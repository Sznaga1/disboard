/* Buduje extension/core.js: logikę listy rozszerzenia z TYCH SAMYCH plików,
   których używa strona (util.js, db.js, library.js, cloud.js). Dzięki temu
   „+1” w rozszerzeniu robi dokładnie to samo co „+1” na stronie: historia,
   daty, kończenie serii, pomijanie fillerów i postać listy wysyłanej do chmury.

   Pliki strony działają w zamkniętym zakresie funkcji z atrapami przeglądarki:
   bez IndexedDB, localStorage i kart, więc niczego nie zapisują same z siebie.

   Uruchomienie po każdej zmianie tych plików:  node tools/build-extension.mjs
   (test tests/extension.test.mjs pilnuje, żeby core.js był aktualny). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CORE_SOURCES = ['js/util.js', 'js/db.js', 'js/library.js', 'js/cloud.js'];
export const CORE_OUT = 'extension/core.js';

export function buildCore() {
  const parts = CORE_SOURCES.map((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
    return `/* ===== ${f} ===== */\n${src}`;
  });
  return `/* PLIK GENEROWANY — nie edytuj ręcznie.
   Źródło: ${CORE_SOURCES.join(', ')} (node tools/build-extension.mjs). */
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

${parts.join('\n\n')}

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
`;
}

// motywy strony (Ex Machina, Flügel…): okienko rozszerzenia bierze kolory z motywu wybranego w Disboard
export const THEMES_OUT = 'extension/themes.css';
export function buildThemes() {
  const src = fs.readFileSync(path.join(ROOT, 'css/themes.css'), 'utf8').replace(/\r\n/g, '\n');
  return `/* PLIK GENEROWANY z css/themes.css — nie edytuj ręcznie (node tools/build-extension.mjs). */\n${src}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.join(ROOT, 'extension'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, CORE_OUT), buildCore());
  fs.writeFileSync(path.join(ROOT, THEMES_OUT), buildThemes());
  console.log(`Zapisano ${CORE_OUT} i ${THEMES_OUT}`);
}
