// T-005: a room and its balcony separated only by an undetected glass slider are two rooms, not one.
// Rule under test (geometry.js splitAtFacade): an open room that crosses the line of an exterior wall ending at its
// edge is cut along that line; the part beyond the facade becomes an outdoor balcony (or is dropped when it is a sliver).
import test from 'node:test';
import assert from 'node:assert/strict';
import { G, P, W, level } from './helpers.mjs';

const area = r => P.polygonArea(r.polygon);
const at = (L, p) => L.rooms.filter(r => P.pointInPolygon(p, r.polygon));

// Living 0..4 × 0..6 (closed, its south wall is the facade), bedroom 4..8 × 0..6 next to it; the bedroom's south side
// is a 4 m slider nobody detected, the balcony (0..8 × 6..7.6) has no drawn parapet — only the side wall runs on.
const sliderPlan = () => level([
  W([0, 0], [8, 0]), W([0, 0], [0, 6]), W([0, 6], [4, 6]), W([4, 0], [4, 6]), // living + facade line z = 6
  W([8, 0], [8, 7.6]),                                                          // east wall runs on along the balcony
]);

test('bedroom and balcony behind an undetected slider are two rooms; the balcony is outdoor', () => {
  const L = sliderPlan(); G.detectRooms(L);
  const bed = at(L, [6, 3]), balc = at(L, [6, 6.9]);
  assert.equal(bed.length, 1, 'one room at the bedroom centre');
  assert.equal(balc.length, 1, 'one room on the balcony');
  assert.notEqual(bed[0], balc[0], 'bedroom and balcony are separate rooms');
  assert.ok(!bed[0].outdoor, 'the bedroom stays indoor');
  assert.ok(balc[0].outdoor, 'the balcony is outdoor');
  assert.equal(balc[0].name.replace(/\s*\d+$/, ''), '陽台');
  // the cut runs on the facade line: the bedroom ends at z ≈ 6, the balcony starts there
  const bz = P.bbox(bed[0].polygon), cz = P.bbox(balc[0].polygon);
  assert.ok(Math.abs(bz.z1 - 6) < 0.2, `bedroom ends at the facade (z1 = ${bz.z1})`);
  assert.ok(Math.abs(cz.z0 - 6) < 0.2, `balcony starts at the facade (z0 = ${cz.z0})`);
  assert.ok(area(bed[0]) > 20 && area(bed[0]) < 25, `bedroom ≈ 3.9 × 5.9 m (got ${area(bed[0]).toFixed(1)})`);
  assert.ok(area(balc[0]) > 4, `balcony keeps its area (got ${area(balc[0]).toFixed(1)})`);
});

test('a room that pokes a thin sliver past the facade is trimmed back to the facade', () => {
  // closed room 4..8 × 0..3 whose east wall (the facade) runs on along the bedroom below and stops 1.6 m short; the
  // bedroom 4..8 × 3..7 is open there and leaks 0.5 m past the facade line
  const L = level([
    W([0, 0], [8.5, 0]), W([0, 0], [0, 7]), W([4, 0], [4, 7]), W([0, 7], [6, 7]), // living 0..4, south facade
    W([4, 3], [8, 3]), W([8, 0], [8, 5.4]),                                       // closed room, east facade
  ]);
  G.detectRooms(L);
  const bed = at(L, [6, 5]);
  assert.equal(bed.length, 1);
  const b = P.bbox(bed[0].polygon);
  assert.ok(b.x1 < 8.25, `bedroom does not cross the east facade line (x1 = ${b.x1})`);
  assert.equal(L.rooms.filter(r => r.outdoor).length, 0, 'a sliver is not a balcony');
});

test('a stepped facade is not cut: an indoor room that sticks out past its neighbour stays whole', () => {
  // living 0..4 × 0..6 closed; bedroom 4..8 × 0..8 sticks out 2 m past the living's facade, walled all round but for
  // a 1.6 m gap in its east wall (so it is an open room)
  const L = level([
    W([0, 0], [8, 0]), W([0, 0], [0, 6]), W([0, 6], [4, 6]), W([4, 0], [4, 8]), W([4, 8], [8, 8]), W([8, 8], [8, 4.6]), W([8, 3], [8, 0]),
  ]);
  G.detectRooms(L);
  const r = at(L, [6, 4]);
  assert.equal(r.length, 1);
  assert.ok(P.pointInPolygon([6, 7.5], r[0].polygon), 'the part beyond the neighbour\'s facade stays in the bedroom');
  assert.equal(L.rooms.filter(x => x.outdoor).length, 0);
});

test('a living room open on its whole front (no facade wall to continue) is left alone', () => {
  const L = level([W([0, 0], [10, 0]), W([10, 0], [10, 8]), W([10, 8], [6, 8]), W([6, 8], [6, 0]), W([0, 0], [0, 8])]);
  G.detectRooms(L);
  const open = L.rooms.filter(r => r.open);
  assert.equal(open.length, 1);
  assert.ok(P.polygonArea(open[0].polygon) > 30);
  assert.equal(L.rooms.filter(r => r.outdoor).length, 0);
});
