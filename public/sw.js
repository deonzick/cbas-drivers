// Minimal service worker: makes the app installable and keeps the last-loaded screens
// available when signal drops. Data (Supabase, Google) always goes to the network.
const CACHE = "cbas-shell-v4";
const SHELL = ["/", "/plan", "/me", "/login", "/manifest.webmanifest", "/icons/icon-192.png", "/brand/cbas-logo-color.svg", "/brand/cbas-logo-white.svg"];

self.addEventListener("install", (e) => {
  // Pre-load the driver screens so the app opens with no signal even before they're visited.
  e.waitUntil((async () => {
    try {
      const c = await caches.open(CACHE);
      await c.addAll(SHELL);
      // Also keep the scripts those screens need, so they run offline.
      const assets = new Set();
      for (const path of ["/", "/plan", "/me", "/login"]) {
        const res = await c.match(path);
        const html = res ? await res.text() : "";
        for (const m of html.matchAll(/\/_next\/static\/[^"'\s)]+/g)) assets.add(m[0]);
      }
      await c.addAll([...assets]);
    } catch (_) { /* first load without signal: nothing to cache yet */ }
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Network first, fall back to the cached copy when offline.
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (req.mode === "navigate" || url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/"))) {
        const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("/")))
  );
});
