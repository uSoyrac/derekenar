// Paylaşım ekranı: Android'de bir uygulamadan "Paylaş" ile gelen metni kaydeder.
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { QuoteForm } from './quote-form.jsx';
import { sources } from '../state.js';
import { cleanUrl, splitSharedText } from '../lib/util.js';

export const shareData = signal(readShare());

function readShare() {
  const p = new URLSearchParams(location.search);
  if (!p.has('text') && !p.has('url') && !p.has('title')) return null;
  const parsed = splitSharedText(p.get('text') || '');
  const url = cleanUrl(p.get('url') || parsed.url);
  const title = (p.get('title') || '').trim();
  history.replaceState(null, '', location.pathname + location.hash);
  if (!parsed.text && !url && !title) return null;
  // Yalnızca adres paylaşıldıysa (seçim yoksa) başlığı not olarak önerme; kaynak olarak ekle.
  return { text: parsed.text, url, title };
}

export function ShareView() {
  const data = shareData.value;
  const [done, setDone] = useState(false);
  const close = () => { shareData.value = null; };
  if (done) {
    return (
      <main class="auth"><div class="auth-card">
        <h1 class="brand">Kaydedildi</h1>
        <p class="lead">Alıntın kütüphanene eklendi.</p>
        <button class="btn primary block" onClick={close}>Kütüphaneyi aç</button>
        <button class="btn block" onClick={() => window.close()}>Kapat ve okumaya dön</button>
      </div></main>
    );
  }
  const existing = data.url && sources.value.find((s) => s.url === data.url);
  const initial = {
    text: data.text,
    ...(existing ? { source_id: existing.id } : data.url ? { newSource: { title: data.title || data.url, url: data.url, kind: 'web' } } : {}),
  };
  return (
    <main class="auth"><div class="auth-card wide">
      <h1 class="brand">Derkenar'a kaydet</h1>
      <QuoteForm initial={initial} origin="share" submitLabel="Kütüphaneye kaydet" onDone={() => setDone(true)} onCancel={close} />
    </div></main>
  );
}
