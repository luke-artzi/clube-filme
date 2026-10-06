'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clube-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.CLUB_INVITE_CODE = 'pipoca';
const { app, syncMovies } = require('../server');
const { movies: LIST } = require('../data/movies.json');
const FIRST = LIST[0].id;

let server, base;
test.before(async () => {
  syncMovies();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

test('fluxo completo: cadastro, nota, média do clube', async () => {
  const ana = client();
  const bia = client();

  assert.equal((await ana('GET', '/api/movies')).status, 401);
  assert.equal((await ana('POST', '/api/register', { username: 'ana', password: '123456', inviteCode: 'errado' })).status, 403);
  assert.equal((await ana('POST', '/api/register', { username: 'ana', displayName: 'Ana', password: '123456', inviteCode: 'pipoca' })).status, 201);
  assert.equal((await bia('POST', '/api/register', { username: 'ANA', password: '123456', inviteCode: 'pipoca' })).status, 409);
  assert.equal((await bia('POST', '/api/register', { username: 'bia', password: '123456', inviteCode: 'pipoca' })).status, 201);

  const { body } = await ana('GET', '/api/movies');
  assert.equal(body.movies.length, LIST.length);
  assert.equal(body.movies[0].id, FIRST);

  assert.equal((await ana('PUT', `/api/movies/${FIRST}/rating`, { rating: 11 })).status, 400);
  assert.equal((await ana('PUT', '/api/movies/tt9999999/rating', { rating: 5 })).status, 404);
  assert.equal((await ana('PUT', `/api/movies/${FIRST}/rating`, { rating: 10 })).status, 200);
  assert.equal((await bia('PUT', `/api/movies/${FIRST}/rating`, { rating: 7 })).status, 200);

  const first = (await bia('GET', '/api/movies')).body.movies[0];
  assert.equal(first.myRating, 7);
  assert.equal(first.clubAvg, 8.5);
  assert.equal(first.clubCount, 2);

  const members = (await ana('GET', '/api/members')).body;
  assert.equal(members.members.length, 2);
  assert.equal(members.members[0].watched, 1);

  await bia('DELETE', `/api/movies/${FIRST}/rating`);
  assert.equal((await bia('GET', '/api/movies')).body.movies[0].myRating, null);

  await ana('POST', '/api/logout');
  assert.equal((await ana('GET', '/api/movies')).status, 401);
  assert.equal((await ana('POST', '/api/login', { username: 'ana', password: 'errada' })).status, 401);
  assert.equal((await ana('POST', '/api/login', { username: 'Ana', password: '123456' })).status, 200);
});

test('addon do Stremio: manifest e catálogos pessoais', async () => {
  const caio = client();
  await caio('POST', '/api/register', { username: 'caio', password: '123456', inviteCode: 'pipoca' });
  await caio('PUT', '/api/movies/tt0068646/rating', { rating: 9 });

  assert.equal((await client()('GET', '/api/stremio')).status, 401);
  const links = (await caio('GET', '/api/stremio')).body;
  assert.match(links.manifestUrl, /^http:\/\/127\.0\.0\.1:\d+\/addon\/[\w-]+\/manifest\.json$/);
  assert.ok(links.appUrl.startsWith('stremio://'));
  const addon = links.manifestUrl.replace(base, '').replace('/manifest.json', '');

  const get = async (p) => {
    const res = await fetch(base + addon + p);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    return { status: res.status, body: await res.json() };
  };

  const man = (await get('/manifest.json')).body;
  assert.deepEqual(man.resources, ['catalog']);
  assert.equal(man.catalogs.length, 4);

  const top = (await get('/catalog/movie/clube-top250.json')).body.metas;
  assert.equal(top.length, Math.min(100, LIST.length));
  assert.equal(top[0].id, FIRST);
  assert.equal((await get('/catalog/movie/clube-top250/skip=200.json')).body.metas.length, Math.max(0, LIST.length - 200));
  const busca = (await get('/catalog/movie/clube-top250/search=poderoso.json')).body.metas;
  assert.ok(busca.every((m) => m.name.includes('Poderoso')) && busca.length >= 2);

  const minhas = (await get('/catalog/movie/clube-minhas-notas.json')).body.metas;
  assert.deepEqual(minhas.map((m) => m.id), ['tt0068646']);
  assert.match(minhas[0].description, /Sua nota: 9/);
  assert.equal((await get('/catalog/movie/clube-nao-vi.json')).body.metas[0].id, FIRST === 'tt0068646' ? LIST[1].id : FIRST);
  assert.ok((await get('/catalog/movie/clube-ranking.json')).body.metas.some((m) => m.id === 'tt0068646'));
  assert.equal((await get('/catalog/movie/outro.json')).status, 404);

  // Gerar link novo invalida o antigo.
  await caio('POST', '/api/stremio/reset');
  assert.equal((await get('/manifest.json')).status, 404);
});
