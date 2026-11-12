'use strict';
/* ==========================================================================
   Disboard — ekrany: wspólne funkcje
   Każdy ekran dostaje ctx: { el, params, query, alive(), title(), onLibrary(), on() }
   Ekrany są w plikach js/pages/*.js i rejestrują się w obiekcie Pages.
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
