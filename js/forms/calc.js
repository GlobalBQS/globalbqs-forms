export const __v = '1.1.16-20261024-683e6469';
// Calculation preview (identical to the approved mockups). The server ALWAYS recalculates on submission
// with the exact ASTM D1250-04 implementation (gbqs_vcf_54b_2004); these figures are only a preview.

/** Numbers: one decimal separator (comma or point), no thousands separators, no spaces. */
export function parseNum(v, signed) {
  const s = String(v ?? '').trim().replace(/^[−–]/, '-');
  if (!s) return { empty: true };
  if (!(signed ? /^[-+]?\d+([.,]\d+)?$/ : /^\d+([.,]\d+)?$/).test(s)) {
    if (/[.,].*[.,]|\d\s+\d/.test(s)) return { err: 'Use one decimal separator and no thousands separators (e.g. 1234.5 or 1234,5).' };
    return { err: 'Not a valid number.' };
  }
  const m = s.match(/[.,](\d+)$/);
  return { n: parseFloat(s.replace(',', '.')), dec: m ? m[1].length : 0 };
}
export const num = (v, sg) => { const p = parseNum(v, sg); return p.n == null ? null : p.n; };
export const fx = (n, d = 2) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const sgn = (n, d = 2) => (n == null || !isFinite(n) ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '±') + fx(Math.abs(n), d));
export const r2 = (x) => Math.round(x * 100) / 100;
export const r3 = (x) => Math.round(x * 1000) / 1000;
export const kgl = (d) => (d == null ? null : d < 2 ? d : d / 1000);

/** VCF Table 54B (generalized products, base 15 °C), 2004 rounding to 5 decimals - mockup approximation. */
export function vcf54b(dens, temp) {
  const d = typeof dens === 'number' ? dens : num(dens), t = typeof temp === 'number' ? temp : num(temp);
  if (d == null || t == null) return null;
  const rho = d < 2 ? d * 1000 : d;
  if (rho < 610 || rho > 1164) return null;
  let a;
  if (rho >= 839) a = 186.9696 / (rho * rho) + 0.4862 / rho; // fuel oils
  else if (rho >= 787.5) a = 594.5418 / (rho * rho); // jet / kerosene
  else if (rho >= 770.5) a = -0.00336312 + 2680.3206 / (rho * rho); // transition zone
  else a = 346.4228 / (rho * rho) + 0.4388 / rho; // gasolines
  const dt = t - 15;
  return Math.round(Math.exp(-a * dt * (1 + 0.8 * a * dt)) * 100000) / 100000;
}

/** TOV (m³), temperature, density (kg/l or kg/m³) -> {vcf, gsv, wcf, mt} or null */
export function weigh(tov, temp, rhoKgl) {
  const T = typeof tov === 'number' ? tov : num(tov);
  const rho = kgl(rhoKgl);
  if (T == null || rho == null) return null;
  const v = vcf54b(rho, temp);
  if (v == null) return null;
  const gsv = r3(T * v);
  const wcf = Math.round((rho - 0.0011) * 10000) / 10000; // weight in air (Table 56)
  return { vcf: v, gsv, wcf, mt: r3(gsv * wcf) };
}

/** Plausibility ranges for the inline "= value" preview */
export const RANGE = { dens: [0.8, 1.01, '0.8000–1.0100 kg/l at 15 °C'], temp: [0, 80, '0–80 °C'], draft: [0, 25, '0–25 m'], deg: [0, 15, '0–15°'], ropes: [0, 40, '0–40 ropes'], jobs: [0, 200, '0–200 jobs'] };
export const isInt = (v) => { const p = parseNum(v); return p.n != null && p.dec === 0; };

/** IMO number: 7 digits; check digit = last digit of (d1*7 + d2*6 + ... + d6*2) */
export function imoOk(v) {
  const s = String(v || '').replace(/^IMO\s*/i, '').trim();
  if (!/^\d{7}$/.test(s)) return false;
  let t = 0; for (let i = 0; i < 6; i++) t += (+s[i]) * (7 - i);
  return t % 10 === +s[6];
}
