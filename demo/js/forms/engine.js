export const __v = '1.1.20-20261031-';
// Form runtime: renders one step at a time (step rail + Back/Next), live calculations, locks after signing,
// signature pads, photos, timesheet drag & drop, and the generic actions shared by all forms.
// A form module supplies: STEPS, PHASE, SIGLBL, R (step renderers), CALC, issues(), flags(), act(), title.
import { $, $$, esc, ICON, note, toast, modal, closeModal, modalOpen, LOGO } from '../ui.js?v=1.1.20-20261031-';
import { ctx, getPath, setPath, hasSig, signed, numCheck, stamp, moveTs, sortTs, tsWarn, newLop, sigLock, sigState, sigGateHtml, SIG_OPEN_MSG, removeRow, rowFilled, reveal } from './components.js?v=1.1.20-20261031-';
import { parseNum } from './calc.js?v=1.1.20-20261031-';
import { BUILD } from '../../config.js?v=1.1.20-20261031-';
const APP_VERSION = String(BUILD.version || 'dev').split('-')[0];

export function mountForm(root, opts) {
  const { form, job, hooks } = opts;
  ctx.S = opts.state; ctx.form = form; ctx.readOnly = !!opts.readOnly;
  ctx.removePhoto = (opts.hooks && opts.hooks.removePhoto) || null; ctx.thumb = opts.thumb || (() => null); ctx.fileStatus = opts.fileStatus || (() => null);
  const S = ctx.S;
  S.ui = S.ui || {}; if (S.ui.step == null) S.ui.step = 0;
  let uid = S.meta?.uid || 1000;
  const nextId = () => { uid += 1; S.meta = S.meta || {}; S.meta.uid = uid; return uid; };
  form.nextId = nextId;
  const STEPS = form.STEPS;
  const SI = (id) => STEPS.findIndex((s) => s.id === id);
  form.SI = SI;

  root.innerHTML = `
  <header class="top"><div class="top-in">
    <div class="top-row"><button class="back-link" type="button" data-act="back" data-keep>‹ Job</button>
      <div class="brand">${LOGO}<b>Global<span>BQS</span></b></div>
      <span class="net" id="net" aria-live="polite"><i></i><span id="netTxt">Online</span></span></div>
    <div class="job"><h1>${esc(form.title)}</h1><span class="ref">${esc(S.order.ref)} · ${esc(S.order.vessel)}</span></div>
    <div class="saved"><span id="saved">${S.meta?.savedAt ? 'Saved on this device · ' + esc(S.meta.savedAt) : 'Nothing entered yet'}</span><span id="sync"></span><span>Form ${esc(form.versionLabel)} · app ${esc(APP_VERSION)}</span></div>
  </div></header>
  <div id="roBanner"></div>
  <div class="layout"><nav class="steps" id="steps" aria-label="Form sections"></nav><main id="main"></main></div>
  <div class="foot"><div class="foot-in">
    <button class="btn ghost" type="button" data-act="prev" id="prevBtn" data-keep>Back</button>
    <div class="where" id="where"></div>
    <button class="btn primary" type="button" data-act="next" id="nextBtn" data-keep>Next</button>
    <button class="btn primary" type="button" data-act="submit" id="barSubmit" hidden>Submit</button>
  </div></div>`;

  const main = $('#main', root);
  let ctxNew = {};

  // ---------- render ----------
  function refresh() {
    $$('[data-calc]', main).forEach((el) => { const [k, ...a] = el.dataset.calc.split(':'); if (k === 'siggate') el.innerHTML = sigGateHtml(a[0]); else if (form.CALC[k]) el.innerHTML = form.CALC[k](...a); });
    // signing rule: pads open only when the section is complete (live, without re-render)
    $$('[data-sigwrap]', main).forEach((w) => {
      const key = w.dataset.sigwrap, cv = w.querySelector('canvas[data-sig]'); if (!cv) return;
      const lock = sigLock(key, w.dataset.lockedby || null);
      if (lock) cv.dataset.locked = lock; else delete cv.dataset.locked;
      w.classList.toggle('locked', !!lock);
      const st = w.querySelector('[data-sigstate]'); if (st) st.textContent = sigState(key, lock);
    });
    $$('[data-req]', main).forEach((el) => el.classList.toggle('miss', String(el.value).trim() === ''));
    $$('[data-pv]', main).forEach((el) => {
      const r = numCheck(el.dataset.pv, el.dataset.kind), inp = el.parentElement.querySelector('input[data-num]');
      if (inp) inp.classList.toggle('bad', !!(r && r.err));
      el.className = 'pv' + (r && r.err ? ' err' : '');
      el.innerHTML = !r ? '' : r.err ? esc(r.err) : `= ${r.n.toFixed(r.dec)}${r.warn ? `<span class="w">${esc(r.warn)}</span>` : ''}`;
    });
    $$('.ts-row', main).forEach((r) => { const e = S.ts.events[+r.dataset.tsrow]; if (e) r.classList.toggle('set', !!(e.t && e.d)); });
    const sb = $('#submitBtn', main); if (sb) sb.disabled = ctx.readOnly || form.issues().length > 0 || !!S.meta?.submitted;
    renderSteps();
    if (ctx.readOnly) disableAll();
  }
  function renderSteps() {
    const L = form.issues(); const per = STEPS.map((_, i) => L.filter((x) => x.s === i).length), last = STEPS.length - 1, step = S.ui.step;
    $('#steps', root).innerHTML = STEPS.map((s, i) => {
      const st = per[i] ? 'open' : 'done'; const lastSt = i === last && per[i] === 0 && L.length ? 'open' : st;
      const sep = s.part && (i === 0 || STEPS[i - 1].part !== s.part) ? `<span class="sep">${esc(s.partLabel || 'Part ' + s.part)}</span>` : '';
      return sep + `<button type="button" class="${lastSt}" data-act="goto" data-i="${i}" data-keep ${i === step ? 'aria-current="step"' : ''}><span class="n">${per[i] || i === step ? i + 1 : '✓'}</span><span class="sl">${s.t}</span>${per[i] ? `<span class="cnt">${per[i]}</span>` : ''}</button>`;
    }).join('');
    $('#where', root).innerHTML = `Step <b>${step + 1}</b> of ${STEPS.length} · ${STEPS[step].t}`;
    const pb = $('#prevBtn', root); pb.disabled = step === 0; pb.style.visibility = step === 0 ? 'hidden' : 'visible';
    $('#nextBtn', root).hidden = step === last;
    // last step: Submit in the bar (keeps the bar balanced); enabled once nothing is open
    const bs = $('#barSubmit', root); bs.hidden = step !== last; bs.disabled = ctx.readOnly || L.length > 0 || !!S.meta?.submitted;
  }
  function applyLocks() {
    $$('[data-lockphase]', main).forEach((c) => {
      const on = signed(c.dataset.lockphase); c.classList.toggle('is-locked', on);
      if (on) c.querySelectorAll('input,select,textarea,button').forEach((el) => { if (!el.hasAttribute('data-keep')) el.disabled = true; });
    });
  }
  function disableAll() {
    main.querySelectorAll('input,select,textarea,button').forEach((el) => { if (!el.hasAttribute('data-keep')) el.disabled = true; });
    main.classList.add('ro');
  }
  function render(focusTop) {
    if (S.ui.step >= STEPS.length) S.ui.step = 0;
    const s = STEPS[S.ui.step];
    main.innerHTML = `<div class="step-h step-anim"><span class="eyebrow">Step ${S.ui.step + 1} of ${STEPS.length}</span><h2>${s.t}</h2><p>${s.d}</p></div>` + form.R[s.id]();
    initSigs(); refresh(); applyLocks();
    if (focusTop) window.scrollTo({ top: 0, behavior: 'auto' });
  }
  form.render = render; form.refresh = refresh;

  // ---------- save ----------
  function markSaved() {
    S.meta = S.meta || {};
    const t = form.portNowText();
    S.meta.savedAt = t;
    $('#saved', root).textContent = `Saved on this device · ${t}` + (navigator.onLine ? '' : ' · will send when online');
    hooks.save(S);
  }
  form.markSaved = markSaved;

  // ---------- signature pads ----------
  function initSigs() {
    $$('canvas[data-sig]', main).forEach((cv) => {
      const key = cv.dataset.sig, dpr = window.devicePixelRatio || 1, h = 150;
      let w = cv.clientWidth || 300;
      const c2 = cv.getContext('2d');
      const setup = () => { w = cv.clientWidth || 300; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); c2.setTransform(dpr, 0, 0, dpr, 0, 0); c2.lineCap = 'round'; c2.lineJoin = 'round'; c2.strokeStyle = '#10203d'; c2.lineWidth = 2.2; };
      setup();
      const draw = () => {
        c2.clearRect(0, 0, w, h); c2.save(); c2.strokeStyle = '#c9d2e2'; c2.lineWidth = 1; c2.beginPath(); c2.moveTo(16, h - 34); c2.lineTo(w - 16, h - 34); c2.stroke(); c2.restore();
        const s = S.sig[key]; if (s && s.strokes) s.strokes.forEach((st) => { c2.beginPath(); st.forEach((p, j) => (j ? c2.lineTo(p[0] * w, p[1] * h) : c2.moveTo(p[0] * w, p[1] * h))); c2.stroke(); });
      };
      cv._redraw = () => { setup(); draw(); };
      draw();
      let cur = null;
      const pt = (e) => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * 1000) / 1000, Math.round((e.clientY - r.top) / r.height * 1000) / 1000]; };
      cv.addEventListener('pointerdown', (e) => {
        if (ctx.readOnly) { toast('This copy is read-only.'); return; }
        if (cv.dataset.locked) { toast(cv.dataset.locked === 'open' ? SIG_OPEN_MSG + ' (see the list above).' : 'Tick the confirmation above first.'); return; }
        e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch { /* */ } cur = [pt(e)];
      });
      cv.addEventListener('pointermove', (e) => { if (!cur) return; const p = pt(e), q = cur[cur.length - 1]; cur.push(p); c2.beginPath(); c2.moveTo(q[0] * w, q[1] * h); c2.lineTo(p[0] * w, p[1] * h); c2.stroke(); });
      const end = () => {
        if (!cur) return; const stroke = cur; cur = null;
        if (stroke.length > 2) {
          const first = !hasSig(key); const s = S.sig[key] || { strokes: [], at: '' };
          s.strokes.push(stroke);
          if (first) { const st = stamp(); s.at = st.text; s.at_local = st.local; s.utc_offset = st.offset; }
          s.mode = S.smode[key] || 'sign'; S.sig[key] = s; markSaved();
          if (first) { render(false); if (Object.values(form.PHASE).some((p) => p.keys.includes(key))) toast('Signed. The figures of this part are now locked.'); }
        }
      };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end); cv.addEventListener('pointerleave', end);
    });
  }

  // ---------- events ----------
  function onBind(e) {
    const el = e.target.closest('[data-bind]'); if (!el || !main.contains(el)) return;
    if (ctx.readOnly) return;
    if (el.dataset.tanksel && el.value === '__new') {
      const [ph, i] = el.dataset.tanksel.split(':'); ctxNew = { ph, i: +i }; el.value = getPath(`${ph}.tanks.${i}.name`) || '';
      modal('Add a tank not on the list', `<p>Only for a tank that is missing from this vessel's tank list. It is marked as new; ops checks it and adds it for future jobs.</p>
        <div class="field"><label for="ntName">Tank name as on the vessel's tank tables</label><div class="ctl"><input id="ntName" autocomplete="off" enterkeyhint="next"></div></div>
        <div class="field"><label for="ntCap">Capacity at 100% <span class="opt">(optional)</span></label><div class="ctl has-unit"><input id="ntCap" class="num" inputmode="decimal" autocomplete="off" enterkeyhint="done"><span class="unit">m³</span></div></div>`,
      [{ label: 'Cancel', value: null }, { label: 'Add tank', value: 'add', kind: 'primary' }], {
        validate: () => {
          const name = ($('#ntName').value || '').trim(), capP = parseNum($('#ntCap').value);
          if (!name) { toast('Enter the tank name.'); return false; }
          if (capP.err) { toast('Capacity: ' + capP.err); return false; }
          if (form.tankNameTaken && form.tankNameTaken(ctxNew.ph, ctxNew.i, name)) { toast('This tank is already in this list.'); return false; }
          form.addNewTank(ctxNew.ph, ctxNew.i, name, capP.n ?? null); return true;
        },
      }).then((v) => { if (v) { markSaved(); render(false); toast('Tank added and marked as new for ops'); } });
      return;
    }
    const v = el.type === 'checkbox' ? el.checked : el.value; setPath(el.dataset.bind, v);
    { // timesheet: a time without a date takes the date of the nearest earlier event (same delivery first), else today at the port
      const m = /^ts\.events\.(\d+)\.t$/.exec(el.dataset.bind || '');
      const evs = S.ts && S.ts.events;
      if (m && v && evs && evs[+m[1]] && !evs[+m[1]].d) {
        const i = +m[1], grp = evs[i].dl ?? null; let d = '';
        for (let j = i - 1; j >= 0 && !d; j--) if ((evs[j].dl ?? null) === grp && evs[j].d) d = evs[j].d;
        for (let j = i - 1; j >= 0 && !d; j--) if (evs[j].d) d = evs[j].d;
        if (!d && form.portNow) d = form.portNow().d;
        if (d) { evs[i].d = d; const di = $('#tsd_' + i); if (di) di.value = d; }
      }
    }
    if (form.onBind) form.onBind(el.dataset.bind, v);
    markSaved();
    if (el.type === 'checkbox' || el.tagName === 'SELECT') { render(false); return; }
    refresh();
  }
  async function onChange(e) {
    if (e.target.matches('input[type=time],input[type=date]')) onBind(e);
    const f = e.target.closest('input[data-photo]'); if (!f || !f.files.length) return;
    if (ctx.readOnly) return;
    const key = f.dataset.photo; const files = [...f.files]; f.value = '';
    toast('Reducing photos…');
    for (const file of files) {
      const entry = await hooks.addPhoto(key, file);
      if (entry) (S.photos[key] = S.photos[key] || []).push(entry);
    }
    markSaved(); render(false); toast(`${files.length} photo${files.length > 1 ? 's' : ''} added`);
  }
  async function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled || !root.contains(b)) return;
    const a = b.dataset.act;
    if (a === 'back') { hooks.back(); return; }
    if (a === 'next' && S.ui.step < STEPS.length - 1) { S.ui.step++; hooks.save(S, true); render(true); return; }
    if (a === 'prev' && S.ui.step > 0) { S.ui.step--; hooks.save(S, true); render(true); return; }
    if (a === 'goto') { S.ui.step = +b.dataset.i; const tb = b.dataset.tab, id = STEPS[S.ui.step].id; if ((tb === 'ves' || tb === 'sup') && S.ui.tab && S.ui.tab[id]) S.ui.tab[id] = tb; if (tb && tb.startsWith('ts:')) S.ui.tsTab = tb.slice(3); hooks.save(S, true); render(true); return; }
    if (a === 'tankToggle') { const t = getPath(`${b.dataset.phase}.tanks.${b.dataset.i}`); if (t) { t.open = !t.open; render(false); } return; }
    if (ctx.readOnly) { if (form.readOnlyAct && form.readOnlyAct(a, b)) return; toast('This copy is read-only.'); return; }
    if (form.act && (await form.act(a, b)) === true) return;
    if (a === 'set') {
      const pth = b.dataset.path, v = b.dataset.val;
      const mm = pth.match(/^(\w+)\.tanks\.(\d+)\.method$/);
      if (mm) { const t = getPath(`${mm[1]}.tanks.${mm[2]}`); if (t && (t.method === 'G') !== (v === 'G') && (t.reading || t.tov)) { t.reading = ''; t.tov = ''; toast('Method changed: reading and volume cleared.'); } }
      if (/^lops\.\d+\.dir$/.test(pth) && getPath(pth) !== v) { const l = getPath(pth.replace(/\.dir$/, '')); l.by = ''; l.to = ''; }
      if (form.beforeSet) form.beforeSet(pth, v);
      setPath(pth, v);
      if (form.afterSet) form.afterSet(pth, v);
      if ((pth === 'bdn.lop' || pth === 'lop') && v === 'yes' && !S.lops.length) S.lops.push(newLop(nextId()));
      markSaved(); render(false); return;
    }
    if (a === 'delTank') {
      const arr = getPath(`${b.dataset.phase}.tanks`), t = arr && arr[+b.dataset.i]; if (!t) return;
      const v = await modal(`Remove tank ${t.name ? t.name : '(no name yet)'}?`, '<p>The tank and its readings are removed from this list. Totals and open items are updated.</p>', [{ label: 'Cancel', value: null }, { label: 'Remove tank', value: 'rm', kind: 'danger' }]);
      if (!v) return;
      const k = arr.indexOf(t); if (k >= 0) arr.splice(k, 1);
      markSaved(); render(false); toast('Tank removed'); return;
    }
    if (a === 'addLop') { S.lops.push(newLop(nextId())); markSaved(); render(false); reveal(main.querySelector(`[data-act="delLop"][data-i="${S.lops.length - 1}"]`)?.closest('.deliv')); return; }
    if (a === 'delLop') {
      const l = S.lops[+b.dataset.i]; if (!l) return;
      await removeRow(`Remove Letter of Protest ${+b.dataset.i + 1}?`, rowFilled({ ...l, dir: '' }) || (S.photos['lop_' + l.id] || []).length, () => {
        const k = S.lops.indexOf(l); if (k >= 0) S.lops.splice(k, 1); (S.photos['lop_' + l.id] || []).forEach((p) => hooks.removePhoto(p)); delete S.photos['lop_' + l.id];
      }, () => { markSaved(); render(false); toast('Letter of Protest removed'); });
      return;
    }
    if (['tsUp', 'tsDown', 'tsDel', 'sortTs', 'addEv'].includes(a) && form.PHASE.ts && signed('ts')) { toast('The timesheet is signed. Unlock it first.'); return; }
    if (a === 'tsUp' || a === 'tsDown') { const i = +b.dataset.i, to = b.dataset.to !== undefined && b.dataset.to !== '' ? +b.dataset.to : (a === 'tsUp' ? i - 1 : i + 1); moveTs(S.ts.events, i, to); markSaved(); render(false); const nb = main.querySelector(`[data-act="${a}"][data-i="${to}"]`); if (nb && !nb.disabled) nb.focus(); return; }
    if (a === 'tsDel') {
      const ev = S.ts.events[+b.dataset.i]; if (!ev) return;
      const drop = () => { const k = S.ts.events.indexOf(ev); if (k >= 0) S.ts.events.splice(k, 1); markSaved(); render(false); toast('Event removed'); };
      if (ev.key) { // standard key event: used for pump rate and waiting times
        const v = await modal(`Remove “${ev.label}”?`, '<p>This event is used to calculate the pump rate and waiting times. Only remove it if it did not happen during this delivery. You can add it again with “Add event”.</p>', [{ label: 'Cancel', value: null }, { label: 'Remove', value: 'rm', kind: 'danger' }]);
        if (v === 'rm') drop();
        return;
      }
      await removeRow(`Remove “${ev.label}”?`, !!ev.t, () => { const k = S.ts.events.indexOf(ev); if (k >= 0) S.ts.events.splice(k, 1); }, () => { markSaved(); render(false); toast('Event removed'); });
      return;
    }
    if (a === 'sortTs') { sortTs(S.ts.events); markSaved(); render(false); toast('Sorted by date and time'); return; }
    if (a === 'now') { const i = +b.dataset.i, n = form.portNow(); Object.assign(S.ts.events[i], { d: n.d, t: n.t }); markSaved(); const di = $('#tsd_' + i), ti = $('#ts_' + i); if (di) di.value = n.d; if (ti) ti.value = n.t; refresh(); return; }
    if (a === 'sigClear') { delete S.sig[b.dataset.key]; markSaved(); render(false); return; }
    if (a === 'receipt') { const k = b.dataset.key, on = (S.smode[k] || 'sign') !== 'receipt'; S.smode[k] = on ? 'receipt' : 'sign'; if (S.sig[k]) S.sig[k].mode = S.smode[k]; markSaved(); render(false); toast(on ? 'Marked: signed for receipt only' : 'Normal signature'); return; }
    if (a === 'vno') {
      const k = b.dataset.key;
      const v = await modal('Are you sure?', '<p>The vessel did not sign. The client will be informed.</p>', [{ label: 'Cancel', value: null }, { label: 'Yes', value: 'yes', kind: 'danger' }]);
      if (v) { delete S.sig[k]; const st = stamp(); S.vno[k] = { reason: '', at: st.text, at_local: st.local, utc_offset: st.offset }; markSaved(); render(false); toast('Recorded: not signed by vessel. Enter the reason.'); }
      return;
    }
    if (a === 'vnoUndo') { delete S.vno[b.dataset.key]; markSaved(); render(false); return; }
    if (a === 'unlock') {
      const ph = b.dataset.ph, P = form.PHASE[ph];
      const v = await modal('Unlock ' + P.label.toLowerCase() + '?', `<p>Unlocking voids the signatures of this part: ${P.keys.map((k) => form.SIGLBL[k]).join(' and ')}. They must sign again after your change. The reason and time are recorded and shown to ops.</p>
        <div class="field"><label for="unlockReason">Reason for the change (required)</label><textarea id="unlockReason" placeholder="E.g. typing error in the temperature of FOT 2P."></textarea></div>`,
      [{ label: 'Cancel', value: null }, { label: 'Unlock and void signatures', value: 'go', kind: 'danger' }], {
        validate: () => { const r = ($('#unlockReason').value || '').trim(); if (!r) { toast('Enter the reason first.'); $('#unlockReason').focus(); return false; } ctxNew.reason = r; return true; },
      });
      if (v) { P.keys.forEach((k) => { delete S.sig[k]; delete S.vno[k]; }); if (P.confirm) setPath(P.confirm, false); S.audit.push({ label: P.label, reason: ctxNew.reason, at: stamp().text }); markSaved(); render(false); toast('Unlocked. Signatures voided; sign again after the change.'); }
      return;
    }
    if (a === 'delPhoto') { const arr = S.photos[b.dataset.key]; const [p] = arr.splice(+b.dataset.i, 1); if (p) hooks.removePhoto(p); markSaved(); render(false); return; }
    if (a === 'submit') { await hooks.submit(); return; }
  }
  function onKey(e) {
    if (e.key === 'Escape' && modalOpen()) { closeModal(); return; }
    if (e.key === 'Enter' && e.target.matches('main input[enterkeyhint="next"]')) {
      e.preventDefault();
      const els = [...main.querySelectorAll('input[enterkeyhint="next"]:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
      const i = els.indexOf(e.target); if (els[i + 1]) els[i + 1].focus(); else $('#nextBtn', root).focus();
    }
  }

  // ---------- timesheet drag & drop (pointer events: mouse, pen, touch) ----------
  let drag = null;
  function onPointerDown(e) {
    const h = e.target.closest('[data-drag]'); if (!h || drag || !main.contains(h)) return;
    if (ctx.readOnly) return;
    if (form.PHASE.ts && signed('ts')) { toast('The timesheet is signed. Unlock it first.'); return; }
    e.preventDefault();
    const row = h.closest('.ts-row'), list = row.parentElement, r = row.getBoundingClientRect();
    const ph = document.createElement('div'); ph.className = 'ts-ph'; ph.style.height = r.height + 'px'; list.insertBefore(ph, row);
    row.classList.add('dragging'); Object.assign(row.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', zIndex: 50, pointerEvents: 'none' });
    drag = { row, ph, list, from: +row.dataset.tsrow, dy: e.clientY - r.top, y: e.clientY };
    try { h.setPointerCapture(e.pointerId); } catch { /* */ }
    const loop = () => {
      if (!drag) return; const m = 90, foot = 96; let v = 0;
      if (drag.y < m) v = -Math.ceil((m - drag.y) / 6); else if (drag.y > innerHeight - foot) v = Math.ceil((drag.y - (innerHeight - foot)) / 6);
      if (v) { window.scrollBy(0, v); placeDrag(); } drag.raf = requestAnimationFrame(loop);
    };
    drag.raf = requestAnimationFrame(loop);
  }
  function placeDrag() {
    const { row, ph, list } = drag; row.style.top = (drag.y - drag.dy) + 'px';
    let before = null; for (const s of list.querySelectorAll('.ts-row:not(.dragging)')) { const bb = s.getBoundingClientRect(); if (drag.y < bb.top + bb.height / 2) { before = s; break; } }
    if (before) { if (ph.nextSibling !== before) list.insertBefore(ph, before); } else if (list.lastElementChild !== ph) list.appendChild(ph);
  }
  const onPointerMove = (e) => { if (!drag) return; e.preventDefault(); drag.y = e.clientY; placeDrag(); };
  const endDrag = () => {
    if (!drag) return; cancelAnimationFrame(drag.raf);
    const { row, ph, list, from } = drag; let k = 0; const vis = [];
    for (const c of list.children) { if (c === ph) k = vis.length; else if (c.classList.contains('ts-row') && c !== row) vis.push(+c.dataset.tsrow); }
    // k = visible position; map to the real array index (rows of other timesheet tabs are not in the list)
    let to = from; if (vis.length) { const t = k < vis.length ? vis[k] : vis[vis.length - 1]; to = k < vis.length ? (from < t ? t - 1 : t) : (from < t ? t : t + 1); }
    drag = null; ph.remove(); row.removeAttribute('style'); row.classList.remove('dragging');
    if (to !== from) { moveTs(S.ts.events, from, to); markSaved(); } render(false);
  };
  const onTouchMove = (e) => { if (drag) e.preventDefault(); };
  // The Back/Next bar is plain CSS (position:fixed; bottom:0). JS only hides it while the on-screen keyboard
  // is open, so it never floats over the form. No offsets are computed (1.1.2 shifted it up on iPad Safari).
  const foot = $('.foot', root), vv = window.visualViewport;
  const placeFoot = () => {
    if (!foot) return;
    const ae = document.activeElement;
    const typing = ae && (/^(TEXTAREA|SELECT)$/.test(ae.tagName) || (ae.tagName === 'INPUT' && !/^(checkbox|radio|button|file)$/.test(ae.type)));
    const kb = !!(vv && typing && vv.height < window.innerHeight - 150);
    foot.classList.toggle('kb-open', kb);
  };
  if (vv) { vv.addEventListener('resize', placeFoot); vv.addEventListener('scroll', placeFoot); }
  window.addEventListener('scroll', placeFoot, { passive: true });
  document.addEventListener('focusin', placeFoot); document.addEventListener('focusout', () => setTimeout(placeFoot, 50));
  let rz; const onResize = () => { clearTimeout(rz); rz = setTimeout(() => $$('canvas[data-sig]', main).forEach((cv) => cv._redraw && cv._redraw()), 150); };

  root.addEventListener('input', onBind);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('resize', onResize);

  render(false);

  return {
    render, refresh,
    setReadOnly(on, bannerHtml) { ctx.readOnly = on; $('#roBanner', root).innerHTML = bannerHtml || ''; render(false); },
    setNet(onlineNow, waiting) {
      const n = $('#net', root); if (!n) return;
      n.classList.toggle('off', !onlineNow);
      $('#netTxt', root).innerHTML = (onlineNow ? 'Online' : 'Offline') + (waiting ? ` <span class="q">${waiting} waiting</span>` : '');
    },
    setSync(text) { const s = $('#sync', root); if (s) s.textContent = text; },
    destroy() {
      root.removeEventListener('input', onBind); root.removeEventListener('change', onChange); root.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove); document.removeEventListener('pointerup', endDrag); document.removeEventListener('pointercancel', endDrag);
      document.removeEventListener('touchmove', onTouchMove); window.removeEventListener('resize', onResize);
      if (vv) { vv.removeEventListener('resize', placeFoot); vv.removeEventListener('scroll', placeFoot); }
      window.removeEventListener('scroll', placeFoot); document.removeEventListener('focusin', placeFoot);
      closeModal();
    },
  };
}
export { note, ICON };
