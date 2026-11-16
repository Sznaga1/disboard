'use strict';
/* ==========================================================================
   Disboard — rozszerzenie: logowanie Google, lista w chmurze (Firestore REST),
   zmiany „+1 / −1”, dane o emisji z AniList i liczba na ikonce.

   Zasady bezpieczeństwa listy (takie same jak w js/cloud.js na stronie):
   • lista w chmurze: users/{uid}/data/state (opis: rev, parts) +
     users/{uid}/parts/{rev}_{i} (lista spakowana gzipem w kawałkach);
   • zapis tylko wtedy, gdy w chmurze dalej leży wersja, którą przeczytaliśmy
     (warunek na czas zmiany dokumentu z opisem: jeden atomowy zapis albo nic);
     inaczej czytamy od nowa i powtarzamy zmianę na świeżej wersji;
   • zmiana = Lib.increment ze strony (extension/core.js), nic więcej;
   • każda zmiana pamięta, od jakiego odcinka startowała: jeśli lista zmieniła
     się w międzyczasie (np. telefon dał już +1), zmiana nie dubluje odcinka.
   ========================================================================== */

const Sync = (() => {
  const CFG = {
    apiKey: 'AIzaSyBn37VYsh3ucxM3Hu2Y626gcS1p79AAnQU',
    projectId: 'disboard-63851',
    clientId: '511078577624-q605icc5ht7u9jjbinu0aabua8p1tog1.apps.googleusercontent.com',
  };
  const SITE = 'https://sznaga1.github.io/disboard/';
  const DOCS = `https://firestore.googleapis.com/v1/projects/${CFG.projectId}/databases/(default)/documents`;
  const PART = 900000;            // jak na stronie: dokument Firestore ma limit 1 MiB
  const SYNC_EVERY = 60e3;        // przy otwarciu okienka: najwyżej raz na minutę
  const AIRING_EVERY = 30 * 60e3; // dane o emisji z AniList
  const FLAGS_TTL = 7 * 864e5;    // fillery i recapy z MyAnimeList

  const C = DisboardCore;
  const store = chrome.storage.local;
  const get = async (k) => (await store.get(k))[k];
  const set = (obj) => store.set(obj);

  /* ---------- błędy z czytelnym opisem ---------- */
  class SyncError extends Error {
    constructor(msg, code) { super(msg); this.code = code; }
  }
  const offline = () => new SyncError('Brak internetu. Zapiszę, gdy połączenie wróci.', 'offline');
  async function call(url, opts = {}) {
    let res;
    try { res = await fetch(url, opts); } catch { throw offline(); }
    return res;
  }

  /* ---------- logowanie ---------- */
  async function signIn() {
    const nonce = crypto.randomUUID();
    const redirect = chrome.identity.getRedirectURL();
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: CFG.clientId, response_type: 'id_token', redirect_uri: redirect,
      scope: 'openid email profile', nonce, prompt: 'select_account',
    });
    let back;
    try { back = await chrome.identity.launchWebAuthFlow({ url, interactive: true }); } catch (e) {
      throw new SyncError('Logowanie przerwane. Jeśli Google pokazał błąd „redirect_uri_mismatch”, adres rozszerzenia nie jest jeszcze dopisany w Google Cloud (albo zmiana jeszcze nie weszła — odczekaj kilka minut).', 'auth');
    }
    const frag = new URLSearchParams(new URL(back).hash.slice(1));
    const idToken = frag.get('id_token');
    if (!idToken) throw new SyncError(`Google nie wydał przepustki (${frag.get('error') || 'brak tokenu'}).`, 'auth');
    const res = await call(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${CFG.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postBody: `id_token=${idToken}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true, returnIdpCredential: true }),
    });
    const d = await res.json();
    if (!res.ok) throw new SyncError(`Firebase nie przyjął logowania: ${(d.error && d.error.message) || res.status}`, 'auth');
    const auth = {
      uid: d.localId, email: d.email || '', name: d.displayName || d.fullName || '', photo: d.photoUrl || '',
      idToken: d.idToken, refreshToken: d.refreshToken, exp: Date.now() + Number(d.expiresIn || 3600) * 1000,
    };
    await set({ auth, cache: null, view: null, lastSync: 0, error: null });
    return auth;
  }

  async function signOut() {
    await store.remove(['auth', 'cache', 'view', 'pending', 'lastSync', 'error']);
  }

  async function token(force = false) {
    const auth = await get('auth');
    if (!auth) throw new SyncError('Zaloguj się, żeby zobaczyć listę.', 'signedout');
    if (!force && auth.exp - Date.now() > 60e3) return auth;
    const res = await call(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refreshToken }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 400) { await signOut(); throw new SyncError('Sesja wygasła. Zaloguj się ponownie.', 'signedout'); }
      throw new SyncError(`Nie udało się odświeżyć logowania (${res.status}).`, 'auth');
    }
    const next = { ...auth, idToken: d.id_token, refreshToken: d.refresh_token || auth.refreshToken, exp: Date.now() + Number(d.expires_in || 3600) * 1000 };
    await set({ auth: next });
    return next;
  }

  // zapytanie do Firestore z tokenem (raz ponawiane po odświeżeniu tokenu)
  async function fs(path, opts = {}, retried = false) {
    const auth = await token(retried);
    const res = await call(path.startsWith('http') ? path : `${DOCS}${path}`, {
      ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.idToken}`, ...(opts.headers || {}) },
    });
    if (res.status === 401 && !retried) return fs(path, opts, true);
    return res;
  }
  async function fsError(res) {
    const d = await res.json().catch(() => ({}));
    const st = (d.error && d.error.status) || '';
    if (st === 'PERMISSION_DENIED') return new SyncError('Baza odmówiła dostępu do listy (reguły Firestore).', 'denied');
    if (st === 'FAILED_PRECONDITION' || st === 'ABORTED' || res.status === 409) return new SyncError('conflict', 'conflict');
    return new SyncError(`Błąd bazy: ${(d.error && d.error.message) || res.status}`, 'fs');
  }

  /* ---------- wartości Firestore ---------- */
  function val(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('bytesValue' in v) return v.bytesValue;
    if ('nullValue' in v) return null;
    return null;
  }
  const fields = (doc) => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, val(v)]));
  const int = (n) => ({ integerValue: String(Math.round(n)) });
  const str = (s) => ({ stringValue: String(s) });

  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function gzip(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  /* ---------- lista w chmurze ---------- */
  const metaPath = (uid) => `/users/${uid}/data/state`;
  const partName = (uid, id) => `projects/${CFG.projectId}/databases/(default)/documents/users/${uid}/parts/${id}`;

  async function readMeta(uid) {
    const res = await fs(metaPath(uid));
    if (res.status === 404) return null;
    if (!res.ok) throw await fsError(res);
    const doc = await res.json();
    return { ...fields(doc), updateTime: doc.updateTime };
  }

  async function readList(uid, meta) {
    const names = Array.from({ length: meta.parts }, (_, i) => partName(uid, `${meta.rev}_${i}`));
    const res = await fs(`${DOCS}:batchGet`, { method: 'POST', body: JSON.stringify({ documents: names }) });
    if (!res.ok) throw await fsError(res);
    const rows = await res.json();
    const byName = new Map(rows.filter((r) => r.found).map((r) => [r.found.name, r.found]));
    const chunks = names.map((n) => {
      const doc = byName.get(n);
      if (!doc) throw new SyncError('conflict', 'conflict'); // ta wersja właśnie została zastąpiona
      return unb64(fields(doc).b);
    });
    const all = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return gunzip(all);
  }

  // jeden atomowy zapis: nowe części + opis, stare części usunięte; tylko gdy opis
  // w chmurze jest dalej ten, który przeczytaliśmy (updateTime)
  async function writeList(uid, meta, rev, json) {
    const bytes = await gzip(json);
    const parts = [];
    for (let i = 0; i < bytes.length || i === 0; i += PART) parts.push(bytes.subarray(i, i + PART));
    const writes = parts.map((p, i) => ({ update: { name: partName(uid, `${rev}_${i}`), fields: { b: { bytesValue: b64(p) } } } }));
    for (let i = 0; i < (meta.parts || 0); i++) writes.push({ delete: partName(uid, `${meta.rev}_${i}`) });
    writes.push({
      update: {
        name: `projects/${CFG.projectId}/databases/(default)/documents${metaPath(uid)}`,
        fields: { v: int(1), rev: str(rev), parts: int(parts.length), size: int(json.length), zipped: int(bytes.length), at: int(Date.now()), device: str('rozszerzenie') },
      },
      currentDocument: { updateTime: meta.updateTime },
    });
    const res = await fs(`${DOCS}:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
    if (!res.ok) throw await fsError(res);
  }

  /* ---------- pobranie listy (z pamięcią podręczną) ---------- */
  async function load(auth, meta) {
    const cache = await get('cache');
    if (cache && cache.uid === auth.uid && cache.rev === meta.rev) return cache.canon;
    const raw = await readList(auth.uid, meta);
    const canon = C.canon(C.normalizeState(JSON.parse(raw)));
    await set({ cache: { uid: auth.uid, rev: meta.rev, canon } });
    return canon;
  }

  async function sync() {
    const auth = await token();
    const meta = await readMeta(auth.uid);
    if (!meta) throw new SyncError('W chmurze nie ma jeszcze listy. Otwórz Disboard na stronie, zaloguj się tam tym samym kontem i poczekaj na synchronizację.', 'empty');
    const canon = await load(auth, meta);
    await set({ view: viewOf(JSON.parse(canon), meta.rev), lastSync: Date.now(), error: null });
  }

  /* ---------- zmiany „+1 / −1” ---------- */
  function applyOne(op) {
    const e = C.Lib.get(op.id);
    if (!e) return { op, result: 'missing' };
    const last = C.Lib.lastEp(e);
    if (last !== op.from) {
      // lista zmieniła się gdzie indziej: jeśli ten krok już się dokonał, nie powtarzamy go
      const done = op.d > 0 ? last >= op.from + op.d : last <= op.from + op.d;
      return { op, result: done ? 'already' : 'changed', last };
    }
    C.Lib.increment(op.id, op.d);
    const after = C.Lib.lastEp(e);
    return { op, result: after === last ? 'nochange' : 'ok', last: after, status: e.status };
  }

  async function needFlags(state, ops) {
    if (!state.settings || !state.settings.skipFiller) return;
    for (const op of ops) {
      const e = state.entries[op.id];
      if (op.d > 0 && e && e.idMal) {
        const f = await fillerFlags(e.idMal);
        if (f) C.setFlags(e.idMal, f);
      }
    }
  }

  // wszystkie czekające zmiany: jedno pobranie, jedna wysyłka; przy sporze od nowa
  async function applyPending() {
    const pending = (await get('pending')) || [];
    if (!pending.length) return [];
    const auth = await token();
    for (let attempt = 0; attempt < 4; attempt++) {
      const meta = await readMeta(auth.uid);
      if (!meta) throw new SyncError('W chmurze nie ma listy — nic nie zmieniam.', 'empty');
      let canon;
      try { canon = await load(auth, meta); } catch (e) { if (e.code === 'conflict') continue; throw e; }
      const state = C.normalizeState(JSON.parse(canon));
      C.setState(state);
      C.clearFlags();
      await needFlags(state, pending);
      C.takeToasts();
      const results = pending.map(applyOne);
      const toasts = C.takeToasts();
      const next = C.canon(C.getState());
      let rev = meta.rev;
      if (next !== canon) {
        rev = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        try {
          await writeList(auth.uid, meta, rev, next);
        } catch (e) {
          if (e.code === 'conflict') continue;
          throw e;
        }
      }
      // widok, pamięć listy i kolejka zmieniają się razem (okienko nie policzy odcinka
      // dwa razy); usuwamy tylko obsłużone zmiany, bo w międzyczasie mogły dojść nowe
      const now = (await get('pending')) || [];
      await set({
        cache: { uid: auth.uid, rev, canon: next },
        view: viewOf(JSON.parse(next), rev),
        pending: now.filter((p) => !pending.some((q) => q.key === p.key)),
        lastSync: Date.now(), error: null,
      });
      return results.map((r) => ({ ...r, toasts }));
    }
    throw new SyncError('Lista zmienia się gdzie indziej szybciej, niż nadążam. Spróbuję za chwilę.', 'busy');
  }

  /* ---------- fillery i recapy (tylko przy włączonym pomijaniu) ---------- */
  async function fillerFlags(malId) {
    const key = `flags:${malId}`;
    const hit = await get(key);
    if (hit && Date.now() - hit.t < FLAGS_TTL) return hit;
    // Jikan nie odpowiadał niedawno: nie czekamy na niego przy każdym „+1”
    const miss = await get('jikanDownAt');
    if (miss && Date.now() - miss < 30 * 60e3) return hit || null;
    const list = [];
    try {
      for (let page = 1; page <= 30; page++) {
        const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        list.push(...(d.data || []));
        if (!d.pagination || !d.pagination.has_next_page) break;
        await new Promise((r) => setTimeout(r, 450)); // Jikan: najwyżej 3 zapytania na sekundę
      }
    } catch { // bez danych: zwykłe +1, tak jak na stronie
      await set({ jikanDownAt: Date.now() });
      return hit || null;
    }
    const toRanges = (nums) => {
      const out = [];
      for (const n of [...new Set(nums)].sort((a, b) => a - b)) { const l = out[out.length - 1]; if (l && n === l[1] + 1) l[1] = n; else out.push([n, n]); }
      return out;
    };
    const f = {
      t: Date.now(),
      n: Math.max(0, ...list.map((x) => x.mal_id || 0)),
      f: toRanges(list.filter((x) => x.filler).map((x) => x.mal_id)),
      r: toRanges(list.filter((x) => x.recap).map((x) => x.mal_id)),
    };
    await set({ [key]: f });
    return f;
  }

  /* ---------- widok dla okienka ---------- */
  function viewOf(state, rev) {
    C.setState(C.normalizeState(state));
    const S = C.getState();
    const lang = S.settings.titleLang;
    const items = Object.values(S.entries).map((e) => {
      const m = e.media || {};
      const t = m.title || {};
      const s = C.Lib.cur(e);
      return {
        id: e.id,
        title: C.titleOf(m, lang),
        sub: [t.romaji, t.english, t.native].find((x) => x && x !== C.titleOf(m, lang)) || '',
        find: [t.romaji, t.english, t.native, ...(m.synonyms || [])].filter(Boolean).join(' | '),
        cover: (m.coverImage && (m.coverImage.large || m.coverImage.medium || m.coverImage.extraLarge)) || '',
        color: (m.coverImage && m.coverImage.color) || '',
        fav: !!e.favorite,
        score: e.score || null,
        status: e.status,
        last: C.Lib.lastEp(e),
        progress: s.progress,
        ranges: !!s.ranges,
        rewatch: s.n || 0,
        total: m.episodes || null,
        mstatus: m.status || null,
        next: m.nextAiringEpisode || null,
        format: m.format || null,
        upd: e.updatedAt || 0,
      };
    });
    return { rev, at: Date.now(), skipFiller: !!S.settings.skipFiller, theme: S.settings.theme || 'disboard', items };
  }

  /* ---------- emisja z AniList (świeższa niż zapisana na liście) ---------- */
  async function refreshAiring(force = false) {
    const view = await get('view');
    const old = (await get('airing')) || { at: 0, map: {} };
    if (!view || (!force && Date.now() - old.at < AIRING_EVERY)) return old;
    const ids = view.items.filter((i) => i.status === 'watching' || i.status === 'paused').map((i) => i.id);
    const map = {};
    for (let i = 0; i < ids.length; i += 50) {
      const res = await call('https://graphql.anilist.co', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: 'query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){id episodes status nextAiringEpisode{episode airingAt}}}}',
          variables: { ids: ids.slice(i, i + 50) },
        }),
      });
      if (!res.ok) return old; // AniList chwilowo nie odpowiada: zostają starsze dane
      const d = await res.json();
      for (const m of (d.data && d.data.Page && d.data.Page.media) || []) {
        map[m.id] = { episodes: m.episodes, status: m.status, next: m.nextAiringEpisode || null };
      }
    }
    const airing = { at: Date.now(), map };
    await set({ airing });
    return airing;
  }

  /* ---------- liczby do okienka i ikonki (te same co w popup.js) ---------- */
  function airInfo(item, airing) {
    const a = (airing && airing.map && airing.map[item.id]) || null;
    const status = (a && a.status) || item.mstatus;
    const next = a ? a.next : item.next;
    const total = (a && a.episodes) || item.total;
    let aired = null;
    if (next && next.episode) aired = next.airingAt * 1000 <= Date.now() ? next.episode : next.episode - 1;
    else if (status === 'FINISHED') aired = total || null;
    else if (status === 'NOT_YET_RELEASED') aired = 0;
    // „nowe” = do 3 odcinków za emisją; dalej to już nadrabianie (np. One Piece), bez alarmu na ikonce
    const behind = status === 'RELEASING' && aired != null ? Math.max(0, aired - item.last) : 0;
    const fresh = behind <= 3 ? behind : 0;
    return { status, next, total, aired, fresh, behind };
  }

  async function badge() {
    const [view, airing, pending, auth] = await Promise.all([get('view'), get('airing'), get('pending'), get('auth')]);
    let text = '';
    if (!auth) text = '';
    else if (view) {
      const n = view.items.filter((i) => i.status === 'watching' && airInfo(i, airing).fresh > 0).length;
      text = n ? String(n) : '';
    }
    if (pending && pending.length) text = text || '…';
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: '#ff4f8b' });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    await chrome.action.setTitle({ title: text && text !== '…' ? `Disboard — nowe odcinki w ${text} ${Number(text) === 1 ? 'serii' : 'seriach'}` : 'Disboard' });
  }

  return {
    SITE, signIn, signOut, sync, applyPending, refreshAiring, badge, airInfo, SYNC_EVERY,
    _test: { readMeta, readList, writeList, applyOne, viewOf, CFG },
  };
})();
