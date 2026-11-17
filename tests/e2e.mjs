// Uçtan uca testler: derlenmiş web uygulaması gerçek bir tarayıcıda sürülür.
// Bulut kipi, gerçek SQL şemasını çalıştıran yerel taklide (cloud-shim) karşı sınanır.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from './pw.mjs';
import { startStatic } from './serve.mjs';
import { startShim } from './cloud-shim.mjs';
import { makeFixtures, OUT } from './make-pdfs.mjs';

const shots = process.env.SHOTS || path.join(os.tmpdir(), 'derkenar-shots');
fs.mkdirSync(shots, { recursive: true });
const fx = (name) => path.join(OUT, name);

await makeFixtures();
const web = await startStatic();
const shim = await startShim({ maxRows: 50 });
const browser = await chromium.launch();
const errors = [];
let step = '';
let expectHttpError = false;
const log = (name) => { step = name; console.log(`  · ${name}`); };

async function newDevice({ cloud = false, viewport = { width: 1200, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true, locale: 'tr-TR' });
  if (cloud) {
    await context.addInitScript(([url, key]) => {
      if (!localStorage.getItem('derkenar.cloud')) localStorage.setItem('derkenar.cloud', JSON.stringify({ url, key }));
    }, [shim.url, shim.anonKey]);
  }
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${step}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (expectHttpError && /status of 400/.test(m.text())) return; // yanlış şifre denemesinin beklenen yanıtı
    errors.push(`[${step}] console: ${m.text().slice(0, 200)}`);
  });
  page.on('dialog', (d) => d.accept());
  await page.goto(web.url);
  return { context, page };
}

const quotesOf = (page) => page.$$eval('.quote', (els) => els.map((e) => ({
  text: e.querySelector('blockquote')?.innerText || '',
  note: e.querySelector('.note')?.innerText || '',
  where: e.querySelector('.where')?.innerText || '',
})));
const countOf = async (page) => Number((await page.locator('.side nav a').first().locator('.n').innerText()).trim());

async function importPdfs(page, names) {
  await page.click('.top >> text=PDF içe aktar');
  await page.setInputFiles('input[type=file][accept*="pdf"]', names.map(fx));
  await page.waitForFunction((n) => document.querySelectorAll('.results li').length === n && !document.querySelector('.progress'), names.length, { timeout: 180000 });
  const rows = await page.$$eval('.results li', (els) => els.map((e) => e.innerText.replace(/\n/g, ' | ')));
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog', { state: 'detached' });
  return rows;
}

async function signUp(page, email, password = 'gizli-sifre') {
  await page.waitForSelector('.auth-card');
  await page.click('text=Hesabım yok, oluştur');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Hesap oluştur")');
  await page.waitForSelector('.shell');
}
async function signIn(page, email, password = 'gizli-sifre') {
  await page.waitForSelector('.auth-card');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]:has-text("Giriş yap")');
}
async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const file = path.join(shots, dl.suggestedFilename());
  await dl.saveAs(file);
  return file;
}

const EXPECT_LONG = 'bireyin belirli bir işi başarma kapasitesine ilişkin yargısıdır ve öğrenme sürecinde belirleyici bir rol oynar.';

// ===========================================================================
console.log('Hesapsız kip');
{
  const { context, page } = await newDevice();
  log('açılış');
  await page.waitForSelector('.shell');
  assert.match(await page.locator('.side-foot').innerText(), /Yalnızca bu cihazda/);

  log('PDF içe aktarma (metin, taranmış, çizimsiz)');
  let rows = await importPdfs(page, ['oz-yeterlik.pdf', 'taranmis.pdf', 'cizimsiz.pdf']);
  assert.match(rows[0], /Öz-yeterlik ve Öğrenme \| 4 yeni alıntı eklendi/);
  assert.match(rows[1], /Taranmış Kitap \| 1 yeni alıntı eklendi · 1 tanesi OCR ile okundu/);
  assert.match(rows[2], /Çizim ya da not bulunamadı/);
  let qs = await quotesOf(page);
  const long = qs.find((q) => q.text.startsWith('bireyin'));
  assert.equal(long.text, EXPECT_LONG, 'çok satırlı çizim ve satır sonu birleştirme');
  assert.match(long.where, /Yılmaz, A\. · Öz-yeterlik ve Öğrenme · s\. 233/);
  const commented = qs.find((q) => q.text === 'geri bildirimleri');
  assert.equal(commented.note, 'yöntem bölümünde kullan', 'çizime bağlı yorum');
  assert.ok(qs.find((q) => q.text === 'Self-efficacy beliefs determine how people feel, think, and behave.' && /s\. 234/.test(q.where)), 'altı çizili metin');
  assert.ok(qs.find((q) => !q.text && q.note === 'Bu bölümü tekrar oku'), 'yapışkan not');
  assert.ok(qs.find((q) => q.text === 'Anlam, okurun metinle kurduğu ilişkide ortaya çıkar.' && /OCR/.test(q.where)), 'taranmış sayfadan OCR');
  assert.equal(await countOf(page), 5);

  log('aynı PDF yeniden: yinelenmez; yeni çizimli sürüm: yalnızca yenisi eklenir');
  rows = await importPdfs(page, ['oz-yeterlik.pdf']);
  assert.match(rows[0], /Yeni çizim yok, 4 tanesi zaten kayıtlıydı/);
  rows = await importPdfs(page, ['oz-yeterlik-v2.pdf']);
  assert.match(rows[0], /1 yeni alıntı eklendi, 4 tanesi zaten kayıtlıydı/);
  assert.equal(await countOf(page), 6);
  assert.ok((await quotesOf(page)).find((q) => q.text === 'Araştırmalar, yüksek öz-yeterliğin akademik başarıyı yordadığını'));

  log('dosya adından yazar / yıl / başlık');
  await importPdfs(page, ['Bandura - 1997 - Self-efficacy.pdf']);
  assert.ok((await quotesOf(page)).some((q) => /Bandura \(1997\) · Self-efficacy/.test(q.where)));
  assert.equal(await countOf(page), 10);

  log('arama (Türkçe harf duyarsız) ve süzgeç temizleme');
  await page.fill('.search input', 'ogrenme surec');
  await page.waitForFunction(() => document.querySelectorAll('.quote').length === 2);
  assert.match(await page.locator('.count').innerText(), /2 \/ 10 alıntı/);
  await page.click('text=Süzgeçleri temizle');
  await page.waitForFunction(() => document.querySelectorAll('.quote').length === 10);

  log('not ekleme ve etiketleme');
  const card = page.locator('.quote', { hasText: 'Anlam, okurun metinle' });
  await card.locator('button[title="Not ekle"]').click();
  await card.locator('textarea').fill('Okuma kuramı bölümüne');
  await card.locator('text=Notu kaydet').click();
  await card.locator('.note', { hasText: 'Okuma kuramı bölümüne' }).waitFor();
  await card.locator('button[title="Etiketle"]').click();
  await card.locator('.tag-input input').fill('kuram');
  await card.locator('.tag-input input').press('Enter');
  await card.locator('text=Tamam').click();
  await card.locator('.chip', { hasText: '#kuram' }).waitFor();
  await page.selectOption('select[aria-label="Etiket"]', 'kuram');
  await page.waitForFunction(() => document.querySelectorAll('.quote').length === 1);
  await page.selectOption('select[aria-label="Etiket"]', '');

  log('proje oluşturma ve alıntı ekleme');
  await page.goto(`${web.url}/#/projeler`);
  await page.fill('input[aria-label="Yeni proje adı"]', 'Öz-yeterlik makalesi');
  await page.click('text=Proje oluştur');
  await page.waitForSelector('.page-title:has-text("Öz-yeterlik makalesi")');
  await page.goto(`${web.url}/#/`);
  for (const text of ['bireyin belirli', 'Anlam, okurun']) {
    const c = page.locator('.quote', { hasText: text }).filter({ hasNotText: 'Bandura' });
    await c.locator('button[title="Projeye ekle"]').click();
    await c.locator('.menu label', { hasText: 'Öz-yeterlik makalesi' }).click();
    await c.locator('.chip.project').waitFor();
    await page.mouse.move(5, 5);
  }
  await page.click('.side nav >> text=Projeler');
  await page.click('.source-list >> text=Öz-yeterlik makalesi');
  await page.waitForFunction(() => document.querySelectorAll('.quote').length === 2);

  log('kaynak bilgisi düzenleme');
  await page.click('.quote .where a >> text=Yılmaz');
  await page.waitForSelector('.source-head');
  await page.click('text=Bilgileri düzenle');
  await page.fill('dialog label:has-text("Yıl") input', '2020');
  await page.fill('dialog label:has-text("Dergi") input', 'Eğitim Araştırmaları Dergisi');
  await page.click('dialog button:has-text("Kaydet")');
  await page.waitForSelector('dialog', { state: 'detached' });
  assert.match(await page.locator('.source-head').innerText(), /Yılmaz, A\. · 2020 · Eğitim Araştırmaları Dergisi/);
  // Kaynak sayfasında alıntılar sayfa sırasıyla
  const pages = await page.$$eval('.quote .where', (els) => els.map((e) => e.innerText.match(/s\. (\d+)/)[1]));
  assert.deepEqual(pages, [...pages].sort());

  log('dışa aktarma: Markdown ve Word');
  await page.goto(`${web.url}/#/projeler`);
  await page.click('.source-list >> text=Öz-yeterlik makalesi');
  await page.click('.toolbar >> text=Dışa aktar');
  const mdFile = await download(page, () => page.click('text=Markdown indir'));
  const md = fs.readFileSync(mdFile, 'utf8');
  assert.match(md, /^# Öz-yeterlik makalesi/);
  assert.ok(md.includes(`> ${EXPECT_LONG} (Yılmaz, A., 2020, s. 233)`), md);
  assert.ok(md.includes('**Not:** Okuma kuramı bölümüne'));
  assert.ok(md.includes('## Kaynakça') && md.includes('- Yılmaz, A. (2020). Öz-yeterlik ve Öğrenme. Eğitim Araştırmaları Dergisi.'));
  const docx = await download(page, () => page.click('text=Word belgesi indir'));
  const buf = fs.readFileSync(docx);
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  assert.ok(buf.length > 2000);
  await page.keyboard.press('Escape');

  log('elle alıntı ekleme (yeni kaynakla)');
  await page.goto(`${web.url}/#/`);
  await page.click('.top >> text=Ekle');
  await page.fill('dialog label:has-text("Alıntı") textarea', 'Elle yazılmış bir alıntı.');
  await page.fill('dialog label:has-text("Not") textarea', 'Kitaptan');
  await page.selectOption('dialog .source-picker select', 'new');
  await page.fill('dialog label:has-text("Başlık") input', 'Deneme Kitabı');
  await page.fill('dialog label:has-text("Yazar") input', 'Kaya, B.');
  await page.fill('dialog label:has-text("Yıl") input', '2021');
  await page.fill('dialog label:has-text("Sayfa") input', '5');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  const manual = (await quotesOf(page)).find((q) => q.text === 'Elle yazılmış bir alıntı.');
  assert.match(manual.where, /Kaya, B\. \(2021\) · Deneme Kitabı · s\. 5/);
  // Aynı kaynaktan ikinci not: kaynak önceden seçili gelir
  await page.click('.top >> text=Ekle');
  await page.waitForSelector('dialog:modal');
  assert.match(await page.$eval('dialog .source-picker select', (s) => s.selectedOptions[0].textContent), /Deneme Kitabı/);
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog', { state: 'detached' });

  log('alıntı düzenleme (OCR hatasını düzeltme senaryosu)');
  const edit = page.locator('.quote', { hasText: 'Elle yazılmış bir alıntı.' });
  await edit.locator('button[title="Düzenle"]').click();
  await page.fill('dialog label:has-text("Alıntı") textarea', 'Elle düzeltilmiş alıntı.');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.locator('.quote', { hasText: 'Elle düzeltilmiş alıntı.' }).waitFor();

  log('kalıcılık: sayfa yenilenince veriler duruyor');
  await page.reload();
  await page.waitForSelector('.quote');
  assert.equal(await countOf(page), 11);

  log('yedek indirme');
  await page.goto(`${web.url}/#/ayarlar`);
  const backup = await download(page, () => page.click('text=Yedeği indir'));
  const data = JSON.parse(fs.readFileSync(backup, 'utf8'));
  assert.equal(data.quotes.length, 11);
  fs.copyFileSync(backup, path.join(shots, 'yedek.json'));

  log('silme: alıntı ve kaynak');
  await page.goto(`${web.url}/#/`);
  await page.locator('.quote', { hasText: 'Elle düzeltilmiş alıntı.' }).locator('button[title="Sil"]').click();
  await page.waitForFunction(() => !document.body.innerText.includes('Elle düzeltilmiş alıntı.'));
  assert.equal(await countOf(page), 10);
  await page.click('.quote .where a >> text=Bandura');
  await page.click('.source-head >> text=Sil');
  await page.waitForSelector('.source-list');
  assert.equal(await countOf(page), 6);

  await page.goto(`${web.url}/#/`);
  await page.waitForSelector('.quote');
  await page.screenshot({ path: path.join(shots, 'akis.png') });
  await context.close();
}

// ---------------------------------------------------------------------------
console.log('Paylaşım hedefi (Android)');
{
  const { context, page } = await newDevice({ viewport: { width: 390, height: 844 } });
  await page.waitForSelector('.shell');
  log('seçim + adres + başlık');
  const q = new URLSearchParams({ title: 'Bir Yazı', text: 'Paylaşılan cümle.', url: 'https://example.com/yazi?utm_source=x&id=7#bolum' });
  await page.goto(`${web.url}/?${q}`);
  await page.waitForSelector('.auth-card h1:has-text("Derkenar\'a kaydet")');
  assert.equal(await page.inputValue('label:has-text("Alıntı") textarea'), 'Paylaşılan cümle.');
  assert.equal(await page.inputValue('label:has-text("Başlık") input'), 'Bir Yazı');
  await page.screenshot({ path: path.join(shots, 'paylasim.png') });
  await page.click('button[type=submit]');
  await page.click('text=Kütüphaneyi aç');
  await page.waitForSelector('.quote');
  let qs = await quotesOf(page);
  assert.equal(qs[0].text, 'Paylaşılan cümle.');
  assert.match(qs[0].where, /Bir Yazı/);
  assert.match(qs[0].where, /paylaşım/);
  assert.equal(new URL(page.url()).search, '', 'paylaşım parametreleri adresten temizlenir');

  log('Android biçimi: adres metnin içinde; aynı sayfa aynı kaynağa bağlanır');
  await page.goto(`${web.url}/?${new URLSearchParams({ text: '"İkinci cümle."\n https://example.com/yazi?id=7' })}`);
  await page.waitForSelector('.auth-card');
  assert.equal(await page.inputValue('label:has-text("Alıntı") textarea'), 'İkinci cümle.');
  assert.match(await page.$eval('.source-picker select', (s) => s.selectedOptions[0].textContent), /Bir Yazı/);
  await page.click('button[type=submit]');
  await page.click('text=Kütüphaneyi aç');
  await page.goto(`${web.url}/#/kaynaklar`);
  await page.waitForSelector('.source-list a');
  assert.equal(await page.locator('.source-list a').count(), 1);
  assert.match(await page.locator('.source-list a').innerText(), /2 alıntı/);

  log('paylaş menüsünden gelen istek (servis işçisi): seçili metin');
  await page.goto(web.url);
  await page.waitForSelector('.shell');
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 });
  const submitShare = (fields, fileB64) => page.evaluate(([f, b64]) => {
    const form = document.createElement('form');
    form.method = 'post'; form.enctype = 'multipart/form-data'; form.action = './share-target';
    for (const [k, v] of Object.entries(f)) {
      const input = document.createElement('input'); input.type = 'hidden'; input.name = k; input.value = v; form.append(input);
    }
    if (b64) {
      const input = document.createElement('input'); input.type = 'file'; input.name = 'files';
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'Öz-yeterlik.pdf', { type: 'application/pdf' }));
      input.files = dt.files; form.append(input);
    }
    document.body.append(form); form.submit();
  }, [fields, fileB64]);
  await Promise.all([page.waitForURL(/127\.0\.0\.1:\d+\/(#.*)?$/), submitShare({ title: 'Üçüncü Yazı', text: 'Gönderilen seçim.', url: 'https://example.org/b' })]);
  await page.waitForSelector('.auth-card h1:has-text("Derkenar\'a kaydet")');
  assert.equal(await page.inputValue('label:has-text("Alıntı") textarea'), 'Gönderilen seçim.');
  await page.click('button[type=submit]');
  await page.click('text=Kütüphaneyi aç');
  await page.waitForFunction(() => document.querySelectorAll('.quote').length === 3);

  log('paylaş menüsünden gelen PDF dosyası: çizimleri içe alınır');
  await submitShare({}, fs.readFileSync(fx('oz-yeterlik.pdf')).toString('base64'));
  await page.waitForFunction(() => document.querySelectorAll('.results li').length === 1 && !document.querySelector('.progress'), null, { timeout: 120000 });
  assert.match(await page.locator('.results li').innerText(), /4 yeni alıntı eklendi/);
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog', { state: 'detached' });
  assert.equal(new URL(page.url()).search, '');
  assert.equal(await countOf(page), 7);
  // Sayfa yenilenince aynı dosya ikinci kez içe alınmaz
  await page.reload();
  await page.waitForSelector('.quote');
  assert.equal(await page.locator('dialog').count(), 0);

  log('telefon görünümü: yatay taşma yok');
  for (const hash of ['#/', '#/kaynaklar', '#/projeler', '#/ayarlar']) {
    await page.goto(`${web.url}/${hash}`);
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `${hash} yatay taşma: ${over}px`);
  }
  await page.goto(`${web.url}/#/`);
  await page.waitForSelector('.quote');
  await page.screenshot({ path: path.join(shots, 'telefon.png') });
  await context.close();
}

// ---------------------------------------------------------------------------
console.log('Klasör izleme');
{
  // Kalıcı profil kullanılır: Chromium, gizli pencerede saklanan test klasörü tanıtıcısını
  // geri okurken çöküyor (yalnızca test düzeneğindeki sanal klasörle ilgili bir tarayıcı hatası).
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'derkenar-profil-'));
  const context = await chromium.launchPersistentContext(profile, { viewport: { width: 1200, height: 900 }, locale: 'tr-TR' });
  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${step}] pageerror: ${e.message}`));
  await page.goto(web.url);
  await page.waitForSelector('.shell');
  const b64 = (name) => fs.readFileSync(fx(name)).toString('base64');
  const write = (name, data) => page.evaluate(async ([n, d]) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('Okuma', { create: true });
    const sub = await dir.getDirectoryHandle('makaleler', { create: true });
    const fh = await sub.getFileHandle(n, { create: true });
    const w = await fh.createWritable();
    await w.write(Uint8Array.from(atob(d), (c) => c.charCodeAt(0)));
    await w.close();
  }, [name, data]);

  log('ilk tarama: alt klasördeki PDF içe alınır');
  await write('oz-yeterlik.pdf', b64('oz-yeterlik.pdf'));
  await write('cizimsiz.pdf', b64('cizimsiz.pdf'));
  let res = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    return window.__derkenar.useFolder(await root.getDirectoryHandle('Okuma'));
  });
  assert.deepEqual(res, { files: 2, changed: 2, added: 4, errors: 0 });
  assert.equal(await countOf(page), 4);

  log('değişiklik yoksa hiçbir şey okunmaz');
  res = await page.evaluate(() => window.__derkenar.scanNow());
  assert.deepEqual(res, { files: 2, changed: 0, added: 0, errors: 0 });

  log('dosyaya yeni çizim eklenince yalnızca o alıntı düşer');
  await page.waitForTimeout(20);
  await write('oz-yeterlik.pdf', b64('oz-yeterlik-v2.pdf'));
  res = await page.evaluate(() => window.__derkenar.scanNow());
  assert.deepEqual(res, { files: 2, changed: 1, added: 1, errors: 0 });
  assert.equal(await countOf(page), 5);

  log('pencere yeniden öne gelince beklemeden taranır');
  await write('taranmis.pdf', b64('taranmis.pdf'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector('.side nav a .n')?.textContent.trim() === '6', null, { timeout: 120000 });

  log('yeniden açılışta klasör hatırlanır ve hemen taranır');
  await write('Bandura - 1997 - Self-efficacy.pdf', b64('Bandura - 1997 - Self-efficacy.pdf'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.side nav a .n')?.textContent.trim() === '10', null, { timeout: 60000 });
  await page.goto(`${web.url}/#/ayarlar`);
  await page.waitForSelector('.card:has-text("Klasör izleme") .badge.ok');
  assert.match(await page.locator('.card:has-text("Klasör izleme")').innerText(), /Okuma/);
  await page.screenshot({ path: path.join(shots, 'ayarlar.png'), fullPage: true });
  await context.close();
}

// ===========================================================================
console.log('Bulut kipi (iki cihaz, hesap yalıtımı, sayfalama, taşıma, bağlantı kodu)');
{
  const A = await newDevice({ cloud: true });
  log('hesap oluşturma');
  await signUp(A.page, 'okur@example.com');
  assert.match(await A.page.locator('.side-foot').innerText(), /Eşitleniyor/);
  await importPdfs(A.page, ['oz-yeterlik.pdf']);
  assert.equal(await countOf(A.page), 4);

  log('ikinci cihaz aynı kütüphaneyi görür');
  const B = await newDevice({ cloud: true, viewport: { width: 390, height: 844 } });
  expectHttpError = true;
  await signIn(B.page, 'okur@example.com', 'yanlis-sifre');
  await B.page.waitForSelector('.status.error');
  assert.match(await B.page.locator('.status.error').innerText(), /E-posta ya da şifre hatalı/);
  expectHttpError = false;
  await signIn(B.page, 'okur@example.com');
  await B.page.waitForSelector('.shell');
  await B.page.waitForSelector('.quote');
  assert.equal((await quotesOf(B.page)).length, 4);
  assert.ok((await quotesOf(B.page)).some((q) => q.text === EXPECT_LONG));

  log('ikinci cihazda eklenen not birincide görünür');
  await B.page.click('.top >> text=Ekle');
  await B.page.fill('dialog label:has-text("Not") textarea', 'Telefondan sesli not');
  await B.page.click('dialog button[type=submit]');
  await B.page.waitForSelector('dialog', { state: 'detached' });
  await A.page.reload();
  await A.page.waitForSelector('.quote');
  assert.ok((await quotesOf(A.page)).some((q) => q.note === 'Telefondan sesli not'));
  // Birincide silinen, ikincide de kaybolur
  await A.page.locator('.quote', { hasText: 'Telefondan sesli not' }).locator('button[title="Sil"]').click();
  await A.page.waitForFunction(() => !document.body.innerText.includes('Telefondan sesli not'));
  await B.page.reload();
  await B.page.waitForSelector('.quote');
  assert.equal((await quotesOf(B.page)).length, 4);

  log('başka hesap bu verileri göremez');
  const C = await newDevice({ cloud: true });
  await signUp(C.page, 'baskasi@example.com');
  await C.page.waitForSelector('.empty');
  assert.equal(await countOf(C.page), 0);
  await C.context.close();

  log('sayfalama: sunucu sınırından (50) fazla satır eksiksiz yüklenir');
  const many = {
    app: 'derkenar', version: 1, sources: [], projects: [],
    quotes: Array.from({ length: 130 }, (_, i) => ({
      id: crypto.randomUUID(), source_id: null, text: `Toplu alıntı ${i + 1}`, note: '', page: '', color: '', tags: [], project_ids: [],
      origin: 'manual', device: 'test', fingerprint: `bulk:${i}`, created_at: new Date(Date.now() - i * 60000).toISOString(), updated_at: new Date().toISOString(),
    })),
  };
  const manyFile = path.join(shots, 'toplu.json');
  fs.writeFileSync(manyFile, JSON.stringify(many));
  await A.page.goto(`${web.url}/#/ayarlar`);
  await A.page.setInputFiles('input[type=file][accept*="json"]', manyFile);
  await A.page.waitForSelector('.toast:has-text("130 alıntı geri yüklendi")');
  await A.page.reload();
  await A.page.waitForSelector('.shell');
  await A.page.waitForFunction(() => document.querySelector('.side nav a .n')?.textContent.trim() === '134');
  // Aynı yedeği yeniden yüklemek kopya oluşturmaz
  await A.page.setInputFiles('input[type=file][accept*="json"]', manyFile);
  await A.page.waitForSelector('.toast:has-text("0 alıntı geri yüklendi")');

  log('hesapsız veriyi hesaba taşıma');
  const D = await newDevice();
  await D.page.waitForSelector('.shell');
  await importPdfs(D.page, ['oz-yeterlik.pdf', 'taranmis.pdf']);
  assert.equal(await countOf(D.page), 5);
  await D.page.evaluate(([url, key]) => localStorage.setItem('derkenar.cloud', JSON.stringify({ url, key })), [shim.url, shim.anonKey]);
  await D.page.goto(`${web.url}/#/ayarlar`);
  await D.page.reload();
  await D.page.click('text=Giriş yap ya da hesap oluştur');
  await signIn(D.page, 'okur@example.com');
  await D.page.waitForSelector('.shell');
  await D.page.waitForSelector('text=Bu cihazda hesapsız kaydedilmiş 5 alıntı var');
  await D.page.click('text=Hesabıma aktar');
  await D.page.waitForSelector('.toast:has-text("1 alıntı hesabına aktarıldı")');
  await D.page.waitForFunction(() => document.querySelector('.side nav a .n')?.textContent.trim() === '135');
  await D.page.goto(`${web.url}/#/kaynaklar`);
  await D.page.waitForSelector('.source-list a');
  assert.equal(await D.page.locator('.source-list a', { hasText: 'Öz-yeterlik ve Öğrenme' }).count(), 1, 'aynı PDF tek kaynak olarak kalır');
  await D.context.close();

  log('bağlantı kodu ve dış araçtan yakalama');
  await A.page.goto(`${web.url}/#/ayarlar`);
  await A.page.fill('input[aria-label="Bağlantı adı"]', 'Test aracı');
  await A.page.click('button:has-text("Bağlantı kodu oluştur")');
  const code = await A.page.inputValue('[data-testid="connection-code"]');
  const conn = JSON.parse(Buffer.from(code, 'base64').toString());
  assert.equal(conn.u, shim.url);
  const cap = await fetch(`${conn.u}/rest/v1/rpc/capture`, {
    method: 'POST', headers: { apikey: conn.k, authorization: `Bearer ${conn.k}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_token: conn.t, p_payload: { text: 'Preview\'dan kısayolla', file_name: 'oz-yeterlik.pdf', kind: 'pdf', origin: 'shortcut', device: 'Mac' } }),
  }).then((r) => r.json());
  assert.equal(cap.duplicate, false);
  await A.page.goto(`${web.url}/#/`);
  await A.page.reload();
  await A.page.fill('.search input', 'kısayolla');
  await A.page.waitForFunction(() => document.querySelectorAll('.quote').length === 1);
  const sc = (await quotesOf(A.page))[0];
  assert.match(sc.where, /Öz-yeterlik ve Öğrenme/, 'kısayol alıntısı içe aktarılmış PDF kaynağına bağlanır');
  assert.match(sc.where, /kısayol/);
  await A.page.goto(`${web.url}/#/ayarlar`);
  await A.page.waitForSelector('.token-list li:has-text("Test aracı")');
  await A.page.click('.token-list >> text=İptal et');
  await A.page.waitForFunction(() => !document.querySelector('.token-list li'));
  const denied = await fetch(`${conn.u}/rest/v1/rpc/token_status`, {
    method: 'POST', headers: { apikey: conn.k, 'content-type': 'application/json' }, body: JSON.stringify({ p_token: conn.t }),
  });
  assert.equal(denied.status, 403, 'iptal edilen kod artık çalışmaz');

  log('çıkış ve yeniden giriş');
  await A.page.click('text=Çıkış yap');
  await signIn(A.page, 'okur@example.com');
  await A.page.waitForSelector('.shell');
  await A.page.waitForFunction(() => document.querySelector('.side nav a .n')?.textContent.trim() === '136');
  await A.context.close();
  await B.context.close();
}

await browser.close();
await web.close();
await shim.close();
if (errors.length) {
  console.log('\nTarayıcı hataları:');
  for (const e of errors) console.log('  ' + e);
  process.exit(1);
}
console.log(`\nBütün uçtan uca testler geçti. Ekran görüntüleri: ${shots}`);
process.exit(0);
