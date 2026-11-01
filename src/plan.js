// Plan data helpers. Everything else (drawing, 3D, collision, quote) derives from these.
export const M2_PER_PING = 3.305785; // 1 坪

export async function loadPlan(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load plan ${url}: ${res.status}`);
  return res.json();
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

export function polygonCentroid(poly) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const f = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * f; cz += (z1 + z2) * f; a += f;
  }
  a *= 0.5;
  return [cx / (6 * a), cz / (6 * a)];
}

export function bbox(poly) {
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

export function pointInPolygon([x, z], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export const toPing = m2 => m2 / M2_PER_PING;

export function wallFrame(w) {
  const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dz);
  return { len, ux: dx / len, uz: dz / len, angle: Math.atan2(dz, dx) };
}

// Split a wall into solid pieces. Each piece: {s0, s1, y0, y1} in wall-local metres
// (s along the wall from a, y from the level floor). Ends extend by t/2 so corners close.
export function wallPieces(w, height) {
  height = w.h || height;
  const { len } = wallFrame(w);
  const ext = w.t / 2;
  const ops = [...(w.openings || [])].sort((p, q) => p.offset - q.offset);
  const pieces = [];
  let cursor = -ext;
  for (const o of ops) {
    const o0 = o.offset, o1 = o.offset + o.width;
    if (o0 > cursor) pieces.push({ s0: cursor, s1: o0, y0: 0, y1: height });
    if (o.sill > 0) pieces.push({ s0: o0, s1: o1, y0: 0, y1: o.sill });
    if (o.head < height) pieces.push({ s0: o0, s1: o1, y0: o.head, y1: height });
    cursor = Math.max(cursor, o1);
  }
  if (cursor < len + ext) pieces.push({ s0: cursor, s1: len + ext, y0: 0, y1: height });
  return pieces;
}

// Segments that block walking (everything except door/passage gaps), in plan coords.
export function collisionSegments(level) {
  const segs = [];
  for (const w of level.walls) {
    const { len, ux, uz } = wallFrame(w);
    const gaps = (w.openings || []).filter(o => o.type !== 'window').map(o => [o.offset, o.offset + o.width]).sort((a, b) => a[0] - b[0]);
    let cur = 0;
    const solid = [];
    for (const [g0, g1] of gaps) { if (g0 > cur) solid.push([cur, g0]); cur = Math.max(cur, g1); }
    if (cur < len) solid.push([cur, len]);
    for (const [s0, s1] of solid) {
      segs.push({ ax: w.a[0] + ux * s0, az: w.a[1] + uz * s0, bx: w.a[0] + ux * s1, bz: w.a[1] + uz * s1, r: w.t / 2 });
    }
  }
  for (const v of level.voids || []) {
    if (v.railFrom) segs.push({ ax: v.railFrom[0], az: v.railFrom[1], bx: v.railTo[0], bz: v.railTo[1], r: 0.03 });
  }
  for (const r of level.railings || []) segs.push({ ax: r.a[0], az: r.a[1], bx: r.b[0], bz: r.b[1], r: 0.05 });
  return segs;
}

// Footprint (axis aligned) of a furniture item, honouring 0/90/180/270 rotation.
export function itemFootprint(f) {
  const a = ((f.rot || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const sc = f.scale || 1;
  const w = (f.w * c + f.d * s) * sc, d = (f.w * s + f.d * c) * sc;
  return { x0: f.x - w / 2, x1: f.x + w / 2, z0: f.z - d / 2, z1: f.z + d / 2 };
}

export const NON_BLOCKING = new Set(['rug', 'pendant', 'linear', 'uppercab', 'hood', 'tvwall', 'headboard', 'curtain', 'heater']);
export const isBlocking = f => !NON_BLOCKING.has(f.kind) && !f.decor && !(f.y > 0.5);

// Quantities used by the quote.
export function quantities(plan) {
  let floorArea = 0, counterLength = 0, cabinetLength = 0, wallArea = 0, grossArea = 0;
  for (const L of plan.levels) {
    grossArea += polygonArea(plan.project.footprint);
    for (const r of L.rooms) if (r.finish === 'floor') floorArea += polygonArea(r.polygon);
    for (const f of L.furniture) {
      if (f.counter) counterLength += f.w;
      if (f.cabinet) cabinetLength += f.w;
    }
    const clear = L.height - 0.2; // ceiling height
    for (const w of L.walls) {
      if (w.outdoor) continue;
      const { len } = wallFrame(w);
      const faces = w.ext ? 1 : 2;
      let a = len * clear;
      for (const o of w.openings || []) a -= o.width * (Math.min(o.head, clear) - o.sill);
      wallArea += a * faces;
    }
  }
  return { floorArea, counterLength, cabinetLength, wallArea, grossArea };
}

export function buildQuote(plan, chosen) {
  const q = quantities(plan);
  const basisQty = {
    floorArea: toPing(q.floorArea),
    counterLength: q.counterLength,
    cabinetLength: q.cabinetLength,
    wallArea: toPing(q.wallArea),
  };
  const lines = [];
  for (const g of plan.finishes) {
    const opt = g.options.find(o => o.id === chosen[g.id]) || g.options[0];
    const qty = basisQty[g.basis];
    lines.push({ group: g.name, groupEn: g.nameEn, name: opt.name, unit: g.unit, qty, unitPrice: opt.price, total: Math.round(qty * opt.price), finish: true });
  }
  const byName = new Map();
  for (const L of plan.levels) for (const f of L.furniture) {
    if (!f.price) continue;
    const key = f.name + '|' + f.price;
    const row = byName.get(key) || { group: L.id === '1F' ? '家具・一樓' : '家具・二樓', name: f.name, nameEn: f.nameEn, unit: '件', qty: 0, unitPrice: f.price };
    row.qty += 1;
    byName.set(key, row);
  }
  for (const row of byName.values()) lines.push({ ...row, total: row.qty * row.unitPrice });
  const total = lines.reduce((s, l) => s + l.total, 0);
  return { lines, total, q };
}

export function stairHeightAt(stair, z, rise) {
  const t = (z - stair.zStart) / (stair.zEnd - stair.zStart);
  return Math.min(1, Math.max(0, t)) * rise;
}
