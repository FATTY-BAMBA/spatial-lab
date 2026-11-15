// Auto-furnish: puts a sensible first layout into every room, so an imported plan isn't an empty shell.
// Rule-based, deterministic and fast: each room gets a recipe by type (bedroom, living, dining, kitchen, bath…);
// every piece is placed back-to-wall on a 5 cm occupancy grid, keeping door swings, openings and the clearance
// in front of each piece free, and keeping tall pieces out of windows.
// Item orientation follows the plan format: an item's back faces (−sin r, −cos r), so rot 0 sits against a wall on its −z side.
import { pointInPolygon, polygonArea, wallFrame, stairBox } from '../plan.js';
import { dressLevel } from './dress.js';

const G = 0.05; // grid (m)
const FREE = 0, HARD = 1, SOFT = 2, KEEP = 3; // SOFT = someone's clearance, KEEP = door swing / opening (no furniture)
const TALL = new Set(['wardrobe', 'shelf', 'tallcab', 'fridge', 'tvwall']);

export function roomType(r) {
  const n = `${r.name || ''} ${r.nameEn || ''}`, area = polygonArea(r.polygon || []);
  if (r.outdoor || /陽台|露台|balcony|terrace/i.test(n)) return /後陽台|service/i.test(n) ? 'service' : 'balcony';
  if (/梯|stair|\bup\b|\bdn\b|走道|走廊|廊下|hall(way)?\b|corridor|儲|倉|storage|更衣|closet|wic|機房|車庫|garage|管道|shaft|電梯|lift|elevator/i.test(n)) return 'none';
  if (/客餐廳|living\s*&\s*dining/i.test(n)) return 'livingdining';
  if (/餐廚|廚餐|kitchen\s*&\s*dining|ldk/i.test(n)) return 'kitchendining';
  if (/客廳|起居|リビング|living|lounge/i.test(n)) return 'living';
  if (/餐廳|dining/i.test(n)) return 'dining';
  if (/廚房|キッチン|kitchen/i.test(n)) return 'kitchen';
  if (/主臥|master bed/i.test(n)) return 'master';
  if (/浴|廁|衛|洗面|トイレ|bath|wc|toilet|powder|shower/i.test(n)) return 'bath';
  if (/書房|study|office/i.test(n)) return 'study';
  if (/玄關|玄|entr|foyer/i.test(n)) return 'entry';
  if (/和室|tatami/i.test(n)) return 'tatami';
  if (/臥|卧|洋室|bed/i.test(n)) return 'bedroom';
  // unnamed rooms (房間 3 / Room 3): big enough for a bed → bedroom, otherwise leave empty for the user
  if (/^(房間|room)\s*\d*$/i.test((r.name || '').trim()) || !r.name) return area >= 7 ? 'bedroom' : 'none';
  return 'none';
}

// --------------------------------------------------------------------------- room grid
function roomGrid(level, room) {
  const P = room.polygon, xs = P.map(p => p[0]), zs = P.map(p => p[1]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs), nx = Math.ceil((Math.max(...xs) - x0) / G), nz = Math.ceil((Math.max(...zs) - z0) / G);
  const g = new Uint8Array(nx * nz).fill(HARD);
  const cx = i => x0 + (i + 0.5) * G, cz = j => z0 + (j + 0.5) * G;
  const walls = level.walls.filter(w => w.kind !== 'zone');
  const segDist = (px, pz, w) => { const { ux, uz, len } = wallFrame(w); const t = Math.max(0, Math.min(len, (px - w.a[0]) * ux + (pz - w.a[1]) * uz)); return Math.hypot(px - (w.a[0] + ux * t), pz - (w.a[1] + uz * t)); };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const px = cx(i), pz = cz(j);
    if (!pointInPolygon([px, pz], P)) continue;
    if (walls.some(w => segDist(px, pz, w) < (w.t || 0.12) / 2 + 0.02)) continue;
    g[j * nx + i] = FREE;
  }
  // door swings and openings that touch this room
  const windows = [];
  for (const w of level.walls) for (const o of w.openings || []) {
    const { ux, uz } = wallFrame(w), a = [w.a[0] + ux * o.offset, w.a[1] + uz * o.offset], b = [a[0] + ux * o.width, a[1] + uz * o.width];
    const n = [-uz, ux];
    if (o.type === 'window') { windows.push({ a, b, w }); continue; }
    const depth = o.type === 'door' ? o.width + 0.1 : 0.9;
    for (const side of [-1, 1]) markRect(g, nx, nz, x0, z0, [a, b, [b[0] + n[0] * side * depth, b[1] + n[1] * side * depth], [a[0] + n[0] * side * depth, a[1] + n[1] * side * depth]], KEEP, true);
  }
  return { g, nx, nz, x0, z0, windows, walls, P };
}

function markRect(g, nx, nz, x0, z0, quad, val, onlyFree) {
  const xs = quad.map(p => p[0]), zs = quad.map(p => p[1]);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / G)), i1 = Math.min(nx - 1, Math.ceil((Math.max(...xs) - x0) / G) - 1);
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - z0) / G)), j1 = Math.min(nz - 1, Math.ceil((Math.max(...zs) - z0) / G) - 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * nx + i;
    if (onlyFree ? g[k] === FREE || g[k] === SOFT : g[k] !== HARD || val === HARD) g[k] = val;
  }
}

// axis-aligned box helpers on the grid
function boxCells(R, b) {
  return { i0: Math.round((b.x0 - R.x0) / G), i1: Math.round((b.x1 - R.x0) / G) - 1, j0: Math.round((b.z0 - R.z0) / G), j1: Math.round((b.z1 - R.z0) / G) - 1 };
}
function boxOK(R, b, allowed) {
  const c = boxCells(R, b);
  if (c.i0 < 0 || c.j0 < 0 || c.i1 >= R.nx || c.j1 >= R.nz || c.i1 < c.i0 || c.j1 < c.j0) return false;
  for (let j = c.j0; j <= c.j1; j++) for (let i = c.i0; i <= c.i1; i++) if (!allowed.has(R.g[j * R.nx + i])) return false;
  return true;
}
function boxMark(R, b, val) {
  const c = boxCells(R, b);
  for (let j = Math.max(0, c.j0); j <= Math.min(R.nz - 1, c.j1); j++) for (let i = Math.max(0, c.i0); i <= Math.min(R.nx - 1, c.i1); i++) {
    const k = j * R.nx + i; if (val === HARD || R.g[k] === FREE) R.g[k] = val;
  }
}
const ONLY_FREE = new Set([FREE]), CLEAR_OK = new Set([FREE, SOFT, KEEP]);

// --------------------------------------------------------------------------- wall-backed slots
// Every straight run of free cells along a wall face, in four directions. n = direction into the room.
function slots(R) {
  const out = [];
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const n of dirs) {
    // a cell is "against a wall" when the cell behind it (opposite n) is HARD and outside-or-wall
    const along = n[0] === 0 ? [1, 0] : [0, 1];
    const lines = new Map();
    for (let j = 0; j < R.nz; j++) for (let i = 0; i < R.nx; i++) {
      if (R.g[j * R.nx + i] === HARD) continue;
      const bi = i - n[0], bj = j - n[1];
      const behind = bi < 0 || bj < 0 || bi >= R.nx || bj >= R.nz ? HARD : R.g[bj * R.nx + bi];
      if (behind !== HARD) continue;
      const key = n[0] === 0 ? j : i, pos = n[0] === 0 ? i : j;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push(pos);
    }
    for (const [key, ps] of lines) {
      ps.sort((a, b) => a - b);
      let s = ps[0];
      for (let k = 1; k <= ps.length; k++) {
        if (k === ps.length || ps[k] !== ps[k - 1] + 1) {
          const e = ps[k - 1] + 1, len = (e - s) * G;
          if (len >= 0.4) {
            // face line in world coords: the wall-side edge of the cell row
            const face = n[0] === 0 ? R.z0 + (n[1] > 0 ? key : key + 1) * G : R.x0 + (n[0] > 0 ? key : key + 1) * G;
            const lo = (n[0] === 0 ? R.x0 : R.z0) + s * G, hi = lo + len;
            out.push({ n, along, face, lo, hi, len });
          }
          if (k < ps.length) s = ps[k];
        }
      }
    }
  }
  return out.sort((a, b) => b.len - a.len);
}

const rotFor = n => Math.round(Math.atan2(n[0], n[1]) * 180 / Math.PI); // back against the wall, front along n

// Box of an item of width w (along the wall) and depth d (into the room) at slot position u (centre along the wall)
function itemBox(S, u, w, d, gap = 0) {
  const f0 = S.face + (S.n[0] + S.n[1]) * gap, f1 = f0 + (S.n[0] + S.n[1]) * d;
  const a0 = u - w / 2, a1 = u + w / 2;
  return S.n[0] === 0 ? { x0: a0, x1: a1, z0: Math.min(f0, f1), z1: Math.max(f0, f1) } : { x0: Math.min(f0, f1), x1: Math.max(f0, f1), z0: a0, z1: a1 };
}
const center = (S, u, d, gap = 0) => { const off = S.face + (S.n[0] + S.n[1]) * (gap + d / 2); return S.n[0] === 0 ? [u, off] : [off, u]; };
const snap = v => Math.round(v / G) * G;

function windowOverlap(R, S, box) {
  return R.windows.some(win => {
    const xs = [win.a[0], win.b[0]], zs = [win.a[1], win.b[1]], pad = 0.05;
    const wx0 = Math.min(...xs) - pad, wx1 = Math.max(...xs) + pad, wz0 = Math.min(...zs) - pad, wz1 = Math.max(...zs) + pad;
    // the window must be on this face (within half a wall + the item depth) and overlap the item along the wall
    const near = S.n[0] === 0 ? Math.abs((wz0 + wz1) / 2 - S.face) < 0.35 && wx1 > box.x0 && wx0 < box.x1 : Math.abs((wx0 + wx1) / 2 - S.face) < 0.35 && wz1 > box.z0 && wz0 < box.z1;
    return near;
  });
}

// Try to place one piece. opts: clear (m in front), side (m each side kept soft), where: 'center'|'corner'|'any',
// tall (avoid windows), prefer(S) → score bonus, avoid: slots to skip. Returns the placement or null.
function place(R, spec, opts = {}) {
  const { w, d } = spec, clear = opts.clear ?? 0.6, side = opts.side ?? 0, tall = opts.tall ?? TALL.has(spec.kind);
  let best = null;
  for (const S of opts.slots || slots(R)) {
    if (S.len < w || (opts.skip && opts.skip(S))) continue;
    const us = [];
    for (let u = S.lo + w / 2; u <= S.hi - w / 2 + 1e-6; u += 0.1) us.push(snap(u));
    if (!us.length) continue;
    for (const u of us) {
      const box = itemBox(S, u, w, d);
      if (!boxOK(R, box, ONLY_FREE)) continue;
      if (tall && windowOverlap(R, S, box)) continue;
      const front = itemBox(S, u, w + side * 2, clear, d);
      if (clear > 0 && !boxOK(R, front, CLEAR_OK)) continue;
      const mid = (S.lo + S.hi) / 2, edge = Math.min(u - w / 2 - S.lo, S.hi - (u + w / 2));
      let score = 0;
      if (opts.where === 'center') score -= Math.abs(u - mid) * 2;
      if (opts.where === 'corner') score -= edge * 3;
      if (opts.prefer) score += opts.prefer(S, u, box);
      score += S.len * 0.05;
      if (!best || score > best.score) best = { S, u, box, front, score };
    }
  }
  if (!best) return null;
  boxMark(R, best.box, HARD);
  if (clear > 0) boxMark(R, best.front, SOFT);
  return best;
}

let uid = 0;
const item = (base, S, u, gap = 0, extra = {}) => {
  const [x, z] = center(S, u, base.d, gap);
  return { ...base, x: +x.toFixed(3), z: +z.toFixed(3), rot: rotFor(S.n), auto: true, ...extra, id: `af${(uid++).toString(36)}` };
};
const CAT = {
  bed6: { kind: 'bed', w: 1.8, d: 2.1, name: '雙人床', nameEn: 'Queen bed', price: 45000 },
  bed5: { kind: 'bed', w: 1.5, d: 2.0, name: '雙人床', nameEn: 'Double bed', price: 32000 },
  bed35: { kind: 'bed', w: 1.05, d: 1.95, name: '單人床', nameEn: 'Single bed', price: 18000 },
  night: { kind: 'nightstand', w: 0.45, d: 0.42, name: '床頭櫃', nameEn: 'Nightstand', price: 6500 },
  wardrobe: { kind: 'wardrobe', w: 1.8, d: 0.6, h: 2.4, name: '系統衣櫃', nameEn: 'Wardrobe', price: 48000 },
  desk: { kind: 'desk', w: 1.2, d: 0.6, name: '書桌', nameEn: 'Desk', price: 16000 },
  deskchair: { kind: 'chair', w: 0.48, d: 0.5, name: '書桌椅', nameEn: 'Desk chair', price: 6800 },
  shelf: { kind: 'shelf', w: 1.2, d: 0.34, h: 2.2, name: '書櫃', nameEn: 'Bookcase', price: 22000 },
  sofa: { kind: 'model', model: 'GlamVelvetSofa', w: 2.19, d: 1.02, name: '絲絨弧形沙發', nameEn: 'Velvet sofa', price: 72000 },
  coffee: { kind: 'roundtable', w: 0.9, d: 0.9, name: '大理石茶几', nameEn: 'Coffee table', price: 16000 },
  rug: { kind: 'rug', w: 2.4, d: 1.7, name: '地毯', nameEn: 'Rug', price: 9800 },
  tvwall: { kind: 'tvwall', w: 2.4, d: 0.08, name: '電視主牆', nameEn: 'TV wall', price: 45000 },
  tvconsole: { kind: 'tvconsole', w: 1.8, d: 0.42, noTv: true, name: '電視櫃', nameEn: 'TV console', price: 26000 },
  plant: { kind: 'model', model: 'DiffuseTransmissionPlant', w: 0.7, d: 0.66, scale: 1.3, name: '植栽', nameEn: 'Plant', price: 3200 },
  table: { kind: 'table', w: 1.6, d: 0.9, name: '餐桌', nameEn: 'Dining table', price: 38000 },
  chair: { kind: 'chair', w: 0.46, d: 0.5, name: '餐椅', nameEn: 'Dining chair', price: 6800 },
  counter: { kind: 'counter', w: 2.4, d: 0.6, counter: true, cabinet: true, sink: true, name: '廚具', nameEn: 'Kitchen run', price: 0 },
  upper: { kind: 'uppercab', w: 2.0, d: 0.35, cabinet: true, name: '吊櫃', nameEn: 'Upper cabinets', price: 0 },
  fridge: { kind: 'fridge', w: 0.75, d: 0.7, name: '冰箱', nameEn: 'Refrigerator', price: 52000 },
  toilet: { kind: 'toilet', w: 0.4, d: 0.65, name: '馬桶', nameEn: 'Toilet', price: 15000 },
  vanity: { kind: 'vanity', w: 0.8, d: 0.45, name: '浴櫃', nameEn: 'Vanity', price: 16000 },
  shower: { kind: 'shower', w: 1.0, d: 0.9, name: '淋浴拉門', nameEn: 'Shower screen', price: 14000 },
  entry: { kind: 'tallcab', w: 1.2, d: 0.4, h: 2.4, cabinet: true, name: '玄關櫃', nameEn: 'Entry cabinet', price: 42000 },
  washer: { kind: 'washer', w: 0.6, d: 0.6, name: '洗衣機', nameEn: 'Washer', price: 24000 },
  tatami: { kind: 'rug', w: 1.8, d: 1.8, name: '和室架高地板', nameEn: 'Tatami platform', price: 30000 },
};
const sized = (base, w) => ({ ...base, w: +w.toFixed(2) });

// --------------------------------------------------------------------------- recipes
function furnishBedroom(R, out, master) {
  const area = polygonArea(R.P), sl = slots(R);
  const beds = master || area >= 12 ? [CAT.bed6, CAT.bed5, CAT.bed35] : area >= 8 ? [CAT.bed5, CAT.bed35] : [CAT.bed35];
  let bed = null;
  for (const b of beds) {
    // headboard on a long wall, centred, away from windows if possible; 0.55 m free beside and 0.6 m at the foot
    bed = place(R, b, { slots: sl, clear: 0.6, side: 0.55, where: 'center', prefer: (S, u, box) => (windowOverlap(R, S, box) ? -2 : 0) });
    if (bed) { out.push(item(b, bed.S, bed.u)); break; }
    bed = place(R, b, { slots: sl, clear: 0.55, side: 0, where: 'any', prefer: (S, u, box) => (windowOverlap(R, S, box) ? -2 : 0) });
    if (bed) { out.push(item(b, bed.S, bed.u)); break; }
  }
  if (bed && bed.S) {
    for (const s of [-1, 1]) {
      const u = bed.u + s * (out[out.length - 1].w / 2 + CAT.night.w / 2 + 0.03), box = itemBox(bed.S, u, CAT.night.w, CAT.night.d);
      if (boxOK(R, box, ONLY_FREE)) { boxMark(R, box, HARD); out.push(item(CAT.night, bed.S, snap(u))); }
    }
  }
  for (const w of [1.8, 1.5, 1.2, 0.9]) { const p = place(R, sized(CAT.wardrobe, w), { clear: 0.7, where: 'corner' }); if (p) { out.push(item(sized(CAT.wardrobe, w), p.S, p.u)); break; } }
  if (area >= 13 || master) {
    const p = place(R, CAT.desk, { clear: 0.75, where: 'corner', prefer: (S, u, box) => (windowOverlap(R, S, box) ? 1 : 0) });
    if (p) { out.push(item(CAT.desk, p.S, p.u)); }
  }
}

function furnishLiving(R, out) {
  const sl = slots(R), sofa = CAT.sofa;
  let done = false;
  // TV wall: a long, mostly solid wall; the sofa faces it 2.8–3.6 m away (or backs onto the opposite wall up to 5.6 m)
  const cands = [];
  for (const T of sl) {
    if (T.len < 2.2) continue;
    for (const tvw of [3.0, 2.4]) {
      if (T.len < tvw + 0.2) continue;
      for (let u = T.lo + tvw / 2 + 0.1; u <= T.hi - tvw / 2 - 0.1 + 1e-6; u += 0.2) {
        const tvBox = itemBox(T, snap(u), tvw, 0.5);
        if (!boxOK(R, tvBox, ONLY_FREE) || windowOverlap(R, T, tvBox)) continue;
        for (const dist of [3.2, 3.0, 3.5, 2.8]) {
          // sofa centre line: TV face + dist (sofa front) + sofa depth / 2
          const sgn = T.n[0] + T.n[1], back = T.face + sgn * (dist + sofa.d);
          const S = { n: [-T.n[0], -T.n[1]], face: back, lo: T.lo, hi: T.hi, len: T.len };
          const sofaBox = itemBox(S, snap(u), sofa.w, sofa.d);
          if (!boxOK(R, sofaBox, ONLY_FREE)) continue;
          const walk = itemBox(T, snap(u), Math.min(tvw, 2.4), dist - 0.5, 0.5); // the space between must be open
          if (!boxOK(R, walk, CLEAR_OK)) continue;
          // prefer sofas that back onto a wall, TVs centred on their wall, and the classic 3.2 m
          const behind = itemBox(S, snap(u), sofa.w, 0.15, -0.15 - 0.0001);
          const backed = !boxOK(R, { ...behind }, CLEAR_OK) ? 1 : 0;
          const score = backed * 1.5 - Math.abs(u - (T.lo + T.hi) / 2) * 0.4 - Math.abs(dist - 3.2) + tvw * 0.2;
          cands.push({ T, S, u: snap(u), tvw, dist, tvBox, sofaBox, score });
          break;
        }
      }
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const c = cands[0];
  if (c) {
    boxMark(R, c.tvBox, HARD); boxMark(R, c.sofaBox, HARD);
    out.push(item(sized(CAT.tvwall, c.tvw), c.T, c.u, 0), item(sized(CAT.tvconsole, Math.max(1.2, c.tvw - 0.6)), c.T, c.u, 0.08));
    out.push(item(sofa, c.S, c.u));
    const sgn = c.T.n[0] + c.T.n[1], mid = c.T.face + sgn * (0.5 + (c.dist - 0.5) / 2);
    const at = c.T.n[0] === 0 ? [c.u, mid] : [mid, c.u];
    out.push({ ...CAT.rug, x: +at[0].toFixed(3), z: +at[1].toFixed(3), rot: rotFor(c.T.n), auto: true, id: `af${(uid++).toString(36)}` });
    out.push({ ...CAT.coffee, x: +at[0].toFixed(3), z: +at[1].toFixed(3), rot: 0, auto: true, id: `af${(uid++).toString(36)}` });
    boxMark(R, itemBox(c.T, c.u, Math.min(c.tvw, 2.6), c.dist - 0.5, 0.5), SOFT);
    done = true;
  }
  if (!done) { const p = place(R, sofa, { clear: 1.2, where: 'center' }); if (p) out.push(item(sofa, p.S, p.u)); }
  const pl = place(R, CAT.plant, { clear: 0, where: 'corner', tall: false }); if (pl) out.push(item(CAT.plant, pl.S, pl.u));
}

function furnishDining(R, out) {
  // table in the most open spot, long side along the room's long axis, chairs either side
  const area = polygonArea(R.P); if (area < 4) return;
  let best = null;
  for (let j = 0; j < R.nz; j += 4) for (let i = 0; i < R.nx; i += 4) { // every 20 cm
    const x = R.x0 + (i + 0.5) * G, z = R.z0 + (j + 0.5) * G;
    for (const rot of [0, 90]) {
      const w = rot ? 0.9 : 1.6, d = rot ? 1.6 : 0.9, pad = 0.75;
      const box = { x0: snap(x - w / 2), x1: snap(x + w / 2), z0: snap(z - d / 2), z1: snap(z + d / 2) };
      const zone = { x0: box.x0 - (rot ? pad : 0.1), x1: box.x1 + (rot ? pad : 0.1), z0: box.z0 - (rot ? 0.1 : pad), z1: box.z1 + (rot ? 0.1 : pad) };
      if (!boxOK(R, zone, ONLY_FREE)) continue;
      const cxr = (R.x0 + R.nx * G / 2), czr = (R.z0 + R.nz * G / 2), score = -Math.hypot(x - cxr, z - czr);
      if (!best || score > best.score) best = { x: (box.x0 + box.x1) / 2, z: (box.z0 + box.z1) / 2, rot, zone, score };
    }
  }
  if (!best) return;
  boxMark(R, best.zone, HARD);
  const rot = best.rot, a = rot * Math.PI / 180, along = [Math.cos(-a), Math.sin(-a)], across = [-along[1], along[0]];
  out.push({ ...CAT.table, x: +best.x.toFixed(3), z: +best.z.toFixed(3), rot, auto: true, id: `af${(uid++).toString(36)}` });
  for (const sx of [-0.4, 0.4]) for (const sz of [-1, 1]) out.push({ ...CAT.chair, x: +(best.x + along[0] * sx + across[0] * sz * 0.72).toFixed(3), z: +(best.z + along[1] * sx + across[1] * sz * 0.72).toFixed(3), rot: rot + (sz > 0 ? 180 : 0), auto: true, id: `af${(uid++).toString(36)}` });
}

function furnishKitchen(R, out) {
  const sl = slots(R).filter(S => S.len >= 1.5);
  for (const S of sl) {
    const w = Math.min(3.0, S.len - (S.len > 2.4 ? 0.8 : 0));
    const p = place(R, sized(CAT.counter, w), { slots: [S], clear: 0.9, where: 'corner', tall: false });
    if (!p) continue;
    out.push(item(sized(CAT.counter, w), p.S, p.u), item(sized(CAT.upper, w), p.S, p.u));
    const f = place(R, CAT.fridge, { clear: 0.8, where: 'corner' }); if (f) out.push(item(CAT.fridge, f.S, f.u));
    return;
  }
}

function furnishBath(R, out) {
  const area = polygonArea(R.P);
  const t = place(R, CAT.toilet, { clear: 0.55, side: 0.15, where: 'corner', tall: false }); if (t) out.push(item(CAT.toilet, t.S, t.u));
  const v = place(R, CAT.vanity, { clear: 0.6, where: 'any', tall: false }); if (v) out.push(item(CAT.vanity, v.S, v.u));
  if (area >= 3.0) { const s = place(R, CAT.shower, { clear: 0.5, where: 'corner', tall: false }); if (s) out.push(item(CAT.shower, s.S, s.u)); }
}

function furnishStudy(R, out) {
  const d = place(R, CAT.desk, { clear: 0.8, where: 'center', prefer: (S, u, box) => (windowOverlap(R, S, box) ? 1 : 0) }); if (d) { out.push(item(CAT.desk, d.S, d.u)); out.push(item(CAT.deskchair, d.S, d.u, CAT.desk.d - 0.05, { rot: rotFor(d.S.n) + 180 })); }
  const s = place(R, CAT.shelf, { clear: 0.6, where: 'corner' }); if (s) out.push(item(CAT.shelf, s.S, s.u));
}

// --------------------------------------------------------------------------- entry point
// Furnish every room on a level that has no furniture yet (or all rooms with { replace: true }, which first
// removes earlier auto-placed pieces but keeps anything the user placed by hand). Returns the number of items added.
export function autoFurnish(level, { replace = false, stairs = [], skipDrawn = false } = {}) {
  // pieces read from the drawing (drawn) survive a re-run; rooms that have them keep the drawing's layout
  if (replace) level.furniture = (level.furniture || []).filter(f => (!f.auto || f.drawn) && !f.dress);
  level.furniture = level.furniture || [];
  let added = 0;
  for (const room of level.rooms || []) {
    const type = roomType(room);
    if (type === 'none') continue;
    if (level.furniture.some(f => f.drawn && pointInPolygon([f.x, f.z], room.polygon))) continue;
    if (!replace && level.furniture.some(f => !f.dress && pointInPolygon([f.x, f.z], room.polygon))) continue;
    const R = roomGrid(level, room);
    for (const f of level.furniture) boxMark(R, rotBox(f), HARD);
    // stair flights (going up from here or arriving from below) plus a landing in front stay clear
    for (const st of stairs) if (st.from === level.id || st.to === level.id) { const b = stairBox(st); boxMark(R, { x0: b.x0 - 0.6, x1: b.x1 + 0.6, z0: b.z0 - 0.6, z1: b.z1 + 0.6 }, KEEP); boxMark(R, b, HARD); }
    const out = [];
    try {
      if (type === 'bedroom' || type === 'master') furnishBedroom(R, out, type === 'master');
      else if (type === 'living') furnishLiving(R, out);
      else if (type === 'livingdining') { furnishLiving(R, out); furnishDining(R, out); }
      else if (type === 'dining') furnishDining(R, out);
      else if (type === 'kitchen') furnishKitchen(R, out);
      else if (type === 'kitchendining') { furnishKitchen(R, out); furnishDining(R, out); if (polygonArea(room.polygon) >= 32) furnishLiving(R, out); }
      else if (type === 'bath') furnishBath(R, out);
      else if (type === 'study') furnishStudy(R, out);
      else if (type === 'entry') { const p = place(R, CAT.entry, { clear: 0.8, where: 'corner' }); if (p) out.push(item(CAT.entry, p.S, p.u)); }
      else if (type === 'service') { const p = place(R, CAT.washer, { clear: 0.6, where: 'corner', tall: false }); if (p) out.push(item(CAT.washer, p.S, p.u)); }
      else if (type === 'balcony') { const p = place(R, CAT.plant, { clear: 0, where: 'corner', tall: false }); if (p) out.push(item(CAT.plant, p.S, p.u)); }
      else if (type === 'tatami') { const p = place(R, CAT.tatami, { clear: 0, where: 'center', tall: false }); if (p) out.push(item(CAT.tatami, p.S, p.u)); }
    } catch (e) { /* a room we can't furnish stays empty */ }
    // open-plan living rooms large enough for a dining table too
    if (type === 'living' && polygonArea(room.polygon) >= 26 && !(level.rooms || []).some(r => /餐|dining/i.test(`${r.name} ${r.nameEn}`))) furnishDining(R, out);
    level.furniture.push(...out); added += out.length;
  }
  dressLevel(level, roomType); // curtains, lights, hood, art, rugs, plants
  return added;
}

function rotBox(f) {
  const a = ((f.rot || 0) * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), sc = f.scale || 1;
  const w = (f.w * c + f.d * s) * sc, d = (f.w * s + f.d * c) * sc;
  return { x0: f.x - w / 2, x1: f.x + w / 2, z0: f.z - d / 2, z1: f.z + d / 2 };
}
