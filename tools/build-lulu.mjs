#!/usr/bin/env node
/* ==========================================================================
   Disboard — centrum Lulu (League of Legends)
   Uruchamiane przez GitHub Actions co 6 godzin (lub ręcznie: node tools/build-lulu.mjs).
   Zbiera z publicznych źródeł wszystko, co dotyczy Lulu, i zapisuje to w data/lulu.json:
     • CommunityDragon, serwer główny i PBE (testowy): skiny, chromy, ikony,
       totemy oraz WSZYSTKIE emotki z gry (wybór, które widać, robi się w aplikacji),
     • oficjalne notatki do patchy z leagueoflegends.com: fragmenty o Lulu,
     • Google News: artykuły o Lulu.
   Data pierwszego wykrycia każdej rzeczy zostaje zapamiętana między przebiegami,
   dzięki temu aplikacja wie, co jest nowe. Plik zapisujemy tylko, gdy coś się zmieniło.
   ========================================================================== */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed, stripTags, decode } from './build-feed.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/lulu.json');

const CHAMP_ID = 117; // Lulu
const LULU = /\blulu\b/i;
const CD = (env) => `https://raw.communitydragon.org/${env}/plugins/rcp-be-lol-game-data/global/default`;
const LOL_NEWS = 'https://www.leagueoflegends.com/en-us/news/game-updates/';
const PATCH_KEEP = 12;        // ile ostatnich notatek do patchy przeglądamy
const NEWS_DAYS = 400;

const gnews = (q, hl, gl, ceid) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
const NEWS_SOURCES = [
  { id: 'gnews-en', name: 'Google News (EN)', url: gnews('Lulu "League of Legends"', 'en-US', 'US', 'US:en') },
  { id: 'gnews-pl', name: 'Google News (PL)', url: gnews('Lulu "League of Legends"', 'pl', 'PL', 'PL:pl') },
];

const RARITY = { kNoRarity: '', kRare: 'Rare', kEpic: 'Epic', kLegendary: 'Legendary', kMythic: 'Mythic', kUltimate: 'Ultimate', kTranscendent: 'Transcendent', kExalted: 'Exalted' };

/* ---------- pomocnicze ---------- */
// „/lol-game-data/assets/ASSETS/X.png” → „assets/x.png” (CommunityDragon trzyma ścieżki małymi literami)
export const imgPath = (p) => (p ? String(p).replace(/^\/lol-game-data\/assets\//i, '').toLowerCase() : null);
const regionText = (arr) => {
  if (!Array.isArray(arr) || !arr.length) return '';
  const r = arr.find((x) => x.region === 'riot') || arr[0];
  return (r && r.description) || '';
};
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

async function fetchRes(url, accept = '*/*') {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'DisboardFeed/1.0 (prywatny tracker)', Accept: accept },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}
const fetchJson = async (url) => (await fetchRes(url, 'application/json')).json();
const fetchText = async (url, accept) => (await fetchRes(url, accept)).text();

/* ---------- CommunityDragon ---------- */
async function loadEnv(env) {
  const base = CD(env) + '/v1';
  const [meta, champ, emotes, icons, wards, lines] = await Promise.all([
    fetchJson(`https://raw.communitydragon.org/${env}/content-metadata.json`).catch(() => ({})),
    fetchJson(`${base}/champions/${CHAMP_ID}.json`),
    fetchJson(`${base}/summoner-emotes.json`),
    fetchJson(`${base}/summoner-icons.json`),
    fetchJson(`${base}/ward-skins.json`),
    fetchJson(`${base}/skinlines.json`).catch(() => []),
  ]);
  const ver = String(meta.version || '').match(/^(\d+\.\d+)/);
  const lineName = new Map(lines.map((l) => [l.id, l.name]));
  return { env, version: ver ? ver[1] : null, champ, emotes, icons, wards, lineName };
}

export function extractSkins(d) {
  return (d.champ.skins || []).map((s) => ({
    id: s.id,
    name: s.name,
    base: !!s.isBase,
    rarity: RARITY[s.rarity] ?? '',
    legacy: !!s.isLegacy,
    line: (s.skinLines || []).map((l) => d.lineName.get(l.id)).filter(Boolean).join(', ') || null,
    desc: s.description || null,
    tile: imgPath(s.tilePath),
    splash: imgPath(s.splashPath),
    load: imgPath(s.loadScreenPath),
    chromas: (s.chromas || []).length,
  }));
}

// chromy osobno: nowa chroma do starego skina też jest nowością
export function extractChromas(d) {
  return (d.champ.skins || []).flatMap((s) => (s.chromas || []).map((c) => ({
    id: c.id,
    skin: s.id,
    name: c.name,
    colors: (c.colors || []).slice(0, 2),
    img: imgPath(c.chromaPath),
    desc: c.description || regionText(c.descriptions) || null,
  })));
}

export function extractEmotes(d) {
  return (d.emotes || [])
    // bez szablonów i wewnętrznych pozycji Riotu („Placeholder…”, „… DO NOT TRANSLATE”)
    .filter((e) => e.name && e.inventoryIcon && !/fpo/i.test(e.inventoryIcon) && !/do not translate|^placeholder/i.test(e.name))
    .map((e) => ({
      id: e.id,
      name: e.name,
      desc: e.description || null,
      img: imgPath(e.inventoryIcon),
      lulu: (e.taggedChampionsIds || []).includes(CHAMP_ID) || LULU.test(`${e.name} ${e.description || ''}`),
    }));
}

export function extractIcons(d) {
  return (d.icons || [])
    .filter((i) => LULU.test(`${i.title} ${regionText(i.descriptions)}`))
    .map((i) => ({ id: i.id, name: i.title, year: i.yearReleased || null, img: imgPath(i.imagePath), desc: regionText(i.descriptions) || null }));
}

export function extractWards(d) {
  return (d.wards || [])
    .filter((w) => LULU.test(`${w.name} ${w.description || ''}`))
    .map((w) => ({ id: w.id, name: w.name, img: imgPath(w.wardImagePath), desc: w.description || regionText(w.regionalDescriptions) || null }));
}

/* Łączy listy z serwera głównego i PBE, zachowując daty z poprzednich przebiegów.
   first — kiedy pierwszy raz zobaczyliśmy rzecz (null: była już przy starcie śledzenia),
   liveAt — kiedy trafiła na serwer główny po wcześniejszym wykryciu na PBE. */
export function mergeCat(liveList, pbeList, prevList, now, baseline) {
  const prev = new Map((prevList || []).map((x) => [x.id, x]));
  const out = new Map();
  for (const x of liveList || []) {
    const p = prev.get(x.id);
    const it = { ...x, where: 'live', first: p ? p.first : (baseline ? null : now) };
    if (p && p.liveAt) it.liveAt = p.liveAt;
    else if (p && p.where === 'pbe') it.liveAt = now;
    out.set(x.id, it);
  }
  for (const x of pbeList || []) {
    if (out.has(x.id)) continue;
    const p = prev.get(x.id);
    out.set(x.id, { ...x, where: 'pbe', first: p ? p.first : (baseline ? null : now) });
  }
  // gdy jedno ze źródeł nie odpowiedziało, nie gubimy rzeczy znanych wcześniej
  if (!liveList || !pbeList) for (const [id, p] of prev) if (!out.has(id)) out.set(id, p);
  return [...out.values()];
}

/* ---------- notatki do patchy ---------- */
function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}
function walk(o, fn) {
  if (Array.isArray(o)) { o.forEach((x) => walk(x, fn)); return; }
  if (o && typeof o === 'object') { fn(o); Object.values(o).forEach((x) => walk(x, fn)); }
}
export function listArticles(html) {
  const d = nextData(html);
  const out = [];
  const seen = new Set();
  walk(d, (o) => {
    const url = o.action && o.action.payload && o.action.payload.url;
    if (!o.title || !url || !o.publishedAt || seen.has(url)) return;
    seen.add(url);
    const abs = url.startsWith('http') ? url : new URL(url.replace(/^\/?/, '/'), 'https://www.leagueoflegends.com').href;
    out.push({ title: String(o.title), url: abs, date: o.publishedAt });
  });
  return out;
}

// HTML → linie tekstu (akapity, punkty listy i nagłówki osobno)
function lines(html) {
  return decode(String(html)
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<(?:p|div|h[1-6]|br|tr|ul|ol|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/* Z treści notatek wybiera fragmenty o Lulu. Notatki są podzielone liniami (<hr>)
   i nagłówkami (h2/h3): blok zaczynający się od „Lulu” bierzemy w całości
   (to zmiany balansu), z innych tylko zdania, w których pada jej imię. */
export function luluMentions(body) {
  const out = [];
  let section = null;
  const parts = String(body).split(/<hr[^>]*>|(?=<h[23][\s>])/i);
  for (const part of parts) {
    const h = part.match(/^<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
    if (h) section = stripTags(h[1]) || section;
    if (!LULU.test(stripTags(part))) continue;
    const ls = lines(h ? part.slice(h[0].length) : part);
    if (!ls.length) continue;
    const champBlock = /^lulu$/i.test(ls[0]);
    const keep = champBlock ? ls.slice(1) : ls.filter((l) => LULU.test(l));
    if (!keep.length) continue;
    out.push({ section, kind: champBlock ? 'balance' : 'mention', lines: keep.slice(0, 30).map((l) => (l.length > 400 ? l.slice(0, 397) + '…' : l)) });
  }
  return out;
}

async function patchNotes(prevPatches) {
  const articles = listArticles(await fetchText(LOL_NEWS, 'text/html'));
  const notes = articles.filter((a) => /patch\s+[\d.]+\s+notes/i.test(a.title)).slice(0, PATCH_KEEP);
  const prev = new Map((prevPatches || []).map((p) => [p.url, p]));
  const out = [];
  for (const [i, a] of notes.entries()) {
    // starsze notatki już się nie zmieniają; dwie najnowsze czytamy zawsze (Riot je poprawia)
    if (i >= 2 && prev.has(a.url)) { out.push(prev.get(a.url)); continue; }
    try {
      const d = nextData(await fetchText(a.url, 'text/html'));
      let body = '';
      walk(d, (o) => { if (typeof o.body === 'string' && o.body.length > body.length) body = o.body; });
      const m = a.title.match(/patch\s+([\d.]+)/i);
      out.push({ title: a.title, url: a.url, date: a.date, patch: m ? m[1] : null, mentions: luluMentions(body) });
    } catch (err) {
      console.warn(`  ✗ ${a.title}: ${err.message || err}`);
      if (prev.has(a.url)) out.push(prev.get(a.url));
    }
  }
  // artykuły (nie notatki) z Lulu w tytule: zapowiedzi skinów, filmiki
  const other = articles.filter((a) => !notes.includes(a) && LULU.test(a.title))
    .map((a) => ({ id: sha(a.url), title: a.title, url: a.url, date: a.date, source: 'leagueoflegends.com' }));
  return { patches: out, articles: other };
}

/* ---------- Google News ---------- */
async function news() {
  const items = [];
  const status = [];
  for (const src of NEWS_SOURCES) {
    try {
      const parsed = parseFeed(await fetchText(src.url, 'application/rss+xml, application/xml, text/xml, */*'));
      let n = 0;
      for (const it of parsed) {
        if (!LULU.test(it.title)) continue; // samo słowo w opisie to zwykle przypadek
        let title = it.title;
        const suffix = ` - ${it.sourceName}`;
        if (it.sourceName && title.endsWith(suffix)) title = title.slice(0, -suffix.length);
        items.push({ id: sha(it.url.replace(/[?#].*$/, '') + '|' + title.toLowerCase()), title, url: it.url, date: it.date, source: it.sourceName || src.name });
        n++;
      }
      status.push({ id: src.id, name: src.name, ok: true, count: n });
    } catch (err) {
      status.push({ id: src.id, name: src.name, ok: false, error: String(err.message || err) });
    }
  }
  return { items, status };
}

/* ---------- całość ---------- */
async function main() {
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* pierwszy przebieg */ }
  const baseline = !prev;
  const now = new Date().toISOString();
  const status = [];

  const envs = {};
  for (const env of ['latest', 'pbe']) {
    try {
      envs[env] = await loadEnv(env);
      status.push({ id: `cd-${env}`, name: `CommunityDragon (${env === 'pbe' ? 'PBE' : 'serwer główny'})`, ok: true });
      console.log(`✓ CommunityDragon ${env}: wersja ${envs[env].version}`);
    } catch (err) {
      status.push({ id: `cd-${env}`, name: `CommunityDragon (${env === 'pbe' ? 'PBE' : 'serwer główny'})`, ok: false, error: String(err.message || err) });
      console.warn(`✗ CommunityDragon ${env}: ${err.message || err}`);
    }
  }
  const L = envs.latest, P = envs.pbe;
  const cat = (fn, key) => mergeCat(L ? fn(L) : null, P ? fn(P) : null, prev && prev[key], now, baseline);

  let patches = (prev && prev.patches) || [];
  let articles = [];
  try {
    const r = await patchNotes(patches);
    patches = r.patches;
    articles = r.articles;
    status.push({ id: 'lol-patches', name: 'Notatki do patchy (leagueoflegends.com)', ok: true, count: patches.length });
    console.log(`✓ Notatki do patchy: ${patches.length}, z Lulu: ${patches.filter((p) => p.mentions.length).length}`);
  } catch (err) {
    status.push({ id: 'lol-patches', name: 'Notatki do patchy (leagueoflegends.com)', ok: false, error: String(err.message || err) });
    console.warn(`✗ Notatki do patchy: ${err.message || err}`);
  }

  const nw = await news();
  status.push(...nw.status);
  const byId = new Map(((prev && prev.news) || []).map((x) => [x.id, x]));
  for (const x of [...articles, ...nw.items]) byId.set(x.id, { ...byId.get(x.id), ...x });
  const cutoff = Date.now() - NEWS_DAYS * 86400e3;
  const newsItems = [...byId.values()]
    .filter((x) => !x.date || Date.parse(x.date) > cutoff)
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0))
    .slice(0, 120);

  const data = {
    v: 1,
    versions: { live: (L && L.version) || (prev && prev.versions && prev.versions.live) || null, pbe: (P && P.version) || (prev && prev.versions && prev.versions.pbe) || null },
    trackedSince: (prev && prev.trackedSince) || now,
    skins: cat(extractSkins, 'skins'),
    chromas: cat(extractChromas, 'chromas'),
    icons: cat(extractIcons, 'icons'),
    wards: cat(extractWards, 'wards'),
    emotes: cat(extractEmotes, 'emotes'),
    patches,
    news: newsItems,
    sources: status,
  };

  if (!L && !P && status.every((s) => !s.ok)) { console.error('Żadne źródło nie odpowiedziało, plik bez zmian.'); process.exitCode = 1; return; }
  const strip = (o) => JSON.stringify({ ...o, updatedAt: undefined, sources: (o.sources || []).map((s) => ({ ...s, count: undefined })) });
  if (prev && strip(prev) === strip(data)) { console.log('Bez zmian.'); return; }
  data.updatedAt = now;
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data) + '\n');
  console.log(`Zapisano: ${data.skins.length} skinów, ${data.chromas.length} chrom, ${data.icons.length} ikon, ${data.wards.length} totemów, ${data.emotes.length} emotek, ${data.news.length} wiadomości → ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
