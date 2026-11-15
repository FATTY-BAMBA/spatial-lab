// Room detection: closed rooms, gaps, spaces open on one side, and what must NOT become a room.
import test from 'node:test';
import assert from 'node:assert/strict';
import { G, P, W, rect, level } from './helpers.mjs';

test('a closed 4 × 5 m room is one room', () => {
  const L = level(rect(0, 0, 4, 5)); G.detectRooms(L);
  assert.equal(L.rooms.length, 1);
  assert.ok(Math.abs(P.polygonArea(L.rooms[0].polygon) - 20) < 1.5);
  assert.ok(!L.rooms[0].open);
});

test('two rooms sharing a wall are two rooms', () => {
  const L = level([...rect(0, 0, 8, 5), W([4, 0], [4, 5])]); G.detectRooms(L);
  assert.equal(L.rooms.length, 2);
});

test('a room with a 1.2 m gap in a wall (no door drawn) is still a room', () => {
  const L = level([W([0, 0], [6, 0]), W([6, 0], [6, 5]), W([6, 5], [3.6, 5]), W([2.4, 5], [0, 5]), W([0, 5], [0, 0])]); G.detectRooms(L);
  assert.equal(L.rooms.length, 1);
  assert.ok(P.polygonArea(L.rooms[0].polygon) > 22);
});

test('a space open on one whole side (undetected glass front) becomes an open room', () => {
  // living room open to the south, next to a closed kitchen that sets the building's extent
  const L = level([W([0, 0], [10, 0]), W([10, 0], [10, 8]), W([10, 8], [6, 8]), W([6, 8], [6, 0]), W([0, 0], [0, 8])]);
  G.detectRooms(L);
  const open = L.rooms.filter(r => r.open);
  assert.equal(open.length, 1, `rooms: ${L.rooms.map(r => r.name + (r.open ? '*' : '')).join(',')}`);
  assert.ok(P.polygonArea(open[0].polygon) > 30);
});

test('the outside notch of an L-shaped house is not a room', () => {
  const L = level([W([0, 0], [10, 0]), W([10, 0], [10, 4]), W([10, 4], [5, 4]), W([5, 4], [5, 9]), W([5, 9], [0, 9]), W([0, 9], [0, 0])]);
  G.detectRooms(L);
  assert.equal(L.rooms.length, 1);
  assert.ok(!L.rooms[0].open);
});

test('room ids stay unique across floors and survive re-detection', () => {
  const A = level(rect(0, 0, 4, 4)); A.id = '1F'; const B = level(rect(0, 0, 4, 4)); B.id = '2F';
  G.detectRooms(A); G.detectRooms(B);
  assert.notEqual(A.rooms[0].id, B.rooms[0].id);
  const id = A.rooms[0].id; A.rooms[0].name = '主臥'; G.detectRooms(A);
  assert.equal(A.rooms[0].id, id); assert.equal(A.rooms[0].name, '主臥');
});
