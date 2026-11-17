/* Centrum Lulu: zbieranie danych (tools/build-lulu.mjs) — daty pierwszego wykrycia,
   przejście z PBE do gry, wybór fragmentów o Lulu z notatek do patchy.
   Bez sieci: wszystko na danych przykładowych. Uruchomienie: node --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCat, luluMentions, extractEmotes, extractChromas, imgPath } from '../tools/build-lulu.mjs';

const NOW = '2026-11-17T12:00:00.000Z';
const LATER = '2026-12-01T12:00:00.000Z';

test('pierwszy przebieg: wszystko, co już jest, nie jest „nowe”', () => {
  const r = mergeCat([{ id: 1 }], [{ id: 1 }, { id: 2 }], null, NOW, true);
  assert.deepEqual(r.map((x) => [x.id, x.where, x.first]), [[1, 'live', null], [2, 'pbe', null]]);
});

test('nowa rzecz dostaje datę wykrycia, stara ją zachowuje', () => {
  const prev = [{ id: 1, where: 'live', first: null }];
  const r = mergeCat([{ id: 1 }, { id: 3 }], [{ id: 1 }, { id: 3 }], prev, NOW, false);
  assert.equal(r.find((x) => x.id === 1).first, null);
  assert.equal(r.find((x) => x.id === 3).first, NOW);
});

test('z PBE do gry: zostaje data z PBE i dochodzi data wejścia do gry', () => {
  const first = mergeCat([], [{ id: 5 }], [], NOW, false);
  assert.equal(first[0].where, 'pbe');
  const second = mergeCat([{ id: 5 }], [{ id: 5 }], first, LATER, false);
  assert.deepEqual([second[0].where, second[0].first, second[0].liveAt], ['live', NOW, LATER]);
  const third = mergeCat([{ id: 5 }], [{ id: 5 }], second, '2027-01-01T00:00:00.000Z', false);
  assert.equal(third[0].liveAt, LATER, 'data wejścia do gry się nie przesuwa');
});

test('źródło nie odpowiedziało: rzeczy znane wcześniej nie znikają', () => {
  const prev = [{ id: 7, where: 'live', first: null }, { id: 8, where: 'pbe', first: NOW }];
  const r = mergeCat(null, [{ id: 8 }], prev, LATER, false);
  assert.deepEqual(r.map((x) => x.id).sort(), [7, 8]);
});

test('emotki: wszystkie z gry, Lulu po tagu postaci albo nazwie; bez szablonów', () => {
  const r = extractEmotes({ emotes: [
    { id: 0, name: '', inventoryIcon: '/lol-game-data/assets/ASSETS/Templates/Emote_FPO_Inventory.png' },
    { id: 10, name: 'Delightify', description: '', taggedChampionsIds: [117], inventoryIcon: '/lol-game-data/assets/ASSETS/Loadouts/A.png' },
    { id: 11, name: 'Lulu Waves', inventoryIcon: '/lol-game-data/assets/ASSETS/B.png' },
    { id: 12, name: 'Poro Love', taggedChampionsIds: [1], inventoryIcon: '/lol-game-data/assets/ASSETS/C.png' },
  ] });
  assert.deepEqual(r.map((e) => [e.id, e.lulu]), [[10, true], [11, true], [12, false]]);
  assert.equal(r[0].img, 'assets/loadouts/a.png');
});

test('chromy liczone osobno, z numerem skina', () => {
  const r = extractChromas({ champ: { skins: [{ id: 117001, chromas: [{ id: 117002, name: 'X', colors: ['#fff', '#000', '#111'], chromaPath: '/lol-game-data/assets/v1/c/117002.png' }] }, { id: 117003 }] } });
  assert.deepEqual(r, [{ id: 117002, skin: 117001, name: 'X', colors: ['#fff', '#000'], img: 'v1/c/117002.png', desc: null }]);
  assert.equal(imgPath(null), null);
});

test('notatki do patchy: blok zmian Lulu w całości, z innych tylko zdania z jej imieniem', () => {
  const body = '<h2>Champions</h2><p><strong>Kayn</strong></p><ul><li>nerf</li></ul><hr class="divider">'
    + '<p><strong>Lulu</strong></p><h4 class="ability-title"><img src="x.png">Q - Glitterlance</h4><ul><li><strong>Damage</strong>: 1 ⇒ <strong>2</strong></li></ul><hr>'
    + '<h2>Bugfixes</h2><ul><li>Fixed Lulu’s Pix vanishing.</li><li>Fixed Teemo.</li></ul>'
    + '<h3>Skins</h3><p>Faerie Court Lulu will be available soon.</p><p>Lulumancer is not her.</p>';
  const m = luluMentions(body);
  assert.deepEqual(m, [
    { section: 'Champions', kind: 'balance', lines: ['Q - Glitterlance', '• Damage: 1 ⇒ 2'] },
    { section: 'Bugfixes', kind: 'mention', lines: ['• Fixed Lulu’s Pix vanishing.'] },
    { section: 'Skins', kind: 'mention', lines: ['Faerie Court Lulu will be available soon.'] },
  ]);
});
