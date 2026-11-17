// Şema, RLS ve RPC fonksiyonlarının testi (shim üzerinden gerçek SQL).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startShim } from './cloud-shim.mjs';

const shim = await startShim();
const base = shim.url;
const call = async (method, path, { token, body, prefer } = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { apikey: shim.anonKey, authorization: `Bearer ${token || shim.anonKey}`, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
};
const signup = async (email) => (await call('POST', '/auth/v1/signup', { body: { email, password: 'secret123' } })).data;

const a = await signup('a@example.com');
const b = await signup('b@example.com');
const A = a.access_token, B = b.access_token;

// A kaynak ve alıntı ekler
let r = await call('POST', '/rest/v1/sources', { token: A, body: { title: 'Kitap A', kind: 'pdf', fingerprint: 'pdf:1' }, prefer: 'return=representation' });
assert.equal(r.status, 201); const srcA = r.data[0];
assert.equal(srcA.user_id, a.user.id);
r = await call('POST', '/rest/v1/quotes', { token: A, body: [{ source_id: srcA.id, text: 'birinci', fingerprint: 'f1' }, { source_id: srcA.id, text: 'ikinci', fingerprint: 'f2' }], prefer: 'return=representation' });
assert.equal(r.data.length, 2);

// Yinelenen parmak izi yok sayılır
r = await call('POST', '/rest/v1/quotes?on_conflict=user_id,fingerprint', { token: A, body: [{ source_id: srcA.id, text: 'birinci', fingerprint: 'f1' }, { source_id: srcA.id, text: 'yeni', fingerprint: 'f3' }], prefer: 'return=representation,resolution=ignore-duplicates' });
assert.equal(r.data.length, 1); assert.equal(r.data[0].text, 'yeni');

// B, A'nın verisini göremez, değiştiremez, silemez
r = await call('GET', '/rest/v1/quotes?select=*', { token: B }); assert.deepEqual(r.data, []);
r = await call('PATCH', `/rest/v1/quotes?id=eq.${(await call('GET', '/rest/v1/quotes?select=*', { token: A })).data[0].id}`, { token: B, body: { note: 'hack' }, prefer: 'return=representation' });
assert.deepEqual(r.data, []);
r = await call('DELETE', `/rest/v1/sources?id=eq.${srcA.id}`, { token: B, prefer: 'return=representation' }); assert.deepEqual(r.data, []);
// B, A adına satır ekleyemez
r = await call('POST', '/rest/v1/quotes', { token: B, body: { user_id: a.user.id, text: 'sahte' } }); assert.equal(r.status, 403);
// Oturumsuz (anon) erişim yok
r = await call('GET', '/rest/v1/quotes?select=*'); assert.ok(r.status >= 400, 'anon select engellenmeli');
r = await call('POST', '/rest/v1/quotes', { body: { text: 'anon' } }); assert.ok(r.status >= 400);

// Token ile yakalama
const token = crypto.randomBytes(32).toString('hex');
const hash = crypto.createHash('sha256').update(token).digest('hex');
r = await call('POST', '/rest/v1/api_tokens', { token: A, body: { token_hash: hash, label: 'test' } }); assert.equal(r.status, 201);
r = await call('POST', '/rest/v1/rpc/token_status', { body: { p_token: token } }); assert.equal(r.data.ok, true); assert.equal(r.data.quotes, 3);
r = await call('POST', '/rest/v1/rpc/token_status', { body: { p_token: 'x'.repeat(64) } }); assert.equal(r.status, 403);
// B, A'nın token özetini göremez
r = await call('GET', '/rest/v1/api_tokens?select=*', { token: B }); assert.deepEqual(r.data, []);

// Web sayfasından yakalama: kaynak adresle oluşturulur, ikinci alıntı aynı kaynağa gider
const page = { url: 'https://example.com/yazi', title: 'Bir Yazı', kind: 'web', origin: 'extension' };
r = await call('POST', '/rest/v1/rpc/capture', { body: { p_token: token, p_payload: { ...page, text: 'web alıntısı', tags: ['yöntem'] } } });
assert.equal(r.status, 200); assert.equal(r.data.duplicate, false); const webSrc = r.data.source_id;
r = await call('POST', '/rest/v1/rpc/capture', { body: { p_token: token, p_payload: { ...page, text: 'ikinci web alıntısı' } } });
assert.equal(r.data.source_id, webSrc);
// Aynı seçim iki kez: yinelenmez
r = await call('POST', '/rest/v1/rpc/capture', { body: { p_token: token, p_payload: { ...page, text: 'ikinci web alıntısı' } } });
assert.equal(r.data.duplicate, true);
// Boş metin reddedilir
r = await call('POST', '/rest/v1/rpc/capture', { body: { p_token: token, p_payload: { ...page, text: '  ' } } }); assert.equal(r.status, 400);

// Mac kısayolu: dosya adıyla, içe aktarılmış PDF kaynağına bağlanır
await call('PATCH', `/rest/v1/sources?id=eq.${srcA.id}`, { token: A, body: { file_name: 'Kitap A.pdf' } });
r = await call('POST', '/rest/v1/rpc/capture', { body: { p_token: token, p_payload: { text: 'preview seçimi', file_name: 'kitap a.pdf', kind: 'pdf', origin: 'shortcut' } } });
assert.equal(r.data.source_id, srcA.id);
// Kaynaksız not
r = await call('POST', '/rest/v1/rpc/capture', { body: { p_token: token, p_payload: { note: 'sadece not' } } });
assert.equal(r.data.source_id, null);

// Sayfaya ait alıntılar, güncelleme, silme
r = await call('POST', '/rest/v1/rpc/quotes_for_url', { body: { p_token: token, p_url: page.url } });
assert.equal(r.data.length, 2); assert.deepEqual(r.data[0].tags, ['yöntem']);
const qid = r.data[0].id;
r = await call('POST', '/rest/v1/rpc/token_update_quote', { body: { p_token: token, p_id: qid, p_patch: { note: 'yorumum', tags: ['a', 'b'] } } }); assert.equal(r.data.updated, 1);
r = await call('GET', `/rest/v1/quotes?select=*&id=eq.${qid}`, { token: A }); assert.equal(r.data[0].note, 'yorumum'); assert.deepEqual(r.data[0].tags, ['a', 'b']);
r = await call('POST', '/rest/v1/rpc/token_delete_quote', { body: { p_token: token, p_id: qid } }); assert.equal(r.data.deleted, 1);

// İç fonksiyon dışarıdan çağrılamaz
r = await call('POST', '/rest/v1/rpc/derkenar_token_user', { body: { p_token: token } }); assert.equal(r.status, 403);
r = await call('POST', '/rest/v1/rpc/derkenar_token_user', { token: A, body: { p_token: token } }); assert.equal(r.status, 403);

// Kaynak silinince alıntıları da silinir
r = await call('DELETE', `/rest/v1/sources?id=eq.${srcA.id}`, { token: A, prefer: 'return=representation' }); assert.equal(r.data.length, 1);
r = await call('GET', `/rest/v1/quotes?select=*&source_id=eq.${srcA.id}`, { token: A }); assert.deepEqual(r.data, []);

console.log('SQL testleri geçti');
await shim.close(); process.exit(0);
