// PDF dosyalarını kütüphaneye aktarır: çizimleri çıkarır, kaynağı bulur/oluşturur, yeni alıntıları ekler.
import { ensureSource, addQuotes } from '../state.js';
import { getOcrEngine } from './ocr.js';

let pdfModule;
const loadPdf = () => (pdfModule ||= import('./pdf-import.js'));

/**
 * @returns {Promise<{ fileName: string, title: string, found: number, added: number, ocr: number, empty: number, sourceId: string|null, error?: string }>}
 */
export async function importPdfFile(file, { onProgress, fileName } = {}) {
  const name = fileName || file.name;
  try {
    const { extractPdf } = await loadPdf();
    const { source, items, stats } = await extractPdf(file, { ocr: getOcrEngine, onProgress, fileName: name });
    if (!items.length) {
      return { fileName: name, title: source.title, found: 0, added: 0, ocr: 0, empty: stats.empty, sourceId: null };
    }
    const saved = await ensureSource(source);
    const inserted = await addQuotes(items.map((it) => ({ ...it, source_id: saved.id })));
    return { fileName: name, title: saved.title || source.title, found: items.length, added: inserted.length, ocr: stats.ocr, empty: stats.empty, sourceId: saved.id };
  } catch (err) {
    console.error(err);
    const msg = /password/i.test(err?.message || '') ? 'Dosya şifreli' : 'Dosya okunamadı';
    return { fileName: name, title: name, found: 0, added: 0, ocr: 0, empty: 0, sourceId: null, error: msg };
  }
}

export const isPdf = (file) => file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
