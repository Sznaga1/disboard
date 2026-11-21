'use strict';
/* ==========================================================================
   Disboard — automatyczna kopia listy do folderu na dysku (Chrome i Edge).
   Wskazujesz raz folder (np. D:\App\disboard), a aplikacja tworzy w nim
   „Disboard - kopie listy” i zapisuje tam plik JSON z całą listą: po zmianach
   (najpóźniej po 2 minutach), przy chowaniu karty i co godzinę. Jeden plik na
   dzień, trzyma 30 ostatnich. Plik to zwykły eksport JSON: przywracasz go
   w Ustawieniach → Import → Kopia Disboard (JSON).
   Uchwyt folderu i stan kopii leżą w bazie listy (SDB, klucz „folderBackup”),
   nie w S: uchwytu nie da się zapisać jako JSON i nie powinien jeździć między kartami.
   ========================================================================== */

const FolderBackup = (() => {
  const DIR_NAME = 'Disboard - kopie listy';
  const KEEP = 30;
  // zwykła kopia dnia albo „-mniejsza” (lista wyraźnie się skurczyła, zob. backupShrunk w db.js)
  const FILE_RE = new RegExp(`^disboard-(\\d{4}-\\d{2}-\\d{2})(${SHRUNK_SUFFIX})?\\.json$`);
  const AFTER_CHANGE = 2 * 60e3;
  const INFO = [
    'Ten folder tworzy aplikacja Disboard (tracker anime).',
    '',
    'Są tu automatyczne kopie Twojej listy anime: jeden plik na dzień',
    '(disboard-RRRR-MM-DD.json), 30 ostatnich dni. Starsze aplikacja usuwa sama.',
    'Inne pliki w tym folderze nie są ruszane.',
    '',
    'Plik z dopiskiem „-mniejsza” powstaje, gdy w ciągu dnia z listy nagle',
    'zniknęło sporo tytułów: wtedy dzisiejszy zwykły plik zostaje nietknięty',
    '(z wcześniejszą, większą listą), a nowsza wersja zapisuje się obok.',
    '',
    'Jak przywrócić listę:',
    '  Disboard → Ustawienia i kopie → Import → Kopia Disboard (JSON)',
    '  i wybierz najnowszy plik z tego folderu.',
    '',
    'Nie usuwaj tego folderu, jeśli chcesz mieć kopię listy poza przeglądarką.',
    '',
  ].join('\r\n');

  let rec = null;       // { root, dir, rootName, lastAt, lastFile, lastSig, lastError }
  let loaded = null;
  let timer = null;
  let running = null;
  let askedThisSession = false;

  const supported = () => typeof window.showDirectoryPicker === 'function';
  const fileName = (t = Date.now(), shrunk = false) => `disboard-${dayKey(t)}${shrunk ? SHRUNK_SUFFIX : ''}.json`;

  function load() {
    if (!loaded) loaded = SDB.get('folderBackup').then((r) => { rec = r || null; return rec; }).catch(() => null);
    return loaded;
  }
  const persist = () => SDB.put('folderBackup', rec).catch((e) => console.warn('Nie zapisano ustawień kopii do folderu', e));

  async function permission(request = false) {
    if (!rec) return 'none';
    const opts = { mode: 'readwrite' };
    try {
      let p = rec.root.queryPermission ? await rec.root.queryPermission(opts) : 'granted';
      if (p !== 'granted' && request && rec.root.requestPermission) p = await rec.root.requestPermission(opts);
      return p;
    } catch { return 'denied'; }
  }

  async function exists(dir, name, kind) {
    try { await (kind === 'dir' ? dir.getDirectoryHandle(name) : dir.getFileHandle(name)); return true; } catch { return false; }
  }
  // folder z kodem aplikacji (repo): kopie trafiłyby do Gita i na GitHuba
  async function isAppFolder(dir) {
    if (await exists(dir, '.git', 'dir')) return true;
    return (await exists(dir, 'index.html')) && (await exists(dir, 'sw.js'));
  }

  async function writeText(dir, name, text) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); // zapis do pliku tymczasowego, podmiana dopiero przy close()
    try { await w.write(text); await w.close(); } catch (e) { try { await w.abort(); } catch { /* już zamknięty */ } throw e; }
  }

  // trzymamy KEEP ostatnich dni (dzień może mieć dwa pliki: zwykły i „-mniejsza”)
  async function rotate(dir) {
    const files = [];
    for await (const [name, h] of dir.entries()) {
      const m = h.kind === 'file' && FILE_RE.exec(name);
      if (m) files.push([name, m[1]]);
    }
    const days = [...new Set(files.map(([, day]) => day))].sort();
    const dropDays = new Set(days.slice(0, Math.max(0, days.length - KEEP)));
    let removed = 0;
    for (const [name, day] of files) if (dropDays.has(day)) { await dir.removeEntry(name); removed++; }
    return { kept: files.length - removed, removed };
  }

  /* Podłączenie folderu (wybranego w oknie albo — w testach — dowolnego uchwytu).
     Wskazany folder = miejsce, w którym tworzymy „Disboard - kopie listy”.
     Jeśli wskażesz od razu ten folder z kopiami, używamy go bez zagnieżdżania. */
  async function connect(root) {
    if (await isAppFolder(root)) {
      throw new Error('To folder z kodem aplikacji (jest w nim index.html albo .git). Kopie trafiłyby do repozytorium na GitHubie. Wybierz folder piętro wyżej, np. D:\\App\\disboard.');
    }
    const dir = root.name === DIR_NAME ? root : await root.getDirectoryHandle(DIR_NAME, { create: true });
    await writeText(dir, 'CO-TO-JEST.txt', INFO);
    rec = { root, dir, rootName: root.name, lastAt: 0, lastFile: null, lastSig: null, lastError: null };
    await persist();
    return backupNow({ force: true });
  }

  async function choose() {
    if (!supported()) throw new Error('Ta przeglądarka nie obsługuje zapisu do folderu. Działa w Chrome i Edge na komputerze.');
    let root;
    try {
      // id: przeglądarka zapamięta ostatnie miejsce i następnym razem otworzy okno właśnie tam
      root = await window.showDirectoryPicker({ id: 'disboard-kopie', mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
      if (e && e.name === 'AbortError') return null; // zamknięte okno wyboru
      throw e;
    }
    return connect(root);
  }

  async function disconnect() {
    rec = null;
    clearTimeout(timer);
    await SDB.put('folderBackup', null).catch(() => {});
    emit('folder-backup');
  }

  /* Kopia teraz. auto: bez pytania o zgodę i bez zapisu, gdy lista się nie
     zmieniła od ostatniej kopii (plik z dzisiejszą datą już ją zawiera). */
  function backupNow({ auto = false, force = false } = {}) {
    if (running) return running;
    running = (async () => {
      await load();
      if (!rec) return { off: true };
      const p = await permission(!auto);
      if (p !== 'granted') return { needsPermission: true };
      const sig = hashStr(JSON.stringify(S));
      const count = Object.keys(S.entries).length;
      const today = fileName();
      // dzisiejszy plik ma wyraźnie więcej tytułów niż lista teraz: nie nadpisujemy go, nowa kopia idzie obok
      const shrunk = rec.lastFile === today && backupShrunk(rec.lastCount, count);
      const name = shrunk ? fileName(Date.now(), true) : today;
      const prevSig = shrunk ? rec.sideSig : rec.lastSig;
      const prevFile = shrunk ? rec.sideFile : rec.lastFile;
      if (!force && sig === prevSig && (auto || prevFile === name)) return { unchanged: true, file: prevFile };
      try {
        await writeText(rec.dir, name, IO.backupJSON());
        const r = await rotate(rec.dir);
        if (shrunk) {
          Object.assign(rec, { lastAt: Date.now(), sideFile: name, sideSig: sig, lastError: null });
          warnShrunk(rec.lastCount, count);
        } else {
          Object.assign(rec, { lastAt: Date.now(), lastFile: name, lastSig: sig, lastCount: count, sideFile: null, sideSig: null, lastError: null });
        }
        await persist();
        emit('folder-backup');
        return { file: name, shrunk, ...r };
      } catch (e) {
        rec.lastError = `${fmtDateTime(Date.now())}: ${e.message || e.name}`;
        await persist();
        emit('folder-backup');
        throw e;
      }
    })();
    return running.finally(() => { running = null; });
  }

  const auto = () => backupNow({ auto: true }).catch((e) => console.warn('Kopia do folderu nie powiodła się', e));
  function schedule() {
    if (!rec) return;
    clearTimeout(timer);
    timer = setTimeout(auto, AFTER_CHANGE);
  }

  // po ponownym uruchomieniu przeglądarki Chrome może poprosić o zgodę jeszcze raz;
  // prośba musi wyjść z kliknięcia, więc pokazujemy dymek z przyciskiem
  async function askIfNeeded() {
    if (!rec || askedThisSession || (await permission()) === 'granted') return;
    askedThisSession = true;
    toast(`Kopia listy do folderu „${rec.rootName}” czeka na Twoją zgodę.`, {
      kind: 'warn', ms: 15000,
      action: { label: 'Zezwól', fn: () => backupNow().then((r) => { if (r && r.file) toast('Zapisano kopię do folderu.', { kind: 'ok' }); }).catch((e) => toast(e.message, { kind: 'error' })) },
    });
  }

  let started = false;
  async function init() {
    await load();
    if (!rec || started) return; // wywoływane też po pierwszym wyborze folderu
    started = true;
    on('library', schedule);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); timer = null; auto(); } });
    setInterval(auto, 3600e3);
    setTimeout(() => { auto(); askIfNeeded(); }, 5000);
  }

  async function status() {
    await load();
    if (!rec) return { supported: supported(), on: false };
    return { supported: supported(), on: true, rootName: rec.rootName, dirName: rec.dir.name, lastAt: rec.lastAt, lastFile: rec.lastFile, sideFile: rec.sideFile && rec.lastFile === fileName() ? rec.sideFile : null, lastCount: rec.lastCount, lastError: rec.lastError, permission: await permission(), keep: KEEP };
  }

  return { supported, init, choose, connect, disconnect, backupNow, status, lastAt: () => (rec ? rec.lastAt : 0), DIR_NAME };
})();
