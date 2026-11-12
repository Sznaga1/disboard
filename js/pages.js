'use strict';
/* ==========================================================================
   Disboard — ekrany
   Każdy ekran dostaje ctx: { el, params, query, alive(), title(), onLibrary(), on() }
   ========================================================================== */

const Pages = {};

/* ---------- pomocnicze ---------- */
const entriesAll = () => Object.values(S.entries);

function upcomingEpisodes() {
  const now = Date.now();
  return entriesAll()
    .filter((e) => ['watching', 'planning', 'paused'].includes(e.status) && !e.media.isAdult)
    .map((e) => ({ e, n: e.media.nextAiringEpisode }))
    .filter((x) => x.n && x.n.airingAt * 1000 > now)
    .sort((a, b) => a.n.airingAt - b.n.airingAt);
}

function backlogEntries() {
  return entriesAll().filter((e) => {
    if (e.status !== 'watching' || e.media.isAdult) return false;
    const aired = Lib.airedEpisodes(e.media);
    return aired != null && aired > Lib.lastEp(e) && !(Lib.epTotal(e) && Lib.lastEp(e) >= Lib.epTotal(e));
  });
}

// scala zdarzenia 'ep' w zakresy („odc. 1–12”)
function groupEpisodeEvents(evs) {
  const out = [];
  for (const h of evs) {
    const last = out[out.length - 1];
    if (last && last.m === h.m && last.s === h.s && Math.abs(last.t - h.t) < 90000 && (h.ep === last.from - 1 || h.ep === last.to + 1)) {
      last.from = Math.min(last.from, h.ep);
      last.to = Math.max(last.to, h.ep);
      last.past = last.past || h.past;
      continue;
    }
    out.push({ ...h, from: h.ep, to: h.ep });
  }
  return out;
}

function historyText(h) {
  const rw = h.s > 0 ? ` (rewatch #${h.s})` : '';
  switch (h.k) {
    case 'ep': return `Obejrzano ${h.from === h.to ? `odc. ${h.from}` : `odc. ${h.from}–${h.to}`}${rw}${h.past ? ' · obejrzenie z przeszłości' : ''}`;
    case 'add': return `Dodano do listy${h.to && h.to !== 'planning' ? ` jako „${LSTATUS_PL[h.to]}”` : ''}`;
    case 'remove': return 'Usunięto z listy';
    case 'status': return `Status: ${LSTATUS_PL[h.from] || '—'} → ${LSTATUS_PL[h.to] || '—'}${rw}`;
    case 'start': return h.s > 0 ? `Rozpoczęto rewatch #${h.s}` : 'Rozpoczęto oglądanie';
    case 'finish': return h.s > 0 ? `Ukończono rewatch #${h.s}` : 'Ukończono pierwsze obejrzenie';
    case 'rewatch': return `Rozpoczęto rewatch #${h.s}`;
    case 'score': return h.to == null ? 'Usunięto ocenę' : `Ocena: ${NF1.format(h.to)}/10`;
    case 'fav': return h.to ? 'Dodano do ulubionych' : 'Usunięto z ulubionych';
    case 'past': return `Dopisano wcześniejsze obejrzenie${h.at ? ` (ukończone ${fmtDate(h.at)})` : ''}`;
    case 'import': return `Zaimportowano z ${h.src || 'pliku'}`;
    case 'backfill': return h.rw
      ? `Dopisano rewatch #${h.s} jako obejrzany kiedyś (bez daty)`
      : `Dopisano jako obejrzane kiedyś: ${h.from === h.to ? `odc. ${h.from}` : `odc. ${h.from}–${h.to}`}${rw} (bez daty)`;
    case 'archived': return h.n
      ? `Przeniesiono do przeszłości: ${nUnit(h.n, 'episode')}${h.sess > 1 ? ` z ${h.sess} obejrzeń` : ''} (teraz bez daty)`
      : 'Przeniesiono daty obejrzenia do przeszłości (teraz bez daty)';
    default: return h.k;
  }
}
const historyKind = (h) => (h.k === 'ep' ? 'ep' : ['start', 'finish', 'rewatch', 'past', 'backfill', 'archived'].includes(h.k) ? 'session' : 'other');

function titleForEvent(h) {
  const e = S.entries[h.m];
  return e ? titleOf(e.media) : (h.ti || `#${h.m}`);
}

const TEXT_FIELD = 'textarea, input[type=text], input[type=search]';

// po przerysowaniu wraca fokus, a w polu tekstowym także kursor i zaznaczenie
function withFocusKept(fn) {
  const a = document.activeElement;
  const id = a && a.id;
  const sel = id && a.matches(TEXT_FIELD) ? { s: a.selectionStart, e: a.selectionEnd, d: a.selectionDirection, top: a.scrollTop } : null;
  fn();
  if (!id) return;
  const el = document.getElementById(id);
  if (!el || el === a) return;
  el.focus({ preventScroll: true });
  if (sel && el.matches(TEXT_FIELD)) { try { el.setSelectionRange(sel.s, sel.e, sel.d); } catch { /* inny typ pola */ } el.scrollTop = sel.top; }
}

// czy piszesz właśnie w polu tekstowym wewnątrz el
const typingIn = (el) => {
  const a = document.activeElement;
  return !!(el && a && el.isConnected && el.contains(a) && a.matches(TEXT_FIELD));
};
// wciśnięty przycisk myszy na przycisku/linku: przerysowanie teraz podmieniłoby go pod kursorem i kliknięcie by przepadło
// (np. piszesz notatkę i od razu klikasz „+1”: wyjście z pola zapisuje notatkę już przy wciśnięciu myszy)
let pressedEl = null;
window.addEventListener('pointerdown', (ev) => { pressedEl = ev.target instanceof Element ? ev.target.closest('button, a, summary, [role=button]') : null; }, true);
for (const k of ['pointerup', 'pointercancel', 'click']) window.addEventListener(k, () => { pressedEl = null; }, true);
const pressingIn = (el) => !!(pressedEl && el && el.contains(pressedEl));
// przerysowanie czeka, aż skończysz pisać: podmiana pola w trakcie gubiła kursor (litery lądowały na początku)
function afterTyping(el, fn) {
  const a = document.activeElement;
  if (typingIn(el)) { a.addEventListener('blur', () => setTimeout(() => afterTyping(el, fn), 0), { once: true }); return undefined; }
  if (!pressingIn(el)) return fn();
  let done = false;
  const go = () => { if (!done) { done = true; afterTyping(el, fn); } };
  window.addEventListener('pointerup', () => setTimeout(go, 0), { once: true, capture: true }); // po kliknięciu
  setTimeout(() => { pressedEl = null; go(); }, 1500); // gdyby puszczenie myszy nie dotarło
  return undefined;
}

function statusOptions(sel) {
  return LIST_STATUSES.map((s) => `<option value="${s}"${s === sel ? ' selected' : ''}>${LSTATUS_PL[s]}</option>`).join('');
}

const JIKAN_STATUS_PL = { 'Finished Airing': 'Zakończone', 'Currently Airing': 'Emitowane', 'Not yet aired': 'Zapowiedziane' };
function malCard(a) {
  const img = a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url);
  const pm = { title: { romaji: a.title, english: a.title_english, native: a.title_japanese }, coverImage: { large: img } };
  const year = a.year || (a.aired && a.aired.prop && a.aired.prop.from && a.aired.prop.from.year);
  const meta = [year, a.type, a.episodes ? nUnit(a.episodes, 'episode') : null, JIKAN_STATUS_PL[a.status] || a.status].filter(Boolean).join(' · ');
  return `<article class="acard">
    <a class="acard-cover" href="${esc(a.url)}" target="_blank" rel="noopener" aria-label="${esc(titleOf(pm))} w MyAnimeList">${UI.cover(pm)}${a.type ? `<span class="acard-format">${esc(a.type)}</span>` : ''}</a>
    <button class="acard-add" type="button" data-add-mal="${Number(a.mal_id)}" title="Dodaj do listy: Planuję" aria-label="Dodaj ${esc(titleOf(pm))} do listy">${ICON.plus}</button>
    <div class="acard-body"><a class="acard-title" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(titleOf(pm))}</a>
      <div class="acard-meta">${esc(meta)}</div><div class="acard-extra mal">MyAnimeList ${ICON.ext}</div></div>
  </article>`;
}

function seasonExtra(m) {
  if (m.status === 'NOT_YET_RELEASED') return UI.premiereLine(m);
  if (m.nextAiringEpisode) return `Odc. ${m.nextAiringEpisode.episode} za ${UI.countdownTo(m.nextAiringEpisode.airingAt, { short: true })}`;
  return esc(fuzzyDate(m.startDate) || '');
}

/* ==========================================================================
   Moduł No Game No Life (strona główna i centrum)
   ========================================================================== */
function sequelHtml(s) {
  const info = NGNL.sequelInfo(s);
  if (!info) {
    return `<div class="seq seq-none"><span class="seq-label">Drugi sezon</span>
      <b>AniList nie ma jeszcze zapowiedzi</b>
      <small>Sprawdzam automatycznie relacje serii i nowe wpisy w bazie.</small></div>`;
  }
  const m = info.media;
  const name = esc(titleOf(m));
  if (m.status === 'NOT_YET_RELEASED') {
    const d = fuzzyDate(m.startDate);
    const exact = fuzzyPrecision(m.startDate) === 'day';
    const at = m.nextAiringEpisode ? m.nextAiringEpisode.airingAt : (exact ? Math.floor(fuzzyTs(m.startDate) / 1000) : null);
    return `<div class="seq seq-yes"><span class="seq-label">Zapowiedziano!</span>
      <a href="#/anime/${m.id}"><b>${name}</b></a>
      <small>${d ? `Premiera: ${esc(d)}` : 'Data premiery: jeszcze nieustalona'}${at ? ` · za ${UI.countdownTo(at, { short: true })}` : ''}</small></div>`;
  }
  if (m.status === 'RELEASING') {
    const n = m.nextAiringEpisode;
    return `<div class="seq seq-yes"><span class="seq-label">Emitowane teraz</span>
      <a href="#/anime/${m.id}"><b>${name}</b></a>
      <small>${n ? `Odcinek ${n.episode} za ${UI.countdownTo(n.airingAt, { short: true })}` : 'Trwa emisja'}</small></div>`;
  }
  return `<div class="seq seq-yes"><span class="seq-label">Kontynuacja</span><a href="#/anime/${m.id}"><b>${name}</b></a><small>${esc(MSTATUS_PL[m.status] || '')}</small></div>`;
}

function ngnlMineHtml(main) {
  if (!main) return '';
  const e = Lib.get(main.id);
  if (!e) {
    return `<div class="mine"><span class="mine-label">Twoja lista</span>
      <div class="mine-actions">
        <button class="btn sm" type="button" data-add="${main.id}" data-status="completed">${ICON.check}Mam za sobą</button>
        <button class="btn ghost sm" type="button" data-add="${main.id}" data-status="watching">Oglądam</button>
      </div></div>`;
  }
  const c = Lib.cur(e);
  const total = Lib.epTotal(e);
  const done = Lib.finishedCount(e);
  const canInc = e.status !== 'completed' && (!total || c.progress < total);
  return `<div class="mine"><span class="mine-label">Twoja lista</span>
    <div class="mine-row">${UI.statusChip(e.status, e)}<span class="num">${c.progress}/${total || '?'} odc.</span></div>
    ${UI.progressBar(c.progress, total)}
    <div class="mine-stat">Obejrzane ${nUnit(done, 'time')} · ${esc(fmtDuration(Lib.entryMinutes(e), { short: true }))} przed ekranem</div>
    <div class="mine-actions">
      ${canInc ? `<button class="btn sm" type="button" data-inc="${e.id}">${ICON.plus}Kolejny odcinek</button>` : ''}
      ${e.status === 'completed' ? `<button class="btn sm" type="button" data-rewatch="${e.id}">${ICON.repeat}Rozpocznij rewatch</button>` : ''}
      <a class="btn ghost sm" href="#/anime/${e.id}">Szczegóły</a>
    </div></div>`;
}

function ngnlHeroHtml(s, { full = false, error = null } = {}) {
  const main = s && s.main;
  const banner = main && main.bannerImage;
  const studios = main ? ((main.studios && main.studios.edges) || []).filter((x) => x.isMain).map((x) => x.node.name) : [];
  const meta = main ? [FORMAT_PL[main.format] || main.format, main.episodes ? nUnit(main.episodes, 'episode') : null, main.seasonYear, studios.join(', ')].filter(Boolean).join(' · ') : '';
  return `<section class="ngnl${full ? ' full' : ''}" aria-labelledby="ngnl-h">
    ${banner ? `<div class="ngnl-bg" style="background-image:url('${esc(banner)}')"></div>` : '<div class="ngnl-bg"></div>'}
    <div class="ngnl-board" aria-hidden="true"></div>
    <div class="ngnl-inner">
      <div class="ngnl-id">
        <p class="eyebrow">${ICON.crown}Centrum serii</p>
        <h2 class="ngnl-title" id="ngnl-h">${esc(main ? (main.title.romaji || 'No Game No Life') : 'No Game No Life')}</h2>
        <p class="ngnl-jp" lang="ja">${esc(main ? (main.title.native || '') : 'ノーゲーム・ノーライフ')}</p>
        ${meta ? `<p class="ngnl-meta">${esc(meta)}</p>` : ''}
        ${error ? `<p class="stale">${esc(error.message)}</p>` : ''}
        ${s ? UI.staleNote(s) : ''}
        <div class="ngnl-cards">
          ${s ? sequelHtml(s) : ''}
          <div class="seq seq-wait"><span class="seq-label">Jak długo czekam na drugi sezon</span><b class="wait-inline num" data-wait="short">—</b><small data-wait="since"></small></div>
        </div>
        ${ngnlMineHtml(main)}
      </div>
      <div class="ngnl-feed">
        <div class="ngnl-feed-head"><h3>Najnowsze informacje</h3><span class="count-new" id="ngnl-newcount" hidden></span></div>
        <div id="ngnl-news-mini">${UI.skeletonRows(4)}</div>
        <div class="ngnl-feed-foot">
          ${full ? '' : `<a class="btn ghost sm" href="#/ngnl">Otwórz centrum NGNL ${ICON.chevron}</a>`}
        </div>
      </div>
    </div>
  </section>`;
}

async function loadNgnlModule(ctx, host, { full = false, onSeries, onNews, onPartial, onTranslated } = {}) {
  let s;
  try {
    s = await NGNL.series();
  } catch (err) {
    if (!ctx.alive()) return null;
    host.innerHTML = ngnlHeroHtml(null, { full, error: err });
    $('#ngnl-news-mini', host).innerHTML = UI.errorBox(err);
    return null;
  }
  if (!ctx.alive()) return null;
  host.innerHTML = ngnlHeroHtml(s, { full });
  Wait.render();
  if (onSeries) onSeries(s);
  ctx.onLibrary(() => {
    const mine = $('.mine', host);
    if (mine) mine.outerHTML = ngnlMineHtml(s.main);
  });
  const mini = $('#ngnl-news-mini', host);
  const renderMini = (items, res) => {
    if (!ctx.alive()) return;
    const n = items.filter(NGNL.isNew).length;
    const badge = $('#ngnl-newcount', host);
    if (badge) { badge.hidden = !n; badge.textContent = n === 1 ? '1 nowa' : `${n} ${plural(n, 'nowa', 'nowe', 'nowych')}`; }
    mini.innerHTML = items.length
      ? `<div class="news-mini">${items.slice(0, full ? 5 : 4).map((it) => UI.newsItem(it, { compact: true })).join('')}</div>`
      : (res && res.retry
        ? UI.empty('Źródła wiadomości chwilowo nie odpowiadają', `Ponowię automatycznie o ${esc(fmtTime(res.retryAt))}.`)
        : UI.empty('Brak wiadomości', 'Źródła nie zwróciły jeszcze żadnych informacji o serii.'));
  };
  // gdy część źródeł zawiedzie (np. MyAnimeList z błędem 504), ponawiamy po 3 minutach
  let retryTimer = null;
  const load = (force = false) => NGNL.news(s, { onPartial: (items) => { Tr.applyKnown(items); renderMini(items); if (onPartial && ctx.alive()) onPartial(items); }, force }).then((res) => {
    if (!ctx.alive()) return;
    res.reload = () => load(true);
    if (res.retry) {
      res.retryAt = Date.now() + 3 * 60e3;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { if (ctx.alive()) load(); }, 3 * 60e3);
    }
    Tr.applyKnown(res.items);
    NGNL.markDiscovered(res.items);
    renderMini(res.items, res);
    if (onNews) onNews(res.items, res.sources, s, res);
    // japońskie nagłówki tłumaczą się w tle i podmieniają na bieżąco
    Tr.items(res.items, { onUpdate: () => { if (!ctx.alive()) return; renderMini(res.items, res); if (onTranslated) onTranslated(res.items); } });
  }).catch((err) => { if (ctx.alive()) mini.innerHTML = UI.errorBox(err); });
  load();
  return s;
}

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

/* ==========================================================================
   WYSZUKIWARKA
   ========================================================================== */
Pages.search = (ctx) => {
  ctx.title('Szukaj anime');
  const p = ctx.query;
  // „typed=1”: przyszliśmy tu, bo zacząłeś pisać na innej stronie — bierzemy wpisane znaki
  const typed = p.get('typed') === '1';
  const st = { q: typed ? TypeSearch.take() : (p.get('q') || ''), format: p.get('format') || '', status: p.get('status') || '', year: p.get('year') || '', genre: p.get('genre') || '', sort: p.get('sort') || '' };
  const FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'];
  const STATUSES = ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED', 'HIATUS', 'CANCELLED'];
  const SORTS = [['', 'Trafność'], ['POPULARITY_DESC', 'Popularność'], ['SCORE_DESC', 'Ocena AniList'], ['TRENDING_DESC', 'Na czasie'], ['START_DATE_DESC', 'Najnowsze']];

  ctx.el.innerHTML = `<div class="page">
    <form class="searchbar" id="s-form" role="search">
      <label class="field big grow">${ICON.search}<span class="sr">Tytuł anime</span>
        <input id="s-q" type="search" value="${esc(st.q)}" placeholder="Tytuł po angielsku, japońsku lub w romaji…" autocomplete="off" enterkeyhint="search"></label>
    </form>
    <div class="filters">
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

  let run = 0, page = 1, items = [];
  const out = $('#s-out');
  const hasFilters = () => st.format || st.status || st.year || st.genre;

  async function search(more = false) {
    if (!ctx.alive()) return;
    const my = ++run;
    if (!more) { page = 1; items = []; out.innerHTML = UI.skeletonCards(12); } else page++;
    const browsing = !st.q && !hasFilters();
    const params = { ...st, page, sort: st.sort || (st.q ? 'SEARCH_MATCH' : browsing ? 'TRENDING_DESC' : 'POPULARITY_DESC') };
    const qs = new URLSearchParams(Object.entries(st).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/szukaj${qs ? '?' + qs : ''}`);
    try {
      const r = await Ani.search(params);
      if (my !== run || !ctx.alive()) return;
      items.push(...r.items);
      const head = browsing ? '<h2 class="sub-h">Na czasie w AniList</h2>' : `<p class="list-sum">${r.pageInfo.total ? `Znaleziono ${NF.format(r.pageInfo.total)} ${plural(r.pageInfo.total, 'wynik', 'wyniki', 'wyników')}` : ''}</p>`;
      out.innerHTML = items.length
        ? `${UI.staleNote(r)}${head}<div class="grid-cards">${items.map((m) => UI.animeCard(m)).join('')}</div>
           ${r.pageInfo.hasNextPage ? '<div class="more-row"><button class="btn ghost" type="button" id="s-more">Pokaż więcej</button></div>' : ''}`
        : UI.empty('Nic nie znaleziono', 'Spróbuj innej pisowni, tytułu japońskiego albo usuń część filtrów.');
      const mb = $('#s-more');
      if (mb) mb.addEventListener('click', () => { mb.disabled = true; mb.textContent = 'Wczytuję…'; search(true); });
    } catch (err) {
      if (my !== run || !ctx.alive()) return;
      if (more) { toast(err.message, { kind: 'error' }); const mb = $('#s-more'); if (mb) { mb.disabled = false; mb.textContent = 'Pokaż więcej'; } return; }
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

  const debounced = debounce(() => search(), 450);
  $('#s-q').addEventListener('input', (ev) => { st.q = ev.target.value.trim(); if (st.q.length === 1) return; debounced(); });
  $('#s-form').addEventListener('submit', (ev) => { ev.preventDefault(); st.q = $('#s-q').value.trim(); search(); $('#s-q').blur(); });
  [['s-format', 'format'], ['s-status', 'status'], ['s-genre', 'genre'], ['s-sort', 'sort']].forEach(([id, k]) => {
    $('#' + id).addEventListener('change', (ev) => { st[k] = ev.target.value; search(); });
  });
  $('#s-year').addEventListener('input', debounce((ev) => { const v = ev.target.value; st.year = /^\d{4}$/.test(v) ? v : ''; search(); }, 600));
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

function groupHistory(evs) {
  const out = [];
  const eps = [];
  const flush = () => { if (eps.length) { out.push(...groupEpisodeEvents(eps)); eps.length = 0; } };
  for (const h of evs) {
    if (h.k === 'ep') eps.push(h);
    else { flush(); out.push(h); }
  }
  flush();
  return out.sort((a, b) => b.t - a.t);
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

/* ==========================================================================
   CENTRUM NO GAME NO LIFE
   ========================================================================== */
Pages.ngnl = (ctx) => {
  ctx.title('No Game No Life');
  ctx.el.innerHTML = `<div class="page ngnl-page">
    <div id="n-hero">${ngnlHeroHtml(null, { full: true })}</div>
    <div id="n-franchise"></div>
    <div id="n-news">${UI.section('Aktualności', UI.skeletonRows(6))}</div>
    <div id="n-merch"></div>
    <div id="n-videos"></div>
    <div id="n-pics"></div>
    <div id="n-timeline"></div>
    <div id="n-sources"></div>
  </div>`;
  NgnlTimeline.render($('#n-timeline'));
  let cat = 'all';
  let allItems = [];
  let lastRes = null;
  let trState = null;
  Tr.availability().then((st) => { trState = st; if (ctx.alive() && allItems.length) renderNews(); });
  ctx.on('translator', (d) => { trState = d.state; if (allItems.length) renderNews(); });
  const trBar = () => {
    const jp = allItems.filter((it) => Tr.isJa(it.title)).length;
    if (!jp) return '';
    if (!S.settings.translate) return `<p class="tr-bar">${nUnit(jp, 'item')} po japońsku. Tłumaczenie jest wyłączone w Ustawieniach.</p>`;
    const done = allItems.filter((it) => it.tr).length;
    const engine = trState === 'ready' || trState === 'available' ? 'tłumacz Chrome (lokalnie)' : 'MyMemory';
    return `<p class="tr-bar"><span class="tr-chip">JP → EN</span> Przetłumaczono ${done} z ${jp} japońskich wiadomości · ${esc(engine)}
      ${trState === 'downloadable' ? `<button class="btn ghost sm" type="button" id="tr-enable">Włącz tłumacza Chrome: szybciej i bez limitu</button>` : ''}
      ${trState === 'downloading' ? '<span class="muted" id="tr-dl">pobieram model…</span>' : ''}</p>`;
  };
  const renderNews = () => {
    const cats = ['all', ...Object.keys(NGNL.CAT_LABEL).filter((c) => allItems.some((it) => it.cat === c))];
    const list = allItems.filter((it) => cat === 'all' || it.cat === cat);
    const nNew = allItems.filter(NGNL.isNew).length;
    $('#n-news').innerHTML = UI.section('Aktualności', `
      <div class="news-tools">
        <div class="chips" role="group" aria-label="Kategoria">${cats.map((c) => `<button type="button" class="chip-btn${c === cat ? ' on' : ''}" data-cat="${c}">${c === 'all' ? 'Wszystko' : esc(NGNL.CAT_LABEL[c])} <span>${c === 'all' ? allItems.length : allItems.filter((it) => it.cat === c).length}</span></button>`).join('')}</div>
        ${nNew ? `<button class="btn ghost sm" type="button" id="n-readall">${ICON.check}Oznacz ${nNew} jako przeczytane</button>` : ''}
      </div>
      ${trBar()}
      ${list.length ? `<div class="news-list">${list.slice(0, 60).map((it) => UI.newsItem(it)).join('')}</div>`
        : !allItems.length && lastRes && lastRes.retry
          ? UI.empty('Źródła wiadomości chwilowo nie odpowiadają', `Szczegóły są w sekcji „Źródła danych” na dole. Ponowię automatycznie o ${esc(fmtTime(lastRes.retryAt))}.`)
          : UI.empty(allItems.length ? 'Brak wiadomości w tej kategorii' : 'Brak wiadomości w źródłach')}
      <p class="src-note">Kategorie przypisuje automat na podstawie słów kluczowych. Streszczenia są skrócone. Pełną treść przeczytasz u źródła.</p>`,
    { sub: 'Najnowsze na górze · automatycznie z Google News, MyAnimeList i kanałów RSS' });
    $$('[data-cat]', $('#n-news')).forEach((b) => b.addEventListener('click', () => { cat = b.dataset.cat; renderNews(); }));
    const ra = $('#n-readall');
    if (ra) ra.addEventListener('click', () => { NGNL.markAllOpened(allItems); renderNews(); });
    const te = $('#tr-enable');
    if (te) te.addEventListener('click', async () => {
      te.disabled = true;
      te.textContent = 'Pobieram model tłumacza…';
      try {
        await Tr.enableChrome((p) => { const d = $('#tr-enable'); if (d) d.textContent = `Pobieram model tłumacza… ${Math.round(p * 100)}%`; });
        allItems.forEach((it) => { if (it.tr && it.tr.engine !== 'chrome') delete it.tr; });
        toast('Tłumacz Chrome gotowy. Kolejne wiadomości tłumaczą się lokalnie.', { kind: 'ok' });
        Tr.items(allItems, { onUpdate: () => { if (ctx.alive()) { renderNews(); renderMerch(); } } });
      } catch (err) { toast(err.message, { kind: 'warn', ms: 6000 }); }
      if (ctx.alive()) renderNews();
    });
  };
  const renderMerch = () => {
    const items = allItems.filter((it) => it.cat === 'merch' || it.cat === 'video');
    $('#n-merch').innerHTML = UI.section('Merch, figurki i wydania Blu-ray', `
      ${items.length ? `<div class="merch">${items.slice(0, 24).map((it) => `
        <a class="merch-card" href="${esc(it.url)}" target="_blank" rel="noopener" data-news="${esc(it.id)}">
          <div class="merch-img">${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}${NGNL.isNew(it) ? '<span class="badge-new">NOWE</span>' : ''}</div>
          <b${S.settings.translate && it.tr && it.tr.title ? ' lang="en"' : ''}>${esc(S.settings.translate && it.tr && it.tr.title ? it.tr.title : it.title)}</b>
          <dl><div><dt>Data</dt><dd>${it.date ? esc(fmtDateShort(it.date)) : 'brak danych'}</dd></div><div><dt>Cena</dt><dd>${it.price ? esc(it.price) : 'brak w źródle'}</dd></div><div><dt>Źródło</dt><dd>${esc(it.source)}</dd></div></dl>
        </a>`).join('')}</div>`
      : UI.empty('Brak ogłoszeń o merchu w źródłach', 'Pojawią się tu wiadomości o figurkach, gadżetach i wydaniach, gdy tylko trafią do Google News, MyAnimeList lub feedu RSS.')}
      <div class="shops"><span class="lbl">Wyszukaj w sklepach:</span>${NGNL.SHOP_SEARCH.map((s) => `<a class="chip link" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} <small>${esc(s.note)}</small>${ICON.ext}</a>`).join('')}</div>
      <p class="src-note">Żaden sklep nie udostępnia publicznego API z produktami, więc aplikacja pokazuje tylko ogłoszenia z newsów i RSS. Nie zgaduje produktów ani cen.</p>`,
    { sub: 'Produkty i wydania wykryte w wiadomościach' });
  };
  const renderSources = (sources, res) => {
    const net = Net.state;
    $('#n-sources').innerHTML = UI.section('Źródła danych', `<ul class="sources">
      <li class="${net.anilist.ok === false ? 'bad' : 'ok'}"><b>AniList</b><span>seria, relacje, zapowiedzi kontynuacji</span></li>
      ${sources.map((s) => `<li class="${s.ok ? 'ok' : s.optional ? 'opt' : 'bad'}"><b>${esc(s.name)}</b><span>${esc(s.note || (s.ok ? 'działa' : 'niedostępne'))}</span></li>`).join('')}
    </ul>
    ${res && res.retry ? `<div class="retry-row"><span>Część źródeł nie odpowiedziała. Ponowię automatycznie o ${esc(fmtTime(res.retryAt))}.</span><button class="btn ghost sm" type="button" id="n-retry">${ICON.refresh}Ponów teraz</button></div>` : ''}`, { sub: 'Stan przy ostatnim pobraniu' });
    const rb = $('#n-retry');
    if (rb) rb.addEventListener('click', () => { rb.disabled = true; rb.textContent = 'Ponawiam…'; res.reload(); });
  };
  const renderFranchise = (s) => {
    const rel = s.related.slice().sort((a, b) => (fuzzyTs(a.startDate) || 0) - (fuzzyTs(b.startDate) || 0));
    const extra = (s.franchise || []).filter((m) => m.id !== s.main.id && !rel.some((r) => r.id === m.id));
    $('#n-franchise').innerHTML = UI.section('Franczyza', `<div class="rels">${rel.map((n) => {
      const href = n.type === 'ANIME' ? `#/anime/${n.id}` : (n.siteUrl || `https://anilist.co/manga/${n.id}`);
      const ext = n.type !== 'ANIME';
      return `<a class="rel" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${UI.cover(n, 'xs')}<span class="rel-t"><small>${esc(RELATION_PL[n.rel] || n.rel)} · ${esc(FORMAT_PL[n.format] || n.format || '')}</small><b>${esc(titleOf(n))}</b><small>${esc([n.startDate && n.startDate.year, MSTATUS_PL[n.status]].filter(Boolean).join(' · '))}</small></span>${ext ? ICON.ext : ''}</a>`;
    }).join('')}${extra.map((n) => `<a class="rel" href="#/anime/${n.id}">${UI.cover(n, 'xs')}<span class="rel-t"><small>Inne w bazie · ${esc(FORMAT_PL[n.format] || n.format || '')}</small><b>${esc(titleOf(n))}</b><small>${esc([n.startDate && n.startDate.year, MSTATUS_PL[n.status]].filter(Boolean).join(' · '))}</small></span></a>`).join('')}</div>
    ${(s.main.externalLinks || []).length ? `<div class="shops"><span class="lbl">Oficjalne i powiązane strony:</span>${s.main.externalLinks.map((l) => `<a class="chip link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.site)}${l.language ? ` <small>${esc(l.language)}</small>` : ''}${ICON.ext}</a>`).join('')}</div>` : ''}`,
    { sub: 'Anime, film, light novel i manga z relacji AniList' });
  };
  const renderVideos = (vids) => {
    $('#n-videos').innerHTML = UI.section('Zwiastuny i materiały promocyjne', vids.length ? `<div class="videos">${vids.slice(0, 16).map((v) => `
      <a class="video" href="${esc(v.url)}" target="_blank" rel="noopener"><div class="video-img">${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="video-play">${ICON.play}</span></div><b>${esc(v.title)}</b><small>${esc(v.anime)}</small></a>`).join('')}</div>`
      : UI.empty('Brak materiałów wideo w źródłach'), { sub: 'Z AniList i MyAnimeList · otwierają się w YouTube' });
  };
  const renderPics = (pics) => {
    $('#n-pics').innerHTML = UI.section('Grafiki', pics.length ? `<div class="pics">${pics.slice(0, 40).map((p, i) => `<button type="button" class="pic" data-pic="${i}" aria-label="Powiększ grafikę: ${esc(p.label)}"><img src="${esc(p.src)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></button>`).join('')}</div>`
      : UI.empty('Brak grafik w źródłach'), { sub: 'Okładki, banery i grafiki promocyjne z AniList i MyAnimeList' });
    $$('[data-pic]', $('#n-pics')).forEach((b) => b.addEventListener('click', () => Lightbox.open(pics, Number(b.dataset.pic))));
  };

  loadNgnlModule(ctx, $('#n-hero'), {
    full: true,
    onSeries: (s) => {
      renderFranchise(s);
      NgnlTimeline.render($('#n-timeline'), { series: s });
      $('#n-videos').innerHTML = UI.section('Zwiastuny i materiały promocyjne', UI.skeletonCards(4));
      NGNL.videos(s).then((v) => { if (ctx.alive()) renderVideos(v); });
      NGNL.pictures(s).then((p) => { if (ctx.alive()) renderPics(p); });
    },
    // wiadomości pokazujemy od razu, gdy przychodzą z kolejnych źródeł
    onPartial: (items) => { allItems = items; renderNews(); renderMerch(); },
    onTranslated: () => { renderNews(); renderMerch(); },
    onNews: (items, sources, s, res) => {
      allItems = items;
      lastRes = res;
      renderNews();
      renderMerch();
      renderSources(sources, res);
    },
  }).then((s) => { if (!s && ctx.alive()) $('#n-news').innerHTML = UI.section('Aktualności', UI.errorBox(new Error('Nie udało się pobrać danych serii z AniList.'))); });
  ctx.on('ngnl-read', () => { if (allItems.length) { renderNews(); renderMerch(); } });
};

/* ==========================================================================
   STATYSTYKI
   ========================================================================== */
function statsTabs(tab) {
  const T = [['podsumowanie', 'summary', 'Podsumowanie'], ['nerd', 'nerd', 'Dla nerda']];
  return `<nav class="tabs" aria-label="Widok statystyk">${T.map(([slug, k, l]) => `<a class="tab${k === tab ? ' on' : ''}" href="#/statystyki/${slug}"${k === tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
}

Pages.stats = (ctx) => {
  // zakładka z adresu, a bez niej ostatnio oglądana
  const p = ctx.params.tab;
  const tab = p === 'nerd' ? 'nerd' : p === 'podsumowanie' ? 'summary' : (S.settings.statsTab === 'nerd' ? 'nerd' : 'summary');
  if (S.settings.statsTab !== tab) { S.settings.statsTab = tab; save(); }
  if (tab === 'nerd') { Nerd.page(ctx, statsTabs('nerd')); return; }
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

/* ==========================================================================
   USTAWIENIA, KOPIE, IMPORT
   ========================================================================== */
Pages.settings = (ctx) => {
  ctx.title('Ustawienia i kopie');

  /* ---------- przeniesienie obejrzeń do przeszłości ---------- */
  const earliest = () => {
    let t = Infinity;
    for (const h of S.history) if ((h.k === 'ep' && !h.past) || ['start', 'finish', 'rewatch'].includes(h.k)) t = Math.min(t, h.t);
    for (const e of Object.values(S.entries)) for (const x of e.sessions) if (!x.past) [x.startedAt, x.finishedAt].forEach((v) => { if (v) t = Math.min(t, v); });
    return Number.isFinite(t) ? t : Date.now();
  };
  const PRESETS = {
    today: () => [startOfDay(Date.now()), Date.now()],
    week: () => [startOfDay(Date.now() - 6 * 86400e3), Date.now()],
    all: () => [startOfDay(earliest()), Date.now()],
  };
  const rs = { from: null, to: null, preset: 'all', off: new Set() };
  const applyPreset = (k) => {
    const [a, b] = PRESETS[k]();
    rs.preset = k;
    rs.from = fromInputDateTime(toInputDateTime(a));
    rs.to = fromInputDateTime(toInputDateTime(b)) + 59999; // cała ostatnia minuta
    rs.off.clear();
  };
  applyPreset('all');

  const resetRows = () => (rs.from != null && rs.to != null && rs.from <= rs.to ? Lib.resetScan(rs.from, rs.to) : null);
  const resetSummary = (rows) => {
    const sel = rows.filter((r) => !rs.off.has(r.id));
    const eps = sel.reduce((a, r) => a + r.eps, 0);
    const mins = sel.reduce((a, r) => a + r.minutes, 0);
    return { sel, html: `Zaznaczone: <b>${sel.length} z ${rows.length}</b> anime · <b>${NF.format(eps)}</b> ${unit(eps, 'episode')} · <b>${esc(mins ? fmtDuration(mins, { short: true }) : '0 min')}</b> trafi do „bez daty”. Łączny czas oglądania się nie zmieni.` };
  };
  const renderLast = () => {
    const host = $('#rs-last');
    if (!host) return;
    const r = S.meta.lastReset;
    host.innerHTML = r ? `<div class="rs-last"><span>Ostatnio przeniesiono ${esc(fmtDateTime(r.t))}: ${nUnit(r.count, 'title')}, ${NF.format(r.eps)} ${unit(r.eps, 'episode')} (zakres ${esc(fmtDateTime(r.from))} – ${esc(fmtDateTime(r.to))}).</span><button class="btn ghost sm" type="button" id="rs-undo">${ICON.repeat}Cofnij</button></div>` : '';
    const u = $('#rs-undo');
    if (u) u.addEventListener('click', () => { if (Lib.undoReset()) { toast('Cofnięto przeniesienie. Daty wróciły na swoje miejsce.', { kind: 'ok' }); renderReset(); renderLast(); } });
  };
  const renderReset = () => {
    const host = $('#rs-host');
    if (!host) return;
    $$('[data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === rs.preset));
    const rows = resetRows();
    if (!rows) { host.innerHTML = '<p class="rs-warn">Początek zakresu musi być wcześniejszy niż jego koniec.</p>'; return; }
    if (!rows.length) {
      host.innerHTML = UI.empty('Brak obejrzeń z datą w tym zakresie', 'Zmień daty albo wybierz „Od początku”. Obejrzenia, którym sam wpisałeś datę, nie są tu brane pod uwagę.');
      return;
    }
    const sum = resetSummary(rows);
    host.innerHTML = `
      <p class="rs-sum" id="rs-sum">${sum.html}</p>
      <div class="rs-tools">
        <button class="btn ghost sm" type="button" id="rs-all">Zaznacz wszystkie</button>
        <button class="btn ghost sm" type="button" id="rs-none">Odznacz wszystkie</button>
        <span class="muted">Odznacz to, co naprawdę oglądałeś w tym czasie.</span>
      </div>
      <div class="table-wrap rs-table"><table>
        <thead><tr><th scope="col"><span class="sr">Zaznacz</span></th><th scope="col">Anime</th><th scope="col" class="num">Odcinki</th><th scope="col" class="num rs-opt">Czas</th><th scope="col" class="rs-opt">Ostatni wpis</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${rs.off.has(r.id) ? 'off' : ''}">
          <td><input type="checkbox" id="rs-c-${r.id}" data-rs="${r.id}" ${rs.off.has(r.id) ? '' : 'checked'}></td>
          <th scope="row"><label for="rs-c-${r.id}" class="rs-anime">${UI.cover(r.e.media, 'xs')}<span>${esc(titleOf(r.e.media))}${r.sessions > 1 ? `<small>${r.sessions} obejrzenia</small>` : ''}</span></label></th>
          <td class="num">${r.eps ? (r.epMin === r.epMax ? `odc. ${r.epMin}` : `${r.eps} <small>(odc. ${r.epMin}–${r.epMax})</small>`) : '<small>tylko daty</small>'}</td>
          <td class="num rs-opt">${r.minutes ? esc(fmtDuration(r.minutes, { short: true })) : '—'}</td>
          <td class="num rs-opt">${esc(fmtDateTime(r.last))}</td>
        </tr>`).join('')}</tbody></table></div>
      <div class="btn-row"><button class="btn" type="button" id="rs-go" ${sum.sel.length ? '' : 'disabled'}>${ICON.history}Przenieś do przeszłości: ${nUnit(sum.sel.length, 'title')}</button></div>`;
    const refreshSum = () => {
      const s2 = resetSummary(rows);
      $('#rs-sum').innerHTML = s2.html;
      const go = $('#rs-go');
      go.disabled = !s2.sel.length;
      go.innerHTML = `${ICON.history}Przenieś do przeszłości: ${nUnit(s2.sel.length, 'title')}`;
    };
    host.querySelector('tbody').addEventListener('change', (ev) => {
      const c = ev.target.closest('[data-rs]');
      if (!c) return;
      const id = Number(c.dataset.rs);
      if (c.checked) rs.off.delete(id); else rs.off.add(id);
      c.closest('tr').classList.toggle('off', !c.checked);
      refreshSum();
    });
    $('#rs-all').addEventListener('click', () => { rs.off.clear(); renderReset(); });
    $('#rs-none').addEventListener('click', () => { rows.forEach((r) => rs.off.add(r.id)); renderReset(); });
    $('#rs-go').addEventListener('click', () => {
      const ids = rows.filter((r) => !rs.off.has(r.id)).map((r) => r.id);
      const res = Lib.resetToPast(rs.from, rs.to, ids);
      if (!res) return;
      toast(`Przeniesiono do przeszłości: ${nUnit(res.count, 'title')}, ${NF.format(res.eps)} ${unit(res.eps, 'episode')}.`, {
        kind: 'ok', action: { label: 'Cofnij', fn: () => { Lib.undoReset(); toast('Cofnięto przeniesienie.', { kind: 'ok' }); renderReset(); renderLast(); } },
      });
      rs.off.clear();
      renderReset();
      renderLast();
    });
  };

  const render = async () => {
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
    const backups = await listBackups();
    if (!ctx.alive()) return;
    const w = S.settings.wait;
    const kinds = [['episode', 'Nowy odcinek oglądanego anime'], ['premiere', 'Premiera lub zmiana daty planowanego anime'], ['sequel', 'Kontynuacja obejrzanego anime (radar)'], ['news', 'Nowa informacja o No Game No Life'], ['merch', 'Nowy merch No Game No Life'], ['change', 'Inne zmiany (koniec emisji, liczba odcinków)']];
    ctx.el.innerHTML = `<div class="page settings">
      ${FX.settingsHtml()}

      <section class="card bf-card">
        <h2 class="card-h">Tryb uzupełniania listy</h2>
        <p class="card-sub">Włącz, gdy dodajesz anime obejrzane dawniej. Odcinki, ukończenia i rewatche zapiszą się wtedy bez daty, więc nie zaśmiecą statystyk z dzisiejszego dnia. Przycisk „+” na okładkach doda tytuł od razu jako Obejrzane.</p>
        <div class="bf-row">
          <label class="switch"><input type="checkbox" id="bf-toggle" ${S.settings.backfill ? 'checked' : ''}><span>Tryb uzupełniania</span></label>
          <span class="muted">Skrót na każdej stronie: <kbd>Alt+U</kbd></span>
        </div>
      </section>

      <section class="card bf-card sf-card">
        <h2 class="card-h">Pomijanie fillerów</h2>
        <p class="card-sub">Plusik przy odcinkach przeskakuje odcinki oznaczone w MyAnimeList jako filler albo recap. Pominięte nie liczą się do czasu oglądania. Fillery obejrzane wcześniej zostają policzone. Dane o fillerach pobierają się same dla oglądanych serii.</p>
        <div class="bf-row">
          <label class="switch"><input type="checkbox" id="sf-toggle" ${S.settings.skipFiller ? 'checked' : ''}><span>Pomijaj fillery</span></label>
          <span class="muted">Skrót na każdej stronie: <kbd>Alt+P</kbd></span>
        </div>
      </section>

      <section class="card" id="rs-card">
        <h2 class="card-h">Przenieś obejrzenia do przeszłości</h2>
        <p class="card-sub">Dla anime dodanych jako obejrzane, zanim był tryb uzupełniania. Odcinki z wybranego okresu tracą datę: znikają z wykresów miesięcznych i z „ostatnio obejrzanych”, ale nadal liczą się do łącznego czasu, liczby odcinków i rewatchy. Statusy, postęp, oceny i notatki zostają bez zmian.</p>
        <div class="rs-range">
          <label class="field"><span class="lbl">Od</span><input type="datetime-local" id="rs-from" value="${toInputDateTime(rs.from)}"></label>
          <label class="field"><span class="lbl">Do</span><input type="datetime-local" id="rs-to" value="${toInputDateTime(rs.to)}"></label>
          <div class="chips rs-presets" role="group" aria-label="Szybki wybór zakresu">
            <button type="button" class="chip-btn" data-preset="today">Dziś</button>
            <button type="button" class="chip-btn" data-preset="week">Ostatnie 7 dni</button>
            <button type="button" class="chip-btn" data-preset="all">Od początku</button>
          </div>
        </div>
        <div id="rs-host"></div>
        <div id="rs-last"></div>
      </section>

      <section class="card">
        <h2 class="card-h">Kopia zapasowa i przenoszenie</h2>
        <p class="card-sub">Lista zapisuje się w tej przeglądarce. Eksport to Twoja polisa: plik JSON odtworzy wszystko, także historię i rewatche.
          ${S.meta.lastExportAt ? `Ostatni eksport: ${esc(fmtDateTime(S.meta.lastExportAt))}.` : '<b>Nie zrobiłeś jeszcze eksportu.</b>'}</p>
        <div class="btn-row">
          <button class="btn" type="button" id="x-json">${ICON.download}Pełna kopia (JSON)</button>
          <button class="btn ghost" type="button" id="x-csv">${ICON.download}Lista do Excela (CSV)</button>
          <button class="btn ghost" type="button" id="x-mal">${ICON.download}Format MyAnimeList (XML)</button>
        </div>
        <h3 class="sub-h">Import</h3>
        <div class="import-grid">
          <label class="drop"><input type="file" id="i-json" accept=".json,application/json"><b>Kopia Disboard (JSON)</b><span>przywrócenie lub scalenie</span></label>
          <label class="drop"><input type="file" id="i-mal" accept=".xml,text/xml,application/xml"><b>Eksport z MyAnimeList (XML)</b><span>myanimelist.net → Export</span></label>
          <label class="drop"><input type="file" id="i-csv" accept=".csv,text/csv"><b>Plik CSV</b><span>kolumny „AniList ID” lub „MAL ID”</span></label>
        </div>
        <div class="field-row"><span class="lbl">Import JSON:</span>
          <label class="radio"><input type="radio" name="i-mode" value="merge" checked> dodaj brakujące pozycje</label>
          <label class="radio"><input type="radio" name="i-mode" value="replace"> zastąp całą bibliotekę</label></div>
        <div id="i-status" class="import-status" role="status"></div>
        <h3 class="sub-h">Automatyczne kopie w przeglądarce</h3>
        <p class="card-sub">Raz na godzinę, do 7 dni wstecz. Chronią przed pomyłką, nie przed wyczyszczeniem danych przeglądarki.</p>
        ${backups.length ? `<ul class="backups">${backups.map((b) => `<li><span>${esc(fmtDateTime(b.t))}${b.label ? ` · ${esc(b.label)}` : ""}</span><span>${nUnit(b.count, 'title')}</span><button class="btn ghost sm" type="button" data-restore="${esc(b.key)}">Przywróć</button></li>`).join('')}</ul>` : '<p class="muted">Jeszcze brak kopii.</p>'}
        <div id="restore-confirm" hidden class="confirm">Przywrócić kopię z <b id="rc-date"></b>? Obecna lista zostanie zastąpiona. <button class="btn danger sm" type="button" id="rc-yes">Przywróć</button> <button class="btn ghost sm" type="button" id="rc-no">Anuluj</button></div>
        <p class="card-sub">Trwała pamięć przeglądarki: <b>${persisted ? 'włączona' : 'niepotwierdzona'}</b>${persisted ? '' : ' <button class="btn ghost sm" type="button" id="persist">Poproś o trwałą pamięć</button>'}</p>
      </section>

      <section class="card">
        <h2 class="card-h">Powiadomienia</h2>
        <p class="card-sub">Zawsze trafiają na dzwonek w aplikacji. Powiadomienia systemowe działają, gdy aplikacja jest otwarta, także w tle na karcie.</p>
        <label class="switch"><input type="checkbox" id="n-sys" ${S.settings.sysNotify && perm === 'granted' ? 'checked' : ''} ${perm === 'unsupported' || perm === 'denied' ? 'disabled' : ''}><span>Powiadomienia systemowe ${perm === 'denied' ? '(zablokowane w przeglądarce)' : perm === 'unsupported' ? '(niedostępne w tej przeglądarce)' : ''}</span></label>
        <fieldset class="checks"><legend class="lbl">Rodzaje</legend>${kinds.map(([k, l]) => `<label class="check"><input type="checkbox" data-kind="${k}" ${S.settings.notifyKinds[k] !== false ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset>
        <button class="btn ghost sm" type="button" id="n-test">Wyślij powiadomienie testowe</button>
      </section>

      <section class="card">
        <h2 class="card-h">Licznik „Jak długo czekam na drugi sezon No Game No Life”</h2>
        <fieldset class="checks">
          <label class="radio"><input type="radio" name="w-mode" value="s1end" ${w.mode !== 'custom' ? 'checked' : ''}> od emisji ostatniego odcinka 1. sezonu (z AniList)</label>
          <label class="radio"><input type="radio" name="w-mode" value="custom" ${w.mode === 'custom' ? 'checked' : ''}> od mojej daty:</label>
          <input type="datetime-local" id="w-custom" value="${w.custom ? new Date(w.custom - new Date(w.custom).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}" aria-label="Data początku czekania">
        </fieldset>
        <label class="switch"><input type="checkbox" id="w-show" ${w.hidden ? '' : 'checked'}><span>Pokazuj licznik w rogu ekranu</span></label>
      </section>

      <section class="card">
        <h2 class="card-h">Wyświetlanie</h2>
        <label class="field"><span class="lbl">Język tytułów</span><select id="s-lang">
          <option value="english" ${S.settings.titleLang === 'english' ? 'selected' : ''}>Angielski (gdy brak: romaji)</option>
          <option value="romaji" ${S.settings.titleLang === 'romaji' ? 'selected' : ''}>Romaji, jak na Shinden i MAL</option>
          <option value="native" ${S.settings.titleLang === 'native' ? 'selected' : ''}>Japoński</option></select></label>
        <label class="switch"><input type="checkbox" id="s-spoil" ${S.settings.hideSpoilers ? 'checked' : ''}><span>Ukrywaj tagi ze spoilerami</span></label>
        <label class="switch"><input type="checkbox" id="s-adult" ${S.settings.adult ? 'checked' : ''}><span>Pokazuj anime 18+ w wyszukiwarce</span></label>
        <p class="src-note">Premiery, harmonogram, zapowiedzi i powiadomienia zawsze pomijają pozycje 18+. Te z Twojej listy liczą się normalnie w statystykach.</p>
        <label class="switch"><input type="checkbox" id="s-tr" ${S.settings.translate ? 'checked' : ''}><span>Tłumacz japońskie wiadomości NGNL na angielski</span></label>
        <div class="tr-status" id="s-tr-status"></div>
      </section>

      <section class="card">
        <h2 class="card-h">Dane z internetu</h2>
        <p class="card-sub">Ostatnie odświeżenie listy: ${S.meta.lastRefresh ? esc(fmtDateTime(S.meta.lastRefresh)) : 'jeszcze nie'}. Emitowane tytuły odświeżają się co 45 min, reszta raz w tygodniu.</p>
        <div class="btn-row">
          <button class="btn ghost" type="button" id="d-refresh">${ICON.refresh}Odśwież całą listę teraz</button>
          <button class="btn ghost" type="button" id="d-clear">Wyczyść pamięć podręczną API</button>
        </div>
        <label class="field"><span class="lbl">Adres feedu RSS z newsami NGNL (JSON)</span><input type="text" id="d-feed" value="${esc(S.settings.feedUrl)}" placeholder="data/ngnl-feed.json"></label>
        <p class="src-note">Feed buduje darmowy workflow GitHub Actions z tego projektu. Instrukcja jest w README.</p>
      </section>

      <section class="card" id="diag">
        <h2 class="card-h">Test połączenia</h2>
        <p class="card-sub">Sprawdza po kolei każde zapytanie do AniList i MyAnimeList. Jeśli coś nie działa, skopiuj wynik i wklej go w rozmowie z Claude.</p>
        <div class="btn-row"><button class="btn" type="button" id="diag-run">${ICON.refresh}Uruchom test</button><button class="btn ghost" type="button" id="diag-copy" hidden>Kopiuj wynik</button></div>
        <ul class="diag" id="diag-out"></ul>
        <p class="diag-verdict" id="diag-verdict" role="status"></p>
        <textarea id="diag-raw" class="diag-raw" rows="6" readonly hidden aria-label="Wynik testu do skopiowania"></textarea>
      </section>

      <section class="card about">
        <h2 class="card-h">O aplikacji</h2>
        <p>Dane o anime pochodzą z <a href="https://anilist.co" target="_blank" rel="noopener">AniList</a>. Newsy, promo i producenci pochodzą z <a href="https://myanimelist.net" target="_blank" rel="noopener">MyAnimeList</a> przez <a href="https://jikan.moe" target="_blank" rel="noopener">Jikan</a>. Aplikacja nie ma własnego serwera: Twoja lista nigdzie nie wychodzi poza tę przeglądarkę.</p>
        <p class="muted">Pozycji na liście: ${Object.keys(S.entries).length} · zdarzeń w historii: ${NF.format(S.history.length)} · rozmiar danych: ${NF1.format(JSON.stringify(S).length / 1024)} kB · zapis: ${storageInfo()}</p>
      </section>
    </div>`;
    FX.bindSettings(ctx.el);
    bind();
  };

  const status = (html, kind = '') => { const el = $('#i-status'); if (el) { el.className = `import-status ${kind}`; el.innerHTML = html; } };
  const bind = () => {
    $('#bf-toggle').addEventListener('change', (ev) => Backfill.set(ev.target.checked));
    $('#sf-toggle').addEventListener('change', (ev) => SkipFill.set(ev.target.checked));
    const onRange = () => {
      rs.from = fromInputDateTime($('#rs-from').value);
      const t = fromInputDateTime($('#rs-to').value);
      rs.to = t == null ? null : t + 59999;
      rs.preset = null;
      renderReset();
    };
    $('#rs-from').addEventListener('change', onRange);
    $('#rs-to').addEventListener('change', onRange);
    $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      applyPreset(b.dataset.preset);
      $('#rs-from').value = toInputDateTime(rs.from);
      $('#rs-to').value = toInputDateTime(rs.to);
      renderReset();
    }));
    renderReset();
    renderLast();
    const renderTr = async () => {
      const box = $('#s-tr-status');
      if (!box) return;
      const stt = await Tr.availability();
      if (!ctx.alive() || !$('#s-tr-status')) return;
      const msg = {
        ready: 'Silnik: tłumacz wbudowany w Chrome. Działa lokalnie, bez limitu.',
        available: 'Silnik: tłumacz wbudowany w Chrome. Działa lokalnie, bez limitu.',
        downloadable: 'Silnik: MyMemory (ok. 5000 znaków dziennie). Chrome może tłumaczyć lokalnie i bez limitu po jednorazowym pobraniu modelu.',
        downloading: 'Chrome pobiera model tłumacza…',
        unsupported: 'Silnik: MyMemory (ok. 5000 znaków dziennie). Ta przeglądarka nie ma wbudowanego tłumacza; ma go Chrome 138+ na komputerze.',
        unavailable: 'Silnik: MyMemory (ok. 5000 znaków dziennie). Tłumacz Chrome jest na tym urządzeniu niedostępny.',
      }[stt] || '';
      box.innerHTML = `<p class="src-note">${esc(msg)}</p>${stt === 'downloadable' ? '<button class="btn ghost sm" type="button" id="s-tr-dl">Pobierz tłumacza Chrome</button>' : ''}`;
      const dl = $('#s-tr-dl');
      if (dl) dl.addEventListener('click', async () => {
        dl.disabled = true;
        try {
          await Tr.enableChrome((p) => { dl.textContent = `Pobieram… ${Math.round(p * 100)}%`; });
          toast('Tłumacz Chrome gotowy.', { kind: 'ok' });
        } catch (err) { toast(err.message, { kind: 'warn', ms: 6000 }); }
        renderTr();
      });
    };
    renderTr();
    $('#s-tr').addEventListener('change', (ev) => {
      S.settings.translate = ev.target.checked;
      save();
      toast(ev.target.checked ? 'Japońskie wiadomości będą tłumaczone na angielski.' : 'Tłumaczenie wiadomości wyłączone.', { kind: 'ok' });
    });
    $('#s-adult').addEventListener('change', (ev) => {
      S.settings.adult = ev.target.checked;
      save();
      toast(ev.target.checked ? 'Wyszukiwarka pokazuje teraz także anime 18+.' : 'Wyszukiwarka ukrywa anime 18+.', { kind: 'ok' });
    });
    $('#x-json').addEventListener('click', () => { IO.exportJSON(); toast('Zapisano pełną kopię JSON.', { kind: 'ok' }); render(); });
    $('#x-csv').addEventListener('click', () => { IO.exportCSV(); toast('Zapisano listę CSV.', { kind: 'ok' }); });
    $('#x-mal').addEventListener('click', () => {
      const r = IO.exportMAL();
      toast(`Wyeksportowano ${r.exported} anime do formatu MAL.${r.skipped ? ` ${r.skipped} bez ID w MAL pominięto.` : ''}`, { kind: 'ok', ms: 6000 });
    });
    const handle = (inputId, fn) => $(inputId).addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      status('Wczytuję plik…');
      try {
        const text = await readFileText(f);
        const r = await fn(text, (msg) => status(esc(msg)));
        status(`${r.replaced ? 'Biblioteka zastąpiona kopią.' : `Dodano ${nUnit(r.added, 'item')}.`}${r.skipped ? ` Pominięto ${r.skipped} (już były na liście).` : ''}${r.missing && r.missing.length ? `<br>Nie znaleziono w AniList: ${r.missing.slice(0, 20).map(esc).join(', ')}${r.missing.length > 20 ? '…' : ''}` : ''}`, 'ok');
      } catch (err) {
        status(esc(err.message), 'bad');
      }
      ev.target.value = '';
    });
    handle('#i-json', (t) => IO.importJSON(t, ($('input[name="i-mode"]:checked') || {}).value || 'merge'));
    handle('#i-mal', (t, p) => IO.importMAL(t, p));
    handle('#i-csv', (t, p) => IO.importCSV(t, p));

    let restoreKey = null;
    $$('[data-restore]').forEach((b) => b.addEventListener('click', () => {
      restoreKey = b.dataset.restore;
      $('#rc-date').textContent = b.parentNode.firstElementChild.textContent;
      $('#restore-confirm').hidden = false;
    }));
    $('#rc-no').addEventListener('click', () => { $('#restore-confirm').hidden = true; });
    $('#rc-yes').addEventListener('click', async () => {
      try { await restoreBackup(restoreKey); toast('Przywrócono kopię.', { kind: 'ok' }); render(); } catch (err) { toast(err.message, { kind: 'error' }); }
    });
    const ps = $('#persist');
    if (ps) ps.addEventListener('click', async () => { const ok = await requestPersistence(); toast(ok ? 'Przeglądarka zgodziła się na trwałą pamięć.' : 'Przeglądarka nie potwierdziła trwałej pamięci. Regularny eksport JSON nadal chroni dane.', { kind: ok ? 'ok' : 'warn', ms: 6000 }); render(); });

    $('#n-sys').addEventListener('change', async (ev) => {
      if (ev.target.checked) {
        const p = await Notification.requestPermission();
        S.settings.sysNotify = p === 'granted';
        if (p !== 'granted') toast('Przeglądarka nie zezwoliła na powiadomienia.', { kind: 'warn' });
      } else S.settings.sysNotify = false;
      save(); render();
    });
    $$('[data-kind]').forEach((c) => c.addEventListener('change', () => { S.settings.notifyKinds[c.dataset.kind] = c.checked; save(); emit('notifs'); }));
    $('#n-test').addEventListener('click', () => {
      Lib.notify({ kind: 'change', title: 'Powiadomienie testowe', body: 'Tak będą wyglądać informacje o nowych odcinkach i premierach.', link: '#/' });
      toast('Wysłano powiadomienie testowe. Sprawdź dzwonek.', { kind: 'ok' });
    });

    $$('input[name="w-mode"]').forEach((r) => r.addEventListener('change', () => { S.settings.wait.mode = r.value; save(); Wait.render(); }));
    $('#w-custom').addEventListener('change', (ev) => {
      const v = ev.target.value ? new Date(ev.target.value).getTime() : null;
      S.settings.wait.custom = v; if (v) S.settings.wait.mode = 'custom';
      save(); Wait.render(); render();
    });
    $('#w-show').addEventListener('change', (ev) => { S.settings.wait.hidden = !ev.target.checked; save(); Wait.render(); });

    $('#s-lang').addEventListener('change', (ev) => { S.settings.titleLang = ev.target.value; save(); emit('library', { kind: 'lang' }); toast('Zmieniono język tytułów.', { kind: 'ok' }); });
    $('#s-spoil').addEventListener('change', (ev) => { S.settings.hideSpoilers = ev.target.checked; save(); });
    $('#d-refresh').addEventListener('click', async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Odświeżam…';
      try { const r = await Lib.refresh({ force: true }); toast(r.stale ? 'AniList nie odpowiada. Zostają ostatnie dane.' : `Zaktualizowano ${r.updated} pozycji.`, { kind: r.stale ? 'warn' : 'ok' }); } catch (err) { toast(err.message, { kind: 'error' }); }
      render();
    });
    $('#d-clear').addEventListener('click', async () => { await clearApiCache(); toast('Wyczyszczono pamięć podręczną. Twoja lista została nietknięta.', { kind: 'ok' }); });
    $('#d-feed').addEventListener('change', (ev) => { S.settings.feedUrl = ev.target.value.trim(); save(); toast('Zapisano adres feedu.', { kind: 'ok' }); });

    let diagReport = null;
    const drawDiag = (rows) => {
      $('#diag-out').innerHTML = rows.map((r) => `<li class="${r.ok ? 'ok' : 'bad'}"><b>${esc(r.name)}</b><span>${r.ok ? `działa · ${r.ms} ms` : esc(r.msg)}</span></li>`).join('');
    };
    $('#diag-run').addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      $('#diag-verdict').textContent = 'Testuję… (kilkanaście sekund, AniList pozwala na ograniczoną liczbę zapytań)';
      diagReport = await diagnoseApis(drawDiag);
      if (!ctx.alive()) return;
      const r = diagReport.results;
      const ani = r.filter((x) => x.name.startsWith('AniList'));
      const minimal = ani[0];
      let v;
      if (ani.every((x) => x.ok)) v = 'AniList działa w całości. Jeśli wcześniej był błąd, była to chwilowa awaria po ich stronie.';
      else if (ani.every((x) => !x.ok && x.kind === 'network')) v = 'Brak połączenia z AniList. Sprawdź internet, a także blokadę reklam, antywirusa lub zaporę, które mogą blokować graphql.anilist.co.';
      else if (!minimal.ok && minimal.kind === 'server') v = 'Serwer AniList ma teraz awarię i odrzuca nawet najprostsze zapytanie. To problem po ich stronie. Aplikacja pokazuje zapisane dane i sama spróbuje ponownie.';
      else if (!minimal.ok) v = `AniList odpowiada błędem na każde zapytanie (${minimal.msg}). Skopiuj wynik i wyślij go Claude.`;
      else v = 'AniList działa, ale odrzuca część zapytań aplikacji. Skopiuj wynik i wyślij go Claude, żeby poprawić konkretne zapytanie. Do tego czasu aplikacja używa wersji lekkiej, jeśli ta przechodzi.';
      $('#diag-verdict').textContent = v;
      $('#diag-raw').value = JSON.stringify(diagReport, null, 1);
      $('#diag-copy').hidden = false;
      b.disabled = false;
    });
    $('#diag-copy').addEventListener('click', async () => {
      const raw = $('#diag-raw');
      try { await navigator.clipboard.writeText(raw.value); toast('Skopiowano wynik testu.', { kind: 'ok' }); }
      catch { raw.hidden = false; raw.focus(); raw.select(); toast('Zaznaczyłem wynik. Skopiuj go skrótem Ctrl+C.', { kind: 'warn' }); }
    });
  };
  render();
  ctx.on('settings', () => {
    const c = $('#bf-toggle'); if (c) c.checked = !!S.settings.backfill;
    const f = $('#sf-toggle'); if (f) f.checked = !!S.settings.skipFiller;
  });
  // import lub przywrócenie kopii zmienia historię → odśwież podgląd zakresu
  ctx.onLibrary((d) => { if (d && (d.kind === 'import' || d.kind === 'replace')) renderReset(); });
};

/* ---------- lightbox dla grafik ---------- */
const Lightbox = (() => {
  let list = [], i = 0, el = null;
  const draw = () => {
    const p = list[i];
    el.querySelector('img').src = p.full;
    el.querySelector('.lb-cap').textContent = `${p.label} · ${i + 1}/${list.length}`;
  };
  function open(pics, start) {
    list = pics; i = start;
    if (!el) {
      el = document.createElement('div');
      el.className = 'lightbox';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.innerHTML = `<button class="icon-btn lb-x" type="button" aria-label="Zamknij">${ICON.x}</button>
        <button class="icon-btn lb-prev" type="button" aria-label="Poprzednia">${ICON.chevron}</button>
        <img alt=""><button class="icon-btn lb-next" type="button" aria-label="Następna">${ICON.chevron}</button><p class="lb-cap"></p>`;
      document.body.append(el);
      el.addEventListener('click', (ev) => {
        if (ev.target === el || ev.target.closest('.lb-x')) close();
        else if (ev.target.closest('.lb-prev')) { i = (i - 1 + list.length) % list.length; draw(); }
        else if (ev.target.closest('.lb-next')) { i = (i + 1) % list.length; draw(); }
      });
      document.addEventListener('keydown', (ev) => {
        if (el.hidden) return;
        if (ev.key === 'Escape') close();
        if (ev.key === 'ArrowRight') { i = (i + 1) % list.length; draw(); }
        if (ev.key === 'ArrowLeft') { i = (i - 1 + list.length) % list.length; draw(); }
      });
    }
    el.hidden = false;
    draw();
    el.querySelector('.lb-x').focus();
  }
  function close() { if (el) el.hidden = true; }
  return { open, close };
})();
