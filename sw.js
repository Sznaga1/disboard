/* Disboard — service worker: działanie aplikacji bez sieci.
   Strategia „najpierw sieć”: nowa wersja plików trafia do Ciebie od razu,
   a gdy sieci brak, aplikacja otwiera się z kopii. Dane API cache'uje sama aplikacja. */
const CACHE = 'disboard-shell-v14';
const SHELL = [
  './', 'index.html', 'css/app.css', 'css/themes.css', 'css/fx.css', 'manifest.webmanifest',
  'js/util.js', 'js/db.js', 'js/api.js', 'js/library.js', 'js/ngnl.js', 'js/io.js',
  'js/charts.js', 'js/ui.js', 'js/pages.js', 'js/app.js', 'js/translate.js', 'js/scanner.js', 'js/quickadd.js',
  'js/extras.js', 'js/episodes.js', 'js/nerd.js', 'js/person.js', 'js/ngnl-timeline.js', 'js/watch-order.js', 'js/radar.js', 'js/fx.js',
  'icons/icon.svg', 'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
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
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
