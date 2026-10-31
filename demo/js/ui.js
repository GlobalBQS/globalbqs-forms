export const __v = '1.1.20-20261031-d3db1c01';
// Shared UI helpers: escaping, icons, notes, toast, modal dialogs.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ICON = {
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.5" stroke-linecap="round"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 22 20H2z"/><path d="M12 10v4.5M12 17.2v.3" stroke-linecap="round"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M8 12.5l2.6 2.6L16.2 9.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9 9l6 6M15 9l-6 6" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
// official icon, dark variant (for the navy app bar)
export const LOGO = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 4 L58 44 L50 50 L42 44 Z" fill="#8fd2ee"/><path d="M96 50 L56 58 L50 50 L56 42 Z" fill="#eaf1fb"/><path d="M50 96 L42 56 L50 50 L58 56 Z" fill="#eaf1fb"/><path d="M4 50 L44 42 L50 50 L44 58 Z" fill="#8fd2ee"/><circle cx="50" cy="50" r="34" stroke="#8fd2ee" stroke-width="6" fill="none" stroke-dasharray="53 160" stroke-linecap="round" transform="rotate(-45 50 50)"/><circle cx="50" cy="50" r="34" stroke="#eaf1fb" stroke-width="6" fill="none" stroke-dasharray="53 160" stroke-linecap="round" transform="rotate(135 50 50)"/></svg>';

export const note = (kind, html) => `<div class="note ${kind}">${ICON[kind] || ICON.info}<div>${html}</div></div>`;

let toastT;
export function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2800);
}

/**
 * modal(title, html, buttons) -> Promise<value|null>
 * buttons: [{label, value, kind:'primary'|'ghost'|'danger'}]; a button with value null just closes.
 * Optional validate(value) callback: return false to keep the dialog open.
 */
let modalResolve = null;
export function modal(title, html, buttons = [{ label: 'Close', value: null, kind: 'primary' }], opts = {}) {
  const m = $('#modal');
  $('#mTitle').textContent = title;
  $('#mBody').innerHTML = html;
  $('#mBtns').innerHTML = buttons.map((b, i) => `<button class="btn ${b.kind || 'ghost'}" type="button" data-mbtn="${i}">${esc(b.label)}</button>`).join('');
  m.hidden = false;
  if (modalResolve) modalResolve(null);
  return new Promise((resolve) => {
    modalResolve = resolve;
    m.onclick = async (e) => {
      const b = e.target.closest('[data-mbtn]'); if (!b) return;
      const def = buttons[+b.dataset.mbtn];
      if (opts.validate && def.value != null && (await opts.validate(def.value)) === false) return;
      m.hidden = true; m.onclick = null; modalResolve = null; resolve(def.value);
    };
    const f = $('#mBody input, #mBody textarea'); if (f) setTimeout(() => f.focus(), 30);
  });
}
export function closeModal() { const m = $('#modal'); if (m && !m.hidden) { m.hidden = true; if (modalResolve) { modalResolve(null); modalResolve = null; } } }
export const modalOpen = () => !$('#modal').hidden;

// time helpers -------------------------------------------------------------
export const pad = (n) => String(n).padStart(2, '0');
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "+02:00" -> 120 ; null when invalid */
export function offsetMin(off) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(off || '').trim());
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
}
export function offsetStr(min) {
  const s = min < 0 ? '-' : '+', a = Math.abs(min);
  return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
export const deviceOffset = () => offsetStr(-new Date().getTimezoneOffset());
/** current local date/time in a given UTC offset */
export function nowIn(off) {
  const min = offsetMin(off) ?? -new Date().getTimezoneOffset();
  const d = new Date(Date.now() + min * 60000);
  return { d: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, t: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}
export const fmtDate = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${dd} ${MON[+m - 1]} ${y}`; };
export const OFFSETS = (() => {
  const L = [];
  for (let m = -12 * 60; m <= 14 * 60; m += 15) {
    if (m % 60 === 0 || [-570, -210, 210, 270, 330, 345, 390, 525, 570, 630, 765, 825].includes(m)) L.push(offsetStr(m));
  }
  return L;
})();
export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
/** client ids for files: 8-80 chars [A-Za-z0-9_-] */
export const fileId = (prefix) => `${prefix}_${uuid().replace(/-/g, '').slice(0, 20)}`;
