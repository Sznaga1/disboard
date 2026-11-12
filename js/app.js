'use strict';
/* ==========================================================================
   Disboard — start aplikacji: routing, akcje globalne, odliczanie,
   licznik oczekiwania na 2. sezon NGNL, powiadomienia, odświeżanie w tle.
   ========================================================================== */

/* ---------- licznik „Jak długo czekam na drugi sezon No Game No Life” ---------- */
const Wait = (() => {
  let series = null;
  let el = null;

  function base() {
    const w = S.settings.wait;
    if (w.mode === 'custom' && w.custom) return { t: w.custom, label: `od ${fmtDateTime(w.custom)} (Twoja data)` };
    const t = NGNL.s1EndTs(series);
    return { t, label: `od ${fmtDate(t)}, emisji ostatniego odcinka 1. sezonu` };
  }

  function state() {
    const seq = series ? NGNL.sequelInfo(series) : null;
    const b = base();
    let end = Date.now(), mode = 'waiting';
    if (seq && seq.media) {
      const st = fuzzyTs(seq.media.startDate);
      if (seq.media.status === 'RELEASING' || seq.media.status === 'FINISHED') { mode = 'done'; if (st) end = st; }
      else mode = 'announced';
    }
    return { b, seq, end, mode };
  }

  const narrow = window.matchMedia('(max-width: 1023px)');
  // na telefonie domyślnie zwinięty do pigułki, żeby nie zasłaniał treści
  const isCollapsed = () => (narrow.matches ? S.settings.wait.collapsedMobile !== false : !!S.settings.wait.collapsed);

  function render() {
    el = el || document.getElementById('wait');
    if (!el) return;
    const w = S.settings.wait;
    const collapsed = isCollapsed();
    el.hidden = !!w.hidden;
    const { b, seq, end, mode } = state();
    const d = diffCalendar(b.t, end);
    const big = `${d.y ? `<span><b>${d.y}</b> ${unit(d.y, 'year')}</span>` : ''}<span><b>${d.d}</b> ${unit(d.d, 'day')}</span>`;
    const clock = `${pad2(d.h)}:${pad2(d.m)}:${pad2(d.s)}`;
    const short = `${d.y ? `${d.y} ${unit(d.y, 'year')} ` : ''}${d.d} ${unit(d.d, 'day')} ${clock}`;
    const statusLine = mode === 'announced'
      ? `<a class="wait-flag" href="#/anime/${seq.media.id}">Zapowiedziano! ${esc(fuzzyDate(seq.media.startDate) || 'data nieustalona')}</a>`
      : mode === 'done' ? `<a class="wait-flag" href="#/anime/${seq.media.id}">Doczekałem się! Oglądaj</a>` : '';
    el.classList.toggle('collapsed', collapsed);
    el.innerHTML = `
      <button class="wait-toggle" type="button" aria-expanded="${!collapsed}" aria-controls="wait-body" title="${collapsed ? 'Rozwiń licznik' : 'Zwiń licznik'}">
        <span class="wait-pawn" aria-hidden="true"></span>
        <span class="wait-mini num">${esc(d.y ? `${d.y} l. ${d.d} d.` : `${d.d} d.`)}</span>
      </button>
      <div class="wait-body" id="wait-body">
        <p class="wait-q">Jak długo czekam na drugi sezon No Game No Life</p>
        <p class="wait-big num">${big}</p>
        <p class="wait-clock num" aria-hidden="true">${clock}</p>
        <p class="wait-since">${esc(b.label)} · łącznie ${NF.format(d.totalDays)} ${unit(d.totalDays, 'day')}</p>
        ${statusLine}
      </div>`;
    $$('[data-wait="short"]').forEach((x) => { x.textContent = short; });
    $$('[data-wait="since"]').forEach((x) => { x.textContent = b.label; });
  }

  function tick() {
    if (!el) return;
    const { b, end, mode } = state();
    const d = diffCalendar(b.t, mode === 'done' ? end : Date.now());
    const c = el.querySelector('.wait-clock');
    if (c) c.textContent = `${pad2(d.h)}:${pad2(d.m)}:${pad2(d.s)}`;
    if (d.h === 0 && d.m === 0 && d.s === 0) render();
    const short = `${d.y ? `${d.y} ${unit(d.y, 'year')} ` : ''}${d.d} ${unit(d.d, 'day')} ${pad2(d.h)}:${pad2(d.m)}:${pad2(d.s)}`;
    $$('[data-wait="short"]').forEach((x) => { x.textContent = short; });
  }

  function init() {
    el = document.getElementById('wait');
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.wait-toggle')) {
        if (narrow.matches) S.settings.wait.collapsedMobile = !isCollapsed();
        else S.settings.wait.collapsed = !isCollapsed();
        save();
        render();
      }
    });
    if (narrow.addEventListener) narrow.addEventListener('change', render);
    render();
    NGNL.series().then((s) => { series = s; render(); }).catch(() => {});
  }

  return { init, render, tick, state, setSeries: (s) => { series = s; render(); } };
})();

/* ---------- tryb uzupełniania listy (Alt+U) ---------- */
const Backfill = (() => {
  const active = () => !!S.settings.backfill;
  function render() {
    const pill = document.getElementById('bf-pill');
    document.body.classList.toggle('backfill-on', active());
    if (pill) pill.hidden = !active();
    // tooltipy „+” na okładkach już wyświetlonych
    $$('.acard-add[data-quick]').forEach((b) => { b.title = UI.quickAddTitle(b.dataset.status || 'planning'); });
  }
  function set(v, { silent = false } = {}) {
    S.settings.backfill = !!v;
    save();
    emit('settings', { backfill: active() });
    if (silent) return;
    toast(active()
      ? 'Tryb uzupełniania włączony: to, co oznaczysz jako obejrzane, zapisze się bez daty, a „+” na okładkach doda tytuł jako Obejrzane. Alt+U wyłącza.'
      : 'Tryb uzupełniania wyłączony. Odcinki znów zapisują się z dzisiejszą datą.',
    { kind: active() ? 'warn' : 'ok', ms: active() ? 6500 : 3500 });
  }
  function init() {
    const pill = document.getElementById('bf-pill');
    if (pill) pill.addEventListener('click', () => set(false));
    document.addEventListener('keydown', (ev) => {
      // Alt+U działa wszędzie, także w trakcie pisania w wyszukiwarce (nie wpisuje znaku)
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && ev.code === 'KeyU') {
        ev.preventDefault();
        set(!active());
      }
    });
    on('settings', render);
    render();
  }
  return { on: active, set, toggle: () => set(!active()), init, render };
})();

/* ---------- pomijanie fillerów (Alt+P) ---------- */
const SkipFill = (() => {
  const active = () => !!S.settings.skipFiller;
  function render() {
    const pill = document.getElementById('sf-pill');
    if (pill) pill.hidden = !active();
  }
  function set(v, { silent = false } = {}) {
    S.settings.skipFiller = !!v;
    save();
    emit('settings', { skipFiller: active() });
    if (active()) {
      // dane o fillerach dla oglądanych serii, żeby plusik na kartach od razu wiedział, co pominąć
      Episodes.scan(Object.values(S.entries).filter((e) => e.status === 'watching')).catch(() => {});
    }
    if (silent) return;
    toast(active()
      ? 'Pomijanie fillerów włączone: plusik przeskoczy fillery i recapy (dane z MyAnimeList). Pominięte odcinki nie liczą się do czasu. Alt+P wyłącza.'
      : 'Pomijanie fillerów wyłączone. Plusik znów dodaje każdy kolejny odcinek.',
    { kind: active() ? 'warn' : 'ok', ms: active() ? 6500 : 3500 });
  }
  function init() {
    const pill = document.getElementById('sf-pill');
    if (pill) pill.addEventListener('click', () => set(false));
    document.addEventListener('keydown', (ev) => {
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && ev.code === 'KeyP') {
        ev.preventDefault();
        set(!active());
      }
    });
    on('settings', render);
    render();
  }
  return { on: active, set, init, render };
})();

/* ---------- pisanie w dowolnym miejscu = szukanie ---------- */
// Litera wpisana poza polem tekstowym przenosi do wyszukiwarki i trafia do pola.
// Znaki wpisane w trakcie przejścia zbieramy w buforze, więc nic nie ginie przy szybkim pisaniu.
// „/” tylko otwiera wyszukiwarkę. Spacja dalej przewija stronę.
const TypeSearch = (() => {
  let buf = '';
  let pending = false;
  const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
  function onKey(ev) {
    if (ev.defaultPrevented || ev.isComposing) return;
    const altgr = ev.getModifierState && ev.getModifierState('AltGraph');
    if (ev.metaKey || ((ev.ctrlKey || ev.altKey) && !altgr)) return;
    const k = ev.key;
    if (!k || k.length !== 1) return;
    if (k === ' ' && !pending) return;
    const t = ev.target;
    if (t && t.closest && t.closest(EDITABLE)) return;
    if (QuickAdd.isOpen() || document.querySelector('.lightbox:not([hidden])')) return;
    const inp = document.getElementById('s-q');
    if (!pending && inp && /^#\/szukaj/.test(location.hash)) {
      // pole nie jest aktywne (np. po dodaniu anime z wyników): zaczynamy nowe wyszukiwanie od zera
      ev.preventDefault();
      inp.focus({ preventScroll: true });
      if (k === '/') { inp.select(); return; }
      inp.value = k;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.setSelectionRange(inp.value.length, inp.value.length);
      return;
    }
    ev.preventDefault();
    if (k !== '/') buf += k;
    if (!pending) {
      pending = true;
      location.hash = '#/szukaj?typed=1';
    }
  }
  function take() { const b = buf; buf = ''; pending = false; return b; }
  // po każdym przejściu zdejmujemy blokadę, nawet gdyby wyszukiwarka nie odebrała bufora
  function settle() { pending = false; buf = ''; }
  return { init: () => document.addEventListener('keydown', onKey), take, settle };
})();

/* ---------- routing ---------- */
const ROUTES = [
  [/^\/?$/, 'home', []],
  [/^\/lista(?:\/(\w+))?$/, 'list', ['tab']],
  [/^\/szukaj$/, 'search', []],
  [/^\/anime\/(\d+)$/, 'anime', ['id']],
  [/^\/premiery(?:\/(\w+))?$/, 'upcoming', ['tab']],
  [/^\/ngnl$/, 'ngnl', []],
  [/^\/skaner$/, 'scanner', []],
  [/^\/statystyki(?:\/(\w+))?$/, 'stats', ['tab']],
  [/^\/osoba\/(\d+)$/, 'person', ['id']],
  [/^\/historia(?:\/(\d+))?$/, 'history', ['id']],
  [/^\/ustawienia$/, 'settings', []],
];
const NAV_OF = { home: 'home', list: 'list', search: 'search', anime: 'search', upcoming: 'upcoming', ngnl: 'ngnl', scanner: 'scanner', stats: 'stats', person: 'search', history: 'history', settings: 'settings' };

let viewToken = 0;
let viewCleanups = [];
let lastRouteKey = '';

function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  let name = 'home', params = {};
  for (const [re, n, keys] of ROUTES) {
    const m = path.match(re);
    if (m) { name = n; keys.forEach((k, i) => { params[k] = m[i + 1]; }); break; }
  }
  const key = `${name}:${JSON.stringify(params)}`;
  viewCleanups.forEach((f) => { try { f(); } catch { /* */ } });
  viewCleanups = [];
  const token = ++viewToken;
  const el = document.getElementById('view');
  const ctx = {
    el, params, query: new URLSearchParams(qs || ''),
    alive: () => token === viewToken,
    title: (t) => { document.title = `${t} · Disboard`; document.getElementById('page-title').textContent = t; },
    onLibrary: (fn) => {
      // zmiany z jednej akcji (np. status → postęp → zakończenie) scalamy w jedno
      // odświeżenie po zakończeniu bieżącego zdarzenia; chroni też przed ponownym
      // wejściem, gdy przebudowa widoku zabiera fokus polu i wywołuje jego „change”
      let pending = false, last;
      viewCleanups.push(on('library', (d) => {
        if (token !== viewToken) return;
        last = pending && (!last || !d || last.id !== d.id) ? null : d;
        if (pending) return;
        pending = true;
        queueMicrotask(() => { pending = false; if (token === viewToken) fn(last); });
      }));
    },
    on: (evt, fn) => { viewCleanups.push(on(evt, (d) => { if (token === viewToken) fn(d); })); },
    onLeave: (fn) => { viewCleanups.push(fn); },
  };
  const changed = key !== lastRouteKey;
  const from = lastRouteKey;
  lastRouteKey = key;
  // rysowanie nowej strony; przy płynnych przejściach (Bajery) przeglądarka woła to chwilę później
  const paint = () => {
    if (token !== viewToken) return;
    $$('[data-nav]').forEach((a) => {
      const onNav = a.dataset.nav === NAV_OF[name];
      a.classList.toggle('on', onNav);
      if (onNav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (!FX.on('vt')) {
      el.classList.remove('enter');
      void el.offsetWidth;
      el.classList.add('enter');
    }
    try {
      Pages[name](ctx);
    } catch (err) {
      console.error(err);
      el.innerHTML = UI.errorBox(err);
    }
    if (changed) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    closeSheets();
    TypeSearch.settle();
  };
  FX.navigate(paint, { from, to: key, name, params, query: ctx.query });
}

/* ---------- akcje globalne (delegacja) ---------- */
document.addEventListener('click', (ev) => {
  const add = ev.target.closest('[data-add]');
  if (add) {
    ev.preventDefault();
    // po przytrzymaniu na dotyku otwiera się menu — ten klik nie dodaje do Planuję
    if (QuickAdd.shouldSuppressClick()) return;
    QuickAdd.close();
    const id = Number(add.dataset.add);
    const base = add.dataset.status || 'planning';
    const status = add.dataset.quick ? UI.quickStatus(base) : base;
    const done = (media) => toast(`Dodano: ${titleOf(media)} → ${LSTATUS_PL[status]}${Backfill.on() && status !== 'planning' ? ' · bez daty' : ''}`, { kind: 'ok' });
    const m = UI.media.get(id) || (Lib.get(id) && Lib.get(id).media);
    if (!m) {
      Ani.media(id).then((r) => { Lib.add(r.media, status); done(r.media); })
        .catch((err) => toast(err.message, { kind: 'error' }));
      return;
    }
    Lib.add(m, status);
    done(m);
    return;
  }
  const addMal = ev.target.closest('[data-add-mal]');
  if (addMal) {
    ev.preventDefault();
    addMal.disabled = true;
    Ani.byMalIds([Number(addMal.dataset.addMal)]).then((list) => {
      const m = list[0];
      if (!m) throw new ApiError('notfound', 'Tego tytułu nie ma jeszcze w AniList, więc nie mogę go dodać.');
      const status = UI.quickStatus('planning');
      Lib.add(m, status);
      toast(`Dodano: ${titleOf(m)} → ${LSTATUS_PL[status]}${Backfill.on() ? ' · bez daty' : ''}`, { kind: 'ok' });
    }).catch((err) => {
      addMal.disabled = false;
      toast(err.kind === 'notfound' ? err.message : 'AniList wciąż nie odpowiada, więc nie mogę jeszcze dodać tego tytułu. Spróbuj za kilka minut.', { kind: 'warn', ms: 6000 });
    });
    return;
  }
  const inc = ev.target.closest('[data-inc]');
  if (inc) {
    ev.preventDefault();
    const id = Number(inc.dataset.inc);
    const d = Number(inc.dataset.d || 1);
    Lib.increment(id, d);
    const e = Lib.get(id);
    if (e && d > 0) {
      const dur = Lib.epDur(e);
      inc.classList.add('pop');
      if (dur) toast(`${titleOf(e.media)}: odc. ${Lib.lastEp(e)} · +${dur} min${Backfill.on() ? ' · bez daty' : ''}`, { kind: 'ok', ms: 2200 });
    }
    return;
  }
  const rw = ev.target.closest('[data-rewatch]');
  if (rw) { ev.preventDefault(); Lib.startRewatch(Number(rw.dataset.rewatch)); return; }
  const news = ev.target.closest('[data-news]');
  if (news) NGNL.markOpened(news.dataset.news);
});

/* ---------- odliczanie (co sekundę) ---------- */
function tickCountdowns() {
  const now = Date.now() / 1000;
  $$('.cd[data-cd]').forEach((el) => {
    const left = Number(el.dataset.cd) - now;
    if (left <= 0) { el.textContent = 'już po emisji'; el.classList.add('done'); el.removeAttribute('data-cd'); return; }
    el.textContent = fmtCountdown(left, { short: !!el.dataset.short });
  });
  Wait.tick();
}

/* ---------- panel powiadomień ---------- */
const KIND_PL = { episode: 'Nowy odcinek', premiere: 'Premiera', news: 'NGNL', merch: 'Merch NGNL', change: 'Zmiana', sequel: 'Kontynuacja' };
function renderBell() {
  const n = Lib.unreadCount();
  const b = $('#bell-count');
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : String(n);
  $('#bell').setAttribute('aria-label', n ? `Powiadomienia: ${n} nowych` : 'Powiadomienia');
}
function renderDrawer() {
  const list = S.notifs.filter((n) => S.settings.notifyKinds[n.kind] !== false).slice(0, 80);
  $('#drawer-list').innerHTML = list.length ? list.map((n) => `
    <li class="${n.read ? '' : 'unread'} k-${n.kind}"><a href="${esc(n.link || '#/')}">
      <span class="dn-kind">${esc(KIND_PL[n.kind] || n.kind)}</span><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ''}<time>${esc(relTime(n.t))}</time></a></li>`).join('')
    : `<li class="dn-empty">${UI.empty('Brak powiadomień', 'Aplikacja sama sprawdza nowe odcinki, premiery i wiadomości o No Game No Life.')}</li>`;
}
function openDrawer() {
  renderDrawer();
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  $('#drawer-close').focus();
}
function closeSheets() {
  $('#drawer').hidden = true;
  $('#more-sheet').hidden = true;
  $('#scrim').hidden = true;
}

/* ---------- baner stanu sieci ---------- */
function renderNet() {
  const a = Net.state.anilist;
  const bn = $('#net-banner');
  if (a.ok === false) {
    bn.hidden = false;
    bn.innerHTML = `${ICON.refresh}<span>${esc(a.err || 'AniList nie odpowiada.')} Pokazuję ostatnio pobrane dane, a Twoja lista działa normalnie.</span><a class="btn ghost sm" href="#/ustawienia">Test połączenia</a><button class="btn ghost sm" type="button" id="net-retry">Spróbuj ponownie</button>`;
    $('#net-retry').addEventListener('click', () => { Net.state.anilist.ok = null; bn.hidden = true; route(); });
  } else bn.hidden = true;
}

/* ---------- start ---------- */
function start() {
  window.addEventListener('hashchange', route);
  $('#bell').addEventListener('click', openDrawer);
  $('#drawer-close').addEventListener('click', closeSheets);
  $('#scrim').addEventListener('click', closeSheets);
  $('#drawer-readall').addEventListener('click', () => { Lib.markAllRead(); renderDrawer(); });
  $('#more-btn').addEventListener('click', () => { $('#more-sheet').hidden = false; $('#scrim').hidden = false; });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheets(); });
  on('notifs', () => { renderBell(); if (!$('#drawer').hidden) renderDrawer(); });
  on('library', renderBell);
  // karty z plusem odświeżają się same po każdej zmianie na liście
  on('library', (d) => {
    if (d && d.id && !d.kind) UI.refreshCards(d.id);
    else new Set($$('.acard[data-id]').map((c) => c.dataset.id)).forEach((id) => UI.refreshCards(id));
  });
  on('net', renderNet);

  if (!storageOk) toast('Przeglądarka blokuje zapis danych (np. tryb prywatny). Lista nie przetrwa zamknięcia karty.', { kind: 'error', ms: 10000 });
  if (staleFallbackSince()) toast('Baza danych przeglądarki nie odpowiada, więc pokazuję starszą kopię listy (sprzed przeniesienia do IndexedDB). Twoja aktualna lista nie zginęła: odśwież stronę albo uruchom przeglądarkę ponownie. Zmiany zrobione teraz zostaną dołączone.', { kind: 'error', ms: 20000 });
  FX.init();
  Wait.init();
  Backfill.init();
  SkipFill.init();
  Episodes.init().then(() => emit('settings'));
  Radar.watch();
  setTimeout(() => Radar.maybeScan(), 8000);
  setInterval(() => Radar.maybeScan(), 3600e3);
  QuickAdd.init();
  TypeSearch.init();
  renderBell();
  route();
  setInterval(tickCountdowns, 1000);

  // odświeżanie w tle
  const refreshAll = () => {
    Lib.refresh().catch(() => {});
    if (Date.now() - (S.meta.lastNewsCheck || 0) > 3 * 3600e3) NGNL.check().catch(() => {});
  };
  setTimeout(refreshAll, 2500);
  setInterval(() => Lib.checkAiring(), 60e3);
  setInterval(refreshAll, 20 * 60e3);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - (S.meta.lastRefresh || 0) > 15 * 60e3) refreshAll();
  });

  setTimeout(() => pruneApiCache().catch(() => {}), 15000);
  if (Object.keys(S.entries).length) requestPersistence();
  const lastExp = S.meta.lastExportAt || S.meta.createdAt;
  if (Object.keys(S.entries).length >= 5 && Date.now() - lastExp > 14 * 86400e3) {
    setTimeout(() => toast('Minęły 2 tygodnie od ostatniej kopii listy.', { kind: 'warn', action: { label: 'Zrób eksport', fn: () => IO.exportJSON() } }), 6000);
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// start dopiero po wczytaniu listy z bazy (IndexedDB jest asynchroniczne)
document.addEventListener('DOMContentLoaded', () => { stateReady.then(start); });
