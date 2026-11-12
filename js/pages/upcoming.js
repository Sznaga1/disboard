'use strict';
/* ==========================================================================
   Disboard — ekrany: premiery i harmonogram
   (dawny js/pages.js; wspólne funkcje w js/pages/common.js)
   ========================================================================== */

/* ==========================================================================
   PREMIERY I HARMONOGRAM
   ========================================================================== */
Pages.upcoming = (ctx) => {
  ctx.title('Premiery i harmonogram');
  const TABS = [['harmonogram', 'Harmonogram'], ['sezon', 'Nadchodzące sezony'], ['zapowiedzi', 'Zapowiedziane']];
  const tab = TABS.some(([k]) => k === ctx.params.tab) ? ctx.params.tab : 'harmonogram';
  ctx.el.innerHTML = `<div class="page">
    <nav class="tabs" aria-label="Widok premier">${TABS.map(([k, l]) => `<a class="tab${k === tab ? ' on' : ''}" href="#/premiery/${k}"${k === tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <div id="u-out"></div></div>`;
  const out = $('#u-out');
  if (tab === 'harmonogram') upSchedule(ctx, out);
  else if (tab === 'sezon') upSeason(ctx, out);
  else upAnnounced(ctx, out);
};

function upSchedule(ctx, out) {
  let onlyMine = false;
  let data = null;
  out.innerHTML = `<div id="u-mine"></div>
    <div class="sec-head"><div><h2>Emisje w ciągu 7 dni</h2><p class="sec-sub">Godziny w Twojej strefie czasowej · dane: AniList</p></div>
      <label class="switch"><input type="checkbox" id="u-onlymine"><span>Tylko moja lista</span></label></div>
    <div id="u-sched">${UI.skeletonRows(8)}</div>`;
  const renderMine = () => {
    const items = upcomingEpisodes();
    $('#u-mine').innerHTML = UI.section('Twoje najbliższe odcinki', items.length ? `<ol class="nx-list big">${items.slice(0, 10).map((x, i) => `
      <li class="nx${i === 0 ? ' nearest' : ''}">
        <a class="nx-cover" href="#/anime/${x.e.id}" tabindex="-1" aria-hidden="true">${UI.cover(x.e.media, 'xs')}</a>
        <div class="nx-main">${i === 0 ? '<span class="nx-flag">Najbliższy</span>' : ''}<a class="nx-title" href="#/anime/${x.e.id}">${esc(titleOf(x.e.media))}</a>
          <span class="nx-ep">Odcinek ${x.n.episode}${x.e.media.episodes ? ` z ${x.e.media.episodes}` : ''} · ${esc(DF.wdTime.format(new Date(x.n.airingAt * 1000)))}</span></div>
        <div class="nx-cd num">${UI.countdownTo(x.n.airingAt, { short: i !== 0 })}</div></li>`).join('')}</ol>`
      : UI.empty('Brak zaplanowanych odcinków z Twojej listy', 'Emitowane anime ze statusem „Oglądam” lub „Planuję” pojawią się tutaj.'));
  };
  const renderSched = () => {
    const host = $('#u-sched');
    if (!data) return;
    const items = data.items.filter((x) => !onlyMine || S.entries[x.media.id]);
    if (!items.length) { host.innerHTML = UI.empty('Brak emisji', onlyMine ? 'Żadne anime z Twojej listy nie ma emisji w najbliższym tygodniu.' : 'AniList nie zwrócił harmonogramu.'); return; }
    const byDay = new Map();
    items.forEach((x) => { const k = dayKey(x.airingAt * 1000); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(x); });
    host.innerHTML = UI.staleNote(data) + [...byDay.entries()].map(([k, arr]) => `
      <section class="day"><h3 class="day-h">${esc(DF.weekday.format(new Date(arr[0].airingAt * 1000)))}${k === dayKey(Date.now()) ? ' <span class="chip">dziś</span>' : ''}</h3>
      <ul class="sched">${arr.map((x) => {
        UI.remember(x.media);
        const mine = S.entries[x.media.id];
        const past = x.airingAt * 1000 < Date.now();
        return `<li class="${mine ? 'mine' : ''}${past ? ' past' : ''}">
          <time class="num">${esc(fmtTime(x.airingAt * 1000))}</time>
          <a class="sched-cover" href="#/anime/${x.media.id}" tabindex="-1" aria-hidden="true">${UI.cover(x.media, 'xs')}</a>
          <div class="sched-main"><a href="#/anime/${x.media.id}">${esc(titleOf(x.media))}</a>
            <small>Odcinek ${x.episode}${x.media.episodes ? ` z ${x.media.episodes}` : ''} · ${esc(FORMAT_PL[x.media.format] || x.media.format || '')}${mine ? ` · ${esc(LSTATUS_PL[mine.status])}` : ''}</small></div>
          <span class="sched-cd num">${past ? 'po emisji' : UI.countdownTo(x.airingAt, { short: true })}</span>
          ${mine ? '' : `<button class="icon-btn sm" type="button" data-add="${x.media.id}" data-status="planning" aria-label="Dodaj do Planuję">${ICON.plus}</button>`}
        </li>`;
      }).join('')}</ul></section>`).join('');
  };
  renderMine();
  ctx.onLibrary(() => { renderMine(); renderSched(); });
  $('#u-onlymine').addEventListener('change', (ev) => { onlyMine = ev.target.checked; renderSched(); });
  Ani.schedule(7).then((r) => { data = r; if (ctx.alive()) renderSched(); })
    .catch((err) => { if (ctx.alive()) $('#u-sched').innerHTML = UI.errorBox(err); });
}

function upSeason(ctx, out) {
  const cur = seasonOf(new Date());
  const opts = [shiftSeason(cur, 0), shiftSeason(cur, 1), shiftSeason(cur, 2), shiftSeason(cur, 3)];
  let sel = 1;
  let page = 1, items = [];
  out.innerHTML = `<div class="chips seasons" role="group" aria-label="Sezon">${opts.map((o, i) => `<button type="button" class="chip-btn${i === sel ? ' on' : ''}" data-i="${i}">${esc(seasonLabel(o.season, o.year))}${i === 0 ? ' (obecny)' : ''}</button>`).join('')}</div><div id="u-season"></div>`;
  const load = async (more = false) => {
    const o = opts[sel];
    const host = $('#u-season');
    if (!more) { page = 1; items = []; host.innerHTML = UI.skeletonCards(12); } else page++;
    try {
      const r = await Ani.season(o.season, o.year, page);
      if (!ctx.alive()) return;
      items.push(...r.items);
      const dated = items.filter((m) => m.startDate && m.startDate.year);
      const undated = items.filter((m) => !(m.startDate && m.startDate.year));
      host.innerHTML = UI.staleNote(r) + `<p class="list-sum">${esc(seasonLabel(o.season, o.year))}: ${NF.format(r.pageInfo.total || items.length)} tytułów w AniList, od najpopularniejszych</p>
        <div class="grid-cards">${dated.concat(undated).map((m) => UI.animeCard(m, { extra: seasonExtra(m) })).join('')}</div>
        ${r.pageInfo.hasNextPage ? '<div class="more-row"><button class="btn ghost" type="button" id="u-more">Pokaż więcej</button></div>' : ''}`;
      const b = $('#u-more');
      if (b) b.addEventListener('click', () => { b.disabled = true; b.textContent = 'Wczytuję…'; load(true); });
    } catch (err) { if (ctx.alive()) host.innerHTML = UI.errorBox(err); }
  };
  $$('.chip-btn', out).forEach((b) => b.addEventListener('click', () => {
    sel = Number(b.dataset.i);
    $$('.chip-btn', out).forEach((x) => x.classList.toggle('on', x === b));
    load();
  }));
  ctx.onLibrary(() => { /* karty pokazują status listy przy następnym wczytaniu */ });
  load();
}

function upAnnounced(ctx, out) {
  let page = 0, items = [], hasMore = true;
  out.innerHTML = `<p class="list-sum">Wszystkie anime ze statusem „zapowiedziane” w AniList, uporządkowane według tego, co wiadomo o dacie premiery.</p><div id="u-ann">${UI.skeletonCards(12)}</div>`;
  const render = (r) => {
    const exact = items.filter((m) => fuzzyPrecision(m.startDate) === 'day').sort((a, b) => fuzzyTs(a.startDate) - fuzzyTs(b.startDate));
    const rough = items.filter((m) => ['month', 'year'].includes(fuzzyPrecision(m.startDate))).sort((a, b) => fuzzyTs(a.startDate) - fuzzyTs(b.startDate));
    const none = items.filter((m) => fuzzyPrecision(m.startDate) === 'none');
    const block = (title, sub, arr) => (arr.length ? UI.section(`${title} <span class="count">${arr.length}</span>`, `<div class="grid-cards">${arr.map((m) => UI.animeCard(m, { extra: UI.premiereLine(m) })).join('')}</div>`, { sub }) : '');
    $('#u-ann').innerHTML = UI.staleNote(r)
      + block('Z potwierdzoną datą premiery', 'Znany dzień premiery', exact)
      + block('Znany miesiąc lub rok', 'Dokładny dzień jeszcze nie został podany', rough)
      + block('Data premiery jeszcze nieustalona', 'Projekt ogłoszony bez terminu', none)
      + (hasMore ? '<div class="more-row"><button class="btn ghost" type="button" id="u-ann-more">Wczytaj kolejne zapowiedzi</button></div>' : '');
    const b = $('#u-ann-more');
    if (b) b.addEventListener('click', () => { b.disabled = true; b.textContent = 'Wczytuję…'; load(1); });
  };
  const load = async (n) => {
    try {
      let last;
      for (let i = 0; i < n && hasMore; i++) {
        page++;
        last = await Ani.announced(page);
        if (!ctx.alive()) return;
        items.push(...last.items);
        hasMore = last.pageInfo.hasNextPage;
      }
      render(last);
    } catch (err) { if (ctx.alive()) $('#u-ann').innerHTML = UI.errorBox(err); }
  };
  load(2);
}
