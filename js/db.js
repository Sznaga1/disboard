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
