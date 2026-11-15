// Plan image → walls.
// Walls in a plan picture are the thickest dark strokes. We find them by stroke width (the shorter of the
// horizontal and vertical dark run through each pixel), cut them into axis-aligned wall rectangles, and hand
// each rectangle's two faces to the DXF wall engine — so pairing, door gaps, corners and rooms work the same
// way as for CAD files. Thin dark lines inside wall gaps are passed along as glazing (windows).
import { detectWalls, closeCorners } from './dxf.js';

const WORK = 1600; // working size (long side, px): small scans are upsampled so thin walls survive

// Bilinear resample of RGBA pixels to luminance at the working size
function toWorkLum(img) {
  const s = WORK / Math.max(img.width, img.height), W = Math.round(img.width * s), H = Math.round(img.height * s);
  const lum = new Uint8Array(W * H), src = img.data, sw = img.width, sh = img.height;
  const L = i => { const r = src[i], g = src[i + 1], b = src[i + 2], a = src[i + 3] / 255; return 255 - a * (255 - (0.299 * r + 0.587 * g + 0.114 * b)); };
  for (let y = 0; y < H; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / s - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / s - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const v = (L((y0 * sw + x0) * 4) * (1 - tx) + L((y0 * sw + x1) * 4) * tx) * (1 - ty) + (L((y1 * sw + x0) * 4) * (1 - tx) + L((y1 * sw + x1) * 4) * tx) * ty;
      lum[y * W + x] = v;
    }
  }
  return { lum, W, H, s };
}

function otsu(lum) {
  const h = new Float64Array(256); for (const v of lum) h[v]++;
  const n = lum.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += h[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sB += t * h[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

// Horizontal / vertical run length of `mask` through each pixel
function runs(mask, W, H) {
  const hr = new Uint16Array(W * H), vr = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W;) {
    const i = y * W + x; if (!mask[i]) { x++; continue; }
    let e = x; while (e < W && mask[y * W + e]) e++;
    for (let k = x; k < e; k++) hr[y * W + k] = e - x; x = e;
  }
  for (let x = 0; x < W; x++) for (let y = 0; y < H;) {
    if (!mask[y * W + x]) { y++; continue; }
    let e = y; while (e < H && mask[e * W + x]) e++;
    for (let k = y; k < e; k++) vr[k * W + x] = e - y; y = e;
  }
  return { hr, vr };
}

// Axis-aligned bars: runs along `dir` of length ≥ L, joined across neighbouring rows into components.
// Each component → { c0, c1 (extent along), m (centre across), t (thickness) } in work px.
function bars(mask, W, H, L, horizontal) {
  const N = horizontal ? H : W, M = horizontal ? W : H, at = (r, c) => mask[horizontal ? r * M + c : c * W + r];
  const rowRuns = [];
  for (let r = 0; r < N; r++) {
    const list = [];
    for (let c = 0; c < M;) { if (!at(r, c)) { c++; continue; } let e = c; while (e < M && at(r, e)) e++; if (e - c >= L) list.push({ r, c0: c, c1: e, id: -1 }); c = e; }
    rowRuns.push(list);
  }
  const parent = []; const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const all = [];
  for (let r = 0; r < N; r++) for (const run of rowRuns[r]) {
    run.id = all.length; parent.push(run.id); all.push(run);
    if (r) for (const p of rowRuns[r - 1]) if (p.c0 < run.c1 && run.c0 < p.c1 && Math.min(p.c1, run.c1) - Math.max(p.c0, run.c0) >= L * 0.5) parent[find(run.id)] = find(p.id);
  }
  const comps = new Map();
  for (const run of all) { const k = find(run.id); if (!comps.has(k)) comps.set(k, []); comps.get(k).push(run); }
  const out = [];
  for (const list of comps.values()) {
    // thickness and centre from column samples (robust to a junction blob at one end)
    const c0 = Math.min(...list.map(r => r.c0)), c1 = Math.max(...list.map(r => r.c1));
    const ts = [], ms = [];
    for (let k = 0; k < 9; k++) {
      const c = c0 + (c1 - c0) * (k + 0.5) / 9, rs = list.filter(r => r.c0 <= c && c < r.c1).map(r => r.r);
      if (rs.length) { ts.push(Math.max(...rs) - Math.min(...rs) + 1); ms.push((Math.max(...rs) + Math.min(...rs) + 1) / 2); }
    }
    if (!ts.length) continue;
    ts.sort((a, b) => a - b); ms.sort((a, b) => a - b);
    out.push({ c0, c1, m: ms[ms.length >> 1], t: ts[ts.length >> 1] });
  }
  return out;
}

// Find walls in a plan picture. img = { width, height, data: RGBA } (an ImageData).
// Returns pixel-space geometry (in the ORIGINAL image's pixels) so the caller can apply any scale later.
export function extractPlanLines(img) {
  const { lum, W, H, s } = toWorkLum(img);
  const thr = Math.max(60, Math.min(140, otsu(lum) - 10));
  const dark = new Uint8Array(W * H); for (let i = 0; i < lum.length; i++) dark[i] = lum[i] < thr;
  const { hr, vr } = runs(dark, W, H);
  // wall thickness = the most common width of LONG dark strokes (≥ 4× longer than wide) — text and fixtures are short
  const hist = new Float64Array(80);
  const minW = Math.max(3, Math.round(WORK / 400));
  for (let i = 0; i < dark.length; i++) if (dark[i]) {
    const h = hr[i], v = vr[i];
    if (h >= 4 * v && v >= minW && v < 80) hist[v]++; else if (v >= 4 * h && h >= minW && h < 80) hist[h]++;
  }
  let tPx = 0, best = 0;
  for (let w = minW; w < 80; w++) { const v = hist[w - 1] * 0.5 + hist[w] + hist[w + 1] * 0.5; if (v > best) { best = v; tPx = w; } }
  if (!tPx) return { faces: [], thin: [], tPx: 0 };
  // partitions are often under half the exterior wall: keep every elongated stroke at least ~40% of it
  const k = Math.max(minW, Math.round(tPx * 0.4));
  const wall = new Uint8Array(W * H), thin = new Uint8Array(W * H);
  for (let i = 0; i < dark.length; i++) if (dark[i]) { if (Math.min(hr[i], vr[i]) >= k) wall[i] = 1; else if (Math.min(hr[i], vr[i]) <= Math.max(2, k / 2.5)) thin[i] = 1; }
  const L = Math.max(k * 4, Math.round(tPx * 2.5)); // shortest wall piece: longer than a letter
  const faces = [], thinLines = [];
  const back = v => v / s; // work px → original px
  const taken = new Uint8Array(W * H); // wall pixels already explained by straight bars
  for (const horizontal of [true, false]) {
    for (const b of bars(wall, W, H, L, horizontal)) {
      if (b.t < k || b.t > tPx * 3.5) continue;
      for (let c = Math.max(0, b.c0 - 2); c < Math.min(horizontal ? W : H, b.c1 + 2); c++) for (let r = Math.floor(b.m - b.t / 2 - 2); r <= Math.ceil(b.m + b.t / 2 + 2); r++) { const i = horizontal ? r * W + c : c * W + r; if (r >= 0 && r < (horizontal ? H : W)) taken[i] = 1; }
      for (const side of [-1, 1]) {
        const m = b.m + side * b.t / 2;
        faces.push(horizontal ? { a: [back(b.c0), back(m)], b: [back(b.c1), back(m)] } : { a: [back(m), back(b.c0)], b: [back(m), back(b.c1)] });
      }
    }
    for (const b of bars(thin, W, H, L, horizontal)) {
      if (b.t > Math.max(3, k / 2)) continue;
      thinLines.push(horizontal ? { a: [back(b.c0), back(b.m)], b: [back(b.c1), back(b.m)] } : { a: [back(b.m), back(b.c0)], b: [back(b.m), back(b.c1)] });
    }
  }
  // angled walls (bay windows, chamfered corners): leftover thick components fitted with their principal axis
  const seen = new Uint8Array(W * H), stack = [];
  for (let i0 = 0; i0 < wall.length; i0++) {
    if (!wall[i0] || taken[i0] || seen[i0]) continue;
    const px = []; stack.push(i0); seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop(); px.push(i); const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const j = Y * W + X; if (wall[j] && !taken[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    const Ld = Math.max(k * 3, Math.round(tPx * 1.5)); // chamfers are short
    if (px.length < Ld * k) continue;
    let mx = 0, my = 0; for (const i of px) { mx += i % W; my += (i / W) | 0; } mx /= px.length; my /= px.length;
    let sxx = 0, syy = 0, sxy = 0; for (const i of px) { const dx = i % W - mx, dy = ((i / W) | 0) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
    const deg = Math.abs(ang * 180 / Math.PI) % 90; if (deg < 12 || deg > 78) continue; // near-axis leftovers are fixtures, not walls
    let lo = Infinity, hi = -Infinity; const across = [];
    for (const i of px) { const dx = i % W - mx, dy = ((i / W) | 0) - my, a = dx * ux + dy * uy; lo = Math.min(lo, a); hi = Math.max(hi, a); across.push(-dx * uy + dy * ux); }
    const len = hi - lo, t = px.length / len;
    if (len < Ld || t < k * 0.8 || t > tPx * 2.5 || len < 2.2 * t) continue;
    // a real angled wall joins the straight ones; isolated diagonals are bold text, arrows or a compass
    const near = (x, y) => { const R = Math.ceil(tPx * 1.2); for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) { const X = Math.round(x + dx), Y = Math.round(y + dy); if (X >= 0 && Y >= 0 && X < W && Y < H && taken[Y * W + X]) return true; } return false; };
    if (!near(mx + ux * lo, my + uy * lo) && !near(mx + ux * hi, my + uy * hi)) continue;
    for (const side of [-1, 1]) {
      const o = side * t / 2, A = [mx + ux * lo - uy * o, my + uy * lo + ux * o], B = [mx + ux * hi - uy * o, my + uy * hi + ux * o];
      faces.push({ a: A.map(back), b: B.map(back) });
    }
  }
  return { faces, thin: thinLines, tPx: tPx / s };
}

// Pixel geometry → editor walls. `mpp` = metres per original pixel; (ox, oz) = where pixel (0,0) sits in plan space.
// Without a scale we assume the dominant (exterior) wall is drawn 25 cm thick — marketing plans draw walls bold.
export function wallsFromImage(lines, { mpp = 0, ox = 0, oz = 0 } = {}) {
  const k = mpp || 0.25 / (lines.tPx || 1);
  const P = p => [ox + p[0] * k, oz + p[1] * k];
  const seg = l => ({ a: P(l.a), b: P(l.b), layer: 'img' });
  const walls = detectWalls(lines.faces.map(seg), { minT: 0.03, maxT: 0.5, minLen: 0.05, others: lines.thin.map(seg) });
  return { walls: bridgeGaps(closeCorners(walls), lines.thin.map(seg)), mpp: k };
}

// Drawn plans often offset the wall pieces on either side of a doorway. Two free wall ends that face each
// other across 0.4–1.6 m (and line up within about a wall thickness) become a short wall that is all doorway.
function bridgeGaps(walls, glass = []) {
  const fr = w => { const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], L = Math.hypot(dx, dz) || 1; return { ux: dx / L, uz: dz / L, L }; };
  const touches = (p, self) => walls.some(v => {
    if (v === self) return false;
    if (self) { const f1 = fr(self), f2 = fr(v); if (Math.abs(f1.ux * f2.uz - f1.uz * f2.ux) < 0.1) return false; } // collinear overlaps don't close an end
    const { ux, uz, L } = fr(v), rx = p[0] - v.a[0], rz = p[1] - v.a[1], al = rx * ux + rz * uz;
    return al > -0.05 && al < L + 0.05 && Math.abs(-rx * uz + rz * ux) <= v.t / 2 + 0.06;
  });
  const free = [];
  for (const w of walls) { if (w.kind) continue; const f = fr(w); for (const e of ['a', 'b']) if (!touches(w[e], w)) free.push({ w, p: w[e], out: e === 'a' ? [-f.ux, -f.uz] : [f.ux, f.uz] }); }
  const used = new Set(), add = [];
  for (const A of free) {
    if (used.has(A)) continue;
    let best = null;
    for (const B of free) {
      if (B === A || used.has(A) || B.w === A.w || used.has(B)) continue;
      if (A.out[0] * B.out[0] + A.out[1] * B.out[1] > -0.6) continue; // must roughly face each other (angled bays too)
      const dx = B.p[0] - A.p[0], dz = B.p[1] - A.p[1], along = dx * A.out[0] + dz * A.out[1], side = Math.abs(-dx * A.out[1] + dz * A.out[0]);
      const back = -(dx * B.out[0] + dz * B.out[1]); // A must also lie ahead of B
      if (along < 0.4 || along > 1.8 || back < 0.2 || side > 1.5 * Math.max(A.w.t, B.w.t) + 0.1) continue;
      if (!best || along < best.along) best = { B, along };
    }
    if (!best) continue;
    used.add(A); used.add(best.B);
    const len = Math.hypot(best.B.p[0] - A.p[0], best.B.p[1] - A.p[1]), t = Math.min(A.w.t, best.B.w.t);
    add.push({ a: A.p.slice(), b: best.B.p.slice(), t, tLocked: true, openings: [len < 1.3 ? { type: 'door', offset: 0, width: +len.toFixed(3), sill: 0, head: 2.1 } : { type: 'passage', offset: 0, width: +len.toFixed(3), sill: 0, head: 2.4 }] });
  }
  // sliding partitions / glazed openings: a free end pointing at a wall up to 4.5 m away, with thin glazing
  // or slider lines filling at least half of the span → extend the wall there and make the span an opening
  for (const A of free) {
    if (used.has(A)) continue;
    const f = fr(A.w);
    let hit = null;
    for (const v of walls) {
      if (v === A.w) continue;
      const g = fr(v), den = A.out[0] * g.uz - A.out[1] * g.ux; if (Math.abs(den) < 0.9) continue; // roughly perpendicular
      const qx = v.a[0] - A.p[0], qz = v.a[1] - A.p[1], ta = (qx * g.uz - qz * g.ux) / den, tv = (qx * A.out[1] - qz * A.out[0]) / den;
      if (ta < 0.5 || ta > 4.5 || tv < 0.05 || tv > g.L - 0.05) continue;
      if (!hit || ta < hit.d) hit = { d: ta, v };
    }
    if (!hit) continue;
    const d = hit.d - hit.v.t / 2, s0 = 0.05, s1 = d - 0.05;
    const cover = [];
    for (const l of glass) {
      const lx = l.b[0] - l.a[0], lz = l.b[1] - l.a[1], ll = Math.hypot(lx, lz); if (ll < 0.2 || Math.abs(lx / ll * A.out[1] - lz / ll * A.out[0]) > 0.05) continue;
      const pa = [l.a, l.b].map(p => [(p[0] - A.p[0]) * A.out[0] + (p[1] - A.p[1]) * A.out[1], Math.abs(-(p[0] - A.p[0]) * A.out[1] + (p[1] - A.p[1]) * A.out[0])]);
      if (pa[0][1] > A.w.t / 2 + 0.12 || pa[1][1] > A.w.t / 2 + 0.12) continue;
      cover.push([Math.max(s0, Math.min(pa[0][0], pa[1][0])), Math.min(s1, Math.max(pa[0][0], pa[1][0]))]);
    }
    cover.sort((x, y) => x[0] - y[0]); let got = 0, upto = s0;
    for (const [c0, c1] of cover) { if (c1 <= upto) continue; got += c1 - Math.max(c0, upto); upto = c1; }
    if (got < 0.5 * (s1 - s0)) continue;
    const end = A.w.a === A.p ? 'a' : 'b', X = [A.p[0] + A.out[0] * hit.d, A.p[1] + A.out[1] * hit.d].map(v => +v.toFixed(3));
    const width = +(d).toFixed(3);
    if (end === 'a') { for (const o of A.w.openings) o.offset = +(o.offset + hit.d).toFixed(3); A.w.openings.push({ type: width >= 1.6 ? 'slider' : 'window', offset: +(hit.v.t / 2).toFixed(3), width, sill: width >= 1.6 ? 0 : 0.9, head: width >= 1.6 ? 2.4 : 2.2, ...(width >= 1.6 ? { panels: width > 4 ? 4 : 2 } : {}) }); }
    else A.w.openings.push({ type: width >= 1.6 ? 'slider' : 'window', offset: +(f.L).toFixed(3), width, sill: width >= 1.6 ? 0 : 0.9, head: width >= 1.6 ? 2.4 : 2.2, ...(width >= 1.6 ? { panels: width > 4 ? 4 : 2 } : {}) });
    A.w[end] = X; A.p = X; used.add(A);
  }
  // solid filled corners: two free ends at right angles whose lines meet within 2.6 m → extend both to the corner
  for (const A of free) {
    if (used.has(A)) continue;
    for (const B of free) {
      if (B === A || B.w === A.w || used.has(B) || used.has(A)) continue;
      if (Math.abs(A.out[0] * B.out[0] + A.out[1] * B.out[1]) > 0.05) continue;
      const axis = o => Math.abs(o[0]) > 0.999 || Math.abs(o[1]) > 0.999;
      if (!axis(A.out) || !axis(B.out) || fr(A.w).L < 1 || fr(B.w).L < 1) continue;
      const den = A.out[0] * B.out[1] - A.out[1] * B.out[0]; if (Math.abs(den) < 1e-6) continue;
      const qx = B.p[0] - A.p[0], qz = B.p[1] - A.p[1], ta = (qx * B.out[1] - qz * B.out[0]) / den, tb = (qx * A.out[1] - qz * A.out[0]) / den;
      if (ta < -0.3 || tb < -0.3 || ta > 2.6 || tb > 2.6 || ta + tb < 0.3) continue;
      const X = [A.p[0] + A.out[0] * ta, A.p[1] + A.out[1] * ta].map(v => +v.toFixed(3));
      for (const E of [A, B]) { const end = E.w.a === E.p ? 'a' : 'b'; if (end === 'a') { const g = Math.hypot(X[0] - E.p[0], X[1] - E.p[1]) * (E === A ? Math.sign(ta) : Math.sign(tb)); for (const o of E.w.openings) o.offset = +(o.offset + g).toFixed(3); } E.w[end] = X; E.p = X; used.add(E); }
    }
  }
  // short pieces touching nothing at either end are bold text strokes or symbols, not walls
  const out = walls.concat(add).filter(w => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) >= 0.05);
  // keep only wall groups that belong to the building: small isolated clusters are text, symbols or furniture
  const near = (p, v) => { const { ux, uz, L } = fr(v), rx = p[0] - v.a[0], rz = p[1] - v.a[1], al = rx * ux + rz * uz; return al > -0.1 && al < L + 0.1 && Math.abs(-rx * uz + rz * ux) <= v.t / 2 + 0.08; };
  const comp = new Map(); let n = 0;
  for (const w of out) {
    if (comp.has(w)) continue;
    const stack = [w]; comp.set(w, n);
    while (stack.length) { const u = stack.pop(); for (const v of out) if (!comp.has(v) && (near(u.a, v) || near(u.b, v) || near(v.a, u) || near(v.b, u))) { comp.set(v, n); stack.push(v); } }
    n++;
  }
  const total = new Array(n).fill(0); for (const w of out) total[comp.get(w)] += fr(w).L;
  const biggest = Math.max(0, ...total);
  return out.filter(w => total[comp.get(w)] >= Math.max(4, biggest * 0.08));
}
