'use strict';

const $ = (sel) => document.querySelector(sel);
const state = { user: null, movies: [], inviteRequired: false, mode: 'login' };

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') showAuth();
  if (!res.ok) throw new Error(data.error || 'Algo deu errado.');
  return data;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const imdbUrl = (id) => `https://www.imdb.com/pt/title/${id}/`;
const fmt = (n) => (n == null ? '–' : Number(n).toFixed(1).replace('.', ','));

// ---------- Autenticação ----------

function setMode(mode) {
  state.mode = mode;
  const reg = mode === 'register';
  $('#tab-login').classList.toggle('active', !reg);
  $('#tab-register').classList.toggle('active', reg);
  $('#f-display').hidden = !reg;
  $('#f-invite').hidden = !(reg && state.inviteRequired);
  $('#auth-submit').textContent = reg ? 'Criar conta' : 'Entrar';
  $('#auth-form').password.autocomplete = reg ? 'new-password' : 'current-password';
  $('#auth-error').textContent = '';
}

function showAuth() {
  state.user = null;
  $('#auth').hidden = false;
  $('#nav').hidden = true;
  $('#userbox').hidden = true;
  for (const v of ['movies', 'ranking', 'members']) $(`#view-${v}`).hidden = true;
}

async function onLoggedIn(user) {
  state.user = user;
  $('#auth').hidden = true;
  $('#nav').hidden = false;
  $('#userbox').hidden = false;
  $('#user-name').textContent = user.displayName;
  await loadMovies();
  showView('movies');
}

$('#tab-login').onclick = () => setMode('login');
$('#tab-register').onclick = () => setMode('register');

$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const body = Object.fromEntries(form.entries());
  try {
    const { user } = await api(state.mode === 'register' ? '/api/register' : '/api/login', { method: 'POST', body });
    e.target.reset();
    await onLoggedIn(user);
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
};

$('#logout').onclick = async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  showAuth();
};

// ---------- Navegação ----------

function showView(view) {
  for (const btn of document.querySelectorAll('#nav button')) btn.classList.toggle('active', btn.dataset.view === view);
  for (const v of ['movies', 'ranking', 'members']) $(`#view-${v}`).hidden = v !== view;
  if (view === 'ranking') renderRanking();
  if (view === 'members') loadMembers();
}
for (const btn of document.querySelectorAll('#nav button')) btn.onclick = () => showView(btn.dataset.view);

// ---------- Filmes ----------

async function loadMovies() {
  const { movies } = await api('/api/movies');
  state.movies = movies;
  renderMovies();
}

function renderSummary() {
  const watched = state.movies.filter((m) => m.myRating != null);
  const avg = watched.length ? watched.reduce((s, m) => s + m.myRating, 0) / watched.length : null;
  const pct = Math.round((watched.length / (state.movies.length || 1)) * 100);
  $('#summary').innerHTML = `
    <div><strong>${watched.length}</strong> de ${state.movies.length} assistidos</div>
    <div class="progress"><span style="width:${pct}%"></span></div>
    <div>Sua média: <strong>${fmt(avg)}</strong></div>`;
}

function filteredMovies() {
  const q = $('#search').value.trim().toLowerCase();
  const filter = $('#filter').value;
  const sort = $('#sort').value;
  let list = state.movies.filter((m) => {
    if (filter === 'watched' && m.myRating == null) return false;
    if (filter === 'unwatched' && m.myRating != null) return false;
    if (!q) return true;
    return `${m.title} ${m.originalTitle} ${m.year}`.toLowerCase().includes(q);
  });
  const byNullLast = (key) => (a, b) => (b[key] ?? -1) - (a[key] ?? -1) || a.rank - b.rank;
  if (sort === 'mine') list.sort(byNullLast('myRating'));
  else if (sort === 'club') list.sort(byNullLast('clubAvg'));
  else if (sort === 'year') list.sort((a, b) => b.year - a.year || a.rank - b.rank);
  else if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  else list.sort((a, b) => a.rank - b.rank);
  return list;
}

function ratingButtons(m) {
  let html = '';
  for (let n = 1; n <= 10; n++) {
    html += `<button class="star ${m.myRating === n ? 'on' : ''} ${m.myRating >= n ? 'fill' : ''}" data-rate="${n}" data-id="${m.id}" title="Nota ${n}">${n}</button>`;
  }
  return html;
}

function movieItem(m) {
  const watched = m.myRating != null;
  return `
    <li class="movie ${watched ? 'watched' : ''}" data-id="${m.id}">
      <div class="rank">#${m.rank}</div>
      <div class="info">
        <button class="title link" data-open="${m.id}">${esc(m.title)}</button>
        <div class="meta">${m.originalTitle !== m.title ? `${esc(m.originalTitle)} · ` : ''}${m.year}
          · <a href="${imdbUrl(m.id)}" target="_blank" rel="noopener">IMDb ↗</a></div>
        <div class="club">Clube: <strong>${fmt(m.clubAvg)}</strong> <span class="muted">(${m.clubCount} ${m.clubCount === 1 ? 'nota' : 'notas'})</span></div>
      </div>
      <div class="rate">
        <div class="rate-label">${watched ? `✓ Assisti · sua nota: <strong>${m.myRating}</strong>` : 'Já assistiu? Dê sua nota:'}</div>
        <div class="stars">${ratingButtons(m)}</div>
        ${watched ? `<button class="link small" data-unrate="${m.id}">Desmarcar</button>` : ''}
      </div>
    </li>`;
}

function renderMovies() {
  renderSummary();
  const list = filteredMovies();
  $('#movie-list').innerHTML = list.length ? list.map(movieItem).join('') : '<li class="empty">Nenhum filme encontrado.</li>';
}

async function setRating(id, rating) {
  const movie = state.movies.find((m) => m.id === id);
  const prev = movie.myRating;
  try {
    if (rating == null) await api(`/api/movies/${id}/rating`, { method: 'DELETE' });
    else await api(`/api/movies/${id}/rating`, { method: 'PUT', body: { rating } });
    await loadMovies();
  } catch (err) {
    movie.myRating = prev;
    alert(err.message);
  }
}

$('#movie-list').addEventListener('click', (e) => {
  const rate = e.target.closest('[data-rate]');
  if (rate) return setRating(rate.dataset.id, Number(rate.dataset.rate));
  const unrate = e.target.closest('[data-unrate]');
  if (unrate) return setRating(unrate.dataset.unrate, null);
  const open = e.target.closest('[data-open]');
  if (open) return openMovie(open.dataset.open);
});

let searchTimer;
$('#search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderMovies, 120); };
$('#filter').onchange = renderMovies;
$('#sort').onchange = renderMovies;

// ---------- Detalhe do filme ----------

async function openMovie(id) {
  const m = state.movies.find((x) => x.id === id);
  const { ratings } = await api(`/api/movies/${id}/ratings`);
  $('#dialog-body').innerHTML = `
    <h2>${esc(m.title)} <span class="muted">(${m.year})</span></h2>
    <p class="muted">${esc(m.originalTitle)} · #${m.rank} no IMDb · <a href="${imdbUrl(m.id)}" target="_blank" rel="noopener">ver no IMDb ↗</a></p>
    <p>Média do clube: <strong>${fmt(m.clubAvg)}</strong> (${m.clubCount} ${m.clubCount === 1 ? 'nota' : 'notas'})</p>
    ${ratings.length ? `<ul class="who">${ratings.map((r) => `<li><span>${esc(r.displayName)}</span><strong>${r.rating}</strong></li>`).join('')}</ul>`
      : '<p class="muted">Ninguém do clube avaliou ainda.</p>'}`;
  $('#movie-dialog').showModal();
}

// ---------- Ranking ----------

function renderRanking() {
  const rated = state.movies.filter((m) => m.clubCount > 0)
    .sort((a, b) => b.clubAvg - a.clubAvg || b.clubCount - a.clubCount || a.rank - b.rank);
  $('#ranking-list').innerHTML = rated.length
    ? rated.map((m) => `
      <li>
        <button class="link" data-open="${m.id}">${esc(m.title)}</button> <span class="muted">(${m.year})</span>
        <span class="score">${fmt(m.clubAvg)} <small>${m.clubCount} ${m.clubCount === 1 ? 'nota' : 'notas'}</small></span>
      </li>`).join('')
    : '<li class="empty">Ainda não há notas. Comece avaliando os filmes que você já viu!</li>';
}
$('#ranking-list').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) openMovie(open.dataset.open);
});

// ---------- Membros ----------

async function loadMembers() {
  const { total, members } = await api('/api/members');
  $('#member-detail').innerHTML = '';
  $('#member-list').innerHTML = members.map((u) => `
    <li>
      <button class="link" data-member="${esc(u.username)}">${esc(u.displayName)}</button>
      <span class="muted">@${esc(u.username)}</span>
      <div class="progress"><span style="width:${Math.round((u.watched / (total || 1)) * 100)}%"></span></div>
      <span>${u.watched}/${total} · média ${fmt(u.avgRating)}</span>
    </li>`).join('');
}

$('#member-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-member]');
  if (!btn) return;
  const { user, ratings } = await api(`/api/members/${encodeURIComponent(btn.dataset.member)}`);
  $('#member-detail').innerHTML = `
    <h3>Notas de ${esc(user.displayName)}</h3>
    ${ratings.length ? `<ol class="ranking">${ratings.map((r) => `
      <li>${esc(r.title)} <span class="muted">(${r.year})</span><span class="score">${r.rating}</span></li>`).join('')}</ol>`
      : '<p class="muted">Ainda não avaliou nenhum filme.</p>'}`;
  $('#member-detail').scrollIntoView({ behavior: 'smooth' });
});

// ---------- Início ----------

(async function init() {
  try {
    const config = await api('/api/config');
    state.inviteRequired = config.inviteRequired;
    setMode('login');
    const { user } = await api('/api/me');
    if (user) await onLoggedIn(user);
    else showAuth();
  } catch (err) {
    showAuth();
  }
})();
