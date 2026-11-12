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
