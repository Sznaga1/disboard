'use strict';
/* ==========================================================================
   Disboard — ekrany: moja lista
   (dawny js/pages.js; wspólne funkcje w js/pages/common.js)
   ========================================================================== */

/* ==========================================================================
   MOJA LISTA
   ========================================================================== */
/* ---------- sortowanie listy ----------
   v(e, cx) zwraca wartość albo null (null zawsze na końcu, w obu kierunkach),
   badge(v, e) — co pokazać na karcie, dir — domyślny kierunek, d — podpisy [malejąco, rosnąco]. */
const NF_COMPACT = new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 });
const FORMAT_ORDER = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'];
const AIR_ORDER = ['RELEASING', 'NOT_YET_RELEASED', 'HIATUS', 'FINISHED', 'CANCELLED'];
const D_DATE = ['Najnowsze', 'Najstarsze'], D_HI = ['Najwyższe', 'Najniższe'], D_MANY = ['Najwięcej', 'Najmniej'], D_LONG = ['Najdłuższe', 'Najkrótsze'], D_ORD = ['Odwrotnie', 'Po kolei'];
const sessMin = (e, f) => { const v = e.sessions.map((x) => x[f]).filter(Boolean); return v.length ? Math.min(...v) : null; };
const sessMax = (e, f) => { const v = e.sessions.map((x) => x[f]).filter(Boolean); return v.length ? Math.max(...v) : null; };
const LIST_SORTS = {
  updated: { g: 'you', l: 'Ostatnio zmieniane', dir: 'desc', d: ['Najświeższe', 'Najdawniej zmieniane'], v: (e) => e.updatedAt || null },
  watched: { g: 'you', l: 'Ostatnio oglądane', dir: 'desc', d: ['Najświeższe', 'Najdawniej oglądane'], v: (e, cx) => cx.last.get(e.id) ?? null, badge: (v) => `oglądane ${esc(relTime(v))}` },
  added: { g: 'you', l: 'Data dodania', dir: 'desc', d: D_DATE, v: (e) => e.addedAt || null, badge: (v) => `dodane ${esc(fmtDateShort(v))}` },
  started: { g: 'you', l: 'Data rozpoczęcia', dir: 'desc', d: D_DATE, v: (e) => sessMin(e, 'startedAt'), badge: (v) => `start ${esc(fmtDateShort(v))}` },
  finished: { g: 'you', l: 'Data ukończenia', dir: 'desc', d: D_DATE, v: (e) => sessMax(e, 'finishedAt'), badge: (v) => `ukończone ${esc(fmtDateShort(v))}` },
  score: { g: 'you', l: 'Twoja ocena', dir: 'desc', d: D_HI, v: (e) => e.score ?? null },
  diff: { g: 'you', l: 'Twoja ocena kontra AniList', dir: 'desc', d: ['Wyżej niż AniList', 'Niżej niż AniList'], v: (e) => (e.score != null && e.media.averageScore ? e.score - e.media.averageScore / 10 : null), badge: (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${NF1.format(Math.abs(v))} vs AniList` },
  progress: { g: 'you', l: 'Postęp', dir: 'desc', d: ['Najdalej', 'Najbliżej początku'], v: (e) => (Lib.epTotal(e) ? Lib.cur(e).progress / Lib.epTotal(e) : null) },
  remaining: { g: 'you', l: 'Zostało odcinków', dir: 'asc', d: D_MANY, v: (e) => (e.status === 'completed' || !Lib.epTotal(e) ? null : Lib.epTotal(e) - Lib.cur(e).progress), badge: (v) => `zostało ${nUnit(v, 'episode')}` },
  time: { g: 'you', l: 'Czas oglądania', dir: 'desc', d: D_LONG, v: (e) => Lib.entryMinutes(e) || null, badge: (v) => esc(fmtDuration(v, { short: true })) },
  rewatch: { g: 'you', l: 'Liczba obejrzeń', dir: 'desc', d: D_MANY, v: (e) => Lib.finishedCount(e) || null, badge: (v) => `obejrzane ${v}×` },
  ...Object.fromEntries(RATE_CATS.map(([k, l]) => [`r_${k}`, { g: 'cat', l, dir: 'desc', d: D_HI, v: (e) => (e.rating && e.rating[k] > 0 ? e.rating[k] : null), badge: (v) => `${esc(l)} ${NF1.format(v)}` }])),
  title: { g: 'anime', l: 'Tytuł', dir: 'asc', d: ['Z–A', 'A–Z'], v: (e) => titleOf(e.media) },
  premiere: { g: 'anime', l: 'Data premiery', dir: 'desc', d: D_DATE, v: (e) => fuzzyTs(e.media.startDate) || (e.media.seasonYear ? new Date(e.media.seasonYear, 0, 1).getTime() : null), badge: (v, e) => esc(seasonLabel(e.media.season, e.media.seasonYear) || fuzzyDate(e.media.startDate) || '') },
  avg: { g: 'anime', l: 'Średnia AniList', dir: 'desc', d: D_HI, v: (e) => (e.media.averageScore ? e.media.averageScore / 10 : null), badge: (v) => `AniList ${NF1.format(v)}` },
  pop: { g: 'anime', l: 'Popularność AniList', dir: 'desc', d: ['Najpopularniejsze', 'Najbardziej niszowe'], v: (e) => e.media.popularity || null, badge: (v) => `${esc(NF_COMPACT.format(v))} list na AniList` },
  eps: { g: 'anime', l: 'Liczba odcinków', dir: 'desc', d: D_MANY, v: (e) => e.media.episodes || null, badge: (v) => nUnit(v, 'episode') },
  length: { g: 'anime', l: 'Długość całej serii', dir: 'asc', d: D_LONG, v: (e) => (Lib.epDur(e) && e.media.episodes ? Lib.epDur(e) * e.media.episodes : null), badge: (v) => `całość ${esc(fmtDuration(v, { short: true }))}` },
  format: { g: 'anime', l: 'Format', dir: 'asc', d: D_ORD, v: (e) => (e.media.format ? (FORMAT_ORDER.indexOf(e.media.format) + 1 || 99) : null), badge: (v, e) => esc(FORMAT_PL[e.media.format] || e.media.format) },
  airstatus: { g: 'anime', l: 'Status emisji', dir: 'asc', d: D_ORD, v: (e) => (e.media.status ? (AIR_ORDER.indexOf(e.media.status) + 1 || 99) : null), badge: (v, e) => esc(MSTATUS_PL[e.media.status] || e.media.status) },
  airing: { g: 'anime', l: 'Najbliższy odcinek', dir: 'asc', d: ['Najpóźniej', 'Najwcześniej'], v: (e) => { const n = e.media.nextAiringEpisode; return n && !e.media.isAdult && n.airingAt * 1000 > Date.now() ? n.airingAt : null; }, badge: (v, e) => `odc. ${e.media.nextAiringEpisode.episode} · ${esc(DF.wdTime.format(new Date(v * 1000)))}` },
};
const LIST_SORT_GROUPS = [['you', 'Twoje dane'], ['cat', 'Oceny w kategoriach'], ['anime', 'Dane anime']];
// rozsądny start dla każdej zakładki, zanim sam coś wybierzesz
const LIST_TAB_DEFAULT = { all: 'updated', watching: 'watched', planning: 'added', completed: 'finished', paused: 'updated', dropped: 'updated', fav: 'score' };

function listSortState(tab) {
  const saved = (S.settings.listSorts || {})[tab];
  if (saved && LIST_SORTS[saved.k]) return { k: saved.k, dir: saved.dir === 'asc' ? 'asc' : 'desc' };
  const k = tab === 'all' && LIST_SORTS[S.settings.listSort] ? S.settings.listSort : LIST_TAB_DEFAULT[tab] || 'updated';
  return { k, dir: LIST_SORTS[k].dir };
}

Pages.list = (ctx) => {
  ctx.title('Moja lista');
  const TABS = [['all', 'Wszystkie'], ...LIST_STATUSES.map((s) => [s, LSTATUS_PL[s]]), ['fav', 'Ulubione'], ['radar', 'Kontynuacje']];
  const tab = TABS.some(([k]) => k === ctx.params.tab) ? ctx.params.tab : 'all';
  let q = '', filter = '';
  let sort = listSortState(tab === 'radar' ? 'all' : tab);

  const inTab = (e) => (tab === 'fav' ? e.favorite : tab === 'all' || e.status === tab);
  const count = (k) => (k === 'radar' ? Radar.count() : entriesAll().filter((e) => (k === 'all' ? true : k === 'fav' ? e.favorite : e.status === k)).length);
  const tabsNav = () => `<nav class="tabs" aria-label="Filtr statusu">${TABS.map(([k, l]) => `<a href="#/lista${k === 'all' ? '' : '/' + k}" class="tab${k === tab ? ' on' : ''}${k === 'radar' ? ' tab-radar' : ''}"${k === tab ? ' aria-current="page"' : ''}>${k === 'radar' ? ICON.radar || '' : ''}${l}<span class="tab-n" data-count="${k}">${count(k)}</span></a>`).join('')}</nav>`;
  const updCounts = () => $$('[data-count]', ctx.el).forEach((el) => { el.textContent = count(el.dataset.count); });
  ctx.on('radar', updCounts);
  // na wąskim ekranie aktywna zakładka ma być widoczna (np. „Kontynuacje” na końcu paska)
  const showTab = () => { const t = $('.tabs .tab.on', ctx.el); const bar = t && t.parentNode; if (t && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = t.offsetLeft - (bar.clientWidth - t.offsetWidth) / 2; };
  queueMicrotask(showTab);

  // zakładka „Kontynuacje”: radar, a nie wpisy z listy
  if (tab === 'radar') {
    ctx.el.innerHTML = `<div class="page">${tabsNav()}<div id="l-out" class="rd-out"></div></div>`;
    Radar.view(ctx, $('#l-out'));
    ctx.onLibrary(updCounts);
    return;
  }

  // filtr: własne tagi, gatunki z AniList i format — z liczbą tytułów w tej zakładce
  function filterOptions() {
    const list = entriesAll().filter(inTab);
    const tally = (arr) => { const m = new Map(); arr.forEach((x) => m.set(x, (m.get(x) || 0) + 1)); return [...m.entries()]; };
    const tags = tally(list.flatMap((e) => e.tags)).sort((a, b) => a[0].localeCompare(b[0], 'pl'));
    const genres = tally(list.flatMap((e) => e.media.genres || [])).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const formats = tally(list.map((e) => e.media.format).filter(Boolean)).sort((a, b) => FORMAT_ORDER.indexOf(a[0]) - FORMAT_ORDER.indexOf(b[0]));
    const opt = (v, l, n) => `<option value="${esc(v)}"${v === filter ? ' selected' : ''}>${esc(l)} (${n})</option>`;
    return `<option value="">Wszystkie gatunki i tagi</option>
      <optgroup label="Gatunki">${genres.map(([g, n]) => opt(`g:${g}`, g, n)).join('')}</optgroup>
      <optgroup label="Format">${formats.map(([f, n]) => opt(`f:${f}`, FORMAT_PL[f] || f, n)).join('')}</optgroup>
      <optgroup label="Twoje tagi">${tags.length ? tags.map(([t, n]) => opt(`t:${t}`, `#${t}`, n)).join('') : '<option disabled>brak — dopiszesz je na stronie anime</option>'}</optgroup>`;
  }
  function sortOptions() {
    return LIST_SORT_GROUPS.map(([g, gl]) => `<optgroup label="${gl}">${Object.entries(LIST_SORTS).filter(([, d]) => d.g === g)
      .map(([k, d]) => `<option value="${k}"${k === sort.k ? ' selected' : ''}>${esc(g === 'cat' ? `Ocena: ${d.l}` : d.l)}</option>`).join('')}</optgroup>`).join('');
  }
  const dirHtml = () => {
    const d = LIST_SORTS[sort.k].d;
    const label = sort.dir === 'desc' ? d[0] : d[1];
    return `${ICON.arrowDown}<span>${esc(label)}</span>`;
  };

  ctx.el.innerHTML = `<div class="page">
    ${tabsNav()}
    <div class="toolbar list-tools">
      <label class="field grow"><span class="sr">Filtruj listę</span>${ICON.search}<input id="l-q" type="search" placeholder="Filtruj po tytule, także japońskim" autocomplete="off"></label>
      <label class="field"><span class="sr">Gatunek, format albo tag</span><select id="l-tag">${filterOptions()}</select></label>
      <div class="sort-box">
        <label class="field"><span class="sr">Sortowanie</span><select id="l-sort">${sortOptions()}</select></label>
        <button type="button" class="dir-btn${sort.dir === 'asc' ? ' asc' : ''}" id="l-dir" title="Odwróć kolejność">${dirHtml()}</button>
      </div>
      <div class="seg" role="group" aria-label="Widok">
        <button type="button" id="l-grid" class="${S.settings.listView === 'grid' ? 'on' : ''}" aria-label="Siatka okładek">${ICON.grid}</button>
        <button type="button" id="l-rows" class="${S.settings.listView === 'rows' ? 'on' : ''}" aria-label="Lista wierszy">${ICON.rows}</button>
      </div>
    </div>
    <div id="l-out"></div>
  </div>`;

  const matches = (e) => {
    if (!inTab(e)) return false;
    if (filter) {
      const v = filter.slice(2);
      if (filter[0] === 't' && !e.tags.includes(v)) return false;
      if (filter[0] === 'g' && !(e.media.genres || []).includes(v)) return false;
      if (filter[0] === 'f' && e.media.format !== v) return false;
    }
    if (q) {
      const t = e.media.title;
      const hay = [t.romaji, t.english, t.native, ...(e.media.synonyms || []), ...e.tags, e.notes].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  function sorted(list) {
    const def = LIST_SORTS[sort.k];
    const cx = { last: new Map() };
    if (sort.k === 'watched') for (const h of S.history) if (h.k === 'ep' && h.t > (cx.last.get(h.m) || 0)) cx.last.set(h.m, h.t);
    const sign = sort.dir === 'asc' ? 1 : -1;
    const rows = list.map((e) => ({ e, v: def.v(e, cx), t: titleOf(e.media) }));
    rows.sort((a, b) => {
      if (a.v == null || b.v == null) return a.v == null && b.v == null ? a.t.localeCompare(b.t, 'pl') : a.v == null ? 1 : -1;
      const c = typeof a.v === 'string' ? a.v.localeCompare(b.v, 'pl') : a.v - b.v;
      return c ? c * sign : a.t.localeCompare(b.t, 'pl');
    });
    return rows.map((r) => ({ e: r.e, badge: def.badge && r.v != null ? def.badge(r.v, r.e) : '' }));
  }

  const render = () => {
    if (!ctx.alive()) return; // opóźniony filtr po przejściu na inną stronę
    const list = sorted(entriesAll().filter(matches));
    updCounts();
    const out = $('#l-out');
    if (!entriesAll().length) {
      out.innerHTML = UI.empty('Twoja lista jest pusta', 'Wyszukaj anime i dodaj je jednym kliknięciem. Dane, okładki i liczba odcinków pobiorą się same.', `<a class="btn" href="#/szukaj">${ICON.search}Szukaj anime</a>`);
      return;
    }
    if (!list.length) { out.innerHTML = UI.empty('Nic nie pasuje do filtrów', 'Zmień zakładkę, gatunek albo wyczyść pole wyszukiwania.'); return; }
    const mins = list.reduce((a, x) => a + Lib.entryMinutes(x.e), 0);
    const noVal = LIST_SORTS[sort.k].badge ? list.filter((x) => !x.badge).length : 0;
    const summary = `<p class="list-sum">${nUnit(list.length, 'title')} · ${NF.format(list.reduce((a, x) => a + Lib.totalEps(x.e), 0))} obejrzanych odcinków · ${esc(fmtDuration(mins))}${noVal ? ` · <span title="Te pozycje są na końcu listy">${NF.format(noVal)} bez wartości „${esc(LIST_SORTS[sort.k].l)}”</span>` : ''}</p>`;
    out.innerHTML = summary + (S.settings.listView === 'rows'
      ? `<div class="erows" role="table"><div class="erow head" role="row"><span></span><span role="columnheader">Tytuł</span><span role="columnheader">Status</span><span role="columnheader">Postęp</span><span role="columnheader">Ocena</span><span role="columnheader">Czas</span></div>${list.map((x) => UI.entryRow(x.e, { badge: x.badge })).join('')}</div>`
      : `<div class="grid-entries wide">${list.map((x) => UI.entryCard(x.e, { badge: x.badge })).join('')}</div>`);
  };
  render();
  ctx.onLibrary(() => withFocusKept(() => {
    // nowy tag albo tytuł: odśwież listę filtrów (liczby przy gatunkach)
    const sel = $('#l-tag');
    if (sel && document.activeElement !== sel) { sel.innerHTML = filterOptions(); if (sel.value !== filter) filter = sel.value; }
    render();
  }));

  const saveSort = () => {
    S.settings.listSorts = { ...(S.settings.listSorts || {}), [tab]: { k: sort.k, dir: sort.dir } };
    save();
    const b = $('#l-dir');
    b.innerHTML = dirHtml();
    b.classList.toggle('asc', sort.dir === 'asc');
    render();
  };
  $('#l-q').addEventListener('input', debounce((ev) => { q = ev.target.value.trim().toLowerCase(); render(); }, 120));
  $('#l-tag').addEventListener('change', (ev) => { filter = ev.target.value; render(); });
  $('#l-sort').addEventListener('change', (ev) => { sort = { k: ev.target.value, dir: LIST_SORTS[ev.target.value].dir }; saveSort(); });
  $('#l-dir').addEventListener('click', () => { sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; saveSort(); });
  const setView = (v) => { S.settings.listView = v; save(); $('#l-grid').classList.toggle('on', v === 'grid'); $('#l-rows').classList.toggle('on', v === 'rows'); render(); };
  $('#l-grid').addEventListener('click', () => setView('grid'));
  $('#l-rows').addEventListener('click', () => setView('rows'));
};
