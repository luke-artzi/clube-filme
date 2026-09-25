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
  assert.equal(body.movies.length, 250);
  assert.equal(body.movies[0].id, 'tt0111161');

  assert.equal((await ana('PUT', '/api/movies/tt0111161/rating', { rating: 11 })).status, 400);
  assert.equal((await ana('PUT', '/api/movies/tt9999999/rating', { rating: 5 })).status, 404);
  assert.equal((await ana('PUT', '/api/movies/tt0111161/rating', { rating: 10 })).status, 200);
  assert.equal((await bia('PUT', '/api/movies/tt0111161/rating', { rating: 7 })).status, 200);

  const shawshank = (await bia('GET', '/api/movies')).body.movies[0];
  assert.equal(shawshank.myRating, 7);
  assert.equal(shawshank.clubAvg, 8.5);
  assert.equal(shawshank.clubCount, 2);

  const members = (await ana('GET', '/api/members')).body;
  assert.equal(members.members.length, 2);
  assert.equal(members.members[0].watched, 1);

  await bia('DELETE', '/api/movies/tt0111161/rating');
  assert.equal((await bia('GET', '/api/movies')).body.movies[0].myRating, null);

  await ana('POST', '/api/logout');
  assert.equal((await ana('GET', '/api/movies')).status, 401);
  assert.equal((await ana('POST', '/api/login', { username: 'ana', password: 'errada' })).status, 401);
  assert.equal((await ana('POST', '/api/login', { username: 'Ana', password: '123456' })).status, 200);
});
