import { decodeCode, getConn, rpc } from './api.js';

const $ = (id) => document.getElementById(id);
const setStatus = (text, kind = '') => { $('status').textContent = text; $('status').className = `status ${kind}`; };

async function show() {
  const conn = await getConn();
  $('disconnect').hidden = !conn;
  if (!conn) return;
  try {
    const s = await rpc('token_status', {}, conn);
    setStatus(`Bağlı. Kütüphanende ${s.quotes} alıntı, ${s.sources} kaynak var.`, 'ok');
  } catch (err) {
    setStatus(`Bağlantı çalışmıyor: ${err.message}`, 'error');
  }
}

$('connect').onclick = async () => {
  try {
    const conn = decodeCode($('code').value);
    await rpc('token_status', {}, conn); // kod geçerli mi?
    await chrome.storage.local.set({ conn });
    await chrome.storage.local.remove('urls');
    $('code').value = '';
    await show();
  } catch (err) {
    setStatus(err.message, 'error');
  }
};

$('disconnect').onclick = async () => {
  await chrome.storage.local.remove(['conn', 'urls']);
  setStatus('Bağlantı kaldırıldı.');
  $('disconnect').hidden = true;
};

show();

chrome.storage.local.get('bubble', ({ bubble }) => { $('bubble').checked = bubble !== false; });
$('bubble').onchange = () => chrome.storage.local.set({ bubble: $('bubble').checked });
