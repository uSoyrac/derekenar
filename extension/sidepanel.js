import { rpc, getConn, cleanUrl } from './api.js';

const $ = (id) => document.getElementById(id);
let current = null; // {tabId, url}

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

// Otomatik testlerde panel normal bir sekmede açılır; hedef sekme ?tabId= ile verilir.
const forcedTab = Number(new URLSearchParams(location.search).get('tabId')) || null;

async function activeTab() {
  if (forcedTab) return chrome.tabs.get(forcedTab).catch(() => null);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function renderQuote(q) {
  const li = el('li', { className: 'quote' });
  if (q.color) li.style.setProperty('--mark', q.color);
  if (q.text) li.append(el('blockquote', { textContent: q.text }));
  const note = el('div', { className: 'note', textContent: q.note, hidden: !q.note });
  const edit = el('button', { className: 'mini', textContent: q.note ? 'Notu düzenle' : 'Not ekle' });
  const del = el('button', { className: 'mini danger', textContent: 'Sil' });
  edit.onclick = () => {
    const area = el('textarea', { rows: 3, value: q.note });
    const ok = el('button', { className: 'mini', textContent: 'Kaydet' });
    ok.onclick = async () => {
      try {
        await rpc('token_update_quote', { p_id: q.id, p_patch: { note: area.value.trim() } });
        await refresh();
chrome.runtime.sendMessage({ type: 'derkenar-refresh-cats' }).catch(() => {});
      } catch (err) { setStatus(err.message, 'error'); }
    };
    note.replaceWith(area);
    edit.replaceWith(ok);
    area.focus();
  };
  del.onclick = async () => {
    if (!confirm('Bu alıntı silinsin mi?')) return;
    try { await rpc('token_delete_quote', { p_id: q.id }); await refresh(); } catch (err) { setStatus(err.message, 'error'); }
  };
  li.append(note, el('div', { className: 'row' }, edit, del));
  return li;
}

async function refresh() {
  const conn = await getConn();
  $('setup').hidden = Boolean(conn);
  $('main').hidden = !conn;
  if (!conn) return;
  if (conn.a) { $('open-app').hidden = false; $('open-app').href = conn.a; }

  const tab = await activeTab();
  const url = tab?.url && /^https?:/.test(tab.url) ? cleanUrl(tab.url) : '';
  current = tab ? { tabId: tab.id, url } : null;
  $('page-title').textContent = tab?.title || 'Sekme bulunamadı';
  try { $('page-host').textContent = url ? new URL(url).hostname : 'Bu sayfanın adresi kaydedilemez; alıntı kaynaksız eklenir'; } catch { $('page-host').textContent = ''; }

  let quotes = [];
  if (url) {
    try { quotes = await rpc('quotes_for_url', { p_url: url }); } catch (err) { setStatus(err.message, 'error'); }
  }
  $('list').replaceChildren(...quotes.slice().reverse().map(renderQuote));
  $('count').textContent = quotes.length ? `(${quotes.length})` : '';
  $('empty').hidden = quotes.length > 0;
}

$('save').onclick = async () => {
  if (!current) return;
  $('save').disabled = true;
  setStatus('Kaydediliyor…');
  const tags = $('tags').value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  const res = await chrome.runtime.sendMessage({ type: 'derkenar-save', tabId: current.tabId, note: $('note').value, tags });
  $('save').disabled = false;
  if (res?.error) return setStatus(res.error, 'error');
  setStatus(res.result.duplicate ? 'Bu alıntı zaten kayıtlıydı' : 'Kaydedildi', 'ok');
  $('note').value = '';
  await refresh();
chrome.runtime.sendMessage({ type: 'derkenar-refresh-cats' }).catch(() => {});
};

$('open-options').onclick = $('setup-link').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
$('open-app').onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: $('open-app').href }); };

chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'complete' || change.url) refresh(); });
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'derkenar-saved') { setStatus('Kaydedildi', 'ok'); refresh(); }
  if (msg.type === 'derkenar-error') setStatus(msg.message, 'error');
});
chrome.storage.onChanged.addListener((changes) => { if (changes.conn) refresh(); });

refresh();
chrome.runtime.sendMessage({ type: 'derkenar-refresh-cats' }).catch(() => {});
