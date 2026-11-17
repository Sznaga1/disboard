/* PLIK GENEROWANY — nie edytuj ręcznie.
   Źródło: js/util.js, js/db.js, js/library.js, js/cloud.js (node tools/build-extension.mjs). */
const DisboardCore = (() => {
  'use strict';
  /* ---------- atrapy przeglądarki: kod strony nic tu nie zapisuje ani nie wyświetla ---------- */
  const noop = () => {};
  const indexedDB = undefined;
  const BroadcastChannel = undefined;
  const localStorage = { getItem: () => null, setItem: noop, removeItem: noop, key: () => null, length: 0 };
  const fakeEl = () => ({ append: noop, remove: noop, click: noop, addEventListener: noop, setAttribute: noop, classList: { add: noop, remove: noop, toggle: noop }, style: {}, dataset: {} });
  const window = { addEventListener: noop, removeEventListener: noop, focus: noop, innerWidth: 1024, matchMedia: () => ({ matches: false, addEventListener: noop }) };
  const document = { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: fakeEl, body: fakeEl(), head: fakeEl() };
  const location = { protocol: 'chrome-extension:', hostname: '', hash: '', href: '' };
  const ErrLog = { add: noop };
  const console = { log: noop, info: noop, warn: noop, error: noop };
  // fillery i recapy (pomijanie): dane pobiera rozszerzenie, format jak na stronie
  let FLAGS = {};
  const Episodes = {
    skipSet(e) {
      const f = e && e.idMal ? FLAGS[e.idMal] : null;
      if (!f) return null;
      const set = new Set();
      for (const [a, b] of [...f.f, ...f.r]) for (let i = a; i <= b; i++) set.add(i);
      return set;
    },
  };
  let toasts = [];

/* ===== js/util.js ===== */
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
  wand: svgI('<path d="M4 20 15 9"/><path d="m14 4 .8 2.2L17 7l-2.2.8L14 10l-.8-2.2L11 7l2.2-.8zM19 11l.5 1.5L21 13l-1.5.5L19 15l-.5-1.5L17 13l1.5-.5zM8 3l.4 1.1L9.5 4.5l-1.1.4L8 6l-.4-1.1-1.1-.4 1.1-.4z"/>'),
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


/* ===== js/db.js ===== */
'use strict';
/* ==========================================================================
   Disboard — pamięć: biblioteka (IndexedDB „disboard-lista”, awaryjnie
   localStorage), cache API i kopie zapasowe (IndexedDB „disboard”), szyna zdarzeń.
   ========================================================================== */

const bus = new EventTarget();
const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
const on = (name, fn) => {
  const h = (e) => fn(e.detail);
  bus.addEventListener(name, h);
  return () => bus.removeEventListener(name, h);
};

/* ---------- IndexedDB z awaryjną pamięcią w RAM ---------- */
const IDB = (() => {
  const mem = { cache: new Map(), backups: new Map() };
  let dbp = null;
  let broken = false;

  function open() {
    if (broken) return Promise.reject(new Error('idb-broken'));
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('disboard', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache');
          if (!d.objectStoreNames.contains('backups')) d.createObjectStore('backups');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('blocked'));
      } catch (e) { rej(e); }
    });
    dbp.catch(() => { broken = true; dbp = null; });
    return dbp;
  }

  async function run(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }

  return {
    async get(store, key) {
      try { return await run(store, 'readonly', (s) => s.get(key)); } catch { return mem[store].get(key); }
    },
    async set(store, key, val) {
      try { await run(store, 'readwrite', (s) => s.put(val, key)); } catch { mem[store].set(key, val); }
    },
    async del(store, key) {
      try { await run(store, 'readwrite', (s) => s.delete(key)); } catch { mem[store].delete(key); }
    },
    async keys(store) {
      try { return (await run(store, 'readonly', (s) => s.getAllKeys())) || []; } catch { return [...mem[store].keys()]; }
    },
    async clear(store) {
      try { await run(store, 'readwrite', (s) => s.clear()); } catch { mem[store].clear(); }
    },
    // usuwa wpisy, dla których drop(klucz, wartość) zwraca true; zwraca ich liczbę
    async prune(store, drop) {
      let n = 0;
      try {
        await run(store, 'readwrite', (s) => {
          const r = s.openCursor();
          r.onsuccess = () => {
            const c = r.result;
            if (!c) return;
            if (drop(c.key, c.value)) { c.delete(); n++; }
            c.continue();
          };
          return null;
        });
      } catch {
        for (const [k, v] of mem[store]) if (drop(k, v)) { mem[store].delete(k); n++; }
      }
      return n;
    },
  };
})();

/* ---------- stan aplikacji ---------- */
const STORE_KEY = 'disboard.library.v1';  // stary zapis listy w localStorage (po przeniesieniu: kopia awaryjna)
const MIGRATED_KEY = 'disboard.movedToIdb'; // kiedy lista trafiła do IndexedDB

function defaultState() {
  return {
    v: 1,
    entries: {},      // anilistId → wpis na liście
    history: [],      // zdarzenia oglądania (append-only, poza cofaniem odcinków)
    notifs: [],       // powiadomienia w aplikacji
    favChars: {},     // ulubione postacie
    radar: { at: 0, baseline: false, items: {}, hidden: {}, seenAt: 0 }, // radar kontynuacji
    settings: {
      titleLang: 'english',
      sysNotify: false,
      notifyKinds: { episode: true, premiere: true, news: true, merch: true, change: true, sequel: true },
      wait: { mode: 's1end', custom: null, hidden: false, collapsed: false },
      feedUrl: 'data/ngnl-feed.json',
      listView: 'grid',
      listSort: 'updated',
      listSorts: {},    // sortowanie osobno dla każdej zakładki listy: { tab: { k, dir } }
      hideSpoilers: true,
      backfill: false,  // tryb uzupełniania listy (Alt+U)
      adult: true,      // pozycje 18+ w wyszukiwarce i na liście
      translate: true,  // tłumaczenie japońskich wiadomości NGNL na angielski
      statsTab: 'summary', // zakładka statystyk: podsumowanie albo „dla nerda”
      skipFiller: false,   // plusik przeskakuje fillery i recapy (Alt+P)
      radarExtras: false,  // radar kontynuacji: także OVA, specjale i historie poboczne
      theme: 'disboard',   // motyw kolorystyczny (wszystkie ciemne)
      fx: { on: false, off: {}, rm: false }, // „Bajery”: przełącznik główny, wyłączone efekty, ignorowanie „ogranicz ruch”
      lulu: { hidden: {} }, // centrum Lulu: emotki ukryte kliknięciem (id → 1)
    },
    meta: {
      createdAt: Date.now(),
      lastRefresh: 0,
      lastNewsCheck: 0,
      newsBaseline: false,
      newsFirstSeen: {},  // id → pierwsze wykrycie
      newsOpened: {},     // id → kliknięto
      notifKeys: {},      // deduplikacja powiadomień
      lastExportAt: null,
      lastBackupAt: 0,
      lastReset: null,  // ostatnie przeniesienie do przeszłości (do cofnięcia)
      traceLog: [],     // czasy wyszukiwań trace.moe (licznik dzienny)
    },
  };
}

function mergeDefaults(target, defs) {
  for (const k of Object.keys(defs)) {
    if (target[k] === undefined || target[k] === null && defs[k] !== null && typeof defs[k] === 'object') {
      target[k] = defs[k];
    } else if (defs[k] && typeof defs[k] === 'object' && !Array.isArray(defs[k]) && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      mergeDefaults(target[k], defs[k]);
    }
  }
  return target;
}

function normalizeState(s) {
  if (!s || typeof s !== 'object') return defaultState();
  mergeDefaults(s, defaultState());
  if (Array.isArray(s.entries)) {
    const map = {};
    s.entries.forEach((e) => { if (e && e.id) map[e.id] = e; });
    s.entries = map;
  }
  for (const e of Object.values(s.entries)) {
    if (!Array.isArray(e.sessions) || !e.sessions.length) {
      e.sessions = [{ n: 0, startedAt: null, finishedAt: null, progress: 0 }];
    }
    e.sessions.forEach((x, i) => {
      x.n = i;
      x.progress = Math.max(0, x.progress | 0);
      // wybrane odcinki (zakresy): postęp = ich liczba
      if (Array.isArray(x.ranges) && x.ranges.length) x.progress = x.ranges.reduce((a, r) => a + Math.max(0, (r[1] | 0) - (r[0] | 0) + 1), 0);
      else delete x.ranges;
    });
    if (!LIST_STATUSES.includes(e.status)) e.status = 'planning';
    if (!Array.isArray(e.tags)) e.tags = [];
    e.notes = e.notes || '';
    e.favorite = !!e.favorite;
    e.media = e.media || { id: e.id, title: { romaji: `Anime #${e.id}` } };
  }
  if (!Array.isArray(s.history)) s.history = [];
  if (!Array.isArray(s.notifs)) s.notifs = [];
  return s;
}

/* ---------- gdzie leży lista ----------
   Lista mieszka w osobnej bazie IndexedDB („disboard-lista”), bo localStorage
   ma limit ok. 5 mln znaków. Stary zapis w localStorage (STORE_KEY) zostaje
   nietknięty jako kopia awaryjna: przy pierwszym uruchomieniu kopiujemy go do
   bazy, sprawdzamy odczytem i dopiero wtedy przełączamy się na bazę. Gdy
   IndexedDB nie działa (np. tryb prywatny), zostajemy przy localStorage. */
const SDB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('disboard-lista', 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
        r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('blocked'));
      } catch (e) { rej(e); }
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then((d) => new Promise((res, rej) => {
      const t = d.transaction('kv', mode);
      let out;
      fn(t.objectStore('kv'), (v) => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('abort'));
    }));
  }
  return {
    open,
    tx,
    get: (k) => tx('readonly', (s, done) => { const r = s.get(k); r.onsuccess = () => done(r.result); }),
    put: (k, v) => tx('readwrite', (s) => { s.put(v, k); }),
  };
})();

let storageOk = true;
let backend = 'ls';     // 'idb' albo 'ls' (localStorage, tryb awaryjny)
let loaded = false;     // dopóki lista się nie wczyta, nic nie zapisujemy (żeby nie nadpisać jej pustą)
// ostatnia wersja listy z pamięci przeglądarki, na której opiera się ta karta
// (punkt odniesienia przy łączeniu zmian z innych kart)
let baseRaw = null;
let baseRev = 0;
let S = defaultState();

function readLegacy() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}
function loadFromLegacy(raw) {
  backend = 'ls';
  try {
    if (raw) { S = normalizeState(JSON.parse(raw)); baseRaw = raw; }
  } catch (e) {
    console.warn('Nie udało się wczytać biblioteki', e);
    storageOk = false;
  }
}

async function loadState() {
  const legacy = readLegacy();
  let rec;
  try {
    rec = await SDB.get('main');
  } catch (e) {
    console.warn('IndexedDB niedostępne, lista zostaje w localStorage', e);
    loadFromLegacy(legacy);
    return;
  }

  if (rec && typeof rec.json === 'string') {
    S = normalizeState(JSON.parse(rec.json));
    baseRaw = rec.json;
    baseRev = rec.rev || 0;
    backend = 'idb';
    await absorbLegacy(legacy);
    return;
  }

  // pierwsze uruchomienie po zmianie: przenosimy listę z localStorage do bazy
  if (!legacy) { backend = 'idb'; return; } // nowa, pusta lista
  let st;
  try { st = normalizeState(JSON.parse(legacy)); } catch (e) {
    console.warn('Stary zapis listy jest uszkodzony, zostaje w localStorage', e);
    loadFromLegacy(legacy);
    return;
  }
  const json = JSON.stringify(st);
  try {
    // dodatkowa kopia oryginału (Ustawienia → kopie); gdyby baza kopii nie odpowiadała,
    // nie blokujemy startu, bo oryginał i tak zostaje w localStorage
    await Promise.race([
      IDB.set('backups', MIGRATION_BACKUP, { t: Date.now(), count: Object.keys(st.entries).length, json: legacy, label: 'Sprzed przeniesienia do IndexedDB' }),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    await SDB.put('legacy', { raw: legacy });
    await SDB.put('main', { rev: 1, json, at: Date.now() });
    const check = await SDB.get('main');
    if (!check || check.json !== json) throw new Error('odczyt kontrolny nie zgadza się z zapisem');
  } catch (e) {
    console.warn('Przeniesienie listy do IndexedDB nie powiodło się, zostaje w localStorage', e);
    loadFromLegacy(legacy);
    return;
  }
  S = st;
  baseRaw = json;
  baseRev = 1;
  backend = 'idb';
  try { localStorage.setItem(MIGRATED_KEY, String(Date.now())); } catch { /* tylko informacja */ }
  console.info(`Disboard: lista przeniesiona do IndexedDB (${Object.keys(st.entries).length} pozycji, ${S.history.length} zdarzeń). Kopia w localStorage została bez zmian.`);
}

/* Karta ze starą wersją aplikacji (sprzed przeniesienia) dalej zapisuje do
   localStorage. Takie zmiany łączymy z listą w bazie, zamiast je zgubić. */
async function absorbLegacy(raw) {
  if (backend !== 'idb' || !raw) return;
  let rec;
  try { rec = await SDB.get('legacy'); } catch { return; }
  if (!rec || rec.raw === raw) return;
  try {
    S = mergeStates(JSON.parse(rec.raw), S, JSON.parse(raw));
  } catch (e) { console.warn('Nie udało się dołączyć zmian ze starszej wersji', e); return; }
  // lista i znacznik „wchłonięte” zapisują się w jednej transakcji
  await queueWrite({ legacyRaw: raw, boot: true });
  console.info('Disboard: dołączono zmiany zapisane przez starszą wersję aplikacji.');
  if (loaded) announceSync();
}

const stateReady = loadState()
  .catch((e) => { console.error('Wczytywanie listy nie powiodło się', e); ErrLog.add(e, { kind: 'load', where: 'wczytywanie listy z IndexedDB', silent: true }); loadFromLegacy(readLegacy()); })
  .then(() => { loaded = true; });
const storageInfo = () => (backend === 'idb' ? 'IndexedDB' : 'localStorage');
// lista była już w bazie, ale teraz baza nie odpowiada: pokazujemy starszą kopię z localStorage
function staleFallbackSince() {
  if (backend === 'idb') return 0;
  try { return Number(localStorage.getItem(MIGRATED_KEY)) || 0; } catch { return 0; }
}

/* ---------- kilka kart naraz: łączenie zmian zamiast nadpisywania ----------
   Każda karta trzyma własną kopię listy. Zapis sprawdza, czy inna karta nie
   zapisała czegoś w międzyczasie. Jeśli tak, zmiany łączą się trójstronnie:
   punkt odniesienia (baseRaw), moja kopia i ich kopia. Anime liczy się jako
   całość: bierzemy wersję ze strony, która je zmieniła (przy zmianie po obu
   stronach wygrywa nowsza), a historia tego anime idzie za wybraną wersją. */
const J = (x) => JSON.stringify(x);
const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
function merge3(b, m, t) {
  const jb = J(b), jm = J(m), jt = J(t);
  if (jm === jb) return t;
  if (jt === jb || jt === jm) return m;
  if (isPlain(m) && isPlain(t)) {
    const bb = isPlain(b) ? b : {};
    const out = {};
    for (const k of new Set([...Object.keys(bb), ...Object.keys(m), ...Object.keys(t)])) {
      const v = merge3(bb[k], m[k], t[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return m; // ta sama wartość zmieniona w obu kartach: wygrywa ta karta
}
function mergeEntries(b = {}, m = {}, t = {}) {
  const out = {}, from = {};
  for (const id of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)])) {
    const jb = J(b[id]), jm = J(m[id]), jt = J(t[id]);
    let side;
    if (jm === jb) side = 't';
    else if (jt === jb || jt === jm) side = 'm';
    else if (!m[id]) side = 't'; // usunięte tu, zmienione tam: zostawiamy (bezpieczniej)
    else if (!t[id]) side = 'm';
    else side = (m[id].updatedAt || 0) >= (t[id].updatedAt || 0) ? 'm' : 't';
    const pick = side === 'm' ? m[id] : t[id];
    if (pick) out[id] = pick;
    from[id] = side;
  }
  return { entries: out, from };
}
function mergeHistory(b = [], m = [], t = [], from = {}) {
  const inBase = new Set(b.map((h) => h.id));
  const seen = new Set();
  const out = [];
  const push = (h) => { if (!seen.has(h.id)) { seen.add(h.id); out.push(h); } };
  for (const h of t) if (from[h.m] !== 'm') push(h);
  for (const h of m) {
    const side = from[h.m];
    if (side === 't') continue;
    if (side === 'm' || !inBase.has(h.id)) push(h);
  }
  return out.sort((x, y) => x.t - y.t);
}
function mergeNotifs(b = [], m = [], t = []) {
  const inBase = new Set(b.map((n) => n.id));
  const mine = new Map(m.map((n) => [n.id, n]));
  const out = t.map((n) => { const x = mine.get(n.id); return x && x.read && !n.read ? { ...n, read: true } : n; });
  const theirs = new Set(t.map((n) => n.id));
  for (const n of m) if (!theirs.has(n.id) && !inBase.has(n.id)) out.push(n);
  return out.sort((x, y) => y.t - x.t).slice(0, 200);
}
function mergeStates(b, m, t) {
  b = b || {};
  const e = mergeEntries(b.entries, m.entries, t.entries);
  return normalizeState({
    ...t,
    entries: e.entries,
    history: mergeHistory(b.history, m.history, t.history, e.from),
    notifs: mergeNotifs(b.notifs, m.notifs, t.notifs),
    favChars: merge3(b.favChars || {}, m.favChars || {}, t.favChars || {}) || {},
    radar: merge3(b.radar || {}, m.radar || {}, t.radar || {}) || {},
    settings: merge3(b.settings, m.settings, t.settings),
    meta: merge3(b.meta, m.meta, t.meta),
  });
}
function announceSync() {
  emit('library', { kind: 'sync' });
  emit('settings');
  emit('notifs');
  emit('favchars', {});
}

/* ---------- zapis ----------
   Zapisy idą po kolei, jeden po drugim. W bazie każda wersja listy ma numer
   (rev). Jeśli w bazie jest inny numer niż ten, na którym opiera się ta karta,
   to inna karta zapisała coś w międzyczasie: najpierw łączymy, potem zapis.
   Odczyt, łączenie i zapis dzieją się w jednej transakcji. */
const MIGRATION_BACKUP = 'przed-migracja';
let writeChain = Promise.resolve();
let pendingWrites = 0;
const chan = typeof BroadcastChannel === 'function' ? new BroadcastChannel('disboard-lista') : null;

function queueWrite(opts = {}) {
  pendingWrites++;
  const p = writeChain.then(() => writeState(opts)).finally(() => { pendingWrites--; });
  writeChain = p.catch(() => {});
  return p;
}

async function writeState({ force = false, boot = false, legacyRaw = null, onStart = null } = {}) {
  if (onStart) onStart();
  if (!loaded && !boot) return; // lista jeszcze się nie wczytała: nie nadpisujemy jej
  if (backend !== 'idb') { writeLegacy({ force }); return; }
  const d = await SDB.open();
  let merged = false, json = baseRaw, rev = baseRev;
  await new Promise((res, rej) => {
    const t = d.transaction('kv', 'readwrite');
    const st = t.objectStore('kv');
    const g = st.get('main');
    g.onsuccess = () => {
      const cur = g.result;
      const curRev = (cur && cur.rev) || 0;
      if (!force && cur && curRev !== baseRev) {
        try {
          S = mergeStates(baseRaw ? JSON.parse(baseRaw) : defaultState(), S, JSON.parse(cur.json));
          merged = true;
        } catch (err) { console.warn('Łączenie zmian z innej karty nie powiodło się', err); }
      }
      json = JSON.stringify(S);
      if (!merged && curRev === baseRev && json === baseRaw && legacyRaw == null) { rev = curRev; return; } // bez zmian
      rev = Math.max(curRev + 1, Date.now()); // zawsze rośnie, także między kartami
      st.put({ rev, json, at: Date.now() }, 'main');
      if (legacyRaw != null) st.put({ raw: legacyRaw }, 'legacy');
    };
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Zapis przerwany'));
  });
  const changed = rev !== baseRev;
  baseRaw = json;
  baseRev = rev;
  if (changed && chan) chan.postMessage({ rev });
  if (merged) announceSync();
}

// tryb awaryjny bez IndexedDB: dawny zapis do localStorage
function writeLegacy({ force = false } = {}) {
  let merged = false;
  if (!force) {
    let cur = null;
    try { cur = localStorage.getItem(STORE_KEY); } catch { /* brak dostępu: zapis i tak się nie uda */ }
    if (cur != null && cur !== baseRaw) {
      try {
        S = mergeStates(baseRaw ? JSON.parse(baseRaw) : defaultState(), S, JSON.parse(cur));
        merged = true;
      } catch (err) { console.warn('Łączenie zmian z innej karty nie powiodło się', err); }
    }
  }
  const json = JSON.stringify(S);
  localStorage.setItem(STORE_KEY, json);
  baseRaw = json;
  if (merged) announceSync();
}

// inna karta zapisała listę: wczytujemy ją od razu (albo łączymy z niezapisanymi zmianami)
function applyRemote(raw, rev = 0) {
  if (raw == null || raw === baseRaw) return;
  let theirs;
  try { theirs = JSON.parse(raw); } catch { return; }
  if (saveTimer || pendingWrites) {
    try { S = mergeStates(baseRaw ? JSON.parse(baseRaw) : defaultState(), S, theirs); } catch { S = normalizeState(theirs); }
  } else {
    S = normalizeState(theirs);
  }
  baseRaw = raw;
  baseRev = rev;
  announceSync();
}
async function pullRemote() {
  if (!loaded || backend !== 'idb') return;
  let rec;
  try { rec = await SDB.get('main'); } catch { return; }
  // numery w bazie tylko rosną: starszej wersji niż własna nie wczytujemy
  if (rec && rec.rev > baseRev) applyRemote(rec.json, rec.rev);
}
if (chan) chan.onmessage = (ev) => { if (ev.data && ev.data.rev > baseRev) pullRemote(); };
window.addEventListener('storage', (ev) => {
  if (ev.key !== STORE_KEY || ev.storageArea !== localStorage || !loaded) return;
  if (backend === 'idb') absorbLegacy(ev.newValue); // zapis ze starszej wersji aplikacji
  else applyRemote(ev.newValue);
});

const SAVE_FAIL = 'Nie udało się zapisać zmian w przeglądarce. Zrób eksport JSON w Ustawieniach, żeby nie stracić danych.';
function saveFailed(e) {
  storageOk = false;
  console.error(e);
  ErrLog.add(e, { kind: 'save', where: 'zapis listy', silent: true }); // dymek o zapisie pokazuje się niżej
  toast(SAVE_FAIL, { kind: 'error', ms: 8000 });
}

let saveTimer = null;
let writeWaiting = null; // zapis już w kolejce, który jeszcze nie ruszył: kolejne zmiany się do niego dołączą
/* Zapis rusza prawie od razu (30 ms, żeby seria kliknięć dała jeden zapis).
   W IndexedDB nie da się zapisać synchronicznie przy zamykaniu karty: przeglądarka
   przerywa wtedy transakcję. Dlatego nie czekamy z zapisem na zamknięcie. */
function save() {
  if (!loaded || saveTimer) return;
  saveTimer = setTimeout(saveNow, 30);
}
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!loaded) return Promise.resolve();
  if (writeWaiting) return writeWaiting; // ten zapis i tak weźmie najnowszy stan listy
  const p = queueWrite({ onStart: () => { writeWaiting = null; } }).then(() => { storageOk = true; }, saveFailed);
  writeWaiting = p;
  maybeBackup();
  return p;
}
// przejście do innej karty albo zamykanie: zapis, jeśli jeszcze czeka
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) saveNow(); });
window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

function replaceState(next) {
  S = normalizeState(next);
  clearTimeout(saveTimer);
  saveTimer = null;
  const p = queueWrite({ force: true }).then(() => { storageOk = true; }, saveFailed);
  maybeBackup();
  emit('library', { kind: 'replace' });
  emit('settings');
  return p;
}

/* ---------- automatyczne kopie zapasowe (IndexedDB, 7 dni) ---------- */
async function maybeBackup(force = false) {
  if (!loaded) return;
  const now = Date.now();
  if (!force && now - (S.meta.lastBackupAt || 0) < 3600e3) return;
  if (!Object.keys(S.entries).length && !force) return;
  S.meta.lastBackupAt = now;
  // migawka od razu, zanim ktokolwiek zmieni listę (np. import tuż po kopii)
  const snap = { t: now, count: Object.keys(S.entries).length, json: JSON.stringify(S) };
  queueWrite().catch(() => { /* zapis główny zgłosi błąd */ });
  await IDB.set('backups', dayKey(now), snap);
  // kopia sprzed przeniesienia do IndexedDB nie wlicza się do 7 dziennych
  const keys = (await IDB.keys('backups')).filter((k) => k !== MIGRATION_BACKUP).sort();
  while (keys.length > 7) await IDB.del('backups', keys.shift());
}

async function listBackups() {
  const keys = (await IDB.keys('backups')).sort().reverse();
  const out = [];
  for (const k of keys) {
    const b = await IDB.get('backups', k);
    if (b) out.push({ key: k, t: b.t, count: b.count, label: b.label || '' });
  }
  return out;
}
async function restoreBackup(key) {
  const b = await IDB.get('backups', key);
  if (!b) throw new Error('Nie znaleziono kopii');
  replaceState(JSON.parse(b.json));
}

async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch { /* brak wsparcia */ }
  return false;
}


/* ===== js/library.js ===== */
'use strict';
/* ==========================================================================
   Disboard — logika trackera: lista, sesje oglądania (rewatche), historia,
   czas oglądania, statystyki, odświeżanie danych i powiadomienia.
   ========================================================================== */

const Lib = (() => {
  const now = () => Date.now();

  /* ---------- migawka danych z API trzymana przy wpisie (działa offline) ---------- */
  function snapshot(m) {
    if (!m) return null;
    return {
      id: m.id, idMal: m.idMal ?? null,
      title: m.title || {}, synonyms: m.synonyms || [],
      coverImage: m.coverImage || {}, bannerImage: m.bannerImage || null,
      format: m.format || null, status: m.status || null,
      episodes: m.episodes ?? null, duration: m.duration ?? null,
      season: m.season || null, seasonYear: m.seasonYear || null,
      startDate: m.startDate || null, endDate: m.endDate || null,
      nextAiringEpisode: m.nextAiringEpisode || null,
      genres: m.genres || [], averageScore: m.averageScore ?? null, popularity: m.popularity ?? null,
      isAdult: !!m.isAdult,
      siteUrl: m.siteUrl || `https://anilist.co/anime/${m.id}`,
      updatedAt: m.updatedAt || null,
    };
  }

  const get = (id) => S.entries[id] || null;
  const cur = (e) => e.sessions[e.sessions.length - 1];
  const epDur = (e) => Number(e.durationOverride) || (e.media && e.media.duration) || null;
  const totalEps = (e) => e.sessions.reduce((a, s) => a + (s.progress || 0), 0);
  const entryMinutes = (e) => { const d = epDur(e); return d ? totalEps(e) * d : 0; };
  // ukończone obejrzenie: z datą, bez daty (done) albo po pełnej liczbie odcinków
  const sessionDone = (e, s) => !!(s.finishedAt || s.done || (e.media.episodes && s.progress >= e.media.episodes));
  const finishedCount = (e) => e.sessions.filter((s) => sessionDone(e, s)).length;
  const isRewatch = (e) => cur(e).n > 0;
  const epTotal = (e) => e.media.episodes || null;
  // tryb uzupełniania: wszystko, co teraz oznaczysz, zapisuje się bez daty
  const backfill = () => !!S.settings.backfill;

  function airedEpisodes(m) {
    if (!m) return null;
    if (m.nextAiringEpisode && m.nextAiringEpisode.episode) {
      const n = m.nextAiringEpisode;
      if (n.airingAt * 1000 <= now()) return n.episode; // już wyemitowany, czekamy na odświeżenie
      return n.episode - 1;
    }
    if (m.status === 'FINISHED') return m.episodes || null;
    if (m.status === 'NOT_YET_RELEASED') return 0;
    return null;
  }

  function event(ev) {
    const e = S.entries[ev.m];
    S.history.push({ id: uid(), t: now(), ti: e ? titleOf(e.media, 'romaji') : ev.ti, ...ev });
  }

  function touch(e) { e.updatedAt = now(); save(); emit('library', { id: e.id }); }

  // początek i koniec obejrzenia: z datą albo, w trybie uzupełniania, bez daty
  function markStarted(e, s, t, { silent = false, nodate = backfill() } = {}) {
    if (s.startedAt || s.nodate) return;
    if (nodate) { s.nodate = true; return; }
    s.startedAt = t;
    if (!silent) event({ k: 'start', m: e.id, s: s.n });
  }
  function markFinished(e, s, t, { nodate = backfill() } = {}) {
    if (s.finishedAt || s.done) return false;
    s.done = true;
    if (nodate) s.nodate = true;
    else { s.finishedAt = t; event({ k: 'finish', m: e.id, s: s.n }); }
    return true;
  }
  function unmarkFinished(s) { s.finishedAt = null; s.done = false; }

  // jeden wpis w historii zamiast dziesiątek odcinków z dzisiejszą datą
  function logBackfill(e, s, from, to, { rewatch = false } = {}) {
    const last = S.history[S.history.length - 1];
    if (!rewatch && last && last.k === 'backfill' && last.m === e.id && last.s === s.n && !last.rw && last.to + 1 === from) {
      last.to = to;
      last.t = now();
      return;
    }
    S.history.push({ id: uid(), t: now(), k: 'backfill', m: e.id, s: s.n, from, to, rw: rewatch || undefined, ti: titleOf(e.media, 'romaji') });
  }

  /* ---------- odcinki jako zakresy ----------
     s.ranges: [[od, do], ...] posortowane i rozłączne; brak = odcinki 1..progress.
     s.progress zawsze = liczba obejrzanych odcinków tej sesji, więc czas i statystyki
     liczą tylko to, co faktycznie zaznaczone (np. 20 ostatnich odcinków DBZ). */
  const rangesOf = (s) => (s.ranges && s.ranges.length ? s.ranges : (s.progress ? [[1, s.progress]] : []));
  function normRanges(list) {
    const r = list.filter(([a, b]) => b >= a && a >= 1).map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [a, b] of r) { const l = out[out.length - 1]; if (l && a <= l[1] + 1) l[1] = Math.max(l[1], b); else out.push([a, b]); }
    return out;
  }
  const countRanges = (r) => r.reduce((n, [a, b]) => n + b - a + 1, 0);
  const lastEpOf = (s) => { const r = rangesOf(s); return r.length ? r[r.length - 1][1] : 0; };
  const hasEp = (s, n) => rangesOf(s).some(([a, b]) => n >= a && n <= b);
  function subtractRange(r, from, to) {
    const out = [];
    for (const [a, b] of r) {
      if (b < from || a > to) { out.push([a, b]); continue; }
      if (a < from) out.push([a, from - 1]);
      if (b > to) out.push([to + 1, b]);
    }
    return out;
  }
  function applyRanges(s, list) {
    const r = normRanges(list);
    if (!r.length) { delete s.ranges; s.progress = 0; }
    else if (r.length === 1 && r[0][0] === 1) { delete s.ranges; s.progress = r[0][1]; }
    else { s.ranges = r; s.progress = countRanges(r); }
  }
  const rangesText = (s) => rangesOf(s).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
  // wpisy trybu uzupełniania (od–do) przycinamy do odznaczonego zakresu
  function trimBackfill(id, sn, from, to) {
    const out = [];
    for (const h of S.history) {
      if (h.k !== 'backfill' || h.m !== id || h.s !== sn || h.rw || h.to < from || h.from > to) { out.push(h); continue; }
      if (h.from < from) out.push({ ...h, to: from - 1 });
      if (h.to > to) out.push({ ...h, id: uid(), from: to + 1 });
    }
    S.history = out;
  }

  // zaznacz albo odznacz dowolne odcinki bieżącego obejrzenia (np. 272–291)
  function setEpisodes(id, from, to, watched, { nodate = backfill(), quiet = false } = {}) {
    const e = get(id);
    if (!e) return 0;
    const s = cur(e);
    const total = epTotal(e);
    from = Math.max(1, Math.floor(from));
    to = Math.floor(to);
    if (total) to = Math.min(to, total);
    if (!(to >= from)) return 0;
    const before = rangesOf(s).map((x) => x.slice());
    const t = now();
    const ti = titleOf(e.media, 'romaji');
    let changed;
    if (watched) {
      let add = [[from, to]];
      for (const [a, b] of before) add = subtractRange(add, a, b);
      changed = countRanges(add);
      if (!changed) return 0;
      applyRanges(s, [...before, [from, to]]);
      if (nodate) add.forEach(([a, b]) => logBackfill(e, s, a, b));
      else add.forEach(([a, b]) => { for (let ep = a; ep <= b; ep++) S.history.push({ id: uid(), t, k: 'ep', m: id, s: s.n, ep, bulk: changed > 1, ti }); });
      markStarted(e, s, t, { nodate });
      if (s.progress > 0 && (e.status === 'planning' || e.status === 'paused' || e.status === 'dropped')) {
        event({ k: 'status', m: id, from: e.status, to: 'watching', s: s.n });
        e.status = 'watching';
      }
      if (total && s.progress >= total) {
        if (markFinished(e, s, t, { nodate }) && !quiet) toast(`Ukończono: ${titleOf(e.media)}${s.n ? ` (rewatch #${s.n})` : ''}${nodate ? ' · bez daty' : ''}`, { kind: 'ok' });
        if (e.status !== 'completed') { event({ k: 'status', m: id, from: e.status, to: 'completed', s: s.n }); e.status = 'completed'; }
      }
    } else {
      const after = subtractRange(before, from, to);
      changed = countRanges(before) - countRanges(after);
      if (!changed) return 0;
      applyRanges(s, after);
      S.history = S.history.filter((h) => !(h.k === 'ep' && h.m === id && h.s === s.n && h.ep >= from && h.ep <= to));
      trimBackfill(id, s.n, from, to);
      if (total && s.progress < total && (s.finishedAt || s.done)) {
        unmarkFinished(s);
        if (e.status === 'completed') e.status = 'watching';
      }
    }
    touch(e);
    return changed;
  }

  /* ---------- operacje na liście ---------- */
  function add(media, status = 'planning') {
    if (!media || !media.id) return null;
    if (S.entries[media.id]) { setStatus(media.id, status); return S.entries[media.id]; }
    const snap = snapshot(media);
    const e = {
      id: media.id, idMal: media.idMal ?? null, status: 'planning',
      score: null, notes: '', favorite: false, tags: [], durationOverride: null,
      addedAt: now(), updatedAt: now(), mediaFetchedAt: now(),
      lastAiredNotified: airedEpisodes(snap),
      sessions: [{ n: 0, startedAt: null, finishedAt: null, progress: 0 }],
      media: snap,
    };
    S.entries[media.id] = e;
    event({ k: 'add', m: media.id, to: status });
    if (status !== 'planning') setStatus(media.id, status, { silentEvent: true });
    touch(e);
    return e;
  }

  function remove(id) {
    const e = S.entries[id];
    if (!e) return null;
    const snap = JSON.parse(JSON.stringify(e));
    delete S.entries[id];
    S.history.push({ id: uid(), t: now(), k: 'remove', m: id, ti: titleOf(e.media, 'romaji') });
    save();
    emit('library', { id, removed: true });
    return snap;
  }
  function restore(entry) {
    S.entries[entry.id] = entry;
    S.history = S.history.filter((h) => !(h.k === 'remove' && h.m === entry.id && now() - h.t < 120000));
    touch(entry);
  }

  function setStatus(id, status, { silentEvent = false } = {}) {
    const e = get(id);
    if (!e || !LIST_STATUSES.includes(status)) return;
    const from = e.status;
    if (from === status) return;
    const s = cur(e);
    if (!silentEvent) event({ k: 'status', m: id, from, to: status, s: s.n });
    if (status === 'completed') {
      const total = epTotal(e);
      e.status = 'completed';
      // przy wybranych odcinkach (np. pominięte fillery) nie dopisujemy reszty
      if (total && s.progress < total && !s.ranges) {
        setProgress(id, total, { fromStatus: true });
        return;
      }
      markStarted(e, s, now(), { silent: true });
      markFinished(e, s, now());
    } else {
      e.status = status;
      if (status === 'watching') markStarted(e, s, now());
      if ((s.finishedAt || s.done) && epTotal(e) && s.progress < epTotal(e)) unmarkFinished(s);
    }
    touch(e);
  }

  function setProgress(id, n, { fromStatus = false } = {}) {
    const e = get(id);
    if (!e) return;
    const s = cur(e);
    const total = epTotal(e);
    n = Math.max(0, Math.floor(Number(n) || 0));
    if (total) n = Math.min(n, total);
    if (s.ranges) {
      // wpisana liczba przy wybranych odcinkach = „obejrzane 1..n”
      const last = lastEpOf(s);
      if (n > 0) setEpisodes(id, 1, n, true, { quiet: fromStatus });
      if (last > n) setEpisodes(id, n + 1, last, false);
      return;
    }
    const old = s.progress;
    if (n === old && !fromStatus) return;
    const t = now();
    if (n > old) {
      if (backfill()) logBackfill(e, s, old + 1, n);
      else {
        const bulk = n - old > 1;
        for (let ep = old + 1; ep <= n; ep++) S.history.push({ id: uid(), t, k: 'ep', m: id, s: s.n, ep, bulk, ti: titleOf(e.media, 'romaji') });
      }
      markStarted(e, s, t);
    } else if (n < old) {
      S.history = S.history.filter((h) => !(h.k === 'ep' && h.m === id && h.s === s.n && h.ep > n));
      // wpisy trybu uzupełniania przycinamy do nowego postępu
      S.history = S.history.filter((h) => {
        if (h.k !== 'backfill' || h.m !== id || h.s !== s.n || h.rw) return true;
        if (h.to > n) h.to = n;
        return h.to >= h.from;
      });
    }
    s.progress = n;
    if (n > 0 && (e.status === 'planning' || e.status === 'paused' || e.status === 'dropped')) {
      event({ k: 'status', m: id, from: e.status, to: 'watching', s: s.n });
      e.status = 'watching';
    }
    if (total && n >= total) {
      if (markFinished(e, s, t) && !fromStatus) {
        toast(`Ukończono: ${titleOf(e.media)}${s.n ? ` (rewatch #${s.n})` : ''}${backfill() ? ' · bez daty' : ''}`, { kind: 'ok' });
      }
      if (e.status !== 'completed') {
        if (!fromStatus) event({ k: 'status', m: id, from: e.status, to: 'completed', s: s.n });
        e.status = 'completed';
      }
    } else if (total && n < total) {
      if (s.finishedAt || s.done) unmarkFinished(s);
      if (e.status === 'completed') e.status = 'watching';
    }
    touch(e);
  }

  // plusik: następny odcinek po ostatnim obejrzanym; w trybie pomijania przeskakuje fillery i recapy
  function increment(id, d = 1) {
    const e = get(id);
    if (!e) return;
    const s = cur(e);
    if (d < 0) {
      if (!s.ranges) { setProgress(id, s.progress + d); return; }
      const last = lastEpOf(s);
      if (last) setEpisodes(id, last, last, false);
      return;
    }
    const total = epTotal(e);
    let next = lastEpOf(s) + 1;
    const skip = S.settings.skipFiller && typeof Episodes !== 'undefined' ? Episodes.skipSet(e) : null;
    const from = next;
    if (skip) while (skip.has(next) && (!total || next < total)) next++;
    if (total && next > total) return;
    const skipped = next - from;
    if (!s.ranges && !skipped) { setProgress(id, next); return; }
    setEpisodes(id, next, next, true);
    if (skipped) toast(`Pominięto ${nUnit(skipped, 'episode')} (filler lub recap): ${skipped > 1 ? `${from}–${next - 1}` : from} · teraz odc. ${next}`, { kind: 'ok', ms: 3500 });
    // koniec serii mimo pominiętych fillerów
    if (skip && total && next === total && s.progress < total) {
      let onlySkipped = true;
      for (let ep = 1; ep <= total && onlySkipped; ep++) if (!hasEp(s, ep) && !skip.has(ep)) onlySkipped = false;
      if (onlySkipped) {
        if (markFinished(e, s, now())) toast(`Ukończono: ${titleOf(e.media)} (bez fillerów)`, { kind: 'ok' });
        if (e.status !== 'completed') { event({ k: 'status', m: id, from: e.status, to: 'completed', s: s.n }); e.status = 'completed'; }
        touch(e);
      }
    }
  }

  function startRewatch(id) {
    const e = get(id);
    if (!e) return;
    const n = e.sessions.length;
    const bf = backfill();
    const s = { n, startedAt: bf ? null : now(), finishedAt: null, progress: 0 };
    if (bf) s.nodate = true;
    e.sessions.push(s);
    if (bf) logBackfill(e, s, 0, 0, { rewatch: true });
    else event({ k: 'rewatch', m: id, s: n });
    e.status = 'watching';
    touch(e);
    toast(bf ? `Dopisujesz rewatch #${n} bez daty: ${titleOf(e.media)}` : `Rozpoczęto rewatch #${n}: ${titleOf(e.media)}`, { kind: 'ok' });
  }

  function cancelRewatch(id) {
    const e = get(id);
    if (!e || e.sessions.length < 2) return;
    const s = cur(e);
    S.history = S.history.filter((h) => !(h.m === id && h.s === s.n && (h.k === 'ep' || h.k === 'rewatch' || h.k === 'backfill')));
    e.sessions.pop();
    e.status = 'completed';
    touch(e);
  }

  // Obejrzenie sprzed korzystania z aplikacji. Trafia na początek, więc staje się
  // „pierwszym obejrzeniem”, a dotychczasowe sesje przesuwają się o jeden numer.
  function addPastWatch(id, { startedAt = null, finishedAt = null } = {}) {
    const e = get(id);
    if (!e) return;
    const total = epTotal(e) || Math.max(1, ...e.sessions.map((s) => s.progress || 0));
    S.history.forEach((h) => { if (h.m === id && typeof h.s === 'number') h.s += 1; });
    e.sessions.unshift({ n: 0, startedAt, finishedAt: finishedAt || null, progress: total, past: true, done: true });
    const last = cur(e);
    if (e.sessions.length > 1 && last.progress === 0 && !last.startedAt && e.status !== 'watching') {
      e.sessions.pop();
      e.status = 'completed';
    }
    e.sessions.forEach((x, i) => { x.n = i; });
    const ti = titleOf(e.media, 'romaji');
    if (finishedAt) {
      for (let ep = 1; ep <= total; ep++) S.history.push({ id: uid(), t: finishedAt, k: 'ep', m: id, s: 0, ep, bulk: true, past: true, ti });
    }
    S.history.push({ id: uid(), t: now(), k: 'past', m: id, s: 0, at: finishedAt, ti });
    touch(e);
  }

  function removeSession(id, n) {
    const e = get(id);
    if (!e || e.sessions.length < 2) return;
    S.history = S.history.filter((h) => !(h.m === id && h.s === n));
    S.history.forEach((h) => { if (h.m === id && h.s > n) h.s -= 1; });
    e.sessions.splice(n, 1);
    e.sessions.forEach((x, i) => { x.n = i; });
    touch(e);
  }

  function updateSession(id, n, patch) {
    const e = get(id);
    if (!e || !e.sessions[n]) return;
    Object.assign(e.sessions[n], patch);
    touch(e);
  }

  /* ---------- oceny szczegółowe ---------- */
  // Ocena ogólna = średnia z ocenionych kategorii, chyba że wpiszesz ją ręcznie.
  function ratingMean(e) {
    const r = (e && e.rating) || {};
    const v = RATE_CATS.map(([k]) => r[k]).filter((x) => x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  const ratedCount = (e) => RATE_CATS.filter(([k]) => e.rating && e.rating[k] > 0).length;
  function applyAuto(e) {
    if (e.scoreManual) return;
    const m = ratingMean(e);
    if (m == null) return;
    const next = Math.round(m * 10) / 10;
    if (next !== e.score) { e.score = next; event({ k: 'score', m: e.id, to: next }); }
  }
  function setRating(id, cat, val) {
    const e = get(id);
    if (!e || !RATE_CATS.some(([k]) => k === cat)) return;
    e.rating = { ...(e.rating || {}) };
    if (val > 0) e.rating[cat] = Math.min(10, Math.round(val * 2) / 2); else delete e.rating[cat];
    applyAuto(e);
    touch(e);
  }
  function setScoreManual(id, v) {
    const e = get(id);
    if (!e) return;
    // „brak” przy ustawionych suwakach = wróć do średniej kategorii (inaczej ocena ogólna znikała i przestawała się liczyć)
    if (v == null && ratedCount(e) > 0) { e.scoreManual = false; applyAuto(e); touch(e); return; }
    e.score = v;
    e.scoreManual = v != null && ratedCount(e) > 0;
    event({ k: 'score', m: id, to: v });
    touch(e);
  }
  function setScoreAuto(id) {
    const e = get(id);
    if (!e) return;
    e.scoreManual = false;
    applyAuto(e);
    touch(e);
  }

  /* ---------- ulubione postacie ---------- */
  function toggleFavChar(c, media) {
    S.favChars = S.favChars || {};
    if (S.favChars[c.id]) delete S.favChars[c.id];
    else S.favChars[c.id] = { id: c.id, n: c.n, img: c.img || null, va: c.va || null, mid: media ? media.id : null, mt: media ? titleOf(media, 'romaji') : '', t: now() };
    save();
    emit('favchars', { id: c.id });
    return !!S.favChars[c.id];
  }

  function setField(id, field, value) {
    const e = get(id);
    if (!e) return;
    e[field] = value;
    if (field === 'score') event({ k: 'score', m: id, to: value });
    if (field === 'favorite') event({ k: 'fav', m: id, to: value });
    touch(e);
  }

  function updateMedia(media) {
    const e = get(media && media.id);
    if (!e) return;
    applyMediaUpdate(e, media);
    save();
    emit('library', { id: e.id, media: true });
  }

  /* ---------- statystyki ---------- */
  function stats() {
    const entries = Object.values(S.entries);
    const byStatus = Object.fromEntries(LIST_STATUSES.map((s) => [s, 0]));
    let eps = 0, minutes = 0, rewatches = 0, rewatchesDone = 0, missingDur = [], favs = 0;
    const perAnime = [];
    for (const e of entries) {
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
      const ep = totalEps(e);
      const d = epDur(e);
      const min = d ? ep * d : 0;
      eps += ep;
      minutes += min;
      if (!d && ep > 0) missingDur.push(e);
      const rw = e.sessions.length - 1;
      rewatches += rw;
      rewatchesDone += e.sessions.slice(1).filter((s) => sessionDone(e, s)).length;
      if (e.favorite) favs++;
      if (ep > 0) perAnime.push({ e, eps: ep, min, watches: finishedCount(e), sessions: e.sessions.length });
    }
    const epsWithDur = entries.reduce((a, e) => a + (epDur(e) ? totalEps(e) : 0), 0);

    // czas w miesiącach/latach z historii odcinków (tylko pozycje nadal na liście)
    const months = {}, years = {}, monthEps = {};
    let datedMinutes = 0;
    for (const h of S.history) {
      if (h.k !== 'ep') continue;
      const e = S.entries[h.m];
      if (!e) continue;
      const d = epDur(e);
      const mk = monthKey(h.t), yk = String(new Date(h.t).getFullYear());
      monthEps[mk] = (monthEps[mk] || 0) + 1;
      if (!d) continue;
      months[mk] = (months[mk] || 0) + d;
      years[yk] = (years[yk] || 0) + d;
      datedMinutes += d;
    }
    // gatunki ważone czasem
    const genres = {};
    for (const p of perAnime) for (const g of (p.e.media.genres || [])) genres[g] = (genres[g] || 0) + p.min;

    return {
      total: entries.length, byStatus, favs, eps, minutes, rewatches, rewatchesDone,
      avgEp: epsWithDur ? minutes / epsWithDur : 0,
      missingDur, perAnime, months, monthEps, years, genres,
      undatedMinutes: Math.max(0, minutes - datedMinutes),
    };
  }

  function thisMonthMinutes() {
    const mk = monthKey(now());
    let m = 0;
    for (const h of S.history) {
      if (h.k !== 'ep' || monthKey(h.t) !== mk) continue;
      const e = S.entries[h.m];
      const d = e && epDur(e);
      if (d) m += d;
    }
    return m;
  }

  /* ---------- odświeżanie danych z AniList + wykrywanie zmian ---------- */
  function needsRefresh(e) {
    // wpisy sprzed dodania popularności do migawki dociągamy raz
    if (e.media && e.media.popularity === undefined) return true;
    const age = now() - (e.mediaFetchedAt || 0);
    const st = e.media && e.media.status;
    const next = e.media && e.media.nextAiringEpisode;
    if (next && next.airingAt * 1000 < now()) return true;
    if (st === 'RELEASING' || st === 'NOT_YET_RELEASED' || st === 'HIATUS') return age > 45 * 60e3;
    return age > 7 * 86400e3;
  }

  function applyMediaUpdate(e, m) {
    const old = e.media || {};
    const fresh = snapshot(m);
    const name = titleOf(fresh);
    const link = `#/anime/${e.id}`;
    // premiery i emisje pozycji 18+ nie generują powiadomień
    const notify = fresh.isAdult ? () => false : notifyRaw;

    if (old.status && fresh.status && old.status !== fresh.status) {
      if (old.status === 'NOT_YET_RELEASED' && fresh.status === 'RELEASING') {
        notify({ kind: 'premiere', key: `prem:${e.id}`, title: `Premiera: ${name}`, body: 'Emisja właśnie się rozpoczęła.', link });
      } else if (fresh.status === 'FINISHED') {
        notify({ kind: 'change', key: `fin:${e.id}`, title: `${name} zakończyło emisję`, body: fresh.episodes ? `Łącznie ${nUnit(fresh.episodes, 'episode')}.` : '', link });
      } else {
        notify({ kind: 'change', key: `st:${e.id}:${fresh.status}`, title: `${name}: ${MSTATUS_PL[fresh.status] || fresh.status}`, body: `Wcześniej: ${MSTATUS_PL[old.status] || old.status}.`, link });
      }
    }
    if (old.episodes && fresh.episodes && old.episodes !== fresh.episodes) {
      notify({ kind: 'change', key: `eps:${e.id}:${fresh.episodes}`, title: `${name}: zmiana liczby odcinków`, body: `${old.episodes} → ${fresh.episodes}`, link });
    }
    if (fresh.status === 'NOT_YET_RELEASED' && old.startDate && fuzzyDate(old.startDate) !== fuzzyDate(fresh.startDate) && fuzzyDate(fresh.startDate)) {
      notify({ kind: 'premiere', key: `date:${e.id}:${fuzzyDate(fresh.startDate)}`, title: `${name}: nowa data premiery`, body: `${fuzzyDate(fresh.startDate)} (wcześniej: ${fuzzyDate(old.startDate) || 'nieustalona'}).`, link });
    }
    const aired = airedEpisodes(fresh);
    if (aired != null && (e.status === 'watching' || e.status === 'planning')) {
      const prev = e.lastAiredNotified ?? aired;
      if (aired > prev && aired > cur(e).progress) {
        notify({ kind: 'episode', key: `ep:${e.id}:${aired}`, title: `Nowy odcinek: ${name}`, body: `Odcinek ${aired} jest już po emisji.`, link });
      }
    }
    if (aired != null) e.lastAiredNotified = Math.max(e.lastAiredNotified ?? 0, aired);
    e.media = fresh;
    e.idMal = fresh.idMal ?? e.idMal;
    e.mediaFetchedAt = now();
  }

  let refreshing = null;
  async function refresh({ force = false } = {}) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const list = Object.values(S.entries).filter((e) => force || needsRefresh(e));
      if (!list.length) return { updated: 0 };
      const res = await Ani.byIds(list.map((e) => e.id), { force: true });
      if (res.stale) return { updated: 0, stale: true };
      const byId = new Map(res.media.map((m) => [m.id, m]));
      let updated = 0;
      for (const old of list) {
        // w trakcie pobierania inna karta mogła podmienić listę: bierzemy aktualny wpis
        const e = S.entries[old.id];
        const m = byId.get(old.id);
        if (e && m) { applyMediaUpdate(e, m); updated++; }
      }
      S.meta.lastRefresh = now();
      save();
      emit('library', { refresh: true });
      return { updated };
    })();
    try { return await refreshing; } finally { refreshing = null; }
  }

  // co minutę: czy zaplanowany odcinek właśnie minął?
  function checkAiring() {
    let due = false;
    for (const e of Object.values(S.entries)) {
      const n = e.media && e.media.nextAiringEpisode;
      if (!n || n.airingAt * 1000 > now()) continue;
      due = true;
      if (e.media.isAdult) continue;
      if ((e.status === 'watching' || e.status === 'planning') && n.episode > (e.lastAiredNotified ?? 0) && n.episode > cur(e).progress) {
        const name = titleOf(e.media);
        if (n.episode === 1 && e.status === 'planning') {
          notify({ kind: 'premiere', key: `prem:${e.id}`, title: `Premiera: ${name}`, body: 'Pierwszy odcinek jest już po emisji.', link: `#/anime/${e.id}` });
        } else {
          notify({ kind: 'episode', key: `ep:${e.id}:${n.episode}`, title: `Nowy odcinek: ${name}`, body: `Odcinek ${n.episode} jest już po emisji.`, link: `#/anime/${e.id}` });
        }
        e.lastAiredNotified = n.episode;
        save();
      }
    }
    if (due) refresh().catch(() => {});
  }

  /* ---------- przeniesienie obejrzeń do przeszłości (soft reset) ---------- */
  // Co wchodzi w zakres: odcinki i znaczniki początku/końca obejrzeń z [from, to].
  // Pomijamy obejrzenia z ręcznie wpisaną datą (past) i wszystko, co dotyczy listy
  // (dodanie, statusy, oceny) — to są prawdziwe dzisiejsze działania.
  const RESET_KINDS = new Set(['start', 'finish', 'rewatch']);
  const inRange = (ts, from, to) => !!ts && ts >= from && ts <= to;

  function resetScan(from, to) {
    const map = new Map();
    const row = (m) => {
      if (!map.has(m)) map.set(m, { id: m, eps: 0, last: 0, sess: new Set(), epMin: Infinity, epMax: 0 });
      return map.get(m);
    };
    for (const h of S.history) {
      if (!S.entries[h.m] || !inRange(h.t, from, to)) continue;
      if (h.k === 'ep' && !h.past) {
        const x = row(h.m);
        x.eps++; x.sess.add(h.s); x.last = Math.max(x.last, h.t);
        x.epMin = Math.min(x.epMin, h.ep); x.epMax = Math.max(x.epMax, h.ep);
      } else if (RESET_KINDS.has(h.k)) {
        const x = row(h.m); x.last = Math.max(x.last, h.t);
      }
    }
    for (const e of Object.values(S.entries)) {
      for (const s of e.sessions) {
        if (s.past) continue;
        if (inRange(s.startedAt, from, to) || inRange(s.finishedAt, from, to)) {
          const x = row(e.id);
          x.last = Math.max(x.last, s.finishedAt || s.startedAt);
        }
      }
    }
    return [...map.values()].map((x) => {
      const e = S.entries[x.id];
      return { ...x, e, sessions: x.sess.size, minutes: x.eps * (epDur(e) || 0) };
    }).sort((a, b) => b.last - a.last);
  }

  function resetToPast(from, to, ids) {
    const set = new Set(ids.map(Number));
    if (!set.size) return null;
    maybeBackup(true); // pełna kopia stanu sprzed operacji (Ustawienia → kopie)
    const removed = [], sessions = [], added = [];
    const per = new Map();
    S.history = S.history.filter((h) => {
      if (!set.has(h.m) || !inRange(h.t, from, to)) return true;
      if ((h.k === 'ep' && !h.past) || RESET_KINDS.has(h.k)) {
        removed.push(h);
        if (h.k === 'ep') {
          const p = per.get(h.m) || { n: 0, sess: new Set() };
          p.n++; p.sess.add(h.s); per.set(h.m, p);
        }
        return false;
      }
      return true;
    });
    for (const id of set) {
      const e = S.entries[id];
      if (!e) continue;
      for (const s of e.sessions) {
        if (s.past) continue;
        const st = inRange(s.startedAt, from, to), fi = inRange(s.finishedAt, from, to);
        if (!st && !fi) continue;
        sessions.push({ m: id, n: s.n, len: e.sessions.length, startedAt: s.startedAt, finishedAt: s.finishedAt, nodate: s.nodate, done: s.done });
        if (st) s.startedAt = null;
        if (fi) { s.finishedAt = null; s.done = true; }
        s.nodate = true;
      }
      const p = per.get(id);
      const ev = { id: uid(), t: now(), k: 'archived', m: id, n: p ? p.n : 0, sess: p ? p.sess.size : 0, ti: titleOf(e.media, 'romaji') };
      S.history.push(ev);
      added.push(ev.id);
    }
    const eps = removed.filter((h) => h.k === 'ep').length;
    S.meta.lastReset = { t: now(), from, to, count: added.length, eps, removed, sessions, added };
    saveNow();
    emit('library', { kind: 'reset' });
    return { count: added.length, eps };
  }

  function undoReset() {
    const r = S.meta.lastReset;
    if (!r) return false;
    const drop = new Set(r.added);
    S.history = S.history.filter((h) => !drop.has(h.id));
    const have = new Set(S.history.map((h) => h.id));
    for (const h of r.removed) if (!have.has(h.id) && S.entries[h.m]) S.history.push(h);
    S.history.sort((a, b) => a.t - b.t);
    for (const x of r.sessions) {
      const e = S.entries[x.m];
      // numeracja obejrzeń mogła się zmienić (np. dopisane obejrzenie) — wtedy nie zgadujemy
      if (!e || e.sessions.length !== x.len || !e.sessions[x.n]) continue;
      Object.assign(e.sessions[x.n], { startedAt: x.startedAt, finishedAt: x.finishedAt, nodate: x.nodate, done: x.done });
    }
    S.meta.lastReset = null;
    saveNow();
    emit('library', { kind: 'reset-undo' });
    return true;
  }

  /* ---------- powiadomienia ---------- */
  function notifyRaw(opts) { return notify(opts); }
  function notify({ kind, key, title, body = '', link = '' }) {
    if (key && S.meta.notifKeys[key]) return false;
    if (key) S.meta.notifKeys[key] = now();
    const n = { id: uid(), t: now(), kind, title, body, link, read: false };
    S.notifs.unshift(n);
    if (S.notifs.length > 200) S.notifs.length = 200;
    const keys = Object.entries(S.meta.notifKeys);
    if (keys.length > 2000) {
      keys.sort((a, b) => a[1] - b[1]).slice(0, keys.length - 1500).forEach(([k]) => delete S.meta.notifKeys[k]);
    }
    save();
    emit('notifs', n);
    if (S.settings.notifyKinds[kind] !== false && S.settings.sysNotify && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const sys = new Notification(title, { body, icon: 'icons/icon-192.png', tag: key || n.id });
        sys.onclick = () => { window.focus(); if (link) location.hash = link; };
      } catch { /* niektóre przeglądarki mobilne wymagają service workera */ }
    }
    return true;
  }
  const unreadCount = () => S.notifs.filter((n) => !n.read && S.settings.notifyKinds[n.kind] !== false).length;
  function markAllRead() { S.notifs.forEach((n) => { n.read = true; }); save(); emit('notifs'); }

  return {
    snapshot, get, cur, epDur, totalEps, entryMinutes, sessionDone, finishedCount, isRewatch, epTotal, airedEpisodes,
    rangesOf, rangesText, hasEp, lastEpOf, lastEp: (e) => lastEpOf(cur(e)), setEpisodes,
    add, remove, restore, setStatus, setProgress, increment, startRewatch, cancelRewatch, addPastWatch,
    removeSession, updateSession, setField, updateMedia, applyMediaUpdate,
    resetScan, resetToPast, undoReset,
    ratingMean, ratedCount, setRating, setScoreManual, setScoreAuto, toggleFavChar,
    stats, thisMonthMinutes, refresh, checkAiring, notify, unreadCount, markAllRead,
  };
})();


/* ===== js/cloud.js ===== */
'use strict';
/* ==========================================================================
   Disboard — konto Google i synchronizacja listy między urządzeniami (Firebase).

   Lista dalej mieszka lokalnie (IndexedDB) i działa bez internetu; chmura jest
   jej lustrem. Synchronizuje jedna karta naraz (Web Locks), pozostałe karty
   dostają zmiany tak jak dotąd, przez bazę i BroadcastChannel.

   Jak to działa:
   • w chmurze (Firestore) leży jedna wersja listy: users/{uid}/data/state
     (mały opis: numer wersji, rozmiar) i users/{uid}/parts/{wersja}_{i}
     (lista spakowana gzipem, w kawałkach po < 1 MB);
   • „baza” = ostatnia wersja, którą to urządzenie wymieniło z chmurą; zapisana
     lokalnie, służy do łączenia trójstronnego (te same funkcje co między kartami);
   • zapis: tylko gdy wersja w chmurze = nasza baza (transakcja); inaczej najpierw
     pobieramy, łączymy, potem zapis;
   • porównujemy listy w postaci uporządkowanej (klucze i historia w stałej
     kolejności), żeby dwa urządzenia nie odsyłały sobie w kółko tego samego.
   ========================================================================== */

const Cloud = (() => {
  const CONFIG = {
    apiKey: 'AIzaSyBn37VYsh3ucxM3Hu2Y626gcS1p79AAnQU',
    authDomain: 'disboard-63851.firebaseapp.com',
    projectId: 'disboard-63851',
    storageBucket: 'disboard-63851.firebasestorage.app',
    messagingSenderId: '511078577624',
    appId: '1:511078577624:web:e3bd8d85938d5ca1a0eead',
  };
  const SDK = '10.14.1';
  const SITE = 'https://sznaga1.github.io/disboard/';
  // pola zależne od urządzenia: nie jeżdżą między sprzętami (inaczej każde
  // odświeżenie danych wysyłałoby całą listę)
  const LOCAL_META = ['lastRefresh', 'lastBackupAt', 'lastNewsCheck', 'lastReset', 'traceLog'];
  const PUSH_DELAY = 4000;
  const MIN_GAP = 15000;
  const PART = 900000; // dokument Firestore ma limit 1 MiB

  const st = { phase: 'off', user: null, lastSync: 0, error: null, leader: false };
  let remote = null;     // adapter chmury (Firebase albo testowy)
  let uidCur = null;
  let base = null;       // { uid, rev, canon }
  let unsub = null;
  let chain = Promise.resolve();
  let timer = null;
  let lastPush = 0;
  let writingRev = null;
  let started = false;

  const setPhase = (phase, extra = {}) => { Object.assign(st, { phase, ...extra }); emit('cloud', status()); };
  const status = () => ({ ...st, user: st.user ? { ...st.user } : null });
  const supportedHere = () => location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);

  /* ---------- postać listy do porównań i wysyłki ---------- */
  function syncView(state) {
    const meta = { ...(state.meta || {}) };
    for (const k of LOCAL_META) delete meta[k];
    return { ...state, meta };
  }
  const byTimeId = (a, b) => (a.t - b.t) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  function canon(state) {
    const v = syncView(state);
    v.history = [...(v.history || [])].sort(byTimeId);
    v.notifs = [...(v.notifs || [])].sort((a, b) => -byTimeId(a, b));
    return JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((x) => [x, val[x]]))
      : val));
  }

  /* ---------- baza (ostatnia wersja wymieniona z chmurą) ---------- */
  async function loadBase() { try { return (await SDB.get('cloudBase')) || null; } catch { return null; } }
  async function setBase(b) {
    base = b;
    try { await SDB.put('cloudBase', b); } catch (e) { console.warn('Nie zapisano stanu synchronizacji', e); }
  }

  const enqueue = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  /* ---------- pobranie i połączenie ---------- */
  async function pull(meta) {
    const raw = await remote.read(meta);
    const theirsCanon = canon(normalizeState(JSON.parse(raw)));
    const theirs = JSON.parse(theirsCanon);
    const localEmpty = !Object.keys(S.entries).length;
    const keep = {};
    for (const k of LOCAL_META) if (S.meta[k] !== undefined) keep[k] = S.meta[k];
    let merged;
    if (!base && localEmpty) merged = theirs; // nowe urządzenie: bierzemy listę z chmury w całości
    else merged = mergeStates(base ? JSON.parse(base.canon) : {}, JSON.parse(canon(S)), theirs);
    S = normalizeState(merged);
    Object.assign(S.meta, keep);
    await setBase({ uid: uidCur, rev: meta.rev, canon: theirsCanon });
    save();
    announceSync();
  }

  /* ---------- wysyłka ---------- */
  async function push(attempt = 0) {
    const c = canon(S);
    if (base && c === base.canon) return false; // nic nowego
    const rev = uid();
    writingRev = rev;
    const r = await remote.write(base ? base.rev : null, rev, c);
    if (r.conflict) {
      if (attempt >= 3) throw new Error('Chmura zmienia się szybciej, niż nadążam. Spróbuję za chwilę.');
      if (r.meta) await pull(r.meta);
      else await setBase(null); // ktoś usunął listę z chmury: zapisujemy od nowa
      return push(attempt + 1);
    }
    await setBase({ uid: uidCur, rev, canon: c });
    lastPush = Date.now();
    return true;
  }

  async function syncOnce() {
    setPhase('syncing');
    try {
      const meta = await remote.readMeta();
      if (meta && (!base || meta.rev !== base.rev)) await pull(meta);
      await push();
      setPhase('ok', { lastSync: Date.now(), error: null });
    } catch (e) {
      console.warn('Synchronizacja nie powiodła się', e);
      setPhase('error', { error: friendly(e) });
      throw e;
    }
  }
  const sync = () => enqueue(syncOnce);

  function schedule(delay = PUSH_DELAY) {
    if (!remote) return;
    clearTimeout(timer);
    const wait = Math.max(delay, lastPush + MIN_GAP - Date.now());
    timer = setTimeout(() => { timer = null; sync().catch(() => {}); }, wait);
  }

  /* ---------- podłączenie i odłączenie (też w testach, z adapterem testowym) ---------- */
  async function attach(adapter, uid) {
    remote = adapter;
    uidCur = uid;
    base = await loadBase();
    if (base && base.uid !== uid) base = null; // inne konto: łączymy jak przy pierwszym logowaniu
    try { await sync(); } catch { /* status pokazuje błąd; nasłuch i ponowienia działają dalej */ }
    unsub = remote.subscribe((meta) => {
      if (!meta || meta.rev === writingRev || (base && meta.rev === base.rev)) return;
      enqueue(async () => {
        if (base && meta.rev === base.rev) return;
        setPhase('syncing');
        try {
          await pull(meta);
          await push();
          setPhase('ok', { lastSync: Date.now(), error: null });
        } catch (e) { setPhase('error', { error: friendly(e) }); }
      });
    });
  }
  function detach() {
    if (unsub) unsub();
    unsub = null;
    remote = null;
    clearTimeout(timer);
  }

  function friendly(e) {
    const code = (e && (e.code || e.name)) || '';
    if (/permission-denied/.test(code)) return 'Baza odmówiła dostępu. Sprawdź reguły w Firestore (Etap 2, krok 4).';
    if (/unavailable|network/i.test(code) || !navigator.onLine) return 'Brak połączenia. Zsynchronizuję, gdy wróci internet.';
    if (/popup-closed|cancelled-popup/.test(code)) return 'Okno logowania zostało zamknięte.';
    if (/unauthorized-domain/.test(code)) return 'Ten adres nie jest dopisany w Firebase (Authentication → Settings → Authorized domains).';
    if (/operation-not-allowed/.test(code)) return 'Logowanie przez Google jest wyłączone w Firebase (Authentication → Sign-in method).';
    const msg = (e && e.message) || 'Nieznany błąd.';
    // Brave z włączonymi Tarczami potrafi zablokować okno logowania Google
    return navigator.brave && /auth\//.test(code) ? `${msg} W Brave: kliknij lwa w pasku adresu, wyłącz Tarcze dla tej strony i spróbuj ponownie.` : msg;
  }

  /* ---------- Firebase ---------- */
  let fb = null; // { auth, db }
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('Nie udało się wczytać Firebase (brak internetu albo blokada).'));
      document.head.append(s);
    });
  }
  async function loadFirebase() {
    if (fb) return fb;
    for (const m of ['app', 'auth', 'firestore']) await loadScript(`https://www.gstatic.com/firebasejs/${SDK}/firebase-${m}-compat.js`);
    const app = firebase.initializeApp(CONFIG);
    fb = { auth: app.auth(), db: app.firestore() };
    return fb;
  }

  async function gzip(str) {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  function firebaseAdapter(uid) {
    const { db } = fb;
    const FBlob = firebase.firestore.Blob;
    const metaRef = db.doc(`users/${uid}/data/state`);
    const partRef = (id) => db.doc(`users/${uid}/parts/${id}`);
    const device = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'telefon' : 'komputer';
    return {
      async readMeta() {
        const s = await metaRef.get();
        return s.exists ? s.data() : null;
      },
      async read(meta) {
        const snaps = await Promise.all(Array.from({ length: meta.parts }, (_, i) => partRef(`${meta.rev}_${i}`).get()));
        const chunks = snaps.map((s) => {
          if (!s.exists) throw new Error('W chmurze brakuje części listy. Spróbuję ponownie.');
          return s.data().b.toUint8Array();
        });
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let o = 0;
        for (const c of chunks) { all.set(c, o); o += c.length; }
        return gunzip(all);
      },
      async write(expectedRev, rev, json) {
        const bytes = await gzip(json);
        const parts = [];
        for (let i = 0; i < bytes.length || i === 0; i += PART) parts.push(bytes.subarray(i, i + PART));
        let conflict = null;
        await db.runTransaction(async (tx) => {
          conflict = null; // Firestore może powtórzyć tę funkcję przy równoczesnym zapisie
          const s = await tx.get(metaRef);
          const cur = s.exists ? s.data() : null;
          if ((cur ? cur.rev : null) !== expectedRev) { conflict = { meta: cur }; return; }
          parts.forEach((p, i) => tx.set(partRef(`${rev}_${i}`), { b: FBlob.fromUint8Array(p) }));
          if (cur) for (let i = 0; i < (cur.parts || 0); i++) tx.delete(partRef(`${cur.rev}_${i}`));
          tx.set(metaRef, { v: 1, rev, parts: parts.length, size: json.length, zipped: bytes.length, at: Date.now(), device });
        });
        return conflict ? { conflict: true, meta: conflict.meta } : { rev };
      },
      subscribe(cb) {
        return metaRef.onSnapshot((s) => cb(s.exists ? s.data() : null), (e) => setPhase('error', { error: friendly(e) }));
      },
    };
  }

  /* ---------- logowanie ---------- */
  async function signIn() {
    if (!supportedHere()) { location.href = SITE; return; }
    try {
      await loadFirebase();
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await fb.auth.signInWithPopup(provider);
      } catch (e) {
        // zablokowane okienko: logowanie przez przekierowanie strony
        if (/popup-blocked|operation-not-supported/.test(e.code || '')) await fb.auth.signInWithRedirect(provider);
        else throw e;
      }
    } catch (e) {
      setPhase(st.user ? st.phase : 'signedout', { error: friendly(e) });
      throw new Error(friendly(e));
    }
  }

  async function signOut() {
    detach();
    await setBase(null);
    if (fb) await fb.auth.signOut();
    setPhase('signedout', { user: null, error: null, leader: false });
  }

  // jedna karta synchronizuje; gdy ją zamkniesz, przejmuje następna
  function becomeLeader(user) {
    const go = async () => {
      if (!st.user || st.user.uid !== user.uid) return;
      st.leader = true;
      try { await attach(firebaseAdapter(user.uid), user.uid); } catch { /* status pokazuje błąd */ }
    };
    if (navigator.locks && navigator.locks.request) {
      navigator.locks.request('disboard-cloud-sync', () => go().then(() => new Promise((res) => { leaderRelease = res; })));
    } else go();
  }
  let leaderRelease = null;

  async function init() {
    if (started) return;
    started = true;
    if (!supportedHere()) { setPhase('unsupported'); return; }
    setPhase('loading');
    try { await loadFirebase(); } catch (e) {
      setPhase('error', { error: friendly(e) });
      window.addEventListener('online', () => { started = false; init(); }, { once: true });
      return;
    }
    fb.auth.getRedirectResult().catch((e) => setPhase('signedout', { error: friendly(e) }));
    fb.auth.onAuthStateChanged((user) => {
      if (!user) {
        detach();
        if (leaderRelease) { leaderRelease(); leaderRelease = null; }
        setPhase('signedout', { user: null, leader: false });
        return;
      }
      st.user = { uid: user.uid, name: user.displayName || '', email: user.email || '', photo: user.photoURL || '' };
      setPhase('syncing', { leader: false });
      becomeLeader(user);
      setTimeout(() => { if (!st.leader && st.phase === 'syncing') setPhase('ok', { error: null }); }, 3000); // inna karta synchronizuje
    });
    // zmiany na liście → wysyłka po kilku sekundach; przy chowaniu karty od razu
    // także „sync”: tak przychodzą zmiany z innych kart, które ta karta wysyła za nie
    // (po własnym pobraniu wysyłka niczego nie robi, bo lista = wersja z chmury)
    for (const ev of ['library', 'settings', 'notifs', 'favchars']) on(ev, () => schedule());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); timer = null; sync().catch(() => {}); } });
    window.addEventListener('online', () => { if (remote) sync().catch(() => {}); });
    setInterval(() => { if (remote && navigator.onLine) sync().catch(() => {}); }, 5 * 60e3);
  }

  return {
    init, signIn, signOut, status, supportedHere, SITE,
    syncNow: () => (remote ? sync() : Promise.resolve()),
    _test: { attach, detach, sync, canon, syncView, getBase: () => base, idle: () => chain },
  };
})();


  /* ---------- przejęcie zapisu i dymków ---------- */
  save = noop;          // listę zapisuje rozszerzenie (do chmury), nie przeglądarka
  saveNow = noop;
  toast = (msg) => { toasts.push(String(msg)); };

  return {
    Lib,
    titleOf,
    LIST_STATUSES,
    LSTATUS_PL,
    normalizeState,
    canon: Cloud._test.canon,
    getState: () => S,
    setState: (s) => { S = s; },
    setFlags: (malId, f) => { FLAGS[malId] = f; },
    clearFlags: () => { FLAGS = {}; },
    takeToasts: () => { const t = toasts; toasts = []; return t; },
  };
})();
if (typeof module !== 'undefined') module.exports = DisboardCore;
