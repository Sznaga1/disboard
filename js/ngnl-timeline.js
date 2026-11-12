'use strict';
/* ==========================================================================
   Disboard — oś czasu No Game No Life (na dole centrum NGNL)
   Dane zebrane ręcznie i sprawdzone w źródłach 30.09.2026: Kadokawa, oficjalna
   strona ngnl.jp, Natalie, Yen Press / Seven Seas, wiki serii, sklepy z doujinshi.
   Daty japońskie; „en” = wydanie angielskie. c: 's' = jedno źródło, 'u' = data przybliżona.
   Rzeczy, których tu nie ma (np. zapowiedź 2. sezonu), dopisują się same z AniList.
   ========================================================================== */

const NGNL_TIMELINE = (() => {
  const K = 'https://www.kadokawa.co.jp/product/';
  const WIKI_TV = 'https://no-game-no-life.fandom.com/wiki/No_Game_No_Life_(Anime)';
  const TV_GOODS = 'https://ngnl.jp/tv/goods/';
  const NC = 'https://ngnl.jp/goods/novel-comics/';
  const ep = (n, d, t, ja, extra = '') => ({ d, k: 'anime', g: 'tv', t: `Odcinek ${n}: ${t}`, ja, x: extra, src: WIKI_TV });
  const ova = (n, d, t, ja, bd) => ({ d, k: 'anime', g: 'ova', t: `Mini OVA ${n}: ${t}`, ja, x: `dodatek do Blu-ray/DVD tom ${bd}`, src: TV_GOODS });
  const ln = (n, d, en, src, ja = '', x = '') => ({ d, k: 'ln', t: `Tom ${n}`, ja, en, x, src });
  return [
    ln(1, '2012-04-25', '2015-04-21', `${K}301310010267/`, 'ゲーマー兄妹がファンタジー世界を征服するそうです', 'debiut serii w MF Bunko J'),
    ln(2, '2012-09-25', '2015-07-21', `${K}301310010268/`, 'ゲーマー兄妹が獣耳っ子の国に目をつけたようです'),
    ln(3, '2013-01-25', '2015-10-27', `${K}301310010269/`, 'ゲーマー兄妹の片割れが消えたようですが……？'),
    { d: '2013-01-27', k: 'manga', t: 'Start mangi (rys. Mashiro Hiiragi)', x: 'Monthly Comic Alive; przerwa po numerze 11/2013, krótki powrót jesienią 2017', src: 'https://no-game-no-life.fandom.com/wiki/No_Game_No_Life_(Series)', c: 's' },
    ln(4, '2013-06-25', '2016-03-22', `${K}301312001067/`, 'ゲーマー兄妹はリアル恋愛ゲームから逃げ出しました'),
    { d: '2013-07-28', k: 'other', t: 'Zapowiedź anime TV', x: 'na festiwalu MF Bunko J Summer School Festival 2013', src: 'https://zh.wikipedia.org/wiki/NO_GAME_NO_LIFE_%E9%81%8A%E6%88%B2%E4%BA%BA%E7%94%9F' },
    { d: '2013-08-10', k: 'doujin', t: 'No Work No Life', x: 'Comiket C84 (10–12 sierpnia), koło pixel phantom Yuu Kamiyi · pierwszy numer, 52 strony ilustracji', src: 'https://www.suruga-ya.com/en/product/ZHORE74192' },
    { d: '2013-11-22', k: 'manga', t: 'Manga · tom 1 (Mashiro Hiiragi)', en: '2014-10-21', x: 'wyd. angielskie: Seven Seas', src: `${K}301309000877/` },
    ln(5, '2013-11-25', '2016-12-20', `${K}301309000871/`, 'ゲーマー兄妹は強くてニューゲームがお嫌いなようです'),
    { d: '2013', sort: '2013-12-29', k: 'doujin', t: 'No Work No Life 2', x: '36 stron ilustracji · wydarzenie niepotwierdzone, prawdopodobnie Comiket C85', src: 'https://bookmeter.com/books/8207654', c: 'u' },
    ep(1, '2014-04-09', 'Beginner', '素人《ビギナー》', 'premiera w AT-X'),
    ep(2, '2014-04-16', 'Challenger', '挑戦者《チャレンジャー》'),
    ep(3, '2014-04-23', 'Expert', '熟練者《エキスパート》'),
    ln(6, '2014-04-25', '2017-07-25', `${K}301402000779/`, 'ゲーマー夫嫁は世界に挑んだそうです', 'prequel, na jego podstawie powstał film Zero'),
    ep(4, '2014-04-30', 'Grandmaster', '国王《グランドマスター》'),
    ep(5, '2014-05-07', 'Weak Square', '駒並べ《ウィークスクエア》'),
    ep(6, '2014-05-14', 'Interesting', '一手《インタレスティング》'),
    ep(7, '2014-05-21', 'Sacrifice', '死に手《サクリファイス》'),
    ep(8, '2014-05-28', 'Fake End', '起死回生《フェイクエンド》'),
    ep(9, '2014-06-04', 'Sky Walk', '解離法《スカイ・ウォーク》'),
    ep(10, '2014-06-11', 'Blue Rose', '指向法《ブルー・ローズ》'),
    ep(11, '2014-06-18', 'Killing Giant', '誘導法《キリング・ジャイアント》'),
    ep(12, '2014-06-25', 'Rule Number 10', '収束法《ルール・ナンバー・10》', 'finał 1. sezonu'),
    ova(1, '2014-06-25', 'Wild Fancy', '妄想《ワイルド・ファンシー》', 'I'),
    ova(2, '2014-07-30', 'Director', '監督《ディレクター》', 'II'),
    ova(3, '2014-08-27', 'Revenge', '復讐《リベンジ》', 'III'),
    ova(4, '2014-09-24', 'Dress-up Doll', '人形《ドレスアップ・ドール》', 'IV'),
    ova(5, '2014-10-29', 'Growth', '成長《グロース》', 'V'),
    ova(6, '2014-11-26', 'Appetite', '食欲《アぺタイト》', 'VI'),
    { d: '2015-05-27', k: 'spinoff', t: 'Start mangi „No Game No Life, Desu!”', x: 'spin-off rys. Kazuya Yuizaki, w roli głównej Izuna', src: 'https://natalie.mu/comic/news/148533' },
    ln(7, '2015-07-24', '2018-10-30', `${K}301501002017`, 'ゲーマー兄妹たちは定石を覆すそうです'),
    { d: '2015-08-14', k: 'doujin', t: 'No Work No Life 3', x: 'Comiket C88 (14–16 sierpnia) · 52 strony: NGNL, Splatoon i własne ilustracje', src: 'https://www.suruga-ya.com/en/product/ZHORO35136', c: 's' },
    ln(8, '2015-12-25', '2019-04-02', NC),
    { d: '2016-01-23', k: 'spinoff', t: '„No Game No Life, Desu!” · tom 1', en: '2017-06-20', x: 'angielski tytuł: „No Game No Life, Please!”', src: NC },
    { d: '2016-02-24', k: 'other', t: 'NEET Blu-ray BOX', x: 'odcinki 1–12 i 6 mini OVA w jednym pudełku', src: TV_GOODS },
    { d: '2016-07-17', k: 'other', t: 'Zapowiedź filmu Zero', x: 'na MF Bunko J Summer School Festival 2016', src: 'https://en.wikipedia.org/wiki/No_Game_No_Life:_Zero' },
    { d: '2016-08-12', k: 'doujin', t: 'No Work No Life Desu!', x: 'Comiket C90 · 36 stron, wspólnie z Kazuyą Yuizakim', src: 'https://hkacger.com/archives/28946/' },
    { d: '2016-08-23', k: 'spinoff', t: '„No Game No Life, Desu!” · tom 2', en: '2017-09-19', src: NC },
    ln(9, '2016-08-25', '2019-10-29', NC),
    { d: '2016-12-23', k: 'spinoff', t: 'Light novel „Practical War Game”', en: '2021-10-05', x: 'poboczna historia: inne spojrzenie na Wielką Wojnę, plus opowiadania dodawane do anime', src: `${K}321609000217/` },
    { d: '2017-04-22', k: 'spinoff', t: '„No Game No Life, Desu!” · tom 3', en: '2018-02-06', src: NC },
    { d: '2017-07-15', k: 'film', t: 'Film „No Game No Life: Zero”', x: 'premiera w japońskich kinach · na podstawie 6. tomu · w USA od 5 października 2017', src: 'https://en.wikipedia.org/wiki/No_Game_No_Life:_Zero' },
    { d: '2017-11-27', k: 'spinoff', t: 'Koniec „No Game No Life, Desu!”', x: 'ostatni rozdział w Monthly Comic Alive', src: 'https://en.wikipedia.org/wiki/No_Game_No_Life' },
    { d: '2018-01-23', k: 'spinoff', t: '„No Game No Life, Desu!” · tom 4', en: '2018-09-25', x: 'ostatni tom', src: NC },
    { d: '2018-02-23', k: 'manga', t: 'Manga · tom 2 (Mashiro Hiiragi)', en: '2019-01-15', src: `${K}321708000418/` },
    { d: '2018-02-23', k: 'film', t: 'Zero na Blu-ray i DVD', x: 'w Japonii · w USA od 28 sierpnia 2018', src: 'https://ngnl.jp/goods/blu-ray-dvd/' },
    ln(10, '2018-02-24', '2020-02-18', `${K}321704000169/`, 'ゲーマー兄妹は過去（ツケ）を払わされるようです'),
    { d: '2019-04-01', k: 'other', t: 'Artbook „Yuu Kamiya Art Works”', x: '148 stron: ilustracje z tomów 1–6, anime i filmu, nowa krótka manga i opowiadanie', src: `${K}321812000135/` },
    ln(11, '2021-11-25', '2022-05-17', `${K}321809000110/`, 'ゲーマー兄妹たちはカップルにならなきゃ出られないそうです', 'w posłowiu autor pisze, że historia weszła w końcowy etap'),
    { d: '2021-11-27', k: 'manga', t: 'Start mangi „Chapter 2: Eastern Union”', x: 'nowa adaptacja, rys. Naitou, Monthly Comic Alive', src: 'https://natalie.mu/comic/news/455269' },
    { d: '2022-06-22', k: 'manga', t: 'Eastern Union · tom 1', en: '2024-06-04', src: `${K}322109001052/` },
    { d: '2022-08-13', k: 'doujin', t: 'No Work No Life Zero', x: 'Comiket C100 · 200-stronicowy zbiór, także z tekstami', src: 'https://www.suruga-ya.jp/product/detail/ZHORE251206' },
    { d: '2023-02-21', k: 'manga', t: 'Eastern Union · tom 2', en: '2024-10-29', src: `${K}322210000421/` },
    ln(12, '2023-02-25', '2023-12-12', `${K}322209000047/`, 'ゲーマー兄妹たちは『魔王』に挑むようです'),
    { d: '2023-12-30', k: 'doujin', t: 'No Work No Life 2023', x: 'Comiket C103 · ok. 30 stron kolorowych ilustracji', src: 'https://www.ebay.com/itm/405000714185' },
    { d: '2024-04-24', k: 'other', t: 'COMPLETE Blu-ray BOX na 10-lecie', x: 'serial, film Zero, 6 mini OVA i nagrania z audycji radiowej', src: 'https://www.kadokawa.co.jp/product/video2155/' },
    { d: '2024-12-23', k: 'manga', t: 'Eastern Union · tom 3', en: '2026-03-24', x: 'najnowszy tom · serializacja zawieszona od stycznia 2025', src: `${K}322306000767/` },
    { d: '2024-12-29', k: 'doujin', t: 'No Work No Life 2024', x: 'Comiket C105 · 32 strony ilustracji', src: 'https://shop.lashinbang.com/products/detail/6642516' },
    { d: '2025-12-30', k: 'doujin', t: 'No Work No Life 2025', x: 'Comiket C107 · kolorowy artbook, sprzedaż także przez Melonbooks', src: 'https://x.com/melonbooks_ec/status/2007391519972725195' },
    { d: '2026-02-19', k: 'other', t: 'Zapowiedź 13. tomu', x: 'pierwszy nowy tom od ponad 3 lat', src: 'https://animecorner.me/no-game-no-life-returns-with-volume-13-in-april-first-new-release-in-over-3-years/', c: 's' },
    ln(13, '2026-04-24', null, `${K}322305001014/`, 'ゲーマー兄妹たちは『魔王』を討つ（すくう）ようです', 'najnowszy tom · wydania angielskiego jeszcze nie zapowiedziano'),
  ];
})();

const NgnlTimeline = (() => {
  const KINDS = {
    ln: ['Light novel', 'var(--crown)'],
    manga: ['Manga', 'var(--shiro)'],
    spinoff: ['Spin-off', 'var(--st-paused)'],
    anime: ['Anime', 'var(--st-watching)'],
    film: ['Film', 'var(--st-completed)'],
    doujin: ['Doujinshi', 'var(--st-dropped)'],
    other: ['Wydarzenie', 'var(--muted)'],
    you: ['Ty', 'var(--sora)'],
  };
  const GROUPS = { tv: 'Anime TV: odcinki 1–12', ova: 'Mini OVA 1–6 na Blu-ray/DVD' };
  const MON = (d) => new Date(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }).replace('.', '');
  const tsOf = (s) => new Date(`${s.length === 4 ? `${s}-12-31` : s.length === 7 ? `${s}-01` : s}T12:00:00`).getTime();
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  // kuratorowana lista + to, co wie AniList (np. zapowiedziany 2. sezon) + Twoje obejrzenia
  function build(series) {
    const items = NGNL_TIMELINE.map((x) => ({ ...x, ts: tsOf(x.sort || x.d) }));
    const seq = series ? NGNL.sequelInfo(series) : null;
    if (seq && seq.media) {
      const m = seq.media;
      const st = fuzzyTs(m.startDate);
      items.push({ d: st ? null : '', ts: st || Infinity, fd: fuzzyDate(m.startDate), k: 'anime', t: `${titleOf(m)}${m.status === 'NOT_YET_RELEASED' ? ' · zapowiedź' : ''}`, x: m.status === 'NOT_YET_RELEASED' ? `data: ${fuzzyDate(m.startDate) || 'jeszcze nieustalona'} · z AniList` : 'z AniList', href: `#/anime/${m.id}`, live: true });
    }
    for (const e of Object.values(S.entries)) {
      if (!/no game no life/i.test(`${e.media.title.romaji || ''} ${e.media.title.english || ''}`)) continue;
      e.sessions.forEach((s) => {
        if (!s.finishedAt) return;
        items.push({ ts: s.finishedAt, d: null, k: 'you', t: `${s.n ? `Twój rewatch #${s.n}` : 'Obejrzałeś'}: ${titleOf(e.media)}`, href: `#/anime/${e.id}` });
      });
    }
    return items.sort((a, b) => a.ts - b.ts);
  }

  function render(el, { series = null } = {}) {
    if (!el) return;
    const st = el._tl || (el._tl = { kind: 'all', open: {} });
    const all = build(series);
    const kinds = ['all', ...Object.keys(KINDS).filter((k) => all.some((x) => x.k === k))];
    const list = all.filter((x) => st.kind === 'all' || x.k === st.kind);
    // znacznik „dziś” wpada we właściwe miejsce (przed zapowiedziami z przyszłą datą)
    if (st.kind === 'all') {
      const i = list.findIndex((x) => x.ts > Date.now());
      list.splice(i < 0 ? list.length : i, 0, { now: true, ts: Date.now() });
    }
    const groupsOpen = st.kind === 'anime';
    const cnt = (k, g) => NGNL_TIMELINE.filter((x) => x.k === k && (!g || x.g === g) && (k !== 'manga' || /tom/.test(x.t))).length;
    const n = (v, a, b, c) => `<span><b class="num">${v}</b> ${plural(v, a, b, c)}</span>`;
    const s1End = tsOf('2014-06-25');
    const lnAfter = NGNL_TIMELINE.filter((x) => x.k === 'ln' && tsOf(x.d) > s1End).length;

    let rows = '', year = null;
    const seenGroup = new Set();
    for (const x of list) {
      const y = Number.isFinite(x.ts) ? new Date(x.ts).getFullYear() : 'Wkrótce';
      if (y !== year) { year = y; rows += `<li class="tl-year"><span class="num">${y}</span></li>`; }
      if (x.now) {
        let wait = '';
        try { const w = Wait.state(); if (w && w.mode !== 'done') { const n = Math.floor((Date.now() - w.b.t) / 86400e3); wait = ` · na 2. sezon czekasz już ${NF.format(n)} ${unit(n, 'day')}`; } } catch { /* licznik jeszcze nie gotowy */ }
        rows += `<li class="tl-now"><time class="num">dziś</time><i class="tl-dot" aria-hidden="true"></i><div class="tl-b"><b>${esc(fmtDate(Date.now()))}${esc(wait)}</b></div></li>`;
        continue;
      }
      const [kl, kc] = KINDS[x.k];
      const collapsed = x.g && !groupsOpen && !st.open[x.g];
      if (collapsed) {
        if (seenGroup.has(x.g)) continue;
        seenGroup.add(x.g);
        const g = NGNL_TIMELINE.filter((z) => z.g === x.g);
        rows += `<li class="tl-it" style="--k:${kc}"><time class="num">${esc(MON(tsOf(g[0].d)))}</time><i class="tl-dot" aria-hidden="true"></i>
          <div class="tl-b"><span class="tl-k">${kl}</span><b>${GROUPS[x.g]}</b>
          <span class="tl-x">${esc(MON(tsOf(g[0].d)))} – ${esc(fmtDate(tsOf(g[g.length - 1].d)))} · ${x.g === 'tv' ? 'co tydzień, w środy' : 'co miesiąc, z kolejnymi tomami Blu-ray/DVD'} <a class="tl-src" href="${esc(g[0].src)}" target="_blank" rel="noopener">${esc(host(g[0].src))}${ICON.ext}</a></span>
          <button class="btn ghost sm tl-more" type="button" data-tl-open="${x.g}">Pokaż ${g.length} ${x.g === 'tv' ? 'odcinków' : 'dodatków'} osobno</button></div></li>`;
        continue;
      }
      const date = x.d && x.d.length === 4 ? `${x.d}` : Number.isFinite(x.ts) ? MON(x.ts) : '?';
      const title = x.href ? `<a href="${esc(x.href)}">${esc(x.t)}</a>` : esc(x.t);
      if (x.g) {
        // odcinki i mini OVA: jedna zwarta linia, źródło raz w nagłówku grupy
        rows += `<li class="tl-it small" style="--k:${kc}"><time class="num">${esc(date)}</time><i class="tl-dot" aria-hidden="true"></i>
          <div class="tl-b"><b>${title} <span class="tl-ja" lang="ja">${esc(x.ja || '')}</span>${x.x ? ` <span class="tl-x">· ${esc(x.x)}</span>` : ''}</b></div></li>`;
        continue;
      }
      rows += `<li class="tl-it${x.g ? ' small' : ''}${x.k === 'you' ? ' you' : ''}${x.live ? ' live' : ''}" style="--k:${kc}">
        <time class="num"${x.c === 'u' ? ' title="Dokładna data nieznana"' : ''}>${esc(date)}${x.c === 'u' ? ' ≈' : ''}</time><i class="tl-dot" aria-hidden="true"></i>
        <div class="tl-b"><span class="tl-k">${kl}</span><b>${title}</b>${x.ja ? `<span class="tl-ja" lang="ja">${esc(x.ja)}</span>` : ''}
          ${x.x || x.en || x.src ? `<span class="tl-x">${[x.x ? esc(x.x) : '', x.en ? `po angielsku: ${esc(fmtDate(tsOf(x.en)))}` : '', x.c === 's' ? 'potwierdzone w jednym źródle' : ''].filter(Boolean).join(' · ')}${x.src ? ` <a class="tl-src" href="${esc(x.src)}" target="_blank" rel="noopener" title="Źródło: ${esc(host(x.src))}">${esc(host(x.src))}${ICON.ext}</a>` : ''}</span>` : ''}
        </div></li>`;
    }

    el.innerHTML = UI.section('Oś czasu No Game No Life', `
      <p class="tl-sum">${n(cnt('ln'), 'tom light novel', 'tomy light novel', 'tomów light novel')}${n(cnt('manga'), 'tom mangi', 'tomy mangi', 'tomów mangi')}<span><b class="num">2</b> spin-offy (Desu! i Practical War Game)</span>${n(cnt('anime', 'tv'), 'odcinek', 'odcinki', 'odcinków')}${n(cnt('anime', 'ova'), 'mini OVA', 'mini OVA', 'mini OVA')}<span><b class="num">1</b> film</span>${n(cnt('doujin'), 'doujinshi No Work No Life', 'doujinshi No Work No Life', 'doujinshi No Work No Life')}</p>
      <p class="tl-fact">Od finału 1. sezonu wyszło już <b>${lnAfter}</b> ${plural(lnAfter, 'tom', 'tomy', 'tomów')} light novel.</p>
      <div class="chips tl-filter" role="group" aria-label="Rodzaj">${kinds.map((k) => `<button type="button" class="chip-btn${k === st.kind ? ' on' : ''}" data-tl-kind="${k}">${k === 'all' ? 'Wszystko' : KINDS[k][0]} <span>${k === 'all' ? all.length : all.filter((x) => x.k === k).length}</span></button>`).join('')}</div>
      <ol class="tl">${rows}</ol>
      <p class="src-note">Daty wydań japońskich, sprawdzone 30 września 2026 u wydawców i w sklepach (linki przy pozycjach). Nowości z AniList, np. zapowiedź 2. sezonu, i Twoje obejrzenia z datą dopisują się same. „≈” oznacza datę przybliżoną.</p>`,
    { sub: 'Light novel, manga, anime, film i doujinshi autora w jednej linii' });
    if (!el.dataset.bound) {
      el.dataset.bound = '1';
      el.addEventListener('click', (ev) => {
        const k = ev.target.closest('[data-tl-kind]');
        if (k) { st.kind = k.dataset.tlKind; render(el, { series: el._series }); return; }
        const o = ev.target.closest('[data-tl-open]');
        if (o) { st.open[o.dataset.tlOpen] = true; render(el, { series: el._series }); }
      });
    }
    el._series = series;
  }

  return { render, build };
})();
