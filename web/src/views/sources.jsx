// Kaynaklar: kitap/makale/sayfa listesi ve tek kaynağın ayrıntısı.
import { useState } from 'preact/hooks';
import { Dialog, Empty, Icon } from '../ui.jsx';
import { QuoteList } from './feed.jsx';
import { sources, quotesBySource, sourceById, updateSource, deleteSource, notify } from '../state.js';
import { dateLabel, fold, sourceLabel } from '../lib/util.js';

const KINDS = { pdf: 'PDF', web: 'Web', book: 'Kitap', article: 'Makale', other: 'Diğer' };

export function SourcesView() {
  const [q, setQ] = useState('');
  const term = fold(q.trim());
  const rows = sources.value
    .map((s) => {
      const list = quotesBySource.value.get(s.id) || [];
      const last = list.reduce((m, x) => (x.created_at > m ? x.created_at : m), s.created_at);
      return { s, count: list.length, last };
    })
    .filter(({ s }) => !term || fold(`${s.title} ${s.author} ${s.file_name} ${s.url}`).includes(term))
    .sort((a, b) => b.last.localeCompare(a.last));
  const orphan = (quotesBySource.value.get('') || []).length;

  return (
    <section>
      <div class="toolbar">
        <label class="search"><Icon name="search" />
          <input type="search" placeholder="Kaynaklarda ara" value={q} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Kaynaklarda ara" />
        </label>
      </div>
      <p class="count">{sources.value.length} kaynak</p>
      {rows.length === 0 && <Empty title="Henüz kaynak yok">Bir PDF içe aktardığında ya da bir sayfadan alıntı kaydettiğinde kaynağı burada görünür.</Empty>}
      <ul class="source-list">
        {rows.map(({ s, count, last }) => (
          <li key={s.id}>
            <a href={`#/kaynak/${s.id}`}>
              <span class="kind">{KINDS[s.kind] || 'Diğer'}</span>
              <span class="title">{s.title || s.file_name || s.url || 'Adsız kaynak'}</span>
              <span class="sub">{[s.author, s.year].filter(Boolean).join(', ') || (s.url ? new URL(s.url, location.href).hostname : s.file_name)}</span>
              <span class="num">{count} alıntı</span>
              <span class="sub date">{dateLabel(last)}</span>
            </a>
          </li>
        ))}
        {orphan > 0 && (
          <li><a href="#/kaynak/yok"><span class="kind">—</span><span class="title">Kaynaksız notlar</span><span class="sub" /><span class="num">{orphan} alıntı</span><span class="sub date" /></a></li>
        )}
      </ul>
    </section>
  );
}

function SourceEdit({ source, onClose }) {
  const [form, setForm] = useState({ title: source.title, author: source.author, year: source.year, container: source.container, url: source.url, kind: source.kind });
  const set = (k) => (e) => setForm({ ...form, [k]: e.currentTarget.value });
  const save = async (e) => {
    e.preventDefault();
    await updateSource(source.id, form);
    notify('Kaynak güncellendi');
    onClose();
  };
  return (
    <Dialog title="Kaynak bilgileri" onClose={onClose}>
      <form class="quote-form" onSubmit={save}>
        <label>Başlık<input value={form.title} onInput={set('title')} /></label>
        <div class="grid-2">
          <label>Yazar<input value={form.author} onInput={set('author')} placeholder="Soyad, A." /></label>
          <label>Yıl<input value={form.year} onInput={set('year')} inputMode="numeric" /></label>
        </div>
        <label>Dergi / yayınevi<input value={form.container} onInput={set('container')} /></label>
        <label>Adres<input value={form.url} onInput={set('url')} placeholder="https://" /></label>
        <label>Tür
          <select value={form.kind} onChange={set('kind')}>{Object.entries(KINDS).map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select>
        </label>
        <div class="form-actions">
          <button type="button" class="btn" onClick={onClose}>Vazgeç</button>
          <button type="submit" class="btn primary">Kaydet</button>
        </div>
      </form>
    </Dialog>
  );
}

export function SourceDetail({ id }) {
  const [editing, setEditing] = useState(false);
  if (id === 'yok') {
    return (
      <section>
        <a class="back" href="#/kaynaklar"><Icon name="back" /> Kaynaklar</a>
        <h2 class="page-title">Kaynaksız notlar</h2>
        <QuoteList base={quotesBySource.value.get('') || []} title="Kaynaksız notlar" showSource={false} />
      </section>
    );
  }
  const source = sourceById.value.get(id);
  if (!source) return <Empty title="Kaynak bulunamadı"><a href="#/kaynaklar">Kaynaklara dön</a></Empty>;
  const list = quotesBySource.value.get(id) || [];
  const remove = async () => {
    if (!confirm(`“${source.title || source.file_name}” ve ${list.length} alıntısı silinsin mi?`)) return;
    await deleteSource(id);
    notify('Kaynak silindi');
    location.hash = '#/kaynaklar';
  };
  return (
    <section>
      <a class="back" href="#/kaynaklar"><Icon name="back" /> Kaynaklar</a>
      <header class="source-head">
        <div>
          <h2 class="page-title">{source.title || source.file_name || 'Adsız kaynak'}</h2>
          <p class="sub">
            {[source.author, source.year, source.container].filter(Boolean).join(' · ') || 'Yazar ve yıl girilmemiş'}
            {source.file_name && <span> · {source.file_name}</span>}
          </p>
          {source.url && <p class="sub"><a href={source.url} target="_blank" rel="noopener noreferrer"><Icon name="link" size={14} /> {source.url}</a></p>}
        </div>
        <div class="row">
          <button class="btn" onClick={() => setEditing(true)}><Icon name="edit" /> Bilgileri düzenle</button>
          <button class="btn danger" onClick={remove}><Icon name="trash" /> Sil</button>
        </div>
      </header>
      <QuoteList base={list} title={sourceLabel(source)} groupBy="page" showSource={false} />
      {editing && <SourceEdit source={source} onClose={() => setEditing(false)} />}
    </section>
  );
}
