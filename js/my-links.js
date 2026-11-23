'use strict';
/* ==========================================================================
   Disboard — własne linki
   Wpisz swoje linki do MY_LINKS poniżej. Pojawią się na stronie anime:
   – linki bez {odcinek} w ramce „Linki” (obok AniList i MAL),
   – linki z {odcinek} (albo z funkcją episode) przy każdym odcinku na liście.
   Każdy link otwiera się w nowej karcie.

   UWAGA: repozytorium jest publiczne, więc to, co tu wpiszesz, widać na GitHubie.

   Wstawki w adresie (same się zakodują do adresu):
     {tytul}     tytuł z nagłówka (według ustawienia języka tytułów)
     {romaji}    np. Shingeki no Kyojin
     {angielski} np. Attack on Titan
     {natywny}   np. 進撃の巨人
     {rok}       rok premiery
     {anilist}   numer anime w AniList
     {mal}       numer anime w MyAnimeList
     {odcinek}   numer odcinka (tylko w linkach do odcinków)
   Jeśli któraś wstawka jest pusta (np. anime nie ma numeru MAL), link się nie pokaże.

   Zamiast adresu możesz podać własną funkcję, która zwraca adres (albo null,
   żeby nie pokazywać linku). Dostaje obiekt a z polami: id, mal, tytul,
   romaji, angielski, natywny, rok, odcinki (liczba odcinków serii).
     anime:   (a) => adres
     episode: (a, n) => adres        n = numer odcinka
   ========================================================================== */

const MY_LINKS = [
  // Przykłady (usuń „//” na początku linii, żeby włączyć):
  // { name: 'Wikipedia', url: 'https://pl.wikipedia.org/w/index.php?search={romaji}' },
  // { name: 'Reddit', url: 'https://www.reddit.com/r/anime/search/?q={romaji}+episode+{odcinek}+discussion' },
  // { name: 'Mój link', episode: (a, n) => `https://example.com/${a.anilist}/${n}` },
];

/* ---------- silnik: tego nie trzeba zmieniać ---------- */
const MyLinks = (() => {
  const warned = new Set();
  const warn = (name, err) => { if (!warned.has(name)) { warned.add(name); console.warn(`Własny link „${name}” zgłosił błąd:`, err); } };

  function info(m) {
    const t = (m && m.title) || {};
    return {
      id: m.id, anilist: m.id, mal: m.idMal || null,
      tytul: titleOf(m), romaji: t.romaji || '', angielski: t.english || '', natywny: t.native || '',
      rok: m.seasonYear || (m.startDate && m.startDate.year) || '',
      odcinki: m.episodes || null,
    };
  }
  // null, gdy brakuje którejś wstawki — wtedy link się nie pokazuje
  function fill(tpl, a, n) {
    let missing = false;
    const out = String(tpl).replace(/\{(\w+)\}/g, (all, k) => {
      const v = k === 'odcinek' ? n : a[k];
      if (v == null || v === '') { missing = true; return ''; }
      return encodeURIComponent(String(v));
    });
    return missing ? null : out;
  }
  const httpOnly = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);
  const perEpisode = (x) => typeof x.episode === 'function' || (typeof x.url === 'string' && x.url.includes('{odcinek}'));
  const config = () => (Array.isArray(MY_LINKS) ? MY_LINKS : []).filter((x) => x && x.name && (x.url || x.anime || x.episode));

  function make(x, a, n) {
    try {
      const fn = n == null ? x.anime : x.episode;
      const u = typeof fn === 'function' ? fn(a, n) : (x.url ? fill(x.url, a, n) : null);
      return httpOnly(u);
    } catch (err) { warn(x.name, err); return null; }
  }

  // linki do całego anime: [{ name, url }]
  function forAnime(m, list = config()) {
    if (!m) return [];
    const a = info(m);
    return list.filter((x) => !perEpisode(x)).map((x) => ({ name: String(x.name), url: make(x, a, null) })).filter((l) => l.url);
  }
  // linki do jednego odcinka: [{ name, url }]
  function forEpisode(m, n, list = config()) {
    if (!m || !n) return [];
    const a = info(m);
    return list.filter(perEpisode).map((x) => ({ name: String(x.name), url: make(x, a, n) })).filter((l) => l.url);
  }
  const hasEpisodeLinks = (list = config()) => list.some(perEpisode);

  return { forAnime, forEpisode, hasEpisodeLinks };
})();
