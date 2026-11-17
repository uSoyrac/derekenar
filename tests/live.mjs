// Gerçek Supabase projesine karşı duman testi. Ortam değişkenleri:
//   LIVE_URL, LIVE_KEY (yayınlanabilir anahtar), LIVE_EMAIL, LIVE_PASSWORD (onaylı bir deneme hesabı)
// Otomatik test takımına dahil değildir; deneme hesabının verilerini değiştirir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from './pw.mjs';
import { startStatic } from './serve.mjs';
import { makeFixtures, OUT } from './make-pdfs.mjs';

const { LIVE_URL, LIVE_KEY, LIVE_EMAIL, LIVE_PASSWORD } = process.env;
assert.ok(LIVE_URL && LIVE_KEY && LIVE_EMAIL && LIVE_PASSWORD, 'LIVE_* değişkenleri gerekli');
const shots = process.env.SHOTS || path.join(os.tmpdir(), 'derkenar-shots');
fs.mkdirSync(shots, { recursive: true });
await makeFixtures();
const web = await startStatic();
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ proxy });
const log = (s) => console.log(`  · ${s}`);
const errors = [];

async function device(viewport = { width: 1200, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: 'tr-TR', acceptDownloads: true });
  await context.addInitScript(([url, key]) => {
    if (!localStorage.getItem('derkenar.cloud')) localStorage.setItem('derkenar.cloud', JSON.stringify({ url, key }));
  }, [LIVE_URL, LIVE_KEY]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(web.url);
  await page.waitForSelector('.auth-card');
  await page.fill('input[type=email]', LIVE_EMAIL);
  await page.fill('input[type=password]', LIVE_PASSWORD);
  await page.click('button[type=submit]:has-text("Giriş yap")');
  await page.waitForSelector('.shell', { timeout: 30000 });
  return { context, page };
}
const count = (page) => page.locator('.side nav a').first().locator('.n').innerText().then((t) => Number(t.trim()));
const texts = (page) => page.$$eval('.quote blockquote', (els) => els.map((e) => e.innerText));

log('giriş (gerçek Supabase Auth)');
const A = await device();
assert.match(await A.page.locator('.side-foot').innerText(), /Eşitleniyor/);
const start = await count(A.page);

log('PDF içe aktarma: alıntılar ve kaynak buluta yazılır');
await A.page.click('.top >> text=PDF içe aktar');
await A.page.setInputFiles('input[type=file][accept*="pdf"]', [path.join(OUT, 'oz-yeterlik.pdf'), path.join(OUT, 'taranmis.pdf')]);
await A.page.waitForFunction(() => document.querySelectorAll('.results li').length === 2 && !document.querySelector('.progress'), null, { timeout: 180000 });
const rows = await A.page.$$eval('.results li', (els) => els.map((e) => e.innerText.replace(/\n/g, ' | ')));
console.log('    ', rows.join('\n     '));
await A.page.keyboard.press('Escape');
assert.equal(await count(A.page), start + 5);

log('yeniden içe aktarma kopya üretmez (sunucudaki benzersizlik kuralı)');
await A.page.click('.top >> text=PDF içe aktar');
await A.page.setInputFiles('input[type=file][accept*="pdf"]', [path.join(OUT, 'oz-yeterlik.pdf')]);
await A.page.waitForFunction(() => document.querySelectorAll('.results li').length === 1 && !document.querySelector('.progress'), null, { timeout: 60000 });
assert.match(await A.page.locator('.results li').innerText(), /Yeni çizim yok/);
await A.page.keyboard.press('Escape');

log('ikinci cihaz aynı kütüphaneyi görür');
const B = await device({ width: 390, height: 844 });
await B.page.waitForSelector('.quote');
assert.equal(await count(B.page), start + 5);
assert.ok((await texts(B.page)).includes('Anlam, okurun metinle kurduğu ilişkide ortaya çıkar.'));

log('not, etiket ve proje güncellemeleri (dizi sütunları dahil) kaydedilir');
const card = A.page.locator('.quote', { hasText: 'Anlam, okurun metinle' });
await card.locator('button[title="Not ekle"]').click();
await card.locator('textarea').fill('Gerçek sunucuda not');
await card.locator('text=Notu kaydet').click();
await card.locator('.note', { hasText: 'Gerçek sunucuda not' }).waitFor();
await card.locator('button[title="Etiketle"]').click();
await card.locator('.tag-input input').fill('kuram');
await card.locator('.tag-input input').press('Enter');
await card.locator('text=Tamam').click();
await A.page.goto(`${web.url}/#/projeler`);
await A.page.fill('input[aria-label="Yeni proje adı"]', 'Canlı deneme projesi');
await A.page.click('text=Proje oluştur');
await A.page.waitForSelector('.page-title:has-text("Canlı deneme projesi")');
await A.page.goto(`${web.url}/#/`);
const c2 = A.page.locator('.quote', { hasText: 'Anlam, okurun metinle' });
await c2.locator('button[title="Projeye ekle"]').click();
await c2.locator('.menu label', { hasText: 'Canlı deneme projesi' }).click();
await c2.locator('.chip.project').waitFor();
await B.page.reload();
await B.page.waitForSelector('.quote');
const seen = B.page.locator('.quote', { hasText: 'Anlam, okurun metinle' });
assert.match(await seen.innerText(), /Gerçek sunucuda not/);
assert.match(await seen.innerText(), /#kuram/);
assert.match(await seen.innerText(), /Canlı deneme projesi/);

log('bağlantı kodu: dış araçtan yakalama, sayfa alıntıları, iptal');
await A.page.goto(`${web.url}/#/ayarlar`);
await A.page.fill('input[aria-label="Bağlantı adı"]', 'Canlı test');
await A.page.click('button:has-text("Bağlantı kodu oluştur")');
const conn = JSON.parse(Buffer.from(await A.page.inputValue('[data-testid="connection-code"]'), 'base64').toString());
const rpc = (fn, args) => JSON.parse(execFileSync('curl', ['-sS', '-m', '30', '-X', 'POST', `${conn.u}/rest/v1/rpc/${fn}`,
  '-H', `apikey: ${conn.k}`, '-H', `Authorization: Bearer ${conn.k}`, '-H', 'Content-Type: application/json',
  '--data-binary', JSON.stringify({ p_token: conn.t, ...args })]).toString());
let r = rpc('capture', { p_payload: { text: "Preview'dan kısayolla", file_name: 'oz-yeterlik.pdf', kind: 'pdf', origin: 'shortcut', device: 'Mac' } });
assert.equal(r.duplicate, false);
r = rpc('capture', { p_payload: { text: 'Web sayfasından', url: 'https://example.com/yazi', title: 'Bir Yazı', kind: 'web', origin: 'extension', tags: ['web'] } });
assert.equal(r.duplicate, false);
r = rpc('quotes_for_url', { p_url: 'https://example.com/yazi' });
assert.equal(r.length, 1); assert.deepEqual(r[0].tags, ['web']);
r = rpc('token_update_quote', { p_id: r[0].id, p_patch: { note: 'panelden' } });
assert.equal(r.updated, 1);
assert.deepEqual(rpc('source_urls', {}), ['https://example.com/yazi']);
await A.page.goto(`${web.url}/#/`);
await A.page.reload();
await A.page.waitForSelector('.quote');
assert.equal(await count(A.page), start + 7);
await A.page.fill('.search input', 'kısayolla');
await A.page.waitForFunction(() => document.querySelectorAll('.quote').length === 1);
assert.match(await A.page.locator('.quote .where').innerText(), /Öz-yeterlik ve Öğrenme/);
await A.page.screenshot({ path: path.join(shots, 'canli.png') });
await A.page.goto(`${web.url}/#/ayarlar`);
await A.page.waitForSelector('.token-list li:has-text("Canlı test")');
await A.page.click('.token-list >> text=İptal et');
await A.page.waitForFunction(() => !document.querySelector('.token-list li'));
r = rpc('token_status', {});
assert.equal(r.code, '28000', 'iptal edilen kod reddedilir');

log('silme: alıntı ve kaynak (bağlı alıntılarıyla)');
await A.page.goto(`${web.url}/#/kaynaklar`);
await A.page.click('.source-list >> text=Bir Yazı');
await A.page.click('.source-head >> text=Sil');
await A.page.waitForSelector('.source-list');
assert.equal(await count(A.page), start + 6);

log('çıkış ve yeniden giriş: veriler duruyor');
await A.page.goto(`${web.url}/#/ayarlar`);
await A.page.click('text=Çıkış yap');
await A.page.waitForSelector('.auth-card');
await A.page.fill('input[type=email]', LIVE_EMAIL);
await A.page.fill('input[type=password]', LIVE_PASSWORD);
await A.page.click('button[type=submit]:has-text("Giriş yap")');
await A.page.waitForSelector('.shell');
await A.page.waitForFunction((n) => document.querySelector('.side nav a .n')?.textContent.trim() === String(n), start + 6);

await browser.close();
await web.close();
if (errors.length) { console.log('Tarayıcı hataları:\n  ' + errors.join('\n  ')); process.exit(1); }
console.log('\nGerçek sunucu duman testi geçti.');
process.exit(0);
