'use strict';
/* ==========================================================================
   Disboard — „Twój rok w anime”
   Podsumowanie jednego roku z historii oglądania: godziny, odcinki, tytuły,
   najdłuższa seria dni, rekordowy miesiąc i dzień, top anime, gatunki
   i studia, plus karta do zapisania jako obrazek PNG.
   Wszystko liczone lokalnie. Studia dociąga moduł Extras (AniList, pamięć
   podręczna 30 dni), tak jak w „Dla nerda”.
   ========================================================================== */

const YearRecap = (() => {
  const DAY = 86400e3;
  const MONTH_CAP = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
  const WD_IN = ['w poniedziałki', 'we wtorki', 'w środy', 'w czwartki', 'w piątki', 'w soboty', 'w niedziele'];
  const keyTs = (k) => new Date(`${k}T12:00:00`).getTime();
  const bounds = (y) => [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()];

  // lata, w których jest choć jeden odcinek z datą (plus bieżący), od najnowszego
  function years() {
    const set = new Set([new Date().getFullYear()]);
    for (const h of S.history) if (h.k === 'ep' && h.t && S.entries[h.m]) set.add(new Date(h.t).getFullYear());
    return [...set].sort((a, b) => b - a);
  }
  // do połowy stycznia podsumowujemy jeszcze poprzedni rok
  function defaultYear() {
    const now = new Date();
    const y = now.getFullYear();
    const ys = years();
    if (now.getMonth() === 0 && now.getDate() <= 15 && ys.includes(y - 1)) return y - 1;
    return y;
  }

  function minutesIn(y) {
    const [from, to] = bounds(y);
    let m = 0;
    for (const h of S.history) {
      if (h.k !== 'ep' || h.t < from || h.t >= to) continue;
      const e = S.entries[h.m];
      if (e) m += Lib.epDur(e) || 0;
    }
    return m;
  }

  /* ---------- obliczenia ----------
     Czas, odcinki, miesiące, top anime i gatunki: wszystkie odcinki z datą w tym roku
     (tak jak wykres „Czas oglądania rocznie”). Seria dni, rekordowy dzień i dzień
     tygodnia: tylko odcinki oznaczane na bieżąco, bez hurtowego zaznaczania i importu
     (tak jak w „Dla nerda”), bo inaczej jeden import robiłby „rekord”. */
  function compute(y, { extras = null } = {}) {
    const [from, to] = bounds(y);
    const per = new Map();
    const months = Array.from({ length: 12 }, () => ({ min: 0, eps: 0 }));
    const days = new Map();
    const wd = Array(7).fill(0);
    const firstEver = new Map(); // pierwszy obejrzany odcinek danego anime w całej historii
    let minutes = 0, eps = 0, pastEps = 0, noDur = 0;
    const finished = [];
    for (const h of S.history) {
      if (h.k === 'ep' && h.t && (!firstEver.has(h.m) || h.t < firstEver.get(h.m))) firstEver.set(h.m, h.t);
      if (!h.t || h.t < from || h.t >= to) continue;
      const e = S.entries[h.m];
      if (!e) continue;
      if (h.k === 'finish') { finished.push({ e, rw: h.s > 0, t: h.t }); continue; }
      if (h.k !== 'ep') continue;
      const d = Lib.epDur(e) || 0;
      if (!d) noDur++;
      eps++;
      minutes += d;
      const p = per.get(e.id) || { e, min: 0, eps: 0 };
      p.min += d; p.eps++;
      per.set(e.id, p);
      const dt = new Date(h.t);
      months[dt.getMonth()].min += d;
      months[dt.getMonth()].eps++;
      if (h.past) { pastEps++; continue; }
      if (h.bulk) continue;
      const k = dayKey(h.t);
      const o = days.get(k) || { min: 0, eps: 0 };
      o.min += d; o.eps++;
      days.set(k, o);
      wd[(dt.getDay() + 6) % 7] += d;
    }
    const top = [...per.values()].sort((a, b) => b.min - a.min || b.eps - a.eps);

    // najdłuższa seria dni z rzędu (w obrębie roku)
    let streak = null, run = null;
    for (const k of [...days.keys()].sort()) {
      if (run && Math.round((keyTs(k) - keyTs(run.to)) / DAY) === 1) { run.to = k; run.len++; }
      else run = { from: k, to: k, len: 1 };
      if (!streak || run.len > streak.len) streak = { ...run };
    }
    let recordDay = null;
    for (const [k, v] of days) if (!recordDay || v.min > recordDay.min) recordDay = { k, ...v };
    let recordMonth = null;
    months.forEach((m, i) => { if (m.min > 0 && (!recordMonth || m.min > recordMonth.min)) recordMonth = { i, ...m }; });
    const wdSum = wd.reduce((a, b) => a + b, 0);
    const favWd = wdSum ? wd.indexOf(Math.max(...wd)) : null;

    // gatunki i studia ważone czasem obejrzanym w tym roku
    const genres = new Map();
    for (const p of top) for (const g of (p.e.media.genres || [])) genres.set(g, (genres.get(g) || 0) + p.min);
    const studios = new Map();
    let withX = 0;
    if (extras) {
      for (const p of top) {
        const x = extras[p.e.id];
        if (!x || x.missing) continue;
        withX++;
        for (const s of (x.studios || [])) {
          const o = studios.get(s.id) || { id: s.id, n: s.n, min: 0, c: 0 };
          o.min += p.min; o.c++;
          studios.set(s.id, o);
        }
      }
    }

    const done = new Map(); // ukończone w tym roku (ostatnie ukończenie danego tytułu)
    for (const f of finished) done.set(f.e.id, f);
    const doneList = [...done.values()];
    const rated = doneList.filter((f) => f.e.score != null).sort((a, b) => b.e.score - a.e.score || (per.get(b.e.id)?.min || 0) - (per.get(a.e.id)?.min || 0));
    const prevMin = minutesIn(y - 1);

    return {
      year: y, minutes, eps, pastEps, noDur,
      titles: per.size,
      newTitles: top.filter((p) => { const f = firstEver.get(p.e.id); return f >= from && f < to; }).length,
      completed: doneList.filter((f) => !f.rw).length,
      rewatched: doneList.filter((f) => f.rw).length,
      best: rated[0] || null,
      top, months, streak, recordDay, recordMonth, favWd,
      activeDays: days.size,
      genres: [...genres.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
      studios: [...studios.values()].sort((a, b) => b.min - a.min || b.c - a.c),
      withX,
      prevMin,
      change: prevMin > 0 ? (minutes - prevMin) / prevMin : null,
    };
  }

  /* ---------- karta do zapisania jako obrazek ---------- */
  const loadImg = (src) => new Promise((res) => {
    if (!src) { res(null); return; }
    const im = new Image();
    im.crossOrigin = 'anonymous'; // bez zgody serwera okładka się nie wczyta, a karta da się zapisać bez niej
    const t = setTimeout(() => res(null), 4000);
    im.onload = () => { clearTimeout(t); res(im); };
    im.onerror = () => { clearTimeout(t); res(null); };
    im.src = src;
  });
  // „212 godzin”, „1,5 godziny”: od 10 godzin bez ułamka
  const hours = (min) => (min >= 600 ? NF.format(Math.round(min / 60)) : NF1.format(min / 60));
  const hoursUnit = (min) => unit(min >= 600 ? Math.round(min / 60) : Math.round(min / 6) / 10, 'hour');

  async function drawCard(R, { covers = true } = {}) {
    const W = 1080, H = 1350, P = 72;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const v = (k, fb) => css.getPropertyValue(k).trim() || fb;
    const C = {
      ink: v('--ink', '#0c0914'), s1: v('--surface', '#141021'), s2: v('--surface-2', '#1b1630'), line: v('--line-2', '#3a3159'),
      text: v('--text', '#f2eeff'), text2: v('--text-2', '#c4bddb'), muted: v('--muted', '#9a92b5'), faint: v('--faint', '#6c6588'),
      sora: v('--sora', '#ff4f8b'), shiro: v('--shiro', '#5fe3e0'), crown: v('--crown', '#ffc65c'), viz1: v('--viz-1', '#1f9fa8'),
    };
    const F = { disp: v('--f-display', 'sans-serif'), body: v('--f-body', 'sans-serif'), data: v('--f-data', 'monospace') };
    try {
      await Promise.race([
        Promise.all([document.fonts.load(`120px ${F.disp}`), document.fonts.load(`700 40px ${F.body}`), document.fonts.load(`600 40px ${F.data}`)]),
        sleep(2500),
      ]);
    } catch { /* zostaną czcionki systemowe */ }

    const rr = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
    const font = (f) => { g.font = f; };
    const fit = (txt, maxW) => {
      let t = String(txt);
      if (g.measureText(t).width <= maxW) return t;
      while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
      return `${t.trimEnd()}…`;
    };
    const text = (t, x, y, { color = C.text, f, align = 'left', maxW = W - 2 * P } = {}) => {
      if (f) font(f);
      g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
      g.fillText(fit(t, maxW), x, y);
      return g.measureText(fit(t, maxW)).width;
    };

    // tło: atrament motywu i dwie poświaty
    g.fillStyle = C.ink; g.fillRect(0, 0, W, H);
    const glow = (x, y, r, col, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, col); gr.addColorStop(1, 'transparent');
      g.globalAlpha = a; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    };
    glow(80, 60, 760, C.sora, 0.32);
    glow(W - 40, H - 80, 700, C.shiro, 0.2);
    g.strokeStyle = C.line; g.lineWidth = 2; rr(24, 24, W - 48, H - 48, 36); g.stroke();

    // nagłówek
    if ('letterSpacing' in g) g.letterSpacing = '6px';
    text('DISBOARD', P, 118, { color: C.muted, f: `600 26px ${F.data}` });
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    text('Mój rok w anime', P, 196, { color: C.text2, f: `700 46px ${F.body}` });
    text(String(R.year), P - 6, 340, { color: C.crown, f: `150px ${F.disp}` });

    // godziny
    const hw = text(hours(R.minutes), P, 486, { f: `118px ${F.disp}` });
    text(hoursUnit(R.minutes), P + hw + 20, 486, { color: C.muted, f: `700 40px ${F.body}` });
    text(`${nUnit(R.eps, 'episode')} · ${nUnit(R.titles, 'title')} · ukończone: ${NF.format(R.completed)}`, P, 548, { color: C.text2, f: `500 32px ${F.body}` });

    // cztery kafelki
    const studio = R.studios[0];
    const tiles = [
      ['Najdłuższa seria', R.streak ? nUnit(R.streak.len, 'day') : '—'],
      ['Rekordowy miesiąc', R.recordMonth ? `${MONTH_CAP[R.recordMonth.i]} · ${hours(R.recordMonth.min)} h` : '—'],
      ['Ulubiony gatunek', R.genres[0] ? R.genres[0][0] : '—'],
      studio ? ['Studio roku', studio.n] : ['Rekordowy dzień', R.recordDay ? `${hours(R.recordDay.min)} h · ${DF.dm.format(new Date(keyTs(R.recordDay.k)))}` : '—'],
    ];
    const tw = (W - 2 * P - 24) / 2, th = 118;
    tiles.forEach(([l, val], i) => {
      const x = P + (i % 2) * (tw + 24), y = 600 + Math.floor(i / 2) * (th + 20);
      g.fillStyle = C.s1; g.globalAlpha = 0.82; rr(x, y, tw, th, 22); g.fill(); g.globalAlpha = 1;
      g.strokeStyle = C.line; g.lineWidth = 1.5; rr(x, y, tw, th, 22); g.stroke();
      text(l, x + 26, y + 44, { color: C.muted, f: `500 24px ${F.body}`, maxW: tw - 52 });
      text(val, x + 26, y + 92, { color: C.text, f: `600 36px ${F.data}`, maxW: tw - 52 });
    });

    // top 3 anime
    text('Najwięcej czasu', P, 910, { color: C.muted, f: `700 26px ${F.body}` });
    const top3 = R.top.slice(0, 3);
    const imgs = covers ? await Promise.all(top3.map((p) => loadImg(p.e.media.coverImage && (p.e.media.coverImage.large || p.e.media.coverImage.extraLarge)))) : [];
    top3.forEach((p, i) => {
      const y = 934 + i * 106, cw = 66, ch = 92;
      text(String(i + 1), P, y + 62, { color: C.crown, f: `44px ${F.disp}` });
      const cx = P + 52;
      g.save(); rr(cx, y, cw, ch, 12); g.clip();
      if (imgs[i]) {
        const s = Math.max(cw / imgs[i].width, ch / imgs[i].height);
        g.drawImage(imgs[i], cx + (cw - imgs[i].width * s) / 2, y + (ch - imgs[i].height * s) / 2, imgs[i].width * s, imgs[i].height * s);
      } else { g.fillStyle = p.e.media.coverImage && p.e.media.coverImage.color ? p.e.media.coverImage.color : C.s2; g.fillRect(cx, y, cw, ch); }
      g.restore();
      const tx = cx + cw + 24;
      text(titleOf(p.e.media), tx, y + 42, { f: `700 34px ${F.body}`, maxW: W - P - tx });
      text(`${fmtDuration(p.min, { short: true, days: false })} · ${nUnit(p.eps, 'episode')}`, tx, y + 82, { color: C.muted, f: `500 26px ${F.body}`, maxW: W - P - tx });
    });

    text(`Disboard · ${DF.day.format(new Date())}`, P, H - 50, { color: C.faint, f: `500 22px ${F.body}` });
    return cv;
  }

  const toBlob = (cv) => new Promise((res, rej) => { try { cv.toBlob((b) => (b ? res(b) : rej(new Error('Nie udało się utworzyć obrazka.'))), 'image/png'); } catch (e) { rej(e); } });
  // okładki z innej domeny mogą zablokować zapis obrazka: wtedy karta bez nich
  async function cardBlob(R) {
    try { return await toBlob(await drawCard(R)); } catch { return toBlob(await drawCard(R, { covers: false })); }
  }

  /* ---------- ekran ---------- */
  function page(ctx, tabsHtml) {
    ctx.title('Twój rok w anime');
    const ys = years();
    const q = Number(ctx.query.get('r'));
    let year = ys.includes(q) ? q : defaultYear();
    let xs = { state: 'idle', done: 0, total: 0 };
    let blobUrl = null;
    ctx.onLeave(() => { if (blobUrl) URL.revokeObjectURL(blobUrl); });

    const pct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${NF.format(Math.abs(Math.round(v * 100)))}%`;
    const tile = (label, value, note = '') => `<div class="nt"><div class="nt-top"><span class="lbl">${label}</span></div><div class="nt-v">${value}</div>${note ? `<p class="nt-n">${note}</p>` : ''}</div>`;
    const none = '<span class="nt-none">brak danych</span>';
    const dShort = (k) => esc(DF.dm.format(new Date(keyTs(k))));

    function render() {
      if (!ctx.alive()) return;
      const R = compute(year, { extras: Extras.all() });
      const yearBtns = ys.slice(0, 8).map((y) => `<button type="button" data-year="${y}" class="${y === year ? 'on' : ''}"${y === year ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${y}</button>`).join('');
      const head = `${tabsHtml}<div class="yr-bar"><div class="seg" role="group" aria-label="Rok">${yearBtns}</div></div>`;
      if (!R.eps) {
        ctx.el.innerHTML = `<div class="page stats yr">${head}${UI.empty(`Brak odcinków z datą w ${year}`, year === new Date().getFullYear() ? 'Podsumowanie wypełni się samo, gdy zaczniesz oznaczać odcinki na bieżąco.' : 'W tym roku nie ma w historii żadnych obejrzanych odcinków z datą.')}</div>`;
        bindYears();
        return;
      }
      const xNote = xs.state === 'run' ? `Pobieram dane o studiach z AniList… ${xs.done}/${xs.total}` : xs.state === 'fail' ? 'AniList nie odpowiada, studia uzupełnią się później.' : '';
      ctx.el.innerHTML = `<div class="page stats yr">
        ${head}
        <section class="stat-hero yr-hero">
          <div class="stat-big"><span class="lbl">Twój rok ${year} w anime</span><b class="num">${esc(hours(R.minutes))} ${hoursUnit(R.minutes)}</b>
            <p class="yr-sub">czyli ${esc(fmtDuration(R.minutes))} bez przerwy${R.change != null ? ` · <span class="${R.change >= 0 ? 'yr-up' : 'yr-down'}">${pct(R.change)} względem ${year - 1}</span>` : ''}</p></div>
          <dl class="stat-units">
            <div><dt>odcinki</dt><dd class="num">${NF.format(R.eps)}</dd></div>
            <div><dt>tytuły</dt><dd class="num">${NF.format(R.titles)} <small>(${NF.format(R.newTitles)} nowych)</small></dd></div>
            <div><dt>ukończone</dt><dd class="num">${NF.format(R.completed)}${R.rewatched ? ` <small>+ ${nUnit(R.rewatched, 'rewatch')}</small>` : ''}</dd></div>
            <div><dt>dni z anime</dt><dd class="num">${NF.format(R.activeDays)}</dd></div>
            <div><dt>średnio dziennie</dt><dd class="num">${esc(fmtDuration(R.minutes / daysIn(year), { short: true }))}</dd></div>
          </dl>
        </section>
        <div class="ntiles">
          ${tile('Najdłuższa seria dni', R.streak ? `<b class="num">${nUnit(R.streak.len, 'day')}</b>` : none, R.streak ? `${dShort(R.streak.from)} – ${dShort(R.streak.to)}` : 'Liczą się odcinki oznaczane na bieżąco.')}
          ${tile('Rekordowy miesiąc', R.recordMonth ? `<b>${MONTH_CAP[R.recordMonth.i]}</b>` : none, R.recordMonth ? `${esc(fmtDuration(R.recordMonth.min, { short: true }))} · ${nUnit(R.recordMonth.eps, 'episode')}` : '')}
          ${tile('Rekordowy dzień', R.recordDay ? `<b class="num">${esc(fmtDuration(R.recordDay.min, { short: true }))}</b>` : none, R.recordDay ? `${dShort(R.recordDay.k)} · ${nUnit(R.recordDay.eps, 'episode')}` : '')}
          ${tile('Najczęściej oglądasz', R.favWd != null ? `<b>${WD_IN[R.favWd]}</b>` : none)}
          ${tile('Najwyżej ocenione ukończone', R.best ? `<a href="#/anime/${R.best.e.id}">${esc(titleOf(R.best.e.media))}</a>` : none, R.best ? `ocena ${NF1.format(R.best.e.score)}` : 'Oceń ukończone tytuły, a pojawi się tutaj.')}
          ${tile('Studio roku', R.studios[0] ? `<b>${esc(R.studios[0].n)}</b>` : `<span class="nt-none">${xs.state === 'run' ? 'pobieram…' : 'brak danych'}</span>`, R.studios[0] ? `${esc(fmtDuration(R.studios[0].min, { short: true }))} · ${nUnit(R.studios[0].c, 'title')}` : '')}
        </div>
        <div class="stats-grid">
          <section class="card span2"><h2 class="card-h">Miesiąc po miesiącu</h2><p class="card-sub">Godziny w ${year}</p><div id="y-month"></div></section>
          <section class="card"><h2 class="card-h">Najwięcej czasu</h2><p class="card-sub">Top anime roku, z rewatchami</p><div id="y-top"></div></section>
          <section class="card"><h2 class="card-h">Gatunki</h2><p class="card-sub">Według czasu w ${year}</p><div id="y-genre"></div></section>
          <section class="card"><h2 class="card-h">Studia</h2><p class="card-sub">Główne studio animacji, według czasu</p><div id="y-studio"></div>${xNote ? `<p class="src-note">${esc(xNote)}</p>` : ''}</section>
          <section class="card yr-share"><h2 class="card-h">Karta do zapisania</h2><p class="card-sub">Obrazek PNG z podsumowaniem, np. do wysłania znajomym.</p>
            <div class="yr-card" id="y-card"><div class="skel yr-skel"></div></div>
            <div class="btn-row"><button class="btn" type="button" id="y-save" disabled>${ICON.download || ''}Zapisz obrazek</button>${typeof ClipboardItem !== 'undefined' ? '<button class="btn ghost" type="button" id="y-copy" disabled>Kopiuj obrazek</button>' : ''}</div>
          </section>
        </div>
        <p class="src-note">Liczone z historii oglądania: odcinki z datą w ${year}${R.pastEps ? ` (w tym ${nUnit(R.pastEps, 'episode')} z importu albo dopisanych z datą ukończenia)` : ''}. Seria dni, rekordowy dzień i dzień tygodnia biorą tylko odcinki oznaczane na bieżąco, tak jak w „Dla nerda”.${R.noDur ? ` ${nUnit(R.noDur, 'episode')} nie ma długości w AniList i nie liczy się do czasu.` : ''}</p>
      </div>`;

      Charts.columns($('#y-month'), { data: R.months.map((m, i) => ({ label: `${MONTH_CAP[i]} ${year}`, short: MONTHS_SHORT[i], value: m.min / 60, tip: `${fmtDuration(m.min) || '0 minut'} · ${NF.format(m.eps)} odc.`, hl: R.recordMonth && R.recordMonth.i === i })), format: (x) => `${NF1.format(x)} godz.`, axisFormat: (x) => NF1.format(x), unitLabel: 'Czas oglądania (godz.)', color: 'var(--viz-1)', empty: 'Brak danych.' });
      Charts.hbars($('#y-top'), { data: R.top.slice(0, 8).map((p) => ({ label: titleOf(p.e.media), value: p.min || p.eps, text: p.min ? fmtDuration(p.min, { short: true }) : `${p.eps} odc.`, href: `#/anime/${p.e.id}` })), color: 'var(--viz-2)', header: ['Anime', 'Czas'], empty: 'Brak danych.' });
      Charts.hbars($('#y-genre'), { data: R.genres.slice(0, 8).map(([gn, m]) => ({ label: gn, value: m, text: fmtDuration(m, { short: true }) })), color: 'var(--viz-1)', header: ['Gatunek', 'Czas'], empty: 'Brak danych o gatunkach.' });
      Charts.hbars($('#y-studio'), { data: R.studios.slice(0, 6).map((s) => ({ label: s.n, value: s.min, text: `${fmtDuration(s.min, { short: true })} · ${nUnit(s.c, 'title')}` })), color: 'var(--viz-2)', header: ['Studio', 'Czas'], empty: xs.state === 'run' ? 'Pobieram dane z AniList…' : 'Brak danych o studiach.' });
      bindYears();
      makeCard(R);
    }

    let cardJob = 0;
    async function makeCard(R) {
      const job = ++cardJob;
      let blob;
      try { blob = await cardBlob(R); } catch (err) {
        if (ctx.alive() && job === cardJob) { const h = $('#y-card'); if (h) h.innerHTML = `<p class="src-note">Nie udało się narysować karty: ${esc(err.message)}</p>`; }
        return;
      }
      if (!ctx.alive() || job !== cardJob) return;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(blob);
      const host = $('#y-card');
      if (!host) return;
      host.innerHTML = `<img src="${blobUrl}" alt="Karta: mój rok ${R.year} w anime, ${esc(hours(R.minutes))} godzin">`;
      const save = $('#y-save'), copy = $('#y-copy');
      save.disabled = false;
      save.onclick = () => downloadFile(`disboard-rok-${R.year}.png`, blob);
      if (copy) {
        copy.disabled = false;
        copy.onclick = async () => {
          try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Skopiowano obrazek. Wklej go np. w czacie.', { kind: 'ok' }); }
          catch { toast('Przeglądarka nie pozwoliła skopiować obrazka. Użyj „Zapisz obrazek”.', { kind: 'warn' }); }
        };
      }
    }

    function bindYears() {
      $$('[data-year]', ctx.el).forEach((b) => b.addEventListener('click', () => {
        year = Number(b.dataset.year);
        history.replaceState(null, '', `#/statystyki/rok?r=${year}`);
        render();
        fetchStudios();
      }));
    }

    // studia: dociągamy dane z AniList dla anime obejrzanych w tym roku
    async function fetchStudios() {
      const ids = compute(year).top.map((p) => p.e.id);
      if (!Extras.missing(ids).length) return;
      xs = { state: 'run', done: 0, total: Extras.missing(ids).length };
      render();
      let r;
      try { r = await Extras.ensure(ids, { alive: ctx.alive, onProgress: (dn, tt) => { xs.done = dn; xs.total = tt; const n = $('#y-studio ~ .src-note'); if (n) n.textContent = `Pobieram dane o studiach z AniList… ${dn}/${tt}`; } }); } catch { r = { failed: true }; }
      if (!ctx.alive()) return;
      xs = { state: r.failed ? 'fail' : 'ok', done: 0, total: 0 };
      render();
    }

    ctx.el.innerHTML = `<div class="page stats yr">${tabsHtml}${UI.skeletonRows(5)}</div>`;
    Extras.load().then(() => { render(); fetchStudios(); });
    // zmiany na liście (np. „+1” w innej karcie): przeliczamy, ale nie przy każdym kliknięciu
    const later = debounce(() => { if (ctx.alive()) render(); }, 1500);
    ctx.onLibrary(later);
  }

  const daysIn = (y) => {
    const [from, to] = bounds(y);
    const end = Math.min(to, Date.now());
    return Math.max(1, Math.round((end - from) / DAY));
  };

  // na stronie głównej: w grudniu i do połowy stycznia zaproszenie do podsumowania
  function teaserHtml() {
    const now = new Date();
    const season = now.getMonth() === 11 || (now.getMonth() === 0 && now.getDate() <= 15);
    if (!season) return '';
    const y = defaultYear();
    const min = minutesIn(y);
    if (min < 60) return '';
    return `<a class="yr-teaser" href="#/statystyki/rok?r=${y}"><span class="yr-teaser-y">${y}</span><span><b>Twój rok w anime jest gotowy</b><small>${esc(hours(min))} ${hoursUnit(min)} oglądania · zobacz podsumowanie i zapisz kartę</small></span>${ICON.chevron || ''}</a>`;
  }

  return { compute, years, defaultYear, page, drawCard, cardBlob, teaserHtml };
})();
