'use strict';
/* ==========================================================================
   Disboard — Skaner kadrów (trace.moe)
   Zrzut ekranu → seria, odcinek i minuta. Wyniki uzupełnione danymi z AniList,
   więc od razu dodasz je na listę (klik, menu statusów albo „Oglądam od odc. N”).
   Licznik: dzienny limit trace.moe (okno 24 h, liczony dla adresu IP).
   ========================================================================== */

const ScanStore = (() => {
  const KEY = 'disboard.trace.v1';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12))); } catch { /* pełna pamięć: historia jest dodatkiem */ } };
  return {
    list: read,
    add(entry) { const l = read().filter((x) => x.id !== entry.id); l.unshift(entry); write(l); },
    clear() { write([]); },
  };
})();

Pages.scanner = (ctx) => {
  ctx.title('Skaner kadrów');
  const st = { img: null, phase: 'idle', hits: [], hidden18: 0, me: null, logTimers: [], shownFrom: null };

  const log24 = () => {
    const cut = Date.now() - 86400e3;
    S.meta.traceLog = (S.meta.traceLog || []).filter((t) => t > cut);
    return S.meta.traceLog;
  };
  const todayCount = () => log24().filter((t) => t >= startOfDay(Date.now())).length;

  ctx.el.innerHTML = `<div class="page scan-page">
    <header class="scan-head">
      <p class="scan-kicker">trace.moe · skaner kadrów</p>
      <h2 class="scan-title">Skąd ten kadr?</h2>
      <p class="scan-lead">Wrzuć zrzut ekranu z anime. Skaner znajdzie serię, odcinek i dokładną minutę, a wynik dodasz na listę jednym kliknięciem.</p>
    </header>
    <div class="scan-grid">
      <section class="scan-console" aria-label="Skaner">
        <div class="scan-strip" aria-hidden="true"><span class="led on"></span>PWR<span class="led" id="sc-led"></span>SCAN<span class="scan-model">DISBOARD · FRAME SCANNER</span></div>
        <div class="scan-screen" id="sc-screen" tabindex="0" role="button" aria-label="Wybierz obrazek z dysku albo upuść go tutaj">
          <input type="file" id="sc-file" accept="image/*" hidden>
          <div class="scan-idle" id="sc-idle">
            <span class="scan-ico">${ICON.image}</span>
            <p class="scan-blink">WRZUĆ KADR<span class="caret">_</span></p>
            <p class="scan-sub">kliknij, przeciągnij plik albo wklej <kbd>Ctrl</kbd>+<kbd>V</kbd></p>
          </div>
          <img id="sc-preview" alt="Wybrany kadr" hidden>
          <div class="scan-grid-fx" aria-hidden="true"></div>
          <div class="scan-beam" aria-hidden="true"></div>
          <i class="c tl" aria-hidden="true"></i><i class="c tr" aria-hidden="true"></i><i class="c bl" aria-hidden="true"></i><i class="c br" aria-hidden="true"></i>
          <button class="scan-clear icon-btn sm" type="button" id="sc-clear" aria-label="Usuń obrazek" hidden>${ICON.x}</button>
        </div>
        <div class="scan-controls">
          <label class="field grow"><span class="sr">Link do obrazka</span><input id="sc-url" type="url" inputmode="url" placeholder="…albo wklej link do obrazka" autocomplete="off"></label>
          <button class="scan-btn" type="button" id="sc-go" disabled>Skanuj</button>
        </div>
        <div class="scan-log" id="sc-log" aria-live="polite"><p>&gt; Gotowy. Czekam na kadr.</p></div>
      </section>
      <aside class="scan-meter" aria-label="Limit wyszukiwań">
        <p class="meter-l">Zostało skanów na dziś</p>
        <p class="meter-v"><b id="sc-left">--</b><small>/ <span id="sc-quota">--</span></small></p>
        <div class="pips" id="sc-pips" aria-hidden="true"></div>
        <dl class="meter-dl">
          <div><dt>Użyte w ostatnich 24 h</dt><dd id="sc-used">--</dd></div>
          <div><dt>Twoje skany dzisiaj</dt><dd id="sc-today">${todayCount()}</dd></div>
          <div><dt>Najbliższy skan wróci</dt><dd id="sc-renew">—</dd></div>
        </dl>
        <p class="meter-note">Limit liczy trace.moe dla Twojego adresu IP w oknie 24 godzin, więc wlicza też wyszukiwania z innych stron w tej samej sieci.</p>
      </aside>
    </div>
    <section class="scan-results" id="sc-results" aria-live="polite"></section>
    <section class="scan-history" id="sc-history"></section>
  </div>`;

  const screen = $('#sc-screen'), fileIn = $('#sc-file'), urlIn = $('#sc-url'), goBtn = $('#sc-go');

  /* ---------- licznik ---------- */
  function renderMeter(consumed = false) {
    const me = st.me;
    const quota = me ? me.quota : null;
    const used = me ? me.quotaUsed : null;
    const left = me ? Math.max(0, quota - used) : null;
    $('#sc-left').textContent = left == null ? '--' : String(left);
    $('#sc-quota').textContent = quota == null ? '--' : String(quota);
    $('#sc-used').textContent = used == null ? '--' : String(used);
    $('#sc-today').textContent = String(todayCount());
    const l = log24();
    $('#sc-renew').textContent = l.length ? `o ${fmtTime(l[0] + 86400e3)}${new Date(l[0] + 86400e3).getDate() !== new Date().getDate() ? ' (jutro)' : ''}` : 'pełna pula';
    $('.meter-v').classList.toggle('low', left != null && left <= 10);
    const pips = $('#sc-pips');
    if (quota) {
      const n = Math.min(quota, 200);
      pips.style.setProperty('--cols', n > 100 ? 25 : 20);
      pips.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < left ? 'on' : ''}${consumed && i === left ? ' eat' : ''}"></i>`).join('');
    }
    goBtn.disabled = !(st.img && st.phase !== 'scanning') || left === 0;
  }
  async function loadMe() {
    try { st.me = await Trace.me(); } catch { st.me = null; }
    if (ctx.alive()) renderMeter();
  }

  /* ---------- log w stylu terminala ---------- */
  const logBox = $('#sc-log');
  function log(line, cls = '') {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    p.textContent = `> ${line}`;
    logBox.append(p);
    while (logBox.children.length > 7) logBox.firstChild.remove();
  }
  const clearLog = () => { logBox.innerHTML = ''; st.logTimers.forEach(clearTimeout); st.logTimers = []; };

  /* ---------- wybór obrazka ---------- */
  async function prepare(file) {
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch { /* format nieobsługiwany przez przeglądarkę — wyślemy oryginał */ }
    if (!bmp) return { blob: file, thumb: null, w: 0, h: 0 };
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const t = document.createElement('canvas');
    const tk = 240 / Math.max(bmp.width, bmp.height);
    t.width = Math.round(bmp.width * tk); t.height = Math.round(bmp.height * tk);
    t.getContext('2d').drawImage(bmp, 0, 0, t.width, t.height);
    return { blob: blob || file, thumb: t.toDataURL('image/jpeg', 0.7), w: bmp.width, h: bmp.height };
  }

  async function setFile(file) {
    if (!file || !/^image\//.test(file.type || 'image/')) { toast('To nie wygląda na obrazek. Wybierz PNG, JPG, WEBP albo GIF.', { kind: 'warn' }); return; }
    if (file.size > 25 * 1024 * 1024) { toast('Plik ma ponad 25 MB. Zrób mniejszy zrzut ekranu.', { kind: 'warn' }); return; }
    const prep = await prepare(file);
    if (!ctx.alive()) return;
    if (st.img && st.img.objectUrl) URL.revokeObjectURL(st.img.objectUrl);
    st.img = { ...prep, name: file.name || 'schowek', objectUrl: URL.createObjectURL(prep.blob) };
    urlIn.value = '';
    showPreview(st.img.objectUrl);
    clearLog();
    log(`Kadr gotowy: ${prep.w ? `${prep.w}×${prep.h} px` : st.img.name}. Naciśnij Skanuj albo Enter.`);
  }
  function setUrl(u) {
    u = String(u || '').trim();
    if (!/^https?:\/\/\S+$/i.test(u)) { st.img = null; showPreview(null); return; }
    st.img = { remote: u, thumb: null };
    showPreview(u);
    clearLog();
    log('Link do obrazka gotowy. Naciśnij Skanuj albo Enter.');
  }
  function showPreview(src) {
    const img = $('#sc-preview');
    img.hidden = !src;
    if (src) { img.src = src; img.onerror = () => { log('Nie mogę wyświetlić podglądu, ale spróbuję zeskanować.', 'warn'); }; } else img.removeAttribute('src');
    $('#sc-idle').hidden = !!src;
    $('#sc-clear').hidden = !src;
    screen.classList.toggle('has-img', !!src);
    st.phase = src ? 'ready' : 'idle';
    renderMeter();
  }

  /* ---------- skanowanie ---------- */
  const fmtT = (sec) => {
    if (sec == null || !Number.isFinite(sec)) return '—';
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  };
  const epNum = (ep) => (typeof ep === 'number' && Number.isFinite(ep) ? ep : (typeof ep === 'string' && /^\d+$/.test(ep) ? Number(ep) : null));
  const tier = (sim) => (sim >= 0.95 ? ['sure', 'PEWNE'] : sim >= 0.9 ? ['likely', 'PRAWDOPODOBNE'] : ['weak', 'NIEPEWNE']);

  async function scan() {
    if (!st.img || st.phase === 'scanning') return;
    if (st.me && st.me.quota - st.me.quotaUsed <= 0) { toast('Dzienny limit skanów jest wyczerpany. Licznik odnawia się w ciągu 24 godzin.', { kind: 'warn' }); return; }
    st.phase = 'scanning';
    screen.classList.add('scanning');
    $('#sc-led').classList.add('on');
    goBtn.disabled = true;
    goBtn.textContent = 'Skanuję…';
    clearLog();
    log(st.img.remote ? 'Pobieram obrazek z linku…' : 'Wysyłam kadr do trace.moe…');
    st.logTimers.push(setTimeout(() => log('Wycinam czarne ramki…'), 700));
    st.logTimers.push(setTimeout(() => log('Przeszukuję bazę klatek anime…'), 1500));
    st.logTimers.push(setTimeout(() => log('Porównuję kolory i układ kadru…'), 3200));
    try {
      const res = await Trace.search(st.img.remote || st.img.blob);
      S.meta.traceLog = [...log24(), Date.now()];
      save();
      const hits = await enrich(res.result);
      if (!ctx.alive()) return;
      st.logTimers.forEach(clearTimeout);
      st.hits = hits.visible;
      st.hidden18 = hits.hidden;
      st.shownFrom = null;
      const top = st.hits[0];
      if (top) {
        log(`Trafienie ${NF1.format(top.sim * 100)}% · ${titleOf(top.m)}${top.ep != null ? `, odc. ${top.ep}` : ''}, ${fmtT(top.at ?? top.from)}`, top.sim >= 0.9 ? 'ok' : 'warn');
        ScanStore.add({ id: uid(), t: Date.now(), thumb: st.img.thumb, remote: st.img.remote || null, hits: st.hits.slice(0, 5).map(compact) });
      } else log(hits.hidden ? 'Pasują tylko pozycje 18+, ukryte w Ustawieniach.' : 'Brak dopasowań. Spróbuj innego kadru bez napisów i ramek.', 'warn');
      renderResults();
      renderHistory();
      st.me = st.me ? { ...st.me, quotaUsed: st.me.quotaUsed + 1 } : st.me;
      renderMeter(true);
      loadMe();
    } catch (err) {
      if (!ctx.alive()) return;
      st.logTimers.forEach(clearTimeout);
      log(err.message, 'bad');
      if (err.kind === 'quota') loadMe();
    } finally {
      if (ctx.alive()) {
        screen.classList.remove('scanning');
        $('#sc-led').classList.remove('on');
        goBtn.textContent = 'Skanuj';
        st.phase = st.img ? 'ready' : 'idle';
        renderMeter();
      }
    }
  }

  // wyniki trace.moe + pełne dane z AniList (okładka, odcinki, format) do dodawania na listę
  async function enrich(result) {
    const raw = result.map((r) => {
      const a = r.anilist;
      const aid = typeof a === 'object' && a ? a.id : Number(a);
      return { r, aid, a: typeof a === 'object' ? a : null };
    }).filter((x) => x.aid);
    const ids = [...new Set(raw.map((x) => x.aid))];
    let byId = new Map();
    if (ids.length) {
      try { byId = new Map((await Ani.byIds(ids)).media.map((m) => [m.id, m])); } catch { /* AniList niedostępny: użyjemy danych z trace.moe */ }
    }
    const seen = new Map();
    for (const { r, aid, a } of raw) {
      const m = byId.get(aid) || { id: aid, idMal: a && a.idMal, title: (a && a.title) || { romaji: r.filename }, synonyms: (a && a.synonyms) || [], isAdult: !!(a && a.isAdult), coverImage: {} };
      if (byId.get(aid)) UI.remember(m);
      const hit = { m, full: !!byId.get(aid), ep: epNum(r.episode), from: r.from, to: r.to, at: r.at ?? null, sim: r.similarity || 0, video: r.video, image: r.image };
      const k = `${aid}:${hit.ep}`;
      if (!seen.has(k) || seen.get(k).sim < hit.sim) seen.set(k, hit);
    }
    const all = [...seen.values()].sort((x, y) => y.sim - x.sim);
    const visible = all.filter((h) => S.settings.adult || !h.m.isAdult);
    return { visible, hidden: all.length - visible.length };
  }
  const compact = (h) => ({ m: { id: h.m.id, title: h.m.title, coverImage: h.m.coverImage, format: h.m.format, episodes: h.m.episodes, seasonYear: h.m.seasonYear, isAdult: h.m.isAdult }, full: h.full, ep: h.ep, from: h.from, to: h.to, at: h.at, sim: h.sim, image: h.image });

  /* ---------- wyniki ---------- */
  function actions(h) {
    const e = Lib.get(h.m.id);
    const canWatch = h.ep != null && h.ep >= 1;
    const add = e
      ? `<button class="hit-status st-${e.status}" type="button" data-qmenu="${h.m.id}" aria-haspopup="menu">${esc(LSTATUS_PL[e.status])}${e.status === 'watching' ? ` · ${Lib.cur(e).progress}/${Lib.epTotal(e) || '?'}` : ''}${ICON.chevron}</button>`
      : `<button class="btn" type="button" data-add="${h.m.id}" data-status="planning" data-quick="1" aria-haspopup="menu" title="Klik: ${esc(LSTATUS_PL[UI.quickStatus('planning')])} · najedź: wybierz status">${ICON.plus}Dodaj do listy</button>`;
    return `${h.full ? add : ''}
      ${canWatch && h.full ? `<button class="btn ghost" type="button" data-hit-watch="${h.m.id}" data-ep="${h.ep}">${ICON.play}Oglądam od odc. ${h.ep}</button>` : ''}
      <a class="btn ghost" href="#/anime/${h.m.id}">Szczegóły ${ICON.chevron}</a>`;
  }

  function heroHtml(h) {
    const [tc, tl] = tier(h.sim);
    const m = h.m;
    const meta = [m.format ? (FORMAT_PL[m.format] || m.format) : null, UI.yearOf(m), m.episodes ? nUnit(m.episodes, 'episode') : null].filter(Boolean).join(' · ');
    return `<article class="hit tier-${tc}" data-id="${m.id}">
      <div class="hit-media">
        ${h.video && !st.shownFrom ? `<video src="${esc(h.video)}${h.video.includes('?') ? '&' : '?'}size=m" poster="${esc(h.image || '')}" autoplay muted loop playsinline preload="metadata"></video>` : (h.image ? `<img src="${esc(h.image)}" alt="" onerror="this.remove()">` : '')}
        <span class="hit-time num">${h.ep != null ? `odc. ${h.ep} · ` : ''}${fmtT(h.at ?? h.from)}</span>
      </div>
      <div class="hit-info">
        <div class="hit-score"><b class="num">${NF1.format(h.sim * 100)}%</b><span class="hit-tier">${tl}</span></div>
        <div class="hit-bar"><i style="width:${Math.max(2, h.sim * 100)}%"></i></div>
        <div class="hit-id">${UI.cover(m, 'sm')}<div>
          <a class="hit-title" href="#/anime/${m.id}">${esc(titleOf(m))}${m.isAdult ? ' <b class="adult">18+</b>' : ''}</a>
          ${m.title && m.title.native && m.title.native !== titleOf(m) ? `<p class="hit-native" lang="ja">${esc(m.title.native)}</p>` : ''}
          ${meta ? `<p class="hit-meta">${esc(meta)}</p>` : ''}
        </div></div>
        <p class="hit-where">${h.ep != null ? `Odcinek <b>${h.ep}</b>` : 'Film lub odcinek specjalny'} · moment <b class="num">${fmtT(h.from)}–${fmtT(h.to)}</b></p>
        ${h.sim < 0.9 ? '<p class="hit-warn">Podobieństwo poniżej 90% zwykle oznacza błędne dopasowanie. Spróbuj kadru bez napisów, logo i czarnych pasów.</p>' : ''}
        <div class="hit-actions">${actions(h)}</div>
      </div>
    </article>`;
  }

  function otherHtml(h) {
    const [tc] = tier(h.sim);
    return `<li class="hit-row tier-${tc}">
      ${h.image ? `<img class="hit-thumb" src="${esc(h.image)}" alt="" loading="lazy" onerror="this.remove()">` : '<span class="hit-thumb"></span>'}
      <div class="hit-row-main"><a href="#/anime/${h.m.id}">${esc(titleOf(h.m))}${h.m.isAdult ? ' <b class="adult">18+</b>' : ''}</a><small>${h.ep != null ? `odc. ${h.ep} · ` : ''}${fmtT(h.at ?? h.from)}</small></div>
      <b class="num hit-row-sim">${NF1.format(h.sim * 100)}%</b>
      <div class="hit-row-act">${actions(h)}</div>
    </li>`;
  }

  function renderResults() {
    const box = $('#sc-results');
    if (!st.hits.length) {
      box.innerHTML = st.phase === 'scanning' ? '' : (st.hidden18 ? UI.empty('Wyniki ukryte', `Pasujące pozycje 18+: ${st.hidden18}. Włączysz je w Ustawieniach → Wyświetlanie.`) : '');
      return;
    }
    const [top, ...rest] = st.hits;
    box.innerHTML = `
      ${st.shownFrom ? `<p class="scan-from">Wynik z historii: ${esc(fmtDateTime(st.shownFrom))}. Nie zużył limitu.</p>` : ''}
      ${heroHtml(top)}
      ${rest.length ? `<h3 class="sub-h">Inne możliwe dopasowania</h3><ul class="hit-rows">${rest.slice(0, 4).map(otherHtml).join('')}</ul>` : ''}
      ${st.hidden18 ? `<p class="src-note">Ukryto ${st.hidden18} ${plural(st.hidden18, 'pozycję', 'pozycje', 'pozycji')} 18+ (Ustawienia → Wyświetlanie).</p>` : ''}`;
    // podgląd wideo wygasa po czasie — wtedy zostaje statyczny kadr
    $$('.hit-media video', box).forEach((v) => v.addEventListener('error', () => {
      if (!top.image) { v.remove(); return; }
      const img = document.createElement('img');
      img.src = top.image; img.alt = '';
      v.replaceWith(img);
    }));
  }

  function renderHistory() {
    const list = ScanStore.list();
    const box = $('#sc-history');
    box.innerHTML = list.length ? UI.section('Ostatnie skany', `
      <div class="scan-hist">${list.map((x) => {
        const h = x.hits[0];
        return `<button type="button" class="hist-card" data-hist="${esc(x.id)}">
          ${x.thumb ? `<img src="${x.thumb}" alt="">` : (h && h.image ? `<img src="${esc(h.image)}" alt="" onerror="this.remove()">` : '<span class="hist-noimg"></span>')}
          <span class="hist-t">${h ? esc(titleOf(h.m)) : 'Brak dopasowań'}</span>
          <small>${h ? `${h.ep != null ? `odc. ${h.ep} · ` : ''}${NF1.format(h.sim * 100)}%` : ''} · ${esc(relTime(x.t))}</small>
        </button>`;
      }).join('')}</div>
      <button class="btn ghost sm" type="button" id="sc-hclear">${ICON.trash}Wyczyść historię</button>`, { sub: 'Zapisane tylko w tej przeglądarce. Ponowne otwarcie wyniku nie zużywa limitu.' }) : '';
    $$('[data-hist]', box).forEach((b) => b.addEventListener('click', async () => {
      const x = ScanStore.list().find((y) => y.id === b.dataset.hist);
      if (!x) return;
      // pełne dane z AniList (z pamięci podręcznej), żeby dało się od razu dodawać na listę
      const ids = [...new Set(x.hits.map((h) => h.m.id))];
      let byId = new Map();
      try { byId = new Map((await Ani.byIds(ids)).media.map((m) => [m.id, m])); } catch { /* bez sieci: pokażemy dane z historii */ }
      if (!ctx.alive()) return;
      st.hits = x.hits.map((h) => {
        const m = byId.get(h.m.id) || UI.media.get(h.m.id) || (Lib.get(h.m.id) && Lib.get(h.m.id).media) || null;
        if (m) UI.remember(m);
        return { ...h, m: m || h.m, full: !!m };
      });
      st.hidden18 = 0;
      st.shownFrom = x.t;
      renderResults();
      $('#sc-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    const hc = $('#sc-hclear');
    if (hc) hc.addEventListener('click', () => { ScanStore.clear(); renderHistory(); toast('Wyczyszczono historię skanów.', { kind: 'ok' }); });
  }

  /* ---------- zdarzenia ---------- */
  screen.addEventListener('click', (ev) => { if (!ev.target.closest('#sc-clear') && st.phase !== 'scanning') fileIn.click(); });
  screen.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === screen) { ev.preventDefault(); if (st.img) scan(); else fileIn.click(); } });
  fileIn.addEventListener('change', () => { if (fileIn.files[0]) setFile(fileIn.files[0]); fileIn.value = ''; });
  $('#sc-clear').addEventListener('click', (ev) => { ev.stopPropagation(); st.img = null; showPreview(null); clearLog(); log('Gotowy. Czekam na kadr.'); });
  ['dragenter', 'dragover'].forEach((t) => screen.addEventListener(t, (ev) => { ev.preventDefault(); screen.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => screen.addEventListener(t, () => screen.classList.remove('drag')));
  screen.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) setFile(f);
    else { const u = ev.dataTransfer.getData('text/uri-list') || ev.dataTransfer.getData('text/plain'); if (u) { urlIn.value = u; setUrl(u); } }
  });
  urlIn.addEventListener('input', debounce(() => setUrl(urlIn.value), 250));
  urlIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); setUrl(urlIn.value); scan(); } });
  goBtn.addEventListener('click', scan);

  const onPaste = (ev) => {
    const items = ev.clipboardData ? [...ev.clipboardData.items] : [];
    const imgItem = items.find((i) => i.kind === 'file' && /^image\//.test(i.type));
    if (imgItem) { ev.preventDefault(); setFile(imgItem.getAsFile()); return; }
    if (ev.target === urlIn) return;
    const text = ev.clipboardData && ev.clipboardData.getData('text');
    if (text && /^https?:\/\//i.test(text.trim())) { ev.preventDefault(); urlIn.value = text.trim(); setUrl(text); }
  };
  const onKey = (ev) => {
    if (ev.key !== 'Enter' || !st.img || QuickAdd.isOpen()) return;
    if (ev.target.closest && ev.target.closest('input, textarea, select, button, a')) return;
    ev.preventDefault();
    scan();
  };
  document.addEventListener('paste', onPaste);
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => {
    document.removeEventListener('paste', onPaste);
    document.removeEventListener('keydown', onKey);
    if (st.img && st.img.objectUrl) URL.revokeObjectURL(st.img.objectUrl);
  });

  // „Oglądam od odc. N”: status Oglądam, obejrzane do odcinka N−1
  $('#sc-results').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-hit-watch]');
    if (!b) return;
    const aid = Number(b.dataset.hitWatch), ep = Number(b.dataset.ep);
    const m = UI.media.get(aid) || (Lib.get(aid) && Lib.get(aid).media);
    if (!m) return;
    if (!Lib.get(aid)) Lib.add(m, 'watching');
    else if (Lib.get(aid).status !== 'watching') Lib.setStatus(aid, 'watching');
    const e = Lib.get(aid);
    if (Lib.cur(e).progress < ep - 1) Lib.setProgress(aid, ep - 1);
    toast(`Oglądam: ${titleOf(m)} · obejrzane do odc. ${Lib.cur(Lib.get(aid)).progress}, następny: ${ep}`, { kind: 'ok' });
  });
  ctx.onLibrary(() => { if (st.hits.length) renderResults(); });
  ctx.on('settings', () => renderMeter());

  renderMeter();
  renderHistory();
  loadMe();
};
