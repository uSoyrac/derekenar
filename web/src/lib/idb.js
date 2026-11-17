// Küçük IndexedDB yardımcıları. İki veritabanı var:
//  - derkenar-data:   hesapsız kullanımda alıntıların kendisi
//  - derkenar-device: bu cihaza özgü ayarlar (izlenen klasör, tarama durumu)

function open(name, stores, version = 1) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      for (const s of stores) {
        if (!req.result.objectStoreNames.contains(s.name)) req.result.createObjectStore(s.name, s.options);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

let dataDb;
let deviceDb;

export const TABLES = ['sources', 'quotes', 'projects', 'settings'];

export function dataStore() {
  dataDb ||= open('derkenar-data', TABLES.map((name) => ({ name, options: { keyPath: 'id' } })), 2);
  return dataDb;
}

export async function idbAll(table) {
  const db = await dataStore();
  return wrap(db.transaction(table).objectStore(table).getAll());
}

export async function idbPut(table, rows) {
  const db = await dataStore();
  const tx = db.transaction(table, 'readwrite');
  for (const row of rows) tx.objectStore(table).put(row);
  await done(tx);
}

export async function idbDelete(table, ids) {
  const db = await dataStore();
  const tx = db.transaction(table, 'readwrite');
  for (const id of ids) tx.objectStore(table).delete(id);
  await done(tx);
}

export async function idbClear() {
  const db = await dataStore();
  const tx = db.transaction(TABLES, 'readwrite');
  for (const t of TABLES) tx.objectStore(t).clear();
  await done(tx);
}

function device() {
  deviceDb ||= open('derkenar-device', [{ name: 'kv' }]);
  return deviceDb;
}

export async function kvGet(key) {
  const db = await device();
  return wrap(db.transaction('kv').objectStore('kv').get(key));
}

export async function kvSet(key, value) {
  const db = await device();
  const tx = db.transaction('kv', 'readwrite');
  if (value === undefined) tx.objectStore('kv').delete(key);
  else tx.objectStore('kv').put(value, key);
  await done(tx);
}
