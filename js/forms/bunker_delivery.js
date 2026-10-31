export const __v = '1.1.20-20261031-490c8eb1';
// Bunker Delivery Survey (form_key bunker_delivery_survey) - port of the approved mockup "as received",
// with prefill from the job, and the submit payload in contract gbqs.forms/1.
import { esc, ICON, note, toast, modal, offsetMin, deviceOffset, OFFSETS } from '../ui.js?v=1.1.20-20261031-490c8eb1';
import { parseNum, num, fx, sgn, r2, kgl, vcf54b, weigh } from './calc.js?v=1.1.20-20261031-490c8eb1';
import {
  ctx, getPath, field, area, selectField, seg, confirmBox, vSig, sigPad, lockBar, photoBlock, tankCard, calc4, CALC_NOTE,
  tovOf, METHOD_KEY, lopCard, LOPV, LOPX, LOPS, lbl, evt, sortTs, tsRows, tsWarn, reviewList, flagList, hasSig, signed, portNow, portOffset, offsetPicker, sigGate,
  tankKey, usedTankKeys, duplicateTanks, freeTanks, removeRow, rowFilled, reveal,
} from './components.js?v=1.1.20-20261031-490c8eb1';

export const key = 'bunker_delivery_survey';
export const title = 'Bunker Delivery Survey';
export const versionLabel = 'BDS 1.0';

const BASE_GRADES = ['VLSFO', 'HSFO', 'LSMGO', 'MDO'];
const DO_GRADES = ['LSMGO', 'MGO', 'MDO', 'DMA', 'DMB', 'DMZ', 'ULSMGO'];
const famOf = (g) => (DO_GRADES.includes(String(g).toUpperCase()) ? 'do' : 'fo');
const S = () => ctx.S;
const GRADES = () => Object.keys(S().grades);
const active = () => GRADES().filter((g) => S().grades[g].on);
const TOL = () => +S().order.tol || 0.5;

export const STEPS = [
  { id: 'vessel', t: 'Vessel & survey', d: 'Order details are filled in for you. Add what you find on board.' },
  { id: 'stem', t: 'Bunker stem', d: 'Tick each grade being delivered, with the nominated quantity and supplier.' },
  { id: 'before', t: 'Before bunkering', d: 'Sound every tank of the delivered grades before the hose is connected.' },
  { id: 'after', t: 'After bunkering', d: 'Sound the same tanks plus any tank that received fuel.' },
  { id: 'bdn', t: 'BDN, samples & seals', d: 'After delivery: one block per BDN with quantity, density and samples. The tanks after bunkering recalculate as soon as the BDN density is in.' },
  { id: 'result', t: 'Result & BDN', d: 'Ship figures against the bunker delivery notes (BDN).' },
  { id: 'time', t: 'Timesheet', d: 'Tap Now as each event happens, or enter the local date and time.' },
  { id: 'submit', t: 'Photos & submit', d: 'Add the photos, check the open items, review and submit.' },
];
const SI = (id) => STEPS.findIndex((s) => s.id === id);
export const PHASE = {
  // steps: the sections that must be complete (0 open items) before this phase can be signed
  before: { keys: ['beforeMaster', 'beforeSurveyor'], label: 'Before-bunkering figures', confirm: 'before.confirm', steps: ['stem', 'before'] },
  final: { keys: ['finalMaster', 'finalSurveyor'], label: 'Final figures', confirm: 'bdn.confirm', steps: ['after', 'bdn', 'result'] },
  ts: { keys: ['ts'], label: 'Timesheet', confirm: null, steps: ['time'] },
};
export const SIGLBL = { beforeMaster: 'Master / C/E, before bunkering', beforeSurveyor: 'Surveyor, before bunkering', finalMaster: 'Master / C/E, final figures', finalSurveyor: 'Surveyor, final figures', ts: 'Master / C/E, timesheet' };

// Timesheet: the 13 standard events map 1:1 to the survey_timesheets columns on the server
const TS_DEFAULT = [
  ['Left base / office', 'left_base_office'], ['Arrived at jetty (launch)', 'arrived_jetty'], ['Left jetty by launch', 'left_jetty'],
  ['Arrived at the vessel', 'arrived_vessel'], ['On board the vessel', 'onboard_vessel'], ['Supply barge arrived alongside', 'supply_arrived_vessel'],
  ['Hose connected', 'hose_connected'], ['Pumping commenced', 'pumping_commenced'], ['Pumping completed', 'pumping_completed'],
  ['Hose disconnected', 'hose_disconnected'], ['Documents / BDN signed', 'documents_bdn_signed'], ['Left the vessel', 'left_vessel'], ['Back at base', 'back_at_base'],
];
const KEY_EVENTS = ['hose_connected', 'pumping_commenced', 'pumping_completed', 'hose_disconnected'];
// events that belong to one delivery (barge/truck/pipeline) when several deliveries have their own times
const DL_CODES = ['supply_arrived_vessel', 'hose_connected', 'pumping_commenced', 'pumping_completed', 'hose_disconnected', 'documents_bdn_signed'];
const TSEV = [['supply_arrived_vessel', 'Barge alongside'], ['hose_connected', 'Hoses connected'], ['pumping_commenced', 'Pumping started'], ['pump_stop', 'Pumping stopped – barge shifting'], ['pump_resume', 'Pumping resumed'], ['pumping_completed', 'Pumping completed'], ['hose_disconnected', 'Hoses disconnected'], ['sampling_completed', 'Sampling completed'], ['barge_cast_off', 'Barge cast off'], ['documents_bdn_signed', 'Documents signed'], ['surveyor_disembarked', 'Surveyor disembarked'], ['other', 'Other…']];
const POINTS = [['vessel', 'Vessel manifold (drip sampler)'], ['barge', 'Barge manifold'], ['inline', 'In-line sampler (flow meter)'], ['other', 'Other, see remarks']];
const STYPES = [['marpol', 'MARPOL'], ['ship', 'Ship'], ['supplier', 'Supplier'], ['other', 'Other']];
const STYPE_NAME = { marpol: 'MARPOL Retained Sample', ship: 'Ship Sample', supplier: 'Supplier Sample' };
const NOREASON = [['notprovided', 'Not provided by supplier'], ['notwitnessed', 'Not witnessed'], ['other', 'Other']];
const BYL = { barge: 'Barge', truck: 'Truck', pipeline: 'Pipeline' };
const BT_METHODS = [['sounding', 'Sounding'], ['ullage', 'Ullage'], ['gauge', 'Gauge']];

// ---------- state ----------
let uidSeed = 1;
let initing = false;
const nid = () => (!initing && ctx.S && ctx.form && ctx.form.nextId ? ctx.form.nextId() : uidSeed++);
const T = (grade, name, method, ph, x) => Object.assign({ id: nid(), grade, name, method, reading: '', tov: '', temp: '', dens: '', ph, densAuto: ph === 'after', corr: false, open: true, emptyBefore: false, rem: '' }, x || {});
const D = () => ({ id: nid(), bdn: '', by: '', name: '', qty: '', dens: '', point: '', seals: { marpol: '', ship: '', supplier: '', other: '' }, samples: '', noReason: '', noRemark: '', extra: [], btanks: [], truck: { type: 'weigh', b: '', a: '' }, pipe: { meter: '', factor: '', b: '', a: '' } });
const BM = () => ({ method: 'sounding', reading: '', trim: '', list: '', gauge: '', tov: '', temp: '', rem: '' });

/** Fresh form state from the job prefill (gbqs_form_prefill). */
export function initState(prefill) {
  uidSeed = 1; initing = true;
  try { return buildState(prefill); } finally { initing = false; }
}
function buildState(prefill) {
  const p = prefill || {};
  const sv = p.survey || {}, port = p.port || {}, ves = p.vessel || {}, par = p.parties || {}, nom = p.nomination || {}, sch = p.schedule || {};
  const delivs = Array.isArray(nom.deliveries) ? nom.deliveries : [];
  const grades = {};
  const names = [...BASE_GRADES];
  delivs.forEach((d) => { const g = String(d.grade || '').toUpperCase(); if (g && !names.includes(g)) names.push(g); });
  for (const g of names) {
    const d = delivs.find((x) => String(x.grade || '').toUpperCase() === g);
    const del = D();
    if (d && d.bdn_number) del.bdn = String(d.bdn_number);
    grades[g] = { on: !!(d && (d.nominated_mt != null || d.bdn_mt != null)), nominated: d && d.nominated_mt != null ? String(d.nominated_mt) : '', supplier: (d && d.supplier) || nom.supplier_name || '', rep: '', del: [del] };
  }
  const tanks = p.tanks || {};
  const VT = [];
  for (const fam of ['fo', 'do']) for (const t of tanks[fam] || []) if (t && t.tank_name) VT.push({ name: t.tank_name, fam, cap: t.capacity_m3 != null ? +t.capacity_m3 : null, isNew: false, src: t.source });
  const off = port.utc_offset && offsetMin(port.utc_offset) != null ? port.utc_offset : '';
  const place = port.place || port.name || '';
  return {
    v: 1, form_key: key,
    order: {
      ref: sv.gbqs_reference || '', report: sv.report_number || '', vessel: ves.name || '', imo: ves.imo ? String(ves.imo) : '', place, port: port.name || '',
      etb: sch.etb || sch.eta || '', type: sv.survey_type_label || title, utcOffset: off, tol: p.tolerance_pct ?? p.client?.delivery_tolerance_pct ?? 0.5,
      client: p.client?.name || '', owner: par.owner || '', charterer: par.charterer || '', agent: par.agent || '', po: sv.po_number || '', instructions: sv.instructions || '',
      orderedText: nom.ordered_quantities || '',
    },
    survey: { registry: '', master: sv.master_name || '', chief: '', surveyor: p.surveyor?.name || '', date: '', time: '', draftFwd: '', draftAft: '', listSide: '', list: '', utcOffset: '' },
    VT, grades,
    before: { tanks: [], logbook: {}, confirm: false },
    after: { tanks: [], consumed: {} },
    newEv: { type: '', other: '', dl: '' }, sup: { mode: '', reason: '' }, ui: { tab: { before: 'ves', after: 'ves' }, step: 0 },
    bdn: { lop: '', remMaster: '', remSurveyor: '', confirm: false },
    ts: { location: place, remarks: '', events: TS_DEFAULT.map(([label, code], i) => ({ id: 900 + i, label, code, d: '', t: '', key: KEY_EVENTS.includes(code) })) },
    photos: { bdn: [], seals: [], other: [] },
    sig: {}, smode: {}, vno: {}, audit: [], lops: [], final: false,
    gate: { answers: {}, fix: {}, done: false },
    meta: { uid: 2000, savedAt: null, submitted: false },
  };
}

export const portNowText = () => `${portNow().t} LT`;
export { portNow };

// ---------- helpers ----------
const tankCap = (name, fam) => { const t = S().VT.find((x) => x.name === name && (!fam || x.fam === fam)); return t && t.cap != null ? t.cap : null; };
export function tankCapFor(path) { const m = path.match(/^(before|after)\.tanks\.(\d+)\./); if (!m) return null; const t = S()[m[1]].tanks[+m[2]]; return t ? tankCap(t.name, famOf(t.grade)) : null; }
const inBefore = (t) => S().before.tanks.some((b) => b.grade === t.grade && b.name === t.name);
const afterOnly = (t) => t.ph === 'after' && t.name && !inBefore(t);
function wDens(list) {
  const L = list.map((d) => ({ q: num(d.qty), r: kgl(num(d.dens)) })).filter((x) => x.r != null); if (!L.length) return null;
  if (L.every((x) => x.q != null && x.q > 0)) { const q = L.reduce((s, x) => s + x.q, 0); return Math.round(L.reduce((s, x) => s + x.q * x.r, 0) / q * 10000) / 10000; }
  return L[0].r;
}
const bdnDens = (g) => wDens(S().grades[g].del);
const awaitingBdn = (t) => t.ph === 'after' && t.densAuto !== false && bdnDens(t.grade) == null && num(tovOf(t)) != null && num(t.temp) != null;
function bdnQty(g) { const d = S().grades[g].del; if (!d.length) return null; let s = 0; for (const x of d) { const q = num(x.qty); if (q == null) return null; s += q; } return r2(s); }
function rawGsv(tov, temp, dens) { const T = num(tov), v = vcf54b(dens, temp); return (T == null || v == null) ? null : T * v; }
// After bunkering: density = BDN density (weighted), or for a tank that held ROB the volume-weighted mix of ROB and new fuel
function autoDens(t) {
  const bdn = bdnDens(t.grade); if (bdn == null) return null;
  const prev = S().before.tanks.find((b) => b.grade === t.grade && b.name && b.name === t.name);
  const robGsv = prev ? rawGsv(tovOf(prev), prev.temp, prev.dens) : null, robD = prev ? kgl(num(prev.dens)) : null;
  if (!robGsv || robD == null) return { d: bdn, src: 'bdn' };
  let d = bdn, gA = null, gNew = null;
  for (let k = 0; k < 5; k++) {
    gA = rawGsv(tovOf(t), t.temp, d); if (gA == null) return { d: bdn, src: 'bdn' }; gNew = gA - robGsv;
    if (gNew <= 0) return { d: robD, src: 'rob', rob: robGsv, robD };
    d = (robGsv * robD + gNew * bdn) / gA;
  }
  return { d: Math.round(d * 10000) / 10000, src: 'mix', rob: robGsv, robD, nw: gNew, bdn };
}
function effDens(t) { if (t.ph === 'after' && t.densAuto !== false) { const a = autoDens(t); return a ? a.d : null; } return kgl(num(t.dens)); }
export function calcTank(t) { return weigh(num(tovOf(t)), t.temp, effDens(t)); }
function phaseTotal(phase, g) {
  const ts = S()[phase].tanks.filter((t) => t.grade === g); if (!ts.length) return null;
  let sum = 0; for (const t of ts) { const c = calcTank(t); if (!c) return null; sum += c.mt; }
  return r2(sum);
}
function results() {
  return active().map((g) => {
    const before = phaseTotal('before', g), after = phaseTotal('after', g), cons = num(S().after.consumed[g]) || 0;
    const delivered = (before != null && after != null) ? r2(after - before + cons) : null;
    const nominated = num(S().grades[g].nominated), bdn = bdnQty(g);
    const diff = (delivered != null && bdn != null) ? r2(delivered - bdn) : null;
    const pct = (diff != null && bdn) ? diff / bdn * 100 : null;
    const barge = supGrade(g);
    return { g, before, after, cons, delivered, nominated, bdn, diff, pct, barge, within: pct == null ? null : Math.abs(pct) <= TOL() + 1e-9 };
  });
}
const allDel = () => active().flatMap((g) => S().grades[g].del.map((d, j) => ({ g, d, j })));
// deliveries for the timesheet: one per BDN block (grade + barge/truck/pipeline)
const delivs = () => allDel().map(({ g, d, j }) => ({ id: d.id, g, d, label: `${g} · ${String(d.name || '').trim() || (d.by ? BYL[d.by] : '') || 'Delivery ' + (j + 1)}` }));
const dlLabel = (id) => { const x = delivs().find((v) => v.id === id); return x ? x.label : null; };
const tsSplit = () => S().ts.events.some((e) => e.dl != null);
// timesheet tabs (times per delivery): 'c' = common events, '<delivery id>' = that delivery, 'all' = everything
const tsTabs = () => (tsSplit() && delivs().length > 1 ? [['c', 'Common'], ...delivs().map((x) => [String(x.id), x.label]), ['all', 'All events']] : null);
const tsTab = () => { const T = tsTabs(); if (!T) return null; const t = S().ui.tsTab; return T.some((x) => x[0] === t) ? t : 'c'; };
const tsShow = (t) => (t == null || t === 'all' ? null : t === 'c' ? (e) => e.dl == null : (e) => String(e.dl) === t);
const tsTabOf = (e) => (e.dl == null ? 'c' : String(e.dl));
const bargeDens = (g, d) => wDens([d]) ?? bdnDens(g);
function bargePhase(g, d, t, k) { const m = t[k]; return weigh(num(m.method === 'gauge' ? m.gauge : m.tov), m.temp, bargeDens(g, d)); }
function bargeTankDel(g, d, t) { if (!t) return null; const b = bargePhase(g, d, t, 'b'), a = bargePhase(g, d, t, 'a'); return b && a ? Math.round((b.mt - a.mt) * 1000) / 1000 : null; }
const corrected = (m) => { const r = num(m.reading); if (r == null) return null; return Math.round((r + (num(m.trim, 1) || 0) + (num(m.list, 1) || 0)) * 1000) / 1000; };
function supDel(g, d) {
  if (S().sup.mode !== 'measured') return null;
  if (d.by === 'barge') { if (!d.btanks.length) return null; let s = 0; for (const t of d.btanks) { const x = bargeTankDel(g, d, t); if (x == null) return null; s += x; } return { v: r2(s), u: 'MT' }; }
  if (d.by === 'truck') { const b = num(d.truck.b), a = num(d.truck.a); if (b == null || a == null) return null; return d.truck.type === 'weigh' ? { v: r2(b - a), u: 'MT' } : { v: r2(a - b), u: 'm³' }; }
  if (d.by === 'pipeline') { const b = num(d.pipe.b), a = num(d.pipe.a); if (b == null || a == null) return null; return { v: r2((a - b) * (num(d.pipe.factor) || 1)), u: 'm³' }; }
  return null;
}
function supGrade(g) { const L = S().grades[g].del; if (S().sup.mode !== 'measured' || !L.length) return null; let s = 0; for (const d of L) { const x = supDel(g, d); if (!x || x.u !== 'MT') return null; s += x.v; } return r2(s); }
/** net pumping minutes; dl = delivery id (its own events plus the events for all deliveries) */
function pumping(dl) {
  const ev = S().ts.events.filter((e) => evt(e) != null && (dl == null || e.dl == null || e.dl === dl)).sort((a, b) => evt(a) - evt(b));
  const own = (code) => (dl != null && ev.some((e) => e.code === code && e.dl === dl) ? ev.filter((e) => e.code === code && e.dl === dl) : ev.filter((e) => e.code === code));
  const st = own('pumping_commenced')[0], en = own('pumping_completed').slice(-1)[0]; if (!st || !en || evt(en) < evt(st)) return null;
  let m = (evt(en) - evt(st)) / 60000, stop = null, stops = 0;
  for (const e of ev) { const x = evt(e); if (x < evt(st) || x > evt(en)) continue; if (e.code === 'pump_stop' && stop == null) stop = x; else if (e.code === 'pump_resume' && stop != null) { m -= (x - stop) / 60000; stop = null; stops++; } }
  pumping.stops = stops; return Math.round(m);
}
const smpTxt = (d) => { const L = []; [['marpol', 'MARPOL'], ['ship', 'Ship'], ['supplier', 'Supplier']].forEach(([k, t]) => { if (String(d.seals[k]).trim()) L.push(t + ' ' + d.seals[k]); }); d.extra.forEach((r) => { if (r.seal) L.push((r.type === 'other' ? (r.desc || 'Other') : lbl(STYPES, r.type) || '?') + ' ' + r.seal + (r.remark ? ' (' + r.remark + ')' : '')); }); return L; };

// ---------- open items (drive step status + submit) ----------
export function issues() {
  const L = []; const add = (id, msg, tab, sign) => L.push({ s: SI(id), msg, tab: tab || null, sign: !!sign });
  const s = S();
  const needSig = (id, k) => { if (s.vno[k]) { if (!String(s.vno[k].reason || '').trim()) add(id, 'Reason the vessel did not sign (' + SIGLBL[k] + ')', null, true); } else if (!hasSig(k)) add(id, 'Signature ' + SIGLBL[k], null, true); };
  const sv = s.survey;
  if (!portOffset()) add('vessel', 'Local time of the port (UTC offset)');
  if (!sv.master) add('vessel', 'Name of the Master');
  if (!sv.chief) add('vessel', 'Name of the Chief Engineer');
  if (!sv.date || !sv.time) add('vessel', 'Date and time of survey');
  if (num(sv.draftFwd) == null || num(sv.draftAft) == null) add('vessel', 'Drafts forward and aft');
  if (!sv.listSide) add('vessel', 'List: port, upright or starboard'); else if (sv.listSide !== 'U' && num(sv.list) == null) add('vessel', 'List in degrees');
  if (!active().length) add('stem', 'Select at least one grade');
  for (const g of active()) {
    const x = s.grades[g];
    if (num(x.nominated) == null) add('stem', g + ': nominated quantity');
    if (!x.supplier) add('stem', g + ': supplier');
    if (!x.del.length) add('bdn', g + ': at least one delivery (BDN)');
    x.del.forEach((d, j) => {
      const n = g + ' delivery ' + (j + 1);
      if (!d.bdn) add('bdn', n + ': BDN number');
      if (!d.by) add('before', n + ': delivered by barge, truck or pipeline', 'sup');
      else if (d.by !== 'pipeline' && !d.name) add('bdn', n + ': ' + (d.by === 'barge' ? 'name of the barge' : 'licence plate'));
      if (num(d.qty) == null) add('bdn', n + ': BDN quantity');
      if (num(d.dens) == null) add('bdn', n + ': BDN density');
      if (!d.samples) add('bdn', n + ': samples taken or not?');
      else if (d.samples === 'yes') {
        if (!d.point) add('bdn', n + ': sampling point');
        if (!['marpol', 'ship', 'supplier'].some((k) => String(d.seals[k]).trim()) && !d.extra.some((r) => String(r.seal).trim())) add('bdn', n + ': at least one seal number');
        d.extra.forEach((r, k) => { const m = n + ' · added sample ' + (k + 1); if (!r.type) add('bdn', m + ': sample type'); else if (r.type === 'other' && !String(r.desc || '').trim()) add('bdn', m + ': sample description'); if (!String(r.seal).trim()) add('bdn', m + ': seal number'); });
      } else if (!d.noReason) add('bdn', n + ': reason for no samples');
    });
    for (const ph of ['before', 'after']) {
      const ts = s[ph].tanks.filter((t) => t.grade === g);
      if (!ts.length) add(ph, g + ': at least one tank', 'ves');
      ts.forEach((t) => {
        if (!t.name) { add(ph, g + ': choose the tank', 'ves'); return; }
        if (num(t.reading) == null) add(ph, t.name + ': ' + (t.method === 'U' ? 'ullage' : t.method === 'G' ? 'gauge reading' : 'sounding'), 'ves');
        if (!calcTank(t) && !awaitingBdn(t)) add(ph, t.name + ': volume, temperature or density', 'ves');
      });
    }
    if (num(s.before.logbook[g]) == null) add('before', g + ': logbook figure before bunkering', 'ves');
  }
  if (active().length) {
    if (!s.sup.mode) add('before', 'Supplier figures: measured or not measured?', 'sup');
    if (s.sup.mode === 'measured') allDel().forEach(({ g, d, j }) => {
      const n = `${g} ${d.bdn || 'delivery ' + (j + 1)}`;
      if (d.by === 'barge') {
        if (!d.btanks.length) add('before', n + ': add at least one barge tank', 'sup');
        d.btanks.forEach((t) => {
          const tn = n + ' · ' + (t.name || 'barge tank'); if (!t.name) add('before', n + ': barge tank name', 'sup');
          [['b', 'before'], ['a', 'after']].forEach(([k, ph]) => {
            const m = t[k];
            if (m.method === 'gauge' ? num(m.gauge) == null : num(m.reading) == null) add(ph, `${tn}: ${m.method === 'gauge' ? 'gauge reading' : 'sounding/ullage'}`, 'sup');
            if (m.method === 'gauge' ? num(m.temp) == null : (num(m.tov) == null || num(m.temp) == null)) add(ph, tn + (m.method === 'gauge' ? ': temperature' : ': volume and temperature'), 'sup');
          });
        });
      } else if (d.by === 'truck') { const w = d.truck.type === 'weigh' ? 'weight' : 'meter reading'; if (num(d.truck.b) == null) add('before', `${n}: truck ${w} before`, 'sup'); if (num(d.truck.a) == null) add('after', `${n}: truck ${w} after`, 'sup'); }
      else if (d.by === 'pipeline') { if (!d.pipe.meter) add('before', n + ': meter ID', 'sup'); if (num(d.pipe.b) == null) add('before', n + ': meter reading before', 'sup'); if (num(d.pipe.a) == null) add('after', n + ': meter reading after', 'sup'); }
    });
  }
  // seal numbers are unique on the whole survey; a BDN number once per grade
  { const seen = new Map();
    allDel().forEach(({ g, d, j }) => { const n = `${g} ${d.bdn || 'delivery ' + (j + 1)}`;
      [...['marpol', 'ship', 'supplier'].map((k) => d.seals[k]), ...d.extra.map((r) => r.seal)].forEach((x) => { const k = String(x || '').trim().toLowerCase(); if (!k) return; if (seen.has(k)) add('bdn', `Seal no. ${String(x).trim()}: used twice (${seen.get(k)}${seen.get(k) === n ? '' : ' and ' + n}) – correct one`); else seen.set(k, n); }); });
    for (const g of active()) { const b = new Set(); s.grades[g].del.forEach((d) => { const k = String(d.bdn || '').trim().toLowerCase(); if (!k) return; if (b.has(k)) add('bdn', `${g}: BDN ${String(d.bdn).trim()} listed twice – remove one`); b.add(k); }); } }
  for (const ph of ['before', 'after']) duplicateTanks(s[ph].tanks, famOf).forEach((n) => add(ph, n + ': listed twice – remove one', 'ves'));
  allDel().forEach(({ g, d, j }) => { const seen = new Set(); (d.btanks || []).forEach((t) => { const k = String(t.name || '').trim().toLowerCase(); if (!k) return; if (seen.has(k)) add('before', `${g} ${d.bdn || 'delivery ' + (j + 1)} · barge tank ${t.name}: listed twice – remove one`, 'sup'); seen.add(k); }); });
  if (!s.before.confirm) add('before', 'Confirmation of the figures before bunkering', null, true);
  needSig('before', 'beforeMaster'); needSig('before', 'beforeSurveyor');
  if (!s.bdn.lop) add('result', 'Was a Letter of Protest issued?');
  if (s.bdn.lop === 'yes') {
    if (!s.lops.length) add('result', 'Add at least one Letter of Protest');
    s.lops.forEach((l, i) => {
      const n = 'Letter of Protest ' + (i + 1);
      if (!l.dir) add('result', n + ': issued or received by the vessel?');
      else { if (!l.by) add('result', n + ': issued by'); if (!l.to) add('result', n + (l.dir === 'out' ? ': issued to' : ': received by')); }
      if (!l.subject) add('result', n + ': subject');
      if (!(s.photos['lop_' + l.id] || []).length) add('result', n + ': photo of the signed LOP');
    });
  }
  if (!s.bdn.confirm) add('result', 'Confirmation of the final figures', null, true);
  needSig('result', 'finalMaster'); needSig('result', 'finalSurveyor');
  if (!s.ts.location) add('time', 'Bunker location');
  s.ts.events.forEach((e) => { if ((e.key || e.custom) && (!e.t || !e.d)) add('time', 'Date and time: ' + (e.dl != null && dlLabel(e.dl) ? dlLabel(e.dl) + ' – ' : '') + e.label.toLowerCase(), tsTabs() ? 'ts:' + tsTabOf(e) : null); });
  needSig('time', 'ts');
  if (!(s.photos.bdn || []).length) add('submit', 'Photo of the signed BDN');
  if (!s.final) add('submit', 'Your review as appointed surveyor');
  return L;
}
// Items recorded for GlobalBQS ops (do not block submission)
export function flags() {
  const F = []; const s = S();
  Object.keys(s.vno).forEach((k) => F.push(['bad', 'Not signed', `Vessel did not sign: ${SIGLBL[k]}${s.vno[k].reason ? ' – ' + s.vno[k].reason : ''}. The client will be informed.`]));
  Object.keys(s.sig).forEach((k) => { if (hasSig(k) && s.sig[k].mode === 'receipt') F.push(['warn', 'Receipt only', 'Signed for receipt only: ' + SIGLBL[k]]); });
  s.audit.forEach((a) => F.push(['warn', 'Unlocked', `${a.label} unlocked after signing, ${a.at}. Reason: ${a.reason}`]));
  s.VT.filter((t) => t.isNew).forEach((t) => F.push(['info', 'New tank', `Tank added on board: ${t.name}${t.cap != null ? ' (' + fx(t.cap, 1) + ' m³)' : ''}`]));
  s.after.tanks.filter(afterOnly).forEach((t) => F.push(t.emptyBefore ? ['info', 'Check', `${t.name}: not sounded before bunkering, recorded as empty`] : ['warn', 'Check', `${t.name}: sounded after but not before bunkering`]));
  active().forEach((g) => s.grades[g].del.forEach((d) => { if (d.samples === 'no') F.push(['warn', 'No samples', `${g} ${d.bdn || 'BDN'}: ${lbl(NOREASON, d.noReason) || 'reason not given'}${d.noRemark ? ' – ' + d.noRemark : ''}`]); }));
  if (s.bdn.lop === 'yes') s.lops.forEach((l) => { if (l.dir) F.push(['warn', 'LOP', `${l.dir === 'out' ? 'Issued by the vessel' : 'Received by the vessel'}: ${lbl(LOPV.concat(LOPX), l.by) || '?'} → ${lbl(LOPV.concat(LOPX), l.to) || '?'} · ${lbl(LOPS, l.subject) || 'subject not set'}${l.name ? ' · ' + l.name : ''}`]); });
  active().forEach((g) => s.grades[g].del.forEach((d) => { if (d.samples === 'yes') { const L = smpTxt(d); if (L.length) F.push(['info', 'Samples', `${g} ${d.bdn || 'BDN'}: ${L.length} sample${L.length > 1 ? 's' : ''} · ${L.join(' · ')}`]); } }));
  GRADES().forEach((g) => { const G = s.grades[g]; if (!G.on && num(G.nominated) != null) F.push(['warn', 'Not delivered', `${g}: nominated ${fx(num(G.nominated))} MT but not delivered during this attendance. A later delivery is a separate survey; GlobalBQS ops arranges it.`]); });
  if (s.sup.mode === 'notmeasured') F.push(['info', 'Supplier', 'Supplier figures not measured' + (s.sup.reason ? ' – ' + s.sup.reason : '')]);
  const gc = gateCorrections(); if (gc.length) F.push(['info', 'Start check', `${gc.length} correction${gc.length > 1 ? 's' : ''} made at the start check`]);
  results().filter((r) => r.within === false).forEach((r) => F.push(['bad', 'Tolerance', `${r.g}: ${sgn(r.pct)}% against the BDN (tolerance ±${fx(TOL(), 2)}%)`]));
  return F;
}

// ---------- renderers ----------
function phaseGroup(phase, g) {
  const s = S();
  const tanks = s[phase].tanks.map((t, i) => [t, i]).filter(([t]) => t.grade === g);
  const extra = phase === 'before'
    ? `<div class="grid two">${field('Logbook figure ' + g, 'before.logbook.' + g, { numeric: 1, unit: 'MT', req: 1, hint: 'From the engine log, before bunkering.' })}<div data-calc="logdiff:${g}"></div></div>`
    : `<div class="grid two">${field(g + ' consumed during bunkering', 'after.consumed.' + g, { numeric: 1, unit: 'MT', hint: 'Leave 0 if the engines were stopped.' })}</div>`;
  const cards = tanks.map(([t, i]) => {
    const warnAfter = afterOnly(t) ? (t.emptyBefore
      ? note('ok', `Not sounded before bunkering; recorded as empty (0 m³) before bunkering. <button class="btn ghost small" type="button" data-act="emptyBefore" data-i="${i}" data-v="0">Undo</button>`)
      : note('warn', `This tank was not sounded before bunkering. Was it empty? Otherwise add it under Before bunkering. <br><button class="btn ghost small" type="button" data-act="emptyBefore" data-i="${i}" data-v="1">Yes, it was empty</button>`)) : '';
    const p = `${phase}.tanks.${i}`;
    const densHtml = (phase === 'after' && t.densAuto !== false)
      ? `<div class="field"><span class="lbl">Density @ 15 °C</span><div data-calc="dens:${i}"></div><button class="btn ghost small" type="button" data-act="densManual" data-i="${i}" style="justify-self:start">Enter manually</button></div>`
      : `<div class="field" style="gap:5px">${field('Density @ 15 °C', p + '.dens', { numeric: 1, unit: 'kg/l', req: 1, kind: 'dens' })}${phase === 'after' ? `<button class="btn ghost small" type="button" data-act="densAuto" data-i="${i}" style="justify-self:start">Use BDN / mix</button>` : ''}</div>`;
    return tankCard(phase, t, i, { VT: s.VT, family: famOf(g), used: usedTankKeys(s[phase].tanks, famOf, i), densHtml, extraHtml: warnAfter });
  });
  return `<section class="card" data-lockphase="${phase === 'before' ? 'before' : 'final'}">
    <div class="card-h"><h3><span class="gchip">${g}</span>${tanks.length} ${tanks.length === 1 ? 'tank' : 'tanks'}</h3><span data-calc="sub:${phase}:${g}"></span></div>
    ${tanks.length ? `<div class="tanks">${cards.join('')}</div>` : '<p class="empty">No tanks added yet.</p>'}
    <button class="btn add" type="button" data-act="addTank" data-phase="${phase}" data-grade="${g}">+ Add ${g} tank</button>
    ${extra}
  </section>`;
}
function delivCard(g, d, j) {
  const p = `grades.${g}.del.${j}`, many = S().grades[g].del.length > 1;
  const nameField = d.by === 'barge' ? field('Name of the barge', p + '.name', { req: 1 }) : d.by === 'truck' ? field('Truck licence plate', p + '.name', { req: 1 }) : d.by === 'pipeline' ? field('Terminal / pipeline', p + '.name', { opt: 1 }) : '';
  return `<div class="deliv" data-del="${g}:${j}"><div class="card-h"><span class="lbl">Delivery ${j + 1}</span>${many ? `<button class="icon-btn" type="button" data-act="delDel" data-g="${g}" data-j="${j}" aria-label="Remove delivery ${j + 1}">${ICON.x}</button>` : ''}</div>
    <div class="grid two">${field('BDN number', p + '.bdn', { req: 1 })}<div class="field"><span class="lbl">Delivered by</span><div class="out"><span class="v">${BYL[d.by] || '—'}</span><button class="btn ghost small" type="button" data-act="gotoSup" data-keep>Set in step 3</button></div></div></div>
    ${nameField ? `<div class="grid two">${nameField}</div>` : ''}
    <div class="grid two">${field('BDN quantity', p + '.qty', { numeric: 1, unit: 'MT', req: 1, hint: 'From the signed BDN.' })}${field('BDN density @ 15 °C', p + '.dens', { numeric: 1, unit: 'kg/l', req: 1, kind: 'dens' })}</div>
    <div class="samp">${seg('Samples for this BDN', p + '.samples', [['yes', 'Samples taken'], ['no', 'No samples']])}
      ${d.samples === 'yes' ? `<div class="grid two">${selectField('Sampling point', p + '.point', POINTS, { req: 1 })}</div>
        <div class="grid two">${field('MARPOL sample · seal no.', p + '.seals.marpol', { opt: 1 })}${field('Ship sample · seal no.', p + '.seals.ship', { opt: 1 })}${field('Supplier sample · seal no.', p + '.seals.supplier', { opt: 1 })}</div>
        ${d.extra.map((r, k) => { const q = `${p}.extra.${k}`; return `<div class="srow"><div class="grid">${selectField('Sample type', q + '.type', STYPES, { req: 1 })}${r.type === 'other' ? field('Sample description', q + '.desc', { req: 1, ph: 'e.g. lab sample' }) : ''}${field('Seal no.', q + '.seal', { req: 1 })}${field('Remark', q + '.remark', { opt: 1, ph: 'e.g. for charterers, retained by barge' })}</div><button class="icon-btn" type="button" data-act="delSmp" data-g="${g}" data-j="${j}" data-k="${k}" aria-label="Remove added sample ${k + 1}">${ICON.x}</button></div>`; }).join('')}
        <button class="btn add" type="button" data-act="addSmp" data-g="${g}" data-j="${j}">+ Add sample</button>
        <p class="hint">Enter at least one seal number.</p>`
      : d.samples === 'no' ? `<div class="grid two">${selectField('Reason', p + '.noReason', NOREASON, { req: 1 })}${field('Remark', p + '.noRemark', { opt: 1 })}</div>` : ''}</div></div>`;
}
function tabBar(ph) {
  const cur = S().ui.tab[ph], b = (k, t) => `<button type="button" role="tab" data-act="tab" data-ph="${ph}" data-t="${k}" data-keep aria-selected="${cur === k}">${t}<span data-calc="tabn:${ph}:${k}"></span></button>`;
  return `<div class="tabs" role="tablist" aria-label="Soundings">${b('ves', 'Soundings vessel')}${b('sup', 'Soundings supplier')}</div>`;
}
function supTab(ph) {
  const before = ph === 'before', lk = before ? 'before' : 'final', D0 = allDel(), s = S();
  const head = before ? `<section class="card" data-lockphase="before"><div class="card-h"><h3>How is each delivery made?</h3></div>
      ${D0.map(({ g, d, j }) => `<div class="grid two"><div class="field"><span class="lbl">Delivery</span><div class="out"><span class="v"><span class="gchip">${g}</span> ${esc(d.bdn || 'Delivery ' + (j + 1))}</span></div></div>${seg('Delivered by', `grades.${g}.del.${j}.by`, [['barge', 'Barge'], ['truck', 'Truck'], ['pipeline', 'Pipeline']])}</div>`).join('') || '<p class="empty">Tick a grade in step 2 first.</p>'}
      <p class="hint">Another delivery (BDN)? Add it in step 5.</p></section>` : '';
  const choice = `<section class="card" data-lockphase="${lk}"><div class="card-h"><h3>Supplier figures</h3><span class="opt">optional</span></div>
      ${seg('Supplier side', 'sup.mode', [['measured', 'Supplier figures measured'], ['notmeasured', 'Supplier figures not measured']])}
      ${s.sup.mode === 'notmeasured' ? `<div class="grid two">${field('Reason', 'sup.reason', { opt: 1, ph: 'E.g. no access to the barge tanks' })}</div>` : ''}
      <p class="hint">The vessel figures are leading. Choose “not measured” to complete this tab.</p></section>`;
  return head + choice + (s.sup.mode === 'measured' ? D0.map(({ g, d, j }) => supCard(ph, g, d, j)).join('') : '');
}
function supCard(ph, g, d, j) {
  const p = `grades.${g}.del.${j}`, k = ph === 'before' ? 'b' : 'a', lk = ph === 'before' ? 'before' : 'final', w = ph === 'before' ? 'before' : 'after';
  let body = '';
  if (!d.by) body = note('warn', 'Choose barge, truck or pipeline' + (ph === 'before' ? ' at the top of this tab.' : ' under Before bunkering → Soundings supplier.'));
  else if (d.by === 'barge') body = `<div class="grid two">${field('Barge name', p + '.name', { req: 1 })}</div>
      ${d.btanks.length ? `<div class="tanks">${d.btanks.map((t, i) => bargeTankCard(ph, g, j, t, i)).join('')}</div>` : '<p class="empty">No barge tanks yet.</p>'}
      ${ph === 'before' ? `<button class="btn add" type="button" data-act="addBT" data-g="${g}" data-j="${j}">+ Add barge tank</button>` : ''}`;
  else if (d.by === 'truck') body = `<div class="grid two">${field('Truck / registration no.', p + '.name', { req: 1 })}${ph === 'before' ? seg('Measured by', p + '.truck.type', [['weigh', 'Weighbridge ticket'], ['meter', 'Meter reading']]) : `<div class="field"><span class="lbl">Measured by</span><div class="out"><span class="v">${d.truck.type === 'weigh' ? 'Weighbridge ticket' : 'Meter reading'}</span></div></div>`}</div>
      <div class="grid two">${d.truck.type === 'weigh' ? field(ph === 'before' ? 'Weight before (loaded)' : 'Weight after (empty)', p + '.truck.' + k, { numeric: 1, unit: 'MT', req: 1 }) : field('Meter reading ' + w, p + '.truck.' + k, { numeric: 1, unit: 'm³', req: 1 })}</div>
      ${photoBlock(`trk_${d.id}_${k}`, d.truck.type === 'weigh' ? 'Photo of the weighbridge ticket' : 'Photo of the meter')}`;
  else body = `<div class="grid two">${field('Meter ID', p + '.pipe.meter', { req: 1 })}${field('Meter factor', p + '.pipe.factor', { numeric: 1, opt: 1, hint: 'Empty = 1.0000.' })}</div>
      <div class="grid two">${field('Meter reading ' + w, p + '.pipe.' + k, { numeric: 1, unit: 'm³', req: 1 })}</div>
      ${photoBlock(`pip_${d.id}_${k}`, 'Photo of the meter')}`;
  return `<section class="card" data-lockphase="${lk}"><div class="card-h"><h3><span class="gchip">${g}</span>${esc(d.bdn || 'Delivery ' + (j + 1))} · ${BYL[d.by] || 'not chosen'}</h3><span data-calc="supd:${g}:${j}"></span></div>${body}</section>`;
}
function bargeTankCard(ph, g, j, t, i) {
  const p = `grades.${g}.del.${j}.btanks.${i}`, k = ph === 'before' ? 'b' : 'a', m = t[k], q = `${p}.${k}`;
  const sum = `<div class="tank-head"><button class="tank-sum" type="button" data-act="btToggle" data-g="${g}" data-j="${j}" data-i="${i}" data-keep aria-expanded="${!!t.open}"><span class="tsum" data-calc="btsum:${ph}:${g}:${j}:${i}"></span>${ICON.chev}</button>
    <button class="icon-btn" type="button" data-act="delBT" data-g="${g}" data-j="${j}" data-i="${i}" aria-label="Remove barge tank ${esc(t.name || '')}" title="Remove barge tank">${ICON.x}</button></div>`;
  if (!t.open) return `<div class="tank">${sum}</div>`;
  return `<div class="tank open">${sum}<div class="tank-body">
    ${ph === 'before' ? `<div class="tank-top"><div class="grow">${field('Barge tank', p + '.name', { req: 1, ph: 'e.g. Cargo tank 3S' })}</div></div>` : ''}
    ${seg('Method', q + '.method', BT_METHODS, 'sm')}
    ${m.method === 'gauge' ? `<div class="grid">${field('Gauge reading', q + '.gauge', { numeric: 1, unit: 'm³', req: 1, hint: 'Volume as read from the barge gauge = TOV.' })}${field('Temperature', q + '.temp', { numeric: 1, unit: '°C', req: 1, kind: 'temp' })}</div><div class="grid two">${field('Remark', q + '.rem', { opt: 1, ph: 'e.g. radar gauge, read in the barge control room' })}</div>`
      : `<div class="grid">${field(m.method === 'ullage' ? 'Ullage' : 'Sounding', q + '.reading', { numeric: 1, unit: 'm', req: 1 })}${field('Trim correction', q + '.trim', { numeric: 1, unit: 'm', kind: 'signed', opt: 1 })}${field('List correction', q + '.list', { numeric: 1, unit: 'm', kind: 'signed', opt: 1 })}<div class="field"><span class="lbl">Corrected</span><div data-calc="bcor:${g}:${j}:${i}:${k}"></div></div></div>`}
    ${m.method === 'gauge' ? '' : `<div class="grid">${field('Volume (TOV)', q + '.tov', { numeric: 1, unit: 'm³', req: 1 })}${field('Temperature', q + '.temp', { numeric: 1, unit: '°C', req: 1, kind: 'temp' })}</div>`}
    <div data-calc="bcalc:${g}:${j}:${i}:${k}"></div>
    ${ph === 'after' ? `<div data-calc="btdel:${g}:${j}:${i}"></div>` : ''}</div></div>`;
}

export const R = {};
R.vessel = () => {
  const s = S(), o = s.order;
  const off = portOffset();
  return `<section class="card order"><div class="card-h"><h3>From the order</h3><span class="lock">${ICON.lock} Set by GlobalBQS</span></div>
    <dl><div><dt>Reference</dt><dd class="mono">${esc(o.ref)}</dd></div><div><dt>Survey type</dt><dd>${esc(o.type)}</dd></div><div><dt>Client</dt><dd>${esc(o.client || '—')}</dd></div><div><dt>Vessel</dt><dd>${esc(o.vessel)}</dd></div><div><dt>IMO</dt><dd class="mono">${esc(o.imo || '—')}</dd></div><div><dt>Port</dt><dd>${esc(o.place || '—')}</dd></div><div><dt>ETB</dt><dd>${esc(o.etb || '—')}</dd></div><div><dt>Surveyor</dt><dd>${esc(s.survey.surveyor || '—')}</dd></div>
    <div><dt>Owner</dt><dd>${esc(o.owner || '—')}</dd></div><div><dt>Charterer</dt><dd>${esc(o.charterer || '—')}</dd></div><div><dt>Agent</dt><dd>${esc(o.agent || '—')}</dd></div>
    <div><dt>Local time (LT)</dt><dd class="mono">${off ? 'UTC' + esc(off) : 'to be chosen'}</dd></div><div><dt>Delivery tolerance</dt><dd>±${fx(TOL(), 2)}% <span class="opt">(client setting)</span></dd></div>
    <div><dt>Form version</dt><dd class="mono">${versionLabel}</dd></div><div><dt>Device</dt><dd>Open on this device; the draft is saved to GlobalBQS whenever there is a connection</dd></div></dl>
    ${o.orderedText ? `<p class="hint">Ordered: ${esc(o.orderedText)}</p>` : ''}
    <p class="hint">Something wrong here? You can correct it at the start check; ops sees the change. Switching device? Open the job link there and sign in; it continues where the last sync stopped.</p></section>
  ${o.utcOffset ? '' : `<section class="card"><div class="card-h"><h3>Local time</h3></div><div class="grid two">${offsetPicker('survey.utcOffset', OFFSETS, deviceOffset())}</div></section>`}
  <section class="card"><div class="card-h"><h3>On board</h3></div>
    <div class="grid">${field('Master', 'survey.master', { req: 1 })}${field('Chief Engineer', 'survey.chief', { req: 1 })}${field('Bunker surveyor', 'survey.surveyor', { req: 1, hint: 'As confirmed when you accepted the job.' })}</div>
    <div class="grid two">${field('Port of registry', 'survey.registry', { opt: 1 })}</div>
    <div class="grid">${field('Date of survey', 'survey.date', { type: 'date', req: 1 })}${field('Time (LT)', 'survey.time', { type: 'time', req: 1, hint: 'Local time' + (off ? ', UTC' + esc(off) : '') + '.' })}</div></section>
  <section class="card"><div class="card-h"><h3>Drafts and list</h3></div>
    <div class="grid">${field('Draft forward', 'survey.draftFwd', { numeric: 1, unit: 'm', req: 1, kind: 'draft' })}${field('Draft aft', 'survey.draftAft', { numeric: 1, unit: 'm', req: 1, kind: 'draft' })}<div class="field"><span class="lbl">Trim</span><div data-calc="trim"></div></div></div>
    <div class="grid two">${seg('List', 'survey.listSide', [['P', 'Port'], ['U', 'Upright'], ['S', 'Stbd']])}${s.survey.listSide && s.survey.listSide !== 'U' ? field('List ' + (s.survey.listSide === 'P' ? 'to port' : 'to starboard'), 'survey.list', { numeric: 1, unit: '°', req: 1, kind: 'deg' }) : ''}</div></section>`;
};
R.stem = () => {
  const s = S();
  const chips = GRADES().map((g) => `<button type="button" class="chip" data-act="grade" data-g="${g}" aria-pressed="${s.grades[g].on}"><span class="box"></span>${g}</button>`).join('');
  const cards = active().map((g) => {
    const p = 'grades.' + g;
    return `<section class="card"><div class="card-h"><h3><span class="gchip">${g}</span>Nomination</h3><span data-calc="nom:${g}"></span></div>
      <div class="grid two" data-lockphase="before">${field('Nominated quantity', p + '.nominated', { numeric: 1, unit: 'MT', req: 1 })}${field('Supplier', p + '.supplier', { req: 1 })}${field('Supplier representative', p + '.rep', { opt: 1 })}</div>
      </section>`;
  }).join('');
  return `${lockBar('before')}<section class="card" data-lockphase="before"><div class="card-h"><h3>Grades in this delivery</h3></div><div class="chips">${chips}</div>
    <p class="hint">The other steps only show the grades you tick here. BDN details (quantity, density, samples) follow in step 5, after the delivery.</p></section>${cards || note('warn', 'Tick at least one grade to continue.')}`;
};
R.before = () => {
  const s = S(), sv = s.survey;
  return lockBar('before') + tabBar('before') + (s.ui.tab.before === 'sup' ? supTab('before') : active().map((g) => phaseGroup('before', g)).join('') + CALC_NOTE) +
  `<section class="card"><div class="card-h"><h3>Sign before bunkering starts</h3></div>
    ${sigGate('before')}
    ${confirmBox('before.confirm', 'Master / Chief Engineer and surveyor confirm the figures before bunkering are true and correct.', 'before')}
    <div class="sigs">${vSig('beforeMaster', 'Master / Chief Engineer', sv.chief || sv.master, 'before.confirm')}${sigPad('beforeSurveyor', 'Bunker surveyor', sv.surveyor, 'before.confirm')}</div></section>`;
};
R.after = () => {
  const s = S(), empty = !s.after.tanks.length;
  return lockBar('final') + tabBar('after') + (s.ui.tab.after === 'sup' ? supTab('after') : `${s.before.tanks.length ? `<section class="card" data-lockphase="final"><div class="card-h"><h3>Same tanks as before?</h3><button class="btn ghost small" type="button" data-act="copyTanks">Copy tanks from before</button></div><p class="hint">Copies all tanks with their readings from Before bunkering. Overwrite the tanks that received bunkers${empty ? '' : '; tanks already listed here are kept'}.</p></section>` : ''}` +
    active().map((g) => phaseGroup('after', g)).join('')) + CALC_NOTE;
};
R.bdn = () => lockBar('final') + active().map((g) => `<section class="card"><div class="card-h"><h3><span class="gchip">${g}</span>Deliveries (one per BDN)</h3><span data-calc="nom:${g}"></span></div>
  <div style="display:grid;gap:10px" data-lockphase="final">${S().grades[g].del.map((d, j) => delivCard(g, d, j)).join('')}
    <button class="btn add" type="button" data-act="addDel" data-g="${g}">+ Add delivery (another BDN)</button></div>
  <div data-calc="delsum:${g}"></div></section>`).join('') +
  note('info', 'Photograph the signed BDN(s), sample labels and seals; add the photos in the last step.');
R.result = () => {
  const s = S(), sv = s.survey, lop = s.bdn.lop;
  const cards = active().map((g) => `<section class="card"><div class="card-h"><h3><span class="gchip">${g}</span>Ship vs BDN</h3><span data-calc="pill:${g}"></span></div>
      <div data-calc="dtable:${g}"></div>
      <div data-calc="res:${g}"></div></section>`).join('');
  return `${lockBar('final')}${cards}
  <p class="fnote">Preview only. Figures are recalculated by GlobalBQS on submission.</p>
  <section class="card"><div class="card-h"><h3>Letters of Protest</h3></div>
    <div data-calc="lophint"></div>
    ${seg('Any Letters of Protest?', 'bdn.lop', [['no', 'No'], ['yes', 'Yes']])}
    ${lop === 'yes' ? s.lops.map((l, i) => lopCard(l, i)).join('') + '<button class="btn add" type="button" data-act="addLop">+ Add Letter of Protest</button>' : ''}</section>
  <section class="card" data-lockphase="final"><div class="card-h"><h3>Remarks</h3></div>
    <div class="grid two">${area('Remarks Master / Chief Engineer', 'bdn.remMaster', { opt: 1 })}${area('Remarks surveyor', 'bdn.remSurveyor', { opt: 1, ph: 'E.g. delivery witnessed in full, samples drawn at the vessel manifold.' })}</div></section>
  <section class="card"><div class="card-h"><h3>Sign the final figures</h3></div>
    ${sigGate('final')}
    ${confirmBox('bdn.confirm', 'Master / Chief Engineer and surveyor confirm the final figures are true and correct.', 'final')}
    <div class="sigs">${vSig('finalMaster', 'Master / Chief Engineer', sv.chief || sv.master, 'bdn.confirm')}${sigPad('finalSurveyor', 'Bunker surveyor', sv.surveyor, 'bdn.confirm')}</div></section>`;
};
R.time = () => {
  const s = S(), off = portOffset() ? 'UTC' + portOffset() : 'UTC offset not chosen';
  const nv = s.newEv;
  const DL = delivs(), many = DL.length > 1, split = tsSplit();
  const tab = tsTab(), TT = tsTabs(), show = tsShow(tab);
  const tabTxt = tab && tab !== 'all' ? (tab === 'c' ? ' (common to all deliveries)' : ' for ' + esc(dlLabel(+tab) || '')) : '';
  const addEv = `<div class="addev"><div class="grid two">${selectField('Add event' + tabTxt, 'newEv.type', TSEV.map((x) => [x[0], x[1]]))}${nv.type === 'other' ? field('Event description', 'newEv.other', { ph: 'e.g. Pilot on board' }) : ''}${many && (!tab || tab === 'all') ? selectField('For delivery', 'newEv.dl', [['', 'All deliveries'], ...DL.map((x) => [String(x.id), x.label])]) : ''}</div>
      <button class="btn add" type="button" data-act="addEv" ${nv.type ? '' : 'disabled'}>+ Add event</button></div>`;
  const sv = s.survey;
  return `${lockBar('ts')}<section class="card" data-lockphase="ts"><div class="grid two">${field('Bunker location', 'ts.location', { req: 1 })}<div class="field"><span class="lbl">Grades</span><div class="out"><span class="v">${active().join(' · ') || '—'}</span></div></div></div></section>
  <section class="card" data-lockphase="ts"><div class="card-h"><h3>Events · LT (${off})</h3><span data-calc="pump${tab && tab !== 'c' && tab !== 'all' ? ':' + tab : ''}"></span><button class="btn ghost small" type="button" data-act="sortTs">Sort by time</button></div>${TT ? `<div class="tabs" role="tablist" aria-label="Timesheet">${TT.map(([k, t]) => `<button type="button" role="tab" data-act="tsTab" data-t="${esc(k)}" data-keep aria-selected="${tab === k}">${esc(t)}${k === 'all' ? '' : `<span data-calc="tstabn:${esc(k)}"></span>`}</button>`).join('')}</div>` : ''}<p class="hint">Drag ⋮⋮ or use ↑ ↓ to change the order.</p>${many || split ? (split
      ? note('ok', `Times per delivery. <b>Common</b>: events for the whole bunkering (arrival, all fast, documents). Each delivery tab: its own hose, pumping, stops and BDN times. Deliveries at the same time: enter the same times. <button class="btn ghost small" type="button" data-act="mergeTs">Use one set of times</button>`)
      : note('warn', `${DL.length} deliveries (${DL.map((x) => esc(x.label)).join(', ')}). Give each delivery its own hose and pumping times, so the pump rate per grade and barge is correct. <button class="btn ghost small" type="button" data-act="splitTs">Separate times per delivery</button>`)) : ''}
    <div class="ts" id="tslist">${tsRows(s.ts.events, (e) => (many && e.dl != null && (!tab || tab === 'all') ? dlLabel(e.dl) : null), show) || '<p class="empty">No events on this tab yet. Add one below.</p>'}</div>${addEv}
    <p class="hint">All times are local time of ${esc(s.order.port || 'the port')} (${off}), with the date, so a night shift counts correctly. Key events feed the pump rate in the vessel and supplier scorecards.</p></section>
  <section class="card"><div data-lockphase="ts">${area('Remarks timesheet', 'ts.remarks', { opt: 1, ph: 'Delays, stoppages and their reason.' })}</div>
    ${sigGate('ts')}
    <div class="sigs">${vSig('ts', 'Master / Chief Engineer', sv.chief || sv.master)}</div></section>`;
};
R.submit = () => `
  <section class="card"><div class="card-h"><h3>Photos</h3></div>
    ${photoBlock('bdn', 'Signed BDN(s)', true)}${photoBlock('seals', 'Sample labels and seals')}${photoBlock('other', 'Other (meter readings, barge, tanks)')}
    <p class="hint">Photos are reduced on this device before upload, so they also send over a slow ship connection.</p></section>
  <section class="card"><div class="card-h"><h3>Recorded for GlobalBQS ops</h3></div><div data-calc="flags"></div></section>
  <section class="card">
    ${confirmBox('final', 'I am the appointed surveyor. I have reviewed this report and signed it. GlobalBQS ops checks it and issues it to the client.')}</section>
  <section class="card" id="submitCard"><div class="card-h"><h3>Before you submit</h3><span data-calc="opencount"></span></div><div data-calc="review"></div>
    <p class="hint">After Submit the status is: Submitted → Under review by GlobalBQS → Report issued. Figures are recalculated by GlobalBQS on submission.</p>
    <button class="btn primary" type="button" data-act="submit" id="submitBtn">Submit survey</button></section>`;

// ---------- live calculated parts ----------
export const CALC = {
  trim() {
    const f = num(S().survey.draftFwd), a = num(S().survey.draftAft); if (f == null || a == null) return '<div class="out"><span class="s">Enter both drafts</span></div>';
    const tr = r2(a - f); return `<div class="out"><span class="v">${fx(Math.abs(tr), 2)} m</span><span class="s">${tr > 0 ? 'by the stern' : tr < 0 ? 'by the head' : 'even keel'}</span></div>`;
  },
  tank(ph, i) {
    const t = S()[ph].tanks[+i]; if (!t) return ''; const c = calcTank(t);
    if (!c) return awaitingBdn(t) ? '<div class="calc-wait">Awaiting BDN density (step 5). The weight is calculated automatically once it is entered.</div>' : '<div class="calc-wait">Weight appears when volume, temperature and density are filled in.</div>';
    return calc4(c);
  },
  tsum(ph, i) {
    const t = S()[ph].tanks[+i]; if (!t) return ''; const c = calcTank(t), tov = num(tovOf(t));
    const flag = afterOnly(t) && !t.emptyBefore ? ' <span class="pill warn">Not sounded before</span>' : '';
    return `<span class="tn">${esc(t.name || 'Choose a tank')}${flag}</span><span class="tv">${tov != null ? 'TOV ' + fx(tov, 2) + ' m³' : 'TOV —'}</span><span class="tm">${c && num(t.reading) != null ? fx(c.mt, 3) + ' MT' : awaitingBdn(t) && num(t.reading) != null ? '<span class="pill info">Awaiting BDN</span>' : '<span class="pill warn">Open</span>'}</span>`;
  },
  dens(i) {
    const t = S().after.tanks[+i]; if (!t) return ''; const a = autoDens(t);
    if (!a) return '<div class="out"><span class="s">Awaiting BDN density (step 5)</span></div><p class="hint">Recalculated automatically once the BDN density is entered.</p>';
    const src = a.src === 'bdn' ? 'BDN density, no ROB in this tank' : a.src === 'rob' ? 'No new fuel: ROB density' : `Mix: ROB ${fx(a.rob, 2)} m³ @ ${fx(a.robD, 4)} + new ${fx(a.nw, 2)} m³ @ ${fx(a.bdn, 4)}`;
    return `<div class="out"><span class="v">${fx(a.d, 4)}</span><span class="s">kg/l</span></div><p class="hint">${src}</p>`;
  },
  sub(ph, g) { const v = phaseTotal(ph, g); return v == null ? '<span class="subtot"><small>Total</small>—</span>' : `<span class="subtot"><small>Total</small>${fx(v, 2)} MT</span>`; },
  logdiff(g) {
    const s = phaseTotal('before', g), l = num(S().before.logbook[g]);
    if (s == null || l == null) return '';
    const d = r2(s - l), pct = l ? d / l * 100 : 0;
    return `<div class="cmp"><span>Sounded by surveyor</span><span class="v">${fx(s)} MT</span><span>Logbook</span><span class="v">${fx(l)} MT</span><span class="d">Difference</span><span class="v d ${Math.abs(pct) > TOL() ? 'neg' : 'pos'}">${sgn(d)} MT</span></div>`;
  },
  nom(g) { const n = num(S().grades[g].nominated); return n == null ? '' : `<span class="subtot">${fx(n)} MT</span>`; },
  delsum(g) { const q = bdnQty(g), d = bdnDens(g), n = S().grades[g].del.length; return `<div class="cmp"><span>Sum of ${n} BDN${n > 1 ? 's' : ''}</span><span class="v">${fx(q)} MT</span><span>Density used after bunkering${n > 1 ? ' (weighted)' : ''}</span><span class="v">${fx(d, 4)} kg/l</span></div>`; },
  dtable(g) {
    const L = S().grades[g].del;
    const sup = S().sup.mode === 'measured' && L.some((d) => supDel(g, d)), sg = supGrade(g);
    return `<div style="overflow-x:auto"><table class="dtab"><thead><tr><th>BDN</th><th>Barge / truck / pipeline</th>${sup ? '<th class="n">Supplier delivered (before − after)</th>' : ''}<th class="n">BDN MT</th><th class="n">kg/l</th></tr></thead><tbody>${L.map((d) => { const x = supDel(g, d); return `<tr><td class="mono">${esc(d.bdn || '—')}</td><td>${esc((BYL[d.by] ? BYL[d.by] + ' · ' : '') + (d.name || '—'))}</td>${sup ? `<td class="n">${x ? fx(x.v) + ' ' + x.u : '—'}</td>` : ''}<td class="n">${fx(num(d.qty))}</td><td class="n">${fx(kgl(num(d.dens)), 4)}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td colspan="2">Total · ship received ${fx(results().find((r) => r.g === g)?.delivered)} MT</td>${sup ? `<td class="n">${sg != null ? fx(sg) + ' MT' : '—'}</td>` : ''}<td class="n">${fx(bdnQty(g))}</td><td class="n">${fx(bdnDens(g), 4)}</td></tr></tfoot></table></div>
      <button class="btn ghost small" type="button" data-act="goto" data-i="${SI('bdn')}" data-keep style="justify-self:start">Change BDN details in step 5</button>`;
  },
  pill(g) { const r = results().find((x) => x.g === g); if (!r || r.within == null) return '<span class="pill warn">Incomplete</span>'; return r.within ? `<span class="pill ok">Within ±${fx(TOL(), 2)}%</span>` : `<span class="pill bad">Outside ±${fx(TOL(), 2)}%</span>`; },
  res(g) {
    const r = results().find((x) => x.g === g); if (!r) return '';
    const cls = r.within == null ? '' : r.within ? 'pos' : 'crit';
    const bd = r.barge != null ? `<div><span>Supplier delivered</span><b>${fx(r.barge)}</b></div>` : '';
    return `<div class="res"><div class="big"><div><span>Delivered (ship)</span><b>${fx(r.delivered)}</b></div><div><span>BDN total</span><b>${fx(r.bdn)}</b></div><div><span>Difference MT</span><b class="${cls}">${sgn(r.diff)}</b></div><div><span>Difference %</span><b class="${cls}">${sgn(r.pct, 2)}%</b></div>${bd}</div>
      <p class="formula">After ${fx(r.after)} − before ${fx(r.before)} + consumed ${fx(r.cons)} = ${fx(r.delivered)} MT · nominated ${fx(r.nominated)} MT</p>
      <p class="hint">Tolerance ±${fx(TOL(), 2)}% (client setting).${r.barge != null && r.bdn != null ? ` Supplier figures vs BDN: ${sgn(r2(r.barge - r.bdn))} MT.` : ''}</p></div>`;
  },
  tabn(ph, k) { const n = issues().filter((x) => x.s === SI(ph) && x.tab === k).length; return n ? `<span class="tb warn">${n}</span>` : '<span class="tb ok">✓</span>'; },
  btsum(ph, g, j, i) {
    const d = S().grades[g].del[+j], t = d && d.btanks[+i]; if (!t) return ''; const k = ph === 'before' ? 'b' : 'a', c = bargePhase(g, d, t, k), tov = num(t[k].method === 'gauge' ? t[k].gauge : t[k].tov);
    return `<span class="tn">${esc(t.name || 'Barge tank')}</span><span class="tv">${tov != null ? 'TOV ' + fx(tov, 2) + ' m³' : 'TOV —'}</span><span class="tm">${c ? fx(c.mt, 3) + ' MT' : bargeDens(g, d) == null && tov != null ? '<span class="pill info">Awaiting BDN</span>' : '<span class="pill warn">Open</span>'}</span>`;
  },
  bcor(g, j, i, k) { const t = S().grades[g].del[+j].btanks[+i]; if (!t) return ''; const c = corrected(t[k]); return `<div class="out"><span class="v">${c == null ? '—' : fx(c, 3) + ' m'}</span><span class="s">incl. trim and list</span></div>`; },
  bcalc(g, j, i, k) {
    const d = S().grades[g].del[+j], t = d.btanks[+i]; if (!t) return ''; const c = bargePhase(g, d, t, k);
    if (!c) return `<div class="calc-wait">${bargeDens(g, d) == null ? 'Awaiting BDN density (step 5).' : 'Weight appears when volume and temperature are filled in.'}</div>`;
    return `<div class="calc4"><div><span>Density (BDN)</span><b>${fx(bargeDens(g, d), 4)}</b></div><div><span>VCF 54B (-04)</span><b>${fx(c.vcf, 5)}</b></div><div><span>GSV m³</span><b>${fx(c.gsv, 3)}</b></div><div class="mt"><span>Weight</span><b>${fx(c.mt, 3)} MT</b></div></div>`;
  },
  btdel(g, j, i) { const d = S().grades[g].del[+j], x = bargeTankDel(g, d, d.btanks[+i]); return x == null ? '' : `<div class="cmp"><span class="d">Delivered from this tank (before − after)</span><span class="v d">${fx(x, 3)} MT</span></div>`; },
  supd(g, j) { const d = S().grades[g].del[+j]; const x = d && supDel(g, d); return x ? `<span class="subtot"><small>Supplier delivered</small>${fx(x.v)} ${x.u}</span>` : ''; },
  lophint() {
    const R0 = results(); if (!R0.length || R0.some((r) => r.within == null)) return `<div class="note" style="background:var(--surface-2);border:1px solid var(--line);color:var(--muted)">${ICON.info}<div>Result appears once soundings and BDN figures are entered.</div></div>`;
    const out = R0.filter((r) => r.within === false);
    if (!out.length) return note('ok', `All delivered grades are within ±${fx(TOL(), 2)}% of the BDN.`);
    return note('warn', `${out.map((r) => `<b>${r.g}</b> ${sgn(r.pct)}%`).join(', ')} outside ±${fx(TOL(), 2)}%. A Letter of Protest is usually issued to the supplier.`);
  },
  tsw(i) { return tsWarn(S().ts.events, +i); },
  tstabn(k) { const n = S().ts.events.filter((e) => tsTabOf(e) === k && (e.key || e.custom) && (!e.t || !e.d)).length; return n ? `<span class="tb warn">${n}</span>` : '<span class="tb ok">✓</span>'; },
  pump(one) {
    if (one != null && tsSplit()) {
      const x = delivs().find((v) => String(v.id) === String(one)); if (x) { const m = pumping(x.id), q = num(x.d.qty); if (m == null) return '<span class="pill warn">Pump rate after pumping completed</span>';
        return `<span class="subtot"><small>Pumping ${Math.floor(m / 60)} h ${m % 60} min${pumping.stops ? ' net' : ''} ·</small>${q && m ? fx(q / (m / 60), 1) : '—'} MT/h</span>`; }
    }
    if (tsSplit() && delivs().length > 1) {
      const L = delivs().map((x) => { const m = pumping(x.id), q = num(x.d.qty); return `${esc(x.label)} ${m == null || !q || !m ? '—' : fx(q / (m / 60), 1)}`; });
      return `<span class="subtot"><small>Pump rate MT/h ·</small>${L.join(' · ')}</span>`;
    }
    const m = pumping(); if (m == null) return '<span class="pill warn">Pump rate after pumping completed</span>';
    const tot = results().reduce((s, r) => s + (r.delivered || 0), 0); const h = m / 60;
    return `<span class="subtot"><small>Pumping ${Math.floor(m / 60)} h ${m % 60} min${pumping.stops ? ' net' : ''} ·</small>${h ? fx(tot / h, 1) : '—'} MT/h</span>`;
  },
  opencount() { const n = issues().length; return n ? `<span class="pill warn">${n} open</span>` : '<span class="pill ok">Complete</span>'; },
  review() { return reviewList(issues()); },
  flags() { return flagList(flags()); },
};

// ---------- form-specific actions ----------
export function act(a, b) {
  const s = S(), fm = ctx.form;
  const done = (msg) => { fm.markSaved(); fm.render(false); if (msg) toast(msg); return true; };
  switch (a) {
    case 'grade': { const g = b.dataset.g; s.grades[g].on = !s.grades[g].on; if (!s.grades[g].del.length) s.grades[g].del.push(D()); return done(); }
    case 'addTank': {
      const ph = b.dataset.phase, fam = famOf(b.dataset.grade);
      if (!freeTanks(s.VT, fam, usedTankKeys(s[ph].tanks, famOf))) toast(`All ${fam === 'do' ? 'gas oil / diesel' : 'fuel oil'} tanks of this vessel are already in this list. Use “Tank not on the list…” only for a tank that is missing.`);
      s[ph].tanks.push(T(b.dataset.grade, '', 'S', ph, { open: true, corr: false })); fm.markSaved(); fm.render(false);
      const n = s[ph].tanks.length - 1; reveal(`[data-tank="${ph}:${n}"]`, `select[data-tanksel="${ph}:${n}"]`); return true;
    }
    case 'emptyBefore': s.after.tanks[+b.dataset.i].emptyBefore = b.dataset.v === '1'; return done();
    case 'densManual': case 'densAuto': { const t = s.after.tanks[+b.dataset.i]; t.densAuto = a === 'densAuto'; if (!t.densAuto && !t.dens) { const x = autoDens(t); if (x) t.dens = x.d.toFixed(4); } return done(); }
    case 'tab': s.ui.tab[b.dataset.ph] = b.dataset.t; fm.render(false); return true;
    case 'tsTab': s.ui.tsTab = b.dataset.t; fm.render(false); return true;
    case 'gotoSup': s.ui.tab.before = 'sup'; s.ui.step = SI('before'); fm.render(true); return true;
    case 'addBT': { const L = s.grades[b.dataset.g].del[+b.dataset.j].btanks; L.push({ id: nid(), name: '', open: true, b: BM(), a: BM() }); done(); reveal(document.querySelector(`[data-act="delBT"][data-g="${b.dataset.g}"][data-j="${b.dataset.j}"][data-i="${L.length - 1}"]`)?.closest('.tank')); return true; }
    case 'btToggle': { const t = s.grades[b.dataset.g].del[+b.dataset.j].btanks[+b.dataset.i]; t.open = !t.open; fm.render(false); return true; }
    case 'delBT': {
      const L = s.grades[b.dataset.g].del[+b.dataset.j].btanks, t = L[+b.dataset.i]; if (!t) return true;
      modal(`Remove barge tank ${t.name ? t.name : '(no name yet)'}?`, '<p>The barge tank and its readings (before and after bunkering) are removed.</p>', [{ label: 'Cancel', value: null }, { label: 'Remove tank', value: 'rm', kind: 'danger' }])
        .then((v) => { if (v) { const k = L.indexOf(t); if (k >= 0) L.splice(k, 1); done('Barge tank removed'); } });
      return true;
    }
    case 'addDel': { const L = s.grades[b.dataset.g].del; L.push(D()); done(); reveal(`[data-del="${b.dataset.g}:${L.length - 1}"]`); return true; }
    case 'delDel': {
      const L = s.grades[b.dataset.g].del, d = L[+b.dataset.j]; if (!d) return true;
      removeRow(`Remove ${b.dataset.g} delivery ${+b.dataset.j + 1}?`, rowFilled({ ...d, truck: { ...d.truck, type: '' } }), () => { const k = L.indexOf(d); if (k >= 0) L.splice(k, 1); }, () => done('Delivery removed'));
      return true;
    }
    case 'addSmp': { const L = s.grades[b.dataset.g].del[+b.dataset.j].extra; L.push({ id: nid(), type: '', seal: '', desc: '', remark: '' }); done(); reveal(document.querySelector(`[data-act="delSmp"][data-g="${b.dataset.g}"][data-j="${b.dataset.j}"][data-k="${L.length - 1}"]`)?.closest('.srow')); return true; }
    case 'delSmp': {
      const L = s.grades[b.dataset.g].del[+b.dataset.j].extra, r = L[+b.dataset.k]; if (!r) return true;
      removeRow(`Remove added sample ${+b.dataset.k + 1}?`, rowFilled(r), () => { const k = L.indexOf(r); if (k >= 0) L.splice(k, 1); }, () => done('Sample removed'));
      return true;
    }
    case 'copyTanks': {
      const have = usedTankKeys(s.after.tanks, famOf); let n = 0; // a tank is copied only once per list
      // copy completely: method, readings, TOV, temperature, density, trim/list flag; the surveyor overwrites the tanks that received bunkers
      s.before.tanks.forEach((t) => {
        if (!t.name || have.has(tankKey(famOf(t.grade), t.name))) return;
        have.add(tankKey(famOf(t.grade), t.name));
        const hasDens = num(t.dens) != null;
        s.after.tanks.push(T(t.grade, t.name, t.method, 'after', { open: false, corr: !!t.corr, reading: t.reading, tov: t.tov, temp: t.temp, dens: t.dens, rem: t.rem || '', densAuto: !hasDens }));
        n++;
      });
      return done(n ? `${n} tank${n > 1 ? 's' : ''} copied` : 'All tanks are already listed');
    }
    case 'splitTs': {
      if (signed('ts')) return false;
      // one block per delivery (its hose, pumping and BDN events, in the original order), placed where the first of them stood
      const L = delivs(); if (L.length < 2) return true;
      const ev = s.ts.events, isDl = (e) => e.dl == null && DL_CODES.includes(e.code);
      const dlEv = ev.filter(isDl); if (!dlEv.length) return true;
      const block = L.flatMap((x, k) => dlEv.map((e) => Object.assign({}, e, { id: k === 0 ? e.id : nid(), dl: x.id, custom: k > 0 ? true : !!e.custom })));
      const at = ev.findIndex(isDl), rest = ev.filter((e) => !isDl(e));
      rest.splice(ev.slice(0, at).filter((e) => !isDl(e)).length, 0, ...block);
      s.ts.events = rest; s.ui.tsTab = 'c'; return done('Times separated per delivery – one tab per delivery');
    }
    case 'mergeTs': {
      if (signed('ts')) return false;
      const seen = new Set();
      s.ts.events = s.ts.events.filter((e) => { if (e.dl == null) return true; if (DL_CODES.includes(e.code)) { if (seen.has(e.code)) return false; seen.add(e.code); } delete e.dl; return true; });
      return done('One set of times for all deliveries');
    }
    case 'addEv': {
      if (signed('ts')) return false;
      const nv = s.newEv, def = TSEV.find((x) => x[0] === nv.type); if (!def) return true; const ev = s.ts.events;
      const prevD = [...ev].reverse().find((e) => e.d); const label = nv.type === 'other' ? String(nv.other || '').trim() : def[1];
      if (!label) { toast('Enter the event description.'); return true; }
      const tb = tsTab(), tx = tb && tb !== 'all' && tb !== 'c' ? delivs().find((v) => String(v.id) === tb) : null;
      const dl = tb && tb !== 'all' ? (tx ? tx.id : null) : nv.dl ? +nv.dl : null; const e0 = { id: nid(), label, code: nv.type, d: prevD ? prevD.d : '', t: '', key: false, custom: true }; if (dl != null && dlLabel(dl)) e0.dl = dl;
      ev.push(e0); s.newEv = { type: '', other: '', dl: '' }; fm.markSaved(); fm.render(false);
      const ti = document.getElementById('ts_' + (ev.length - 1)); reveal(ti && (ti.closest('tr, .ts-row, li, .row') || ti), ti); return true;
    }
    default: return false;
  }
}
export function beforeSet(pth, v) {
  const mm = pth.match(/^grades\.(\w+)\.del\.(\d+)\.btanks\.(\d+)\.(b|a)\.method$/);
  if (mm) { const m = S().grades[mm[1]].del[+mm[2]].btanks[+mm[3]][mm[4]]; if ((m.method === 'gauge') !== (v === 'gauge') && (m.reading || m.gauge || m.tov || m.trim || m.list)) { Object.assign(m, { reading: '', trim: '', list: '', gauge: '', tov: '' }); toast('Method changed: readings and volume cleared.'); } }
}
export function tankNameTaken(ph, i, name) {
  const s = S(), t = s[ph].tanks[i]; return usedTankKeys(s[ph].tanks, famOf, i).has(tankKey(famOf(t.grade), name));
}
export function addNewTank(ph, i, name, cap) {
  const s = S(), t = s[ph].tanks[i], fam = famOf(t.grade);
  if (!s.VT.some((x) => x.fam === fam && x.name.toLowerCase() === name.toLowerCase())) s.VT.push({ name, fam, cap, isNew: true });
  t.name = s.VT.find((x) => x.fam === fam && x.name.toLowerCase() === name.toLowerCase()).name;
}

/** Summary for the submit confirmation */
export function submitSummary() {
  const rows = results().map((r) => `<span class="gchip">${r.g}</span><span class="v">${fx(r.delivered)} MT</span><span class="v ${r.within ? 'pos' : 'crit'}">${sgn(r.pct)}% vs BDN</span>`).join('');
  const F = flags(), nPh = Object.values(S().photos).reduce((n, x) => n + x.length, 0);
  return `<div class="cmp" style="grid-template-columns:auto 1fr auto;align-items:center">${rows}</div>
    <p>Delivered quantities as shown (preview), ${Object.keys(S().sig).filter(hasSig).length} signatures and ${nPh} photos.${F.length ? ` <b>${F.length} item${F.length > 1 ? 's are' : ' is'} flagged for ops.</b>` : ''}</p>
    <p>After submission no changes can be made here. GlobalBQS recalculates the figures, checks the survey and issues the report to the client.</p>`;
}

// ---------- start check (gate) ----------
export function gateCorrections(s = S()) {
  const G = s.gate || {}, a = G.answers || {}, f = G.fix || {}, o = s.order, out = [];
  if (a.vessel === 'n') {
    if (f.vessel != null && String(f.vessel).trim() && f.vessel.trim() !== o.vessel) out.push({ field: 'vessel_name', expected_value: o.vessel || null, corrected_value: f.vessel.trim(), expected_survey_type: null, remark: null });
    if (f.imo != null && String(f.imo).trim() && String(f.imo).trim() !== o.imo) out.push({ field: 'imo_number', expected_value: o.imo || null, corrected_value: String(f.imo).trim(), expected_survey_type: null, remark: null });
  }
  if (a.type === 'n' && f.typeExp) out.push({ field: 'survey_type', expected_value: o.type || null, corrected_value: null, expected_survey_type: f.typeExp, remark: f.typeNote || null });
  if (a.grades === 'n') {
    Object.keys(f).filter((k) => k.startsWith('g_') && String(f[k]).trim()).forEach((k) => {
      const g = k.slice(2); out.push({ field: 'grade_' + g, expected_value: s.grades[g] && s.grades[g].nominated ? s.grades[g].nominated + ' MT' : null, corrected_value: String(f[k]).trim(), expected_survey_type: null, remark: null });
    });
    if (String(f.gradesNote || '').trim()) out.push({ field: 'grades', expected_value: null, corrected_value: null, expected_survey_type: null, remark: f.gradesNote.trim() });
  }
  return out;
}
export const gateGrades = (s) => Object.keys(s.grades).filter((g) => s.grades[g].on).map((g) => [g, s.grades[g].nominated || '']);

// ---------- submit payload (contract gbqs.forms/1) ----------
const nn = (v) => { const x = num(v); return x == null ? null : x; };
const str = (v) => { const x = String(v ?? '').trim(); return x || null; };
const d4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

/**
 * Build the payload. sigFiles: {sigKey: client_file_id} for the PNGs generated at submit time.
 * Returns {payload, fileIds}.
 */
export function toPayload(s, { formVersion, sigFiles }) {
  ctx.S = s;
  const off = portOffset() || null;
  const sv = s.survey, o = s.order, gc = gateCorrections(s), act0 = Object.keys(s.grades).filter((g) => s.grades[g].on);
  const fileIds = new Set();
  const useFile = (id) => { if (id) fileIds.add(id); return id || null; };
  const photos = [];
  const addPhotos = (list, section, skipFirst) => (list || []).forEach((p, i) => { if (skipFirst && i === 0) return; photos.push({ file: useFile(p.id), section }); });

  // tanks
  const tanks = [];
  const tankRow = (t, phase, extra = {}) => {
    const vt = s.VT.find((x) => x.name === t.name && x.fam === famOf(t.grade));
    return Object.assign({
      phase, grade: t.grade, grade_group: famOf(t.grade), tank_name: str(t.name), method: METHOD_KEY[t.method] || 'sounding',
      raw_value: nn(t.reading), trim_list_corrected: t.method === 'G' ? null : !!t.corr, tov_m3: nn(tovOf(t)), temp_c: nn(t.temp),
      density_15: d4(effDens(t)), capacity_m3: vt && vt.isNew && vt.cap != null ? vt.cap : null, not_measured: false, not_measured_reason: null, remark: str(t.rem),
    }, extra);
  };
  for (const t of s.before.tanks) if (act0.includes(t.grade)) tanks.push(tankRow(t, 'before'));
  for (const t of s.after.tanks) {
    if (!act0.includes(t.grade)) continue;
    if (afterOnly(t) && t.emptyBefore) tanks.push(tankRow(t, 'before', { raw_value: 0, tov_m3: 0, trim_list_corrected: null, remark: 'Not sounded before bunkering; recorded as empty by the surveyor' }));
    tanks.push(tankRow(t, 'after'));
  }

  // deliveries
  const deliveries = []; let seq = 0; const seqOf = {};
  for (const g of act0) {
    const G = s.grades[g];
    G.del.forEach((d, j) => {
      seq++; seqOf[d.id] = seq;
      const measurements = [];
      const M = (x) => Object.assign({ phase: null, kind: null, tank_name: null, method: null, raw_value: null, trim_list_corrected: null, tov_m3: null, temp_c: null, density_15: null, meter_reading: null, meter_factor: null, weighbridge_mt: null, file: null, not_measured: false, not_measured_reason: null }, x);
      if (s.sup.mode === 'measured') {
        if (d.by === 'barge') d.btanks.forEach((t) => [['b', 'before'], ['a', 'after']].forEach(([k, ph]) => {
          const m = t[k], gauge = m.method === 'gauge';
          measurements.push(M({ phase: ph, kind: 'barge_tank', tank_name: str(t.name), method: gauge ? 'gauge' : (m.method === 'ullage' ? 'ullage' : 'sounding'),
            raw_value: gauge ? nn(m.gauge) : corrected(m), trim_list_corrected: gauge ? null : (num(m.trim, 1) != null || num(m.list, 1) != null),
            tov_m3: gauge ? nn(m.gauge) : nn(m.tov), temp_c: nn(m.temp) }));
        }));
        else if (d.by === 'truck') [['b', 'before'], ['a', 'after']].forEach(([k, ph]) => {
          const pk = `trk_${d.id}_${k}`, first = (s.photos[pk] || [])[0];
          if (d.truck.type === 'weigh') measurements.push(M({ phase: ph, kind: 'truck', tank_name: str(d.name), method: 'weighbridge', weighbridge_mt: nn(d.truck[k]), file: useFile(first && first.id) }));
          else measurements.push(M({ phase: ph, kind: 'truck', tank_name: str(d.name), method: 'meter', meter_reading: nn(d.truck[k]), file: useFile(first && first.id) }));
          addPhotos(s.photos[pk], d.truck.type === 'weigh' ? 'photo_supplier_weighbridge' : 'photo_supplier_meter', true);
        });
        else if (d.by === 'pipeline') [['b', 'before'], ['a', 'after']].forEach(([k, ph]) => {
          const pk = `pip_${d.id}_${k}`, first = (s.photos[pk] || [])[0];
          measurements.push(M({ phase: ph, kind: 'pipeline', tank_name: str(d.pipe.meter), method: 'meter', meter_reading: nn(d.pipe[k]), meter_factor: nn(d.pipe.factor), file: useFile(first && first.id) }));
          addPhotos(s.photos[pk], 'photo_supplier_meter', true);
        });
      }
      const samples = [];
      if (d.samples === 'yes') {
        ['marpol', 'ship', 'supplier'].forEach((k) => { if (String(d.seals[k] || '').trim()) samples.push({ sample_type: STYPE_NAME[k], seal_number: String(d.seals[k]).trim(), description: null, remark: null, is_extra: false }); });
        d.extra.forEach((r) => { if (String(r.seal || '').trim()) samples.push({ sample_type: r.type === 'other' ? 'Other' : (STYPE_NAME[r.type] || 'Sample'), seal_number: String(r.seal).trim(), description: r.type === 'other' ? str(r.desc) : null, remark: str(r.remark), is_extra: true }); });
      }
      const remarks = [];
      if (s.sup.mode === 'notmeasured') remarks.push('Supplier figures not measured' + (s.sup.reason ? ': ' + s.sup.reason : ''));
      deliveries.push({
        seq, client_ref: 'd' + d.id, grade: g, bdn_number: str(d.bdn), delivery_mode: d.by || null, carrier_name: str(d.name),
        supplier: str(G.supplier), supplier_rep: str(G.rep), nominated_qty_mt: j === 0 ? nn(G.nominated) : null, bdn_qty_mt: nn(d.qty), bdn_density_15: nn(d.dens),
        bdn_file: null, samples_status: d.samples === 'yes' ? 'taken' : d.samples === 'no' ? 'none' : null,
        no_samples_reason: d.samples === 'no' ? [lbl(NOREASON, d.noReason), str(d.noRemark)].filter(Boolean).join(' – ') || null : null,
        sampling_point: d.samples === 'yes' ? (lbl(POINTS, d.point) || null) : null, remark: remarks.join('; ') || null,
        measurements, samples,
      });
    });
  }

  // LOPs
  const LALL = LOPV.concat(LOPX);
  const lops = s.bdn.lop === 'yes' ? s.lops.map((l) => {
    const ph = s.photos['lop_' + l.id] || [];
    addPhotos(ph, 'lop_photo', true);
    return { direction: l.dir === 'in' ? 'received_by_vessel' : 'issued_by_vessel', issued_by: lbl(LALL, l.by) || null, issued_to: lbl(LALL, l.to) || null, subject: lbl(LOPS, l.subject) || null, person_name: str(l.name), remark: str(l.remarks), file: useFile(ph[0] && ph[0].id) };
  }) : [];

  // signatures
  const vesselName = str(sv.chief) || str(sv.master);
  const vesselRole = str(sv.chief) ? 'chief_engineer' : 'master';
  const SIGS = [['beforeMaster', 'before', 'vessel'], ['beforeSurveyor', 'before', 'surveyor'], ['finalMaster', 'after', 'vessel'], ['finalSurveyor', 'after', 'surveyor'], ['ts', 'timesheet', 'vessel']];
  const signatures = [];
  for (const [k, section, who] of SIGS) {
    const sig = s.sig[k], no = s.vno[k];
    const role = who === 'surveyor' ? 'surveyor' : vesselRole, name = who === 'surveyor' ? str(sv.surveyor) : vesselName;
    if (no) {
      signatures.push({ section, role, signer_name: name, status: 'not_signed', reason: str(no.reason), signed_at_local: no.at_local || null, utc_offset: no.utc_offset || off, file: null });
      addPhotos(s.photos['vno_' + k], 'photo_not_signed');
    } else if (sig && sig.strokes && sig.strokes.length) {
      signatures.push({ section, role, signer_name: name, status: sig.mode === 'receipt' ? 'receipt_only' : 'signed', reason: null, signed_at_local: sig.at_local || null, utc_offset: sig.utc_offset || off, file: useFile(sigFiles && sigFiles[k]) });
    }
  }

  // timesheet
  const multi = Object.keys(seqOf).length > 1;
  const timesheet = s.ts.events.filter((e) => e.d && e.t).map((e, i) => {
    const ds = multi && e.dl != null && seqOf[e.dl] ? seqOf[e.dl] : null;
    return { seq: i + 1, event_key: e.code || 'other', label: (ds ? dlLabel(e.dl) + ' – ' : '') + e.label, at_local: `${e.d}T${e.t}`, utc_offset: off, delivery_seq: ds };
  });

  // photos
  addPhotos(s.photos.bdn, 'bdn_document');
  addPhotos(s.photos.seals, 'photo_seals');
  addPhotos(s.photos.other, 'photo_other');

  // fields without a place in contract gbqs.forms/1 (yet) -> extra (not in the remarks)
  const extra = {
    list_side: { P: 'port', S: 'starboard', U: 'upright' }[sv.listSide] || null,
    consumed_during_bunkering_mt: Object.fromEntries(act0.map((g) => [g, nn(s.after.consumed[g])]).filter(([, v]) => v != null)),
    unlock_log: s.audit.map((a) => ({ part: a.label, reason: a.reason, at: a.at })),
  };

  const imoFix = gc.find((x) => x.field === 'imo_number');
  const payload = {
    contract: 'gbqs.forms/1',
    form_key: key,
    form_version: formVersion || '1.0',
    completed_at: new Date().toISOString(),
    survey: {
      place: str(s.ts.location) || str(o.place), utc_offset: off,
      date_of_survey: str(sv.date), time_of_survey: str(sv.time),
      port_of_registry: str(sv.registry), imo_number: imoFix ? imoFix.corrected_value : str(o.imo),
      master_name: str(sv.master), chief_engineer_name: str(sv.chief), surveyor_name: str(sv.surveyor),
      owner: str(o.owner), charterer: str(o.charterer), po_number: str(o.po),
      draft_fwd_m: nn(sv.draftFwd), draft_aft_m: nn(sv.draftAft), list_deg: sv.listSide === 'U' ? 0 : nn(sv.list),
      logbook: Object.fromEntries(act0.map((g) => [g, nn(s.before.logbook[g])])),
      master_remarks: String(s.bdn.remMaster || ''), surveyor_remarks: String(s.bdn.remSurveyor || '').trim(), timesheet_remarks: String(s.ts.remarks || ''),
      overall_condition: null, conclusion: null,
    },
    grades: act0,
    tanks,
    deliveries,
    samples: [],
    lops,
    signatures,
    timesheet,
    gate_corrections: gc,
    condition_items: [],
    damages: [],
    photos,
    extra,
  };
  return { payload, fileIds: [...fileIds] };
}

/** signature keys that need a PNG at submit time */
export const signatureKeys = () => Object.keys(S().sig).filter(hasSig);
