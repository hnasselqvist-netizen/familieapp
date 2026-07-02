// v-kokebok-quick-1
const CACHE = "familieapp-kokebok1";

self.addEventListener("install", e => {
  self.skipWaiting(); // Aktiver umiddelbart
});

self.addEventListener("activate", e => {
  // Slett ALLE gamle cacher
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  // Ikke cache noe — hent alltid fra nett
  // Kan skru på caching igjen når appen er stabil
  if (e.request.url.includes("firebasedatabase.app") ||
      e.request.url.includes("googleapis.com")) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
