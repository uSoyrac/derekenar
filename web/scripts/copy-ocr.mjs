// OCR (tesseract.js) dosyalarını public/ocr altına kopyalar; uygulama bunları kendi adresinden yükler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'public', 'ocr');
fs.mkdirSync(path.join(out, 'core'), { recursive: true });
fs.mkdirSync(path.join(out, 'lang'), { recursive: true });

fs.copyFileSync(path.join(nm, 'tesseract.js', 'dist', 'worker.min.js'), path.join(out, 'worker.min.js'));
for (const f of fs.readdirSync(path.join(nm, 'tesseract.js-core'))) {
  if (/-lstm\.wasm\.js$/.test(f)) fs.copyFileSync(path.join(nm, 'tesseract.js-core', f), path.join(out, 'core', f));
}
for (const lang of ['tur', 'eng']) {
  fs.copyFileSync(
    path.join(nm, '@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`),
    path.join(out, 'lang', `${lang}.traineddata.gz`),
  );
}
console.log('OCR dosyaları kopyalandı');
