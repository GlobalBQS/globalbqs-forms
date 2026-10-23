export const __v = '1.1.12-20261023-6b99a1aa';
// B221 (Bunker Quantity Survey), On-/Off-Hire Bunker, On-/Off-Hire B+C and On-/Off-Hire Condition.
// One factory, four approved mockups ("as received"): the B+C mockup is the union of the bunker part
// (vessel, fuel types & logbook, tank soundings, result) and the condition part (hull & main deck,
// deck fittings & safety, cargo holds, engine room, damages & conclusion). Shared components from
// components.js (tank rows, signatures with the "sign only when complete" rule, photos, LOP, review).
import { esc, ICON, note, toast, offsetMin, deviceOffset, OFFSETS, fmtDate } from '../ui.js?v=1.1.12-20261023-6b99a1aa';
import { num, fx, sgn, r2, kgl, weigh, isInt } from './calc.js?v=1.1.12-20261023-6b99a1aa';
import {
  ctx, getPath, field, area, selectField, seg, confirmBox, vSig, sigPad, lockBar, photoBlock, tankCard, calc4, CALC_NOTE,
  tovOf, METHOD_KEY, lopCard, LOPV, LOPX, LOPS, lbl, reviewList, flagList, hasSig, portNow, portOffset, offsetPicker, sigGate, gateCorrectionsFrom,
  tankKey, usedTankKeys, duplicateTanks, freeTanks, removeRow, rowFilled, dropPhotos,
} from './components.js?v=1.1.12-20261023-6b99a1aa';

const BASE_GRADES = ['VLSFO', 'HSFO', 'LSMGO', 'MDO'];
const DO_GRADES = ['LSMGO', 'MGO', 'MDO', 'DMA', 'DMB', 'DMZ', 'ULSMGO'];
const famOf = (g) => (DO_GRADES.includes(String(g).toUpperCase()) ? 'do' : 'fo');
const STAT = [['good', 'Good'], ['fair', 'Fair'], ['damaged', 'Damaged'], ['na', 'N/A']];
const SECS = [
  { id: 'hull', step: 'hull', key: 'hull', t: 'Hull condition', items: [['shell', 'Shell plating'], ['coating', 'Coating'], ['corrosion', 'Corrosion / pitting'], ['fouling', 'Hull fouling']] },
  { id: 'deck', step: 'hull', key: 'main_deck', t: 'Main deck', items: [['deckplate', 'Deck plating'], ['coamings', 'Hatch coamings'], ['drainage', 'Deck drainage'], ['bulwarks', 'Bulwarks / railings']] },
  { id: 'fit', step: 'deck', key: 'deck_fittings', t: 'Deck fittings', items: [['mooring', 'Mooring winches'], ['anchors', 'Anchors / windlass'], ['cranes', 'Cranes / derricks'], ['ladders', 'Ladders / gangway']] },
  { id: 'safety', step: 'deck', key: 'deck_machinery_safety', t: 'Deck machinery & safety equipment', items: [['ff', 'Fire fighting equipment'], ['lsa', 'Life-saving appliances'], ['emerg', 'Emergency equipment'], ['navlights', 'Navigation lights']] },
  { id: 'er', step: 'engine', key: 'engine_room', t: 'Engine room', items: [['erapp', 'General appearance'], ['erhouse', 'House keeping'], ['ercrit', 'Status critical equipment']] },
];
const ITEMS = {}; SECS.forEach((s) => s.items.forEach(([k, n]) => { ITEMS[k] = { k, n, sec: s.id, secT: s.t, step: s.step, secKey: s.key }; }));
const DEFAULT_HOLD_ITEMS = [['tank_top', 'Tank top'], ['hopper_sides', 'Hopper sides'], ['side_shell_frames', 'Side shell / frames'], ['topside_sloping_plates', 'Topside sloping plates'], ['transverse_bulkheads', 'Transverse bulkheads'], ['ladders_access', 'Ladders / access'], ['hatch_coaming', 'Hatch coaming'], ['hatch_covers_seals', 'Hatch covers & seals'], ['bilge_wells', 'Bilge wells']];
const AREAS = [['hull', 'Hull'], ['deck', 'Main deck'], ['fit', 'Deck fittings'], ['safety', 'Machinery & safety equipment'], ['hold', 'Cargo hold'], ['er', 'Engine room'], ['accom', 'Accommodation'], ['other', 'Other']];
const CMP = [['existing', 'Existing at on-hire'], ['new', 'New since on-hire'], ['notrec', 'Not in on-hire report']];
const OVERALL = [['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor']];
const bad = (st) => st === 'fair' || st === 'damaged';

const VARIANTS = {
  bunker_quantity_survey: { kind: 'b221', title: 'Bunker Quantity Survey (B221)', version: 'B221 1.0', phase: 'single', bunker: true, cond: false, lops: true },
  on_hire_bunker: { kind: 'bunker', off: false, title: 'On-Hire Bunker Survey', version: 'BH 1.0', phase: 'on_hire', bunker: true, cond: false },
  off_hire_bunker: { kind: 'bunker', off: true, title: 'Off-Hire Bunker Survey', version: 'BH 1.0', phase: 'off_hire', bunker: true, cond: false },
  on_hire_bc: { kind: 'bc', off: false, title: 'On-Hire Bunker & Condition Survey', version: 'BC 1.0', phase: 'on_hire', bunker: true, cond: true },
  off_hire_bc: { kind: 'bc', off: true, title: 'Off-Hire Bunker & Condition Survey', version: 'BC 1.0', phase: 'off_hire', bunker: true, cond: true },
  on_hire_condition: { kind: 'condition', off: false, title: 'On-Hire Condition Survey', version: 'CS 1.0', phase: null, bunker: false, cond: true },
  off_hire_condition: { kind: 'condition', off: true, title: 'Off-Hire Condition Survey', version: 'CS 1.0', phase: null, bunker: false, cond: true },
};

export function create(key) {
  const V = VARIANTS[key];
  if (!V) return null;
  const S = () => ctx.S;
  const OFF = () => !!V.off;
  const HIRE = V.kind === 'b221' ? null : (V.off ? 'Redelivery' : 'Delivery');
  const TOL = () => +S().order.tol || 0.5;
  const HOLD_ITEMS = () => S().holdItems || DEFAULT_HOLD_ITEMS;
  const GRADES = () => Object.keys(S().grades || {});
  const active = () => GRADES().filter((g) => S().grades[g].on);

  // ---------- steps & phases ----------
  const STEPS = [{ id: 'vessel', t: 'Vessel & survey', d: 'Order details are filled in for you. Add what you find on board.', part: V.kind === 'bc' ? 1 : null, partLabel: 'Part 1 · Bunker' }];
  if (V.bunker) {
    STEPS.push({ id: 'grades', t: 'Fuel types & logbook', d: 'Tick each fuel type on board and enter the logbook ROB at the time of survey.' });
    STEPS.push({ id: 'tanks', t: 'Tank soundings', d: 'Sound every tank of the ticked fuel types, including settling and service tanks.' });
    if (V.kind === 'bc') STEPS.push({ id: 'bunker', t: 'Bunker result & signatures', d: 'Surveyed figures against the logbook. The Master / Chief Engineer and you sign the bunker figures.' });
    else STEPS.push({ id: 'result', t: V.kind === 'b221' ? 'Result & LOP' : 'Bunker summary', d: V.kind === 'b221' ? 'Surveyed figures against the logbook, Letters of Protest and remarks.' : 'Surveyed figures against the logbook, with remarks.' });
  }
  if (V.cond) {
    const p2 = V.kind === 'bc' ? 2 : null;
    STEPS.push({ id: 'hull', t: 'Hull & main deck', d: 'Rate each item. Damaged needs a remark; photos are optional.', part: p2, partLabel: 'Part 2 · Condition' });
    STEPS.push({ id: 'deck', t: 'Deck fittings & safety', d: 'Rate each item. Damaged needs a remark; photos are optional.', part: p2, partLabel: 'Part 2 · Condition' });
    STEPS.push({ id: 'holds', t: 'Cargo holds', d: 'Add each hold; the standard hold items load automatically.', part: p2, partLabel: 'Part 2 · Condition' });
    STEPS.push({ id: 'engine', t: 'Engine room', d: 'General condition, critical equipment and maintenance status.', part: p2, partLabel: 'Part 2 · Condition' });
    STEPS.push({ id: 'concl', t: 'Damages, photos & conclusion', d: 'Damage register, photos, conclusion, your review, the signatures and submit.', part: p2, partLabel: 'Part 2 · Condition' });
  } else {
    STEPS.push({ id: 'submit', t: 'Photos, signatures & submit', d: 'Add the photos, check the open items, then the Master / Chief Engineer and you sign the figures and you submit.' });
  }
  if (V.kind === 'bc') STEPS.forEach((s, i) => { if (i > 0 && !s.part) s.part = 1; });
  STEPS.forEach((s) => { if (s.part === 1) s.partLabel = 'Part 1 · Bunker'; });
  const SI = (id) => STEPS.findIndex((s) => s.id === id);
  const bunkerStep = V.kind === 'bc' ? 'bunker' : 'submit';
  const lastStep = V.cond ? 'concl' : 'submit';

  const PHASE = {};
  const SIGLBL = {};
  if (V.bunker) {
    PHASE.bunker = { keys: ['bMaster', 'bSurveyor'], label: V.kind === 'b221' ? 'The figures' : 'The bunker figures', confirm: 'confirm', steps: V.kind === 'bc' ? ['grades', 'tanks', 'bunker'] : ['grades', 'tanks', 'result'] };
    SIGLBL.bMaster = V.cond ? 'Master / C/E, bunker figures' : 'Master / Chief Engineer'; SIGLBL.bSurveyor = V.cond ? 'Surveyor, bunker figures' : 'Bunker surveyor';
  }
  if (V.cond) {
    PHASE.cond = { keys: ['cMaster', 'cSurveyor'], label: 'The condition findings', confirm: 'cond.confirm', steps: ['hull', 'deck', 'holds', 'engine'] };
    SIGLBL.cMaster = V.bunker ? 'Master / C/E, condition' : 'Master / Chief Engineer'; SIGLBL.cSurveyor = V.bunker ? 'Surveyor, condition' : 'Surveyor';
  }

  // ---------- state ----------
  let seed = 1, initing = false;
  const nid = () => (!initing && ctx.S && ctx.form && ctx.form.nextId ? ctx.form.nextId() : seed++);
  const T = (grade) => ({ id: nid(), grade, name: '', method: 'S', reading: '', tov: '', rem: '', temp: '', dens: '', corr: false, open: true });
  const newHold = (n) => { const it = {}; HOLD_ITEMS().forEach(([k]) => { it[k] = { st: '', rem: '' }; }); return { id: nid(), hold: n || '', open: true, items: it }; };

  function initState(prefill) {
    seed = 1; initing = true;
    try {
      const p = prefill || {};
      const sv = p.survey || {}, port = p.port || {}, ves = p.vessel || {}, par = p.parties || {}, sch = p.schedule || {}, nom = p.nomination || {};
      const names = [...BASE_GRADES];
      (nom.deliveries || []).forEach((d) => { const g = String(d.grade || '').toUpperCase(); if (g && !names.includes(g)) names.push(g); });
      const grades = {}; names.forEach((g) => { grades[g] = { on: false, logbook: '' }; });
      const VT = [];
      for (const fam of ['fo', 'do']) for (const t of (p.tanks || {})[fam] || []) if (t && t.tank_name) VT.push({ name: t.tank_name, fam, cap: t.capacity_m3 != null ? +t.capacity_m3 : null, isNew: false });
      const hi = Array.isArray(p.hold_items) && p.hold_items.length ? p.hold_items.filter((x) => x && x.key).map((x) => [String(x.key), String(x.label || x.key)]) : DEFAULT_HOLD_ITEMS;
      const items = {}; Object.keys(ITEMS).forEach((k) => { items[k] = { st: '', rem: '' }; });
      const off = port.utc_offset && offsetMin(port.utc_offset) != null ? port.utc_offset : '';
      return {
        v: 1, form_key: key,
        order: {
          ref: sv.gbqs_reference || '', vessel: ves.name || '', imo: ves.imo ? String(ves.imo) : '', place: port.place || port.name || '', port: port.name || '',
          etb: sch.etb || sch.eta || '', type: sv.survey_type_label || V.title, utcOffset: off, tol: p.tolerance_pct ?? p.client?.delivery_tolerance_pct ?? 0.5,
          client: p.client?.name || '', owner: par.owner || '', charterer: par.charterer || '', agent: par.agent || '', po: sv.po_number || '', instructions: sv.instructions || '',
          charter: p.charter && typeof p.charter === 'object' ? p.charter : null,
          onHire: p.on_hire_survey && typeof p.on_hire_survey === 'object' ? p.on_hire_survey : null,
        },
        survey: { registry: '', master: sv.master_name || '', chief: '', surveyor: p.surveyor?.name || '', date: '', time: '', draftFwd: '', draftAft: '', listSide: '', list: '', utcOffset: '' },
        VT, grades, holdItems: hi,
        rob: { tanks: [] }, confirm: false, rem: { master: '', surveyor: '' }, lop: '', lops: [],
        cond: { items, x: { hullClean: '', ropes: '', linerDue: '', coc: '', cocText: '', routine: '', critical: '', critRem: '', erRem: '' }, holds: [], damages: [], general: '', overall: '', steve: { ans: '', rows: [], rem: '' }, confirm: false, remMaster: '' },
        ts: { events: [] },
        photos: { log: [], tanks: [], other: [] },
        sig: {}, smode: {}, vno: {}, audit: [], final: false,
        ui: { step: 0, tab: {} },
        gate: { answers: {}, fix: {}, done: false },
        meta: { uid: 2000, savedAt: null, submitted: false },
      };
    } finally { initing = false; }
  }

  // ---------- calculations ----------
  const tankCap = (name, fam) => { const t = S().VT.find((x) => x.name === name && (!fam || x.fam === fam)); return t && t.cap != null ? t.cap : null; };
  function tankCapFor(path) { const m = path.match(/^rob\.tanks\.(\d+)\./); if (!m) return null; const t = S().rob.tanks[+m[1]]; return t ? tankCap(t.name, famOf(t.grade)) : null; }
  const calcTank = (t) => weigh(num(tovOf(t)), t.temp, kgl(num(t.dens)));
  function gradeTotal(g) { const ts = S().rob.tanks.filter((t) => t.grade === g); if (!ts.length) return null; let sum = 0; for (const t of ts) { const c = calcTank(t); if (!c) return null; sum += c.mt; } return r2(sum); }
  function results() {
    return active().map((g) => {
      const sur = gradeTotal(g), log = num(S().grades[g].logbook);
      const diff = sur != null && log != null ? r2(sur - log) : null, pct = diff != null && log ? diff / log * 100 : null;
      return { g, sur, log, diff, pct, within: pct == null ? null : Math.abs(pct) <= TOL() + 1e-9 };
    });
  }
  const nPh = (k) => (S().photos[k] || []).length;
  const holdLbl = (h, k) => `Hold ${h.hold || '?'} · ${lbl(HOLD_ITEMS(), k)}`;
  function linkDamage(src, areaKey, label, on) {
    const D = S().cond.damages, i = D.findIndex((d) => d.src === src);
    if (on && i < 0) D.push({ id: nid(), src, srcLbl: label, area: areaKey, loc: '', desc: '', cmp: '' });
    else if (!on && i >= 0 && !String(D[i].desc || '').trim() && !nPh('dmg_' + D[i].id)) D.splice(i, 1);
  }

  // ---------- open items ----------
  function issues() {
    const L = []; const add = (id, msg, tab, sign) => L.push({ s: SI(id), msg, tab: tab || null, sign: !!sign });
    const s = S(), sv = s.survey, C = s.cond, X = C.x;
    const needSig = (id, k) => { if (s.vno[k]) { if (!String(s.vno[k].reason || '').trim()) add(id, 'Reason the vessel did not sign (' + SIGLBL[k] + ')', null, true); } else if (!hasSig(k)) add(id, 'Signature ' + SIGLBL[k], null, true); };
    if (!portOffset()) add('vessel', 'Local time of the port (UTC offset)');
    if (!sv.master) add('vessel', 'Name of the Master');
    if (!sv.chief) add('vessel', 'Name of the Chief Engineer');
    if (!sv.date || !sv.time) add('vessel', 'Date and time of survey');
    if (V.bunker) {
      if (num(sv.draftFwd) == null || num(sv.draftAft) == null) add('vessel', 'Drafts forward and aft');
      if (!sv.listSide) add('vessel', 'List: port, upright or starboard'); else if (sv.listSide !== 'U' && num(sv.list) == null) add('vessel', 'List in degrees');
      if (!active().length) { add('grades', 'Tick at least one fuel type'); add('tanks', 'Tick the fuel types in step 2 first'); }
      for (const g of active()) {
        if (num(s.grades[g].logbook) == null) add('grades', g + ': logbook ROB at time of survey');
        const ts = s.rob.tanks.filter((t) => t.grade === g);
        if (!ts.length) add('tanks', g + ': at least one tank');
        ts.forEach((t) => {
          if (!t.name) { add('tanks', g + ': choose the tank'); return; }
          if (num(t.reading) == null) add('tanks', t.name + ': ' + (t.method === 'U' ? 'ullage' : t.method === 'G' ? 'gauge reading' : 'sounding'));
          if (!calcTank(t)) add('tanks', t.name + ': volume, temperature or density');
        });
      }
      duplicateTanks(s.rob.tanks, famOf).forEach((n) => add('tanks', n + ': listed twice – remove one'));
      if (V.lops) {
        if (!s.lop) add('result', 'Any Letters of Protest?');
        if (s.lop === 'yes') {
          if (!s.lops.length) add('result', 'Add at least one Letter of Protest');
          s.lops.forEach((l, i) => {
            const n = 'Letter of Protest ' + (i + 1);
            if (!l.dir) add('result', n + ': issued or received by the vessel?');
            else { if (!l.by) add('result', n + ': issued by'); if (!l.to) add('result', n + (l.dir === 'out' ? ': issued to' : ': received by')); }
            if (!l.subject) add('result', n + ': subject');
            if (!(s.photos['lop_' + l.id] || []).length) add('result', n + ': photo of the signed LOP');
          });
        }
      }
      if (!s.confirm) add(bunkerStep, 'Confirmation of the bunker figures', null, true);
      needSig(bunkerStep, 'bMaster'); needSig(bunkerStep, 'bSurveyor');
    }
    if (V.cond) {
      SECS.forEach((sec) => sec.items.forEach(([k, n]) => {
        const it = C.items[k];
        if (!it.st) add(sec.step, `${sec.t}: rate ${n.toLowerCase()}`);
        else if (it.st === 'damaged' && !String(k === 'ercrit' ? X.critRem : it.rem).trim()) add(sec.step, `${n}: ${k === 'ercrit' ? 'comments' : 'remark'}`);
      }));
      if (C.items.mooring.st && C.items.mooring.st !== 'na' && !isInt(X.ropes)) add('deck', 'Total number of ropes (220 m)');
      if (!isInt(X.routine)) add('engine', 'Number of routine jobs overdue');
      if (!isInt(X.critical)) add('engine', 'Number of critical jobs overdue');
      if (!X.coc) add('engine', 'Any condition of class?'); else if (X.coc === 'yes' && !String(X.cocText || '').trim()) add('engine', 'Condition of class: details');
      if (!C.holds.length) add('holds', 'Add at least one hold');
      C.holds.forEach((h, i) => {
        if (!h.hold) add('holds', `Hold ${i + 1}: hold number`);

        const open = HOLD_ITEMS().filter(([k]) => !(h.items[k] || {}).st).length; if (open) add('holds', `Hold ${h.hold || i + 1}: rate ${open} item${open > 1 ? 's' : ''}`);
        HOLD_ITEMS().forEach(([k]) => { const it = h.items[k] || {}; if (it.st === 'damaged' && !String(it.rem || '').trim()) add('holds', holdLbl(h, k) + ': remark'); });
      });
      [...new Set(C.holds.map((h) => h.hold).filter((x, k, A) => x && A.indexOf(x) !== k))].forEach((x) => add('holds', `Hold ${x}: listed twice – remove one`));
      C.damages.forEach((d, i) => {
        const n = 'Damage ' + (i + 1);
        if (!d.area) add('concl', n + ': area'); if (!String(d.loc || '').trim()) add('concl', n + ': exact location'); if (!String(d.desc || '').trim()) add('concl', n + ': description');
        if (OFF() && !d.cmp) add('concl', n + ': compared with on-hire');
      });
      if (OFF()) {
        const St = C.steve;
        if (!St.ans) add('concl', 'Outstanding damages during the charter: no, or list them');
        else if (St.ans === 'yes') {
          if (!St.rows.length) add('concl', 'Add at least one outstanding stevedore damage');
          St.rows.forEach((r, i) => { if (!String(r.loc || '').trim()) add('concl', `Stevedore damage ${i + 1}: hold / location`); if (!String(r.desc || '').trim()) add('concl', `Stevedore damage ${i + 1}: description`); });
        }
      }
      if (!String(C.general || '').trim()) add('concl', 'General remarks / conclusion');
      if (!C.overall) add('concl', 'Overall condition');
      if (!C.confirm) add('concl', 'Confirmation of the condition findings', null, true);
      needSig('concl', 'cMaster'); needSig('concl', 'cSurveyor');
    }
    if (!s.final) add(lastStep, 'Your review as appointed surveyor', null, true);
    return L;
  }
  // the conclusion (damages, conclusion, overall) belongs to the condition findings: complete before signing
  if (V.cond) PHASE.cond.steps.push('concl');

  function flags() {
    const F = [], s = S(), C = s.cond, X = C.x;
    Object.keys(s.vno).forEach((k) => F.push(['bad', 'Not signed', `Vessel did not sign: ${SIGLBL[k]}${s.vno[k].reason ? ' – ' + s.vno[k].reason : ''}. The client will be informed.`]));
    Object.keys(s.sig).forEach((k) => { if (hasSig(k) && s.sig[k].mode === 'receipt') F.push(['warn', 'Receipt only', 'Signed for receipt only: ' + SIGLBL[k]]); });
    s.audit.forEach((a) => F.push(['warn', 'Unlocked', `${a.label} unlocked after signing, ${a.at}. Reason: ${a.reason}`]));
    s.VT.filter((t) => t.isNew).forEach((t) => F.push(['info', 'New tank', `Tank added on board: ${t.name}${t.cap != null ? ' (' + fx(t.cap, 1) + ' m³)' : ''}`]));
    if (V.bunker) results().filter((r) => r.within === false).forEach((r) => F.push(['bad', 'Logbook', `${r.g}: surveyed ${sgn(r.diff)} MT (${sgn(r.pct)}%) against the logbook`]));
    if (V.lops && s.lop === 'yes') s.lops.forEach((l) => { if (l.dir) F.push(['warn', 'LOP', `${l.dir === 'out' ? 'Issued by the vessel' : 'Received by the vessel'}: ${lbl(LOPV.concat(LOPX), l.by) || '?'} → ${lbl(LOPV.concat(LOPX), l.to) || '?'} · ${lbl(LOPS, l.subject) || 'subject not set'}${l.name ? ' · ' + l.name : ''}`]); });
    if (V.cond) {
      const dmg = Object.values(ITEMS).filter((i) => C.items[i.k].st === 'damaged').length + C.holds.reduce((n, h) => n + HOLD_ITEMS().filter(([k]) => (h.items[k] || {}).st === 'damaged').length, 0);
      if (C.damages.length) F.push(['warn', 'Damages', `${C.damages.length} damage${C.damages.length > 1 ? 's' : ''} in the register${dmg ? ` (${dmg} item${dmg > 1 ? 's' : ''} rated Damaged)` : ''}`]);
      if (OFF() && C.steve.ans === 'yes' && C.steve.rows.length) F.push(['warn', 'Stevedore', `${C.steve.rows.length} outstanding stevedore damage${C.steve.rows.length > 1 ? 's' : ''}`]);
      if (OFF()) { const nw = C.damages.filter((d) => d.cmp === 'new' || d.cmp === 'notrec').length; if (nw) F.push(['bad', 'New damage', `${nw} damage${nw > 1 ? 's' : ''} not in the on-hire report – possible charterers' claim`]); }
      if (num(X.critical) > 0) F.push(['bad', 'Engine room', `${X.critical} critical maintenance job${num(X.critical) > 1 ? 's' : ''} overdue`]);
      if (X.coc === 'yes') F.push(['warn', 'Class', `Condition of class: ${X.cocText || 'details not given'}`]);
      if (C.overall === 'poor') F.push(['bad', 'Overall', 'Overall condition rated Poor']);
    }
    const gc = gateCorrectionsFrom(s, []); if (gc.length) F.push(['info', 'Start check', `${gc.length} correction${gc.length > 1 ? 's' : ''} made at the start check`]);
    return F;
  }

  // ---------- renderers ----------
  const statSeg = (path, label) => { const v = getPath(path); return `<div class="seg sm stat" role="group" aria-label="${esc(label)}">${STAT.map(([val, txt]) => `<button type="button" data-act="set" data-path="${path}" data-val="${val}" aria-pressed="${v === val}">${txt}</button>`).join('')}</div>`; };
  const NEUTRAL = (t) => `<div class="note" style="background:var(--surface-2);border:1px solid var(--line);color:var(--muted)">${ICON.info}<div>${t}</div></div>`;
  function gradeGroup(g) {
    const s = S(); const tanks = s.rob.tanks.map((t, i) => [t, i]).filter(([t]) => t.grade === g);
    return `<section class="card" data-lockphase="bunker">
      <div class="card-h"><h3><span class="gchip">${g}</span>${tanks.length} ${tanks.length === 1 ? 'tank' : 'tanks'}</h3><span data-calc="sub:${g}"></span></div>
      ${tanks.length ? `<div class="tanks">${tanks.map(([t, i]) => tankCard('rob', t, i, { VT: s.VT, family: famOf(g), used: usedTankKeys(s.rob.tanks, famOf, i) })).join('')}</div>` : '<p class="empty">No tanks added yet.</p>'}
      <button class="btn add" type="button" data-act="addTank" data-grade="${g}">+ Add ${g} tank</button>
      <div data-calc="logdiff:${g}"></div></section>`;
  }
  function checkItem(k) {
    const s = S(), it = s.cond.items[k], I = ITEMS[k], p = 'cond.items.' + k;
    let extra = '';
    if (k === 'fouling') extra = `<div class="grid two">${field('Last hull cleaning', 'cond.x.hullClean', { type: 'date', opt: 1 })}</div>`;
    if (k === 'mooring' && it.st && it.st !== 'na') extra = `<div class="grid two">${field('Total number of ropes (220 m)', 'cond.x.ropes', { numeric: 1, req: 1, kind: 'ropes' })}</div>`;
    const need = it.st === 'damaged';
    return `<div class="ci${it.st ? ' st-' + it.st : ''}"><div class="ci-h"><span class="nm">${I.n}</span>${statSeg(p + '.st', I.n)}</div>
      ${extra}
      ${it.st ? area(k === 'ercrit' ? 'Critical equipment comments' : 'Remarks', k === 'ercrit' ? 'cond.x.critRem' : p + '.rem', { opt: !need, ph: need ? 'What, where, extent. E.g. coating breakdown at waterline, port side aft, approx. 2 m².' : '' }) : ''}
      ${bad(it.st) ? photoBlock('it_' + k, 'Photo of ' + I.n.toLowerCase()) + (need ? `<p class="link-tag"><b>Damaged</b> · added to the damage register in step ${SI('concl') + 1}.</p>` : '') : ''}
    </div>`;
  }
  const secCard = (sec) => `<section class="card" data-lockphase="cond"><div class="card-h"><h3>${sec.t}</h3><span data-calc="secn:${sec.id}"></span></div>
    <div class="clist">${sec.items.map(([k]) => checkItem(k)).join('')}</div>
    ${sec.id !== 'er' ? `<div class="secph">${photoBlock('sec_' + sec.id, sec.t + ' · overview photos')}</div>` : ''}</section>`;
  function holdBlock(h, i) {
    const p = `cond.holds.${i}`;
    const sum = `<div class="tank-head"><button class="tank-sum" type="button" data-act="holdToggle" data-i="${i}" data-keep aria-expanded="${!!h.open}"><span class="tsum" data-calc="hsum:${i}"></span>${ICON.chev}</button>
      <button class="icon-btn" type="button" data-act="delHold" data-i="${i}" aria-label="Remove hold ${esc(h.hold || i + 1)}" title="Remove hold">${ICON.x}</button></div>`;
    if (!h.open) return `<div class="tank" data-hold="${i}">${sum}</div>`;
    return `<div class="tank open" data-hold="${i}">${sum}<div class="tank-body">
      <div class="tank-top"><div class="grow">${selectField('Hold no.', p + '.hold', Array.from({ length: 9 }, (_, k) => [String(k + 1), 'Hold ' + (k + 1)]), { req: 1, taken: new Set(S().cond.holds.filter((x, k) => k !== i && x.hold).map((x) => x.hold)) })}</div>
        ${i > 0 ? `<button class="btn ghost small" type="button" data-act="copyHold" data-i="${i}">Copy ratings from previous hold</button>` : ''}
</div>
      <div class="clist">${HOLD_ITEMS().map(([k, n]) => {
        const it = h.items[k] || (h.items[k] = { st: '', rem: '' }), q = `${p}.items.${k}`, d = it.st === 'damaged';
        return `<div class="ci${it.st ? ' st-' + it.st : ''}"><div class="ci-h"><span class="nm">${esc(n)}</span>${statSeg(q + '.st', n)}</div>
          ${it.st ? area('Remarks', q + '.rem', { opt: !d, ph: d ? 'E.g. local pitting, port side aft, approx. 30 × 40 cm.' : '' }) : ''}
          ${bad(it.st) ? photoBlock(`hold_${h.id}_${k}`, 'Photo') : ''}
          ${d ? `<p class="link-tag"><b>Damaged</b> · added to the damage register in step ${SI('concl') + 1}.</p>` : ''}</div>`;
      }).join('')}</div></div></div>`;
  }
  function damageRow(d, i) {
    const p = `cond.damages.${i}`;
    return `<div class="deliv"><div class="card-h"><span class="lbl">Damage ${i + 1}${d.src ? ` <span class="opt">· from ${esc(d.srcLbl)}</span>` : ''}</span><button class="icon-btn" type="button" data-act="delDmg" data-i="${i}" aria-label="Remove damage ${i + 1}">${ICON.x}</button></div>
      <div class="grid two">${selectField('Area', p + '.area', AREAS, { req: 1 })}${field('Exact location', p + '.loc', { req: 1, ph: 'E.g. Hold 2, port side, frame 112' })}</div>
      ${area('Description', p + '.desc', { ph: 'Type, size and extent. E.g. dent 40 × 25 cm, depth approx. 3 cm, no cracks.' })}
      ${OFF() ? seg('Compared with the on-hire report', p + '.cmp', CMP) : ''}
      ${photoBlock('dmg_' + d.id, 'Photos of the damage')}</div>`;
  }
  function steveCard() {
    const St = S().cond.steve;
    return `<section class="card" data-lockphase="cond"><div class="card-h"><h3>Outstanding stevedore damages</h3>${St.ans === 'yes' ? `<span class="pill warn">${St.rows.length} listed</span>` : ''}</div>
      ${seg('Any outstanding damage(s) occurred during the Charter and not yet repaired/rectified?', 'cond.steve.ans', [['none', 'No outstanding stevedore damages'], ['yes', 'Yes, list them']])}
      ${St.ans === 'yes' ? St.rows.map((r, i) => { const p = `cond.steve.rows.${i}`; return `<div class="deliv"><div class="card-h"><span class="lbl">Stevedore damage ${i + 1}</span><button class="icon-btn" type="button" data-act="delStv" data-i="${i}" aria-label="Remove stevedore damage ${i + 1}">${ICON.x}</button></div>
        <div class="grid two">${field('Hold / location', p + '.loc', { req: 1, ph: 'E.g. Hold 3, hatch coaming fwd stbd' })}</div>
        ${area('Description', p + '.desc', { ph: 'E.g. coaming top plate bent approx. 60 cm, grab damage.' })}
        ${photoBlock('stv_' + r.id, 'Photos')}</div>`; }).join('') + '<button class="btn add" type="button" data-act="addStv">+ Add stevedore damage</button>' : ''}
      ${St.ans ? area('Remark', 'cond.steve.rem', { opt: 1 }) : ''}
      <p class="hint">Off-hire only. Separate from the damage register above.</p></section>`;
  }
  const photosCard = (hint) => `<section class="card"><div class="card-h"><h3>Photos</h3></div>
    ${photoBlock('log', 'Engine log / ROB page')}${photoBlock('tanks', 'Sounding tapes, gauges and tank tables')}${photoBlock('other', 'Other')}
    <p class="hint">${hint}</p></section>`;
  const reviewCard = () => `<section class="card"><div class="card-h"><h3>Recorded for GlobalBQS ops</h3></div><div data-calc="flags"></div>
    ${confirmBox('final', 'I am the appointed surveyor. I have reviewed this report. GlobalBQS ops checks it and issues it to the client.')}</section>`;
  const submitCard = () => `<section class="card" id="submitCard"><div class="card-h"><h3>Before you submit</h3><span data-calc="opencount"></span></div><div data-calc="review"></div>
    <p class="hint">After Submit the status is: Submitted → Under review by GlobalBQS → Report issued.${V.bunker ? ' Figures are recalculated by GlobalBQS on submission.' : ''}</p>
    <button class="btn primary" type="button" data-act="submit" id="submitBtn">Submit survey</button></section>`;
  const bunkerSign = (title, text) => { const sv = S().survey; return `<section class="card"><div class="card-h"><h3>${title}</h3></div>
    ${sigGate('bunker')}
    ${confirmBox('confirm', text, 'bunker')}
    <div class="sigs">${vSig('bMaster', 'Master / Chief Engineer', sv.chief || sv.master, 'confirm')}${sigPad('bSurveyor', 'Bunker surveyor', sv.surveyor, 'confirm')}</div></section>`; };
  const resultCards = () => `<section class="card"><div class="card-h"><h3>${V.kind === 'bc' ? 'Bunker summary · surveyed vs logbook' : 'Surveyed vs logbook'}</h3><span data-calc="pill"></span></div><div data-calc="summary"></div></section>`;
  const remarksCard = () => `<section class="card" data-lockphase="bunker"><div class="card-h"><h3>Remarks</h3></div>
    <div class="grid two">${area('Remarks Master / Chief Engineer', 'rem.master', { opt: 1 })}${area(V.kind === 'b221' ? 'Remarks surveyor' : 'Remarks bunker surveyor', 'rem.surveyor', { opt: 1, ph: 'E.g. all tanks sounded in presence of the C/E; FOT 2S not accessible.' })}</div></section>`;

  // charter party + on-hire survey (prefill.charter / prefill.on_hire_survey), read-only; hidden when null
  const dt = (v) => { const x = String(v || ''); return /^\d{4}-\d{2}-\d{2}/.test(x) ? fmtDate(x.slice(0, 10)) : x; };
  const join = (...a) => a.map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
  function charterRows() {
    if (V.kind === 'b221') return '';
    const c = S().order.charter, h = S().order.onHire, out = [];
    if (c) {
      const cp = join(c.cp_date ? 'CP ' + dt(c.cp_date) : '', c.charter_type);
      if (cp) out.push(['Charter party', cp]);
      if (c.charterer) out.push(['Charterer (CP)', c.charterer]);
      if (c.owner) out.push(['Owner (CP)', c.owner]);
      const pl = OFF() ? join(c.redelivery_place, dt(c.redelivery_date)) : join(c.delivery_place, dt(c.delivery_date));
      if (pl) out.push([(OFF() ? 'Redelivery' : 'Delivery') + ' (CP)', pl]);
    }
    if (OFF() && h) {
      const txt = h.source === 'external'
        ? join(h.report_number ? 'Report ' + h.report_number : 'External report', h.surveyor_company, dt(h.date), h.place)
        : join(h.gbqs_reference, dt(h.date), h.place);
      if (txt) out.push(['On-hire survey', txt]);
    }
    return out.map(([k, v]) => `<div data-charter><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  }

  const R = {};
  R.vessel = () => {
    const s = S(), o = s.order, off = portOffset();
    return `<section class="card order"><div class="card-h"><h3>From the order</h3><span class="lock">${ICON.lock} Set by GlobalBQS</span></div>
      <dl><div><dt>Reference</dt><dd class="mono">${esc(o.ref)}</dd></div><div><dt>Survey type</dt><dd>${esc(o.type)}</dd></div><div><dt>Client</dt><dd>${esc(o.client || '—')}</dd></div><div><dt>P.O. number / your ref</dt><dd class="mono">${esc(o.po || '—')}</dd></div>
      <div><dt>Vessel</dt><dd>${esc(o.vessel)}</dd></div><div><dt>IMO</dt><dd class="mono">${esc(o.imo || '—')}</dd></div><div><dt>Place of survey</dt><dd>${esc(o.place || '—')}</dd></div><div><dt>${HIRE ? 'ETA / ETB · ' + HIRE.toLowerCase() : 'ETA / ETB'}</dt><dd>${esc(o.etb || '—')}</dd></div>
      ${charterRows()}
      <div><dt>Surveyor</dt><dd>${esc(s.survey.surveyor || '—')}</dd></div><div><dt>Owner</dt><dd>${esc(o.owner || '—')}</dd></div><div><dt>Charterer</dt><dd>${esc(o.charterer || '—')}</dd></div><div><dt>Agent</dt><dd>${esc(o.agent || '—')}</dd></div>
      <div><dt>Local time (LT)</dt><dd class="mono">${off ? 'UTC' + esc(off) : 'to be chosen'}</dd></div><div><dt>Form version</dt><dd class="mono">${V.version}</dd></div>
      <div><dt>Device</dt><dd>Open on this device; the draft is saved to GlobalBQS whenever there is a connection</dd></div></dl>
      <p class="hint">Something wrong here? You can correct it at the start check; ops sees the change. Switching device? Open the job link there and sign in; it continues where the last sync stopped.</p></section>
    ${o.utcOffset ? '' : `<section class="card"><div class="card-h"><h3>Local time</h3></div><div class="grid two">${offsetPicker('survey.utcOffset', OFFSETS, deviceOffset())}</div></section>`}
    <section class="card"><div class="card-h"><h3>On board</h3></div>
      <div class="grid">${field('Master', 'survey.master', { req: 1 })}${field('Chief Engineer', 'survey.chief', { req: 1 })}${field(V.bunker ? 'Bunker surveyor' : 'Surveyor', 'survey.surveyor', { req: 1, hint: 'As confirmed when you accepted the job.' })}</div>
      <div class="grid two">${field('Port of registry', 'survey.registry', { opt: 1 })}</div>
      <div class="grid">${field('Date of survey', 'survey.date', { type: 'date', req: 1 })}${field('Time (LT)', 'survey.time', { type: 'time', req: 1, hint: 'Local time' + (off ? ', UTC' + esc(off) : '') + '.' + (HIRE ? ' Time of ' + HIRE.toLowerCase() + ' as per the CP.' : '') })}</div></section>
    ${V.bunker ? `<section class="card"><div class="card-h"><h3>Drafts and list</h3></div>
      <div class="grid">${field('Draft forward', 'survey.draftFwd', { numeric: 1, unit: 'm', req: 1, kind: 'draft' })}${field('Draft aft', 'survey.draftAft', { numeric: 1, unit: 'm', req: 1, kind: 'draft' })}<div class="field"><span class="lbl">Trim</span><div data-calc="trim"></div></div></div>
      <div class="grid two">${seg('List', 'survey.listSide', [['P', 'Port'], ['U', 'Upright'], ['S', 'Stbd']])}${s.survey.listSide && s.survey.listSide !== 'U' ? field('List ' + (s.survey.listSide === 'P' ? 'to port' : 'to starboard'), 'survey.list', { numeric: 1, unit: '°', req: 1, kind: 'deg' }) : ''}</div></section>` : ''}`;
  };
  R.grades = () => {
    const s = S();
    const chips = GRADES().map((g) => `<button type="button" class="chip" data-act="grade" data-g="${g}" aria-pressed="${s.grades[g].on}"><span class="box"></span>${g}</button>`).join('');
    return `${lockBar('bunker')}<section class="card" data-lockphase="bunker"><div class="card-h"><h3>Fuel types on board</h3></div><div class="chips">${chips}</div>
      <p class="hint">The next steps only show the fuel types you tick here.</p></section>
    ${active().length ? `<section class="card" data-lockphase="bunker"><div class="card-h"><h3>Logbook ROB at ${HIRE ? HIRE.toLowerCase() : 'time of survey'}</h3></div>
      <div class="grid">${active().map((g) => field(g, 'grades.' + g + '.logbook', { numeric: 1, unit: 'MT', req: 1 })).join('')}</div>
      <p class="hint">As stated by the Master / Chief Engineer from the engine log, at the time of survey.</p></section>` : note('warn', 'Tick at least one fuel type to continue.')}`;
  };
  R.tanks = () => lockBar('bunker') + (active().length ? active().map(gradeGroup).join('') + CALC_NOTE : note('warn', 'Tick the fuel types on board in step 2 first.'));
  R.result = () => {
    const s = S();
    return `${lockBar('bunker')}${resultCards()}
    ${V.lops ? `<section class="card"><div class="card-h"><h3>Letters of Protest</h3></div>
      ${seg('Any Letters of Protest?', 'lop', [['no', 'No'], ['yes', 'Yes']])}
      ${s.lop === 'yes' ? s.lops.map((l, i) => lopCard(l, i)).join('') + '<button class="btn add" type="button" data-act="addLop">+ Add Letter of Protest</button>' : ''}</section>` : ''}
    ${remarksCard()}`;
  };
  R.bunker = () => `${lockBar('bunker')}${resultCards()}${remarksCard()}
    ${bunkerSign('Sign the bunker figures', 'Master / Chief Engineer and surveyor confirm the above bunker values are true and correct.')}
    ${note('info', 'Next: the vessel condition part. It is signed separately at the end.')}`;
  R.submit = () => `${photosCard('All photos are optional. They are reduced on this device before upload, so they also send over a slow ship connection.')}
    ${reviewCard()}
    ${lockBar('bunker')}${bunkerSign(V.kind === 'b221' ? 'Sign the figures' : 'Sign the bunker figures', 'Master / Chief Engineer and surveyor confirm the above values are true and correct.')}
    ${submitCard()}`;
  R.hull = () => lockBar('cond') + SECS.filter((x) => x.step === 'hull').map(secCard).join('');
  R.deck = () => lockBar('cond') + SECS.filter((x) => x.step === 'deck').map(secCard).join('');
  R.holds = () => `${lockBar('cond')}<section class="card" data-lockphase="cond"><div class="card-h"><h3>Condition of cargo holds</h3><span data-calc="holdn"></span></div>
    ${S().cond.holds.length ? `<div class="tanks">${S().cond.holds.map(holdBlock).join('')}</div>` : '<p class="empty">No holds added yet.</p>'}
    <button class="btn add" type="button" data-act="addHold">+ Add hold</button>
    <p class="hint">Each hold loads the ${HOLD_ITEMS().length} standard items. Photos are optional; a remark is required for Damaged.</p></section>`;
  R.engine = () => {
    const sec = SECS.find((x) => x.id === 'er'), X = 'cond.x';
    return `${lockBar('cond')}${secCard(sec)}
    <section class="card" data-lockphase="cond"><div class="card-h"><h3>Maintenance status</h3></div>
      <div class="grid">${field('Routine jobs overdue', X + '.routine', { numeric: 1, req: 1, kind: 'jobs' })}${field('Critical jobs overdue', X + '.critical', { numeric: 1, req: 1, kind: 'jobs' })}${field('Next liner/cyl. head due', X + '.linerDue', { opt: 1, ph: 'e.g. 1240 h to go' })}</div>
      <div class="grid two">${seg('Any condition of class?', X + '.coc', [['no', 'No'], ['yes', 'Yes']])}${S().cond.x.coc === 'yes' ? field('Condition of class · details', X + '.cocText', { req: 1, ph: 'e.g. CoC 2026-14, due 31 Jan 2027' }) : ''}</div>
      ${area('Engine room comments', X + '.erRem', { opt: 1 })}
      ${photoBlock('sec_er', 'Engine room photos')}</section>`;
  };
  R.concl = () => {
    const C = S().cond, sv = S().survey;
    return `${lockBar('cond')}<section class="card" data-lockphase="cond"><div class="card-h"><h3>Damage register</h3><span data-calc="dmgn"></span></div>
      ${C.damages.length ? C.damages.map(damageRow).join('') : '<p class="empty">No damages recorded. Items rated Damaged appear here automatically.</p>'}
      <button class="btn add" type="button" data-act="addDmg">+ Add damage</button></section>
    ${OFF() ? steveCard() : ''}
    ${photosCard('All photos are optional. Condition photos can also be added per item and section. Photos are reduced on this device before upload.')}
    <section class="card" data-lockphase="cond"><div class="card-h"><h3>Conclusion</h3></div>
      ${area('General remarks / conclusion', 'cond.general', { ph: 'E.g. vessel presented in good overall condition for her age; minor items noted.' })}
      ${seg('Overall condition (for this type of vessel and age)', 'cond.overall', OVERALL, 'stat')}</section>
    ${reviewCard()}
    <section class="card"><div class="card-h"><h3>Sign the condition findings</h3></div>
      ${sigGate('cond')}
      <div data-lockphase="cond">${area('Remarks Master / Chief Engineer', 'cond.remMaster', { opt: 1 })}</div>
      ${confirmBox('cond.confirm', 'Master / Chief Engineer and surveyor confirm the condition findings in this report.', 'cond')}
      <div class="sigs">${vSig('cMaster', 'Master / Chief Engineer', sv.chief || sv.master, 'cond.confirm')}${sigPad('cSurveyor', 'Surveyor', sv.surveyor, 'cond.confirm')}</div></section>
    ${submitCard()}`;
  };

  const CALC = {
    trim() {
      const f = num(S().survey.draftFwd), a = num(S().survey.draftAft); if (f == null || a == null) return '<div class="out"><span class="s">Enter both drafts</span></div>';
      const tr = r2(a - f); return `<div class="out"><span class="v">${fx(Math.abs(tr), 2)} m</span><span class="s">${tr > 0 ? 'by the stern' : tr < 0 ? 'by the head' : 'even keel'}</span></div>`;
    },
    tank(ph, i) { const t = S().rob.tanks[+i]; if (!t) return ''; const c = calcTank(t); return c ? calc4(c) : '<div class="calc-wait">Weight appears when volume, temperature and density are filled in.</div>'; },
    tsum(ph, i) {
      const t = S().rob.tanks[+i]; if (!t) return ''; const c = calcTank(t), tov = num(tovOf(t));
      return `<span class="tn">${esc(t.name || 'Choose a tank')}</span><span class="tv">${tov != null ? 'TOV ' + fx(tov, 2) + ' m³' : 'TOV —'}</span><span class="tm">${c && num(t.reading) != null ? fx(c.mt, 3) + ' MT' : '<span class="pill warn">Open</span>'}</span>`;
    },
    sub(g) { const v = gradeTotal(g); return v == null ? '<span class="subtot"><small>Total</small>—</span>' : `<span class="subtot"><small>Total</small>${fx(v, 2)} MT</span>`; },
    logdiff(g) {
      const r = results().find((x) => x.g === g); if (!r || r.sur == null || r.log == null) return '';
      return `<div class="cmp"><span>Surveyed</span><span class="v">${fx(r.sur)} MT</span><span>Logbook</span><span class="v">${fx(r.log)} MT</span><span class="d">Difference</span><span class="v d ${r.within ? 'pos' : 'neg'}">${sgn(r.diff)} MT · ${sgn(r.pct)}%</span></div>`;
    },
    pill() { const R0 = results(); if (!R0.length || R0.some((r) => r.within == null)) return '<span class="pill warn">Incomplete</span>'; return R0.every((r) => r.within) ? `<span class="pill ok">Within ±${fx(TOL(), 2)}%</span>` : '<span class="pill bad">Difference noted</span>'; },
    summary() {
      const R0 = results(); if (!R0.length) return NEUTRAL('Tick the fuel types in step 2 first.');
      const tbl = `<div style="overflow-x:auto"><table class="dtab"><thead><tr><th>Fuel type</th><th class="n">Surveyed MT</th><th class="n">Logbook MT</th><th class="n">Difference MT</th><th class="n">%</th></tr></thead><tbody>${R0.map((r) => `<tr><td><span class="gchip">${r.g}</span></td><td class="n">${fx(r.sur)}</td><td class="n">${fx(r.log)}</td><td class="n ${r.within == null ? '' : r.within ? 'pos' : 'crit'}">${sgn(r.diff)}</td><td class="n ${r.within == null ? '' : r.within ? 'pos' : 'crit'}">${r.pct == null ? '—' : sgn(r.pct) + '%'}</td></tr>`).join('')}</tbody></table></div>`;
      const done = R0.every((r) => r.within != null);
      return tbl + (done ? (R0.every((r) => r.within) ? note('ok', `All fuel types are within ±${fx(TOL(), 2)}% of the logbook.`) : note('warn', 'Difference with the logbook noted. Explain it in the remarks; ops is informed.')) : NEUTRAL('Result appears once soundings and logbook figures are entered.')) +
        `<p class="hint">Indicative band ±${fx(TOL(), 2)}% (client setting). Preview only; figures are recalculated by GlobalBQS on submission.</p>`;
    },
    secn(id) {
      const sec = SECS.find((x) => x.id === id), its = sec.items.map(([k]) => S().cond.items[k].st), done = its.filter(Boolean).length, d = its.filter((x) => x === 'damaged').length, f = its.filter((x) => x === 'fair').length;
      return `<span class="subtot"><small>Rated</small>${done}/${its.length}</span>${d ? ` <span class="pill bad">${d} damaged</span>` : ''}${f ? ` <span class="pill warn">${f} fair</span>` : ''}`;
    },
    holdn() { const H = S().cond.holds; return H.length ? `<span class="subtot"><small>Holds</small>${H.length}</span>` : ''; },
    hsum(i) {
      const h = S().cond.holds[+i]; if (!h) return ''; const st = HOLD_ITEMS().map(([k]) => (h.items[k] || {}).st), r = st.filter(Boolean).length, d = st.filter((x) => x === 'damaged').length, f = st.filter((x) => x === 'fair').length;
      return `<span class="tn" style="white-space:normal">Hold ${esc(h.hold || '?')} · ${st.length} items${d ? ` · ${d} damaged` : ''}${f ? ` · ${f} fair` : ''}</span><span class="tv">${r}/${st.length} rated</span><span class="tm">${r < st.length ? '<span class="pill warn">Open</span>' : d ? '<span class="pill bad">Damaged</span>' : '<span class="pill ok">Done</span>'}</span>`;
    },
    dmgn() { const n = S().cond.damages.length; return n ? `<span class="pill warn">${n} recorded</span>` : '<span class="pill ok">None</span>'; },
    opencount() { const n = issues().length; return n ? `<span class="pill warn">${n} open</span>` : '<span class="pill ok">Complete</span>'; },
    review() { return reviewList(issues()); },
    flags() { return flagList(flags()); },
  };

  function act(a, b) {
    const s = S(), fm = ctx.form, C = s.cond;
    const done = (msg) => { fm.markSaved(); fm.render(false); if (msg) toast(msg); return true; };
    switch (a) {
      case 'grade': { const g = b.dataset.g; s.grades[g].on = !s.grades[g].on; return done(); }
      case 'addTank': {
        const fam = famOf(b.dataset.grade);
        if (!freeTanks(s.VT, fam, usedTankKeys(s.rob.tanks, famOf))) toast(`All ${fam === 'do' ? 'gas oil / diesel' : 'fuel oil'} tanks of this vessel are already in this list. Use “Tank not on the list…” only for a tank that is missing.`);
        s.rob.tanks.push(T(b.dataset.grade)); fm.markSaved(); fm.render(false);
        const sel = document.querySelector(`select[data-tanksel="rob:${s.rob.tanks.length - 1}"]`); if (sel) sel.focus(); return true;
      }
      case 'addHold': {
        const H = C.holds, used = new Set(H.map((h) => h.hold)); let n = 1; while (used.has(String(n)) && n < 9) n++;
        const full = used.has(String(n));
        H.forEach((h) => { h.open = false; }); H.push(newHold(full ? '' : String(n)));
        return done(full ? 'Holds 1 to 9 are all in the list already. Check the hold numbers.' : `Hold ${n} added with ${HOLD_ITEMS().length} items`);
      }
      case 'holdToggle': { const h = C.holds[+b.dataset.i]; h.open = !h.open; fm.render(false); return true; }
      case 'copyHold': {
        const i = +b.dataset.i, h = C.holds[i], pr = C.holds[i - 1];
        HOLD_ITEMS().forEach(([k]) => { const v = (pr.items[k] || {}).st || ''; h.items[k] = h.items[k] || { st: '', rem: '' }; h.items[k].st = v; linkDamage(`hold_${h.id}_${k}`, 'hold', holdLbl(h, k), v === 'damaged'); });
        return done('Ratings copied; check and adjust per item');
      }
      case 'delHold': {
        const h = C.holds[+b.dataset.i]; if (!h) return true;
        const filled = HOLD_ITEMS().some(([k]) => (h.items[k] || {}).st || String((h.items[k] || {}).rem || '').trim() || (s.photos[`hold_${h.id}_${k}`] || []).length);
        removeRow(`Remove Hold ${h.hold || +b.dataset.i + 1}?`, filled, () => {
          const k = C.holds.indexOf(h); if (k >= 0) C.holds.splice(k, 1);
          HOLD_ITEMS().forEach(([x]) => { dropPhotos(`hold_${h.id}_${x}`); linkDamage(`hold_${h.id}_${x}`, 'hold', '', false); });
        }, () => done('Hold removed'));
        return true;
      }
      case 'addStv': C.steve.rows.push({ id: nid(), loc: '', desc: '' }); return done();
      case 'delStv': {
        const r = C.steve.rows[+b.dataset.i]; if (!r) return true;
        removeRow(`Remove stevedore damage ${+b.dataset.i + 1}?`, rowFilled(r) || (s.photos['stv_' + r.id] || []).length, () => { const k = C.steve.rows.indexOf(r); if (k >= 0) C.steve.rows.splice(k, 1); dropPhotos('stv_' + r.id); }, () => done('Stevedore damage removed'));
        return true;
      }
      case 'addDmg': C.damages.push({ id: nid(), src: '', srcLbl: '', area: '', loc: '', desc: '', cmp: '' }); return done();
      case 'delDmg': {
        const d = C.damages[+b.dataset.i]; if (!d) return true;
        removeRow(`Remove damage ${+b.dataset.i + 1}?`, rowFilled({ ...d, src: '', srcLbl: '' }) || (s.photos['dmg_' + d.id] || []).length, () => { const k = C.damages.indexOf(d); if (k >= 0) C.damages.splice(k, 1); dropPhotos('dmg_' + d.id); }, () => done('Damage removed'));
        return true;
      }
      default: return false;
    }
  }
  function afterSet(pth, v) {
    let m = pth.match(/^cond\.items\.(\w+)\.st$/);
    if (m) { const I = ITEMS[m[1]]; linkDamage('it_' + m[1], I.sec, I.secT + ' · ' + I.n, v === 'damaged'); }
    m = pth.match(/^cond\.holds\.(\d+)\.items\.(\w+)\.st$/);
    if (m) { const h = S().cond.holds[+m[1]]; linkDamage(`hold_${h.id}_${m[2]}`, 'hold', holdLbl(h, m[2]), v === 'damaged'); }
  }
  function tankNameTaken(ph, i, name) {
    const s = S(), t = s.rob.tanks[i]; return usedTankKeys(s.rob.tanks, famOf, i).has(tankKey(famOf(t.grade), name));
  }
  function addNewTank(ph, i, name, cap) {
    const s = S(), t = s.rob.tanks[i], fam = famOf(t.grade);
    if (!s.VT.some((x) => x.fam === fam && x.name.toLowerCase() === name.toLowerCase())) s.VT.push({ name, fam, cap, isNew: true });
    t.name = s.VT.find((x) => x.fam === fam && x.name.toLowerCase() === name.toLowerCase()).name;
  }
  function submitSummary() {
    const s = S(), F = flags(), np = Object.values(s.photos).reduce((n, x) => n + x.length, 0);
    const rows = V.bunker ? `<div class="cmp" style="grid-template-columns:auto 1fr auto;align-items:center">${results().map((r) => `<span class="gchip">${r.g}</span><span class="v">${fx(r.sur)} MT</span><span class="v ${r.within ? 'pos' : 'crit'}">${sgn(r.pct)}% vs logbook</span>`).join('')}</div>` : '';
    return `${rows}<p>${V.bunker ? 'ROB as shown (preview), ' : ''}${V.cond ? `overall condition <b>${lbl(OVERALL, s.cond.overall)}</b>, ${s.cond.damages.length} damage${s.cond.damages.length === 1 ? '' : 's'}, ` : ''}${Object.keys(s.sig).filter(hasSig).length} signatures and ${np} photos.${F.length ? ` <b>${F.length} item${F.length > 1 ? 's are' : ' is'} flagged for ops.</b>` : ''}</p>
      <p>After submission no changes can be made here. GlobalBQS ${V.bunker ? 'recalculates the figures, ' : ''}checks the survey and issues the report to the client.</p>`;
  }

  // ---------- payload (contract gbqs.forms/1 + extra) ----------
  const nn = (v) => num(v);
  const str = (v) => { const x = String(v ?? '').trim(); return x || null; };
  const int = (v) => (isInt(v) ? parseInt(String(v).trim(), 10) : null);
  function toPayload(s, { formVersion, sigFiles }) {
    ctx.S = s;
    const off = portOffset() || null, sv = s.survey, o = s.order, C = s.cond, X = C.x, act0 = V.bunker ? Object.keys(s.grades).filter((g) => s.grades[g].on) : [];
    const fileIds = new Set(); const useFile = (id) => { if (id) fileIds.add(id); return id || null; };
    const photos = []; const addPhotos = (list, section, skipFirst) => (list || []).forEach((p, i) => { if (skipFirst && i === 0) return; photos.push({ file: useFile(p.id), section }); });
    const files = (key) => (s.photos[key] || []).map((p) => useFile(p.id));

    const tanks = V.bunker ? s.rob.tanks.filter((t) => act0.includes(t.grade)).map((t) => {
      const vt = s.VT.find((x) => x.name === t.name && x.fam === famOf(t.grade));
      return { phase: V.phase, grade: t.grade, grade_group: famOf(t.grade), tank_name: str(t.name), method: METHOD_KEY[t.method] || 'sounding', raw_value: nn(t.reading),
        trim_list_corrected: t.method === 'G' ? null : !!t.corr, tov_m3: nn(tovOf(t)), temp_c: nn(t.temp), density_15: nn(t.dens), capacity_m3: vt && vt.isNew && vt.cap != null ? vt.cap : null,
        not_measured: false, not_measured_reason: null, remark: str(t.rem) };
    }) : [];

    const LALL = LOPV.concat(LOPX);
    const lops = V.lops && s.lop === 'yes' ? s.lops.map((l) => {
      const ph = s.photos['lop_' + l.id] || []; addPhotos(ph, 'lop_photo', true);
      return { direction: l.dir === 'in' ? 'received_by_vessel' : 'issued_by_vessel', issued_by: lbl(LALL, l.by) || null, issued_to: lbl(LALL, l.to) || null, subject: lbl(LOPS, l.subject) || null, person_name: str(l.name), remark: str(l.remarks), file: useFile(ph[0] && ph[0].id) };
    }) : [];

    const vesselName = str(sv.chief) || str(sv.master), vesselRole = str(sv.chief) ? 'chief_engineer' : 'master';
    const SIGS = [];
    if (V.bunker) SIGS.push(['bMaster', 'bunker', 'vessel'], ['bSurveyor', 'bunker', 'surveyor']);
    if (V.cond) SIGS.push(['cMaster', 'condition', 'vessel'], ['cSurveyor', 'condition', 'surveyor']);
    const signatures = [];
    for (const [k, section, who] of SIGS) {
      const sig = s.sig[k], no = s.vno[k], role = who === 'surveyor' ? 'surveyor' : vesselRole, name = who === 'surveyor' ? str(sv.surveyor) : vesselName;
      if (no) { signatures.push({ section, role, signer_name: name, status: 'not_signed', reason: str(no.reason), signed_at_local: no.at_local || null, utc_offset: no.utc_offset || off, file: null }); addPhotos(s.photos['vno_' + k], 'photo_not_signed'); }
      else if (sig && sig.strokes && sig.strokes.length) signatures.push({ section, role, signer_name: name, status: sig.mode === 'receipt' ? 'receipt_only' : 'signed', reason: null, signed_at_local: sig.at_local || null, utc_offset: sig.utc_offset || off, file: useFile(sigFiles && sigFiles[k]) });
    }

    const condition_items = [], damages = [];
    if (V.cond) {
      SECS.forEach((sec) => sec.items.forEach(([k]) => {
        const it = C.items[k];
        condition_items.push({ section: sec.key, hold_no: null, item_key: k, rating: it.st || null, remark: str(k === 'ercrit' ? X.critRem : it.rem), files: files('it_' + k) });
      }));
      C.holds.forEach((h) => HOLD_ITEMS().forEach(([k]) => {
        const it = h.items[k] || {};
        condition_items.push({ section: 'hold', hold_no: h.hold ? parseInt(h.hold, 10) : null, item_key: k, rating: it.st || null, remark: str(it.rem), files: files(`hold_${h.id}_${k}`) });
      }));
      C.damages.forEach((d) => damages.push({ kind: 'damage', area: lbl(AREAS, d.area) || null, location: str(d.loc), description: str(d.desc), compared_on_hire: OFF() ? (lbl(CMP, d.cmp) || null) : null, files: files('dmg_' + d.id) }));
      if (OFF() && C.steve.ans === 'yes') C.steve.rows.forEach((r) => damages.push({ kind: 'stevedore', area: 'Stevedore damage', location: str(r.loc), description: str(r.desc), compared_on_hire: null, files: files('stv_' + r.id) }));
      SECS.filter((x) => x.id !== 'er').forEach((x) => addPhotos(s.photos['sec_' + x.id], 'photo_' + x.key));
      addPhotos(s.photos.sec_er, 'photo_engine_room');
    }
    addPhotos(s.photos.log, 'photo_engine_log');
    addPhotos(s.photos.tanks, 'photo_tanks');
    addPhotos(s.photos.other, 'photo_other');

    // fields without a place in contract gbqs.forms/1 (yet) -> extra
    const extra = {
      list_side: V.bunker ? ({ P: 'port', S: 'starboard', U: 'upright' }[sv.listSide] || null) : null,
      unlock_log: s.audit.map((a) => ({ part: a.label, reason: a.reason, at: a.at })),
    };
    if (V.cond) Object.assign(extra, {
      hull_last_cleaning_date: str(X.hullClean),
      mooring_ropes_220m_count: C.items.mooring.st && C.items.mooring.st !== 'na' ? int(X.ropes) : null,
      next_liner_cyl_head_due: str(X.linerDue),
      condition_of_class: X.coc === 'yes' ? true : X.coc === 'no' ? false : null,
      condition_of_class_details: X.coc === 'yes' ? str(X.cocText) : null,
      routine_jobs_overdue: int(X.routine),
      critical_jobs_overdue: int(X.critical),
      engine_room_comments: str(X.erRem),
      condition_master_remarks: V.bunker ? str(C.remMaster) : null,
      outstanding_damages: OFF() ? (C.steve.ans === 'yes' ? true : C.steve.ans === 'none' ? false : null) : null,
      outstanding_damages_remark: OFF() ? str(C.steve.rem) : null,
    });

    const gc = gateCorrectionsFrom(s, []);
    const imoFix = gc.find((x) => x.field === 'imo_number');
    const payload = {
      contract: 'gbqs.forms/1', form_key: key, form_version: formVersion || '1.0', completed_at: new Date().toISOString(),
      survey: {
        place: str(o.place), utc_offset: off, date_of_survey: str(sv.date), time_of_survey: str(sv.time),
        port_of_registry: str(sv.registry), imo_number: imoFix ? imoFix.corrected_value : str(o.imo),
        master_name: str(sv.master), chief_engineer_name: str(sv.chief), surveyor_name: str(sv.surveyor),
        owner: str(o.owner), charterer: str(o.charterer), po_number: str(o.po),
        draft_fwd_m: V.bunker ? nn(sv.draftFwd) : null, draft_aft_m: V.bunker ? nn(sv.draftAft) : null, list_deg: V.bunker ? (sv.listSide === 'U' ? 0 : nn(sv.list)) : null,
        logbook: Object.fromEntries(act0.map((g) => [g, nn(s.grades[g].logbook)])),
        master_remarks: String(V.bunker ? (s.rem.master || '') : (C.remMaster || '')), surveyor_remarks: String(V.bunker ? (s.rem.surveyor || '') : ''), timesheet_remarks: '',
        overall_condition: V.cond ? (C.overall || null) : null, conclusion: V.cond ? str(C.general) : null,
      },
      grades: act0, tanks, deliveries: [], samples: [], lops, signatures, timesheet: [], gate_corrections: gc, condition_items, damages, photos, extra,
    };
    return { payload, fileIds: [...fileIds] };
  }

  return {
    key, title: V.title, versionLabel: V.version, variant: V,
    STEPS, PHASE, SIGLBL, R, CALC, issues, flags, act, afterSet, addNewTank, tankNameTaken, submitSummary, toPayload, initState, tankCapFor,
    portNowText: () => `${portNow().t} LT`, portNow,
    gateGrades: () => [], // hire/B221 jobs have no nominated quantities: the grades check is skipped
    signatureKeys: () => Object.keys(S().sig).filter(hasSig),
  };
}
