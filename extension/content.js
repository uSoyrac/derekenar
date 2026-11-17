// Sayfada daha önce kaydedilmiş alıntıları vurgular. Sayfanın yapısına dokunmaz
// (CSS Custom Highlight API); desteklenmeyen tarayıcılarda sessizce hiçbir şey yapmaz.
(() => {
  if (!('highlights' in CSS) || typeof Highlight === 'undefined') return;
  const NAME = 'derkenar';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'IFRAME']);
  const ranges = [];
  let styled = false;

  function ensureStyle() {
    if (styled) return;
    styled = true;
    const style = document.createElement('style');
    style.textContent = `::highlight(${NAME}) { background-color: rgb(246 201 69 / 0.5); color: inherit; }`;
    document.documentElement.append(style);
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

  function highlight(texts) {
    if (!document.body) return 0;
    const idx = index();
    let found = 0;
    for (const text of texts) {
      const needle = String(text || '').replace(/\s+/g, '');
      if (needle.length < 3) continue;
      const at = idx.hay.indexOf(needle);
      if (at < 0) continue;
      const end = at + needle.length - 1;
      const range = new Range();
      range.setStart(idx.nodes[at], idx.offsets[at]);
      range.setEnd(idx.nodes[end], idx.offsets[end] + 1);
      ranges.push(range);
      found++;
    }
    if (found) {
      ensureStyle();
      CSS.highlights.set(NAME, new Highlight(...ranges));
    }
    return found;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.type === 'derkenar-highlight') respond({ found: highlight(msg.texts) });
  });

  chrome.runtime.sendMessage({ type: 'derkenar-page-quotes', url: location.href }, (res) => {
    if (chrome.runtime.lastError || !res?.quotes?.length) return;
    highlight(res.quotes.map((q) => q.text));
  });
})();
