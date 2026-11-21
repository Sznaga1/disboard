'use strict';
/* ==========================================================================
   Disboard — ekrany: wyszukiwarka
   (dawny js/pages.js; wspólne funkcje w js/pages/common.js)
   ========================================================================== */

/* ==========================================================================
   WYSZUKIWARKA
   ========================================================================== */
let searchLastRandom = 0; // „Losuj” nie trafia dwa razy z rzędu w to samo

Pages.search = (ctx) => {
  ctx.title('Szukaj anime');
  const p = ctx.query;
  // „typed=1”: przyszliśmy tu, bo zacząłeś pisać na innej stronie — bierzemy wpisane znaki
  const typed = p.get('typed') === '1';
  const st = { q: typed ? TypeSearch.take() : (p.get('q') || ''), format: p.get('format') || '', status: p.get('status') || '', year: p.get('year') || '', genre: p.get('genre') || '', sort: p.get('sort') || '' };
  const FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'];
  const STATUSES = ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED', 'HIATUS', 'CANCELLED'];
  const SORTS = [['', 'Trafność'], ['POPULARITY_DESC', 'Popularność'], ['SCORE_DESC', 'Ocena AniList'], ['GEMS', 'Ukryte perełki'], ['TRENDING_DESC', 'Na czasie'], ['START_DATE_DESC', 'Najnowsze']];
  // nagłówek przy przeglądaniu bez tytułu i filtrów (zależy od sortowania)
  const BROWSE_H = { '': 'Na czasie w AniList', TRENDING_DESC: 'Na czasie w AniList', POPULARITY_DESC: 'Najpopularniejsze w AniList', SCORE_DESC: 'Najwyżej oceniane w AniList', START_DATE_DESC: 'Najnowsze w AniList', GEMS: 'Ukryte perełki' };

  ctx.el.innerHTML = `<div class="page">
    <form class="searchbar" id="s-form" role="search">
      <label class="field big grow">${ICON.search}<span class="sr">Tytuł anime</span>
        <input id="s-q" type="search" value="${esc(st.q)}" placeholder="Tytuł po angielsku, japońsku lub w romaji…" autocomplete="off" enterkeyhint="search"></label>
      <button type="button" class="dir-btn l-rand s-rand" id="s-rand" title="Nie wiesz, co obejrzeć? Losuje tytuł spośród wyników, z uwzględnieniem filtrów i sortowania (pomija to, co masz na liście)">${ICON.dice}<span>Losuj</span></button>
      <button type="button" class="dir-btn s-fbtn" id="s-fbtn" aria-expanded="false" aria-controls="s-filters" aria-label="Filtry">${ICON.filter}<span>Filtry</span><b class="l-badge" hidden></b></button>
    </form>
    <div class="filters" id="s-filters">
      <label class="field"><span class="lbl">Format</span><select id="s-format"><option value="">Każdy</option>${FORMATS.map((f) => `<option value="${f}"${f === st.format ? ' selected' : ''}>${FORMAT_PL[f]}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">Status</span><select id="s-status"><option value="">Każdy</option>${STATUSES.map((f) => `<option value="${f}"${f === st.status ? ' selected' : ''}>${MSTATUS_PL[f]}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">Rok</span><input id="s-year" type="number" inputmode="numeric" min="1940" max="2035" value="${esc(st.year)}" placeholder="np. 2014"></label>
      <label class="field"><span class="lbl">Gatunek</span><select id="s-genre"><option value="">Każdy</option></select></label>
      <label class="field"><span class="lbl">Sortuj</span><select id="s-sort">${SORTS.map(([k, l]) => `<option value="${k}"${k === st.sort ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div id="s-out"></div>
  </div>`;

  Ani.genres().then((gs) => {
    if (!ctx.alive()) return;
    $('#s-genre').insertAdjacentHTML('beforeend', gs.filter((g) => S.settings.adult || g !== 'Hentai').map((g) => `<option value="${esc(g)}"${g === st.genre ? ' selected' : ''}>${esc(g)}</option>`).join(''));
  }).catch(() => {});

  let run = 0, page = 0, items = [];
  const out = $('#s-out');
  const hasFilters = () => st.format || st.status || st.year || st.genre;
  // bez wpisanego tytułu pomijamy to, co już jest na liście: wtedy widać rzeczy nowe dla Ciebie.
  // Po tytule szukamy zawsze wszystkiego (żeby dało się znaleźć i otworzyć swoje anime)
  const myIds = () => Object.keys(S.entries).map(Number);
  const hideOn = () => S.settings.searchHideMine !== false;
  const hidingMine = () => !st.q && hideOn() && myIds().length > 0;
  const paramsFor = (p) => ({
    ...st, page: p,
    sort: st.sort || (st.q ? 'SEARCH_MATCH' : !hasFilters() ? 'TRENDING_DESC' : 'POPULARITY_DESC'),
    notIds: hidingMine() ? myIds() : null,
  });

  // jedna porcja wyników; perełki dociągamy (do 3 stron), bo AniList oddaje głównie kontynuacje
  async function fetchChunk() {
    const gems = st.sort === 'GEMS';
    const got = [];
    let r;
    for (let i = 0; i < (gems ? 3 : 1); i++) {
      r = await Ani.search(paramsFor(++page));
      got.push(...r.items);
      if (!gems || got.length >= 18 || !r.pageInfo.hasNextPage) break;
    }
    return { r, got };
  }

  // szara linijka nad wynikami: liczba wyników, opis perełek, przełącznik „Twoja lista”
  function summary(r) {
    const gems = st.sort === 'GEMS';
    const parts = [];
    if (!gems && (st.q || hasFilters()) && r.pageInfo.total) parts.push(`Znaleziono ${NF.format(r.pageInfo.total)} ${plural(r.pageInfo.total, 'wynik', 'wyniki', 'wyników')}`);
    if (gems) parts.push('Średnia od 75%, mniej niż 50 tys. widzów, bez kontynuacji');
    const n = myIds().length;
    if (!st.q && n) {
      parts.push(hideOn()
        ? `${parts.length ? 'bez' : 'Bez'} ${NF.format(n)} ${plural(n, 'tytułu', 'tytułów', 'tytułów')} z Twojej listy <button type="button" class="s-mine">Pokaż je</button>`
        : `${parts.length ? 'razem' : 'Razem'} z tytułami z Twojej listy <button type="button" class="s-mine">Ukryj je</button>`);
    }
    return parts.length ? `<p class="list-sum s-sum">${parts.join(' · ')}</p>` : '';
  }

  async function search(more = false) {
    if (!ctx.alive()) return;
    const my = ++run;
    if (!more) { page = 0; items = []; out.innerHTML = UI.skeletonCards(12); }
    const pageBefore = page; // przy błędzie „Pokaż więcej” ponawiamy od tej samej strony
    const browsing = !st.q && !hasFilters();
    const qs = new URLSearchParams(Object.entries(st).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/szukaj${qs ? '?' + qs : ''}`);
    try {
      const { r, got } = await fetchChunk();
      if (my !== run || !ctx.alive()) return;
      const seen = new Set(items.map((m) => m.id));
      items.push(...got.filter((m) => !seen.has(m.id) && seen.add(m.id)));
      const title = browsing ? BROWSE_H[st.sort] : st.sort === 'GEMS' ? BROWSE_H.GEMS : '';
      const head = `${title ? `<h2 class="sub-h">${title}</h2>` : ''}${summary(r)}`;
      out.innerHTML = items.length
        ? `${UI.staleNote(r)}${head}<div class="grid-cards">${items.map((m) => UI.animeCard(m)).join('')}</div>
           ${r.pageInfo.hasNextPage ? '<div class="more-row"><button class="btn ghost" type="button" id="s-more">Pokaż więcej</button></div>' : ''}`
        : `${head}${UI.empty('Nic nie znaleziono', st.sort === 'GEMS' ? 'Perełki mają ostre kryteria: usuń część filtrów albo zmień rok.' : 'Spróbuj innej pisowni, tytułu japońskiego albo usuń część filtrów.')}`;
      const mb = $('#s-more');
      if (mb) mb.addEventListener('click', () => { mb.disabled = true; mb.textContent = 'Wczytuję…'; search(true); });
    } catch (err) {
      if (my !== run || !ctx.alive()) return;
      if (more) { page = pageBefore; toast(err.message, { kind: 'error' }); const mb = $('#s-more'); if (mb) { mb.disabled = false; mb.textContent = 'Pokaż więcej'; } return; }
      out.innerHTML = `${UI.errorBox(err, 's-retry')}<div id="s-fallback">${UI.skeletonCards(6)}</div>`;
      $('#s-retry').addEventListener('click', () => search());
      // zapasowo: wyniki z MyAnimeList, żeby wyszukiwarka nie była martwa
      try {
        const j = await Jikan.search(st.q);
        if (my !== run || !ctx.alive()) return;
        const fb = $('#s-fallback');
        if (!fb) return;
        fb.innerHTML = j.items.length ? `<h2 class="sub-h">${st.q ? 'Wyniki z MyAnimeList' : 'Teraz emitowane według MyAnimeList'}</h2>
          <p class="list-sum">AniList chwilowo nie odpowiada, więc pokazuję wyniki z MyAnimeList. Przycisk „+” doda tytuł, gdy tylko AniList znów zadziała.</p>
          <div class="grid-cards">${j.items.map(malCard).join('')}</div>` : UI.empty('MyAnimeList też nic nie znalazł', 'Spróbuj innej pisowni tytułu.');
      } catch {
        const fb = $('#s-fallback');
        if (fb) fb.innerHTML = '<p class="list-sum">Zapasowe źródło (MyAnimeList) też nie odpowiada. Sprawdź połączenie z internetem albo uruchom test w Ustawieniach.</p>';
      }
    }
  }

  // na telefonie filtry są schowane pod przyciskiem; liczba = ile filtrów działa
  const updBadge = () => { const n = ['format', 'status', 'year', 'genre'].filter((k) => st[k]).length; const b = $('#s-fbtn .l-badge'); b.hidden = !n; b.textContent = String(n); };
  updBadge();
  $('#s-fbtn').addEventListener('click', () => {
    const open = !$('#s-filters').classList.contains('open');
    $('#s-filters').classList.toggle('open', open);
    $('#s-fbtn').setAttribute('aria-expanded', String(open));
  });
  // „Ukryj je / Pokaż je”: zapamiętane w ustawieniach (synchronizowane jak reszta)
  out.addEventListener('click', (ev) => {
    if (!ev.target.closest('.s-mine')) return;
    S.settings.searchHideMine = !hideOn();
    save();
    search();
  });

  // „Losuj”: losowa strona wyników (przy tytule tylko najlepsze trafienia), potem losowy tytuł spoza listy
  $('#s-rand').addEventListener('click', async () => {
    const btn = $('#s-rand');
    btn.disabled = true;
    try {
      const base = paramsFor(1);
      const first = await Ani.search(base);
      const per = st.sort === 'GEMS' ? 50 : 24;
      const pages = Math.max(1, Math.min(Math.ceil((first.pageInfo.total || 0) / per), st.q ? 1 : st.sort === 'GEMS' ? 3 : 10));
      const p = 1 + Math.floor(Math.random() * pages);
      const r = p === 1 ? first : await Ani.search(paramsFor(p));
      const fresh = (a) => a.filter((m) => !Lib.get(m.id) && m.id !== searchLastRandom);
      const pool = [fresh(r.items), fresh(first.items), r.items.filter((m) => m.id !== searchLastRandom)].find((a) => a.length) || [];
      if (!ctx.alive()) return;
      if (!pool.length) { toast('Nie ma czego losować: zmień filtry albo sortowanie.'); return; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      searchLastRandom = pick.id;
      location.hash = animeHref(pick.id);
    } catch (err) {
      if (ctx.alive()) toast(err.message, { kind: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  const debounced = debounce(() => search(), 450);
  $('#s-q').addEventListener('input', (ev) => { st.q = ev.target.value.trim(); if (st.q.length === 1) return; debounced(); });
  $('#s-form').addEventListener('submit', (ev) => { ev.preventDefault(); st.q = $('#s-q').value.trim(); search(); $('#s-q').blur(); });
  [['s-format', 'format'], ['s-status', 'status'], ['s-genre', 'genre'], ['s-sort', 'sort']].forEach(([id, k]) => {
    $('#' + id).addEventListener('change', (ev) => { st[k] = ev.target.value; updBadge(); search(); });
  });
  $('#s-year').addEventListener('input', debounce((ev) => { const v = ev.target.value; st.year = /^\d{4}$/.test(v) ? v : ''; updBadge(); search(); }, 600));
  if (typed) {
    const inp = $('#s-q');
    inp.focus({ preventScroll: true });
    inp.setSelectionRange(inp.value.length, inp.value.length);
    if (st.q.trim().length >= 2) search();
    else {
      history.replaceState(null, '', '#/szukaj');
      out.innerHTML = '<p class="list-sum">Pisz dalej: wyniki pojawią się od dwóch liter.</p>';
    }
  } else {
    search();
    if (!st.q && window.matchMedia('(pointer:fine)').matches) $('#s-q').focus();
  }
};
