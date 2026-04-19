/**
 * Ledger service worker — keeps the app usable when the connection dies.
 *
 * Strategy:
 *   - App shell (icons, manifest, root HTML): cache-first.
 *   - Static Next build assets (/_next/static/*): cache-first with long TTL.
 *   - Data (HTML pages, API responses): network-first; falls back to cache
 *     only if the network fails.
 *
 * Intentionally lightweight — no build-time workbox wiring.
 */

const VERSION = "ledger-v1";
const SHELL_CACHE = `shell-${VERSION}`;
const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

const SHELL_ASSETS = [
  "/manifest.json",
  "/icon-192.svg",
  "/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.endsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Shell + static: cache-first
  if (
    SHELL_ASSETS.some((a) => url.pathname === a) ||
    url.pathname.startsWith("/_next/static/")
  ) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else: network-first with cache fallback
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match("/"))),
  );
});
