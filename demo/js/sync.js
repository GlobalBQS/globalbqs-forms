export const __v = '1.1.10-20261023-39e8b4ad';
// Sync engine: draft push (debounced, with rev), file uploads (register -> PUT -> confirm) and the outbox
// (files first, then submit; idempotent client ids; retry with backoff). Emits events on `bus`.
import * as db from './db.js?v=1.1.10-20261023-39e8b4ad';
import { call, putFile, ApiError } from './api.js?v=1.1.10-20261023-39e8b4ad';

export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

const BACKOFF = [5, 15, 30, 60, 120, 300, 600]; // seconds
const nextDelay = (n) => BACKOFF[Math.min(n, BACKOFF.length - 1)] * 1000;
const READ_ONLY_CODES = { revoked: 'taken_over', not_active_device: 'not_active_device', job_closed: 'job_closed', cancelled: 'cancelled' };

export const online = () => navigator.onLine !== false;

/** Mark a job read-only after the server said so (revoked / not active / closed). */
export async function markReadOnly(jobId, code, data = {}) {
  const reason = code === 'revoked' ? (data.reason || 'taken_over') : (READ_ONLY_CODES[code] || code);
  const job = await db.update('jobs', jobId, (j) => (j ? { ...j, read_only: true, read_only_reason: reason } : undefined));
  emit('readonly', { jobId, reason, job });
  return job;
}

async function handleAuthError(jobId, e) {
  if (!(e instanceof ApiError)) return false;
  if (READ_ONLY_CODES[e.code]) { await markReadOnly(jobId, e.code, e.data); return true; }
  if (e.code === 'invalid_session' || e.code === 'missing_token') {
    await db.update('jobs', jobId, (j) => (j ? { ...j, session: null, needs_sign_in: true } : undefined));
    emit('signin', { jobId });
    return true;
  }
  return false;
}

// ---------- local draft ----------
export async function saveLocal(jobId, state) {
  const cur = await db.get('drafts', jobId);
  const rec = { job_id: jobId, state, local_rev: (cur?.local_rev || 0) + 1, saved_at: new Date().toISOString() };
  await db.put('drafts', rec);
  schedulePush(jobId);
  return rec;
}

// ---------- server draft -> device ----------
// Number of filled-in values in a draft state (same rule as gbqs_form_state_filled on the server): order data from
// the prefill, ui, meta, start check, audit and signatures do not count.
const NOT_COUNTED = new Set(['order', 'ui', 'meta', 'gate', 'audit', 'form_key', 'v', 'VT', 'ts', 'final', 'sig', 'smode', 'vno']);
export function filledCount(state) {
  let n = 0;
  const walk = (x) => {
    if (x == null) return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (typeof x === 'object') { Object.values(x).forEach(walk); return; }
    if (x === '' || x === false) return;
    n++;
  };
  if (state && typeof state === 'object') for (const [k, v] of Object.entries(state)) if (!NOT_COUNTED.has(k)) walk(v);
  return n;
}
const REOPEN_RE = /Reopened by GlobalBQS/;
const hasReopen = (st) => !!(st && Array.isArray(st.audit) && st.audit.some((a) => REOPEN_RE.test(a.reason || '')));
/** clearly less filled in than the other state (e.g. an empty form against a filled-in one) */
export const muchEmptier = (a, b) => { const fa = filledCount(a), fb = filledCount(b); return fb - fa >= 10 && fa * 2 < fb; };

/** Adopt the server draft (mutates `job`, stores the draft; the caller stores the job). Rules:
 *  - no local draft -> take the server's;
 *  - a job reopened for correction: the seed (previous entries) wins over a local copy without it;
 *  - server rev newer: take it unless this device has unpushed changes; with unpushed changes take it anyway
 *    when the local copy is less filled in, otherwise ask (pending_stale);
 *  - never keep a clearly emptier local copy when the server has a filled-in draft of the same or newer rev.
 *  A replaced local copy is kept as a backup (kv draft_backup:<job>). Returns true when adopted. */
export async function adoptServerDraft(job, draft) {
  const id = job.job_id;
  const local = await db.get('drafts', id);
  job.foreign_draft = false;
  if (draft && draft.payload && draft.payload.state) {
    const serverRev = draft.rev || 0, st = draft.payload.state, known = job.server_rev || 0;
    const take = async () => {
      if (local && local.state) { try { await db.kvSet('draft_backup:' + id, { saved_at: new Date().toISOString(), server_rev: known, local }); } catch { /* */ } }
      const lr = (local?.local_rev || 0) + 1;
      await db.put('drafts', { job_id: id, state: st, local_rev: lr, saved_at: draft.saved_at || new Date().toISOString() });
      job.server_rev = serverRev; job.pushed_local_rev = lr; job.pending_stale = null;
      emit('adopted', { jobId: id, rev: serverRev });
      return true;
    };
    if (!local || !local.state) return take();
    if (draft.payload.reopened_from && hasReopen(st) && !hasReopen(local.state)) return take();
    if (serverRev >= known && muchEmptier(local.state, st)) return take();
    if (serverRev > known) {
      const unpushed = local.local_rev !== job.pushed_local_rev;
      if (!unpushed || filledCount(local.state) < filledCount(st)) return take();
      job.pending_stale = { rev: serverRev, saved_at: draft.saved_at, payload: draft.payload };
    }
    return false;
  }
  if (draft && draft.payload) {
    // previous-format draft on the server: keep the rev for later pushes, but do not push an empty form over it
    job.server_rev = Math.max(job.server_rev || 0, draft.rev || 0);
    job.foreign_draft = true;
  }
  return false;
}

/** Fetch the server draft and adopt it when it is newer / fuller (job open, form open, app back in front). */
export function pullServerDraft(jobId) {
  return exclusive('draft:' + jobId, async () => {
    const job = await db.get('jobs', jobId);
    if (!job || !job.session || job.read_only || !online()) return { skipped: true };
    if (['queued', 'submitted'].includes(job.status)) return { skipped: true };
    let r;
    try { r = await call('/draft', { session: job.session }); } catch (e) { await handleAuthError(jobId, e); return { error: e.code }; }
    if (!r || !r.payload) return { none: true };
    const cur = await db.get('jobs', jobId);
    const adopted = await adoptServerDraft(cur, { rev: r.rev, saved_at: r.saved_at, payload: r.payload });
    await db.put('jobs', cur);
    return { adopted, pending: !!cur.pending_stale };
  });
}

// ---------- draft push ----------
const timers = new Map();
const running = new Map();
export function schedulePush(jobId, delay = 2500) {
  clearTimeout(timers.get(jobId));
  timers.set(jobId, setTimeout(() => pushDraft(jobId).catch(() => {}), delay));
}

/** one runner per job */
function exclusive(key, fn) {
  const prev = running.get(key) || Promise.resolve();
  const p = prev.catch(() => {}).then(fn);
  running.set(key, p.finally(() => { if (running.get(key) === p) running.delete(key); }));
  return p;
}

export function pushDraft(jobId, { force = false, allowShrink = false } = {}) {
  return exclusive('draft:' + jobId, async () => {
    const job = await db.get('jobs', jobId);
    if (!job || !job.session || job.read_only || !online()) return { skipped: true };
    if (['queued', 'submitted'].includes(job.status)) return { skipped: true };
    const draft = await db.get('drafts', jobId);
    if (!draft) return { skipped: true };
    if (!force && draft.local_rev === job.pushed_local_rev) return { skipped: true, upToDate: true };
    // never overwrite a server draft of another format (e.g. the previous submission) with a form not started yet
    if (job.foreign_draft && !(draft.state && draft.state.gate && draft.state.gate.done)) return { skipped: true, foreign: true };
    try {
      const r = await call('/draft', { method: 'POST', session: job.session, body: { rev: job.server_rev || 0, payload: { format: 'gbqs.forms.draft/1', form_key: job.form_key, form_version: job.form_version, saved_at: draft.saved_at, state: draft.state, ...(allowShrink ? { allow_shrink: true } : {}) } } });
      const j2 = await db.update('jobs', jobId, (j) => ({ ...j, server_rev: r.rev, pushed_local_rev: draft.local_rev, synced_at: new Date().toISOString(), status: j.status === 'new' ? 'in_progress' : j.status }));
      emit('synced', { jobId, job: j2 });
      return { ok: true, rev: r.rev };
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale') {
        let server = null;
        try { server = await call('/draft', { session: job.session }); } catch (e2) { if (await handleAuthError(jobId, e2)) return { error: e2.code }; }
        // the server has a fuller version (e.g. a job reopened with the previous entries): take it, keep ours as backup
        if (server && server.payload && server.payload.state) {
          const cur = await db.get('jobs', jobId);
          const adopted = await adoptServerDraft(cur, { rev: server.rev, saved_at: server.saved_at, payload: server.payload });
          await db.put('jobs', cur); // adopted, or pending_stale kept so the question is asked when the form opens
          if (adopted) return { adopted: true };
        }
        emit('stale', { jobId, serverRev: e.data.server_rev, server });
        return { stale: true };
      }
      if (await handleAuthError(jobId, e)) return { error: e.code };
      if (e instanceof ApiError && e.retryable) schedulePush(jobId, nextDelay(1));
      emit('syncerror', { jobId, code: e.code });
      return { error: e.code };
    }
  });
}

/** Load the version saved on GlobalBQS on this device, whatever is here (the local copy is kept as a backup).
 *  Used by the "Load saved version from GlobalBQS" button. */
export async function forceServerDraft(jobId) {
  return exclusive('draft:' + jobId, async () => {
    const job = await db.get('jobs', jobId);
    if (!job || !job.session) throw new ApiError('invalid_session', 0);
    const r = await call('/draft', { session: job.session });
    if (!r || !r.payload || !r.payload.state) return { none: true };
    const local = await db.get('drafts', jobId);
    if (local && local.state) { try { await db.kvSet('draft_backup:' + jobId, { saved_at: new Date().toISOString(), server_rev: job.server_rev || 0, local, reason: 'manual' }); } catch { /* */ } }
    const lr = (local?.local_rev || 0) + 1;
    await db.put('drafts', { job_id: jobId, state: r.payload.state, local_rev: lr, saved_at: r.saved_at || new Date().toISOString() });
    await db.update('jobs', jobId, (j) => ({ ...j, server_rev: r.rev, pushed_local_rev: lr, pending_stale: null, foreign_draft: false, synced_at: new Date().toISOString() }));
    emit('adopted', { jobId, rev: r.rev });
    return { loaded: true, rev: r.rev };
  });
}

/** Stale resolution: "keep mine" -> overwrite server (build on server rev); "use server" -> replace local state. */
export async function resolveStale(jobId, choice, server) {
  await db.update('jobs', jobId, (j) => (j ? { ...j, pending_stale: null } : j));
  if (choice === 'mine') {
    await db.update('jobs', jobId, (j) => ({ ...j, server_rev: server?.rev ?? j.server_rev }));
    return pushDraft(jobId, { force: true, allowShrink: true });
  }
  const state = server?.payload?.state;
  if (state) {
    const cur = await db.get('drafts', jobId);
    const rec = { job_id: jobId, state, local_rev: (cur?.local_rev || 0) + 1, saved_at: server.saved_at || new Date().toISOString() };
    await db.put('drafts', rec);
    await db.update('jobs', jobId, (j) => ({ ...j, server_rev: server.rev, pushed_local_rev: rec.local_rev, synced_at: new Date().toISOString() }));
  }
  return { replaced: !!state };
}

// ---------- files ----------
export async function addFile(rec) {
  const r = { status: 'pending', attempts: 0, created_at: new Date().toISOString(), ...rec };
  await db.put('files', r);
  emit('files', { jobId: r.job_id });
  if (online()) uploadFiles(r.job_id).catch(() => {});
  return r;
}

// iOS Safari/WebKit can return Blobs from IndexedDB that can no longer be read ("WebKitBlobResource error",
// fetch fails with "Load failed" before the request is sent). Since 1.1.6 files are stored as ArrayBuffer
// bytes; old records with a Blob are read first, and a signature that cannot be read is re-drawn from the
// strokes in the draft (regenerator hook set by the app).
let regenerate = null;
export function setRegenerator(fn) { regenerate = fn; }
class FileUnreadable extends Error {}
async function readBytes(f) {
  if (f.bytes && f.bytes.byteLength) return f.bytes;
  if (f.blob) {
    try { const b = await f.blob.arrayBuffer(); if (b && b.byteLength) return b; } catch { /* unreadable blob */ }
  }
  throw new FileUnreadable(f.id);
}
async function bytesFor(f) {
  try { return await readBytes(f); } catch (e) {
    if (!(e instanceof FileUnreadable)) throw e;
    if (regenerate) {
      const b = await regenerate(f);
      if (b && b.byteLength) { await db.put('files', { ...f, bytes: b, blob: null, size: b.byteLength, regenerated: true }); return b; }
    }
    throw e;
  }
}

async function uploadOne(job, f) {
  const bytes = await bytesFor(f); // read before registering: an unreadable file is detected here, not as a network error
  const reg = await call('/file', {
    method: 'POST', session: job.session,
    body: { client_file_id: f.id, kind: f.kind, section: f.section || null, mime: f.mime, size_bytes: bytes.byteLength, taken_at: f.taken_at || null },
  });
  if (!reg.already_uploaded) {
    await db.put('files', { ...(await db.get('files', f.id)), status: 'uploading', storage_path: reg.storage_path });
    emit('files', { jobId: job.job_id });
    const type = reg.upload.content_type || f.mime;
    await putFile(reg.upload.url, new Blob([bytes], { type }), type);
  }
  await call('/file/confirm', { method: 'POST', session: job.session, body: { client_file_id: f.id } });
  const cur = await db.get('files', f.id);
  await db.put('files', { ...cur, status: 'uploaded', storage_path: reg.storage_path, uploaded_at: new Date().toISOString(), error: null, error_text: null });
  emit('files', { jobId: job.job_id });
}

/** Upload pending files of a job (optionally only the given ids). Resolves true when all of them are uploaded
 *  (or permanently lost: unreadable photos do not block the submission; the server keeps a placeholder). */
export function uploadFiles(jobId, onlyIds = null) {
  return exclusive('files:' + jobId, async () => {
    const job = await db.get('jobs', jobId);
    if (!job || !job.session || job.read_only) return false;
    const files = (await db.byIndex('files', 'job_id', jobId)).filter((f) => !onlyIds || onlyIds.includes(f.id));
    let allDone = true;
    for (const f of files) {
      if (f.status === 'uploaded' || f.status === 'lost') continue;
      if (f.removed && !(onlyIds && onlyIds.includes(f.id))) continue;
      if (!online()) { allDone = false; break; }
      if (f.next_at && Date.now() < f.next_at && !onlyIds) { allDone = false; continue; }
      try { await uploadOne(job, f); } catch (e) {
        if (await handleAuthError(jobId, e)) return false;
        const cur = (await db.get('files', f.id)) || f;
        if (e instanceof FileUnreadable) {
          // a photo that this device can no longer read: do not block the survey; ops sees a placeholder
          await db.put('files', { ...cur, status: 'lost', error: 'unreadable', error_text: 'This file could not be read on this device and was not sent.' });
          emit('files', { jobId });
          continue;
        }
        allDone = false;
        const attempts = (cur.attempts || 0) + 1;
        const code = e instanceof ApiError ? e.code : 'error';
        const text = code === 'offline' ? (online() ? 'Upload failed (connection or storage error).' : 'No connection.') : (e.message || code);
        await db.put('files', { ...cur, status: 'error', attempts, error: code, error_text: text, next_at: Date.now() + nextDelay(attempts - 1) });
        emit('files', { jobId });
        if (!online()) break; // really offline: stop; otherwise try the other files too
      }
    }
    return allDone;
  });
}

// ---------- outbox ----------
export async function enqueueSubmission(jobId, payload, fileIds) {
  const existing = await db.get('outbox', jobId);
  if (existing) return existing; // never create a second submission for the same job
  const rec = { job_id: jobId, client_submission_id: (crypto.randomUUID ? crypto.randomUUID() : 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)), payload, file_ids: fileIds, status: 'queued', attempts: 0, next_at: 0, created_at: new Date().toISOString() };
  await db.put('outbox', rec);
  await db.update('jobs', jobId, (j) => ({ ...j, status: 'queued' }));
  emit('outbox', { jobId });
  processOutbox(jobId).catch(() => {});
  return rec;
}

/** best effort: the last state (with signatures) is on the server before the submission, so a job reopened
 *  for correction starts from exactly what was submitted */
async function pushFinalDraft(jobId) {
  try {
    const job = await db.get('jobs', jobId), d = await db.get('drafts', jobId);
    if (!job || !d || !d.state || d.local_rev === job.pushed_local_rev) return;
    const r = await call('/draft', { method: 'POST', session: job.session, body: { rev: job.server_rev || 0, payload: { format: 'gbqs.forms.draft/1', form_key: job.form_key, form_version: job.form_version, saved_at: d.saved_at, state: d.state } } });
    await db.update('jobs', jobId, (j) => ({ ...j, server_rev: r.rev, pushed_local_rev: d.local_rev, synced_at: new Date().toISOString() }));
  } catch { /* not needed for the submission */ }
}

export function processOutbox(jobId, { force = false } = {}) {
  return exclusive('outbox:' + jobId, async () => {
    const ob = await db.get('outbox', jobId);
    if (!ob || ob.status === 'sent' || ob.status === 'blocked') return ob;
    if (!force && ob.next_at && Date.now() < ob.next_at) return ob;
    const job = await db.get('jobs', jobId);
    if (!job || !job.session) return ob;
    if (!online()) return ob;
    await db.put('outbox', { ...ob, status: 'sending' }); emit('outbox', { jobId });
    try {
      const filesOk = await uploadFiles(jobId, ob.file_ids || []);
      if (!filesOk) throw new ApiError(online() ? 'files_pending' : 'offline', 0, { stage: 'files' });
      await pushFinalDraft(jobId);
      const r = await call('/submit', { method: 'POST', session: job.session, body: { client_submission_id: ob.client_submission_id, payload: ob.payload } });
      const done = { ...ob, status: 'sent', result: r, sent_at: new Date().toISOString(), last_error: null };
      await db.put('outbox', done);
      await db.update('jobs', jobId, (j) => ({ ...j, status: 'submitted', read_only: true, read_only_reason: 'submitted', submission: { client_submission_id: ob.client_submission_id, submission_id: r.submission_id, status: r.status, at: done.sent_at, duplicate: !!r.duplicate } }));
      emit('outbox', { jobId, sent: true, result: r });
      return done;
    } catch (e) {
      const cur = await db.get('outbox', jobId);
      const code = e instanceof ApiError ? e.code : 'error';
      if (code === 'already_submitted') {
        const blocked = { ...cur, status: 'blocked', last_error: code };
        await db.put('outbox', blocked);
        await db.update('jobs', jobId, (j) => ({ ...j, status: 'submitted', read_only: true, read_only_reason: 'already_submitted' }));
        emit('outbox', { jobId, blocked: code });
        return blocked;
      }
      if (READ_ONLY_CODES[code]) {
        await db.put('outbox', { ...cur, status: 'blocked', last_error: code });
        await markReadOnly(jobId, code, e.data);
        emit('outbox', { jobId, blocked: code });
        return cur;
      }
      if (code === 'invalid_session' || code === 'missing_token') await handleAuthError(jobId, e);
      const attempts = (cur.attempts || 0) + 1;
      const rec = { ...cur, status: 'error', attempts, last_error: code, next_at: Date.now() + nextDelay(attempts - 1) };
      await db.put('outbox', rec);
      emit('outbox', { jobId, error: code });
      return rec;
    }
  });
}

// ---------- background loop ----------
let started = false;
export async function kickAll(force = false) {
  if (!online()) return;
  const jobs = await db.all('jobs');
  for (const j of jobs) {
    if (!j.session || j.read_only) {
      if (j.status !== 'queued') continue;
    }
    const ob = await db.get('outbox', j.job_id);
    if (ob && ob.status !== 'sent' && ob.status !== 'blocked') await processOutbox(j.job_id, { force });
    else if (!ob) { await pushDraft(j.job_id); await uploadFiles(j.job_id); }
  }
}
export function startLoop() {
  if (started) return; started = true;
  addEventListener('online', () => { emit('net', { online: true }); kickAll(true); });
  addEventListener('offline', () => emit('net', { online: false }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kickAll(); });
  setInterval(() => kickAll(), 20000);
  setTimeout(() => kickAll(), 1500);
}
