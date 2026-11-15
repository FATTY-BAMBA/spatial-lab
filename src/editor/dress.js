// Dressing pass: the finishing layer a designer adds after the layout — sheer curtains at the windows of living
// rooms and bedrooms, a pendant over the dining table, a range hood over the cooktop run, art above the sofa,
// bed and sideboard, a rug under the bed, a plant at the sofa's end. Runs after any furnishing (drawn or generic);
// replaces its own earlier pieces (dress: true) so it can run again.
// Item orientation follows the plan format: back faces (−sin r, −cos r).
import { pointInPolygon, polygonArea, wallFrame } from '../plan.js';

const DRESSED = /living|livingdining|kitchendining|dining|bedroom|master|study|tatami/;
const rad = d => (d * Math.PI) / 180;
const r3 = v => +v.toFixed(3);

function footprint(f) { // axis-aligned box of a (0/90/180/270-rotated) piece
  const q = Math.abs(Math.round((f.rot || 0) / 90)) % 2 === 1, hw = (q ? f.d : f.w) / 2, hd = (q ? f.w : f.d) / 2;
  return { x0: f.x - hw, x1: f.x + hw, z0: f.z - hd, z1: f.z + hd };
}
const overlaps = (a, b, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad;

export function dressLevel(level, roomType) {
  level.furniture = (level.furniture || []).filter(f => !f.dress);
  const base = level.furniture.slice(), add = [];
  let uid = Date.now() % 1e6;
  const put = (o, room) => add.push({ ...o, x: r3(o.x), z: r3(o.z), auto: true, dress: true, room: room ? room.id : undefined, id: `dr${(uid++).toString(36)}` });
  const typeOf = new Map((level.rooms || []).map(r => [r, roomType(r)]));
  const roomAt = p => (level.rooms || []).find(r => pointInPolygon(p, r.polygon));
  const inRoom = (f, room) => pointInPolygon([f.x, f.z], room.polygon);
  const free = (box, room, pad = 0.05) => [box.x0, box.x1].every(x => [box.z0, box.z1].every(z => pointInPolygon([x, z], room.polygon))) && !base.concat(add).some(f => f.kind !== 'rug' && overlaps(footprint(f), box, pad));

  // sheer curtains at the windows (and sliding doors) of living spaces and bedrooms
  for (const w of level.walls || []) {
    if (w.kind === 'zone') continue;
    const { ux, uz } = wallFrame(w), n = [-uz, ux];
    for (const o of w.openings || []) {
      if (!(o.type === 'window' || o.type === 'slider') || o.width < 0.5) continue;
      const mid = [w.a[0] + ux * (o.offset + o.width / 2), w.a[1] + uz * (o.offset + o.width / 2)];
      for (const s of [1, -1]) {
        const inside = [mid[0] + n[0] * s * 0.35, mid[1] + n[1] * s * 0.35], room = roomAt(inside);
        if (!room || room.outdoor || room.wet || !DRESSED.test(typeOf.get(room) || '')) continue;
        const off = (w.t || 0.12) / 2 + 0.1, back = [-n[0] * s, -n[1] * s]; // back of the curtain faces the wall
        put({ kind: 'curtain', sheer: true, name: '紗簾', nameEn: 'Sheer curtain', price: Math.round(4500 + o.width * 2500), w: +(o.width + 0.3).toFixed(2), d: 0.12, x: mid[0] + n[0] * s * off, z: mid[1] + n[1] * s * off, rot: rotFromBack(back) }, room);
        break;
      }
    }
  }
  for (const [room, type] of typeOf) {
    if (!DRESSED.test(type)) continue;
    const mine = base.filter(f => inRoom(f, room));
    // lighting over the dining table
    for (const tb of mine.filter(f => f.kind === 'table' || (f.kind === 'roundtable' && f.w >= 0.8 && /餐|dining/i.test(`${f.name} ${f.nameEn}`)))) {
      if (tb.kind === 'table') put({ kind: 'linear', name: '餐桌吊燈', nameEn: 'Linear pendant', price: 12800, w: +Math.min(1.6, tb.w * 0.7).toFixed(2), d: 0.1, x: tb.x, z: tb.z, rot: tb.rot || 0 }, room);
      else put({ kind: 'pendant', name: '吊燈', nameEn: 'Pendant', price: 8800, w: 0.36, d: 0.36, x: tb.x, z: tb.z, rot: 0 }, room);
    }
    // range hood over the kitchen run (one per kitchen, towards one end of the longest run)
    const run = mine.filter(f => f.kind === 'counter' && f.sink !== undefined && f.w >= 1.5).sort((a, b) => b.w - a.w)[0];
    if (run && !mine.some(f => f.kind === 'hood')) {
      const u = [Math.cos(rad(run.rot || 0)), -Math.sin(rad(run.rot || 0))], k = run.w / 2 - 0.55;
      put({ kind: 'hood', name: '排油煙機', nameEn: 'Range hood', price: 18000, w: 0.75, d: 0.5, x: run.x + u[0] * k, z: run.z + u[1] * k, rot: run.rot || 0 }, room);
    }
    // art on the wall behind the sofa, the bed and the sideboard
    for (const f of mine.filter(f => f.kind === 'sofa' || (f.kind === 'model' && /GlamVelvetSofa/.test(f.model || '')) || f.kind === 'bed' || f.kind === 'sideboard')) {
      const back = [-Math.sin(rad(f.rot || 0)), -Math.cos(rad(f.rot || 0))], aw = +Math.min(1.5, Math.max(0.6, f.w * (f.kind === 'bed' ? 0.55 : 0.6))).toFixed(2);
      const y = f.kind === 'bed' ? 1.55 : f.kind === 'sideboard' ? 1.55 : 1.5;
      put({ kind: 'art', name: '掛畫', nameEn: 'Wall art', price: 6800, w: aw, d: 0.04, h: +(aw * 0.62).toFixed(2), y, seed: uid, x: f.x + back[0] * (f.d / 2 - 0.02), z: f.z + back[1] * (f.d / 2 - 0.02), rot: f.rot || 0 }, room);
    }
    // a rug under the bed, reaching past its foot
    for (const bed of mine.filter(f => f.kind === 'bed' && f.w >= 1.3)) {
      if (mine.some(f => f.kind === 'rug' && overlaps(footprint(f), footprint(bed)))) continue;
      const fwd = [Math.sin(rad(bed.rot || 0)), Math.cos(rad(bed.rot || 0))];
      put({ kind: 'rug', name: '床邊地毯', nameEn: 'Bedroom rug', price: 7800, w: +(bed.w + 0.9).toFixed(2), d: 1.7, x: bed.x + fwd[0] * 0.45, z: bed.z + fwd[1] * 0.45, rot: bed.rot || 0 }, room);
    }
    // a plant at one end of the sofa, if there is room
    const sofa = mine.find(f => f.kind === 'sofa' || (f.kind === 'model' && /Sofa/.test(f.model || '')));
    if (sofa && !mine.some(f => /Plant/.test(f.model || ''))) {
      const u = [Math.cos(rad(sofa.rot || 0)), -Math.sin(rad(sofa.rot || 0))];
      for (const s of [1, -1]) {
        const at = [sofa.x + u[0] * s * (sofa.w / 2 + 0.42), sofa.z + u[1] * s * (sofa.w / 2 + 0.42)], box = { x0: at[0] - 0.3, x1: at[0] + 0.3, z0: at[1] - 0.3, z1: at[1] + 0.3 };
        if (free(box, room)) { put({ kind: 'model', model: 'DiffuseTransmissionPlant', scale: 1.3, name: '植栽', nameEn: 'Plant', price: 3200, w: 0.7, d: 0.66, x: at[0], z: at[1], rot: 0 }, room); break; }
      }
    }
    if (polygonArea(room.polygon) < 4) continue;
  }
  level.furniture.push(...add.map(({ room, ...f }) => f));
  return add.length;
}
function rotFromBack([bx, bz]) { // back = (−sin r, −cos r)
  return Math.round((Math.atan2(-bx, -bz) * 180) / Math.PI);
}
