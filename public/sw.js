// Service worker : rend l'appli installable et utilisable hors ligne.
// - Fichiers de l'appli (HTML/JS/CSS) : réseau d'abord, pour toujours avoir la dernière version.
// - Modèle et moteur ONNX (~30 Mo, ne changent pas) : cache d'abord, téléchargés une seule fois.
// - Polices Google : servies depuis le cache, mises à jour en arrière-plan.
const APP_CACHE = 'genrescope-app-v4';
const ASSET_CACHE = 'genrescope-assets-v2'; // v2 : ONNX Runtime 1.18 (build sans threads)
const FONT_CACHE = 'genrescope-fonts-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'worker.js', 'mel.js', 'capture-worklet.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![APP_CACHE, ASSET_CACHE, FONT_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// À la 1re visite, la page charge le modèle avant que le service worker ne la contrôle :
// la page demande donc explicitement de le mettre en cache (servi par le cache HTTP, sans re-télécharger).
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cache-assets') return;
  e.waitUntil(caches.open(ASSET_CACHE).then(async (cache) => {
    for (const url of e.data.urls) {
      if (new URL(url).origin !== location.origin) continue;
      if (!(await cache.match(url))) await cache.add(url).catch(() => {});
    }
  }));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const hit = await cache.match(e.request);
        const update = fetch(e.request).then((res) => {
          if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
          return res;
        }).catch(() => hit);
        return hit || update;
      }),
    );
    return;
  }
  if (url.origin !== location.origin) return;

  if (/\/(models|vendor)\//.test(url.pathname)) {
    e.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }

  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) caches.open(APP_CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
