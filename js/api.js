'use strict';
/* ==========================================================================
   Disboard — źródła danych
   • AniList GraphQL (główna baza anime, zapowiedzi, harmonogram)
     limit: 90/min, obecnie tryb ograniczony 30/min → kubełek tokenów ~27/min
   • Jikan v4 (nieoficjalne API MyAnimeList): newsy, promo, grafiki, producenci
     limit: 3/s i 60/min → odstęp 1,1 s
   • Własny feed RSS (data/ngnl-feed.json) budowany przez GitHub Actions
   Każda odpowiedź trafia do cache w IndexedDB. Gdy sieć/API zawiedzie,
   aplikacja zwraca ostatnio pobrane dane z flagą `stale`.
   ========================================================================== */

const ANILIST_URL = 'https://graphql.anilist.co';
const JIKAN_URL = 'https://api.jikan.moe/v4';

class ApiError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

/* ---------- stan źródeł (do banera offline i panelu źródeł) ---------- */
const Net = {
  state: {
    anilist: { ok: null, t: 0, err: null },
    jikan: { ok: null, t: 0, err: null },
    feed: { ok: null, t: 0, err: null },
    rss: { ok: null, t: 0, err: null },
    anizip: { ok: null, t: 0, err: null },
  },
  ok(src) { this.state[src] = { ok: true, t: Date.now(), err: null }; emit('net', src); },
  fail(src, err) { this.state[src] = { ok: false, t: Date.now(), err: err && err.message }; emit('net', src); },
};

/* ---------- ograniczanie tempa ---------- */
// Kubełek tokenów pilnuje tempa STARTÓW zapytań. Zapytania mogą trwać równolegle,
// więc jedno wolne lub ponawiane nie blokuje kolejnych.
function tokenBucket(capacity, perSecond) {
  let tokens = capacity, last = Date.now();
  let gate = Promise.resolve();
  const take = async () => {
    for (;;) {
      const now = Date.now();
      tokens = Math.min(capacity, tokens + ((now - last) / 1000) * perSecond);
      last = now;
      if (tokens >= 1) { tokens -= 1; return; }
      await sleep(Math.ceil(((1 - tokens) / perSecond) * 1000));
    }
  };
  return (fn) => {
    const turn = gate.then(take);
    gate = turn.catch(() => {});
    return turn.then(fn);
  };
}
const aniLimit = tokenBucket(6, 27 / 60);
const jikanLimit = tokenBucket(1, 1 / 1.2);

let rateNoticeAt = 0;
function rateNotice(sec) {
  if (Date.now() - rateNoticeAt < 20000) return;
  rateNoticeAt = Date.now();
  toast(`AniList chwilowo ogranicza liczbę zapytań. Ponawiam za ${sec} s.`, { kind: 'warn' });
}

/* ---------- cache ---------- */
const inflight = new Map(); // to samo zapytanie w toku → jedna wspólna odpowiedź
async function cached(key, ttl, fetcher, { force = false, src = 'anilist' } = {}) {
  const hit = await IDB.get('cache', key);
  if (!force && hit && Date.now() - hit.t < ttl) return { data: hit.data, t: hit.t, stale: false, cache: true };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const data = await fetcher();
      await IDB.set('cache', key, { t: Date.now(), data });
      Net.ok(src);
      return { data, t: Date.now(), stale: false, cache: false };
    } catch (err) {
      if (err.kind !== 'notfound') Net.fail(src, err);
      if (hit) return { data: hit.data, t: hit.t, stale: true, cache: true, error: err };
      throw err;
    }
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

/* ---------- AniList ---------- */
async function aniPost(query, variables, attempt = 0) {
  // puste filtry pomijamy całkiem: jawne null bywa dla serwera czymś innym niż brak filtra
  const vars = Object.fromEntries(Object.entries(variables || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''));
  let res;
  try {
    res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: vars }),
    });
  } catch (e) {
    throw new ApiError('network', 'Brak połączenia z AniList.');
  }
  if (res.status === 429) {
    const ra = parseInt(res.headers.get('Retry-After'), 10) || 30;
    if (attempt < 3) {
      rateNotice(ra);
      await sleep((ra + 1) * 1000);
      return aniPost(query, variables, attempt + 1);
    }
    throw new ApiError('rate', 'AniList odrzuca zapytania z powodu limitu. Spróbuj za minutę.');
  }
  if (res.status >= 500 && attempt < 1) {
    await sleep(1200);
    return aniPost(query, variables, attempt + 1);
  }
  let json;
  try { json = await res.json(); } catch { throw new ApiError(res.status >= 500 ? 'server' : 'parse', `AniList zwrócił nieczytelną odpowiedź (HTTP ${res.status}).`, { status: res.status }); }
  if (json.errors && json.errors.length) {
    const nf = json.errors.some((e) => e.status === 404);
    if (nf) throw new ApiError('notfound', 'Nie znaleziono tego anime w AniList.');
    if (!json.data || Object.values(json.data).every((v) => v == null)) {
      const msg = json.errors.map((e) => e.message).join('; ');
      const server = res.status >= 500 || json.errors.some((e) => e.status >= 500) || /internal server error/i.test(msg);
      if (server) throw new ApiError('server', `Serwer AniList zgłosił błąd (HTTP ${res.status}: ${msg}).`, { status: res.status, raw: msg });
      if (res.status === 403) throw new ApiError('blocked', `AniList chwilowo nie przyjmuje zapytań (HTTP 403: ${msg}).`, { status: 403, raw: msg });
      throw new ApiError('graphql', `AniList odrzucił zapytanie: ${msg}`, { status: res.status, raw: msg });
    }
  }
  if (!res.ok && !json.data) throw new ApiError(res.status >= 500 ? 'server' : 'http', `AniList: HTTP ${res.status}`, { status: res.status });
  return json.data;
}

// Gdy AniList zgłasza błąd serwera, próbujemy lżejszej wersji zapytania (mniej pól).
// Wynik „lekki” trzymamy w cache tylko 10 minut, żeby szybko wrócić do pełnych danych.
async function gql(query, variables = {}, { ttl = 3600e3, key, force = false } = {}) {
  const k = key || 'gql:' + hashStr(query + JSON.stringify(variables));
  try {
    return await cached(k, ttl, () => aniLimit(() => aniPost(query, variables)), { force, src: 'anilist' });
  } catch (err) {
    const lite = LITE.get(query);
    if (!lite || !['server', 'graphql', 'parse'].includes(err.kind)) throw err;
    const data = await aniLimit(() => aniPost(lite, variables)).catch(() => { throw err; });
    await IDB.set('cache', k, { t: Date.now() - ttl + 10 * 60e3, data, lite: true });
    Net.ok('anilist');
    Net.state.anilist.lite = true;
    return { data, t: Date.now(), stale: false, lite: true };
  }
}

const F_MEDIA_CARD = `id idMal title{romaji english native} synonyms coverImage{large extraLarge color}
  bannerImage format status episodes duration season seasonYear
  startDate{year month day} endDate{year month day}
  nextAiringEpisode{airingAt episode timeUntilAiring}
  genres averageScore popularity isAdult siteUrl updatedAt`;

const F_MEDIA_FULL = `${F_MEDIA_CARD}
  description(asHtml:true) source(version:3) countryOfOrigin hashtag
  tags{name rank isMediaSpoiler category}
  studios{edges{isMain node{id name siteUrl}}}
  relations{edges{relationType(version:2) node{id idMal type format status episodes
    title{romaji english native} coverImage{large color} startDate{year month day} siteUrl}}}
  externalLinks{url site type language}
  trailer{id site thumbnail}
  streamingEpisodes{title thumbnail url site}
  stats{scoreDistribution{score amount}}
  rankings{rank type allTime season year format context}`;

const Q = {
  search: `query($q:String,$page:Int,$format:[MediaFormat],$status:MediaStatus,$year:Int,$genre:String,$sort:[MediaSort],$adult:Boolean){
    Page(page:$page,perPage:24){pageInfo{hasNextPage total}
      media(search:$q,type:ANIME,isAdult:$adult,format_in:$format,status:$status,seasonYear:$year,genre:$genre,sort:$sort){${F_MEDIA_CARD}}}}`,
  media: `query($id:Int){Media(id:$id,type:ANIME){${F_MEDIA_FULL}}}`,
  byIds: `query($ids:[Int],$page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage}
      media(id_in:$ids,type:ANIME){${F_MEDIA_CARD}}}}`,
  byMalIds: `query($ids:[Int],$page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage}
      media(idMal_in:$ids,type:ANIME){${F_MEDIA_CARD}}}}`,
  season: `query($season:MediaSeason,$year:Int,$page:Int){Page(page:$page,perPage:30){pageInfo{hasNextPage total}
      media(season:$season,seasonYear:$year,type:ANIME,isAdult:false,sort:[POPULARITY_DESC]){${F_MEDIA_CARD}}}}`,
  announced: `query($page:Int){Page(page:$page,perPage:40){pageInfo{hasNextPage total}
      media(status:NOT_YET_RELEASED,type:ANIME,isAdult:false,sort:[POPULARITY_DESC]){${F_MEDIA_CARD}}}}`,
  schedule: `query($from:Int,$to:Int,$page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage}
      airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:[TIME]){id airingAt episode
        media{id idMal title{romaji english native} coverImage{large color} format status episodes duration isAdult popularity countryOfOrigin}}}}`,
  genres: `query{GenreCollection}`,
  // postacie z japońskimi aktorami głosowymi i twórcy — strona anime
  people: `query($id:Int,$cp:Int,$sp:Int){Media(id:$id,type:ANIME){id
      characters(page:$cp,perPage:18,sort:[ROLE,RELEVANCE,ID]){pageInfo{hasNextPage}
        edges{role node{id name{full native} image{medium} siteUrl favourites}
          voiceActors(language:JAPANESE,sort:[RELEVANCE,ID]){id name{full native} image{medium}}}}
      staff(page:$sp,perPage:18,sort:[RELEVANCE,ID]){pageInfo{hasNextPage}
        edges{role node{id name{full native} image{medium}}}}}}`,
  // strona osoby (aktor głosowy albo twórca)
  person: `query($id:Int,$page:Int){Staff(id:$id){id name{full native alternative} image{large medium}
      description(asHtml:true) primaryOccupations gender dateOfBirth{year month day} age homeTown yearsActive languageV2 siteUrl favourites
      characterMedia(page:$page,perPage:25,sort:[POPULARITY_DESC]){pageInfo{hasNextPage}
        edges{characterRole node{id idMal type format status episodes duration seasonYear startDate{year month day} isAdult
          title{romaji english native} coverImage{large color} siteUrl} characters{id name{full} image{medium}}}}
      staffMedia(page:$page,perPage:25,sort:[POPULARITY_DESC],type:ANIME){pageInfo{hasNextPage}
        edges{staffRole node{id idMal type format status episodes duration seasonYear startDate{year month day} isAdult
          title{romaji english native} coverImage{large color} siteUrl}}}}}`,
  // dane do statystyk dla nerda: studia, źródło, tagi, rankingi, rozkład ocen, główna obsada i twórcy
  extra: `query($ids:[Int],$n:Int){Page(perPage:$n){media(id_in:$ids,type:ANIME){id source(version:3) popularity favourites
      studios{edges{isMain node{id name}}}
      tags{name rank isMediaSpoiler}
      rankings{rank type allTime season year format context}
      stats{scoreDistribution{score amount}}
      characters(perPage:8,sort:[ROLE,RELEVANCE,ID]){edges{role node{id name{full} image{medium}}
        voiceActors(language:JAPANESE,sort:[RELEVANCE,ID]){id name{full native} image{medium}}}}
      staff(perPage:10,sort:[RELEVANCE,ID]){edges{role node{id name{full} image{medium}}}}}}}`,
  // kolejność oglądania: kolejne „piętra” relacji serii (tylko anime)
  relations: `query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){id idMal type format status episodes duration
      season seasonYear startDate{year month day} endDate{year month day} isAdult genres averageScore popularity synonyms
      title{romaji english native} coverImage{large color} siteUrl nextAiringEpisode{airingAt episode}
      relations{edges{relationType(version:2) node{id idMal type format status episodes isAdult
        title{romaji english native} coverImage{large color} startDate{year month day} siteUrl}}}}}}`,
  ngnl: `query{
      main: Media(idMal:19815,type:ANIME){${F_MEDIA_FULL}}
      franchise: Page(perPage:25){media(search:"No Game No Life",type:ANIME,sort:[START_DATE]){
        id idMal title{romaji english native} format status episodes startDate{year month day}
        coverImage{large color} bannerImage siteUrl nextAiringEpisode{airingAt episode}}}
    }`,
};

// lżejsze wersje zapytań na wypadek błędów serwera AniList
const F_CARD_LITE = `id idMal title{romaji english native} coverImage{large color} format status episodes duration
  seasonYear startDate{year month day} nextAiringEpisode{airingAt episode} genres isAdult siteUrl`;
const F_FULL_LITE = `${F_CARD_LITE} description`;
const LITE = new Map(Object.values(Q)
  .filter((q) => q.includes(F_MEDIA_CARD))
  .map((q) => [q, q.split(F_MEDIA_FULL).join(F_FULL_LITE).split(F_MEDIA_CARD).join(F_CARD_LITE)]));

/* ---------- test połączenia (Ustawienia → Test połączenia) ---------- */
async function diagnoseApis(onStep) {
  const probes = [
    ['AniList: najprostsze zapytanie', 'anilist', `query{Media(id:1,type:ANIME){id title{romaji}}}`, {}],
    ['AniList: wyszukiwanie „no game”', 'anilist', Q.search, { q: 'no game', page: 1, sort: ['SEARCH_MATCH'] }],
    ['AniList: przeglądanie bez tytułu', 'anilist', Q.search, { page: 1, sort: ['TRENDING_DESC'] }],
    ['AniList: wyszukiwanie w wersji lekkiej', 'anilist', LITE.get(Q.search), { q: 'no game', page: 1, sort: ['SEARCH_MATCH'] }],
    ['AniList: szczegóły anime', 'anilist', Q.media, { id: 19815 }],
    ['AniList: moduł No Game No Life', 'anilist', Q.ngnl, {}],
    ['AniList: harmonogram emisji', 'anilist', Q.schedule, { from: Math.floor(Date.now() / 1000), to: Math.floor(Date.now() / 1000) + 86400, page: 1 }],
    ['AniList: zapowiedzi', 'anilist', Q.announced, { page: 1 }],
    ['Jikan (MyAnimeList)', 'jikan', '/anime/19815', null],
  ];
  const out = [];
  for (const [name, src, q, v] of probes) {
    const t0 = performance.now();
    let row;
    try {
      if (src === 'anilist') await aniLimit(() => aniPost(q, v, 1));
      else await jikanGet(q, 0);
      row = { name, ok: true, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      row = { name, ok: false, ms: Math.round(performance.now() - t0), kind: e.kind || 'error', msg: e.message };
    }
    out.push(row);
    if (onStep) onStep(out.slice());
  }
  return {
    at: new Date().toISOString(),
    env: { protocol: location.protocol, origin: location.origin, online: navigator.onLine, ua: navigator.userAgent },
    results: out,
  };
}

const Ani = {
  async search(params) {
    const vars = {
      q: params.q || null,
      page: params.page || 1,
      format: params.format ? [params.format] : null,
      status: params.status || null,
      year: params.year ? Number(params.year) : null,
      genre: params.genre || null,
      sort: [params.sort || (params.q ? 'SEARCH_MATCH' : 'POPULARITY_DESC')],
      // 18+: przy włączonym przełączniku filtr pomijamy całkiem (zwraca obie grupy)
      adult: S.settings.adult ? null : false,
    };
    const r = await gql(Q.search, vars, { ttl: 6 * 3600e3 });
    return { ...r, items: (r.data.Page.media || []).filter((m) => S.settings.adult || !m.isAdult), pageInfo: r.data.Page.pageInfo };
  },
  async media(id, opts = {}) {
    const r = await gql(Q.media, { id: Number(id) }, { ttl: 6 * 3600e3, key: 'media:' + id, ...opts });
    return { ...r, media: r.data.Media };
  },
  async byIds(ids, { force = false } = {}) {
    const out = [];
    let stale = false;
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const r = await gql(Q.byIds, { ids: chunk, page: 1 }, { ttl: force ? 0 : 1800e3, key: 'ids:' + hashStr(chunk.join(',')), force });
      stale = stale || r.stale;
      out.push(...(r.data.Page.media || []));
    }
    return { media: out, stale };
  },
  async byMalIds(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const r = await gql(Q.byMalIds, { ids: chunk, page: 1 }, { ttl: 600e3 });
      out.push(...(r.data.Page.media || []));
    }
    return out;
  },
  async season(season, year, page = 1) {
    const r = await gql(Q.season, { season, year, page }, { ttl: 6 * 3600e3 });
    return { ...r, items: r.data.Page.media || [], pageInfo: r.data.Page.pageInfo };
  },
  async announced(page = 1) {
    const r = await gql(Q.announced, { page }, { ttl: 6 * 3600e3 });
    return { ...r, items: r.data.Page.media || [], pageInfo: r.data.Page.pageInfo };
  },
  async schedule(days = 7) {
    // okno liczone od pełnej godziny → stabilny klucz cache przez godzinę
    const from = Math.floor(Date.now() / 3600e3) * 3600 - 3600;
    const to = from + days * 86400 + 3600;
    const items = [];
    let stale = false, t = Date.now();
    for (let page = 1; page <= 4; page++) {
      const r = await gql(Q.schedule, { from, to, page }, { ttl: 1800e3 });
      stale = stale || r.stale;
      t = Math.min(t, r.t);
      items.push(...(r.data.Page.airingSchedules || []));
      if (!r.data.Page.pageInfo.hasNextPage) break;
    }
    return { items: items.filter((x) => x.media && !x.media.isAdult), stale, t };
  },
  async genres() {
    const r = await gql(Q.genres, {}, { ttl: 7 * 86400e3, key: 'genres' });
    return r.data.GenreCollection || [];
  },
  async people(id, cp = 1, sp = 1) {
    const r = await gql(Q.people, { id: Number(id), cp, sp }, { ttl: 7 * 86400e3 });
    return { ...r, media: r.data.Media };
  },
  async person(id, page = 1) {
    const r = await gql(Q.person, { id: Number(id), page }, { ttl: 3 * 86400e3 });
    return { ...r, staff: r.data.Staff };
  },
  async relations(ids, { ttl = 7 * 86400e3, force = false } = {}) {
    const sorted = ids.slice().sort((a, b) => a - b);
    const r = await gql(Q.relations, { ids: sorted }, { ttl: force ? 0 : ttl, force, key: 'rel:' + hashStr(sorted.join(',')) });
    return (r.data.Page && r.data.Page.media) || [];
  },
  // bez własnej pamięci podręcznej: wynik zapisuje moduł Extras
  async extra(ids) {
    const data = await aniLimit(() => aniPost(Q.extra, { ids, n: ids.length }));
    Net.ok('anilist');
    return (data.Page && data.Page.media) || [];
  },
  async ngnl(opts = {}) {
    const r = await gql(Q.ngnl, {}, { ttl: 6 * 3600e3, key: 'ngnl', ...opts });
    return { ...r, main: r.data.main, franchise: (r.data.franchise && r.data.franchise.media) || [] };
  },
};

/* ---------- Jikan ---------- */
// Każda próba (także ponowienie) przechodzi przez ogranicznik: max ~1 start na 1,2 s,
// więc nie wpadamy w limit 3/s. Błędy 5xx (np. 504) oznaczają, że Jikan nie doczekał
// się odpowiedzi od MyAnimeList — ponawiamy raz, potem zgłaszamy „upstream”.
async function jikanGet(path, retries5xx = 1) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try { res = await jikanLimit(() => fetch(JIKAN_URL + path, { headers: { Accept: 'application/json' } })); }
    catch { throw new ApiError('network', 'Brak połączenia z Jikan (MyAnimeList).'); }
    if (res.status === 429 && attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
    if (res.status >= 500 && attempt < retries5xx) { await sleep(4000); continue; }
    if (res.status === 404) throw new ApiError('notfound', 'Brak wpisu w MyAnimeList.');
    if (res.status >= 500) throw new ApiError('upstream', `MyAnimeList chwilowo nie odpowiada (HTTP ${res.status}). To przeciążenie po stronie Jikan/MyAnimeList, nie Twojej aplikacji.`, { status: res.status });
    if (res.status === 429) throw new ApiError('rate', 'Jikan: za dużo zapytań naraz (HTTP 429).', { status: 429 });
    if (!res.ok) throw new ApiError('http', `Jikan: HTTP ${res.status}`, { status: res.status });
    try { return await res.json(); } catch { throw new ApiError('parse', 'Jikan zwrócił nieczytelną odpowiedź.'); }
  }
}

const Jikan = {
  get(path, ttl = 6 * 3600e3, opts = {}) {
    return cached('jikan:' + path, ttl, () => jikanGet(path), { src: 'jikan', ...opts });
  },
  async animeFull(malId) { const r = await this.get(`/anime/${malId}/full`, 24 * 3600e3); return r.data.data; },
  async news(kind, malId, opts) { const r = await this.get(`/${kind}/${malId}/news`, 3 * 3600e3, opts); return { ...r, items: r.data.data || [] }; },
  async videos(malId) { const r = await this.get(`/anime/${malId}/videos`, 12 * 3600e3); return r.data.data || {}; },
  async pictures(malId) { const r = await this.get(`/anime/${malId}/pictures`, 24 * 3600e3); return r.data.data || []; },
  // zapasowe wyszukiwanie, gdy AniList nie działa
  async search(q) {
    const path = q ? `/anime?q=${encodeURIComponent(q)}${S.settings.adult ? '' : '&sfw=true'}&limit=24` : '/top/anime?filter=airing&sfw=true&limit=24';
    const r = await this.get(path, 3 * 3600e3);
    return { ...r, items: r.data.data || [] };
  },
};

/* ---------- Google News RSS przez rss2json (działa prosto z przeglądarki) ---------- */
// Google News nie pozwala przeglądarce czytać RSS bezpośrednio (brak CORS);
// darmowy rss2json.com zamienia kanał na JSON z nagłówkami CORS. Bez klucza: do 10 pozycji na kanał.
const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';
function googleNewsUrl(q, lang) {
  return lang === 'ja'
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`
    : `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}
const Rss = {
  async google(q, lang, { force = false } = {}) {
    const url = googleNewsUrl(q, lang);
    const r = await cached('rss:' + hashStr(url), 2 * 3600e3, async () => {
      let res;
      try { res = await fetch(RSS2JSON + encodeURIComponent(url), { headers: { Accept: 'application/json' } }); }
      catch { throw new ApiError('network', 'Brak połączenia z rss2json.com.'); }
      if (res.status === 429) throw new ApiError('rate', 'rss2json: dzienny limit darmowych zapytań wyczerpany (HTTP 429).');
      if (!res.ok) throw new ApiError(res.status >= 500 ? 'upstream' : 'http', `rss2json: HTTP ${res.status}`);
      let json;
      try { json = await res.json(); } catch { throw new ApiError('parse', 'rss2json zwrócił nieczytelną odpowiedź.'); }
      if (json.status !== 'ok') throw new ApiError('rss', `rss2json: ${json.message || 'błąd kanału'}`);
      return json.items || [];
    }, { force, src: 'rss' });
    const items = r.data.map((it) => {
      // Google News: „Tytuł - Źródło”
      let title = String(it.title || '').trim();
      let source = (it.author || '').trim();
      const cut = title.lastIndexOf(' - ');
      if (cut > 10 && title.length - cut <= 70) {
        if (!source) source = title.slice(cut + 3).trim();
        title = title.slice(0, cut).trim();
      }
      const ts = it.pubDate ? Date.parse(String(it.pubDate).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(it.pubDate) ? '' : 'Z')) : NaN;
      return { title, source: source || 'Google News', url: it.link, date: Number.isFinite(ts) ? ts : null, image: it.thumbnail || null };
    }).filter((x) => x.title && x.url);
    return { items, stale: r.stale, t: r.t };
  },
};

/* ---------- własny feed RSS (opcjonalny) ---------- */
async function loadFeed({ force = false } = {}) {
  const url = S.settings.feedUrl;
  if (!url) return { items: [], disabled: true };
  if (location.protocol === 'file:' && !/^https?:/i.test(url)) {
    return { items: [], unavailable: 'Plik otwarty z dysku: przeglądarka blokuje odczyt lokalnego feedu. Po wrzuceniu na hosting zadziała.' };
  }
  try {
    const r = await cached('feed:' + url, 30 * 60e3, async () => {
      let res;
      try { res = await fetch(url, { cache: 'no-store' }); } catch { throw new ApiError('network', 'Nie udało się pobrać feedu.'); }
      if (!res.ok) throw new ApiError('http', `Feed: HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.items)) throw new ApiError('parse', 'Feed ma nieprawidłowy format.');
      return json;
    }, { force, src: 'feed' });
    return { ...r.data, stale: r.stale, fetchedAt: r.t };
  } catch (e) {
    return { items: [], unavailable: e.message };
  }
}

async function clearApiCache() {
  await IDB.clear('cache');
}

/* ---------- trace.moe: rozpoznawanie anime ze zrzutu ekranu ---------- */
// Bez klucza: limit dzienny (okno 24 h) liczony dla Twojego adresu IP, jedno wyszukiwanie naraz.
const TRACE_URL = 'https://api.trace.moe';
const Trace = {
  async me() {
    let res;
    try { res = await fetch(`${TRACE_URL}/me`, { cache: 'no-store' }); } catch { throw new ApiError('network', 'Brak połączenia z trace.moe.'); }
    if (!res.ok) throw new ApiError('http', `trace.moe: HTTP ${res.status}`, { status: res.status });
    return res.json();
  },
  // input: Blob (obraz) albo adres URL obrazka
  async search(input) {
    const qs = '?anilistInfo=1&cutBorders=1';
    let res;
    try {
      res = typeof input === 'string'
        ? await fetch(`${TRACE_URL}/search${qs}&url=${encodeURIComponent(input)}`)
        : await fetch(`${TRACE_URL}/search${qs}`, { method: 'POST', body: input, headers: { 'Content-Type': input.type || 'image/jpeg' } });
    } catch { throw new ApiError('network', 'Brak połączenia z trace.moe. Sprawdź internet i spróbuj ponownie.'); }
    let json = null;
    try { json = await res.json(); } catch { /* bywa pusta odpowiedź przy błędzie */ }
    const msg = json && json.error ? String(json.error) : '';
    if (res.status === 402) throw new ApiError('quota', msg && /concurren/i.test(msg) ? 'Poprzednie wyszukiwanie jeszcze trwa. Poczekaj chwilę.' : 'Wykorzystałeś dzienny limit wyszukiwań trace.moe. Licznik odnawia się w ciągu 24 godzin.', { status: 402 });
    if (res.status === 429) throw new ApiError('rate', 'trace.moe: za dużo wyszukiwań w krótkim czasie. Odczekaj kilka sekund.', { status: 429 });
    if (res.status === 400) throw new ApiError('bad', `trace.moe nie odczytał obrazka${msg ? ` (${msg})` : ''}. Spróbuj innego pliku albo zrzutu ekranu.`, { status: 400 });
    if (res.status === 413) throw new ApiError('bad', 'Obrazek jest za duży dla trace.moe.', { status: 413 });
    if (res.status >= 500) throw new ApiError('server', `Serwer trace.moe jest przeciążony (HTTP ${res.status}). Spróbuj za chwilę.`, { status: res.status });
    if (!res.ok) throw new ApiError('http', `trace.moe: HTTP ${res.status}${msg ? ` · ${msg}` : ''}`, { status: res.status });
    if (msg) throw new ApiError('trace', `trace.moe: ${msg}`);
    return { frameCount: json.frameCount || 0, result: Array.isArray(json.result) ? json.result : [] };
  },
};
