// detectWalls prunes its pair searches with spatial indexes (T-001: 40k-line drawings took ~1 min). The indexes must
// never change a result: on random drawings the indexed run equals the exhaustive all-pairs run, value for value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { X } from './helpers.mjs';

// seeded random drawing: double-line walls (varied thickness), single lines, near-axis jitter, directions on both
// sides of the ±90° wrap, collinear pieces with gaps, long and tiny lines, far from the origin
function drawing(seed, n) {
  let x = seed >>> 0;
  const r = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
  const segs = [], ox = r() < 0.5 ? 0 : 4000 * r(), oz = r() < 0.5 ? 0 : 3000 * r();
  const pick = a => a[Math.floor(r() * a.length)];
  for (let i = 0; i < n; i++) {
    const th = pick([0, 0, Math.PI / 2, -Math.PI / 2 + 1e-12, Math.PI / 2 - 0.004, 0.0003, -0.0002, 0.45, 0.45 + 0.01, r() * Math.PI - Math.PI / 2]);
    const ux = Math.cos(th), uz = Math.sin(th), nx = -uz, nz = ux;
    const len = pick([0.05, 0.3, 1, 2.5, 4, 12, 60]) * (0.5 + r());
    const cx = ox + r() * 40, cz = oz + r() * 30;
    const line = (o, s0, s1) => segs.push({ a: [cx + ux * s0 + nx * o, cz + uz * s0 + nz * o], b: [cx + ux * s1 + nx * o, cz + uz * s1 + nz * o], layer: 'W' });
    const kind = r();
    if (kind < 0.55) { const t = pick([0.04, 0.06, 0.1, 0.12, 0.15, 0.2, 0.24, 0.4, 0.45]); line(0, 0, len); line(t, r() * 0.3, len - r() * 0.3); }
    else if (kind < 0.7) { line(0, 0, len); line(0, len + 0.8 + r(), 2 * len + 1); line(0.15, 0, 2 * len + 1); } // collinear pieces with a gap
    else line(0, 0, len);
  }
  return segs;
}

test('indexed detectWalls equals the exhaustive one on 40 random drawings', () => {
  for (let k = 1; k <= 40; k++) {
    const segs = drawing(k * 7919, 20 + (k % 8) * 25);
    const a = X.detectWalls(segs), b = X.detectWalls(segs, { exhaustive: true });
    assert.deepEqual(a, b, `drawing ${k}`);
    // the room-outline (zone) pass uses very wide pairing limits
    assert.deepEqual(X.detectWalls(segs, { minT: 9, maxT: 9 }), X.detectWalls(segs, { minT: 9, maxT: 9, exhaustive: true }), `zones ${k}`);
  }
});

test('20,000 short wall lines: walls in a few seconds, not minutes', () => {
  const segs = [];
  for (let i = 0; i < 20000; i++) { const x = (i % 250) * 0.1, z = Math.floor(i / 250) * 0.1; segs.push({ a: [x, z], b: [x + 0.09, z + 0.04], layer: 'W' }); }
  const t0 = performance.now();
  X.detectWalls(segs);
  assert.ok(performance.now() - t0 < 4000, `${Math.round(performance.now() - t0)} ms`);
});
