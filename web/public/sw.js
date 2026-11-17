// Derkenar servis işçisi: uygulama kabuğunu önbelleğe alır, böylece yüklü uygulama
// bağlantı zayıfken de açılır. Veri istekleri (Supabase) önbelleğe alınmaz.
const CACHE = 'derkenar-v2';
const SHARED = 'derkenar-paylasilan';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE && key !== SHARED) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Android'de "Paylaş → Derkenar": seçili metin adres parametrelerine çevrilir,
// PDF dosyaları geçici olarak saklanır ve uygulama açılınca içe alınır.
async function receiveShare(request) {
  const form = await request.formData();
  const files = form.getAll('files').filter((f) => f && typeof f !== 'string' && f.size > 0);
  const target = new URL('./', self.registration.scope);
  if (files.length) {
    const cache = await caches.open(SHARED);
    for (const key of await cache.keys()) await cache.delete(key);
    await Promise.all(files.map((file, i) => cache.put(
      new URL(`./__paylasilan/${i}`, self.registration.scope).href,
      new Response(file, { headers: { 'content-type': file.type || 'application/pdf', 'x-file-name': encodeURIComponent(file.name || `paylasilan-${i + 1}.pdf`) } }),
    )));
    target.searchParams.set('shared', String(files.length));
  } else {
    for (const key of ['title', 'text', 'url']) {
      const value = form.get(key);
      if (typeof value === 'string' && value) target.searchParams.set(key, value);
    }
  }
  return Response.redirect(target.href, 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(req));
    return;
  }
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
