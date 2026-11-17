// Derkenar servis işçisi: uygulama kabuğunu önbelleğe alır, böylece yüklü uygulama
// bağlantı zayıfken de açılır. Veri istekleri (Supabase) önbelleğe alınmaz.
const CACHE = 'derkenar-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/config.json')) return;

  // Sayfanın kendisi: önce ağ, olmazsa önbellek (paylaşım parametreleri yok sayılır).
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put('./', res.clone());
        return res;
      } catch {
        return (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Derlenmiş dosyalar içerik özetiyle adlandırıldığı için önbellekten sunulabilir.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && (url.pathname.includes('/assets/') || url.pathname.includes('/ocr/') || /\.(png|svg|webmanifest)$/.test(url.pathname))) {
      cache.put(req, res.clone());
    }
    return res;
  })());
});
