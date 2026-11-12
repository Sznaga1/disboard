'use strict';
/* ==========================================================================
   Disboard — ekrany: strona główna
   (dawny js/pages.js; wspólne funkcje w js/pages/common.js)
   ========================================================================== */

/* ==========================================================================
   STRONA GŁÓWNA
   ========================================================================== */
Pages.home = (ctx) => {
  ctx.title('Strona główna');
  ctx.el.innerHTML = `<div class="home">
    <div id="h-ngnl">${ngnlHeroHtml(null)}</div>
    <div class="home-duo">
      <div id="h-watching"></div>
      <div id="h-next"></div>
    </div>
    <div id="h-stats"></div>
    <div id="h-radar"></div>
    <div id="h-upcoming"></div>
    <div class="home-duo">
      <div id="h-recent"></div>
      <div id="h-updates"></div>
    </div>
    <div class="home-trio"><div id="h-added"></div><div id="h-finished"></div><div id="h-rewatch"></div></div>
  </div>`;

  const renderRadar = () => { const h = $('#h-radar'); if (h) h.innerHTML = Radar.homeHtml(); };
  renderRadar();
  ctx.on('radar', renderRadar);
  ctx.onLibrary(renderRadar);

  const renderWatching = () => {
    const list = entriesAll().filter((e) => e.status === 'watching').sort((a, b) => b.updatedAt - a.updatedAt);
    $('#h-watching').innerHTML = UI.section('Oglądam',
      list.length ? `<div class="grid-entries">${list.slice(0, 6).map(UI.entryCard).join('')}</div>`
        : UI.empty('Nic teraz nie oglądasz', 'Znajdź anime i ustaw status „Oglądam”. Pojawi się tutaj z licznikiem odcinków i czasem do kolejnego odcinka.', `<a class="btn" href="#/szukaj">${ICON.search}Szukaj anime</a>`),
      { more: list.length > 6 ? '#/lista/watching' : '', sub: list.length ? nUnit(list.length, 'title') : '' });
  };

  const renderNext = () => {
    const items = upcomingEpisodes().slice(0, 6);
    const backlog = backlogEntries();
    const rows = items.map((x, i) => `
      <li class="nx${i === 0 ? ' nearest' : ''}">
        <a class="nx-cover" href="#/anime/${x.e.id}" tabindex="-1" aria-hidden="true">${UI.cover(x.e.media, 'xs')}</a>
        <div class="nx-main">
          ${i === 0 ? '<span class="nx-flag">Najbliższy odcinek</span>' : ''}
          <a href="#/anime/${x.e.id}" class="nx-title">${esc(titleOf(x.e.media))}</a>
          <span class="nx-ep">Odcinek ${x.n.episode}${x.e.media.episodes ? ` z ${x.e.media.episodes}` : ''} · ${esc(DF.wdTime.format(new Date(x.n.airingAt * 1000)))}</span>
        </div>
        <div class="nx-cd num">${UI.countdownTo(x.n.airingAt, { short: i !== 0 })}</div>
      </li>`).join('');
    const back = backlog.length ? `<div class="backlog"><h3>Do nadrobienia</h3><ul>${backlog.map((e) => {
      const aired = Lib.airedEpisodes(e.media);
      const p = Lib.lastEp(e);
      return `<li><a href="#/anime/${e.id}">${esc(titleOf(e.media))}</a><span class="num">${aired - p === 1 ? `odc. ${aired}` : `odc. ${p + 1}–${aired}`}</span><button class="icon-btn sm" type="button" data-inc="${e.id}" aria-label="Obejrzałem kolejny odcinek">${ICON.plus}</button></li>`;
    }).join('')}</ul></div>` : '';
    $('#h-next').innerHTML = UI.section('Następne odcinki',
      (rows ? `<ol class="nx-list">${rows}</ol>` : UI.empty('Brak zaplanowanych odcinków', 'Emitowane anime ze statusem „Oglądam” lub „Planuję” pokażą tu odliczanie do kolejnego odcinka.')) + back,
      { more: '#/premiery', moreLabel: 'Harmonogram' });
  };

  const renderStats = () => {
    const st = Lib.stats();
    const month = Lib.thisMonthMinutes();
    const tiles = [
      ['Łączny czas oglądania', st.minutes ? fmtDuration(st.minutes, { short: true }) : '0 min', `${NF.format(Math.round(st.minutes))} min · ${NF1.format(st.minutes / 60)} godz.`, true],
      ['W tym miesiącu', month ? fmtDuration(month, { short: true }) : '0 min', monthLabel(monthKey(Date.now()))],
      ['Obejrzane odcinki', NF.format(st.eps), st.missingDur.length ? `${st.missingDur.length} bez długości odcinka` : 'wszystkie z czasem'],
      ['Rewatche', NF.format(st.rewatches), `${NF.format(st.rewatchesDone)} ukończone`],
      ['Na liście', NF.format(st.total), `${st.byStatus.watching} oglądam · ${st.byStatus.completed} obejrzane`],
    ];
    $('#h-stats').innerHTML = UI.section('Twoje oglądanie', `<div class="tiles">${tiles.map(([l, v, s, hero]) => `
      <div class="tile${hero ? ' hero' : ''}"><span class="tile-l">${esc(l)}</span><b class="tile-v num">${esc(v)}</b><span class="tile-s">${esc(s)}</span></div>`).join('')}</div>`,
    { more: '#/statystyki', moreLabel: 'Statystyki' });
  };

  const nextS = shiftSeason(seasonOf(new Date()), 1);
  const renderUpcoming = (seasonItems, err, r) => {
    const planned = entriesAll().filter((e) => !e.media.isAdult && (e.media.status === 'NOT_YET_RELEASED' || (e.status === 'planning' && e.media.nextAiringEpisode && e.media.nextAiringEpisode.episode === 1)))
      .sort((a, b) => (fuzzyTs(a.media.startDate) || 9e15) - (fuzzyTs(b.media.startDate) || 9e15));
    const mine = planned.length ? `<h3 class="sub-h">Z Twojej listy</h3><div class="grid-cards">${planned.slice(0, 6).map((e) => UI.animeCard(e.media, { extra: UI.premiereLine(e.media) })).join('')}</div>` : '';
    let pop;
    if (err) pop = UI.errorBox(err);
    else if (!seasonItems) pop = UI.skeletonCards(6);
    else pop = `<div class="grid-cards">${seasonItems.slice(0, 12).map((m) => UI.animeCard(m, { extra: seasonExtra(m) })).join('')}</div>`;
    $('#h-upcoming').innerHTML = UI.section('Nadchodzące premiery', `${mine}<h3 class="sub-h">Najpopularniejsze: ${esc(seasonLabel(nextS.season, nextS.year))}</h3>${UI.staleNote(r)}${pop}`,
      { more: '#/premiery/sezon', moreLabel: 'Wszystkie premiery' });
  };
  let seasonCache = null, seasonErr = null, seasonR = null;
  Ani.season(nextS.season, nextS.year).then((r) => { seasonCache = r.items; seasonR = r; if (ctx.alive()) renderUpcoming(seasonCache, null, r); })
    .catch((err) => { seasonErr = err; if (ctx.alive()) renderUpcoming(null, err); });

  const renderRecent = () => {
    const evs = S.history.filter((h) => h.k === 'ep').slice(-300).reverse();
    const groups = groupEpisodeEvents(evs).slice(0, 8);
    $('#h-recent').innerHTML = UI.section('Ostatnio obejrzane odcinki', groups.length ? `<ul class="feed">${groups.map((g) => `
      <li><a href="#/anime/${g.m}">${esc(titleForEvent(g))}</a><span>${esc(historyText(g))}</span><time>${esc(relTime(g.t))}</time></li>`).join('')}</ul>`
      : UI.empty('Historia jest pusta', 'Każde kliknięcie „+1” zapisuje datę obejrzenia odcinka.'), { more: '#/historia', moreLabel: 'Historia' });
  };

  const renderUpdates = () => {
    const list = S.notifs.filter((n) => S.settings.notifyKinds[n.kind] !== false).slice(0, 6);
    $('#h-updates').innerHTML = UI.section('Najważniejsze aktualizacje', list.length ? `<ul class="feed updates">${list.map((n) => `
      <li class="${n.read ? '' : 'unread'}"><a href="${esc(n.link || '#/')}">${esc(n.title)}</a><span>${esc(n.body)}</span><time>${esc(relTime(n.t))}</time></li>`).join('')}</ul>`
      : UI.empty('Na razie spokojnie', 'Tu trafią nowe odcinki, premiery, zmiany dat i nowe informacje o No Game No Life.'));
  };

  const renderTrio = () => {
    const all = entriesAll();
    const added = all.slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, 5);
    const finished = [];
    all.forEach((e) => e.sessions.forEach((s) => { if (s.finishedAt) finished.push({ e, s }); }));
    finished.sort((a, b) => b.s.finishedAt - a.s.finishedAt);
    const rewatch = all.filter((e) => e.sessions.length > 1)
      .sort((a, b) => (Lib.isRewatch(b) && b.status === 'watching') - (Lib.isRewatch(a) && a.status === 'watching') || b.updatedAt - a.updatedAt).slice(0, 5);
    const mini = (e, right) => `<li><a class="mini-cover" href="#/anime/${e.id}" tabindex="-1" aria-hidden="true">${UI.cover(e.media, 'xs')}</a><a href="#/anime/${e.id}" class="mini-t">${esc(titleOf(e.media))}</a><span class="mini-r">${right}</span></li>`;
    $('#h-added').innerHTML = UI.section('Ostatnio dodane', added.length ? `<ul class="mini">${added.map((e) => mini(e, esc(relTime(e.addedAt)))).join('')}</ul>` : UI.empty('Pusto', 'Dodane anime pojawią się tutaj.'));
    $('#h-finished').innerHTML = UI.section('Ostatnio zakończone', finished.length ? `<ul class="mini">${finished.slice(0, 5).map(({ e, s }) => mini(e, `${s.n ? `rewatch #${s.n} · ` : ''}${esc(fmtDateShort(s.finishedAt))}`)).join('')}</ul>` : UI.empty('Jeszcze nic', 'Ukończone serie i rewatche trafią tutaj.'));
    $('#h-rewatch').innerHTML = UI.section('Rewatche', rewatch.length ? `<ul class="mini">${rewatch.map((e) => mini(e, Lib.isRewatch(e) && e.status === 'watching' ? `<b>w trakcie #${Lib.cur(e).n}</b> ${UI.progressText(e)}` : `${nUnit(Lib.finishedCount(e), 'time')}`)).join('')}</ul>` : UI.empty('Brak rewatchy', 'Przy obejrzanym anime kliknij „Rozpocznij rewatch”.'));
  };

  const renderLib = () => { renderWatching(); renderNext(); renderStats(); renderRecent(); renderTrio(); renderUpcoming(seasonCache, seasonErr, seasonR); };
  renderLib();
  renderUpdates();
  ctx.onLibrary(renderLib);
  ctx.on('notifs', renderUpdates);
  loadNgnlModule(ctx, $('#h-ngnl'));
};
