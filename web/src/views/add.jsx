// Ekleme: PDF'ten çizimleri içe alma ve elle / sesle not yazma.
import { signal } from '@preact/signals';
import { useRef, useState } from 'preact/hooks';
import { Dialog, Icon } from '../ui.jsx';
import { QuoteForm } from './quote-form.jsx';
import { importPdfFile, isPdf } from '../lib/importer.js';
import { notify } from '../state.js';

export const addOpen = signal(null); // null | 'pdf' | 'note'
export const importJob = signal({ active: false, current: '', progress: 0, results: [] });

export async function runImport(fileList) {
  const files = [...fileList].filter(isPdf);
  if (!files.length) { notify('PDF dosyası bulunamadı', 'error'); return; }
  if (importJob.value.active) { notify('Süren bir içe aktarma var', 'error'); return; }
  addOpen.value = 'pdf';
  importJob.value = { active: true, current: files[0].name, progress: 0, results: [] };
  const results = [];
  for (const file of files) {
    importJob.value = { active: true, current: file.name, progress: 0, results: [...results] };
    const res = await importPdfFile(file, {
      onProgress: (done, total) => { importJob.value = { ...importJob.value, progress: total ? done / total : 0 }; },
    });
    results.push(res);
  }
  importJob.value = { active: false, current: '', progress: 1, results };
}

function ResultRow({ r }) {
  let text;
  if (r.error) text = r.error;
  else if (!r.found) text = r.empty ? `Çizim var ama metni okunamadı (${r.empty})` : 'Çizim ya da not bulunamadı';
  else {
    text = r.added ? `${r.added} yeni alıntı eklendi` : 'Yeni çizim yok';
    if (r.found > r.added) text += `, ${r.found - r.added} tanesi zaten kayıtlıydı`;
    if (r.ocr) text += ` · ${r.ocr} tanesi OCR ile okundu`;
    if (r.empty) text += ` · ${r.empty} çizim okunamadı`;
  }
  return (
    <li class={r.error ? 'err' : ''}>
      <span class="title">{r.title || r.fileName}</span>
      <span class="sub">{text}</span>
      {r.sourceId && <a href={`#/kaynak/${r.sourceId}`} onClick={() => { addOpen.value = null; }}>Aç</a>}
    </li>
  );
}

function PdfTab() {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const job = importJob.value;
  return (
    <div>
      <div class={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); runImport(e.dataTransfer.files); }}>
        <Icon name="upload" size={28} />
        <p><strong>Altını çizdiğin PDF'leri buraya sürükle</strong></p>
        <p class="dim">Çizimler ve notlar sayfa numarasıyla alınır. Dosya hiçbir yere yüklenmez; bu cihazda okunur.</p>
        <button class="btn primary" disabled={job.active} onClick={() => input.current.click()}>Dosya seç</button>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden
          onChange={(e) => { runImport(e.currentTarget.files); e.currentTarget.value = ''; }} />
      </div>
      {job.active && (
        <div class="progress" role="status">
          <span>{job.current} okunuyor…</span>
          <progress value={job.progress} max="1" />
        </div>
      )}
      {job.results.length > 0 && <ul class="results">{job.results.map((r, i) => <ResultRow r={r} key={i} />)}</ul>}
    </div>
  );
}

export function AddDialog() {
  const tab = addOpen.value;
  if (!tab) return null;
  const close = () => { addOpen.value = null; };
  return (
    <Dialog title="Ekle" onClose={close} wide>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'pdf'} class={tab === 'pdf' ? 'on' : ''} onClick={() => { addOpen.value = 'pdf'; }}>PDF'ten çizimleri al</button>
        <button role="tab" aria-selected={tab === 'note'} class={tab === 'note' ? 'on' : ''} onClick={() => { addOpen.value = 'note'; }}>Alıntı / not yaz</button>
      </div>
      {tab === 'pdf' ? <PdfTab /> : <QuoteForm onDone={() => { close(); notify('Kaydedildi'); }} onCancel={close} />}
    </Dialog>
  );
}
