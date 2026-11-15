// Dressing pass: curtains where people live (not in bathrooms), art/rug with a bed, and safe to run again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { G, F, DR, rect, level } from './helpers.mjs';

function furnishedRoom(name, nameEn, wet = false) {
  const L = level(rect(0, 0, 4, 4)); L.walls[0].openings.push({ type: 'window', offset: 1.5, width: 1.2, sill: 0.9, head: 2.2 });
  G.detectRooms(L); Object.assign(L.rooms[0], { name, nameEn, wet });
  F.autoFurnish(L, { replace: true });
  return L;
}

test('a bedroom gets a curtain at its window, art over the bed and a rug', () => {
  const L = furnishedRoom('主臥', 'Master Bedroom'); const k = L.furniture.filter(f => f.dress).map(f => f.kind);
  assert.ok(k.includes('curtain')); assert.ok(k.includes('art')); assert.ok(k.includes('rug'));
});

test('a bathroom gets no curtain', () => {
  const L = furnishedRoom('衛浴', 'Bathroom', true);
  assert.ok(!L.furniture.some(f => f.dress && f.kind === 'curtain'));
});

test('dressing twice does not duplicate', () => {
  const L = furnishedRoom('主臥', 'Master Bedroom'); const n = L.furniture.length;
  DR.dressLevel(L, F.roomType); assert.equal(L.furniture.length, n);
});
