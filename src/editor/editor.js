// PrimeStride Spatial Lab — plan editor.
// Draw walls, place doors/windows, rooms are detected automatically, place furniture,
// trace over a photo/scan or a DXF, then open the result in 3D.
import { polygonArea, bbox, toPing, wallFrame, pointInPolygon, itemFootprint } from '../plan.js';
import { drawLevel } from '../drawing.js';
import { detectRooms, completePlan, labelPoint, roomFlagsFromName } from './geometry.js';
import { stairLocal, stairBox } from '../plan.js';
import * as Cloud from '../cloud.js';
import { placeDrawn, insideWalls, mergeItems } from './drawn.js';
import { tidyExteriorOpenings } from './openings.js';
import { takeFile } from '../handoff.js';
import { parseDXF, decodeDXF, defaultWallLayers } from './dxf.js';
import { DWG_MAX_BYTES } from './dwg.js';
import { runCADJob, planLevel, ROOM_EN } from './cadimport.js';
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
  '匯入 DXF／DWG': 'Import DXF / DWG',
  '轉檔（DWG → DXF）': 'Converting DWG → DXF',
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
  '正在把平面圖變成 3D': 'Turning your plan into 3D',
  '讀取圖面': 'Reading the drawing',
  '牆體、門窗與樓層': 'Walls, openings and floors',
  'AI 辨識房間': 'AI names the rooms',
  '依圖擺放家具與佈置': 'Furniture as drawn, plus decor',
  '儲存到你的帳號': 'Saving to your account',
  '先檢查平面': 'Check the plan first',
  '開啟 3D 導覽': 'Open the 3D walk-through',
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
const EN = ROOM_EN;
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
// a new project takes its name from the first uploaded file ("寅成NO3-A3.jpg" → "寅成NO3-A3")
function nameFromFile(fname) {
  if (doc.project.name && doc.project.name !== '新專案') return;
  const n = String(fname || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 60);
  if (n && !/^(image|img|scan|screenshot|未命名|untitled)[\s\d-]*$/i.test(n)) { doc.project.name = n; doc.project.nameEn = n; }
}
function newLevel(i, below) {
  const id = `${i + 1}F`;
  const L = { id, name: ['一樓', '二樓', '三樓', '四樓', '五樓'][i] || `${i + 1}樓`, nameEn: ['Ground floor', 'Second floor', 'Third floor', 'Fourth floor', 'Fifth floor'][i] || `Floor ${i + 1}`, elevation: below ? below.elevation + below.height : 0, height: 3.0, walls: [], rooms: [], furniture: [] };
  if (below) L.walls = below.walls.filter(w => w.ext).map(w => ({ ...w, openings: (w.openings || []).filter(o => o.type === 'window').map(o => ({ ...o })), id: undefined }));
  return L;
}
const level = () => doc.levels[lv];

// redetect: false when the rooms were just found for exactly these walls (CAD import result from the worker)
function commit(label, { redetect = true } = {}) {
  if (redetect) for (const L of doc.levels) detectRooms(L);
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
// save right now (used before leaving for the 3D view); true when the project is in the account
async function cloudFlush() {
  if (!cloud.user) return false;
  clearTimeout(cloud.timer);
  for (let i = 0; i < 50 && cloud.busy; i++) await new Promise(r => setTimeout(r, 200));
  await cloudSave();
  return !!cloud.id;
}
function go3D() { if (cloud.id) location.href = `/?id=${encodeURIComponent(cloud.id)}#explore`; else open3D(true); }

// ---------------------------------------------------------------- import progress (picture → 3D)
// Shown while a plan picture becomes a model: each step ticks off with what it found; at the end a short
// summary and the 3D walk-through opens by itself (or the designer stays to check the plan).
const flow = {
  on: false, timer: 0,
  el: () => $('#flow'),
  // cad: a DXF/DWG drawing (rooms are named from the drawing's text, not by AI); dwg: show the 轉檔 step first
  start(name, { cad = false, dwg = false } = {}) {
    const el = this.el(); if (!el) return;
    this.on = true; this.t0 = Date.now(); clearInterval(this.timer);
    el.hidden = false; el.classList.remove('done');
    el.querySelector('#flow-h').textContent = t('正在把平面圖變成 3D', 'Turning your plan into 3D');
    el.querySelector('.fn').textContent = name || '';
    el.querySelector('.pv').style.backgroundImage = 'none';
    el.querySelectorAll('li').forEach(li => { li.className = ''; li.querySelector('small').textContent = ''; });
    const conv = el.querySelector('li[data-k="convert"]');
    if (conv) { conv.hidden = !dwg; if (!dwg) conv.className = 'skip'; }
    const rl = el.querySelector('li[data-k="rooms"] span');
    rl.dataset.ai = rl.dataset.ai || rl.textContent;
    rl.textContent = cad ? t('依圖面文字命名房間', 'Rooms named from the drawing') : rl.dataset.ai;
    const fl = el.querySelector('li[data-k="furniture"] span');
    fl.dataset.ai = fl.dataset.ai || fl.textContent;
    fl.textContent = cad ? t('擺放家具與佈置', 'Furniture and decor') : fl.dataset.ai;
    el.querySelector('.sum').hidden = true; el.querySelector('.acts').hidden = true;
    this.step(dwg ? 'convert' : 'read', 'active');
  },
  preview(src) { if (this.on) this.el().querySelector('.pv').style.backgroundImage = `url("${src}")`; },
  step(k, state, note) {
    if (!this.on) return;
    const li = this.el().querySelector(`li[data-k="${k}"]`); if (!li) return;
    li.className = state; if (note != null) li.querySelector('small').textContent = note;
  },
  fail(msg) {
    if (!this.on) return;
    const el = this.el(); el.classList.add('done');
    el.querySelector('#flow-h').textContent = t('需要你幫一下', 'This one needs a hand');
    el.querySelectorAll('li.active').forEach(li => { li.className = 'skip'; });
    const sum = el.querySelector('.sum'); sum.hidden = false; sum.textContent = msg;
    const acts = el.querySelector('.acts'); acts.hidden = false; acts.querySelector('.go').hidden = true;
    acts.querySelector('.stay').textContent = t('手動描牆', 'Trace by hand');
    acts.querySelector('.stay').onclick = () => this.close();
    this.on = false;
  },
  async afterDetect(aiPromise) {
    if (!this.on) return;
    const nWalls = doc.levels.reduce((n, L) => n + L.walls.length, 0);
    this.step('walls', 'done', t(`${doc.levels.length} 層 · ${nWalls} 道牆`, `${doc.levels.length} floor${doc.levels.length > 1 ? 's' : ''} · ${nWalls} walls`));
    this.step('rooms', 'active');
    const signedIn = !!(await Cloud.accessToken());
    const ok = await aiPromise;
    if (!ok) {
      this.step('rooms', 'skip', signedIn ? t('AI 暫時無法使用，已用規則命名', 'AI unavailable; rule-based names') : t('登入後可用 AI', 'sign in for AI'));
      this.step('furniture', 'done', t('標準配置', 'standard layout'));
    }
    this.step('save', 'active');
    const saved = await cloudFlush().catch(() => false);
    this.step('save', saved ? 'done' : 'skip', saved ? t('已儲存', 'saved') : t('未登入：只存在這台電腦', 'not signed in: this browser only'));
    this.finish();
  },
  finish() {
    const el = this.el(); el.classList.add('done');
    const rooms = doc.levels.reduce((n, L) => n + L.rooms.length, 0), items = doc.levels.reduce((n, L) => n + (L.furniture || []).filter(f => !f.dress).length, 0);
    const deco = doc.levels.reduce((n, L) => n + (L.furniture || []).filter(f => f.dress).length, 0);
    const iss = doc.levels.reduce((n, L) => n + findIssues(L).length, 0), secs = Math.round((Date.now() - this.t0) / 1000);
    el.querySelector('#flow-h').textContent = t('完成，可以走進去了', 'Done. Walk in.');
    const sum = el.querySelector('.sum'); sum.hidden = false;
    sum.innerHTML = t(`<b>${doc.levels.length} 層、${rooms} 個房間、${items} 件家具</b>（另加 ${deco} 件窗簾、燈具與佈置），共 ${secs} 秒。`, `<b>${doc.levels.length} floor${doc.levels.length > 1 ? 's' : ''}, ${rooms} rooms, ${items} pieces of furniture</b> (plus ${deco} curtains, lights and decor) in ${secs} s.`)
      + (iss ? t(`<br>「檢查」列出 ${iss} 處可補強的地方（例如沒接上的牆），之後可以一鍵補上。`, `<br>“Check” lists ${iss} things worth fixing (like walls that don't meet); most are one click.`) : '');
    const acts = el.querySelector('.acts'); acts.hidden = false;
    const goB = acts.querySelector('.go'), stay = acts.querySelector('.stay'); goB.hidden = false;
    stay.textContent = t('先檢查平面', 'Check the plan first');
    let n = 5; const label = () => { goB.textContent = t(`開啟 3D 導覽（${n}）`, `Open the 3D walk-through (${n})`); }; label();
    this.timer = setInterval(() => { n--; if (n <= 0) { clearInterval(this.timer); go3D(); } else label(); }, 1000);
    goB.onclick = () => { clearInterval(this.timer); go3D(); };
    stay.onclick = () => { clearInterval(this.timer); goB.textContent = t('開啟 3D 導覽', 'Open the 3D walk-through'); this.close(); };
    this.on = false;
  },
  close() { clearInterval(this.timer); this.on = false; this.el().hidden = true; },
};
// picture imports: AI names the rooms and reads the drawn furniture; the progress screen follows along
function runAI() { const p = aiNameRooms({ quiet: true }); if (flow.on) flow.afterDetect(p); return p; }
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
const isCAD = f => /\.(dxf|dwg)$/i.test(f.name);
$('#file-dxf').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; e.target.value = ''; isCAD(f) ? importCADFile(f) : importImageFile(f); });
$('#file-img').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  isCAD(f) ? importCADFile(f) : importImageFile(f);
});
async function importImageFile(f) {
  nameFromFile(f.name);
  if (!doc.levels.some(L => L.walls.length)) flow.start(f.name);
  let src;
  try { src = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name) ? await pdfToImage(f) : URL.createObjectURL(f); }
  catch (err) { console.error(err); flow.fail(t('無法讀取這個 PDF', 'Could not read this PDF')); toast(t('無法讀取這個 PDF', 'Could not read this PDF')); return; }
  flow.preview(src);
  const img = new Image();
  img.onerror = () => flow.fail(t('無法讀取這張圖片', 'Could not read this picture'));
  img.onload = () => {
    underlay.imgEl = img; underlay.x = 0; underlay.z = 0;
    // find the walls once; the drawn wall thickness also gives a first guess at the scale (exterior wall ≈ 25 cm)
    try {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
      underlay.lines = extractPlanLines(g.getImageData(0, 0, c.width, c.height));
    } catch (err) { console.error(err); underlay.lines = null; }
    underlay.mpp = underlay.lines && underlay.lines.tPx ? 0.18 / underlay.lines.tPx : 12 / img.width;
    $('#ul-img').hidden = false; fitView();
    // empty project: go straight to walls, rooms, furniture and AI names (scale from wall thickness; a printed size corrects it)
    if (underlay.lines && underlay.lines.faces.length && !doc.levels.some(L => L.walls.length)) {
      flow.step('read', 'done', `${img.width}×${img.height}`); flow.step('walls', 'active');
      setTool('select'); setTimeout(() => $('#img-detect').click(), 60); return;
    }
    if (flow.on) flow.fail(t('這張圖找不到清楚的牆線。可以手動描牆，或換一張解析度較高的格局圖。', 'No clear walls found in this picture. Trace them by hand, or try a sharper plan.'));
    setTool('scale');
    toast(t('底圖已載入，比例已依牆厚估算。點兩個已知距離的點校正比例（例如一道標有尺寸的牆），再按「自動辨識牆體」。', 'Plan loaded; scale estimated from the wall thickness. Click two points a known distance apart to correct it (e.g. a dimensioned wall), then press “Detect walls”.'));
  };
  img.src = src;
}
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
// picture px (in the image sent to the AI, scale S) → plan metres on a floor with picture shift sh
const toPlanPx = ([px, py], sh, S) => [underlay.x + (px / S + sh[0]) * underlay.mpp, underlay.z + (py / S + sh[1]) * underlay.mpp];
let aiState = 'unknown'; // 'off' once the server says no key is configured
async function aiNameRooms({ quiet = false } = {}) {
  if (!underlay.imgEl || aiState === 'off') { if (!quiet) toast(t('AI 命名需要先匯入平面圖圖片', 'AI naming needs an imported plan picture')); return false; }
  const img = underlay.imgEl, S = Math.min(1, 1568 / Math.max(img.width, img.height), Math.sqrt(1.15e6 / (img.width * img.height))); // ≤1.15 MP: the model then sees our exact pixels
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
  flow.step('rooms', 'active', t('約 20–40 秒', 'about 20–40 s'));
  let out;
  try {
    const token = await Cloud.accessToken();
    if (!token) { if (!quiet) toast(t('登入後即可使用 AI 辨識房間名稱', 'Sign in to name rooms with AI')); else toast(t('已依規則命名房間；登入後可用 AI 辨識房間名稱。', 'Rooms got rule-based names; sign in to name them with AI.')); return false; }
    // two independent reads in parallel, merged: the model's item lists vary run to run, the union is far steadier
    const body = JSON.stringify({ image: c.toDataURL('image/jpeg', 0.85), count: marks.length, floors: doc.levels.length, size: [c.width, c.height] });
    const ask = () => fetch('/api/vision', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body }).then(async r => ({ r, j: await r.json().catch(() => ({})) }), () => null);
    const [a, b] = await Promise.all([ask(), ask()]);
    const good = [a, b].filter(x => x && x.r.ok);
    const r = (good[0] || a || b || {}).r;
    if (!r) throw new Error('network');
    if (r.status === 401) { if (!quiet) toast(t('請重新登入後再試', 'Please sign in again')); return false; }
    if (r.status === 503 || r.status === 404) { aiState = 'off'; if (!quiet) toast(t('AI 命名尚未啟用（伺服器未設定金鑰），已使用規則命名。', 'AI naming is not enabled on the server yet; rule-based names are used.')); return false; }
    if (!good.length) throw new Error((a && a.j.error) || r.status);
    out = good[0].j;
    // what the AI answered, kept for QA recordings (qa/recordings/<fixture>.json: replayed by the regression gate)
    window.__qaVision = { S, size: [c.width, c.height], file: doc.project.name, passes: good.map(g => ({ rooms: g.j.rooms, items: g.j.items, scale: g.j.scale })) };
    if (good[1]) out.items = mergeItems(out.items || [], good[1].j.items || []);
    flow.step('rooms', 'done', t(`${out.rooms.length} 間`, `${out.rooms.length} rooms`)); flow.step('furniture', 'active', t(`圖面上 ${(out.items || []).length} 件`, `${(out.items || []).length} drawn`));
    // second look: the drawing has furniture but some furnishable rooms came back empty → ask about just those rooms
    if ((out.items || []).length >= 3) {
      const hit = new Set(out.items.map(it => it.n));
      const typeOf = new Map(out.rooms.map(x => [x.n, x.type]));
      // big open rooms whose items sit at one end only (the dining set found, the living set missed)
      const lopsided = m => {
        if (polygonArea(m.r.polygon) < 25) return false;
        const sh = m.L.imgShift || [0, 0], pts = out.items.filter(it => it.n === m.n).map(it => toPlanPx([(it.box[0] + it.box[2]) / 2, (it.box[1] + it.box[3]) / 2], sh, S));
        const b = bbox(m.r.polygon), long = b.x1 - b.x0 > b.z1 - b.z0 ? 0 : 1, lo = long ? b.z0 : b.x0, hi = long ? b.z1 : b.x1;
        const vs = pts.map(p => p[long]); return !vs.length || (Math.max(...vs) - Math.min(...vs)) < 0.5 * (hi - lo);
      };
      const empty = marks.filter(m => /客|餐|廚|臥|書|和|浴/.test(typeOf.get(m.n) || '') && ((!hit.has(m.n) && polygonArea(m.r.polygon) >= 4.5) || lopsided(m))).map(m => m.n);
      if (empty.length) {
        if (!quiet) toast(t('AI 再看一次部分房間的家具…', 'AI is taking a second look at some rooms…'));
        flow.step('furniture', 'active', t('AI 再看一次部分房間…', 'second look at some rooms…'));
        const r2 = await fetch('/api/vision', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ image: c.toDataURL('image/jpeg', 0.85), count: marks.length, floors: doc.levels.length, size: [c.width, c.height], focus: empty }) });
        if (r2.ok) { // keep what the second look adds; drop near-duplicates of items already found
          const o2 = await r2.json(); window.__qaVision.passes[2] = { rooms: o2.rooms, items: o2.items, scale: o2.scale, focus: empty }; const same = (a, b) => a.kind === b.kind && Math.abs((a.box[0] + a.box[2]) - (b.box[0] + b.box[2])) < 30 && Math.abs((a.box[1] + a.box[3]) - (b.box[1] + b.box[3])) < 30;
          out.items = out.items.concat((o2.items || []).filter(it => empty.includes(it.n) && !out.items.some(x => same(x, it))));
        }
      }
    }
  } catch (e) { console.warn('vision', e); if (!quiet) toast(t('AI 命名失敗，請稍後再試', 'AI naming failed; try again later')); return false; }
  // apply names (second and later bedrooms on a floor become 次臥, 次臥 2…)
  const seen = new Map();
  for (const x of out.rooms) {
    const m = marks[x.n - 1]; if (!m) continue;
    const r = m.r; let name = x.name, en = x.nameEn;
    if (name === '臥室') { const k = (seen.get(m.L) || 0) + 1; seen.set(m.L, k); name = k === 1 ? '次臥' : `次臥 ${k}`; en = k === 1 ? 'Bedroom' : `Bedroom ${k}`; }
    r.name = name; r.nameEn = en;
    r.wet = /浴/.test(name); if (r.wet) r.finish = 'tile';
    Object.assign(r, roomFlagsFromName(name, r.finish)); // outdoor ↔ balcony finish, both ways
    r.circulation = /走道|樓梯|玄關/.test(name);
    r.hasStairs = !!x.stairs;
    if (x.floor && !r.wet && !r.outdoor) r.floor = x.floor === 'tile' ? 'stone' : x.floor; // drawn floor finish (wet rooms keep their tile)
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
  tidyExteriorOpenings(doc);
  // the drawing's own furniture layout: each item goes on the floor of the room it was drawn in (rooms keep their
  // position through detectRooms, so the marker's floor is the item's floor); rooms with nothing drawn get the generic layout
  let nDrawn = 0;
  const byLevel = new Map();
  for (const it of out.items || []) {
    // by position first (several floors side by side in one picture: only the right floor's shift lands it in a room), then by the room number
    const c = [(it.box[0] + it.box[2]) / 2, (it.box[1] + it.box[3]) / 2], m = marks[it.n - 1];
    const at = Lv => toPlanPx(c, Lv.imgShift || [0, 0], S);
    const L = doc.levels.find(Lv => Lv.rooms.some(r => pointInPolygon(at(Lv), r.polygon))) || doc.levels.find(Lv => insideWalls(Lv, at(Lv))) || (m ? m.L : null);
    if (!L) continue;
    if (!byLevel.has(L)) byLevel.set(L, []); byLevel.get(L).push(it);
  }
  for (const L of doc.levels) {
    L.furniture = (L.furniture || []).filter(f => !f.auto);
    const items = byLevel.get(L);
    if (items) { const sh = L.imgShift || [0, 0]; const placed = placeDrawn(L, items, q => toPlanPx(q, sh, S), doc.stairs); L.furniture.push(...placed); nDrawn += placed.length; }
    autoFurnish(L, { replace: false, stairs: doc.stairs, skipDrawn: true });
  }
  commit();
  flow.step('furniture', 'done', nDrawn ? t(`${nDrawn} 件依圖面`, `${nDrawn} as drawn`) : t('標準配置', 'standard layout'));
  toast(nDrawn
    ? t(`AI 已命名 ${out.rooms.length} 個房間，並依圖面擺放 ${nDrawn} 件家具${out.scale ? '；比例已依圖面尺寸校正' : ''}。`, `AI named ${plural(out.rooms.length, 'room')} and placed ${nDrawn} pieces as drawn${out.scale ? '; scale set from a printed size' : ''}.`)
    : t(`AI 已命名 ${out.rooms.length} 個房間${out.scale ? '、依圖面尺寸校正比例' : ''}，家具已依房間類型重新配置。`, `AI named ${plural(out.rooms.length, 'room')}${out.scale ? ' and set the scale from a printed size' : ''}; furniture was rearranged to match.`));
  return true;
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
  if (!underlay.imgEl || !underlay.lines || !underlay.lines.faces.length) { flow.fail(t('這張圖找不到牆線，請手動描繪', 'No walls found in this image. Trace them by hand.')); toast(t('這張圖找不到牆線，請手動描繪', 'No walls found in this image. Trace them by hand.')); return; }
  const { walls, floors } = wallsFromImage(underlay.lines, { mpp: underlay.mpp, ox: underlay.x, oz: underlay.z });
  if (!walls.length) { flow.fail(t('這張圖找不到牆線，請手動描繪', 'No walls found in this image. Trace them by hand.')); toast(t('這張圖找不到牆線，請手動描繪', 'No walls found in this image. Trace them by hand.')); return; }
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
    tidyExteriorOpenings(doc);
    for (const L of doc.levels) nF += autoFurnish(L, { stairs: doc.stairs });
    lv = 0; buildLevelTabs(); commit();
    const counts = doc.levels.map(L => `${L.id} ${L.rooms.length}`).join('、');
    toast(t(`偵測到 ${floors.length} 個樓層（左到右為 1F→${floors.length}F），房間：${counts}。各樓層已對齊到 1F 位置；請逐層檢查缺口與門窗。`, `Found ${floors.length} floors (left to right = 1F→${floors.length}F). Rooms: ${counts}. Floors are aligned onto 1F; check each floor for gaps and openings.`));
    runAI();
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
  tidyExteriorOpenings(doc);
  autoFurnish(L, { replace: true, stairs: doc.stairs });
  commit();
  toast(t(`辨識出 ${walls.length} 道牆、${L.rooms.length} 個房間。請檢查缺口、門窗與房間名稱；未封閉的空間用「牆」補上。`, `Found ${plural(walls.length, 'wall')} and ${plural(L.rooms.length, 'room')}. Check gaps, doors/windows and room names; close open spaces with the Wall tool.`));
  runAI();
});
$('#ul-opacity').addEventListener('input', e => { underlay.opacity = +e.target.value; render(); });
$('#ul-remove').addEventListener('click', () => { underlay.imgEl = null; $('#ul-img').hidden = true; render(); });
$('#file-json').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); loadDoc(d.levels && d.levels[0] && d.levels[0].walls && !d.story ? d : fromBuiltIn(d)); } catch (err) { toast(t('無法讀取這個 JSON 檔', 'Could not read this JSON file')); } e.target.value = ''; });
$('#btn-download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(isEn ? doc.project.nameEn || doc.project.name : doc.project.name) || 'plan'}.spatial.json`; a.click();
});
$('#btn-3d').addEventListener('click', () => open3D());
async function open3D(explore = false) {
  if (!doc.levels[0].rooms.length) { toast(t('還沒有封閉的房間：先畫出外牆和隔間。', 'No closed rooms yet. Draw the exterior walls and partitions first.')); return; }
  const base = await (await fetch('data/apartment.json')).json();
  const full = completePlan(doc, base);
  try { localStorage.setItem('spatial.custom', JSON.stringify(full)); } catch { toast(t('瀏覽器儲存空間不足', 'Not enough browser storage')); return; }
  location.href = `index.html?p=custom${explore ? '#explore' : ''}`;
}

// A DXF or DWG file picked or dropped. Into an empty project it goes straight to walls, rooms and furniture with the
// progress screen (like a picture); into a plan with walls it only becomes the underlay to trace over.
// The drawing is converted (DWG), read, and, into an empty project, turned into walls, rooms, names and furniture in
// a Worker (cadimport.js); this page only shows the steps with a running clock and applies the result.
async function importCADFile(f) {
  nameFromFile(f.name);
  const auto = !doc.levels.some(L => L.walls.length);
  const dwg = /\.dwg$/i.test(f.name);
  if (auto) flow.start(f.name, { cad: true, dwg });
  else toast(dwg ? t('DWG 轉檔中…', 'Converting the DWG…') : t('讀取圖面中…', 'Reading the drawing…'));
  let buf;
  try { buf = await f.arrayBuffer(); } catch (err) { console.error(err); return cadFail(t('無法讀取這個檔案', 'Could not read this file')); }
  const order = [...(dwg ? ['convert'] : []), 'read', 'walls', 'rooms', 'furniture'];
  let cur = order[0], since = Date.now(), layersRead = [];
  const secs = () => Math.round((Date.now() - since) / 1000);
  const tick = setInterval(() => { if (secs() >= 1) flow.step(cur, 'active', t(`${secs()} 秒…`, `${secs()} s…`)); }, 500);
  const next = k => { const i = order.indexOf(k); cur = order[i + 1]; since = Date.now(); if (cur) flow.step(cur, 'active'); };
  const onStage = (k, info) => {
    if (k === 'convert') { console.info(`DWG ${info.version} → DXF in ${info.ms.total} ms (read ${info.ms.read}, write ${info.ms.write})`); flow.step('convert', 'done', t(`AutoCAD ${info.year} · ${(info.ms.total / 1000).toFixed(1)} 秒`, `AutoCAD ${info.year} · ${(info.ms.total / 1000).toFixed(1)} s`)); }
    if (k === 'read') { flow.step('read', 'done', t(`${info.segs} 線段 · ${info.layers} 圖層`, `${info.segs} lines · ${info.layers} layers`)); layersRead = info.wallLayers || []; }
    if (k === 'walls') flow.step('walls', 'done', t(`${info.walls} 道牆 · 圖層 ${layersRead.join('、')}`.slice(0, 48), `${info.walls} walls · layer ${layersRead.join(', ')}`.slice(0, 48)));
    if (k === 'rooms') flow.step('rooms', 'done', t(`${info.rooms} 間${info.named ? `，${info.named} 間有名稱` : ''}`, `${info.rooms} rooms${info.named ? `, ${info.named} named` : ''}`));
    if (k === 'furniture') flow.step('furniture', 'done', t(`${info.furniture} 件標準配置`, `${info.furniture} pieces, standard layout`));
    next(k);
  };
  const t0 = performance.now();
  let res;
  try { res = await runCADJob(buf, { dwg, plan: auto, stairs: doc.stairs, levelId: level().id, onStage }); }
  catch (err) { console.error(err); return cadFail(cadMessage(err)); }
  finally { clearInterval(tick); }
  console.info(`CAD import ${f.name}: ${Math.round(performance.now() - t0)} ms in the worker`);
  // apply in small pieces with a frame in between, so a big drawing never holds the page for long
  const frame = () => new Promise(r => setTimeout(r, 20)); // (not rAF: a background tab would stall the import)
  await frame();
  showDrawing(res.d, res.wallLayers, f.name);
  await frame();
  if (!auto) { toast(t(`圖面已載入，牆線圖層：${res.wallLayers.join('、')}。按「自動辨識牆體」，或直接沿著藍線描牆。`, `Drawing loaded. Wall layers: ${res.wallLayers.join(', ')}. Press “Detect walls”, or trace along the blue lines.`)); return; }
  cadPreview(res.d);
  await frame();
  setTool('select');
  if (!res.level) { cadFail(t(`牆線圖層（${res.wallLayers.join('、')}）找不到牆。請在右側改選牆線圖層後按「自動辨識牆體」，或沿著藍線手動描牆。`, `No walls on the wall layers (${res.wallLayers.join(', ')}). Pick other wall layers on the right and press “Detect walls”, or trace along the blue lines.`)); return; }
  const L = level(); sel = null;
  Object.assign(L, res.level);
  commit('import', { redetect: false });
  flow.step('save', 'active');
  const saved = await cloudFlush().catch(() => false);
  flow.step('save', saved ? 'done' : 'skip', saved ? t('已儲存', 'saved') : t('未登入：只存在這台電腦', 'not signed in: this browser only'));
  flow.finish();
}
function cadFail(msg) { if (flow.on) flow.fail(msg); toast(msg); }
function cadMessage(err) {
  if (err.code === 'dxf-failed') return t('DXF 讀取失敗：請另存為 ASCII DXF（R2010 或更舊）', 'Could not read the DXF. Save it as ASCII DXF (R2010 or older).');
  if (err.code === 'no-lines') return t('這個圖檔沒有可用的線條', 'This drawing has no usable lines');
  if (err.code === 'crashed') return t('瀏覽器處理這張圖時中斷了（多半是圖面太大、記憶體不足）。請關閉其他分頁後再試一次，或在 CAD 中刪掉用不到的圖層、圖塊後再上傳。', 'The browser stopped while working on this drawing (usually too big for the memory available). Close other tabs and try again, or delete unused layers and blocks in your CAD app and upload again.');
  if (err.code === 'timeout') return t('圖面處理超過 3 分鐘仍未完成。請刪減圖面內容（例如不需要的圖層、圖塊）後再試。', 'The drawing took over 3 minutes. Trim it (unused layers, blocks) and try again.');
  const mb = err.bytes ? (err.bytes / 1048576).toFixed(0) : '';
  switch (err.code) {
    case 'too-large': return t(`這個 DWG 有 ${mb} MB，超過 ${DWG_MAX_BYTES / 1048576} MB 上限。請在 AutoCAD 刪掉用不到的圖層並執行 PURGE 清理後再上傳，或另存為 DXF。`, `This DWG is ${mb} MB, over the ${DWG_MAX_BYTES / 1048576} MB limit. Delete unused layers and run PURGE in AutoCAD, then upload again, or save it as DXF.`);
    case 'not-dwg': return t('這不是 AutoCAD 的 DWG 檔，或檔案已損毀。', 'This is not an AutoCAD DWG file, or the file is damaged.');
    case 'old-version': return t(`這個 DWG 是 R12 以前的舊格式（${err.version}）。請在 CAD 中另存為 AutoCAD 2018 DWG 或 DXF 再上傳。`, `This DWG uses a format older than R12 (${err.version}). Save it as AutoCAD 2018 DWG or DXF and upload again.`);
    case 'new-version': case 'unsupported-version': return t(`目前還無法轉換這個 DWG 版本${err.version ? `（${err.version}）` : ''}。請在 AutoCAD 另存為「AutoCAD 2018 DWG」或 DXF 再上傳。`, `This DWG version${err.version ? ` (${err.version})` : ''} can't be converted yet. Save it as "AutoCAD 2018 DWG" or DXF in AutoCAD and upload again.`);
    case 'empty': return t('這個 DWG 裡沒有可讀取的線條（可能只有外部參照或專用物件）。請在 CAD 中綁定外部參照，或另存為 DXF 再上傳。', 'No readable lines in this DWG (it may only hold external references or custom objects). Bind the xrefs in your CAD app, or save as DXF, and upload again.');
    case 'timeout': return t('DWG 轉檔超過 2 分鐘仍未完成。請刪減圖面內容（例如不需要的圖層、圖塊）後再試，或另存為 DXF。', 'The DWG conversion took over 2 minutes. Trim the drawing (unused layers, blocks) and try again, or save it as DXF.');
    default: return t('DWG 轉檔失敗，檔案可能損毀或含有無法讀取的物件。請在 AutoCAD 另存為 DXF 後再上傳。', 'The DWG could not be converted; the file may be damaged or hold objects we cannot read. Save it as DXF in AutoCAD and upload again.');
  }
}
// small top-down picture of the drawing for the progress screen
function cadPreview(d) {
  try {
    const pts = d.segs.flatMap(s => [s.a, s.b]); if (!pts.length) return;
    // 1st–99th percentile, so a stray title block or a point far away doesn't shrink the plan to a dot
    const q = (v, f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
    const xs = pts.map(p => p[0]).sort((a, b) => a - b), zs = pts.map(p => p[1]).sort((a, b) => a - b);
    const b = { x0: q(xs, 0.01), x1: q(xs, 0.99), z0: q(zs, 0.01), z1: q(zs, 0.99) }, W = 1120, H = 360, c = document.createElement('canvas'); c.width = W; c.height = H;
    const sc = Math.min((W - 40) / (b.x1 - b.x0 || 1), (H - 40) / (b.z1 - b.z0 || 1));
    const g = c.getContext('2d'); g.fillStyle = '#f3efe8'; g.fillRect(0, 0, W, H); g.strokeStyle = '#3a342c'; g.lineWidth = 1.2; g.beginPath();
    const ox = (W - (b.x1 - b.x0) * sc) / 2, oz = (H - (b.z1 - b.z0) * sc) / 2;
    // big drawings: only the 6,000 longest lines, so the picture stays a few ms (it is decoration)
    const segs = d.segs.length <= 6000 ? d.segs : d.segs.map(s => [Math.abs(s.b[0] - s.a[0]) + Math.abs(s.b[1] - s.a[1]), s]).sort((p, q) => q[0] - p[0]).slice(0, 6000).map(p => p[1]);
    for (const s of segs) { g.moveTo(ox + (s.a[0] - b.x0) * sc, oz + (s.a[1] - b.z0) * sc); g.lineTo(ox + (s.b[0] - b.x0) * sc, oz + (s.b[1] - b.z0) * sc); }
    g.stroke(); flow.preview(c.toDataURL('image/png'));
  } catch (err) { console.error(err); }
}
// put a read drawing under the plan: layers list, wall layers, view
function showDrawing(d, wallLayers, name) {
  underlay.dxf = d;
  underlay.dxfLayers = new Set(Object.keys(d.layers));
  underlay.wallLayers = new Set(wallLayers);
  buildLayerList();
  $('#ul-dxf').hidden = false;
  $('#dxf-name').textContent = `${name} · ${(d.units * 1000).toFixed(0) === '1' ? 'mm' : d.units === 0.01 ? 'cm' : 'm'} · ${d.segs.length} ${t('線段', 'lines')}`;
  fitView();
}
// a small DXF (the sample menu) read on the page and shown as the underlay; files go through importCADFile
function importDXF(src, name) {
  if (typeof src !== 'string' && /\.dwg$/i.test(name || '')) { importCADFile(new File([src], name)); return; }
  let d;
  try { d = parseDXF(typeof src === 'string' ? src : decodeDXF(src)); } catch (err) { console.error(err); toast(t('DXF 讀取失敗：請另存為 ASCII DXF（R2010 或更舊）', 'Could not read the DXF. Save it as ASCII DXF (R2010 or older).')); return; }
  if (!d.segs.length) { toast(t('這個圖檔沒有可用的線條', 'This drawing has no usable lines')); return; }
  showDrawing(d, defaultWallLayers(d), name);
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
$('#dxf-detect').addEventListener('click', () => detectDXF());
// DXF underlay → walls, rooms named from the drawing's text, main door, furniture. Returns counts, or null when no walls.
function detectDXF() {
  if (!underlay.wallLayers.size) { toast(t('請先勾選至少一個牆線圖層', 'Tick at least one wall layer first')); return null; }
  sel = null;
  const r = planLevel(underlay.dxf, [...underlay.wallLayers], level(), { stairs: doc.stairs });
  if (!r) { toast(t('這些圖層找不到牆線，請改選圖層或手動描繪', 'No wall lines on these layers. Pick other layers or trace by hand.')); return null; }
  commit();
  toast(t(`辨識出 ${r.walls} 道牆、${r.rooms} 個房間，並自動配置 ${r.furniture} 件家具（Ctrl+Z 可復原）。請檢查門窗類型與房間名稱。`, `Found ${plural(r.walls, 'wall')} and ${plural(r.rooms, 'room')}, and placed ${plural(r.furniture, 'piece')} of furniture (Ctrl+Z undoes). Check door/window types and room names.`));
  return r;
}
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
  // a file picked on the projects page: import it straight away
  if (params.get('upload')) {
    const u = new URL(location.href); u.searchParams.delete('upload'); history.replaceState(null, '', u);
    const f = await takeFile().catch(() => null);
    if (f) setTimeout(() => (isCAD(f) ? importCADFile(f) : importImageFile(f)), 50);
  }
  Cloud.onAuth(u => { const was = cloud.user; cloud.user = u; if (!!was !== !!u) cloudHeader(); });
  resize(); fitView();
  setTool(doc.levels[0].walls.length ? 'select' : 'wall');
  window.__editor = { get doc() { return doc; }, loadDoc, importDXF, importCADFile, open3D, setTool, commit, view, fitView, level };
})();
