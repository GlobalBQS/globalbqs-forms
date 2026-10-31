export const __v = '1.1.20-20261031-98de01fa';
// GlobalBQS Forms - app shell: routing, journey screens (link -> install -> code -> takeover -> my jobs -> job
// -> start check -> form -> status), service worker + update prompt, network state.
import { ENV } from '../config.js?v=1.1.20-20261031-98de01fa';
import * as db from './db.js?v=1.1.20-20261031-98de01fa';
import { call, ApiError, textFor } from './api.js?v=1.1.20-20261031-98de01fa';
import * as sync from './sync.js?v=1.1.20-20261031-98de01fa';
import { $, esc, ICON, LOGO, note, toast, modal, closeModal, timeAgo, fileId, offsetMin } from './ui.js?v=1.1.20-20261031-98de01fa';
import { compressPhoto, exifToIso, strokesToPng } from './photos.js?v=1.1.20-20261031-98de01fa';
import { loadForm, isSupported } from './forms/registry.js?v=1.1.20-20261031-98de01fa';
import { mountForm } from './forms/engine.js?v=1.1.20-20261031-98de01fa';
import { imoOk } from './forms/calc.js?v=1.1.20-20261031-98de01fa';

const app = $('#app');
let cleanup = null;
const pending = new Map(); // token -> {summary, codeSent, email, expires, code, takeover}

// ---------- environment / device ----------
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);
function deviceLabel() {
  const ua = navigator.userAgent;
  const dev = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet') : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux PC' : 'Device';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${dev} · ${br}${isStandalone() ? ' (app)' : ''}`;
}
const TOKEN_RE = /[0-9a-f]{64}/i;

// ---------- chrome ----------
function bar(title, sub, back, extra = '') {
  return `<header class="appbar">${back ? `<button class="back" type="button" data-go="${back}">‹ Back</button>` : ''}
    <div class="appbar-row"><div class="brand">${LOGO}<b>Global<span>BQS</span> Surveyor</b></div><span class="net ${navigator.onLine ? '' : 'off'}" data-net><i></i>${navigator.onLine ? 'Online' : 'No signal'}</span></div>
    ${title ? `<h1>${title}</h1>` : ''}${sub ? `<p>${sub}</p>` : ''}${extra}</header>`;
}
function screen(html) {
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  closeModal();
  app.className = 'journey-app';
  app.innerHTML = `<div class="phone">${html}</div>`;
  paintedSeq = routeSeq;
  window.scrollTo(0, 0);
}
/** re-render the current screen without running the route cleanup (keeps listeners of the view) */
let routeSeq = 0, paintedSeq = -1;
function repaint(html) { const ph = app.querySelector('.phone'); if (ph && app.className === 'journey-app' && paintedSeq === routeSeq) { ph.innerHTML = html; } else screen(html); }
const firstRun = (n) => `<div class="progress" aria-label="First time setup, step ${n} of 2"><i class="on"></i><i class="${n > 1 ? 'on' : ''}"></i><span>First time on this device · step ${n} of 2</span></div>`;
function errorScreen(title, msg, actions = '') {
  screen(`${bar(title, '')}<div class="content">${note('bad', esc(msg))}${actions}<button class="btn ghost block" type="button" data-go="#/">My jobs on this device</button></div>`);
}
function updateNetPills() {
  document.querySelectorAll('[data-net]').forEach((n) => { n.classList.toggle('off', !navigator.onLine); n.innerHTML = `<i></i>${navigator.onLine ? 'Online' : 'No signal'}`; });
}

// ---------- jobs ----------
async function jobByToken(token) { return (await db.all('jobs')).find((j) => j.token === token) || null; }
const statusPill = (j, ob) => {
  if (j.read_only && j.read_only_reason === 'taken_over') return '<span class="pill bad">Continued on another device</span>';
  if (j.read_only_reason === 'cancelled') return '<span class="pill bad">Cancelled</span>';
  if (j.status === 'submitted') return '<span class="pill info">Under review by GlobalBQS</span>';
  if (j.status === 'queued') return `<span class="pill warn">${ob && ob.status === 'sending' ? 'Sending…' : 'Waiting to send'}</span>`;
  if (j.status === 'in_progress') return '<span class="pill info">In progress</span>';
  return j.prefill ? '<span class="pill ok">Ready offline</span>' : '<span class="pill warn">Not downloaded</span>';
};

/** blank = the surveyor has not started on this device (start check not done, or never edited) */
const REOPEN_RE = /Reopened by GlobalBQS/;
const adoptServerDraft = (job, draft) => sync.adoptServerDraft(job, draft);

/** store / refresh a job from a /job response that included the prefill (signed in) */
async function storeJobFromOpen(token, r, sessionInfo) {
  const id = r.job.id;
  const prev = await db.get('jobs', id);
  const job = {
    ...(prev || {}),
    job_id: id, token,
    session: sessionInfo ? sessionInfo.session_token : prev?.session,
    device_id: sessionInfo ? sessionInfo.device_id : prev?.device_id,
    form_key: r.job.form_key, form_version: r.job.form_version || '1.0', job_status: r.job.status,
    summary: r.summary, prefill: r.prefill || prev?.prefill || null,
    status: prev?.status && prev.status !== 'new' ? prev.status : (r.job.status === 'in_progress' && r.draft ? 'in_progress' : 'new'),
    read_only: false, read_only_reason: null, needs_sign_in: false,
    server_rev: prev?.server_rev ?? 0, pushed_local_rev: prev?.pushed_local_rev ?? 0,
    opened_at: prev?.opened_at || new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  if (r.job.status === 'submitted' && job.status !== 'submitted') { job.status = 'submitted'; job.read_only = true; job.read_only_reason = 'submitted'; }
  await adoptServerDraft(job, r.draft);
  await db.put('jobs', job);
  return job;
}

// ---------- views ----------
const V = {};

V.jobs = async () => {
  const jobs = (await db.all('jobs')).sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at)));
  const obs = Object.fromEntries((await db.all('outbox')).map((o) => [o.job_id, o]));
  const notReady = jobs.filter((j) => !j.prefill && !j.read_only).length;
  screen(`${bar('My jobs', 'Jobs opened on this device')}
  <div class="content">
    <div class="card newjob"><h3>Open a new job</h3>
      <ol class="howto small"><li>In the e-mail from GlobalBQS, press and hold the <b>Open survey form</b> button and choose <b>Copy link</b>.</li><li>Come back here and tap <b>Paste link</b>.</li></ol>
      <button class="btn primary block" type="button" id="pasteBtn">Paste link</button>
      <div class="fix"><label for="pasteLink">Or paste / type the link here</label><input id="pasteLink" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://forms.globalbqs.com/j/…"></div>
      <button class="btn ghost block" type="button" id="openLinkBtn">Open job</button></div>
    ${db.memoryOnly ? note('bad', '<b>This browser does not allow the app to store data</b> (private mode?). Your work is lost when you close it. Use a normal window or the home-screen app.') : ''}
    ${jobs.length ? '<h3 style="margin:4px 0 0">My jobs</h3>' : ''}
    ${jobs.length ? (notReady ? note('warn', `<b>${notReady} job${notReady > 1 ? 's' : ''} not ready offline yet.</b> Open ${notReady > 1 ? 'them' : 'it'} while you have signal.`) : note('ok', 'All jobs are on this device. You can go on board without signal.')) : note('info', 'No jobs on this device yet. Open the job link from the e-mail on this device, or paste it below.')}
    ${jobs.map((j) => `<button class="jobcard" type="button" data-go="#/job/${j.job_id}">
      <div class="row"><span class="mono small">${esc(j.summary?.gbqs_reference || '')}</span>${statusPill(j, obs[j.job_id])}</div>
      <span class="vsl">${esc(j.summary?.vessel_name || 'Job')}</span><span class="muted">${esc(j.summary?.survey_type_label || '')} · ${esc(j.summary?.port || '')}${j.summary?.eta ? ' · ETA ' + esc(j.summary.eta) : ''}</span></button>`).join('')}
    <p class="muted small" style="margin:0;text-align:center">GlobalBQS Forms ${esc(ENV.version)}${ENV.isDemo ? ' · DEMO' : ''}</p>
  </div>`);
  const open = () => { const m = TOKEN_RE.exec($('#pasteLink').value || ''); if (!m) { toast('That is not a GlobalBQS job link. Copy the link of the “Open survey form” button in the e-mail.'); return; } location.hash = '#/j/' + m[0].toLowerCase(); };
  $('#openLinkBtn').onclick = open;
  $('#pasteLink').addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  $('#pasteBtn').onclick = async () => {
    let txt = '';
    try { txt = await navigator.clipboard.readText(); } catch { /* not allowed: use the field */ }
    if (txt && TOKEN_RE.test(txt)) { $('#pasteLink').value = txt; open(); return; }
    const f = $('#pasteLink'); f.focus(); toast(txt ? 'The copied text is not a job link. Copy the link from the e-mail again.' : 'Press and hold in the field and choose Paste.');
  };
};

V.link = async (token) => {
  token = token.toLowerCase();
  const local = await jobByToken(token);
  screen(`${bar('Opening the job…', '')}<div class="content"><div class="card"><p class="muted" style="margin:0">Checking the link…</p></div></div>`);
  if (!navigator.onLine) {
    if (local) { location.replace('#/job/' + local.job_id); return; }
    errorScreen('No signal', 'Opening a new job link needs signal, once. Try again when you are back in range.', '<button class="btn primary block" type="button" data-reload>Try again</button>');
    return;
  }
  let r;
  try { r = await call('/job', { query: { token }, session: local?.session }); } catch (e) {
    if (e.code === 'offline' && local) { location.replace('#/job/' + local.job_id); return; }
    if ((e.code === 'link_replaced' || e.code === 'invalid_link') && local && local.session) {
      // the job stays usable on this device (signed in); only this link is old
      await db.put('jobs', { ...local, link_replaced: true });
      location.replace('#/job/' + local.job_id);
      setTimeout(() => toast(e.code === 'link_replaced' ? 'This link was replaced by a newer one. The job opens from this device.' : 'This link is no longer valid. The job opens from this device.'), 300);
      return;
    }
    if (e.code === 'cancelled' && local) await db.put('jobs', { ...local, read_only: true, read_only_reason: 'cancelled' });
    errorScreen(e.code === 'cancelled' ? 'Job cancelled' : e.code === 'link_replaced' ? 'Link replaced' : e.code === 'invalid_link' ? 'Link not valid' : 'Could not open the job', textFor(e.code),
      e.retryable ? '<button class="btn primary block" type="button" data-reload>Try again</button>' : '');
    return;
  }
  // a newer link for a job that is already signed in on this device: no new code needed
  if (r.needs_sign_in && r.job && !local) {
    const same = await db.get('jobs', r.job.id);
    if (same && same.session) {
      try { const r2 = await call('/job', { query: { token }, session: same.session }); if (!r2.needs_sign_in && r2.prefill) { r = r2; } } catch { /* sign in as usual */ }
    }
  }
  if (!r.needs_sign_in && r.prefill) {
    const job = await storeJobFromOpen(token, r, null);
    location.replace('#/job/' + job.job_id);
    return;
  }
  if (local && r.session && r.session.code === 'revoked') {
    await db.put('jobs', { ...local, read_only: true, read_only_reason: r.session.reason || 'taken_over' });
    location.replace('#/job/' + local.job_id);
    return;
  }
  pending.set(token, { summary: r.summary, active: r.active_device, job: r.job });
  const skipped = await db.kvGet('install_skipped', false);
  if (!isStandalone() && !skipped) location.replace('#/install/' + token);
  else location.replace('#/signin/' + token);
};

/** in the browser (not the home-screen app) on iPhone/iPad: the e-mail link cannot open the installed app */
function installedHint(token) {
  if (isStandalone() || !isIOS()) return '';
  return `<div class="card"><p style="margin:0"><b>Already have the GlobalBQS app on your home screen?</b> Copy this link, open the GlobalBQS app and tap <b>Open a new job</b> → <b>Paste link</b>.</p>
    <button class="btn ghost block" type="button" data-copylink="${token}">Copy link</button></div>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copylink]'); if (!b) return;
  const url = location.href.split('#')[0].replace(/[^/]*$/, '') + 'j/' + b.dataset.copylink;
  try { await navigator.clipboard.writeText(url); toast('Link copied. Open the GlobalBQS app and tap Open a new job → Paste link.'); }
  catch { modal('Copy this link', `<p class="mono small" style="word-break:break-all;user-select:all">${esc(url)}</p>`); }
});

V.install = async (token) => {
  const p = pending.get(token);
  if (!p) { location.replace('#/j/' + token); return; }
  let tab = isAndroid() ? 'android' : 'ios';
  let deferred = window.__bip || null;
  const render = () => {
    repaint(`${bar('Welcome' + (p.summary?.vessel_name ? '' : ''), 'Install once on this device (about 30 seconds)')}
    <div class="content">
      ${firstRun(1)}
      ${installedHint(token)}
      <div class="card"><dl class="kv"><dt>Job</dt><dd class="mono">${esc(p.summary?.gbqs_reference || '')}</dd><dt>Survey</dt><dd>${esc(p.summary?.survey_type_label || '')}</dd><dt>Vessel</dt><dd>${esc(p.summary?.vessel_name || '')}</dd><dt>Port</dt><dd>${esc(p.summary?.port || '')}</dd>${p.summary?.eta ? `<dt>ETA</dt><dd>${esc(p.summary.eta)}</dd>` : ''}</dl></div>
      ${note('info', 'Put the app on your home screen first. Then it opens without signal and keeps your work, also when you close it.')}
      <div class="tabs" role="group" aria-label="Device type"><button type="button" data-tab="ios" aria-pressed="${tab === 'ios'}">iPhone / iPad</button><button type="button" data-tab="android" aria-pressed="${tab === 'android'}">Android</button></div>
      <div class="card">${tab === 'ios'
        ? `<ol class="howto"><li>Tap <b>Copy job link</b> below.</li><li>Tap the <b>Share</b> button of Safari (square with arrow) and choose <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open GlobalBQS from your home screen and paste the link there.</li></ol>
           <button class="btn ghost block" type="button" id="copyLink">Copy job link</button>`
        : `${deferred ? '<button class="btn primary block" type="button" id="installBtn">Install the app</button>' : ''}<ol class="howto"><li>Tap the <b>⋮</b> menu at the top right of Chrome.</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Confirm, then open GlobalBQS from your home screen; the job opens there.</li></ol>`}</div>
      ${tab === 'ios' ? note('warn', '<b>iPhone / iPad:</b> sign in only in the app on your home screen, not in Safari. Safari and the home-screen app keep their data apart.') : ''}
      <button class="btn primary block" type="button" id="skipInstall">Skip – continue in the browser</button>
      <p class="muted small" style="margin:0;text-align:center">Laptop? It works in the browser too; nothing to install.</p>
    </div>`);
    app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
    const cl = $('#copyLink'); if (cl) cl.onclick = async () => { const url = location.href.split('#')[0] + '#/j/' + token; try { await navigator.clipboard.writeText(url); toast('Job link copied. Paste it in the home-screen app.'); } catch { modal('Copy this link', `<p class="mono small" style="word-break:break-all">${esc(url)}</p>`); } };
    const ib = $('#installBtn'); if (ib) ib.onclick = async () => { deferred.prompt(); const c = await deferred.userChoice.catch(() => null); window.__bip = null; deferred = null; if (c && c.outcome === 'accepted') toast('Installed. Open GlobalBQS from your home screen.'); render(); };
    $('#skipInstall').onclick = async () => { await db.kvSet('install_skipped', true); location.replace('#/signin/' + token); };
  };
  setJobManifest(token);
  render();
  const onBip = () => { deferred = window.__bip; render(); };
  addEventListener('gbqs:bip', onBip);
  cleanup = () => removeEventListener('gbqs:bip', onBip);
};

V.signin = async (token) => {
  let p = pending.get(token);
  if (!p) {
    const local = await jobByToken(token);
    if (!navigator.onLine) { errorScreen('No signal', 'Signing in needs signal, once. After that the job works offline.'); return; }
    try { const r = await call('/job', { query: { token } }); p = { summary: r.summary, active: r.active_device, job: r.job }; pending.set(token, p); } catch (e) { errorScreen('Could not open the job', textFor(e.code)); return; }
    if (local) p.retake = true;
  }
  const render = (msg) => {
    const ok = /^\d{6}$/.test(p.code || '');
    repaint(`${bar('Sign in on this device', 'Step 2 of 2 · confirm it is you')}
    <div class="content">
      ${firstRun(2)}
      ${installedHint(token)}
      <div class="card"><dl class="kv"><dt>Job</dt><dd class="mono">${esc(p.summary?.gbqs_reference || '')}</dd><dt>Vessel</dt><dd>${esc(p.summary?.vessel_name || '')}</dd></dl></div>
      <div class="card"><p style="margin:0">We e-mail you a 6-digit code to confirm it's you. You need it once per job on this device.</p><p class="muted small" style="margin:0">Code goes to <b>${esc(p.email || p.summary?.surveyor_email_masked || 'your e-mail address')}</b>.</p>
        ${p.codeSent ? `<p class="muted small" style="margin:0">Code sent. Valid until ${esc(new Date(p.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))} (device time).</p>` : ''}
        <button class="btn ghost block" type="button" id="sendCode" ${navigator.onLine ? '' : 'disabled'}>${p.codeSent ? 'Send a new code' : 'Send me the code'}</button>
        ${navigator.onLine ? '' : '<p class="muted small" style="margin:0">Signing in needs signal, once. After that the job works offline.</p>'}</div>
      ${p.codeSent ? `<div class="card"><label class="muted small" for="code">6-digit code</label><input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="${esc(p.code || '')}" enterkeyhint="done">
        ${msg ? `<p class="err" role="alert" style="margin:0">${esc(msg)}</p>` : ''}
        <button class="btn primary block" type="button" id="verify" ${ok ? '' : 'disabled'}>Confirm and open the job</button></div>` : (msg ? note('bad', esc(msg)) : '')}
      ${note('info', 'The job can be open on <b>one device at a time</b>. Whenever there is a connection your draft (figures, signatures, photos) is saved to GlobalBQS, so another device continues where the last sync stopped.')}
    </div>`);
    $('#sendCode').onclick = sendCode;
    const c = $('#code');
    if (c) {
      c.oninput = () => { c.value = c.value.replace(/\D/g, '').slice(0, 6); p.code = c.value; $('#verify').disabled = !/^\d{6}$/.test(p.code); };
      c.onkeydown = (e) => { if (e.key === 'Enter' && /^\d{6}$/.test(p.code || '')) verify(false); };
      $('#verify').onclick = () => verify(false);
      if (!p.code) c.focus();
    }
  };
  async function sendCode() {
    const b = $('#sendCode'); b.disabled = true;
    try {
      const r = await call('/code', { method: 'POST', body: { token, device_label: deviceLabel() } });
      p.codeSent = true; p.email = r.email_masked; p.expires = r.expires_at; p.code = '';
      toast('Code sent to ' + (r.email_masked || 'your e-mail'));
      render();
    } catch (e) { render(textFor(e.code)); }
  }
  async function verify(takeover) {
    const b = $('#verify'); if (b) b.disabled = true;
    try {
      const r = await call('/verify', { method: 'POST', body: { token, code: p.code, device_label: deviceLabel(), takeover } });
      if (r.needs_takeover) { p.takeover = { label: r.other_device_label, last_seen: r.other_last_seen }; location.replace('#/takeover/' + token); return; }
      await finishSignIn(token, r);
    } catch (e) {
      let msg = textFor(e.code);
      if (e.code === 'invalid_code' && e.data.attempts_left != null) msg += ` ${e.data.attempts_left} attempt${e.data.attempts_left === 1 ? '' : 's'} left.`;
      if (['no_code', 'too_many_attempts'].includes(e.code)) { p.code = ''; }
      if (takeover) { location.replace('#/signin/' + token); setTimeout(() => toast(msg), 300); return; }
      render(msg);
    }
  }
  V._verify = verify;
  render();
};

async function finishSignIn(token, r) {
  const sess = { session_token: r.session_token, device_id: r.device_id };
  let open;
  try { open = await call('/job', { query: { token }, session: sess.session_token }); } catch (e) { errorScreen('Signed in, but the job could not be loaded', textFor(e.code), '<button class="btn primary block" type="button" data-reload>Try again</button>'); return; }
  const job = await storeJobFromOpen(token, open, sess);
  pending.delete(token);
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* */ }
  toast(r.took_over ? 'Continued on this device from the last sync.' : 'Signed in on this device.');
  location.replace('#/job/' + job.job_id);
}

V.takeover = async (token) => {
  const p = pending.get(token);
  if (!p || !p.takeover) { location.replace('#/signin/' + token); return; }
  const last = p.takeover.last_seen ? new Date(p.takeover.last_seen) : null;
  screen(`${bar('Continue here?', `${esc(p.summary?.gbqs_reference || '')} · ${esc(p.summary?.vessel_name || '')}`)}
  <div class="content">
    ${note('warn', `<b>This job is open on another device (${esc(p.takeover.label || 'unknown device')}${last ? ' · last active ' + esc(last.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })) : ''}). Continue here?</b>`)}
    <div class="card"><dl class="kv"><dt>Continues with</dt><dd>Figures, signatures and photos up to the last sync of the other device</dd></dl></div>
    ${note('bad', 'Changes on the other device that were not synced yet will not come along.')}
    <button class="btn primary block" type="button" id="doTake">Continue on this device</button>
    <button class="btn ghost block" type="button" id="cancelTake">Cancel</button>
    <p class="muted small" style="margin:0">Continuing takes the job over. The other device becomes read-only. No call to ops needed.</p>
  </div>`);
  $('#doTake').onclick = async () => {
    $('#doTake').disabled = true;
    try {
      const r = await call('/verify', { method: 'POST', body: { token, code: p.code, device_label: deviceLabel(), takeover: true } });
      if (r.needs_takeover) { toast('Still open elsewhere; try again.'); $('#doTake').disabled = false; return; }
      await finishSignIn(token, r);
    } catch (e) {
      p.code = ''; p.takeover = null;
      location.replace('#/signin/' + token);
      setTimeout(() => toast(textFor(e.code) + (e.code === 'no_code' ? '' : '')), 300);
    }
  };
  $('#cancelTake').onclick = () => { pending.delete(token); toast('Cancelled. The job stays open on the other device.'); location.replace('#/'); };
};

function roBanner(job) {
  if (!job.read_only) return '';
  if (job.read_only_reason === 'taken_over') return note('bad', `<b>This job was continued on another device.</b> This copy is read-only. <button class="btn ghost small" type="button" data-go="#/signin/${job.token}">Sign in to take it back</button>`);
  if (job.read_only_reason === 'cancelled') return note('bad', '<b>This job was cancelled by GlobalBQS.</b> This copy is read-only.');
  if (job.read_only_reason === 'already_submitted') return note('warn', '<b>This job was already submitted</b> (from another device or earlier). This copy is read-only.');
  if (job.read_only_reason === 'submitted') return '';
  return note('warn', `<b>${esc(textFor(job.read_only_reason))}</b>`);
}

V.job = async (id) => {
  let job = await db.get('jobs', id);
  if (!job) { location.replace('#/'); return; }
  serverDraftSeen.delete(id);
  const fresh = await refreshPrefill(job);
  job = fresh || job;
  const ob = await db.get('outbox', id);
  const s = job.summary || {}, pf = job.prefill || {};
  const draft = await db.get('drafts', id);
  const started = !!(draft && draft.state && draft.state.gate && draft.state.gate.done);
  // "Load saved version from GlobalBQS" only when, just now (online), the server had a draft that differs from this device:
  // a newer rev than this device synced, or more filled in than the local copy
  const sd = fresh && navigator.onLine ? serverDraftSeen.get(id) : null;
  const showLoad = !!(sd && !job.read_only && job.session && !['queued', 'submitted'].includes(job.status) && isSupported(job.form_key)
    && (sd.rev > (job.server_rev || 0) || !(draft && draft.state) || sync.filledCount(draft.state) < sd.filled));
  const port = pf.port || {}, sch = pf.schedule || {}, nom = pf.nomination || {};
  const grades = (nom.deliveries || []).map((d) => `${d.grade}${d.nominated_mt != null ? ' ' + d.nominated_mt + ' MT' : ''}`).join(' · ') || nom.ordered_quantities || '—';
  const supported = isSupported(job.form_key);
  screen(`${bar(esc(s.vessel_name || pf.vessel?.name || 'Job'), `${esc(s.gbqs_reference || '')} · ${esc(s.survey_type_label || '')}`, '#/')}
  <div class="content">
    <div class="row">${statusPill(job, ob)}<span class="muted small">${job.synced_at ? 'Last synced ' + esc(timeAgo(job.synced_at)) : 'Not synced yet'}</span></div>
    ${roBanner(job)}
    ${job.status === 'submitted' ? reviewNote(job.review || 'processing') : ''}
    ${job.link_replaced && !job.read_only ? note('warn', '<b>A newer link was sent for this job.</b> You can carry on here; your work is saved and synchronised. To refresh the job details (vessel, port, instructions), open the link in the latest e-mail once.') : ''}
    ${!job.read_only && !['queued', 'submitted'].includes(job.status) && draft && draft.state && (draft.state.audit || []).some((a) => REOPEN_RE.test(a.reason || '')) ? note('info', '<b>Reopened for correction.</b> Your previous entries and photos are loaded. Correct what is needed; the signatures must be collected again before you submit.') : ''}
    ${!supported ? note('warn', 'This survey type is not available in this app version yet. Use the form link from GlobalBQS operations.') : ''}
    <div class="card"><dl class="kv"><dt>IMO</dt><dd class="mono">${esc(pf.vessel?.imo || '—')}</dd><dt>Place</dt><dd>${esc(port.place || s.port || '—')}</dd><dt>ETA</dt><dd>${esc(sch.eta || s.eta || '—')}</dd><dt>ETB</dt><dd>${esc(sch.etb || '—')}</dd><dt>Grades</dt><dd>${esc(grades)}</dd><dt>Supplier</dt><dd>${esc(nom.supplier_name || '—')}</dd><dt>Agent</dt><dd>${esc(pf.parties?.agent || '—')}</dd>
      <dt>Form version</dt><dd class="mono">${esc(job.form_version || '1.0')}</dd>${job.submission?.submission_id ? `<dt>Submission ID</dt><dd class="mono">${esc(job.submission.submission_id)}</dd>` : ''}</dl></div>
    ${job.read_only ? '' : note('info', `<b>Open on this device.</b> Whenever there is a connection your draft (figures, signatures, photos) is saved to GlobalBQS automatically. Switching device? Open the job link there and sign in; it continues where the last sync stopped.`)}
    ${pf.survey?.instructions ? `<div class="card"><h3>Instructions from the client</h3><p class="muted" style="margin:0;white-space:pre-line">${esc(pf.survey.instructions)}</p></div>` : ''}
    ${!job.prefill ? note('warn', 'This job is not ready offline yet. Open it once with signal.') : ''}
    ${['queued', 'submitted'].includes(job.status) ? '<button class="btn primary block" type="button" data-go="#/job/' + id + '/status">Show status</button>'
      : supported && job.prefill ? `<button class="btn primary block" type="button" data-go="#/job/${id}/${started ? 'form' : 'check'}">${job.read_only ? 'View survey (read-only)' : started ? 'Continue survey' : 'I am on board: start'}</button>` : ''}
    ${showLoad ? `<button class="btn ghost block" type="button" id="loadServer">Load saved version from GlobalBQS</button><p class="muted small" style="margin:0;text-align:center">Replaces the copy on this device with the version last saved on GlobalBQS (this device's copy is kept as a backup).</p>` : ''}
    ${job.status === 'submitted' || job.read_only_reason === 'cancelled' ? '<button class="btn ghost block" type="button" id="removeJob">Remove from this device</button>' : ''}
  </div>`);
  const ls = $('#loadServer');
  if (ls) ls.onclick = async () => {
    if (!navigator.onLine) { toast('This needs signal.'); return; }
    const v = await modal('Load the saved version?', '<p>The form on this device is replaced by the version last saved on GlobalBQS. The copy on this device is kept as a backup.</p>', [{ label: 'Cancel', value: null }, { label: 'Load saved version', value: 'go', kind: 'primary' }]);
    if (!v) return;
    ls.disabled = true;
    try {
      const r = await sync.forceServerDraft(id);
      if (r.none) { toast('No saved version on GlobalBQS yet.'); ls.disabled = false; return; }
      toast('Saved version loaded.');
      const d = await db.get('drafts', id);
      location.hash = '#/job/' + id + (d && d.state && d.state.gate && d.state.gate.done ? '/form' : '/check');
    } catch (e) { toast(textFor(e.code)); ls.disabled = false; }
  };
  if (job.status === 'submitted') refreshReview(id).then((changed) => { if (changed && location.hash === '#/job/' + id) route(); });
  const rm = $('#removeJob');
  if (rm) rm.onclick = async () => {
    const v = await modal('Remove this job from this device?', '<p>The survey stays with GlobalBQS. Only the copy on this device is removed.</p>', [{ label: 'Cancel', value: null }, { label: 'Remove', value: 'rm', kind: 'danger' }]);
    if (!v) return;
    for (const f of await db.byIndex('files', 'job_id', id)) await db.del('files', f.id);
    await db.del('drafts', id); await db.del('outbox', id); await db.del('jobs', id);
    location.replace('#/');
  };
};

// ---------- start check ----------
const IMO_WARN = "IMO number check digit does not match – please verify against the vessel's certificate. You can continue; ops is informed.";
const SURVEY_TYPES = ['Bunker Quantity Survey (B221)', 'On-Hire Bunker Survey', 'On-Hire Condition Survey', 'On-Hire B+C Survey (combined)', 'Off-Hire Bunker Survey', 'Off-Hire Condition Survey', 'Off-Hire B+C Survey (combined)', 'Bunker Delivery Survey'];
async function loadState(job, form) {
  const d = await db.get('drafts', job.job_id);
  if (d && d.state) return d.state;
  const st = form.initState(job.prefill);
  await db.put('drafts', { job_id: job.job_id, state: st, local_rev: 0, saved_at: new Date().toISOString() });
  return st;
}
V.check = async (id) => {
  const job = await db.get('jobs', id);
  if (!job) { location.replace('#/'); return; }
  const form = await loadForm(job.form_key);
  if (!form) { location.replace('#/job/' + id); return; }
  await pullFirst(id);
  const S = await loadState(job, form);
  if (job.prefill && S.order) refreshOrder(S, job.prefill);
  S.gate = S.gate || { answers: {}, fix: {}, done: false };
  const g = S.gate, o = S.order;
  const save = () => sync.saveLocal(id, S);
  const fin = (k, label, val, opt = {}) => `<label for="fx_${k}">${label}</label><input id="fx_${k}" data-fix="${k}" value="${esc(val)}" autocomplete="off" ${opt.num ? 'inputmode="numeric"' : ''} ${opt.max ? `maxlength="${opt.max}"` : ''} class="${opt.bad ? 'bad' : ''}" style="${opt.mono ? 'font-family:var(--mono)' : ''}">`;
  const gl = form.gateGrades(S);
  const fixOk = (k) => {
    const f = g.fix;
    if (k === 'vessel') return !!String(f.vessel ?? o.vessel).trim() && /^\d{7}$/.test(String(f.imo ?? o.imo ?? '').replace(/^IMO\s*/i, '').trim()); // check digit = warning only
    if (k === 'type') return !!f.typeExp;
    if (k === 'grades') return gl.some(([gg]) => String(f['g_' + gg] ?? '') !== '') || !!String(f.gradesNote || '').trim();
    return true;
  };
  const GATE = [
    ['vessel', 'Vessel on board matches?', () => `<span class="big">${esc(o.vessel)}</span><span class="big">IMO ${esc(o.imo || '—')} ${imoOk(o.imo) ? '<span class="pill ok">Check digit OK</span>' : '<span class="pill warn">Check digit does not match</span>'}</span>${imoOk(o.imo) ? '' : `<span class="err" style="color:var(--neg)">${IMO_WARN}</span>`}<span class="muted small">Check the IMO number on the ship's certificates, not only the name.</span>`,
      () => { const imo = g.fix.imo ?? o.imo, ok = imoOk(imo); return fin('vessel', 'Vessel name as on board', g.fix.vessel ?? o.vessel) + fin('imo', 'IMO number (7 digits)', imo, { num: 1, max: 7, mono: 1, bad: !ok }) + `<span class="${ok ? 'okm' : 'err'}" data-imomsg>${ok ? 'IMO check digit OK.' : IMO_WARN}</span>`; }],
    ['type', 'Is this the survey you are asked to do?', () => `<span class="big">${esc(o.type)}</span>`,
      () => `<label for="fx_typeExp">Which survey does the vessel/Master expect?</label><select id="fx_typeExp" data-fix="typeExp" class="sel"><option value="">Choose…</option>${SURVEY_TYPES.filter((t) => t !== o.type).map((t) => `<option ${g.fix.typeExp === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <label for="fx_typeNote">Remark (optional)</label><textarea id="fx_typeNote" data-fix="typeNote">${esc(g.fix.typeNote || '')}</textarea><span class="muted small">You carry on with the ${esc(o.type)}. Ops sees the mismatch and contacts the client if needed.</span>`],
    ['grades', 'Grades and quantities as nominated?', () => `<span class="big">${esc(gl.map(([gg, q]) => gg + (q ? ' ' + q + ' MT' : '')).join(' · ') || '—')}</span><span class="muted small">Compare with the supplier's delivery documents.</span>`,
      () => gl.map(([gg, q]) => fin('g_' + gg, `${gg} as stated on board (nominated: ${q ? q + ' MT' : '—'})`, g.fix['g_' + gg] ?? '', { mono: 1 })).join('') + `<label for="fx_gradesNote">Other difference <span class="muted">(optional)</span></label><textarea id="fx_gradesNote" data-fix="gradesNote">${esc(g.fix.gradesNote || '')}</textarea>`],
  ];
  if (!gl.length) GATE.splice(2, 1); // no nominated grades/quantities for this survey type
  const allOk = () => GATE.every(([k]) => g.answers[k] === 'y' || (g.answers[k] === 'n' && fixOk(k)));
  const render = () => {
    const fixes = GATE.filter(([k]) => g.answers[k] === 'n').length;
    repaint(`${bar('Before you start', `${esc(o.vessel)} · ${esc(o.type)}`, '#/job/' + id)}
    <div class="content">
      ${roBanner(job)}
      <p class="muted" style="margin:0">Three quick checks. Something different on board? Choose “No”, correct it here and carry on. Your correction is saved with the survey and visible to ops.</p>
      ${GATE.map(([k, q, body, fix]) => `<div class="check ${g.answers[k] === 'y' ? 'yes' : g.answers[k] === 'n' ? 'no' : ''}"><q>${q}</q>${body()}
        <div class="yn" role="group" aria-label="${esc(q)}"><button type="button" class="y" data-gate="${k}" data-v="y" aria-pressed="${g.answers[k] === 'y'}">Yes</button><button type="button" class="n" data-gate="${k}" data-v="n" aria-pressed="${g.answers[k] === 'n'}">No, correct it</button></div>
        ${g.answers[k] === 'n' ? `<div class="fix">${fix()}<span class="saved-fix" data-fixstate="${k}">${fixOk(k) ? 'Saved for ops.' : ''}</span></div>` : ''}</div>`).join('')}
      ${fixes ? note('info', `Your correction${fixes > 1 ? 's are' : ' is'} saved with the survey and shown to ops; no need to call. The Master and Chief Engineer confirm the figures with their signatures.`) : ''}
      <button class="btn primary block" type="button" id="startForm" ${allOk() && !job.read_only ? '' : 'disabled'}>Open the survey form</button>
      <button class="btn ghost block" type="button" id="skipGate">Skip the check for now</button>
    </div>`);
    app.querySelectorAll('[data-gate]').forEach((b) => { b.onclick = () => { if (job.read_only) return; g.answers[b.dataset.gate] = b.dataset.v; save(); render(); }; });
    $('#startForm').onclick = () => { g.done = true; save().then(() => { if (Object.keys(g.fix).length) toast('Corrections saved for ops'); location.hash = '#/job/' + id + '/form'; }); };
    $('#skipGate').onclick = () => { g.done = true; save().then(() => { location.hash = '#/job/' + id + '/form'; }); };
  };
  const onInput = (e) => {
    const f = e.target.closest('[data-fix]'); if (!f || job.read_only) return;
    g.fix[f.dataset.fix] = f.value;
    if (f.dataset.fix === 'imo') { const ok = imoOk(f.value); f.classList.toggle('bad', !ok); const m = app.querySelector('[data-imomsg]'); if (m) { m.className = ok ? 'okm' : 'err'; m.textContent = ok ? 'IMO check digit OK.' : IMO_WARN; } }
    app.querySelectorAll('[data-fixstate]').forEach((s) => { s.textContent = fixOk(s.dataset.fixstate) ? 'Saved for ops.' : ''; });
    $('#startForm').disabled = !allOk();
    save();
  };
  render();
  app.addEventListener('input', onInput); app.addEventListener('change', onInput);
  const prev = cleanup; cleanup = () => { app.removeEventListener('input', onInput); app.removeEventListener('change', onInput); if (prev) prev(); };
};

// ---------- form ----------
const thumbs = new Map();
async function loadThumbs(jobId) {
  for (const f of await db.byIndex('files', 'job_id', jobId)) {
    if (f.kind === 'signature' || thumbs.has(f.id)) continue;
    if (f.bytes) thumbs.set(f.id, URL.createObjectURL(new Blob([f.bytes], { type: f.mime || 'image/jpeg' })));
    else if (f.blob) { try { thumbs.set(f.id, URL.createObjectURL(f.blob)); } catch { /* unreadable */ } }
  }
}
const fileStatusCache = new Map();
async function refreshFileStatus(jobId) { for (const f of await db.byIndex('files', 'job_id', jobId)) fileStatusCache.set(f.id, f.status); }

/** read-only order data in a draft always follows the latest prefill (vessel, IMO, port, parties, charter) */
function refreshOrder(S, pf) {
  const o = S.order, sv = pf.survey || {}, port = pf.port || {}, ves = pf.vessel || {}, par = pf.parties || {}, sch = pf.schedule || {};
  const setIf = (k, v) => { if (v != null && v !== '') o[k] = String(v); };
  setIf('ref', sv.gbqs_reference); setIf('vessel', ves.name); setIf('imo', ves.imo); setIf('place', port.place || port.name); setIf('port', port.name);
  setIf('etb', sch.etb || sch.eta); setIf('type', sv.survey_type_label); setIf('client', pf.client?.name); setIf('owner', par.owner); setIf('charterer', par.charterer);
  setIf('agent', par.agent); setIf('po', sv.po_number);
  if (port.utc_offset && offsetMin(port.utc_offset) != null) o.utcOffset = port.utc_offset;
  const tol = pf.tolerance_pct ?? pf.client?.delivery_tolerance_pct; if (tol != null) o.tol = tol;
  o.charter = pf.charter ?? null; o.onHire = pf.on_hire_survey ?? null;
}
const serverDraftSeen = new Map();
/** refresh prefill (and summary) in the background whenever a job is opened with signal */
async function refreshPrefill(job) {
  if (!navigator.onLine || !job.session || job.read_only) return null;
  try {
    let r;
    try { r = await call('/job', { query: { token: job.token }, session: job.session }); } catch (e) {
      if (e.code === 'link_replaced' || e.code === 'invalid_link') await db.update('jobs', job.job_id, (j) => (j ? { ...j, link_replaced: e.code } : undefined));
      return null;
    }
    if (!r || r.needs_sign_in || !r.prefill) return null;
    const cur = await db.get('jobs', job.job_id);
    if (!cur) return null;
    const j = { ...cur, link_replaced: false, prefill: r.prefill, summary: r.summary || cur.summary, job_status: r.job?.status || cur.job_status, prefill_at: new Date().toISOString() };
    if (!['queued', 'submitted'].includes(j.status)) await adoptServerDraft(j, r.draft);
    // what the server holds right now (used only for this page view: offer "Load saved version" when it differs)
    serverDraftSeen.set(j.job_id, r.draft && r.draft.payload && r.draft.payload.state ? { rev: r.draft.rev || 0, filled: sync.filledCount(r.draft.payload.state) } : null);
    await db.put('jobs', j);
    return j;
  } catch { return null; }
}

/** before showing a draft: get the server's version when online (max 5 s; offline the local copy is used) */
async function pullFirst(id) {
  if (!navigator.onLine) return null;
  try { return await Promise.race([sync.pullServerDraft(id), new Promise((r) => setTimeout(() => r(null), 5000))]); } catch { return null; }
}

V.form = async (id) => {
  const seq = routeSeq;
  let job = await db.get('jobs', id);
  if (!job) { location.replace('#/'); return; }
  const form = await loadForm(job.form_key);
  if (!form) { location.replace('#/job/' + id); return; }
  if (job.status === 'queued' || job.status === 'submitted') { location.replace('#/job/' + id + '/status'); return; }
  await pullFirst(id);
  if (seq !== routeSeq) return;
  job = (await db.get('jobs', id)) || job;
  const S = await loadState(job, form);
  // read-only order data always follows the latest prefill (charter party, on-hire survey)
  if (job.prefill && S.order) refreshOrder(S, job.prefill);
  await loadThumbs(id); await refreshFileStatus(id);
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  closeModal();
  app.className = 'form-app';
  app.innerHTML = '';
  let saveT = null;
  const flush = () => { if (saveT) { clearTimeout(saveT); saveT = null; return sync.saveLocal(id, S); } return Promise.resolve(); };
  const hooks = {
    save: (_s, now) => { clearTimeout(saveT); saveT = setTimeout(() => { saveT = null; sync.saveLocal(id, S); }, now ? 0 : 250); },
    back: async () => { await flush(); location.hash = '#/job/' + id; },
    addPhoto: async (key, file) => {
      const c = await compressPhoto(file);
      const fid = fileId('ph');
      const trk = /^trk_(\d+)_/.exec(key);
      const trkDel = trk ? Object.values(S.grades).flatMap((g) => g.del).find((d) => String(d.id) === trk[1]) : null;
      const kind = key === 'bdn' ? 'bdn' : key.startsWith('lop') ? 'lop' : trk ? (trkDel && trkDel.truck.type !== 'weigh' ? 'meter' : 'weighbridge') : key.startsWith('pip') ? 'meter' : 'photo';
      const section = key === 'bdn' ? 'bdn_document' : key.startsWith('lop') ? 'lop_photo' : key.startsWith('vno') ? 'photo_not_signed' : key.startsWith('trk') || key.startsWith('pip') ? 'photo_supplier_measurement' : 'photo_' + key;
      const takenAt = exifToIso(c.exif, S.order.utcOffset || S.survey.utcOffset);
      const bytes = await c.blob.arrayBuffer(); // stored as bytes, not as Blob (iOS IndexedDB Blob bug)
      await sync.addFile({ id: fid, job_id: id, kind, section, mime: c.mime, size: bytes.byteLength, bytes, taken_at: takenAt, exif_datetime_original: c.exif?.dateTimeOriginal || null, exif_offset: c.exif?.offset || null, label: `Photo · ${key}` });
      thumbs.set(fid, URL.createObjectURL(c.blob)); fileStatusCache.set(fid, 'pending');
      return { id: fid, from: c.from, to: c.to, taken_at: takenAt, w: c.width, h: c.height };
    },
    removePhoto: async (p) => {
      const f = await db.get('files', p.id); if (!f) return;
      if (f.status === 'uploaded') await db.put('files', { ...f, removed: true }); else await db.del('files', p.id);
    },
    submit: async () => {
      if (S.meta?.submitted) return;
      const v = await modal('Submit this survey?', form.submitSummary(), [{ label: 'Check again', value: null }, { label: 'Submit', value: 'go', kind: 'primary' }]);
      if (!v) return;
      const sigFiles = {};
      for (const k of form.signatureKeys()) {
        const sig = S.sig[k];
        if (!sig.file_id) {
          const png = await strokesToPng(sig.strokes);
          sig.file_id = fileId('sig');
          await db.put('files', { id: sig.file_id, job_id: id, kind: 'signature', section: 'signature_' + k, mime: 'image/png', size: png.size, bytes: await png.arrayBuffer(), taken_at: null, status: 'pending', attempts: 0, label: 'Signature · ' + (form.SIGLBL[k] || k), created_at: new Date().toISOString() });
        }
        sigFiles[k] = sig.file_id;
      }
      const { payload, fileIds } = form.toPayload(S, { formVersion: job.form_version, sigFiles });
      S.meta = S.meta || {}; S.meta.submitted = true; S.meta.submittedAt = new Date().toISOString();
      await sync.saveLocal(id, S);
      await sync.enqueueSubmission(id, payload, fileIds);
      location.hash = '#/job/' + id + '/status';
    },
  };
  const ctl = mountForm(app, {
    form, job, state: S, readOnly: !!job.read_only, hooks,
    thumb: (fid) => thumbs.get(fid) || null, fileStatus: (fid) => fileStatusCache.get(fid) || null,
  });
  const syncText = (j) => `Open on this device · ${j.synced_at ? (navigator.onLine ? 'Last synced ' : 'Not synced since ') + new Date(j.synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (device time)' : 'Not synced yet'}`;
  const updNet = async () => {
    const files = await db.byIndex('files', 'job_id', id);
    ctl.setNet(navigator.onLine, files.filter((f) => f.status !== 'uploaded' && !f.removed).length);
  };
  ctl.setSync(syncText(job));
  if (job.read_only) ctl.setReadOnly(true, `<div class="ro-wrap">${roBanner(job)}</div>`);
  updNet();
  const onRO = (e) => { if (e.detail.jobId !== id) return; job = e.detail.job || job; ctl.setReadOnly(true, `<div class="ro-wrap">${roBanner({ ...job, read_only: true, read_only_reason: e.detail.reason })}</div>`); };
  const onSynced = (e) => { if (e.detail.jobId !== id) return; ctl.setSync(syncText(e.detail.job)); };
  const onFiles = async (e) => { if (e.detail.jobId !== id) return; await refreshFileStatus(id); updNet(); };
  const onStale = async (e) => {
    if (e.detail.jobId !== id) return;
    const sv = e.detail.server;
    const v = await modal('Newer version on GlobalBQS', `<p>This survey was also saved from another session (version ${esc(e.detail.serverRev)}${sv?.saved_at ? ', ' + esc(new Date(sv.saved_at).toLocaleString()) : ''}). Which version do you want to keep?</p><p class="muted small">The version you do not keep is replaced.</p>`,
      [{ label: 'Use the saved version', value: 'server', kind: 'ghost' }, { label: "Keep this device's version", value: 'mine', kind: 'primary' }]);
    if (!v) return;
    await flush();
    const r = await sync.resolveStale(id, v, sv);
    if (v === 'server' && r.replaced) { toast('Saved version loaded.'); route(); } else toast('This device’s version is saved.');
  };
  const onSignin = (e) => { if (e.detail.jobId === id) toast('Please sign in again on this device to keep syncing.'); };
  const onNet = () => updNet();
  sync.bus.addEventListener('readonly', onRO); sync.bus.addEventListener('synced', onSynced); sync.bus.addEventListener('files', onFiles);
  sync.bus.addEventListener('stale', onStale); sync.bus.addEventListener('signin', onSignin); sync.bus.addEventListener('net', onNet);
  let reloading = false;
  const reloadForm = (msg) => { if (reloading) return; reloading = true; clearTimeout(saveT); saveT = null; toast(msg); route(); };
  const onAdopted = (e) => { if (e.detail.jobId === id) reloadForm('Latest saved version loaded from GlobalBQS.'); };
  const onHide = async () => {
    if (document.visibilityState === 'hidden') { await flush(); sync.pushNow(id); return; }
    // back in front: pick up a newer / fuller version saved on GlobalBQS
    await flush();
    const r = await pullFirst(id);
    if (r && r.pending) { const j = await db.get('jobs', id); const ps = j && j.pending_stale; if (ps) { await db.put('jobs', { ...j, pending_stale: null }); onStale({ detail: { jobId: id, serverRev: ps.rev, server: { rev: ps.rev, saved_at: ps.saved_at, payload: ps.payload } } }); } }
  };
  sync.bus.addEventListener('adopted', onAdopted);
  const onPageHide = () => { flush().then(() => sync.pushNow(id)); };
  // closing the tab or browser with changes not yet sent: ask first (desktop browsers show their own dialog)
  let unsent = false;
  const checkUnsent = () => sync.hasUnsent(id).then((v) => { unsent = v; }).catch(() => {});
  const onBeforeUnload = (e) => { if (saveT || unsent) { onPageHide(); e.preventDefault(); e.returnValue = ''; } };
  const unsentT = setInterval(checkUnsent, 1500);
  document.addEventListener('visibilitychange', onHide); addEventListener('pagehide', onPageHide); addEventListener('beforeunload', onBeforeUnload);
  cleanup = () => {
    flush(); ctl.destroy();
    sync.bus.removeEventListener('readonly', onRO); sync.bus.removeEventListener('synced', onSynced); sync.bus.removeEventListener('files', onFiles);
    sync.bus.removeEventListener('stale', onStale); sync.bus.removeEventListener('signin', onSignin); sync.bus.removeEventListener('net', onNet);
    document.removeEventListener('visibilitychange', onHide); removeEventListener('pagehide', onPageHide); removeEventListener('beforeunload', onBeforeUnload); clearInterval(unsentT); sync.bus.removeEventListener('adopted', onAdopted);
  };
  // a newer server draft found while opening the link, with local unpushed changes: ask now
  if (job.pending_stale) {
    const ps = job.pending_stale; await db.put('jobs', { ...job, pending_stale: null });
    sync.bus.dispatchEvent(new CustomEvent('stale', { detail: { jobId: id, serverRev: ps.rev, server: { rev: ps.rev, saved_at: ps.saved_at, payload: ps.payload } } }));
  } else if (navigator.onLine && !job.read_only) sync.pushDraft(id);
};

// ---------- after submit: where the report stands ----------
const REVIEW_ORDER = ['processing', 'correction', 'resubmitted', 'awaiting_confirmation', 'approved', 'issued'];
const REVIEW_TEXT = {
  processing: ['info', '<b>Submitted. Next step:</b> we will e-mail you the draft report within a few minutes. Please check it and tap <b>Approve</b>, or request a correction. The report is issued to the client only after your confirmation.'],
  awaiting_confirmation: ['warn', '<b>Draft report sent – awaiting your confirmation.</b> Check your e-mail and tap <b>Approve</b>, or request a correction. The report is issued to the client only after your confirmation.'],
  correction: ['info', '<b>Correction requested.</b> GlobalBQS is handling it. If the form needs to be changed, you receive an e-mail with a new link.'],
  resubmitted: ['info', '<b>Corrected survey received.</b> We will e-mail you the updated draft report to confirm.'],
  approved: ['ok', '<b>Confirmed – GlobalBQS will issue the report.</b> Thank you.'],
  issued: ['ok', '<b>Report issued to the client.</b> Thank you.'],
};
const reviewNote = (stg) => { const t = REVIEW_TEXT[stg] || REVIEW_TEXT.processing; return note(t[0], t[1]); };
/** ask GlobalBQS where the report stands (signed-in device, online); true when it changed */
async function refreshReview(id) {
  const job = await db.get('jobs', id);
  if (!job || !job.session || !job.token || !navigator.onLine || !(job.status === 'submitted' || job.job_status === 'submitted')) return false;
  try {
    const r = await call('/job', { query: { token: job.token }, session: job.session });
    const stg = r && r.review && r.review.stage; if (!stg || stg === job.review) return false;
    await db.update('jobs', id, (j) => (j ? { ...j, review: stg, review_at: new Date().toISOString() } : undefined));
    return true;
  } catch { return false; }
}

// ---------- status ----------
V.status = async (id) => {
  const job = await db.get('jobs', id);
  if (!job) { location.replace('#/'); return; }
  const render = async () => {
    const j = await db.get('jobs', id), ob = await db.get('outbox', id);
    const files = (await db.byIndex('files', 'job_id', id)).filter((f) => !ob || (ob.file_ids || []).includes(f.id));
    const sent = ob && ob.status === 'sent', blocked = ob && ob.status === 'blocked';
    const s = j.summary || {};
    const done = sent || j.status === 'submitted', stg = j.review || (done ? 'processing' : null), at = (k) => REVIEW_ORDER.indexOf(stg) >= REVIEW_ORDER.indexOf(k);
    const steps = [
      ['Reviewed and signed by you', 'You reviewed the survey and signed it as the appointed surveyor. Stored on this device.', true],
      ['Submitted', sent ? `Received ${ob.sent_at ? 'at ' + esc(new Date(ob.sent_at).toLocaleString()) : ''}. Submission ID <span class="mono">${esc(ob.result?.submission_id || '—')}</span>.` : done ? 'Received by GlobalBQS.' : blocked ? esc(textFor(ob.last_error)) : navigator.onLine ? 'Sending… keep the app open.' : 'Waiting for signal. Keep the app on your device; it sends by itself. Opening the app ashore speeds it up.', done],
      ['Draft report e-mailed to you', stg === 'correction' ? 'You requested a correction. GlobalBQS is handling it.' : 'We e-mail you the draft report within a few minutes. Check it and tap <b>Approve</b>, or request a correction.', done && at('awaiting_confirmation')],
      ['Confirmed by you', 'The report is issued to the client only after your confirmation.', done && at('approved')],
      ['Report issued to the client', 'GlobalBQS issues the report to the client.', done && at('issued')],
    ];
    const now = steps.findIndex((x) => !x[2]);
    const pill = (f) => (f.status === 'uploaded' ? '<span class="pill ok">Uploaded</span>' : f.status === 'uploading' ? '<span class="pill info">Uploading</span>' : f.status === 'lost' ? '<span class="pill bad">Not sent</span>' : f.status === 'error' ? `<span class="pill warn" title="${esc(f.error || '')}">Retry ${f.attempts || 1}</span>` : '<span class="pill warn">Waiting</span>');
    const failing = files.filter((f) => f.status === 'error' && (f.attempts || 0) >= 2);
    repaint(`${bar(sent ? 'Survey submitted' : blocked ? 'Not sent' : 'Waiting to send', `${esc(s.gbqs_reference || '')} · ${esc(s.vessel_name || '')}`, '#/job/' + id)}
    <div class="content">
      ${done ? reviewNote(stg) : ''}
      ${sent ? note('ok', `<b>Received by GlobalBQS.</b> Submission ID <span class="mono">${esc(ob.result?.submission_id || '')}</span>.${ob.result?.duplicate ? ' (already received earlier)' : ''}`)
        : blocked ? note('bad', `<b>${esc(textFor(ob.last_error))}</b>`)
        : note('warn', '<b>Not sent yet.</b> Everything is safe on this device. Do not delete the app or clear the browser until it shows Submitted.')}
      ${!ob && !done ? note('info', 'No submission on this device.') : ''}
      <div class="card"><ol class="tl">${steps.map((x, i) => `<li class="${x[2] ? 'done' : i === now ? 'now' : ''}"><span class="d">${x[2] ? '✓' : ''}</span><div><b>${x[0]}</b><span>${x[1]}</span></div></li>`).join('')}</ol></div>
      ${ob ? `<div class="card"><div class="row"><h3>Outbox</h3>${sent ? '<span class="pill ok">All uploaded</span>' : `<span class="pill warn">${ob.status === 'sending' ? 'Sending' : 'Waiting'}</span>`}</div>
        <dl class="kv"><dt>Client reference</dt><dd class="mono small">${esc(ob.client_submission_id)}</dd><dt>Form version</dt><dd class="mono">${esc(ob.payload?.form_version || '')}</dd>${ob.last_error && !sent ? `<dt>Last attempt</dt><dd>${esc(textFor(ob.last_error))}</dd>` : ''}</dl>
        <ul class="ob" id="obList"><li><span>Survey data and figures<small>${(JSON.stringify(ob.payload).length / 1024).toFixed(1)} kB</small></span>${sent ? '<span class="pill ok">Sent</span>' : '<span class="pill warn">Waiting</span>'}</li>
        ${files.map((f) => `<li data-file="${esc(f.id)}"><span>${esc(f.label || f.kind)}<small>${((f.size || 0) / 1048576).toFixed(2)} MB${(f.status === 'error' || f.status === 'lost') && f.error_text ? ' · ' + esc(f.error_text) : ''}</small></span>${pill(f)}</li>`).join('')}</ul>
        ${failing.length && !sent ? note('warn', `<b>${failing.length} file${failing.length > 1 ? 's' : ''} could not be uploaded yet.</b> The app keeps trying by itself. Tap <b>Send now</b> to retry immediately; if it keeps failing, contact GlobalBQS operations – your survey stays safe on this device.`) : ''}
        ${!sent && !blocked ? `<button class="btn ghost block" type="button" id="sendNow" ${navigator.onLine ? '' : 'disabled'}>Send now</button>` : ''}</div>` : ''}
      ${note('info', 'Job cancelled by the client while you were offline? Your submission will still be received and checked by ops. You do not need to do anything.')}
      <button class="btn primary block" type="button" data-go="#/">Back to my jobs</button>
    </div>`);
    const sn = $('#sendNow'); if (sn) sn.onclick = () => { sn.disabled = true; sync.processOutbox(id, { force: true }); };
  };
  await render();
  refreshReview(id).then((changed) => { if (changed) render(); });
  let t = null;
  const re = (e) => { if (e.detail && e.detail.jobId && e.detail.jobId !== id) return; clearTimeout(t); t = setTimeout(render, 120); };
  sync.bus.addEventListener('outbox', re); sync.bus.addEventListener('files', re); sync.bus.addEventListener('net', re);
  cleanup = () => { sync.bus.removeEventListener('outbox', re); sync.bus.removeEventListener('files', re); sync.bus.removeEventListener('net', re); };
  if (navigator.onLine) sync.processOutbox(id, { force: true });
};

// ---------- router ----------
async function route() {
  routeSeq++;
  const h = location.hash.replace(/^#/, '') || '/';
  let m;
  try {
    if ((m = /^\/j\/([0-9a-fA-F]{64})\/?$/.exec(h))) return await V.link(m[1]);
    if ((m = /^\/install\/([0-9a-f]{64})$/.exec(h))) return await V.install(m[1]);
    if ((m = /^\/signin\/([0-9a-f]{64})$/.exec(h))) return await V.signin(m[1]);
    if ((m = /^\/takeover\/([0-9a-f]{64})$/.exec(h))) return await V.takeover(m[1]);
    if ((m = /^\/job\/([\w-]+)\/(check|form|status)$/.exec(h))) return await V[m[2]](m[1]);
    if ((m = /^\/job\/([\w-]+)$/.exec(h))) return await V.job(m[1]);
    if (/^\/j\//.test(h)) return errorScreen('Link not valid', textFor('invalid_link'));
    return await V.jobs();
  } catch (e) {
    console.error(e);
    errorScreen('Something went wrong', 'The app ran into a problem. Your saved work is not affected. ' + (e && e.message ? '(' + e.message + ')' : ''), '<button class="btn primary block" type="button" data-reload>Reload</button>');
  }
}

// a manifest whose start_url opens this job (Android/Chrome install from the job page)
function setJobManifest(token) {
  try {
    const base = new URL('./', location.href).href;
    const mf = { name: 'GlobalBQS Forms', short_name: 'GBQS Forms', id: base, start_url: base + '#/j/' + token, scope: base, display: 'standalone', background_color: '#0a1a33', theme_color: '#0a1a33',
      icons: [{ src: base + 'assets/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: base + 'assets/icons/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: base + 'assets/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] };
    const link = document.querySelector('link[rel="manifest"]');
    if (link) link.href = URL.createObjectURL(new Blob([JSON.stringify(mf)], { type: 'application/manifest+json' }));
  } catch { /* keep the static manifest */ }
}

// ---------- service worker + update prompt ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then((reg) => {
    const prompt = (w) => {
      const b = $('#updateBar'); b.hidden = false;
      $('#updateBtn').onclick = () => { reloading = true; w.postMessage({ type: 'skipWaiting' }); };
    };
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => { /* no SW (e.g. http) */ });
}

// ---------- release check ----------
// All modules carry the release version (build). Should the app cache ever hold modules of two releases (e.g. a
// CDN served an old file during an update), drop the app cache and reload once. Drafts (IndexedDB) are untouched.
const MODULES = ['./db.js', './api.js', './sync.js', './ui.js', './photos.js', './forms/registry.js', './forms/engine.js', './forms/calc.js', './forms/components.js', './forms/hire.js', './forms/bunker_delivery.js'];
async function releaseOk() {
  if (!/^\d+\.\d+\.\d+-/.test(ENV.version)) return true; // dev build
  const self = typeof __v !== 'undefined' ? __v : null; // eslint-disable-line no-undef
  const vs = [self, ...(await Promise.all(MODULES.map((m) => import(m + '?v=' + ENV.version).then((x) => x.__v).catch(() => 'missing'))))];
  if (vs.every((v) => v === ENV.version)) { try { sessionStorage.removeItem('gbqs_repair'); } catch { /* */ } return true; }
  let tried = false;
  try { tried = sessionStorage.getItem('gbqs_repair') === ENV.version; sessionStorage.setItem('gbqs_repair', ENV.version); } catch { /* */ }
  if (tried) return true;
  try { for (const k of await caches.keys()) if (k.startsWith('gbqs-forms-')) await caches.delete(k); } catch { /* */ }
  try { for (const r of (await navigator.serviceWorker.getRegistrations())) await r.unregister(); } catch { /* */ }
  location.reload();
  return false;
}

// ---------- boot ----------
async function boot() {
  if (!(await releaseOk())) return;
  // /j/<token> path (static host 404 fallback / SW) -> hash route
  const pm = /\/j\/([0-9a-fA-F]{64})\/?$/.exec(location.pathname);
  if (pm) { location.replace(location.pathname.replace(/j\/[0-9a-fA-F]{64}\/?$/, '') + '#/j/' + pm[1].toLowerCase()); return; }
  if (ENV.isDemo) document.documentElement.classList.add('is-demo');
  await db.ready();
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__bip = e; dispatchEvent(new Event('gbqs:bip')); });
  addEventListener('hashchange', route);
  addEventListener('online', updateNetPills); addEventListener('offline', updateNetPills);
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g && !g.disabled) { e.preventDefault(); location.hash = g.dataset.go; return; }
    if (e.target.closest('[data-reload]')) location.reload();
  });
  sync.setRegenerator(async (f) => {
    if (f.kind !== 'signature') return null;
    const d = await db.get('drafts', f.job_id);
    const sig = d && d.state && d.state.sig ? Object.values(d.state.sig).find((x) => x && x.file_id === f.id) : null;
    if (!sig || !sig.strokes || !sig.strokes.length) return null;
    const png = await strokesToPng(sig.strokes);
    return png ? await png.arrayBuffer() : null;
  });
  sync.startLoop();
  registerSW();
  route();
}
boot();
export { ApiError, offsetMin, ICON };
