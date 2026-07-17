// BudgetBuddy Service Worker — cache-first for static assets, network-first for API
const CACHE = 'budgetbuddy-v1'
const STATIC = ['/', '/budget', '/transactions', '/accounts', '/goals', '/coach']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).catch(() => {})
  )
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

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
        return res
      })
      return cached || network
    })
  )
})
