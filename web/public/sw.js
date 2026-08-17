// BudgetBuddy Service Worker — network-first for pages (so a normal refresh
// always gets the latest deploy instead of a stale cached HTML shell),
// cache-first for hashed static assets (safe: their URLs change per build),
// always network for API requests.
const CACHE = 'budgetbuddy-v2'

self.addEventListener('install', e => {
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // Skip non-GET and API requests (always network for API)
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return

  // Page navigations and Next.js data/RSC requests — network-first, so a
  // redeploy is visible on a normal refresh, not just a hard refresh.
  // Only fall back to the cache when actually offline.
  const isNavigation = e.request.mode === 'navigate' || url.pathname.startsWith('/_next/data/')
  if (isNavigation) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE).then(c => c.put(e.request, clone))
          }
          return res
        })
        .catch(() => caches.match(e.request))
    )
    return
  }

  // Fingerprinted static assets (/_next/static/*, images, etc.) — safe to
  // cache-first since a new build ships a new URL for changed content.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      })
    })
  )
})
