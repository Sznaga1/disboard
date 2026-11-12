/* Synchronizacja między urządzeniami: dwa „urządzenia” (dwie osobne kopie
   aplikacji z własną pamięcią) i wspólna chmura w pamięci, która zachowuje się
   jak Firestore: zapis przechodzi tylko, gdy wersja w chmurze się zgadza. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, media } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function memoryCloud() {
  let meta = null;
  const data = new Map();
  const subs = new Set();
  const cloud = {
    writes: 0,
    async readMeta() { return meta && { ...meta }; },
    async read(m) { return data.get(m.rev); },
    async write(expected, rev, json) {
      if ((meta ? meta.rev : null) !== expected) return { conflict: true, meta: meta && { ...meta } };
      data.set(rev, json);
      meta = { rev, parts: 1 };
      cloud.writes++;
      setTimeout(() => subs.forEach((f) => f({ ...meta })), 0);
      return { rev };
    },
    subscribe(cb) { subs.add(cb); setTimeout(() => cb(meta && { ...meta }), 0); return () => subs.delete(cb); },
    get meta() { return meta; },
  };
  return cloud;
}

async function device(cloud, uid = 'u1') {
  const app = await loadApp();
  const C = app.run('Cloud._test');
  return {
    app, Lib: app.Lib, C,
    get S() { return app.S; },
    login: () => C.attach(cloud, uid),
    sync: () => C.sync(),
    idle: async () => { await sleep(20); await C.idle(); await sleep(20); await C.idle(); },
    canon: () => C.canon(app.S),
  };
}

test('nowe urządzenie po zalogowaniu dostaje całą listę z chmury', async () => {
  const cloud = memoryCloud();
  const A = await device(cloud);
  A.Lib.add(media(1, { title: 'No Game No Life' }), 'watching');
  A.Lib.setEpisodes(1, 1, 5, true);
  A.S.settings.theme = 'neon';
  await A.login();
  assert.equal(cloud.writes, 1);

  const B = await device(cloud);
  await B.login();
  assert.equal(B.Lib.cur(B.Lib.get(1)).progress, 5);
  assert.equal(B.S.settings.theme, 'neon');
  assert.equal(B.S.history.filter((h) => h.k === 'ep').length, 5);
  assert.equal(B.canon(), A.canon());
});

test('zmiany różnych anime z dwóch urządzeń łączą się', async () => {
  const cloud = memoryCloud();
  const A = await device(cloud);
  A.Lib.add(media(1), 'watching');
  A.Lib.add(media(2), 'watching');
  await A.login();
  const B = await device(cloud);
  await B.login();

  A.Lib.setEpisodes(1, 1, 3, true);
  B.Lib.setEpisodes(2, 1, 7, true);
  await A.sync();
  await B.sync(); // B ma nieaktualną bazę: pobiera, łączy, wysyła
  await A.idle();
  await B.idle();
  for (const d of [A, B]) {
    assert.equal(d.Lib.cur(d.Lib.get(1)).progress, 3);
    assert.equal(d.Lib.cur(d.Lib.get(2)).progress, 7);
  }
  assert.equal(A.canon(), B.canon());
});

test('to samo anime na dwóch urządzeniach: wygrywa nowsza zmiana, wszędzie tak samo', async () => {
  const cloud = memoryCloud();
  const A = await device(cloud);
  A.Lib.add(media(1), 'watching');
  await A.login();
  const B = await device(cloud);
  await B.login();

  A.Lib.get(1).notes = 'starsza'; A.Lib.get(1).updatedAt = Date.now() - 1000;
  B.Lib.get(1).notes = 'nowsza'; B.Lib.get(1).updatedAt = Date.now();
  await A.sync();
  await B.sync();
  await A.idle(); await B.idle();
  assert.equal(A.Lib.get(1).notes, 'nowsza');
  assert.equal(B.Lib.get(1).notes, 'nowsza');
});

test('bez ping-ponga: po zgraniu kolejne synchronizacje niczego nie wysyłają', async () => {
  const cloud = memoryCloud();
  const A = await device(cloud);
  A.Lib.add(media(1), 'watching');
  A.Lib.setEpisodes(1, 1, 12, true);
  await A.login();
  const B = await device(cloud);
  B.Lib.add(media(2), 'planning'); // własna lista przed pierwszym logowaniem
  await B.login();
  await A.idle(); await B.idle();
  const writes = cloud.writes;
  for (let i = 0; i < 3; i++) { await A.sync(); await B.sync(); await A.idle(); await B.idle(); }
  assert.equal(cloud.writes, writes, 'żadnych zbędnych zapisów');
  assert.equal(A.canon(), B.canon());
});

test('pierwsze logowanie z własną listą: lista lokalna i z chmury się sumują', async () => {
  const cloud = memoryCloud();
  const A = await device(cloud);
  A.Lib.add(media(1), 'completed');
  await A.login();
  const B = await device(cloud);
  B.Lib.add(media(2), 'watching');
  await B.login();
  assert.ok(B.Lib.get(1) && B.Lib.get(2), 'B ma obie pozycje');
  await A.idle();
  assert.ok(A.Lib.get(2), 'A dostało pozycję z B na żywo');
});

test('zmiana na jednym urządzeniu przychodzi na drugie sama (na żywo)', async () => {
  const cloud = memoryCloud();
  const A = await device(cloud);
  A.Lib.add(media(1), 'watching');
  await A.login();
  const B = await device(cloud);
  await B.login();
  A.Lib.setEpisodes(1, 1, 4, true);
  await A.sync();
  await B.idle(); // B nie wywołuje sync(): zmiana przychodzi przez nasłuch
  assert.equal(B.Lib.cur(B.Lib.get(1)).progress, 4);
});

test('dane tylko tego urządzenia nie jeżdżą do chmury', async () => {
  const cloud = memoryCloud();
  const A = await device(cloud);
  A.Lib.add(media(1), 'watching');
  A.S.meta.lastRefresh = 111;
  A.S.meta.lastBackupAt = 222;
  await A.login();
  const B = await device(cloud);
  B.S.meta.lastRefresh = 999;
  await B.login();
  assert.equal(B.S.meta.lastRefresh, 999, 'B zachowuje swój czas odświeżenia');
  const writes = cloud.writes;
  A.S.meta.lastRefresh = Date.now(); // samo odświeżenie danych nie wysyła listy
  await A.sync();
  assert.equal(cloud.writes, writes);
});

test('usunięcie anime na jednym urządzeniu znika też na drugim', async () => {
  const cloud = memoryCloud();
  const A = await device(cloud);
  A.Lib.add(media(1), 'watching');
  A.Lib.add(media(2), 'watching');
  await A.login();
  const B = await device(cloud);
  await B.login();
  A.Lib.remove(2);
  await A.sync();
  await B.idle();
  assert.equal(B.Lib.get(2), null);
  assert.ok(B.Lib.get(1));
});
