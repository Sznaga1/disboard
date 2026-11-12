'use strict';
/* ==========================================================================
   Disboard — dane dodatkowe o anime z listy (do statystyk dla nerda)
   Studia, źródło, tagi, rankingi AniList, rozkład ocen społeczności,
   główne postacie z japońskimi aktorami głosowymi i twórcy.
   Pobierane w tle partiami, zapisane w pamięci podręcznej na 30 dni.
   ========================================================================== */

const Extras = (() => {
  const KEY = 'extras:v1';
  const TTL = 30 * 86400e3;
  let map = null;
  let running = null;

  async function load() {
    if (map) return map;
    const hit = await IDB.get('cache', KEY);
    map = (hit && hit.data) || {};
    return map;
  }
  const persist = () => IDB.set('cache', KEY, { t: Date.now(), data: map });

  function compact(m) {
    const edges = (m.characters && m.characters.edges) || [];
    return {
      t: Date.now(),
      source: m.source || null,
      pop: m.popularity ?? null,
      favs: m.favourites ?? null,
      studios: ((m.studios && m.studios.edges) || []).filter((e) => e.isMain).map((e) => ({ id: e.node.id, n: e.node.name })),
      tags: (m.tags || []).filter((t) => !t.isMediaSpoiler && t.rank >= 60).slice(0, 12).map((t) => [t.name, t.rank]),
      rank: (m.rankings || []).map((r) => ({ r: r.rank, t: r.type, a: r.allTime, s: r.season, y: r.year, f: r.format, c: r.context })),
      dist: ((m.stats && m.stats.scoreDistribution) || []).map((d) => [d.score, d.amount]),
      chars: edges.map((e) => {
        const va = (e.voiceActors || [])[0];
        return {
          id: e.node.id, n: e.node.name && e.node.name.full, img: e.node.image && e.node.image.medium, role: e.role,
          va: va ? { id: va.id, n: va.name && va.name.full, nn: va.name && va.name.native, img: va.image && va.image.medium } : null,
        };
      }),
      staff: ((m.staff && m.staff.edges) || []).map((e) => ({ id: e.node.id, n: e.node.name && e.node.name.full, img: e.node.image && e.node.image.medium, role: e.role })),
    };
  }

  const stale = (x) => !x || Date.now() - x.t > TTL;

  // pobiera brakujące dane partiami; przy zbyt złożonym zapytaniu zmniejsza partię
  async function ensure(ids, { onProgress, alive } = {}) {
    await load();
    // poprzednie pobieranie (np. z opuszczonej strony) kończymy i liczymy od nowa
    if (running) { await running.catch(() => {}); return ensure(ids, { onProgress, alive }); }
    running = (async () => {
      const todo = ids.filter((id) => stale(map[id]));
      let size = 6, done = 0, failed = false;
      for (let i = 0; i < todo.length;) {
        if (alive && !alive()) break;
        const chunk = todo.slice(i, i + size);
        try {
          const media = await Ani.extra(chunk);
          for (const m of media) map[m.id] = compact(m);
          for (const id of chunk) if (!map[id]) map[id] = { t: Date.now(), missing: true };
          i += chunk.length;
          done += chunk.length;
          await persist();
          if (onProgress) onProgress(done, todo.length);
        } catch (err) {
          if (size > 1 && err.kind !== 'network' && err.kind !== 'rate') { size = Math.max(1, Math.floor(size / 2)); continue; }
          failed = true;
          break;
        }
      }
      return { done, total: todo.length, failed };
    })();
    try { return await running; } finally { running = null; }
  }

  const missing = (ids) => ids.filter((id) => stale(map && map[id]));
  const busy = () => !!running;

  return { load, ensure, missing, busy, get: (id) => (map ? map[id] : null), all: () => map || {}, compact };
})();
