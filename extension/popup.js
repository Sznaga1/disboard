'use strict';
/* Disboard — okienko rozszerzenia. Pokazuje listę zapamiętaną przez część
   w tle (od razu, bez czekania na sieć), a zmiany „+1 / −1” zleca części w tle,
   bo okienko znika, gdy tylko klikniesz gdzie indziej. */

const SITE = 'https://sznaga1.github.io/disboard/';
const $ = (s) => document.querySelector(s);
const KEYS = ['auth', 'view', 'airing', 'pending', 'error', 'lastSync'];
const TABS = [['watching', 'Oglądam'], ['planning', 'Planuję'], ['paused', 'Wstrzymane'], ['completed', 'Obejrzane'], ['dropped', 'Porzucone']];
const STATUS_PL = Object.fromEntries(TABS);
const STATUS_ORDER = ['watching', 'paused', 'planning', 'completed', 'dropped'];
let st = {};
const busy = new Set();
let msgTimer = null;
let refreshing = false;
let tab = 'watching';
try { tab = localStorage.getItem('disboard.tab') || 'watching'; } catch { /* bez pamięci */ }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
const NF1 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });
function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}
function countdown(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.max(1, Math.floor((sec % 3600) / 60));
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}
function clock(ts) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  return today ? hm : `${d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} ${hm}`;
}
const CLOCK_IC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const PLUS_IC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';

/* ---------- motyw ze strony ---------- */
function applyTheme(t) {
  const html = document.documentElement;
  if (!t || t === 'disboard') html.removeAttribute('data-theme'); else html.setAttribute('data-theme', t);
  try { localStorage.setItem('disboard.theme', t || 'disboard'); } catch { /* bez pamięci */ }
}

/* ---------- liczby ---------- */
// to samo co Sync.airInfo w sync.js (emisja z AniList ma pierwszeństwo przed zapisaną na liście)
function airInfo(item) {
  const a = (st.airing && st.airing.map && st.airing.map[item.id]) || null;
  const status = (a && a.status) || item.mstatus;
  const next = a ? a.next : item.next;
  const total = (a && a.episodes) || item.total;
  let aired = null;
  if (next && next.episode) aired = next.airingAt * 1000 <= Date.now() ? next.episode : next.episode - 1;
  else if (status === 'FINISHED') aired = total || null;
  else if (status === 'NOT_YET_RELEASED') aired = 0;
  const last = shownLast(item);
  // „nowe” = do 3 odcinków za emisją; dalej to już nadrabianie (np. One Piece), bez alarmu na ikonce
  const behind = status === 'RELEASING' && aired != null ? Math.max(0, aired - last) : 0;
  const fresh = behind <= 3 ? behind : 0;
  return { status, next, total, aired, fresh, behind };
}
// postęp z doliczonymi zmianami, które jeszcze czekają na zapis
const pendingDelta = (id) => (st.pending || []).filter((p) => p.id === id).reduce((a, p) => a + p.d, 0);
function shownLast(item) {
  const total = (st.airing && st.airing.map && st.airing.map[item.id] && st.airing.map[item.id].episodes) || item.total;
  let n = item.last + pendingDelta(item.id);
  if (total) n = Math.min(n, total);
  return Math.max(0, n);
}

/* ---------- rysowanie ---------- */
function render() {
  const signedIn = !!st.auth;
  if (st.view && st.view.theme) applyTheme(st.view.theme);
  $('#signin').hidden = signedIn;
  $('#main').hidden = !signedIn;
  $('#search').hidden = !signedIn;
  $('#refresh').hidden = !signedIn;
  $('#account').hidden = !signedIn;
  $('#open').href = SITE;
  $('#home').href = SITE;
  if (!signedIn) $('#account-panel').hidden = true;
  if (signedIn) {
    $('#who-name').textContent = st.auth.name || 'Konto Google';
    $('#who-mail').textContent = st.auth.email || '';
    const img = $('#acct-photo');
    if (st.auth.photo) { img.src = st.auth.photo; img.hidden = false; $('#acct-icon').hidden = true; }
  }
  renderSync();
  if (signedIn) renderList();
  if (st.error && !$('#msg').dataset.sticky) showError(st.error);
}

function renderSync() {
  const el = $('#sync');
  const dot = $('#acct-dot');
  el.classList.remove('err');
  dot.className = 'acct-dot';
  $('#refresh').classList.toggle('spin', refreshing);
  if (!st.auth) { el.textContent = ''; return; }
  const pend = (st.pending || []).length;
  let text = '';
  if (pend && st.error && st.error.code === 'offline') { text = `${pend} ${plural(pend, 'zmiana czeka', 'zmiany czekają', 'zmian czeka')} na internet`; dot.classList.add('busy'); }
  else if (pend || busy.size) { text = 'zapisuję…'; dot.classList.add('busy'); }
  else if (refreshing && !st.view) { text = 'pobieram listę…'; dot.classList.add('busy'); }
  else if (st.error && st.error.code !== 'offline') { text = 'błąd synchronizacji'; el.classList.add('err'); dot.classList.add('bad'); }
  else if (st.lastSync) text = `stan z ${clock(st.lastSync)}`;
  el.textContent = text;
  $('#who-sync').textContent = st.lastSync ? `Lista z chmury: ${clock(st.lastSync)}` : '';
}

function cardHtml(item, { showStatus }) {
  const a = airInfo(item);
  const last = shownLast(item);
  const total = a.total;
  const done = total && last >= total;
  const row = [];
  if (showStatus) row.push(`<span class="chip st st-${item.status}"><i></i>${STATUS_PL[item.status]}</span>`);
  if (item.rewatch) row.push(`<span class="chip rw">rewatch #${item.rewatch}</span>`);
  if (a.fresh > 0) row.push(`<span class="chip new">${a.fresh} ${plural(a.fresh, 'nowy', 'nowe', 'nowych')}</span>`);
  if (a.next && a.next.airingAt * 1000 > Date.now()) row.push(`<span class="next-ep" title="Następny odcinek">${CLOCK_IC}odc. ${a.next.episode} · <b>${countdown(a.next.airingAt - Date.now() / 1000)}</b></span>`);
  else if (a.behind > 3) row.push(`<span class="behind">${a.behind} do nadrobienia</span>`);
  else if (!a.fresh && total && !done && item.status === 'watching') row.push(`<span class="behind">zostało ${total - last}</span>`);
  if (item.score && (item.status === 'completed' || showStatus)) row.push(`<span class="score">★ ${NF1.format(item.score)}</span>`);
  const pct = total ? Math.min(100, Math.round((last / total) * 100)) : 100;
  const isBusy = busy.has(item.id);
  const cc = item.color ? ` style="--cc:${esc(item.color)}"` : '';
  const cover = item.cover ? `<img src="${esc(item.cover)}" alt="" loading="lazy" decoding="async">` : `<span class="cover-fb">${esc((item.title || '?').slice(0, 2))}</span>`;
  return `<article class="card${a.fresh ? ' fresh' : ''}${isBusy ? ' busy' : ''}" data-id="${item.id}">
    <a class="cover"${cc} href="${SITE}#/anime/${item.id}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">
      ${cover}
      ${a.fresh ? `<span class="cover-new">+${a.fresh}</span>` : ''}
      ${item.fav ? '<span class="cover-fav">★</span>' : ''}
    </a>
    <div class="body">
      <a class="title" href="${SITE}#/anime/${item.id}" target="_blank" rel="noopener" title="${esc(item.sub ? `${item.title}\n${item.sub}` : item.title)}">${esc(item.title)}</a>
      ${row.length ? `<div class="row">${row.join('')}</div>` : ''}
      <div class="prog st-${item.status}">
        <div class="pbar${total ? '' : ' unknown'}"><i style="width:${pct}%"></i></div>
        <div class="prog-row">
          <span class="num">${last}<small> / ${total || '?'}</small></span>
          <span class="steps">
            <button class="btn-inc minus" data-d="-1" title="Cofnij odcinek" aria-label="Cofnij odcinek: ${esc(item.title)}" ${last <= 0 ? 'disabled' : ''}>−1</button>
            <button class="btn-inc plus" data-d="1" title="Obejrzałem odcinek ${last + 1}" aria-label="Obejrzałem odcinek ${last + 1}: ${esc(item.title)}" ${done ? 'disabled' : ''}>${PLUS_IC}1</button>
          </span>
        </div>
      </div>
    </div>
  </article>`;
}

function sortTab(rows, status) {
  if (status === 'watching') {
    return rows.map((i) => ({ i, f: airInfo(i).fresh > 0 }))
      .sort((x, y) => (y.f - x.f) || (y.i.upd - x.i.upd)).map((x) => x.i);
  }
  return [...rows].sort((x, y) => y.upd - x.upd);
}

function renderTabs(items, q, found) {
  const nav = $('#tabs');
  if (q) {
    nav.innerHTML = `<span class="tab static on">Wyniki <span class="tab-n">${found}</span></span>`;
    return;
  }
  const count = Object.fromEntries(TABS.map(([k]) => [k, 0]));
  for (const i of items) if (count[i.status] !== undefined) count[i.status]++;
  nav.innerHTML = TABS.map(([k, label]) => `<button class="tab${k === tab ? ' on' : ''}" role="tab" aria-selected="${k === tab}" data-tab="${k}">${label} <span class="tab-n">${count[k]}</span></button>`).join('');
}

function renderList() {
  const box = $('#list');
  if (!st.view) {
    renderTabs([], '', 0);
    box.innerHTML = `<div class="empty">${st.error ? 'Nie udało się pobrać listy.' : 'Pobieram Twoją listę…'}</div>`;
    return;
  }
  const items = st.view.items;
  const raw = $('#q').value.trim();
  const q = norm(raw);
  const scroll = box.scrollTop;
  if (q) {
    const words = q.split(/\s+/);
    const rows = items
      .map((i) => ({ i, hay: norm(`${i.title} | ${i.find}`) }))
      .filter((x) => words.every((w) => x.hay.includes(w)))
      .sort((x, y) => (STATUS_ORDER.indexOf(x.i.status) - STATUS_ORDER.indexOf(y.i.status))
        || ((norm(y.i.title).startsWith(q) ? 1 : 0) - (norm(x.i.title).startsWith(q) ? 1 : 0))
        || (y.i.upd - x.i.upd))
      .map((x) => x.i);
    renderTabs(items, q, rows.length);
    box.innerHTML = rows.length
      ? rows.slice(0, 60).map((i) => cardHtml(i, { showStatus: true })).join('')
      : `<div class="empty">Nie masz na liście nic pasującego do <b>„${esc(raw)}”</b>.<br>Nowe tytuły dodasz w Disboard.</div>`;
    return;
  }
  renderTabs(items, '', 0);
  const rows = sortTab(items.filter((i) => i.status === tab), tab);
  const empty = {
    watching: 'Nic teraz nie oglądasz.<br>Wpisz tytuł u góry, żeby znaleźć coś na swojej liście.',
    planning: 'Nie masz nic w planach.',
    paused: 'Nic nie jest wstrzymane.',
    completed: 'Nie masz jeszcze obejrzanych tytułów.',
    dropped: 'Nic nie porzuciłeś.',
  }[tab];
  box.innerHTML = rows.length ? rows.map((i) => cardHtml(i, { showStatus: false })).join('') : `<div class="empty">${empty}</div>`;
  box.scrollTop = scroll;
}

/* ---------- komunikaty ---------- */
function hideMsg() { const el = $('#msg'); el.hidden = true; delete el.dataset.sticky; }
function showMsg(text, kind = '', { ms = 5000 } = {}) {
  const el = $('#msg');
  clearTimeout(msgTimer);
  el.hidden = false;
  el.className = `msg ${kind}`;
  el.innerHTML = `<span></span><button type="button" aria-label="Zamknij">×</button>`;
  el.querySelector('span').textContent = text;
  el.dataset.sticky = '1';
  if (ms) msgTimer = setTimeout(hideMsg, ms);
}
function showError(err) {
  if (!err) return;
  if (err.code === 'offline' && (st.pending || []).length) { showMsg(err.msg, '', { ms: 0 }); return; }
  showMsg(err.msg, 'err', { ms: 0 });
}

/* ---------- akcje ---------- */
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message })));

async function step(id, d, btn) {
  const item = st.view && st.view.items.find((i) => i.id === id);
  if (!item || busy.has(id)) return;
  const from = shownLast(item);
  busy.add(id);
  if (btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  renderSync();
  const card = btn && btn.closest('.card');
  if (card) card.classList.add('busy');
  const r = await send({ type: 'step', id, from, d });
  busy.delete(id);
  const mine = r && r.results ? [...r.results].reverse().find((x) => x.op.id === id) : null;
  if (!r || !r.ok) {
    if (r && r.code === 'offline') showMsg('Brak internetu. Zmiana poczeka i zapisze się sama, gdy połączenie wróci.');
    else showMsg((r && r.error) || 'Nie udało się zapisać zmiany.', 'err', { ms: 0 });
  } else if (mine) {
    const toasts = mine.toasts || [];
    if (mine.result === 'ok') {
      if (toasts.length) showMsg(toasts.join(' · '), 'ok', { ms: 6000 });
      else showMsg(`${item.title}: ${d > 0 ? `obejrzany odc. ${mine.last}` : `cofnięto do odc. ${mine.last}`}`, 'ok', { ms: 2500 });
    } else if (mine.result === 'already') showMsg('Ten odcinek był już zaznaczony na innym urządzeniu. Nic nie zmieniłem.');
    else if (mine.result === 'changed') showMsg('Lista zmieniła się na innym urządzeniu. Pokazuję aktualny stan, kliknij jeszcze raz.');
    else if (mine.result === 'missing') showMsg('Tego tytułu nie ma już na liście.', 'err');
    else showMsg('Nic do zmiany.');
  }
  await load();
  if (mine && mine.result === 'ok') {
    const c = document.querySelector(`.card[data-id="${id}"]`);
    if (c) c.classList.add('flash');
  }
}

async function refresh(force) {
  refreshing = true;
  renderSync();
  await send({ type: 'refresh', force });
  refreshing = false;
  await load();
}

async function load() {
  st = await chrome.storage.local.get(KEYS);
  render();
}

/* ---------- start ---------- */
$('#list').addEventListener('click', (ev) => {
  const b = ev.target.closest('.btn-inc');
  if (!b || b.disabled) return;
  step(Number(b.closest('.card').dataset.id), Number(b.dataset.d), b);
});
$('#tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  try { localStorage.setItem('disboard.tab', tab); } catch { /* bez pamięci */ }
  $('#list').scrollTop = 0;
  renderList();
});
$('#q').addEventListener('input', () => { $('#list').scrollTop = 0; renderList(); });
$('#q').addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && ev.target.value) { ev.preventDefault(); ev.target.value = ''; renderList(); }
});
$('#msg').addEventListener('click', (ev) => { if (ev.target.closest('button')) hideMsg(); });
$('#refresh').addEventListener('click', () => refresh(true));
$('#account').addEventListener('click', () => {
  const p = $('#account-panel');
  p.hidden = !p.hidden;
  $('#account').setAttribute('aria-expanded', String(!p.hidden));
});
$('#signout').addEventListener('click', async () => {
  await send({ type: 'signout' });
  $('#account-panel').hidden = true;
  await load();
});
$('#signin-btn').addEventListener('click', async (ev) => {
  ev.target.disabled = true;
  showMsg('Otwieram okno logowania Google…', '', { ms: 0 });
  const r = await send({ type: 'signin' }); // okienko zwykle zamknie się samo, gdy pojawi się okno Google
  ev.target.disabled = false;
  if (r && !r.ok) showMsg(r.error, 'err', { ms: 0 });
  else hideMsg();
  await load();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !KEYS.some((k) => k in changes)) return;
  for (const k of KEYS) if (k in changes) st[k] = changes[k].newValue;
  if ('error' in changes && !changes.error.newValue && $('#msg').classList.contains('err') && !busy.size) hideMsg();
  render();
});
// odliczanie do odcinków odświeża się co minutę, póki okienko jest otwarte
setInterval(() => { if (st.view && !busy.size) renderList(); }, 60e3);

load().then(() => {
  if (st.auth) refresh(false);
  $('#q').focus();
});
