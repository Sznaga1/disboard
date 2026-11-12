'use strict';
/* ==========================================================================
   Disboard — pamięć: biblioteka (localStorage), cache API i kopie zapasowe
   (IndexedDB), szyna zdarzeń.
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
  };
})();

/* ---------- stan aplikacji ---------- */
const STORE_KEY = 'disboard.library.v1';

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

let storageOk = true;
// ostatnia wersja listy z pamięci przeglądarki, na której opiera się ta karta
// (punkt odniesienia przy łączeniu zmian z innych kart)
let baseRaw = null;
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const st = normalizeState(JSON.parse(raw)); baseRaw = raw; return st; }
  } catch (e) {
    console.warn('Nie udało się wczytać biblioteki', e);
    storageOk = false;
  }
  return defaultState();
}

let S = loadState();

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

// zapis z kontrolą: jeśli inna karta zapisała od mojego ostatniego odczytu, najpierw łączę
function writeState({ force = false } = {}) {
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
function applyRemote(raw) {
  if (raw == null || raw === baseRaw) return;
  let theirs;
  try { theirs = JSON.parse(raw); } catch { return; }
  if (saveTimer) {
    try { S = mergeStates(baseRaw ? JSON.parse(baseRaw) : defaultState(), S, theirs); } catch { S = normalizeState(theirs); }
  } else {
    S = normalizeState(theirs);
  }
  baseRaw = raw;
  announceSync();
}
window.addEventListener('storage', (ev) => {
  if (ev.key === STORE_KEY && ev.storageArea === localStorage) applyRemote(ev.newValue);
});

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 200);
}
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    writeState();
    storageOk = true;
  } catch (e) {
    storageOk = false;
    console.error(e);
    toast('Nie udało się zapisać zmian w przeglądarce. Zrób eksport JSON w Ustawieniach, żeby nie stracić danych.', { kind: 'error', ms: 8000 });
  }
  maybeBackup();
}
window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

function replaceState(next) {
  S = normalizeState(next);
  clearTimeout(saveTimer);
  saveTimer = null;
  try { writeState({ force: true }); storageOk = true; } catch (e) { storageOk = false; console.error(e); }
  maybeBackup();
  emit('library', { kind: 'replace' });
  emit('settings');
}

/* ---------- automatyczne kopie zapasowe (IndexedDB, 7 dni) ---------- */
async function maybeBackup(force = false) {
  const now = Date.now();
  if (!force && now - (S.meta.lastBackupAt || 0) < 3600e3) return;
  if (!Object.keys(S.entries).length && !force) return;
  S.meta.lastBackupAt = now;
  try { writeState(); } catch { /* zapis główny zgłosi błąd */ }
  const key = dayKey(now);
  await IDB.set('backups', key, { t: now, count: Object.keys(S.entries).length, json: JSON.stringify(S) });
  const keys = (await IDB.keys('backups')).sort();
  while (keys.length > 7) await IDB.del('backups', keys.shift());
}

async function listBackups() {
  const keys = (await IDB.keys('backups')).sort().reverse();
  const out = [];
  for (const k of keys) {
    const b = await IDB.get('backups', k);
    if (b) out.push({ key: k, t: b.t, count: b.count });
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
