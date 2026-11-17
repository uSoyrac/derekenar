// Mac servis betiğinin sunucuyla konuşan kısmını sınar: JXA ortamı taklit edilir,
// ama betiğin ürettiği curl komutu gerçekten çalıştırılır (kabuk tırnaklaması dahil).
// macOS'e özgü kısımlar (Servisler, System Events) burada sınanamaz.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'mac', 'derkenar-servis.js'), 'utf8');
// Betik eşzamanlı çalıştığı için sunucu taklidi ayrı bir süreçte durmalı.
const child = spawn(process.execPath, [path.join(here, 'cloud-shim.mjs')], { env: { ...process.env, PORT: '0' } });
const shim = await new Promise((resolve, reject) => {
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
    const m = out.match(/shim (\S+)\nanon key: (\S+)/);
    if (m) resolve({ url: m[1], anonKey: m[2] });
  });
  child.on('exit', () => reject(new Error('sunucu taklidi başlamadı')));
});

const signup = await fetch(`${shim.url}/auth/v1/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'mac@example.com', password: 'secret123' }) }).then((r) => r.json());
const token = crypto.randomBytes(32).toString('hex');
await fetch(`${shim.url}/rest/v1/api_tokens`, {
  method: 'POST', headers: { apikey: shim.anonKey, authorization: `Bearer ${signup.access_token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ token_hash: crypto.createHash('sha256').update(token).digest('hex') }),
});
const conn = { u: shim.url, k: shim.anonKey, t: token };

function run(cmd) {
  try {
    return execSync(cmd, { shell: '/bin/bash', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (e) {
    console.log('komut hatası:', String(e.stderr).slice(0, 300));
    throw e;
  }
}

function runScript(input, frontApp) {
  const notes = [];
  const Application = (name) => {
    if (name === 'System Events') return { applicationProcesses: { whose: () => [{ name: () => frontApp.name, windows: [{ name: () => frontApp.window }] }] } };
    if (name === 'Preview') return { documents: [{ name: () => frontApp.doc }] };
    return { windows: [{ activeTab: () => ({ url: () => frontApp.url, title: () => frontApp.title }) }] };
  };
  Application.currentApplication = () => ({
    displayNotification: (m) => notes.push(m),
    doShellScript: (cmd) => (cmd.includes('base64 -D')
      ? JSON.stringify(conn)
      : run(cmd)),
  });
  vm.runInNewContext(`${src}\nrun(input);`, { Application, input, JSON, String, Array });
  return notes;
}

let notes = runScript(["Seçili 'tırnaklı' ve \"çift tırnaklı\" metin; $HOME `ls` \\n"], { name: 'Preview', doc: "Yılmaz'ın kitabı.pdf" });
assert.deepEqual(notes, ['Kaydedildi']);
notes = runScript(["Seçili 'tırnaklı' ve \"çift tırnaklı\" metin; $HOME `ls` \\n"], { name: 'Preview', doc: "Yılmaz'ın kitabı.pdf" });
assert.deepEqual(notes, ['Bu alıntı zaten kayıtlıydı']);
notes = runScript(['Web seçimi'], { name: 'Google Chrome', url: 'https://example.com/a#b', title: 'Bir sayfa' });
assert.deepEqual(notes, ['Kaydedildi']);
notes = runScript(['   '], { name: 'Preview', doc: 'x.pdf' });
assert.deepEqual(notes, ['Seçili metin yok']);

const get = (table) => fetch(`${shim.url}/rest/v1/${table}?select=*&order=created_at.asc`, { headers: { apikey: shim.anonKey, authorization: `Bearer ${signup.access_token}` } }).then((r) => r.json());
const quotes = await get('quotes');
const sources = await get('sources');
assert.equal(quotes.length, 2);
assert.equal(quotes[0].text, "Seçili 'tırnaklı' ve \"çift tırnaklı\" metin; $HOME `ls` \\n", 'özel karakterler bozulmadan ulaşır');
assert.equal(quotes[0].origin, 'shortcut');
const pdf = sources.find((x) => x.id === quotes[0].source_id);
assert.equal(pdf.file_name, "Yılmaz'ın kitabı.pdf");
assert.equal(pdf.kind, 'pdf');
const webSrc = sources.find((x) => x.id === quotes[1].source_id);
assert.equal(webSrc.url, 'https://example.com/a');
assert.equal(webSrc.title, 'Bir sayfa');

console.log('Mac betiği (sunucu kısmı) testleri geçti');
child.kill();
process.exit(0);
