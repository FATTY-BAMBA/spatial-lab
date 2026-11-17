// A compact QR code encoder (ISO/IEC 18004, model 2): byte mode, error correction level M (≈15 % of the code can be
// covered or smudged and it still scans), versions 1–40, best of the 8 masks. Pure, no DOM; written after Project Nayuki's
// reference design (MIT). Used for the share link's QR in the 3D viewer (T-010); qa/unit/qr.test.mjs decodes its output.
//   qrMatrix('https://…') → { size, at(x, y) → true for a dark module, version }
//   qrSvgPath(m) → an SVG path ('M x y h1v1h-1z…') of the dark modules, for a viewBox of size + 2 × quiet zone

// error-correction codewords per block and number of blocks, level M, index = version
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const FORMAT_M = 0; // level M's 2-bit format indicator

const rawModules = v => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
};
const dataCodewords = v => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v];
const alignPositions = (v, size) => {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, out = [6];
  for (let p = size - 7; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
};

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1
const gfMul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
function rsDivisor(degree) {
  const r = new Array(degree).fill(0); r[degree - 1] = 1; let root = 1;
  for (let i = 0; i < degree; i++) { for (let j = 0; j < degree; j++) { r[j] = gfMul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1]; } root = gfMul(root, 0x02); }
  return r;
}
function rsRemainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
  return r;
}

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let v = 1;
  for (; v <= 40; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8) break;
  if (v > 40) throw new Error('QR: text too long');
  // bits: mode 0100 (byte), length, data, terminator, pad to bytes, pad codewords
  const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
  const cap = dataCodewords(v) * 8;
  put(0, Math.min(4, cap - bits.length)); put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // split into blocks, add Reed–Solomon codewords, interleave
  const nb = BLOCKS[v], eccLen = ECC_PER_BLOCK[v], raw = Math.floor(rawModules(v) / 8), short = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const div = rsDivisor(eccLen), blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, k + shortLen - eccLen + (i < short ? 0 : 1)); k += d.length;
    const e = rsRemainder(d, div); if (i < short) d.push(0); blocks.push(d.concat(e));
  }
  const words = [];
  for (let i = 0; i < blocks[0].length; i++) for (let j = 0; j < nb; j++) if (i !== shortLen - eccLen || j >= short) words.push(blocks[j][i]);

  // function patterns
  const size = v * 4 + 17, mod = [], fn = [];
  for (let y = 0; y < size; y++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
    if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
  }
  const al = alignPositions(v, size), last = al.length - 1;
  for (let i = 0; i <= last; i++) for (let j = 0; j <= last; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = mask => {
    const d = (FORMAT_M << 3) | mask; let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const dark = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, dark); set(c, a, dark); }
  }
  // data in the zigzag
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && n < words.length * 8) { mod[y][x] = ((words[n >>> 3] >>> (7 - (n & 7))) & 1) === 1; n++; }
    }
  }
  // the mask with the lowest penalty
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const s = penalty(mod, size); if (s < bestScore) { bestScore = s; best = m; }
    applyMask(m); // XOR again = undo
  }
  applyMask(best); drawFormat(best);
  return { size, version: v, mask: best, at: (x, y) => x >= 0 && y >= 0 && x < size && y < size && mod[y][x] };
}

// the standard's four penalty rules: runs of 5+, 2×2 blocks, finder-like 1:1:3:1:1 runs, dark/light balance
function penalty(mod, size) {
  let s = 0;
  const line = get => {
    let run = 1, prev = get(0);
    const seq = [get(0) ? 1 : 0];
    for (let i = 1; i < size; i++) {
      const c = get(i); seq.push(c ? 1 : 0);
      if (c === prev) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else { run = 1; prev = c; }
    }
    const str = seq.join('');
    for (const pat of ['10111010000', '00001011101']) for (let i = str.indexOf(pat); i >= 0; i = str.indexOf(pat, i + 1)) s += 40;
  };
  for (let y = 0; y < size; y++) line(x => mod[y][x]);
  for (let x = 0; x < size; x++) line(y => mod[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (mod[y][x]) dark++;
    if (x < size - 1 && y < size - 1) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) s += 3; }
  }
  const total = size * size;
  s += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return s;
}

/** SVG path of the dark modules, offset by a quiet zone of `quiet` modules (viewBox 0 0 size+2q size+2q). */
export function qrSvgPath(m, quiet = 4) {
  let d = '';
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.at(x, y)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  return d;
}

/** A complete <svg> string: black modules on white with the quiet zone, scaled by the page (width/height 100%). */
export function qrSvg(text, { quiet = 4, label = '' } = {}) {
  const m = qrMatrix(text), n = m.size + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img"${label ? ` aria-label="${String(label).replace(/[&<>"]/g, '')}"` : ''}><rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${qrSvgPath(m, quiet)}"/></svg>`;
}
