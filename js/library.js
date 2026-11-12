'use strict';
/* ==========================================================================
   Disboard — logika trackera: lista, sesje oglądania (rewatche), historia,
   czas oglądania, statystyki, odświeżanie danych i powiadomienia.
   ========================================================================== */

const Lib = (() => {
  const now = () => Date.now();

  /* ---------- migawka danych z API trzymana przy wpisie (działa offline) ---------- */
  function snapshot(m) {
    if (!m) return null;
    return {
      id: m.id, idMal: m.idMal ?? null,
      title: m.title || {}, synonyms: m.synonyms || [],
      coverImage: m.coverImage || {}, bannerImage: m.bannerImage || null,
      format: m.format || null, status: m.status || null,
      episodes: m.episodes ?? null, duration: m.duration ?? null,
      season: m.season || null, seasonYear: m.seasonYear || null,
      startDate: m.startDate || null, endDate: m.endDate || null,
      nextAiringEpisode: m.nextAiringEpisode || null,
      genres: m.genres || [], averageScore: m.averageScore ?? null, popularity: m.popularity ?? null,
      isAdult: !!m.isAdult,
      siteUrl: m.siteUrl || `https://anilist.co/anime/${m.id}`,
      updatedAt: m.updatedAt || null,
    };
  }

  const get = (id) => S.entries[id] || null;
  const cur = (e) => e.sessions[e.sessions.length - 1];
  const epDur = (e) => Number(e.durationOverride) || (e.media && e.media.duration) || null;
  const totalEps = (e) => e.sessions.reduce((a, s) => a + (s.progress || 0), 0);
  const entryMinutes = (e) => { const d = epDur(e); return d ? totalEps(e) * d : 0; };
  // ukończone obejrzenie: z datą, bez daty (done) albo po pełnej liczbie odcinków
  const sessionDone = (e, s) => !!(s.finishedAt || s.done || (e.media.episodes && s.progress >= e.media.episodes));
  const finishedCount = (e) => e.sessions.filter((s) => sessionDone(e, s)).length;
  const isRewatch = (e) => cur(e).n > 0;
  const epTotal = (e) => e.media.episodes || null;
  // tryb uzupełniania: wszystko, co teraz oznaczysz, zapisuje się bez daty
  const backfill = () => !!S.settings.backfill;

  function airedEpisodes(m) {
    if (!m) return null;
    if (m.nextAiringEpisode && m.nextAiringEpisode.episode) {
      const n = m.nextAiringEpisode;
      if (n.airingAt * 1000 <= now()) return n.episode; // już wyemitowany, czekamy na odświeżenie
      return n.episode - 1;
    }
    if (m.status === 'FINISHED') return m.episodes || null;
    if (m.status === 'NOT_YET_RELEASED') return 0;
    return null;
  }

  function event(ev) {
    const e = S.entries[ev.m];
    S.history.push({ id: uid(), t: now(), ti: e ? titleOf(e.media, 'romaji') : ev.ti, ...ev });
  }

  function touch(e) { e.updatedAt = now(); save(); emit('library', { id: e.id }); }

  // początek i koniec obejrzenia: z datą albo, w trybie uzupełniania, bez daty
  function markStarted(e, s, t, { silent = false, nodate = backfill() } = {}) {
    if (s.startedAt || s.nodate) return;
    if (nodate) { s.nodate = true; return; }
    s.startedAt = t;
    if (!silent) event({ k: 'start', m: e.id, s: s.n });
  }
  function markFinished(e, s, t, { nodate = backfill() } = {}) {
    if (s.finishedAt || s.done) return false;
    s.done = true;
    if (nodate) s.nodate = true;
    else { s.finishedAt = t; event({ k: 'finish', m: e.id, s: s.n }); }
    return true;
  }
  function unmarkFinished(s) { s.finishedAt = null; s.done = false; }

  // jeden wpis w historii zamiast dziesiątek odcinków z dzisiejszą datą
  function logBackfill(e, s, from, to, { rewatch = false } = {}) {
    const last = S.history[S.history.length - 1];
    if (!rewatch && last && last.k === 'backfill' && last.m === e.id && last.s === s.n && !last.rw && last.to + 1 === from) {
      last.to = to;
      last.t = now();
      return;
    }
    S.history.push({ id: uid(), t: now(), k: 'backfill', m: e.id, s: s.n, from, to, rw: rewatch || undefined, ti: titleOf(e.media, 'romaji') });
  }

  /* ---------- odcinki jako zakresy ----------
     s.ranges: [[od, do], ...] posortowane i rozłączne; brak = odcinki 1..progress.
     s.progress zawsze = liczba obejrzanych odcinków tej sesji, więc czas i statystyki
     liczą tylko to, co faktycznie zaznaczone (np. 20 ostatnich odcinków DBZ). */
  const rangesOf = (s) => (s.ranges && s.ranges.length ? s.ranges : (s.progress ? [[1, s.progress]] : []));
  function normRanges(list) {
    const r = list.filter(([a, b]) => b >= a && a >= 1).map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [a, b] of r) { const l = out[out.length - 1]; if (l && a <= l[1] + 1) l[1] = Math.max(l[1], b); else out.push([a, b]); }
    return out;
  }
  const countRanges = (r) => r.reduce((n, [a, b]) => n + b - a + 1, 0);
  const lastEpOf = (s) => { const r = rangesOf(s); return r.length ? r[r.length - 1][1] : 0; };
  const hasEp = (s, n) => rangesOf(s).some(([a, b]) => n >= a && n <= b);
  function subtractRange(r, from, to) {
    const out = [];
    for (const [a, b] of r) {
      if (b < from || a > to) { out.push([a, b]); continue; }
      if (a < from) out.push([a, from - 1]);
      if (b > to) out.push([to + 1, b]);
    }
    return out;
  }
  function applyRanges(s, list) {
    const r = normRanges(list);
    if (!r.length) { delete s.ranges; s.progress = 0; }
    else if (r.length === 1 && r[0][0] === 1) { delete s.ranges; s.progress = r[0][1]; }
    else { s.ranges = r; s.progress = countRanges(r); }
  }
  const rangesText = (s) => rangesOf(s).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
  // wpisy trybu uzupełniania (od–do) przycinamy do odznaczonego zakresu
  function trimBackfill(id, sn, from, to) {
    const out = [];
    for (const h of S.history) {
      if (h.k !== 'backfill' || h.m !== id || h.s !== sn || h.rw || h.to < from || h.from > to) { out.push(h); continue; }
      if (h.from < from) out.push({ ...h, to: from - 1 });
      if (h.to > to) out.push({ ...h, id: uid(), from: to + 1 });
    }
    S.history = out;
  }

  // zaznacz albo odznacz dowolne odcinki bieżącego obejrzenia (np. 272–291)
  function setEpisodes(id, from, to, watched, { nodate = backfill(), quiet = false } = {}) {
    const e = get(id);
    if (!e) return 0;
    const s = cur(e);
    const total = epTotal(e);
    from = Math.max(1, Math.floor(from));
    to = Math.floor(to);
    if (total) to = Math.min(to, total);
    if (!(to >= from)) return 0;
    const before = rangesOf(s).map((x) => x.slice());
    const t = now();
    const ti = titleOf(e.media, 'romaji');
    let changed;
    if (watched) {
      let add = [[from, to]];
      for (const [a, b] of before) add = subtractRange(add, a, b);
      changed = countRanges(add);
      if (!changed) return 0;
      applyRanges(s, [...before, [from, to]]);
      if (nodate) add.forEach(([a, b]) => logBackfill(e, s, a, b));
      else add.forEach(([a, b]) => { for (let ep = a; ep <= b; ep++) S.history.push({ id: uid(), t, k: 'ep', m: id, s: s.n, ep, bulk: changed > 1, ti }); });
      markStarted(e, s, t, { nodate });
      if (s.progress > 0 && (e.status === 'planning' || e.status === 'paused' || e.status === 'dropped')) {
        event({ k: 'status', m: id, from: e.status, to: 'watching', s: s.n });
        e.status = 'watching';
      }
      if (total && s.progress >= total) {
        if (markFinished(e, s, t, { nodate }) && !quiet) toast(`Ukończono: ${titleOf(e.media)}${s.n ? ` (rewatch #${s.n})` : ''}${nodate ? ' · bez daty' : ''}`, { kind: 'ok' });
        if (e.status !== 'completed') { event({ k: 'status', m: id, from: e.status, to: 'completed', s: s.n }); e.status = 'completed'; }
      }
    } else {
      const after = subtractRange(before, from, to);
      changed = countRanges(before) - countRanges(after);
      if (!changed) return 0;
      applyRanges(s, after);
      S.history = S.history.filter((h) => !(h.k === 'ep' && h.m === id && h.s === s.n && h.ep >= from && h.ep <= to));
      trimBackfill(id, s.n, from, to);
      if (total && s.progress < total && (s.finishedAt || s.done)) {
        unmarkFinished(s);
        if (e.status === 'completed') e.status = 'watching';
      }
    }
    touch(e);
    return changed;
  }

  /* ---------- operacje na liście ---------- */
  function add(media, status = 'planning') {
    if (!media || !media.id) return null;
    if (S.entries[media.id]) { setStatus(media.id, status); return S.entries[media.id]; }
    const snap = snapshot(media);
    const e = {
      id: media.id, idMal: media.idMal ?? null, status: 'planning',
      score: null, notes: '', favorite: false, tags: [], durationOverride: null,
      addedAt: now(), updatedAt: now(), mediaFetchedAt: now(),
      lastAiredNotified: airedEpisodes(snap),
      sessions: [{ n: 0, startedAt: null, finishedAt: null, progress: 0 }],
      media: snap,
    };
    S.entries[media.id] = e;
    event({ k: 'add', m: media.id, to: status });
    if (status !== 'planning') setStatus(media.id, status, { silentEvent: true });
    touch(e);
    return e;
  }

  function remove(id) {
    const e = S.entries[id];
    if (!e) return null;
    const snap = JSON.parse(JSON.stringify(e));
    delete S.entries[id];
    S.history.push({ id: uid(), t: now(), k: 'remove', m: id, ti: titleOf(e.media, 'romaji') });
    save();
    emit('library', { id, removed: true });
    return snap;
  }
  function restore(entry) {
    S.entries[entry.id] = entry;
    S.history = S.history.filter((h) => !(h.k === 'remove' && h.m === entry.id && now() - h.t < 120000));
    touch(entry);
  }

  function setStatus(id, status, { silentEvent = false } = {}) {
    const e = get(id);
    if (!e || !LIST_STATUSES.includes(status)) return;
    const from = e.status;
    if (from === status) return;
    const s = cur(e);
    if (!silentEvent) event({ k: 'status', m: id, from, to: status, s: s.n });
    if (status === 'completed') {
      const total = epTotal(e);
      e.status = 'completed';
      // przy wybranych odcinkach (np. pominięte fillery) nie dopisujemy reszty
      if (total && s.progress < total && !s.ranges) {
        setProgress(id, total, { fromStatus: true });
        return;
      }
      markStarted(e, s, now(), { silent: true });
      markFinished(e, s, now());
    } else {
      e.status = status;
      if (status === 'watching') markStarted(e, s, now());
      if ((s.finishedAt || s.done) && epTotal(e) && s.progress < epTotal(e)) unmarkFinished(s);
    }
    touch(e);
  }

  function setProgress(id, n, { fromStatus = false } = {}) {
    const e = get(id);
    if (!e) return;
    const s = cur(e);
    const total = epTotal(e);
    n = Math.max(0, Math.floor(Number(n) || 0));
    if (total) n = Math.min(n, total);
    if (s.ranges) {
      // wpisana liczba przy wybranych odcinkach = „obejrzane 1..n”
      const last = lastEpOf(s);
      if (n > 0) setEpisodes(id, 1, n, true, { quiet: fromStatus });
      if (last > n) setEpisodes(id, n + 1, last, false);
      return;
    }
    const old = s.progress;
    if (n === old && !fromStatus) return;
    const t = now();
    if (n > old) {
      if (backfill()) logBackfill(e, s, old + 1, n);
      else {
        const bulk = n - old > 1;
        for (let ep = old + 1; ep <= n; ep++) S.history.push({ id: uid(), t, k: 'ep', m: id, s: s.n, ep, bulk, ti: titleOf(e.media, 'romaji') });
      }
      markStarted(e, s, t);
    } else if (n < old) {
      S.history = S.history.filter((h) => !(h.k === 'ep' && h.m === id && h.s === s.n && h.ep > n));
      // wpisy trybu uzupełniania przycinamy do nowego postępu
      S.history = S.history.filter((h) => {
        if (h.k !== 'backfill' || h.m !== id || h.s !== s.n || h.rw) return true;
        if (h.to > n) h.to = n;
        return h.to >= h.from;
      });
    }
    s.progress = n;
    if (n > 0 && (e.status === 'planning' || e.status === 'paused' || e.status === 'dropped')) {
      event({ k: 'status', m: id, from: e.status, to: 'watching', s: s.n });
      e.status = 'watching';
    }
    if (total && n >= total) {
      if (markFinished(e, s, t) && !fromStatus) {
        toast(`Ukończono: ${titleOf(e.media)}${s.n ? ` (rewatch #${s.n})` : ''}${backfill() ? ' · bez daty' : ''}`, { kind: 'ok' });
      }
      if (e.status !== 'completed') {
        if (!fromStatus) event({ k: 'status', m: id, from: e.status, to: 'completed', s: s.n });
        e.status = 'completed';
      }
    } else if (total && n < total) {
      if (s.finishedAt || s.done) unmarkFinished(s);
      if (e.status === 'completed') e.status = 'watching';
    }
    touch(e);
  }

  // plusik: następny odcinek po ostatnim obejrzanym; w trybie pomijania przeskakuje fillery i recapy
  function increment(id, d = 1) {
    const e = get(id);
    if (!e) return;
    const s = cur(e);
    if (d < 0) {
      if (!s.ranges) { setProgress(id, s.progress + d); return; }
      const last = lastEpOf(s);
      if (last) setEpisodes(id, last, last, false);
      return;
    }
    const total = epTotal(e);
    let next = lastEpOf(s) + 1;
    const skip = S.settings.skipFiller && typeof Episodes !== 'undefined' ? Episodes.skipSet(e) : null;
    const from = next;
    if (skip) while (skip.has(next) && (!total || next < total)) next++;
    if (total && next > total) return;
    const skipped = next - from;
    if (!s.ranges && !skipped) { setProgress(id, next); return; }
    setEpisodes(id, next, next, true);
    if (skipped) toast(`Pominięto ${nUnit(skipped, 'episode')} (filler lub recap): ${skipped > 1 ? `${from}–${next - 1}` : from} · teraz odc. ${next}`, { kind: 'ok', ms: 3500 });
    // koniec serii mimo pominiętych fillerów
    if (skip && total && next === total && s.progress < total) {
      let onlySkipped = true;
      for (let ep = 1; ep <= total && onlySkipped; ep++) if (!hasEp(s, ep) && !skip.has(ep)) onlySkipped = false;
      if (onlySkipped) {
        if (markFinished(e, s, now())) toast(`Ukończono: ${titleOf(e.media)} (bez fillerów)`, { kind: 'ok' });
        if (e.status !== 'completed') { event({ k: 'status', m: id, from: e.status, to: 'completed', s: s.n }); e.status = 'completed'; }
        touch(e);
      }
    }
  }

  function startRewatch(id) {
    const e = get(id);
    if (!e) return;
    const n = e.sessions.length;
    const bf = backfill();
    const s = { n, startedAt: bf ? null : now(), finishedAt: null, progress: 0 };
    if (bf) s.nodate = true;
    e.sessions.push(s);
    if (bf) logBackfill(e, s, 0, 0, { rewatch: true });
    else event({ k: 'rewatch', m: id, s: n });
    e.status = 'watching';
    touch(e);
    toast(bf ? `Dopisujesz rewatch #${n} bez daty: ${titleOf(e.media)}` : `Rozpoczęto rewatch #${n}: ${titleOf(e.media)}`, { kind: 'ok' });
  }

  function cancelRewatch(id) {
    const e = get(id);
    if (!e || e.sessions.length < 2) return;
    const s = cur(e);
    S.history = S.history.filter((h) => !(h.m === id && h.s === s.n && (h.k === 'ep' || h.k === 'rewatch' || h.k === 'backfill')));
    e.sessions.pop();
    e.status = 'completed';
    touch(e);
  }

  // Obejrzenie sprzed korzystania z aplikacji. Trafia na początek, więc staje się
  // „pierwszym obejrzeniem”, a dotychczasowe sesje przesuwają się o jeden numer.
  function addPastWatch(id, { startedAt = null, finishedAt = null } = {}) {
    const e = get(id);
    if (!e) return;
    const total = epTotal(e) || Math.max(1, ...e.sessions.map((s) => s.progress || 0));
    S.history.forEach((h) => { if (h.m === id && typeof h.s === 'number') h.s += 1; });
    e.sessions.unshift({ n: 0, startedAt, finishedAt: finishedAt || null, progress: total, past: true, done: true });
    const last = cur(e);
    if (e.sessions.length > 1 && last.progress === 0 && !last.startedAt && e.status !== 'watching') {
      e.sessions.pop();
      e.status = 'completed';
    }
    e.sessions.forEach((x, i) => { x.n = i; });
    const ti = titleOf(e.media, 'romaji');
    if (finishedAt) {
      for (let ep = 1; ep <= total; ep++) S.history.push({ id: uid(), t: finishedAt, k: 'ep', m: id, s: 0, ep, bulk: true, past: true, ti });
    }
    S.history.push({ id: uid(), t: now(), k: 'past', m: id, s: 0, at: finishedAt, ti });
    touch(e);
  }

  function removeSession(id, n) {
    const e = get(id);
    if (!e || e.sessions.length < 2) return;
    S.history = S.history.filter((h) => !(h.m === id && h.s === n));
    S.history.forEach((h) => { if (h.m === id && h.s > n) h.s -= 1; });
    e.sessions.splice(n, 1);
    e.sessions.forEach((x, i) => { x.n = i; });
    touch(e);
  }

  function updateSession(id, n, patch) {
    const e = get(id);
    if (!e || !e.sessions[n]) return;
    Object.assign(e.sessions[n], patch);
    touch(e);
  }

  /* ---------- oceny szczegółowe ---------- */
  // Ocena ogólna = średnia z ocenionych kategorii, chyba że wpiszesz ją ręcznie.
  function ratingMean(e) {
    const r = (e && e.rating) || {};
    const v = RATE_CATS.map(([k]) => r[k]).filter((x) => x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  const ratedCount = (e) => RATE_CATS.filter(([k]) => e.rating && e.rating[k] > 0).length;
  function applyAuto(e) {
    if (e.scoreManual) return;
    const m = ratingMean(e);
    if (m == null) return;
    const next = Math.round(m * 10) / 10;
    if (next !== e.score) { e.score = next; event({ k: 'score', m: e.id, to: next }); }
  }
  function setRating(id, cat, val) {
    const e = get(id);
    if (!e || !RATE_CATS.some(([k]) => k === cat)) return;
    e.rating = { ...(e.rating || {}) };
    if (val > 0) e.rating[cat] = Math.min(10, Math.round(val * 2) / 2); else delete e.rating[cat];
    applyAuto(e);
    touch(e);
  }
  function setScoreManual(id, v) {
    const e = get(id);
    if (!e) return;
    e.score = v;
    e.scoreManual = v != null && ratedCount(e) > 0;
    event({ k: 'score', m: id, to: v });
    touch(e);
  }
  function setScoreAuto(id) {
    const e = get(id);
    if (!e) return;
    e.scoreManual = false;
    applyAuto(e);
    touch(e);
  }

  /* ---------- ulubione postacie ---------- */
  function toggleFavChar(c, media) {
    S.favChars = S.favChars || {};
    if (S.favChars[c.id]) delete S.favChars[c.id];
    else S.favChars[c.id] = { id: c.id, n: c.n, img: c.img || null, va: c.va || null, mid: media ? media.id : null, mt: media ? titleOf(media, 'romaji') : '', t: now() };
    save();
    emit('favchars', { id: c.id });
    return !!S.favChars[c.id];
  }

  function setField(id, field, value) {
    const e = get(id);
    if (!e) return;
    e[field] = value;
    if (field === 'score') event({ k: 'score', m: id, to: value });
    if (field === 'favorite') event({ k: 'fav', m: id, to: value });
    touch(e);
  }

  function updateMedia(media) {
    const e = get(media && media.id);
    if (!e) return;
    applyMediaUpdate(e, media);
    save();
    emit('library', { id: e.id, media: true });
  }

  /* ---------- statystyki ---------- */
  function stats() {
    const entries = Object.values(S.entries);
    const byStatus = Object.fromEntries(LIST_STATUSES.map((s) => [s, 0]));
    let eps = 0, minutes = 0, rewatches = 0, rewatchesDone = 0, missingDur = [], favs = 0;
    const perAnime = [];
    for (const e of entries) {
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
      const ep = totalEps(e);
      const d = epDur(e);
      const min = d ? ep * d : 0;
      eps += ep;
      minutes += min;
      if (!d && ep > 0) missingDur.push(e);
      const rw = e.sessions.length - 1;
      rewatches += rw;
      rewatchesDone += e.sessions.slice(1).filter((s) => sessionDone(e, s)).length;
      if (e.favorite) favs++;
      if (ep > 0) perAnime.push({ e, eps: ep, min, watches: finishedCount(e), sessions: e.sessions.length });
    }
    const epsWithDur = entries.reduce((a, e) => a + (epDur(e) ? totalEps(e) : 0), 0);

    // czas w miesiącach/latach z historii odcinków (tylko pozycje nadal na liście)
    const months = {}, years = {}, monthEps = {};
    let datedMinutes = 0;
    for (const h of S.history) {
      if (h.k !== 'ep') continue;
      const e = S.entries[h.m];
      if (!e) continue;
      const d = epDur(e);
      const mk = monthKey(h.t), yk = String(new Date(h.t).getFullYear());
      monthEps[mk] = (monthEps[mk] || 0) + 1;
      if (!d) continue;
      months[mk] = (months[mk] || 0) + d;
      years[yk] = (years[yk] || 0) + d;
      datedMinutes += d;
    }
    // gatunki ważone czasem
    const genres = {};
    for (const p of perAnime) for (const g of (p.e.media.genres || [])) genres[g] = (genres[g] || 0) + p.min;

    return {
      total: entries.length, byStatus, favs, eps, minutes, rewatches, rewatchesDone,
      avgEp: epsWithDur ? minutes / epsWithDur : 0,
      missingDur, perAnime, months, monthEps, years, genres,
      undatedMinutes: Math.max(0, minutes - datedMinutes),
    };
  }

  function thisMonthMinutes() {
    const mk = monthKey(now());
    let m = 0;
    for (const h of S.history) {
      if (h.k !== 'ep' || monthKey(h.t) !== mk) continue;
      const e = S.entries[h.m];
      const d = e && epDur(e);
      if (d) m += d;
    }
    return m;
  }

  /* ---------- odświeżanie danych z AniList + wykrywanie zmian ---------- */
  function needsRefresh(e) {
    // wpisy sprzed dodania popularności do migawki dociągamy raz
    if (e.media && e.media.popularity === undefined) return true;
    const age = now() - (e.mediaFetchedAt || 0);
    const st = e.media && e.media.status;
    const next = e.media && e.media.nextAiringEpisode;
    if (next && next.airingAt * 1000 < now()) return true;
    if (st === 'RELEASING' || st === 'NOT_YET_RELEASED' || st === 'HIATUS') return age > 45 * 60e3;
    return age > 7 * 86400e3;
  }

  function applyMediaUpdate(e, m) {
    const old = e.media || {};
    const fresh = snapshot(m);
    const name = titleOf(fresh);
    const link = `#/anime/${e.id}`;
    // premiery i emisje pozycji 18+ nie generują powiadomień
    const notify = fresh.isAdult ? () => false : notifyRaw;

    if (old.status && fresh.status && old.status !== fresh.status) {
      if (old.status === 'NOT_YET_RELEASED' && fresh.status === 'RELEASING') {
        notify({ kind: 'premiere', key: `prem:${e.id}`, title: `Premiera: ${name}`, body: 'Emisja właśnie się rozpoczęła.', link });
      } else if (fresh.status === 'FINISHED') {
        notify({ kind: 'change', key: `fin:${e.id}`, title: `${name} zakończyło emisję`, body: fresh.episodes ? `Łącznie ${nUnit(fresh.episodes, 'episode')}.` : '', link });
      } else {
        notify({ kind: 'change', key: `st:${e.id}:${fresh.status}`, title: `${name}: ${MSTATUS_PL[fresh.status] || fresh.status}`, body: `Wcześniej: ${MSTATUS_PL[old.status] || old.status}.`, link });
      }
    }
    if (old.episodes && fresh.episodes && old.episodes !== fresh.episodes) {
      notify({ kind: 'change', key: `eps:${e.id}:${fresh.episodes}`, title: `${name}: zmiana liczby odcinków`, body: `${old.episodes} → ${fresh.episodes}`, link });
    }
    if (fresh.status === 'NOT_YET_RELEASED' && old.startDate && fuzzyDate(old.startDate) !== fuzzyDate(fresh.startDate) && fuzzyDate(fresh.startDate)) {
      notify({ kind: 'premiere', key: `date:${e.id}:${fuzzyDate(fresh.startDate)}`, title: `${name}: nowa data premiery`, body: `${fuzzyDate(fresh.startDate)} (wcześniej: ${fuzzyDate(old.startDate) || 'nieustalona'}).`, link });
    }
    const aired = airedEpisodes(fresh);
    if (aired != null && (e.status === 'watching' || e.status === 'planning')) {
      const prev = e.lastAiredNotified ?? aired;
      if (aired > prev && aired > cur(e).progress) {
        notify({ kind: 'episode', key: `ep:${e.id}:${aired}`, title: `Nowy odcinek: ${name}`, body: `Odcinek ${aired} jest już po emisji.`, link });
      }
    }
    if (aired != null) e.lastAiredNotified = Math.max(e.lastAiredNotified ?? 0, aired);
    e.media = fresh;
    e.idMal = fresh.idMal ?? e.idMal;
    e.mediaFetchedAt = now();
  }

  let refreshing = null;
  async function refresh({ force = false } = {}) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const list = Object.values(S.entries).filter((e) => force || needsRefresh(e));
      if (!list.length) return { updated: 0 };
      const res = await Ani.byIds(list.map((e) => e.id), { force: true });
      if (res.stale) return { updated: 0, stale: true };
      const byId = new Map(res.media.map((m) => [m.id, m]));
      let updated = 0;
      for (const old of list) {
        // w trakcie pobierania inna karta mogła podmienić listę: bierzemy aktualny wpis
        const e = S.entries[old.id];
        const m = byId.get(old.id);
        if (e && m) { applyMediaUpdate(e, m); updated++; }
      }
      S.meta.lastRefresh = now();
      save();
      emit('library', { refresh: true });
      return { updated };
    })();
    try { return await refreshing; } finally { refreshing = null; }
  }

  // co minutę: czy zaplanowany odcinek właśnie minął?
  function checkAiring() {
    let due = false;
    for (const e of Object.values(S.entries)) {
      const n = e.media && e.media.nextAiringEpisode;
      if (!n || n.airingAt * 1000 > now()) continue;
      due = true;
      if (e.media.isAdult) continue;
      if ((e.status === 'watching' || e.status === 'planning') && n.episode > (e.lastAiredNotified ?? 0) && n.episode > cur(e).progress) {
        const name = titleOf(e.media);
        if (n.episode === 1 && e.status === 'planning') {
          notify({ kind: 'premiere', key: `prem:${e.id}`, title: `Premiera: ${name}`, body: 'Pierwszy odcinek jest już po emisji.', link: `#/anime/${e.id}` });
        } else {
          notify({ kind: 'episode', key: `ep:${e.id}:${n.episode}`, title: `Nowy odcinek: ${name}`, body: `Odcinek ${n.episode} jest już po emisji.`, link: `#/anime/${e.id}` });
        }
        e.lastAiredNotified = n.episode;
        save();
      }
    }
    if (due) refresh().catch(() => {});
  }

  /* ---------- przeniesienie obejrzeń do przeszłości (soft reset) ---------- */
  // Co wchodzi w zakres: odcinki i znaczniki początku/końca obejrzeń z [from, to].
  // Pomijamy obejrzenia z ręcznie wpisaną datą (past) i wszystko, co dotyczy listy
  // (dodanie, statusy, oceny) — to są prawdziwe dzisiejsze działania.
  const RESET_KINDS = new Set(['start', 'finish', 'rewatch']);
  const inRange = (ts, from, to) => !!ts && ts >= from && ts <= to;

  function resetScan(from, to) {
    const map = new Map();
    const row = (m) => {
      if (!map.has(m)) map.set(m, { id: m, eps: 0, last: 0, sess: new Set(), epMin: Infinity, epMax: 0 });
      return map.get(m);
    };
    for (const h of S.history) {
      if (!S.entries[h.m] || !inRange(h.t, from, to)) continue;
      if (h.k === 'ep' && !h.past) {
        const x = row(h.m);
        x.eps++; x.sess.add(h.s); x.last = Math.max(x.last, h.t);
        x.epMin = Math.min(x.epMin, h.ep); x.epMax = Math.max(x.epMax, h.ep);
      } else if (RESET_KINDS.has(h.k)) {
        const x = row(h.m); x.last = Math.max(x.last, h.t);
      }
    }
    for (const e of Object.values(S.entries)) {
      for (const s of e.sessions) {
        if (s.past) continue;
        if (inRange(s.startedAt, from, to) || inRange(s.finishedAt, from, to)) {
          const x = row(e.id);
          x.last = Math.max(x.last, s.finishedAt || s.startedAt);
        }
      }
    }
    return [...map.values()].map((x) => {
      const e = S.entries[x.id];
      return { ...x, e, sessions: x.sess.size, minutes: x.eps * (epDur(e) || 0) };
    }).sort((a, b) => b.last - a.last);
  }

  function resetToPast(from, to, ids) {
    const set = new Set(ids.map(Number));
    if (!set.size) return null;
    maybeBackup(true); // pełna kopia stanu sprzed operacji (Ustawienia → kopie)
    const removed = [], sessions = [], added = [];
    const per = new Map();
    S.history = S.history.filter((h) => {
      if (!set.has(h.m) || !inRange(h.t, from, to)) return true;
      if ((h.k === 'ep' && !h.past) || RESET_KINDS.has(h.k)) {
        removed.push(h);
        if (h.k === 'ep') {
          const p = per.get(h.m) || { n: 0, sess: new Set() };
          p.n++; p.sess.add(h.s); per.set(h.m, p);
        }
        return false;
      }
      return true;
    });
    for (const id of set) {
      const e = S.entries[id];
      if (!e) continue;
      for (const s of e.sessions) {
        if (s.past) continue;
        const st = inRange(s.startedAt, from, to), fi = inRange(s.finishedAt, from, to);
        if (!st && !fi) continue;
        sessions.push({ m: id, n: s.n, len: e.sessions.length, startedAt: s.startedAt, finishedAt: s.finishedAt, nodate: s.nodate, done: s.done });
        if (st) s.startedAt = null;
        if (fi) { s.finishedAt = null; s.done = true; }
        s.nodate = true;
      }
      const p = per.get(id);
      const ev = { id: uid(), t: now(), k: 'archived', m: id, n: p ? p.n : 0, sess: p ? p.sess.size : 0, ti: titleOf(e.media, 'romaji') };
      S.history.push(ev);
      added.push(ev.id);
    }
    const eps = removed.filter((h) => h.k === 'ep').length;
    S.meta.lastReset = { t: now(), from, to, count: added.length, eps, removed, sessions, added };
    saveNow();
    emit('library', { kind: 'reset' });
    return { count: added.length, eps };
  }

  function undoReset() {
    const r = S.meta.lastReset;
    if (!r) return false;
    const drop = new Set(r.added);
    S.history = S.history.filter((h) => !drop.has(h.id));
    const have = new Set(S.history.map((h) => h.id));
    for (const h of r.removed) if (!have.has(h.id) && S.entries[h.m]) S.history.push(h);
    S.history.sort((a, b) => a.t - b.t);
    for (const x of r.sessions) {
      const e = S.entries[x.m];
      // numeracja obejrzeń mogła się zmienić (np. dopisane obejrzenie) — wtedy nie zgadujemy
      if (!e || e.sessions.length !== x.len || !e.sessions[x.n]) continue;
      Object.assign(e.sessions[x.n], { startedAt: x.startedAt, finishedAt: x.finishedAt, nodate: x.nodate, done: x.done });
    }
    S.meta.lastReset = null;
    saveNow();
    emit('library', { kind: 'reset-undo' });
    return true;
  }

  /* ---------- powiadomienia ---------- */
  function notifyRaw(opts) { return notify(opts); }
  function notify({ kind, key, title, body = '', link = '' }) {
    if (key && S.meta.notifKeys[key]) return false;
    if (key) S.meta.notifKeys[key] = now();
    const n = { id: uid(), t: now(), kind, title, body, link, read: false };
    S.notifs.unshift(n);
    if (S.notifs.length > 200) S.notifs.length = 200;
    const keys = Object.entries(S.meta.notifKeys);
    if (keys.length > 2000) {
      keys.sort((a, b) => a[1] - b[1]).slice(0, keys.length - 1500).forEach(([k]) => delete S.meta.notifKeys[k]);
    }
    save();
    emit('notifs', n);
    if (S.settings.notifyKinds[kind] !== false && S.settings.sysNotify && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const sys = new Notification(title, { body, icon: 'icons/icon-192.png', tag: key || n.id });
        sys.onclick = () => { window.focus(); if (link) location.hash = link; };
      } catch { /* niektóre przeglądarki mobilne wymagają service workera */ }
    }
    return true;
  }
  const unreadCount = () => S.notifs.filter((n) => !n.read && S.settings.notifyKinds[n.kind] !== false).length;
  function markAllRead() { S.notifs.forEach((n) => { n.read = true; }); save(); emit('notifs'); }

  return {
    snapshot, get, cur, epDur, totalEps, entryMinutes, sessionDone, finishedCount, isRewatch, epTotal, airedEpisodes,
    rangesOf, rangesText, hasEp, lastEpOf, lastEp: (e) => lastEpOf(cur(e)), setEpisodes,
    add, remove, restore, setStatus, setProgress, increment, startRewatch, cancelRewatch, addPastWatch,
    removeSession, updateSession, setField, updateMedia, applyMediaUpdate,
    resetScan, resetToPast, undoReset,
    ratingMean, ratedCount, setRating, setScoreManual, setScoreAuto, toggleFavChar,
    stats, thisMonthMinutes, refresh, checkAiring, notify, unreadCount, markAllRead,
  };
})();
