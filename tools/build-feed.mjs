#!/usr/bin/env node
/* ==========================================================================
   Disboard — budowanie feedu z wiadomościami o No Game No Life
   Uruchamiane przez GitHub Actions co 4 godziny (lub ręcznie: node tools/build-feed.mjs).
   Zbiera publiczne kanały RSS, zostawia tylko wpisy o NGNL, dopisuje je do
   data/ngnl-feed.json (historia do ~13 miesięcy) i nic nie wymyśla:
   każda pozycja ma tytuł, datę, źródło i link do oryginału.
   ========================================================================== */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/ngnl-feed.json');

const KEYWORDS = /no\s*game,?\s*no\s*life|ノーゲーム・?ノーライフ|ノゲノラ/i;
const MERCH = /figur|figma|nendoroid|pop ?up parade|scale figure|merch|goods|グッズ|フィギュア|ねんどろいど|plush|acrylic|t-?shirt|apparel|hoodie|keychain|prize|くじ|tapestry|dakimakura|blu-?ray|\bdvd\b|ブルーレイ|box set|collab cafe|コラボカフェ/i;

const gnews = (q, lang) => (lang === 'ja'
  ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`
  : `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`);

export const SOURCES = [
  { id: 'gnews-en', name: 'Google News (EN)', url: gnews('"No Game No Life"', 'en'), filter: false },
  { id: 'gnews-ja', name: 'Google News (JP)', url: gnews('ノーゲーム・ノーライフ', 'ja'), filter: false },
  { id: 'gnews-merch-en', name: 'Google News: merch (EN)', url: gnews('"No Game No Life" (figure OR nendoroid OR merch OR "Blu-ray")', 'en'), filter: false, kind: 'merch' },
  { id: 'gnews-merch-ja', name: 'Google News: グッズ (JP)', url: gnews('ノーゲーム・ノーライフ (フィギュア OR グッズ OR ねんどろいど)', 'ja'), filter: false, kind: 'merch' },
  { id: 'ann', name: 'Anime News Network', url: 'https://www.animenewsnetwork.com/all/rss.xml?ann-edition=w', filter: true },
  { id: 'natalie', name: 'コミックナタリー', url: 'https://natalie.mu/comic/feed/news', filter: true },
];

/* ---------- parsowanie RSS/Atom bez zależności ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
export const stripTags = (s) => decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}
function attr(block, name, a) {
  const re = new RegExp(`<${name}\\s[^>]*${a}=["']([^"']+)["']`, 'i');
  const m = block.match(re);
  return m ? decode(m[1]) : '';
}

export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = stripTags(tag(b, 'title'));
    let link = decode(tag(b, 'link')).trim();
    if (!link) link = attr(b, 'link', 'href');
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const descRaw = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content');
    const image = attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url') || attr(b, 'enclosure', 'url')
      || (decode(descRaw).match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || '';
    const source = stripTags(tag(b, 'source'));
    const ts = date ? Date.parse(decode(date).trim()) : NaN;
    if (title && link) items.push({ title, url: link, date: Number.isFinite(ts) ? new Date(ts).toISOString() : null, summary: stripTags(descRaw), image, sourceName: source });
  }
  return items;
}

const idOf = (url, title) => createHash('sha1').update((url || '').replace(/[?#].*$/, '') + '|' + String(title).toLowerCase()).digest('hex').slice(0, 16);
const clip = (s, n) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n) > n - 40 ? s.lastIndexOf(' ', n) : n).trim() + '…');

export function normalize(src, it) {
  const isGoogle = src.id.startsWith('gnews');
  let title = it.title;
  let source = src.name;
  if (isGoogle) {
    source = it.sourceName || source;
    const suffix = ` - ${it.sourceName}`;
    if (it.sourceName && title.endsWith(suffix)) title = title.slice(0, -suffix.length);
  }
  const text = `${title} ${it.summary}`;
  return {
    id: idOf(it.url, title),
    title,
    date: it.date,
    // Google News w opisie powtarza tylko tytuł i nazwę źródła
    summary: isGoogle ? '' : clip(it.summary, 220),
    source,
    via: src.name,
    url: it.url,
    image: it.image || null,
    price: null,
    kind: MERCH.test(text) ? 'merch' : 'news',
  };
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'DisboardFeed/1.0 (+https://github.com; prywatny tracker anime)', Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  let prev = { items: [] };
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* pierwszy przebieg */ }
  const byId = new Map((prev.items || []).map((x) => [x.id, x]));
  const status = [];

  for (const src of SOURCES) {
    try {
      const xml = await fetchText(src.url);
      const parsed = parseFeed(xml);
      const relevant = parsed.filter((it) => !src.filter || KEYWORDS.test(`${it.title} ${it.summary}`));
      let added = 0;
      for (const it of relevant) {
        const n = normalize(src, it);
        if (!byId.has(n.id)) added++;
        byId.set(n.id, { ...byId.get(n.id), ...n });
      }
      status.push({ id: src.id, name: src.name, ok: true, count: relevant.length, added });
      console.log(`✓ ${src.name}: ${relevant.length} pasujących (${added} nowych)`);
    } catch (err) {
      status.push({ id: src.id, name: src.name, ok: false, error: String(err.message || err) });
      console.warn(`✗ ${src.name}: ${err.message || err}`);
    }
  }

  const cutoff = Date.now() - 400 * 86400e3;
  const items = [...byId.values()]
    .filter((x) => !x.date || Date.parse(x.date) > cutoff)
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0))
    .slice(0, 300);

  const out = { generatedAt: new Date().toISOString(), sources: status, items };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`Zapisano ${items.length} pozycji → ${OUT}`);
  if (status.every((s) => !s.ok)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
