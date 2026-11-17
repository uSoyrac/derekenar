// Renk kategorileri. Beş renk, Preview'ın çizim kalemi renkleriyle aynıdır;
// PDF'ten gelen herhangi bir çizim rengi en yakın kategoriye eşlenir.
export const PALETTE = [
  { key: 'yellow', hex: '#f6c945', name: 'Sarı', hue: 47 },
  { key: 'green', hex: '#6fcf7c', name: 'Yeşil', hue: 128 },
  { key: 'blue', hex: '#6aaef5', name: 'Mavi', hue: 211 },
  { key: 'pink', hex: '#f58fb0', name: 'Pembe', hue: 341 },
  { key: 'purple', hex: '#b48cf2', name: 'Mor', hue: 264 },
];

const byKey = new Map(PALETTE.map((p) => [p.key, p]));
export const paletteOf = (key) => byKey.get(key) || PALETTE[0];

function hueOf(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return null; // gri tonlar
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// Bir rengin kategori anahtarı. Rengi olmayan kayıtlar sarı (varsayılan) sayılır.
export function colorKey(hex) {
  const hue = hueOf(hex);
  if (hue === null) return 'yellow';
  let best = PALETTE[0], bestDist = 999;
  for (const p of PALETTE) {
    const d = Math.min(Math.abs(hue - p.hue), 360 - Math.abs(hue - p.hue));
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best.key;
}
