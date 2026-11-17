// Alıntı / not formu: elle ekleme, düzenleme ve paylaşım ekranı aynı formu kullanır.
import { useState } from 'preact/hooks';
import { ColorPicker, MicButton, SourcePicker, TagInput } from '../ui.jsx';
import { colorKey, paletteOf } from '../lib/categories.js';
import { addQuotes, ensureSource, updateQuote, notify, sources } from '../state.js';
import { hash } from '../lib/util.js';

const RECENT = 30 * 60 * 1000;

// Son yarım saatte kullanılan kaynak varsa onu öner: aynı kitaptan art arda not almak kolaylaşır.
function defaultSource(initial) {
  if (initial?.source_id) return { mode: 'existing', id: initial.source_id };
  if (initial?.newSource) return { mode: 'new', ...initial.newSource };
  const last = localStorage.getItem('derkenar.lastSource');
  if (last) {
    try {
      const { id, at } = JSON.parse(last);
      if (Date.now() - at < RECENT && sources.value.some((s) => s.id === id)) return { mode: 'existing', id };
    } catch { /* yok say */ }
  }
  return { mode: 'none' };
}

export function QuoteForm({ initial, quote, origin = 'manual', onDone, onCancel, submitLabel }) {
  const [text, setText] = useState(quote?.text ?? initial?.text ?? '');
  const [note, setNote] = useState(quote?.note ?? initial?.note ?? '');
  const [page, setPage] = useState(quote?.page ?? '');
  const [tags, setTags] = useState(quote?.tags ?? []);
  const [color, setColor] = useState(() => colorKey(quote?.color || ''));
  const [source, setSource] = useState(() => (quote ? (quote.source_id ? { mode: 'existing', id: quote.source_id } : { mode: 'none' }) : defaultSource(initial)));
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() && !note.trim()) { notify('Alıntı ya da not yazmalısın', 'error'); return; }
    setSaving(true);
    try {
      let source_id = null;
      if (source.mode === 'existing') source_id = source.id;
      else if (source.mode === 'new' && (source.title || source.url)) {
        const title = (source.title || '').trim();
        const saved = await ensureSource({
          kind: source.kind || (source.url ? 'web' : 'book'), title, author: (source.author || '').trim(),
          year: (source.year || '').trim(), url: source.url || '',
          fingerprint: source.url ? `url:${source.url}` : `title:${title.toLocaleLowerCase('tr')}`,
        });
        source_id = saved.id;
      }
      if (quote) {
        const patch = { text: text.trim(), note: note.trim(), page: page.trim(), tags, source_id };
        // Renk yalnızca kategori değiştiyse yazılır; PDF'ten gelen özgün ton korunur.
        if (color !== colorKey(quote.color || '')) patch.color = paletteOf(color).hex;
        await updateQuote(quote.id, patch);
      } else {
        const body = text.trim();
        await addQuotes([{
          source_id, text: body, note: note.trim(), page: page.trim(), tags, origin, color: paletteOf(color).hex,
          fingerprint: body ? `man:${hash(`${source_id || ''}|${body}`)}` : null,
        }]);
      }
      if (source_id) localStorage.setItem('derkenar.lastSource', JSON.stringify({ id: source_id, at: Date.now() }));
      onDone?.();
    } catch (err) {
      notify(`Kaydedilemedi: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form class="quote-form" onSubmit={submit}>
      <label>Alıntı
        <textarea rows={5} value={text} placeholder="Okuduğun metinden bir bölüm" onInput={(e) => setText(e.currentTarget.value)} />
      </label>
      <div class="field-tools"><MicButton onAppend={(t) => setText((v) => (v ? `${v} ${t}` : t))} label="Alıntıyı sesle yaz" /></div>
      <label>Not
        <textarea rows={3} value={note} placeholder="Kendi yorumun" onInput={(e) => setNote(e.currentTarget.value)} />
      </label>
      <div class="field-tools"><MicButton onAppend={(t) => setNote((v) => (v ? `${v} ${t}` : t))} label="Notu sesle yaz" /></div>
      <div class="label-like">Renk / kategori<ColorPicker value={color} onChange={setColor} /></div>
      <SourcePicker value={source} onChange={setSource} />
      <div class="grid-2">
        <label>Sayfa<input value={page} onInput={(e) => setPage(e.currentTarget.value)} placeholder="örn. 42" /></label>
        <div class="label-like">Etiketler<TagInput tags={tags} onChange={setTags} /></div>
      </div>
      <div class="form-actions">
        {onCancel && <button type="button" class="btn" onClick={onCancel}>Vazgeç</button>}
        <button type="submit" class="btn primary" disabled={saving}>{saving ? 'Kaydediliyor…' : (submitLabel || 'Kaydet')}</button>
      </div>
    </form>
  );
}
