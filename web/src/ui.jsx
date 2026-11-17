import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { speechSupported, startDictation } from './lib/speech.js';
import { notify, sources, allTags } from './state.js';
import { sourceLabel } from './lib/util.js';

const PATHS = {
  feed: 'M4 6h16M4 12h16M4 18h10',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zm0 13a3 3 0 0 1 3-3h11',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  gear: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 2-4-4',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm-7-3a7 7 0 0 0 14 0M12 19v3',
  x: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  tag: 'M3 12V4h8l10 10-8 8L3 12zm5-4h.01',
  check: 'M5 12l5 5L20 7',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v4h16v-4',
  download: 'M12 4v12m0 0-4-4m4 4 4-4M4 20h16',
  link: 'M9 15l6-6M11 6l1-1a4 4 0 0 1 6 6l-1 1M13 18l-1 1a4 4 0 0 1-6-6l1-1',
  back: 'M15 5l-7 7 7 7',
  note: 'M5 4h14v12l-4 4H5V4zm10 16v-4h4M8 9h8M8 13h5',
};

export function Icon({ name, size = 18 }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Dialog({ title, onClose, children, wide }) {
  const ref = useRef(null);
  // Pencere, ekrana çizilmeden önce kipli açılır; böylece Esc ve odak ilk andan itibaren çalışır.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el.open) el.showModal();
    const onCancel = (e) => { e.preventDefault(); onClose(); };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, []);
  return (
    <dialog ref={ref} class={`dialog${wide ? ' wide' : ''}`} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div class="dialog-body">
        <header class="dialog-head">
          <h2>{title}</h2>
          <button class="icon-btn" onClick={onClose} aria-label="Kapat"><Icon name="x" /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

// Dikte düğmesi: konuşulan metni onAppend ile alana ekler.
export function MicButton({ onAppend, label = 'Sesle yaz' }) {
  const [live, setLive] = useState(false);
  const [interim, setInterim] = useState('');
  const stop = useRef(null);
  useEffect(() => () => stop.current?.(), []);
  if (!speechSupported) return null;
  const toggle = () => {
    if (live) { stop.current?.(); return; }
    setLive(true);
    stop.current = startDictation({
      onText: (_final, partial) => setInterim(partial),
      onError: (msg) => notify(msg, 'error'),
      onEnd: (text) => { setLive(false); setInterim(''); stop.current = null; if (text) onAppend(text); },
    });
  };
  return (
    <span class="mic-wrap">
      <button type="button" class={`btn small${live ? ' recording' : ''}`} onClick={toggle} aria-pressed={live}>
        <Icon name="mic" size={15} /> {live ? 'Durdur' : label}
      </button>
      {live && <span class="mic-live" aria-live="polite">{interim || 'Dinliyorum…'}</span>}
    </span>
  );
}

export function TagInput({ tags, onChange }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };
  return (
    <div class="tag-input">
      {tags.map((t) => (
        <span class="chip" key={t}>#{t}
          <button type="button" aria-label={`${t} etiketini kaldır`} onClick={() => onChange(tags.filter((x) => x !== t))}>×</button>
        </span>
      ))}
      <input value={draft} placeholder="etiket ekle" list="all-tags" aria-label="Etiket ekle"
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
        onBlur={add} />
      <datalist id="all-tags">{allTags.value.map(([t]) => <option value={t} key={t} />)}</datalist>
    </div>
  );
}

// Kaynak seçici: mevcut kaynaklardan biri, kaynaksız ya da yeni kaynak.
export function SourcePicker({ value, onChange }) {
  const sorted = [...sources.value].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  const mode = value.mode;
  return (
    <div class="source-picker">
      <label>Kaynak
        <select value={mode === 'existing' ? value.id : mode} onChange={(e) => {
          const v = e.currentTarget.value;
          if (v === 'none' || v === 'new') onChange({ ...value, mode: v });
          else onChange({ ...value, mode: 'existing', id: v });
        }}>
          <option value="none">Kaynaksız</option>
          <option value="new">+ Yeni kaynak</option>
          {sorted.map((s) => <option value={s.id} key={s.id}>{sourceLabel(s)}</option>)}
        </select>
      </label>
      {mode === 'new' && (
        <div class="grid-3">
          <label>Başlık<input value={value.title || ''} onInput={(e) => onChange({ ...value, title: e.currentTarget.value })} /></label>
          <label>Yazar<input value={value.author || ''} onInput={(e) => onChange({ ...value, author: e.currentTarget.value })} /></label>
          <label>Yıl<input value={value.year || ''} inputMode="numeric" onInput={(e) => onChange({ ...value, year: e.currentTarget.value })} /></label>
        </div>
      )}
    </div>
  );
}

export function Empty({ title, children }) {
  return <div class="empty"><h3>{title}</h3><div>{children}</div></div>;
}
