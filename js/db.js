export const __v = '1.1.11-20261023-3d362bf4';
// Small IndexedDB wrapper. Stores:
//   jobs    (job_id)  job record: token, session, summary, prefill, status, revs, read_only, ...
//   drafts  (job_id)  form state as entered on this device (+ local_rev)
//   files   (id)      photos / signatures as Blobs, with upload status; index job_id
//   outbox  (job_id)  queued submission (client_submission_id + payload) and its status
//   kv      (k)       misc settings (install skipped, device id, ...)
// Falls back to memory when IndexedDB is not available (private mode); the app then warns.
const DB_NAME = 'gbqs-forms';
const DB_VERSION = 1;
let dbp = null;
export let memoryOnly = false;
const mem = { jobs: new Map(), drafts: new Map(), files: new Map(), outbox: new Map(), kv: new Map() };
const KEYS = { jobs: 'job_id', drafts: 'job_id', files: 'id', outbox: 'job_id', kv: 'k' };

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { memoryOnly = true; resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'job_id' });
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'job_id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' }).createIndex('job_id', 'job_id');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'job_id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { memoryOnly = true; resolve(null); };
    req.onblocked = () => { /* another tab holds an old version; wait */ };
  });
  return dbp;
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; }, reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function get(store, key) {
  return tx(store, 'readonly', (s) => (s ? wrap(s.get(key)) : structuredCloneSafe(mem[store].get(key))));
}
export async function put(store, value) {
  return tx(store, 'readwrite', (s) => (s ? wrap(s.put(value)) : (mem[store].set(value[KEYS[store]], structuredCloneSafe(value)), value[KEYS[store]])));
}
export async function del(store, key) {
  return tx(store, 'readwrite', (s) => (s ? wrap(s.delete(key)) : mem[store].delete(key)));
}
export async function all(store) {
  return tx(store, 'readonly', (s) => (s ? wrap(s.getAll()) : [...mem[store].values()].map(structuredCloneSafe)));
}
export async function byIndex(store, index, value) {
  return tx(store, 'readonly', (s) => (s ? wrap(s.index(index).getAll(value)) : [...mem[store].values()].filter((v) => v[index] === value).map(structuredCloneSafe)));
}
/** read-modify-write in one call; fn receives the current value (or undefined) and returns the new one */
export async function update(store, key, fn) {
  const cur = await get(store, key);
  const next = await fn(cur);
  if (next !== undefined) await put(store, next);
  return next;
}
export async function kvGet(k, dflt = null) { const r = await get('kv', k); return r ? r.v : dflt; }
export async function kvSet(k, v) { return put('kv', { k, v }); }

function structuredCloneSafe(v) {
  if (v == null) return v;
  try { return structuredClone(v); } catch { return v; }
}

export async function ready() { await open(); return !memoryOnly; }
