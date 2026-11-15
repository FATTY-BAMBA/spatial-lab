// Furniture read from the drawing: placement, orientation, wall snapping, and merging two AI reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { G, D, rect, level } from './helpers.mjs';

const room = () => { const L = level(rect(0, 0, 4, 4)); G.detectRooms(L); return L; };
const px = p => [p[0] / 100, p[1] / 100]; // 1 px = 1 cm

test('a bed drawn a little off the wall is pushed back against it, facing its foot', () => {
  const L = room();
  const [bed] = D.placeDrawn(L, [{ kind: 'bed', box: [100, 30, 280, 240], facing: 'down' }], px);
  assert.equal(bed.kind, 'bed'); assert.equal(bed.rot, 0); assert.equal(bed.w, 1.8);
  assert.ok(Math.abs(bed.z - bed.d / 2 - 0.085) < 0.03, `back edge at ${(bed.z - bed.d / 2).toFixed(3)}`);
});

test('facing maps to rotation (front = +z at 0°)', () => {
  const L = room();
  const rot = f => D.placeDrawn(L, [{ kind: 'sofa', box: [150, 150, 250, 240], facing: f }], px)[0].rot;
  assert.deepEqual(['down', 'up', 'right', 'left'].map(rot), [0, 180, 90, -90]);
});

test('a table drawn taller than wide lies along its long side', () => {
  const L = room();
  const [t] = D.placeDrawn(L, [{ kind: 'dining_table', box: [150, 100, 240, 280], facing: 'up' }], px);
  assert.equal(Math.abs(t.rot), 90); assert.ok(t.w > t.d);
});

test('items outside the building are skipped; a TV brings its TV wall', () => {
  const L = room();
  assert.equal(D.placeDrawn(L, [{ kind: 'sofa', box: [900, 900, 1000, 990], facing: 'up' }], px).length, 0);
  const tv = D.placeDrawn(L, [{ kind: 'tv', box: [20, 150, 50, 300], facing: 'right' }], px);
  assert.deepEqual(tv.map(f => f.kind).sort(), ['tvconsole', 'tvwall']);
});

test('merging two AI reads keeps one copy of shared items and every item only one read found', () => {
  const A = [{ kind: 'bed', box: [100, 100, 280, 300] }, { kind: 'desk', box: [10, 10, 80, 40] }];
  const B = [{ kind: 'bed', box: [104, 96, 276, 306] }, { kind: 'wardrobe', box: [300, 10, 390, 60] }];
  const m = D.mergeItems(A, B);
  assert.deepEqual(m.map(x => x.kind).sort(), ['bed', 'desk', 'wardrobe']);
  assert.deepEqual(m.find(x => x.kind === 'bed').box, [102, 98, 278, 303]);
});
