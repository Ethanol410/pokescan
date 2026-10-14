/* Service worker PokéScan : l'appli s'ouvre même sans réseau,
   et les cartes déjà consultées restent disponibles hors ligne. */
const VERSION = "pokescan-v13";
// Caches gardés d'une version à l'autre : base d'images, prix et images de cartes (préparation braderie).
const KEEP = ["pokescan-index", "pokescan-api", "pokescan-img"];
const SHELL = ["./", "index.html", "app.js", "match.js", "locate.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
// Prix : réseau d'abord, mais pas plus de 3,5 s si on a déjà une copie (réseau faible en braderie) ;
// la réponse du réseau, si elle finit par arriver, met la copie à jour pour la prochaine fois.
async function apiFirst(req) {
  const cache = await caches.open("pokescan-api");
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  if (!hit) return net;
  const timeout = new Promise((r) => setTimeout(() => r(hit), 3500));
  return Promise.race([net.catch(() => hit), timeout]);
}
async function cacheFirst(req, name = VERSION) {
  const cache = await caches.open(name);
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

// Garde un seul index en cache (environ 6 Mo) : le nouveau remplace l'ancien.
async function indexFile(req) {
  const cache = await caches.open("pokescan-index");
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    for (const k of await cache.keys()) await cache.delete(k);
    await cache.put(req, res.clone());
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "api.tcgdex.net") return e.respondWith(apiFirst(req));              // prix : frais si possible
  if (url.hostname === "assets.tcgdex.net") return e.respondWith(cacheFirst(req, "pokescan-img")); // images de cartes
  if (url.hostname === "cdn.jsdelivr.net" ||
      url.hostname.endsWith("gstatic.com") || url.hostname === "fonts.googleapis.com" ||
      url.hostname.endsWith("projectnaptha.com")) return e.respondWith(cacheFirst(req));  // images, OCR, polices
  // Index d'images : le fichier change de nom à chaque mise à jour, on le garde tel quel.
  if (url.origin === location.origin && /\/index\/cards-[\w]+\.bin$/.test(url.pathname)) return e.respondWith(indexFile(req));
  if (url.origin === location.origin && url.pathname.endsWith("/index/cards.json")) return e.respondWith(networkFirst(req));
  if (url.origin === location.origin) return e.respondWith(staleWhileRevalidate(req));      // l'appli elle-même
});
