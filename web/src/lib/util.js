export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : fallbackUuid());

function fallbackUuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const nowIso = () => new Date().toISOString();

export function deviceName() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPad|iPhone/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iOS';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Tarayıcı';
}

// Küçük, hızlı, kriptografik olmayan özet (parmak izi için yeterli).
export function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export const normText = (s) => (s || '').replace(/\s+/g, ' ').trim();

// Türkçe büyük/küçük harf ve aksan duyarsız arama için sadeleştirme.
export function fold(s) {
  return (s || '').toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const dayFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const dayNoYear = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
const timeFmt = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

export const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Dün';
  return d.getFullYear() === today.getFullYear() ? dayNoYear.format(d) : dayFmt.format(d);
}

export const timeLabel = (iso) => timeFmt.format(new Date(iso));
export const dateLabel = (iso) => dayFmt.format(new Date(iso));

// "Yazar (2019)" / "Başlık" gibi kısa kaynak etiketi.
export function sourceLabel(source) {
  if (!source) return 'Kaynaksız';
  const title = source.title || source.file_name || source.url || 'Adsız kaynak';
  if (source.author) return `${source.author}${source.year ? ` (${source.year})` : ''} · ${title}`;
  return source.year ? `${title} (${source.year})` : title;
}

// Metin içi gönderme: (Yazar, 2019, s. 12)
export function citation(source, page) {
  if (!source) return '';
  const who = source.author || source.title || source.file_name || '';
  const parts = [who, source.year || 't.y.'];
  if (page) parts.push(`s. ${page}`);
  return `(${parts.filter(Boolean).join(', ')})`;
}

// Kaynakça satırı (APA'ya yakın, sade).
export function reference(source) {
  const bits = [];
  bits.push(`${source.author || source.title || source.file_name || 'Adsız'} (${source.year || 't.y.'}).`);
  if (source.author && source.title) bits.push(`${source.title}.`);
  if (source.container) bits.push(`${source.container}.`);
  if (source.url) bits.push(source.url);
  return bits.join(' ');
}

export function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// Bir paylaşım metninden adresi ayır: Android, seçimi ve adresi tek metinde gönderebilir.
export function splitSharedText(text) {
  const raw = (text || '').trim();
  const m = raw.match(/https?:\/\/\S+/g);
  if (!m) return { text: raw.replace(/^"|"$/g, ''), url: '' };
  const url = m[m.length - 1];
  const rest = raw.replace(url, '').trim().replace(/^["“]|["”]$/g, '').trim();
  return { text: rest, url };
}

export function cleanUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch { return url || ''; }
}

// "Yazar - 2019 - Başlık.pdf" (Zotero) ya da "Yazar (2019) Başlık.pdf" kalıplarını çözer.
export function parseFileName(name) {
  const base = (name || '').replace(/\.pdf$/i, '').replace(/_/g, ' ').trim();
  let m = base.match(/^(.+?)\s+-\s+(\d{4})\s+-\s+(.+)$/);
  if (m) return { author: m[1].trim(), year: m[2], title: m[3].trim() };
  m = base.match(/^(.+?)\s*\((\d{4})\)\s*[-–.]?\s*(.+)$/);
  if (m) return { author: m[1].trim(), year: m[2], title: m[3].trim() };
  return { author: '', year: '', title: base };
}
