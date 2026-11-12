'use strict';
/* ==========================================================================
   Disboard — odcinki: kadry, tytuły i daty (ani.zip, dane TheTVDB), fillery,
   recapy i oceny odcinków (MyAnimeList przez Jikan), sekcja „Odcinki” na
   stronie anime z zaznaczaniem dowolnych zakresów oraz skan fillerów do
   statystyk i trybu pomijania.
   ========================================================================== */

const Episodes = (() => {
  const FLAGS_KEY = 'epflags:v1';
  // na telefonie krótsze strony, żeby lista nie ciągnęła się bez końca
  const pageSize = () => (window.innerWidth < 600 ? 25 : 50);
  let flags = null; // malId → { t, n, f: [[od, do]], r: [[od, do]] }
  let persistTimer = null;
  let scanning = null;

  /* ---------- pomocnicze ---------- */
  function toRanges(nums) {
    const s = [...new Set(nums)].sort((a, b) => a - b);
    const out = [];
    for (const n of s) { const l = out[out.length - 1]; if (l && n === l[1] + 1) l[1] = n; else out.push([n, n]); }
    return out;
  }
  const inR = (r, n) => r.some(([a, b]) => n >= a && n <= b);
  const countR = (r) => r.reduce((x, [a, b]) => x + b - a + 1, 0);
  const rText = (r) => r.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');

  async function init() {
    if (flags) return flags;
    const hit = await IDB.get('cache', FLAGS_KEY);
    flags = (hit && hit.data) || {};
    return flags;
  }
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => IDB.set('cache', FLAGS_KEY, { t: Date.now(), data: flags }), 300);
  }
  const flagsOf = (e) => (flags && e && e.idMal ? flags[e.idMal] || null : null);
  // zbiór odcinków do pominięcia (fillery + recapy) albo null, gdy brak danych
  function skipSet(e) {
    const f = flagsOf(e);
    if (!f) return null;
    const set = new Set();
    for (const [a, b] of [...f.f, ...f.r]) for (let i = a; i <= b; i++) set.add(i);
    return set;
  }
  function updateFlags(malId, list, total) {
    if (!flags || !malId || !list) return;
    const maxEp = Math.max(0, ...list.map((x) => x.mal_id || 0));
    flags[malId] = {
      t: Date.now(),
      n: Math.max(total || 0, maxEp),
      f: toRanges(list.filter((x) => x.filler).map((x) => x.mal_id)),
      r: toRanges(list.filter((x) => x.recap).map((x) => x.mal_id)),
    };
    persist();
    emit('epflags', { malId });
  }

  /* ---------- źródła ---------- */
  // Jikan: lista odcinków po 100 na stronę (numer, tytuły, data, ocena, filler, recap)
  async function jikanEpisodes(malId, { ttl, onPage, alive } = {}) {
    const out = [];
    let page = 1, last = 1;
    do {
      const r = await Jikan.get(`/anime/${malId}/episodes?page=${page}`, ttl);
      const d = r.data || {};
      out.push(...(d.data || []));
      last = (d.pagination && d.pagination.last_visible_page) || page;
      if (onPage) onPage(out.slice(), page, last);
      page++;
      if (alive && !alive()) break;
    } while (page <= last && page <= 30);
    return out;
  }
  // ani.zip: kadry, tytuły, daty emisji i długości odcinków po identyfikatorze AniList
  function anizip(anilistId, ttl) {
    return cached('anizip:' + anilistId, ttl, async () => {
      let res;
      try { res = await fetch(`https://api.ani.zip/mappings?anilist_id=${anilistId}`, { headers: { Accept: 'application/json' } }); }
      catch { throw new ApiError('network', 'Brak połączenia z ani.zip.'); }
      if (res.status === 404) throw new ApiError('notfound', 'ani.zip nie zna tej serii.');
      if (!res.ok) throw new ApiError('http', `ani.zip: HTTP ${res.status}`);
      let j;
      try { j = await res.json(); } catch { throw new ApiError('parse', 'ani.zip zwrócił nieczytelną odpowiedź.'); }
      const eps = {};
      for (const [k, v] of Object.entries(j.episodes || {})) {
        if (!/^\d+$/.test(k) || !v) continue;
        const t = v.title || {};
        eps[k] = { t: t.en || t['x-jat'] || null, ja: t.ja || null, d: v.airDate || v.airdate || null, img: v.image || null, len: v.runtime || v.length || null };
      }
      return eps;
    }, { src: 'anizip' });
  }
  // AniList: miniatury odcinków z serwisów streamingowych (zapas, gdy ani.zip milczy)
  function streamMap(m) {
    const map = new Map();
    for (const s of (m.streamingEpisodes || [])) {
      const n = Number((String(s.title || '').match(/(?:episode|odcinek|ep\.?)\s*(\d+)/i) || [])[1]);
      if (n && !map.has(n)) map.set(n, { img: s.thumbnail || null, title: String(s.title).replace(/^.*?(?:episode|odcinek|ep\.?)\s*\d+\s*[-–:]\s*/i, '') || null });
    }
    return map;
  }

  function build(m, st) {
    const jk = new Map((st.jk || []).map((x) => [x.mal_id, x]));
    const az = st.az || {};
    const sm = streamMap(m);
    const aired = Lib.airedEpisodes(m);
    const n = Math.max(m.episodes || 0, aired || 0, ...[...jk.keys()], ...Object.keys(az).map(Number), 0);
    const list = [];
    for (let i = 1; i <= n; i++) {
      const j = jk.get(i), a = az[i], s = sm.get(i);
      list.push({
        n: i,
        title: (a && a.t) || (j && (j.title || j.title_romanji)) || (s && s.title) || null,
        ja: (j && j.title_japanese) || (a && a.ja) || null,
        date: (a && a.d) || (j && j.aired ? String(j.aired).slice(0, 10) : null),
        img: (a && a.img) || (s && s.img) || null,
        score: j && j.score != null ? Number(j.score) : null,
        filler: !!(j && j.filler),
        recap: !!(j && j.recap),
      });
    }
    return { list, n, hasFlags: !!st.jk, errors: st.err };
  }

  // wszystko o odcinkach jednej serii; onUpdate dostaje kolejne, coraz pełniejsze wersje
  async function detail(m, { alive, onUpdate } = {}) {
    await init();
    const ttl = m.status === 'RELEASING' ? 86400e3 : 30 * 86400e3;
    const st = { az: null, jk: null, err: [] };
    const push = () => { if (onUpdate && (!alive || alive())) onUpdate(build(m, st)); };
    const p1 = anizip(m.id, ttl).then((r) => { st.az = r.data; push(); }).catch((err) => { if (err.kind !== 'notfound') st.err.push(['ani.zip', err]); });
    const p2 = m.idMal
      ? jikanEpisodes(m.idMal, { ttl, alive, onPage: (list) => { st.jk = list; push(); } })
        .then((list) => { st.jk = list; updateFlags(m.idMal, list, m.episodes); })
        .catch((err) => { if (err.kind !== 'notfound') st.err.push(['MyAnimeList', err]); })
      : Promise.resolve();
    await Promise.all([p1, p2]);
    return build(m, st);
  }

  /* ---------- skan fillerów w tle (statystyki, tryb pomijania) ---------- */
  const longEnough = (e) => (e.media.episodes || Lib.lastEp(e) || 0) >= 20;
  const staleFlags = (e) => { const f = flagsOf(e); if (!f) return true; return Date.now() - f.t > (e.media.status === 'RELEASING' ? 7 : 30) * 86400e3; };
  function needScan(entries) { return entries.filter((e) => e.idMal && longEnough(e) && staleFlags(e)); }
  async function scan(entries, { onProgress, alive } = {}) {
    await init();
    if (scanning) { await scanning.catch(() => {}); return scan(entries, { onProgress, alive }); }
    scanning = (async () => {
      const todo = needScan(entries);
      let done = 0, failed = false;
      for (const e of todo) {
        if (alive && !alive()) break;
        try {
          const list = await jikanEpisodes(e.idMal, { ttl: e.media.status === 'RELEASING' ? 7 * 86400e3 : 30 * 86400e3 });
          updateFlags(e.idMal, list, e.media.episodes);
        } catch (err) {
          if (err.kind === 'network') { failed = true; break; }
          if (err.kind === 'notfound') flags[e.idMal] = { t: Date.now(), n: e.media.episodes || 0, f: [], r: [] };
          else failed = true;
        }
        done++;
        if (onProgress) onProgress(done, todo.length);
      }
      persist();
      return { done, total: todo.length, failed };
    })();
    try { return await scanning; } finally { scanning = null; }
  }

  /* ==========================================================================
     SEKCJA „ODCINKI” NA STRONIE ANIME
     ========================================================================== */
  const EFILTERS = [['all', 'Wszystkie'], ['todo', 'Nieobejrzane'], ['filler', 'Fillery'], ['canon', 'Fabularne']];
  let datedPref = false; // „z dzisiejszą datą” — domyślnie wyłączone (zaznaczanie to zwykle dawne oglądanie)

  function section(ctx, host, m) {
    if (!host) return;
    const st = { data: null, open: false, page: null, filter: 'all', lastClick: null, loading: true };
    const entry = () => Lib.get(m.id);
    const watched = (n) => { const e = entry(); return !!e && Lib.hasEp(Lib.cur(e), n); };
    const kind = (x) => (x.filler ? 'f' : x.recap ? 'r' : 'c');

    function summary(d) {
      const e = entry();
      const nf = d.list.filter((x) => x.filler).length, nr = d.list.filter((x) => x.recap).length;
      const bits = [nUnit(d.n, 'episode')];
      if (d.hasFlags) bits.push(nf ? `${nf} ${plural(nf, 'filler', 'fillery', 'fillerów')} (${Math.round((nf / d.n) * 100)}%)` : 'bez fillerów');
      if (nr) bits.push(`${nr} ${plural(nr, 'recap', 'recapy', 'recapów')}`);
      if (e) bits.push(`obejrzane ${Lib.cur(e).progress}`);
      return bits.join(' · ');
    }
    function mapHtml(d) {
      if (!d.n) return '';
      return `<div class="eps-map${d.n > 160 ? ' dense' : ''}" style="--n:${d.n}" role="img" aria-label="Mapa odcinków: ${esc(summary(d))}">${d.list.map((x) => `<i class="${kind(x)}${watched(x.n) ? ' w' : ''}" data-epjump="${x.n}" title="Odc. ${x.n}${x.filler ? ' · filler' : x.recap ? ' · recap' : ''}${watched(x.n) ? ' · obejrzany' : ''}"></i>`).join('')}</div>`;
    }
    const filtered = (d) => d.list.filter((x) => st.filter === 'all' || (st.filter === 'todo' ? !watched(x.n) : st.filter === 'filler' ? (x.filler || x.recap) : !(x.filler || x.recap)));
    function defaultPage(d) {
      const e = entry();
      const next = e ? Lib.lastEp(e) + 1 : 1;
      const list = filtered(d);
      const i = Math.max(0, list.findIndex((x) => x.n >= next));
      return Math.floor((i < 0 ? 0 : i) / pageSize());
    }
    function row(x) {
      const w = watched(x.n);
      const onList = !!entry();
      return `<li class="ep ${kind(x)}${w ? ' w' : ''}" data-ep="${x.n}">
        <button class="ep-chk" type="button" data-epchk="${x.n}" aria-pressed="${w}" ${onList ? '' : 'disabled'} title="${onList ? (w ? 'Odznacz odcinek' : 'Oznacz jako obejrzany · Shift+klik zaznacza zakres') : 'Dodaj anime do listy, żeby zaznaczać odcinki'}">${ICON.check}</button>
        <div class="ep-img">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}<span class="num">${x.n}</span></div>
        <div class="ep-t"><b><span class="num">${x.n}.</span> ${esc(x.title || `Odcinek ${x.n}`)}</b>${x.ja ? `<small lang="ja">${esc(x.ja)}</small>` : ''}</div>
        <div class="ep-meta">${x.date ? `<time class="num">${esc(fmtDateShort(new Date(`${x.date}T12:00:00`).getTime()))}</time>` : ''}${x.score != null ? `<span class="ep-score num">★${NF1.format(x.score)}</span>` : ''}${x.filler ? '<span class="ep-tag f">Filler</span>' : ''}${x.recap ? '<span class="ep-tag r">Recap</span>' : ''}</div>
      </li>`;
    }
    function panelHtml(d) {
      const list = filtered(d);
      const pages = Math.max(1, Math.ceil(list.length / pageSize()));
      if (st.page == null || st.page >= pages) st.page = defaultPage(d);
      const slice = list.slice(st.page * pageSize(), st.page * pageSize() + pageSize());
      const e = entry();
      const label = (p) => { const a = list[p * pageSize()], b = list[Math.min(list.length, p * pageSize() + pageSize()) - 1]; return a && b ? `${a.n}–${b.n}` : '—'; };
      const pager = (id) => (pages > 1 ? `<div class="eps-pages">
          <button class="icon-btn sm" type="button" data-eppage="${st.page - 1}" ${st.page ? '' : 'disabled'} aria-label="Poprzednia strona">${ICON.chevron}</button>
          <select${id ? ` id="${id}"` : ''} class="eps-pgsel" aria-label="Strona odcinków">${Array.from({ length: pages }, (_, p) => `<option value="${p}"${p === st.page ? ' selected' : ''}>Odcinki ${label(p)}</option>`).join('')}</select>
          <button class="icon-btn sm" type="button" data-eppage="${st.page + 1}" ${st.page < pages - 1 ? '' : 'disabled'} aria-label="Następna strona">${ICON.chevron}</button>
        </div>` : '');
      return `<div class="eps-tools">
          <div class="seg" role="group" aria-label="Filtr odcinków">${EFILTERS.map(([k, l]) => `<button type="button" data-epf="${k}" class="${st.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <label class="eps-go"><span>Idź do</span><input type="number" id="eps-go" min="1" max="${d.n}" inputmode="numeric" placeholder="nr"></label>
          ${pager('eps-page')}
        </div>
        ${e ? `<div class="eps-range">
          <span class="lbl">Zaznacz zakres</span>
          <label><span class="sr">Od odcinka</span><input type="number" id="eps-from" min="1" max="${d.n}" inputmode="numeric" placeholder="od"></label>
          <span aria-hidden="true">–</span>
          <label><span class="sr">Do odcinka</span><input type="number" id="eps-to" min="1" max="${d.n}" inputmode="numeric" placeholder="do"></label>
          <button class="btn sm" type="button" data-eprange="1">${ICON.check}Obejrzane</button>
          <button class="btn ghost sm" type="button" data-eprange="0">Nieobejrzane</button>
          <label class="switch sm"><input type="checkbox" id="eps-dated"${datedPref ? ' checked' : ''}><span>z dzisiejszą datą</span></label>
          ${Lib.isRewatch(e) ? `<small class="muted">Zaznaczasz w: rewatch #${Lib.cur(e).n}</small>` : ''}
        </div>` : '<p class="eps-hint">Dodaj anime do listy, żeby zaznaczać obejrzane odcinki.</p>'}
        ${slice.length ? `<ol class="eps-list">${slice.map(row).join('')}</ol>` : UI.empty('Brak odcinków w tym filtrze')}
        ${pages > 1 ? `<div class="eps-foot">${pager('')}</div>` : ''}
        <p class="src-note">Kadry, tytuły i daty: ani.zip (TheTVDB) i AniList. Fillery, recapy i oceny odcinków (skala 1–5): MyAnimeList przez Jikan. Oznaczenia fillerów dodają użytkownicy MAL, więc przy mniej znanych seriach bywają niepełne.${d.errors && d.errors.length ? ` Nie odpowiedziało: ${esc(d.errors.map((x) => x[0]).join(', '))}.` : ''}</p>`;
    }

    function render() {
      if (!ctx.alive() || !host.isConnected) return;
      const d = st.data;
      if (!d || !d.n) {
        host.innerHTML = st.loading ? `<section class="eps"><div class="eps-bar"><span class="eps-title">Odcinki</span><span class="eps-sum muted">wczytuję…</span></div></section>` : '';
        return;
      }
      const e = entry();
      const skip = S.settings.skipFiller && e && d.hasFlags;
      host.innerHTML = `<section class="eps${st.open ? ' open' : ''}" aria-label="Odcinki">
        <div class="eps-bar">
          <button class="eps-toggle" type="button" id="eps-toggle" aria-expanded="${st.open}" aria-controls="eps-panel"><span class="eps-title">Odcinki</span>${ICON.chevron}</button>
          <span class="eps-sum">${esc(summary(d))}${st.loading ? ' <span class="muted">· wczytuję…</span>' : ''}</span>
          ${skip ? '<span class="sf-chip" title="Plusik przeskakuje fillery i recapy (Alt+P)">pomijam fillery</span>' : ''}
        </div>
        ${mapHtml(d)}
        ${d.hasFlags ? `<div class="eps-legend" aria-hidden="true"><span><i class="c w"></i>fabularny</span><span><i class="f w"></i>filler</span><span><i class="r w"></i>recap</span><span><i class="c"></i>nieobejrzany</span>${d.list.some((x) => x.filler) ? `<span class="eps-fl">Fillery: ${esc(rText(toRanges(d.list.filter((x) => x.filler).map((x) => x.n))))}</span>` : ''}</div>` : ''}
        <div class="eps-panel" id="eps-panel"${st.open ? '' : ' hidden'}>${st.open ? panelHtml(d) : ''}</div>
      </section>`;
    }
    const rerenderPanel = () => {
      const p = host.querySelector('#eps-panel');
      if (!p || !st.open) { render(); return; }
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    };

    host.addEventListener('click', (ev) => {
      const d = st.data;
      if (!d) return;
      if (ev.target.closest('#eps-toggle')) { st.open = !st.open; if (st.open) st.page = null; render(); return; }
      const j = ev.target.closest('[data-epjump]');
      if (j) {
        const n = Number(j.dataset.epjump);
        st.open = true; st.filter = 'all';
        st.page = Math.floor((n - 1) / pageSize());
        render();
        const r = host.querySelector(`.ep[data-ep="${n}"]`);
        if (r) { r.scrollIntoView({ block: 'center', behavior: 'smooth' }); r.classList.add('flash'); }
        return;
      }
      const f = ev.target.closest('[data-epf]');
      if (f) { st.filter = f.dataset.epf; st.page = null; rerenderPanel(); return; }
      const pg = ev.target.closest('[data-eppage]');
      if (pg && !pg.disabled) { st.page = Number(pg.dataset.eppage); rerenderPanel(); host.querySelector('.eps-list') && host.querySelector('.eps').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      const c = ev.target.closest('[data-epchk]');
      if (c && !c.disabled) {
        const n = Number(c.dataset.epchk);
        const want = !watched(n);
        if (ev.shiftKey && st.lastClick != null && st.lastClick !== n) {
          const a = Math.min(st.lastClick, n), b = Math.max(st.lastClick, n);
          const k = Lib.setEpisodes(m.id, a, b, want, { nodate: !datedPref });
          toast(`${want ? 'Obejrzane' : 'Odznaczone'}: odc. ${a}–${b}${k ? ` (${nUnit(k, 'episode')})` : ''}`, { kind: 'ok', ms: 2500 });
        } else {
          Lib.setEpisodes(m.id, n, n, want, { nodate: !datedPref });
        }
        st.lastClick = n;
        return;
      }
      const rg = ev.target.closest('[data-eprange]');
      if (rg) {
        const a = Number(host.querySelector('#eps-from').value), b = Number(host.querySelector('#eps-to').value) || a;
        if (!a) { toast('Wpisz numer pierwszego odcinka.', { kind: 'warn' }); return; }
        const want = rg.dataset.eprange === '1';
        const k = Lib.setEpisodes(m.id, Math.min(a, b), Math.max(a, b), want, { nodate: !datedPref });
        toast(k ? `${want ? 'Oznaczono jako obejrzane' : 'Odznaczono'}: odc. ${Math.min(a, b)}–${Math.max(a, b)} (${nUnit(k, 'episode')})${want && !datedPref ? ' · bez daty' : ''}` : 'Nic się nie zmieniło.', { kind: k ? 'ok' : 'warn' });
      }
    });
    host.addEventListener('change', (ev) => {
      if (ev.target.classList.contains('eps-pgsel')) { st.page = Number(ev.target.value); rerenderPanel(); }
      if (ev.target.id === 'eps-dated') datedPref = ev.target.checked;
    });
    host.addEventListener('keydown', (ev) => {
      if (ev.target.id === 'eps-go' && ev.key === 'Enter') {
        const n = Number(ev.target.value);
        if (!n || !st.data) return;
        st.filter = 'all';
        st.page = Math.floor((Math.min(n, st.data.n) - 1) / pageSize());
        rerenderPanel();
        const r = host.querySelector(`.ep[data-ep="${n}"]`);
        if (r) { r.scrollIntoView({ block: 'center', behavior: 'smooth' }); r.classList.add('flash'); }
      }
      if ((ev.target.id === 'eps-from' || ev.target.id === 'eps-to') && ev.key === 'Enter') host.querySelector('[data-eprange="1"]').click();
    });

    render();
    detail(m, { alive: ctx.alive, onUpdate: (d) => { st.data = d; render(); } })
      .then((d) => { st.loading = false; st.data = d; render(); })
      .catch(() => { st.loading = false; render(); });
    ctx.onLibrary((d) => {
      if (d && d.id && d.id !== m.id && !d.kind) return;
      // nie gubimy wpisywanych zakresów
      const a = document.activeElement;
      const keep = a && host.contains(a) && a.matches('input') ? { id: a.id, v: a.value } : null;
      const from = host.querySelector('#eps-from'), to = host.querySelector('#eps-to');
      const fv = from && from.value, tv = to && to.value;
      rerenderPanel();
      if (fv) { const x = host.querySelector('#eps-from'); if (x) x.value = fv; }
      if (tv) { const x = host.querySelector('#eps-to'); if (x) x.value = tv; }
      if (keep) { const x = host.querySelector(`#${keep.id}`); if (x) { x.value = keep.v; x.focus(); } }
    });
    ctx.on('settings', render);
  }

  return { init, detail, section, skipSet, flagsOf, scan, needScan, toRanges, inR, countR, rText, all: () => flags || {} };
})();
