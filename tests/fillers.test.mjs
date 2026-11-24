/* Baza fillerów (tools/build-fillers.mjs): odczyt strony odcinków MyAnimeList.
   Bez sieci: fragment HTML w takim kształcie, jaki MAL wysyła (listopad 2026).
   Uruchomienie: node --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEpisodes, toRanges } from '../tools/build-fillers.mjs';

const row = (n, type, score) => `<tr class="episode-list-data">
          <td class="episode-number nowrap" data-raw="${n}">${n}</td>
          <td class="episode-video nowrap"><a href="https://myanimelist.net/anime/21/One_Piece/episode/${n}" class="mal-icon"><i class="malicon"></i></a></td>
          <td class="episode-title fs12">${type ? `<span class="fl-r di-ib pr4 icon-episode-type-bg">${type}</span>` : ''}<a href="https://myanimelist.net/anime/21/One_Piece/episode/${n}" class="fl-l fw-b ">Tytuł ${n}</a>
          </td>
          <td class="episode-aired nowrap">Feb 24, 2002</td><td  class="episode-poll ac nowrap${score ? ' scored' : ''}" style="background-size: 80% 3px;" data-raw="${score || ''}" >
              <div class="average">average <span class="value">${score || ''}</span></div></td>
            <td class="episode-forum ac nowrap" data-raw="57"></td></tr>`;
const pager = (offs) => `<div class="pagination ac">${offs.map((o) => `<a class="link" href="https://myanimelist.net/anime/21/One_Piece/episode?offset=${o}">x</a>`).join('')}</div>`;
const page = (rows, offs = []) => `<html><head><meta property="og:title" content="One Piece"></head><body><table>${rows.join('')}</table>${pager(offs)}</body></html>`;

test('fillery, recapy i oceny z wierszy tabeli', () => {
  const r = parseEpisodes(page([row(101, '', '4.00'), row(102, 'Filler', '4.08'), row(103, 'Recap', null)]));
  assert.deepEqual(r.rows, [
    { n: 101, filler: false, recap: false, score: 4 },
    { n: 102, filler: true, recap: false, score: 4.08 },
    { n: 103, filler: false, recap: true, score: null },
  ]);
  assert.equal(r.title, 'One Piece');
});

test('następna strona: z paska stron, także na pierwszej (bez rel="next")', () => {
  assert.equal(parseEpisodes(page([row(1)], [0, 100, 200, 1100]), 0).hasNext, true);
  assert.equal(parseEpisodes(page([row(1101)], [900, 1000, 1100]), 1100).hasNext, false);
  assert.equal(parseEpisodes(page([row(1)]), 0).hasNext, false, 'jedna strona: bez paska');
});

test('strona bez odcinków nie psuje odczytu', () => {
  const r = parseEpisodes('<html><meta property="og:title" content="Film"><p>No episode information has been added.</p></html>');
  assert.deepEqual(r.rows, []);
  assert.equal(r.hasNext, false);
});

test('zakresy odcinków', () => {
  assert.deepEqual(toRanges([5, 1, 2, 3, 9, 10, 2]), [[1, 3], [5, 5], [9, 10]]);
  assert.deepEqual(toRanges([]), []);
});
