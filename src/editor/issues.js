// Plan check: finds what usually goes wrong after an import (or a quick sketch) and how to fix it.
//   gap   – a wall end that touches nothing; fix = join it to a nearby free end or extend it to the wall it points at
//   stray – a short piece of wall touching nothing (text strokes, symbols); fix = delete
//   small – a sliver "room" (< 1 m²); usually a missing or doubled wall nearby
//   name  – a room still carrying a default name (房間 3, 臥室 2)
import { polygonArea, wallFrame } from '../plan.js';

const OPEN = 0.05;          // how far an end may sit from another wall and still count as connected (beyond half its thickness)
const JOIN = 2.0;           // longest gap we offer to close between two free ends (m)
const REACH = 2.5;          // longest extension we offer towards a wall ahead (m)

function frame(w) { const f = wallFrame(w); return { ux: f.ux, uz: f.uz, len: f.len }; }

// is point p on (or at the end of) wall v?
function onWall(p, v, slack = OPEN) {
  const { ux, uz, len } = frame(v), rx = p[0] - v.a[0], rz = p[1] - v.a[1], al = rx * ux + rz * uz;
  return al > -slack - (v.t || 0.12) / 2 && al < len + slack + (v.t || 0.12) / 2 && Math.abs(-rx * uz + rz * ux) <= (v.t || 0.12) / 2 + slack;
}

export function freeEnds(level) {
  const out = [];
  for (const w of level.walls) {
    const { ux, uz, len } = frame(w); if (len < 1e-6) continue;
    for (const e of ['a', 'b']) {
      const p = w[e];
      if (level.walls.some(v => v !== w && onWall(p, v))) continue;
      out.push({ w, end: e, p, out: e === 'a' ? [-ux, -uz] : [ux, uz] });
    }
  }
  return out;
}

const r3 = v => +v.toFixed(3);
const DEFAULT_NAME = /^(臥室|房間|Room|Bedroom)\s*\d+$/i;

export function findIssues(level) {
  const issues = [], ends = freeEnds(level), used = new Set();
  // stray pieces first: both ends free and short
  for (const w of level.walls) {
    const { len } = frame(w);
    const fa = ends.find(e => e.w === w && e.end === 'a'), fb = ends.find(e => e.w === w && e.end === 'b');
    if (fa && fb && len < 0.6) { issues.push({ kind: 'stray', p: [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], wall: w, len, fix: { type: 'delete', wall: w } }); used.add(fa); used.add(fb); }
  }
  for (const E of ends) {
    if (used.has(E)) continue;
    let best = null;
    // a) another free end close by
    for (const F of ends) {
      if (F === E || used.has(F) || F.w === E.w) continue;
      const d = Math.hypot(F.p[0] - E.p[0], F.p[1] - E.p[1]);
      if (d > JOIN || d < 0.02) continue;
      const ahead = (F.p[0] - E.p[0]) * E.out[0] + (F.p[1] - E.p[1]) * E.out[1];
      if (ahead < -0.05) continue; // behind this end: joining would fold back over the wall
      // joins run along the wall or square to the plan — never a diagonal shortcut across a room
      const jx = (F.p[0] - E.p[0]) / d, jz = (F.p[1] - E.p[1]) / d;
      if (jx * E.out[0] + jz * E.out[1] < 0.94 && Math.abs(jx) < 0.985 && Math.abs(jz) < 0.985) continue;
      if (!best || d < best.d) best = { d, type: 'join', F };
    }
    // b) a wall straight ahead
    for (const v of level.walls) {
      if (v === E.w) continue;
      const { ux, uz, len } = frame(v), den = E.out[0] * uz - E.out[1] * ux; if (Math.abs(den) < 0.2) continue;
      const qx = v.a[0] - E.p[0], qz = v.a[1] - E.p[1], ta = (qx * uz - qz * ux) / den, tv = (qx * E.out[1] - qz * E.out[0]) / den;
      if (ta < 0.02 || ta > REACH || tv < -0.02 || tv > len + 0.02) continue;
      const d = ta - (v.t || 0.12) / 2 * Math.abs(den);
      if (!best || d < best.d - 0.15) best = { d: Math.max(0, d), type: 'extend', to: [r3(E.p[0] + E.out[0] * ta), r3(E.p[1] + E.out[1] * ta)], v };
    }
    if (best && best.type === 'join') used.add(best.F);
    used.add(E);
    issues.push({ kind: 'gap', p: E.p, d: best ? best.d : null, wall: E.w, end: E.end, fix: best ? { ...best, E } : null });
  }
  for (const r of level.rooms || []) {
    const a = polygonArea(r.polygon), c = r.polygon.reduce((s, q) => [s[0] + q[0] / r.polygon.length, s[1] + q[1] / r.polygon.length], [0, 0]);
    if (a < 1.0) issues.push({ kind: 'small', p: c, room: r, area: a });
    else if (DEFAULT_NAME.test(r.name || '')) issues.push({ kind: 'name', p: c, room: r, area: a });
  }
  const order = { gap: 0, stray: 1, small: 2, name: 3 };
  return issues.sort((a, b) => order[a.kind] - order[b.kind] || (a.d ?? 9) - (b.d ?? 9));
}

// Apply one issue's fix in place. Returns true when something changed.
export function applyFix(level, issue) {
  const f = issue.fix; if (!f) return false;
  if (f.type === 'delete') { const i = level.walls.indexOf(f.wall); if (i < 0) return false; level.walls.splice(i, 1); return true; }
  const E = f.E, w = E.w;
  if (!level.walls.includes(w)) return false;
  if (f.type === 'extend') {
    // grow the wall to meet the one ahead; openings measured from `a` shift when `a` moves
    const grow = Math.hypot(f.to[0] - E.p[0], f.to[1] - E.p[1]);
    if (E.end === 'a') for (const o of w.openings || []) o.offset = r3(o.offset + grow);
    w[E.end] = f.to.slice();
    return true;
  }
  if (f.type === 'join') {
    const F = f.F, a = E.p.slice(), b = F.p.slice(), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // a short gap between two ends facing each other is usually a doorway; a wide one an open passage
    const facing = E.out[0] * F.out[0] + E.out[1] * F.out[1] < -0.7;
    const openings = facing && len >= 0.6 && len <= 1.3 ? [{ type: 'door', offset: 0.02, width: r3(len - 0.04), sill: 0, head: 2.1 }]
      : facing && len > 1.3 ? [{ type: 'passage', offset: 0.02, width: r3(len - 0.04), sill: 0, head: 2.4 }] : [];
    level.walls.push({ id: `fx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, a, b, t: Math.min(w.t || 0.12, F.w.t || 0.12), openings });
    return true;
  }
  return false;
}

// Fix every gap/stray that has a fix, re-checking after each change so fixes never collide.
export function fixAll(level, detect) {
  let n = 0;
  for (let guard = 0; guard < 200; guard++) {
    const next = findIssues(level).find(i => i.fix && (i.kind === 'gap' || i.kind === 'stray'));
    if (!next || !applyFix(level, next)) break;
    n++;
    if (detect) detect(level);
  }
  return n;
}
