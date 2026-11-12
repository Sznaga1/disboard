'use strict';
/* ==========================================================================
   Disboard — ekrany: centrum No Game No Life
   (dawny js/pages.js; wspólne funkcje w js/pages/common.js)
   ========================================================================== */

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
