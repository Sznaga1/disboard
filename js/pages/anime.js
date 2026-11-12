'use strict';
/* ==========================================================================
   Disboard — ekrany: szczegóły anime, tracker, postacie i twórcy
   (dawny js/pages.js; wspólne funkcje w js/pages/common.js)
   ========================================================================== */

/* ==========================================================================
   SZCZEGÓŁY ANIME
   ========================================================================== */
Pages.anime = (ctx) => {
  const id = Number(ctx.params.id);
  const e0 = Lib.get(id);
  // przelot okładki (Bajery): anime spoza listy też rysujemy od razu z danych karty, żeby okładka miała dokąd lecieć
  const m0 = e0 ? e0.media : (FX.on('morph') ? UI.media.get(id) : null);
  ctx.title(m0 ? titleOf(m0) : 'Anime');
  ctx.el.innerHTML = `<div class="detail" id="d-root">${m0 ? detailHtml(m0, { partial: true }) : `<div class="detail-load">${UI.skeletonRows(6)}</div>`}</div>`;
  if (m0) bindDetail(ctx, m0, true);

  Ani.media(id).then((r) => afterTyping($('#d-root'), () => {
    // pełne dane przyszły, gdy pisałeś notatkę — podmieniamy stronę dopiero po wyjściu z pola
    if (!ctx.alive()) return;
    const m = r.media;
    UI.remember(m);
    if (Lib.get(id)) Lib.updateMedia(m);
    ctx.title(titleOf(m));
    $('#d-root').innerHTML = UI.staleNote(r) + detailHtml(m);
    bindDetail(ctx, m, false);
    if (m.idMal) loadMalExtras(ctx, m);
    WatchOrder.load(ctx, $('#d-order'), m);
    if (m.format !== 'MOVIE' && m.episodes !== 1 && m.status !== 'NOT_YET_RELEASED') Episodes.section(ctx, $('#d-eps'), m);
    loadPeople(ctx, m);
  })).catch((err) => {
    if (!ctx.alive()) return;
    if (e0) {
      $('#d-root').insertAdjacentHTML('afterbegin', `<p class="stale">${esc(err.message)} Pokazuję dane zapisane przy wpisie.</p>`);
    } else {
      $('#d-root').innerHTML = UI.errorBox(err, 'd-retry');
      $('#d-retry').addEventListener('click', () => { location.hash = `#/anime/${id}?r=${Date.now()}`; });
    }
  });
};

function detailHtml(m, { partial = false } = {}) {
  const t = m.title || {};
  const studios = (m.studios && m.studios.edges) || [];
  const mainStudios = studios.filter((x) => x.isMain).map((x) => x.node.name);
  const others = studios.filter((x) => !x.isMain).map((x) => x.node.name);
  const alt = [t.romaji, t.english, t.native, ...(m.synonyms || [])].filter((x, i, a) => x && a.indexOf(x) === i && x !== titleOf(m));
  const hideSp = S.settings.hideSpoilers;
  const tags = (m.tags || []).filter((x) => x.rank >= 40).sort((a, b) => b.rank - a.rank);
  const info = [
    ['Format', FORMAT_PL[m.format] || m.format],
    ['Odcinki', m.episodes ? NF.format(m.episodes) : (m.status === 'RELEASING' ? 'emisja trwa, liczba nieznana' : null)],
    ['Długość odcinka', m.duration ? nUnit(m.duration, 'minute') : null],
    ['Status emisji', MSTATUS_PL[m.status] || m.status],
    ['Początek emisji', fuzzyDate(m.startDate)],
    ['Koniec emisji', fuzzyDate(m.endDate)],
    ['Sezon', m.season ? seasonLabel(m.season, m.seasonYear) : (m.seasonYear || null)],
    ['Źródło', m.source ? (SOURCE_PL[m.source] || m.source) : (partial ? null : 'Brak danych')],
    ['Studio', mainStudios.join(', ') || (partial ? null : 'Brak danych')],
    ['Producenci', others.length ? others.join(', ') : null, 'd-producers'],
    ['Kraj', m.countryOfOrigin === 'JP' ? 'Japonia' : m.countryOfOrigin === 'CN' ? 'Chiny' : m.countryOfOrigin === 'KR' ? 'Korea Płd.' : m.countryOfOrigin],
    ['Średnia AniList', m.averageScore ? `${m.averageScore}/100` : null],
    ['Popularność', m.popularity ? `${NF.format(m.popularity)} list` : null],
  ];
  const rels = ((m.relations && m.relations.edges) || []).slice().sort((a, b) => RELATION_ORDER.indexOf(a.relationType) - RELATION_ORDER.indexOf(b.relationType));
  const links = [
    ['AniList', m.siteUrl || `https://anilist.co/anime/${m.id}`],
    m.idMal ? ['MyAnimeList', `https://myanimelist.net/anime/${m.idMal}`] : null,
    ...((m.externalLinks || []).map((l) => [`${l.site}${l.language ? ` (${l.language})` : ''}`, l.url, l.type])),
  ].filter(Boolean);
  const next = m.nextAiringEpisode;

  return `
    <div class="d-banner"${m.bannerImage ? ` style="background-image:url('${esc(m.bannerImage)}')"` : ''}></div>
    <header class="d-head">
      ${UI.cover(m, 'lg')}
      <div class="d-titles">
        <div class="d-chips">${UI.airingChip(m)}${m.format ? `<span class="chip">${esc(FORMAT_PL[m.format] || m.format)}</span>` : ''}${UI.yearOf(m) ? `<span class="chip">${UI.yearOf(m)}</span>` : ''}${m.isAdult ? '<span class="chip adult">18+</span>' : ''}</div>
        <h1 class="d-title">${esc(titleOf(m))}</h1>
        ${t.native && t.native !== titleOf(m) ? `<p class="d-native" lang="ja">${esc(t.native)}</p>` : ''}
        ${subTitleOf(m) && subTitleOf(m) !== t.native ? `<p class="d-sub">${esc(subTitleOf(m))}</p>` : ''}
        ${next ? `<p class="d-next">${ICON.clock}Odcinek ${next.episode}${m.episodes ? ` z ${m.episodes}` : ''}: ${esc(DF.wdTime.format(new Date(next.airingAt * 1000)))} · za <b>${UI.countdownTo(next.airingAt)}</b></p>` : ''}
        ${m.status === 'NOT_YET_RELEASED' && !next ? `<p class="d-next">${UI.premiereLine(m)}</p>` : ''}
        <div id="d-add"></div>
      </div>
    </header>
    <div class="d-grid">
      <div class="d-main">
        <div id="d-tracker"></div>
        <div id="d-eps"></div>
        ${m.description ? `<section class="sec"><header class="sec-head"><h2>Opis</h2></header><div class="d-desc">${sanitizeHtml(m.description)}</div><p class="src-note">Opis: AniList (po angielsku)</p></section>` : (partial ? '' : '<section class="sec"><header class="sec-head"><h2>Opis</h2></header><p class="muted">Brak danych.</p></section>')}
        <div id="d-order">${rels.length ? `<section class="sec"><header class="sec-head"><h2>Powiązane</h2></header><div class="rels">${rels.map((r) => {
          const n = r.node;
          const href = n.type === 'ANIME' ? `#/anime/${n.id}` : (n.siteUrl || `https://anilist.co/manga/${n.id}`);
          const ext = n.type !== 'ANIME';
          return `<a class="rel" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${UI.cover(n, 'xs')}<span class="rel-t"><small>${esc(RELATION_PL[r.relationType] || r.relationType)} · ${esc(FORMAT_PL[n.format] || n.format || '')}</small><b>${esc(titleOf(n))}</b><small>${esc([n.startDate && n.startDate.year, MSTATUS_PL[n.status]].filter(Boolean).join(' · '))}</small></span>${ext ? ICON.ext : ''}</a>`;
        }).join('')}</div></section>` : ''}</div>
        ${m.trailer && m.trailer.id ? `<section class="sec"><header class="sec-head"><h2>Zwiastun</h2></header>${trailerHtml(m.trailer)}</section>` : ''}
        ${m.streamingEpisodes && m.streamingEpisodes.length ? `<section class="sec"><header class="sec-head"><h2>Odcinki w serwisach</h2><p class="sec-sub">Linki udostępnione przez AniList</p></header><div class="stream">${m.streamingEpisodes.slice(0, 12).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener"><img src="${esc(s.thumbnail)}" alt="" loading="lazy" onerror="this.remove()"><span>${esc(s.title)}</span><small>${esc(s.site)}</small></a>`).join('')}</div></section>` : ''}
        <div id="d-people"></div>
        <div id="d-history"></div>
      </div>
      <aside class="d-side">
        <section class="card">
          <h2 class="card-h">Informacje</h2>
          <dl class="info">${info.filter(([, v]) => v != null && v !== '').map(([k, v, idAttr]) => `<div${idAttr ? ` id="${idAttr}"` : ''}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
            ${partial ? '' : `<div id="d-producers-mal" hidden></div>`}</dl>
        </section>
        ${m.rankings && m.rankings.length ? `<section class="card"><h2 class="card-h">Rankingi AniList</h2><ul class="ranks">${m.rankings.slice().sort((a, b) => a.rank - b.rank).slice(0, 4).map((r) => `<li><b class="num">#${r.rank}</b><span>${esc(rankText(r).replace(/^#\d+\s*/, ''))}</span></li>`).join('')}</ul></section>` : ''}
        ${m.genres && m.genres.length ? `<section class="card"><h2 class="card-h">Gatunki</h2><div class="chips">${m.genres.map((g) => `<a class="chip link" href="#/szukaj?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}</div></section>` : ''}
        ${tags.length ? `<section class="card"><h2 class="card-h">Tagi</h2><div class="chips">${tags.map((x) => `<span class="chip${x.isMediaSpoiler ? ' spoiler' : ''}"${x.isMediaSpoiler && hideSp ? ' hidden' : ''} title="${esc(x.category || '')} · ${x.rank}%">${esc(x.name)}</span>`).join('')}</div>
          ${tags.some((x) => x.isMediaSpoiler) && hideSp ? '<button class="btn ghost sm" type="button" id="d-spoil">Pokaż tagi ze spoilerami</button>' : ''}</section>` : ''}
        ${alt.length ? `<section class="card"><h2 class="card-h">Inne tytuły</h2><ul class="alt">${alt.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></section>` : ''}
        <section class="card"><h2 class="card-h">Linki</h2><ul class="links">${links.map(([l, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}${ICON.ext}</a></li>`).join('')}</ul></section>
      </aside>
    </div>`;
}

function trailerHtml(tr) {
  if (tr.site === 'youtube') {
    const thumb = tr.thumbnail || `https://i.ytimg.com/vi/${tr.id}/hqdefault.jpg`;
    return `<div class="trailer" data-yt="${esc(tr.id)}"><img src="${esc(thumb)}" alt="" loading="lazy"><button class="trailer-play" type="button" aria-label="Odtwórz zwiastun">${ICON.play}</button>
      <a class="trailer-link" href="https://www.youtube.com/watch?v=${esc(tr.id)}" target="_blank" rel="noopener">Otwórz w YouTube ${ICON.ext}</a></div>`;
  }
  if (tr.site === 'dailymotion') return `<a class="btn ghost" href="https://www.dailymotion.com/video/${esc(tr.id)}" target="_blank" rel="noopener">Zwiastun w Dailymotion ${ICON.ext}</a>`;
  return '';
}

function bindDetail(ctx, m, partial) {
  const root = $('#d-root');
  const renderAdd = () => {
    const e = Lib.get(m.id);
    const host = $('#d-add', root);
    if (!host) return;
    host.innerHTML = e ? '' : `<div class="add-row"><span class="lbl">Dodaj do listy:</span>${LIST_STATUSES.map((s) => `<button class="btn ${s === 'planning' ? '' : 'ghost'} sm" type="button" data-add="${m.id}" data-status="${s}">${LSTATUS_PL[s]}</button>`).join('')}</div>`;
  };
  root._m = m; // pełne dane z API (rozkład ocen) — nadpisywane przy drugim renderze
  const renderTracker = () => {
    const host = $('#d-tracker', root);
    if (!host) return;
    // piszesz notatkę albo tagi (albo trzymasz wciśniętą mysz) → przerysujemy, gdy skończysz
    if (typingIn(host) || pressingIn(host)) {
      if (!root._trWait) { root._trWait = true; afterTyping(host, () => { root._trWait = false; if (ctx.alive()) renderTracker(); }); }
      return;
    }
    const e = Lib.get(m.id);
    withFocusKept(() => { host.innerHTML = trackerHtml(e, root._m, root._rateOpen ?? (e ? Lib.ratedCount(e) > 0 : false)); });
  };
  const renderHist = () => {
    const host = $('#d-history', root);
    if (!host) return;
    const evs = S.history.filter((h) => h.m === m.id).slice().reverse();
    if (!evs.length) { host.innerHTML = ''; return; }
    const items = groupHistory(evs).slice(0, 12);
    host.innerHTML = UI.section('Historia tego anime', `<ul class="feed">${items.map((h) => `<li><span>${esc(historyText(h))}</span><time>${esc(fmtDateTime(h.t))}</time></li>`).join('')}</ul>`, { more: `#/historia/${m.id}`, moreLabel: 'Pełna historia' });
  };
  renderAdd(); renderTracker(); renderHist();
  const sp = $('#d-spoil', root);
  if (sp) sp.addEventListener('click', () => { $$('.chip.spoiler', root).forEach((c) => { c.hidden = false; }); sp.remove(); });
  const tr = $('.trailer', root);
  if (tr) $('.trailer-play', tr).addEventListener('click', () => {
    tr.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(tr.dataset.yt)}?autoplay=1" title="Zwiastun" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  });
  // widok renderuje się dwa razy (dane z listy, potem z API) — nasłuch tylko raz
  if (root.dataset.bound) return;
  root.dataset.bound = '1';
  ctx.onLibrary((d) => {
    if (!(!d || !d.id || d.id === m.id || d.kind)) return;
    renderAdd(); renderHist();
    renderTracker(); // zmiana (też z innej karty) nie skasuje tekstu, który właśnie piszesz — patrz renderTracker
  });
  ctx.on('settings', () => renderTracker());
  bindTracker(ctx, root, m);
}

// porównanie Twojej oceny z rozkładem ocen społeczności AniList
function communityCmp(score, m, { full = true } = {}) {
  if (!m) return '';
  const avg = m.averageScore ? m.averageScore / 10 : null;
  const dist = ((m.stats && m.stats.scoreDistribution) || []).slice().sort((a, b) => a.score - b.score);
  const total = dist.reduce((a, d) => a + d.amount, 0);
  if (!avg && !total) return full ? '<p class="src-note">AniList nie ma jeszcze ocen tego anime.</p>' : '';
  const bucket = score != null ? clamp(Math.round(score) * 10, 10, 100) : null;
  let pct = null;
  if (bucket && total) {
    let below = 0, same = 0;
    for (const d of dist) { if (d.score < bucket) below += d.amount; else if (d.score === bucket) same += d.amount; }
    pct = Math.round(((below + same / 2) / total) * 100);
  }
  const diff = score != null && avg != null ? score - avg : null;
  const diffTxt = diff == null ? '' : `<b class="num ${diff >= 0 ? 'up' : 'down'}">${diff > 0 ? '+' : ''}${NF1.format(diff)}</b>`;
  if (!full) {
    return `<p class="cmp-line"><span class="lbl">AniList</span> średnia <b class="num">${avg != null ? NF1.format(avg) : '—'}</b>${diff != null ? ` · Ty ${diffTxt}` : ''}${pct != null ? ` · wyżej niż ${pct}% ocen` : ''}</p>`;
  }
  const max = Math.max(1, ...dist.map((d) => d.amount));
  return `<div class="cmp">
    <div class="cmp-txt">
      <span class="lbl">Na tle społeczności AniList</span>
      <p class="cmp-avg">Średnia <b class="num">${avg != null ? NF1.format(avg) : '—'}</b>${diff != null ? ` · Ty ${diffTxt}` : ''}</p>
      ${pct != null ? `<p>Twoja ocena ${NF1.format(score)} jest wyżej niż <b>${pct}%</b> ocen na AniList (${NF.format(total)} ${plural(total, 'głos', 'głosy', 'głosów')}).</p>` : '<p>Wystaw ocenę, a zobaczysz, jak wypadasz na tle innych.</p>'}
    </div>
    ${total ? `<div class="cmp-hist" role="img" aria-label="Rozkład ocen na AniList${bucket ? `, Twoja ocena w przedziale ${bucket / 10}` : ''}">
      ${dist.map((d) => `<i class="${d.score === bucket ? 'me' : ''}" style="height:${Math.max(3, (d.amount / max) * 100)}%" title="${d.score / 10}: ${NF.format(d.amount)} ${plural(d.amount, 'ocena', 'oceny', 'ocen')}"></i>`).join('')}
    </div><div class="cmp-axis" aria-hidden="true"><span>1</span><span>5</span><span>10</span></div>` : ''}
  </div>`;
}

function rateHtml(e, m, open) {
  const r = e.rating || {};
  const rated = Lib.ratedCount(e);
  const mean = Lib.ratingMean(e);
  let overall;
  if (!rated) overall = 'Przesuń suwaki. Ocena ogólna policzy się sama ze średniej kategorii.';
  else if (e.scoreManual) overall = `Ocena ogólna <b class="num">${e.score != null ? NF1.format(e.score) : '—'}</b> wpisana ręcznie · średnia kategorii: <b class="num">${NF1.format(mean)}</b> <button class="btn ghost sm" type="button" id="tr-rate-auto">Licz ze średniej</button>`;
  else overall = `Ocena ogólna <b class="num">${NF1.format(e.score)}</b> = średnia z ${rated} ${plural(rated, 'kategorii', 'kategorii', 'kategorii')}. Możesz ją też wybrać ręcznie powyżej.`;
  return `<section class="rate" id="tr-rate"${open ? '' : ' hidden'}>
    <div class="rate-grid">
      ${RATE_CATS.map(([k, l]) => `<div class="rate-row">
        <label for="rate-${k}">${l}</label>
        <input type="range" id="rate-${k}" data-rate="${k}" min="0" max="10" step="0.5" value="${r[k] || 0}" style="--p:${(r[k] || 0) * 10}%" aria-valuetext="${r[k] ? NF1.format(r[k]) : 'brak'}">
        <output class="num" id="rate-${k}-o" for="rate-${k}">${r[k] ? NF1.format(r[k]) : '—'}</output>
      </div>`).join('')}
    </div>
    <p class="rate-overall">${overall}</p>
    ${communityCmp(e.score, m)}
  </section>`;
}

function trackerHtml(e, m = null, rateOpen = false) {
  if (!e) return '';
  const c = Lib.cur(e);
  const total = Lib.epTotal(e);
  const dur = Lib.epDur(e);
  const canInc = !total || Lib.lastEp(e) < total;
  const eps = Lib.totalEps(e);
  const scores = ['', ...Array.from({ length: 20 }, (_, i) => (i + 1) / 2)];
  if (e.score != null && !scores.includes(e.score)) { scores.push(e.score); scores.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a - b)); }
  const done = Lib.finishedCount(e);
  const sessions = e.sessions.map((s) => {
    const label = s.n === 0 ? 'Pierwsze obejrzenie' : `Rewatch #${s.n}`;
    const isCur = s === c;
    return `<tr class="${isCur ? 'cur' : ''}">
      <th scope="row">${label}${s.past ? ' <small>(sprzed aplikacji)</small>' : s.nodate ? ' <small>(obejrzane kiedyś)</small>' : ''}${isCur && e.status === 'watching' ? ' <small class="on">w trakcie</small>' : ''}</th>
      <td class="num"${s.ranges ? ` title="Odcinki: ${esc(Lib.rangesText(s))}"` : ''}>${s.progress}/${total || '?'}${s.ranges ? ' <small>wybrane</small>' : ''}</td>
      <td><input type="date" id="ses-${s.n}-start" data-ses="${s.n}" data-f="startedAt" value="${toInputDate(s.startedAt)}" aria-label="${label}: data rozpoczęcia"></td>
      <td><input type="date" id="ses-${s.n}-end" data-ses="${s.n}" data-f="finishedAt" value="${toInputDate(s.finishedAt)}" aria-label="${label}: data zakończenia"></td>
      <td class="num">${dur ? esc(fmtDuration(s.progress * dur, { short: true })) : '—'}</td>
      <td>${e.sessions.length > 1 && !isCur ? `<button class="icon-btn sm" type="button" data-ses-del="${s.n}" aria-label="Usuń: ${label}">${ICON.x}</button>` : ''}</td>
    </tr>`;
  }).join('');
  return `<section class="tracker st-${e.status}" aria-label="Twój wpis">
    ${S.settings.backfill ? '<p class="bf-note"><span class="bf-dot" aria-hidden="true"></span><span>Tryb uzupełniania: odcinki, ukończenie i rewatch zapiszą się bez daty. <kbd>Alt+U</kbd> wyłącza.</span></p>' : ''}
    ${S.settings.skipFiller ? `<p class="bf-note sf-note"><span class="bf-dot" aria-hidden="true"></span><span>${Episodes.skipSet(e) ? 'Pomijanie fillerów: plusik przeskoczy fillery i recapy.' : 'Pomijanie fillerów jest włączone, ale dla tej serii nie ma jeszcze danych o fillerach (rozwiń „Odcinki”, żeby je pobrać).'} <kbd>Alt+P</kbd> wyłącza.</span></p>` : ''}
    <div class="tr-top">
      <label class="field"><span class="lbl">Status</span><select id="tr-status">${statusOptions(e.status)}</select></label>
      <div class="tr-prog">
        <span class="lbl">${Lib.isRewatch(e) ? `Rewatch #${c.n}` : 'Obejrzane odcinki'}</span>
        <div class="stepper">
          <button class="icon-btn" type="button" id="tr-dec" aria-label="Cofnij odcinek" ${c.progress ? '' : 'disabled'}>${ICON.minus}</button>
          <input id="tr-prog" type="number" inputmode="numeric" min="0" ${total ? `max="${total}"` : ''} value="${c.progress}" aria-label="Liczba obejrzanych odcinków">
          <span class="of">/ ${total || '?'}</span>
          <button class="icon-btn accent" type="button" id="tr-inc" aria-label="Obejrzałem kolejny odcinek" ${canInc ? '' : 'disabled'}>${ICON.plus}</button>
        </div>
        ${c.ranges ? `<small class="tr-ranges">Obejrzane odcinki: <b class="num">${esc(Lib.rangesText(c))}</b></small>` : ''}
      </div>
      <label class="field"><span class="lbl">Ocena</span><select id="tr-score">${scores.map((v) => `<option value="${v}"${(v === '' ? e.score == null : e.score === v) ? ' selected' : ''}>${v === '' ? 'brak' : NF1.format(v)}</option>`).join('')}</select></label>
      <button class="fav-btn${e.favorite ? ' on' : ''}" type="button" id="tr-fav" aria-pressed="${e.favorite}">${ICON.star}<span>${e.favorite ? 'Ulubione' : 'Do ulubionych'}</span></button>
    </div>
    <div class="rate-bar">
      <button class="rate-toggle" type="button" id="tr-rate-toggle" aria-expanded="${rateOpen}" aria-controls="tr-rate">${ICON.star}<span>${rateOpen ? 'Ukryj ocenę szczegółową' : 'Oceń szczegółowo'}</span><small>fabuła · postacie · animacja · muzyka · frajda</small></button>
      ${!rateOpen ? communityCmp(e.score, m, { full: false }) : ''}
    </div>
    ${rateHtml(e, m, rateOpen)}
    ${UI.progressBar(c.progress, total, { cls: 'lg' })}
    <div class="tr-time">
      <div><span class="lbl">Czas oglądania tego anime</span>
        <b class="num">${dur ? esc(fmtDuration(eps * dur)) : 'nie da się policzyć'}</b>
        <small>${dur ? `${NF.format(eps)} odc. × ${dur} min = ${NF.format(eps * dur)} min` : 'Brak długości odcinka w AniList — ustaw ją obok.'} · obejrzane ${nUnit(done, 'time')}</small>
      </div>
      <label class="field dur${dur ? '' : ' need'}"><span class="lbl">Długość odcinka (min)</span>
        <input id="tr-dur" type="number" inputmode="numeric" min="1" max="600" value="${e.durationOverride || ''}" placeholder="${e.media.duration ? `${e.media.duration} (AniList)` : 'wpisz'}"></label>
    </div>
    <div class="tr-actions">
      ${e.status === 'completed' ? `<button class="btn" type="button" data-rewatch="${e.id}">${ICON.repeat}Rozpocznij rewatch</button>` : ''}
      ${Lib.isRewatch(e) && c.progress === 0 ? `<button class="btn ghost" type="button" id="tr-cancel-rw">Anuluj rewatch #${c.n}</button>` : ''}
      <button class="btn ghost" type="button" id="tr-past">${ICON.history}Dopisz wcześniejsze obejrzenie</button>
    </div>
    <div class="tr-past" id="tr-past-form" hidden>
      <p>Obejrzałeś to anime, zanim zacząłeś korzystać z aplikacji? Dopisz tamto obejrzenie. Czas się doliczy, a z datą zakończenia trafi też do statystyk miesięcznych.</p>
      <div class="row">
        <label class="field"><span class="lbl">Rozpoczęto (opcjonalnie)</span><input type="date" id="past-start"></label>
        <label class="field"><span class="lbl">Zakończono (opcjonalnie)</span><input type="date" id="past-end"></label>
        <button class="btn" type="button" id="past-save">Dopisz obejrzenie</button>
      </div>
    </div>
    <div class="table-wrap"><table class="sessions"><caption>Obejrzenia i rewatche</caption>
      <thead><tr><th scope="col">Obejrzenie</th><th scope="col">Postęp</th><th scope="col">Rozpoczęto</th><th scope="col">Zakończono</th><th scope="col">Czas</th><th><span class="sr">Usuń</span></th></tr></thead>
      <tbody>${sessions}</tbody></table></div>
    <div class="tr-meta">
      <label class="field"><span class="lbl">Własne tagi (po przecinku)</span><input id="tr-tags" type="text" value="${esc(e.tags.join(', '))}" placeholder="np. ulubione openingi, z bratem"></label>
      <label class="field"><span class="lbl">Notatki</span><textarea id="tr-notes" rows="3" placeholder="Twoje przemyślenia, od którego tomu LN kontynuować…">${esc(e.notes)}</textarea></label>
    </div>
    <div class="tr-danger">
      <button class="btn danger ghost sm" type="button" id="tr-remove">Usuń z listy</button>
      <span id="tr-remove-confirm" hidden>Usunąć ${esc(titleOf(e.media))} razem z postępem? <button class="btn danger sm" type="button" id="tr-remove-yes">Tak, usuń</button> <button class="btn ghost sm" type="button" id="tr-remove-no">Anuluj</button></span>
    </div>
  </section>`;
}

function bindTracker(ctx, root, m) {
  const id = m.id;
  root.addEventListener('change', (ev) => {
    const t = ev.target;
    if (!Lib.get(id)) return;
    if (t.id === 'tr-status') Lib.setStatus(id, t.value);
    else if (t.id === 'tr-prog') Lib.setProgress(id, t.value);
    else if (t.id === 'tr-score') Lib.setScoreManual(id, t.value === '' ? null : Number(t.value));
    else if (t.dataset.rate) Lib.setRating(id, t.dataset.rate, Number(t.value));
    else if (t.id === 'tr-dur') Lib.setField(id, 'durationOverride', Number(t.value) > 0 ? Math.round(Number(t.value)) : null);
    else if (t.id === 'tr-tags') Lib.setField(id, 'tags', [...new Set(t.value.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean))]);
    else if (t.id === 'tr-notes') Lib.setField(id, 'notes', t.value);
    else if (t.dataset.ses) Lib.updateSession(id, Number(t.dataset.ses), { [t.dataset.f]: fromInputDate(t.value) });
  });
  // suwaki ocen: podgląd na żywo, zapis po puszczeniu
  root.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t.dataset || !t.dataset.rate) return;
    const v = Number(t.value);
    t.style.setProperty('--p', `${v * 10}%`);
    const o = document.getElementById(`${t.id}-o`);
    if (o) o.textContent = v ? NF1.format(v) : '—';
  });
  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t || !Lib.get(id)) return;
    if (t.id === 'tr-rate-toggle') {
      const panel = $('#tr-rate', root);
      root._rateOpen = panel.hidden;
      panel.hidden = !panel.hidden;
      t.setAttribute('aria-expanded', String(!panel.hidden));
      t.querySelector('span').textContent = panel.hidden ? 'Oceń szczegółowo' : 'Ukryj ocenę szczegółową';
      const line = $('.rate-bar .cmp-line', root);
      if (line) line.hidden = !panel.hidden;
      return;
    }
    if (t.id === 'tr-rate-auto') { Lib.setScoreAuto(id); return; }
    if (t.id === 'tr-inc') Lib.increment(id, 1);
    else if (t.id === 'tr-dec') Lib.increment(id, -1);
    else if (t.id === 'tr-fav') Lib.setField(id, 'favorite', !Lib.get(id).favorite);
    else if (t.id === 'tr-cancel-rw') Lib.cancelRewatch(id);
    else if (t.id === 'tr-past') { const f = $('#tr-past-form', root); f.hidden = !f.hidden; }
    else if (t.id === 'past-save') {
      Lib.addPastWatch(id, { startedAt: fromInputDate($('#past-start', root).value), finishedAt: fromInputDate($('#past-end', root).value) });
      toast('Dopisano wcześniejsze obejrzenie.', { kind: 'ok' });
    } else if (t.dataset.sesDel) Lib.removeSession(id, Number(t.dataset.sesDel));
    else if (t.id === 'tr-remove') { $('#tr-remove-confirm', root).hidden = false; t.hidden = true; }
    else if (t.id === 'tr-remove-no') { $('#tr-remove-confirm', root).hidden = true; $('#tr-remove', root).hidden = false; }
    else if (t.id === 'tr-remove-yes') {
      const snap = Lib.remove(id);
      toast(`Usunięto z listy: ${titleOf(m)}`, { action: { label: 'Cofnij', fn: () => Lib.restore(snap) } });
    }
  });
}

/* ---------- postacie i obsada (strona anime) ---------- */
function charCard(edge, media, cmap) {
  const c = edge.node;
  const va = (edge.voiceActors || [])[0];
  const fav = !!(S.favChars && S.favChars[c.id]);
  cmap.set(c.id, { id: c.id, n: c.name.full, img: c.image && c.image.medium, va: va ? { id: va.id, n: va.name.full } : null });
  return `<article class="pc">
    <div class="pc-char">
      ${c.image && c.image.medium ? `<img src="${esc(c.image.medium)}" alt="" loading="lazy" onerror="this.remove()">` : '<span class="pc-noimg"></span>'}
      <div class="pc-t"><a href="${esc(c.siteUrl || `https://anilist.co/character/${c.id}`)}" target="_blank" rel="noopener">${esc(c.name.full || c.name.native || '?')}</a><small>${esc(CHAR_ROLE_PL[edge.role] || '')}</small></div>
      <button type="button" class="pc-fav${fav ? ' on' : ''}" data-favchar="${c.id}" aria-pressed="${fav}" title="${fav ? 'Usuń z ulubionych postaci' : 'Dodaj do ulubionych postaci'}">${ICON.heart}</button>
    </div>
    ${va ? `<a class="pc-va" href="#/osoba/${va.id}">
      <div class="pc-t"><b>${esc(va.name.full)}</b><small lang="ja">${esc(va.name.native || 'aktor głosowy')}</small></div>
      ${va.image && va.image.medium ? `<img src="${esc(va.image.medium)}" alt="" loading="lazy" onerror="this.remove()">` : '<span class="pc-noimg"></span>'}
    </a>` : '<span class="pc-va none">brak danych o aktorze</span>'}
  </article>`;
}

async function loadPeople(ctx, m) {
  const host = $('#d-people');
  if (!host) return;
  const st = { tab: 'chars', cp: 1, sp: 1, chars: [], staff: [], moreC: false, moreS: false, busy: false };
  const cmap = new Map();
  host.innerHTML = UI.section('Postacie i obsada', UI.skeletonRows(3));
  const fetchPage = async () => {
    const r = await Ani.people(m.id, st.cp, st.sp);
    const md = r.media;
    return md;
  };
  try {
    const md = await fetchPage();
    if (!ctx.alive()) return;
    st.chars = md.characters.edges; st.moreC = md.characters.pageInfo.hasNextPage;
    st.staff = md.staff.edges; st.moreS = md.staff.pageInfo.hasNextPage;
  } catch (err) {
    if (ctx.alive()) host.innerHTML = UI.section('Postacie i obsada', UI.errorBox(err));
    return;
  }
  if (!st.chars.length && !st.staff.length) { host.innerHTML = ''; return; }
  const render = () => {
    const chars = st.chars.map((e) => charCard(e, m, cmap)).join('');
    const staff = st.staff.map((e) => `<a class="ps" href="#/osoba/${e.node.id}">
      ${e.node.image && e.node.image.medium ? `<img src="${esc(e.node.image.medium)}" alt="" loading="lazy" onerror="this.remove()">` : '<span class="pc-noimg"></span>'}
      <span class="pc-t"><b>${esc(e.node.name.full)}</b><small>${esc(e.role || '')}</small></span></a>`).join('');
    host.innerHTML = UI.section('Postacie i obsada', `
      <div class="chips pp-tabs" role="tablist">
        <button type="button" role="tab" class="chip-btn${st.tab === 'chars' ? ' on' : ''}" data-ptab="chars" aria-selected="${st.tab === 'chars'}">Postacie i aktorzy <span>${st.chars.length}${st.moreC ? '+' : ''}</span></button>
        <button type="button" role="tab" class="chip-btn${st.tab === 'staff' ? ' on' : ''}" data-ptab="staff" aria-selected="${st.tab === 'staff'}">Twórcy <span>${st.staff.length}${st.moreS ? '+' : ''}</span></button>
      </div>
      ${st.tab === 'chars' ? `<div class="pcs">${chars || '<p class="muted">Brak danych o postaciach.</p>'}</div>` : `<div class="pss">${staff || '<p class="muted">Brak danych o twórcach.</p>'}</div>`}
      ${(st.tab === 'chars' ? st.moreC : st.moreS) ? `<div class="more-row"><button class="btn ghost" type="button" id="pp-more">${st.busy ? 'Wczytuję…' : 'Pokaż więcej'}</button></div>` : ''}`,
    { sub: 'Japońska obsada głosowa z AniList · kliknij aktora, żeby zobaczyć jego inne role' });
  };
  render();
  host.addEventListener('click', async (ev) => {
    const tb = ev.target.closest('[data-ptab]');
    if (tb) { st.tab = tb.dataset.ptab; render(); return; }
    const fv = ev.target.closest('[data-favchar]');
    if (fv) {
      const c = cmap.get(Number(fv.dataset.favchar));
      if (!c) return;
      const onNow = Lib.toggleFavChar(c, m);
      fv.classList.toggle('on', onNow);
      fv.setAttribute('aria-pressed', String(onNow));
      toast(onNow ? `Dodano do ulubionych postaci: ${c.n}` : `Usunięto z ulubionych postaci: ${c.n}`, { kind: 'ok' });
      return;
    }
    if (ev.target.closest('#pp-more') && !st.busy) {
      st.busy = true;
      if (st.tab === 'chars') st.cp++; else st.sp++;
      render();
      try {
        const md = await fetchPage();
        if (!ctx.alive()) return;
        if (st.tab === 'chars') { st.chars.push(...md.characters.edges); st.moreC = md.characters.pageInfo.hasNextPage; }
        else { st.staff.push(...md.staff.edges); st.moreS = md.staff.pageInfo.hasNextPage; }
      } catch (err) { toast(err.message, { kind: 'error' }); }
      st.busy = false;
      render();
    }
  });
}

async function loadMalExtras(ctx, m) {
  try {
    const d = await Jikan.animeFull(m.idMal);
    if (!ctx.alive() || !d) return;
    const prod = (d.producers || []).map((p) => p.name);
    const lic = (d.licensors || []).map((p) => p.name);
    const host = $('#d-producers-mal');
    const rows = [];
    if (prod.length) rows.push(['Producenci (MyAnimeList)', prod.join(', ')]);
    if (lic.length) rows.push(['Licencjodawcy (MyAnimeList)', lic.join(', ')]);
    if (d.broadcast && d.broadcast.string && d.broadcast.string !== 'Unknown') rows.push(['Emisja w Japonii', d.broadcast.string]);
    if (d.rating) rows.push(['Kategoria wiekowa (MAL)', d.rating]);
    if (!rows.length || !host) return;
    const old = $('#d-producers');
    if (old && prod.length) old.remove();
    host.outerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  } catch { /* uzupełnienie opcjonalne */ }
}
