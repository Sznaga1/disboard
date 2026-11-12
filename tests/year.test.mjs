/* Testy „Twój rok w anime” i dziennika błędów.
   Uruchomienie: node --test tests/*.test.mjs */
process.env.TZ = 'Europe/Warsaw';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, media } from './harness.mjs';

const at = (y, m, d, h = 20) => new Date(y, m - 1, d, h).getTime();
const plain = (x) => JSON.parse(JSON.stringify(x)); // obiekty z vm mają inne prototypy

// lista z ręcznie ułożoną historią: n odcinków danego dnia
function seed(app, list) {
  const { Lib, run } = app;
  for (const x of list) {
    if (!Lib.get(x.id)) {
      const m = { ...media(x.id, { duration: x.dur ?? 24, title: x.title || `Anime ${x.id}` }), genres: x.genres || [] };
      Lib.add(m, 'watching');
    }
  }
  run('S.history = S.history.filter((h) => h.k !== "ep")');
  const evs = [];
  for (const x of list) for (const [t, n, extra] of x.days) for (let i = 0; i < n; i++) evs.push({ id: `${x.id}-${t}-${i}`, t: t + i * 60e3, k: 'ep', m: x.id, s: 0, ep: i + 1, ...(extra || {}) });
  run(`S.history.push(...${JSON.stringify(evs)})`);
}

test('rok: godziny, odcinki, tytuły i porównanie z poprzednim rokiem', async () => {
  const app = await loadApp();
  seed(app, [
    { id: 1, genres: ['Action'], days: [[at(2026, 3, 1), 10], [at(2026, 3, 2), 5]] },
    { id: 2, genres: ['Drama', 'Action'], dur: 30, days: [[at(2026, 7, 10), 4]] },
    { id: 3, days: [[at(2025, 5, 5), 5]] },
  ]);
  const R = app.run('YearRecap.compute(2026)');
  assert.equal(R.eps, 19);
  assert.equal(R.minutes, 15 * 24 + 4 * 30);
  assert.equal(R.titles, 2);
  assert.equal(R.recordMonth.i, 2, 'marzec');
  assert.equal(R.top[0].e.id, 1);
  assert.deepEqual(plain(R.genres.map(([g]) => g)), ['Action', 'Drama']);
  assert.equal(R.genres[0][1], 15 * 24 + 4 * 30, 'Action z obu tytułów');
  assert.equal(R.prevMin, 5 * 24);
  assert.equal(Math.round(R.change * 100), Math.round(((480 - 120) / 120) * 100));
  assert.equal(app.run('YearRecap.compute(2025)').titles, 1);
  const ys = plain(app.run('YearRecap.years()'));
  assert.ok(ys.includes(2025) && ys.includes(2026) && ys.includes(new Date().getFullYear()));
  assert.deepEqual(ys, ys.slice().sort((a, b) => b - a), 'od najnowszego');
});

test('rok: najdłuższa seria dni bez hurtowych zaznaczeń i importu', async () => {
  const app = await loadApp();
  seed(app, [
    { id: 1, days: [[at(2026, 1, 30), 1], [at(2026, 1, 31), 1], [at(2026, 2, 1), 1], [at(2026, 2, 2), 1]] },
    // hurtowe zaznaczenie i import w dniach pomiędzy nie przedłużają serii
    { id: 2, days: [[at(2026, 2, 3), 12, { bulk: true }], [at(2026, 2, 4), 12, { past: true, bulk: true }], [at(2026, 5, 1), 1], [at(2026, 5, 2), 1]] },
  ]);
  const R = app.run('YearRecap.compute(2026)');
  assert.equal(R.streak.len, 4);
  assert.equal(R.streak.from, '2026-01-30');
  assert.equal(R.streak.to, '2026-02-02');
  assert.equal(R.eps, 4 + 24 + 2, 'hurtowe i importowane liczą się do czasu');
  assert.equal(R.pastEps, 12);
  assert.equal(R.activeDays, 6);
  assert.equal(R.recordDay.eps, 1);
});

test('rok: seria przez sylwestra liczy się tylko w obrębie roku', async () => {
  const app = await loadApp();
  seed(app, [{ id: 1, days: [[at(2025, 12, 30), 1], [at(2025, 12, 31), 1], [at(2026, 1, 1), 1], [at(2026, 1, 2), 1], [at(2026, 1, 3), 1]] }]);
  assert.equal(app.run('YearRecap.compute(2026)').streak.len, 3);
  assert.equal(app.run('YearRecap.compute(2025)').streak.len, 2);
});

test('rok: ukończone, rewatche, najwyżej ocenione i studia z danych dodatkowych', async () => {
  const app = await loadApp();
  const { Lib, run } = app;
  seed(app, [{ id: 1, days: [[at(2026, 4, 1), 12]] }, { id: 2, days: [[at(2026, 4, 2), 12]] }, { id: 3, days: [[at(2026, 4, 3), 2]] }]);
  run(`S.history.push(
    { id: 'f1', t: ${at(2026, 4, 1, 23)}, k: 'finish', m: 1, s: 0 },
    { id: 'f2', t: ${at(2026, 4, 2, 23)}, k: 'finish', m: 2, s: 1 },
    { id: 'f0', t: ${at(2025, 4, 2, 23)}, k: 'finish', m: 3, s: 0 })`);
  Lib.setScoreManual(1, 9);
  Lib.setScoreManual(2, 10);
  const extras = { 1: { studios: [{ id: 7, n: 'Madhouse' }] }, 2: { studios: [{ id: 7, n: 'Madhouse' }, { id: 8, n: 'Bones' }] }, 3: { missing: true } };
  const R = run(`YearRecap.compute(2026, { extras: ${JSON.stringify(extras)} })`);
  assert.equal(R.completed, 1);
  assert.equal(R.rewatched, 1);
  assert.equal(R.best.e.id, 2);
  assert.equal(R.studios[0].n, 'Madhouse');
  assert.equal(R.studios[0].c, 2);
  assert.equal(R.withX, 2);
});

test('rok: pusty rok nie wywraca obliczeń', async () => {
  const app = await loadApp();
  const R = app.run('YearRecap.compute(2019)');
  assert.equal(R.eps, 0);
  assert.equal(R.streak, null);
  assert.equal(R.recordMonth, null);
  assert.equal(R.change, null);
});

/* ---------- dziennik błędów ---------- */
test('dziennik: zapis, seria tego samego błędu jako jeden wpis, limit 50', async () => {
  const app = await loadApp();
  const { run } = app;
  run(`ErrLog.add(new TypeError('x is undefined'), { kind: 'view', where: 'ekran lista' })`);
  run(`ErrLog.add(new TypeError('x is undefined'), { kind: 'view', where: 'ekran lista' })`);
  let list = run('ErrLog.list()');
  assert.equal(list.length, 1);
  assert.equal(list[0].n, 2);
  assert.equal(list[0].msg, 'TypeError: x is undefined');
  for (let i = 0; i < 60; i++) run(`ErrLog.add('błąd ${i}', { silent: true })`);
  list = run('ErrLog.list()');
  assert.equal(list.length, 50);
  assert.equal(list[0].msg, 'błąd 59', 'najnowszy na początku');
  assert.ok(JSON.parse(app.localStorage.getItem('disboard.errlog.v1')).length === 50, 'leży w osobnym kluczu localStorage');
  assert.ok(!JSON.stringify(run('S')).includes('błąd 59'), 'nie trafia do listy (ani do kopii i synchronizacji)');
});

test('dziennik: raport z kontekstem, czyszczenie i cofnięcie', async () => {
  const app = await loadApp();
  const { run } = app;
  run(`(() => { const e = new Error('Nie działa zapis'); e.stack = 'Error: Nie działa zapis\\n    at save (js/db.js:10:5)'; ErrLog.add(e, { kind: 'save', where: 'zapis listy', silent: true }); })()`);
  const rep = run(`ErrLog.report({ Zapis: 'localStorage · pozycji: 0' })`);
  assert.match(rep, /Disboard — raport błędów/);
  assert.match(rep, /Zapis: localStorage · pozycji: 0/);
  assert.match(rep, /zapis · ekran .* · zapis listy/);
  assert.match(rep, /Nie działa zapis\n {4}at save \(js\/db\.js:10:5\)/);
  const keep = run('ErrLog.list()');
  run('ErrLog.clear()');
  assert.equal(run('ErrLog.list()').length, 0);
  run(`ErrLog.restore(${JSON.stringify(keep)})`);
  assert.equal(run('ErrLog.list()')[0].msg, 'Nie działa zapis');
});

// (dymek o błędzie → wpis „komunikat” sprawdza test w przeglądarce: tu toast jest atrapą)
