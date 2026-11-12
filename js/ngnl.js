'use strict';
/* ==========================================================================
   Disboard — centrum No Game No Life
   Źródła: AniList (seria, relacje, zapowiedzi), Jikan/MyAnimeList (newsy anime,
   light novel i mangi, promo, grafiki), opcjonalny feed RSS z GitHub Actions.
   Nic tu nie jest wpisane ręcznie poza identyfikatorem serii w MAL (19815).
   ========================================================================== */

const NGNL = (() => {
  const MAL_ID = 19815;
  const S1_END_FALLBACK = { year: 2014, month: 6, day: 25 }; // gdy AniList nie odpowie

  const CATS = [
    { id: 'merch', label: 'Merch', re: /figur|figma|nendoroid|pop ?up parade|scale|merch|goods|グッズ|フィギュア|ねんどろいど|plush|pluszak|acrylic|akryl|t-?shirt|koszulk|apparel|hoodie|keychain|brelok|prize|kuji|くじ|tapestry|poster|dakimakura|artbook|画集|collab cafe|コラボカフェ/i },
    { id: 'video', label: 'Blu-ray / DVD', re: /blu-?ray|\bdvd\b|\bbd\b|box set|ブルーレイ|4k ?uhd|home video/i },
    { id: 'books', label: 'Light novel i manga', re: /light novel|\bnovel\b|manga|volume|\bvol\.|\btom\b|巻|ライトノベル|小説|漫画|コミカライズ|yen press|mf ?bunko|kadokawa|alive|chapter/i },
    { id: 'games', label: 'Gry', re: /\bgame\b|mobile|gacha|collab|コラボ|ゲーム|playstation|nintendo|\bps\d|steam|vita/i },
    { id: 'events', label: 'Wydarzenia', re: /event|expo|festival|convention|anime ?japan|\bstage\b|concert|\blive\b|イベント|展|exhibition|panel/i },
    { id: 'anime', label: 'Anime i produkcja', re: /anime|season|sezon|trailer|\bpv\b|teaser|zwiastun|staff|\bcast\b|studio|madhouse|film|movie|アニメ|映画|続編|2期|production|announce|ogłosz/i },
  ];
  const CAT_LABEL = Object.fromEntries(CATS.map((c) => [c.id, c.label]));
  CAT_LABEL.other = 'Inne';

  function classify(item) {
    const txt = `${item.title} ${item.summary || ''}`
      .replace(/no\s*game,?\s*no\s*life/gi, ' ')
      .replace(/ノーゲーム・?ノーライフ|ノゲノラ/g, ' ');
    if (item.kind === 'merch') return 'merch';
    for (const c of CATS) if (c.re.test(txt)) return c.id;
    return 'other';
  }

  function normTitle(t) { return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }

  /* ---------- seria z AniList ---------- */
  async function series(opts) {
    const r = await Ani.ngnl(opts);
    const main = r.main;
    const edges = (main && main.relations && main.relations.edges) || [];
    const related = edges.map((ed) => ({ rel: ed.relationType, ...ed.node }));
    // do MyAnimeList pytamy oszczędnie: seria TV, film Zero i light novel
    const zero = related.find((x) => x.type === 'ANIME' && x.idMal);
    const ln = related.find((x) => x.type === 'MANGA' && x.format === 'NOVEL' && x.idMal);
    const animeMal = [MAL_ID, zero && zero.idMal].filter(Boolean);
    const mangaMal = ln ? [{ id: ln.idMal, title: titleOf(ln), format: ln.format }] : [];
    return { main, related, franchise: r.franchise, zero, animeMal: [...new Set(animeMal)], mangaMal, stale: r.stale, t: r.t };
  }

  // Czy AniList zna kontynuację (drugi sezon / nowy projekt)?
  function sequelInfo(s) {
    if (!s || !s.main) return null;
    const ids = new Set([s.main.id]);
    const seq = s.related.find((x) => x.rel === 'SEQUEL' && x.type === 'ANIME');
    if (seq) return { media: seq, via: 'relation' };
    const s1Start = fuzzyTs(s.main.startDate) || 0;
    const zero = s.related.filter((x) => x.type === 'ANIME').map((x) => x.id);
    zero.forEach((id) => ids.add(id));
    const cand = (s.franchise || []).filter((m) => {
      if (ids.has(m.id)) return false;
      const t = `${m.title.romaji} ${m.title.english} ${m.title.native}`;
      if (!/no game no life|ノーゲーム・?ノーライフ/i.test(t)) return false;
      if (!['TV', 'TV_SHORT', 'ONA', 'MOVIE'].includes(m.format)) return false;
      const st = fuzzyTs(m.startDate);
      return m.status === 'NOT_YET_RELEASED' || m.status === 'RELEASING' || (st && st > s1Start + 4 * 365 * 86400e3 && m.format !== 'MOVIE');
    });
    return cand.length ? { media: cand[0], via: 'search' } : null;
  }

  function s1EndTs(s) {
    const fd = (s && s.main && s.main.endDate && s.main.endDate.year) ? s.main.endDate : S1_END_FALLBACK;
    return new Date(fd.year, (fd.month || 1) - 1, fd.day || 1).getTime();
  }

  /* ---------- newsy ---------- */
  function mapJikanNews(n, origin) {
    return {
      id: 'mal:' + n.mal_id,
      title: n.title,
      date: n.date ? Date.parse(n.date) : null,
      summary: truncate(n.excerpt || '', 240),
      source: 'MyAnimeList',
      author: n.author_username || null,
      url: n.url,
      image: n.images && n.images.jpg && n.images.jpg.image_url,
      origin,
    };
  }

  // Google News przez rss2json: działa z dysku i bez własnego serwera
  const GNEWS = [
    { name: 'Google News (EN)', q: '"No Game No Life"', lang: 'en' },
    { name: 'Google News (JP)', q: 'ノーゲーム・ノーライフ', lang: 'ja' },
    { name: 'Google News: merch (EN)', q: '"No Game No Life" (figure OR nendoroid OR merch OR "Blu-ray")', lang: 'en' },
    { name: 'Google News: グッズ (JP)', q: 'ノーゲーム・ノーライフ (フィギュア OR グッズ OR ねんどろいど)', lang: 'ja' },
  ];
  const RETRYABLE = ['upstream', 'rate', 'network', 'server'];

  async function news(s, { force = false, onPartial } = {}) {
    const items = [];
    const sources = [];
    const push = (arr) => { items.push(...arr); if (onPartial) onPartial(merge(items)); };
    const tasks = [];
    let order = 0;

    for (const g of GNEWS) {
      const o = order++;
      const name = `${g.name} · przez rss2json`;
      tasks.push(Rss.google(g.q, g.lang, { force }).then((r) => {
        push(r.items.map((x) => ({ id: 'gn:' + hashStr(x.url.replace(/[?#].*$/, '')), title: x.title, date: x.date, summary: '', source: x.source, url: x.url, image: x.image, origin: 'rss' })));
        sources.push({ o, name, ok: true, note: r.stale ? `offline, dane z ${fmtDateTime(r.t)}` : `${r.items.length} wpisów` });
      }).catch((e) => { sources.push({ o, name, ok: false, note: e.message, kind: e.kind }); }));
    }

    // feed RSS z GitHub Actions (jeśli jest)
    const oFeed = order++;
    tasks.push(loadFeed({ force }).then((feed) => {
      if (feed.items && feed.items.length) {
        push(feed.items.map((x) => ({
          id: 'feed:' + (x.id || hashStr(x.url || x.title)),
          title: x.title, date: x.date ? Date.parse(x.date) : null,
          summary: truncate(x.summary || '', 240), source: x.source || 'RSS', url: x.url,
          image: x.image || null, price: x.price || null, kind: x.kind === 'merch' ? 'merch' : undefined, origin: 'feed',
        })));
      }
      sources.push({ o: oFeed, name: 'Feed RSS (GitHub Actions)', ok: !!(feed.items && feed.items.length), optional: true, note: feed.unavailable || (feed.generatedAt ? `zbudowany ${fmtDateTime(Date.parse(feed.generatedAt))}` : (feed.items && !feed.items.length ? 'plik jest pusty — uruchom workflow' : '')) });
    }));

    const targets = [
      { kind: 'anime', id: MAL_ID, label: 'anime (seria TV)' },
      ...(s.zero && s.zero.idMal ? [{ kind: 'anime', id: s.zero.idMal, label: `anime: ${titleOf(s.zero)}` }] : []),
      ...s.mangaMal.map((m) => ({ kind: 'manga', id: m.id, label: `light novel: ${m.title}` })),
    ];
    for (const tg of targets) {
      const o = order++;
      const name = `MyAnimeList — ${tg.label}`;
      tasks.push(Jikan.news(tg.kind, tg.id, { force }).then((r) => {
        push(r.items.map((n) => mapJikanNews(n, tg.kind)));
        sources.push({ o, name, ok: true, note: r.stale ? `offline, dane z ${fmtDateTime(r.t)}` : `${r.items.length} wpisów` });
      }).catch((e) => { sources.push({ o, name, ok: false, note: e.message, kind: e.kind }); }));
    }

    await Promise.all(tasks);
    sources.sort((a, b) => a.o - b.o);
    const retry = sources.some((x) => !x.ok && RETRYABLE.includes(x.kind));
    return { items: merge(items), sources, retry };
  }

  function merge(items) {
    const seen = new Map();
    for (const it of items) {
      const k = it.url ? it.url.replace(/[?#].*$/, '') : normTitle(it.title);
      const k2 = normTitle(it.title);
      if (seen.has(k) || [...seen.values()].some((x) => normTitle(x.title) === k2)) continue;
      it.cat = classify(it);
      seen.set(k, it);
    }
    return [...seen.values()].sort((a, b) => (b.date || 0) - (a.date || 0));
  }

  // oznaczanie NOWE: pierwsze pobranie = punkt odniesienia (bez zalewu „nowych”)
  function markDiscovered(items) {
    if (!items.length) return []; // pusty wynik (np. awaria źródeł) nie ustala punktu odniesienia
    const first = !S.meta.newsBaseline;
    const fresh = [];
    for (const it of items) {
      if (!S.meta.newsFirstSeen[it.id]) {
        // stare wpisy z nowo dodanego źródła nie udają świeżych wiadomości
        const old = it.date && Date.now() - it.date > 30 * 86400e3;
        S.meta.newsFirstSeen[it.id] = (first || old) ? 1 : Date.now();
        if (!first && !old) fresh.push(it);
      }
    }
    S.meta.newsBaseline = true;
    save();
    return fresh;
  }
  function isNew(it) {
    if (S.meta.newsOpened[it.id]) return false;
    const fs = S.meta.newsFirstSeen[it.id];
    if (fs && fs > 1 && Date.now() - fs < 14 * 86400e3) return true;
    return !!(it.date && Date.now() - it.date < 7 * 86400e3);
  }
  function markOpened(id) { S.meta.newsOpened[id] = Date.now(); save(); emit('ngnl-read'); }
  function markAllOpened(items) { items.forEach((it) => { S.meta.newsOpened[it.id] = Date.now(); }); save(); emit('ngnl-read'); }

  // okresowe sprawdzenie: nowe newsy → powiadomienia
  async function check({ force = false } = {}) {
    try {
      const s = await series();
      const { items } = await news(s, { force });
      const fresh = markDiscovered(items);
      await Tr.items(fresh.slice(0, 5));
      for (const it of fresh.slice(0, 5)) {
        const merch = it.cat === 'merch';
        const title = S.settings.translate && it.tr && it.tr.title ? it.tr.title : it.title;
        Lib.notify({
          kind: merch ? 'merch' : 'news', key: 'news:' + it.id,
          title: merch ? `Nowy merch NGNL: ${truncate(title, 70)}` : `No Game No Life: ${truncate(title, 80)}`,
          body: `${it.source}${it.date ? ' · ' + fmtDateShort(it.date) : ''}`, link: '#/ngnl',
        });
      }
      S.meta.lastNewsCheck = Date.now();
      save();
      emit('ngnl-news', { count: items.filter(isNew).length });
      return items;
    } catch (e) {
      return null;
    }
  }

  /* ---------- promo i grafiki ---------- */
  async function videos(s) {
    const out = [];
    const seen = new Set();
    const add = (v) => { if (v.yt && seen.has(v.yt)) return; if (v.yt) seen.add(v.yt); out.push(v); };
    if (s.main && s.main.trailer && s.main.trailer.site === 'youtube') {
      add({ title: 'Zwiastun (AniList)', yt: s.main.trailer.id, thumb: s.main.trailer.thumbnail, url: `https://www.youtube.com/watch?v=${s.main.trailer.id}`, anime: 'No Game No Life' });
    }
    const vids = await Promise.all(s.animeMal.map((id) => Jikan.videos(id).then((v) => [id, v]).catch(() => [id, null])));
    for (const [id, v] of vids) {
      if (!v) continue;
      try {
        const anime = id === MAL_ID ? 'No Game No Life' : (s.related.find((x) => x.idMal === id) ? titleOf(s.related.find((x) => x.idMal === id)) : 'NGNL');
        for (const p of (v.promo || [])) {
          const tr = p.trailer || {};
          const yt = tr.youtube_id || (tr.embed_url && (tr.embed_url.match(/embed\/([\w-]{6,})/) || [])[1]);
          if (!yt && !tr.url) continue;
          add({ title: p.title || 'Promo', yt, thumb: (tr.images && (tr.images.maximum_image_url || tr.images.large_image_url || tr.images.medium_image_url)) || (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null), url: tr.url || `https://www.youtube.com/watch?v=${yt}`, anime });
        }
        for (const mv of (v.music_videos || [])) {
          const vid = mv.video || {};
          const yt = vid.youtube_id;
          if (!yt) continue;
          add({ title: (mv.meta && mv.meta.title) ? `Muzyka: ${mv.meta.title}` : (mv.title || 'Teledysk'), yt, thumb: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, url: vid.url || `https://www.youtube.com/watch?v=${yt}`, anime });
        }
      } catch { /* pomijamy źródło */ }
    }
    return out;
  }

  async function pictures(s) {
    const out = [];
    const add = (src, full, label) => { if (src && !out.some((x) => x.full === full)) out.push({ src, full: full || src, label }); };
    if (s.main) {
      add(s.main.coverImage && s.main.coverImage.large, s.main.coverImage && (s.main.coverImage.extraLarge || s.main.coverImage.large), 'Okładka (AniList)');
      if (s.main.bannerImage) add(s.main.bannerImage, s.main.bannerImage, 'Baner (AniList)');
    }
    for (const r of s.related) if (r.coverImage && r.coverImage.large) add(r.coverImage.large, r.coverImage.large, titleOf(r));
    const all = await Promise.all(s.animeMal.map((id) => Jikan.pictures(id).catch(() => [])));
    for (const pics of all) {
      for (const p of pics) add(p.jpg && (p.jpg.image_url || p.jpg.large_image_url), p.jpg && (p.jpg.large_image_url || p.jpg.image_url), 'MyAnimeList');
    }
    return out;
  }

  const SHOP_SEARCH = [
    { name: 'Allegro', url: 'https://allegro.pl/listing?string=no%20game%20no%20life', note: 'polski marketplace' },
    { name: 'AmiAmi', url: 'https://www.amiami.com/eng/search/list/?s_keywords=no%20game%20no%20life', note: 'figurki z Japonii' },
    { name: 'eBay', url: 'https://www.ebay.com/sch/i.html?_nkw=no+game+no+life', note: 'rynek wtórny' },
    { name: 'Yen Press', url: 'https://yenpress.com/series/no-game-no-life', note: 'angielskie wydanie light novel' },
  ];

  return { MAL_ID, series, sequelInfo, s1EndTs, news, check, isNew, markOpened, markAllOpened, markDiscovered, videos, pictures, CAT_LABEL, SHOP_SEARCH };
})();
