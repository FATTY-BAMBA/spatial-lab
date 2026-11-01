// PrimeStride Spatial Lab — plan editor.
// Draw walls, place doors/windows, rooms are detected automatically, place furniture,
// trace over a photo/scan or a DXF, then open the result in 3D.
import { polygonArea, bbox, toPing, wallFrame, pointInPolygon, itemFootprint } from '../plan.js';
import { drawLevel } from '../drawing.js';
import { detectRooms, completePlan, labelPoint } from './geometry.js';
import { parseDXF, detectWalls, closeCorners } from './dxf.js';

const $ = s => document.querySelector(s);
const cv = $('#ed'), ctx = cv.getContext('2d');
const dpr = Math.min(devicePixelRatio || 1, 2);
const STORE = 'spatial.editor.doc';
const fmt = n => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const m2 = v => `${v.toFixed(2)} m`;

// ---------------------------------------------------------------- catalogue
const ITEMS = [
  { group: '客廳', label: '絲絨沙發', kind: 'model', model: 'GlamVelvetSofa', w: 2.19, d: 1.02, name: '絲絨弧形沙發', nameEn: 'Velvet sofa', price: 72000 },
  { group: '客廳', label: '單椅', kind: 'model', model: 'SheenChair', w: 0.83, d: 0.57, name: '單椅', nameEn: 'Lounge chair', price: 18800 },
  { group: '客廳', label: '茶几', kind: 'roundtable', w: 0.9, d: 0.9, name: '大理石茶几', nameEn: 'Coffee table', price: 16000 },
  { group: '客廳', label: '坐墩', kind: 'model', model: 'SpecularSilkPouf', w: 0.61, d: 0.61, name: '坐墩', nameEn: 'Pouf', price: 5200 },
  { group: '客廳', label: '電視牆組', kind: 'tvset', w: 3.0, d: 0.42, name: '電視主牆', nameEn: 'TV wall', price: 45000 },
  { group: '客廳', label: '地毯', kind: 'rug', w: 2.4, d: 1.7, name: '地毯', nameEn: 'Rug', price: 9800 },
  { group: '客廳', label: '植栽', kind: 'model', model: 'DiffuseTransmissionPlant', w: 0.7, d: 0.66, scale: 1.3, name: '植栽', nameEn: 'Plant', price: 3200 },
  { group: '客廳', label: '窗簾', kind: 'curtain', w: 2.0, d: 0.18, name: '窗簾', nameEn: 'Curtain', price: 9000 },
  { group: '餐廚', label: '餐桌組 (4人)', kind: 'diningset', w: 1.8, d: 0.9, name: '餐桌', nameEn: 'Dining table', price: 38000 },
  { group: '餐廚', label: '餐椅', kind: 'chair', w: 0.46, d: 0.5, name: '餐椅', nameEn: 'Dining chair', price: 6800 },
  { group: '餐廚', label: '廚具 (一字型)', kind: 'counter', w: 2.4, d: 0.6, counter: true, cabinet: true, sink: true, name: '廚具', nameEn: 'Kitchen run', price: 0 },
  { group: '餐廚', label: '吊櫃', kind: 'uppercab', w: 2.0, d: 0.35, cabinet: true, name: '吊櫃', nameEn: 'Upper cabinets', price: 0 },
  { group: '餐廚', label: '冰箱', kind: 'fridge', w: 0.75, d: 0.7, name: '冰箱', nameEn: 'Refrigerator', price: 52000 },
  { group: '餐廚', label: '餐邊櫃', kind: 'sideboard', w: 1.6, d: 0.45, name: '餐邊櫃', nameEn: 'Sideboard', price: 28000 },
  { group: '臥室', label: '雙人床 6尺', kind: 'bed', w: 1.8, d: 2.1, name: '雙人床', nameEn: 'Queen bed', price: 45000 },
  { group: '臥室', label: '雙人床 5尺', kind: 'bed', w: 1.5, d: 2.0, name: '雙人床', nameEn: 'Double bed', price: 32000 },
  { group: '臥室', label: '床頭櫃', kind: 'nightstand', w: 0.45, d: 0.42, name: '床頭櫃', nameEn: 'Nightstand', price: 6500 },
  { group: '臥室', label: '系統衣櫃', kind: 'wardrobe', w: 1.8, d: 0.6, h: 2.4, name: '系統衣櫃', nameEn: 'Wardrobe', price: 48000 },
  { group: '臥室', label: '書桌', kind: 'desk', w: 1.4, d: 0.65, name: '書桌', nameEn: 'Desk', price: 16000 },
  { group: '臥室', label: '書櫃', kind: 'shelf', w: 1.8, d: 0.34, h: 2.2, name: '書櫃', nameEn: 'Bookcase', price: 22000 },
  { group: '衛浴', label: '馬桶', kind: 'toilet', w: 0.4, d: 0.65, name: '馬桶', nameEn: 'Toilet', price: 15000 },
  { group: '衛浴', label: '浴櫃', kind: 'vanity', w: 0.8, d: 0.45, name: '浴櫃', nameEn: 'Vanity', price: 16000 },
  { group: '衛浴', label: '淋浴拉門', kind: 'shower', w: 1.2, d: 0.9, name: '淋浴拉門', nameEn: 'Shower screen', price: 14000 },
  { group: '衛浴', label: '浴缸', kind: 'tub', w: 1.6, d: 0.75, name: '浴缸', nameEn: 'Bathtub', price: 38000 },
  { group: '其他', label: '玄關櫃', kind: 'tallcab', w: 1.8, d: 0.4, h: 2.4, cabinet: true, name: '玄關櫃', nameEn: 'Entry cabinet', price: 42000 },
  { group: '其他', label: '洗衣機', kind: 'washer', w: 0.6, d: 0.6, name: '洗衣機', nameEn: 'Washer', price: 24000 },
];
const EN = { 主臥: 'Master Bedroom', 主臥室: 'Master Bedroom', 次臥: 'Bedroom', 臥室: 'Bedroom', 小孩房: "Kid's Room", 客廳: 'Living', 餐廳: 'Dining', 客餐廳: 'Living & Dining', 廚房: 'Kitchen', 衛浴: 'Bathroom', 浴室: 'Bathroom', 主浴: 'Master Bath', 玄關: 'Entrance', 陽台: 'Balcony', 前陽台: 'Balcony', 後陽台: 'Service Balcony', 書房: 'Study', 走道: 'Hall', 儲藏室: 'Storage', 更衣室: 'Walk-in Closet', 和室: 'Tatami Room' };
const OPENING = {
  door: { width: 0.9, sill: 0, head: 2.1 },
  window: { width: 1.5, sill: 0.9, head: 2.2 },
  slider: { width: 2.4, sill: 0, head: 2.4, panels: 2 },
  passage: { width: 1.2, sill: 0, head: 2.4 },
};
const TOOLS = {
  select: { key: 'v', hint: '點選物件；拖曳移動；拖曳牆端點改長度。Delete 刪除，Ctrl+Z 復原。' },
  wall: { key: 'w', hint: '點擊起點、連續點擊畫牆；直接輸入長度（cm 或 m）按 Enter。雙擊或 Esc 結束。' },
  door: { key: 'd', hint: '點牆面放門。' },
  window: { key: 'n', hint: '點牆面放窗。' },
  slider: { key: 's', hint: '點牆面放落地拉門。' },
  zone: { key: 'z', hint: '畫虛線分界，把開放空間分成兩個房間（例如客廳／餐廳）。' },
  item: { key: 'f', hint: '從右側選家具，點擊放置；R 旋轉 90°。' },
  stair: { key: 't', hint: '拖出樓梯範圍：從樓梯起點拖到終點（沿上下方向）。會自動建立上一層。' },
  scale: { key: 'k', hint: '底圖比例：點兩個已知距離的點，再輸入實際長度。' },
};

// ---------------------------------------------------------------- state
let doc = null;
let lv = 0;
let tool = 'select';
let sel = null; // {type, wall, opening, room, item, stair}
let hover = null;
let view = { x0: -2, z0: -2, s: 60 };
let underlay = { img: null, imgEl: null, x: 0, z: 0, mpp: 0.01, opacity: 0.55, dxf: null, dxfLayers: new Set(), dxfOpacity: 0.7 };
let draft = null; // wall drawing { pts: [...] }
let typed = '';
let pendingItem = null; // catalogue entry to place
let itemRot = 0;
let snap = null;
let undo = [], redo = [];

function blank() {
  return { project: { name: '新專案', type: 'apartment', floor: 9 }, levels: [newLevel(0)], stairs: [] };
}
function newLevel(i, below) {
  const id = `${i + 1}F`;
  const L = { id, name: ['一樓', '二樓', '三樓', '四樓', '五樓'][i] || `${i + 1}樓`, elevation: below ? below.elevation + below.height : 0, height: 3.0, walls: [], rooms: [], furniture: [] };
  if (below) L.walls = below.walls.filter(w => w.ext).map(w => ({ ...w, openings: (w.openings || []).filter(o => o.type === 'window').map(o => ({ ...o })), id: undefined }));
  return L;
}
const level = () => doc.levels[lv];

function commit(label) {
  for (const L of doc.levels) detectRooms(L);
  syncVoids();
  undo.push(JSON.stringify(doc)); if (undo.length > 120) undo.shift();
  redo = [];
  save();
  refreshPanel();
  render();
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(doc)); } catch {} }
function loadDoc(d, fit = true) {
  doc = d; lv = 0; sel = null; draft = null;
  for (const L of doc.levels) { L.walls = L.walls || []; L.furniture = L.furniture || []; detectRooms(L); }
  doc.stairs = doc.stairs || [];
  undo = [JSON.stringify(doc)]; redo = [];
  save(); buildLevelTabs(); refreshPanel(); if (fit) fitView(); render();
}
function undoStep() { if (undo.length < 2) return; redo.push(undo.pop()); doc = JSON.parse(undo[undo.length - 1]); lv = Math.min(lv, doc.levels.length - 1); sel = null; save(); buildLevelTabs(); refreshPanel(); render(); }
function redoStep() { if (!redo.length) return; const s = redo.pop(); undo.push(s); doc = JSON.parse(s); sel = null; save(); buildLevelTabs(); refreshPanel(); render(); }

// stairwell openings on the level above follow the stairs
function syncVoids() {
  for (const L of doc.levels) L.voids = [];
  for (const st of doc.stairs) {
    const up = doc.levels.find(L => L.id === st.to); if (!up) continue;
    const z0 = Math.min(st.zStart, st.zEnd), z1 = Math.max(st.zStart, st.zEnd);
    const x0 = st.x0 - 0.05, x1 = st.x1 + 0.1;
    const railEnd = st.zEnd > st.zStart ? z1 - 0.85 : z0 + 0.85;
    up.voids.push({ id: st.id, polygon: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], railFrom: [x1, st.zEnd > st.zStart ? z0 : z1], railTo: [x1, railEnd] });
  }
}

// ---------------------------------------------------------------- view
function resize() {
  const r = cv.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  render();
}
const toScreen = (x, z) => [(x - view.x0) * view.s, (z - view.z0) * view.s];
const toWorld = (sx, sy) => [sx / view.s + view.x0, sy / view.s + view.z0];
function evWorld(e) { const r = cv.getBoundingClientRect(); return toWorld((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr); }
function fitView(pts) {
  if (!pts) {
    pts = doc.levels.flatMap(L => L.walls.flatMap(w => [w.a, w.b]));
    if (underlay.dxf) pts = pts.concat(underlay.dxf.segs.flatMap(s => [s.a, s.b]));
    if (underlay.imgEl) pts.push([underlay.x, underlay.z], [underlay.x + underlay.imgEl.width * underlay.mpp, underlay.z + underlay.imgEl.height * underlay.mpp]);
  }
  if (!pts.length) pts = [[0, 0], [12, 10]];
  const b = bbox(pts);
  const w = Math.max(4, b.x1 - b.x0) + 3, h = Math.max(4, b.z1 - b.z0) + 3;
  view.s = Math.min(cv.width / w, cv.height / h);
  view.x0 = (b.x0 + b.x1) / 2 - cv.width / view.s / 2;
  view.z0 = (b.z0 + b.z1) / 2 - cv.height / view.s / 2;
  render();
}

// ---------------------------------------------------------------- snapping
const SNAP_PX = 12;
function snapPoint(p, from, opts = {}) {
  const tol = (SNAP_PX * dpr) / view.s;
  let best = null;
  const consider = (q, kind, d) => { if (d < tol && (!best || d < best.d - 1e-9)) best = { p: q, kind, d }; };
  const L = level();
  for (const w of L.walls) for (const q of [w.a, w.b]) if (!opts.ignore || !opts.ignore.includes(q)) consider(q, '端點', Math.hypot(q[0] - p[0], q[1] - p[1]));
  if (underlay.dxf) for (const s of underlay.dxf.segs) { if (!underlay.dxfLayers.has(s.layer)) continue; for (const q of [s.a, s.b]) consider(q, 'DXF 端點', Math.hypot(q[0] - p[0], q[1] - p[1])); }
  if (best) return best;
  // along existing walls (T-junction)
  for (const w of L.walls) {
    const { ux, uz, len } = wallFrame(w);
    const t = (p[0] - w.a[0]) * ux + (p[1] - w.a[1]) * uz;
    if (t < 0 || t > len) continue;
    const q = [w.a[0] + ux * t, w.a[1] + uz * t];
    consider(q.map(v => +v.toFixed(3)), '牆上', Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  let q = p.slice(), kind = '格點';
  if (from) {
    const dx = p[0] - from[0], dz = p[1] - from[1], ang = Math.atan2(dz, dx), len = Math.hypot(dx, dz);
    const step = Math.PI / 4, a2 = Math.round(ang / step) * step;
    if (Math.abs(ang - a2) < 0.12 && !opts.free) { q = [from[0] + Math.cos(a2) * len, from[1] + Math.sin(a2) * len]; kind = Math.round(a2 / step) % 2 ? '45°' : '正交'; }
    // keep the orthogonal direction but land on aligned endpoints
    if (best && best.kind === '牆上') return best;
    for (const w of L.walls) for (const e of [w.a, w.b]) {
      if (kind === '正交' && Math.abs(Math.cos(a2)) > 0.5 && Math.abs(e[0] - q[0]) < tol) { q[0] = e[0]; kind = '對齊'; }
      if (kind === '正交' && Math.abs(Math.sin(a2)) > 0.5 && Math.abs(e[1] - q[1]) < tol) { q[1] = e[1]; kind = '對齊'; }
    }
  } else if (best) return best;
  const g = 0.05;
  q = q.map(v => Math.round(v / g) * g);
  return { p: q.map(v => +v.toFixed(3)), kind };
}

// ---------------------------------------------------------------- picking
function nearestWall(p, maxD) {
  let best = null;
  for (const w of level().walls) {
    const { ux, uz, len } = wallFrame(w);
    const t = (p[0] - w.a[0]) * ux + (p[1] - w.a[1]) * uz;
    if (t < -0.05 || t > len + 0.05) continue;
    const d = Math.abs((p[0] - w.a[0]) * -uz + (p[1] - w.a[1]) * ux);
    if (d < maxD && (!best || d < best.d)) best = { w, t, d, len };
  }
  return best;
}
function pick(p) {
  const L = level(), tol = (8 * dpr) / view.s;
  for (let i = L.furniture.length - 1; i >= 0; i--) { const f = L.furniture[i]; const b = itemFootprint(f); if (p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.z0 && p[1] <= b.z1) return { type: 'item', item: f }; }
  for (const st of doc.stairs) if (st.from === L.id) { const z0 = Math.min(st.zStart, st.zEnd), z1 = Math.max(st.zStart, st.zEnd); if (p[0] >= st.x0 && p[0] <= st.x1 && p[1] >= z0 && p[1] <= z1) return { type: 'stair', stair: st }; }
  const nw = nearestWall(p, Math.max(tol, 0.15));
  if (nw) {
    const o = (nw.w.openings || []).find(o => nw.t >= o.offset - 0.05 && nw.t <= o.offset + o.width + 0.05);
    if (o) return { type: 'opening', wall: nw.w, opening: o };
    return { type: 'wall', wall: nw.w };
  }
  const r = L.rooms.find(r => pointInPolygon(p, r.polygon));
  if (r) return { type: 'room', room: r };
  return null;
}

// ---------------------------------------------------------------- rendering
function render() {
  if (!doc) return;
  const W = cv.width, H = cv.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#eceee8'; ctx.fillRect(0, 0, W, H);
  // grid: 10 cm minor (when zoomed), 1 m major
  const [gx0, gz0] = toWorld(0, 0), [gx1, gz1] = toWorld(W, H);
  const minor = view.s > 90 ? 0.1 : view.s > 25 ? 0.5 : 1;
  for (const [step, alpha] of [[minor, 0.05], [1, 0.12], [5, 0.2]]) {
    ctx.strokeStyle = `rgba(31,35,40,${alpha})`; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = Math.floor(gx0 / step) * step; x < gx1; x += step) { const [sx] = toScreen(x, 0); ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, H); }
    for (let z = Math.floor(gz0 / step) * step; z < gz1; z += step) { const [, sy] = toScreen(0, z); ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(W, Math.round(sy) + 0.5); }
    ctx.stroke();
  }
  // underlays
  if (underlay.imgEl) {
    ctx.globalAlpha = underlay.opacity;
    const [sx, sy] = toScreen(underlay.x, underlay.z);
    ctx.drawImage(underlay.imgEl, sx, sy, underlay.imgEl.width * underlay.mpp * view.s, underlay.imgEl.height * underlay.mpp * view.s);
    ctx.globalAlpha = 1;
  }
  if (underlay.dxf) {
    ctx.globalAlpha = underlay.dxfOpacity; ctx.strokeStyle = '#2d6cb5'; ctx.lineWidth = 1; ctx.beginPath();
    for (const s of underlay.dxf.segs) { if (!underlay.dxfLayers.has(s.layer)) continue; const a = toScreen(...s.a), b = toScreen(...s.b); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    ctx.fillStyle = '#2d6cb5'; ctx.font = `${11 * dpr}px "Noto Sans TC", sans-serif`;
    for (const t of underlay.dxf.texts) { const [sx, sy] = toScreen(...t.p); ctx.fillText(t.text, sx, sy); }
    ctx.globalAlpha = 1;
  }
  // lower level as a faint trace guide
  if (lv > 0) {
    ctx.globalAlpha = 0.18;
    drawLevel(doc, { ...doc.levels[lv - 1], rooms: [], furniture: [] }, { canvas: cv, view, pxPerM: view.s, noGrid: true, noDims: true, furniture: false });
    ctx.globalAlpha = 1;
  }
  // the level itself, drawn with the same ink renderer as the 3D floor
  const L = level();
  drawLevel({ ...doc, stairs: doc.stairs }, L, { canvas: cv, view, pxPerM: view.s, noGrid: true, noDims: true, highlight: sel && sel.type === 'room' ? sel.room.id : null });
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // selection + handles
  const accent = '#e0a91e';
  const wallPath = (w, extra = 0) => {
    const { ux, uz } = wallFrame(w); const n = [-uz, ux], h = (w.t || 0.12) / 2 + extra;
    const pts = [[w.a[0] + n[0] * h, w.a[1] + n[1] * h], [w.b[0] + n[0] * h, w.b[1] + n[1] * h], [w.b[0] - n[0] * h, w.b[1] - n[1] * h], [w.a[0] - n[0] * h, w.a[1] - n[1] * h]].map(q => toScreen(...q));
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(...q) : ctx.moveTo(...q))); ctx.closePath();
  };
  if (hover && (!sel || hover.wall !== sel.wall || hover.item !== sel.item) && tool === 'select') {
    ctx.strokeStyle = 'rgba(224,169,30,.7)'; ctx.lineWidth = 2 * dpr;
    if (hover.type === 'wall' || hover.type === 'opening') { wallPath(hover.wall, 0.03); ctx.stroke(); }
    if (hover.type === 'item') { const b = itemFootprint(hover.item); const [x, y] = toScreen(b.x0, b.z0); ctx.strokeRect(x, y, (b.x1 - b.x0) * view.s, (b.z1 - b.z0) * view.s); }
  }
  if (sel) {
    ctx.strokeStyle = accent; ctx.lineWidth = 2.5 * dpr; ctx.fillStyle = 'rgba(224,169,30,.18)';
    if (sel.type === 'wall') {
      wallPath(sel.wall, 0.04); ctx.fill(); ctx.stroke();
      for (const q of [sel.wall.a, sel.wall.b]) { const [x, y] = toScreen(...q); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 6 * dpr, 0, 7); ctx.fill(); ctx.stroke(); }
      const { len } = wallFrame(sel.wall); const mid = toScreen((sel.wall.a[0] + sel.wall.b[0]) / 2, (sel.wall.a[1] + sel.wall.b[1]) / 2);
      tag(mid[0], mid[1] - 16 * dpr, m2(len));
    }
    if (sel.type === 'opening') {
      const { ux, uz } = wallFrame(sel.wall), o = sel.opening;
      const a = [sel.wall.a[0] + ux * o.offset, sel.wall.a[1] + uz * o.offset], b = [a[0] + ux * o.width, a[1] + uz * o.width];
      wallPath({ a, b, t: sel.wall.t }, 0.06); ctx.fill(); ctx.stroke();
      const mid = toScreen((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); tag(mid[0], mid[1] - 16 * dpr, `${Math.round(o.width * 100)} cm`);
    }
    if (sel.type === 'item') { const b = itemFootprint(sel.item); const [x, y] = toScreen(b.x0, b.z0); ctx.fillRect(x, y, (b.x1 - b.x0) * view.s, (b.z1 - b.z0) * view.s); ctx.strokeRect(x, y, (b.x1 - b.x0) * view.s, (b.z1 - b.z0) * view.s); }
    if (sel.type === 'stair') { const st = sel.stair; const [x, y] = toScreen(st.x0, Math.min(st.zStart, st.zEnd)); ctx.strokeRect(x, y, (st.x1 - st.x0) * view.s, Math.abs(st.zEnd - st.zStart) * view.s); }
  }
  // tool previews
  if (tool === 'wall' || tool === 'zone') {
    if (draft && draft.pts.length && draft.cursor) {
      const a = draft.pts[draft.pts.length - 1], b = draft.cursor;
      ctx.strokeStyle = tool === 'zone' ? 'rgba(31,35,40,.6)' : accent; ctx.lineWidth = (tool === 'zone' ? 1.5 : Math.max(2, 0.12 * view.s)) * dpr / (tool === 'zone' ? 1 : dpr);
      if (tool === 'zone') ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(...toScreen(...a)); ctx.lineTo(...toScreen(...b)); ctx.stroke(); ctx.setLineDash([]);
      const mid = toScreen((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      tag(mid[0], mid[1] - 18 * dpr, typed ? `${typed} ⏎` : m2(Math.hypot(b[0] - a[0], b[1] - a[1])), true);
    }
  }
  if (['door', 'window', 'slider'].includes(tool) && hover && hover.preview) {
    const { w, offset, width } = hover.preview; const { ux, uz } = wallFrame(w);
    const a = [w.a[0] + ux * offset, w.a[1] + uz * offset], b = [a[0] + ux * width, a[1] + uz * width];
    ctx.fillStyle = hover.preview.ok ? 'rgba(224,169,30,.45)' : 'rgba(200,60,40,.4)'; wallPath({ a, b, t: w.t }, 0.05); ctx.fill();
  }
  if (tool === 'item' && pendingItem && hover && hover.p) {
    const f = { ...pendingItem, x: hover.p[0], z: hover.p[1], rot: itemRot };
    const b = itemFootprint(f); const [x, y] = toScreen(b.x0, b.z0);
    ctx.fillStyle = 'rgba(224,169,30,.25)'; ctx.strokeStyle = accent; ctx.lineWidth = 2 * dpr;
    ctx.fillRect(x, y, (b.x1 - b.x0) * view.s, (b.z1 - b.z0) * view.s); ctx.strokeRect(x, y, (b.x1 - b.x0) * view.s, (b.z1 - b.z0) * view.s);
  }
  if ((tool === 'stair' || tool === 'scale') && draft && draft.a && draft.cursor) {
    ctx.strokeStyle = accent; ctx.lineWidth = 2 * dpr;
    const a = toScreen(...draft.a), b = toScreen(...draft.cursor);
    if (tool === 'stair') { ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); tag(b[0], b[1] + 18 * dpr, `${m2(Math.abs(draft.cursor[0] - draft.a[0]))} × ${m2(Math.abs(draft.cursor[1] - draft.a[1]))}`); }
    else { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
  }
  if (snap && (tool !== 'select')) {
    const [x, y] = toScreen(...snap.p);
    ctx.strokeStyle = '#2d6cb5'; ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(x - 5 * dpr, y - 5 * dpr, 10 * dpr, 10 * dpr);
    ctx.fillStyle = '#2d6cb5'; ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`; ctx.fillText(snap.kind, x + 8 * dpr, y - 8 * dpr);
  }
}
function tag(x, y, text, strong) {
  ctx.font = `600 ${11 * dpr}px "IBM Plex Mono", monospace`;
  const w = ctx.measureText(text).width + 10 * dpr, h = 18 * dpr;
  ctx.fillStyle = strong ? '#1f2328' : 'rgba(31,35,40,.85)'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = '#f6f7f3'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1);
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------- input
let drag = null, panning = null, spaceDown = false;
const pointers = new Map();
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) { panning = { pinch: dist2(), view: { ...view }, mid: mid2() }; return; }
  if (e.button === 1 || e.button === 2 || spaceDown) { panning = { x: e.clientX, y: e.clientY, view: { ...view } }; return; }
  const p = evWorld(e);
  if (tool === 'select') {
    const L = level();
    // wall endpoint handles first
    if (sel && sel.type === 'wall') for (const end of ['a', 'b']) {
      const [x, y] = toScreen(...sel.wall[end]); const r = cv.getBoundingClientRect();
      if (Math.hypot(x - (e.clientX - r.left) * dpr, y - (e.clientY - r.top) * dpr) < 10 * dpr) {
        const q = sel.wall[end];
        const linked = L.walls.flatMap(w => ['a', 'b'].filter(k => w !== sel.wall && Math.hypot(w[k][0] - q[0], w[k][1] - q[1]) < 0.01).map(k => ({ w, k })));
        drag = { kind: 'end', w: sel.wall, end, linked, from: sel.wall[end === 'a' ? 'b' : 'a'] }; return;
      }
    }
    sel = pick(p);
    if (sel && sel.type === 'item') drag = { kind: 'item', item: sel.item, off: [p[0] - sel.item.x, p[1] - sel.item.z] };
    else if (sel && sel.type === 'opening') drag = { kind: 'opening', w: sel.wall, o: sel.opening, off: projOn(sel.wall, p) - sel.opening.offset };
    else if (sel && sel.type === 'wall') {
      const w = sel.wall;
      const linked = L.walls.flatMap(v => ['a', 'b'].flatMap(k => v !== w && ['a', 'b'].some(e2 => Math.hypot(v[k][0] - w[e2][0], v[k][1] - w[e2][1]) < 0.01) ? [{ w: v, k, e2: ['a', 'b'].find(e2 => Math.hypot(v[k][0] - w[e2][0], v[k][1] - w[e2][1]) < 0.01) }] : []));
      drag = { kind: 'wall', w, start: p, a0: w.a.slice(), b0: w.b.slice(), linked };
    }
    refreshPanel(); render();
    return;
  }
  if (tool === 'wall' || tool === 'zone') {
    const s = snapPoint(p, draft && draft.pts.length ? draft.pts[draft.pts.length - 1] : null, { free: e.altKey });
    if (!draft) draft = { pts: [s.p], cursor: s.p };
    else addWallPoint(s.p);
    return;
  }
  if (['door', 'window', 'slider'].includes(tool)) { placeOpening(p); return; }
  if (tool === 'item' && pendingItem) { placeItem(p); return; }
  if (tool === 'stair' || tool === 'scale') { const s = snapPoint(p, null); draft = { a: s.p, cursor: s.p }; return; }
});
cv.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (panning) {
    if (panning.pinch && pointers.size === 2) {
      const k = dist2() / panning.pinch, m = mid2(), r = cv.getBoundingClientRect();
      const mx = (panning.mid[0] - r.left) * dpr, my = (panning.mid[1] - r.top) * dpr;
      const wx = mx / panning.view.s + panning.view.x0, wz = my / panning.view.s + panning.view.z0;
      view.s = Math.min(600, Math.max(8, panning.view.s * k));
      view.x0 = wx - ((m[0] - r.left) * dpr) / view.s; view.z0 = wz - ((m[1] - r.top) * dpr) / view.s;
    } else if (!panning.pinch) {
      view.x0 = panning.view.x0 - ((e.clientX - panning.x) * dpr) / view.s; view.z0 = panning.view.z0 - ((e.clientY - panning.y) * dpr) / view.s;
    }
    render(); return;
  }
  const p = evWorld(e);
  $('#coords').textContent = `x ${p[0].toFixed(2)}  z ${p[1].toFixed(2)} m`;
  if (drag) { onDrag(p, e); render(); return; }
  hover = null; snap = null;
  if (tool === 'select') { hover = pick(p); cv.style.cursor = hover ? (hover.type === 'item' || hover.type === 'opening' ? 'move' : 'pointer') : 'default'; }
  else if (tool === 'wall' || tool === 'zone') { const s = snapPoint(p, draft && draft.pts.length ? draft.pts[draft.pts.length - 1] : null, { free: e.altKey }); snap = s; if (draft) draft.cursor = s.p; cv.style.cursor = 'crosshair'; }
  else if (['door', 'window', 'slider'].includes(tool)) hover = { preview: openingPreview(p) };
  else if (tool === 'item') hover = { p: [Math.round(p[0] / 0.05) * 0.05, Math.round(p[1] / 0.05) * 0.05] };
  else if ((tool === 'stair' || tool === 'scale') ) { const s = snapPoint(p, draft && draft.a, {}); snap = s; if (draft) draft.cursor = s.p; }
  $('#snapinfo').textContent = snap ? `吸附：${snap.kind}` : '';
  render();
});
cv.addEventListener('pointerup', e => {
  pointers.delete(e.pointerId);
  if (panning) { if (pointers.size < 2) panning = null; return; }
  if (drag) { drag = null; commit(); return; }
  if (tool === 'stair' && draft && draft.a) {
    const a = draft.a, b = draft.cursor; draft = null;
    if (Math.abs(b[0] - a[0]) > 0.6 && Math.abs(b[1] - a[1]) > 1.5) addStair(a, b);
    render(); return;
  }
  if (tool === 'scale' && draft && draft.a) {
    const a = draft.a, b = draft.cursor;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.2) askScale(a, b); else draft = null;
  }
});
cv.addEventListener('dblclick', () => { if (tool === 'wall' || tool === 'zone') finishDraft(); });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), mx = (e.clientX - r.left) * dpr, my = (e.clientY - r.top) * dpr;
  const [wx, wz] = toWorld(mx, my);
  view.s = Math.min(600, Math.max(8, view.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  view.x0 = wx - mx / view.s; view.z0 = wz - my / view.s;
  render();
}, { passive: false });
const dist2 = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
const mid2 = () => { const [a, b] = [...pointers.values()]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };

function projOn(w, p) { const { ux, uz } = wallFrame(w); return (p[0] - w.a[0]) * ux + (p[1] - w.a[1]) * uz; }
function onDrag(p, e) {
  if (drag.kind === 'item') { drag.item.x = +(Math.round((p[0] - drag.off[0]) / 0.05) * 0.05).toFixed(3); drag.item.z = +(Math.round((p[1] - drag.off[1]) / 0.05) * 0.05).toFixed(3); }
  if (drag.kind === 'opening') { const { len } = wallFrame(drag.w); drag.o.offset = +Math.min(len - drag.o.width, Math.max(0, Math.round((projOn(drag.w, p) - drag.off) / 0.05) * 0.05)).toFixed(3); }
  if (drag.kind === 'end') {
    const s = snapPoint(p, drag.from, { ignore: [drag.w[drag.end], ...drag.linked.map(l => l.w[l.k])], free: e.altKey });
    drag.w[drag.end] = s.p.slice();
    for (const l of drag.linked) l.w[l.k] = s.p.slice();
    snap = s;
  }
  if (drag.kind === 'wall') {
    const { ux, uz } = wallFrame({ a: drag.a0, b: drag.b0 });
    const n = [-uz, ux];
    let d = (p[0] - drag.start[0]) * n[0] + (p[1] - drag.start[1]) * n[1];
    d = Math.round(d / 0.05) * 0.05;
    drag.w.a = [+(drag.a0[0] + n[0] * d).toFixed(3), +(drag.a0[1] + n[1] * d).toFixed(3)];
    drag.w.b = [+(drag.b0[0] + n[0] * d).toFixed(3), +(drag.b0[1] + n[1] * d).toFixed(3)];
    for (const l of drag.linked) l.w[l.k] = drag.w[l.e2].slice();
  }
}

function addWallPoint(q) {
  const a = draft.pts[draft.pts.length - 1];
  if (Math.hypot(q[0] - a[0], q[1] - a[1]) < 0.05) return;
  level().walls.push({ id: `w${Date.now().toString(36)}${level().walls.length}`, a: a.slice(), b: q.slice(), t: 0.12, openings: [], ...(tool === 'zone' ? { kind: 'zone' } : {}) });
  draft.pts.push(q); typed = '';
  // closing a loop ends the chain
  if (Math.hypot(q[0] - draft.pts[0][0], q[1] - draft.pts[0][1]) < 0.01 && draft.pts.length > 2) { draft = null; snap = null; }
  commit();
}
function finishDraft() { draft = null; typed = ''; snap = null; render(); }

function openingPreview(p) {
  const nw = nearestWall(p, 0.6);
  if (!nw || nw.w.kind) return null;
  const def = OPENING[tool];
  const width = Math.min(def.width, nw.len - 0.1);
  const offset = +Math.min(nw.len - width - 0.05, Math.max(0.05, Math.round((nw.t - width / 2) / 0.05) * 0.05)).toFixed(3);
  const ok = !(nw.w.openings || []).some(o => offset < o.offset + o.width && offset + width > o.offset);
  return { w: nw.w, offset, width, ok };
}
function placeOpening(p) {
  const pr = openingPreview(p);
  if (!pr || !pr.ok) return;
  pr.w.openings = pr.w.openings || [];
  const o = { type: tool, offset: pr.offset, ...OPENING[tool], width: pr.width };
  if (tool === 'door' && pr.w.ext && !level().walls.some(w => (w.openings || []).some(x => x.main))) o.main = true;
  pr.w.openings.push(o);
  sel = { type: 'opening', wall: pr.w, opening: o };
  commit();
}
function placeItem(p) {
  const L = level();
  const base = { ...pendingItem }; delete base.group; delete base.label;
  const x = Math.round(p[0] / 0.05) * 0.05, z = Math.round(p[1] / 0.05) * 0.05;
  if (base.kind === 'diningset') {
    const r = itemRot;
    const t = { ...base, kind: 'table', x, z, rot: r };
    L.furniture.push(t);
    const along = [Math.cos((-r * Math.PI) / 180), Math.sin((-r * Math.PI) / 180)];
    const across = [-along[1], along[0]];
    for (const sx of [-0.4, 0.4]) for (const sz of [-1, 1]) L.furniture.push({ kind: 'chair', x: +(x + along[0] * sx + across[0] * sz * 0.72).toFixed(3), z: +(z + along[1] * sx + across[1] * sz * 0.72).toFixed(3), w: 0.46, d: 0.5, rot: r + (sz > 0 ? 180 : 0), name: '餐椅', nameEn: 'Dining chair', price: 6800 });
  } else if (base.kind === 'tvset') {
    const r = itemRot, a = (r * Math.PI) / 180;
    const back = [-Math.sin(a), -Math.cos(a)];
    L.furniture.push({ kind: 'tvwall', x: +(x + back[0] * 0.17).toFixed(3), z: +(z + back[1] * 0.17).toFixed(3), w: base.w, d: 0.08, rot: r, name: '電視主牆', nameEn: 'TV wall', price: base.price });
    L.furniture.push({ kind: 'tvconsole', x, z, w: base.w - 0.6, d: 0.42, rot: r, noTv: true, name: '電視櫃', nameEn: 'TV console', price: 26000 });
  } else {
    const f = { ...base, x, z, rot: itemRot };
    L.furniture.push(f);
    sel = { type: 'item', item: f };
  }
  commit();
}
function addStair(a, b) {
  if (lv === doc.levels.length - 1) doc.levels.push(newLevel(lv + 1, level()));
  const st = { id: `S${doc.stairs.length + 1}`, from: level().id, to: doc.levels[lv + 1].id, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), zStart: a[1], zEnd: b[1], risers: Math.max(14, Math.round(level().height / 0.175)), name: '直跑樓梯', nameEn: 'Straight stair' };
  doc.stairs.push(st);
  buildLevelTabs();
  sel = { type: 'stair', stair: st };
  commit();
}
function askScale(a, b) {
  const box = $('#scale-ask');
  box.hidden = false;
  const input = $('#scale-len');
  input.value = '';
  input.focus();
  box.onsubmit = ev => {
    ev.preventDefault();
    const real = parseLen(input.value);
    if (!real) return;
    const cur = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = real / cur;
    // scale the image about point a
    underlay.mpp *= k;
    underlay.x = a[0] + (underlay.x - a[0]) * k;
    underlay.z = a[1] + (underlay.z - a[1]) * k;
    box.hidden = true; draft = null; setTool('wall'); fitView(); toast(`底圖比例已設定：${m2(real)}`);
  };
}
// "360" -> 3.60 m (cm), "3.6" -> 3.6 m, "3600mm" -> 3.6 m
function parseLen(s) {
  s = String(s).trim().toLowerCase();
  if (!s) return null;
  const v = parseFloat(s);
  if (!isFinite(v) || v <= 0) return null;
  if (s.endsWith('mm')) return v / 1000;
  if (s.endsWith('cm')) return v / 100;
  if (s.endsWith('m')) return v;
  if (s.includes('.') || v <= 30) return v;
  return v >= 1000 ? v / 1000 : v / 100;
}

addEventListener('keydown', e => {
  if (e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') { spaceDown = true; cv.style.cursor = 'grab'; e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redoStep() : undoStep(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redoStep(); return; }
  if ((tool === 'wall' || tool === 'zone') && draft && draft.pts.length) {
    if (/^[0-9.]$/.test(e.key) || (typed && /^[cm]$/.test(k))) { typed += e.key; render(); return; }
    if (e.key === 'Backspace' && typed) { typed = typed.slice(0, -1); render(); return; }
    if (e.key === 'Enter' && typed) {
      const len = parseLen(typed); typed = '';
      if (len) { const a = draft.pts[draft.pts.length - 1], c = draft.cursor || a; let dx = c[0] - a[0], dz = c[1] - a[1]; const d = Math.hypot(dx, dz) || 1; if (Math.hypot(dx, dz) < 1e-6) { dx = 1; dz = 0; } addWallPoint([+(a[0] + (dx / d) * len).toFixed(3), +(a[1] + (dz / d) * len).toFixed(3)]); }
      return;
    }
  }
  if (e.key === 'Escape') { if (draft) finishDraft(); else { sel = null; pendingItem = null; setTool('select'); } return; }
  if (e.key === 'Enter' && draft) { finishDraft(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { deleteSel(); e.preventDefault(); return; }
  if (k === 'r' && (tool === 'item' || (sel && sel.type === 'item'))) { if (sel && sel.type === 'item' && tool === 'select') { sel.item.rot = ((sel.item.rot || 0) + 90) % 360; commit(); } else { itemRot = (itemRot + 90) % 360; render(); } return; }
  for (const [name, t] of Object.entries(TOOLS)) if (t.key === k && !e.ctrlKey && !e.metaKey) { setTool(name); return; }
});
addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; cv.style.cursor = ''; } });

function deleteSel() {
  const L = level();
  if (sel.type === 'wall') L.walls.splice(L.walls.indexOf(sel.wall), 1);
  if (sel.type === 'opening') sel.wall.openings.splice(sel.wall.openings.indexOf(sel.opening), 1);
  if (sel.type === 'item') L.furniture.splice(L.furniture.indexOf(sel.item), 1);
  if (sel.type === 'stair') doc.stairs.splice(doc.stairs.indexOf(sel.stair), 1);
  sel = null; commit();
}

// ---------------------------------------------------------------- UI
function setTool(t) {
  tool = t; draft = null; typed = ''; snap = null; hover = null;
  document.querySelectorAll('#tools button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  $('#hint').textContent = TOOLS[t].hint;
  $('#catalog').hidden = t !== 'item';
  cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
  if (t === 'scale' && !underlay.imgEl) toast('先匯入一張平面圖圖片，再設定比例。');
  render();
}
document.querySelectorAll('#tools button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

function buildCatalog() {
  const host = $('#catalog-list');
  let g = null, grp;
  for (const it of ITEMS) {
    if (it.group !== g) { g = it.group; grp = document.createElement('div'); grp.className = 'cat-group'; grp.innerHTML = `<span>${g}</span>`; host.appendChild(grp); }
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = it.label;
    b.addEventListener('click', () => { pendingItem = it; host.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
    grp.appendChild(b);
  }
}

function buildLevelTabs() {
  const host = $('#levels');
  host.innerHTML = '';
  doc.levels.forEach((L, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = L.id; b.setAttribute('aria-pressed', String(i === lv));
    b.addEventListener('click', () => { lv = i; sel = null; draft = null; buildLevelTabs(); refreshPanel(); render(); });
    host.appendChild(b);
  });
  const add = document.createElement('button'); add.type = 'button'; add.textContent = '+ 樓層'; add.className = 'add';
  add.addEventListener('click', () => { doc.levels.push(newLevel(doc.levels.length, doc.levels[doc.levels.length - 1])); lv = doc.levels.length - 1; buildLevelTabs(); commit(); toast(`已新增 ${level().id}，外牆已從下層複製`); });
  host.appendChild(add);
}

function field(label, value, onChange, opts = {}) {
  const id = `f${Math.random().toString(36).slice(2, 8)}`;
  const wrap = document.createElement('label'); wrap.className = 'field'; wrap.htmlFor = id;
  wrap.innerHTML = `<span>${label}</span>`;
  let el;
  if (opts.options) { el = document.createElement('select'); for (const [v, t] of opts.options) { const o = document.createElement('option'); o.value = v; o.textContent = t; el.appendChild(o); } el.value = value; }
  else if (opts.check) { el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!value; }
  else { el = document.createElement('input'); el.type = opts.type || 'text'; el.value = value; if (opts.step) el.step = opts.step; }
  el.id = id;
  el.addEventListener('change', () => { onChange(opts.check ? el.checked : el.type === 'number' ? parseFloat(el.value) : el.value); commit(); });
  wrap.appendChild(el);
  if (opts.unit) { const u = document.createElement('em'); u.textContent = opts.unit; wrap.appendChild(u); }
  return wrap;
}
function refreshPanel() {
  const host = $('#props'); host.innerHTML = '';
  const h = (t, sub) => { const d = document.createElement('div'); d.className = 'ph'; d.innerHTML = `<h2>${t}</h2>${sub ? `<span>${sub}</span>` : ''}`; host.appendChild(d); };
  const btn = (t, fn, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.className = cls; b.addEventListener('click', fn); host.appendChild(b); return b; };
  if (sel && sel.type === 'wall') {
    const w = sel.wall, { len } = wallFrame(w);
    h('牆', w.kind === 'zone' ? '區域分界' : w.kind === 'railing' ? '欄杆' : w.ext ? '外牆' : '內牆');
    host.append(
      field('長度', +(len * 100).toFixed(0), v => { const L2 = v / 100; const { ux, uz } = wallFrame(w); w.b = [+(w.a[0] + ux * L2).toFixed(3), +(w.a[1] + uz * L2).toFixed(3)]; }, { type: 'number', unit: 'cm' }),
      field('牆厚', +(w.t * 100).toFixed(0), v => { w.t = v / 100; w.tLocked = true; }, { type: 'number', unit: 'cm' }),
      field('類型', w.kind || 'wall', v => { if (v === 'wall') delete w.kind; else w.kind = v; }, { options: [['wall', '牆'], ['railing', '陽台欄杆'], ['zone', '區域分界（不建牆）']] }),
    );
    btn('刪除牆', deleteSel, 'danger');
  } else if (sel && sel.type === 'opening') {
    const o = sel.opening;
    h('開口', { door: '門', window: '窗', slider: '落地拉門', passage: '開口' }[o.type]);
    host.append(
      field('類型', o.type, v => { Object.assign(o, { ...OPENING[v], width: o.width, type: v }); }, { options: [['door', '門'], ['window', '窗'], ['slider', '落地拉門'], ['passage', '無門開口']] }),
      field('寬度', Math.round(o.width * 100), v => { o.width = v / 100; }, { type: 'number', unit: 'cm' }),
      field('距牆起點', Math.round(o.offset * 100), v => { o.offset = v / 100; }, { type: 'number', unit: 'cm' }),
      field('窗台高', Math.round(o.sill * 100), v => { o.sill = v / 100; }, { type: 'number', unit: 'cm' }),
      field('頂高', Math.round(o.head * 100), v => { o.head = v / 100; }, { type: 'number', unit: 'cm' }),
    );
    if (o.type === 'door') host.append(field('大門（入口）', o.main, v => { for (const L of doc.levels) for (const w of L.walls) for (const x of w.openings || []) delete x.main; if (v) o.main = true; }, { check: true }));
    btn('刪除開口', deleteSel, 'danger');
  } else if (sel && sel.type === 'room') {
    const r = sel.room, a = polygonArea(r.polygon);
    h(r.name, `${a.toFixed(1)} m² · ${toPing(a).toFixed(1)} 坪`);
    host.append(
      field('名稱', r.name, v => { r.name = v; if (EN[v]) r.nameEn = EN[v]; }),
      field('英文', r.nameEn || '', v => { r.nameEn = v; }),
      field('地坪類型', r.outdoor ? 'balcony' : r.finish, v => { r.finish = v; r.outdoor = v === 'balcony'; r.wet = v === 'tile'; }, { options: [['floor', '室內地坪（套用材質）'], ['tile', '濕區磁磚'], ['balcony', '陽台（戶外）']] }),
      field('走道／過道', r.circulation, v => { r.circulation = v; }, { check: true }),
    );
    const quick = document.createElement('div'); quick.className = 'quick';
    for (const [n, en, fin] of [['客廳', 'Living', 'floor'], ['餐廳', 'Dining', 'floor'], ['廚房', 'Kitchen', 'floor'], ['主臥', 'Master Bedroom', 'floor'], ['次臥', 'Bedroom', 'floor'], ['書房', 'Study', 'floor'], ['衛浴', 'Bathroom', 'tile'], ['玄關', 'Entrance', 'floor'], ['陽台', 'Balcony', 'balcony'], ['走道', 'Hall', 'floor']]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = n;
      b.addEventListener('click', () => { r.name = n; r.nameEn = en; r.finish = fin; r.outdoor = fin === 'balcony'; r.wet = fin === 'tile'; r.circulation = n === '走道'; commit(); });
      quick.appendChild(b);
    }
    host.appendChild(quick);
  } else if (sel && sel.type === 'item') {
    const f = sel.item;
    h(f.name || f.kind, f.nameEn || '');
    host.append(
      field('寬', Math.round(f.w * 100), v => { f.w = v / 100; }, { type: 'number', unit: 'cm' }),
      field('深', Math.round(f.d * 100), v => { f.d = v / 100; }, { type: 'number', unit: 'cm' }),
      field('旋轉', f.rot || 0, v => { f.rot = v; }, { options: [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']].map(([v, t]) => [String(v), t]) }),
      field('單價', f.price || 0, v => { f.price = v; }, { type: 'number', unit: 'NT$' }),
    );
    btn('旋轉 90°（R）', () => { f.rot = ((f.rot || 0) + 90) % 360; commit(); });
    btn('刪除', deleteSel, 'danger');
  } else if (sel && sel.type === 'stair') {
    const st = sel.stair;
    h('樓梯', `${st.from} → ${st.to}`);
    host.append(field('踏階數', st.risers, v => { st.risers = Math.max(8, Math.round(v)); }, { type: 'number' }));
    btn('反轉方向', () => { [st.zStart, st.zEnd] = [st.zEnd, st.zStart]; commit(); });
    btn('刪除樓梯', deleteSel, 'danger');
  } else {
    h('專案', doc.project.name);
    host.append(
      field('案名', doc.project.name, v => { doc.project.name = v; }),
      field('建築類型', doc.project.type || 'apartment', v => { doc.project.type = v; }, { options: [['apartment', '大樓住宅（含城市景觀）'], ['townhouse', '透天／獨棟']] }),
      field('所在樓層', doc.project.floor || 9, v => { doc.project.floor = v; }, { type: 'number', unit: 'F' }),
      field(`${level().id} 樓高`, Math.round(level().height * 100), v => { const L = level(); L.height = v / 100; let e = 0; for (const x of doc.levels) { x.elevation = e; e += x.height; } }, { type: 'number', unit: 'cm' }),
    );
  }
  // room schedule
  const L = level();
  const rooms = L.rooms;
  const sum = rooms.filter(r => !r.outdoor).reduce((s, r) => s + polygonArea(r.polygon), 0);
  const t = document.createElement('table'); t.className = 'sched';
  t.innerHTML = `<thead><tr><th>${L.id} 房間</th><th class="num">m²</th><th class="num">坪</th></tr></thead><tbody>${rooms.map(r => `<tr data-id="${r.id}"><td>${r.name}${r.outdoor ? ' <small>戶外</small>' : ''}</td><td class="num">${polygonArea(r.polygon).toFixed(1)}</td><td class="num">${toPing(polygonArea(r.polygon)).toFixed(1)}</td></tr>`).join('')}</tbody><tfoot><tr><td>室內合計</td><td class="num">${sum.toFixed(1)}</td><td class="num">${toPing(sum).toFixed(1)}</td></tr></tfoot>`;
  t.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => { sel = { type: 'room', room: rooms.find(r => r.id === tr.dataset.id) }; refreshPanel(); render(); }));
  if (!rooms.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '畫出封閉的牆，房間會自動出現並計算面積。'; host.appendChild(p); }
  else host.appendChild(t);
  $('#stat').textContent = `${doc.levels.length} 層 · ${doc.levels.reduce((n, l) => n + l.walls.length, 0)} 道牆 · ${doc.levels.reduce((n, l) => n + l.rooms.length, 0)} 個房間`;
}

let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

// ---------------------------------------------------------------- files
$('#btn-new').addEventListener('click', () => { if (doc.levels.some(L => L.walls.length) && !window.confirm('清除目前的平面圖，開始新專案？')) return; underlay = { ...underlay, imgEl: null, dxf: null }; loadDoc(blank()); setTool('wall'); });
$('#btn-sample').addEventListener('change', async e => {
  const v = e.target.value; e.target.value = '';
  if (!v) return;
  if (v === 'dxf') { const t = await (await fetch('samples/sample-2br-apartment.dxf')).text(); importDXF(t, 'sample-2br-apartment.dxf'); return; }
  const d = await (await fetch(`data/${v}.json`)).json();
  loadDoc(fromBuiltIn(d));
});
function fromBuiltIn(d) {
  const out = { project: { name: d.project.name, type: d.project.type || 'townhouse', floor: d.project.site ? d.project.site.floor : 1 }, levels: [], stairs: JSON.parse(JSON.stringify(d.stairs || [])) };
  for (const L of d.levels) {
    const walls = JSON.parse(JSON.stringify(L.walls)).map(w => { delete w.outdoor; delete w.h; return w; });
    for (const r of L.railings || []) if (!r.solid) walls.push({ id: `rl${walls.length}`, a: r.a, b: r.b, t: 0.06, kind: 'railing', openings: [] }); else walls.push({ id: `rl${walls.length}`, a: r.a, b: r.b, t: 0.15, openings: [] });
    out.levels.push({ id: L.id, name: L.name, elevation: L.elevation, height: L.height, walls, rooms: JSON.parse(JSON.stringify(L.rooms)), furniture: JSON.parse(JSON.stringify(L.furniture)) });
  }
  return out;
}
$('#file-dxf').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; importDXF(await f.text(), f.name); e.target.value = ''; });
$('#file-img').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => { underlay.imgEl = img; underlay.mpp = 12 / img.width; underlay.x = 0; underlay.z = 0; $('#ul-img').hidden = false; fitView(); setTool('scale'); toast('底圖已載入：點兩個已知距離的點設定比例（例如一道標有尺寸的牆）'); };
  img.src = URL.createObjectURL(f);
  e.target.value = '';
});
$('#ul-opacity').addEventListener('input', e => { underlay.opacity = +e.target.value; render(); });
$('#ul-remove').addEventListener('click', () => { underlay.imgEl = null; $('#ul-img').hidden = true; render(); });
$('#file-json').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); loadDoc(d.levels && d.levels[0] && d.levels[0].walls && !d.story ? d : fromBuiltIn(d)); } catch (err) { toast('無法讀取這個 JSON 檔'); } e.target.value = ''; });
$('#btn-download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${doc.project.name || 'plan'}.spatial.json`; a.click();
});
$('#btn-3d').addEventListener('click', open3D);
async function open3D() {
  if (!doc.levels[0].rooms.length) { toast('還沒有封閉的房間：先畫出外牆和隔間。'); return; }
  const base = await (await fetch('data/apartment.json')).json();
  const full = completePlan(doc, base);
  try { localStorage.setItem('spatial.custom', JSON.stringify(full)); } catch { toast('瀏覽器儲存空間不足'); return; }
  location.href = 'index.html?p=custom';
}

function importDXF(text, name) {
  let d;
  try { d = parseDXF(text); } catch (err) { console.error(err); toast('DXF 讀取失敗：請另存為 ASCII DXF（R2010 或更舊）'); return; }
  if (!d.segs.length) { toast('這個 DXF 沒有可用的線條'); return; }
  underlay.dxf = d;
  const wallish = Object.keys(d.layers).filter(l => /wall|牆|a-wall|壁/i.test(l));
  underlay.dxfLayers = new Set(Object.keys(d.layers));
  buildLayerList(wallish);
  $('#ul-dxf').hidden = false;
  $('#dxf-name').textContent = `${name} · ${(d.units * 1000).toFixed(0) === '1' ? 'mm' : d.units === 0.01 ? 'cm' : 'm'} · ${d.segs.length} 線段`;
  fitView();
  toast('DXF 已載入。勾選牆線圖層後按「自動辨識牆體」，或直接沿著藍線描牆。');
}
function buildLayerList(wallish) {
  const host = $('#dxf-layers'); host.innerHTML = '';
  for (const [name, n] of Object.entries(underlay.dxf.layers).sort((a, b) => b[1] - a[1])) {
    const row = document.createElement('label'); row.className = 'layer';
    row.innerHTML = `<input type="checkbox" ${underlay.dxfLayers.has(name) ? 'checked' : ''}><span>${name}</span><em>${n}</em><input type="radio" name="wl" title="牆線圖層" ${wallish.includes(name) || (!wallish.length && n === Math.max(...Object.values(underlay.dxf.layers))) ? 'checked' : ''} value="${name}">`;
    row.querySelector('input[type=checkbox]').addEventListener('change', e => { e.target.checked ? underlay.dxfLayers.add(name) : underlay.dxfLayers.delete(name); render(); });
    host.appendChild(row);
  }
}
$('#dxf-detect').addEventListener('click', () => {
  const layer = ($('#dxf-layers input[type=radio]:checked') || {}).value;
  const segs = underlay.dxf.segs.filter(s => s.layer === layer);
  const others = underlay.dxf.segs.filter(s => s.layer !== layer && !s.arc);
  const walls = closeCorners(detectWalls(segs, { others }));
  if (!walls.length) { toast('這個圖層找不到成對的牆線，請改選圖層或手動描繪'); return; }
  const L = level();
  sel = null;
  L.walls = walls.map((w, i) => ({ id: `d${i}`, ...w }));
  detectRooms(L);
  // name rooms from DXF text inside them
  for (const r of L.rooms) {
    const t = underlay.dxf.texts.find(t => pointInPolygon(t.p, r.polygon) && /[一-鿿]|room|bed|living|kitchen|bath/i.test(t.text));
    if (t) { r.name = t.text.slice(0, 8); r.nameEn = EN[r.name] || ''; if (/陽台|露台|balcony/i.test(t.text)) { r.outdoor = true; r.finish = 'balcony'; } if (/浴|廁|bath|wc/i.test(t.text)) { r.finish = 'tile'; r.wet = true; } }
  }
  // the exterior door closest to an "entrance" label is the main door
  const ent = underlay.dxf.texts.find(t => /玄關|入口|entry|entrance/i.test(t.text));
  let best = null;
  for (const w of L.walls) { if (!w.ext) continue; const { ux, uz } = wallFrame(w); for (const o of w.openings) if (o.type === 'door') { const m = [w.a[0] + ux * (o.offset + o.width / 2), w.a[1] + uz * (o.offset + o.width / 2)]; const d = ent ? Math.hypot(m[0] - ent.p[0], m[1] - ent.p[1]) : 0; if (!best || d < best.d) best = { o, d }; } }
  if (best) best.o.main = true;
  commit();
  toast(`辨識出 ${walls.length} 道牆、${L.rooms.length} 個房間。請檢查門窗類型與房間名稱。`);
});
$('#dxf-opacity').addEventListener('input', e => { underlay.dxfOpacity = +e.target.value; render(); });
$('#dxf-remove').addEventListener('click', () => { underlay.dxf = null; $('#ul-dxf').hidden = true; render(); });

// ---------------------------------------------------------------- boot
buildCatalog();
const params = new URLSearchParams(location.search);
let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch {}
addEventListener('resize', resize);
(async () => {
  const from = params.get('from');
  if (from && from !== 'custom') { const d = await (await fetch(`data/${from === 'townhouse' ? 'house' : from}.json`)).json(); loadDoc(fromBuiltIn(d), false); }
  else if (saved && saved.levels) loadDoc(saved, false);
  else loadDoc(blank(), false);
  resize(); fitView();
  setTool(doc.levels[0].walls.length ? 'select' : 'wall');
  window.__editor = { get doc() { return doc; }, loadDoc, importDXF, open3D, setTool, commit, view, fitView, level };
})();
