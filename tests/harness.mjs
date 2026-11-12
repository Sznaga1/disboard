/* Środowisko testowe: ładuje prawdziwe skrypty aplikacji (te same pliki, które
   wczytuje index.html) do osobnego kontekstu vm z minimalną „przeglądarką”:
   localStorage w pamięci, bez IndexedDB (aplikacja przechodzi wtedy na
   localStorage), bez sieci. Każde wywołanie loadApp() daje świeżą aplikację. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = ['js/util.js', 'js/db.js', 'js/library.js', 'js/io.js', 'js/cloud.js'];

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

const noop = () => {};
const fakeEl = () => ({ append: noop, remove: noop, click: noop, addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop }, style: {}, dataset: {} });

export async function loadApp({ storage = {} } = {}) {
  const downloads = [];
  const toasts = [];
  const sandbox = {
    console: { ...console, warn: noop, info: noop }, // brak IndexedDB w testach jest zamierzony
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    URL, Blob, TextEncoder, TextDecoder, EventTarget, CustomEvent, Intl, structuredClone,
    localStorage: memoryStorage(storage),
    navigator: {},
    window: { addEventListener: noop, removeEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }) },
    document: { addEventListener: noop, visibilityState: 'visible', getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: fakeEl, body: fakeEl() },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  // zamiast pobierania pliku i dymków: zapamiętujemy, co aplikacja chciała zrobić
  sandbox.downloadFile = (name, content, type) => { downloads.push({ name, content, type }); };
  sandbox.toast = (msg, opts) => { toasts.push({ msg, opts }); };
  const run = (code) => vm.runInContext(code, ctx);
  await run('stateReady');
  return {
    run,
    get S() { return run('S'); },
    Lib: run('Lib'),
    IO: run('IO'),
    fn: (name) => run(name),
    localStorage: sandbox.localStorage,
    downloads,
    toasts,
  };
}

// minimalna migawka anime w kształcie danych z AniList
export function media(id, { episodes = 12, duration = 24, title = `Anime ${id}`, status = 'FINISHED' } = {}) {
  return { id, idMal: id + 1000, title: { romaji: title, english: title }, episodes, duration, status, format: 'TV', coverImage: {}, genres: [] };
}
