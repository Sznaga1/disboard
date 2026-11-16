/* Rozszerzenie przeglądarki: „+1 / −1” z rozszerzenia trafiają do tej samej
   listy w chmurze, z której korzysta strona. Chmura to atrapa Firestore
   (REST dla rozszerzenia, adapter jak w js/cloud.js dla strony) na wspólnych
   dokumentach: opis users/{uid}/data/state + części gzip w users/{uid}/parts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadApp, media } from './harness.mjs';
import { buildCore, CORE_OUT, buildThemes, THEMES_OUT } from '../tools/build-extension.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UID = 'u1';
const DOCS = 'https://firestore.googleapis.com/v1/projects/disboard-63851/databases/(default)/documents';
const PREFIX = 'projects/disboard-63851/databases/(default)/documents/';

/* ---------- atrapa Firestore ---------- */
function fakeFirestore() {
  const docs = new Map(); // ścieżka → { fields, updateTime }
  let clock = 0;
  const subs = new Set();
  const stamp = () => `2026-11-16T00:00:00.${String(++clock).padStart(6, '0')}Z`;
  const metaPath = `users/${UID}/data/state`;
  const db = {
    docs, offline: false, beforeCommit: null, commits: 0,
    // REST, tak jak wywołuje go rozszerzenie
    async fetch(url, opts = {}) {
      if (db.offline) throw new TypeError('Failed to fetch');
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('https://securetoken.googleapis.com')) return json(200, { id_token: 'tok2', refresh_token: 'r2', expires_in: '3600' });
      if (url.startsWith('https://graphql.anilist.co')) return json(200, { data: { Page: { media: [] } } });
      if (!url.startsWith(DOCS)) throw new Error(`nieznany adres ${url}`);
      const rest = url.slice(DOCS.length);
      if (!opts.method || opts.method === 'GET') {
        const p = rest.slice(1);
        const d = docs.get(p);
        return d ? json(200, { name: PREFIX + p, fields: d.fields, updateTime: d.updateTime }) : json(404, { error: { status: 'NOT_FOUND' } });
      }
      const body = JSON.parse(opts.body);
      if (rest === ':batchGet') {
        return json(200, body.documents.map((n) => {
          const d = docs.get(n.slice(PREFIX.length));
          return d ? { found: { name: n, fields: d.fields, updateTime: d.updateTime } } : { missing: n };
        }));
      }
      if (rest === ':commit') {
        if (db.beforeCommit) { const f = db.beforeCommit; db.beforeCommit = null; await f(); }
        for (const w of body.writes) {
          const pre = w.currentDocument;
          if (pre && pre.updateTime) {
            const d = docs.get(w.update.name.slice(PREFIX.length));
            if (!d || d.updateTime !== pre.updateTime) return json(400, { error: { status: 'FAILED_PRECONDITION', message: 'updateTime mismatch' } });
          }
        }
        const t = stamp();
        for (const w of body.writes) {
          if (w.delete) docs.delete(w.delete.slice(PREFIX.length));
          else docs.set(w.update.name.slice(PREFIX.length), { fields: w.update.fields, updateTime: t });
        }
        db.commits++;
        notify();
        return json(200, { commitTime: t });
      }
      throw new Error(`nieobsługiwane: ${rest}`);
    },
    // adapter strony (to samo co firebaseAdapter w js/cloud.js, na tych samych dokumentach)
    site: {
      async readMeta() { return readMeta(); },
      async read(meta) {
        const chunks = Array.from({ length: meta.parts }, (_, i) => {
          const d = docs.get(`users/${UID}/parts/${meta.rev}_${i}`);
          if (!d) throw new Error('brak części');
          return Buffer.from(d.fields.b.bytesValue, 'base64');
        });
        return gunzip(Buffer.concat(chunks));
      },
      async write(expected, rev, json) {
        const cur = readMeta();
        if ((cur ? cur.rev : null) !== expected) return { conflict: true, meta: cur };
        const bytes = await gzip(json);
        const t = stamp();
        docs.set(`users/${UID}/parts/${rev}_0`, { fields: { b: { bytesValue: Buffer.from(bytes).toString('base64') } }, updateTime: t });
        if (cur) for (let i = 0; i < cur.parts; i++) docs.delete(`users/${UID}/parts/${cur.rev}_${i}`);
        docs.set(metaPath, { fields: { v: { integerValue: '1' }, rev: { stringValue: rev }, parts: { integerValue: '1' }, device: { stringValue: 'komputer' } }, updateTime: t });
        notify();
        return { rev };
      },
      subscribe(cb) { subs.add(cb); setTimeout(() => cb(readMeta()), 0); return () => subs.delete(cb); },
    },
  };
  function readMeta() {
    const d = docs.get(metaPath);
    if (!d) return null;
    return { rev: d.fields.rev.stringValue, parts: Number(d.fields.parts.integerValue), device: d.fields.device && d.fields.device.stringValue };
  }
  function notify() { setTimeout(() => subs.forEach((f) => f(readMeta())), 0); }
  return db;
}
async function gzip(text) {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(s).text();
}

/* ---------- rozszerzenie (część w tle) w osobnym kontekście ---------- */
async function extension(db) {
  const mem = new Map([['auth', { uid: UID, idToken: 'tok', refreshToken: 'r', exp: Date.now() + 3600e3, email: 'x@y' }]]);
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = typeof keys === 'string' ? [keys] : keys;
          return Object.fromEntries(list.filter((k) => mem.has(k)).map((k) => [k, clone(mem.get(k))]));
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) mem.set(k, clone(v)); },
        async remove(keys) { for (const k of [].concat(keys)) mem.delete(k); },
      },
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {}, setTitle: async () => {} },
    identity: {},
  };
  const ctx = vm.createContext({
    chrome, fetch: (u, o) => db.fetch(u, o), crypto: globalThis.crypto, btoa, atob, Blob, Response,
    CompressionStream, DecompressionStream, URL, URLSearchParams, setTimeout, clearTimeout, Intl, structuredClone,
    EventTarget, CustomEvent, TextEncoder, TextDecoder, queueMicrotask, console,
  });
  for (const f of ['extension/core.js', 'extension/sync.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const Sync = vm.runInContext('Sync', ctx);
  return {
    Sync, mem,
    view: () => mem.get('view'),
    item: (id) => mem.get('view').items.find((i) => i.id === id),
    async step(id, d, from) {
      const it = mem.get('view').items.find((i) => i.id === id);
      const pending = mem.get('pending') || [];
      pending.push({ id, d, from: from ?? it.last, key: Math.random().toString(36), t: Date.now() });
      mem.set('pending', pending);
      return Sync.applyPending();
    },
  };
}

async function site(db) {
  const app = await loadApp();
  const C = app.run('Cloud._test');
  await C.attach(db.site, UID);
  return {
    app, Lib: app.Lib, C,
    get S() { return app.S; },
    idle: async () => { for (let i = 0; i < 3; i++) { await sleep(20); await C.idle(); } },
  };
}

/* ---------- testy ---------- */
test('extension/core.js jest zbudowany z aktualnych plików strony', () => {
  const now = fs.readFileSync(path.join(ROOT, CORE_OUT), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(now === buildCore(), 'Uruchom: node tools/build-extension.mjs');
  const themes = fs.readFileSync(path.join(ROOT, THEMES_OUT), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(themes === buildThemes(), 'Motywy nieaktualne. Uruchom: node tools/build-extension.mjs');
});

test('manifest: stały numer rozszerzenia i tylko potrzebne uprawnienia', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.ok(m.key && m.key.length > 300);
  assert.deepEqual([...m.permissions].sort(), ['alarms', 'identity', 'storage', 'unlimitedStorage']);
  for (const f of ['popup.html', 'popup.js', 'popup.css', 'background.js', 'core.js', 'sync.js', 'icons/icon-192.png', 'icons/icon.svg', 'theme.js', 'themes.css']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'extension', f)), f);
  }
});

test('rozszerzenie czyta listę wysłaną przez stronę', async () => {
  const db = fakeFirestore();
  const A = await site(db);
  A.Lib.add(media(1, { title: 'No Game No Life' }), 'watching');
  A.Lib.setProgress(1, 4);
  A.Lib.add(media(2, { title: 'Planowane' }), 'planning');
  await A.C.sync();
  const X = await extension(db);
  await X.Sync.sync();
  assert.equal(X.view().items.length, 2);
  assert.equal(X.item(1).last, 4);
  assert.equal(X.item(1).status, 'watching');
  assert.equal(X.item(1).title, 'No Game No Life');
  assert.equal(X.item(2).status, 'planning');
  assert.equal(X.view().theme, 'disboard');
});

test('+1 z rozszerzenia = to samo co +1 na stronie, a strona dostaje zmianę', async () => {
  const db = fakeFirestore();
  const A = await site(db);
  A.Lib.add(media(1, { episodes: 12 }), 'watching');
  A.Lib.setProgress(1, 4);
  await A.C.sync();
  const X = await extension(db);
  await X.Sync.sync();
  const [r] = await X.step(1, 1);
  assert.equal(r.result, 'ok');
  assert.equal(r.last, 5);
  assert.equal(X.item(1).last, 5);
  assert.equal(db.docs.get(`users/${UID}/data/state`).fields.device.stringValue, 'rozszerzenie');
  await A.idle();
  const e = A.Lib.get(1);
  assert.equal(A.Lib.cur(e).progress, 5);
  const eps = A.S.history.filter((h) => h.k === 'ep' && h.m === 1).map((h) => h.ep).sort((a, b) => a - b);
  assert.equal(eps.join(','), '1,2,3,4,5');
  // stare części listy zostały usunięte, w chmurze leży jedna wersja
  assert.equal([...db.docs.keys()].filter((k) => k.includes('/parts/')).length, 1);
  // strona nie odsyła listy z powrotem (brak pętli)
  const commits = db.commits;
  await A.C.sync();
  assert.equal(db.commits, commits);
});

test('+1 na ostatnim odcinku kończy serię; −1 cofa', async () => {
  const db = fakeFirestore();
  const A = await site(db);
  A.Lib.add(media(1, { episodes: 3, title: 'Krótkie' }), 'watching');
  A.Lib.setProgress(1, 2);
  await A.C.sync();
  const X = await extension(db);
  await X.Sync.sync();
  const [r] = await X.step(1, 1);
  assert.equal(r.status, 'completed');
  assert.ok(r.toasts.some((t) => /Ukończono/.test(t)));
  assert.equal(X.item(1).status, 'completed');
  await A.idle();
  assert.equal(A.Lib.get(1).status, 'completed');
  assert.ok(A.Lib.cur(A.Lib.get(1)).finishedAt);
  const [back] = await X.step(1, -1);
  assert.equal(back.last, 2);
  await A.idle();
  assert.equal(A.Lib.get(1).status, 'watching');
  assert.equal(A.S.history.filter((h) => h.k === 'ep' && h.m === 1).length, 2);
});

test('zmiana strony w trakcie zapisu rozszerzenia: obie zmiany zostają', async () => {
  const db = fakeFirestore();
  const A = await site(db);
  A.Lib.add(media(1), 'watching');
  A.Lib.add(media(2), 'watching');
  await A.C.sync();
  const X = await extension(db);
  await X.Sync.sync();
  // tuż przed zapisem rozszerzenia strona zapisuje własną zmianę innego anime
  db.beforeCommit = async () => { A.Lib.setProgress(2, 7); await A.C.sync(); };
  const [r] = await X.step(1, 1);
  assert.equal(r.result, 'ok');
  await A.idle();
  assert.equal(A.Lib.cur(A.Lib.get(1)).progress, 1);
  assert.equal(A.Lib.cur(A.Lib.get(2)).progress, 7);
  assert.equal(X.item(2).last, 7);
});

test('odcinek zaznaczony już na innym urządzeniu nie liczy się drugi raz', async () => {
  const db = fakeFirestore();
  const A = await site(db);
  A.Lib.add(media(1), 'watching');
  A.Lib.setProgress(1, 3);
  await A.C.sync();
  const X = await extension(db);
  await X.Sync.sync();
  A.Lib.increment(1); // telefon/strona: odc. 4
  await A.C.sync();
  const [r] = await X.step(1, 1, 3); // rozszerzenie widziało jeszcze odc. 3
  assert.equal(r.result, 'already');
  await A.idle();
  assert.equal(A.Lib.cur(A.Lib.get(1)).progress, 4);
});

test('bez internetu zmiana czeka w kolejce i zapisuje się później', async () => {
  const db = fakeFirestore();
  const A = await site(db);
  A.Lib.add(media(1), 'watching');
  await A.C.sync();
  const X = await extension(db);
  await X.Sync.sync();
  db.offline = true;
  await assert.rejects(X.step(1, 1), (e) => e.code === 'offline');
  assert.equal(X.mem.get('pending').length, 1);
  db.offline = false;
  const [r] = await X.Sync.applyPending();
  assert.equal(r.result, 'ok');
  assert.equal(X.mem.get('pending').length, 0);
  await A.idle();
  assert.equal(A.Lib.cur(A.Lib.get(1)).progress, 1);
});

test('pusta chmura: rozszerzenie niczego nie tworzy', async () => {
  const db = fakeFirestore();
  const X = await extension(db);
  await assert.rejects(X.Sync.sync(), (e) => e.code === 'empty');
  assert.equal(db.docs.size, 0);
});

test('pomijanie fillerów działa tak jak na stronie', async () => {
  const db = fakeFirestore();
  const A = await site(db);
  A.Lib.add(media(1, { episodes: 10 }), 'watching');
  A.Lib.setProgress(1, 2);
  A.S.settings.skipFiller = true;
  await A.C.sync();
  const X = await extension(db);
  await X.Sync.sync();
  X.mem.set('flags:1001', { t: Date.now(), n: 10, f: [[3, 4]], r: [] }); // media(1) ma idMal 1001
  const [r] = await X.step(1, 1);
  assert.equal(r.last, 5);
  await A.idle();
  assert.equal(A.Lib.lastEp(A.Lib.get(1)), 5);
  assert.equal(A.Lib.cur(A.Lib.get(1)).progress, 3); // 1, 2 i 5
});
