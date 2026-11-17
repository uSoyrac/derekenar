// PDF dosyasındaki çizimleri (highlight / altı çizili) ve yapışkan notları okur.
// Çizimin altındaki metin, sayfanın metin katmanından geometriyle bulunur;
// metin katmanı yoksa (taranmış PDF) o bölge görüntüye çevrilip OCR'a verilir.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { hash, normText, parseFileName } from './util.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MARKUP = new Set(['Highlight', 'Underline', 'Squiggly']);
const NOTES = new Set(['Text', 'FreeText']);

// --- geometri ---------------------------------------------------------------

function quadRects(annot) {
  const qp = annot.quadPoints;
  const rects = [];
  const push = (xs, ys) => rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  if (qp && qp.length) {
    if (typeof qp[0] === 'number') {
      for (let i = 0; i + 7 < qp.length; i += 8) {
        push([qp[i], qp[i + 2], qp[i + 4], qp[i + 6]], [qp[i + 1], qp[i + 3], qp[i + 5], qp[i + 7]]);
      }
    } else {
      for (const quad of qp) push(quad.map((p) => p.x), quad.map((p) => p.y));
    }
  }
  if (!rects.length && annot.rect) {
    const [a, b, c, d] = annot.rect;
    rects.push([Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]);
  }
  return rects.filter((r) => r[2] - r[0] > 0.5 && r[3] - r[1] > 0.5);
}

// Harf genişliklerini genel bir yazı tipiyle ölçüp öğenin gerçek genişliğine ölçekler.
// Böylece uzun satırlarda çizimin başladığı/bittiği harf doğru bulunur.
let measureCtx;
const widthCache = new Map();
function charWidths(str, family) {
  if (!measureCtx) {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  }
  const font = `100px ${family === 'monospace' ? 'monospace' : family === 'sans-serif' ? 'sans-serif' : 'serif'}`;
  if (measureCtx.font !== font) measureCtx.font = font;
  const out = new Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const key = font + str[i];
    let w = widthCache.get(key);
    if (w === undefined) { w = measureCtx.measureText(str[i]).width || 50; widthCache.set(key, w); }
    out[i] = w;
  }
  return out;
}

function prepareItems(textContent) {
  const items = [];
  for (const it of textContent.items) {
    if (typeof it.str !== 'string' || !it.str.length || !it.width) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > Math.abs(a) * 0.2) continue; // döndürülmüş metin: OCR yoluna bırak
    const h = Math.hypot(c, d) || it.height || 10;
    const family = textContent.styles?.[it.fontName]?.fontFamily || 'serif';
    const widths = charWidths(it.str, family);
    const total = widths.reduce((s, w) => s + w, 0) || 1;
    const edges = [e];
    for (const w of widths) edges.push(edges[edges.length - 1] + (w / total) * it.width);
    items.push({ str: it.str, x: e, y: f, w: it.width, h, edges });
  }
  return items;
}

const isWordChar = (ch) => /[\p{L}\p{N}'’]/u.test(ch);

// Öğenin, dikdörtgenin içinde kalan harf aralığı; sınırlar sözcük başı/sonuna yaslanır.
function sliceItem(item, rect) {
  const [x0, y0, x1, y1] = rect;
  const yc = item.y + item.h * 0.3;
  if (yc < y0 || yc > y1) return null;
  if (item.x + item.w < x0 || item.x > x1) return null;
  const tol = (item.w / item.str.length) * 0.35;
  let s = -1, e = -1;
  for (let k = 0; k < item.str.length; k++) {
    const center = (item.edges[k] + item.edges[k + 1]) / 2;
    if (center >= x0 - tol && center <= x1 + tol) { if (s < 0) s = k; e = k + 1; }
  }
  if (s < 0) return null;
  const str = item.str;
  // Sözcüğün yarısından fazlası çiziliyse tamamını al, değilse o parçayı bırak.
  if (s > 0 && isWordChar(str[s]) && isWordChar(str[s - 1])) {
    let ws = s; while (ws > 0 && isWordChar(str[ws - 1])) ws--;
    let we = s; while (we < str.length && isWordChar(str[we])) we++;
    if (we - s >= (we - ws) / 2) s = ws; else s = Math.min(we, e);
  }
  if (e < str.length && e > s && isWordChar(str[e - 1]) && isWordChar(str[e])) {
    let ws = e; while (ws > 0 && isWordChar(str[ws - 1])) ws--;
    let we = e; while (we < str.length && isWordChar(str[we])) we++;
    if (e - ws >= (we - ws) / 2) e = we; else e = Math.max(ws, s);
  }
  if (e <= s) return null;
  return { text: str.slice(s, e), x: item.edges[s], xEnd: item.edges[e], h: item.h };
}

function joinLines(lines) {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) { out = line; continue; }
    // Satır sonunda bölünmüş sözcüğü birleştir.
    if (/[\p{L}][-­‐]$/u.test(out) && /^\p{Ll}/u.test(line)) out = out.slice(0, -1) + line;
    else out += ' ' + line;
  }
  return normText(out);
}

function textUnderRects(items, rects) {
  const lines = [];
  for (const rect of rects) {
    const pieces = [];
    for (const item of items) {
      const piece = sliceItem(item, rect);
      if (piece) pieces.push(piece);
    }
    pieces.sort((a, b) => a.x - b.x);
    let line = '';
    let lastEnd = null;
    for (const p of pieces) {
      if (lastEnd !== null && p.x - lastEnd > p.h * 0.12 && !/\s$/.test(line) && !/^\s/.test(p.text)) line += ' ';
      line += p.text;
      lastEnd = p.xEnd;
    }
    lines.push(line);
  }
  return joinLines(lines);
}

// --- üst veri ----------------------------------------------------------------

function cleanTitle(title) {
  const t = normText(title).replace(/^Microsoft Word - /i, '');
  if (!t || /\.(docx?|indd|pdf|tex|dvi|qxd)$/i.test(t) || /^untitled$/i.test(t)) return '';
  return t;
}

function toHex(color) {
  if (!color || color.length < 3) return '';
  return '#' + [color[0], color[1], color[2]].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

function pdfDate(str) {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(str || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0));
  return Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 86400000 ? null : d.toISOString();
}

// --- ana işlev ---------------------------------------------------------------

/**
 * @param {File|Blob} file
 * @param {{ ocr?: () => Promise<object>, onProgress?: (done: number, total: number) => void, fileName?: string }} opts
 * @returns {Promise<{ source: object, items: object[], stats: { highlights: number, notes: number, ocr: number, empty: number } }>}
 */
export async function extractPdf(file, opts = {}) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  try {
    const fileName = opts.fileName || file.name || 'belge.pdf';
    const meta = await pdf.getMetadata().catch(() => ({ info: {} }));
    const fromName = parseFileName(fileName);
    const title = cleanTitle(meta.info?.Title) || fromName.title;
    const author = normText(meta.info?.Author) || fromName.author;
    const docId = pdf.fingerprints?.[0] || hash(fileName + data.length);
    const labels = await pdf.getPageLabels().catch(() => null);

    const source = {
      kind: 'pdf', title, author, year: fromName.year, file_name: fileName, fingerprint: `pdf:${docId}`,
    };
    const items = [];
    const stats = { highlights: 0, notes: 0, ocr: 0, empty: 0 };
    let ocrEngine = null;

    for (let n = 1; n <= pdf.numPages; n++) {
      opts.onProgress?.(n - 1, pdf.numPages);
      const page = await pdf.getPage(n);
      const annots = (await page.getAnnotations()).filter((a) => MARKUP.has(a.subtype) || NOTES.has(a.subtype));
      if (!annots.length) { page.cleanup(); continue; }

      const label = labels?.[n - 1] && /\S/.test(labels[n - 1]) ? labels[n - 1] : String(n);
      const textItems = prepareItems(await page.getTextContent());
      let rendered = null;

      // Sayfadaki okuma sırasına göre: yukarıdan aşağı, soldan sağa.
      const withRects = annots.map((a) => ({ a, rects: quadRects(a) })).filter((x) => x.rects.length || NOTES.has(x.a.subtype));
      withRects.sort((p, q) => {
        const pr = p.rects[0] || p.a.rect, qr = q.rects[0] || q.a.rect;
        return (qr[3] - pr[3]) || (pr[0] - qr[0]);
      });

      for (const { a, rects } of withRects) {
        const comment = normText(a.contentsObj?.str || '');
        const created_at = pdfDate(a.modificationDate) || pdfDate(a.creationDate) || undefined;
        if (NOTES.has(a.subtype)) {
          if (!comment) continue;
          stats.notes++;
          items.push({ text: '', note: comment, page: label, color: toHex(a.color), origin: 'pdf', created_at, fingerprint: `${source.fingerprint}:${n}:n:${hash(comment)}` });
          continue;
        }
        let text = textUnderRects(textItems, rects);
        let viaOcr = false;
        if (!text && opts.ocr) {
          try {
            ocrEngine ||= await opts.ocr();
            rendered ||= await renderPage(page);
            text = await ocrRects(ocrEngine, rendered, rects);
            viaOcr = Boolean(text);
          } catch (err) {
            console.warn('OCR başarısız', err);
          }
        }
        if (!text) { stats.empty++; continue; }
        stats.highlights++;
        if (viaOcr) stats.ocr++;
        items.push({
          text, note: comment, page: label, color: toHex(a.color), origin: viaOcr ? 'pdf-ocr' : 'pdf', created_at,
          fingerprint: `${source.fingerprint}:${n}:${hash(text)}`,
        });
      }
      page.cleanup();
    }
    opts.onProgress?.(pdf.numPages, pdf.numPages);
    return { source, items, stats };
  } finally {
    await pdf.destroy();
  }
}

// --- taranmış sayfalar için OCR ------------------------------------------------

async function renderPage(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 3600 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Çizimin rengi metni örtmesin diye ek açıklamalar çizilmez.
  await page.render({ canvasContext: ctx, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
  return { canvas, viewport, scale };
}

async function ocrRects(engine, rendered, rects) {
  const { canvas, viewport, scale } = rendered;
  const lines = [];
  for (const rect of rects) {
    const [vx0, vy0, vx1, vy1] = viewport.convertToViewportRectangle(rect);
    const pad = 3 * scale;
    const x = Math.max(0, Math.min(vx0, vx1) - pad);
    const y = Math.max(0, Math.min(vy0, vy1) - pad);
    const w = Math.min(canvas.width - x, Math.abs(vx1 - vx0) + pad * 2);
    const h = Math.min(canvas.height - y, Math.abs(vy1 - vy0) + pad * 2);
    if (w < 8 || h < 8) continue;
    const crop = document.createElement('canvas');
    crop.width = Math.ceil(w); crop.height = Math.ceil(h);
    crop.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, crop.width, crop.height);
    const heightPt = rect[3] - rect[1];
    const text = await engine.recognize(crop, { block: rects.length === 1 && heightPt > 30 });
    lines.push(...text.split('\n'));
  }
  return joinLines(lines);
}
