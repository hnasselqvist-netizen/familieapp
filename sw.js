const CACHE = "familieapp-v1";
const ASSETS = [
  "/",
  "/index.html",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone@7.23.10/babel.min.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js"
];

// Installer og cache alle ressurser
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Rydd opp gamle cacher
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Serve fra cache, fall tilbake til nett
self.addEventListener("fetch", e => {
  // Ikke cache Firebase-dataforespørsler
  if (e.request.url.includes("firebasedatabase.app") ||
      e.request.url.includes("googleapis.com") ||
      e.request.url.includes("firebaseauth")) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
