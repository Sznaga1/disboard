'use strict';
/* ==========================================================================
   Disboard — ekrany: statystyki i historia oglądania
   (dawny js/pages.js; wspólne funkcje w js/pages/common.js)
   ========================================================================== */

/* ==========================================================================
   STATYSTYKI
   ========================================================================== */
function statsTabs(tab) {
  const T = [['podsumowanie', 'summary', 'Podsumowanie'], ['nerd', 'nerd', 'Dla nerda'], ['rok', 'year', 'Twój rok']];
  return `<nav class="tabs" aria-label="Widok statystyk">${T.map(([slug, k, l]) => `<a class="tab${k === tab ? ' on' : ''}" href="#/statystyki/${slug}"${k === tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
}

Pages.stats = (ctx) => {
  // zakładka z adresu, a bez niej ostatnio oglądana
  const p = ctx.params.tab;
  const tab = p === 'nerd' ? 'nerd' : p === 'rok' ? 'year' : p === 'podsumowanie' ? 'summary' : (['nerd', 'year'].includes(S.settings.statsTab) ? S.settings.statsTab : 'summary');
  if (S.settings.statsTab !== tab) { S.settings.statsTab = tab; save(); }
  if (tab === 'nerd') { Nerd.page(ctx, statsTabs('nerd')); return; }
  if (tab === 'year') { YearRecap.page(ctx, statsTabs('year')); return; }
  ctx.title('Statystyki');
  let range = 12;
  const render = () => {
    const st = Lib.stats();
    const hours = st.minutes / 60, days = st.minutes / 1440;
    const monthsKeys = [];
    const d = new Date(); d.setDate(1);
    for (let i = range - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); monthsKeys.push(monthKey(x.getTime())); }
    const curM = monthKey(Date.now());
    const monthData = monthsKeys.map((k) => ({ label: monthLabel(k), short: monthLabel(k, { short: true }), value: (st.months[k] || 0) / 60, tip: `${fmtDuration(st.months[k] || 0) || '0 minut'} · ${NF.format(st.monthEps[k] || 0)} odc.`, hl: k === curM }));
    const yearKeys = Object.keys(st.years).sort();
    const yearData = yearKeys.map((y) => ({ label: y, value: st.years[y] / 60, tip: fmtDuration(st.years[y]) }));
    const top = st.perAnime.slice().sort((a, b) => b.min - a.min || b.eps - a.eps).slice(0, 10);
    const genres = Object.entries(st.genres).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const statusColors = { watching: 'var(--st-watching)', planning: 'var(--st-planning)', completed: 'var(--st-completed)', paused: 'var(--st-paused)', dropped: 'var(--st-dropped)' };
    const allRows = st.perAnime.slice().sort((a, b) => b.min - a.min);

    ctx.el.innerHTML = `<div class="page stats">
      ${statsTabs('summary')}
      <section class="stat-hero">
        <div class="stat-big"><span class="lbl">Łączny czas oglądania</span><b class="num">${esc(st.minutes ? fmtDuration(st.minutes) : '0 minut')}</b></div>
        <dl class="stat-units">
          <div><dt>minuty</dt><dd class="num">${NF.format(Math.round(st.minutes))}</dd></div>
          <div><dt>godziny</dt><dd class="num">${NF1.format(hours)}</dd></div>
          <div><dt>dni</dt><dd class="num">${NF2.format(days)}</dd></div>
          <div><dt>obejrzane odcinki</dt><dd class="num">${NF.format(st.eps)}</dd></div>
          <div><dt>średnia długość odcinka</dt><dd class="num">${st.avgEp ? `${NF1.format(st.avgEp)} min` : '—'}</dd></div>
          <div><dt>rewatche</dt><dd class="num">${NF.format(st.rewatches)} <small>(${NF.format(st.rewatchesDone)} ukończ.)</small></dd></div>
        </dl>
      </section>
      ${st.missingDur.length ? `<div class="warnbox"><b>${st.missingDur.length} ${plural(st.missingDur.length, 'anime nie ma', 'anime nie mają', 'anime nie ma')} długości odcinka w AniList</b>, więc ich odcinki nie wliczają się do czasu:
        ${st.missingDur.map((e) => `<a href="#/anime/${e.id}">${esc(titleOf(e.media))}</a>`).join(', ')}. Ustaw długość ręcznie na stronie anime.</div>` : ''}
      <div class="stats-grid">
        <section class="card span2">
          <header class="card-head"><h2 class="card-h">Czas oglądania miesięcznie</h2>
            <div class="seg" role="group" aria-label="Zakres"><button type="button" data-range="12" class="${range === 12 ? 'on' : ''}">12 mies.</button><button type="button" data-range="24" class="${range === 24 ? 'on' : ''}">24 mies.</button></div></header>
          <p class="card-sub">Godziny na podstawie dat obejrzenia odcinków</p>
          <div id="c-month"></div>
          ${st.undatedMinutes > 0.5 ? `<p class="src-note">${esc(fmtDuration(st.undatedMinutes))} nie ma daty (obejrzane kiedyś, import albo przeniesione do przeszłości). Ten czas liczy się do sumy, ale nie trafia na wykres.</p>` : ''}
        </section>
        <section class="card"><h2 class="card-h">Lista według statusu</h2><p class="card-sub">${nUnit(st.total, 'title')} · ${st.favs} ulubionych</p><div id="c-status"></div></section>
        <section class="card"><h2 class="card-h">Czas oglądania rocznie</h2><p class="card-sub">Godziny</p><div id="c-year"></div></section>
        <section class="card"><h2 class="card-h">Najczęściej oglądane serie</h2><p class="card-sub">Według łącznego czasu, z rewatchami</p><div id="c-top"></div></section>
        <section class="card"><h2 class="card-h">Gatunki</h2><p class="card-sub">Według czasu oglądania</p><div id="c-genre"></div></section>
      </div>
      ${UI.section('Czas dla każdego anime', allRows.length ? `<div class="table-wrap"><table class="ptable">
        <thead><tr><th scope="col">Anime</th><th scope="col" class="num">Obejrzenia</th><th scope="col" class="num">Odcinki</th><th scope="col" class="num">Długość odc.</th><th scope="col" class="num">Czas</th></tr></thead>
        <tbody>${allRows.map((p) => `<tr><th scope="row"><a href="#/anime/${p.e.id}">${esc(titleOf(p.e.media))}</a></th><td class="num">${p.sessions > 1 ? `${p.watches} (${p.sessions - 1} rew.)` : p.watches}</td><td class="num">${NF.format(p.eps)}</td><td class="num">${Lib.epDur(p.e) ? `${Lib.epDur(p.e)} min` : '<span class="warn-txt">brak</span>'}</td><td class="num">${esc(fmtDuration(p.min, { short: true }))}</td></tr>`).join('')}</tbody></table></div>`
        : UI.empty('Brak obejrzanych odcinków', 'Statystyki wypełnią się, gdy zaczniesz oznaczać odcinki.'))}
    </div>`;

    Charts.columns($('#c-month'), { data: monthData, format: (v) => `${NF1.format(v)} godz.`, axisFormat: (v) => NF1.format(v), unitLabel: 'Czas oglądania (godz.)', color: 'var(--viz-1)', empty: 'Brak obejrzanych odcinków z datą w tym okresie.' });
    Charts.columns($('#c-year'), { data: yearData, format: (v) => `${NF1.format(v)} godz.`, axisFormat: (v) => NF1.format(v), unitLabel: 'Czas (godz.)', color: 'var(--viz-1)', height: 160, empty: 'Brak danych z datą.' });
    Charts.stack($('#c-status'), { data: LIST_STATUSES.map((s) => ({ label: LSTATUS_PL[s], value: st.byStatus[s] || 0, color: statusColors[s] })) });
    Charts.hbars($('#c-top'), { data: top.map((p) => ({ label: titleOf(p.e.media), value: p.min || p.eps, text: p.min ? `${fmtDuration(p.min, { short: true })}${p.sessions > 1 ? ` · ${p.sessions}×` : ''}` : `${p.eps} odc.`, href: `#/anime/${p.e.id}` })), color: 'var(--viz-2)', header: ['Anime', 'Czas'], empty: 'Jeszcze nic nie obejrzano.' });
    Charts.hbars($('#c-genre'), { data: genres.map(([g, v]) => ({ label: g, value: v, text: fmtDuration(v, { short: true }) })), color: 'var(--viz-1)', header: ['Gatunek', 'Czas'], empty: 'Brak danych o gatunkach.' });
    $$('[data-range]', ctx.el).forEach((b) => b.addEventListener('click', () => { range = Number(b.dataset.range); render(); }));
  };
  render();
  ctx.onLibrary(render);
};

/* ==========================================================================
   HISTORIA
   ========================================================================== */
Pages.history = (ctx) => {
  const only = ctx.params.id ? Number(ctx.params.id) : null;
  ctx.title('Historia oglądania');
  let kind = 'all', limit = 150;
  const render = () => {
    const ids = [...new Set(S.history.map((h) => h.m))];
    const evs = S.history.filter((h) => (!only || h.m === only) && (kind === 'all' || historyKind(h) === kind)).slice().reverse();
    const groups = groupHistory(evs);
    const byDay = new Map();
    groups.slice(0, limit).forEach((g) => { const k = dayKey(g.t); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(g); });
    const e = only ? S.entries[only] : null;
    const summary = e ? `<section class="card hist-sum">
        <div class="hist-sum-head">${UI.cover(e.media, 'sm')}<div><h2><a href="#/anime/${e.id}">${esc(titleOf(e.media))}</a></h2>
        <p>Obejrzane ${nUnit(Lib.finishedCount(e), 'time')} · ${NF.format(Lib.totalEps(e))} odcinków · ${esc(fmtDuration(Lib.entryMinutes(e)))}</p></div></div>
        <ol class="hist-sessions">${e.sessions.map((s) => `<li><b>${s.n === 0 ? 'Pierwsze obejrzenie' : `Rewatch #${s.n}`}</b><span>${s.progress}/${Lib.epTotal(e) || '?'} odc.</span><span>${s.startedAt ? `od ${esc(fmtDate(s.startedAt))}` : 'początek bez daty'}</span><span>${s.finishedAt ? `do ${esc(fmtDate(s.finishedAt))}` : (s === Lib.cur(e) && e.status === 'watching' ? 'w trakcie' : Lib.sessionDone(e, s) ? 'ukończone, bez daty' : 'bez daty zakończenia')}</span></li>`).join('')}</ol>
      </section>` : '';
    ctx.el.innerHTML = `<div class="page">
      ${summary}
      <div class="toolbar">
        <label class="field"><span class="lbl">Anime</span><select id="h-anime"><option value="">Wszystkie</option>${ids.map((id) => ({ id, t: S.entries[id] ? titleOf(S.entries[id].media) : (S.history.find((h) => h.m === id) || {}).ti })).sort((a, b) => String(a.t).localeCompare(String(b.t), 'pl')).map((x) => `<option value="${x.id}"${x.id === only ? ' selected' : ''}>${esc(x.t || '#' + x.id)}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">Rodzaj</span><select id="h-kind"><option value="all">Wszystko</option><option value="ep"${kind === 'ep' ? ' selected' : ''}>Odcinki</option><option value="session"${kind === 'session' ? ' selected' : ''}>Rozpoczęcia, zakończenia, rewatche</option><option value="other"${kind === 'other' ? ' selected' : ''}>Statusy, oceny, lista</option></select></label>
      </div>
      ${groups.length ? [...byDay.entries()].map(([k, arr]) => `<section class="day"><h3 class="day-h">${esc(DF.weekday.format(new Date(arr[0].t)))} ${new Date(arr[0].t).getFullYear() !== new Date().getFullYear() ? new Date(arr[0].t).getFullYear() : ''}</h3>
        <ul class="timeline">${arr.map((h) => `<li class="k-${historyKind(h)}"><time class="num">${esc(fmtTime(h.t))}</time>${only ? '' : `<a href="#/anime/${h.m}">${esc(titleForEvent(h))}</a>`}<span>${esc(historyText(h))}</span></li>`).join('')}</ul></section>`).join('')
        + (groups.length > limit ? '<div class="more-row"><button class="btn ghost" type="button" id="h-more">Pokaż starsze</button></div>' : '')
        : UI.empty('Brak zdarzeń', 'Historia zapisuje się sama: dodanie anime, każdy odcinek, zmiany statusu, rozpoczęcia i zakończenia rewatchy.')}
    </div>`;
    $('#h-anime').addEventListener('change', (ev) => { location.hash = ev.target.value ? `#/historia/${ev.target.value}` : '#/historia'; });
    $('#h-kind').addEventListener('change', (ev) => { kind = ev.target.value; render(); });
    const more = $('#h-more');
    if (more) more.addEventListener('click', () => { limit += 150; render(); });
  };
  render();
  ctx.onLibrary(render);
};
