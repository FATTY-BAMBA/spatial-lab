// Plan geometry used by the editor: room detection from walls (planar faces),
// exterior wall marking, label/spot placement and the auto-generated 3D story.
import { polygonArea, polygonCentroid, pointInPolygon, bbox, wallFrame, stairBox } from '../plan.js';

const EPS = 0.004;
const key = (x, z) => `${Math.round(x / EPS)}|${Math.round(z / EPS)}`;

function segIntersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const qp = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return [t, u];
}
function projT(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2;
  const q = [a[0] + dx * t, a[1] + dz * t];
  return { t, d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
}

// Build a planar graph from wall centrelines (split at crossings and T-junctions)
export function wallGraph(walls) {
  const ok = p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const segs = walls.filter(w => w.kind !== 'ignore' && ok(w.a) && ok(w.b) && Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > EPS).map(w => ({ a: w.a, b: w.b, ts: [0, 1] }));
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j];
    const hit = segIntersect(A.a, A.b, B.a, B.b);
    if (hit) { A.ts.push(hit[0]); B.ts.push(hit[1]); continue; }
    for (const [S, T] of [[A, B], [B, A]]) for (const p of [T.a, T.b]) {
      const pr = projT(p, S.a, S.b);
      if (pr.d < 0.03 && pr.t > 0.001 && pr.t < 0.999) S.ts.push(pr.t);
    }
  }
  const verts = new Map(), adj = new Map();
  // match vertices by distance, not by grid cell: a 4 mm grid splits points that straddle a cell edge
  // (7.05 / 0.004 = 1762.5), which left T-junctions unconnected
  const vid = p => {
    const cx = Math.round(p[0] / EPS), cz = Math.round(p[1] / EPS);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const k = `${cx + dx}|${cz + dz}`, q = verts.get(k);
      if (q && Math.hypot(q[0] - p[0], q[1] - p[1]) <= EPS * 1.5) return k;
    }
    const k = `${cx}|${cz}`; verts.set(k, p); adj.set(k, new Set()); return k;
  };
  for (const S of segs) {
    const ts = [...new Set(S.ts.map(t => Math.min(1, Math.max(0, t)).toFixed(9)))].map(Number).sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) {
      const p = [S.a[0] + (S.b[0] - S.a[0]) * ts[k], S.a[1] + (S.b[1] - S.a[1]) * ts[k]];
      const q = [S.a[0] + (S.b[0] - S.a[0]) * ts[k + 1], S.a[1] + (S.b[1] - S.a[1]) * ts[k + 1]];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < EPS * 2) continue;
      const u = vid(p), v = vid(q);
      if (u === v) continue;
      adj.get(u).add(v); adj.get(v).add(u);
    }
  }
  return { verts, adj };
}

// Minimal cycles (faces) of the planar graph. Returns { rooms: [poly], outer: poly|null }
export function findFaces(walls) {
  const { verts, adj } = wallGraph(walls);
  // prune dangling edges
  let changed = true;
  while (changed) {
    changed = false;
    for (const [k, n] of adj) if (n.size === 1) { const o = [...n][0]; adj.get(o).delete(k); n.clear(); changed = true; }
  }
  const ang = (u, v) => { const a = verts.get(u), b = verts.get(v); return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  const sorted = new Map();
  for (const [k, n] of adj) sorted.set(k, [...n].sort((x, y) => ang(k, x) - ang(k, y)));
  const used = new Set(), faces = [];
  for (const [u, ns] of sorted) for (const v of ns) {
    if (used.has(u + '>' + v)) continue;
    const poly = []; let a = u, b = v, guard = 0;
    while (!used.has(a + '>' + b) && guard++ < 2000) {
      used.add(a + '>' + b);
      poly.push(verts.get(a));
      const list = sorted.get(b); if (!list || !list.length) break;
      const i = list.indexOf(a);
      const c = list[(i - 1 + list.length) % list.length];
      a = b; b = c;
    }
    if (poly.length >= 3) faces.push(simplify(poly));
  }
  const withArea = faces.map(p => ({ p, s: signedArea(p) })).filter(f => Math.abs(f.s) > 0.25);
  if (!withArea.length) return { rooms: [], outer: null };
  // outer boundaries have the opposite orientation to rooms; the largest one is the footprint
  const roomsSign = Math.sign(withArea.reduce((m, f) => (Math.abs(f.s) > Math.abs(m.s) ? f : m)).s) * -1;
  const rooms = withArea.filter(f => Math.sign(f.s) === roomsSign).map(f => f.p);
  const outers = withArea.filter(f => Math.sign(f.s) !== roomsSign).sort((x, y) => Math.abs(y.s) - Math.abs(x.s));
  return { rooms, outer: outers[0] ? outers[0].p.slice().reverse() : null };
}

export function signedArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; s += x1 * z2 - x2 * z1; } return s / 2; }

function simplify(p) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-6) out.push([+b[0].toFixed(3), +b[1].toFixed(3)]);
  }
  return out;
}

// Re-detect rooms, inheriting names/finishes from previous rooms that overlap.
const DEFAULT_NAMES = [['客廳', 'Living'], ['臥室', 'Bedroom'], ['房間', 'Room']];
export function detectRooms(level) {
  const { rooms: faces, outer } = findFaces(level.walls);
  // gaps between back-to-back walls and pipe chases are not rooms: drop faces under ~30 cm effective width (2·area / perimeter)
  const perim = q => q.reduce((s, p, i) => { const n = q[(i + 1) % q.length]; return s + Math.hypot(n[0] - p[0], n[1] - p[1]); }, 0);
  const polys = faces.filter(q => { const A = polygonArea(q); return A >= 0.25 && 2 * A / perim(q) >= 0.26; });
  // spaces whose walls don't fully close (a living room open to the carport, an archway, a missing wall end) are rooms too
  for (const q of openAreas(level.walls, polys)) polys.push(q);
  const prev = level.rooms || [];
  const used = new Set();
  const rooms = polys.map((poly, i) => {
    const c = labelPoint(poly);
    const old = prev.find(r => !used.has(r.id) && pointInPolygon(c, r.polygon)) || prev.find(r => !used.has(r.id) && r.labelAt && pointInPolygon(r.labelAt, poly));
    if (old) used.add(old.id);
    const area = polygonArea(poly);
    const biggest = polys.every(q => polygonArea(q) <= area + 1e-6);
    const base = old || { id: `r${String(level.id || '').replace(/\W/g, '')}${Date.now().toString(36)}${i}`, name: biggest && area > 15 ? '客廳' : area > 7 ? '臥室' : '房間', nameEn: biggest && area > 15 ? 'Living' : area > 7 ? 'Bedroom' : 'Room', finish: 'floor' };
    return { ...base, polygon: poly, labelAt: old && old.labelPinned ? old.labelAt : c };
  });
  // new rooms: one 客廳 at most, the rest numbered (臥室 1, 臥室 2… / 房間 1…)
  const isNew = r => !prev.some(p => p.id === r.id);
  const taken = new Set(rooms.filter(r => !isNew(r)).map(r => r.name));
  for (const r of rooms) {
    if (!isNew(r)) continue;
    if (r.name === '客廳' && !taken.has('客廳')) { taken.add('客廳'); continue; }
    if (r.name === '客廳') { r.name = '臥室'; r.nameEn = 'Bedroom'; }
    let n = 1; while (taken.has(`${r.name} ${n}`)) n++;
    r.name = `${r.name} ${n}`; taken.add(r.name);
    if (r.nameEn) r.nameEn = `${r.nameEn} ${n}`;
  }
  level.rooms = rooms;
  // walls on the outer boundary are exterior
  if (outer) for (const w of level.walls) {
    if (w.lockExt) continue;
    const { ux, uz, len } = wallFrame(w);
    const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], n = [-uz, ux];
    const p1 = [m[0] + n[0] * 0.15, m[1] + n[1] * 0.15], p2 = [m[0] - n[0] * 0.15, m[1] - n[1] * 0.15];
    const ext = len > 0.05 && pointInPolygon(p1, outer) !== pointInPolygon(p2, outer);
    w.ext = ext;
    if (!w.tLocked) w.t = ext ? 0.2 : 0.12;
  }
  level.outline = outer;
  return level;
}

// ---------------------------------------------------------------- open areas
// Grid over the floor; walls thickened by R seal gaps up to 2R; whatever the outside can't reach through that and no
// closed room covers is an open area — grown back to the real wall faces and traced into a polygon.
const openCache = new Map();
export function openAreas(walls, roomPolys, R = 1.3) {
  // edits re-detect rooms on every floor: only redo the grid when this floor's walls or closed rooms changed
  const key = R + '|' + (walls || []).map(w => `${w.a[0]},${w.a[1]},${w.b[0]},${w.b[1]},${w.t || 0},${w.kind || ''}`).join(';') + '|' + roomPolys.map(P => P.length + ':' + P[0]).join(';');
  if (openCache.has(key)) return openCache.get(key).map(P => P.map(p => p.slice()));
  const res = openAreasRaw(walls, roomPolys, R);
  openCache.set(key, res); if (openCache.size > 24) openCache.delete(openCache.keys().next().value);
  return res.map(P => P.map(p => p.slice()));
}
function openAreasRaw(walls, roomPolys, R) {
  const real = (walls || []).filter(w => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 0.05);
  if (real.length < 3) return [];
  // the building's extent closes spaces left fully open on one side (an undetected glass front): virtual walls on the
  // bounding box; a pocket only counts when real walls make most of its edge
  const rx = real.flatMap(w => [w.a[0], w.b[0]]), rz = real.flatMap(w => [w.a[1], w.b[1]]);
  const bx0 = Math.min(...rx), bx1 = Math.max(...rx), bz0 = Math.min(...rz), bz1 = Math.max(...rz);
  const frame = [[[bx0, bz0], [bx1, bz0]], [[bx1, bz0], [bx1, bz1]], [[bx1, bz1], [bx0, bz1]], [[bx0, bz1], [bx0, bz0]]].map(([a, b]) => ({ a, b, kind: 'zone', virtual: true }));
  const ws = real.concat(frame);
  const xs = ws.flatMap(w => [w.a[0], w.b[0]]), zs = ws.flatMap(w => [w.a[1], w.b[1]]);
  const x0 = Math.min(...xs) - R - 0.6, z0 = Math.min(...zs) - R - 0.6, x1 = Math.max(...xs) + R + 0.6, z1 = Math.max(...zs) + R + 0.6;
  const cs = Math.max(0.1, Math.sqrt(((x1 - x0) * (z1 - z0)) / 250000)), nx = Math.ceil((x1 - x0) / cs), nz = Math.ceil((z1 - z0) / cs), N = nx * nz;
  const idx = (i, j) => j * nx + i, cx = i => x0 + (i + 0.5) * cs, cz = j => z0 + (j + 0.5) * cs;
  // walls
  const wall = new Uint8Array(N); // 1 real wall, 2 virtual frame
  for (const w of ws) {
    const half = (w.kind === 'zone' ? 0.04 : (w.t || 0.12) / 2) + cs * 0.5;
    const i0 = Math.max(0, Math.floor((Math.min(w.a[0], w.b[0]) - half - x0) / cs)), i1 = Math.min(nx - 1, Math.ceil((Math.max(w.a[0], w.b[0]) + half - x0) / cs));
    const j0 = Math.max(0, Math.floor((Math.min(w.a[1], w.b[1]) - half - z0) / cs)), j1 = Math.min(nz - 1, Math.ceil((Math.max(w.a[1], w.b[1]) + half - z0) / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (projClamp([cx(i), cz(j)], w.a, w.b) <= half && wall[idx(i, j)] !== 1) wall[idx(i, j)] = w.virtual ? 2 : 1;
  }
  // distance to the nearest wall (chamfer 3-4), in cells
  const D = new Float32Array(N).fill(1e9);
  for (let k = 0; k < N; k++) if (wall[k]) D[k] = 0;
  const relax = (k, k2, c) => { if (D[k2] + c < D[k]) D[k] = D[k2] + c; };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = idx(i, j); if (i > 0) relax(k, k - 1, 1); if (j > 0) { relax(k, k - nx, 1); if (i > 0) relax(k, k - nx - 1, 1.414); if (i < nx - 1) relax(k, k - nx + 1, 1.414); } }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = idx(i, j); if (i < nx - 1) relax(k, k + 1, 1); if (j < nz - 1) { relax(k, k + nx, 1); if (i < nx - 1) relax(k, k + nx + 1, 1.414); if (i > 0) relax(k, k + nx - 1, 1.414); } }
  const Rc = R / cs;
  // outside: flood from the border through cells farther than R from any wall
  const out = new Uint8Array(N), q = new Int32Array(N); let h = 0, t = 0;
  const push = k => { if (!out[k] && D[k] > Rc) { out[k] = 1; q[t++] = k; } };
  for (let i = 0; i < nx; i++) { push(idx(i, 0)); push(idx(i, nz - 1)); }
  for (let j = 0; j < nz; j++) { push(idx(0, j)); push(idx(nx - 1, j)); }
  while (h < t) { const k = q[h++], i = k % nx, j = (k / nx) | 0; if (i > 0) push(k - 1); if (i < nx - 1) push(k + 1); if (j > 0) push(k - nx); if (j < nz - 1) push(k + nx); }
  // cells already in a closed room
  const inRoom = new Uint8Array(N);
  for (const P of roomPolys) {
    const b = bbox(P), i0 = Math.max(0, Math.floor((b.x0 - x0) / cs)), i1 = Math.min(nx - 1, Math.ceil((b.x1 - x0) / cs)), j0 = Math.max(0, Math.floor((b.z0 - z0) / cs)), j1 = Math.min(nz - 1, Math.ceil((b.z1 - z0) / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pointInPolygon([cx(i), cz(j)], P)) inRoom[idx(i, j)] = 1;
  }
  // pockets: connected cores (cells farther than R from every wall, not outside, not in a room) …
  const lab = new Int32Array(N); let id = 0; h = 0; t = 0;
  const isCore = k => !wall[k] && !inRoom[k] && !out[k] && D[k] > Rc;
  const nb = (k, f) => { const i = k % nx, j = (k / nx) | 0; if (i > 0) f(k - 1); if (i < nx - 1) f(k + 1); if (j > 0) f(k - nx); if (j < nz - 1) f(k + nx); };
  for (let s0 = 0; s0 < N; s0++) {
    if (lab[s0] || !isCore(s0)) continue;
    id++; let hh = 0, tt = 0; const qq = [s0]; lab[s0] = id;
    while (hh < qq.length) nb(qq[hh++], k2 => { if (!lab[k2] && isCore(k2)) { lab[k2] = id; qq.push(k2); } });
  }
  if (!id) return [];
  // … then every free cell joins its nearest pocket (all pockets grow together), out to the wall faces
  const depth = new Float32Array(N);
  for (let k = 0; k < N; k++) if (lab[k]) q[t++] = k;
  const limit = 2 * Rc + 3;
  while (h < t) {
    const k = q[h++];
    nb(k, k2 => { if (lab[k2] || wall[k2] || inRoom[k2] || out[k2] || depth[k] + 1 > limit) return; lab[k2] = lab[k]; depth[k2] = depth[k] + 1; q[t++] = k2; });
  }
  // per pocket: size, core size, and how much of its edge is real wall (not the virtual frame, not open space)
  const st = Array.from({ length: id + 1 }, () => ({ n: 0, core: 0, edge: 0, real: 0 }));
  for (let k = 0; k < N; k++) {
    const L = lab[k]; if (!L) continue;
    const S = st[L]; S.n++; if (D[k] > Rc) S.core++;
    nb(k, k2 => { if (lab[k2] === L || inRoom[k2]) return; S.edge++; if (wall[k2] === 1) S.real++; });
  }
  const res = [];
  for (let L = 1; L <= id; L++) {
    const S = st[L];
    if (S.n * cs * cs < 4 || S.core * cs * cs < 0.6 || S.real < 0.6 * S.edge) continue;
    // trim slivers that slipped out through gaps in a facade (opening: erode then grow back, 50 cm; a cut-off blob is dropped by the tracer, which keeps the main outline)
    const r = Math.max(1, Math.round(0.5 / cs)), M = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (lab[k] === L) M[k] = 1;
    const E = boxFilter(M, nx, nz, r, true), O = boxFilter(E, nx, nz, r, false);
    for (let k = 0; k < N; k++) if (lab[k] === L && !O[k]) lab[k] = 0;
    const poly = traceCells(lab, L, nx, nz, x0, z0, cs);
    if (poly && poly.length >= 4 && polygonArea(poly) >= 4) res.push(poly);
  }
  return res;
}
// square min (erode) / max (dilate) filter of a 0/1 grid, radius r cells, via running sums along rows then columns
function boxFilter(M, nx, nz, r, erode) {
  const tmp = new Uint16Array(nx * nz), outM = new Uint8Array(nx * nz), w = 2 * r + 1;
  for (let j = 0; j < nz; j++) { let sum = 0; const o = j * nx; for (let i = -r; i < nx; i++) { const add = i + r < nx ? M[o + i + r] : 0, sub = i - r - 1 >= 0 ? M[o + i - r - 1] : 0; sum += add - sub; if (i >= 0) tmp[o + i] = sum; } }
  for (let i = 0; i < nx; i++) { let sum = 0; for (let j = -r; j < nz; j++) { const add = j + r < nz ? tmp[(j + r) * nx + i] : 0, sub = j - r - 1 >= 0 ? tmp[(j - r - 1) * nx + i] : 0; sum += add - sub; if (j >= 0) outM[j * nx + i] = erode ? (sum >= w * w ? 1 : 0) : (sum > 0 ? 1 : 0); } }
  return outM;
}
// outline of the cells labelled id: walk the grid edges between inside and outside cells, keep the longest loop, simplify
function traceCells(lab, id, nx, nz, x0, z0, cs) {
  const at = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && lab[j * nx + i] === id;
  const next = new Map(); const key = (i, j) => i * 100003 + j;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!at(i, j)) continue;
    // directed boundary edges, inside on the left (counter-clockwise around the cell set)
    if (!at(i, j - 1)) next.set(key(i + 1, j), [i, j]);       // top edge: (i+1,j) → (i,j)
    if (!at(i - 1, j)) next.set(key(i, j), [i, j + 1]);       // left edge: (i,j) → (i,j+1)
    if (!at(i, j + 1)) next.set(key(i, j + 1), [i + 1, j + 1]); // bottom edge
    if (!at(i + 1, j)) next.set(key(i + 1, j + 1), [i + 1, j]); // right edge
  }
  let best = null;
  const seen = new Set();
  for (const [k0] of next) {
    if (seen.has(k0)) continue;
    const loop = []; let k = k0, guard = 0;
    while (!seen.has(k) && next.has(k) && guard++ < 200000) { seen.add(k); const p = next.get(k); loop.push(p); k = key(p[0], p[1]); }
    if (!best || loop.length > best.length) best = loop;
  }
  if (!best || best.length < 4) return null;
  const pts = best.map(([i, j]) => [x0 + i * cs, z0 + j * cs]);
  const simp = dp(pts.concat([pts[0]]), Math.max(0.12, cs * 1.2)).slice(0, -1);
  return simp.map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]);
}
function dp(pts, eps) { // Douglas–Peucker
  if (pts.length < 3) return pts;
  let k = -1, m = 0; const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = projClamp(pts[i], a, b); if (d > m) { m = d; k = i; } }
  if (m <= eps) return [a, b];
  return dp(pts.slice(0, k + 1), eps).slice(0, -1).concat(dp(pts.slice(k), eps));
}

// Point well inside a polygon (grid search for the largest clearance)
export function labelPoint(poly) {
  const b = bbox(poly);
  let best = polygonCentroid(poly), bestD = pointInPolygon(best, poly) ? edgeDist(best, poly) : -1;
  const step = Math.max(0.15, Math.min(b.x1 - b.x0, b.z1 - b.z0) / 12);
  for (let x = b.x0 + step / 2; x < b.x1; x += step) for (let z = b.z0 + step / 2; z < b.z1; z += step) {
    const p = [x, z];
    if (!pointInPolygon(p, poly)) continue;
    const d = edgeDist(p, poly);
    if (d > bestD + 0.05) { best = p; bestD = d; }
  }
  return [+best[0].toFixed(2), +best[1].toFixed(2)];
}
function edgeDist(p, poly) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, projClamp(p, poly[i], poly[(i + 1) % poly.length]));
  return m;
}
function projClamp(p, a, b) { const pr = projT(p, a, b); const t = Math.min(1, Math.max(0, pr.t)); return Math.hypot(p[0] - (a[0] + (b[0] - a[0]) * t), p[1] - (a[1] + (b[1] - a[1]) * t)); }

// ---------------------------------------------------------------- doors & story
export function doorLinks(level) {
  const links = [];
  for (const w of level.walls) {
    const { ux, uz } = wallFrame(w);
    const n = [-uz, ux];
    for (const o of w.openings || []) {
      if (o.type === 'window') continue;
      const s = o.offset + o.width / 2;
      const m = [w.a[0] + ux * s, w.a[1] + uz * s];
      const pa = [m[0] + n[0] * 0.35, m[1] + n[1] * 0.35], pb = [m[0] - n[0] * 0.35, m[1] - n[1] * 0.35];
      const ra = level.rooms.find(r => pointInPolygon(pa, r.polygon)), rb = level.rooms.find(r => pointInPolygon(pb, r.polygon));
      links.push({ m, n, a: ra ? ra.id : null, b: rb ? rb.id : null, main: !!o.main, type: o.type });
    }
  }
  return links;
}

// Fill in everything the 3D app needs from a hand-drawn plan.
export function completePlan(plan, base) {
  const p = JSON.parse(JSON.stringify(plan));
  p.schema = 'primestride.spatial/plan@0.2';
  p.stairs = p.stairs || [];
  for (const L of p.levels) {
    detectRooms(L);
    L.furniture = L.furniture || [];
    L.railings = L.railings || [];
    // walls marked as railings become glass balustrades
    const keep = [];
    for (const w of L.walls) { if (w.kind === 'railing') L.railings.push({ a: w.a, b: w.b, h: 1.1 }); else if (w.kind !== 'zone') keep.push(w); }
    L.walls = keep;
    L.walls.forEach((w, i) => { w.id = w.id || `w${i}`; w.openings = w.openings || []; });
  }
  const L0 = p.levels[0];
  const outline = L0.outline || (() => { const b = bbox(L0.walls.flatMap(w => [w.a, w.b])); return [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]; })();
  const fb = bbox(outline);
  p.project = { ...base.project, ...p.project };
  // always carry both names; never inherit the sample's English name (plans saved before nameEn existed)
  if (!plan.project || !plan.project.nameEn) p.project.nameEn = plan.project && plan.project.name && !/[\u3400-\u9fff]/.test(plan.project.name) ? plan.project.name : 'Custom project';
  for (const L of p.levels) if (!L.nameEn) L.nameEn = L.id;
  p.project.footprint = [[fb.x0, fb.z0], [fb.x1, fb.z0], [fb.x1, fb.z1], [fb.x0, fb.z1]];
  if (p.project.type === 'apartment') {
    p.project.site = { floor: p.project.floor || 9, floorHeight: 3.0, towerBox: [fb.x0 - 0.6, fb.z0 - 3.6, fb.x1 + 0.6, fb.z1 + 1.8], city: true };
  } else delete p.project.site;
  p.project.hour = p.project.hour ?? 15.25;
  if (!p.finishes) p.finishes = JSON.parse(JSON.stringify(base.finishes));
  if (!p.defaultFinishes) p.defaultFinishes = { ...base.defaultFinishes };
  let interior = 0;
  for (const L of p.levels) for (const r of L.rooms) if (!r.outdoor) interior += polygonArea(r.polygon);
  const nRooms = p.levels.reduce((n, L) => n + L.rooms.filter(r => !r.outdoor && !r.circulation).length, 0);
  p.project.stats = [
    { label: '樓層 Levels', labelEn: 'Levels', value: p.levels.map(L => L.id).join(' / '), valueEn: p.levels.map(L => L.id).join(' / ') },
    { label: '房間 Rooms', labelEn: 'Rooms', value: `${nRooms} 間`, valueEn: `${nRooms}` },
  ];
  // room ids must be unique across floors (older imports made several floors in the same millisecond)
  const seenIds = new Set();
  for (const L of p.levels) for (const r of L.rooms) { if (seenIds.has(r.id)) r.id = `${r.id}-${L.id}`; seenIds.add(r.id); }
  for (const L of p.levels) {
    const links = doorLinks(L);
    for (const r of L.rooms) {
      r.labelAt = r.labelAt || labelPoint(r.polygon);
      if (!r.spotPinned) r.spot = roomSpot(r, links, blockersFor(p, L));
    }
  }
  for (const f of p.finishes) f.focus = f.focus && roomExists(p, f.focus) ? f.focus : biggestRoom(p.levels[0], f.id === 'counter' || f.id === 'cabinet' ? /廚|kitchen/i : null);
  p.story = buildStory(p);
  return p;
}
const roomExists = (p, id) => p.levels.some(L => L.rooms.some(r => r.id === id));
function biggestRoom(L, re) {
  const rooms = L.rooms.filter(r => !r.outdoor);
  const named = re ? rooms.find(r => re.test(r.name + ' ' + (r.nameEn || ''))) : null;
  return (named || rooms.sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0] || {}).id;
}

// things a standing camera must not be inside: stair runs (from or to this floor), stairwell openings, furniture
function blockersFor(p, L) {
  const boxes = [];
  for (const st of p.stairs || []) if (st.from === L.id || st.to === L.id) { const b = stairBox(st); boxes.push({ ...b, pad: 0.45 }); }
  for (const v of L.voids || []) { const b = bbox(v.polygon); boxes.push({ ...b, pad: 0.35 }); }
  for (const f of L.furniture || []) {
    if (!(f.w > 0 && f.d > 0) || f.x == null) continue;
    const q = Math.abs(Math.round((f.rot || 0) / 90)) % 2 === 1, hw = (q ? f.d : f.w) / 2, hd = (q ? f.w : f.d) / 2;
    boxes.push({ x0: f.x - hw, x1: f.x + hw, z0: f.z - hd, z1: f.z + hd, pad: 0.25 });
  }
  return boxes;
}
const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
// where a visitor stands on arriving in a room: a free spot (clear of walls, stairs and furniture) near the door,
// looking across the longest open line of the room — also the natural angle for a render
function roomSpot(r, links, blockers = []) {
  const c = labelPoint(r.polygon), poly = r.polygon;
  const edgeDist = q => { let m = Infinity; for (let i = 0; i < poly.length; i++) m = Math.min(m, segDist(q, poly[i], poly[(i + 1) % poly.length])); return m; };
  const free = q => pointInPolygon(q, poly) && edgeDist(q) >= 0.4 && !blockers.some(b => q[0] > b.x0 - b.pad && q[0] < b.x1 + b.pad && q[1] > b.z0 - b.pad && q[1] < b.z1 + b.pad);
  const door = links.find(l => l.a === r.id || l.b === r.id);
  const dir = door ? (door.a === r.id ? 1 : -1) : 0;
  const atDoor = door ? [door.m[0] + door.n[0] * dir * 0.7, door.m[1] + door.n[1] * dir * 0.7] : null;
  // free sample points across the room
  const b = bbox(poly), step = Math.max(0.3, Math.min(0.6, Math.sqrt(polygonArea(poly)) / 12)), pts = [];
  for (let x = b.x0 + step / 2; x < b.x1; x += step) for (let z = b.z0 + step / 2; z < b.z1; z += step) if (free([x, z])) pts.push([x, z]);
  let pos, look;
  if (atDoor && free(atDoor) && pts.length) { // classic: just inside the door, looking at the far end
    pos = atDoor; look = pts.reduce((a, q) => (Math.hypot(q[0] - pos[0], q[1] - pos[1]) > Math.hypot(a[0] - pos[0], a[1] - pos[1]) ? q : a), pts[0]);
  } else if (pts.length > 1) { // the two free points farthest apart; stand at the one nearer the door
    let best = [pts[0], pts[0]], bd = -1;
    const S = pts.length > 400 ? pts.filter((_, i) => i % Math.ceil(pts.length / 400) === 0) : pts;
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) { const d = Math.hypot(S[i][0] - S[j][0], S[i][1] - S[j][1]); if (d > bd) { bd = d; best = [S[i], S[j]]; } }
    const ref = atDoor || c;
    [pos, look] = Math.hypot(best[0][0] - ref[0], best[0][1] - ref[1]) <= Math.hypot(best[1][0] - ref[0], best[1][1] - ref[1]) ? best : [best[1], best[0]];
  } else { // tiny or fully furnished room: the old rule
    pos = atDoor && pointInPolygon(atDoor, poly) ? atDoor : c;
    look = [c[0] + (c[0] - pos[0]) * 0.8, c[1] + (c[1] - pos[1]) * 0.8];
  }
  if (Math.hypot(look[0] - pos[0], look[1] - pos[1]) < 1) look = door ? [pos[0] + door.n[0] * dir * 3, pos[1] + door.n[1] * dir * 3] : [b.x1, b.z1];
  return { pos: pos.map(v => +v.toFixed(2)), look: look.map(v => +v.toFixed(2)) };
}

function buildStory(p) {
  const L = p.levels[0];
  const fb = bbox(p.project.footprint);
  const cx = (fb.x0 + fb.x1) / 2, cz = (fb.z0 + fb.z1) / 2, size = Math.max(fb.x1 - fb.x0, fb.z1 - fb.z0);
  const topH = p.levels.reduce((h, l) => Math.max(h, l.elevation + l.height), 0);
  const nodes = [
    { id: 'plan', pos: [cx, 60, cz + 0.6], look: [cx, 0, cz], fov: 13, hold: 1.1 },
    { id: 'aerial', pos: [cx + size * 1.5, topH + size * 1.45, cz + size * 1.75], look: [cx, 0.2, cz], fov: 34, travel: 1.7, hold: 1.5 },
  ];
  const links = doorLinks(L);
  const main = links.find(l => l.main) || links.find(l => !l.a || !l.b);
  const rooms = L.rooms.filter(r => !r.outdoor);
  const roomById = Object.fromEntries(L.rooms.map(r => [r.id, r]));
  let current = null;
  const at = (q, y = 1.6) => [+q[0].toFixed(2), y, +q[1].toFixed(2)];
  if (main) {
    const dir = main.a ? 1 : -1; // inside direction
    const out = [main.m[0] - main.n[0] * dir * 3, main.m[1] - main.n[1] * dir * 3];
    const inn = [main.m[0] + main.n[0] * dir * 0.8, main.m[1] + main.n[1] * dir * 0.8];
    nodes.push({ pos: at(out, 1.65), look: at(inn, 1.5), fov: 58, travel: 1.0 });
    current = main.a || main.b;
  }
  // visit the biggest rooms in door-graph order (BFS from the entrance)
  const targets = rooms.filter(r => !r.circulation).sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon)).slice(0, 4).map(r => r.id);
  if (!current) current = targets[0];
  const order = [];
  const graph = new Map();
  for (const l of links) if (l.a && l.b) { (graph.get(l.a) || graph.set(l.a, []).get(l.a)).push(l); (graph.get(l.b) || graph.set(l.b, []).get(l.b)).push(l); }
  const pathTo = (from, to) => {
    const prev = new Map([[from, null]]), q = [from];
    while (q.length) { const u = q.shift(); if (u === to) break; for (const l of graph.get(u) || []) { const v = l.a === u ? l.b : l.a; if (!prev.has(v)) { prev.set(v, { u, l }); q.push(v); } } }
    if (!prev.has(to)) return null;
    const steps = []; let v = to;
    while (prev.get(v)) { const { u, l } = prev.get(v); steps.unshift({ from: u, to: v, l }); v = u; }
    return steps;
  };
  const remaining = [current, ...targets.filter(t => t !== current)];
  let first = true;
  for (const id of remaining) {
    if (!roomById[id]) continue;
    if (!first) {
      const steps = pathTo(current, id) || [];
      for (const s of steps) {
        const dir = s.l.a === s.from ? -1 : 1; // normal points toward room a
        const before = [s.l.m[0] - s.l.n[0] * dir * 0.6, s.l.m[1] - s.l.n[1] * dir * 0.6];
        const after = [s.l.m[0] + s.l.n[0] * dir * 0.6, s.l.m[1] + s.l.n[1] * dir * 0.6];
        nodes.push({ pos: at(before), look: at(after, 1.5), travel: 0.45 });
        nodes.push({ pos: at(after), look: at([after[0] + s.l.n[0] * dir * 2, after[1] + s.l.n[1] * dir * 2], 1.4), travel: 0.35 });
      }
    }
    const r = roomById[id];
    nodes.push({ id: `room-${id}`, room: id, level: L.id, pos: at(r.spot.pos), look: at(r.spot.look, 1.15), fov: 64, travel: first ? 0.6 : 0.7, hold: 0.85 });
    current = id; first = false;
    order.push(id);
  }
  nodes.push({ id: 'outro', pos: [cx + size * 1.4, topH + size * 0.75, cz + size * 1.3], look: [cx, topH * 0.4, cz], fov: 36, travel: 1.6, hold: 1.4 });
  const rise = {};
  for (const l of p.levels) rise[l.id] = ['plan', 'aerial'];
  return {
    nodes, rise, real: 'aerial', explode: p.levels.length > 1 ? 'outro' : undefined,
    captions: {
      rise: ['牆體從圖面直接長出來', '你剛畫的平面圖，牆厚、門窗、房間，直接長成 3D 空間。', 'Your drawing, raised into space.'],
      real: ['套上材質、光線與家具', '每一項材質和家具都是清單上的一行，換材質，總價跟著更新。', 'Finishes, light and furniture — each one is a line on the quote.'],
      outro: ['一份資料，從圖面到報價', '回到編輯器修改，3D 與報價會一起更新。', 'Edit the plan; the 3D and the quote follow.'],
    },
  };
}
