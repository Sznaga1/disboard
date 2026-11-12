/* Spójność plików: tryb offline (sw.js) musi znać każdy skrypt z index.html,
   a każdy plik z jego listy musi istnieć — inaczej instalacja trybu offline
   po cichu się nie uda. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const shell = () => JSON.parse(read('sw.js').match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));

test('każdy plik z listy trybu offline istnieje', () => {
  const missing = shell().filter((f) => f !== './' && !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(missing, []);
});

test('tryb offline zna każdy skrypt i arkusz z index.html', () => {
  const html = read('index.html');
  const used = [...html.matchAll(/<script src="([^"]+)"/g), ...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map((m) => m[1]);
  const list = shell();
  assert.deepEqual(used.filter((f) => !list.includes(f)), []);
});

test('ikony z manifestu są w trybie offline', () => {
  const icons = JSON.parse(read('manifest.webmanifest')).icons.map((i) => i.src);
  const list = shell();
  assert.deepEqual(icons.filter((f) => !list.includes(f)), []);
});
