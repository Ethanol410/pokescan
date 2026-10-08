/* Service worker PokéScan : l'appli s'ouvre même sans réseau,
   et les cartes déjà consultées restent disponibles hors ligne. */
const VERSION = "pokescan-v4";
const SHELL = ["./", "index.html", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const update = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || update;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "api.tcgdex.net") return e.respondWith(networkFirst(req));          // prix : frais si possible
  if (url.hostname === "assets.tcgdex.net" || url.hostname === "cdn.jsdelivr.net" ||
      url.hostname.endsWith("gstatic.com") || url.hostname === "fonts.googleapis.com" ||
      url.hostname.endsWith("projectnaptha.com")) return e.respondWith(cacheFirst(req));  // images, OCR, polices
  if (url.origin === location.origin) return e.respondWith(staleWhileRevalidate(req));      // l'appli elle-même
});
