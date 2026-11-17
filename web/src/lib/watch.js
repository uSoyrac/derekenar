// Klasör izleme: seçilen klasördeki PDF'ler değiştikçe çizimleri kendiliğinden içe alır.
// Tarayıcının Dosya Sistemi Erişimi API'sini kullanır (masaüstü Chrome / Edge).
// Uygulama açıkken çalışır; klasör izni ve tarama durumu bu cihazda saklanır.
import { signal } from '@preact/signals';
import { kvGet, kvSet } from './idb.js';
import { importPdfFile } from './importer.js';

export const watchSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
export const watch = signal({ state: 'off', name: '', lastScan: null, lastResult: null, progress: null });
// state: off | needs-permission | idle | scanning

const HANDLE = 'watch.handle';
const SEEN = 'watch.seen';
const INTERVAL = 60_000;
const MAX_FILES = 3000;

let handle = null;
let timer = null;
let running = false;

const set = (patch) => { watch.value = { ...watch.value, ...patch }; };

async function* walk(dir, prefix = '', depth = 0) {
  for await (const [name, entry] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (entry.kind === 'file') {
      if (/\.pdf$/i.test(name)) yield { path: prefix + name, entry };
    } else if (depth < 6) {
      yield* walk(entry, `${prefix}${name}/`, depth + 1);
    }
  }
}

export async function initWatch() {
  if (!watchSupported) return;
  handle = (await kvGet(HANDLE)) || null;
  if (!handle) return;
  set({ name: handle.name });
  const perm = await handle.queryPermission({ mode: 'read' });
  if (perm === 'granted') { start(); scanNow(); } // açılışta bir kez hemen tara
  else set({ state: 'needs-permission' });
}

export async function chooseFolder() {
  const picked = await window.showDirectoryPicker({ id: 'derkenar', mode: 'read' });
  await useFolder(picked);
}

// Testlerde ve klasör seçiminden sonra ortak yol.
export async function useFolder(dirHandle) {
  handle = dirHandle;
  await kvSet(HANDLE, handle);
  await kvSet(SEEN, {});
  set({ name: handle.name, lastResult: null });
  start();
  return scanNow();
}

export async function regrant() {
  if (!handle) return;
  const perm = await handle.requestPermission({ mode: 'read' });
  if (perm === 'granted') { start(); await scanNow(); }
}

export async function stopWatch() {
  clearInterval(timer); timer = null; handle = null;
  await kvSet(HANDLE, undefined);
  await kvSet(SEEN, undefined);
  set({ state: 'off', name: '', lastScan: null, lastResult: null, progress: null });
}

// Tarama, pencere arkada ya da simge durumundayken de sürer: Preview'da okurken
// Derkenar'a dönmek gerekmez. (Tarayıcı arka plan sekmelerinde zamanlayıcıyı dakikada bire indirir; yeterli.)
let listening = false;
function start() {
  set({ state: 'idle' });
  clearInterval(timer);
  timer = setInterval(scanNow, INTERVAL);
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scanNow(); });
    window.addEventListener('focus', () => scanNow());
  }
}

export async function scanNow() {
  if (!handle || running) return null;
  running = true;
  set({ state: 'scanning', progress: null });
  const result = { files: 0, changed: 0, added: 0, errors: 0 };
  try {
    const seen = (await kvGet(SEEN)) || {};
    const next = {};
    for await (const { path, entry } of walk(handle)) {
      if (++result.files > MAX_FILES) break;
      let file;
      try { file = await entry.getFile(); } catch { continue; }
      const stamp = `${file.lastModified}:${file.size}`;
      if (seen[path] === stamp) { next[path] = stamp; continue; }
      result.changed++;
      set({ progress: path });
      const res = await importPdfFile(file, { fileName: entry.name });
      if (res.error) result.errors++;
      next[path] = stamp; // yazımı süren dosyanın boyutu/tarihi değişeceği için yeniden denenir
      result.added += res.added;
      await kvSet(SEEN, { ...seen, ...next });
    }
    await kvSet(SEEN, next);
    set({ state: 'idle', lastScan: new Date().toISOString(), lastResult: result, progress: null });
    return result;
  } catch (err) {
    console.warn('Klasör taraması başarısız', err);
    const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
    set({ state: denied ? 'needs-permission' : 'idle', progress: null });
    return null;
  } finally {
    running = false;
  }
}
