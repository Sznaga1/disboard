'use strict';
/* ==========================================================================
   Disboard — strona osoby (#/osoba/:id): aktor głosowy albo twórca z AniList.
   Nagłówek z danymi, „Na Twojej liście” (role z API + dane ze statystyk),
   potem wszystkie role głosowe i praca przy anime, doczytywane stronami.
   ========================================================================== */

const OCC_PL = {
  'Voice Actor': ['Aktor głosowy', 'Aktorka głosowa'], Actor: ['Aktor', 'Aktorka'], Director: ['Reżyser', 'Reżyserka'],
  'Animation Director': ['Reżyser animacji', 'Reżyserka animacji'], 'Sound Director': ['Reżyser dźwięku', 'Reżyserka dźwięku'],
  Animator: ['Animator', 'Animatorka'], Mangaka: ['Mangaka', 'Mangaka'], Composer: ['Kompozytor', 'Kompozytorka'],
  Musician: ['Muzyk', 'Muzyczka'], Singer: ['Wokalista', 'Wokalistka'], Writer: ['Scenarzysta', 'Scenarzystka'],
  Screenwriter: ['Scenarzysta', 'Scenarzystka'], Producer: ['Producent', 'Producentka'], Artist: ['Artysta', 'Artystka'],
  Illustrator: ['Ilustrator', 'Ilustratorka'], Novelist: ['Pisarz', 'Pisarka'], Author: ['Autor', 'Autorka'],
  'Character Designer': ['Projektant postaci', 'Projektantka postaci'], Lyricist: ['Autor tekstów', 'Autorka tekstów'],
  'Storyboard Artist': ['Scenorysy', 'Scenorysy'], Arranger: ['Aranżer', 'Aranżerka'],
};
const LANG_PL = { Japanese: 'japoński', English: 'angielski', Korean: 'koreański', Chinese: 'chiński', Mandarin: 'mandaryński', Spanish: 'hiszpański', Portuguese: 'portugalski', French: 'francuski', German: 'niemiecki', Italian: 'włoski', Polish: 'polski' };
const CHAR_ROLE_SHORT = { MAIN: 'główna', SUPPORTING: 'drugoplanowa', BACKGROUND: 'epizod' };

Pages.person = (ctx) => {
  const id = Number(ctx.params.id);
  ctx.title('Osoba');
  ctx.el.innerHTML = `<div class="page person" id="p-root"><div class="detail-load">${UI.skeletonRows(6)}</div></div>`;
  const st = { page: 1, p: null, chars: new Map(), staff: new Map(), moreC: false, moreS: false, busy: false, tab: null, sort: 'pop', stale: null };

  const okAdult = (n) => S.settings.adult || !n.isAdult;
  function absorb(p) {
    for (const ed of (p.characterMedia && p.characterMedia.edges) || []) {
      const n = ed.node;
      if (!n || n.type !== 'ANIME' || !okAdult(n)) continue;
      const o = st.chars.get(n.id) || { m: n, chars: [], role: ed.characterRole, i: st.chars.size };
      for (const c of (ed.characters || [])) if (c && !o.chars.some((x) => x.id === c.id)) o.chars.push(c);
      st.chars.set(n.id, o);
    }
    for (const ed of (p.staffMedia && p.staffMedia.edges) || []) {
      const n = ed.node;
      if (!n || !okAdult(n)) continue;
      const o = st.staff.get(n.id) || { m: n, roles: [], i: st.staff.size };
      if (ed.staffRole && !o.roles.includes(ed.staffRole)) o.roles.push(ed.staffRole);
      st.staff.set(n.id, o);
    }
    st.moreC = !!(p.characterMedia && p.characterMedia.pageInfo && p.characterMedia.pageInfo.hasNextPage);
    st.moreS = !!(p.staffMedia && p.staffMedia.pageInfo && p.staffMedia.pageInfo.hasNextPage);
  }

  // anime z Twojej listy: z wczytanych ról i z danych zebranych do statystyk
  function mine() {
    const out = new Map();
    const put = (mid) => { if (!out.has(mid)) out.set(mid, { e: S.entries[mid], chars: new Set(), roles: new Set() }); return out.get(mid); };
    for (const [mid, o] of st.chars) if (S.entries[mid]) { const r = put(mid); o.chars.forEach((c) => r.chars.add(`${c.name.full}${o.role ? ` (${CHAR_ROLE_SHORT[o.role] || ''})` : ''}`)); }
    for (const [mid, o] of st.staff) if (S.entries[mid]) { const r = put(mid); o.roles.forEach((x) => r.roles.add(x)); }
    const X = Extras.all();
    for (const e of Object.values(S.entries)) {
      const x = X[e.id];
      if (!x || x.missing) continue;
      for (const c of (x.chars || [])) if (c.va && c.va.id === id) put(e.id).chars.add(`${c.n}${c.role ? ` (${CHAR_ROLE_SHORT[c.role] || ''})` : ''}`);
      for (const s of (x.staff || [])) if (s.id === id) put(e.id).roles.add(s.role || '');
    }
    return [...out.values()].sort((a, b) => (b.e.score ?? -1) - (a.e.score ?? -1) || titleOf(a.e.media).localeCompare(titleOf(b.e.media), 'pl'));
  }

  const sortArr = (arr) => {
    if (st.sort === 'new') return arr.slice().sort((a, b) => (fuzzyTs(b.m.startDate) || 0) - (fuzzyTs(a.m.startDate) || 0));
    if (st.sort === 'mine') return arr.slice().sort((a, b) => (S.entries[b.m.id] ? 1 : 0) - (S.entries[a.m.id] ? 1 : 0) || a.i - b.i);
    return arr.slice().sort((a, b) => a.i - b.i);
  };

  function headHtml(p) {
    const fem = p.gender === 'Female';
    const occ = (p.primaryOccupations || []).map((o) => (OCC_PL[o] ? OCC_PL[o][fem ? 1 : 0] : o));
    let birth = null;
    const b = p.dateOfBirth;
    if (b && b.year) birth = fuzzyDate(b);
    else if (b && b.month && b.day) birth = new Date(2000, b.month - 1, b.day).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });
    const ya = p.yearsActive || [];
    const info = [
      ['Data urodzenia', birth],
      ['Wiek', p.age ? nUnit(p.age, 'year') : null],
      ['Pochodzenie', p.homeTown],
      ['Aktywność', ya.length ? (ya[1] ? `${ya[0]}–${ya[1]}` : `od ${ya[0]}`) : null],
      ['Język', p.languageV2 ? (LANG_PL[p.languageV2] || p.languageV2) : null],
      ['Ulubione na AniList', p.favourites ? NF.format(p.favourites) : null],
    ].filter(([, v]) => v);
    const alt = ((p.name && p.name.alternative) || []).filter(Boolean);
    const img = p.image && (p.image.large || p.image.medium);
    return `<header class="p-head">
      <div class="p-img">${img ? `<img src="${esc(img)}" alt="" onerror="this.remove()">` : ''}<span class="av-fb" aria-hidden="true">${esc((p.name.full || '?').charAt(0))}</span></div>
      <div class="p-titles">
        ${occ.length ? `<div class="d-chips">${occ.map((o) => `<span class="chip">${esc(o)}</span>`).join('')}</div>` : ''}
        <h1 class="d-title">${esc(p.name.full || p.name.native || '?')}</h1>
        ${p.name.native ? `<p class="d-native" lang="ja">${esc(p.name.native)}</p>` : ''}
        ${alt.length ? `<p class="d-sub">Też jako: ${alt.map(esc).join(', ')}</p>` : ''}
      </div>
      <div class="p-extra">
        ${info.length ? `<dl class="p-info">${info.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        <p class="p-links"><a class="btn ghost sm" href="${esc(p.siteUrl || `https://anilist.co/staff/${p.id}`)}" target="_blank" rel="noopener">AniList ${ICON.ext}</a></p>
      </div>
    </header>
    ${p.description ? `<section class="sec p-desc-wrap"><div class="p-desc clamp" id="p-desc">${sanitizeHtml(p.description)}</div><button class="btn ghost sm" type="button" id="p-desc-more" hidden>Pokaż całość</button><p class="src-note">Opis: AniList (po angielsku)</p></section>` : ''}`;
  }

  function mineHtml() {
    const arr = mine();
    if (!arr.length) return '';
    const mins = sum0(arr.map((x) => Lib.entryMinutes(x.e)));
    const sc = arr.filter((x) => x.e.score != null).map((x) => x.e.score);
    const incomplete = st.moreC || st.moreS;
    return UI.section(`Na Twojej liście <span class="count">${arr.length}</span>`, `
      <p class="p-mine-sum"><span><b class="num">${arr.length}</b> anime</span>${mins ? `<span><b class="num">${esc(fmtDuration(mins, { short: true }))}</b> oglądania</span>` : ''}${sc.length ? `<span>Twoja średnia <b class="num">${NF1.format(sc.reduce((a, b) => a + b, 0) / sc.length)}</b></span>` : ''}</p>
      <ul class="p-mine">${arr.map((x) => `<li>
        <a class="p-mine-c" href="#/anime/${x.e.id}">${UI.cover(x.e.media, 'xs')}</a>
        <div class="p-mine-t"><a href="#/anime/${x.e.id}"><b>${esc(titleOf(x.e.media))}</b></a>
          <small>${[...x.chars].length ? `jako ${esc([...x.chars].join(', '))}` : ''}${[...x.chars].length && x.roles.size ? ' · ' : ''}${x.roles.size ? esc([...x.roles].filter(Boolean).join(', ')) : ''}</small></div>
        <div class="p-mine-s">${UI.statusChip(x.e.status, x.e)}${x.e.score != null ? `<span class="score">${ICON.star}${NF1.format(x.e.score)}</span>` : ''}</div>
      </li>`).join('')}</ul>
      ${incomplete ? '<p class="src-note">Sprawdzam role wczytane do tej pory i dane ze statystyk dla nerda. Przy długiej karierze „Pokaż więcej” niżej może dorzucić kolejne.</p>' : ''}`,
    { sub: 'Anime, które masz na liście, z tą osobą' });
  }

  function gridHtml() {
    const cArr = sortArr([...st.chars.values()]);
    const sArr = sortArr([...st.staff.values()]);
    if (!cArr.length && !sArr.length) return UI.empty('Brak ról w anime', 'AniList nie ma ról tej osoby w anime.');
    if (!st.tab) st.tab = cArr.length >= sArr.length ? 'chars' : 'staff';
    if (st.tab === 'chars' && !cArr.length) st.tab = 'staff';
    if (st.tab === 'staff' && !sArr.length) st.tab = 'chars';
    const more = st.tab === 'chars' ? st.moreC : st.moreS;
    const cards = st.tab === 'chars'
      ? cArr.map((o) => UI.animeCard(o.m, { extra: `<span class="p-role">${o.chars.slice(0, 2).map((c) => `${c.image && c.image.medium ? `<img src="${esc(c.image.medium)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${esc(c.name.full)}</span>`).join('')}${o.chars.length > 2 ? `<span>+${o.chars.length - 2}</span>` : ''}</span><small class="p-role-k">${esc(CHAR_ROLE_PL[o.role] || '')}</small>` }))
      : sArr.map((o) => UI.animeCard(o.m, { extra: `<small class="p-role-k">${esc(o.roles.join(', '))}</small>` }));
    return `<div class="p-tools">
        <div class="chips pp-tabs" role="tablist">
          ${cArr.length ? `<button type="button" role="tab" class="chip-btn${st.tab === 'chars' ? ' on' : ''}" data-ptab="chars" aria-selected="${st.tab === 'chars'}">Role głosowe <span>${cArr.length}${st.moreC ? '+' : ''}</span></button>` : ''}
          ${sArr.length ? `<button type="button" role="tab" class="chip-btn${st.tab === 'staff' ? ' on' : ''}" data-ptab="staff" aria-selected="${st.tab === 'staff'}">Praca przy anime <span>${sArr.length}${st.moreS ? '+' : ''}</span></button>` : ''}
        </div>
        <div class="seg" role="group" aria-label="Kolejność">${[['pop', 'Popularne'], ['new', 'Najnowsze'], ['mine', 'Moje najpierw']].map(([k, l]) => `<button type="button" data-psort="${k}" class="${st.sort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div class="grid-cards">${cards.join('')}</div>
      ${more ? `<div class="more-row"><button class="btn ghost" type="button" id="p-more"${st.busy ? ' disabled' : ''}>${st.busy ? 'Wczytuję…' : 'Pokaż więcej'}</button></div>` : ''}
      ${st.sort !== 'pop' && (st.moreC || st.moreS) ? '<p class="src-note">Sortuję tylko role wczytane do tej pory.</p>' : ''}`;
  }

  function render() {
    if (!ctx.alive() || !st.p) return;
    const root = $('#p-root');
    root.innerHTML = `${UI.staleNote(st.stale)}${headHtml(st.p)}<div id="p-mine">${mineHtml()}</div>${UI.section('Role w anime', `<div id="p-grid">${gridHtml()}</div>`, { sub: 'Kolejność jak na AniList: od najpopularniejszych' })}`;
    const desc = $('#p-desc', root);
    const btn = $('#p-desc-more', root);
    if (desc && btn && desc.scrollHeight > desc.clientHeight + 8) btn.hidden = false;
  }
  const renderGrid = () => { const g = $('#p-grid'); if (g) g.innerHTML = gridHtml(); const m = $('#p-mine'); if (m) m.innerHTML = mineHtml(); };

  async function load(page) {
    const r = await Ani.person(id, page);
    if (!ctx.alive()) return;
    if (!r.staff) throw new ApiError('graphql', 'AniList nie zna tej osoby.');
    if (page === 1) { st.p = r.staff; st.stale = r; ctx.title(r.staff.name.full || 'Osoba'); }
    absorb(r.staff);
  }

  Promise.all([Extras.load(), load(1)]).then(() => { render(); bind(); }).catch((err) => {
    if (!ctx.alive()) return;
    $('#p-root').innerHTML = UI.errorBox(err, 'p-retry');
    $('#p-retry').addEventListener('click', () => { location.hash = `#/osoba/${id}?r=${Date.now()}`; });
  });

  function bind() {
    const root = $('#p-root');
    root.addEventListener('click', async (ev) => {
      const tb = ev.target.closest('[data-ptab]');
      if (tb) { st.tab = tb.dataset.ptab; renderGrid(); return; }
      const so = ev.target.closest('[data-psort]');
      if (so) { st.sort = so.dataset.psort; renderGrid(); return; }
      if (ev.target.closest('#p-desc-more')) {
        const d = $('#p-desc', root);
        d.classList.toggle('clamp');
        ev.target.closest('#p-desc-more').textContent = d.classList.contains('clamp') ? 'Pokaż całość' : 'Zwiń';
        return;
      }
      if (ev.target.closest('#p-more') && !st.busy) {
        st.busy = true;
        renderGrid();
        try { st.page++; await load(st.page); } catch (err) { st.page--; toast(err.message, { kind: 'error' }); }
        st.busy = false;
        if (ctx.alive()) renderGrid();
      }
    });
    ctx.onLibrary(() => { const m = $('#p-mine'); if (m) m.innerHTML = mineHtml(); });
  }
};

const sum0 = (a) => a.reduce((x, y) => x + y, 0);
