/* Testy logiki aplikacji: liczenie czasu i odcinków, rewatche, zakresy odcinków,
   łączenie zmian z dwóch kart, eksport i import, zegar NGNL.
   Uruchomienie: node --test tests/   (bez instalowania czegokolwiek) */
process.env.TZ = 'Europe/Warsaw'; // strefa z czasem letnim/zimowym, jak u użytkownika

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, media } from './harness.mjs';

const plain = (x) => JSON.parse(JSON.stringify(x));

/* ---------- czas oglądania i rewatche ---------- */
test('obejrzenie całej serii liczy odcinki, minuty i kończy anime', async () => {
  const { Lib } = await loadApp();
  Lib.add(media(1, { episodes: 12, duration: 24 }), 'watching');
  assert.equal(Lib.setEpisodes(1, 1, 12, true), 12);
  const e = Lib.get(1);
  assert.equal(Lib.totalEps(e), 12);
  assert.equal(Lib.entryMinutes(e), 12 * 24);
  assert.equal(e.status, 'completed');
  assert.equal(Lib.finishedCount(e), 1);
});

test('rewatch dolicza odcinki i minuty do tego samego anime', async () => {
  const { Lib } = await loadApp();
  Lib.add(media(2, { episodes: 12, duration: 24 }), 'watching');
  Lib.setEpisodes(2, 1, 12, true);
  Lib.startRewatch(2);
  const e = Lib.get(2);
  assert.ok(Lib.isRewatch(e));
  assert.equal(e.status, 'watching');
  Lib.setEpisodes(2, 1, 6, true);
  assert.equal(Lib.totalEps(e), 18);
  assert.equal(Lib.entryMinutes(e), 18 * 24);
  assert.equal(Lib.finishedCount(e), 1, 'rewatch jeszcze nieukończony');
  Lib.setEpisodes(2, 7, 12, true);
  assert.equal(Lib.finishedCount(e), 2);
  assert.equal(Lib.entryMinutes(e), 24 * 24);
});

test('ręczna długość odcinka zastępuje tę z AniList', async () => {
  const { Lib } = await loadApp();
  Lib.add(media(3, { episodes: 10, duration: 24 }), 'watching');
  Lib.setEpisodes(3, 1, 10, true);
  Lib.get(3).durationOverride = 30;
  assert.equal(Lib.entryMinutes(Lib.get(3)), 300);
});

test('statystyki sumują czas wszystkich pozycji', async () => {
  const { Lib } = await loadApp();
  Lib.add(media(4, { episodes: 12, duration: 24 }), 'watching');
  Lib.add(media(5, { episodes: 2, duration: 100 }), 'watching');
  Lib.setEpisodes(4, 1, 12, true);
  Lib.setEpisodes(5, 1, 2, true);
  const st = Lib.stats();
  assert.equal(st.total, 2);
  assert.equal(st.minutes, 12 * 24 + 2 * 100);
  assert.equal(st.eps, 14);
});

/* ---------- zakresy odcinków ---------- */
test('zaznaczanie i odznaczanie dowolnych zakresów odcinków', async () => {
  const { Lib, S } = await loadApp();
  Lib.add(media(6, { episodes: 12 }), 'watching');
  Lib.setEpisodes(6, 1, 5, true);
  Lib.setEpisodes(6, 10, 12, true);
  const s = () => Lib.cur(Lib.get(6));
  assert.equal(Lib.rangesText(s()), '1–5, 10–12');
  assert.equal(s().progress, 8);
  assert.equal(Lib.setEpisodes(6, 3, 4, false), 2);
  assert.equal(Lib.rangesText(s()), '1–2, 5, 10–12');
  assert.equal(s().progress, 6);
  assert.ok(Lib.hasEp(s(), 5) && !Lib.hasEp(s(), 3));
  // historia ma zdarzenia dokładnie dla zaznaczonych odcinków
  const eps = plain(S.history.filter((h) => h.k === 'ep' && h.m === 6).map((h) => h.ep).sort((a, b) => a - b));
  assert.deepEqual(eps, [1, 2, 5, 10, 11, 12]);
});

test('ponowne zaznaczenie obejrzanych odcinków niczego nie dubluje', async () => {
  const { Lib, S } = await loadApp();
  Lib.add(media(7, { episodes: 12 }), 'watching');
  Lib.setEpisodes(7, 1, 6, true);
  assert.equal(Lib.setEpisodes(7, 1, 6, true), 0);
  assert.equal(S.history.filter((h) => h.k === 'ep' && h.m === 7).length, 6);
});

test('odznaczenie ostatniego odcinka cofa ukończenie', async () => {
  const { Lib } = await loadApp();
  Lib.add(media(8, { episodes: 3 }), 'watching');
  Lib.setEpisodes(8, 1, 3, true);
  assert.equal(Lib.get(8).status, 'completed');
  Lib.setEpisodes(8, 3, 3, false);
  assert.equal(Lib.get(8).status, 'watching');
  assert.equal(Lib.finishedCount(Lib.get(8)), 0);
});

/* ---------- łączenie zmian z dwóch kart ---------- */
function twoTabs(app) {
  const { Lib } = app;
  Lib.add(media(10), 'watching');
  Lib.add(media(11), 'watching');
  const base = plain(app.S);
  return { base, mine: plain(base), theirs: plain(base) };
}

test('łączenie: zmiany różnych anime z dwóch kart się sumują', async () => {
  const app = await loadApp();
  const { base, mine, theirs } = twoTabs(app);
  mine.entries[10].notes = 'z karty A'; mine.entries[10].updatedAt += 10;
  theirs.entries[11].score = 9; theirs.entries[11].updatedAt += 10;
  const out = app.fn('mergeStates')(base, mine, theirs);
  assert.equal(out.entries[10].notes, 'z karty A');
  assert.equal(out.entries[11].score, 9);
});

test('łączenie: to samo anime zmienione w obu kartach — wygrywa nowsza zmiana', async () => {
  const app = await loadApp();
  const { base, mine, theirs } = twoTabs(app);
  mine.entries[10].notes = 'starsza'; mine.entries[10].updatedAt += 10;
  theirs.entries[10].notes = 'nowsza'; theirs.entries[10].updatedAt += 20;
  assert.equal(app.fn('mergeStates')(base, mine, theirs).entries[10].notes, 'nowsza');
  assert.equal(app.fn('mergeStates')(base, theirs, mine).entries[10].notes, 'nowsza');
});

test('łączenie: usunięte w jednej karcie, zmienione w drugiej — zostaje', async () => {
  const app = await loadApp();
  const { base, mine, theirs } = twoTabs(app);
  delete mine.entries[10];
  theirs.entries[10].notes = 'ważna notatka'; theirs.entries[10].updatedAt += 10;
  assert.equal(app.fn('mergeStates')(base, mine, theirs).entries[10].notes, 'ważna notatka');
});

test('łączenie: nowe anime i jego historia z obu kart', async () => {
  const app = await loadApp();
  const { base } = twoTabs(app);
  app.Lib.add(media(12), 'watching');
  app.Lib.setEpisodes(12, 1, 3, true);
  const mine = plain(app.S);
  const theirs = plain(base);
  theirs.entries[13] = { ...plain(base.entries[10]), id: 13, media: media(13) };
  theirs.history.push({ id: 'x13', t: Date.now(), k: 'add', m: 13 });
  const out = app.fn('mergeStates')(base, mine, theirs);
  assert.ok(out.entries[12] && out.entries[13]);
  assert.equal(out.history.filter((h) => h.k === 'ep' && h.m === 12).length, 3);
  assert.ok(out.history.some((h) => h.id === 'x13'));
});

/* ---------- eksport i import ---------- */
async function sampleApp() {
  const app = await loadApp();
  const { Lib } = app;
  Lib.add(media(20, { episodes: 12, title: 'No Game No Life' }), 'watching');
  Lib.setEpisodes(20, 1, 12, true);
  Lib.startRewatch(20);
  Lib.setEpisodes(20, 1, 4, true);
  Lib.add(media(21, { episodes: 24, title: 'Tytuł; z "cudzysłowem"' }), 'planning');
  Lib.get(21).notes = 'notatka\nw dwóch liniach';
  Lib.get(21).tags = ['isekai', 'gry'];
  return app;
}

test('eksport JSON → import „zastąp” odtwarza listę 1:1', async () => {
  const src = await sampleApp();
  src.IO.exportJSON();
  const file = src.downloads.at(-1);
  assert.match(file.name, /^disboard-kopia-\d{4}-\d{2}-\d{2}\.json$/);

  const dst = await loadApp();
  const r = await dst.IO.importJSON(file.content, 'replace');
  assert.equal(r.added, 2);
  const want = JSON.parse(file.content).state;
  assert.deepEqual(plain(dst.S.entries), want.entries);
  assert.deepEqual(plain(dst.S.history), want.history);
  assert.equal(dst.Lib.totalEps(dst.Lib.get(20)), 16);
});

test('import „dołącz” pomija pozycje, które już są na liście', async () => {
  const src = await sampleApp();
  src.IO.exportJSON();
  const dst = await loadApp();
  dst.Lib.add(media(20, { title: 'moja wersja' }), 'completed');
  const r = await dst.IO.importJSON(src.downloads.at(-1).content, 'merge');
  assert.deepEqual({ added: r.added, skipped: r.skipped }, { added: 1, skipped: 1 });
  assert.equal(dst.Lib.get(20).status, 'completed', 'istniejąca pozycja zostaje nietknięta');
  assert.equal(dst.Lib.get(21).notes, 'notatka\nw dwóch liniach');
});

test('import odrzuca plik, który nie jest kopią Disboard', async () => {
  const app = await loadApp();
  await assert.rejects(app.IO.importJSON('to nie json'), /poprawny plik JSON/);
  await assert.rejects(app.IO.importJSON('{"a":1}'), /kopię z Disboard/);
});

test('eksport CSV: średniki, cudzysłowy i nowe linie wracają po odczycie', async () => {
  const app = await sampleApp();
  app.IO.exportCSV();
  const rows = app.IO.parseCSV(app.downloads.at(-1).content);
  const head = rows[0];
  const row = rows.find((r) => r[head.indexOf('AniList ID')] === '21');
  assert.ok(row, 'wiersz anime 21');
  assert.equal(row[head.indexOf('Tytuł (romaji)')], 'Tytuł; z "cudzysłowem"');
  assert.equal(row[head.indexOf('Notatki')], 'notatka\nw dwóch liniach');
  const nGnL = rows.find((r) => r[head.indexOf('AniList ID')] === '20');
  assert.equal(nGnL[head.indexOf('Obejrzane odcinki łącznie')], '16');
});

/* ---------- zapis ---------- */
test('zapis trafia do pamięci przeglądarki i wraca po ponownym uruchomieniu', async () => {
  const app = await loadApp();
  app.Lib.add(media(30), 'watching');
  app.Lib.setEpisodes(30, 1, 5, true);
  await app.run('saveNow()');
  const raw = app.localStorage.getItem('disboard.library.v1');
  const again = await loadApp({ storage: { 'disboard.library.v1': raw } });
  assert.equal(again.Lib.cur(again.Lib.get(30)).progress, 5);
});

/* ---------- zegar NGNL ---------- */
test('zegar NGNL: zmiana czasu na zimowy nie przesuwa godzin', async () => {
  const app = await loadApp();
  const diffCalendar = app.fn('diffCalendar');
  const from = new Date(2014, 5, 25).getTime(); // północ 25.06.2014, czas letni
  const winter = diffCalendar(from, new Date(2026, 10, 12, 14, 37, 5).getTime());
  assert.deepEqual([winter.y, winter.d, winter.h, winter.m, winter.s], [12, 140, 14, 37, 5]);
  const midnight = diffCalendar(from, new Date(2026, 10, 12, 0, 0, 0).getTime());
  assert.deepEqual([midnight.h, midnight.m, midnight.s], [0, 0, 0]);
  const summer = diffCalendar(from, new Date(2026, 6, 15, 9, 0, 0).getTime());
  assert.deepEqual([summer.y, summer.d, summer.h], [12, 20, 9]);
  const anniv = diffCalendar(from, new Date(2026, 5, 25).getTime());
  assert.deepEqual([anniv.y, anniv.d, anniv.h], [12, 0, 0]);
});
