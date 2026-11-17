// Uygulama durumu: tüm kaynaklar, alıntılar ve projeler bellekte tutulur;
// arama ve süzme istemci tarafında yapılır. Kalıcılık sürücüye (yerel/bulut) aittir.
import { signal, computed } from '@preact/signals';
import { createLocalDriver } from './drivers/local.js';
import { createCloudDriver } from './drivers/cloud.js';
import { idbAll } from './lib/idb.js';
import { uuid, nowIso, deviceName } from './lib/util.js';

export const phase = signal('boot'); // boot | auth | ready
export const mode = signal('local'); // local | cloud
export const cloudConfig = signal(null); // {url, key} ya da null
export const user = signal(null);
export const sources = signal([]);
export const quotes = signal([]);
export const projects = signal([]);
export const busy = signal(false);
export const toast = signal(null);
export const localLeftover = signal(0); // buluta geçince bu cihazda kalan alıntı sayısı

export const sourceById = computed(() => new Map(sources.value.map((s) => [s.id, s])));
export const projectById = computed(() => new Map(projects.value.map((p) => [p.id, p])));
export const quotesBySource = computed(() => {
  const map = new Map();
  for (const q of quotes.value) {
    const key = q.source_id || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(q);
  }
  return map;
});
export const allTags = computed(() => {
  const counts = new Map();
  for (const q of quotes.value) for (const t of q.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr'));
});

let driver = null;
let toastTimer;

export function notify(message, kind = 'info') {
  clearTimeout(toastTimer);
  toast.value = { message, kind };
  toastTimer = setTimeout(() => { toast.value = null; }, kind === 'error' ? 7000 : 3500);
}

export const getDriver = () => driver;

async function readCloudConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('derkenar.cloud') || 'null');
    if (saved?.url && saved?.key) return saved;
  } catch { /* yok say */ }
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.supabaseUrl && cfg.supabaseKey) return { url: cfg.supabaseUrl, key: cfg.supabaseKey };
    }
  } catch { /* yapılandırma yoksa yerel kip */ }
  return null;
}

export async function init() {
  cloudConfig.value = await readCloudConfig();
  if (cloudConfig.value) {
    const cloud = createCloudDriver(cloudConfig.value);
    let session = null;
    try { session = await cloud.session(); } catch { /* ağ yoksa oturumsuz say */ }
    if (session) return enterCloud(cloud, session);
    if (localStorage.getItem('derkenar.mode') !== 'local') {
      driver = cloud;
      phase.value = 'auth';
      return;
    }
  }
  await enterLocal();
}

export async function enterLocal() {
  driver = createLocalDriver();
  mode.value = 'local';
  user.value = null;
  localStorage.setItem('derkenar.mode', 'local');
  await refresh();
  phase.value = 'ready';
}

async function enterCloud(cloud, session) {
  driver = cloud;
  mode.value = 'cloud';
  user.value = session.user;
  localStorage.setItem('derkenar.mode', 'cloud');
  await refresh();
  try { localLeftover.value = (await idbAll('quotes')).length; } catch { localLeftover.value = 0; }
  phase.value = 'ready';
}

export async function signIn(email, password, isNew) {
  const cloud = driver?.kind === 'cloud' ? driver : createCloudDriver(cloudConfig.value);
  const session = isNew ? await cloud.signUp(email, password) : await cloud.signIn(email, password);
  if (!session) return false; // e-posta onayı bekleniyor
  await enterCloud(cloud, session);
  return true;
}

export async function signOut() {
  if (driver?.kind === 'cloud') await driver.signOut();
  sources.value = []; quotes.value = []; projects.value = [];
  user.value = null;
  localStorage.removeItem('derkenar.mode');
  driver = createCloudDriver(cloudConfig.value);
  phase.value = 'auth';
}

export function showAuth() {
  driver = createCloudDriver(cloudConfig.value);
  phase.value = 'auth';
}

export function saveCloudConfig(url, key) {
  if (url && key) localStorage.setItem('derkenar.cloud', JSON.stringify({ url: url.replace(/\/+$/, ''), key }));
  else localStorage.removeItem('derkenar.cloud');
  localStorage.removeItem('derkenar.mode');
  location.reload();
}

let refreshing = null;
export function refresh() {
  refreshing ||= (async () => {
    try {
      const [s, q, p] = await Promise.all([driver.all('sources'), driver.all('quotes'), driver.all('projects')]);
      sources.value = s; quotes.value = q; projects.value = p;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

// Bu cihazdaki (hesapsız) verileri buluta taşır; kimlikler korunur.
export async function migrateLocalToCloud() {
  const local = createLocalDriver();
  const [s, q, p] = await Promise.all([local.all('sources'), local.all('quotes'), local.all('projects')]);
  const knownFp = new Map(sources.value.filter((x) => x.fingerprint).map((x) => [x.fingerprint, x.id]));
  const remap = new Map();
  const newSources = [];
  for (const src of s) {
    if (src.fingerprint && knownFp.has(src.fingerprint)) remap.set(src.id, knownFp.get(src.fingerprint));
    else newSources.push(src);
  }
  if (newSources.length) await driver.insert('sources', newSources);
  if (p.length) await driver.insert('projects', p);
  const rows = q.map((x) => ({ ...x, source_id: remap.get(x.source_id) || x.source_id }));
  const inserted = rows.length ? await driver.insert('quotes', rows) : [];
  await local.clear();
  localLeftover.value = 0;
  await refresh();
  return inserted.length;
}

// ---------------------------------------------------------------------------
// Kayıt oluşturma: bütün sütunlar doldurulur ki toplu eklemede varsayılanlar sorun çıkarmasın.

function makeSource(data) {
  const now = nowIso();
  return {
    id: uuid(), kind: data.kind || 'other', title: data.title || '', author: data.author || '',
    year: data.year || '', container: data.container || '', url: data.url || '',
    file_name: data.file_name || '', fingerprint: data.fingerprint || null,
    created_at: now, updated_at: now,
  };
}

function makeQuote(data) {
  const now = data.created_at || nowIso();
  return {
    id: uuid(), source_id: data.source_id || null, text: data.text || '', note: data.note || '',
    page: data.page ? String(data.page) : '', color: data.color || '', tags: data.tags || [],
    project_ids: data.project_ids || [], origin: data.origin || 'manual', device: deviceName(),
    fingerprint: data.fingerprint || null, created_at: now, updated_at: nowIso(),
  };
}

// Aynı parmak izine, dosya adına ya da adrese sahip kaynak varsa onu döndürür; yoksa oluşturur.
export async function ensureSource(data) {
  const list = sources.value;
  const lower = (v) => (v || '').toLowerCase();
  const found = (data.fingerprint && list.find((s) => s.fingerprint === data.fingerprint))
    || (data.file_name && list.find((s) => s.file_name && lower(s.file_name) === lower(data.file_name)))
    || (data.url && list.find((s) => s.url === data.url));
  if (found) {
    // Kısayolla (yalnızca dosya adıyla) oluşmuş kaynağı PDF kimliğiyle zenginleştir.
    if (data.fingerprint && found.fingerprint !== data.fingerprint && String(found.fingerprint || '').startsWith('file:')) {
      await updateSource(found.id, { fingerprint: data.fingerprint, kind: data.kind || found.kind });
    }
    return sourceById.value.get(found.id) || found;
  }
  const row = makeSource(data);
  const inserted = await driver.insert('sources', [row]);
  if (!inserted.length) {
    await refresh();
    return sources.value.find((s) => s.fingerprint === row.fingerprint) || row;
  }
  sources.value = [...sources.value, inserted[0]];
  return inserted[0];
}

// Parmak izi zaten kayıtlı olan alıntılar atlanır. Eklenen satırları döndürür.
export async function addQuotes(items) {
  const known = new Set(quotes.value.map((q) => q.fingerprint).filter(Boolean));
  const rows = [];
  for (const item of items) {
    if (item.fingerprint) {
      if (known.has(item.fingerprint)) continue;
      known.add(item.fingerprint);
    }
    rows.push(makeQuote(item));
  }
  if (!rows.length) return [];
  const inserted = await driver.insert('quotes', rows);
  quotes.value = [...quotes.value, ...inserted];
  return inserted;
}

export async function updateQuote(id, patch) {
  const next = await driver.update('quotes', id, { ...patch, updated_at: nowIso() });
  if (next) quotes.value = quotes.value.map((q) => (q.id === id ? next : q));
}

export async function deleteQuote(id) {
  await driver.remove('quotes', id);
  quotes.value = quotes.value.filter((q) => q.id !== id);
}

export async function updateSource(id, patch) {
  const next = await driver.update('sources', id, { ...patch, updated_at: nowIso() });
  if (next) sources.value = sources.value.map((s) => (s.id === id ? next : s));
}

export async function deleteSource(id) {
  await driver.remove('sources', id);
  sources.value = sources.value.filter((s) => s.id !== id);
  quotes.value = quotes.value.filter((q) => q.source_id !== id);
}

export async function addProject(name) {
  const row = { id: uuid(), name: name.trim(), created_at: nowIso() };
  const inserted = await driver.insert('projects', [row]);
  projects.value = [...projects.value, inserted[0] || row];
  return inserted[0] || row;
}

export async function deleteProject(id) {
  const affected = quotes.value.filter((q) => (q.project_ids || []).includes(id));
  for (const q of affected) await updateQuote(q.id, { project_ids: q.project_ids.filter((p) => p !== id) });
  await driver.remove('projects', id);
  projects.value = projects.value.filter((p) => p.id !== id);
}

export async function toggleProject(quote, projectId) {
  const has = (quote.project_ids || []).includes(projectId);
  const project_ids = has ? quote.project_ids.filter((p) => p !== projectId) : [...(quote.project_ids || []), projectId];
  await updateQuote(quote.id, { project_ids });
}

// Yedek: tüm veriyi tek JSON olarak ver / geri yükle.
export function exportBackup() {
  return JSON.stringify({ app: 'derkenar', version: 1, exported_at: nowIso(), sources: sources.value, quotes: quotes.value, projects: projects.value }, null, 2);
}

export async function importBackup(json) {
  const data = JSON.parse(json);
  if (data.app !== 'derkenar') throw new Error('Bu dosya bir Derkenar yedeği değil');
  const strip = ({ user_id, ...rest }) => rest;
  const haveS = new Set(sources.value.map((s) => s.id));
  const haveFp = new Map(sources.value.filter((s) => s.fingerprint).map((s) => [s.fingerprint, s.id]));
  const remap = new Map();
  const newS = [];
  for (const s of (data.sources || []).map(strip)) {
    if (haveS.has(s.id)) continue;
    if (s.fingerprint && haveFp.has(s.fingerprint)) { remap.set(s.id, haveFp.get(s.fingerprint)); continue; }
    newS.push(s);
  }
  const haveP = new Set(projects.value.map((p) => p.id));
  const newP = (data.projects || []).map(strip).filter((p) => !haveP.has(p.id));
  const haveQ = new Set(quotes.value.map((q) => q.id));
  const haveQfp = new Set(quotes.value.map((q) => q.fingerprint).filter(Boolean));
  const newQ = (data.quotes || []).map(strip)
    .filter((q) => !haveQ.has(q.id) && !(q.fingerprint && haveQfp.has(q.fingerprint)))
    .map((q) => ({ ...q, source_id: remap.get(q.source_id) || q.source_id }));
  if (newS.length) await driver.insert('sources', newS);
  if (newP.length) await driver.insert('projects', newP);
  const inserted = newQ.length ? await driver.insert('quotes', newQ) : [];
  await refresh();
  return inserted.length;
}
