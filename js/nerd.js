'use strict';
/* ==========================================================================
   Disboard — statystyki dla nerda
   Wszystko liczone lokalnie z Twojej listy i historii oglądania. Obsadę,
   twórców, studia, tagi, rankingi i rozkład ocen dociąga moduł Extras
   (AniList, pamięć podręczna na 30 dni). Nic tu nie jest zmyślone: gdy brak
   danych, kafelek to mówi.
   ========================================================================== */

const Nerd = (() => {
  const DAY = 86400e3;
  // przeliczniki (czas z AniList: 12 odc. × 23 min; film Zero 106 min; lot LOT WAW–NRT ok. 10,5 godz.)
  const NGNL_MIN = 276;
  const ZERO_MIN = 106;
  const FLIGHT_MIN = 630;
  const WORKDAY_MIN = 480;
  const WD = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
  const WD_SHORT = ['pn', 'wt', 'śr', 'cz', 'pt', 'so', 'nd'];
  const WD_IN = ['w poniedziałki', 'we wtorki', 'w środy', 'w czwartki', 'w piątki', 'w soboty', 'w niedziele'];
  const SEASON_NOM = { WINTER: 'Zima', SPRING: 'Wiosna', SUMMER: 'Lato', FALL: 'Jesień' };
  const PARTS = [['Noc', 0, 6, 'var(--st-paused)'], ['Rano', 6, 12, 'var(--st-planning)'], ['Popołudnie', 12, 18, 'var(--st-completed)'], ['Wieczór', 18, 24, 'var(--st-watching)']];
  const LEN = [[1, 1, '1'], [2, 6, '2–6'], [7, 13, '7–13'], [14, 26, '14–26'], [27, 52, '27–52'], [53, 100, '53–100'], [101, 1e9, '101+']];
  const ROLE_GROUPS = [
    ['Reżyseria', /^(chief |series )?director\b/i],
    ['Autor oryginału', /^original (creator|story|work)\b/i],
    ['Kompozycja serii i scenariusz', /^(series composition|script|screenplay)\b/i],
    ['Projekt postaci', /character design/i],
    ['Muzyka', /^music\b/i],
  ];
  const SECTIONS = [['rytm', 'Rytm'], ['biblioteka', 'Biblioteka'], ['ludzie', 'Ludzie'], ['oceny', 'Oceny'], ['nawyki', 'Nawyki'], ['fillery', 'Fillery'], ['przeliczniki', 'Przeliczniki'], ['ngnl', 'Kącik NGNL']];

  /* ---------- matematyka ---------- */
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : null);
  function median(a) {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function stdev(a) {
    if (a.length < 2) return null;
    const m = avg(a);
    return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
  }
  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 5) return null;
    const mx = avg(xs), my = avg(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }
  // jaki odsetek głosów AniList jest niższy od Twojej oceny (remisy liczone w połowie)
  function pctIn(dist, score) {
    const total = sum(dist.map((d) => d[1]));
    if (!total || score == null) return null;
    const b = clamp(Math.round(score) * 10, 10, 100);
    let below = 0, same = 0;
    for (const [s, a] of dist) { if (s < b) below += a; else if (s === b) same += a; }
    return ((below + same / 2) / total) * 100;
  }
  const keyTs = (k) => new Date(`${k}T12:00:00`).getTime();
  const yearOf = (m) => m.seasonYear || (m.startDate && m.startDate.year) || null;
  const seen = (e) => Lib.totalEps(e) > 0 || Lib.finishedCount(e) > 0;
  const T = (e) => esc(titleOf(e.media));
  const aLink = (e) => `<a href="#/anime/${e.id}">${T(e)}</a>`;
  const dur = (min) => esc(fmtDuration(min, { short: true }));
  const pct = (v) => `${NF.format(Math.round(v))}%`;
  // odmiana przy liczbie z ułamkiem: „0,4 doby”, „1,2 dniówki”, „5 dób”
  function frac(v, forms, nf = NF2) {
    const txt = nf.format(v);
    return /,/.test(txt) ? forms[3] : plural(Math.round(v), forms[0], forms[1], forms[2]);
  }
  function waitTxt(ts) {
    const d = Math.floor((Date.now() - ts) / DAY);
    return d < 1 ? 'od dziś' : esc(nUnit(d, 'day'));
  }
  const isNgnl = (e) => [19815, 33674].includes(e.idMal) || /no game no life/i.test(`${e.media.title.romaji || ''} ${e.media.title.english || ''}`);

  /* ==========================================================================
     OBLICZENIA
     ========================================================================== */
  function compute() {
    const entries = Object.values(S.entries);
    const st = Lib.stats();
    const seenE = entries.filter(seen);
    const X = Extras.all();
    const xOf = (e) => { const x = X[e.id]; return x && !x.missing ? x : null; };

    /* ---------- rytm: tylko odcinki oznaczane na bieżąco ---------- */
    const live = [];
    let bulk = 0, past = 0, firstAny = null;
    const recent = { min: 0, from: Date.now() - 30 * DAY };
    for (const h of S.history) {
      if (h.k !== 'ep') continue;
      const e = S.entries[h.m];
      if (!e) continue;
      if (h.past) { past++; continue; }
      const d = Lib.epDur(e) || 0;
      if (h.t >= recent.from) recent.min += d;
      if (!firstAny || h.t < firstAny.t) firstAny = h;
      if (h.bulk) { bulk++; continue; }
      live.push({ t: h.t, m: h.m, d });
    }
    live.sort((a, b) => a.t - b.t);
    const days = new Map();
    const hours = Array(24).fill(0), wd = Array(7).fill(0);
    for (const v of live) {
      const k = dayKey(v.t);
      const d = days.get(k) || { min: 0, eps: 0 };
      d.min += v.d; d.eps++;
      days.set(k, d);
      const dt = new Date(v.t);
      hours[dt.getHours()] += v.d;
      wd[(dt.getDay() + 6) % 7] += v.d;
    }
    const liveMin = sum(live.map((v) => v.d));
    // sesje: kolejny odcinek oznaczony najpóźniej 30 min po tym, jak mógł się skończyć
    const sessions = [];
    let cur = null;
    for (const v of live) {
      const len = (v.d || 24) * 60e3;
      if (cur && v.t - cur.end <= len + 30 * 60e3) { cur.end = v.t; cur.eps++; cur.min += v.d; cur.ids.add(v.m); }
      else { if (cur) sessions.push(cur); cur = { start: v.t - len, end: v.t, eps: 1, min: v.d, ids: new Set([v.m]) }; }
    }
    if (cur) sessions.push(cur);
    const marathons = sessions.filter((s) => s.eps >= 3);
    const longest = sessions.filter((s) => s.eps >= 2).sort((a, b) => b.min - a.min || b.eps - a.eps)[0] || null;
    // serie dni z rzędu
    const dks = [...days.keys()].sort();
    let best = null, run = null;
    for (const k of dks) {
      if (run && Math.round((keyTs(k) - keyTs(run.to)) / DAY) === 1) { run.to = k; run.len++; }
      else run = { from: k, to: k, len: 1 };
      if (!best || run.len > best.len) best = { ...run };
    }
    const y = new Date(); y.setDate(y.getDate() - 1);
    const curStreak = run && (run.to === dayKey(Date.now()) || run.to === dayKey(y.getTime())) ? run.len : 0;
    const firstLive = live[0] || null;
    const spanDays = firstLive ? Math.max(1, Math.round((keyTs(dayKey(Date.now())) - keyTs(dayKey(firstLive.t))) / DAY) + 1) : 0;
    let record = null;
    for (const [k, v] of days) if (!record || v.min > record.min) record = { k, ...v };
    const argmax = (a) => a.reduce((bi, v, i) => (v > a[bi] ? i : bi), 0);
    const R = {
      live, bulk, past, days, hours, wd, sessions, marathons, longest, streak: best, curStreak, firstAny, firstLive, spanDays, record, liveMin,
      activeDays: days.size, favHour: liveMin ? argmax(hours) : null, favWd: liveMin ? argmax(wd) : null,
      parts: PARTS.map(([l, a, b, c]) => ({ label: l, value: sum(hours.slice(a, b)), color: c })),
    };

    /* ---------- biblioteka ---------- */
    const fmt = {}, yearsC = {}, seasonsC = {}, lenC = {}, genresC = {}, srcC = {};
    const studioC = new Map(), tagC = new Map(), pops = [], ranked = [];
    let oldest = null, newest = null, longestSeries = null, shortEp = null, longEp = null;
    const yrs = [];
    const tsOf = (m) => fuzzyTs(m.startDate) || (yearOf(m) ? new Date(yearOf(m), 0, 1).getTime() : null);
    for (const e of seenE) {
      const m = e.media;
      const fk = FORMAT_PL[m.format] || m.format || 'Nieznany';
      fmt[fk] = (fmt[fk] || 0) + 1;
      const yr = yearOf(m);
      if (yr) {
        yearsC[yr] = (yearsC[yr] || 0) + 1;
        yrs.push(yr);
        const ts = tsOf(m);
        if (!oldest || ts < oldest.ts) oldest = { e, ts, yr };
        if (!newest || ts > newest.ts) newest = { e, ts, yr };
      }
      if (m.season) seasonsC[m.season] = (seasonsC[m.season] || 0) + 1;
      if (m.episodes) {
        const b = LEN.find(([a, z]) => m.episodes >= a && m.episodes <= z);
        lenC[b[2]] = (lenC[b[2]] || 0) + 1;
        if (!longestSeries || m.episodes > longestSeries.media.episodes) longestSeries = e;
      }
      const d = Lib.epDur(e);
      if (d) {
        if (!shortEp || d < Lib.epDur(shortEp)) shortEp = e;
        if (!longEp || d > Lib.epDur(longEp)) longEp = e;
      }
      for (const g of (m.genres || [])) (genresC[g] = genresC[g] || []).push(e);
      const x = xOf(e);
      if (!x) continue;
      if (x.source) srcC[x.source] = (srcC[x.source] || 0) + 1;
      for (const s of (x.studios || [])) {
        const o = studioC.get(s.id) || { id: s.id, n: s.n, c: 0, min: 0 };
        o.c++; o.min += Lib.entryMinutes(e);
        studioC.set(s.id, o);
      }
      for (const [t] of (x.tags || [])) tagC.set(t, (tagC.get(t) || 0) + 1);
      if (x.pop != null) pops.push({ e, pop: x.pop });
      const rr = (x.rank || []).filter((r) => r.a && r.t === 'RATED').sort((a, b) => a.r - b.r)[0];
      const pp = (x.rank || []).filter((r) => r.a && r.t === 'POPULAR').sort((a, b) => a.r - b.r)[0];
      if (rr || pp) ranked.push({ e, rr, pp });
    }
    pops.sort((a, b) => a.pop - b.pop);
    const B = {
      fmt, yearsC, seasonsC, lenC, genresC, srcC, oldest, newest, longestSeries, shortEp, longEp,
      avgYear: avg(yrs), studios: [...studioC.values()].sort((a, b) => b.c - a.c || b.min - a.min),
      tags: [...tagC.entries()].sort((a, b) => b[1] - a[1]), pops,
      popMedian: median(pops.map((p) => p.pop)),
      topRated: ranked.filter((r) => r.rr && r.rr.r <= 100).sort((a, b) => a.rr.r - b.rr.r),
      topPopular: ranked.filter((r) => r.pp && r.pp.r <= 100),
      withX: seenE.filter(xOf).length,
    };

    /* ---------- ludzie ---------- */
    const vaMap = new Map(), staffMap = new Map();
    for (const e of seenE) {
      const x = xOf(e);
      if (!x) continue;
      const min = Lib.entryMinutes(e);
      for (const c of (x.chars || [])) {
        if (!c.va || !c.va.id) continue;
        let o = vaMap.get(c.va.id);
        if (!o) { o = { id: c.va.id, n: c.va.n, nn: c.va.nn, img: c.va.img, ids: new Set(), chars: [], main: 0, min: 0, scores: [] }; vaMap.set(c.va.id, o); }
        o.chars.push({ n: c.n, img: c.img, role: c.role, mid: e.id, mt: titleOf(e.media) });
        if (c.role === 'MAIN') o.main++;
        if (!o.ids.has(e.id)) { o.ids.add(e.id); o.min += min; if (e.score != null) o.scores.push(e.score); }
      }
      for (const s of (x.staff || [])) {
        let o = staffMap.get(s.id);
        if (!o) { o = { id: s.id, n: s.n, img: s.img, roles: new Map() }; staffMap.set(s.id, o); }
        o.roles.set(e.id, [...(o.roles.get(e.id) || []), s.role || '']);
      }
    }
    const vas = [...vaMap.values()].sort((a, b) => b.ids.size - a.ids.size || b.main - a.main || b.min - a.min);
    const bestVa = vas.filter((v) => v.scores.length >= 3).map((v) => ({ v, m: avg(v.scores) })).sort((a, b) => b.m - a.m || b.v.scores.length - a.v.scores.length)[0] || null;
    const staffGroups = ROLE_GROUPS.map(([l, re]) => {
      const arr = [];
      for (const o of staffMap.values()) {
        let c = 0, min = 0;
        for (const [mid, roles] of o.roles) if (roles.some((r) => re.test(r))) { c++; min += S.entries[mid] ? Lib.entryMinutes(S.entries[mid]) : 0; }
        if (c) arr.push({ o, c, min });
      }
      arr.sort((a, b) => b.c - a.c || b.min - a.min);
      return { l, arr: arr.slice(0, 5) };
    });
    const favChars = Object.values(S.favChars || {}).sort((a, b) => b.t - a.t);
    const favVaC = new Map();
    for (const c of favChars) if (c.va && c.va.id) { const o = favVaC.get(c.va.id) || { va: c.va, n: 0 }; o.n++; favVaC.set(c.va.id, o); }
    const favCharsVa = [...favVaC.values()].sort((a, b) => b.n - a.n)[0] || null;
    const P = { vas, favVa: vas[0] || null, bestVa, staffGroups, favChars, favCharsVa: favCharsVa && favCharsVa.n >= 2 ? favCharsVa : null };

    /* ---------- oceny ---------- */
    const rated = entries.filter((e) => e.score != null && e.score > 0);
    const scores = rated.map((e) => e.score);
    const hist = Array(10).fill(0);
    for (const s of scores) hist[clamp(Math.ceil(s), 1, 10) - 1]++;
    const pairs = rated.filter((e) => e.media.averageScore).map((e) => ({ e, me: e.score, al: e.media.averageScore / 10, diff: e.score - e.media.averageScore / 10 }));
    const perGenre = {};
    for (const e of rated) for (const g of (e.media.genres || [])) (perGenre[g] = perGenre[g] || []).push(e.score);
    const cats = RATE_CATS.map(([k, l]) => {
      const v = entries.filter((e) => e.rating && e.rating[k] > 0).map((e) => ({ e, v: e.rating[k] }));
      v.sort((a, b) => b.v - a.v || (b.e.score || 0) - (a.e.score || 0));
      return { k, l, n: v.length, mean: avg(v.map((x) => x.v)), best: v[0] || null };
    });
    const pcts = rated.map((e) => { const x = xOf(e); return x && x.dist && x.dist.length ? pctIn(x.dist, e.score) : null; }).filter((v) => v != null);
    const O = {
      rated, scores, hist, pairs, mean: avg(scores), median: median(scores), sd: stdev(scores),
      diffMean: avg(pairs.map((p) => p.diff)),
      over: pairs.filter((p) => p.diff >= 0.5).sort((a, b) => b.diff - a.diff).slice(0, 4),
      under: pairs.filter((p) => p.diff <= -0.5).sort((a, b) => a.diff - b.diff).slice(0, 4),
      r: pearson(pairs.map((p) => p.me), pairs.map((p) => p.al)),
      perGenre: Object.entries(perGenre).filter(([, v]) => v.length >= 2).map(([g, v]) => ({ g, m: avg(v), n: v.length })).sort((a, b) => b.m - a.m),
      cats, catRated: entries.filter((e) => Lib.ratedCount(e) > 0).length,
      pct: avg(pcts), pctN: pcts.length,
      ngnlRank: null,
    };

    /* ---------- nawyki ---------- */
    const fin = [];
    for (const e of entries) {
      for (const s of e.sessions) {
        if (!s.startedAt || !s.finishedAt || s.past || s.progress < 2) continue;
        const span = s.finishedAt - s.startedAt;
        // hurtowe „Obejrzane” ma początek = koniec — to nie jest prawdziwe oglądanie
        if (span < Math.max(10, (s.progress - 1) * 5) * 60e3) continue;
        fin.push({ e, s, span, days: span / DAY });
      }
    }
    const byStatus = st.byStatus;
    const dropped = entries.filter((e) => e.status === 'dropped');
    const dropPct = dropped.filter((e) => Lib.epTotal(e)).map((e) => (Lib.cur(e).progress / Lib.epTotal(e)) * 100);
    const planning = entries.filter((e) => e.status === 'planning');
    let backlogMin = 0, backlogUnknown = 0;
    for (const e of planning) { const d = Lib.epDur(e), n = e.media.episodes; if (d && n) backlogMin += d * n; else backlogUnknown++; }
    const pace = recent.min / 30;
    const rewatched = entries.filter((e) => e.sessions.length > 1).sort((a, b) => b.sessions.length - a.sessions.length);
    let rwMin = 0;
    for (const e of entries) { const d = Lib.epDur(e); if (d) rwMin += sum(e.sessions.slice(1).map((s) => s.progress || 0)) * d; }
    const paused = entries.filter((e) => e.status === 'paused').sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    const H = {
      fin, medianDays: median(fin.map((f) => f.days)),
      fastest: fin.filter((f) => f.s.progress >= 6).sort((a, b) => a.span - b.span)[0] || null,
      slowest: fin.slice().sort((a, b) => b.span - a.span)[0] || null,
      completed: byStatus.completed || 0, droppedN: dropped.length, dropMedian: median(dropPct),
      dropEp: median(dropped.map((e) => Lib.cur(e).progress).filter((n) => n > 0)),
      paused, planning, backlogMin, backlogUnknown, pace,
      forecastDays: backlogMin && pace > 0 ? backlogMin / pace : null,
      oldestPlan: planning.slice().sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))[0] || null,
      rewatched, rwMin,
    };

    /* ---------- NGNL ---------- */
    const ngnl = entries.filter(isNgnl);
    const main = ngnl.find((e) => e.idMal === 19815 || e.id === 19815) || null;
    if (main && main.score != null) {
      const sorted = rated.slice().sort((a, b) => b.score - a.score);
      O.ngnlRank = { pos: sorted.findIndex((e) => e.score <= main.score) + 1, of: sorted.length };
    }
    let waitMs = null;
    try { const w = Wait.state(); if (w && w.b && w.b.t) waitMs = (w.mode === 'done' ? w.end : Date.now()) - w.b.t; } catch { /* licznik jeszcze nie gotowy */ }
    const N = { entries: ngnl, main, min: sum(ngnl.map((e) => Lib.entryMinutes(e))), watches: sum(ngnl.map((e) => Lib.finishedCount(e))), waitMs };

    /* ---------- fillery (dane MyAnimeList z modułu Episodes) ---------- */
    const FL = Episodes.all();
    const overlap = (a, b) => { let n = 0; for (const [x1, x2] of a) for (const [y1, y2] of b) { const lo = Math.max(x1, y1), hi = Math.min(x2, y2); if (hi >= lo) n += hi - lo + 1; } return n; };
    const clip = (r, last) => r.filter(([a]) => a <= last).map(([a, b]) => [a, Math.min(b, last)]);
    let fW = 0, fMin = 0, rW = 0, rMin = 0, sk = 0, skMin = 0, epsInF = 0, known = 0;
    const perSeries = [];
    for (const e of seenE) {
      const f = e.idMal && FL[e.idMal];
      if (!f) continue;
      known++;
      const d = Lib.epDur(e) || 0;
      let fw = 0, rw = 0, skipped = 0;
      for (const s of e.sessions) {
        const r = Lib.rangesOf(s);
        fw += overlap(r, f.f);
        rw += overlap(r, f.r);
        if (s.ranges) {
          const last = Lib.lastEpOf(s);
          const skipR = clip([...f.f, ...f.r], last);
          skipped += skipR.reduce((a, [x, y]) => a + y - x + 1, 0) - overlap(r, skipR);
        }
      }
      const nF = f.f.reduce((a, [x, y]) => a + y - x + 1, 0);
      fW += fw; rW += rw; fMin += fw * d; rMin += rw * d; sk += skipped; skMin += skipped * d;
      epsInF += Lib.totalEps(e);
      if (nF && f.n) perSeries.push({ e, share: nF / f.n, nF, fw, n: f.n });
    }
    perSeries.sort((a, b) => b.share - a.share || b.nF - a.nF);
    const Fx = { fW, fMin, rW, rMin, sk, skMin, known, epsInF, perSeries, need: Episodes.needScan(seenE).length, long: seenE.filter((e) => e.idMal && (e.media.episodes || Lib.lastEp(e) || 0) >= 20).length };

    return { st, entries, seenE, R, B, P, O, H, N, Fx, facts: null };
  }

  /* ---------- ciekawostki: tylko z prawdziwych danych ---------- */
  function facts(d) {
    const { st, R, B, P, O, H, N } = d;
    const f = [];
    if (R.favWd != null && R.liveMin) f.push(`Najwięcej oglądasz ${WD_IN[R.favWd]}: to ${pct((R.wd[R.favWd] / R.liveMin) * 100)} czasu z odcinków oznaczanych na bieżąco.`);
    if (R.longest) f.push(`Twój najdłuższy maraton: ${fmtDuration(R.longest.min)} i ${nUnit(R.longest.eps, 'episode')} jednym ciągiem (${fmtDate(R.longest.end)}).`);
    if (R.favHour != null && R.liveMin) f.push(`Twoja złota godzina to ${R.favHour}:00–${(R.favHour + 1) % 24}:00. Wtedy wpada ${pct((R.hours[R.favHour] / R.liveMin) * 100)} Twojego czasu.`);
    if (st.minutes >= NGNL_MIN) f.push(`W Twoim czasie oglądania całe No Game No Life zmieściłoby się ${NF1.format(st.minutes / NGNL_MIN)} razy.`);
    if (st.minutes >= FLIGHT_MIN) f.push(`Tym czasem można by ${NF1.format(st.minutes / FLIGHT_MIN)} razy przelecieć z Warszawy do Tokio.`);
    if (P.favVa && P.favVa.ids.size >= 2) f.push(`${P.favVa.n} ma głos w ${NF.format(P.favVa.ids.size)} anime z Twojej listy. To Twój najczęstszy seiyū.`);
    if (O.diffMean != null && O.pairs.length >= 3) f.push(Math.abs(O.diffMean) < 0.15 ? 'Oceniasz praktycznie tak samo jak średnia AniList.' : `Oceniasz średnio o ${NF1.format(Math.abs(O.diffMean))} pkt ${O.diffMean > 0 ? 'łagodniej' : 'surowiej'} niż średnia AniList.`);
    if (B.oldest) f.push(`Najstarsze obejrzane anime na liście: ${titleOf(B.oldest.e.media)} z ${B.oldest.yr} r.`);
    if (B.pops.length) f.push(`Twoja najbardziej niszowa pozycja to ${titleOf(B.pops[0].e.media)}: tylko ${NF.format(B.pops[0].pop)} list na AniList.`);
    if (R.liveMin && R.parts[0].value) f.push(`${pct((R.parts[0].value / R.liveMin) * 100)} Twojego oglądania przypada na noc, między północą a 6:00.`);
    if (H.planning.length && H.backlogMin) f.push(`W Planuję czeka ${nUnit(H.planning.length, 'title')}, czyli ${fmtDuration(H.backlogMin)} oglądania.`);
    if (B.studios[0] && B.studios[0].c >= 2) f.push(`Studio, które pojawia się u Ciebie najczęściej, to ${B.studios[0].n} (${nUnit(B.studios[0].c, 'title')}).`);
    const cb = O.cats.filter((c) => c.n >= 2).sort((a, b) => b.mean - a.mean);
    if (cb.length >= 2) f.push(`W ocenach szczegółowych najhojniejszy jesteś dla kategorii „${cb[0].l}”, a najsurowszy dla „${cb[cb.length - 1].l}”.`);
    if (R.streak && R.streak.len >= 3) f.push(`Rekordowa seria: ${nUnit(R.streak.len, 'day')} z rzędu z przynajmniej jednym odcinkiem.`);
    if (N.waitMs) f.push(`Przez czas czekania na 2. sezon NGNL dałoby się obejrzeć 1. sezon ${NF.format(Math.floor(N.waitMs / 60e3 / NGNL_MIN))} razy bez przerwy.`);
    if (d.Fx && d.Fx.fMin >= 60) f.push(`Na fillerach spędziłeś ${fmtDuration(d.Fx.fMin)} (${nUnit(d.Fx.fW, 'episode')}). To ${NF1.format(d.Fx.fMin / NGNL_MIN)} razy całe No Game No Life.`);
    if (d.Fx && d.Fx.perSeries[0]) f.push(`Najbardziej fillerowa seria na Twojej liście: ${titleOf(d.Fx.perSeries[0].e.media)}, ${pct(d.Fx.perSeries[0].share * 100)} odcinków to fillery.`);
    if (H.fastest) f.push(`Najszybciej ukończone: ${titleOf(H.fastest.e.media)}, ${nUnit(H.fastest.s.progress, 'episode')} w ${fmtDuration(H.fastest.span / 60e3)}.`);
    return f;
  }

  /* ==========================================================================
     WIDOK
     ========================================================================== */
  const how = (txt) => (txt ? `<details class="how"><summary title="Jak to liczę?" aria-label="Jak to liczę?">?</summary><div class="how-pop">${txt}</div></details>` : '');
  const tile = (label, value, note = '', h = '', cls = '') => `<div class="nt ${cls}">
      <div class="nt-top"><span class="lbl">${label}</span>${how(h)}</div>
      <div class="nt-v">${value}</div>${note ? `<p class="nt-n">${note}</p>` : ''}</div>`;
  const none = (txt = 'brak danych') => `<span class="nt-none">${txt}</span>`;
  const card = (id, title, sub = '', h = '', cls = '', body = '') => `<section class="card nc ${cls}">
      <header class="nc-head"><div><h3 class="card-h">${title}</h3>${sub ? `<p class="card-sub">${sub}</p>` : ''}</div>${how(h)}</header>
      ${id ? `<div id="${id}"></div>` : ''}${body}</section>`;
  const sec = (i, id, title, sub, inner) => `<section class="nsec" id="n-${id}" aria-labelledby="n-${id}-h">
      <header class="nsec-head"><span class="nsec-i num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <div><h2 id="n-${id}-h">${title}</h2><p class="sec-sub">${sub}</p></div></header>${inner}</section>`;
  const avatar = (img, name, cls = '') => (img ? `<img class="${cls}" src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="${cls} av-fb" aria-hidden="true">${esc(String(name || '?').trim().charAt(0))}</span>`);

  function rhythmHtml(R) {
    if (!R.live.length) {
      return UI.empty('Rytm pojawi się po pierwszych odcinkach', `Oznaczaj odcinki plusikiem na bieżąco, a zobaczysz kalendarz, ulubione godziny i maratony.${R.bulk + R.past ? ` Teraz masz ${NF.format(R.bulk + R.past)} odcinków oznaczonych hurtem albo dopisanych wstecz, a te nie mówią, kiedy oglądałeś.` : ''}`);
    }
    const L = R.longest;
    const nightPct = R.liveMin ? (R.parts[0].value / R.liveMin) * 100 : 0;
    const titles = (s) => [...s.ids].slice(0, 2).map((id) => (S.entries[id] ? aLink(S.entries[id]) : '')).join(', ') + (s.ids.size > 2 ? ` i ${s.ids.size - 2} inne` : '');
    return `
      ${card('nc-heat', 'Kalendarz oglądania', 'Ostatnie 53 tygodnie · jeden kwadrat to jeden dzień', 'Suma minut z odcinków oznaczonych danego dnia. Kolory mają stałe progi: do 45 min, do 2 godz., do 4 godz. i powyżej, więc intensywny dzień zawsze wygląda tak samo.', 'span-all')}
      <div class="ntiles">
        ${tile('Najdłuższy maraton', L ? `<b class="num">${dur(L.min)}</b>` : none(), L ? `${nUnit(L.eps, 'episode')} · ${esc(fmtDate(L.end))}<br>${titles(L)}` : '', 'Maraton to odcinki oznaczane jeden po drugim. Następny musi wpaść najpóźniej 30 minut po tym, jak poprzedni mógł się skończyć. Czas to suma długości odcinków.')}
        ${tile('Maratony 3+ odc.', `<b class="num">${NF.format(R.marathons.length)}</b>`, R.marathons.length ? `średnio ${NF1.format(avg(R.marathons.map((m) => m.eps)))} odc. · razem ${dur(sum(R.marathons.map((m) => m.min)))}` : 'jeszcze żadnego', 'Liczba sesji, w których obejrzałeś co najmniej 3 odcinki jednym ciągiem (definicja jak przy najdłuższym maratonie).')}
        ${tile('Najdłuższa seria dni', R.streak ? `<b class="num">${nUnit(R.streak.len, 'day')}</b>` : none(), R.streak ? `${esc(fmtDateShort(keyTs(R.streak.from)))} – ${esc(fmtDateShort(keyTs(R.streak.to)))}${R.curStreak ? ` · teraz: ${nUnit(R.curStreak, 'day')}` : ''}` : '', 'Najwięcej dni pod rząd z przynajmniej jednym odcinkiem. Obecna seria trwa, jeśli coś obejrzałeś dziś albo wczoraj.')}
        ${tile('Aktywne dni', `<b class="num">${NF.format(R.activeDays)}</b>`, `${pct((R.activeDays / R.spanDays) * 100)} dni od ${esc(fmtDate(R.firstLive.t))}`, 'Dni z przynajmniej jednym odcinkiem, na tle wszystkich dni od pierwszego odcinka oznaczonego na bieżąco.')}
        ${tile('Średnio w aktywny dzień', `<b class="num">${dur(R.liveMin / R.activeDays)}</b>`, `${NF1.format(R.live.length / R.activeDays)} odc.`, 'Czas z odcinków oznaczonych na bieżąco podzielony przez liczbę aktywnych dni.')}
        ${tile('Rekordowy dzień', R.record ? `<b class="num">${dur(R.record.min)}</b>` : none(), R.record ? `${nUnit(R.record.eps, 'episode')} · ${esc(fmtDate(keyTs(R.record.k)))}` : '', 'Dzień z największą sumą minut.')}
        ${tile('Złota godzina', R.favHour != null ? `<b class="num">${R.favHour}:00–${(R.favHour + 1) % 24}:00</b>` : none(), R.favHour != null ? `${pct((R.hours[R.favHour] / R.liveMin) * 100)} czasu` : '', 'Godzina, w której oznaczasz najwięcej minut. Liczy się chwila kliknięcia plusa, czyli zwykle koniec odcinka.')}
        ${tile('Ulubiony dzień', R.favWd != null ? `<b>${WD[R.favWd]}</b>` : none(), R.favWd != null ? `${pct((R.wd[R.favWd] / R.liveMin) * 100)} czasu` : '', 'Dzień tygodnia z największą sumą minut.')}
        ${tile('Nocny marek', `<b class="num">${pct(nightPct)}</b>`, 'czasu między 0:00 a 6:00', 'Udział minut oznaczonych między północą a szóstą rano.')}
        ${tile('Pierwszy odcinek w aplikacji', R.firstAny ? `<b class="num">${esc(fmtDate(R.firstAny.t))}</b>` : none(), R.firstAny && S.entries[R.firstAny.m] ? aLink(S.entries[R.firstAny.m]) : '', 'Najwcześniejszy odcinek zapisany z datą (także hurtem), bez obejrzeń dopisanych wstecz.')}
      </div>
      <div class="ncharts">
        ${card('nc-hours', 'Pora doby', 'Czas według godziny', 'Suma minut odcinków według godziny, o której je oznaczyłeś.', 'span-all')}
        ${card('nc-wd', 'Dni tygodnia', 'Czas według dnia', 'Suma minut odcinków według dnia tygodnia.')}
        ${card('nc-parts', 'Noc, rano, popołudnie, wieczór', '', 'Noc 0–6, rano 6–12, popołudnie 12–18, wieczór 18–24.')}
      </div>
      <p class="src-note">Rytm liczę z ${nUnit(R.live.length, 'episode')} oznaczonych na bieżąco.${R.bulk ? ` Pominąłem ${NF.format(R.bulk)} oznaczonych hurtem (np. „Obejrzane” jednym kliknięciem), bo mają datę kliknięcia, a nie oglądania.` : ''}${R.past ? ` Pominąłem też ${NF.format(R.past)} z obejrzeń dopisanych wstecz.` : ''}</p>`;
  }

  function libraryHtml(d) {
    const { B, seenE } = d;
    if (!seenE.length) return UI.empty('Biblioteka jest jeszcze pusta', 'Statystyki biblioteki liczą anime, z których obejrzałeś choć jeden odcinek.');
    const favSeason = Object.entries(B.seasonsC).sort((a, b) => b[1] - a[1])[0];
    const seasonsTotal = sum(Object.values(B.seasonsC));
    const rare = Object.entries(B.genresC).filter(([, v]) => v.length === 1);
    const xNote = B.withX < seenE.length ? `<p class="src-note">Studia, źródła, tagi, popularność i rankingi mam dla ${B.withX} z ${seenE.length} anime.</p>` : '';
    const niche = B.pops[0], main = B.pops[B.pops.length - 1];
    return `
      <div class="ntiles">
        ${tile('Obejrzane tytuły', `<b class="num">${NF.format(seenE.length)}</b>`, `${NF.format(d.st.byStatus.completed || 0)} ukończonych`, 'Anime z przynajmniej jednym obejrzanym odcinkiem albo ukończonym obejrzeniem. Tylko one liczą się w tej sekcji.')}
        ${tile('Średni rok premiery', B.avgYear ? `<b class="num">${Math.round(B.avgYear)}</b>` : none(), B.avgYear ? `mediana ${Math.round(median(Object.entries(B.yearsC).flatMap(([y, c]) => Array(c).fill(Number(y)))))}` : '', 'Średnia z roku emisji (sezon albo data rozpoczęcia z AniList).')}
        ${tile('Najstarsze', B.oldest ? `<b class="num">${B.oldest.yr}</b>` : none(), B.oldest ? aLink(B.oldest.e) : '', 'Najwcześniejsza data rozpoczęcia emisji wśród obejrzanych.')}
        ${tile('Najnowsze', B.newest ? `<b class="num">${B.newest.yr}</b>` : none(), B.newest ? aLink(B.newest.e) : '', 'Najpóźniejsza data rozpoczęcia emisji wśród obejrzanych.')}
        ${tile('Ulubiony sezon', favSeason ? `<b>${SEASON_NOM[favSeason[0]]}</b>` : none(), favSeason ? `${pct((favSeason[1] / seasonsTotal) * 100)} tytułów z sezonem` : '', 'Pora roku, w której startowało najwięcej obejrzanych anime (sezon emisji z AniList; filmy i OVA często go nie mają).')}
        ${tile('Najdłuższa seria', B.longestSeries ? `<b class="num">${nUnit(B.longestSeries.media.episodes, 'episode')}</b>` : none(), B.longestSeries ? aLink(B.longestSeries) : '', 'Najwięcej odcinków według AniList.')}
        ${tile('Najkrótszy odcinek', B.shortEp ? `<b class="num">${Lib.epDur(B.shortEp)} min</b>` : none(), B.shortEp ? aLink(B.shortEp) : '', 'Długość odcinka z AniList albo Twoja poprawka.')}
        ${tile('Najdłuższy odcinek', B.longEp ? `<b class="num">${Lib.epDur(B.longEp)} min</b>` : none(), B.longEp ? aLink(B.longEp) : '', 'Przy filmach to długość całego filmu.')}
        ${tile('Indeks hipstera', B.popMedian != null ? `<b class="num">${NF.format(Math.round(B.popMedian))}</b>` : none('czekam na dane'), niche ? `mediana list na AniList<br>najbardziej niszowe: ${aLink(niche.e)} (${NF.format(niche.pop)})${main && main !== niche ? `<br>najbardziej mainstreamowe: ${aLink(main.e)} (${NF.format(main.pop)})` : ''}` : '', 'Mediana liczby użytkowników AniList, którzy mają dane anime na liście. Im niższa, tym bardziej niszowy gust.')}
        ${tile('W top 100 AniList', `<b class="num">${NF.format(B.topRated.length)}</b>`, B.topRated.length ? `najwyżej: ${aLink(B.topRated[0].e)} (#${B.topRated[0].rr.r})` : 'najwyżej ocenianych wszech czasów', 'Ile obejrzanych anime zajmuje miejsce w pierwszej setce rankingu „najwyżej oceniane wszech czasów” AniList.')}
      </div>
      <div class="ncharts">
        ${card('nc-years', 'Lata premier', '', 'Liczba obejrzanych tytułów według roku rozpoczęcia emisji. Przy długim zakresie lata łączą się w pięciolatki.', 'span-all')}
        ${card('nc-fmt', 'Formaty', '', 'TV, filmy, OVA i reszta według AniList.')}
        ${card('nc-len', 'Długość serii', 'Liczba odcinków', 'Podział obejrzanych tytułów według liczby odcinków z AniList.')}
        ${card('nc-genres', 'Gatunki', 'Liczba tytułów', 'Każdy tytuł liczy się w każdym swoim gatunku. Wersja ważona czasem jest w podsumowaniu.', '', `${rare.length ? `<p class="nc-rare"><span class="lbl">Rzadkości</span> ${rare.map(([g, v]) => `<span class="chip">${esc(g)} · ${aLink(v[0])}</span>`).join(' ')}</p>` : ''}<p class="nc-rare" id="nc-miss" hidden></p>`)}
        ${card('nc-studios', 'Studia', 'Główne studio animacji', 'Tylko studia oznaczone w AniList jako główne. Czas to suma obejrzanych odcinków ich anime.')}
        ${card('nc-src', 'Źródła', 'Na podstawie czego powstało anime', 'Źródło z AniList: manga, light novel, oryginał i tak dalej.')}
        ${card('nc-tags', 'Tagi', 'Najczęstsze motywy', 'Tagi AniList z trafnością co najmniej 60% i bez spoilerów. Liczba tytułów z danym tagiem.')}
        ${B.topRated.length ? card('', 'Twoje anime w rankingach AniList', 'Najwyżej oceniane wszech czasów', 'Miejsca z rankingu AniList wśród obejrzanych anime.', '', `<ol class="nrank">${B.topRated.slice(0, 10).map((x) => `<li><b class="num">#${x.rr.r}</b>${aLink(x.e)}</li>`).join('')}</ol>`) : ''}
      </div>${xNote}`;
  }

  function peopleHtml(d) {
    const { P, B, seenE } = d;
    const fv = P.favVa;
    const hero = fv ? `<article class="fva">
        <a class="fva-img" href="#/osoba/${fv.id}" aria-label="${esc(fv.n)}">${avatar(fv.img, fv.n)}</a>
        <div class="fva-body">
          <span class="lbl">Twój ulubiony seiyū ${how('Aktor głosowy (japoński dubbing), który pojawia się w największej liczbie obejrzanych anime. Przy remisie decyduje liczba głównych ról, potem czas oglądania. Biorę 8 najważniejszych postaci z każdego anime.')}</span>
          <h3><a href="#/osoba/${fv.id}">${esc(fv.n)}</a></h3>${fv.nn ? `<p class="fva-nn" lang="ja">${esc(fv.nn)}</p>` : ''}
          <p class="fva-stats"><span><b class="num">${fv.ids.size}</b> anime</span><span><b class="num">${fv.chars.length}</b> ${plural(fv.chars.length, 'postać', 'postacie', 'postaci')}</span><span><b class="num">${dur(fv.min)}</b> oglądania</span>${fv.scores.length ? `<span>Twoja średnia <b class="num">${NF1.format(avg(fv.scores))}</b></span>` : ''}</p>
          <ul class="fva-chars">${fv.chars.slice(0, 8).map((c) => `<li><a href="#/anime/${c.mid}" title="${esc(`${c.n} · ${c.mt}`)}">${avatar(c.img, c.n)}<span>${esc(c.n)}</span><small>${esc(c.mt)}</small></a></li>`).join('')}</ul>
        </div></article>` : '';
    if (!fv && !P.favChars.length && !seenE.length) return UI.empty('Brak obejrzanych anime', 'Seiyū i twórców policzę z anime, z których obejrzałeś choć jeden odcinek.');
    if (!fv && !P.favChars.length) {
      return UI.empty(B.withX ? 'Brak danych o obsadzie' : 'Czekam na dane o obsadzie', B.withX ? 'AniList nie ma obsady dla obejrzanych anime.' : 'Pobieram z AniList postacie i aktorów dla obejrzanych anime. Chwilę to potrwa przy długiej liście.');
    }
    const bv = P.bestVa;
    return `${hero}
      <div class="ntiles">
        ${tile('Różne głosy', `<b class="num">${NF.format(P.vas.length)}</b>`, `seiyū w ${NF.format(B.withX)} z ${NF.format(seenE.length)} anime`, 'Liczba różnych japońskich aktorów głosowych wśród 8 najważniejszych postaci każdego obejrzanego anime.')}
        ${tile('Najlepiej oceniany seiyū', bv ? `<a href="#/osoba/${bv.v.id}"><b>${esc(bv.v.n)}</b></a>` : none('za mało ocen'), bv ? `Twoja średnia <b class="num">${NF1.format(bv.m)}</b> z ${bv.v.scores.length} anime` : 'potrzeba min. 3 ocenionych anime z tą samą osobą', 'Średnia Twoich ocen anime, w których występuje dana osoba. Liczę tylko tych, którzy są w co najmniej 3 ocenionych tytułach.')}
        ${tile('Głos Twoich ulubionych postaci', P.favCharsVa ? `<a href="#/osoba/${P.favCharsVa.va.id}"><b>${esc(P.favCharsVa.va.n)}</b></a>` : none(P.favChars.length >= 2 ? 'każda ma inny głos' : P.favChars.length ? 'za mało ulubionych postaci' : 'brak ulubionych postaci'), P.favCharsVa ? `${P.favCharsVa.n} z ${P.favChars.length} ulubionych postaci` : 'serduszko przy postaci na stronie anime', 'Aktor, który użycza głosu największej liczbie Twoich ulubionych postaci (co najmniej dwóm).')}
      </div>
      <div class="ncharts">
        ${card('nc-vas', 'Najczęstsze głosy', 'Liczba anime z Twojej listy', 'Seiyū z największą liczbą obejrzanych anime. Kliknij nazwisko, żeby zobaczyć wszystkie role.')}
        ${card('', 'Twórcy', 'Kto najczęściej stoi za Twoimi anime', 'Role z 10 najważniejszych osób ekipy każdego anime według AniList. Liczba to obejrzane tytuły z tą rolą.', '', `<div class="staffg">${P.staffGroups.map((g) => `<div class="sg"><h4 class="lbl">${g.l}</h4>${g.arr.length ? `<ol>${g.arr.map((x) => `<li><a href="#/osoba/${x.o.id}">${avatar(x.o.img, x.o.n, 'sg-av')}<span>${esc(x.o.n)}</span></a><b class="num">${x.c}</b></li>`).join('')}</ol>` : '<p class="muted">brak danych</p>'}</div>`).join('')}</div>`)}
      </div>
      ${UI.section(`Ulubione postacie <span class="count">${P.favChars.length}</span>`, P.favChars.length
    ? `<div class="fchars">${P.favChars.map((c) => `<article class="fchar">${avatar(c.img, c.n, 'fchar-img')}<div class="fchar-t"><b>${esc(c.n)}</b>${c.mid ? `<a href="#/anime/${c.mid}">${esc(c.mt || 'anime')}</a>` : ''}${c.va ? `<small>głos: <a href="#/osoba/${c.va.id}">${esc(c.va.n)}</a></small>` : ''}</div>
          <button class="pc-fav on" type="button" data-unfav="${c.id}" aria-pressed="true" title="Usuń z ulubionych postaci">${ICON.heart}</button></article>`).join('')}</div>`
    : '<p class="muted">Dodaj postacie serduszkiem w sekcji „Postacie i obsada” na stronie anime.</p>', { sub: 'Zapisane serduszkiem na stronach anime' })}`;
  }

  function ratingsHtml(d) {
    const { O, seenE } = d;
    if (!O.rated.length) return UI.empty('Brak ocen', 'Wystaw kilka ocen na stronach anime. Możesz też oceniać szczegółowo w pięciu kategoriach.');
    const r = O.r;
    const rTxt = r == null ? '' : r >= 0.7 ? 'bardzo zgodny gust z AniList' : r >= 0.4 ? 'raczej zgodny z AniList' : r >= 0.1 ? 'luźno zgodny z AniList' : r > -0.1 ? 'chodzisz własnymi ścieżkami' : 'na przekór tłumowi';
    const dm = O.diffMean;
    const cmpList = (arr, up) => (arr.length ? `<ul class="dlist">${arr.map((p) => `<li>${aLink(p.e)}<span class="num">Ty ${NF1.format(p.me)} · AniList ${NF1.format(p.al)} <b class="${up ? 'up' : 'down'}">${up ? '+' : '−'}${NF1.format(Math.abs(p.diff))}</b></span></li>`).join('')}</ul>` : '<p class="muted">Brak wyraźnych różnic.</p>');
    const catBody = O.catRated ? `<ul class="dlist">${O.cats.filter((c) => c.best).map((c) => `<li><span><span class="lbl">${esc(c.l)}</span> ${aLink(c.best.e)}</span><span class="num">${NF1.format(c.best.v)}</span></li>`).join('')}</ul>` : '<p class="muted">Otwórz „Oceń szczegółowo” na stronie anime i przesuń suwaki.</p>';
    return `
      <div class="ntiles">
        ${tile('Ocenione', `<b class="num">${NF.format(O.rated.length)}</b>`, `${pct((O.rated.filter(seen).length / Math.max(1, seenE.length)) * 100)} obejrzanych · ${NF.format(O.catRated)} szczegółowo`, 'Pozycje z oceną ogólną. Szczegółowo = co najmniej jedna kategoria.')}
        ${tile('Średnia', `<b class="num">${NF2.format(O.mean)}</b>`, `mediana ${NF1.format(O.median)}`, 'Średnia i mediana Twoich ocen ogólnych (skala 0,5–10).')}
        ${tile('Rozrzut', O.sd != null ? `<b class="num">±${NF2.format(O.sd)}</b>` : none('za mało ocen'), O.sd != null ? (O.sd < 1 ? 'oceniasz bardzo równo' : O.sd < 1.8 ? 'typowy rozrzut' : 'używasz całej skali') : '', 'Odchylenie standardowe: o ile przeciętnie ocena odbiega od Twojej średniej.')}
        ${tile('Ty kontra AniList', dm != null ? `<b class="num ${dm >= 0 ? 'up' : 'down'}">${dm > 0 ? '+' : dm < 0 ? '−' : ''}${NF2.format(Math.abs(dm))}</b>` : none(), dm != null ? (Math.abs(dm) < 0.15 ? 'oceniasz jak średnia' : dm > 0 ? 'łagodniej niż średnia' : 'surowiej niż średnia') + ` · ${O.pairs.length} anime` : '', 'Średnia różnica między Twoją oceną a średnią AniList (przeliczoną na skalę 10) dla tych samych anime.')}
        ${tile('Zgodność gustu', r != null ? `<b class="num">${NF2.format(r)}</b>` : none('min. 5 ocen'), rTxt, 'Współczynnik korelacji Pearsona między Twoimi ocenami a średnimi AniList: 1 = idealnie ta sama kolejność, 0 = brak związku, wartości ujemne = odwrotnie niż tłum.')}
        ${tile('Percentyl społeczności', O.pct != null ? `<b class="num">${pct(O.pct)}</b>` : none('czekam na dane'), O.pct != null ? `głosów na AniList jest niższych od Twoich · ${O.pctN} anime` : '', 'Dla każdego ocenionego anime sprawdzam, jaki odsetek głosów na AniList jest niższy niż Twój (z rozkładu ocen, remisy liczą się w połowie), i uśredniam.')}
      </div>
      <div class="ncharts">
        ${card('nc-hist', 'Rozkład Twoich ocen', '', 'Liczba ocen w przedziałach: słupek „8” to oceny 7,5 i 8.')}
        ${card('nc-cats', 'Średnie w kategoriach', O.catRated ? `${nUnit(O.catRated, 'title')} ocenione szczegółowo` : 'Brak ocen szczegółowych', 'Średnia z każdej kategorii oceny szczegółowej (tylko anime, w których ją oceniłeś).')}
        ${card('', 'Najlepsze w kategoriach', '', 'Najwyższa ocena w każdej kategorii; przy remisie wygrywa wyższa ocena ogólna.', '', catBody)}
        ${card('', 'Oceniasz wyżej niż AniList', '', 'Największe różnice na plus (co najmniej 0,5 pkt).', '', cmpList(O.over, true))}
        ${card('', 'Oceniasz niżej niż AniList', '', 'Największe różnice na minus (co najmniej 0,5 pkt).', '', cmpList(O.under, false))}
        ${card('nc-pg', 'Średnia ocena w gatunkach', 'Gatunki z co najmniej 2 ocenionymi tytułami', 'Średnia Twoich ocen ogólnych dla anime z danym gatunkiem.')}
      </div>`;
  }

  function habitsHtml(d) {
    const { H, st } = d;
    const f = H.fastest, sl = H.slowest;
    const decided = H.completed + H.droppedN;
    const spanTxt = (ms) => (ms < DAY ? fmtDuration(ms / 60e3) : nUnit(Math.round(ms / DAY), 'day'));
    const rw = H.rewatched[0];
    return `<div class="ntiles">
        ${tile('Typowy czas ukończenia', H.medianDays != null ? `<b class="num">${esc(spanTxt(H.medianDays * DAY))}</b>` : none(), H.fin.length ? `mediana z ${H.fin.length} ${plural(H.fin.length, 'obejrzenia', 'obejrzeń', 'obejrzeń')}` : 'potrzeba obejrzeń z datą startu i końca', 'Od pierwszego do ostatniego odcinka. Pomijam obejrzenia dopisane wstecz i hurtowe „Obejrzane” (start i koniec w tej samej chwili).')}
        ${tile('Najszybciej ukończone', f ? `<b class="num">${esc(spanTxt(f.span))}</b>` : none(), f ? `${aLink(f.e)} · ${nUnit(f.s.progress, 'episode')}` : 'min. 6 odcinków', 'Najkrótszy czas od startu do końca wśród obejrzeń z co najmniej 6 odcinkami.')}
        ${tile('Najdłużej ciągnięte', sl ? `<b class="num">${esc(spanTxt(sl.span))}</b>` : none(), sl ? aLink(sl.e) : '', 'Najdłuższy czas od startu do końca jednego obejrzenia.')}
        ${tile('Kończysz, co zaczniesz', decided ? `<b class="num">${pct((H.completed / decided) * 100)}</b>` : none(), decided ? `${NF.format(H.completed)} ukończ. · ${NF.format(H.droppedN)} porzuc.` : '', 'Ukończone na tle ukończonych i porzuconych (bez oglądanych i wstrzymanych).')}
        ${tile('Porzucasz przy', H.dropMedian != null ? `<b class="num">${pct(H.dropMedian)}</b>` : none(H.droppedN ? 'brak liczby odcinków' : 'nic nie porzuciłeś'), H.dropEp != null ? `serii · zwykle po ${NF1.format(H.dropEp)}. odc.` : '', 'Mediana postępu w porzuconych seriach, w procentach długości serii i w odcinkach.')}
        ${tile('Wstrzymane', `<b class="num">${NF.format(H.paused.length)}</b>`, H.paused[0] ? `najdłużej: ${aLink(H.paused[0])}` : '', 'Pozycje ze statusem Wstrzymane; „najdłużej” = najdawniej zmieniane.')}
        ${tile('Planuję', `<b class="num">${NF.format(H.planning.length)}</b>`, H.backlogMin ? `${dur(H.backlogMin)} oglądania${H.backlogUnknown ? ` + ${H.backlogUnknown} bez długości` : ''}` : '', 'Suma odcinków × długość z AniList dla pozycji w Planuję. Tytuły bez liczby odcinków (np. jeszcze w emisji) liczę osobno.')}
        ${tile('Prognoza backlogu', H.forecastDays != null ? `<b class="num">${nUnit(Math.ceil(H.forecastDays), 'day')}</b>` : none(!H.planning.length ? 'backlog pusty' : !H.backlogMin ? 'brak długości tytułów' : 'brak tempa z 30 dni'), H.forecastDays != null ? `przy Twoim tempie ${dur(H.pace)} dziennie` : '', 'Czas Planuję podzielony przez Twoje średnie dzienne tempo z ostatnich 30 dni (wszystkie odcinki z datą). Zakłada, że nic nowego nie dodasz.')}
        ${tile('Najdłużej czeka', H.oldestPlan ? `<b class="num">${waitTxt(H.oldestPlan.addedAt)}</b>` : none(), H.oldestPlan ? aLink(H.oldestPlan) : '', 'Pozycja w Planuję dodana najdawniej.')}
        ${tile('Rewatche', `<b class="num">${NF.format(st.rewatches)}</b>`, rw ? `najczęściej: ${aLink(rw)} (${rw.sessions.length}×)${H.rwMin ? ` · ${dur(H.rwMin)}` : ''}` : 'jeszcze żadnego', 'Liczba ponownych obejrzeń i czas, jaki na nie poszedł.')}
      </div>`;
  }

  function fillersHtml(d) {
    const F = d.Fx;
    if (!F.long) return UI.empty('Brak długich serii', 'Fillery liczę w seriach od 20 odcinków, a takich jeszcze nie obejrzałeś.');
    if (!F.known) return UI.empty('Sprawdzam fillery', 'Pobieram z MyAnimeList, które odcinki Twoich długich serii to fillery. Przy dłuższej liście to potrwa kilka minut, potem dane zostają w pamięci.');
    const top = F.perSeries[0];
    const share = F.epsInF ? (F.fW / F.epsInF) * 100 : 0;
    return `<div class="ntiles">
        ${tile('Obejrzane fillery', `<b class="num">${nUnit(F.fW, 'episode')}</b>`, `${pct(share)} odcinków w seriach, które mają fillery`, 'Odcinki oznaczone w MyAnimeList jako filler, które obejrzałeś (także w rewatchach). Przy wybranych odcinkach liczą się tylko zaznaczone.')}
        ${tile('Czas zmarnowany na fillerach', `<b class="num">${dur(F.fMin)}</b>`, F.fMin >= NGNL_MIN ? `to ${NF1.format(F.fMin / NGNL_MIN)}× całe No Game No Life` : F.fMin ? 'mniej niż całe No Game No Life' : 'czysto', 'Obejrzane fillery × długość odcinka danej serii.')}
        ${tile('Recapy', `<b class="num">${nUnit(F.rW, 'episode')}</b>`, F.rMin ? dur(F.rMin) : 'żadnego', 'Odcinki-podsumowania (recap) według MyAnimeList, liczone osobno od fillerów.')}
        ${tile('Najbardziej fillerowa seria', top ? `<b class="num">${pct(top.share * 100)}</b>` : none('bez fillerów'), top ? `${aLink(top.e)} · ${top.nF} z ${top.n} odc.` : '', 'Seria z Twojej listy z największym udziałem fillerów wśród wszystkich odcinków.')}
        ${tile('Zaoszczędzone dzięki pomijaniu', F.sk ? `<b class="num">${dur(F.skMin)}</b>` : none(S.settings.skipFiller ? 'jeszcze nic' : 'tryb wyłączony'), F.sk ? `${nUnit(F.sk, 'episode')} pominiętych` : '<kbd>Alt+P</kbd> włącza pomijanie fillerów', 'Fillery i recapy, które przeskoczyłeś w trybie pomijania (albo zostawiłeś niezaznaczone), przed ostatnim obejrzanym odcinkiem.')}
      </div>
      ${F.perSeries.length ? `<div class="ncharts">${card('nc-fill', 'Udział fillerów w Twoich seriach', 'Procent odcinków serii', 'Liczba odcinków oznaczonych jako filler na tle wszystkich odcinków serii (dane MyAnimeList).', 'span-all')}</div>` : ''}
      <p class="src-note">Dane o fillerach mam dla ${F.known} z ${F.long} długich serii (od 20 odcinków). Oznaczenia wpisują użytkownicy MyAnimeList, więc przy mniej znanych seriach bywają niepełne.</p>`;
  }

  function convHtml(d) {
    const m = d.st.minutes;
    if (!m) return UI.empty('Nie ma czego przeliczać', 'Przeliczniki pojawią się, gdy zbierze się czas oglądania.');
    const c = (glyph, value, label, h) => `<div class="nconv"><span class="nconv-g" aria-hidden="true">${glyph}</span><b class="num">${value}</b><span>${label}</span>${how(h)}</div>`;
    return `<div class="nconvs">
      ${c('♛', `${NF1.format(m / NGNL_MIN)}×`, 'całe No Game No Life', '12 odcinków × 23 min = 276 min.')}
      ${c('♜', `${NF1.format(m / ZERO_MIN)}×`, 'film No Game No Life: Zero', 'Film trwa 106 min.')}
      ${c('☾', NF2.format(m / 1440), frac(m / 1440, ['doba', 'doby', 'dób', 'doby']), 'Łączny czas podzielony przez 24 godziny.')}
      ${c('◔', `${NF2.format((m / 525600) * 100)}%`, 'roku życia', 'Łączny czas na tle 365 dni.')}
      ${c('✈', `${NF1.format(m / FLIGHT_MIN)}×`, 'lot Warszawa–Tokio', 'Bezpośredni lot LOT trwa ok. 10,5 godz. (630 min).')}
      ${c('⌚', NF1.format(m / WORKDAY_MIN), `${frac(m / WORKDAY_MIN, ['dniówka', 'dniówki', 'dniówek', 'dniówki'], NF1)} po 8 godzin`, '8 godzin = 480 min.')}
    </div><p class="src-note">Na podstawie łącznego czasu: ${esc(fmtDuration(m))}.</p>`;
  }

  function ngnlHtml(d) {
    const { N, O, st } = d;
    const wait = N.waitMs ? Math.floor(N.waitMs / DAY) : null;
    if (!N.entries.length) {
      return `<div class="ngc">${UI.empty('NGNL nie ma jeszcze na liście', 'Dodaj serię, a policzę, ile razy ją obejrzałeś i jak Twoja ocena ma się do AniList.', '<a class="btn" href="#/anime/19815">Otwórz No Game No Life</a>')}
        ${wait != null ? `<p class="ngc-wait">A na 2. sezon czekasz już <b class="num">${NF.format(wait)}</b> ${unit(wait, 'day')}.</p>` : ''}</div>`;
    }
    const mn = N.main;
    const al = mn && mn.media.averageScore ? mn.media.averageScore / 10 : null;
    return `<div class="ntiles ngc">
      ${tile('Ukończone obejrzenia', `<b class="num">${NF.format(N.watches)}</b>`, N.entries.map((e) => `${aLink(e)} ${Lib.finishedCount(e)}×`).join('<br>'), 'Ukończone obejrzenia wszystkich pozycji NGNL na liście (seria, film Zero i dodatki), z rewatchami.')}
      ${tile('Czas z Disboardem', `<b class="num">${dur(N.min)}</b>`, st.minutes ? `${pct((N.min / st.minutes) * 100)} całego Twojego oglądania` : '', 'Suma czasu wszystkich obejrzeń pozycji NGNL.')}
      ${tile('Twoja ocena', mn && mn.score != null ? `<b class="num">${NF1.format(mn.score)}</b>` : none('bez oceny'), mn && mn.score != null && al ? `AniList ${NF1.format(al)} · ${mn.score - al >= 0 ? '+' : '−'}${NF1.format(Math.abs(mn.score - al))}` : '', 'Ocena 1. sezonu na tle średniej AniList.')}
      ${tile('Miejsce w Twoim rankingu', O.ngnlRank ? `<b class="num">#${O.ngnlRank.pos}</b>` : none(), O.ngnlRank ? `z ${O.ngnlRank.of} ocenionych` : '', 'Pozycja 1. sezonu wśród wszystkich Twoich ocen (remisy dzielą miejsce).')}
      ${tile('Czekasz na 2. sezon', wait != null ? `<b class="num">${NF.format(wait)} ${unit(wait, 'day')}</b>` : none(), N.waitMs ? `tyle czasu to ${NF.format(Math.floor(N.waitMs / 60e3 / NGNL_MIN))} ${plural(Math.floor(N.waitMs / 60e3 / NGNL_MIN), 'maraton', 'maratony', 'maratonów')} całego 1. sezonu` : '', 'Ten sam licznik co w rogu ekranu.')}
    </div>`;
  }

  /* ---------- wykresy po wstawieniu HTML ---------- */
  function drawCharts(root, d) {
    const q = (id) => root.querySelector(`#${id}`);
    const { R, B, P, O } = d;
    if (q('nc-heat')) Charts.heatmap(q('nc-heat'), { days: R.days });
    // wartości w godzinach (oś w pełnych/połówkowych godzinach), podpowiedź w minutach
    const hAxis = (v) => `${NF1.format(v)} h`;
    if (q('nc-hours')) Charts.columns(q('nc-hours'), { data: R.hours.map((v, h) => ({ label: `${h}:00–${(h + 1) % 24}:00`, short: String(h), value: v / 60, tip: fmtDuration(v, { short: true }), hl: h === R.favHour })), format: (v) => fmtDuration(v * 60, { short: true }), axisFormat: hAxis, unitLabel: 'Czas', xHeader: 'Godzina', height: 150, every: 3 });
    if (q('nc-wd')) Charts.columns(q('nc-wd'), { data: R.wd.map((v, i) => ({ label: WD[i], short: WD_SHORT[i], value: v / 60, tip: fmtDuration(v, { short: true }), hl: i === R.favWd })), format: (v) => fmtDuration(v * 60, { short: true }), axisFormat: hAxis, unitLabel: 'Czas', xHeader: 'Dzień', height: 150 });
    if (q('nc-parts')) Charts.stack(q('nc-parts'), { data: R.parts, label: 'Pora dnia oglądania', format: (v, t) => `${dur(v)} · ${pct((v / t) * 100)}`, empty: 'Brak danych.' });
    if (q('nc-years')) {
      const ys = Object.keys(B.yearsC).map(Number);
      let data = [];
      if (ys.length) {
        const lo = Math.min(...ys), hi = Math.max(...ys);
        const step = hi - lo > 30 ? 5 : 1;
        for (let y = step === 5 ? lo - (lo % 5) : lo; y <= hi; y += step) {
          let v = 0;
          for (let k = y; k < y + step; k++) v += B.yearsC[k] || 0;
          data.push({ label: step === 5 ? `${y}–${y + 4}` : String(y), short: step === 5 ? `${String(y).slice(2)}–` : `'${String(y).slice(2)}`, value: v, tip: nUnit(v, 'title') });
        }
      }
      Charts.columns(q('nc-years'), { data, format: (v) => NF.format(v), unitLabel: 'Tytuły', xHeader: 'Rok', height: 150, minStep: 1, empty: 'Brak lat emisji.' });
    }
    const hb = (id, arr, opts = {}) => { if (q(id)) Charts.hbars(q(id), { color: 'var(--viz-1)', ...opts, data: arr }); };
    hb('nc-fmt', Object.entries(B.fmt).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, text: nUnit(v, 'title') })), { header: ['Format', 'Tytuły'] });
    if (q('nc-len')) Charts.columns(q('nc-len'), { data: LEN.map(([, , l]) => ({ label: `${l} odc.`, short: l, value: B.lenC[l] || 0, tip: nUnit(B.lenC[l] || 0, 'title') })), format: (v) => NF.format(v), unitLabel: 'Tytuły', xHeader: 'Odcinki', height: 140, minStep: 1, empty: 'Brak liczby odcinków.' });
    hb('nc-genres', Object.entries(B.genresC).sort((a, b) => b[1].length - a[1].length).slice(0, 12).map(([g, v]) => ({ label: g, value: v.length, text: nUnit(v.length, 'title'), href: `#/szukaj?genre=${encodeURIComponent(g)}` })), { header: ['Gatunek', 'Tytuły'] });
    hb('nc-studios', B.studios.slice(0, 8).map((s) => ({ label: s.n, value: s.c, text: `${nUnit(s.c, 'title')} · ${fmtDuration(s.min, { short: true })}` })), { color: 'var(--viz-2)', header: ['Studio', 'Tytuły'], empty: B.withX ? 'Brak danych o studiach.' : 'Czekam na dane z AniList…' });
    hb('nc-src', Object.entries(B.srcC).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: SOURCE_PL[k] || k, value: v, text: nUnit(v, 'title') })), { header: ['Źródło', 'Tytuły'], empty: B.withX ? 'Brak danych o źródłach.' : 'Czekam na dane z AniList…' });
    hb('nc-tags', B.tags.slice(0, 10).map(([t, v]) => ({ label: t, value: v, text: nUnit(v, 'title') })), { color: 'var(--viz-2)', header: ['Tag', 'Tytuły'], empty: B.withX ? 'Brak tagów.' : 'Czekam na dane z AniList…' });
    hb('nc-vas', P.vas.slice(0, 10).map((v) => ({ label: v.n, value: v.ids.size, text: `${v.ids.size} anime · ${v.chars.length} ${plural(v.chars.length, 'postać', 'postacie', 'postaci')}`, href: `#/osoba/${v.id}` })), { color: 'var(--viz-2)', header: ['Seiyū', 'Anime'], empty: 'Czekam na dane z AniList…' });
    if (q('nc-hist')) Charts.columns(q('nc-hist'), { data: O.hist.map((v, i) => ({ label: `${NF1.format(i + 0.5)} i ${i + 1}`, short: String(i + 1), value: v, tip: `${NF.format(v)} ${plural(v, 'ocena', 'oceny', 'ocen')}` })), format: (v) => NF.format(v), unitLabel: 'Liczba ocen', xHeader: 'Ocena', height: 150, minStep: 1 });
    hb('nc-cats', O.cats.filter((c) => c.n).map((c) => ({ label: c.l, value: c.mean, text: `${NF2.format(c.mean)} · ${c.n} anime` })), { header: ['Kategoria', 'Średnia'], empty: 'Brak ocen szczegółowych.' });
    hb('nc-fill', d.Fx.perSeries.slice(0, 10).map((x) => ({ label: titleOf(x.e.media), value: x.share * 100, text: `${pct(x.share * 100)} · ${x.nF} z ${x.n}`, href: `#/anime/${x.e.id}` })), { color: 'var(--crown)', header: ['Seria', 'Fillery'], empty: 'Brak serii z fillerami.', max: 100 });
    hb('nc-pg', O.perGenre.slice(0, 12).map((g) => ({ label: g.g, value: g.m, text: `${NF2.format(g.m)} · ${g.n} anime` })), { header: ['Gatunek', 'Średnia'], empty: 'Za mało ocen w gatunkach.' });
  }

  /* ==========================================================================
     STRONA
     ========================================================================== */
  function page(ctx, tabsHtml) {
    ctx.title('Statystyki dla nerda');
    let fact = null;
    let xs = { state: 'idle', done: 0, total: 0 };
    let last = null;

    const needIds = () => Object.values(S.entries).filter((e) => seen(e) || (e.score != null)).map((e) => e.id);
    const bannerHtml = () => {
      if (xs.state === 'run') {
        const p = xs.total ? (xs.done / xs.total) * 100 : 0;
        const what = xs.job === 'fill' ? 'Sprawdzam w MyAnimeList fillery w długich seriach' : 'Pobieram z AniList obsadę, twórców, studia i rankingi';
        return `<div class="nxb" role="status"><div class="nxb-t"><span class="nxb-dot" aria-hidden="true"></span>${what}: <b class="num">${xs.done}/${xs.total}</b> ${xs.job === 'fill' ? plural(xs.total, 'seria', 'serie', 'serii') : 'anime'}</div><div class="nxb-bar"><i style="width:${p}%"></i></div></div>`;
      }
      if (xs.state === 'fail') return `<div class="nxb fail" role="status"><div class="nxb-t">Nie udało się pobrać wszystkiego ${xs.job === 'fill' ? 'z MyAnimeList' : 'z AniList'} (${xs.done}/${xs.total}). Część kafelków czeka na dane.</div><button class="btn ghost sm" type="button" id="nx-retry">${ICON.refresh}Spróbuj ponownie</button></div>`;
      return '';
    };
    const updBanner = () => { const b = ctx.el.querySelector('#nx-host'); if (b) b.innerHTML = bannerHtml(); };

    const render = () => {
      if (!ctx.alive()) return;
      const d = compute();
      const fs = facts(d);
      if (fact == null || fact >= fs.length) fact = fs.length ? parseInt(hashStr(dayKey(Date.now())), 36) % fs.length : 0;
      last = { d, fs };
      // otwarte „?” zostaje otwarte po przeliczeniu
      const openHow = [...ctx.el.querySelectorAll('details.how')].findIndex((x) => x.open);
      const html = [
        rhythmHtml(d.R), libraryHtml(d), peopleHtml(d), ratingsHtml(d), habitsHtml(d), fillersHtml(d), convHtml(d), ngnlHtml(d),
      ];
      const subs = [
        'Kiedy i jak oglądasz', 'Co jest na Twojej półce', 'Głosy, twórcy i postacie', 'Jak oceniasz i na tle AniList', 'Kończenie, porzucanie, backlog', 'Ile czasu poszło na odcinki poboczne', 'Twój czas w innych jednostkach', 'Bo to jest centrum wszechświata',
      ];
      ctx.el.innerHTML = `<div class="page stats nerd">
        ${tabsHtml}
        <section class="nfact" aria-live="polite">
          <div class="nfact-k" aria-hidden="true"><span>♠</span><span>♥</span><span>♦</span><span>♣</span></div>
          <div class="nfact-b"><span class="lbl">Ciekawostka dnia</span><p id="nfact-t">${fs.length ? esc(fs[fact]) : 'Dodaj trochę anime i oznacz kilka odcinków, a coś tu dla Ciebie znajdę.'}</p></div>
          ${fs.length > 1 ? `<button class="btn ghost sm" type="button" id="nfact-roll">${ICON.repeat}Losuj</button>` : ''}
        </section>
        <nav class="nnav" aria-label="Sekcje">${SECTIONS.map(([k, l]) => `<button type="button" class="chip-btn" data-jump="n-${k}">${l}</button>`).join('')}</nav>
        <div id="nx-host">${bannerHtml()}</div>
        ${SECTIONS.map(([k, l], i) => sec(i, k, l, subs[i], html[i])).join('')}
      </div>`;
      const root = ctx.el.querySelector('.nerd');
      drawCharts(root, d);
      if (openHow >= 0) { const el = root.querySelectorAll('details.how')[openHow]; if (el) el.open = true; }
      bind(root);
      fillMissingGenres(d);
    };

    function fillMissingGenres(d) {
      const el = ctx.el.querySelector('#nc-miss');
      if (!el || !d.seenE.length) return;
      Ani.genres().then((all) => {
        if (!ctx.alive() || !el.isConnected) return;
        const have = new Set(Object.keys(d.B.genresC));
        const miss = all.filter((g) => !have.has(g) && (S.settings.adult || g !== 'Hentai'));
        if (!miss.length) return;
        el.hidden = false;
        el.innerHTML = `<span class="lbl">Jeszcze nie ruszone</span> ${miss.map((g) => `<a class="chip link" href="#/szukaj?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join(' ')}`;
      }).catch(() => {});
    }

    function bind(root) {
      root.addEventListener('click', (ev) => {
        // klik poza otwartym „?” zamyka wyjaśnienie
        if (!ev.target.closest('details.how')) root.querySelectorAll('details.how[open]').forEach((x) => { x.open = false; });
        const j = ev.target.closest('[data-jump]');
        if (j) { const t = root.querySelector(`#${j.dataset.jump}`); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        if (ev.target.closest('#nfact-roll') && last && last.fs.length > 1) {
          let n = fact;
          while (n === fact) n = Math.floor(Math.random() * last.fs.length);
          fact = n;
          const t = root.querySelector('#nfact-t');
          t.classList.remove('flip'); void t.offsetWidth; t.classList.add('flip');
          t.textContent = last.fs[fact];
          return;
        }
        if (ev.target.closest('#nx-retry')) { if (xs.job === 'fill') fetchFillers(); else fetchExtras(); return; }
        const uf = ev.target.closest('[data-unfav]');
        if (uf) {
          const c = (S.favChars || {})[uf.dataset.unfav];
          if (c) { Lib.toggleFavChar(c, null); toast(`Usunięto z ulubionych postaci: ${c.n}`, { kind: 'ok', action: { label: 'Cofnij', fn: () => { S.favChars[c.id] = c; save(); emit('favchars', { id: c.id }); } } }); }
        }
      });
      // jedno otwarte „?” naraz
      root.addEventListener('toggle', (ev) => {
        const t = ev.target;
        if (!(t instanceof HTMLDetailsElement) || !t.classList.contains('how') || !t.open) return;
        root.querySelectorAll('details.how[open]').forEach((x) => { if (x !== t) x.open = false; });
        // dymek nie może wyjść poza ekran (wąskie kafelki na telefonie)
        const pop = t.querySelector('.how-pop');
        if (pop) {
          pop.style.transform = '';
          const r = pop.getBoundingClientRect();
          const dx = r.left < 8 ? 8 - r.left : r.right > window.innerWidth - 8 ? window.innerWidth - 8 - r.right : 0;
          if (dx) pop.style.transform = `translateX(${dx}px)`;
        }
      }, true);
    }

    async function fetchExtras() {
      const ids = needIds();
      const todo = Extras.missing(ids);
      if (!todo.length) { xs = { state: 'ok', done: 0, total: 0 }; updBanner(); fetchFillers(); return; }
      xs = { state: 'run', job: 'extras', done: 0, total: todo.length };
      updBanner();
      let r;
      try {
        r = await Extras.ensure(ids, { alive: ctx.alive, onProgress: (dn, tt) => { xs.done = dn; xs.total = tt; updBanner(); } });
      } catch { r = { failed: true }; }
      if (!ctx.alive()) return;
      xs.state = r.failed ? 'fail' : 'ok';
      render();
      if (!r.failed) fetchFillers();
    }

    // fillery: długie serie z Obejrzanych, po jednym zapytaniu do Jikan na 100 odcinków
    async function fetchFillers() {
      const seenE = Object.values(S.entries).filter(seen);
      const todo = Episodes.needScan(seenE);
      if (!todo.length) return;
      xs = { state: 'run', job: 'fill', done: 0, total: todo.length };
      updBanner();
      let r;
      try { r = await Episodes.scan(seenE, { alive: ctx.alive, onProgress: (dn, tt) => { xs.done = dn; xs.total = tt; updBanner(); } }); } catch { r = { failed: true }; }
      if (!ctx.alive()) return;
      xs.state = r.failed ? 'fail' : 'ok';
      render();
    }

    Promise.all([Extras.load(), Episodes.init()]).then(() => { render(); fetchExtras(); });
    ctx.el.innerHTML = `<div class="page stats nerd">${tabsHtml}${UI.skeletonRows(6)}</div>`;
    ctx.onLibrary(() => { if (last) render(); });
    ctx.on('favchars', () => { if (last) render(); });
  }

  return { page, compute, facts };
})();
