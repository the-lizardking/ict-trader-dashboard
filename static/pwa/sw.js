const CACHE = "ict-widget-v1";
const SHELL = [
  "/",
  "/static/pwa/index.html",
  "/static/pwa/style.css",
  "/static/pwa/app.js",
  "/static/pwa/icons/icon.svg",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => { /* tolerate missing */ }))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Network-first for the live payload; serve stale-cache when offline.
  if (url.pathname === "/api/widget" || url.pathname === "/api/widget.json") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for the shell.
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request))
  );
});

// Periodic background sync (Chrome on Android) — best-effort refresh of
// the cached payload so the widget shows fresh data on first paint.
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "widget-refresh") {
    event.waitUntil(
      fetch("/api/widget.json", { cache: "no-store" }).then((res) =>
        caches.open(CACHE).then((c) => c.put("/api/widget.json", res.clone()))
      ).catch(() => null)
    );
  }
});
