// Service worker: deja la app disponible sin conexión.
// Al cambiar archivos de la app, subir la versión para forzar la actualización.
const CACHE = 'sattracker-v3';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/orbit.js',
  'js/sats.js',
  'js/db.js',
  'js/recorder.js',
  'js/adif.js',
  'vendor/satellite.esm.js',
  'data/amateur.tle',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' evita guardar copias viejas de la caché HTTP del navegador
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // TLE de CelesTrak: siempre red
  // Primero la red (para tener siempre la última versión), con la caché como respaldo
  // si no hay conexión o la red tarda más de 3 s (por ejemplo, en el campo).
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok) cache.put(e.request, r.clone());
      return r;
    });
    net.catch(() => {});
    const timeout = new Promise(res => setTimeout(res, 3000));
    try {
      const r = await Promise.race([net, timeout]);
      if (r) return r;
    } catch { /* sin red */ }
    return (await cache.match(e.request, { ignoreSearch: true })) || net;
  })());
});
