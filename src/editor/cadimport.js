// CAD drawing (DXF or DWG bytes) → plan level: the whole automatic part of the editor's CAD import, pure (no DOM).
// cad-worker.js runs it off the page during the progress flow; the editor's 自動辨識牆體 button runs planLevel()
// on the page after the designer picks wall layers. Stages report through onStage(step, info).
import { parseDXF, decodeDXF, defaultWallLayers, wallsFromDXF } from './dxf.js';
import { convertDWG, loadAcad, DwgError } from './dwg.js';
import { detectRooms, roomFlagsFromName } from './geometry.js';
import { autoFurnish } from './furnish.js';
import { pointInPolygon, wallFrame } from '../plan.js';

export const ROOM_EN = { 主臥: 'Master Bedroom', 主臥室: 'Master Bedroom', 次臥: 'Bedroom', 臥室: 'Bedroom', 小孩房: "Kid's Room", 客廳: 'Living', 餐廳: 'Dining', 客餐廳: 'Living & Dining', 廚房: 'Kitchen', 衛浴: 'Bathroom', 浴室: 'Bathroom', 主浴: 'Master Bath', 玄關: 'Entrance', 陽台: 'Balcony', 前陽台: 'Balcony', 後陽台: 'Service Balcony', 書房: 'Study', 走道: 'Hall', 儲藏室: 'Storage', 更衣室: 'Walk-in Closet', 和室: 'Tatami Room' };
const ROOMWORD = /房|廳|厅|室|臥|卧|廚|厨|浴|廁|厕|衛|卫|陽台|阳台|玄關|書房|儲|倉|走道|梯|辦公|會議|大廳|茶水|機房|room|bed|living|dining|kitchen|bath|wc|toilet|hall|lobby|office|meeting|conference|storage|store|closet|laundry|utility|garage|study|foyer|entry|corridor|balcony|terrace|pantry|shop|retail|电|電氣|electrical|mech/i;
const ROOMRANK = [/客廳|客厅|起居|living|lounge/i, /餐廳|餐厅|dining/i, /臥|卧|bed/i, /辦公|office|會議|meeting/i, /廚|厨|kitchen/i];

// DXF text or bytes → parsed drawing (segs, texts, layers, units)
export function readCAD(src) {
  let d;
  try { d = parseDXF(typeof src === 'string' ? src : decodeDXF(src)); }
  catch (err) { throw new DwgError('dxf-failed', `DXF could not be read: ${(err && err.message) || err}`); }
  if (!d.segs.length) throw new DwgError('no-lines', 'The drawing has no usable lines');
  return d;
}

// Walls from the chosen layers, rooms, room names from the drawing's text, the main door and furniture, written into
// level L (walls, rooms, furniture are replaced). Returns counts, or null when the layers hold no walls.
export function planLevel(d, wallLayers, L, { stairs = [], onStage = () => {} } = {}) {
  const walls = wallsFromDXF(d, wallLayers);
  if (!walls.some(w => w.kind !== 'zone')) return null;
  L.walls = walls.map((w, i) => ({ id: `d${i}`, ...w }));
  onStage('walls', { walls: walls.length });
  detectRooms(L);
  // name rooms from text inside them; open plans carry several labels (玄關 + 客廳 + 餐廳): the main living space names it
  let named = 0;
  const rank = x => { const i = ROOMRANK.findIndex(re => re.test(x.text)); return i < 0 ? 99 : i; };
  for (const r of L.rooms) {
    const inside = d.texts.filter(x => pointInPolygon(x.p, r.polygon) && !/^[\d\s.,:×x*+\-=/'"mM²㎡]+$/.test(x.text) && x.text.length <= 24);
    const x = inside.filter(x => ROOMWORD.test(x.text)).sort((a, b) => rank(a) - rank(b))[0] || inside.find(x => /[一-鿿가-힣]/.test(x.text));
    if (x) {
      named++;
      r.name = x.text.replace(/\s*[\d.]+\s*(m²|㎡|m2|坪)\s*$/i, '').slice(0, 10);
      r.nameEn = ROOM_EN[r.name] || (/[一-鿿]/.test(r.name) ? '' : r.name);
      Object.assign(r, roomFlagsFromName(x.text, r.finish));
      if (/浴|廁|bath|wc/i.test(x.text)) { r.finish = 'tile'; r.wet = true; }
    }
  }
  // the exterior door closest to an "entrance" label is the main door
  const ent = d.texts.find(x => /玄關|入口|entry|entrance/i.test(x.text));
  let best = null;
  for (const w of L.walls) {
    if (!w.ext) continue;
    const { ux, uz } = wallFrame(w);
    for (const o of w.openings) if (o.type === 'door') { const m = [w.a[0] + ux * (o.offset + o.width / 2), w.a[1] + uz * (o.offset + o.width / 2)]; const dd = ent ? Math.hypot(m[0] - ent.p[0], m[1] - ent.p[1]) : 0; if (!best || dd < best.d) best = { o, d: dd }; }
  }
  if (best) best.o.main = true;
  onStage('rooms', { rooms: L.rooms.length, named });
  const furniture = autoFurnish(L, { replace: true, stairs });
  onStage('furniture', { furniture });
  return { walls: walls.length, rooms: L.rooms.length, named, furniture };
}

// The whole automatic import: [DWG → DXF] → drawing → (plan: true) walls, rooms, names, furniture.
// Returns { d, wallLayers, conv, level: { walls, rooms, furniture } | null, counts | null }. Throws DwgError (code).
export async function runCAD(buf, { dwg = false, plan = true, stairs = [], levelId = '1F', onStage = () => {} } = {}) {
  let src = buf, conv = null;
  if (dwg) {
    const t0 = Date.now();
    const r = convertDWG(await loadAcad(), buf);
    conv = { version: r.version, year: r.year, ms: { ...r.ms, total: Date.now() - t0 }, warnings: r.warnings };
    src = r.dxf;
    onStage('convert', conv);
  }
  const d = readCAD(src);
  const wallLayers = defaultWallLayers(d);
  onStage('read', { segs: d.segs.length, layers: Object.keys(d.layers).length, wallLayers });
  if (!plan) return { d, wallLayers, conv, level: null, counts: null };
  const L = { id: levelId, walls: [], rooms: [], furniture: [], voids: [] };
  const counts = planLevel(d, wallLayers, L, { stairs, onStage });
  return { d, wallLayers, conv, level: counts ? { walls: L.walls, rooms: L.rooms, furniture: L.furniture } : null, counts };
}

// ---- browser: runCAD in a module Worker (cad-worker.js) so the page keeps painting; stages arrive through onStage.
// · the Worker gets a copy of the file, so the page still has the bytes if the Worker never starts;
// · the Worker fails before it says anything (script missing, no module workers: Safari < 15, Firefox < 114)
//   → the same import runs here, once;
// · the Worker dies after it started (out of memory, a crash) or a message can't be read → reject at once with
//   code 'crashed' (running the same drawing on the page would only freeze it);
// · nothing for `timeout` ms → 'timeout'.
// Rejects with a DwgError (code). opts.workerUrl is for tests.
export const CAD_TIMEOUT_MS = 180000;
export function runCADJob(buf, { timeout = CAD_TIMEOUT_MS, onStage = () => {}, workerUrl = new URL('./cad-worker.js', import.meta.url), ...opts } = {}) {
  const W = globalThis.Worker;
  if (typeof W === 'undefined') return runCAD(buf, { ...opts, onStage });
  return new Promise((resolve, reject) => {
    let w, done = false, started = false;
    const stop = () => { done = true; clearTimeout(timer); try { w && w.terminate(); } catch {} };
    const end = (fn, v) => { if (done) return; stop(); fn(v); };
    const here = () => { if (done) return; stop(); runCAD(buf, { ...opts, onStage }).then(resolve, reject); };
    const crashed = why => end(reject, new DwgError('crashed', `The CAD worker stopped: ${why}`));
    const timer = setTimeout(() => end(reject, new DwgError('timeout', `The drawing took longer than ${Math.round(timeout / 1000)} s`)), timeout);
    try { w = new W(workerUrl, { type: 'module' }); } catch { here(); return; }
    w.onmessage = e => {
      if (done) return;
      started = true;
      const m = e.data || {};
      if (m.stage) { try { onStage(m.stage, m.info); } catch (err) { console.error(err); } return; }
      if (m.ok) end(resolve, m.result);
      else end(reject, new DwgError(m.code || 'failed', m.message || 'CAD import failed', { version: m.version, bytes: m.bytes }));
    };
    w.onerror = e => {
      if (e && e.preventDefault) e.preventDefault();
      if (done) return;
      const why = (e && e.message) || 'error';
      if (!started) { console.warn(`CAD worker unavailable (${why}): importing on the page`); here(); }
      else crashed(why);
    };
    w.onmessageerror = () => crashed('unreadable message');
    const copy = buf.slice(0);
    w.postMessage({ buf: copy, opts }, [copy]);
  });
}
