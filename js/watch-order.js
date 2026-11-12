'use strict';
/* ==========================================================================
   Disboard — kolejność oglądania serii (strona anime)
   Idzie po relacjach AniList w głąb: prequel prequela, sequel sequela,
   historie poboczne. Główna linia = sezony i filmy połączone relacjami
   prequel/sequel, w kolejności premier. OVA i specjale wpięte pod sezon,
   przy którym wyszły. Wersje alternatywne, spin-offy i manga osobno.
   ========================================================================== */

const WatchOrder = (() => {
  const FOLLOW = new Set(['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY']);
  const MAIN_EDGE = new Set(['PREQUEL', 'SEQUEL']);
  const MAIN_FMT = new Set(['TV', 'TV_SHORT', 'ONA']);
  const MAX_NODES = 60;
  const MAX_LAYERS = 14;
  const memo = new Map(); // rootId → wynik (na czas sesji)

  const tsOf = (m) => fuzzyTs(m && m.startDate) || null;
  const edges = (m) => ((m && m.relations && m.relations.edges) || []).filter((e) => e && e.node);
  const okAdult = (m) => S.settings.adult || !m.isAdult;

  // pobieranie warstwa po warstwie: jedno zapytanie na „piętro” relacji
  async function collect(root, { alive } = {}) {
    const nodes = new Map([[root.id, root]]);
    const tried = new Set([root.id]);
    let frontier = [root];
    let truncated = false, layers = 0;
    while (frontier.length && layers < MAX_LAYERS) {
      const next = [];
      for (const m of frontier) {
        for (const e of edges(m)) {
          if (e.node.type !== 'ANIME' || !FOLLOW.has(e.relationType) || tried.has(e.node.id)) continue;
          tried.add(e.node.id);
          next.push(e.node.id);
        }
      }
      if (!next.length) break;
      const room = MAX_NODES - nodes.size;
      if (room <= 0) { truncated = true; break; }
      if (next.length > room) truncated = true;
      if (alive && !alive()) return null;
      const got = await Ani.relations(next.slice(0, room));
      frontier = [];
      for (const m of got) { if (!nodes.has(m.id)) { nodes.set(m.id, m); frontier.push(m); } }
      layers++;
    }
    if (frontier.length && layers >= MAX_LAYERS) truncated = true;
    return { nodes, truncated };
  }

  function compose(root, nodes, truncated) {
    const all = [...nodes.values()].filter((m) => m.id === root.id || okAdult(m));
    const ids = new Set(all.map((m) => m.id));
    // składowe połączone prequel/sequel
    const adj = new Map(all.map((m) => [m.id, []]));
    for (const m of all) for (const e of edges(m)) if (MAIN_EDGE.has(e.relationType) && ids.has(e.node.id)) { adj.get(m.id).push(e.node.id); adj.get(e.node.id).push(m.id); }
    const comp = new Map();
    let ci = 0;
    for (const m of all) {
      if (comp.has(m.id)) continue;
      const stack = [m.id];
      comp.set(m.id, ci);
      while (stack.length) { const x = stack.pop(); for (const y of adj.get(x)) if (!comp.has(y)) { comp.set(y, ci); stack.push(y); } }
      ci++;
    }
    const groups = new Map();
    for (const m of all) { const c = comp.get(m.id); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(m); }
    // główna linia: najwięcej sezonów TV; przy remisie ta z otwartym anime
    const score = (g) => [g.filter((m) => MAIN_FMT.has(m.format)).length, g.some((m) => m.id === root.id) ? 1 : 0, g.length];
    const mainGroup = [...groups.values()].sort((a, b) => { const x = score(a), y = score(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; })[0] || [root];
    const byDate = (a, b) => (tsOf(a) ?? 9e15) - (tsOf(b) ?? 9e15) || a.id - b.id;
    const main = mainGroup.slice().sort(byDate).map((m) => ({ m, extras: [], note: '' }));
    const mainIds = new Set(main.map((x) => x.m.id));
    // dodatki: pod ostatni sezon, który wyszedł przed nimi
    const extras = all.filter((m) => !mainIds.has(m.id)).sort(byDate);
    for (const m of extras) {
      const t = tsOf(m);
      let host = main[0];
      if (t != null) for (const x of main) { const xt = tsOf(x.m); if (xt != null && xt <= t) host = x; }
      host.extras.push({ m, note: '' });
    }
    // prequel wydany później niż seria, której jest prequelem
    const notes = new Map();
    for (const m of all) {
      for (const e of edges(m)) {
        if (e.relationType !== 'PREQUEL' || !ids.has(e.node.id) || notes.has(e.node.id)) continue;
        const pre = nodes.get(e.node.id);
        if (tsOf(pre) && tsOf(m) && tsOf(pre) > tsOf(m)) notes.set(pre.id, `fabularnie dzieje się przed „${titleOf(m)}”`);
      }
    }
    for (const x of main) { x.note = notes.get(x.m.id) || ''; x.extras.forEach((y) => { y.note = notes.get(y.m.id) || ''; }); }
    // wersje alternatywne, spin-offy i reszta: tylko z relacji, bez dalszego chodzenia
    const alts = new Map(), src = new Map();
    for (const m of all) {
      for (const e of edges(m)) {
        const n = e.node;
        if (n.type !== 'ANIME') { if (!src.has(n.id)) src.set(n.id, { n, rel: e.relationType }); continue; }
        if (ids.has(n.id) || alts.has(n.id) || FOLLOW.has(e.relationType) || !okAdult(n)) continue;
        alts.set(n.id, { n, rel: e.relationType });
      }
    }
    const byNode = (a, b) => (tsOf(a.n) ?? 9e15) - (tsOf(b.n) ?? 9e15);
    return { root, main, alts: [...alts.values()].sort(byNode), sources: [...src.values()].sort(byNode), truncated, count: all.length };
  }

  /* ---------- widok ---------- */
  const seenIt = (e) => !!e && (e.status === 'completed' || Lib.finishedCount(e) > 0);
  function statusBtn(m) {
    const e = Lib.get(m.id);
    if (!e) return `<button class="wo-add" type="button" data-add="${m.id}" data-status="planning" data-quick="1" title="Dodaj do Planuję (najedź, żeby wybrać inny status)" aria-label="Dodaj ${esc(titleOf(m))} do listy">${ICON.plus}</button>`;
    const c = Lib.cur(e);
    const txt = seenIt(e) && e.status !== 'watching' ? `${ICON.check}Obejrzane${Lib.finishedCount(e) > 1 ? ` ${Lib.finishedCount(e)}×` : ''}`
      : e.status === 'watching' ? `${ICON.play}${c.progress}/${Lib.epTotal(e) || '?'}`
        : esc(LSTATUS_PL[e.status]);
    return `<button class="wo-st st-${e.status}${seenIt(e) ? ' seen' : ''}" type="button" data-qmenu="${m.id}" title="Zmień status" aria-haspopup="menu">${txt}</button>`;
  }
  function meta(m, note) {
    const p = [FORMAT_PL[m.format] || m.format, UI.yearOf(m), m.episodes ? `${m.episodes} odc.` : (m.status === 'RELEASING' ? 'w emisji' : null), m.status === 'NOT_YET_RELEASED' ? 'zapowiedź' : null].filter(Boolean);
    return `${esc(p.join(' · '))}${note ? ` · <em>${esc(note)}</em>` : ''}`;
  }
  function row(m, { n = null, note = '', root, small = false } = {}) {
    if (m.relations || Lib.get(m.id)) UI.remember(m); // pełne dane → „+” doda bez dodatkowego zapytania
    const here = m.id === root.id;
    const e = Lib.get(m.id);
    return `<div class="wo-row${here ? ' here' : ''}${seenIt(e) ? ' seen' : ''}${small ? ' small' : ''}">
      ${n != null ? `<span class="wo-n num" aria-hidden="true">${n}</span>` : '<span class="wo-n sub" aria-hidden="true"></span>'}
      <a class="wo-cover" href="#/anime/${m.id}" tabindex="-1" aria-hidden="true">${UI.cover(m, 'xs')}</a>
      <div class="wo-main">
        ${here ? `<span class="wo-t">${esc(titleOf(m))}</span>` : `<a class="wo-t" href="#/anime/${m.id}">${esc(titleOf(m))}</a>`}
        <small>${here ? '<b class="wo-here">tu jesteś</b> · ' : ''}${meta(m, note)}</small>
      </div>
      <div class="wo-s">${statusBtn(m)}</div>
    </div>`;
  }

  function summary(d) {
    const items = d.main.flatMap((x) => [x.m, ...x.extras.map((y) => y.m)]);
    let seen = 0, mins = 0, unknown = 0;
    const missing = [];
    for (const m of items) {
      const e = Lib.get(m.id);
      if (!e) missing.push(m);
      if (seenIt(e)) { seen++; continue; }
      if (m.status === 'NOT_YET_RELEASED') continue;
      const dur = e ? Lib.epDur(e) : m.duration;
      const eps = m.episodes || (e && Lib.epTotal(e));
      if (!dur || !eps) { unknown++; continue; }
      mins += Math.max(0, eps - (e ? Lib.cur(e).progress : 0)) * dur;
    }
    const addable = missing.filter((m) => okAdult(m));
    return { items, seen, mins, unknown, addable };
  }

  function html(d) {
    const s = summary(d);
    const pct = s.items.length ? (s.seen / s.items.length) * 100 : 0;
    let n = 0;
    const list = d.main.map((x) => `<li class="wo-it">
        ${row(x.m, { n: ++n, note: x.note, root: d.root })}
        ${x.extras.length ? `<ul class="wo-extra" aria-label="Dodatki">${x.extras.map((y) => `<li>${row(y.m, { note: y.note, root: d.root, small: true })}</li>`).join('')}</ul>` : ''}
      </li>`).join('');
    return UI.section('Kolejność oglądania', `
      <div class="wo-sum">
        <div class="wo-sum-t"><b>Obejrzałeś ${s.seen} z ${s.items.length}</b>${s.seen < s.items.length ? ` · zostało ${s.mins ? esc(fmtDuration(s.mins, { short: true })) : '0 min'}${s.unknown ? ` + ${s.unknown} bez długości` : ''}` : ' · cała seria za Tobą'}</div>
        ${UI.progressBar(s.seen, s.items.length || 1)}
        ${s.addable.length ? `<button class="btn ghost sm" type="button" id="wo-addall">${ICON.plus}Dodaj brakujące (${s.addable.length}) do Planuję</button>` : ''}
      </div>
      <ol class="wo-list">${list}</ol>
      ${d.alts.length ? `<h3 class="sub-h">Inne wersje i spin-offy</h3><div class="wo-alts">${d.alts.map((a) => `<div class="wo-alt"><span class="lbl">${esc(RELATION_PL[a.rel] || a.rel)}</span>${row(a.n, { root: d.root, small: true })}</div>`).join('')}</div>` : ''}
      ${d.sources.length ? `<h3 class="sub-h">Manga i light novel</h3><div class="chips wo-src">${d.sources.map((x) => `<a class="chip link" href="${esc(x.n.siteUrl || `https://anilist.co/manga/${x.n.id}`)}" target="_blank" rel="noopener">${esc(titleOf(x.n))} <small>${esc([RELATION_PL[x.rel] || x.rel, FORMAT_PL[x.n.format] || x.n.format, x.n.startDate && x.n.startDate.year].filter(Boolean).join(' · '))}</small>${ICON.ext}</a>`).join('')}</div>` : ''}
      <p class="src-note">Kolejność premier z relacji AniList. Sezony i filmy są ponumerowane, OVA i specjale wiszą pod sezonem, po którym wyszły. Chronologia fabuły może się różnić, a gdy się rozjeżdża, piszę o tym przy pozycji.${d.truncated ? ' Seria jest bardzo duża, więc pokazuję jej pierwsze ' + d.count + ' pozycji.' : ''}</p>`,
    { sub: `${nUnit(s.items.length, 'item')} w serii · według dat premier` });
  }

  // host: element na stronie anime; m: pełne dane z API (z relacjami)
  async function load(ctx, host, m) {
    if (!host) return;
    let d = memo.get(m.id);
    if (!d) {
      if (!edges(m).some((e) => e.node.type === 'ANIME')) return; // brak powiązanych anime → zostaje zwykła sekcja
      try {
        const r = await collect(m, { alive: ctx.alive });
        if (!r || !ctx.alive()) return;
        d = compose(m, r.nodes, r.truncated);
        memo.set(m.id, d);
      } catch { return; /* zostaje zwykła sekcja „Powiązane” */ }
    }
    const items = d.main.reduce((a, x) => a + 1 + x.extras.length, 0);
    if (items < 2 && !d.alts.length) return;
    const render = () => { if (ctx.alive() && host.isConnected) host.innerHTML = html(d); };
    render();
    host.dataset.wo = '1';
    ctx.onLibrary(render);
    host.addEventListener('click', (ev) => {
      if (!ev.target.closest('#wo-addall')) return;
      const add = summary(d).addable;
      add.forEach((x) => Lib.add(x, 'planning'));
      toast(`Dodano do Planuję: ${nUnit(add.length, 'title')}`, { kind: 'ok', action: { label: 'Cofnij', fn: () => add.forEach((x) => Lib.remove(x.id)) } });
    });
  }

  return { load, compose, collect };
})();
