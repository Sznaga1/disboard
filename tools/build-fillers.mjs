#!/usr/bin/env node
/* ==========================================================================
   Disboard — własna baza fillerów i recapów (zamiast Jikan)
   Uruchamiane przez GitHub Actions co 3 godziny (lub ręcznie:
   node tools/build-fillers.mjs [--minutes=20] [--max=100] [--only=21,1735]).

   Jikan (nieoficjalne API MyAnimeList) przestał odpowiadać, a tylko on dawał
   oznaczenia fillerów. Te same oznaczenia leżą na stronach odcinków MyAnimeList
   (myanimelist.net/anime/{id}/_/episode), więc czytamy je stamtąd sami:
     • lista serii: AniList (TV, TV_SHORT, ONA, OVA, SPECIAL z numerem MAL):
       wszystkie od 20 odcinków i trwające, a po nich krótsze (2–19 odcinków)
       o popularności > 2000; lista trzymana dobę w data/fillers-targets.json,
     • strony odcinków MAL: po 100 odcinków na stronę, jedno zapytanie na ~1,5 s,
     • kolejność: nowe długie, trwające (co tydzień tylko ostatnia strona), nowe
       krótkie, potem najdawniej sprawdzane (zakończone co 90 dni, krótkie co 180).
   Każdy przebieg ma limit czasu; to, czego nie zdążył, zrobi następny.

   Wynik:
     data/fillers.json  { v, built, total, s: { malId: { d, n, f?, r? } } }
                        d = dzień sprawdzenia (dni od 1970-01-01), n = liczba odcinków,
                        f/r = zakresy fillerów/recapów [[od, do], …]
     data/eps/NN.json   oceny odcinków (skala 1–5) dla malId % 100 = NN:
                        { malId: [ocena odc. 1, ocena odc. 2, …] } (null = brak głosów)
   ========================================================================== */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/fillers.json');
const EPS_DIR = resolve(ROOT, 'data/eps');
const TARGETS = resolve(ROOT, 'data/fillers-targets.json');
const TARGETS_TTL = 20 * 3600e3;
const SHARDS = 100;

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const BUDGET_MS = Number(args.minutes || 20) * 60e3;   // czas na strony MAL w jednym przebiegu
const MAX_SERIES = args.max ? Number(args.max) : Infinity;
const ONLY = args.only ? new Set(args.only.split(',').map(Number)) : null;
const MAL_GAP = 1500;          // odstęp między zapytaniami do MAL
const ANI_GAP = 2200;          // AniList: tryb ograniczony 30/min
const MIN_EPS = 20;            // tak jak w aplikacji: fillery liczymy w seriach od 20 odcinków
const REFRESH_DONE = 90;       // dni: zakończone serie
const REFRESH_SHORT = 180;     // dni: zakończone krótkie serie (fillery tam to rzadkość)
const REFRESH_LIVE = 6;        // dni: trwające serie (ostatnia strona)
const MAX_PAGES = 30;          // jak dawniej przy Jikan: najwyżej 3000 odcinków

const UA = 'Mozilla/5.0 (compatible; DisboardFillers/1.0; +https://github.com/Sznaga1/disboard)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => Math.floor(Date.now() / 864e5);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------- pomocnicze ---------- */
export function toRanges(nums) {
  const out = [];
  for (const n of [...new Set(nums)].sort((a, b) => a - b)) { const l = out[out.length - 1]; if (l && n === l[1] + 1) l[1] = n; else out.push([n, n]); }
  return out;
}
const fromRanges = (r) => { const s = new Set(); for (const [a, b] of r || []) for (let i = a; i <= b; i++) s.add(i); return s; };
async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

/* ---------- AniList: lista serii do sprawdzenia ---------- */
const FORMATS = '[TV,TV_SHORT,ONA,OVA,SPECIAL]';
const Q = `query($p:Int,$min:Int,$max:Int,$popG:Int,$popL:Int,$status:MediaStatus){Page(page:$p,perPage:50){pageInfo{hasNextPage}
  media(type:ANIME,episodes_greater:$min,episodes_lesser:$max,popularity_greater:$popG,popularity_lesser:$popL,status:$status,format_in:${FORMATS},sort:POPULARITY_DESC){
    id idMal episodes status popularity nextAiringEpisode{episode}}}}`;
async function aniPage(vars, attempt = 0) {
  let res;
  try {
    res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query: Q, variables: vars }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    if (attempt < 4) { await sleep(5000 * (attempt + 1)); return aniPage(vars, attempt + 1); }
    throw e;
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 5) { await sleep(((Number(res.headers.get('retry-after')) || 30) + 1) * 1000); return aniPage(vars, attempt + 1); }
    throw new Error(`AniList HTTP ${res.status}`);
  }
  const j = await res.json();
  if (j.errors) throw new Error('AniList: ' + j.errors.map((x) => x.message).join('; '));
  return j.data.Page;
}
// Dwie grupy:
//  • długie (od 20 odcinków): fillery do pomijania i statystyk; wszystkie, jakie zna AniList,
//  • krótkie (2–19 odcinków, popularność > 2000): na stronie anime oceny odcinków i rzadkie
//    recapy; sprawdzane po długich. AniList daje najwyżej 100 stron na zapytanie, więc
//    krótkie dzielimy na pasma popularności (każde < 5000 serii).
const SHORT_BANDS = [[30000, null], [8000, 30001], [2000, 8001]];
async function fetchTargets() {
  const map = new Map();
  const add = (m, kind) => {
    if (!m.idMal) return;
    const aired = m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : 0;
    const n = Math.max(m.episodes || 0, aired);
    // trwające: długa albo krótka zależnie od liczby odcinków (często jeszcze nieznanej)
    const short = kind === 'auto' ? n < MIN_EPS : kind;
    if (short ? n < 2 : n < MIN_EPS) return;
    const old = map.get(m.idMal);
    if (old && !old.short) return; // seria długa ma pierwszeństwo
    map.set(m.idMal, { mal: m.idMal, n, live: m.status === 'RELEASING', pop: m.popularity || 0, short: !!short });
  };
  const runs = [
    [{ min: MIN_EPS - 1 }, false],    // wszystkie od 20 odcinków (podana liczba)
    [{ status: 'RELEASING' }, 'auto'], // trwające bez podanej liczby (np. One Piece)
    ...SHORT_BANDS.map(([g, l]) => [{ min: 1, max: MIN_EPS, popG: g, ...(l ? { popL: l } : {}) }, true]),
  ];
  for (const [vars, short] of runs) {
    for (let p = 1; p <= 100; p++) {
      const pg = await aniPage({ ...vars, p });
      pg.media.forEach((m) => add(m, short));
      if (!pg.pageInfo.hasNextPage) break;
      if (p === 100) log(`Uwaga: zapytanie ${JSON.stringify(vars)} doszło do limitu 100 stron`);
      await sleep(ANI_GAP);
    }
    log(`AniList: ${map.size} serii po zapytaniu ${JSON.stringify(vars)}`);
  }
  // w kolejności priorytetu: długie, potem krótkie, w każdej grupie od najpopularniejszych
  return [...map.values()].sort((a, b) => a.short - b.short || b.pop - a.pop);
}
// lista z AniList zmienia się powoli: trzymamy ją dobę w data/fillers-targets.json
// (bez popularności, sama kolejność), żeby nie pytać o ~180 stron co 3 godziny
async function targets() {
  const old = await readJson(TARGETS, null);
  if (old && Array.isArray(old.list) && Date.now() - Date.parse(old.at) < TARGETS_TTL) {
    log(`Lista serii z ${old.at} (${old.list.length})`);
    return old.list.map(([mal, n, live, short], i) => ({ mal, n, live: !!live, short: !!short, pop: old.list.length - i }));
  }
  const list = await fetchTargets();
  const body = list.map((t) => JSON.stringify([t.mal, t.n, t.live ? 1 : 0, t.short ? 1 : 0])).join(',\n');
  await writeFile(TARGETS, `{"at":${JSON.stringify(new Date().toISOString())},"list":[\n${body}\n]}\n`);
  return list;
}

/* ---------- MyAnimeList: strona odcinków ---------- */
const decode = (s) => s.replace(/&#0*39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
export function parseEpisodes(html, offset = 0) {
  const rows = [];
  const parts = html.split('<tr class="episode-list-data">').slice(1);
  for (const p of parts) {
    const row = p.split('</tr>')[0];
    const num = row.match(/class="episode-number[^"]*"\s+data-raw="(\d+)"/);
    if (!num) continue;
    const type = (row.match(/icon-episode-type-bg">\s*([A-Za-z]+)\s*</) || [])[1] || '';
    const sc = row.match(/class="episode-poll[^"]*"[^>]*data-raw="([\d.]+)"/);
    const score = sc ? Number(sc[1]) : null;
    rows.push({ n: Number(num[1]), filler: /^filler$/i.test(type), recap: /^recap$/i.test(type), score: score > 0 ? score : null });
  }
  // pasek stron („1 - 100 · 101 - 200 · … · 1101 - 1180”): jest dalej, gdy widać większy offset
  const offs = [...html.matchAll(/\/episode\?offset=(\d+)"/g)].map((m) => Number(m[1]));
  const hasNext = offs.some((o) => o > offset);
  const title = decode((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '');
  return { rows, hasNext, title };
}

class MalError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }
let lastMal = 0;
async function malPage(id, offset) {
  const url = `https://myanimelist.net/anime/${id}/_/episode${offset ? `?offset=${offset}` : ''}`;
  for (let attempt = 0; ; attempt++) {
    const wait = lastMal + MAL_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastMal = Date.now();
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    } catch {
      if (attempt < 2) { await sleep(10000); continue; }
      throw new MalError('MAL nie odpowiada', 'network');
    }
    if (res.status === 404) throw new MalError('brak w MAL', 'notfound');
    if (res.status === 429 || res.status === 403 || res.status >= 500) {
      if (attempt < 3) { await sleep(30000 * (attempt + 1)); continue; }
      throw new MalError(`MAL HTTP ${res.status}`, res.status === 403 ? 'blocked' : 'busy');
    }
    if (!res.ok) throw new MalError(`MAL HTTP ${res.status}`, 'http');
    const html = await res.text();
    // strona bez tabeli odcinków, ale też bez śladu anime = coś nas zatrzymało (np. captcha)
    if (!html.includes('episode_video') && !html.includes('episode-list') && !html.includes('og:title')) {
      if (attempt < 2) { await sleep(30000); continue; }
      throw new MalError('MAL zwrócił stronę bez danych', 'blocked');
    }
    return parseEpisodes(html, offset);
  }
}

// cała seria albo (od strony `fromPage`) jej końcówka
async function scrape(id, fromPage = 0) {
  const rows = [];
  let pages = 0;
  for (let p = fromPage; p < MAX_PAGES; p++) {
    const r = await malPage(id, p * 100);
    pages++;
    rows.push(...r.rows);
    if (!r.hasNext || r.rows.length < 100) break;
  }
  return { rows, pages };
}

/* ---------- główny przebieg ---------- */
async function main() {
  let t0 = Date.now();
  const idx = await readJson(OUT, null) || { v: 1, s: {} };
  idx.s = idx.s || {};
  const shards = new Map();
  const shardOf = async (id) => {
    const k = id % SHARDS;
    if (!shards.has(k)) shards.set(k, { data: await readJson(resolve(EPS_DIR, `${String(k).padStart(2, '0')}.json`), {}), dirty: false });
    return shards.get(k);
  };

  const list = ONLY ? [...ONLY].map((mal) => ({ mal, n: 0, live: false, pop: 0, short: false })) : await targets();
  t0 = Date.now(); // limit czasu liczymy od pierwszej strony MAL
  const now = today();
  // kolejność: 0 nowe długie, 1 trwające (końcówka co tydzień), 2 nowe krótkie, 3 przeterminowane
  const due = (t) => {
    const e = idx.s[t.mal];
    if (!e) return { need: true, rank: t.short ? 2 : 0, part: false };
    if (ONLY) return { need: true, rank: 0, part: false };
    const age = now - e.d;
    const fullAge = now - (e.full || e.d);
    const keep = t.short ? REFRESH_SHORT : REFRESH_DONE;
    if (t.live && fullAge < REFRESH_DONE) return { need: age >= REFRESH_LIVE, rank: 1, part: true };
    return { need: fullAge >= keep, rank: 3, part: false };
  };
  const byAge = (a, b) => ((idx.s[a.t.mal] || {}).d || 0) - ((idx.s[b.t.mal] || {}).d || 0);
  const queue = list.map((t) => ({ t, ...due(t) })).filter((x) => x.need)
    .sort((a, b) => a.rank - b.rank || (a.rank === 0 || a.rank === 2 ? b.t.pop - a.t.pop : byAge(a, b)));
  log(`Serii w bazie: ${Object.keys(idx.s).length}, cel: ${list.length}, do sprawdzenia teraz: ${queue.length}`);

  let done = 0, pages = 0, failed = 0, stop = null;
  // zapis postępu: co 100 serii, na końcu i przy przerwaniu (Ctrl+C, anulowanie w Actions),
  // żeby przerwany przebieg nie tracił tego, co już pobrał
  let saving = Promise.resolve();
  const save = () => (saving = saving.then(async () => {
    const head = {
      v: 1,
      built: new Date().toISOString(),
      total: ONLY ? idx.total || 0 : list.length,
      src: 'MyAnimeList (strony odcinków), lista serii z AniList',
    };
    // jedna seria na linię: czytelne zmiany w historii repozytorium
    const body = Object.entries(idx.s).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n');
    await mkdir(EPS_DIR, { recursive: true });
    await writeFile(OUT, `${JSON.stringify(head).slice(0, -1)},"s":{\n${body}\n}}\n`);
    for (const [k, sh] of shards) {
      if (!sh.dirty) continue;
      const b = Object.entries(sh.data).sort((x, y) => Number(x[0]) - Number(y[0])).map(([id, v]) => `${JSON.stringify(id)}:${JSON.stringify(v)}`).join(',\n');
      await writeFile(resolve(EPS_DIR, `${String(k).padStart(2, '0')}.json`), `{\n${b}\n}\n`);
      sh.dirty = false;
    }
  }));
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      log(`Przerwane (${sig}): zapisuję ${done} sprawdzonych serii`);
      (done ? save() : Promise.resolve()).finally(() => process.exit(130));
    });
  }
  for (const { t, part } of queue) {
    if (done >= MAX_SERIES) break;
    if (!ONLY && Date.now() - t0 > BUDGET_MS) { stop = 'czas'; break; }
    const old = idx.s[t.mal];
    const fromPage = part && old && old.n ? Math.floor((old.n - 1) / 100) : 0;
    try {
      const r = await scrape(t.mal, fromPage);
      pages += r.pages;
      const sh = await shardOf(t.mal);
      // przy odświeżaniu końcówki zachowujemy wcześniejsze odcinki
      const keepBelow = fromPage * 100;
      const f = new Set([...fromRanges(old && fromPage ? old.f : [])].filter((n) => n <= keepBelow));
      const rc = new Set([...fromRanges(old && fromPage ? old.r : [])].filter((n) => n <= keepBelow));
      const scores = (fromPage && Array.isArray(sh.data[t.mal]) ? sh.data[t.mal].slice(0, keepBelow) : []);
      for (const x of r.rows) {
        if (x.filler) f.add(x.n);
        if (x.recap) rc.add(x.n);
        scores[x.n - 1] = x.score;
      }
      const maxN = Math.max(0, ...r.rows.map((x) => x.n), fromPage ? (old.n || 0) : 0);
      const e = { d: now, n: Math.max(maxN, t.n || 0) };
      // full = dzień ostatniego pełnego sprawdzenia; brak pola = pełne było w dniu d
      if (fromPage) e.full = old.full || old.d;
      const fr = toRanges([...f]), rr = toRanges([...rc]);
      if (fr.length) e.f = fr;
      if (rr.length) e.r = rr;
      idx.s[t.mal] = e;
      const sc = Array.from({ length: maxN }, (_, i) => (scores[i] == null ? null : Math.round(scores[i] * 100) / 100));
      if (sc.some((x) => x != null)) { sh.data[t.mal] = sc; sh.dirty = true; }
      else if (sh.data[t.mal]) { delete sh.data[t.mal]; sh.dirty = true; }
      done++;
      if (done % 100 === 0) await save();
      if (done % 25 === 0 || ONLY) log(`${done}/${queue.length} · MAL ${t.mal}: ${e.n} odc., fillery ${countR(e.f)}, recapy ${countR(e.r)} · stron ${pages}`);
    } catch (err) {
      if (err.kind === 'notfound') { idx.s[t.mal] = { d: now, n: t.n || 0 }; done++; continue; }
      failed++;
      log(`MAL ${t.mal}: ${err.message}`);
      if (err.kind === 'blocked' || err.kind === 'network' || err.kind === 'busy') { stop = err.message; break; }
      if (failed >= 10) { stop = 'za dużo błędów'; break; }
    }
  }

  const left = queue.length - done;
  log(`Gotowe: ${done} serii, ${pages} stron MAL, błędów ${failed}, zostało ${left}${stop ? ` (przerwane: ${stop})` : ''}, ${Math.round((Date.now() - t0) / 1000)} s`);
  // blokada MAL bez żadnego postępu = czerwony przebieg, żeby było widać w Actions
  if (stop && stop !== 'czas' && !done) process.exitCode = 1;
  // nic nie sprawdzone = nic do zapisania (bez pustych commitów co 3 godziny)
  if (!done) return;
  await save();
}
const countR = (r) => (r || []).reduce((x, [a, b]) => x + b - a + 1, 0);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
