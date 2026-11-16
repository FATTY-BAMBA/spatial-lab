// Minimal ASCII DXF reader for floor plans: LINE, LWPOLYLINE, POLYLINE/VERTEX, ARC,
// CIRCLE, TEXT, MTEXT, ATTRIB and INSERT (block references, nested with transforms).
// Output is in metres with plan coordinates [x, z] (DXF y flipped to z).
const UNIT = { 0: null, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };

// Layers that usually hold walls: AIA names, Chinese names, partitions (輕隔間)
export const WALL_LAYER = /wall|牆|墙|隔間|隔间|partition|prtn|壁/i;

// Decode a DXF file's bytes. Older Taiwan/China AutoCAD files are Big5 / GBK, named in $DWGCODEPAGE;
// R2007+ files are UTF-8. Falls back to Big5 when UTF-8 decoding produces replacement characters.
export function decodeDXF(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 20000)));
  const cp = ((head.match(/\$DWGCODEPAGE\s*\r?\n\s*3\r?\n\s*([^\r\n]+)/) || [])[1] || '').trim().toUpperCase();
  const ver = ((head.match(/\$ACADVER\s*\r?\n\s*1\r?\n\s*([^\r\n]+)/) || [])[1] || '').trim();
  const modern = ver >= 'AC1021'; // R2007+: always UTF-8
  const enc = modern ? 'utf-8' : /950/.test(cp) ? 'big5' : /936/.test(cp) ? 'gbk' : /932/.test(cp) ? 'shift_jis' : /949/.test(cp) ? 'euc-kr' : 'utf-8';
  let text = new TextDecoder(enc).decode(bytes);
  if (enc === 'utf-8' && !modern && text.includes('\uFFFD')) { try { text = new TextDecoder('big5').decode(bytes); } catch {} }
  return text;
}

export function parseDXF(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].replace(/\s+$/, '')]);
  let insunits = null;
  const blocks = {}, entities = [];
  let section = null, i = 0;
  const readEntity = start => {
    const type = pairs[start][1];
    const e = { type, layer: '0', pts: [], codes: {} };
    let j = start + 1;
    for (; j < pairs.length && pairs[j][0] !== 0; j++) {
      const [c, v] = pairs[j];
      if (c === 8) e.layer = v;
      else if (c === 10) e.pts.push([+v, 0]);
      else if (c === 20 && e.pts.length) e.pts[e.pts.length - 1][1] = +v;
      else if (c === 11) e.p2 = [+v, 0];
      else if (c === 21 && e.p2) e.p2[1] = +v;
      else if (c === 1 || c === 3) e.text = (e.text || '') + v;
      else if (c === 2) e.name = v;
      else e.codes[c] = v;
    }
    return { e, next: j };
  };
  function collect(at, out) {
    const { e, next } = readEntity(at);
    let j = next;
    if (e.type === 'POLYLINE') {
      e.pts = []; // the header's 10/20 is a dummy elevation point, not a vertex
      while (j < pairs.length && pairs[j][0] === 0 && pairs[j][1] === 'VERTEX') { const r = readEntity(j); if (r.e.pts[0]) e.pts.push(r.e.pts[0]); j = r.next; }
      if (j < pairs.length && pairs[j][1] === 'SEQEND') j = readEntity(j).next;
    }
    if (e.type !== 'SEQEND' && e.type !== 'VERTEX') out.push(e);
    return j;
  }
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'SECTION') { section = pairs[i + 1] && pairs[i + 1][1]; i += 2; continue; }
    if (c === 0 && v === 'ENDSEC') { section = null; i++; continue; }
    if (section === 'HEADER' && c === 9 && v === '$INSUNITS') { insunits = parseInt(pairs[i + 1][1], 10); i += 2; continue; }
    if (section === 'BLOCKS' && c === 0 && v === 'BLOCK') {
      const { e: head, next } = readEntity(i);
      const blk = { name: head.name, base: head.pts[0] || [0, 0], ents: [] };
      i = next;
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDBLK')) {
        if (pairs[i][0] === 0) i = collect(i, blk.ents); else i++;
      }
      blocks[blk.name] = blk;
      continue;
    }
    if (section === 'ENTITIES' && c === 0) { i = collect(i, entities); continue; }
    i++;
  }
  // geometry in drawing units
  const segs = [], texts = [];
  const emit = (e, xf, depth = 0) => {
    const T = p => xf(p);
    switch (e.type) {
      case 'LINE': if (e.pts[0] && e.p2) segs.push({ a: T(e.pts[0]), b: T(e.p2), layer: e.layer }); break;
      case 'LWPOLYLINE': case 'POLYLINE': {
        const P = e.pts.map(T);
        // a constant-width polyline is a wall drawn as one thick stroke
        const w = (+(e.codes[43] || e.codes[40] || 0) || 0) * (xf.scale || 1);
        const add = (a, b) => segs.push(w > 0 ? { a, b, layer: e.layer, w } : { a, b, layer: e.layer });
        for (let k = 0; k < P.length - 1; k++) add(P[k], P[k + 1]);
        if ((+e.codes[70] & 1) && P.length > 2) add(P[P.length - 1], P[0]);
        break;
      }
      case 'ARC': case 'CIRCLE': {
        const c0 = e.pts[0]; if (!c0) break;
        const r = +e.codes[40];
        const a0 = e.type === 'ARC' ? (+e.codes[50] * Math.PI) / 180 : 0;
        let a1 = e.type === 'ARC' ? (+e.codes[51] * Math.PI) / 180 : Math.PI * 2;
        if (a1 <= a0) a1 += Math.PI * 2;
        const n = Math.max(6, Math.round((a1 - a0) / 0.2));
        let prev = null;
        for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; const p = T([c0[0] + r * Math.cos(a), c0[1] + r * Math.sin(a)]); if (prev) segs.push({ a: prev, b: p, layer: e.layer, arc: true }); prev = p; }
        break;
      }
      case 'TEXT': case 'MTEXT': case 'ATTRIB': if (e.pts[0] && e.text) texts.push({ p: T(e.pts[0]), text: cleanText(e.text), layer: e.layer }); break;
      case 'INSERT': {
        const blk = blocks[e.name]; if (!blk || depth > 2) break;
        const ip = e.pts[0] || [0, 0];
        const sx = +(e.codes[41] || 1), sy = +(e.codes[42] || e.codes[41] || 1), rot = ((+e.codes[50] || 0) * Math.PI) / 180;
        const cs = Math.cos(rot), sn = Math.sin(rot);
        const inner = p => { const x = (p[0] - blk.base[0]) * sx, y = (p[1] - blk.base[1]) * sy; return xf([ip[0] + x * cs - y * sn, ip[1] + x * sn + y * cs]); };
        inner.scale = (xf.scale || 1) * Math.abs(sx);
        for (const be of blk.ents) emit({ ...be, layer: be.layer === '0' ? e.layer : be.layer }, inner, depth + 1);
        break;
      }
    }
  };
  for (const e of entities) emit(e, p => p);
  // units: header, else guess from extents (plans in mm are usually > 2000 units across)
  let k = UNIT[insunits];
  const all = segs.flatMap(s => [s.a, s.b]);
  const ext = all.length ? all.reduce((m, p) => ({ x0: Math.min(m.x0, p[0]), x1: Math.max(m.x1, p[0]), y0: Math.min(m.y0, p[1]), y1: Math.max(m.y1, p[1]) }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }) : { x0: 0, x1: 1, y0: 0, y1: 1 };
  if (!k) { const span = Math.max(ext.x1 - ext.x0, ext.y1 - ext.y0); k = span > 400 ? 0.001 : span > 40 ? 0.01 : 1; }
  // to metres, origin at the drawing's top-left, y flipped to plan z
  const X = p => [+((p[0] - ext.x0) * k).toFixed(4), +((ext.y1 - p[1]) * k).toFixed(4)];
  const layers = {};
  for (const s of segs) layers[s.layer] = (layers[s.layer] || 0) + 1;
  return {
    units: k, insunits,
    segs: segs.map(s => ({ a: X(s.a), b: X(s.b), layer: s.layer, arc: !!s.arc, ...(s.w ? { w: +(s.w * k).toFixed(4) } : {}) })).filter(s => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 0.005),
    texts: texts.map(t => ({ ...t, p: X(t.p) })),
    layers,
  };
}

function cleanText(t) { return t.replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/\\[A-Za-z][^;]*;/g, '').replace(/\\P/g, ' ').replace(/[{}]/g, '').trim(); }

// ---- spatial indexes for detectWalls. Each one only prunes: it returns a superset of the items that can pass the
// caller's exact test, and the caller still runs that test in the original order, so results are identical to the
// all-pairs loops they replace (O(n²) → about O(n), see qa/unit/dxf-index.test.mjs).
const ANG_BINS = 600, ANG_W = Math.PI / ANG_BINS, PAR = Math.asin(0.0201); // |cross| ≤ 0.02 ⇔ |Δθ| ≤ asin(0.02) (mod π)
const ANG_REACH = Math.ceil(PAR / ANG_W) + 1;
const angOf = (ux, uz) => Math.atan2(uz, ux);
const angBin = th => ((Math.round(th / ANG_W) % ANG_BINS) + ANG_BINS) % ANG_BINS;
const angDist = (a, b) => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };
// bins of near-parallel items, each with the exact direction of its first member as its frame
function angleBins() {
  const bins = new Map();
  return {
    bins,
    add(th, ux, uz) { const k = angBin(th); let b = bins.get(k); if (!b) bins.set(k, b = { th, ux, uz, nx: -uz, nz: ux, items: [] }); return b; },
    // bins that may hold an item parallel to direction th, with the angle between th and the bin's frame
    *near(th) { const k = angBin(th); for (let i = -ANG_REACH; i <= ANG_REACH; i++) { const b = bins.get((k + i + ANG_BINS) % ANG_BINS); if (b) yield [b, angDist(th, b.th)]; } },
  };
}
const cellKey = (i, j) => i * 4194304 + j; // |i|, |j| < 2^21 (cells are clamped to that)

// Walls from linework, in three passes:
//  1. constant-width polylines are walls already (centreline + width);
//  2. pairs of parallel lines 7–42 cm apart are the two faces of a wall; a second pass pairs what is
//     left at 3.5–7 cm (light partitions, 輕隔間) so thin pairs never steal a real wall's faces;
//  3. if most of the layer is still unexplained, the drawing uses single-line walls: long lines become
//     centrelines with a default thickness (set later by detectRooms: 20 cm exterior, 12 cm interior).
// Collinear pieces merge; the gaps between them become openings (a gap with glazing lines is a window).
// `exhaustive: true` skips the indexes (every pair is tested): the unit tests compare both on random drawings.
export function detectWalls(segs, { minT = 0.07, maxT = 0.42, minLen = 0.08, others = [], arcs = [], exhaustive = false } = {}) {
  const prep = list => list.filter(s => !s.arc && !s.w).map(s => {
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], len = Math.hypot(dx, dz);
    let ux = dx / len, uz = dz / len;
    if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uz < 0)) { ux = -ux; uz = -uz; }
    return { ...s, len, ux, uz };
  }).filter(s => s.len > minLen);
  // centre and radius of the drawing: offsets measured from the centre keep the pruning windows tight
  let O = [0, 0], RAD = 1;
  {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const s of segs) for (const p of [s.a, s.b]) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
    if (x0 <= x1) { O = [(x0 + x1) / 2, (z0 + z1) / 2]; RAD = Math.hypot(x1 - x0, z1 - z0) / 2 + 1; }
  }
  const EPS = 1e-6;
  // candidate partners j > i for every i: same or neighbouring direction bin, B.a within hi of A's line (plus the
  // error from measuring both in the bin's frame: 2·RAD·Δθ), and overlapping extents along the line
  const pairCandidates = (S, hi) => {
    if (exhaustive) return S.map((_, i) => Array.from({ length: S.length - i - 1 }, (_, k) => i + 1 + k));
    const AB = angleBins(), HC = Math.max(hi / 2, 0.05), HS = Math.max(1, (2 * RAD) / 2e6);
    const fr = S.map(A => {
      const b = AB.add(angOf(A.ux, A.uz), A.ux, A.uz);
      return b;
    });
    // each item in its own bin's frame: c = offset of .a, [s0, s1] = extent along the bin direction
    const rec = S.map((A, i) => {
      const b = fr[i], ca = (A.a[0] - O[0]) * b.nx + (A.a[1] - O[1]) * b.nz;
      const p = (A.a[0] - O[0]) * b.ux + (A.a[1] - O[1]) * b.uz, q = (A.b[0] - O[0]) * b.ux + (A.b[1] - O[1]) * b.uz;
      const r = { c: ca, s0: Math.min(p, q), s1: Math.max(p, q) };
      if (!b.grid) b.grid = new Map();
      const row = Math.floor(ca / HC);
      for (let col = Math.floor(r.s0 / HS), c1 = Math.floor(r.s1 / HS); col <= c1; col++) { const k = cellKey(row, col); let l = b.grid.get(k); if (!l) b.grid.set(k, l = []); l.push(i); }
      return r;
    });
    const stamp = new Int32Array(S.length).fill(-1), out = [];
    for (let i = 0; i < S.length; i++) {
      const A = S[i], th = angOf(A.ux, A.uz), list = [];
      for (const [b, dth] of AB.near(th)) {
        if (dth > PAR + ANG_W) continue;
        const slack = 2 * RAD * dth + EPS;
        const ca = (A.a[0] - O[0]) * b.nx + (A.a[1] - O[1]) * b.nz;
        const p = (A.a[0] - O[0]) * b.ux + (A.a[1] - O[1]) * b.uz, q = (A.b[0] - O[0]) * b.ux + (A.b[1] - O[1]) * b.uz;
        const r0 = Math.floor((ca - hi - slack) / HC), r1 = Math.floor((ca + hi + slack) / HC);
        const c0 = Math.floor((Math.min(p, q) - slack) / HS), c1 = Math.floor((Math.max(p, q) + slack) / HS);
        for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
          const l = b.grid.get(cellKey(row, col)); if (!l) continue;
          for (const j of l) if (j > i && stamp[j] !== i) { stamp[j] = i; list.push(j); }
        }
      }
      out.push(list.sort((x, y) => x - y));
    }
    return out;
  };
  const pairUp = (S, lo, hi) => {
    const raw = [];
    const cand = pairCandidates(S, hi);
    for (let i = 0; i < S.length; i++) for (const j of cand[i]) {
      const A = S[i], B = S[j];
      if (Math.abs(A.ux * B.uz - A.uz * B.ux) > 0.02) continue; // not parallel
      const nx = -A.uz, nz = A.ux;
      const d = (B.a[0] - A.a[0]) * nx + (B.a[1] - A.a[1]) * nz;
      const t = Math.abs(d);
      if (t < lo || t > hi) continue;
      // each end pair in ascending order (same values a two-element sort gives, without the arrays)
      const a0 = A.a[0] * A.ux + A.a[1] * A.uz, a1 = A.b[0] * A.ux + A.b[1] * A.uz, b0 = B.a[0] * A.ux + B.a[1] * A.uz, b1 = B.b[0] * A.ux + B.b[1] * A.uz;
      const pa0 = a0 > a1 ? a1 : a0, pa1 = a0 > a1 ? a0 : a1, pb0 = b0 > b1 ? b1 : b0, pb1 = b0 > b1 ? b0 : b1;
      const s0 = Math.max(pa0, pb0), s1 = Math.min(pa1, pb1);
      if (s1 - s0 < minLen) continue;
      const off = (A.a[0] * nx + A.a[1] * nz) + d / 2;
      raw.push({ ux: A.ux, uz: A.uz, nx, nz, off, s0, s1, t, i, j });
    }
    // keep the closest partner per stretch: drop pairs that enclose a thinner pair on the same line.
    // Ties (same thickness) go to the longer pair, and a same-thickness pair only drops when it sits
    // inside one already kept — so a short stub never evicts the full wall it belongs to.
    raw.sort((a, b) => (a.t - b.t > 0.01 ? 1 : b.t - a.t > 0.01 ? -1 : (b.s1 - b.s0) - (a.s1 - a.s0)));
    // kept pairs indexed by their stored offset and extent (the clash test compares exactly those values), visited
    // in the order they were kept; pairs dropped later are skipped like the filter below did
    let kept = [];
    const KH = Math.max(hi / 2, 0.05), KS = Math.max(1, (2 * RAD) / 2e6), kgrid = new Map();
    let seq = 0;
    for (const r of raw) {
      const rl = r.s1 - r.s0;
      let clash = false;
      const near = [], reach = (hi + r.t) / 2 + EPS, mark = ++seq;
      if (exhaustive) { for (const k of kept) if (!k.dead) near.push(k); } else for (let row = Math.floor((r.off - reach) / KH), r1 = Math.floor((r.off + reach) / KH); row <= r1; row++)
        for (let col = Math.floor(r.s0 / KS) - 1, c1 = Math.floor(r.s1 / KS) + 1; col <= c1; col++) {
          const l = kgrid.get(cellKey(row, col)); if (!l) continue;
          for (const k of l) if (!k.dead && k.mark !== mark) { k.mark = mark; near.push(k); }
        }
      if (near.length > 1) near.sort((a, b) => a.seq - b.seq);
      for (const k of near) {
        if (Math.abs(k.ux * r.uz - k.uz * r.ux) > 0.02 || Math.abs(k.off - r.off) >= (k.t + r.t) / 2 - 1e-6) continue;
        const ov = Math.min(k.s1, r.s1) - Math.max(k.s0, r.s0);
        if (ov <= 0.1 && !(ov > 0 && rl <= 0.12)) continue;
        if (!(r.t > k.t + 0.01 || (r.s0 >= k.s0 - 0.02 && r.s1 <= k.s1 + 0.02))) continue;
        const kl = k.s1 - k.s0;
        const kInside = k.s0 >= r.s0 - 0.02 && k.s1 <= r.s1 + 0.02, rInside = r.s0 >= k.s0 - 0.02 && r.s1 <= k.s1 + 0.02;
        // a short detail (door jamb, column cap) must not evict the long wall it sits in: the wall wins
        if (kInside && kl < 0.6 && rl > 3 * kl) { k.dead = true; continue; }
        // two walls meeting end to end on one line only share their ends: trim, don't drop
        if (!kInside && !rInside) {
          if (k.s0 <= r.s0) r.s0 = k.s1; else r.s1 = k.s0;
          if (r.s1 - r.s0 < minLen) { clash = true; break; }
          continue;
        }
        clash = true; break;
      }
      if (!clash) {
        r.seq = seq++; kept.push(r);
        const row = Math.floor(r.off / KH);
        for (let col = Math.floor(r.s0 / KS), c1 = Math.floor(r.s1 / KS); col <= c1; col++) { const k = cellKey(row, col); let l = kgrid.get(k); if (!l) kgrid.set(k, l = []); l.push(r); }
      }
    }
    return kept.filter(k => !k.dead).map(k => { delete k.seq; delete k.mark; return k; });
  };
  const S = prep(segs);
  let bands = pairUp(S, minT, maxT);
  // which segments does a band explain (lies inside it)?
  const inBand = (s, b) => {
    if (Math.abs(s.ux * b.uz - s.uz * b.ux) > 0.03) return false;
    const m = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
    const across = Math.abs(m[0] * b.nx + m[1] * b.nz - b.off), along = m[0] * b.ux + m[1] * b.uz;
    return across <= b.t / 2 + 0.02 && along > b.s0 - 0.05 && along < b.s1 + 0.05;
  };
  // bands indexed by the cells their rectangle (± t/2 + 2 cm across, ± 5 cm along) covers; a segment's midpoint
  // can only be inside bands registered in its own cell
  const bandIndex = list => {
    const CELL = 1, g = new Map();
    for (const b of list) {
      const h = b.t / 2 + 0.02 + CELL / 2 + EPS, a0 = b.s0 - 0.05, a1 = b.s1 + 0.05;
      const n = Math.max(1, Math.ceil((a1 - a0) / CELL));
      const seen = new Set();
      for (let k = 0; k <= n; k++) {
        const al = a0 + ((a1 - a0) * k) / n, px = b.ux * al + b.nx * b.off, pz = b.uz * al + b.nz * b.off;
        for (let i = Math.floor((px - h - O[0]) / CELL), i1 = Math.floor((px + h - O[0]) / CELL); i <= i1; i++)
          for (let j = Math.floor((pz - h - O[1]) / CELL), j1 = Math.floor((pz + h - O[1]) / CELL); j <= j1; j++) {
            const key = cellKey(i, j); if (seen.has(key)) continue; seen.add(key);
            let l = g.get(key); if (!l) g.set(key, l = []); l.push(b);
          }
      }
    }
    if (exhaustive) return s => list.some(b => inBand(s, b));
    return s => { const m = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], l = g.get(cellKey(Math.floor((m[0] - O[0]) / CELL), Math.floor((m[1] - O[1]) / CELL))); return !!l && l.some(b => inBand(s, b)); };
  };
  let explained = bandIndex(bands);
  // pass 2: thin partitions among the leftovers
  const left = S.filter(s => !explained(s));
  if (left.length) { bands = bands.concat(pairUp(left, 0.035, minT)); explained = bandIndex(bands); }
  // pass 3: single-line drawings
  const totalLen = S.reduce((a, s) => a + s.len, 0) || 1;
  const rest = S.filter(s => !explained(s));
  const restLen = rest.reduce((a, s) => a + s.len, 0);
  const singleLine = restLen / totalLen > 0.5;
  const centre = (s, t, extra = {}) => {
    const nx = -s.uz, nz = s.ux, pa = [s.a, s.b].map(p => p[0] * s.ux + p[1] * s.uz).sort((x, y) => x - y);
    return { ux: s.ux, uz: s.uz, nx, nz, off: s.a[0] * nx + s.a[1] * nz, s0: pa[0], s1: pa[1], t, ...extra };
  };
  if (singleLine) for (const s of rest) if (s.len >= 0.5) bands.push(centre(s, 0.12, { soft: true }));
  // pass 1: wide polylines
  for (const s of segs) if (s.w >= 0.04 && !s.arc) {
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], len = Math.hypot(dx, dz);
    if (len < minLen) continue;
    let ux = dx / len, uz = dz / len;
    if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uz < 0)) { ux = -ux; uz = -uz; }
    bands.push(centre({ ...s, ux, uz, len }, Math.min(s.w, 0.6)));
  }

  // a gap with glazing lines (parallel lines from other layers inside the wall band) is a window
  const glazed = (w, s0, s1) => others.some(g => {
    const gx = g.b[0] - g.a[0], gz = g.b[1] - g.a[1], gl = Math.hypot(gx, gz);
    if (gl < 0.2 || Math.abs((gx / gl) * w.uz - (gz / gl) * w.ux) > 0.05) return false;
    const m = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2];
    const along = m[0] * w.ux + m[1] * w.uz, across = m[0] * w.nx + m[1] * w.nz - w.off;
    return Math.abs(across) <= Math.max(w.t, 0.12) / 2 + 0.03 && along > s0 + 0.02 && along < s1 - 0.02;
  });
  // CAD lines are often a fraction of a degree off true: snap near-axis bands (within ~1.2°) to the axis
  for (const b of bands) {
    const ax = Math.abs(b.ux) > 0.99978 ? [1, 0] : Math.abs(b.uz) > 0.99978 ? [0, 1] : null;
    if (!ax) continue;
    const sm = (b.s0 + b.s1) / 2, mid = [b.ux * sm + b.nx * b.off, b.uz * sm + b.nz * b.off], half = (b.s1 - b.s0) / 2;
    b.ux = ax[0]; b.uz = ax[1]; b.nx = -ax[1]; b.nz = ax[0];
    const along = mid[0] * b.ux + mid[1] * b.uz;
    b.off = mid[0] * b.nx + mid[1] * b.nz; b.s0 = along - half; b.s1 = along + half;
  }
  // merge collinear pieces of similar thickness; small gaps become openings, wide glazed gaps too (sliding doors)
  bands.sort((a, b) => a.off - b.off || a.s0 - b.s0);
  // same line = parallel, and the other piece's midpoint sits on this line (measured in world space, so
  // slightly skewed or far-from-origin drawings still merge)
  const sameLine = (p, q) => {
    if (Math.abs(q.ux * p.uz - q.uz * p.ux) > 0.02) return false;
    const qm = (q.s0 + q.s1) / 2, mid = [q.ux * qm + q.nx * q.off, q.uz * qm + q.nz * q.off];
    return Math.abs(mid[0] * p.nx + mid[1] * p.nz - p.off) < Math.max(0.03, Math.min(p.t, q.t) * 0.35) && Math.abs(q.t - p.t) < 0.04;
  };
  const toFrame = (p, q) => { // q's extent along p's direction
    const a = [q.ux * q.s0 + q.nx * q.off, q.uz * q.s0 + q.nz * q.off], b = [q.ux * q.s1 + q.nx * q.off, q.uz * q.s1 + q.nz * q.off];
    const s = [a[0] * p.ux + a[1] * p.uz, b[0] * p.ux + b[1] * p.uz].sort((x, y) => x - y);
    return { ...q, ux: p.ux, uz: p.uz, nx: p.nx, nz: p.nz, off: p.off, s0: s[0], s1: s[1] };
  };
  // candidates for sameLine: near-parallel bands whose midpoint offset (in the bin's frame) is within the tolerance
  // of this band's line, allowing 2·RAD·Δθ for measuring in the bin's frame instead of the band's own
  const LB = angleBins();
  bands.forEach((q, j) => {
    const b = LB.add(angOf(q.ux, q.uz), q.ux, q.uz), qm = (q.s0 + q.s1) / 2;
    const mx = q.ux * qm + q.nx * q.off - O[0], mz = q.uz * qm + q.nz * q.off - O[1];
    b.items.push({ c: mx * b.nx + mz * b.nz, j });
  });
  for (const b of LB.bins.values()) b.items.sort((x, y) => x.c - y.c);
  const lineCandidates = p => {
    if (exhaustive) return bands.map((_, j) => j);
    const pm = (p.s0 + p.s1) / 2, X = [p.ux * pm + p.nx * p.off - O[0], p.uz * pm + p.nz * p.off - O[1]];
    const tol = Math.max(0.03, p.t * 0.35), out = [];
    for (const [b, dth] of LB.near(angOf(p.ux, p.uz))) {
      if (dth > PAR + ANG_W) continue;
      const c = X[0] * b.nx + X[1] * b.nz, w = tol + 2 * RAD * dth + EPS, it = b.items;
      let lo = 0, hi = it.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (it[m].c < c - w) lo = m + 1; else hi = m; }
      for (let k = lo; k < it.length && it[k].c <= c + w; k++) out.push(it[k].j);
    }
    return out.sort((x, y) => x - y);
  };
  const walls = [], used = new Set();
  for (let i = 0; i < bands.length; i++) {
    if (used.has(i)) continue;
    const line = [bands[i]]; used.add(i);
    for (const j of lineCandidates(bands[i])) {
      if (j <= i) continue;
      const r = bands[j];
      if (used.has(j)) continue;
      if (sameLine(bands[i], r)) { line.push(toFrame(bands[i], r)); used.add(j); }
    }
    line.sort((a, b) => a.s0 - b.s0);
    let cur = { ...line[0], openings: [] };
    for (let k = 1; k < line.length; k++) {
      const r = line[k], gap = r.s0 - cur.s1;
      if (gap < 0.05) { cur.s1 = Math.max(cur.s1, r.s1); continue; }
      if (gap <= 6.2 || (gap <= 9.6 && glazed(cur, cur.s1, r.s0))) { cur.openings.push({ s: cur.s1, w: gap }); cur.s1 = Math.max(cur.s1, r.s1); continue; }
      walls.push(cur); cur = { ...r, openings: [] };
    }
    walls.push(cur);
  }
  return walls.filter(w => w.s1 - w.s0 >= 0.12 || w.openings.length).map(w => {
    const a = [w.ux * w.s0 + w.nx * w.off, w.uz * w.s0 + w.nz * w.off];
    const b = [w.ux * w.s1 + w.nx * w.off, w.uz * w.s1 + w.nz * w.off];
    return {
      a: a.map(v => +v.toFixed(3)), b: b.map(v => +v.toFixed(3)), t: +w.t.toFixed(3), tLocked: !w.soft,
      openings: w.openings.map(o => openingFor(o.s - w.s0, o.w, glazed(w, o.s, o.s + o.w), arcs, w)),
    };
  });
}

// Classify a gap: glazing → window (or a sliding door when wide); else a door, or an open passage when wide.
function openingFor(offset, width, glass, arcs = [], w = null) {
  const off = +offset.toFixed(3), wd = +width.toFixed(3);
  if (glass) return wd >= 2.4 ? { type: 'slider', offset: off, width: wd, sill: 0, head: 2.4, panels: wd > 4 ? 4 : 2 } : { type: 'window', offset: off, width: wd, sill: wd < 1 ? 1.4 : 0.9, head: 2.2 };
  return wd < 1.3 ? { type: 'door', offset: off, width: wd, sill: 0, head: 2.1 } : { type: 'passage', offset: off, width: wd, sill: 0, head: 2.4 };
}

// Extend wall ends so the plan closes into rooms:
//  · a corner gap up to `reach` closes to the intersection;
//  · a partition that stops 0.5–1.5 m short of another wall is a doorway: extend it and put an opening
//    on the extension (most interior doors sit between a partition end and the next wall).
export function closeCorners(walls, reach = 0.45, { doorGap = 1.5 } = {}) {
  const inter = (w, v) => {
    const r = [w.b[0] - w.a[0], w.b[1] - w.a[1]], s = [v.b[0] - v.a[0], v.b[1] - v.a[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-6) return null;
    const qp = [v.a[0] - w.a[0], v.a[1] - w.a[1]];
    const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
    return { t, u, p: [w.a[0] + r[0] * t, w.a[1] + r[1] * t] };
  };
  const ends = [];
  for (const w of walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    for (const end of ['a', 'b']) {
      let best = null, door = null;
      for (const v of walls) {
        if (v === w) continue;
        const h = inter(w, v); if (!h) continue;
        const vlen = Math.hypot(v.b[0] - v.a[0], v.b[1] - v.a[1]);
        const dEnd = end === 'a' ? -h.t * len : (h.t - 1) * len; // >0 means beyond this end
        const onV = h.u > -reach / vlen && h.u < 1 + reach / vlen;
        if (onV && dEnd > -reach && dEnd < reach && (!best || Math.abs(dEnd) < Math.abs(best.d))) best = { d: dEnd, p: h.p };
        // doorway: the extension must land squarely on v (not past its ends) and v must be roughly perpendicular
        const strictlyOnV = h.u > 0.02 && h.u < 0.98;
        const cos = Math.abs(((w.b[0] - w.a[0]) * (v.b[0] - v.a[0]) + (w.b[1] - w.a[1]) * (v.b[1] - v.a[1])) / (len * vlen || 1));
        const gap = dEnd - (v.t || 0.12) / 2;
        if (strictlyOnV && cos < 0.3 && gap >= 0.5 && dEnd <= doorGap && (!door || dEnd < door.d)) door = { d: dEnd, p: h.p, gap, vt: v.t || 0.12 };
      }
      ends.push({ w, end, best, door, len });
    }
  }
  for (const { w, end, best, door, len } of ends) {
    const hit = best || door;
    if (!hit) continue;
    // the doorway must not cut through another wall on the way
    if (!best && door) {
      const from = w[end];
      const blocked = walls.some(v => v !== w && (() => { const h = inter({ a: from, b: door.p }, v); return h && h.t > 0.02 && h.t < 0.98 && h.u > 0 && h.u < 1; })());
      if (blocked) continue;
    }
    const extend = hit.d; // >0 grows the wall
    if (end === 'a') for (const o of w.openings) o.offset = +(o.offset + extend).toFixed(3);
    w[end] = hit.p.map(v => +v.toFixed(3));
    if (!best && door) {
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const width = +door.gap.toFixed(3);
      const offset = end === 'a' ? +(door.vt / 2).toFixed(3) : +(L - door.d).toFixed(3);
      w.openings.push(width < 1.3 ? { type: 'door', offset, width, sill: 0, head: 2.1 } : { type: 'passage', offset, width, sill: 0, head: 2.4 });
    }
  }
  return walls;
}

// Layers to read walls from by default: every wall-like layer, else the busiest one.
export function defaultWallLayers(d) {
  const named = Object.keys(d.layers).filter(l => WALL_LAYER.test(l) && !/hatch|patt|填充|dim|標註/i.test(l));
  if (named.length) return named;
  const busiest = Object.entries(d.layers).sort((a, b) => b[1] - a[1])[0];
  return busiest ? [busiest[0]] : [];
}

// Layers holding room outlines (AIA A-AREA / A-ROOM, Chinese 房間 / 空間 / 區域)
export const ROOM_LAYER = /a-room|a-area|area-bndy|room|space|房間|空間|區域|区域/i;

// The whole import step shared by the editor and the benchmark: chosen layers → closed walls.
// Room outlines, when the drawing has them, become invisible zone boundaries wherever no wall stands,
// so open-plan spaces and single-outline drawings still split into rooms.
export function wallsFromDXF(d, layers) {
  const set = new Set(layers);
  const segs = d.segs.filter(s => set.has(s.layer));
  const others = d.segs.filter(s => !set.has(s.layer) && !s.arc);
  const arcs = d.segs.filter(s => s.arc);
  const walls = closeCorners(detectWalls(segs, { others, arcs }));
  const outline = d.segs.filter(s => !s.arc && !set.has(s.layer) && ROOM_LAYER.test(s.layer) && !/roof|屋頂/i.test(s.layer));
  if (outline.length) {
    const near = s => walls.some(w => {
      const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
      const sx = s.b[0] - s.a[0], sz = s.b[1] - s.a[1], sl = Math.hypot(sx, sz) || 1;
      if (Math.abs(ux * sz / sl - uz * sx / sl) > 0.05) return false;
      const m = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], along = (m[0] - w.a[0]) * ux + (m[1] - w.a[1]) * uz;
      return Math.abs((m[0] - w.a[0]) * -uz + (m[1] - w.a[1]) * ux) < w.t / 2 + 0.3 && along > -0.1 && along < L + 0.1;
    });
    const zones = detectWalls(outline.filter(s => !near(s)).map(s => ({ ...s, layer: 'zone' })), { minT: 9, maxT: 9 }) // single-line pass only
      .map(w => ({ ...w, kind: 'zone', t: 0.12, tLocked: false, openings: [] }));
    if (zones.length) return closeCorners(walls.concat(zones));
  }
  return walls;
}
