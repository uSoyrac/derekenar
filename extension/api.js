// Derkenar sunucusuyla konuşan küçük istemci. Bağlantı kodu, web uygulamasının
// Ayarlar sayfasında üretilir: base64(JSON {u: sunucu adresi, k: açık anahtar, t: bağlantı kodu, a: uygulama adresi}).

export function decodeCode(code) {
  const clean = String(code || '').replace(/\s+/g, '');
  let conn;
  try { conn = JSON.parse(atob(clean)); } catch { throw new Error('Bağlantı kodu okunamadı; kodu eksiksiz yapıştırdığından emin ol'); }
  if (!conn.u || !conn.k || !conn.t) throw new Error('Bağlantı kodu eksik');
  return conn;
}

export async function getConn() {
  const { conn } = await chrome.storage.local.get('conn');
  return conn || null;
}

export async function rpc(fn, args, conn) {
  conn ||= await getConn();
  if (!conn) throw new Error('Eklenti henüz bağlanmadı; ayarlardan bağlantı kodunu gir');
  let res;
  try {
    res = await fetch(`${conn.u}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: conn.k, Authorization: `Bearer ${conn.k}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: conn.t, ...args }),
    });
  } catch {
    throw new Error('Sunucuya ulaşılamadı');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || `Sunucu hatası (${res.status})`);
  return data;
}

// Adresin izleme parametrelerini ve sayfa içi bağlantısını at: aynı sayfa hep aynı kaynağa gitsin.
export function cleanUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch { return url || ''; }
}

// Sekmeden kaynak bilgisi çıkar. PDF ise dosya adı da gönderilir; böylece
// içe aktarılmış aynı PDF'in kaynağına bağlanır.
export function sourceFromTab(tab, pageUrl) {
  const raw = pageUrl || tab?.url || '';
  const url = cleanUrl(raw);
  let fileName = '';
  try {
    const last = decodeURIComponent(new URL(raw).pathname.split('/').pop() || '');
    if (/\.pdf$/i.test(last)) fileName = last;
  } catch { /* adres çözülemedi */ }
  const isPdf = Boolean(fileName);
  return {
    url: /^https?:/.test(url) ? url : '',
    title: isPdf ? fileName.replace(/\.pdf$/i, '') : (tab?.title || '').trim(),
    kind: isPdf ? 'pdf' : 'web',
    file_name: fileName,
  };
}
