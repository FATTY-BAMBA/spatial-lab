// PrimeStride Spatial Lab — plan editor.
// Draw walls, place doors/windows, rooms are detected automatically, place furniture,
// trace over a photo/scan or a DXF, then open the result in 3D.
import { polygonArea, bbox, toPing, wallFrame, pointInPolygon, itemFootprint } from '../plan.js';
import { drawLevel } from '../drawing.js';
import { detectRooms, completePlan, labelPoint } from './geometry.js';
import { stairLocal, stairBox } from '../plan.js';
import * as Cloud from '../cloud.js';
import { parseDXF, decodeDXF, defaultWallLayers, wallsFromDXF } from './dxf.js';
import { extractPlanLines, wallsFromImage } from './raster.js';
import { findIssues, applyFix, fixAll } from './issues.js';
import { autoFurnish } from './furnish.js';
import { isEn, t, unitLabel, translateDom, langSwitch } from '../i18n.js';

// ---------------------------------------------------------------- language
// Static text in editor.html; everything generated below goes through t('中文', 'English').
translateDom({
  '回到 Spatial Lab': 'Back to Spatial Lab',
  '平面編輯器': 'Plan Editor',
  '新專案': 'New project',
  '開啟範例': 'Open sample',
  '大樓 3 房 2 廳': 'Apartment · 3 bed',
  '透天 2 樓': 'Townhouse · 2 floors',
  'DXF 範例：2房公寓': 'DXF sample: 2-bed apartment',
  '匯入 DXF': 'Import DXF',
  '匯入平面圖圖片／PDF': 'Import plan image / PDF',
  '先校正比例再辨識，門寬與房間大小才會準確。': 'Set the scale before detecting so door widths and room sizes come out right.',
  '開啟 JSON': 'Open JSON',
  '下載 JSON': 'Download JSON',
  '在 3D 中查看': 'View in 3D',
  '工具': 'Tools',
  '選取 (V)': 'Select (V)', '選取': 'Select',
  '牆 (W)': 'Wall (W)', '牆': 'Wall',
  '門 (D)': 'Door (D)', '門': 'Door',
  '窗 (N)': 'Window (N)', '窗': 'Window',
  '落地拉門 (S)': 'Sliding door (S)', '拉門': 'Sliding door',
  '區域分界 (Z)': 'Zone divider (Z)', '分界': 'Divider',
  '家具 (F)': 'Furniture (F)', '家具': 'Furniture',
  '樓梯 (T)': 'Stairs (T)', '樓梯': 'Stairs',
  '底圖比例 (K)': 'Underlay scale (K)', '比例': 'Scale',
  '平面圖編輯區': 'Plan drawing area',
  '樓層': 'Levels',
  '選一件，點擊平面放置；R 旋轉。': 'Pick an item, then click the plan to place it. R rotates.',
  '這兩點的實際距離？': 'Real distance between these two points?',
  '例如 360（cm）或 3.6（m）': 'e.g. 360 (cm) or 3.6 (m)',
  '設定比例': 'Set scale',
  '平面圖底圖': 'Plan underlay',
  '底圖透明度': 'Underlay opacity',
  '重新設定比例': 'Set scale again',
  '移除底圖': 'Remove underlay',
  'DXF 底圖': 'DXF underlay',
  'DXF 透明度': 'DXF opacity',
  '自動辨識牆體': 'Detect walls',
  '移除': 'Remove',
  '左框：顯示圖層；右框：牆線圖層（可多選）。描牆時會吸附 DXF 端點。': 'Left box: show layer. Right box: wall layers (pick several). Wall tracing snaps to DXF endpoints.',
  '滾輪縮放 · 空白鍵/右鍵拖曳平移 · Ctrl+Z 復原': 'Scroll to zoom · Space or right-drag to pan · Ctrl+Z to undo',
});
if (isEn) document.title = 'Spatial Lab Plan Editor';
{
  // keep the page's own path (editor.html locally, /editor with clean URLs) so the switch works on any static server
  const sw = langSwitch('lang-switch');
  for (const a of sw.querySelectorAll('a')) { const u = new URL(a.href); a.href = location.pathname + u.search + u.hash; }
  document.querySelector('#btn-3d').before(sw);
}
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
// snap kinds stay Chinese internally (they are compared below); this is only for display
const SNAP_EN = { 端點: 'Endpoint', 'DXF 端點': 'DXF endpoint', 牆上: 'On wall', 格點: 'Grid', '45°': '45°', 正交: 'Ortho', 對齊: 'Aligned' };
const snapLabel = k => t(k, SNAP_EN[k] || k);
const roomName = r => (isEn ? r.nameEn || r.name : r.name);

const $ = s => document.querySelector(s);
const cv = $('#ed'), ctx = cv.getContext('2d');
const dpr = Math.min(devicePixelRatio || 1, 2);
const STORE = 'spatial.editor.doc';
const fmt = n => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const m2 = v => `${v.toFixed(2)} m`;

// ---------------------------------------------------------------- catalogue
const ITEMS = [
  { group: '客廳', groupEn: 'Living', label: '絲絨沙發', labelEn: 'Velvet sofa', kind: 'model', model: 'GlamVelvetSofa', w: 2.19, d: 1.02, name: '絲絨弧形沙發', nameEn: 'Velvet sofa', price: 72000 },
  { group: '客廳', groupEn: 'Living', label: '單椅', labelEn: 'Lounge chair', kind: 'model', model: 'SheenChair', w: 0.83, d: 0.57, name: '單椅', nameEn: 'Lounge chair', price: 18800 },
  { group: '客廳', groupEn: 'Living', label: '茶几', labelEn: 'Coffee table', kind: 'roundtable', w: 0.9, d: 0.9, name: '大理石茶几', nameEn: 'Coffee table', price: 16000 },
  { group: '客廳', groupEn: 'Living', label: '坐墩', labelEn: 'Pouf', kind: 'model', model: 'SpecularSilkPouf', w: 0.61, d: 0.61, name: '坐墩', nameEn: 'Pouf', price: 5200 },
  { group: '客廳', groupEn: 'Living', label: '電視牆組', labelEn: 'TV wall set', kind: 'tvset', w: 3.0, d: 0.42, name: '電視主牆', nameEn: 'TV wall', price: 45000 },
  { group: '客廳', groupEn: 'Living', label: '地毯', labelEn: 'Rug', kind: 'rug', w: 2.4, d: 1.7, name: '地毯', nameEn: 'Rug', price: 9800 },
  { group: '客廳', groupEn: 'Living', label: '植栽', labelEn: 'Plant', kind: 'model', model: 'DiffuseTransmissionPlant', w: 0.7, d: 0.66, scale: 1.3, name: '植栽', nameEn: 'Plant', price: 3200 },
  { group: '客廳', groupEn: 'Living', label: '窗簾', labelEn: 'Curtain', kind: 'curtain', w: 2.0, d: 0.18, name: '窗簾', nameEn: 'Curtain', price: 9000 },
  { group: '餐廚', groupEn: 'Kitchen & dining', label: '餐桌組 (4人)', labelEn: 'Dining set (4)', kind: 'diningset', w: 1.8, d: 0.9, name: '餐桌', nameEn: 'Dining table', price: 38000 },
  { group: '餐廚', groupEn: 'Kitchen & dining', label: '餐椅', labelEn: 'Dining chair', kind: 'chair', w: 0.46, d: 0.5, name: '餐椅', nameEn: 'Dining chair', price: 6800 },
  { group: '餐廚', groupEn: 'Kitchen & dining', label: '廚具 (一字型)', labelEn: 'Kitchen (straight)', kind: 'counter', w: 2.4, d: 0.6, counter: true, cabinet: true, sink: true, name: '廚具', nameEn: 'Kitchen run', price: 0 },
  { group: '餐廚', groupEn: 'Kitchen & dining', label: '吊櫃', labelEn: 'Upper cabinets', kind: 'uppercab', w: 2.0, d: 0.35, cabinet: true, name: '吊櫃', nameEn: 'Upper cabinets', price: 0 },
  { group: '餐廚', groupEn: 'Kitchen & dining', label: '冰箱', labelEn: 'Refrigerator', kind: 'fridge', w: 0.75, d: 0.7, name: '冰箱', nameEn: 'Refrigerator', price: 52000 },
  { group: '餐廚', groupEn: 'Kitchen & dining', label: '餐邊櫃', labelEn: 'Sideboard', kind: 'sideboard', w: 1.6, d: 0.45, name: '餐邊櫃', nameEn: 'Sideboard', price: 28000 },
  { group: '臥室', groupEn: 'Bedroom', label: '雙人床 6尺', labelEn: 'Bed 180 cm', kind: 'bed', w: 1.8, d: 2.1, name: '雙人床', nameEn: 'Queen bed', price: 45000 },
  { group: '臥室', groupEn: 'Bedroom', label: '雙人床 5尺', labelEn: 'Bed 150 cm', kind: 'bed', w: 1.5, d: 2.0, name: '雙人床', nameEn: 'Double bed', price: 32000 },
  { group: '臥室', groupEn: 'Bedroom', label: '床頭櫃', labelEn: 'Nightstand', kind: 'nightstand', w: 0.45, d: 0.42, name: '床頭櫃', nameEn: 'Nightstand', price: 6500 },
  { group: '臥室', groupEn: 'Bedroom', label: '系統衣櫃', labelEn: 'Wardrobe', kind: 'wardrobe', w: 1.8, d: 0.6, h: 2.4, name: '系統衣櫃', nameEn: 'Wardrobe', price: 48000 },
  { group: '臥室', groupEn: 'Bedroom', label: '書桌', labelEn: 'Desk', kind: 'desk', w: 1.4, d: 0.65, name: '書桌', nameEn: 'Desk', price: 16000 },
  { group: '臥室', groupEn: 'Bedroom', label: '書櫃', labelEn: 'Bookcase', kind: 'shelf', w: 1.8, d: 0.34, h: 2.2, name: '書櫃', nameEn: 'Bookcase', price: 22000 },
  { group: '衛浴', groupEn: 'Bath', label: '馬桶', labelEn: 'Toilet', kind: 'toilet', w: 0.4, d: 0.65, name: '馬桶', nameEn: 'Toilet', price: 15000 },
  { group: '衛浴', groupEn: 'Bath', label: '浴櫃', labelEn: 'Vanity', kind: 'vanity', w: 0.8, d: 0.45, name: '浴櫃', nameEn: 'Vanity', price: 16000 },
  { group: '衛浴', groupEn: 'Bath', label: '淋浴拉門', labelEn: 'Shower screen', kind: 'shower', w: 1.2, d: 0.9, name: '淋浴拉門', nameEn: 'Shower screen', price: 14000 },
  { group: '衛浴', groupEn: 'Bath', label: '浴缸', labelEn: 'Bathtub', kind: 'tub', w: 1.6, d: 0.75, name: '浴缸', nameEn: 'Bathtub', price: 38000 },
  { group: '其他', groupEn: 'Other', label: '玄關櫃', labelEn: 'Entry cabinet', kind: 'tallcab', w: 1.8, d: 0.4, h: 2.4, cabinet: true, name: '玄關櫃', nameEn: 'Entry cabinet', price: 42000 },
  { group: '其他', groupEn: 'Other', label: '洗衣機', labelEn: 'Washer', kind: 'washer', w: 0.6, d: 0.6, name: '洗衣機', nameEn: 'Washer', price: 24000 },
];
const EN = { 主臥: 'Master Bedroom', 主臥室: 'Master Bedroom', 次臥: 'Bedroom', 臥室: 'Bedroom', 小孩房: "Kid's Room", 客廳: 'Living', 餐廳: 'Dining', 客餐廳: 'Living & Dining', 廚房: 'Kitchen', 衛浴: 'Bathroom', 浴室: 'Bathroom', 主浴: 'Master Bath', 玄關: 'Entrance', 陽台: 'Balcony', 前陽台: 'Balcony', 後陽台: 'Service Balcony', 書房: 'Study', 走道: 'Hall', 儲藏室: 'Storage', 更衣室: 'Walk-in Closet', 和室: 'Tatami Room' };
const ZH = Object.fromEntries(Object.entries(EN).reverse().map(([zh, en]) => [en.toLowerCase(), zh]));
const OPENING = {
  door: { width: 0.9, sill: 0, head: 2.1 },
  window: { width: 1.5, sill: 0.9, head: 2.2 },
  slider: { width: 2.4, sill: 0, head: 2.4, panels: 2 },
  passage: { width: 1.2, sill: 0, head: 2.4 },
};
const TOOLS = {
  select: { key: 'v', hint: t('點選物件；拖曳移動；拖曳牆端點改長度。Delete 刪除，Ctrl+Z 復原。', 'Click to select; drag to move; drag a wall end to change its length. Delete removes, Ctrl+Z undoes.') },
  wall: { key: 'w', hint: t('點擊起點、連續點擊畫牆；直接輸入長度（cm 或 m）按 Enter。雙擊或 Esc 結束。', 'Click a start point, then keep clicking to draw walls. Type a length (cm or m) and press Enter. Double-click or Esc to finish.') },
  door: { key: 'd', hint: t('點牆面放門。', 'Click a wall to place a door.') },
  window: { key: 'n', hint: t('點牆面放窗。', 'Click a wall to place a window.') },
  slider: { key: 's', hint: t('點牆面放落地拉門。', 'Click a wall to place a sliding door.') },
  zone: { key: 'z', hint: t('畫虛線分界，把開放空間分成兩個房間（例如客廳／餐廳）。', 'Draw a dashed divider to split an open space into two rooms (e.g. living / dining).') },
  item: { key: 'f', hint: t('從右側選家具，點擊放置；R 旋轉 90°。', 'Pick furniture on the right, then click to place it. R rotates 90°.') },
  stair: { key: 't', hint: t('拖出樓梯範圍：從樓梯起點拖到終點（沿上下方向）。會自動建立上一層。', 'Drag out the stair: from its bottom step to its top, along the run. The level above is added automatically.') },
  scale: { key: 'k', hint: t('底圖比例：點兩個已知距離的點，再輸入實際長度。', 'Underlay scale: click two points a known distance apart, then type the real length.') },
};

// ---------------------------------------------------------------- state
let doc = null;
let lv = 0;
let tool = 'select';
let sel = null; // {type, wall, opening, room, item, stair}
let hover = null;
let view = { x0: -2, z0: -2, s: 60 };
let underlay = { img: null, imgEl: null, x: 0, z: 0, mpp: 0.01, opacity: 0.55, dxf: null, dxfLayers: new Set(), wallLayers: new Set(), dxfOpacity: 0.7 };
let draft = null; // wall drawing { pts: [...] }
let typed = '';
let pendingItem = null; // catalogue entry to place
let itemRot = 0;
let snap = null;
let undo = [], redo = [];

function blank() {
  return { project: { name: '新專案', nameEn: 'New project', type: 'apartment', floor: 9 }, levels: [newLevel(0)], stairs: [] };
}
function newLevel(i, below) {
  const id = `${i + 1}F`;
  const L = { id, name: ['一樓', '二樓', '三樓', '四樓', '五樓'][i] || `${i + 1}樓`, nameEn: ['Ground floor', 'Second floor', 'Third floor', 'Fourth floor', 'Fifth floor'][i] || `Floor ${i + 1}`, elevation: below ? below.elevation + below.height : 0, height: 3.0, walls: [], rooms: [], furniture: [] };
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
function save() { try { localStorage.setItem(STORE, JSON.stringify(doc)); } catch {} cloudSoon(); }

// ---------------------------------------------------------------- cloud (signed-in designers)
// Plans save to the account a moment after each change; ?id= opens a saved project, ?new=1 starts a fresh one.
const cloud = { user: null, id: null, timer: 0, busy: false, again: false, ready: false };
function cloudStatus(text, cls = '') { const e = $('#cloud-status'); if (e) { e.textContent = text; e.className = `cloud-status ${cls}`; } }
function cloudSoon() {
  if (!cloud.ready || !cloud.user) return;
  if (!cloud.id && !doc.levels.some(L => L.walls.length)) return; // nothing worth saving yet
  clearTimeout(cloud.timer); cloudStatus(t('儲存中…', 'Saving…'));
  cloud.timer = setTimeout(cloudSave, 1500);
}
async function cloudSave() {
  if (cloud.busy) { cloud.again = true; return; }
  cloud.busy = true;
  try {
    const id = await Cloud.saveProject({ id: cloud.id, name: doc.project.name, doc, thumb: planThumb() });
    if (!cloud.id) { cloud.id = id; const u = new URL(location.href); u.searchParams.delete('new'); u.searchParams.set('id', id); history.replaceState(null, '', u); }
    cloudStatus(t('已儲存到帳號', 'Saved to your account'), 'ok');
  } catch (e) { console.warn('cloud save', e); cloudStatus(t('未能儲存，稍後重試', 'Not saved — retrying'), 'err'); clearTimeout(cloud.timer); cloud.timer = setTimeout(cloudSave, 8000); }
  cloud.busy = false;
  if (cloud.again) { cloud.again = false; cloudSoon(); }
}
// small top-down picture of the ground floor for the projects page
function planThumb() {
  try {
    const L = doc.levels[0], pts = L.walls.flatMap(w => [w.a, w.b]); if (!pts.length) return null;
    const b = bbox(pts), W = 480, H = 320, c = document.createElement('canvas'); c.width = W; c.height = H;
    const s = Math.min(W / (b.x1 - b.x0 + 1.2), H / (b.z1 - b.z0 + 1.2));
    const v = { s, x0: (b.x0 + b.x1) / 2 - W / s / 2, z0: (b.z0 + b.z1) / 2 - H / s / 2 };
    const g = c.getContext('2d'); g.fillStyle = '#16130f'; g.fillRect(0, 0, W, H);
    drawLevel(doc, L, { canvas: c, view: v, pxPerM: s, noGrid: true, noDims: true, theme: 'dark' });
    return c.toDataURL('image/jpeg', 0.72);
  } catch { return null; }
}
function cloudHeader() {
  const host = $('#acct'); if (!host) return;
  host.innerHTML = '';
  if (cloud.user) {
    const st = document.createElement('span'); st.id = 'cloud-status'; st.className = 'cloud-status';
    st.textContent = cloud.id ? t('已儲存到帳號', 'Saved to your account') : t('畫出牆後自動儲存', 'Saves once you draw');
    const a = document.createElement('a'); a.className = 'hbtn'; a.href = '/projects'; a.textContent = t('我的專案', 'My projects');
    host.append(st, a);
  } else {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'hbtn'; b.textContent = t('登入以儲存', 'Sign in to save');
    b.title = t('用 Google 登入，平面圖會存到你的帳號，也能用 AI 辨識房間', 'Sign in with Google to save plans to your account and use AI room naming');
    b.addEventListener('click', () => Cloud.signIn('/projects').catch(() => toast(t('無法登入', 'Could not sign in'))));
    host.append(b);
  }
}
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
    // in the stair's own terms (across a, along v), then mapped back to plan x/z
    const l = stairLocal(st), xr = st.axis === 'x', W = (a, v) => (xr ? [v, a] : [a, v]);
    const v0 = Math.min(l.s0, l.s1), v1 = Math.max(l.s0, l.s1), a0 = l.a0 - 0.05, a1 = l.a1 + 0.1;
    const railEnd = l.s1 > l.s0 ? v1 - 0.85 : v0 + 0.85;
    up.voids.push({ id: st.id, polygon: [W(a0, v0), W(a1, v0), W(a1, v1), W(a0, v1)], railFrom: W(a1, l.s1 > l.s0 ? v0 : v1), railTo: W(a1, railEnd) });
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
  for (const st of doc.stairs) if (st.from === L.id) { const b = stairBox(st); if (p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.z0 && p[1] <= b.z1) return { type: 'stair', stair: st }; }
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
let issues = [], focusIssue = null;
function zoomTo(p) {
  view.s = Math.max(view.s, Math.min(cv.width, cv.height) / 7);
  view.x0 = p[0] - cv.width / view.s / 2; view.z0 = p[1] - cv.height / view.s / 2;
}
function render() {
  if (!doc) return;
  const W = cv.width, H = cv.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#16130f'; ctx.fillRect(0, 0, W, H);
  // grid: 10 cm minor (when zoomed), 1 m major
  const [gx0, gz0] = toWorld(0, 0), [gx1, gz1] = toWorld(W, H);
  const minor = view.s > 90 ? 0.1 : view.s > 25 ? 0.5 : 1;
  for (const [step, alpha] of [[minor, 0.035], [1, 0.08], [5, 0.15]]) {
    ctx.strokeStyle = `rgba(237,229,215,${alpha})`; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = Math.floor(gx0 / step) * step; x < gx1; x += step) { const [sx] = toScreen(x, 0); ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, H); }
    for (let z = Math.floor(gz0 / step) * step; z < gz1; z += step) { const [, sy] = toScreen(0, z); ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(W, Math.round(sy) + 0.5); }
    ctx.stroke();
  }
  // underlays
  if (underlay.imgEl) {
    ctx.globalAlpha = underlay.opacity;
    // multi-floor pictures: each floor was moved onto 1F's spot, so slide the picture to show this floor's drawing
    const sh = level().imgShift || [0, 0];
    const [sx, sy] = toScreen(underlay.x + sh[0] * underlay.mpp, underlay.z + sh[1] * underlay.mpp);
    ctx.drawImage(underlay.imgEl, sx, sy, underlay.imgEl.width * underlay.mpp * view.s, underlay.imgEl.height * underlay.mpp * view.s);
    ctx.globalAlpha = 1;
  }
  if (underlay.dxf) {
    ctx.globalAlpha = underlay.dxfOpacity; ctx.strokeStyle = '#7fb2e5'; ctx.lineWidth = 1; ctx.beginPath();
    for (const s of underlay.dxf.segs) { if (!underlay.dxfLayers.has(s.layer)) continue; const a = toScreen(...s.a), b = toScreen(...s.b); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    ctx.fillStyle = '#7fb2e5'; ctx.font = `${11 * dpr}px "Noto Sans TC", sans-serif`;
    for (const t of underlay.dxf.texts) { const [sx, sy] = toScreen(...t.p); ctx.fillText(t.text, sx, sy); }
    ctx.globalAlpha = 1;
  }
  // lower level as a faint trace guide
  if (lv > 0) {
    ctx.globalAlpha = 0.18;
    drawLevel(doc, { ...doc.levels[lv - 1], rooms: [], furniture: [] }, { canvas: cv, view, pxPerM: view.s, noGrid: true, noDims: true, furniture: false, theme: 'dark' });
    ctx.globalAlpha = 1;
  }
  // the level itself, drawn with the same ink renderer as the 3D floor
  const L = level();
  drawLevel({ ...doc, stairs: doc.stairs }, L, { canvas: cv, view, pxPerM: view.s, noGrid: true, noDims: true, highlight: sel && sel.type === 'room' ? sel.room.id : null, theme: 'dark' });
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // selection + handles
  const accent = '#c9a26a';
  const wallPath = (w, extra = 0) => {
    const { ux, uz } = wallFrame(w); const n = [-uz, ux], h = (w.t || 0.12) / 2 + extra;
    const pts = [[w.a[0] + n[0] * h, w.a[1] + n[1] * h], [w.b[0] + n[0] * h, w.b[1] + n[1] * h], [w.b[0] - n[0] * h, w.b[1] - n[1] * h], [w.a[0] - n[0] * h, w.a[1] - n[1] * h]].map(q => toScreen(...q));
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(...q) : ctx.moveTo(...q))); ctx.closePath();
  };
  if (hover && (!sel || hover.wall !== sel.wall || hover.item !== sel.item) && tool === 'select') {
    ctx.strokeStyle = 'rgba(201,162,106,.7)'; ctx.lineWidth = 2 * dpr;
    if (hover.type === 'wall' || hover.type === 'opening') { wallPath(hover.wall, 0.03); ctx.stroke(); }
    if (hover.type === 'item') { const b = itemFootprint(hover.item); const [x, y] = toScreen(b.x0, b.z0); ctx.strokeRect(x, y, (b.x1 - b.x0) * view.s, (b.z1 - b.z0) * view.s); }
  }
  if (sel) {
    ctx.strokeStyle = accent; ctx.lineWidth = 2.5 * dpr; ctx.fillStyle = 'rgba(201,162,106,.2)';
    if (sel.type === 'wall') {
      wallPath(sel.wall, 0.04); ctx.fill(); ctx.stroke();
      for (const q of [sel.wall.a, sel.wall.b]) { const [x, y] = toScreen(...q); ctx.fillStyle = '#16130f'; ctx.beginPath(); ctx.arc(x, y, 6 * dpr, 0, 7); ctx.fill(); ctx.stroke(); }
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
    if (sel.type === 'stair') { const b = stairBox(sel.stair); const [x, y] = toScreen(b.x0, b.z0); ctx.strokeRect(x, y, (b.x1 - b.x0) * view.s, (b.z1 - b.z0) * view.s); }
  }
  // plan-check markers: open ends red, tiny rooms amber; the focused one gets its fix previewed
  if (tool === 'select') for (const i of issues) {
    if (i.kind === 'name') continue;
    const [x, y] = toScreen(...i.p), on = i === focusIssue;
    ctx.strokeStyle = i.kind === 'small' ? '#d9a441' : '#e0563f'; ctx.lineWidth = (on ? 2.5 : 1.5) * dpr;
    ctx.beginPath(); ctx.arc(x, y, (on ? 11 : 6) * dpr, 0, 7); ctx.stroke();
    if (on && i.fix && i.fix.type !== 'delete') {
      const to = i.fix.type === 'join' ? i.fix.F.p : i.fix.to;
      ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(...toScreen(...to)); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // tool previews
  if (tool === 'wall' || tool === 'zone') {
    if (draft && draft.pts.length && draft.cursor) {
      const a = draft.pts[draft.pts.length - 1], b = draft.cursor;
      ctx.strokeStyle = tool === 'zone' ? 'rgba(237,229,215,.6)' : accent; ctx.lineWidth = (tool === 'zone' ? 1.5 : Math.max(2, 0.12 * view.s)) * dpr / (tool === 'zone' ? 1 : dpr);
      if (tool === 'zone') ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(...toScreen(...a)); ctx.lineTo(...toScreen(...b)); ctx.stroke(); ctx.setLineDash([]);
      const mid = toScreen((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      tag(mid[0], mid[1] - 18 * dpr, typed ? `${typed} ⏎` : m2(Math.hypot(b[0] - a[0], b[1] - a[1])), true);
    }
  }
  if (['door', 'window', 'slider'].includes(tool) && hover && hover.preview) {
    const { w, offset, width } = hover.preview; const { ux, uz } = wallFrame(w);
    const a = [w.a[0] + ux * offset, w.a[1] + uz * offset], b = [a[0] + ux * width, a[1] + uz * width];
    ctx.fillStyle = hover.preview.ok ? 'rgba(201,162,106,.5)' : 'rgba(196,67,47,.5)'; wallPath({ a, b, t: w.t }, 0.05); ctx.fill();
  }
  if (tool === 'item' && pendingItem && hover && hover.p) {
    const f = { ...pendingItem, x: hover.p[0], z: hover.p[1], rot: itemRot };
    const b = itemFootprint(f); const [x, y] = toScreen(b.x0, b.z0);
    ctx.fillStyle = 'rgba(201,162,106,.25)'; ctx.strokeStyle = accent; ctx.lineWidth = 2 * dpr;
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
    ctx.strokeStyle = '#7fb2e5'; ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(x - 5 * dpr, y - 5 * dpr, 10 * dpr, 10 * dpr);
    ctx.fillStyle = '#7fb2e5'; ctx.font = `${10 * dpr}px "Noto Sans TC", sans-serif`; ctx.fillText(snapLabel(snap.kind), x + 8 * dpr, y - 8 * dpr);
  }
}
function tag(x, y, text, strong) {
  ctx.font = `700 ${11 * dpr}px "Noto Sans TC", sans-serif`;
  const w = ctx.measureText(text).width + 10 * dpr, h = 18 * dpr;
  ctx.fillStyle = strong ? '#c9a26a' : 'rgba(237,229,215,.92)'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = '#1b140b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1);
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
  $('#snapinfo').textContent = snap ? t(`吸附：${snap.kind}`, `Snap: ${snapLabel(snap.kind)}`) : '';
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
  const base = { ...pendingItem }; delete base.group; delete base.label; delete base.groupEn; delete base.labelEn;
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
  const base = { id: `S${doc.stairs.length + 1}`, from: level().id, to: doc.levels[lv + 1].id, risers: Math.max(14, Math.round(level().height / 0.175)), name: '直跑樓梯', nameEn: 'Straight stair' };
  // the drag runs from the bottom step to the top: its longer direction is the run
  const st = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1])
    ? { ...base, axis: 'x', z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]), xStart: a[0], xEnd: b[0] }
    : { ...base, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), zStart: a[1], zEnd: b[1] };
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
    box.hidden = true; draft = null; setTool('wall'); fitView();
    toast(underlay.lines && underlay.lines.faces.length ? t(`底圖比例已設定：${m2(real)}。按「自動辨識牆體」產生牆與房間。`, `Underlay scale set: ${m2(real)}. Press “Detect walls” to build walls and rooms.`) : t(`底圖比例已設定：${m2(real)}`, `Underlay scale set: ${m2(real)}`));
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
  if (t === 'scale' && !underlay.imgEl) toast(isEn ? 'Import a plan image first, then set its scale.' : '先匯入一張平面圖圖片，再設定比例。');
  render();
}
document.querySelectorAll('#tools button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

function buildCatalog() {
  const host = $('#catalog-list');
  let g = null, grp;
  for (const it of ITEMS) {
    if (it.group !== g) { g = it.group; grp = document.createElement('div'); grp.className = 'cat-group'; grp.innerHTML = `<span>${t(g, it.groupEn)}</span>`; host.appendChild(grp); }
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = t(it.label, it.labelEn);
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
  const add = document.createElement('button'); add.type = 'button'; add.textContent = t('+ 樓層', '+ Level'); add.className = 'add';
  add.addEventListener('click', () => { doc.levels.push(newLevel(doc.levels.length, doc.levels[doc.levels.length - 1])); lv = doc.levels.length - 1; buildLevelTabs(); commit(); toast(t(`已新增 ${level().id}，外牆已從下層複製`, `Added ${level().id}; exterior walls copied from the level below`)); });
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
    h(t('牆', 'Wall'), w.kind === 'zone' ? t('區域分界', 'Zone divider') : w.kind === 'railing' ? t('欄杆', 'Railing') : w.ext ? t('外牆', 'Exterior wall') : t('內牆', 'Interior wall'));
    host.append(
      field(t('長度', 'Length'), +(len * 100).toFixed(0), v => { const L2 = v / 100; const { ux, uz } = wallFrame(w); w.b = [+(w.a[0] + ux * L2).toFixed(3), +(w.a[1] + uz * L2).toFixed(3)]; }, { type: 'number', unit: 'cm' }),
      field(t('牆厚', 'Thickness'), +(w.t * 100).toFixed(0), v => { w.t = v / 100; w.tLocked = true; }, { type: 'number', unit: 'cm' }),
      field(t('類型', 'Type'), w.kind || 'wall', v => { if (v === 'wall') delete w.kind; else w.kind = v; }, { options: [['wall', t('牆', 'Wall')], ['railing', t('陽台欄杆', 'Balcony railing')], ['zone', t('區域分界（不建牆）', 'Zone divider (no wall)')]] }),
    );
    btn(t('刪除牆', 'Delete wall'), deleteSel, 'danger');
  } else if (sel && sel.type === 'opening') {
    const o = sel.opening;
    h(t('開口', 'Opening'), isEn ? { door: 'Door', window: 'Window', slider: 'Sliding door', passage: 'Opening' }[o.type] : { door: '門', window: '窗', slider: '落地拉門', passage: '開口' }[o.type]);
    host.append(
      field(t('類型', 'Type'), o.type, v => { Object.assign(o, { ...OPENING[v], width: o.width, type: v }); }, { options: [['door', t('門', 'Door')], ['window', t('窗', 'Window')], ['slider', t('落地拉門', 'Sliding door')], ['passage', t('無門開口', 'Open passage')]] }),
      field(t('寬度', 'Width'), Math.round(o.width * 100), v => { o.width = v / 100; }, { type: 'number', unit: 'cm' }),
      field(t('距牆起點', 'From wall start'), Math.round(o.offset * 100), v => { o.offset = v / 100; }, { type: 'number', unit: 'cm' }),
      field(t('窗台高', 'Sill height'), Math.round(o.sill * 100), v => { o.sill = v / 100; }, { type: 'number', unit: 'cm' }),
      field(t('頂高', 'Head height'), Math.round(o.head * 100), v => { o.head = v / 100; }, { type: 'number', unit: 'cm' }),
    );
    if (o.type === 'door') host.append(field(t('大門（入口）', 'Main entrance'), o.main, v => { for (const L of doc.levels) for (const w of L.walls) for (const x of w.openings || []) delete x.main; if (v) o.main = true; }, { check: true }));
    btn(t('刪除開口', 'Delete opening'), deleteSel, 'danger');
  } else if (sel && sel.type === 'room') {
    const r = sel.room, a = polygonArea(r.polygon);
    h(roomName(r), `${a.toFixed(1)} m² · ${toPing(a).toFixed(1)} ${unitLabel('坪')}`);
    // the current language's name comes first; the plan always keeps both (name + nameEn)
    const zhField = field(t('名稱', 'Chinese'), r.name, v => { r.name = v; if (EN[v]) r.nameEn = EN[v]; });
    const enField = field(t('英文', 'Name'), r.nameEn || '', v => { r.nameEn = v; const zh = ZH[v.trim().toLowerCase()]; if (zh && isEn) r.name = zh; });
    host.append(
      ...(isEn ? [enField, zhField] : [zhField, enField]),
      field(t('地坪類型', 'Floor'), r.outdoor ? 'balcony' : r.finish, v => { r.finish = v; r.outdoor = v === 'balcony'; r.wet = v === 'tile'; }, { options: [['floor', t('室內地坪（套用材質）', 'Interior floor (takes finish)')], ['tile', t('濕區磁磚', 'Wet-area tile')], ['balcony', t('陽台（戶外）', 'Balcony (outdoor)')]] }),
      field(t('走道／過道', 'Hallway'), r.circulation, v => { r.circulation = v; }, { check: true }),
    );
    const quick = document.createElement('div'); quick.className = 'quick';
    for (const [n, en, fin] of [['客廳', 'Living', 'floor'], ['餐廳', 'Dining', 'floor'], ['廚房', 'Kitchen', 'floor'], ['主臥', 'Master Bedroom', 'floor'], ['次臥', 'Bedroom', 'floor'], ['書房', 'Study', 'floor'], ['衛浴', 'Bathroom', 'tile'], ['玄關', 'Entrance', 'floor'], ['陽台', 'Balcony', 'balcony'], ['走道', 'Hall', 'floor']]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t(n, en);
      b.addEventListener('click', () => { r.name = n; r.nameEn = en; r.finish = fin; r.outdoor = fin === 'balcony'; r.wet = fin === 'tile'; r.circulation = n === '走道'; commit(); });
      quick.appendChild(b);
    }
    host.appendChild(quick);
  } else if (sel && sel.type === 'item') {
    const f = sel.item;
    h(isEn ? f.nameEn || f.name || f.kind : f.name || f.kind, isEn ? '' : f.nameEn || '');
    host.append(
      field(t('寬', 'Width'), Math.round(f.w * 100), v => { f.w = v / 100; }, { type: 'number', unit: 'cm' }),
      field(t('深', 'Depth'), Math.round(f.d * 100), v => { f.d = v / 100; }, { type: 'number', unit: 'cm' }),
      field(t('旋轉', 'Rotation'), f.rot || 0, v => { f.rot = v; }, { options: [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']].map(([v, t]) => [String(v), t]) }),
      field(t('單價', 'Unit price'), f.price || 0, v => { f.price = v; }, { type: 'number', unit: 'NT$' }),
    );
    btn(t('旋轉 90°（R）', 'Rotate 90° (R)'), () => { f.rot = ((f.rot || 0) + 90) % 360; commit(); });
    btn(t('刪除', 'Delete'), deleteSel, 'danger');
  } else if (sel && sel.type === 'stair') {
    const st = sel.stair;
    h(t('樓梯', 'Stairs'), `${st.from} → ${st.to}`);
    host.append(field(t('踏階數', 'Risers'), st.risers, v => { st.risers = Math.max(8, Math.round(v)); }, { type: 'number' }));
    btn(t('反轉方向', 'Reverse direction'), () => { if (st.axis === 'x') [st.xStart, st.xEnd] = [st.xEnd, st.xStart]; else [st.zStart, st.zEnd] = [st.zEnd, st.zStart]; commit(); });
    btn(t('刪除樓梯', 'Delete stairs'), deleteSel, 'danger');
  } else {
    const P = doc.project;
    h(t('專案', 'Project'), isEn ? P.nameEn || P.name : P.name);
    // the current language's name comes first; the plan always keeps both (name + nameEn)
    const zhName = field(t('案名', 'Chinese'), P.name, v => { P.name = v; });
    const enName = field(t('英文案名', 'Name'), P.nameEn || '', v => { P.nameEn = v; });
    host.append(
      ...(isEn ? [enName, zhName] : [zhName, enName]),
      field(t('建築類型', 'Building'), P.type || 'apartment', v => { P.type = v; }, { options: [['apartment', t('大樓住宅（含城市景觀）', 'Apartment (with city view)')], ['townhouse', t('透天／獨棟', 'Townhouse / detached')]] }),
      field(t('所在樓層', 'Floor'), P.floor || 9, v => { P.floor = v; }, { type: 'number', unit: 'F' }),
      field(t(`${level().id} 樓高`, `${level().id} height`), Math.round(level().height * 100), v => { const L = level(); L.height = v / 100; let e = 0; for (const x of doc.levels) { x.elevation = e; e += x.height; } }, { type: 'number', unit: 'cm' }),
    );
  }
  // plan check: open wall ends, strays, slivers, default names
  issues = findIssues(level());
  if (!sel && issues.length) {
    const box = document.createElement('div'); box.className = 'issues';
    const fixable = issues.filter(i => i.fix).length;
    const label = { gap: t('牆端未接上', 'Open wall end'), stray: t('零碎線段', 'Stray piece'), small: t('過小的房間', 'Tiny room'), name: t('房間待命名', 'Room needs a name') };
    const detail = i => i.kind === 'gap' ? (i.fix ? (i.fix.type === 'join' ? t(`與另一端相距 ${m2(i.fix.d)}`, `${m2(i.fix.d)} from another end`) : t(`延伸 ${m2(i.fix.d)} 接到前方的牆`, `extend ${m2(i.fix.d)} to the wall ahead`)) : t('附近沒有可接的牆，請手動補畫', 'nothing close to join; draw it by hand'))
      : i.kind === 'stray' ? m2(i.len) : i.kind === 'small' ? `${i.area.toFixed(2)} m²` : `${roomName(i.room)} · ${i.area.toFixed(1)} m²`;
    box.innerHTML = `<div class="ih"><h3>${t('檢查', 'Check')} <em>${issues.length}</em></h3>${fixable ? `<button type="button" class="go" id="fix-all">${t(`全部補上（${fixable}）`, `Fix all (${fixable})`)}</button>` : ''}</div>`;
    const ul = document.createElement('ul');
    issues.slice(0, 40).forEach((i, k) => {
      const li = document.createElement('li'); li.className = `k-${i.kind}`;
      li.innerHTML = `<span class="dot"></span><span class="tx"><b>${label[i.kind]}</b><small>${detail(i)}</small></span>`;
      if (i.fix) { const b = document.createElement('button'); b.type = 'button'; b.textContent = i.fix.type === 'delete' ? t('刪除', 'Delete') : t('補上', 'Fix'); b.addEventListener('click', e => { e.stopPropagation(); if (applyFix(level(), i)) { focusIssue = null; commit(); } }); li.appendChild(b); }
      li.addEventListener('click', () => { focusIssue = i; zoomTo(i.p); if (i.room) { sel = { type: 'room', room: i.room }; refreshPanel(); } render(); });
      ul.appendChild(li);
    });
    box.appendChild(ul); host.appendChild(box);
    const fa = box.querySelector('#fix-all');
    if (fa) fa.addEventListener('click', () => { const n = fixAll(level(), detectRooms); focusIssue = null; commit(); toast(t(`已補上 ${n} 處；剩下的請手動檢查`, `Fixed ${n}; check the rest by hand`)); });
  }
  if (!sel && level().rooms.length) {
    const row = document.createElement('div'); row.className = 'furnish-row';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'go';
    b.textContent = level().furniture.some(f => f.auto) ? t('重新自動配置家具', 'Re-furnish automatically') : t('自動配置家具', 'Furnish automatically');
    b.title = t('依房間類型與大小擺放家具，保留門與走道淨空；你手動放的家具不會被移動。', 'Places furniture by room type and size, keeping doors and walkways clear. Pieces you placed yourself stay put.');
    b.addEventListener('click', () => { let n = 0; for (const L2 of doc.levels) n += autoFurnish(L2, { replace: true, stairs: doc.stairs }); commit(); toast(t(`已配置 ${n} 件家具（Ctrl+Z 復原）。改房間名稱後再按一次，家具會跟著換。`, `Placed ${plural(n, 'piece')} (Ctrl+Z undoes). Rename rooms and press again to refurnish.`)); });
    row.appendChild(b);
    if (underlay.imgEl && aiState !== 'off') {
      const ai = document.createElement('button'); ai.type = 'button'; ai.className = 'ghost';
      ai.textContent = t('AI 辨識房間名稱', 'Name rooms with AI');
      ai.title = t('依圖面上的家具符號與文字判斷每個房間（客廳、臥室、衛浴…），並建立樓梯。', 'Reads furniture symbols and labels in the picture to name each room, and adds stairs.');
      ai.addEventListener('click', () => aiNameRooms());
      row.appendChild(ai);
    }
    host.appendChild(row);
  }
  // room schedule
  const L = level();
  const rooms = L.rooms;
  const sum = rooms.filter(r => !r.outdoor).reduce((s, r) => s + polygonArea(r.polygon), 0);
  const tbl = document.createElement('table'); tbl.className = 'sched';
  tbl.innerHTML = `<thead><tr><th>${L.id} ${t('房間', 'rooms')}</th><th class="num">m²</th><th class="num">${unitLabel('坪')}</th></tr></thead><tbody>${rooms.map(r => `<tr data-id="${r.id}"><td>${roomName(r)}${r.outdoor ? ` <small>${t('戶外', 'outdoor')}</small>` : ''}</td><td class="num">${polygonArea(r.polygon).toFixed(1)}</td><td class="num">${toPing(polygonArea(r.polygon)).toFixed(1)}</td></tr>`).join('')}</tbody><tfoot><tr><td>${t('室內合計', 'Interior total')}</td><td class="num">${sum.toFixed(1)}</td><td class="num">${toPing(sum).toFixed(1)}</td></tr></tfoot>`;
  tbl.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => { sel = { type: 'room', room: rooms.find(r => r.id === tr.dataset.id) }; refreshPanel(); render(); }));
  if (!rooms.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = t('畫出封閉的牆，房間會自動出現並計算面積。', 'Draw closed walls; rooms appear automatically with their areas.'); host.appendChild(p); }
  else host.appendChild(tbl);
  const nL = doc.levels.length, nW = doc.levels.reduce((n, l) => n + l.walls.length, 0), nR = doc.levels.reduce((n, l) => n + l.rooms.length, 0);
  $('#stat').textContent = isEn ? `${plural(nL, 'level')} · ${plural(nW, 'wall')} · ${plural(nR, 'room')}` : `${nL} 層 · ${nW} 道牆 · ${nR} 個房間`;
}

let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

// ---------------------------------------------------------------- files
$('#btn-new').addEventListener('click', () => { if (doc.levels.some(L => L.walls.length) && !window.confirm(t('清除目前的平面圖，開始新專案？', 'Clear the current plan and start a new project?'))) return; underlay = { ...underlay, imgEl: null, dxf: null }; loadDoc(blank()); setTool('wall'); });
$('#btn-sample').addEventListener('change', async e => {
  const v = e.target.value; e.target.value = '';
  if (!v) return;
  if (v === 'dxf') { const b = await (await fetch('samples/sample-2br-apartment.dxf')).arrayBuffer(); importDXF(b, 'sample-2br-apartment.dxf'); return; }
  const d = await (await fetch(`data/${v}.json`)).json();
  loadDoc(fromBuiltIn(d));
});
function zoneEdges(rooms, walls) {
  const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
  const onBoundary = (p, r) => r.polygon.some((q, i) => segDist(p, q, r.polygon[(i + 1) % r.polygon.length]) < 0.05);
  const out = [];
  const proj = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)); return [a[0] + t * dx, a[1] + t * dz]; };
  const snapEnd = p => {
    for (const [a, b] of out) for (const q of [a, b]) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.12) return q.slice();
    let best = null, bd = 0.35;
    for (const w of walls) { const d = segDist(p, w.a, w.b); if (d < bd) { bd = d; best = proj(p, w.a, w.b); } }
    for (const [a, b] of out) { const d = segDist(p, a, b); if (d < bd) { bd = d; best = proj(p, a, b); } }
    return (best || p).map(v => +v.toFixed(3));
  };
  const covered = p => walls.some(w => segDist(p, w.a, w.b) < (w.t || 0.12) / 2 + 0.04) || out.some(([a, b]) => segDist(p, a, b) < 0.05);
  rooms.forEach((r, ri) => r.polygon.forEach((a, i) => {
    const b = r.polygon[(i + 1) % r.polygon.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.2) return;
    const n = Math.ceil(len / 0.05), at = k => [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n];
    const runs = []; let k0 = null;
    for (let k = 0; k <= n; k++) {
      const p = at(k), open = !covered(p) && rooms.some((o, oi) => oi !== ri && onBoundary(p, o));
      if (open && k0 === null) k0 = k;
      if ((!open || k === n) && k0 !== null) { runs.push([k0, open ? k : k - 1]); k0 = null; }
    }
    for (const [s0, s1] of runs) {
      if ((s1 - s0) / n * len < 0.3) continue;
      // extend each end to the nearest wall/zone so the divider joins the wall graph
      const p0 = at(Math.max(0, s0 - 1)), p1 = at(Math.min(n, s1 + 1));
      out.push([snapEnd(p0), snapEnd(p1)]);
    }
  }));
  return out;
}
function fromBuiltIn(d) {
  const out = { project: { name: d.project.name, nameEn: d.project.nameEn || '', type: d.project.type || 'townhouse', floor: d.project.site ? d.project.site.floor : 1 }, levels: [], stairs: JSON.parse(JSON.stringify(d.stairs || [])) };
  for (const L of d.levels) {
    const walls = JSON.parse(JSON.stringify(L.walls)).map(w => { delete w.outdoor; delete w.h; return w; });
    for (const r of L.railings || []) if (!r.solid) walls.push({ id: `rl${walls.length}`, a: r.a, b: r.b, t: 0.06, kind: 'railing', openings: [] }); else walls.push({ id: `rl${walls.length}`, a: r.a, b: r.b, t: 0.15, openings: [] });
    // open-plan boundaries (客廳/餐廳/走道) have no wall; keep them as zone dividers so rooms stay separate
    for (const [a, b] of zoneEdges(L.rooms, walls)) walls.push({ id: `zn${walls.length}`, a, b, t: 0.12, kind: 'zone', openings: [] });
    out.levels.push({ id: L.id, name: L.name, nameEn: L.nameEn || '', elevation: L.elevation, height: L.height, walls, rooms: JSON.parse(JSON.stringify(L.rooms)), furniture: JSON.parse(JSON.stringify(L.furniture)) });
  }
  return out;
}
$('#file-dxf').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; importDXF(await f.arrayBuffer(), f.name); e.target.value = ''; });
$('#file-img').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  let src;
  try { src = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name) ? await pdfToImage(f) : URL.createObjectURL(f); }
  catch (err) { console.error(err); toast(t('無法讀取這個 PDF', 'Could not read this PDF')); return; }
  const img = new Image();
  img.onload = () => {
    underlay.imgEl = img; underlay.x = 0; underlay.z = 0;
    // find the walls once; the drawn wall thickness also gives a first guess at the scale (exterior wall ≈ 25 cm)
    try {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
      underlay.lines = extractPlanLines(g.getImageData(0, 0, c.width, c.height));
    } catch (err) { console.error(err); underlay.lines = null; }
    underlay.mpp = underlay.lines && underlay.lines.tPx ? 0.18 / underlay.lines.tPx : 12 / img.width;
    $('#ul-img').hidden = false; fitView(); setTool('scale');
    toast(t('底圖已載入，比例已依牆厚估算。點兩個已知距離的點校正比例（例如一道標有尺寸的牆），再按「自動辨識牆體」。', 'Plan loaded; scale estimated from the wall thickness. Click two points a known distance apart to correct it (e.g. a dimensioned wall), then press “Detect walls”.'));
  };
  img.src = src;
});
// First page of a PDF → PNG data URL, rendered at ~2400 px on the long side
async function pdfToImage(file) {
  const pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await pdf.getPage(1), v0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 2400 / Math.max(v0.width, v0.height) });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  return c.toDataURL('image/png');
}
// ---------------------------------------------------------------- AI room naming (image imports)
// Draws a numbered marker in every detected room on the plan picture and asks /api/vision what each room is.
// Applies names, wet/outdoor flags, a printed dimension as the true scale, stairs between floors, then refurnishes.
let aiState = 'unknown'; // 'off' once the server says no key is configured
async function aiNameRooms({ quiet = false } = {}) {
  if (!underlay.imgEl || aiState === 'off') { if (!quiet) toast(t('AI 命名需要先匯入平面圖圖片', 'AI naming needs an imported plan picture')); return false; }
  const img = underlay.imgEl, S = Math.min(1, 1568 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * S); c.height = Math.round(img.height * S);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  const marks = [], R0 = Math.max(10, Math.round(c.width / 85));
  doc.levels.forEach(L => {
    const sh = L.imgShift || [0, 0];
    for (const r of L.rooms) {
      const p = labelPoint(r.polygon), px = ((p[0] - underlay.x) / underlay.mpp - sh[0]) * S, py = ((p[1] - underlay.z) / underlay.mpp - sh[1]) * S;
      if (!(px > 0 && py > 0 && px < c.width && py < c.height)) continue;
      const n = marks.length + 1; marks.push({ n, L, r });
      g.beginPath(); g.arc(px, py, R0, 0, 7); g.fillStyle = '#fff'; g.fill(); g.lineWidth = Math.max(2, R0 / 5); g.strokeStyle = '#d0021b'; g.stroke();
      g.fillStyle = '#d0021b'; g.font = `bold ${Math.round(R0 * 1.15)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), px, py + 1);
    }
  });
  if (!marks.length) return false;
  if (!quiet) toast(t('AI 正在辨識房間…', 'AI is identifying the rooms…'));
  let out;
  try {
    const token = await Cloud.accessToken();
    if (!token) { if (!quiet) toast(t('登入後即可使用 AI 辨識房間名稱', 'Sign in to name rooms with AI')); else toast(t('已依規則命名房間；登入後可用 AI 辨識房間名稱。', 'Rooms got rule-based names; sign in to name them with AI.')); return false; }
    const r = await fetch('/api/vision', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ image: c.toDataURL('image/jpeg', 0.85), count: marks.length, floors: doc.levels.length }) });
    if (r.status === 401) { if (!quiet) toast(t('請重新登入後再試', 'Please sign in again')); return false; }
    if (r.status === 503 || r.status === 404) { aiState = 'off'; if (!quiet) toast(t('AI 命名尚未啟用（伺服器未設定金鑰），已使用規則命名。', 'AI naming is not enabled on the server yet; rule-based names are used.')); return false; }
    out = await r.json(); if (!r.ok) throw new Error(out.error || r.status);
  } catch (e) { console.warn('vision', e); if (!quiet) toast(t('AI 命名失敗，請稍後再試', 'AI naming failed; try again later')); return false; }
  // apply names (second and later bedrooms on a floor become 次臥, 次臥 2…)
  const seen = new Map();
  for (const x of out.rooms) {
    const m = marks[x.n - 1]; if (!m) continue;
    const r = m.r; let name = x.name, en = x.nameEn;
    if (name === '臥室') { const k = (seen.get(m.L) || 0) + 1; seen.set(m.L, k); name = k === 1 ? '次臥' : `次臥 ${k}`; en = k === 1 ? 'Bedroom' : `Bedroom ${k}`; }
    r.name = name; r.nameEn = en;
    r.wet = /浴/.test(name); if (r.wet) r.finish = 'tile';
    r.outdoor = /陽台|庭院/.test(name); if (r.outdoor) r.finish = 'balcony';
    r.circulation = /走道|樓梯|玄關/.test(name);
    r.hasStairs = !!x.stairs;
  }
  // a printed room size fixes the scale for the whole plan
  if (out.scale) {
    const m = marks[out.scale.n - 1];
    if (m) {
      const xs = m.r.polygon.map(p => p[0]), zs = m.r.polygon.map(p => p[1]), wm = Math.max(...xs) - Math.min(...xs), dm = Math.max(...zs) - Math.min(...zs);
      const f1 = out.scale.w / wm, f2 = out.scale.d / dm, f = (f1 + f2) / 2;
      if (Math.abs(f1 - f2) / f < 0.15 && Math.abs(f - 1) > 0.03) rescalePlan(f);
    }
  }
  // stairs: one straight run per floor, up to the floor above. Prefer this floor's 樓梯 room; when the stairs sit
  // inside an open room (1F living/dining), use the footprint of the stair room above (floors are aligned).
  const stairRoom = L => L && (L.rooms.find(r => r.name === '樓梯') || null);
  for (let i = 0; i < doc.levels.length - 1; i++) {
    const L = doc.levels[i]; if (doc.stairs.some(st => st.from === L.id)) continue;
    let sr = stairRoom(L);
    if (!sr && L.rooms.some(r => r.hasStairs)) sr = stairRoom(doc.levels[i + 1]) || (i > 0 ? stairRoom(doc.levels[i - 1]) : null);
    if (!sr) continue;
    const xs = sr.polygon.map(p => p[0]), zs = sr.polygon.map(p => p[1]);
    const x0 = Math.min(...xs) + 0.1, x1 = Math.max(...xs) - 0.1, z0 = Math.min(...zs) + 0.1, z1 = Math.max(...zs) - 0.1;
    // the run follows the room's long side; the flight takes about half the width when the room is wide
    const base = { id: `S${doc.stairs.length + 1}`, from: L.id, to: doc.levels[i + 1].id, risers: Math.max(14, Math.round(L.height / 0.175)), name: '直跑樓梯', nameEn: 'Straight stair', auto: true };
    const r3 = v => +v.toFixed(3);
    if (x1 - x0 > z1 - z0) { const w = Math.min(1.1, z1 - z0 > 2.4 ? (z1 - z0) / 2 : z1 - z0); doc.stairs.push({ ...base, axis: 'x', z0: r3(z0), z1: r3(z0 + w), xStart: r3(x0), xEnd: r3(x1) }); }
    else { const w = Math.min(1.1, x1 - x0 > 2.4 ? (x1 - x0) / 2 : x1 - x0); doc.stairs.push({ ...base, x0: r3(x0), x1: r3(x0 + w), zStart: r3(z1), zEnd: r3(z0) }); }
  }
  for (const L of doc.levels) detectRooms(L);
  tidyExteriorOpenings();
  for (const L of doc.levels) autoFurnish(L, { replace: true, stairs: doc.stairs });
  commit();
  toast(t(`AI 已命名 ${out.rooms.length} 個房間${out.scale ? '、依圖面尺寸校正比例' : ''}，家具已依房間類型重新配置。`, `AI named ${plural(out.rooms.length, 'room')}${out.scale ? ' and set the scale from a printed size' : ''}; furniture was rearranged to match.`));
  return true;
}
// Picture imports: gaps in outside walls are windows, except the entrance (one door on the ground floor, by the
// 玄關 or living room) and wide openings off the living/dining room, which become sliding doors (落地窗).
function tidyExteriorOpenings() {
  let hasMain = doc.levels.some(L => L.walls.some(w => (w.openings || []).some(o => o.main)));
  doc.levels.forEach((L, li) => {
    const roomAt = p => L.rooms.find(r => pointInPolygon(p, r.polygon));
    const cands = [];
    for (const w of L.walls) {
      if (!w.ext) continue;
      const { ux, uz } = wallFrame(w), n = [-uz, ux];
      for (const o of w.openings || []) {
        if (o.type === 'window' || o.main) continue;
        const m = [w.a[0] + ux * (o.offset + o.width / 2), w.a[1] + uz * (o.offset + o.width / 2)];
        const r = roomAt([m[0] + n[0] * 0.4, m[1] + n[1] * 0.4]) || roomAt([m[0] - n[0] * 0.4, m[1] - n[1] * 0.4]);
        const nm = r ? `${r.name} ${r.nameEn || ''}` : '';
        if (o.width >= 1.8 && /客|餐|living|dining/i.test(nm)) { Object.assign(o, { type: 'slider', sill: 0, head: 2.4, panels: o.width > 3 ? 4 : 2 }); continue; }
        if (li === 0 && o.width >= 0.75 && o.width <= 1.6) cands.push({ o, score: /玄關|玄|entr/i.test(nm) ? 3 : /客|餐|living|dining/i.test(nm) ? 2 : /廚|kitchen/i.test(nm) ? 0.5 : 1 });
        Object.assign(o, { type: 'window', sill: /浴|廁|bath/i.test(nm) ? 1.4 : 0.9, head: 2.2 });
      }
    }
    if (li === 0 && !hasMain && cands.length) { cands.sort((a, b) => b.score - a.score); Object.assign(cands[0].o, { type: 'door', sill: 0, head: 2.1, main: true }); hasMain = true; }
  });
}
// Scale the whole plan (walls, furniture, stairs, picture) about the picture's origin
function rescalePlan(f) {
  const ox = underlay.x, oz = underlay.z, P = p => [+(ox + (p[0] - ox) * f).toFixed(3), +(oz + (p[1] - oz) * f).toFixed(3)];
  for (const L of doc.levels) {
    for (const w of L.walls) { w.a = P(w.a); w.b = P(w.b); for (const o of w.openings || []) { o.offset = +(o.offset * f).toFixed(3); o.width = +(o.width * f).toFixed(3); } }
    for (const r of L.rooms) r.polygon = r.polygon.map(P);
    L.furniture = L.furniture.filter(x => !x.auto);
    for (const x of L.furniture) { const q = P([x.x, x.z]); x.x = q[0]; x.z = q[1]; }
    if (L.imgShift) L.imgShift = L.imgShift.map(v => v); // picture pixels: unchanged
  }
  for (const st of doc.stairs) {
    if (st.axis === 'x') { const a = P([st.xStart, st.z0]), b = P([st.xEnd, st.z1]); st.xStart = a[0]; st.z0 = a[1]; st.xEnd = b[0]; st.z1 = b[1]; }
    else { const a = P([st.x0, st.zStart]), b = P([st.x1, st.zEnd]); st.x0 = a[0]; st.zStart = a[1]; st.x1 = b[0]; st.zEnd = b[1]; }
  }
  underlay.mpp *= f;
  for (const L of doc.levels) detectRooms(L);
}

$('#img-detect').addEventListener('click', () => {
  if (!underlay.imgEl || !underlay.lines || !underlay.lines.faces.length) { toast(t('這張圖找不到牆線，請手動描繪', 'No walls found in this image. Trace them by hand.')); return; }
  const { walls, floors } = wallsFromImage(underlay.lines, { mpp: underlay.mpp, ox: underlay.x, oz: underlay.z });
  if (!walls.length) { toast(t('這張圖找不到牆線，請手動描繪', 'No walls found in this image. Trace them by hand.')); return; }
  sel = null;
  if (floors.length > 1) {
    // 透天 plans: one picture, several floors side by side (left → right = 1F, 2F, 3F…)
    if (doc.levels.some(L => L.walls.length) && !window.confirm(t(`圖中偵測到 ${floors.length} 個樓層，要取代目前所有樓層嗎？`, `Found ${floors.length} floors in this picture. Replace all current floors?`))) return;
    doc.levels = floors.map((ws, i) => { const L = newLevel(i); L.walls = ws.map((w, j) => ({ id: `i${i}_${j}`, ...w })); L.imgShift = (underlay.lines.floors[i].shift || [0, 0]).map(v => +v.toFixed(1)); return L; });
    for (let i = 1; i < doc.levels.length; i++) doc.levels[i].elevation = doc.levels[i - 1].elevation + doc.levels[i - 1].height;
    let nF = 0;
    doc.project.type = 'townhouse'; // several floors in one picture = a 透天
    doc.stairs = []; // the floors are new, so are their stairs
    for (const L of doc.levels) { L.rooms = []; detectRooms(L); }
    tidyExteriorOpenings();
    for (const L of doc.levels) nF += autoFurnish(L, { stairs: doc.stairs });
    lv = 0; buildLevelTabs(); commit();
    const counts = doc.levels.map(L => `${L.id} ${L.rooms.length}`).join('、');
    toast(t(`偵測到 ${floors.length} 個樓層（左到右為 1F→${floors.length}F），房間：${counts}。各樓層已對齊到 1F 位置；請逐層檢查缺口與門窗。`, `Found ${floors.length} floors (left to right = 1F→${floors.length}F). Rooms: ${counts}. Floors are aligned onto 1F; check each floor for gaps and openings.`));
    aiNameRooms({ quiet: true });
    return;
  }
  // a new picture replaces the floors an earlier picture created; otherwise only the current floor
  if (doc.levels.some(x => x.imgShift)) { if (!window.confirm(t('取代先前由圖片建立的樓層？', 'Replace the floors created from the previous picture?'))) return; doc.levels = [newLevel(0)]; doc.stairs = []; lv = 0; buildLevelTabs(); }
  const L = level();
  if (L.walls.length && !window.confirm(t('取代目前樓層的牆體？', 'Replace the walls on this floor?'))) return;
  L.walls = walls.map((w, i) => ({ id: `i${i}`, ...w }));
  L.rooms = [];
  doc.stairs = doc.stairs.filter(st => st.from !== L.id || !st.auto);
  detectRooms(L);
  tidyExteriorOpenings();
  autoFurnish(L, { replace: true, stairs: doc.stairs });
  commit();
  toast(t(`辨識出 ${walls.length} 道牆、${L.rooms.length} 個房間。請檢查缺口、門窗與房間名稱；未封閉的空間用「牆」補上。`, `Found ${plural(walls.length, 'wall')} and ${plural(L.rooms.length, 'room')}. Check gaps, doors/windows and room names; close open spaces with the Wall tool.`));
  aiNameRooms({ quiet: true });
});
$('#ul-opacity').addEventListener('input', e => { underlay.opacity = +e.target.value; render(); });
$('#ul-remove').addEventListener('click', () => { underlay.imgEl = null; $('#ul-img').hidden = true; render(); });
$('#file-json').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); loadDoc(d.levels && d.levels[0] && d.levels[0].walls && !d.story ? d : fromBuiltIn(d)); } catch (err) { toast(t('無法讀取這個 JSON 檔', 'Could not read this JSON file')); } e.target.value = ''; });
$('#btn-download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(isEn ? doc.project.nameEn || doc.project.name : doc.project.name) || 'plan'}.spatial.json`; a.click();
});
$('#btn-3d').addEventListener('click', open3D);
async function open3D() {
  if (!doc.levels[0].rooms.length) { toast(t('還沒有封閉的房間：先畫出外牆和隔間。', 'No closed rooms yet. Draw the exterior walls and partitions first.')); return; }
  const base = await (await fetch('data/apartment.json')).json();
  const full = completePlan(doc, base);
  try { localStorage.setItem('spatial.custom', JSON.stringify(full)); } catch { toast(t('瀏覽器儲存空間不足', 'Not enough browser storage')); return; }
  location.href = 'index.html?p=custom';
}

const ROOMWORD = /房|廳|厅|室|臥|卧|廚|厨|浴|廁|厕|衛|卫|陽台|阳台|玄關|書房|儲|倉|走道|梯|辦公|會議|大廳|茶水|機房|room|bed|living|dining|kitchen|bath|wc|toilet|hall|lobby|office|meeting|conference|storage|store|closet|laundry|utility|garage|study|foyer|entry|corridor|balcony|terrace|pantry|shop|retail|电|電氣|electrical|mech/i;
const ROOMRANK = [/客廳|客厅|起居|living|lounge/i, /餐廳|餐厅|dining/i, /臥|卧|bed/i, /辦公|office|會議|meeting/i, /廚|厨|kitchen/i];
function importDXF(src, name) {
  let d;
  if (/\.dwg$/i.test(name || '')) { toast(t('請先在 CAD 中另存為 DXF（DWG 尚不支援）', 'Save it as DXF from your CAD app first (DWG is not supported yet).')); return; }
  try { d = parseDXF(typeof src === 'string' ? src : decodeDXF(src)); } catch (err) { console.error(err); toast(t('DXF 讀取失敗：請另存為 ASCII DXF（R2010 或更舊）', 'Could not read the DXF. Save it as ASCII DXF (R2010 or older).')); return; }
  if (!d.segs.length) { toast(t('這個 DXF 沒有可用的線條', 'This DXF has no usable lines')); return; }
  underlay.dxf = d;
  underlay.dxfLayers = new Set(Object.keys(d.layers));
  underlay.wallLayers = new Set(defaultWallLayers(d));
  buildLayerList();
  $('#ul-dxf').hidden = false;
  $('#dxf-name').textContent = `${name} · ${(d.units * 1000).toFixed(0) === '1' ? 'mm' : d.units === 0.01 ? 'cm' : 'm'} · ${d.segs.length} ${t('線段', 'lines')}`;
  fitView();
  toast(t(`DXF 已載入，牆線圖層：${[...underlay.wallLayers].join('、')}。按「自動辨識牆體」，或直接沿著藍線描牆。`, `DXF loaded. Wall layers: ${[...underlay.wallLayers].join(', ')}. Press “Detect walls”, or trace along the blue lines.`));
}
function buildLayerList() {
  const host = $('#dxf-layers'); host.innerHTML = '';
  for (const [name, n] of Object.entries(underlay.dxf.layers).sort((a, b) => b[1] - a[1])) {
    const row = document.createElement('label'); row.className = 'layer';
    row.innerHTML = `<input type="checkbox" ${underlay.dxfLayers.has(name) ? 'checked' : ''}><span>${name}</span><em>${n}</em><input type="checkbox" class="wl" title="${t('牆線圖層', 'Wall layer')}" ${underlay.wallLayers.has(name) ? 'checked' : ''}>`;
    const [show, wl] = row.querySelectorAll('input');
    show.addEventListener('change', e => { e.target.checked ? underlay.dxfLayers.add(name) : underlay.dxfLayers.delete(name); render(); });
    wl.addEventListener('change', e => { e.target.checked ? underlay.wallLayers.add(name) : underlay.wallLayers.delete(name); });
    host.appendChild(row);
  }
}
$('#dxf-detect').addEventListener('click', () => {
  if (!underlay.wallLayers.size) { toast(t('請先勾選至少一個牆線圖層', 'Tick at least one wall layer first')); return; }
  const walls = wallsFromDXF(underlay.dxf, [...underlay.wallLayers]);
  if (!walls.some(w => w.kind !== 'zone')) { toast(t('這些圖層找不到牆線，請改選圖層或手動描繪', 'No wall lines on these layers. Pick other layers or trace by hand.')); return; }
  const L = level();
  sel = null;
  L.walls = walls.map((w, i) => ({ id: `d${i}`, ...w }));
  detectRooms(L);
  // name rooms from DXF text inside them
  for (const r of L.rooms) {
    const inside = underlay.dxf.texts.filter(t => pointInPolygon(t.p, r.polygon) && !/^[\d\s.,:×x*+\-=/'"mM²㎡]+$/.test(t.text) && t.text.length <= 24);
    // open plans carry several labels (玄關 + 客廳 + 餐廳): the main living space names the room
    const rank = t => { const i = ROOMRANK.findIndex(re => re.test(t.text)); return i < 0 ? 99 : i; };
    const t = inside.filter(t => ROOMWORD.test(t.text)).sort((a, b) => rank(a) - rank(b))[0] || inside.find(t => /[一-鿿가-힣]/.test(t.text));
    if (t) { r.name = t.text.replace(/\s*[\d.]+\s*(m²|㎡|m2|坪)\s*$/i, '').slice(0, 10); r.nameEn = EN[r.name] || (/[一-鿿]/.test(r.name) ? '' : r.name); if (/陽台|露台|balcony/i.test(t.text)) { r.outdoor = true; r.finish = 'balcony'; } if (/浴|廁|bath|wc/i.test(t.text)) { r.finish = 'tile'; r.wet = true; } }
  }
  // the exterior door closest to an "entrance" label is the main door
  const ent = underlay.dxf.texts.find(t => /玄關|入口|entry|entrance/i.test(t.text));
  let best = null;
  for (const w of L.walls) { if (!w.ext) continue; const { ux, uz } = wallFrame(w); for (const o of w.openings) if (o.type === 'door') { const m = [w.a[0] + ux * (o.offset + o.width / 2), w.a[1] + uz * (o.offset + o.width / 2)]; const d = ent ? Math.hypot(m[0] - ent.p[0], m[1] - ent.p[1]) : 0; if (!best || d < best.d) best = { o, d }; } }
  if (best) best.o.main = true;
  const nF = autoFurnish(L, { replace: true, stairs: doc.stairs });
  commit();
  toast(t(`辨識出 ${walls.length} 道牆、${L.rooms.length} 個房間，並自動配置 ${nF} 件家具（Ctrl+Z 可復原）。請檢查門窗類型與房間名稱。`, `Found ${plural(walls.length, 'wall')} and ${plural(L.rooms.length, 'room')}, and placed ${plural(nF, 'piece')} of furniture (Ctrl+Z undoes). Check door/window types and room names.`));
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
  const from = params.get('from'), cid = params.get('id');
  cloud.user = await Cloud.currentUser();
  if (cid && cloud.user) {
    try { const row = await Cloud.loadProject(cid); cloud.id = cid; loadDoc(row.doc, false); }
    catch { toast(t('找不到這個專案', 'Project not found')); loadDoc(blank(), false); }
  } else if (cid) { location.href = '/projects'; return; }
  else if (params.get('new')) loadDoc(blank(), false);
  else if (from && from !== 'custom') { const d = await (await fetch(`data/${from === 'townhouse' ? 'house' : from}.json`)).json(); loadDoc(fromBuiltIn(d), false); }
  else if (saved && saved.levels) loadDoc(saved, false);
  else loadDoc(blank(), false);
  cloud.ready = true; cloudHeader();
  Cloud.onAuth(u => { const was = cloud.user; cloud.user = u; if (!!was !== !!u) cloudHeader(); });
  resize(); fitView();
  setTool(doc.levels[0].walls.length ? 'select' : 'wall');
  window.__editor = { get doc() { return doc; }, loadDoc, importDXF, open3D, setTool, commit, view, fitView, level };
})();
