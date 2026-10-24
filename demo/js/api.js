export const __v = '1.1.16-20261024-683e6469';
// forms-api client. Errors are always {ok:false, code, message} from the server; the app shows its own
// English texts per code (server messages can be Dutch). Network problems become code "offline".
import { ENV } from '../config.js?v=1.1.16-20261024-683e6469';

export const TEXT = {
  files_pending: 'Waiting for photos/signatures to upload (see the list below).',
  offline: 'No connection. Your work is saved on this device and will be sent when you are back in range.',
  invalid_link: 'This link is not valid (any more). Ask GlobalBQS operations for a new link.',
  link_replaced: 'This link has been replaced by a newer one. Use the link in the latest e-mail from GlobalBQS for this job.',
  cancelled: 'This job was cancelled by GlobalBQS. Nothing more to do here.',
  rate_limited: 'Too many codes requested. Wait 15 minutes and try again.',
  invalid_code: 'That code is not correct.',
  no_code: 'This code has expired or was already used. Ask for a new code.',
  too_many_attempts: 'Too many wrong attempts. Ask for a new code.',
  missing_token: 'Please sign in again on this device.',
  invalid_session: 'Your sign-in on this device is no longer valid. Please sign in again.',
  revoked: 'This job was continued on another device. This copy is read-only.',
  not_active_device: 'This job is open on another device. This copy is read-only.',
  job_closed: 'This job has been submitted or closed. This copy is read-only.',
  stale: 'A newer version of this survey was saved from another session.',
  already_submitted: 'This job has already been submitted.',
  bad_request: 'The app sent an invalid request. Please update the app or contact GlobalBQS.',
  bad_payload: 'The survey data could not be read by the server. Please contact GlobalBQS operations.',
  bad_file_id: 'A file reference was invalid. Please contact GlobalBQS operations.',
  bad_kind: 'A file type was not accepted. Please contact GlobalBQS operations.',
  bad_mime: 'Only JPEG, PNG, WebP, HEIC or PDF files can be uploaded.',
  bad_submission_id: 'The submission reference was invalid. Please contact GlobalBQS operations.',
  too_large: 'This file or request is too large (max 25 MB per file).',
  no_email: 'No e-mail address is known for you on this job. Contact GlobalBQS operations.',
  not_found: 'The file did not arrive. It will be uploaded again.',
  not_registered: 'The file was not registered yet. It will be registered again.',
  file_id_conflict: 'A file reference clashed with another job. Please contact GlobalBQS operations.',
  processing_error: 'Received, but processing failed. GlobalBQS operations has been notified.',
  server_error: 'The server had a problem. The app will try again later.',
  unknown_route: 'The app version does not match the server. Please reload the app.',
  method_not_allowed: 'The app version does not match the server. Please reload the app.',
  http_error: 'Unexpected answer from the server. The app will try again later.',
};
export const textFor = (code) => TEXT[code] || TEXT.http_error;

export class ApiError extends Error {
  constructor(code, status, data) {
    super(textFor(code));
    this.code = code; this.status = status; this.data = data || {};
  }
  get retryable() { return ['offline', 'files_pending', 'server_error', 'http_error', 'rate_limited', 'processing_error'].includes(this.code); }
}

/**
 * call('/job', {query:{token}, session}) / call('/draft', {method:'POST', body, session})
 * Resolves with the JSON body when ok !== false, otherwise throws ApiError.
 */
export async function call(path, { method = 'GET', body, session, query, timeoutMs = 30000 } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('offline', 0);
  const url = new URL(ENV.apiBase + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const headers = {};
  if (session) headers.Authorization = 'Bearer ' + session;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: 'no-store', credentials: 'omit' });
  } catch {
    throw new ApiError('offline', 0);
  } finally { clearTimeout(t); }
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!data || typeof data !== 'object') throw new ApiError(res.status >= 500 ? 'server_error' : 'http_error', res.status);
  if (data.ok === false) throw new ApiError(String(data.code || (res.status >= 500 ? 'server_error' : 'http_error')), res.status, data);
  return data;
}

/** PUT raw bytes to a signed upload URL (Supabase storage). */
export async function putFile(url, blob, contentType, timeoutMs = 120000) {
  if (navigator.onLine === false) throw new ApiError('offline', 0);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob, signal: ctl.signal, credentials: 'omit' });
  } catch { throw new ApiError('offline', 0); } finally { clearTimeout(t); }
  if (!res.ok) throw new ApiError(res.status >= 500 ? 'server_error' : 'http_error', res.status);
  return true;
}
