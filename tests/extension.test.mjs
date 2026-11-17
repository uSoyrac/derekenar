// Chrome eklentisinin testi: gerçek Chromium'a yüklenir, yerel sunucu taklidine bağlanır.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from './pw.mjs';
import { fileURLToPath } from 'node:url';
import { startStatic } from './serve.mjs';
import { startShim } from './cloud-shim.mjs';

const ext = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const shots = process.env.SHOTS || path.join(os.tmpdir(), 'derkenar-shots');
fs.mkdirSync(shots, { recursive: true });

const ARTICLE = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Okuma Üzerine Bir Yazı</title></head>
<body style="font:18px/1.6 Georgia;max-width:640px;margin:40px auto">
<h1>Okuma Üzerine</h1>
<p id="p1">Okumak, bir metnin içinden geçerken iz bırakmaktır. <em>Altını çizdiğimiz</em> her cümle, daha sonra döneceğimiz bir işarettir.</p>
<p id="p2">İkinci paragraf başka bir düşünceyi taşır ve ayrı bir alıntı olarak kaydedilir.</p>
</body></html>`;

const web = await startStatic();
// Makale ayrı bir adresten sunulur: kenar düğmesi Derkenar'ın kendi sayfasında bilerek gizlenir.
const site = await startStatic(0, { '/makale.html': ARTICLE });
const shim = await startShim();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'derkenar-ext-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1200, height: 900 }, locale: 'tr-TR',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const log = (s) => console.log(`  · ${s}`);
const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const errors = [];
context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));

log('hesap ve bağlantı kodu (web uygulamasından)');
const app = await context.newPage();
app.on('dialog', (d) => d.accept());
await app.addInitScript(([url, key, origin]) => {
  if (location.origin === origin && !localStorage.getItem('derkenar.cloud')) localStorage.setItem('derkenar.cloud', JSON.stringify({ url, key }));
}, [shim.url, shim.anonKey, web.url]);
await app.goto(web.url);
await app.click('text=Hesabım yok, oluştur');
await app.fill('input[type=email]', 'okur@example.com');
await app.fill('input[type=password]', 'gizli-sifre');
await app.click('button:has-text("Hesap oluştur")');
await app.waitForSelector('.shell');
await app.goto(`${web.url}/#/ayarlar`);
await app.click('button:has-text("Bağlantı kodu oluştur")');
const code = await app.inputValue('[data-testid="connection-code"]');

log('ayarlar sayfası: hatalı kod reddedilir, doğru kod bağlanır');
const options = await context.newPage();
await options.goto(`chrome-extension://${id}/options.html`);
await options.fill('#code', 'bozuk-kod');
await options.click('#connect');
await options.waitForSelector('#status.error');
await options.fill('#code', code);
await options.click('#connect');
await options.waitForSelector('#status.ok');
assert.match(await options.innerText('#status'), /Bağlı\. Kütüphanende 0 alıntı/);

log('sağ tık menüsüyle kaydetme ve sayfada vurgulama');
const article = await context.newPage();
await article.goto(`${site.url}/makale.html?utm_source=bulten#giris`);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: '*://*/makale.html*' }))[0].id);
const first = 'Altını çizdiğimiz her cümle, daha sonra döneceğimiz bir işarettir.';
await sw.evaluate(async ([tid, text]) => {
  const tab = await chrome.tabs.get(tid);
  chrome.contextMenus.onClicked.dispatch({ menuItemId: 'derkenar-save', selectionText: text, pageUrl: tab.url }, tab);
}, [tabId, first]);
await article.waitForFunction(() => CSS.highlights.size === 1, null, { timeout: 15000 });
const marked = await article.evaluate(() => [...CSS.highlights.get('derkenar')].map((r) => r.toString()).join('|'));
assert.equal(marked, first, 'vurgu, biçimli (em) metni aşarak tam cümleyi kapsar');
let rows = (await shim.db.query('select q.text, q.origin, s.url, s.title, s.kind from public.quotes q join public.sources s on s.id = q.source_id')).rows;
assert.equal(rows.length, 1);
assert.equal(rows[0].text, first);
assert.equal(rows[0].url, `${site.url}/makale.html`, 'izleme parametreleri ve # kısmı atılır');
assert.equal(rows[0].title, 'Okuma Üzerine Bir Yazı');
assert.equal(rows[0].kind, 'web');

log('klavye kısayoluyla kaydetme (sayfadaki gerçek seçim)');
await article.evaluate(() => {
  const range = document.createRange();
  range.selectNodeContents(document.getElementById('p2'));
  getSelection().removeAllRanges();
  getSelection().addRange(range);
});
await sw.evaluate(async (tid) => chrome.commands.onCommand.dispatch('save-selection', await chrome.tabs.get(tid)), tabId);
await article.waitForFunction(() => [...(CSS.highlights.get('derkenar') || [])].length === 2, null, { timeout: 15000 });
rows = (await shim.db.query('select count(*)::int as n from public.quotes')).rows;
assert.equal(rows[0].n, 2);

log('kenar düğmesi: çizim kipi açıkken seçim kendiliğinden kaydedilir, geri alınabilir');
{
  const bubble = article.locator('#derkenar-host .bubble');
  await bubble.waitFor();
  assert.equal(await bubble.getAttribute('aria-pressed'), 'false');
  assert.equal(await article.locator('#derkenar-host .count').innerText(), '2', 'düğmede bu sayfadaki alıntı sayısı');
  const before = (await shim.db.query('select count(*)::int as n from public.quotes')).rows[0].n;
  // Kip kapalıyken seçim kaydedilmez
  await article.locator('h1').click({ clickCount: 3 });
  await article.waitForTimeout(900);
  assert.equal((await shim.db.query('select count(*)::int as n from public.quotes')).rows[0].n, before);
  // Kipi aç, bir cümleyi fareyle seç
  await bubble.click();
  await article.waitForFunction(() => document.querySelector('#derkenar-host').shadowRoot.querySelector('.bubble').classList.contains('on'));
  await article.locator('h1').click({ clickCount: 3 });
  await article.locator('#derkenar-host .toast:has-text("Kaydedildi")').waitFor();
  let saved = (await shim.db.query(`select text, origin from public.quotes where text = 'Okuma Üzerine'`)).rows;
  assert.equal(saved.length, 1);
  assert.equal(await article.evaluate(() => [...CSS.highlights.get('derkenar')].length), 3);
  assert.equal(await article.evaluate(() => String(getSelection())), '', 'kaydedilen seçim bırakılır, sarı vurgu kalır');
  assert.equal(await article.locator('#derkenar-host .count').innerText(), '3');
  // Tek sözcük (çift tıklama) kaydedilmez
  await article.locator('#p2').dblclick({ position: { x: 30, y: 10 } });
  await article.waitForTimeout(900);
  assert.equal((await shim.db.query('select count(*)::int as n from public.quotes')).rows[0].n, before + 1);
  // Aynı bölümü yeniden seçmek ikinci bir kayıt oluşturmaz
  await article.locator('h1').click({ clickCount: 3 });
  await article.waitForTimeout(900);
  assert.equal((await shim.db.query('select count(*)::int as n from public.quotes')).rows[0].n, before + 1);
  await article.evaluate(() => getSelection().removeAllRanges());
  await bubble.click(); // kipi kapat
  await article.waitForFunction(() => !document.querySelector('#derkenar-host').shadowRoot.querySelector('.bubble').classList.contains('on'));
  await bubble.click(); // yeniden aç
  await article.locator('#p1 em').click({ clickCount: 2 }); // tek sözcük: yok sayılır
  await article.evaluate(() => {
    const node = document.getElementById('p1').firstChild;
    const range = document.createRange();
    range.setStart(node, 0); range.setEnd(node, 8);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await article.waitForTimeout(900); // "Okumak," tek sözcük: kaydedilmez
  assert.equal((await shim.db.query('select count(*)::int as n from public.quotes')).rows[0].n, before + 1);
  await article.evaluate(() => getSelection().removeAllRanges());
  await shim.db.query(`delete from public.quotes where text = 'Okuma Üzerine'`);
  await article.reload();
  await article.locator('#derkenar-host .bubble.on').waitFor(); // kip, sayfa yenilense de açık kalır
  await article.locator('h1').click({ clickCount: 3 });
  await article.locator('#derkenar-host .toast:has-text("Kaydedildi")').waitFor();
  await article.screenshot({ path: path.join(shots, 'eklenti-dugme.png') });
  await article.locator('#derkenar-host .undo').click();
  await article.waitForFunction(() => [...(CSS.highlights.get('derkenar') || [])].length === 2);
  saved = (await shim.db.query(`select text from public.quotes where text = 'Okuma Üzerine'`)).rows;
  assert.equal(saved.length, 0, 'geri al, kaydı siler');
  await bubble.click(); // sonraki adımlar için kipi kapat
  await article.waitForFunction(() => !document.querySelector('#derkenar-host').shadowRoot.querySelector('.bubble').classList.contains('on'));
  // Derkenar uygulamasının kendi sayfasında düğme çıkmaz
  assert.equal(await app.locator('#derkenar-host').count(), 0);
}

log('sayfa yeniden açılınca vurgular geri gelir');
await article.reload();
await article.waitForFunction(() => [...(CSS.highlights.get('derkenar') || [])].length === 2, null, { timeout: 15000 });
await article.screenshot({ path: path.join(shots, 'eklenti-vurgu.png') });

log('alıntısı olmayan sayfada sunucuya sayfa adresi sorulmaz');
const before = (await shim.db.query('select last_used_at from public.api_tokens')).rows[0].last_used_at;
const other = await context.newPage();
await other.goto(`${web.url}/`);
await other.waitForTimeout(800);
const after = (await shim.db.query('select last_used_at from public.api_tokens')).rows[0].last_used_at;
assert.equal(String(after), String(before));
await other.close();

log('yan panel: listeleme, notla kaydetme, not düzenleme, silme');
const panel = await context.newPage();
panel.on('dialog', (d) => d.accept());
await panel.goto(`chrome-extension://${id}/sidepanel.html?tabId=${tabId}`);
await panel.waitForFunction(() => document.querySelectorAll('#list li').length === 2);
assert.match(await panel.innerText('.page'), /Okuma Üzerine Bir Yazı/);
await article.evaluate(() => {
  const node = document.getElementById('p1').firstChild;
  const range = document.createRange();
  range.setStart(node, 0); range.setEnd(node, node.nodeValue.indexOf('.') + 1);
  getSelection().removeAllRanges(); getSelection().addRange(range);
});
await panel.fill('#note', 'Girişte kullan');
await panel.fill('#tags', 'okuma, giriş');
await panel.click('#save');
await panel.waitForFunction(() => document.querySelectorAll('#list li').length === 3);
rows = (await shim.db.query(`select text, note, tags from public.quotes where note <> ''`)).rows;
assert.equal(rows[0].text, 'Okumak, bir metnin içinden geçerken iz bırakmaktır.');
assert.equal(rows[0].note, 'Girişte kullan');
assert.deepEqual(rows[0].tags, ['okuma', 'giriş']);
// Aynı seçimi yeniden kaydetmek kopya oluşturmaz
await panel.fill('#note', 'Girişte kullan');
await panel.click('#save');
await panel.waitForSelector('#status:has-text("zaten kayıtlıydı")');
await panel.screenshot({ path: path.join(shots, 'eklenti-panel.png') });

const item = panel.locator('#list li', { hasText: 'İkinci paragraf' });
await item.locator('button:has-text("Not ekle")').click();
await item.locator('textarea').fill('Panelden eklenen not');
await item.locator('button:has-text("Kaydet")').click();
await panel.waitForSelector('#list li .note:has-text("Panelden eklenen not")');
await panel.locator('#list li', { hasText: 'Altını çizdiğimiz' }).locator('button:has-text("Sil")').click();
await panel.waitForFunction(() => document.querySelectorAll('#list li').length === 2);

log('kaydedilenler web uygulamasında görünür');
await app.goto(`${web.url}/#/`);
await app.reload();
await app.waitForFunction(() => document.querySelectorAll('.quote').length === 2);
assert.match(await app.locator('.quote').first().innerText(), /eklenti/);

log('bağlantı kaldırılınca panel kurulum uyarısını gösterir');
await options.bringToFront();
options.on('dialog', (d) => d.accept());
await options.click('#disconnect');
await panel.reload();
await panel.waitForSelector('#setup:not([hidden])');

await context.close();
await web.close();
await site.close();
await shim.close();
if (errors.length) { console.log('Sayfa hataları:', errors); process.exit(1); }
console.log('\nEklenti testleri geçti.');
process.exit(0);
