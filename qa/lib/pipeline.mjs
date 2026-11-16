// The import pipeline outside the browser — the same modules the editor runs:
//   picture: extractPlanLines → wallsFromImage (floors) → detectRooms → tidyExteriorOpenings
//            → [AI step replayed from a recording: room names + drawn furniture] → autoFurnish → dress
//   DXF:     parseDXF → wall layer → detectWalls/closeCorners → detectRooms → autoFurnish
// Returns the plan document and metrics used by the regression gate.
import './node-env.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { REPO } from './node-env.mjs';
import { recordingPath } from './fixtures.mjs';
const require = createRequire(import.meta.url);

const R = await import(join(REPO, 'src/editor/raster.js'));
const G = await import(join(REPO, 'src/editor/geometry.js'));
const P = await import(join(REPO, 'src/plan.js'));
const F = await import(join(REPO, 'src/editor/furnish.js'));
const D = await import(join(REPO, 'src/editor/drawn.js'));
const O = await import(join(REPO, 'src/editor/openings.js'));
const X = await import(join(REPO, 'src/editor/dxf.js'));
const IS = await import(join(REPO, 'src/editor/issues.js'));

function decode(path) {
  const buf = readFileSync(path);
  if (/\.png$/i.test(path)) { const { PNG } = require('pngjs'); return PNG.sync.read(buf); }
  return require('jpeg-js').decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
}

export async function runFixture(fx, { ai = true } = {}) {
  const t0 = performance.now();
  const doc = fx.kind === 'dxf' ? fromDXF(fx.path) : fromImage(fx.path);
  const tGeo = performance.now() - t0;
  let aiInfo = null;
  if (fx.kind !== 'dxf' && ai && existsSync(recordingPath(fx.id))) aiInfo = replayAI(doc, JSON.parse(readFileSync(recordingPath(fx.id), 'utf8')));
  for (const L of doc.levels) F.autoFurnish(L, { replace: false, stairs: doc.stairs, skipDrawn: true });
  return { doc, metrics: metricsOf(doc, { ms: Math.round(performance.now() - t0), msGeometry: Math.round(tGeo), ai: aiInfo }) };
}

function fromImage(path) {
  const img = decode(path);
  const lines = R.extractPlanLines(img);
  const res = R.wallsFromImage(lines, { mpp: 0 });
  const fl = lines.floors && lines.floors.length > 1 ? lines.floors : [{ shift: [0, 0] }];
  const levels = res.floors.map((ws, k) => {
    const L = { id: `${k + 1}F`, name: `${k + 1}F`, elevation: k * 3, height: 3, walls: ws.map((w, i) => ({ id: `w${k}_${i}`, openings: [], ...w })), rooms: [], furniture: [], voids: [], imgShift: (fl[k] && fl[k].shift) || [0, 0] };
    G.detectRooms(L); return L;
  });
  const doc = { levels, stairs: [], project: { name: 'qa' }, _img: { w: img.width, h: img.height, mpp: res.mpp } };
  O.tidyExteriorOpenings(doc);
  return doc;
}

function fromDXF(path) {
  const d = X.parseDXF(X.decodeDXF(readFileSync(path)));
  const walls = X.wallsFromDXF(d, X.defaultWallLayers(d)); // the editor's default layer choice
  const L = { id: '1F', name: '1F', elevation: 0, height: 3, walls: walls.map((w, i) => ({ id: `d${i}`, openings: [], ...w })), rooms: [], furniture: [], voids: [] };
  G.detectRooms(L);
  return { levels: [L], stairs: [], project: { name: 'qa' } };
}

// A recording is what /api/vision answered for this picture: { S, size, passes: [ {rooms, items, scale}, … ] }.
// Rooms are matched by marker number (markers are numbered floor by floor, room by room — like the editor).
function replayAI(doc, rec) {
  const S = rec.S, mpp = doc._img.mpp;
  const marks = []; doc.levels.forEach(L => L.rooms.forEach(r => marks.push({ n: marks.length + 1, L, r })));
  const [a, b, focus] = rec.passes;
  let items = a.items || [];
  if (b) items = D.mergeItems(items, b.items || []);
  if (focus) { const same = (p, q) => p.kind === q.kind && Math.abs((p.box[0] + p.box[2]) - (q.box[0] + q.box[2])) < 30 && Math.abs((p.box[1] + p.box[3]) - (q.box[1] + q.box[3])) < 30; items = items.concat((focus.items || []).filter(it => (!focus.focus || focus.focus.includes(it.n)) && !items.some(x => same(x, it)))); }
  for (const x of a.rooms || []) {
    const m = marks[x.n - 1]; if (!m) continue;
    Object.assign(m.r, { name: x.name, nameEn: x.nameEn, hasStairs: !!x.stairs }, G.roomFlagsFromName(x.name, m.r.finish)); // as the editor's aiNameRooms
    if (x.floor && !m.r.wet && !m.r.outdoor) m.r.floor = x.floor === 'tile' ? 'stone' : x.floor;
  }
  const toPlan = (p, sh) => [(p[0] / S + sh[0]) * mpp, (p[1] / S + sh[1]) * mpp];
  const byL = new Map();
  for (const it of items) {
    const c = [(it.box[0] + it.box[2]) / 2, (it.box[1] + it.box[3]) / 2];
    const L = doc.levels.find(Lv => Lv.rooms.some(r => P.pointInPolygon(toPlan(c, Lv.imgShift), r.polygon))) || doc.levels.find(Lv => D.insideWalls(Lv, toPlan(c, Lv.imgShift)));
    if (L) { if (!byL.has(L)) byL.set(L, []); byL.get(L).push(it); }
  }
  let placed = 0;
  for (const [L, its] of byL) { const f = D.placeDrawn(L, its, q => toPlan(q, L.imgShift), doc.stairs); L.furniture.push(...f); placed += f.length; }
  return { items: items.length, placed, passes: rec.passes.length };
}

export function metricsOf(doc, extra = {}) {
  const lv = doc.levels;
  const rooms = lv.flatMap(L => L.rooms);
  const furn = lv.flatMap(L => L.furniture || []);
  const issues = lv.reduce((n, L) => n + IS.findIssues(L).length, 0);
  const furnishedRooms = lv.reduce((n, L) => n + L.rooms.filter(r => (L.furniture || []).some(f => !f.dress && P.pointInPolygon([f.x, f.z], r.polygon))).length, 0);
  return {
    floors: lv.length,
    walls: lv.reduce((n, L) => n + L.walls.length, 0),
    openings: lv.reduce((n, L) => n + L.walls.reduce((m, w) => m + (w.openings || []).length, 0), 0),
    rooms: rooms.length,
    openRooms: rooms.filter(r => r.open).length,
    roomArea: +rooms.reduce((a, r) => a + P.polygonArea(r.polygon), 0).toFixed(1),
    furnishedRooms,
    furniture: furn.filter(f => !f.dress).length,
    drawn: furn.filter(f => f.drawn).length,
    decor: furn.filter(f => f.dress).length,
    issues,
    ...extra,
  };
}
