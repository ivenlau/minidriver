/* MiniDriver Service Worker：PWA 安装的最小实现 + 静态资源离线缓存 */
const VERSION = 'v1'
const SHELL_CACHE = `md-shell-${VERSION}`
const ASSET_CACHE = `md-assets-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add('/index.html'))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k.startsWith('md-') && k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // 只处理同源 GET；API 与文件内容（含 Range）永不缓存
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // 页面导航：网络优先，离线回退缓存的 index.html（SPA）
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(event.request)
          const cache = await caches.open(SHELL_CACHE)
          cache.put('/index.html', res.clone())
          return res
        } catch {
          const cached = (await caches.match('/index.html')) || (await caches.match(event.request))
          return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
        }
      })(),
    )
    return
  }

  // 带内容哈希的构建产物：不可变，缓存优先
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(event.request)
        if (cached) return cached
        const res = await fetch(event.request)
        if (res.ok) {
          const cache = await caches.open(ASSET_CACHE)
          cache.put(event.request, res.clone())
        }
        return res
      })(),
    )
    return
  }

  // 其余静态文件（theme.js / 图标 / manifest）：网络优先，失败回退缓存
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(event.request)
        if (res.ok) {
          const cache = await caches.open(ASSET_CACHE)
          cache.put(event.request, res.clone())
        }
        return res
      } catch {
        const cached = await caches.match(event.request)
        return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      }
    })(),
  )
})
