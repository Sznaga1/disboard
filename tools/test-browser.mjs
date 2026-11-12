/* Test w prawdziwej przeglądarce (Chrome albo Edge bez okna, na czystym profilu
   tymczasowym). Sprawdza zapis listy w IndexedDB: przeniesienie z localStorage,
   zapis przy zamykaniu karty, zmiany ze starszej wersji w innej karcie, dwie
   karty naraz, listę ponad dawny limit, kopię sprzed przeniesienia, sprzątanie
   cache i tryb awaryjny bez IndexedDB. Na koniec przechodzi po wszystkich
   ekranach i sprawdza, że żaden nie rzuca błędem.

   Uruchomienie:  node tools/test-browser.mjs
   Inna przeglądarka:  CHROME="ścieżka/do/chrome" node tools/test-browser.mjs
   Sieć do AniList/Jikan jest w teście zablokowana: niczego nie pobiera. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  OK  ', name); } else { fail++; console.log('  FAIL', name, extra); }
};

/* ---------- przeglądarka ---------- */
function findBrowser() {
  const c = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = c.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Nie znalazłem Chrome ani Edge. Podaj ścieżkę w zmiennej CHROME.');
  return found;
}

async function startBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'disboard-test-'));
  const proc = spawn(findBrowser(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  const stop = async () => {
    proc.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows bywa wolny ze zwalnianiem plików */ }
  };
  return { port, stop };
}

function startServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}

/* ---------- DevTools Protocol: jedna karta ---------- */
async function newPage(port, { noIndexedDB = false, inject = null } = {}) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pend = new Map(), logs = [], loadWaiters = [];
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'info'].includes(d.params.type)) logs.push(d.params.type + ' ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
    if (d.method === 'Page.loadEventFired') loadWaiters.splice(0).forEach((f) => f());
  });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*anilist.co*', '*jikan.moe*', '*trace.moe*', '*mymemory*', '*googleapis*', '*gstatic*', '*myanimelist*', '*youtube*', '*ani.zip*'] });
  if (noIndexedDB) await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'indexedDB', { get() { throw new Error('brak IndexedDB (test)'); } });` });
  if (inject) await send('Page.addScriptToEvaluateOnNewDocument', { source: inject });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result.result.value;
  };
  const loaded = () => new Promise((r) => loadWaiters.push(r));
  const go = async (url) => { const p = loaded(); await send('Page.navigate', { url }); await p; };
  const reload = async () => { const p = loaded(); await send('Page.reload'); await p; };
  const ready = () => ev('(async () => { await stateReady; return true; })()');
  return { send, ev, go, reload, ready, logs, closePage: () => send('Page.close'), close: () => ws.close() };
}

/* ---------- dane testowe: lista jak ze starej wersji (localStorage) ---------- */
const SEED = `(() => {
  const now = Date.now(); const st = { v: 1, entries: {}, history: [], notifs: [], settings: { titleLang: 'romaji' }, meta: { createdAt: now - 1e9 } };
  for (let i = 1; i <= 600; i++) {
    const id = 100000 + i;
    st.entries[id] = { id, idMal: i, status: i % 5 ? 'completed' : 'watching', score: 8, notes: '', favorite: false, tags: [], addedAt: now - 1e8, updatedAt: now - 1e8, mediaFetchedAt: now,
      sessions: [{ n: 0, startedAt: now - 9e7, finishedAt: now - 8e7, progress: 24, done: true }],
      media: { id, idMal: i, title: { romaji: 'Testowe anime numer ' + i + ' z dosyć długim tytułem', english: 'Test anime ' + i, native: 'テストアニメ' + i }, synonyms: ['TA' + i], coverImage: { large: 'https://s4.anilist.co/x/' + id + '.jpg', color: '#e4a15d' }, bannerImage: null, format: 'TV', status: 'FINISHED', episodes: 24, duration: 24, season: 'WINTER', seasonYear: 2020, genres: ['Action', 'Drama'], averageScore: 80, popularity: 1000, isAdult: false, siteUrl: 'https://anilist.co/anime/' + id, updatedAt: 1 } };
    for (let ep = 1; ep <= 24; ep++) st.history.push({ id: 'h' + i + '_' + ep, t: now - 8e7 + ep, k: 'ep', m: id, s: 0, ep, bulk: true, ti: 'Testowe anime numer ' + i });
  }
  localStorage.setItem('disboard.library.v1', JSON.stringify(st));
  return true;
})()`;
const LEGACY = `localStorage.getItem('disboard.library.v1')`;
const note = (id) => `(S.entries[${id}] && S.entries[${id}].notes)`;
const setNote = (id, v, wait = 0) => `(S.entries[${id}].notes = ${JSON.stringify(v)}, S.entries[${id}].updatedAt = Date.now(), save(), new Promise((r) => setTimeout(r, ${wait})))`;

async function main() {
  const server = await startServer();
  const browser = await startBrowser();
  const BASE = server.base;
  const P = (o) => newPage(browser.port, o);
  try {
    const A = await P();

    console.log('Przeniesienie listy z localStorage do IndexedDB');
    await A.go(BASE + '/manifest.webmanifest');
    await A.ev(SEED);
    const seed = await A.ev(LEGACY);
    await A.go(BASE + '/'); await A.ready();
    check('zapis: IndexedDB', (await A.ev('storageInfo()')) === 'IndexedDB');
    check('600 pozycji i 14400 zdarzeń', (await A.ev('Object.keys(S.entries).length + "/" + S.history.length')) === '600/14400');
    check('localStorage nietknięty', (await A.ev(LEGACY)) === seed);
    check('kopia „przed-migracja” = oryginał', await A.ev(`IDB.get('backups', 'przed-migracja').then((b) => !!b && b.json === ${LEGACY})`));

    console.log('Zapis');
    await A.ev(setNote(100001, 'zmiana-1', 600));
    await A.reload(); await A.ready();
    check('zmiana przetrwała przeładowanie', (await A.ev(note(100001))) === 'zmiana-1');
    await A.ev(setNote(100005, 'szybko', 100));
    await A.reload(); await A.ready();
    check('przeładowanie 100 ms po zmianie', (await A.ev(note(100005))) === 'szybko');
    const C = await P();
    await C.go(BASE + '/'); await C.ready();
    await C.ev(setNote(100006, 'zamknieta', 100));
    await C.closePage();
    await sleep(700);
    check('zamknięcie karty 100 ms po zmianie', (await A.ev(`SDB.get('main').then((r) => JSON.parse(r.json).entries[100006].notes)`)) === 'zamknieta');
    check('localStorage nadal nietknięty', (await A.ev(LEGACY)) === seed);

    console.log('Starsza wersja aplikacji w innej karcie');
    await A.ev(`(() => { const s = JSON.parse(${LEGACY}); s.entries[100002].notes = 'stara-karta'; s.entries[100002].updatedAt = Date.now(); localStorage.setItem('disboard.library.v1', JSON.stringify(s)); return true; })()`);
    await A.reload(); await A.ready();
    const lg = await A.ev(`${note(100002)} + "|" + ${note(100001)}`);
    check('jej zmiana dołączona, własna zachowana', lg === 'stara-karta|zmiana-1', lg);

    console.log('Dwie karty');
    const B = await P();
    await B.go(BASE + '/'); await B.ready();
    await A.ev(`(S.entries[100003].score = 3, S.entries[100003].updatedAt = Date.now(), saveNow())`);
    let seen = false;
    for (let i = 0; i < 30 && !seen; i++) { seen = (await B.ev('S.entries[100003].score')) === 3; if (!seen) await sleep(100); }
    check('karta B widzi zmianę z A', seen);
    await Promise.all([
      A.ev(`(S.entries[100010].notes = 'z-A', S.entries[100010].updatedAt = Date.now(), saveNow())`),
      B.ev(`(S.entries[100011].notes = 'z-B', S.entries[100011].updatedAt = Date.now(), saveNow())`),
    ]);
    await sleep(800);
    await A.reload(); await A.ready();
    const both = await A.ev(`${note(100010)} + "|" + ${note(100011)}`);
    check('równoczesne zmiany z obu kart zachowane', both === 'z-A|z-B', both);
    B.close();

    console.log('Ekrany');
    const routes = ['#/', '#/lista', '#/lista/watching', '#/szukaj', '#/anime/100001', '#/premiery', '#/ngnl', '#/skaner', '#/statystyki', '#/statystyki/nerd', '#/statystyki/rok', '#/historia', '#/historia/100001', '#/ustawienia'];
    for (const r of routes) {
      const before = A.logs.length;
      await A.ev(`(location.hash = ${JSON.stringify(r)}, new Promise((res) => setTimeout(res, 700)))`);
      const errs = A.logs.slice(before).filter((l) => l.startsWith('EXC'));
      const filled = (await A.ev(`(document.getElementById('view') || document.body).innerText.trim().length`)) > 20;
      check(`ekran ${r}`, filled && !errs.length, errs.slice(0, 2).join(' | '));
    }
    check('w Ustawieniach widać „zapis: IndexedDB”', (await A.ev(`(location.hash = '#/ustawienia', new Promise((r) => setTimeout(() => r(document.body.innerText.includes('zapis: IndexedDB')), 700)))`)));

    console.log('Lista ponad dawny limit localStorage');
    await A.ev(`(() => { const now = Date.now(); for (let i = 1; i <= 2000; i++) { const id = 200000 + i; const e = JSON.parse(JSON.stringify(S.entries[100001])); e.id = id; e.media.id = id; e.notes = ''; S.entries[id] = e; for (let ep = 1; ep <= 24; ep++) S.history.push({ id: 'g' + i + '_' + ep, t: now, k: 'ep', m: id, s: 0, ep, bulk: true, ti: 'Duże ' + i }); } return saveNow(); })()`);
    await A.reload(); await A.ready();
    const size = await A.ev(`SDB.get('main').then((r) => r.json.length)`);
    check(`2600 pozycji, ${(size / 1e6).toFixed(1)} mln znaków (limit localStorage ~5)`, (await A.ev('Object.keys(S.entries).length')) === 2600 && size > 5e6);

    console.log('Szybkie „+1” na liście (2600 pozycji)');
    // „Oglądam” w danych testowych ma wszystkie odcinki; kilku pozycjom cofamy postęp, żeby miały „+1”
    await A.ev(`(() => { for (let i = 5; i <= 200; i += 5) { const s = S.entries[100000 + i].sessions[0]; s.progress = 10; s.finishedAt = null; s.done = false; } S.settings.listSorts = {}; S.settings.listView = 'grid'; save(); location.hash = '#/lista'; return new Promise((r) => setTimeout(r, 1500)); })()`);
    const inc = await A.ev(`(async () => {
      const cards = [...document.querySelectorAll('#l-out .ecard')];
      const other = cards[3];
      other.dataset.probe = 'stary-wezel';
      const btns = [...document.querySelectorAll('#l-out .ecard [data-inc]')];
      const b = btns[Math.floor(btns.length / 2)];
      const id = Number(b.dataset.inc);
      const before = Lib.cur(S.entries[id]).progress;
      const t = performance.now();
      b.click();
      await Promise.resolve(); await Promise.resolve();
      document.body.offsetHeight;
      const ms = performance.now() - t;
      const first = document.querySelector('#l-out .ecard');
      return { ms: Math.round(ms), kept: !!document.querySelector('[data-probe="stary-wezel"]'), top: Number(first.dataset.id) === id, prog: Lib.cur(S.entries[id]).progress - before,
        same: [...document.querySelectorAll('#l-out .ecard')].length === cards.length, num: first.querySelector('.ecard-prog-row .num').textContent };
    })()`);
    check(`„+1” bez przebudowy całej listy (${inc.ms} ms)`, inc.kept && inc.prog === 1 && inc.ms < 80, JSON.stringify(inc));
    check('kliknięta karta na górze (sortowanie „ostatnio zmieniane”), liczba kart bez zmian', inc.top && inc.same, JSON.stringify(inc));
    const full = await A.ev(`(async () => { const t = performance.now(); document.getElementById('l-grid').click(); await Promise.resolve(); document.body.offsetHeight; return Math.round(performance.now() - t); })()`);
    check(`zmiana widoku nadal rysuje całą listę (${full} ms)`, !(await A.ev(`!!document.querySelector('[data-probe]')`)));

    console.log('Twój rok w anime');
    await A.ev(`(location.hash = '#/statystyki/rok', new Promise((r) => setTimeout(r, 2500)))`);
    const yr = await A.ev(`(async () => { const img = document.querySelector('#y-card img'); const b = img ? await (await fetch(img.src)).blob() : null; return { hero: (document.querySelector('.yr-hero') || {}).innerText || '', img: !!img, type: b && b.type, size: b ? b.size : 0, save: !(document.getElementById('y-save') || {}).disabled }; })()`);
    check('podsumowanie roku z godzinami', /Twój rok \d{4} w anime/i.test(yr.hero) && /godzin/.test(yr.hero), JSON.stringify(yr.hero.slice(0, 120)));
    check(`karta PNG gotowa do zapisania (${Math.round(yr.size / 1024)} kB)`, yr.img && yr.type === 'image/png' && yr.size > 20000 && yr.save, JSON.stringify(yr));

    console.log('Kopia sprzed przeniesienia');
    await A.ev(`restoreBackup('przed-migracja').then(() => new Promise((r) => setTimeout(r, 500)))`);
    await A.reload(); await A.ready();
    check('przywrócenie daje z powrotem 600 pozycji', (await A.ev('Object.keys(S.entries).length')) === 600);

    console.log('Sprzątanie cache API');
    await A.ev(`(async () => { const old = Date.now() - 40 * 86400e3; await IDB.set('cache', 'gql:stare', { t: old, data: 1 }); await IDB.set('cache', 'gql:nowe', { t: Date.now(), data: 1 }); await IDB.set('cache', 'epflags:v1', { t: old, data: {} }); await IDB.set('cache', 'tr:ja-en:x', { t: old, data: 1 }); return pruneApiCache({ force: true }); })()`);
    const keys = await A.ev(`IDB.keys('cache')`);
    check('stare usunięte; nowe, fillery i tłumaczenia zostały', !keys.includes('gql:stare') && ['gql:nowe', 'epflags:v1', 'tr:ja-en:x'].every((k) => keys.includes(k)), JSON.stringify(keys));

    console.log('Kopia do folderu na dysku');
    // okna wyboru folderu nie da się kliknąć bez ekranu, więc podajemy folder z prywatnej
    // pamięci przeglądarki (OPFS): ma te same funkcje zapisu co folder na dysku
    check('przeglądarka obsługuje wybór folderu', await A.ev(`typeof showDirectoryPicker === 'function'`));
    const files = (dir) => `(async () => { const o = await navigator.storage.getDirectory(); let d = o; for (const p of ${JSON.stringify(dir)}) d = await d.getDirectoryHandle(p); const out = []; for await (const [n] of d.entries()) out.push(n); return out.sort(); })()`;
    const refused = await A.ev(`(async () => { const o = await navigator.storage.getDirectory(); const repo = await o.getDirectoryHandle('repo', { create: true }); for (const f of ['index.html', 'sw.js']) await (await repo.getFileHandle(f, { create: true })).createWritable().then((w) => w.close()); try { await FolderBackup.connect(repo); return 'przyjęty'; } catch (e) { return e.message; } })()`);
    check('folder z kodem aplikacji odrzucony', /kodem aplikacji/.test(refused), refused);
    check('…i nic w nim nie powstało', !(await A.ev(files(['repo']))).includes('Disboard - kopie listy'));
    const first = await A.ev(`(async () => { const o = await navigator.storage.getDirectory(); const root = await o.getDirectoryHandle('disboard', { create: true }); await (await root.getFileHandle('inny-plik.txt', { create: true })).createWritable().then((w) => w.close()); return FolderBackup.connect(root); })()`);
    const today = await A.ev(`'disboard-' + dayKey(Date.now()) + '.json'`);
    check('pierwsza kopia zapisana od razu', first && first.file === today, JSON.stringify(first));
    check('w folderze: kopia i CO-TO-JEST.txt', JSON.stringify(await A.ev(files(['disboard', 'Disboard - kopie listy'])) ) === JSON.stringify(['CO-TO-JEST.txt', today]));
    check('inne pliki w wybranym folderze nietknięte', (await A.ev(files(['disboard']))).includes('inny-plik.txt'));
    const readBackup = `(async () => { const o = await navigator.storage.getDirectory(); const d = await (await o.getDirectoryHandle('disboard')).getDirectoryHandle('Disboard - kopie listy'); return JSON.parse(await (await (await d.getFileHandle('disboard-' + dayKey(Date.now()) + '.json')).getFile()).text()); })()`;
    const b1 = await A.ev(`${readBackup}.then((j) => ({ app: j.app, n: Object.keys(j.state.entries).length }))`);
    check('plik to pełna kopia Disboard (600 pozycji)', b1.app === 'disboard' && b1.n === 600, JSON.stringify(b1));
    check('bez zmian w liście: brak ponownego zapisu', (await A.ev(`FolderBackup.backupNow({ auto: true })`)).unchanged === true);
    await A.ev(`(S.entries[100001].notes = 'do-folderu', S.entries[100001].updatedAt = Date.now(), FolderBackup.backupNow({ auto: true }))`);
    check('po zmianie kopia zaktualizowana', (await A.ev(`${readBackup}.then((j) => j.state.entries[100001].notes)`)) === 'do-folderu');
    await A.ev(`(async () => { const o = await navigator.storage.getDirectory(); const d = await (await o.getDirectoryHandle('disboard')).getDirectoryHandle('Disboard - kopie listy'); for (let i = 1; i <= 35; i++) { const n = 'disboard-2020-01-' + String(i).padStart(2, '0') + '.json'; await (await d.getFileHandle(n, { create: true })).createWritable().then((w) => w.close()); } await (await d.getFileHandle('moje-notatki.txt', { create: true })).createWritable().then((w) => w.close()); return FolderBackup.backupNow({ force: true }); })()`);
    const after = await A.ev(files(['disboard', 'Disboard - kopie listy']));
    check('zostaje 30 ostatnich kopii, najnowsza też', after.filter((n) => /^disboard-\d{4}-\d\d-\d\d\.json$/.test(n)).length === 30 && after.includes(today), JSON.stringify(after.slice(0, 3)));
    check('obce pliki w folderze kopii nietknięte', after.includes('moje-notatki.txt') && after.includes('CO-TO-JEST.txt'));
    await A.reload(); await A.ready();
    const st = await A.ev(`FolderBackup.status()`);
    check('ustawienie przetrwało przeładowanie', st.on && st.rootName === 'disboard' && st.lastFile === today, JSON.stringify(st));
    await A.ev(`(location.hash = '#/ustawienia', new Promise((r) => setTimeout(r, 900)))`);
    check('panel w Ustawieniach pokazuje folder', (await A.ev(`(document.getElementById('fb-host') || {}).innerText || ''`)).includes('disboard\\Disboard - kopie listy'));
    await A.ev(`FolderBackup.disconnect()`);

    const errs = A.logs.filter((l) => l.startsWith('EXC') || l.startsWith('error'));
    check('brak błędów w konsoli', !errs.length, errs.slice(0, 3).join(' | '));
    check('dziennik błędów pusty po całym teście', (await A.ev('ErrLog.list().length')) === 0, JSON.stringify(await A.ev('ErrLog.list().slice(0, 3)')));

    console.log('Dziennik błędów');
    await A.ev(`(location.hash = '#/lista', setTimeout(() => { throw new TypeError('testowy błąd'); }), Promise.reject(new Error('testowa obietnica')), new Promise((r) => setTimeout(r, 600)))`);
    const el = await A.ev(`ErrLog.list().map((e) => e.kind + ':' + e.msg).join(' | ')`);
    check('złapany błąd i nieobsłużona obietnica', el.includes('error:TypeError: testowy błąd') && el.includes('promise:testowa obietnica'), el);
    check('dymek „Coś poszło nie tak” (jeden na serię)', (await A.ev(`[...document.querySelectorAll('.toast')].filter((t) => t.innerText.includes('Coś poszło nie tak')).length`)) === 1);
    await A.ev(`(toast('Nie udało się czegoś zrobić', { kind: 'error' }), true)`);
    check('dymek błędu zapisany jako komunikat', (await A.ev(`ErrLog.list()[0].kind + ':' + ErrLog.list()[0].msg`)) === 'message:Nie udało się czegoś zrobić');
    await A.ev(`([...document.querySelectorAll('.toast button')].find((b) => b.textContent === 'Pokaż').click(), new Promise((r) => setTimeout(r, 1200)))`);
    check('„Pokaż” prowadzi do dziennika w Ustawieniach', (await A.ev(`location.hash`)) === '#/ustawienia?bledy' && (await A.ev(`document.querySelectorAll('#el-host li').length`)) === 3);
    await A.ev(`(document.getElementById('el-copy').click(), new Promise((r) => setTimeout(r, 500)))`);
    const rep = await A.ev(`document.getElementById('el-raw').value`);
    check('raport: przeglądarka, zapis, błędy ze stosem', rep.includes('Disboard — raport błędów') && rep.includes('Zapis: IndexedDB') && rep.includes('TypeError: testowy błąd') && rep.includes('testowa obietnica') && rep.includes('Przeglądarka: '), rep.slice(0, 300));
    check('raport bez adresu e-mail i notatek z listy', !/@/.test(rep.replace(/at .*/g, '')) && !rep.includes('do-folderu'));
    await A.ev(`(document.getElementById('el-clear').click(), new Promise((r) => setTimeout(r, 300)))`);
    check('wyczyść dziennik', (await A.ev('ErrLog.list().length')) === 0 && (await A.ev(`document.getElementById('el-host').innerText`)).includes('żadnych błędów'));
    A.close();

    console.log('Telefon (390 px, dotyk)');
    const M = await P();
    await M.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await M.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await M.go(BASE + '/#/lista'); await M.ready(); await sleep(1200);
    await M.ev(`(document.getElementById('net-banner').hidden = true, true)`); // baner „brak AniList” to skutek zablokowanej sieci w teście
    const mob = await M.ev(`(() => {
      const vis = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
      const card = document.querySelector('#l-out [data-id]');
      const inc = document.querySelector('#l-out .btn-inc');
      return { waitBtn: vis('wait-btn'), waitPanel: vis('wait'), more: vis('l-more'), tag: vis('l-tag'), cardTop: Math.round(card.getBoundingClientRect().top), inc: inc ? Math.round(inc.getBoundingClientRect().height) : null, docW: document.documentElement.scrollWidth };
    })()`);
    check('licznik NGNL w górnym pasku, nie na treści', mob.waitBtn && !mob.waitPanel, JSON.stringify(mob));
    check(`lista: pierwsza karta ${mob.cardTop} px od góry (filtry schowane)`, mob.more && !mob.tag && mob.cardTop < 260, JSON.stringify(mob));
    check('bez przewijania w bok', mob.docW === 390, String(mob.docW));
    const opened = await M.ev(`(async () => { document.getElementById('wait-btn').click(); await new Promise((r) => setTimeout(r, 200)); const a = getComputedStyle(document.getElementById('wait')).display; document.querySelector('.page-title').click(); await new Promise((r) => setTimeout(r, 200)); const b = getComputedStyle(document.getElementById('wait')).display; document.getElementById('l-more').click(); await new Promise((r) => setTimeout(r, 200)); return [a, b, getComputedStyle(document.getElementById('l-tag')).display !== 'none' && document.getElementById('l-tag').getBoundingClientRect().width > 0].join(','); })()`);
    check('licznik otwiera się i zamyka stuknięciem obok; „Filtry” pokazują gatunek i sortowanie', opened === 'flex,none,true', opened);
    check('brak błędów (telefon)', !M.logs.some((l) => l.startsWith('EXC')), M.logs.filter((l) => l.startsWith('EXC')).join(' | '));
    M.close();

    console.log('Brave (zapis do folderu domyślnie wyłączony)');
    // Brave ma navigator.brave i, dopóki nie włączysz opcji w brave://flags, nie ma showDirectoryPicker
    const Br = await P({ inject: `delete window.showDirectoryPicker; Object.defineProperty(navigator, 'brave', { value: { isBrave: () => Promise.resolve(true) } });` });
    await Br.go(BASE + '/#/ustawienia'); await Br.ready(); await sleep(900);
    const brText = await Br.ev(`(document.getElementById('fb-host') || {}).innerText || ''`);
    check('panel prowadzi do brave://flags', brText.includes('brave://flags/#file-system-access-api') && brText.includes('Enabled') && brText.includes('Relaunch'), JSON.stringify(brText.slice(0, 120)));
    check('jest przycisk kopiowania adresu', await Br.ev(`!!document.getElementById('fb-flag')`));
    check('brak błędów (Brave)', !Br.logs.some((l) => l.startsWith('EXC')), Br.logs.filter((l) => l.startsWith('EXC')).join(' | '));
    Br.close();

    console.log('Tryb awaryjny bez IndexedDB');
    const F = await P({ noIndexedDB: true });
    await F.go(BASE + '/'); await F.ready();
    check('zapis: localStorage, lista wczytana', (await F.ev('storageInfo() + "/" + Object.keys(S.entries).length')) === 'localStorage/600');
    await F.ev(setNote(100009, 'ls-mode', 300));
    check('zapis trafia do localStorage', (await F.ev(`JSON.parse(${LEGACY}).entries[100009].notes`)) === 'ls-mode');
    F.close();
  } finally {
    await browser.stop();
    server.close();
  }
  console.log(`\n${ok} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
