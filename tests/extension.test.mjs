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
// Sayfadaki Derkenar vurguları: {renk: [metinler]}
const marksOf = (page) => page.evaluate(() => Object.fromEntries([...CSS.highlights.entries()]
  .filter(([name]) => name.startsWith('derkenar-'))
  .map(([name, hl]) => [name.replace('derkenar-', ''), [...hl].map((r) => r.toString().trim())])));
const markCount = async (page) => Object.values(await marksOf(page)).flat().length;
const waitMarks = (page, n) => page.waitForFunction((want) => [...CSS.highlights.entries()]
  .filter(([name]) => name.startsWith('derkenar-')).reduce((sum, [, hl]) => sum + hl.size, 0) === want, n, { timeout: 15000 });
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
  chrome.contextMenus.onClicked.dispatch({ menuItemId: 'derkenar-save-green', parentMenuItemId: 'derkenar-save', selectionText: text, pageUrl: tab.url }, tab);
}, [tabId, first]);
await waitMarks(article, 1);
assert.deepEqual(await marksOf(article), { green: [first] }, 'vurgu, biçimli (em) metni aşarak tam cümleyi kapsar; rengi menüde seçilen kategori');
let rows = (await shim.db.query('select q.text, q.origin, q.color, s.url, s.title, s.kind from public.quotes q join public.sources s on s.id = q.source_id')).rows;
assert.equal(rows.length, 1);
assert.equal(rows[0].text, first);
assert.equal(rows[0].color, '#6fcf7c');
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
await waitMarks(article, 2);
rows = (await shim.db.query('select count(*)::int as n from public.quotes')).rows;
assert.equal(rows[0].n, 2);
assert.equal((await marksOf(article)).yellow.length, 1, 'kısayol, kip kapalıyken varsayılan renkle kaydeder');

log('kenar düğmesi: seç, düğmeye bas, renk seç; o renkle ve kategoriyle kaydedilir');
{
  const host = article.locator('#derkenar-host');
  const bubble = host.locator('.bubble');
  const swatch = (key) => host.locator(`.swatch[data-color="${key}"]`);
  const pressed = () => bubble.getAttribute('aria-pressed');
  const total = async () => (await shim.db.query('select count(*)::int as n from public.quotes')).rows[0].n;
  await bubble.waitFor();
  assert.equal(await pressed(), 'false');
  assert.equal(await host.locator('.count').innerText(), '2', 'düğmede bu sayfadaki alıntı sayısı');
  const before = await total();

  // Kip kapalıyken yalnızca seçmek hiçbir şey kaydetmez
  await article.locator('h1').click({ clickCount: 3 });
  await article.waitForTimeout(900);
  assert.equal(await total(), before);

  // Seçim dururken düğmeye bas: palet açılır, seçim bozulmaz; pembe seç
  await bubble.click();
  await host.locator('.palette').waitFor();
  assert.equal(await article.evaluate(() => String(getSelection()).trim()), 'Okuma Üzerine', 'düğmeye basmak seçimi bozmaz');
  assert.match(await host.locator('.hint').innerText(), /seçtiğin bölüm bu renkle kaydedilir/);
  await swatch('pink').click();
  await host.locator('.toast:has-text("Kaydedildi · Pembe")').waitFor();
  let saved = (await shim.db.query(`select color from public.quotes where text = 'Okuma Üzerine'`)).rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].color, '#f58fb0');
  assert.deepEqual((await marksOf(article)).pink, ['Okuma Üzerine']);
  assert.equal(await article.evaluate(() => String(getSelection())), '', 'kaydedilen seçim bırakılır, renkli vurgu kalır');
  assert.equal(await host.locator('.count').innerText(), '3');
  assert.equal(await pressed(), 'false', 'tek seferlik kayıt çizim kipini açmaz');

  // Paletten tek sözcük de kaydedilebilir; geri al kaydı siler
  await article.locator('#p1 em').dblclick({ position: { x: 12, y: 8 } });
  await bubble.click();
  await swatch('blue').click();
  await host.locator('.toast:has-text("Kaydedildi · Mavi")').waitFor();
  assert.equal(await total(), before + 2);
  await host.locator('.undo').click();
  await waitMarks(article, 3);
  assert.equal(await total(), before + 1, 'geri al, kaydı siler');

  // Kategori adı uygulamada değiştirilince palet ve sağ tık menüsü onu gösterir
  await shim.db.query(`insert into public.settings (user_id, categories) select id, '{"green":"Yöntem"}'::jsonb from auth.users`);
  await sw.evaluate(() => new Promise((resolve) => {
    chrome.storage.onChanged.addListener(function once(changes) { if (changes.cats) { chrome.storage.onChanged.removeListener(once); resolve(); } });
    chrome.storage.local.remove('cats').then(() => chrome.runtime.onStartup.dispatch());
  }));
  await article.evaluate(() => getSelection().removeAllRanges());
  await bubble.click();
  await host.locator('.swatch[data-color="green"]:has-text("Yöntem")').waitFor();
  assert.match(await host.locator('.hint').innerText(), /çizim kipi açılır/);

  // Seçim yokken renk seçmek çizim kipini o renkle açar
  await swatch('green').click();
  await article.waitForFunction(() => document.querySelector('#derkenar-host').shadowRoot.querySelector('.bubble').classList.contains('on'));
  assert.equal(await pressed(), 'true');
  await shim.db.query(`delete from public.quotes where text = 'Okuma Üzerine'`);
  await article.reload();
  await host.locator('.bubble.on').waitFor(); // kip, sayfa yenilense de açık kalır
  await article.locator('h1').click({ clickCount: 3 });
  await host.locator('.toast:has-text("Kaydedildi · Yöntem")').waitFor();
  saved = (await shim.db.query(`select color from public.quotes where text = 'Okuma Üzerine'`)).rows;
  assert.equal(saved[0].color, '#6fcf7c');
  await article.screenshot({ path: path.join(shots, 'eklenti-dugme.png') });
  // Çizim kipinde tek sözcük (çift tıklama) kaydedilmez
  await article.locator('#p2').dblclick({ position: { x: 30, y: 10 } });
  await article.waitForTimeout(900);
  assert.equal(await total(), before + 1);
  await article.evaluate(() => getSelection().removeAllRanges());

  // Palet açıkken ekran görüntüsü, sonra kipi kapat
  await bubble.click();
  await host.locator('.swatch.off').waitFor();
  await article.screenshot({ path: path.join(shots, 'eklenti-palet.png') });
  await host.locator('.swatch.off').click();
  await article.waitForFunction(() => !document.querySelector('#derkenar-host').shadowRoot.querySelector('.bubble').classList.contains('on'));
  await shim.db.query(`delete from public.quotes where text = 'Okuma Üzerine'`);
  // Derkenar uygulamasının kendi sayfasında düğme çıkmaz
  assert.equal(await app.locator('#derkenar-host').count(), 0);
}

log('sayfa yeniden açılınca vurgular geri gelir');
await article.reload();
await waitMarks(article, 2);
assert.deepEqual(Object.keys(await marksOf(article)).sort(), ['green', 'yellow'], 'vurgular kendi renkleriyle geri gelir');
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
