'use strict';
/* ==========================================================================
   Disboard — import i eksport
   JSON: pełna kopia (lista, sesje, historia, ustawienia)
   CSV:  średniki + BOM → poprawnie otwiera się w polskim Excelu
   XML:  format eksportu MyAnimeList (import na MAL/AniList)
   ========================================================================== */

const IO = (() => {
  const stamp = () => dayKey(Date.now());

  function exportJSON() {
    const payload = { app: 'disboard', format: 1, exportedAt: new Date().toISOString(), state: S };
    downloadFile(`disboard-kopia-${stamp()}.json`, JSON.stringify(payload, null, 1), 'application/json');
    S.meta.lastExportAt = Date.now();
    save();
  }

  const csvCell = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const CSV_COLS = [
    ['AniList ID', (e) => e.id],
    ['MAL ID', (e) => e.idMal || ''],
    ['Tytuł (romaji)', (e) => e.media.title.romaji || ''],
    ['Tytuł (angielski)', (e) => e.media.title.english || ''],
    ['Tytuł (japoński)', (e) => e.media.title.native || ''],
    ['Format', (e) => FORMAT_PL[e.media.format] || e.media.format || ''],
    ['Status', (e) => LSTATUS_PL[e.status]],
    ['Obejrzane odcinki (bieżące obejrzenie)', (e) => Lib.cur(e).progress],
    ['Liczba odcinków', (e) => e.media.episodes || ''],
    ['Liczba obejrzeń', (e) => Lib.finishedCount(e)],
    ['Obejrzane odcinki łącznie', (e) => Lib.totalEps(e)],
    ['Długość odcinka (min)', (e) => Lib.epDur(e) || ''],
    ['Czas oglądania (min)', (e) => Lib.entryMinutes(e)],
    ['Czas oglądania (godz.)', (e) => NF2.format(Lib.entryMinutes(e) / 60)],
    ['Ocena', (e) => (e.score == null ? '' : NF1.format(e.score))],
    ...RATE_CATS.map(([k, l]) => [`Ocena: ${l}`, (e) => (e.rating && e.rating[k] ? NF1.format(e.rating[k]) : '')]),
    ['Ulubione', (e) => (e.favorite ? 'tak' : '')],
    ['Tagi', (e) => e.tags.join(', ')],
    ['Rozpoczęto', (e) => toInputDate(e.sessions[0].startedAt)],
    ['Zakończono', (e) => toInputDate(e.sessions[0].finishedAt)],
    ['Dodano', (e) => toInputDate(e.addedAt)],
    ['Notatki', (e) => e.notes || ''],
  ];

  function exportCSV() {
    const rows = [CSV_COLS.map((c) => c[0])];
    for (const e of Object.values(S.entries).sort((a, b) => titleOf(a.media, 'romaji').localeCompare(titleOf(b.media, 'romaji')))) {
      rows.push(CSV_COLS.map((c) => c[1](e)));
    }
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
    downloadFile(`disboard-lista-${stamp()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  const MAL_STATUS = { watching: 'Watching', completed: 'Completed', paused: 'On-Hold', dropped: 'Dropped', planning: 'Plan to Watch' };
  const MAL_TYPE = { TV: 'TV', TV_SHORT: 'TV', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' };
  const cdata = (s) => `<![CDATA[${String(s || '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  const malDate = (ts) => (ts ? dayKey(ts) : '0000-00-00');

  function exportMAL() {
    const list = Object.values(S.entries);
    const ok = list.filter((e) => e.idMal);
    const skipped = list.length - ok.length;
    const counts = { watching: 0, completed: 0, paused: 0, dropped: 0, planning: 0 };
    ok.forEach((e) => { counts[e.status]++; });
    const body = ok.map((e) => {
      const first = e.sessions[0];
      const c = Lib.cur(e);
      const rewatching = Lib.isRewatch(e) && e.status === 'watching';
      const done = e.sessions.filter((s) => Lib.sessionDone(e, s)).length;
      const status = rewatching ? 'Completed' : MAL_STATUS[e.status];
      const watched = rewatching ? (e.media.episodes || first.progress) : c.progress;
      return `  <anime>
    <series_animedb_id>${e.idMal}</series_animedb_id>
    <series_title>${cdata(e.media.title.romaji || titleOf(e.media))}</series_title>
    <series_type>${MAL_TYPE[e.media.format] || 'Unknown'}</series_type>
    <series_episodes>${e.media.episodes || 0}</series_episodes>
    <my_id>0</my_id>
    <my_watched_episodes>${watched}</my_watched_episodes>
    <my_start_date>${malDate(first.startedAt)}</my_start_date>
    <my_finish_date>${malDate(first.finishedAt)}</my_finish_date>
    <my_rated></my_rated>
    <my_score>${e.score == null ? 0 : Math.round(e.score)}</my_score>
    <my_storage></my_storage>
    <my_storage_value>0.00</my_storage_value>
    <my_status>${status}</my_status>
    <my_comments>${cdata(e.notes)}</my_comments>
    <my_times_watched>${Math.max(0, done - 1)}</my_times_watched>
    <my_rewatch_value></my_rewatch_value>
    <my_priority>LOW</my_priority>
    <my_tags>${cdata(e.tags.join(', '))}</my_tags>
    <my_rewatching>${rewatching ? 1 : 0}</my_rewatching>
    <my_rewatching_ep>${rewatching ? c.progress : 0}</my_rewatching_ep>
    <my_discuss>1</my_discuss>
    <my_sns>default</my_sns>
    <update_on_import>1</update_on_import>
  </anime>`;
    }).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>disboard</user_name>
    <user_export_type>1</user_export_type>
    <user_total_anime>${ok.length}</user_total_anime>
    <user_total_watching>${counts.watching}</user_total_watching>
    <user_total_completed>${counts.completed}</user_total_completed>
    <user_total_onhold>${counts.paused}</user_total_onhold>
    <user_total_dropped>${counts.dropped}</user_total_dropped>
    <user_total_plantowatch>${counts.planning}</user_total_plantowatch>
  </myinfo>
${body}
</myanimelist>
`;
    downloadFile(`disboard-mal-${stamp()}.xml`, xml, 'application/xml');
    return { exported: ok.length, skipped };
  }

  /* ---------- import ---------- */
  async function importJSON(text, mode = 'merge') {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('To nie jest poprawny plik JSON.'); }
    const st = data && (data.state || (data.entries ? data : null));
    if (!st || typeof st.entries !== 'object') throw new Error('Plik nie wygląda na kopię z Disboard.');
    await maybeBackup(true);
    if (mode === 'replace') {
      replaceState(st);
      return { added: Object.keys(S.entries).length, skipped: 0, replaced: true };
    }
    const incoming = normalizeState(JSON.parse(JSON.stringify(st)));
    let skipped = 0;
    const addedIds = new Set();
    for (const [id, e] of Object.entries(incoming.entries)) {
      if (S.entries[id]) { skipped++; continue; }
      S.entries[id] = e;
      addedIds.add(Number(id));
    }
    const known = new Set(S.history.map((h) => h.id));
    for (const h of incoming.history) {
      if (!known.has(h.id) && addedIds.has(Number(h.m))) S.history.push(h);
    }
    S.history.sort((a, b) => a.t - b.t);
    // ulubione postacie: dopisujemy brakujące
    S.favChars = S.favChars || {};
    for (const [cid, c] of Object.entries(incoming.favChars || {})) if (!S.favChars[cid]) S.favChars[cid] = c;
    saveNow();
    emit('library', { kind: 'import' });
    return { added: addedIds.size, skipped };
  }

  const MAL_IN = { watching: 'watching', completed: 'completed', 'on-hold': 'paused', dropped: 'dropped', 'plan to watch': 'planning', 1: 'watching', 2: 'completed', 3: 'paused', 4: 'dropped', 6: 'planning' };
  const parseMalDate = (s) => (s && !/^0000/.test(s) ? fromInputDate(s) : null);

  async function importMAL(text, onProgress) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Nie udało się odczytać pliku XML.');
    const rows = [...doc.querySelectorAll('anime')].map((a) => {
      const g = (tag) => { const el = a.querySelector(tag); return el ? el.textContent.trim() : ''; };
      return {
        mal: Number(g('series_animedb_id')), title: g('series_title'),
        watched: Number(g('my_watched_episodes')) || 0,
        start: parseMalDate(g('my_start_date')), finish: parseMalDate(g('my_finish_date')),
        score: Number(g('my_score')) || null,
        status: MAL_IN[g('my_status').toLowerCase()] || 'planning',
        comments: g('my_comments'), times: Number(g('my_times_watched')) || 0,
        rewatching: g('my_rewatching') === '1', rewatchEp: Number(g('my_rewatching_ep')) || 0,
        tags: g('my_tags').split(',').map((t) => t.trim()).filter(Boolean),
      };
    }).filter((r) => r.mal);
    if (!rows.length) throw new Error('W pliku nie ma żadnych anime.');
    const todo = rows.filter((r) => !Object.values(S.entries).some((e) => e.idMal === r.mal));
    if (onProgress) onProgress(`Szukam ${todo.length} tytułów w AniList…`);
    const media = await Ani.byMalIds(todo.map((r) => r.mal));
    const byMal = new Map(media.map((m) => [m.idMal, m]));
    await maybeBackup(true);
    let added = 0;
    const missing = [];
    for (const r of todo) {
      const m = byMal.get(r.mal);
      if (!m) { missing.push(r.title || `MAL #${r.mal}`); continue; }
      buildEntry(m, r);
      added++;
    }
    S.history.sort((a, b) => a.t - b.t);
    saveNow();
    emit('library', { kind: 'import' });
    return { added, skipped: rows.length - todo.length, missing };
  }

  // wpis z danych importu; historia odcinków tylko tam, gdzie znamy datę zakończenia
  function buildEntry(m, r) {
    const snap = Lib.snapshot(m);
    const total = snap.episodes || null;
    const ti = snap.title.romaji || titleOf(snap);
    const sessions = [];
    const completedOnce = r.status === 'completed' || r.rewatching || r.times > 0;
    const firstProgress = completedOnce ? (total || r.watched) : r.watched;
    sessions.push({ n: 0, startedAt: r.start, finishedAt: completedOnce ? (r.finish || null) : null, progress: firstProgress, done: completedOnce || undefined, nodate: (completedOnce && !r.finish) || undefined });
    for (let i = 0; i < r.times; i++) sessions.push({ n: sessions.length, startedAt: null, finishedAt: null, progress: total || r.watched, past: true, done: true });
    if (r.rewatching) sessions.push({ n: sessions.length, startedAt: null, finishedAt: null, progress: r.rewatchEp });
    const e = {
      id: m.id, idMal: m.idMal, status: r.rewatching ? 'watching' : r.status,
      score: r.score, notes: r.comments || '', favorite: false, tags: r.tags,
      durationOverride: null, addedAt: Date.now(), updatedAt: Date.now(), mediaFetchedAt: Date.now(),
      lastAiredNotified: Lib.airedEpisodes(snap), sessions, media: snap,
    };
    S.entries[m.id] = e;
    S.history.push({ id: uid(), t: Date.now(), k: 'import', m: m.id, ti, src: r.src || 'MAL' });
    if (r.finish && sessions[0].finishedAt) {
      for (let ep = 1; ep <= sessions[0].progress; ep++) S.history.push({ id: uid(), t: r.finish, k: 'ep', m: m.id, s: 0, ep, bulk: true, past: true, ti });
    }
  }

  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }

  async function importCSV(text, onProgress) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('Plik CSV jest pusty.');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => head.findIndex((h) => names.some((n) => h === n.toLowerCase()));
    const iId = col('AniList ID', 'anilist_id', 'id');
    const iMal = col('MAL ID', 'mal_id');
    if (iId < 0 && iMal < 0) throw new Error('Brak kolumny „AniList ID” ani „MAL ID”.');
    const iStatus = col('Status'), iProg = col('Obejrzane odcinki (bieżące obejrzenie)', 'progress');
    const iScore = col('Ocena', 'score'), iNotes = col('Notatki', 'notes'), iTags = col('Tagi', 'tags');
    const iStart = col('Rozpoczęto', 'started'), iEnd = col('Zakończono', 'finished'), iTimes = col('Liczba obejrzeń');
    const iFav = col('Ulubione'), iDur = col('Długość odcinka (min)');
    const iCats = RATE_CATS.map(([k, l]) => [k, col(`Ocena: ${l}`, `rating_${k}`)]).filter(([, i]) => i >= 0);
    const num = (v) => { const n = Number(String(v || '').replace(',', '.')); return n > 0 ? Math.min(10, Math.round(n * 2) / 2) : null; };
    const statusIn = Object.fromEntries(Object.entries(LSTATUS_PL).map(([k, v]) => [v.toLowerCase(), k]));
    const recs = rows.slice(1).map((r) => ({
      id: iId >= 0 ? Number(r[iId]) : null, mal: iMal >= 0 ? Number(r[iMal]) : null,
      status: statusIn[(r[iStatus] || '').trim().toLowerCase()] || MAL_IN[(r[iStatus] || '').trim().toLowerCase()] || 'planning',
      watched: Number(r[iProg]) || 0,
      score: iScore >= 0 && r[iScore] ? Number(String(r[iScore]).replace(',', '.')) : null,
      comments: iNotes >= 0 ? r[iNotes] : '', tags: iTags >= 0 ? String(r[iTags] || '').split(',').map((t) => t.trim()).filter(Boolean) : [],
      start: iStart >= 0 ? fromInputDate(r[iStart]) : null, finish: iEnd >= 0 ? fromInputDate(r[iEnd]) : null,
      times: iTimes >= 0 ? Math.max(0, (Number(r[iTimes]) || 0) - 1) : 0,
      fav: iFav >= 0 && /^(tak|yes|1|true)$/i.test(String(r[iFav]).trim()),
      dur: iDur >= 0 ? Number(r[iDur]) || null : null,
      rating: Object.fromEntries(iCats.map(([k, i]) => [k, num(r[i])]).filter(([, v]) => v)),
      src: 'CSV',
    })).filter((r) => r.id || r.mal);
    const todo = recs.filter((r) => !(r.id && S.entries[r.id]) && !(r.mal && Object.values(S.entries).some((e) => e.idMal === r.mal)));
    if (onProgress) onProgress(`Pobieram dane ${todo.length} tytułów z AniList…`);
    const withId = todo.filter((r) => r.id), withMal = todo.filter((r) => !r.id && r.mal);
    const a = withId.length ? (await Ani.byIds(withId.map((r) => r.id))).media : [];
    const b = withMal.length ? await Ani.byMalIds(withMal.map((r) => r.mal)) : [];
    const byId = new Map(a.map((m) => [m.id, m])), byMal = new Map(b.map((m) => [m.idMal, m]));
    await maybeBackup(true);
    let added = 0;
    const missing = [];
    for (const r of todo) {
      const m = r.id ? byId.get(r.id) : byMal.get(r.mal);
      if (!m) { missing.push(r.id ? `AniList #${r.id}` : `MAL #${r.mal}`); continue; }
      buildEntry(m, { ...r, rewatching: false, rewatchEp: 0 });
      if (r.fav) S.entries[m.id].favorite = true;
      if (r.dur && !m.duration) S.entries[m.id].durationOverride = r.dur;
      if (Object.keys(r.rating).length) {
        const e = S.entries[m.id];
        e.rating = r.rating;
        const mean = Lib.ratingMean(e);
        if (e.score == null) e.score = Math.round(mean * 10) / 10;
        else e.scoreManual = e.score !== Math.round(mean * 10) / 10;
      }
      added++;
    }
    S.history.sort((x, y) => x.t - y.t);
    saveNow();
    emit('library', { kind: 'import' });
    return { added, skipped: recs.length - todo.length, missing };
  }

  return { exportJSON, exportCSV, exportMAL, importJSON, importMAL, importCSV, parseCSV };
})();
