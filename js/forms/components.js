export const __v = '1.1.12-20261023-6b99a1aa';
// Shared form components (used by Bunker Delivery now, and by B221 / Bunker / B+C / Condition in phase C):
// fields, segmented buttons, confirm boxes, signature pads with lock/unlock and vessel options,
// photo blocks, tank rows (sounding / ullage / gauge), LOP cards, timesheet, review checklist.
// All renderers read the current form state through `ctx`.
import { esc, ICON, note, nowIn, fmtDate, modal, toast } from '../ui.js?v=1.1.12-20261023-6b99a1aa';
import { parseNum, fx, RANGE } from './calc.js?v=1.1.12-20261023-6b99a1aa';

export const ctx = {
  removePhoto: null, // app hook: drop a photo file (not uploaded / not linked)
  S: null,          // form state (the draft)
  form: null,       // form module
  readOnly: false,
  thumb: () => null, // client_file_id -> object URL (or null when only on the server)
  fileStatus: () => null,
};

// ---------- state paths ----------
export function getPath(p) { return p.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx.S); }
export function setPath(p, v) {
  const k = p.split('.'); const last = k.pop();
  const o = k.reduce((o, x) => { if (o[x] == null) o[x] = /^\d+$/.test(x) ? [] : {}; return o[x]; }, ctx.S);
  o[last] = v;
}
const idOf = (path) => 'f_' + path.replace(/\W/g, '_');

// ---------- time in port LT ----------
export const portOffset = () => ctx.S?.order?.utcOffset || ctx.S?.survey?.utcOffset || '';
export const portNow = () => nowIn(portOffset());
export const stamp = () => { const n = portNow(); return { text: `${fmtDate(n.d)} ${n.t} LT (UTC${portOffset() || '?'})`, local: `${n.d}T${n.t}`, offset: portOffset() || null }; };

// ---------- plausibility ----------
export function numCheck(path, kind) {
  const p = parseNum(getPath(path), kind === 'signed');
  if (p.empty) return null;
  if (p.err) return { err: p.err };
  if ((kind === 'ropes' || kind === 'jobs') && p.dec > 0) return { err: 'Enter a whole number.' };
  let warn = ''; const r = RANGE[kind];
  if (kind === 'dens' && p.n > 2) warn = 'Enter the density in kg/l, e.g. 0.9870.';
  else if (r && (p.n < r[0] || p.n > r[1])) warn = 'Outside ' + r[2] + '. Check the figure.';
  if (kind === 'tov' && ctx.form.tankCapFor) { const cap = ctx.form.tankCapFor(path); if (cap != null && p.n > cap) warn = `More than the tank capacity (${fx(cap, 1)} m³). Check the figure.`; }
  return { n: p.n, dec: p.dec, warn };
}

// ---------- basic fields ----------
export function field(label, path, o = {}) {
  const v = getPath(path) ?? '', id = idOf(path);
  const miss = o.req && (v === '' || v == null);
  const kind = o.kind || 'n';
  return `<div class="field ${o.cls || ''}"><label for="${id}">${label}${o.opt ? ' <span class="opt">(optional)</span>' : ''}</label>
  <div class="ctl${o.unit ? ' has-unit' : ''}"><input id="${id}" class="${o.numeric ? 'num' : ''}${miss ? ' miss' : ''}" data-bind="${path}" type="${o.type || 'text'}" ${o.numeric ? `inputmode="${kind === 'signed' ? 'text' : kind === 'ropes' || kind === 'jobs' ? 'numeric' : 'decimal'}" data-num="${kind}"` : ''} enterkeyhint="next" value="${esc(v)}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} autocomplete="off" ${o.req ? 'data-req="1"' : ''} ${o.max ? `maxlength="${o.max}"` : ''}>${o.unit ? `<span class="unit">${o.unit}</span>` : ''}</div>
  ${o.numeric ? `<p class="pv" data-pv="${path}" data-kind="${kind}" aria-live="polite"></p>` : ''}
  ${o.hint ? `<p class="hint">${o.hint}</p>` : ''}</div>`;
}
export function area(label, path, o = {}) {
  const id = idOf(path);
  return `<div class="field"><label for="${id}">${label}${o.opt ? ' <span class="opt">(optional)</span>' : ''}</label><textarea id="${id}" data-bind="${path}" placeholder="${esc(o.ph || '')}">${esc(getPath(path) ?? '')}</textarea></div>`;
}
/** o.taken: values already used in this list (other rows): shown disabled */
export function selectField(label, path, opts, o = {}) {
  const v = getPath(path) ?? '', id = idOf(path);
  return `<div class="field"><label for="${id}">${label}</label><div class="ctl"><select id="${id}" data-bind="${path}" ${o.req ? 'data-req="1"' : ''} class="${o.req && !v ? 'miss' : ''}"><option value="">${o.placeholder || 'Choose…'}</option>${opts.map(([val, txt]) => { const taken = o.taken && v !== val && o.taken.has(val); return `<option value="${esc(val)}" ${v === val ? 'selected' : ''} ${taken ? 'disabled' : ''}>${esc(txt)}${taken ? ' · already in this list' : ''}</option>`; }).join('')}</select></div>${o.hint ? `<p class="hint">${o.hint}</p>` : ''}</div>`;
}
export function seg(label, path, opts, cls = '') {
  const v = getPath(path);
  return `<div class="field"><span class="lbl">${label}</span><div class="seg ${cls}" role="group" aria-label="${esc(label)}">${opts.map(([val, txt]) => `<button type="button" data-act="set" data-path="${path}" data-val="${esc(val)}" aria-pressed="${v === val}">${txt}</button>`).join('')}</div></div>`;
}
export function confirmBox(path, text, lockPh) {
  const on = !!getPath(path), id = 'c_' + path.replace(/\W/g, '_'), dis = lockPh && signed(lockPh);
  return `<label class="confirm${on ? ' on' : ''}" for="${id}"><input type="checkbox" id="${id}" data-bind="${path}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}><span>${text}</span></label>`;
}

// ---------- signatures & locks ----------
export const hasSig = (k) => !!(ctx.S.sig[k] && ctx.S.sig[k].strokes && ctx.S.sig[k].strokes.length);
export const signed = (ph) => !!ctx.form.PHASE[ph] && ctx.form.PHASE[ph].keys.some(hasSig);
// ---------- signing rule (shared by all forms) ----------
// A phase can only be signed when every section in PHASE[ph].steps is complete (0 open items, not counting
// the signatures/confirmation themselves). So a signed section can never contain open items.
export const phaseOf = (key) => Object.keys(ctx.form.PHASE).find((ph) => ctx.form.PHASE[ph].keys.includes(key)) || null;
export function phaseOpen(ph) {
  const P = ctx.form.PHASE[ph]; if (!P || !P.steps) return [];
  return ctx.form.issues().filter((x) => !x.sign && P.steps.includes(ctx.form.STEPS[x.s]?.id));
}
/** why a signature pad is not usable: 'open' (section incomplete), 'confirm' (tick the confirmation), or null */
export function sigLock(key, lockedBy) {
  if (hasSig(key)) return null;
  const ph = phaseOf(key);
  if (ph && phaseOpen(ph).length) return 'open';
  if (lockedBy && !getPath(lockedBy)) return 'confirm';
  return null;
}
export const SIG_OPEN_MSG = 'Complete the open items in this section before signing';
/** note with the open items (jump links) shown above the signature pads; live-updated via data-calc */
export function sigGate(ph) { return `<div data-calc="siggate:${ph}">${sigGateHtml(ph)}</div>`; }
export function sigGateHtml(ph) {
  if (signed(ph)) return '';
  const L = phaseOpen(ph);
  if (!L.length) return '';
  return `<div class="note warn">${ICON.warn}<div><b>${SIG_OPEN_MSG}.</b> ${L.length} open item${L.length > 1 ? 's' : ''}:
    <ul class="issues" style="margin-top:8px">${L.map((x) => `<li><span><span class="st">${x.s + 1}</span>${esc(x.msg)}</span><button class="btn ghost small" type="button" data-act="goto" data-i="${x.s}" data-tab="${x.tab || ''}" data-keep>Go to</button></li>`).join('')}</ul></div></div>`;
}
export function sigState(key, lock) {
  const s = ctx.S.sig[key];
  if (s && s.strokes && s.strokes.length) return (s.mode === 'receipt' ? 'Signed for receipt only · ' : 'Signed · ') + s.at;
  return lock === 'open' ? SIG_OPEN_MSG : lock === 'confirm' ? 'Tick the confirmation first' : 'Sign with finger, stylus or mouse';
}
export function sigPad(key, role, name, lockedBy) {
  const s = hasSig(key), lock = sigLock(key, lockedBy), locked = !!lock;
  return `<div class="sig${s ? ' signed' : ''}${locked ? ' locked' : ''}" data-sigwrap="${key}" data-lockedby="${lockedBy || ''}">
    <div class="sig-h"><span class="lbl">${role}</span><span class="who">${esc(name || '')}</span></div>
    <canvas data-sig="${key}" ${locked ? `data-locked="${lock}"` : ''} role="img" aria-label="Signature pad, ${esc(role)}"></canvas>
    <div class="sig-f"><span data-sigstate="${key}">${sigState(key, lock)}</span><button class="btn ghost small" type="button" data-act="sigClear" data-key="${key}">Clear</button></div></div>`;
}
/** Vessel signature: sign normally, sign for receipt only, or record that the vessel did not sign */
export function vSig(key, role, name, lockedBy) {
  const S = ctx.S, no = S.vno[key];
  if (no) {
    return `<div class="sig vno">
      <div class="sig-h"><span class="lbl">${role}</span><span class="pill bad">Not signed by vessel</span></div>
      <p class="hint">Recorded ${esc(no.at)}. Submit stays possible; ops is informed and the client will be told.</p>
      ${area('Reason the vessel did not sign', 'vno.' + key + '.reason', { ph: 'E.g. Master refuses to sign, disagrees with the figure of FOT 1S.' })}
      ${photoBlock('vno_' + key, 'Photo (e.g. of a written remark)')}
      <button class="btn ghost small" type="button" data-act="vnoUndo" data-key="${key}" style="justify-self:start">Vessel signs after all</button></div>`;
  }
  const s = hasSig(key), mode = S.smode[key] || 'sign', lock = sigLock(key, lockedBy), locked = !!lock;
  return `<div class="sig${s ? ' signed' : ''}${mode === 'receipt' ? ' receipt' : ''}${locked ? ' locked' : ''}" data-sigwrap="${key}" data-lockedby="${lockedBy || ''}">
    <div class="sig-h"><span class="lbl">${role}</span><span class="who">${esc(name || '')}</span></div>
    ${mode === 'receipt' ? '<span class="pill warn" style="justify-self:start">For receipt only</span>' : ''}
    <canvas data-sig="${key}" ${locked ? `data-locked="${lock}"` : ''} role="img" aria-label="Signature pad, ${esc(role)}"></canvas>
    <div class="sig-f"><span data-sigstate="${key}">${sigState(key, lock)}</span><button class="btn ghost small" type="button" data-act="sigClear" data-key="${key}">Clear</button></div>
    <div class="vbtns"><button class="btn ghost small" type="button" data-act="receipt" data-key="${key}" aria-pressed="${mode === 'receipt'}">Signed for receipt only</button><button class="btn ghost small" type="button" data-act="vno" data-key="${key}">Not signed by vessel</button></div></div>`;
}
export function lockBar(ph) {
  if (!signed(ph)) return '';
  return `<div class="lockbar">${ICON.lock}<div><b>${ctx.form.PHASE[ph].label} are signed and locked.</b> To change a figure, unlock with a reason. This voids the signatures of this part; they must be given again.</div><button class="btn ghost small" type="button" data-act="unlock" data-ph="${ph}">Unlock…</button></div>`;
}

// ---------- photos ----------
export function photoBlock(key, title, req) {
  const ph = ctx.S.photos[key] || [];
  return `<div class="field" style="gap:10px"><div class="card-h"><span class="lbl">${title}${req ? '' : ' <span class="opt">(optional)</span>'}</span>
    <span class="btn ghost small file-btn">Add photos<input type="file" accept="image/*" multiple data-photo="${key}" aria-label="Add photos: ${esc(title)}"></span></div>
    ${ph.length ? `<div class="ph-grid">${ph.map((p, i) => { const u = ctx.thumb(p.id), st = ctx.fileStatus(p.id);
      return `<figure class="ph" style="margin:0">${u ? `<img src="${u}" alt="${esc(title)} ${i + 1}">` : '<div class="ph-none">Saved on GlobalBQS</div>'}<figcaption>${p.from ? fx(p.from / 1048576, 1) + ' → ' : ''}${fx((p.to || 0) / 1048576, 2)} MB${st ? ` · <span class="fst ${st}">${st === 'uploaded' ? 'sent' : st === 'error' ? 'retry' : 'waiting'}</span>` : ''}</figcaption><button type="button" data-act="delPhoto" data-key="${key}" data-i="${i}" aria-label="Remove photo">${ICON.x}</button></figure>`; }).join('')}</div>` : '<p class="empty">No photos yet.</p>'}</div>`;
}

// ---------- tank rows (vessel tanks): sounding / ullage / gauge ----------
export const METHODS = [['S', 'Sounding'], ['U', 'Ullage'], ['G', 'Gauge']];
export const METHOD_KEY = { S: 'sounding', U: 'ullage', G: 'gauge' };
export const tovOf = (t) => (t.method === 'G' ? t.reading : t.tov); // gauge reading is the TOV (m³)

/** a tank is unique per tank list by family + name (case-insensitive); "Serv tk" may exist as fo and as do tank */
export const tankKey = (fam, name) => fam + '|' + String(name || '').trim().toLowerCase();
/** keys of the tanks used in a list, except row `except` */
export function usedTankKeys(list, famOf, except = -1) {
  const u = new Set(); (list || []).forEach((t, k) => { if (k !== except && t && t.name) u.add(tankKey(famOf(t.grade), t.name)); }); return u;
}
/** tank names listed more than once in one list */
export function duplicateTanks(list, famOf) {
  const seen = new Map(), dup = new Set();
  (list || []).forEach((t) => { if (!t || !t.name) return; const k = tankKey(famOf(t.grade), t.name); if (seen.has(k)) dup.add(seen.get(k)); else seen.set(k, t.name); });
  return [...dup];
}
/** number of vessel tanks of a family not yet in the list */
export const freeTanks = (VT, fam, used) => VT.filter((x) => x.fam === fam && !used.has(tankKey(fam, x.name))).length;
/** <select> options for a vessel tank, grouped by grade family (fo / do); tanks already in this list are disabled */
export function tankOptions(t, VT, family, used = new Set(), famLabel = { fo: 'Fuel oil tanks', do: 'Gas oil / diesel tanks' }) {
  const opt = (x) => { const own = x.name === t.name, taken = !own && used.has(tankKey(family, x.name));
    return `<option value="${esc(x.name)}" ${own ? 'selected' : ''} ${taken ? 'disabled' : ''}>${esc(x.name)}${x.isNew ? ' · new' : ''}${taken ? ' · already in this list' : ''}</option>`; };
  const grp = (f) => `<optgroup label="${famLabel[f]}">${VT.filter((x) => x.fam === f).map(opt).join('')}</optgroup>`;
  const sel = t.name && !VT.some((x) => x.fam === family && x.name === t.name) ? `<option value="${esc(t.name)}" selected>${esc(t.name)}</option>` : '';
  return `<option value="" ${t.name ? '' : 'selected'}>Choose a tank…</option>${sel}${grp(family)}<option value="__new">Tank not on the list…</option>`;
}
/**
 * One vessel tank row. o: {VT, family, used (keys in this list, other rows), densHtml (override for the density cell), extraHtml, newHint}
 * Calculated parts render into data-calc="tsum:<phase>:<i>" and "tank:<phase>:<i>" (form CALC).
 */
export function tankCard(phase, t, i, o) {
  const p = `${phase}.tanks.${i}`;
  const sum = `<div class="tank-head"><button class="tank-sum" type="button" data-act="tankToggle" data-phase="${phase}" data-i="${i}" data-keep aria-expanded="${!!t.open}"><span class="tsum" data-calc="tsum:${phase}:${i}"></span>${ICON.chev}</button>
    <button class="icon-btn" type="button" data-act="delTank" data-phase="${phase}" data-i="${i}" aria-label="Remove tank ${esc(t.name || '')}" title="Remove tank">${ICON.x}</button></div>`;
  if (!t.open) return `<div class="tank" data-tank="${phase}:${i}">${sum}</div>`;
  const vt = o.VT.find((x) => x.name === t.name && x.fam === o.family);
  return `<div class="tank open" data-tank="${phase}:${i}">${sum}<div class="tank-body">
    <div class="tank-top">
      <div class="field grow"><label for="tn_${t.id}">Tank</label><div class="ctl"><select id="tn_${t.id}" data-bind="${p}.name" data-tanksel="${phase}:${i}" data-req="1">${tankOptions(t, o.VT, o.family, o.used)}</select></div>
        ${vt && vt.isNew ? '<p class="hint"><span class="pill info">New</span> Added on board; ops will check it and add it to the vessel tank list.</p>' : ''}</div>
      <div class="field"><span class="lbl">Method</span><div class="seg sm" role="group" aria-label="Sounding, ullage or gauge">
        ${METHODS.map(([v, l]) => `<button type="button" data-act="set" data-path="${p}.method" data-val="${v}" aria-pressed="${t.method === v}">${l}</button>`).join('')}</div></div>
    </div>
    ${o.extraHtml || ''}
    <div class="grid">
      ${t.method === 'G' ? field('Gauge reading', p + '.reading', { numeric: 1, unit: 'm³', req: 1, kind: 'tov', hint: 'Volume as read from the gauge = TOV.' })
        : field(t.method === 'U' ? 'Ullage' : 'Sounding', p + '.reading', { numeric: 1, unit: 'm', req: 1 }) + field('Volume (TOV)', p + '.tov', { numeric: 1, unit: 'm³', req: 1, kind: 'tov' })}
      ${field('Temperature', p + '.temp', { numeric: 1, unit: '°C', req: 1, kind: 'temp' })}
      ${o.densHtml != null ? o.densHtml : field('Density @ 15 °C', p + '.dens', { numeric: 1, unit: 'kg/l', req: 1, kind: 'dens' })}
    </div>
    ${t.method !== 'G' ? `<label class="tick"><input type="checkbox" data-bind="${p}.corr" ${t.corr ? 'checked' : ''}> Trim/list corrected</label>` : `<div class="grid two">${field('Remark', p + '.rem', { opt: 1, ph: 'e.g. remote gauge, read in the ECR' })}</div>`}
    <div data-calc="tank:${phase}:${i}"></div>
  </div></div>`;
}
export function calc4(c) {
  return `<div class="calc4"><div><span>VCF 54B (-04)</span><b>${fx(c.vcf, 5)}</b></div><div><span>GSV m³</span><b>${fx(c.gsv, 3)}</b></div><div><span>WCF</span><b>${fx(c.wcf, 4)}</b></div><div class="mt"><span>Weight</span><b>${fx(c.mt, 3)} MT</b></div></div>`;
}
export const CALC_NOTE = '<p class="fnote">VCF per ASTM D1250-04, Table 54B (base 15 °C), rounded to 5 decimals · WCF = density − 0.0011 · Figures are recalculated by GlobalBQS on submission.</p>';

// ---------- Letters of Protest ----------
export const LOPV = [['master', 'Master'], ['ce', 'Chief Engineer'], ['surveyor', 'Surveyor for the vessel']];
export const LOPX = [['supplier', 'Supplier'], ['barge', 'Barge master'], ['truck', 'Truck driver'], ['terminal', 'Terminal'], ['other', 'Other']];
export const LOPS = [['qty', 'Quantity shortfall'], ['quality', 'Quality'], ['delay', 'Delay'], ['sampling', 'Sampling'], ['other', 'Other']];
export const lbl = (L, v) => (L.find((x) => x[0] === v) || ['', ''])[1];
export const newLop = (id) => ({ id, dir: '', by: '', to: '', subject: '', name: '', remarks: '' });
export function lopCard(l, i) {
  const p = `lops.${i}`, out = l.dir === 'out';
  return `<div class="deliv"><div class="card-h"><span class="lbl">Letter of Protest ${i + 1}</span><button class="icon-btn" type="button" data-act="delLop" data-i="${i}" aria-label="Remove Letter of Protest ${i + 1}">${ICON.x}</button></div>
    ${seg('Direction', p + '.dir', [['out', 'Issued by the vessel'], ['in', 'Received by the vessel']])}
    ${l.dir ? `${seg('Issued by', p + '.by', out ? LOPV : LOPX)}${seg(out ? 'Issued to' : 'Received by', p + '.to', out ? LOPX : LOPV)}` : ''}
    ${seg('Subject', p + '.subject', LOPS)}
    <div class="grid two">${field('Name of the person', p + '.name', { opt: 1, ph: out ? 'Who received it' : l.dir === 'in' ? 'Who issued it' : '' })}</div>
    ${photoBlock('lop_' + l.id, 'Photo of the signed LOP', true)}
    ${area('Remarks', p + '.remarks', { opt: 1 })}</div>`;
}

// ---------- timesheet ----------
export const evt = (e) => (e && e.d && e.t ? Date.parse(e.d + 'T' + e.t + ':00Z') : null);
export function sortTs(ev) {
  const pos = [], dated = [];
  ev.forEach((e, i) => { if (evt(e) != null) { pos.push(i); dated.push(e); } });
  dated.sort((a, b) => evt(a) - evt(b)); pos.forEach((p, k) => { ev[p] = dated[k]; });
}
export function moveTs(ev, from, to) { if (to < 0 || to >= ev.length || from === to) return; const [x] = ev.splice(from, 1); ev.splice(to, 0, x); }
export function tsRows(events) {
  const N = events.length;
  return events.map((e, i) => `<div class="ts-row${e.t && e.d ? ' set' : ''}" data-tsrow="${i}"><button class="drag" type="button" data-drag="${i}" aria-label="Drag to reorder: ${esc(e.label)}" title="Drag to reorder">⋮⋮</button>
      <div class="ts-main"><div class="ts-head"><label class="ts-lbl${e.key ? ' key' : ''}" for="tsd_${i}">${esc(e.label)}</label>
        <button class="mini" type="button" data-act="tsUp" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="mini" type="button" data-act="tsDown" data-i="${i}" aria-label="Move down" ${i === N - 1 ? 'disabled' : ''}>↓</button>${e.custom ? `<button class="mini del" type="button" data-act="tsDel" data-i="${i}" aria-label="Remove ${esc(e.label)}">×</button>` : ''}</div>
      <div class="ts-ctl"><div class="dt"><input id="tsd_${i}" type="date" data-bind="ts.events.${i}.d" value="${esc(e.d)}" aria-label="Date, ${esc(e.label)}"><input id="ts_${i}" type="time" data-bind="ts.events.${i}.t" value="${esc(e.t)}" aria-label="Time LT, ${esc(e.label)}"></div><span class="lt">LT</span><button class="btn ghost small" type="button" data-act="now" data-i="${i}">Now</button></div>
      <div class="ts-warn" data-calc="tsw:${i}"></div></div></div>`).join('');
}
export function tsWarn(events, i) {
  const e = events[i];
  if (!e) return '';
  if (e.t && !e.d) return 'Add the date.';
  const a = evt(e); if (a == null) return '';
  for (let j = i - 1; j >= 0; j--) {
    const p = evt(events[j]);
    if (p != null) { if (a < p) return `Out of order — earlier than “${esc(events[j].label)}” (${fmtDate(events[j].d)} ${events[j].t} LT).<button class="btn ghost small" type="button" data-act="sortTs">Sort by time?</button>`; break; }
  }
  return '';
}

// ---------- review checklist ----------
export function reviewList(L) {
  if (!L.length) return note('ok', 'Everything is filled in and signed.');
  return `<ul class="issues">${L.map((x) => `<li><span><span class="st">${x.s + 1}</span>${esc(x.msg)}</span><button class="btn ghost small" type="button" data-act="goto" data-i="${x.s}" data-tab="${x.tab || ''}" data-keep>Go to</button></li>`).join('')}</ul>`;
}
export function flagList(F) {
  if (!F.length) return '<p class="empty">Nothing special. Ops sees the survey as is.</p>';
  return `<ul class="flags">${F.map(([k, t, m]) => `<li><span class="pill ${k}">${t}</span><span>${esc(m)}</span></li>`).join('')}</ul><p class="hint">These do not stop you from submitting; ops follows them up.</p>`;
}

// ---------- UTC offset picker (when the port has no known offset) ----------
export function offsetPicker(path, OFFSETS, deviceOff) {
  const v = getPath(path) || '';
  return `<div class="field"><label for="${idOf(path)}">Local time of the port (UTC offset)</label><div class="ctl"><select id="${idOf(path)}" data-bind="${path}" data-req="1" class="${v ? '' : 'miss'}"><option value="">Choose…</option>${OFFSETS.map((o) => `<option value="${o}" ${o === v ? 'selected' : ''}>UTC${o}${o === deviceOff ? ' (this device)' : ''}</option>`).join('')}</select></div><p class="hint">The port's UTC offset is not known to GlobalBQS. Choose it once; all times in this survey are local time (LT) with this offset.</p></div>`;
}

// ---------- start-check corrections (shared by all forms) ----------
/** gate answers -> contract gate_corrections. nominated: [[grade, nominatedQty]] shown in the grades check */
export function gateCorrectionsFrom(s, nominated = []) {
  const G = s.gate || {}, a = G.answers || {}, f = G.fix || {}, o = s.order, out = [];
  if (a.vessel === 'n') {
    if (f.vessel != null && String(f.vessel).trim() && f.vessel.trim() !== o.vessel) out.push({ field: 'vessel_name', expected_value: o.vessel || null, corrected_value: f.vessel.trim(), expected_survey_type: null, remark: null });
    if (f.imo != null && String(f.imo).trim() && String(f.imo).trim() !== o.imo) out.push({ field: 'imo_number', expected_value: o.imo || null, corrected_value: String(f.imo).trim(), expected_survey_type: null, remark: null });
  }
  if (a.type === 'n' && f.typeExp) out.push({ field: 'survey_type', expected_value: o.type || null, corrected_value: null, expected_survey_type: f.typeExp, remark: f.typeNote || null });
  if (a.grades === 'n') {
    const nom = Object.fromEntries(nominated);
    Object.keys(f).filter((k) => k.startsWith('g_') && String(f[k]).trim()).forEach((k) => {
      const g = k.slice(2); out.push({ field: 'grade_' + g, expected_value: nom[g] ? nom[g] + ' MT' : null, corrected_value: String(f[k]).trim(), expected_survey_type: null, remark: null });
    });
    if (String(f.gradesNote || '').trim()) out.push({ field: 'grades', expected_value: null, corrected_value: null, expected_survey_type: null, remark: f.gradesNote.trim() });
  }
  return out;
}

// ---------- removing a repeatable row ----------
/** photos of a removed row: drop the files (pending ones are not uploaded) and the references */
export function dropPhotos(key) {
  const S = ctx.S; (S.photos[key] || []).forEach((p) => { if (ctx.removePhoto) ctx.removePhoto(p); }); delete S.photos[key];
}
/** any value filled in (ignores ids, open flags and empty values) */
export function rowFilled(o, skip = ['id', 'open']) {
  if (o == null || o === '' || o === false) return false;
  if (Array.isArray(o)) return o.some((x) => rowFilled(x, skip));
  if (typeof o === 'object') return Object.entries(o).some(([k, v]) => !skip.includes(k) && rowFilled(v, skip));
  return true;
}
/** remove a row: short confirmation when something is filled in; returns a promise (true = removed) */
export async function removeRow(title, filled, doRemove, done) {
  if (filled) {
    const v = await modal(title, '<p>What is entered in this row (ratings, remarks, photos) is removed. Open items and totals are updated.</p>', [{ label: 'Cancel', value: null }, { label: 'Remove', value: 'rm', kind: 'danger' }]);
    if (!v) return false;
  }
  doRemove(); if (done) done(); return true;
}
