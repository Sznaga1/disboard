'use strict';
/* ==========================================================================
   Disboard — radar kontynuacji
   Źródła: anime z Twojej listy ze statusem Obejrzane i Oglądam. Z relacji
   AniList bierzemy następny krok w serii (sequel: sezony i filmy; pod
   przełącznikiem także OVA, specjale i historie poboczne), którego nie masz
   na liście. Radar to osobna lista: nie liczy się do statystyk ani Planuję.
   ========================================================================== */

const Radar = (() => {
  const MAIN_FMT = new Set(['TV', 'TV_SHORT', 'ONA', 'MOVIE']);
  const SCAN_EVERY = 20 * 3600e3;
  let running = null;
  let pending = null;

  const R = () => {
    if (!S.radar || typeof S.radar !== 'object') S.radar = { at: 0, baseline: false, items: {}, hidden: {}, seenAt: 0 };
    if (!S.radar.items) S.radar.items = {};
    if (!S.radar.hidden) S.radar.hidden = {};
    return S.radar;
  };
  const sources = () => Object.values(S.entries).filter((e) => e.status === 'completed' || e.status === 'watching');
  const edges = (m) => ((m && m.relations && m.relations.edges) || []).filter((e) => e && e.node && e.node.type === 'ANIME');

  async function fetchAll(ids, ttl, force) {
    const out = [];
    const sorted = ids.slice().sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 50) out.push(...await Ani.relations(sorted.slice(i, i + 50), { ttl, force }));
    return out;
  }

  async function scan({ force = false } = {}) {
    if (running) return running;
    running = (async () => {
      const r = R();
      const src = sources();
      const srcIds = src.map((e) => e.id);
      const got = await fetchAll(srcIds, SCAN_EVERY, force);
      // kandydaci: sequel (sezony i filmy = główne; OVA/specjale = dodatki) albo historia poboczna (dodatek)
      const cands = new Map();
      for (const m of got) {
        if (!S.entries[m.id]) continue;
        for (const e of edges(m)) {
          const n = e.node;
          if (S.entries[n.id]) continue;
          let extra;
          if (e.relationType === 'SEQUEL') extra = !MAIN_FMT.has(n.format);
          else if (e.relationType === 'SIDE_STORY') extra = true;
          else continue;
          const c = cands.get(n.id) || { id: n.id, extra, from: [], node: n };
          if (!extra) c.extra = false;
          if (!c.from.includes(m.id)) c.from.push(m.id);
          cands.set(n.id, c);
        }
      }
      // pełne dane kandydatów (odcinki, długość, emisja) i ich własne kontynuacje
      const details = new Map((cands.size ? await fetchAll([...cands.keys()], SCAN_EVERY, force) : []).map((m) => [m.id, m]));
      const now = Date.now();
      const prev = r.items || {};
      const next = {};
      const announce = r.baseline;
      for (const c of cands.values()) {
        const full = details.get(c.id);
        const m = Lib.snapshot(full || c.node);
        const more = full ? edges(full).some((e) => e.relationType === 'SEQUEL' && !S.entries[e.node.id]) : false;
        const old = prev[c.id];
        next[c.id] = { m, from: c.from, extra: c.extra, more, first: old ? old.first : now };
        if (!announce || r.hidden[c.id] || (c.extra && !S.settings.radarExtras) || (m.isAdult && !S.settings.adult)) continue;
        const name = titleOf(m);
        const fromName = S.entries[c.from[0]] ? titleOf(S.entries[c.from[0]].media) : '';
        const link = `#/anime/${c.id}`;
        if (!old) {
          Lib.notify({
            kind: 'sequel', key: `rd:new:${c.id}`, link,
            title: m.status === 'NOT_YET_RELEASED' ? `Zapowiedziano: ${name}` : `Nowa kontynuacja: ${name}`,
            body: `Kontynuacja „${fromName}”${m.status === 'NOT_YET_RELEASED' ? (fuzzyDate(m.startDate) ? ` · premiera: ${fuzzyDate(m.startDate)}` : ' · data jeszcze nieustalona') : ' · już możesz oglądać'}.`,
          });
        } else {
          const om = old.m || {};
          if (om.status === 'NOT_YET_RELEASED' && m.status === 'RELEASING') {
            Lib.notify({ kind: 'sequel', key: `rd:air:${c.id}`, link, title: `Premiera kontynuacji: ${name}`, body: `Ruszyła emisja kontynuacji „${fromName}”.` });
          } else if (m.status === 'NOT_YET_RELEASED' && !fuzzyDate(om.startDate) && fuzzyDate(m.startDate)) {
            Lib.notify({ kind: 'sequel', key: `rd:date:${c.id}:${fuzzyDate(m.startDate)}`, link, title: `${name}: jest data premiery`, body: `${fuzzyDate(m.startDate)} · kontynuacja „${fromName}”.` });
          }
        }
      }
      r.items = next;
      r.at = now;
      if (!r.baseline) r.seenAt = now; // pierwszy skan: nic nie jest „nowe”
      r.baseline = true;
      r.src = srcIds;
      save();
      emit('radar');
      return { count: cands.size };
    })();
    try { return await running; } finally { running = null; }
  }

  // nowe źródło (np. ukończone anime) → sprawdzamy po chwili, bez ponownego pobierania reszty
  function watch() {
    on('library', (d) => {
      if (!d || !d.id || d.kind) return;
      const e = S.entries[d.id];
      const r = R();
      if (r.items[d.id]) emit('radar'); // pozycja z radaru trafiła na listę
      if (!e || !(e.status === 'completed' || e.status === 'watching')) return;
      if ((r.src || []).includes(d.id)) return;
      clearTimeout(pending);
      pending = setTimeout(() => scan().catch(() => {}), 4000);
    });
  }
  function maybeScan() {
    if (!sources().length) return;
    if (Date.now() - (R().at || 0) > SCAN_EVERY) scan().catch(() => {});
  }

  /* ---------- widok ---------- */
  const visible = () => Object.entries(R().items)
    .filter(([id, x]) => !S.entries[id] && !R().hidden[id] && (!x.extra || S.settings.radarExtras) && (!x.m.isAdult || S.settings.adult))
    .map(([id, x]) => ({ id: Number(id), ...x }));
  const hiddenList = () => Object.keys(R().hidden).filter((id) => R().items[id] && !S.entries[id]).map((id) => ({ id: Number(id), ...R().items[id] }));
  // „NOWE” = wykryte po Twojej ostatniej wizycie w zakładce
  const isNew = (x, ref = R().seenAt || 0) => x.first > ref;
  const count = () => visible().length;

  function card(x, ref) {
    const m = x.m;
    const src = x.from.map((id) => S.entries[id]).filter(Boolean);
    const fromTxt = src.length ? `po „${esc(titleOf(src[0].media))}”${src.length > 1 ? ` i ${src.length - 1} innych` : ''}` : '';
    let line = '';
    if (m.status === 'NOT_YET_RELEASED') line = UI.premiereLine(m);
    else if (m.status === 'RELEASING') {
      const aired = Lib.airedEpisodes(m);
      const n = m.nextAiringEpisode;
      line = `${aired != null ? `odc. ${aired}/${m.episodes || '?'}` : 'w emisji'}${n && n.airingAt * 1000 > Date.now() ? ` · następny za ${UI.countdownTo(n.airingAt, { short: true })}` : ''}`;
    } else if (m.episodes) {
      const d = m.duration;
      line = `${nUnit(m.episodes, 'episode')}${d ? ` · ${esc(fmtDuration(m.episodes * d, { short: true }))}` : ''}`;
    }
    return UI.animeCard(m, {
      extra: `${isNew(x, ref) ? '<span class="badge-new rd-new">NOWE</span>' : ''}<span class="rd-from">${fromTxt}</span>${line ? `<span class="rd-line">${line}</span>` : ''}${x.more ? '<span class="rd-more">dalej w serii: kolejne</span>' : ''}
        <button class="rd-hide" type="button" data-rhide="${x.id}" title="Nie interesuje mnie — schowaj">Nie interesuje mnie</button>`,
    });
  }

  function viewHtml(ref) {
    const r = R();
    const list = visible();
    const src = sources().length;
    const groups = [
      ['done', 'Już wyszło, czeka na Ciebie', list.filter((x) => x.m.status === 'FINISHED' || x.m.status === 'CANCELLED')],
      ['air', 'W emisji', list.filter((x) => x.m.status === 'RELEASING')],
      ['soon', 'Zapowiedziane', list.filter((x) => x.m.status === 'NOT_YET_RELEASED' || x.m.status === 'HIATUS' || !x.m.status)],
    ];
    const ts = (x) => fuzzyTs(x.m.startDate) || 9e15;
    groups[0][2].sort((a, b) => b.first - a.first || ts(b) - ts(a));
    groups[1][2].sort((a, b) => ((a.m.nextAiringEpisode || {}).airingAt || 9e12) - ((b.m.nextAiringEpisode || {}).airingAt || 9e12));
    groups[2][2].sort((a, b) => ts(a) - ts(b));
    const hid = hiddenList();
    const extrasN = Object.entries(r.items).filter(([id, x]) => x.extra && !S.entries[id] && !r.hidden[id]).length;
    const head = `<div class="rd-intro">
        <p><b>Kontynuacje anime, które obejrzałeś, a których nie masz na liście.</b> To nie jest Planuję: nic się tu nie liczy do statystyk, a tytuł trafia na listę dopiero, gdy klikniesz „+”.</p>
        <div class="rd-tools">
          <span class="muted">${r.at ? `Sprawdzone ${esc(relTime(r.at))}` : 'Jeszcze nie sprawdzone'} · ${nUnit(src, 'title')} z Obejrzanych i Oglądam</span>
          <label class="switch sm"><input type="checkbox" id="rd-extras"${S.settings.radarExtras ? ' checked' : ''}><span>Też OVA, specjale i historie poboczne${extrasN ? ` (${extrasN})` : ''}</span></label>
          <button class="btn ghost sm" type="button" id="rd-scan"${running ? ' disabled' : ''}>${ICON.refresh}${running ? 'Sprawdzam…' : 'Sprawdź teraz'}</button>
        </div>
      </div>`;
    if (!src) return head + UI.empty('Radar nie ma czego pilnować', 'Oznacz anime jako Obejrzane albo Oglądam, a radar sprawdzi, czy mają kontynuacje.');
    if (!r.at) return head + (running ? UI.skeletonCards(6) : UI.empty('Radar jeszcze nie sprawdzał', 'Kliknij „Sprawdź teraz”.'));
    const body = list.length ? groups.filter((g) => g[2].length).map(([k, l, arr]) => UI.section(`${l} <span class="count">${arr.length}</span>`, `<div class="grid-cards rd-grid">${arr.map((x) => card(x, ref)).join('')}</div>`, { cls: `rd-sec rd-${k}` })).join('')
      : UI.empty('Brak kontynuacji do pokazania', 'Wszystkie znane kontynuacje Twoich anime są już na liście albo schowane. Radar sprawdza raz dziennie.');
    const hidden = hid.length ? `<details class="rd-hidden"><summary>Schowane <span class="count">${hid.length}</span></summary>
        <ul>${hid.map((x) => `<li><a href="#/anime/${x.id}">${esc(titleOf(x.m))}</a><button class="btn ghost sm" type="button" data-runhide="${x.id}">Przywróć</button></li>`).join('')}</ul></details>` : '';
    return head + body + hidden;
  }

  // zakładka „Kontynuacje” na stronie listy
  function view(ctx, out) {
    // „NOWE” widać przez całą tę wizytę; przy następnej już nie
    const seenBefore = R().seenAt || 0;
    const render = () => { if (ctx.alive() && out.isConnected) out.innerHTML = viewHtml(seenBefore); };
    render();
    if (R().baseline) { R().seenAt = Date.now(); save(); }
    out.addEventListener('click', (ev) => {
      const h = ev.target.closest('[data-rhide]');
      if (h) {
        const id = Number(h.dataset.rhide);
        R().hidden[id] = Date.now();
        save(); emit('radar');
        const x = R().items[id];
        toast(`Schowano: ${x ? titleOf(x.m) : ''}`, { kind: 'ok', action: { label: 'Cofnij', fn: () => { delete R().hidden[id]; save(); emit('radar'); } } });
        return;
      }
      const u = ev.target.closest('[data-runhide]');
      if (u) { delete R().hidden[Number(u.dataset.runhide)]; save(); emit('radar'); return; }
      if (ev.target.closest('#rd-scan')) {
        const p = scan({ force: true });
        render();
        p.then(() => toast('Radar sprawdzony.', { kind: 'ok' })).catch((err) => toast(err.message, { kind: 'error' })).finally(render);
      }
    });
    out.addEventListener('change', (ev) => {
      if (ev.target.id === 'rd-extras') { S.settings.radarExtras = ev.target.checked; save(); emit('radar'); }
    });
    ctx.on('radar', render);
    ctx.onLibrary(render);
    if (!R().at && !running && sources().length) scan().then(render).catch(render);
  }

  // kafelek na stronie głównej
  function homeHtml() {
    const list = visible();
    if (!list.length) return '';
    const fresh = list.filter(isNew);
    const soon = list.filter((x) => x.m.status === 'NOT_YET_RELEASED').length;
    const ready = list.filter((x) => x.m.status === 'FINISHED').length;
    const pick = (fresh.length ? fresh : list).slice().sort((a, b) => b.first - a.first).slice(0, 6);
    return `<a class="rd-tile" href="#/lista/radar">
      <div class="rd-tile-t"><span class="lbl">Radar kontynuacji</span>
        <b>${fresh.length ? `${fresh.length} ${plural(fresh.length, 'nowa', 'nowe', 'nowych')} · ` : ''}${nUnit(list.length, 'title')} ${plural(list.length, 'czeka', 'czekają', 'czeka')}</b>
        <small>${[ready ? `${ready} już wyszło` : '', soon ? `${soon} zapowiedzianych` : ''].filter(Boolean).join(' · ')}</small></div>
      <div class="rd-tile-covers">${pick.map((x) => UI.cover(x.m, 'xs')).join('')}</div>
      ${ICON.chevron}
    </a>`;
  }

  return { scan, maybeScan, watch, view, homeHtml, count, visible, items: () => R().items };
})();
