'use strict';
/* ==========================================================================
   Disboard — narzędzia wspólne: DOM, formatowanie liczb, dat i czasu (PL),
   etykiety słowników AniList, sanityzacja HTML, ikony, toasty.
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ---------- liczby i odmiana ---------- */
const NF = new Intl.NumberFormat('pl-PL');
const NF1 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });
const NF2 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });

function plural(n, one, few, many) {
  n = Math.abs(n);
  if (n === 1) return one;
  const d = n % 10, h = n % 100;
  if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return few;
  return many;
}

// [jeden, kilka, wiele, ułamek]
const UNITS = {
  day: ['dzień', 'dni', 'dni', 'dnia'],
  hour: ['godzina', 'godziny', 'godzin', 'godziny'],
  minute: ['minuta', 'minuty', 'minut', 'minuty'],
  second: ['sekunda', 'sekundy', 'sekund', 'sekundy'],
  year: ['rok', 'lata', 'lat', 'roku'],
  episode: ['odcinek', 'odcinki', 'odcinków', 'odcinka'],
  time: ['raz', 'razy', 'razy', 'razu'],
  rewatch: ['rewatch', 'rewatche', 'rewatchy', 'rewatchu'],
  title: ['tytuł', 'tytuły', 'tytułów', 'tytułu'],
  item: ['pozycja', 'pozycje', 'pozycji', 'pozycji'],
};

function unit(n, u) {
  const f = UNITS[u];
  return Number.isInteger(n) ? plural(n, f[0], f[1], f[2]) : f[3];
}
function nUnit(n, u, nf = NF) { return `${nf.format(n)} ${unit(n, u)}`; }

/* ---------- czas trwania ---------- */
function splitMinutes(min) {
  min = Math.round(min);
  return { d: Math.floor(min / 1440), h: Math.floor((min % 1440) / 60), m: min % 60 };
}

// 288 → „4 godziny 48 minut”; short: „4 godz. 48 min”
function fmtDuration(min, { short = false, days = true } = {}) {
  min = Math.round(min || 0);
  if (min <= 0) return short ? '0 min' : '0 minut';
  let { d, h, m } = splitMinutes(min);
  if (!days) { h += d * 24; d = 0; }
  const p = [];
  if (short) {
    if (d) p.push(`${NF.format(d)} d`);
    if (h) p.push(`${h} godz.`);
    if (m) p.push(`${m} min`);
    return p.join(' ');
  }
  if (d) p.push(nUnit(d, 'day'));
  if (h) p.push(nUnit(h, 'hour'));
  if (m) p.push(nUnit(m, 'minute'));
  return p.join(' ');
}

// „3 dni 4 godziny 12 minut”
function fmtCountdown(sec, { short = false } = {}) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (short) {
    if (d) return `${d} d ${h} godz.`;
    if (h) return `${h} godz. ${m} min`;
    return `${m} min ${s} s`;
  }
  const p = [];
  if (d) p.push(nUnit(d, 'day'));
  if (d || h) p.push(nUnit(h, 'hour'));
  p.push(nUnit(m, 'minute'));
  if (!d && !h) p.push(nUnit(s, 'second'));
  return p.join(' ');
}

/* ---------- daty ---------- */
const MONTHS_NOM = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec',
  'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const DF = {
  day: new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }),
  dayShort: new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' }),
  dm: new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }),
  dt: new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  time: new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }),
  weekday: new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }),
  wdTime: new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
};
const fmtDate = (ts) => (ts ? DF.day.format(new Date(ts)) : '—');
const fmtDateShort = (ts) => (ts ? DF.dayShort.format(new Date(ts)) : '—');
const fmtDateTime = (ts) => (ts ? DF.dt.format(new Date(ts)) : '—');
const fmtTime = (ts) => DF.time.format(new Date(ts));

// FuzzyDate z AniList: {year, month, day} mogą być częściowe
function fuzzyDate(fd) {
  if (!fd || !fd.year) return null;
  if (fd.month && fd.day) return DF.day.format(new Date(fd.year, fd.month - 1, fd.day));
  if (fd.month) return `${MONTHS_NOM[fd.month - 1]} ${fd.year}`;
  return String(fd.year);
}
function fuzzyTs(fd) {
  if (!fd || !fd.year) return null;
  return new Date(fd.year, (fd.month || 1) - 1, fd.day || 1, 12).getTime();
}
function fuzzyPrecision(fd) {
  if (!fd || !fd.year) return 'none';
  if (fd.month && fd.day) return 'day';
  if (fd.month) return 'month';
  return 'year';
}

const pad2 = (n) => String(n).padStart(2, '0');
function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function monthKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function monthLabel(key, { short = false } = {}) {
  const [y, m] = key.split('-').map(Number);
  return short ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : `${MONTHS_NOM[m - 1]} ${y}`;
}
const toInputDate = (ts) => (ts ? dayKey(ts) : '');
// <input type="datetime-local">: „RRRR-MM-DDTGG:MM” w czasie lokalnym
function toInputDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${dayKey(ts)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fromInputDateTime(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
function fromInputDate(v) {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12).getTime(); // południe: odporne na zmianę czasu
}

function relTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'przed chwilą';
  if (min < 60) return `${min} min temu`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} godz. temu`;
  // dni kalendarzowe: wczoraj o 1:00 to „wczoraj”, a nie „2 dni temu”
  const d = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400e3);
  if (d <= 1) return 'wczoraj';
  if (d < 7) return `${d} dni temu`;
  return fmtDateShort(ts);
}

// Różnica kalendarzowa: pełne lata + reszta dni/godzin/minut/sekund
// Różnica liczona „na zegarku”: obie chwile zamieniamy na czas lokalny zapisany
// jak UTC, więc zmiana czasu letni/zimowy nie przesuwa godzin (od północy
// w czerwcu, czyli w czasie letnim, do północy w listopadzie to równe dni, nie +1 h).
function diffCalendar(fromTs, toTs) {
  const wall = (ts) => { const x = new Date(ts); return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate(), x.getHours(), x.getMinutes(), x.getSeconds(), x.getMilliseconds()); };
  const fromW = wall(fromTs), toW = wall(toTs);
  const from = new Date(fromW), to = new Date(toW);
  let y = to.getUTCFullYear() - from.getUTCFullYear();
  const anniv = (yy) => { const a = new Date(fromW); a.setUTCFullYear(from.getUTCFullYear() + yy); return a; };
  let a = anniv(y);
  if (a > to) { y--; a = anniv(y); }
  const rest = Math.max(0, Math.floor((to - a) / 1000));
  return {
    y,
    d: Math.floor(rest / 86400),
    h: Math.floor((rest % 86400) / 3600),
    m: Math.floor((rest % 3600) / 60),
    s: rest % 60,
    totalDays: Math.floor((toW - fromW) / 86400000),
  };
}

/* ---------- sezony ---------- */
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const SEASON_PL = { WINTER: 'Zima', SPRING: 'Wiosna', SUMMER: 'Lato', FALL: 'Jesień' };
function seasonOf(date = new Date()) {
  return { season: SEASONS[Math.floor(date.getMonth() / 3)], year: date.getFullYear() };
}
function shiftSeason({ season, year }, by = 1) {
  let i = SEASONS.indexOf(season) + by;
  while (i > 3) { i -= 4; year++; }
  while (i < 0) { i += 4; year--; }
  return { season: SEASONS[i], year };
}
const SEASON_GEN = { WINTER: 'zimy', SPRING: 'wiosny', SUMMER: 'lata', FALL: 'jesieni' };
// „#3 najpopularniejsze wiosny 2014” z rankingu AniList
function rankText(r) {
  const what = (r.type || r.t) === 'RATED' ? 'najwyżej oceniane' : 'najpopularniejsze';
  const all = r.allTime ?? r.a, season = r.season ?? r.s, year = r.year ?? r.y;
  const scope = all ? 'wszech czasów' : season && year ? `${SEASON_GEN[season] || ''} ${year}` : year ? `w ${year} r.` : '';
  return `#${r.rank ?? r.r} ${what} ${scope}`.trim();
}
const seasonLabel = (s, y) => (s ? `${SEASON_PL[s] || s} ${y ?? ''}`.trim() : (y ? String(y) : null));

/* ---------- słowniki AniList ---------- */
const FORMAT_PL = {
  TV: 'TV', TV_SHORT: 'TV (krótkie)', MOVIE: 'Film', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA',
  MUSIC: 'Teledysk', MANGA: 'Manga', NOVEL: 'Light novel', ONE_SHOT: 'One-shot',
};
const MSTATUS_PL = {
  FINISHED: 'Zakończone', RELEASING: 'Emitowane', NOT_YET_RELEASED: 'Zapowiedziane',
  CANCELLED: 'Anulowane', HIATUS: 'Przerwa w emisji',
};
const SOURCE_PL = {
  ORIGINAL: 'Oryginalna historia', MANGA: 'Manga', LIGHT_NOVEL: 'Light novel', VISUAL_NOVEL: 'Visual novel',
  VIDEO_GAME: 'Gra wideo', OTHER: 'Inne', NOVEL: 'Powieść', DOUJINSHI: 'Doujinshi', ANIME: 'Anime',
  WEB_NOVEL: 'Web novel', LIVE_ACTION: 'Live action', GAME: 'Gra', COMIC: 'Komiks',
  MULTIMEDIA_PROJECT: 'Projekt multimedialny', PICTURE_BOOK: 'Książka obrazkowa',
};
const RELATION_PL = {
  ADAPTATION: 'Adaptacja', PREQUEL: 'Prequel', SEQUEL: 'Sequel', PARENT: 'Seria główna',
  SIDE_STORY: 'Historia poboczna', CHARACTER: 'Wspólne postacie', SUMMARY: 'Podsumowanie',
  ALTERNATIVE: 'Wersja alternatywna', SPIN_OFF: 'Spin-off', OTHER: 'Inne', SOURCE: 'Materiał źródłowy',
  COMPILATION: 'Kompilacja', CONTAINS: 'Zawiera',
};
const RELATION_ORDER = ['SOURCE', 'PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE',
  'ADAPTATION', 'SUMMARY', 'COMPILATION', 'CONTAINS', 'CHARACTER', 'OTHER'];

const LIST_STATUSES = ['watching', 'planning', 'completed', 'paused', 'dropped'];
// kategorie oceny szczegółowej
const RATE_CATS = [['plot', 'Fabuła'], ['chars', 'Postacie'], ['anim', 'Animacja'], ['music', 'Muzyka i dźwięk'], ['fun', 'Frajda']];
const CHAR_ROLE_PL = { MAIN: 'Główna', SUPPORTING: 'Drugoplanowa', BACKGROUND: 'Epizod' };
const LSTATUS_PL = {
  watching: 'Oglądam', planning: 'Planuję', completed: 'Obejrzane', paused: 'Wstrzymane', dropped: 'Porzucone',
};

/* ---------- tytuły ---------- */
function titleOf(media, lang) {
  const t = (media && media.title) || {};
  const pref = lang || (typeof S !== 'undefined' ? S.settings.titleLang : 'english');
  if (pref === 'native') return t.native || t.romaji || t.english || 'Bez tytułu';
  if (pref === 'romaji') return t.romaji || t.english || t.native || 'Bez tytułu';
  return t.english || t.romaji || t.native || 'Bez tytułu';
}
function subTitleOf(media) {
  const t = (media && media.title) || {};
  const main = titleOf(media);
  return [t.romaji, t.english, t.native].find((x) => x && x !== main) || '';
}

/* ---------- sanityzacja opisu z API ---------- */
function sanitizeHtml(html) {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  const ALLOWED = new Set(['BR', 'I', 'B', 'EM', 'STRONG', 'P']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH']);
  const out = document.createElement('div');
  const walk = (src, dst) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === 3) { dst.append(document.createTextNode(n.textContent)); return; }
      if (n.nodeType !== 1 || DROP.has(n.tagName.toUpperCase())) return;
      if (ALLOWED.has(n.tagName)) {
        const el = document.createElement(n.tagName.toLowerCase());
        dst.append(el);
        walk(n, el);
      } else {
        walk(n, dst);
      }
    });
  };
  walk(tpl.content, out);
  return out.innerHTML;
}
function stripHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  return (tpl.content.textContent || '').replace(/\s+/g, ' ').trim();
}
function truncate(s, n) {
  s = String(s || '').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 20)).replace(/[\s,.;:–-]+$/, '') + '…';
}

/* ---------- ikony (własne, obrys 1.8) ---------- */
const svgI = (d, extra = '') => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  home: svgI('<path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/>'),
  list: svgI('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>'),
  search: svgI('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  calendar: svgI('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  crown: svgI('<path d="M4 18h16l1-10-5 4-4-7-4 7-5-4z"/><path d="M4 21h16"/>'),
  chart: svgI('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  history: svgI('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4M12 8v4.5l3 2"/>'),
  gear: svgI('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  bell: svgI('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  plus: svgI('<path d="M12 5v14M5 12h14"/>'),
  minus: svgI('<path d="M5 12h14"/>'),
  star: svgI('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  x: svgI('<path d="M6 6l12 12M18 6 6 18"/>'),
  play: svgI('<path d="M8 5.5v13l10.5-6.5z"/>'),
  ext: svgI('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  more: svgI('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
  repeat: svgI('<path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3"/>'),
  check: svgI('<path d="m5 12.5 4.5 4.5L19 7"/>'),
  grid: svgI('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
  rows: svgI('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  download: svgI('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
  upload: svgI('<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>'),
  refresh: svgI('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>'),
  clock: svgI('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  radar: svgI('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18 6"/><circle cx="12" cy="12" r="1.2"/>'),
  arrowDown: svgI('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  filter: svgI('<path d="M4 6h16M7 12h10M10 18h4"/>'),
  dice: svgI('<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.8" cy="8.8" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="15.2" cy="15.2" r="1"/>'),
  heart: svgI('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'),
  chevron: svgI('<path d="m9 6 6 6-6 6"/>'),
  news: svgI('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  scan: svgI('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3.2"/><path d="M12 6.8v1.6M12 15.6v1.6M6.8 12h1.6M15.6 12h1.6"/>'),
  image: svgI('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8 8.5"/>'),
  trash: svgI('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>'),
  user: svgI('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.8 3.9-6 7.5-6s6.7 2.2 7.5 6"/>'),
  cloud: svgI('<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.2 4.7 4.7 0 0 0 7 18.5z"/>'),
};

/* ---------- toasty ---------- */
function toast(msg, { kind = 'info', action = null, ms = 3800, logged = false } = {}) {
  // komunikaty o błędach trafiają też do dziennika błędów (Ustawienia), żeby był ślad po dymku
  if (kind === 'error' && !logged && typeof ErrLog !== 'undefined') ErrLog.add(msg, { kind: 'message', silent: true });
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const span = document.createElement('span');
  span.textContent = msg;
  el.append(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { action.fn(); el.remove(); });
    el.append(b);
  }
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, action ? Math.max(ms, 6000) : ms);
}

/* ---------- pobieranie pliku ---------- */
function downloadFile(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function readFileText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}
