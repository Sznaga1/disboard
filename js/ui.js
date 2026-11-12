'use strict';
/* ==========================================================================
   Disboard — komponenty interfejsu (karty, chipy, sekcje, odliczanie)
   ========================================================================== */

const UI = (() => {
  const media = new Map(); // id → obiekt z API (do szybkiego dodawania z kart)
  const remember = (m) => { if (m && m.id) media.set(m.id, m); return m; };

  const safeColor = (c, fb = '#2a2340') => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : fb);
  const initials = (t) => String(t || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  function cover(m, cls = '') {
    const src = m && m.coverImage && (m.coverImage.large || m.coverImage.extraLarge);
    const color = safeColor(m && m.coverImage && m.coverImage.color);
    return `<div class="cover ${cls}" style="--cc:${color}">
      <span class="cover-fb" aria-hidden="true">${esc(initials(titleOf(m)))}</span>
      ${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
    </div>`;
  }

  function statusChip(status, e) {
    const rw = e && Lib.isRewatch(e) && status === 'watching' ? ` · rewatch #${Lib.cur(e).n}` : '';
    return `<span class="chip st st-${status}"><i aria-hidden="true"></i>${esc(LSTATUS_PL[status])}${rw}</span>`;
  }

  function airingChip(m) {
    if (!m || !m.status) return '';
    const cls = m.status === 'RELEASING' ? 'air-on' : m.status === 'NOT_YET_RELEASED' ? 'air-soon' : 'air-off';
    return `<span class="chip ${cls}">${esc(MSTATUS_PL[m.status] || m.status)}</span>`;
  }

  function yearOf(m) {
    return (m && (m.seasonYear || (m.startDate && m.startDate.year))) || null;
  }

  function metaLine(m, { status = true } = {}) {
    const p = [];
    const y = yearOf(m);
    if (y) p.push(y);
    if (m.format) p.push(FORMAT_PL[m.format] || m.format);
    if (m.episodes) p.push(nUnit(m.episodes, 'episode'));
    else if (m.status === 'RELEASING') p.push('odc. ?');
    if (status && m.status) p.push(MSTATUS_PL[m.status] || m.status);
    return p.map(esc).join(' · ');
  }

  function countdown(sec, { short = false } = {}) {
    const at = Math.floor(Date.now() / 1000) + sec;
    return `<span class="cd" data-cd="${at}"${short ? ' data-short="1"' : ''}>${esc(fmtCountdown(sec, { short }))}</span>`;
  }
  function countdownTo(unix, { short = false } = {}) {
    return `<span class="cd" data-cd="${unix}"${short ? ' data-short="1"' : ''}>${esc(fmtCountdown(unix - Date.now() / 1000, { short }))}</span>`;
  }

  function premiereLine(m) {
    if (m.nextAiringEpisode && m.nextAiringEpisode.episode === 1) {
      return `Premiera za ${countdownTo(m.nextAiringEpisode.airingAt, { short: true })}`;
    }
    const d = fuzzyDate(m.startDate);
    if (!d) return 'Data premiery: jeszcze nieustalona';
    return `Premiera: ${esc(d)}`;
  }

  // „+” na okładce: w trybie uzupełniania dodaje od razu jako Obejrzane (bez daty)
  const quickStatus = (base = 'planning') => (S.settings.backfill ? 'completed' : base);
  const quickAddTitle = (base = 'planning') => (S.settings.backfill
    ? 'Dodaj jako Obejrzane, bez daty (tryb uzupełniania)'
    : `Dodaj do listy: ${LSTATUS_PL[base]}`);

  // okładka karty z przyciskiem „+” albo odznaką statusu (obie otwierają menu statusów)
  function cardMedia(m, addStatus = 'planning') {
    const e = Lib.get(m.id);
    return `<a class="acard-cover${e && e.favorite ? ' is-fav' : ''}" href="#/anime/${m.id}" aria-label="${esc(titleOf(m))}">
        ${cover(m)}
        ${m.format || m.isAdult ? `<span class="acard-format">${esc(FORMAT_PL[m.format] || m.format || '')}${m.isAdult ? `${m.format ? ' · ' : ''}<b class="adult">18+</b>` : ''}</span>` : ''}
      </a>
      ${e
    ? `<button class="acard-onlist st-${e.status}" type="button" data-qmenu="${m.id}" title="Zmień status" aria-haspopup="menu">${esc(LSTATUS_PL[e.status])}${e.status === 'watching' || e.status === 'paused' ? ` <span class="num">${Lib.cur(e).progress}/${Lib.epTotal(e) || '?'}</span>` : ''}${ICON.chevron}</button>`
    : `<button class="acard-add" type="button" data-add="${m.id}" data-status="${addStatus}" data-quick="1" title="${esc(quickAddTitle(addStatus))}" aria-label="Dodaj ${esc(titleOf(m))} do listy" aria-haspopup="menu">${ICON.plus}</button>`}`;
  }

  function animeCard(m, { extra = '', addStatus = 'planning' } = {}) {
    remember(m);
    return `<article class="acard" data-id="${m.id}" data-add-status="${addStatus}">
      <div class="acard-media">${cardMedia(m, addStatus)}</div>
      <div class="acard-body">
        <a class="acard-title" href="#/anime/${m.id}">${esc(titleOf(m))}</a>
        <div class="acard-meta">${metaLine(m)}</div>
        ${extra ? `<div class="acard-extra">${extra}</div>` : ''}
      </div>
    </article>`;
  }

  // po zmianie na liście odświeżamy wszystkie karty tego anime na ekranie (bez przeładowania widoku)
  function refreshCards(id) {
    $$(`.acard[data-id="${id}"] .acard-media`).forEach((box) => {
      const m = media.get(Number(id)) || (Lib.get(id) && Lib.get(id).media);
      if (m) box.innerHTML = cardMedia(m, box.parentNode.dataset.addStatus || 'planning');
    });
  }

  function progressBar(p, total, { cls = '' } = {}) {
    const pct = total ? clamp((p / total) * 100, 0, 100) : (p ? 100 : 0);
    return `<div class="pbar ${cls}${total ? '' : ' unknown'}" role="progressbar" aria-valuemin="0" aria-valuemax="${total || p || 1}" aria-valuenow="${p}"><i style="width:${pct}%"></i></div>`;
  }

  function progressText(e) {
    const c = Lib.cur(e);
    const total = Lib.epTotal(e);
    return `${c.progress}/${total || '?'}${c.ranges ? ` · odc. ${Lib.rangesText(c)}` : ''}`;
  }

  function nextEpBadge(e) {
    const n = e.media.nextAiringEpisode;
    if (!n || e.media.isAdult || n.airingAt * 1000 < Date.now()) return '';
    return `<span class="next-ep">${ICON.clock} odc. ${n.episode} za ${countdownTo(n.airingAt, { short: true })}</span>`;
  }

  // opts.badge: wartość, po której lista jest posortowana (np. „2014”, „AniList 7,7”)
  const sortBadge = (opts) => (opts && typeof opts === 'object' && opts.badge ? `<span class="sort-val">${opts.badge}</span>` : '');

  function entryCard(e, opts) {
    const m = e.media;
    const c = Lib.cur(e);
    const total = Lib.epTotal(e);
    const canInc = e.status !== 'completed' && (!total || Lib.lastEp(e) < total);
    const aired = Lib.airedEpisodes(m);
    const last = Lib.lastEp(e);
    const behind = aired != null && !m.isAdult && aired > last && e.status === 'watching' ? aired - last : 0;
    return `<article class="ecard st-${e.status}" data-id="${e.id}">
      <a class="ecard-cover" href="#/anime/${e.id}" aria-label="${esc(titleOf(m))}">
        ${cover(m)}
        ${e.favorite ? `<span class="ecard-fav" title="Ulubione">${ICON.star}</span>` : ''}
        ${behind ? `<span class="ecard-behind" title="Wyemitowane, a nieobejrzane">+${behind}</span>` : ''}
      </a>
      <div class="ecard-body">
        <a class="ecard-title" href="#/anime/${e.id}">${esc(titleOf(m))}</a>
        <div class="ecard-row">${statusChip(e.status, e)}${e.score != null ? `<span class="score">${ICON.star}${NF1.format(e.score)}</span>` : ''}</div>
        ${sortBadge(opts)}
        <div class="ecard-prog">
          ${progressBar(c.progress, total)}
          <div class="ecard-prog-row">
            <span class="num">${progressText(e)} <small>odc.</small></span>
            ${canInc ? `<button class="btn-inc" type="button" data-inc="${e.id}" aria-label="Obejrzałem kolejny odcinek">${ICON.plus}<span>1</span></button>` : ''}
          </div>
        </div>
        ${nextEpBadge(e)}
      </div>
    </article>`;
  }

  function entryRow(e, opts) {
    const m = e.media;
    const c = Lib.cur(e);
    const total = Lib.epTotal(e);
    const canInc = e.status !== 'completed' && (!total || c.progress < total);
    return `<div class="erow st-${e.status}" data-id="${e.id}" role="row">
      <a class="erow-cover" href="#/anime/${e.id}" tabindex="-1" aria-hidden="true">${cover(m, 'sm')}</a>
      <div class="erow-main" role="cell">
        <a class="erow-title" href="#/anime/${e.id}">${esc(titleOf(m))}</a>
        <div class="erow-meta">${sortBadge(opts)}${metaLine(m)}${e.tags.length ? ' · ' + e.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join(' ') : ''}</div>
      </div>
      <div class="erow-status" role="cell">${statusChip(e.status, e)}</div>
      <div class="erow-prog" role="cell">
        <button class="icon-btn sm" type="button" data-inc="${e.id}" data-d="-1" aria-label="Cofnij odcinek" ${c.progress ? '' : 'disabled'}>${ICON.minus}</button>
        <span class="num">${progressText(e)}</span>
        <button class="icon-btn sm" type="button" data-inc="${e.id}" aria-label="Obejrzałem kolejny odcinek" ${canInc ? '' : 'disabled'}>${ICON.plus}</button>
      </div>
      <div class="erow-score num" role="cell">${e.score != null ? NF1.format(e.score) : '—'}</div>
      <div class="erow-time num" role="cell">${Lib.epDur(e) ? esc(fmtDuration(Lib.entryMinutes(e), { short: true })) : '<span class="warn-txt" title="Brak długości odcinka">?</span>'}</div>
    </div>`;
  }

  function section(title, body, { id = '', more = '', moreLabel = 'Zobacz wszystko', cls = '', sub = '' } = {}) {
    return `<section class="sec ${cls}"${id ? ` id="${id}"` : ''}>
      <header class="sec-head">
        <div><h2>${title}</h2>${sub ? `<p class="sec-sub">${sub}</p>` : ''}</div>
        ${more ? `<a class="sec-more" href="${more}">${esc(moreLabel)}${ICON.chevron}</a>` : ''}
      </header>
      <div class="sec-body">${body}</div>
    </section>`;
  }

  const skeletonCards = (n = 6) => `<div class="grid-cards">${Array.from({ length: n }, () => '<div class="skel-card"><div class="skel skel-cover"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>').join('')}</div>`;
  const skeletonRows = (n = 4) => `<div class="skel-rows">${Array.from({ length: n }, () => '<div class="skel skel-row"></div>').join('')}</div>`;

  function empty(title, body = '', action = '') {
    return `<div class="empty"><div class="empty-mark" aria-hidden="true"></div><h3>${esc(title)}</h3>${body ? `<p>${body}</p>` : ''}${action}</div>`;
  }

  function staleNote(r) {
    if (!r || !r.stale) return '';
    return `<p class="stale">${ICON.refresh} Brak połączenia ze źródłem. Pokazuję dane zapisane ${esc(fmtDateTime(r.t))}.</p>`;
  }

  function errorBox(err, retryId = '') {
    return `<div class="errbox" role="alert"><b>Nie udało się pobrać danych.</b><p>${esc(err && err.message ? err.message : String(err))}</p>${retryId ? `<button class="btn ghost sm" type="button" id="${retryId}">${ICON.refresh}Spróbuj ponownie</button>` : ''}</div>`;
  }

  function newsItem(it, { compact = false } = {}) {
    const isNew = NGNL.isNew(it);
    const tr = S.settings.translate && it.tr ? it.tr : null;
    const title = tr && tr.title ? tr.title : it.title;
    const summary = tr && tr.summary ? tr.summary : it.summary;
    const waiting = S.settings.translate && !tr && Tr.isJa(it.title);
    return `<article class="news${isNew ? ' is-new' : ''}${compact ? ' compact' : ''}">
      ${!compact && it.image ? `<a class="news-img" href="${esc(it.url)}" target="_blank" rel="noopener" data-news="${esc(it.id)}" tabindex="-1" aria-hidden="true"><img src="${esc(it.image)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></a>` : ''}
      <div class="news-body">
        <div class="news-top">
          ${isNew ? '<span class="badge-new">NOWE</span>' : ''}
          <span class="news-cat">${esc(NGNL.CAT_LABEL[it.cat] || 'Inne')}</span>
          <time>${it.date ? esc(fmtDateShort(it.date)) : 'data nieznana'}</time>
          ${tr ? `<span class="tr-chip" title="Przetłumaczono z japońskiego: ${esc(Tr.engineLabel(tr.engine))}">JP → EN</span>` : waiting ? '<span class="tr-chip wait">tłumaczę…</span>' : ''}
        </div>
        <a class="news-title" href="${esc(it.url)}" target="_blank" rel="noopener" data-news="${esc(it.id)}"${tr && tr.title ? ' lang="en"' : ''}>${esc(title)}</a>
        ${tr && tr.title && !compact ? `<p class="tr-orig" lang="ja">${esc(it.title)}</p>` : ''}
        ${!compact && summary ? `<p class="news-sum">${esc(summary)}</p>` : ''}
        <div class="news-src">${esc(it.source)}${it.author ? ` · ${esc(it.author)}` : ''} ${ICON.ext}
          ${!compact && (tr || Tr.isJa(it.title)) ? `<a class="tr-page" href="${esc(Tr.pageUrl(it.url))}" target="_blank" rel="noopener">Czytaj artykuł po angielsku ${ICON.ext}</a>` : ''}</div>
      </div>
    </article>`;
  }

  return {
    quickStatus, quickAddTitle, cardMedia, refreshCards,
    remember, media, cover, statusChip, airingChip, metaLine, countdown, countdownTo, premiereLine,
    animeCard, entryCard, entryRow, progressBar, progressText, nextEpBadge, section,
    skeletonCards, skeletonRows, empty, staleNote, errorBox, newsItem, safeColor, yearOf,
  };
})();
