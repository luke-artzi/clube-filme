'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'clube.db');
const INVITE_CODE = process.env.CLUB_INVITE_CODE || '';
const SESSION_DAYS = 30;
const COOKIE = 'clube_sid';

// ---------- Banco de dados ----------

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS movies (
    id TEXT PRIMARY KEY,
    rank INTEGER,
    title TEXT NOT NULL,
    original_title TEXT NOT NULL,
    year INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ratings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id TEXT NOT NULL REFERENCES movies(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, movie_id)
  );
`);

// Sincroniza a tabela de filmes com data/movies.json a cada início.
// Filmes que saíram do Top 250 ficam com rank NULL (as notas antigas não se perdem).
function syncMovies() {
  const { movies } = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'movies.json'), 'utf8'));
  const upsert = db.prepare(`
    INSERT INTO movies (id, rank, title, original_title, year) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET rank = excluded.rank, title = excluded.title,
      original_title = excluded.original_title, year = excluded.year
  `);
  db.exec('BEGIN');
  try {
    db.exec('UPDATE movies SET rank = NULL');
    for (const m of movies) upsert.run(m.id, m.rank, m.title, m.originalTitle, m.year);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return movies.length;
}

// ---------- Senhas e sessões ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(sha256(token), Date.now()) || null;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Faça login para continuar.' });
  req.user = user;
  next();
}

// Limite simples de tentativas de login/cadastro por IP.
const attempts = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 15 * 60 * 1000; }
  entry.count += 1;
  attempts.set(key, entry);
  if (entry.count > 30) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
  next();
}

// ---------- App ----------

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ inviteRequired: Boolean(INVITE_CODE) });
});

app.post('/api/register', rateLimit, (req, res) => {
  const username = String(req.body.username || '').trim();
  const displayName = String(req.body.displayName || '').trim() || username;
  const password = String(req.body.password || '');
  const invite = String(req.body.inviteCode || '').trim();

  if (INVITE_CODE && invite !== INVITE_CODE) return res.status(403).json({ error: 'Código de convite inválido.' });
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'Usuário deve ter 3 a 30 caracteres (letras, números, ponto, hífen ou _).' });
  }
  if (displayName.length > 40) return res.status(400).json({ error: 'Nome muito longo (máx. 40).' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'Esse usuário já existe.' });
  }

  const { lastInsertRowid } = db.prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)')
    .run(username, displayName, hashPassword(password));
  createSession(res, Number(lastInsertRowid));
  res.status(201).json({ user: { id: Number(lastInsertRowid), username, displayName } });
});

app.post('/api/login', rateLimit, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT id, username, display_name AS displayName, password_hash FROM users WHERE username = ?').get(username);
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }
  createSession(res, row.id);
  res.json({ user: { id: row.id, username: row.username, displayName: row.displayName } });
});

app.post('/api/logout', (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: currentUser(req) });
});

// Lista de filmes com a nota do usuário e a média do clube.
app.get('/api/movies', requireAuth, (req, res) => {
  const movies = db.prepare(`
    SELECT m.id, m.rank, m.title, m.original_title AS originalTitle, m.year,
           my.rating AS myRating,
           ROUND(AVG(r.rating), 1) AS clubAvg,
           COUNT(r.rating) AS clubCount
    FROM movies m
    LEFT JOIN ratings my ON my.movie_id = m.id AND my.user_id = ?
    LEFT JOIN ratings r ON r.movie_id = m.id
    WHERE m.rank IS NOT NULL
    GROUP BY m.id
    ORDER BY m.rank
  `).all(req.user.id);
  res.json({ movies });
});

// Notas de todos os membros para um filme.
app.get('/api/movies/:id/ratings', requireAuth, (req, res) => {
  const ratings = db.prepare(`
    SELECT u.display_name AS displayName, u.username, r.rating, r.updated_at AS updatedAt
    FROM ratings r JOIN users u ON u.id = r.user_id
    WHERE r.movie_id = ?
    ORDER BY r.rating DESC, u.display_name
  `).all(req.params.id);
  res.json({ ratings });
});

// Marca como assistido + nota (1 a 10).
app.put('/api/movies/:id/rating', requireAuth, (req, res) => {
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    return res.status(400).json({ error: 'A nota deve ser um número inteiro de 1 a 10.' });
  }
  if (!db.prepare('SELECT 1 FROM movies WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Filme não encontrado.' });
  }
  db.prepare(`
    INSERT INTO ratings (user_id, movie_id, rating) VALUES (?, ?, ?)
    ON CONFLICT(user_id, movie_id) DO UPDATE SET rating = excluded.rating, updated_at = datetime('now')
  `).run(req.user.id, req.params.id, rating);
  res.json({ ok: true, rating });
});

// Desmarca (não assistido).
app.delete('/api/movies/:id/rating', requireAuth, (req, res) => {
  db.prepare('DELETE FROM ratings WHERE user_id = ? AND movie_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

// Membros do clube e progresso de cada um.
app.get('/api/members', requireAuth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM movies WHERE rank IS NOT NULL').get().n;
  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName,
           COUNT(m.id) AS watched,
           ROUND(AVG(CASE WHEN m.id IS NOT NULL THEN r.rating END), 1) AS avgRating
    FROM users u
    LEFT JOIN ratings r ON r.user_id = u.id
    LEFT JOIN movies m ON m.id = r.movie_id AND m.rank IS NOT NULL
    GROUP BY u.id
    ORDER BY watched DESC, u.display_name
  `).all();
  res.json({ total, members });
});

// Filmes avaliados por um membro.
app.get('/api/members/:username', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, display_name AS displayName FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Membro não encontrado.' });
  const ratings = db.prepare(`
    SELECT m.id, m.rank, m.title, m.original_title AS originalTitle, m.year, r.rating
    FROM ratings r JOIN movies m ON m.id = r.movie_id
    WHERE r.user_id = ?
    ORDER BY r.rating DESC, m.rank
  `).all(user.id);
  res.json({ user, ratings });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno.' });
});

if (require.main === module) {
  const count = syncMovies();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  app.listen(PORT, () => {
    console.log(`Clube do Filme rodando em http://localhost:${PORT} (${count} filmes)`);
    if (!INVITE_CODE) console.log('Aviso: CLUB_INVITE_CODE não definido — qualquer pessoa pode se cadastrar.');
  });
}

module.exports = { app, syncMovies };
