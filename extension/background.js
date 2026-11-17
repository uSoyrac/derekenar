import { rpc, getConn, sourceFromTab, cleanUrl } from './api.js';

const URLS_TTL = 5 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'derkenar-save', title: "Derkenar'a kaydet", contexts: ['selection'] });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function flash(tabId, text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color, tabId });
    await chrome.action.setBadgeText({ text, tabId });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }).catch(() => {}), 2500);
  } catch { /* sekme kapanmış olabilir */ }
}

// Seçimi kaydeder; sonucu yan panele ve sayfadaki içerik betiğine bildirir.
export async function saveSelection({ text, note = '', tags = [], tab, pageUrl, fromPage = false }) {
  const body = (text || '').replace(/\s+\n/g, '\n').trim();
  if (!body && !note.trim()) throw new Error('Önce sayfada bir metin seç');
  if (!(await getConn())) {
    chrome.runtime.openOptionsPage();
    throw new Error('Eklenti henüz bağlanmadı');
  }
  const source = sourceFromTab(tab, pageUrl);
  const result = await rpc('capture', {
    p_payload: { ...source, text: body, note: note.trim(), tags, origin: 'extension', device: 'Chrome eklentisi' },
  });
  if (source.url) await rememberUrl(source.url);
  if (tab?.id) {
    flash(tab.id, result.duplicate ? '=' : '✓', '#2f6b3a');
    // Çizim kipinde sayfa, seçimin kendisini boyar; diğer yollarda metni sayfada bulup vurgulamasını isteriz.
    if (body && !fromPage) chrome.tabs.sendMessage(tab.id, { type: 'derkenar-highlight', texts: [body] }).catch(() => {});
  }
  chrome.runtime.sendMessage({ type: 'derkenar-saved', url: source.url }).catch(() => {});
  return result;
}

async function fail(tab, err) {
  if (tab?.id) flash(tab.id, '!', '#a3262b');
  await chrome.storage.session.set({ lastError: { message: err.message, at: Date.now() } });
  chrome.runtime.sendMessage({ type: 'derkenar-error', message: err.message }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'derkenar-save') return;
  try { await saveSelection({ text: info.selectionText, tab, pageUrl: info.pageUrl }); } catch (err) { await fail(tab, err); }
});

async function selectionOf(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => String(getSelection()) });
    return res?.result || '';
  } catch {
    return null; // Chrome'un PDF görüntüleyicisi gibi betik çalıştırılamayan sayfalar
  }
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'save-selection' || !tab) return;
  try {
    const text = await selectionOf(tab.id);
    if (text === null) throw new Error("Bu sayfada kısayol çalışmıyor; metni seçip sağ tıkla ve “Derkenar'a kaydet”i seç");
    await saveSelection({ text, tab });
  } catch (err) { await fail(tab, err); }
});

// --- alıntısı olan adreslerin önbelleği ---
async function knownUrls(force = false) {
  const { urls } = await chrome.storage.local.get('urls');
  if (!force && urls && Date.now() - urls.at < URLS_TTL) return urls.list;
  if (!(await getConn())) return [];
  try {
    const list = await rpc('source_urls', {});
    await chrome.storage.local.set({ urls: { list, at: Date.now() } });
    return list;
  } catch {
    return urls?.list || [];
  }
}

async function rememberUrl(url) {
  const { urls } = await chrome.storage.local.get('urls');
  const list = urls?.list || [];
  if (!list.includes(url)) await chrome.storage.local.set({ urls: { list: [...list, url], at: urls?.at || Date.now() } });
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  (async () => {
    if (msg.type === 'derkenar-page-quotes') {
      // İçerik betiği: bu sayfada daha önce kaydedilmiş alıntı var mı?
      const url = cleanUrl(msg.url);
      const list = await knownUrls();
      if (!list.includes(url)) return respond({ quotes: [] });
      respond({ quotes: await rpc('quotes_for_url', { p_url: url }) });
    } else if (msg.type === 'derkenar-save') {
      const tab = msg.tabId ? await chrome.tabs.get(msg.tabId) : sender.tab;
      const text = msg.text !== undefined ? msg.text : await selectionOf(tab.id);
      if (text === null) throw new Error("Bu sayfada seçim okunamıyor; metni seçip sağ tıkla ve “Derkenar'a kaydet”i seç");
      respond({ ok: true, result: await saveSelection({ text, note: msg.note, tags: msg.tags, tab, fromPage: Boolean(msg.fromPage) }) });
    } else if (msg.type === 'derkenar-undo') {
      respond(await rpc('token_delete_quote', { p_id: msg.id }));
      chrome.runtime.sendMessage({ type: 'derkenar-saved' }).catch(() => {});
    } else if (msg.type === 'derkenar-open-panel') {
      await chrome.sidePanel.open({ tabId: sender.tab.id });
      respond({ ok: true });
    } else if (msg.type === 'derkenar-refresh-urls') {
      respond({ urls: await knownUrls(true) });
    }
  })().catch((err) => respond({ error: err.message }));
  return true;
});
