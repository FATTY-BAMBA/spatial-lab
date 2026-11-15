// The DXF import on our own sample stays healthy (walls, rooms).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../lib/node-env.mjs';
import { G, X, level } from './helpers.mjs';

test('sample-2br-apartment.dxf → walls and 6 rooms', () => {
  const d = X.parseDXF(X.decodeDXF(readFileSync(join(REPO, 'samples/sample-2br-apartment.dxf'))));
  const walls = X.wallsFromDXF(d, X.defaultWallLayers(d));
  const L = level(walls.map((w, i) => ({ id: `d${i}`, openings: [], ...w }))); G.detectRooms(L);
  assert.ok(walls.length >= 8, `walls ${walls.length}`);
  assert.equal(L.rooms.length, 6);
});
