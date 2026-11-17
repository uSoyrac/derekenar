// Derkenar içerik betiği:
//  1) Sayfanın kenarında duran Derkenar düğmesi. Basınca "çizim kipi" açılır;
//     kip açıkken seçilen metin kendiliğinden kaydedilir ve sarıya boyanır.
//  2) Sayfada daha önce kaydedilmiş alıntıları yeniden vurgular.
// Sayfanın yapısına dokunmaz: düğme kapalı bir gölge kökünde durur, vurgular CSS Custom Highlight API ile çizilir.
(() => {
  if (window.top !== window || !document.body) return;
  const HAS_HL = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
  const NAME = 'derkenar';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'IFRAME']);
  const marks = []; // {range, id}
  let styled = false;
  let active = false;
  let pageCount = 0;
  let lastText = '';
  let ui = null;

  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? { error: 'Eklenti yanıt vermedi; sayfayı yenile' } : res));
    } catch {
      resolve({ error: 'Eklenti güncellendi; sayfayı yenile' });
    }
  });

  // --- vurgular ---------------------------------------------------------------

  function paint() {
    if (!HAS_HL) return;
    if (!styled) {
      styled = true;
      const style = document.createElement('style');
      style.textContent = `::highlight(${NAME}) { background-color: rgb(246 201 69 / 0.5); color: inherit; }`;
      document.documentElement.append(style);
    }
    if (marks.length) CSS.highlights.set(NAME, new Highlight(...marks.map((m) => m.range)));
    else CSS.highlights.delete(NAME);
  }

  // Sayfadaki görünür metni boşluksuz tek dizi olarak çıkarır; her harfin geldiği düğümü hatırlar.
  function index() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && !SKIP.has(n.parentElement.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    let hay = '';
    const nodes = [];
    const offsets = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue;
      for (let i = 0; i < value.length; i++) {
        if (/\s/.test(value[i])) continue;
        hay += value[i];
        nodes.push(node);
        offsets.push(i);
      }
    }
    return { hay, nodes, offsets };
  }

  function highlightTexts(items) {
    const idx = index();
    let found = 0;
    for (const item of items) {
      const needle = String(item.text || '').replace(/\s+/g, '');
      if (needle.length < 3) continue;
      const at = idx.hay.indexOf(needle);
      if (at < 0) continue;
      const end = at + needle.length - 1;
      const range = new Range();
      range.setStart(idx.nodes[at], idx.offsets[at]);
      range.setEnd(idx.nodes[end], idx.offsets[end] + 1);
      marks.push({ range, id: item.id || null });
      found++;
    }
    paint();
    return found;
  }

  // --- kenar düğmesi ------------------------------------------------------------

  const CSS_TEXT = `
    :host { all: initial; }
    .wrap { position: fixed; right: 16px; bottom: 96px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
      font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .bubble { width: 46px; height: 46px; border-radius: 50%; border: 2px solid #c9c2b2; background: #211f1b; cursor: pointer; padding: 0;
      display: grid; place-items: center; box-shadow: 0 2px 10px rgb(0 0 0 / 28%); position: relative; transition: transform .12s; }
    .bubble:hover { transform: scale(1.06); }
    .bubble:focus-visible { outline: 3px solid #f6c945; outline-offset: 2px; }
    .bubble svg { width: 24px; height: 24px; }
    .bubble .bar { fill: #8a8478; }
    .bubble.on { background: #f6c945; border-color: #f6c945; }
    .bubble.on .bar { fill: #211f1b; }
    .count { position: absolute; top: -6px; left: -6px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: #2f6b3a; color: #fff;
      font-size: 11px; font-weight: 600; line-height: 18px; text-align: center; }
    .count:empty { display: none; }
    .tools { display: none; gap: 6px; }
    .wrap:hover .tools, .wrap:focus-within .tools { display: flex; }
    .mini { border: 0; border-radius: 14px; padding: 4px 10px; background: #211f1b; color: #ece7dc; cursor: pointer; font: inherit; box-shadow: 0 2px 8px rgb(0 0 0 / 25%); }
    .mini:hover { background: #38352f; }
    .toast { max-width: 260px; padding: 8px 12px; border-radius: 10px; background: #211f1b; color: #ece7dc; box-shadow: 0 2px 10px rgb(0 0 0 / 30%);
      display: flex; gap: 10px; align-items: center; }
    .toast[hidden] { display: none; }
    .toast.error { background: #a3262b; color: #fff; }
    .toast button { border: 0; background: none; color: #f6c945; cursor: pointer; font: inherit; font-weight: 600; padding: 0; text-decoration: underline; }
  `;

  function buildUi() {
    const host = document.createElement('div');
    host.id = 'derkenar-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS_TEXT}</style>
      <div class="wrap">
        <div class="toast" role="status" hidden><span class="msg"></span><button class="undo" hidden>Geri al</button></div>
        <div class="tools">
          <button class="mini" data-act="panel">Bu sayfadan kaydettiklerim</button>
          <button class="mini" data-act="hide" title="Bu sayfada gizle">Gizle</button>
        </div>
        <button class="bubble" aria-pressed="false">
          <span class="count"></span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect class="bar" x="4" y="5" width="16" height="3" rx="1.5"/><rect class="bar" x="4" y="10.500" width="16" height="3" rx="1.5"/><rect class="bar" x="4" y="16" width="10" height="3" rx="1.5"/></svg>
        </button>
      </div>`;
    const $ = (sel) => root.querySelector(sel);
    const bubble = $('.bubble');
    let toastTimer;
    const api = {
      host,
      render() {
        bubble.classList.toggle('on', active);
        bubble.setAttribute('aria-pressed', String(active));
        const label = active
          ? 'Derkenar çizim kipi açık: seçtiğin metin kaydedilir. Kapatmak için bas.'
          : 'Derkenar çizim kipini aç: seçtiğin metin kendiliğinden kaydedilsin.';
        bubble.title = label;
        bubble.setAttribute('aria-label', label);
        $('.count').textContent = pageCount ? String(pageCount) : '';
      },
      toast(message, kind = '', onUndo = null) {
        clearTimeout(toastTimer);
        const el = $('.toast');
        el.className = `toast ${kind}`;
        $('.msg').textContent = message;
        const undo = $('.undo');
        undo.hidden = !onUndo;
        undo.onclick = onUndo ? () => { el.hidden = true; onUndo(); } : null;
        el.hidden = false;
        toastTimer = setTimeout(() => { el.hidden = true; }, onUndo ? 6000 : 3000);
      },
    };
    bubble.addEventListener('click', () => chrome.storage.local.set({ active: !active }));
    $('[data-act="panel"]').addEventListener('click', () => send({ type: 'derkenar-open-panel' }));
    $('[data-act="hide"]').addEventListener('click', () => { host.remove(); ui = null; });
    document.documentElement.append(host);
    return api;
  }

  // --- çizim kipi: seçim biter bitmez kaydet ---------------------------------------

  let timer;
  function onSelectEnd(event) {
    if (!active || !ui) return;
    if (event.target === ui.host) return;
    clearTimeout(timer);
    timer = setTimeout(capture, 350);
  }

  async function capture() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { lastText = ''; return; }
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    // Tek sözcüklük seçimler (çift tıklama) yanlışlıkla kaydedilmesin; onlar için sağ tık menüsü var.
    if (text.split(' ').length < 2 || text === lastText) return;
    const parent = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
    if (parent?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
    if (text.length > 8000) { ui.toast('Seçim çok uzun; daha kısa bir bölüm seç', 'error'); return; }
    lastText = text;
    const range = sel.getRangeAt(0).cloneRange();
    const res = await send({ type: 'derkenar-save', text, fromPage: true });
    if (!ui) return;
    if (!res || res.error) { lastText = ''; ui.toast(res?.error || 'Kaydedilemedi', 'error'); return; }
    const id = res.result.quote_id;
    if (res.result.duplicate) { ui.toast('Bu alıntı zaten kayıtlıydı'); sel.removeAllRanges(); return; }
    marks.push({ range, id });
    paint();
    sel.removeAllRanges();
    pageCount++;
    ui.render();
    ui.toast('Kaydedildi', '', async () => {
      const undone = await send({ type: 'derkenar-undo', id });
      if (undone?.error) { ui?.toast(undone.error, 'error'); return; }
      const at = marks.findIndex((m) => m.id === id);
      if (at >= 0) marks.splice(at, 1);
      paint();
      pageCount = Math.max(0, pageCount - 1);
      lastText = '';
      ui?.render();
    });
  }

  document.addEventListener('mouseup', onSelectEnd, true);
  document.addEventListener('touchend', onSelectEnd, true);
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift' || e.shiftKey) onSelectEnd(e); }, true);

  // --- başlangıç ------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.type === 'derkenar-highlight') {
      const found = highlightTexts(msg.texts.map((text) => ({ text })));
      pageCount += found;
      ui?.render();
      respond({ found });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.active) { active = Boolean(changes.active.newValue); lastText = ''; ui?.render(); }
    const hide = (changes.bubble && changes.bubble.newValue === false)
      || (changes.conn?.newValue?.a && location.href.startsWith(changes.conn.newValue.a));
    if (hide && ui) { ui.host.remove(); ui = null; }
  });

  chrome.storage.local.get(['active', 'bubble', 'conn'], (state) => {
    active = Boolean(state.active);
    // Düğme, Derkenar uygulamasının kendi sayfasında ve kapatıldıysa gösterilmez.
    const ownApp = state.conn?.a && location.href.startsWith(state.conn.a);
    if (state.bubble !== false && !ownApp) { ui = buildUi(); ui.render(); }
    send({ type: 'derkenar-page-quotes', url: location.href }).then((res) => {
      if (!res?.quotes?.length) return;
      pageCount = res.quotes.length;
      highlightTexts(res.quotes);
      ui?.render();
    });
  });
})();
