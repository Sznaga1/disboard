/* Disboard — service worker: działanie aplikacji bez sieci.
   Strategia „najpierw sieć”: nowa wersja plików trafia do Ciebie od razu,
   a gdy sieci brak, aplikacja otwiera się z kopii. Dane API cache'uje sama aplikacja.
   Kopia odświeża się przy każdym wejściu online, więc nazwa cache jest stała
   i nie trzeba jej podbijać przy aktualizacjach. Gdy zmienisz listę plików
   poniżej, przeglądarka sama zainstaluje nowego service workera. */
const CACHE = 'disboard-shell';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'css/themes.css', 'css/fx.css',
  'js/util.js', 'js/db.js', 'js/api.js', 'js/library.js', 'js/extras.js', 'js/episodes.js', 'js/ngnl.js', 'js/io.js', 'js/folder-backup.js',
  'js/translate.js', 'js/charts.js', 'js/ui.js',
  'js/pages/common.js', 'js/pages/home.js', 'js/pages/list.js', 'js/pages/search.js', 'js/pages/anime.js',
  'js/pages/upcoming.js', 'js/pages/ngnl.js', 'js/pages/stats.js', 'js/pages/settings.js', 'js/pages/lightbox.js',
  'js/nerd.js', 'js/person.js', 'js/ngnl-timeline.js', 'js/watch-order.js', 'js/radar.js', 'js/scanner.js',
  'js/quickadd.js', 'js/fx.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' omija pamięć HTTP przeglądarki, żeby nie zapisać starej wersji pliku
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  // sprzątanie kopii z dawnych wersji (disboard-shell-v1 … v14)
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('ngnl-feed.json')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
