// Akış: alıntıların listesi, arama ve süzgeçler, seçip dışa aktarma.
import { signal } from '@preact/signals';
import { useMemo, useState } from 'preact/hooks';
import { Dialog, Empty, Icon, MicButton, TagInput } from '../ui.jsx';
import { QuoteForm } from './quote-form.jsx';
import {
  quotes, sourceById, projectById, projects, allTags, updateQuote, deleteQuote, toggleProject, notify,
} from '../state.js';
import { citation, copyText, dayKey, dayLabel, download, fold, sourceLabel, timeLabel } from '../lib/util.js';
import { toDocx, toMarkdown } from '../lib/export.js';

const query = signal('');
const tagFilter = signal('');
const period = signal('all');
const selecting = signal(false);
const selected = signal(new Set());

const PERIODS = [['all', 'Tüm zamanlar'], ['7', 'Son 7 gün'], ['30', 'Son 30 gün'], ['90', 'Son 3 ay']];
const ORIGINS = { 'pdf-ocr': 'OCR', extension: 'eklenti', share: 'paylaşım', shortcut: 'kısayol', capture: 'yakalama' };

function QuoteCard({ quote, showSource = true }) {
  const source = sourceById.value.get(quote.source_id);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(quote.note);
  const [editing, setEditing] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [menu, setMenu] = useState(false);
  const isSelected = selected.value.has(quote.id);

  const saveNote = async () => {
    await updateQuote(quote.id, { note: noteDraft.trim() });
    setEditingNote(false);
  };
  const toggleSelect = () => {
    const next = new Set(selected.value);
    if (next.has(quote.id)) next.delete(quote.id); else next.add(quote.id);
    selected.value = next;
  };
  const copy = async () => {
    const body = [quote.text ? `“${quote.text}” ${citation(source, quote.page)}`.trim() : '', quote.note].filter(Boolean).join('\n\n');
    notify((await copyText(body)) ? 'Kopyalandı' : 'Kopyalanamadı', 'info');
  };
  const remove = async () => {
    if (!confirm('Bu alıntı silinsin mi?')) return;
    await deleteQuote(quote.id);
    notify('Alıntı silindi');
  };

  return (
    <article class={`quote${isSelected ? ' selected' : ''}`} style={quote.color ? `--mark:${quote.color}` : ''} data-quote-id={quote.id}>
      {selecting.value && (
        <label class="select-box"><input type="checkbox" checked={isSelected} onChange={toggleSelect} aria-label="Alıntıyı seç" /></label>
      )}
      <div class="quote-main">
        {quote.text && <blockquote>{quote.text}</blockquote>}
        {editingNote ? (
          <div class="note-edit">
            <textarea rows={3} value={noteDraft} autoFocus onInput={(e) => setNoteDraft(e.currentTarget.value)} placeholder="Kendi yorumun" />
            <div class="row">
              <MicButton onAppend={(t) => setNoteDraft((v) => (v ? `${v} ${t}` : t))} />
              <span class="spacer" />
              <button class="btn small" onClick={() => { setNoteDraft(quote.note); setEditingNote(false); }}>Vazgeç</button>
              <button class="btn small primary" onClick={saveNote}>Notu kaydet</button>
            </div>
          </div>
        ) : quote.note ? (
          <p class="note" onClick={() => { setNoteDraft(quote.note); setEditingNote(true); }} title="Notu düzenle">{quote.note}</p>
        ) : null}

        {(quote.tags?.length > 0 || tagging) && (
          tagging
            ? <div class="row"><TagInput tags={quote.tags || []} onChange={(tags) => updateQuote(quote.id, { tags })} /><button class="btn small" onClick={() => setTagging(false)}>Tamam</button></div>
            : <div class="chips">{quote.tags.map((t) => <button class="chip link" key={t} onClick={() => { tagFilter.value = t; }}>#{t}</button>)}</div>
        )}
        {(quote.project_ids || []).some((id) => projectById.value.has(id)) && (
          <div class="chips">{quote.project_ids.filter((id) => projectById.value.has(id)).map((id) => (
            <a class="chip project" key={id} href={`#/proje/${id}`}><Icon name="folder" size={12} /> {projectById.value.get(id).name}</a>
          ))}</div>
        )}

        <footer class="quote-meta">
          <span class="where">
            {showSource && (source
              ? <a href={`#/kaynak/${source.id}`}>{sourceLabel(source)}</a>
              : <span>Kaynaksız</span>)}
            {quote.page && <span>{showSource ? ' · ' : ''}s. {quote.page}</span>}
            <span class="dim"> · {timeLabel(quote.created_at)}{quote.device ? ` · ${quote.device}` : ''}</span>
            {ORIGINS[quote.origin] && <span class="badge">{ORIGINS[quote.origin]}</span>}
          </span>
          <span class="actions">
            {!quote.note && !editingNote && <button class="icon-btn" title="Not ekle" aria-label="Not ekle" onClick={() => setEditingNote(true)}><Icon name="note" size={16} /></button>}
            <button class="icon-btn" title="Etiketle" aria-label="Etiketle" onClick={() => setTagging(!tagging)}><Icon name="tag" size={16} /></button>
            <span class="menu-wrap">
              <button class="icon-btn" title="Projeye ekle" aria-label="Projeye ekle" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="folder" size={16} /></button>
              {menu && (
                <div class="menu" onMouseLeave={() => setMenu(false)}>
                  {projects.value.length === 0 && <p class="dim">Henüz proje yok. Projeler sayfasından oluştur.</p>}
                  {projects.value.map((p) => (
                    <label key={p.id}><input type="checkbox" checked={(quote.project_ids || []).includes(p.id)} onChange={() => toggleProject(quote, p.id)} /> {p.name}</label>
                  ))}
                </div>
              )}
            </span>
            <button class="icon-btn" title="Kopyala" aria-label="Kopyala" onClick={copy}><Icon name="copy" size={16} /></button>
            <button class="icon-btn" title="Düzenle" aria-label="Düzenle" onClick={() => setEditing(true)}><Icon name="edit" size={16} /></button>
            <button class="icon-btn danger" title="Sil" aria-label="Sil" onClick={remove}><Icon name="trash" size={16} /></button>
          </span>
        </footer>
      </div>
      {editing && (
        <Dialog title="Alıntıyı düzenle" onClose={() => setEditing(false)}>
          <QuoteForm quote={quote} onDone={() => { setEditing(false); notify('Güncellendi'); }} onCancel={() => setEditing(false)} />
        </Dialog>
      )}
    </article>
  );
}

function ExportDialog({ title, list, onClose }) {
  const [working, setWorking] = useState(false);
  const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'alintilar';
  const md = () => toMarkdown(title, list, sourceById.value);
  const word = async () => {
    setWorking(true);
    try { download(`${safe}.docx`, await toDocx(title, list, sourceById.value)); } catch (err) { notify(`Word dosyası oluşturulamadı: ${err.message}`, 'error'); }
    setWorking(false);
  };
  return (
    <Dialog title="Dışa aktar" onClose={onClose}>
      <p>{list.length} alıntı, kaynaklarına göre gruplanıp sayfa sırasıyla ve kaynakçasıyla aktarılır.</p>
      <div class="stack">
        <button class="btn primary" disabled={working} onClick={word}><Icon name="download" /> {working ? 'Hazırlanıyor…' : 'Word belgesi indir (.docx)'}</button>
        <button class="btn" onClick={() => download(`${safe}.md`, md(), 'text/markdown')}><Icon name="download" /> Markdown indir (.md)</button>
        <button class="btn" onClick={async () => notify((await copyText(md())) ? 'Panoya kopyalandı' : 'Kopyalanamadı')}><Icon name="copy" /> Metin olarak kopyala</button>
      </div>
    </Dialog>
  );
}

/**
 * @param {{ base?: object[], title?: string, groupBy?: 'day'|'page', showSource?: boolean, emptyText?: any }} props
 */
export function QuoteList({ base, title = 'Alıntılarım', groupBy = 'day', showSource = true, emptyText }) {
  const all = base || quotes.value;
  const [exporting, setExporting] = useState(false);
  const [limit, setLimit] = useState(150);
  const q = fold(query.value.trim());
  const tag = tagFilter.value;
  const days = period.value;

  const filtered = useMemo(() => {
    const since = days === 'all' ? 0 : Date.now() - Number(days) * 86400000;
    const terms = q.split(/\s+/).filter(Boolean);
    return all.filter((item) => {
      if (since && new Date(item.created_at).getTime() < since) return false;
      if (tag && !(item.tags || []).includes(tag)) return false;
      if (terms.length) {
        const src = sourceById.value.get(item.source_id);
        const hay = fold(`${item.text} ${item.note} ${(item.tags || []).join(' ')} ${src ? `${src.title} ${src.author} ${src.file_name}` : ''}`);
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [all, q, tag, days, sourceById.value]);

  const groups = useMemo(() => {
    if (groupBy === 'page') {
      const num = (p) => { const n = parseInt(p, 10); return Number.isNaN(n) ? Infinity : n; };
      return [{ key: 'all', label: '', items: [...filtered].sort((a, b) => num(a.page) - num(b.page) || a.created_at.localeCompare(b.created_at)) }];
    }
    const sorted = [...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const out = [];
    for (const item of sorted) {
      const key = dayKey(item.created_at);
      if (!out.length || out[out.length - 1].key !== key) out.push({ key, label: dayLabel(item.created_at), items: [] });
      out[out.length - 1].items.push(item);
    }
    return out;
  }, [filtered, groupBy]);

  // Çok büyük listelerde yalnızca ilk bölüm çizilir.
  const visible = [];
  let room = limit;
  for (const g of groups) {
    if (room <= 0) break;
    visible.push({ ...g, total: g.items.length, items: g.items.slice(0, room) });
    room -= g.items.length;
  }

  const chosen = filtered.filter((item) => selected.value.has(item.id));
  const exportList = selecting.value && chosen.length ? chosen : filtered;
  const filtering = q || tag || days !== 'all';

  return (
    <section class="feed">
      <div class="toolbar">
        <label class="search"><Icon name="search" />
          <input type="search" placeholder="Alıntılarda, notlarda, kaynaklarda ara" value={query.value}
            onInput={(e) => { query.value = e.currentTarget.value; }} aria-label="Ara" />
        </label>
        <select value={period.value} onChange={(e) => { period.value = e.currentTarget.value; }} aria-label="Dönem">
          {PERIODS.map(([v, l]) => <option value={v} key={v}>{l}</option>)}
        </select>
        <select value={tagFilter.value} onChange={(e) => { tagFilter.value = e.currentTarget.value; }} aria-label="Etiket">
          <option value="">Tüm etiketler</option>
          {allTags.value.map(([t, n]) => <option value={t} key={t}>#{t} ({n})</option>)}
        </select>
        <button class={`btn${selecting.value ? ' active' : ''}`} onClick={() => { selecting.value = !selecting.value; selected.value = new Set(); }}>
          <Icon name="check" /> {selecting.value ? 'Seçimi bitir' : 'Seç'}
        </button>
        <button class="btn" disabled={!filtered.length} onClick={() => setExporting(true)}>
          <Icon name="download" /> Dışa aktar{selecting.value && chosen.length ? ` (${chosen.length})` : ''}
        </button>
      </div>
      <p class="count" aria-live="polite">
        {filtering ? `${filtered.length} / ${all.length} alıntı` : `${all.length} alıntı`}
        {filtering && <button class="link-btn" onClick={() => { query.value = ''; tagFilter.value = ''; period.value = 'all'; }}>Süzgeçleri temizle</button>}
      </p>

      {filtered.length === 0 && (
        <Empty title={all.length ? 'Bu süzgeçlere uyan alıntı yok' : 'Henüz alıntı yok'}>
          {all.length ? 'Aramayı ya da dönemi değiştirmeyi dene.' : (emptyText || 'Altını çizdiğin bir PDF\'i bu pencereye sürükle ya da sağ üstteki “Ekle” ile ilk notunu yaz.')}
        </Empty>
      )}

      {visible.map((g) => (
        <div class="group" key={g.key}>
          {g.label && <h3 class="day">{g.label}<span>{g.total}</span></h3>}
          {g.items.map((item) => <QuoteCard quote={item} key={item.id} showSource={showSource} />)}
        </div>
      ))}
      {filtered.length > limit && (
        <button class="btn more" onClick={() => setLimit(limit + 300)}>Daha fazla göster ({filtered.length - limit} alıntı daha)</button>
      )}

      {exporting && <ExportDialog title={title} list={exportList} onClose={() => setExporting(false)} />}
    </section>
  );
}
