// Plan geometry used by the editor: room detection from walls (planar faces),
// exterior wall marking, label/spot placement and the auto-generated 3D story.
import { polygonArea, polygonCentroid, pointInPolygon, bbox, wallFrame } from '../plan.js';

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
  const segs = walls.filter(w => w.kind !== 'ignore').map(w => ({ a: w.a, b: w.b, ts: [0, 1] }));
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
  const vid = p => { const k = key(p[0], p[1]); if (!verts.has(k)) { verts.set(k, p); adj.set(k, new Set()); } return k; };
  for (const S of segs) {
    const ts = [...new Set(S.ts.map(t => Math.min(1, Math.max(0, t)).toFixed(5)))].map(Number).sort((x, y) => x - y);
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
      const list = sorted.get(b), i = list.indexOf(a);
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
  const { rooms: polys, outer } = findFaces(level.walls);
  const prev = level.rooms || [];
  const used = new Set();
  const rooms = polys.map((poly, i) => {
    const c = labelPoint(poly);
    const old = prev.find(r => !used.has(r.id) && pointInPolygon(c, r.polygon)) || prev.find(r => !used.has(r.id) && r.labelAt && pointInPolygon(r.labelAt, poly));
    if (old) used.add(old.id);
    const area = polygonArea(poly);
    const biggest = polys.every(q => polygonArea(q) <= area + 1e-6);
    const base = old || { id: `r${Date.now().toString(36)}${i}`, name: biggest && area > 15 ? '客廳' : area > 7 ? '臥室' : '房間', nameEn: biggest && area > 15 ? 'Living' : area > 7 ? 'Bedroom' : 'Room', finish: 'floor' };
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
  p.project.footprint = [[fb.x0, fb.z0], [fb.x1, fb.z0], [fb.x1, fb.z1], [fb.x0, fb.z1]];
  if (p.project.type === 'apartment') {
    p.project.site = { floor: p.project.floor || 9, floorHeight: 3.0, towerBox: [fb.x0 - 0.6, fb.z0 - 3.6, fb.x1 + 0.6, fb.z1 + 1.8], city: true };
  } else delete p.project.site;
  p.project.hour = p.project.hour ?? 15.25;
  if (!p.finishes) p.finishes = JSON.parse(JSON.stringify(base.finishes));
  if (!p.defaultFinishes) p.defaultFinishes = { ...base.defaultFinishes };
  let interior = 0;
  for (const L of p.levels) for (const r of L.rooms) if (!r.outdoor) interior += polygonArea(r.polygon);
  p.project.stats = [
    { label: '樓層 Levels', value: p.levels.map(L => L.id).join(' / ') },
    { label: '房間 Rooms', value: `${p.levels.reduce((n, L) => n + L.rooms.filter(r => !r.outdoor && !r.circulation).length, 0)} 間` },
  ];
  for (const L of p.levels) {
    const links = doorLinks(L);
    for (const r of L.rooms) {
      r.labelAt = r.labelAt || labelPoint(r.polygon);
      if (!r.spotPinned) r.spot = roomSpot(r, links);
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

function roomSpot(r, links) {
  const c = labelPoint(r.polygon);
  const door = links.find(l => l.a === r.id || l.b === r.id);
  let pos, look;
  if (door) {
    const dir = door.a === r.id ? 1 : -1; // into the room along the normal
    const inside = [door.m[0] + door.n[0] * dir * 0.7, door.m[1] + door.n[1] * dir * 0.7];
    pos = pointInPolygon(inside, r.polygon) ? inside : c;
    look = [c[0] + (c[0] - pos[0]) * 0.8, c[1] + (c[1] - pos[1]) * 0.8];
    if (Math.hypot(look[0] - pos[0], look[1] - pos[1]) < 1) look = [pos[0] + door.n[0] * dir * 3, pos[1] + door.n[1] * dir * 3];
  } else {
    const b = bbox(r.polygon);
    pos = [b.x0 + (b.x1 - b.x0) * 0.2, b.z0 + (b.z1 - b.z0) * 0.2];
    if (!pointInPolygon(pos, r.polygon)) pos = c;
    look = [b.x1, b.z1];
  }
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
