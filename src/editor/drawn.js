// Furniture read from the drawing: a 格局圖 usually shows the designer's own layout (beds, sofa, dining set,
// kitchen run, bathroom fixtures…). The vision model lists each drawn item with its pixel box and the way it
// faces; here each one becomes a real piece at that spot, sized from the drawing within sensible limits,
// turned the right way and pushed back against the wall it was drawn against.
// Item orientation follows the plan format: back faces (−sin r, −cos r); rot 0 = back on −z, front towards +z.
import { pointInPolygon, wallFrame, stairBox } from '../plan.js';

// kind → piece; w/d ranges clamp sizes read from the drawing (metres); fixed: [w, d] keeps the catalog size
const KINDS = {
  bed: { make: (w, d) => (w >= 1.3 ? { kind: 'bed', name: '雙人床', nameEn: 'Double bed', price: 45000, w: clamp(w, 1.4, 2.0), d: clamp(d, 1.95, 2.2) } : { kind: 'bed', name: '單人床', nameEn: 'Single bed', price: 18000, w: clamp(w, 0.9, 1.2), d: clamp(d, 1.9, 2.1) }), wall: true },
  nightstand: { base: { kind: 'nightstand', name: '床頭櫃', nameEn: 'Nightstand', price: 6500 }, w: [0.4, 0.6], d: [0.35, 0.5], wall: true },
  wardrobe: { base: { kind: 'wardrobe', name: '系統衣櫃', nameEn: 'Wardrobe', price: 48000, h: 2.4 }, w: [0.8, 3.6], d: [0.55, 0.65], wall: true },
  desk: { base: { kind: 'desk', name: '書桌', nameEn: 'Desk', price: 16000 }, w: [0.8, 2.2], d: [0.5, 0.75], wall: true },
  chair: { base: { kind: 'chair', name: '椅子', nameEn: 'Chair', price: 6800 }, fixed: [0.46, 0.5] },
  sofa: { base: { kind: 'sofa', name: '沙發', nameEn: 'Sofa', price: 68000 }, w: [1.5, 3.4], d: [0.85, 1.0], wall: true },
  armchair: { base: { kind: 'model', model: 'SheenChair', name: '單椅', nameEn: 'Lounge chair', price: 18800 }, fixed: [0.83, 0.57] },
  coffee_table: { make: (w, d) => (Math.abs(w - d) < 0.2 * Math.max(w, d) ? { kind: 'roundtable', name: '茶几', nameEn: 'Coffee table', price: 16000, w: clamp(w, 0.6, 1.1), d: clamp(w, 0.6, 1.1) } : { kind: 'coffee', name: '茶几', nameEn: 'Coffee table', price: 16000, w: clamp(w, 0.8, 1.6), d: clamp(d, 0.45, 0.9) }) },
  rug: { base: { kind: 'rug', name: '地毯', nameEn: 'Rug', price: 9800 }, w: [0.8, 4], d: [0.6, 3.2] },
  tv: { make: w => ({ kind: 'tvconsole', name: '電視櫃', nameEn: 'TV console', price: 26000, w: clamp(w, 1.2, 2.6), d: 0.42 }), wall: true, tvwall: true },
  dining_table: { make: (w, d) => (Math.abs(w - d) < 0.15 * Math.max(w, d) && w < 1.4 ? { kind: 'roundtable', name: '圓餐桌', nameEn: 'Round dining table', price: 32000, w: clamp(w, 0.8, 1.3), d: clamp(w, 0.8, 1.3) } : { kind: 'table', name: '餐桌', nameEn: 'Dining table', price: 38000, w: clamp(w, 1.0, 2.6), d: clamp(d, 0.7, 1.1) }) },
  kitchen_counter: { base: { kind: 'counter', name: '廚具', nameEn: 'Kitchen run', price: 0, counter: true, cabinet: true, sink: true }, w: [0.6, 6], d: [0.55, 0.65], wall: true, upper: true },
  island: { base: { kind: 'counter', name: '中島', nameEn: 'Kitchen island', price: 85000, counter: true, cabinet: true }, w: [1.0, 3.2], d: [0.6, 1.2] },
  fridge: { base: { kind: 'fridge', name: '冰箱', nameEn: 'Refrigerator', price: 52000 }, fixed: [0.75, 0.7], wall: true },
  toilet: { base: { kind: 'toilet', name: '馬桶', nameEn: 'Toilet', price: 15000 }, fixed: [0.4, 0.65], wall: true },
  sink: { base: { kind: 'vanity', name: '浴櫃', nameEn: 'Vanity', price: 16000 }, w: [0.5, 1.4], d: [0.42, 0.5], wall: true },
  shower: { base: { kind: 'shower', name: '淋浴拉門', nameEn: 'Shower screen', price: 14000 }, w: [0.8, 1.4], d: [0.8, 1.2], wall: true },
  bathtub: { base: { kind: 'tub', name: '浴缸', nameEn: 'Bathtub', price: 38000 }, w: [1.2, 1.8], d: [0.68, 0.85], wall: true },
  washer: { base: { kind: 'washer', name: '洗衣機', nameEn: 'Washer', price: 24000 }, fixed: [0.6, 0.6], wall: true },
  plant: { base: { kind: 'model', model: 'DiffuseTransmissionPlant', scale: 1.3, name: '植栽', nameEn: 'Plant', price: 3200 }, fixed: [0.7, 0.66] },
  shelf: { base: { kind: 'shelf', name: '書櫃', nameEn: 'Bookcase', price: 22000, h: 2.2 }, w: [0.6, 2.8], d: [0.3, 0.4], wall: true },
  cabinet: { base: { kind: 'tallcab', name: '收納櫃', nameEn: 'Storage cabinet', price: 32000, cabinet: true, h: 2.4 }, w: [0.6, 2.4], d: [0.35, 0.6], wall: true },
  sideboard: { base: { kind: 'sideboard', name: '餐邊櫃', nameEn: 'Sideboard', price: 28000 }, w: [0.9, 2.4], d: [0.4, 0.5], wall: true },
};
export const DRAWN_KINDS = Object.keys(KINDS);
const ROT = { down: 0, up: 180, right: 90, left: -90 };
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function insideWalls(level, [x, z]) {
  const ws = (level.walls || []).filter(w => w.kind !== 'zone'); if (!ws.length) return false;
  const xs = ws.flatMap(w => [w.a[0], w.b[0]]), zs = ws.flatMap(w => [w.a[1], w.b[1]]);
  return x > Math.min(...xs) && x < Math.max(...xs) && z > Math.min(...zs) && z < Math.max(...zs);
}

// items: [{ kind, box: [x0, y0, x1, y1] (picture px), facing }]; toPlan([px, py]) → [x, z] for that item's floor
export function placeDrawn(level, items, toPlan, stairs = []) {
  const out = [];
  let uid = Date.now() % 1e6;
  const stairBoxes = stairs.filter(st => st.from === level.id || st.to === level.id).map(stairBox);
  for (const it of items) {
    const K = KINDS[it.kind]; if (!K) continue;
    const a = toPlan([it.box[0], it.box[1]]), b = toPlan([it.box[2], it.box[3]]);
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
    let cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const room = (level.rooms || []).find(r => pointInPolygon([cx, cz], r.polygon));
    if (room ? room.outdoor && !/plant|washer/.test(it.kind) : !insideWalls(level, [cx, cz])) continue; // open areas (a living room open to the carport) still count
    if (stairBoxes.some(s => cx > s.x0 && cx < s.x1 && cz > s.z0 && cz < s.z1)) continue;
    // tables, rugs, islands and plants have no front: lay them along their long side
    const free = /dining_table|coffee_table|rug|island|plant/.test(it.kind);
    const facing = free ? (z1 - z0 > x1 - x0 ? 'right' : 'down') : ROT[it.facing] != null ? it.facing : 'down';
    const along = facing === 'up' || facing === 'down', sw = along ? x1 - x0 : z1 - z0, sd = along ? z1 - z0 : x1 - x0;
    let p = K.make ? K.make(sw, sd) : { ...K.base, w: K.fixed ? K.fixed[0] : clamp(sw, ...K.w), d: K.fixed ? K.fixed[1] : clamp(sd, ...K.d) };
    p = { ...p, w: +p.w.toFixed(2), d: +p.d.toFixed(2) };
    const rot = ROT[facing], rad = rot * Math.PI / 180, back = [-Math.sin(rad), -Math.cos(rad)];
    if (K.wall) { // drawn against a wall: put the back face on that wall's face
      const s = snapBack(level, [cx, cz], back, p.d);
      if (s) { cx = s[0]; cz = s[1]; }
    }
    const f = { ...p, x: +cx.toFixed(3), z: +cz.toFixed(3), rot, auto: true, drawn: true, id: `ad${(uid++).toString(36)}` };
    out.push(f);
    if (K.upper) out.push({ kind: 'uppercab', name: '吊櫃', nameEn: 'Upper cabinets', price: 0, cabinet: true, w: p.w, d: 0.35, x: +(cx + back[0] * (p.d - 0.35) / 2).toFixed(3), z: +(cz + back[1] * (p.d - 0.35) / 2).toFixed(3), rot, auto: true, drawn: true, id: `ad${(uid++).toString(36)}` });
    if (K.tvwall) out.push({ kind: 'tvwall', name: '電視主牆', nameEn: 'TV wall', price: 45000, w: clamp(p.w + 0.6, 1.8, 3.2), d: 0.08, x: +(cx + back[0] * (p.d / 2 + 0.04)).toFixed(3), z: +(cz + back[1] * (p.d / 2 + 0.04)).toFixed(3), rot, auto: true, drawn: true, id: `ad${(uid++).toString(36)}` });
  }
  if (out.length) { const tv = out.find(f => f.kind === 'tvconsole'); if (tv && out.some(f => f.kind === 'tvwall')) tv.noTv = true; }
  return out;
}

// the wall behind a piece (parallel, within 45 cm of its back): returns the centre that puts the back on the wall face
function snapBack(level, c, back, d) {
  let best = null;
  const backPt = [c[0] + back[0] * d / 2, c[1] + back[1] * d / 2];
  for (const w of level.walls || []) {
    if (w.kind === 'zone') continue;
    const { ux, uz, len } = wallFrame(w), n = [-uz, ux];
    if (Math.abs(n[0] * back[0] + n[1] * back[1]) < 0.9) continue; // not parallel to the back
    const t = (backPt[0] - w.a[0]) * ux + (backPt[1] - w.a[1]) * uz;
    if (t < -0.2 || t > len + 0.2) continue;
    const off = (backPt[0] - w.a[0]) * n[0] + (backPt[1] - w.a[1]) * n[1]; // signed distance from the wall line
    const side = Math.sign(off) || -Math.sign(n[0] * back[0] + n[1] * back[1]);
    const gap = Math.abs(off) - (w.t || 0.12) / 2;
    if (gap > 0.45 || gap < -0.3) continue;
    if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { gap, n, side, off, w };
  }
  if (!best) return null;
  const move = (best.w.t || 0.12) / 2 + 0.01 - Math.abs(best.off); // >0: push away from the wall, <0: pull towards it
  return [c[0] + best.n[0] * best.side * move, c[1] + best.n[1] * best.side * move];
}
