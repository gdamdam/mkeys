// Per-build fingerprint, stamped in at build time by the mkeys-precache-manifest
// vite plugin (replaces the placeholder). It changes whenever any hashed asset
// changes, so sw.js is no longer byte-identical between deploys — that byte
// difference is what makes the browser re-install the SW and re-run precache().
// In dev (unbuilt), it stays the literal placeholder, which is fine.
const BUILD_HASH = '__BUILD_HASH__'
// Cache names carry the build hash so activate() purges every prior deploy's
// shell/runtime caches instead of leaving stale hashed assets behind forever.
const SHELL_CACHE = `mkeys-shell-${BUILD_HASH}`
// Runtime cache is size-capped: hashed bundles from past deploys would otherwise
// accumulate here forever. Trimming to a fixed budget bounds disk usage.
const RUNTIME_CACHE = `mkeys-runtime-${BUILD_HASH}`
const RUNTIME_MAX_ENTRIES = 64
const APP_BASE = new URL('./', self.location.href).pathname
const SHELL_URLS = [APP_BASE, `${APP_BASE}manifest.webmanifest`, `${APP_BASE}mkeys-mark.svg`]

async function precache() {
  const cache = await caches.open(SHELL_CACHE)
  await cache.addAll(SHELL_URLS)
  // Precache the content-hashed build assets (JS/CSS/worklet) listed in the
  // generated manifest. The SW activates after the first visit's assets have
  // already loaded, so without this they would not be cached until re-requested,
  // leaving the first offline load broken. Best-effort: a missing manifest (dev
  // build) or fetch failure still leaves the shell cached and assets fall back to
  // the runtime cache-first handler below.
  try {
    const response = await fetch(`${APP_BASE}precache-manifest.json`, { cache: 'no-store' })
    if (response.ok) {
      const assets = await response.json()
      if (Array.isArray(assets)) {
        await cache.addAll(assets.map((path) => `${APP_BASE}${path}`))
      }
    }
  } catch {
    // Offline precache of hashed assets is best-effort; ignore failures.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Keep claim() inside waitUntil so the browser can't terminate the worker
  // before old caches are purged and clients are claimed.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

// Drop the oldest entries until the cache is within budget. cache.keys() returns
// requests in insertion order, so the front of the list is the least recently
// added — delete from there.
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - maxEntries; i += 1) {
    await cache.delete(keys[i])
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return

  // Network-first for navigations: a stale cached index.html points at hashed
  // asset URLs that no longer exist after a deploy, which renders a blank page.
  // Always try the network, refresh the cached shell, and fall back to cache offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)))
          }
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached ?? caches.match(APP_BASE))),
    )
    return
  }

  // Cache-first for everything else: built assets are content-hashed and immutable.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          event.waitUntil(
            caches.open(RUNTIME_CACHE)
              .then((cache) => cache.put(request, copy))
              .then(() => trimCache(RUNTIME_CACHE, RUNTIME_MAX_ENTRIES)),
          )
        }
        return response
      })
    }),
  )
})
