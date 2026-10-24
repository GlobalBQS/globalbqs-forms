export const __v = '1.1.14-20261024-96ce6caf';
// Photos: read EXIF DateTimeOriginal BEFORE compressing (canvas drops EXIF), then shrink on the device
// (max 2000 px, JPEG quality 0.8). The browser applies the EXIF orientation when drawing.

/** Parse EXIF DateTimeOriginal (0x9003) and OffsetTimeOriginal (0x9011) from a JPEG ArrayBuffer. */
export function readExif(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00) return null;
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      if (marker === 0xffda) return null; // start of scan: no EXIF
      off += 2 + len;
    }
  } catch { /* corrupt */ }
  return null;
}
function parseTiff(v, start) {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
  const str = (o, n) => { let s = ''; for (let i = 0; i < n; i++) { const c = v.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); } return s; };
  const readIfd = (ifdOff) => {
    const out = {}; const n = u16(start + ifdOff);
    for (let i = 0; i < n; i++) {
      const e = start + ifdOff + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
      const valOff = cnt > 4 ? start + u32(e + 8) : e + 8;
      if (type === 2) out[tag] = str(valOff, cnt);
      else if (type === 4) out[tag] = u32(e + 8);
      else if (type === 3) out[tag] = u16(e + 8);
    }
    return out;
  };
  const ifd0 = readIfd(u32(start + 4));
  let exif = {};
  if (ifd0[0x8769]) exif = readIfd(ifd0[0x8769]);
  const dto = exif[0x9003] || ifd0[0x0132] || null; // DateTimeOriginal, else DateTime
  if (!dto) return null;
  return { dateTimeOriginal: dto, offset: exif[0x9011] || null };
}

/** EXIF "YYYY:MM:DD HH:MM:SS" (+ offset or fallback offset) -> ISO string with offset, or null */
export function exifToIso(exif, fallbackOffset) {
  if (!exif || !exif.dateTimeOriginal) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(exif.dateTimeOriginal);
  if (!m) return null;
  const off = /^[+-]\d{2}:\d{2}$/.test(exif.offset || '') ? exif.offset : (/^[+-]\d{2}:\d{2}$/.test(fallbackOffset || '') ? fallbackOffset : null);
  const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return off ? local + off : local; // server parses ISO; without offset it is taken as UTC-less local
}

async function loadImage(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** -> {blob, width, height, from, to, exif} ; non-images / failures return the original file */
export async function compressPhoto(file, { max = 2000, quality = 0.8 } = {}) {
  let exif = null;
  try { if (/jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name || '')) exif = readExif(await file.arrayBuffer()); } catch { /* ignore */ }
  try {
    const img = await loadImage(file);
    const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (img.close) img.close();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    if (!blob) throw new Error('toBlob failed');
    return { blob, mime: 'image/jpeg', width: c.width, height: c.height, from: file.size, to: blob.size, exif };
  } catch {
    const mime = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'].includes(file.type) ? file.type : 'image/jpeg';
    return { blob: file, mime, width: null, height: null, from: file.size, to: file.size, exif };
  }
}

/** signature strokes (normalised 0..1) -> PNG blob */
export async function strokesToPng(strokes, w = 600, h = 200) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#10203d'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const st of strokes || []) { ctx.beginPath(); st.forEach((p, j) => (j ? ctx.lineTo(p[0] * w, p[1] * h) : ctx.moveTo(p[0] * w, p[1] * h))); ctx.stroke(); }
  return new Promise((r) => c.toBlob(r, 'image/png'));
}
