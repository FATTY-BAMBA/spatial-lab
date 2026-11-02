// 匯出: hand the model to the designer's own tools.
//   .glb  — SketchUp, Blender, D5 Render, Twinmotion (colour materials, metres, named groups)
//   .obj  — 3ds Max, Rhino and the rest (zip with .mtl)
//   .dxf  — the 2D plan for AutoCAD (layers, millimetres), drawn by the same code as the on-screen plan
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { drawLevel, planFrame } from './drawing.js';
import { polygonArea, toPing } from './plan.js';

const CAT = {
  walls: '牆 Walls', tile: '壁磚 Wall tile', trim: '踢腳板 Skirting', openings: '門窗 Doors & windows',
  railings: '欄杆 Railings', ceiling: '天花板 Ceiling', lighting: '天花造型與燈具 Ceiling details & lights',
  stairs: '樓梯 Stairs', furniture: '家具與設備 Furniture & fixtures', other: '其他 Other',
};

// ---------- 3D ----------
function avgColor(tex) {
  const img = tex && tex.image;
  if (!img || img.data || !(img.width || img.videoWidth)) return null;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch { return null; }
}

// Plain colour materials: every CAD/render tool reads them, and SketchUp drops textured glTF colours to white.
function materialConverter() {
  const cache = new Map(), used = new Map();
  const conv = m => {
    if (Array.isArray(m)) return m.map(conv);
    if (cache.has(m)) return cache.get(m);
    const color = m.color ? m.color.clone() : new THREE.Color(1, 1, 1);
    const avg = avgColor(m.map); if (avg) color.multiply(avg);
    let name = (m.name || 'material').replace(/\s+/g, '_');
    const k = (used.get(name) || 0) + 1; used.set(name, k); if (k > 1) name += '_' + k;
    const see = m.transparent && m.opacity < 0.99;
    const n = new THREE.MeshStandardMaterial({
      name, color, roughness: m.roughness ?? 0.8, metalness: m.metalness ?? 0, side: m.side,
      transparent: see, opacity: see ? Math.max(0.25, m.opacity) : 1,
    });
    cache.set(m, n); return n;
  };
  return conv;
}

// Furniture GLBs store quantised (int16, normalised) positions; other tools need plain floats in metres.
// UVs are dropped too: exported materials are plain colours.
function geometryConverter() {
  const cache = new Map();
  return geo => {
    if (cache.has(geo)) return cache.get(geo);
    const g = new THREE.BufferGeometry();
    if (geo.index) g.setIndex(Array.from(geo.index.array));
    for (const k of ['position', 'normal']) {
      const a = geo.attributes[k]; if (!a) continue;
      const out = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++) { out[i * 3] = a.getX(i); out[i * 3 + 1] = a.getY(i); out[i * 3 + 2] = a.getZ(i); }
      if (k === 'normal') for (let i = 0; i < out.length; i += 3) { const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1; out[i] /= l; out[i + 1] /= l; out[i + 2] /= l; }
      g.setAttribute(k, new THREE.BufferAttribute(out, 3));
    }
    for (const gr of geo.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    if (!g.attributes.normal) g.computeVertexNormals();
    cache.set(geo, g); return g;
  };
}

function buildExportScene(world, plan, title) {
  const root = new THREE.Group(); root.name = title;
  for (const L of plan.levels) {
    const lv = world.levels[L.id]; if (!lv) continue;
    const lg = new THREE.Group(); lg.name = [L.name, L.nameEn].filter(Boolean).join(' ') || L.id; lg.position.y = L.elevation;
    root.add(lg);
    const floors = new THREE.Group(); floors.name = '地板 Floors'; lg.add(floors);
    for (const c of lv.group.children) {
      if (!c.isMesh || !c.userData.room) continue;
      const r = L.rooms.find(x => x.id === c.userData.room);
      const m = c.clone(); m.visible = true;
      m.name = r ? `${r.name} ${r.nameEn || ''} ${polygonArea(r.polygon).toFixed(1)}m² ${toPing(polygonArea(r.polygon)).toFixed(1)}坪`.replace(/\s+/g, ' ').trim() : 'floor';
      floors.add(m);
    }
    const groups = {}, count = {};
    for (const c of lv.rise.children) {
      const cat = c.userData.cat || 'other';
      if (!groups[cat]) { groups[cat] = new THREE.Group(); groups[cat].name = CAT[cat] || cat; lg.add(groups[cat]); }
      const o = c.clone(); o.visible = true;
      const f = c.userData.item;
      count[cat] = (count[cat] || 0) + 1;
      o.name = f ? [f.name || f.kind, f.nameEn].filter(Boolean).join(' ') : `${(CAT[cat] || cat).split(' ').pop()} ${count[cat]}`;
      groups[cat].add(o);
    }
  }
  // strip what other tools cannot use: edge lines, lights, hidden helpers; swap materials
  const conv = materialConverter(), geom = geometryConverter(), drop = [];
  root.traverse(o => {
    if (o === root) return;
    if (o.isLine || o.isPoints || o.isSprite || o.isLight || o.isCamera || !o.visible) { drop.push(o); return; }
    if (o.isMesh) {
      o.material = conv(o.material); o.geometry = geom(o.geometry); o.castShadow = o.receiveShadow = false;
      if (!o.name) { let p = o.parent; while (p && !p.name) p = p.parent; o.name = p ? p.name : 'mesh'; }
    }
  });
  for (const o of drop) o.removeFromParent();
  root.updateMatrixWorld(true);
  return root;
}

export async function exportGLB(world, plan, title) {
  const root = buildExportScene(world, plan, title);
  const buf = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  return new Blob([buf], { type: 'model/gltf-binary' });
}

export async function exportOBJ(world, plan, title, base) {
  const root = buildExportScene(world, plan, title);
  const obj = `# ${title}\n# PrimeStride Spatial Lab · units: metres · Y up\nmtllib ${base}.mtl\n` + new OBJExporter().parse(root).replace(/(-?\d+\.\d{5})\d+/g, '$1');
  const mats = new Map();
  root.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) mats.set(m.name, m); });
  let mtl = `# ${title}\n`;
  for (const [name, m] of mats) {
    const c = m.color.clone().convertLinearToSRGB();
    mtl += `\nnewmtl ${name}\nKd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}\nKa 0 0 0\nKs ${m.metalness > 0.5 ? '0.6 0.6 0.6' : '0.04 0.04 0.04'}\nNs ${Math.round((1 - m.roughness) * 200)}\nd ${m.opacity.toFixed(3)}\nillum 2\n`;
  }
  const readme = `${title}\r\n\r\n單位：公尺（匯入時請選 Meters）· Units: metres\r\n座標：Y 軸向上（SketchUp / 3ds Max 匯入時可勾選 Swap YZ）· Y is up\r\n\r\n${base}.obj + ${base}.mtl 請放在同一個資料夾。Keep the .obj and .mtl together.\r\n材質為純色，方便換成貴公司自己的材質庫。Materials are plain colours, ready to swap for your own library.\r\n\r\nPrimeStride Spatial Lab\r\n`;
  return zip([[`${base}.obj`, obj], [`${base}.mtl`, mtl], ['README 說明.txt', readme]]);
}

// ---------- tiny store-only zip ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function deflate(data) {
  if (typeof CompressionStream === 'undefined') return null;
  try { return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); } catch { return null; }
}
async function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, text] of files) {
    const n = enc.encode(name), raw = typeof text === 'string' ? enc.encode(text) : text, crc = crc32(raw);
    const packed = await deflate(raw), method = packed && packed.length < raw.length ? 8 : 0, data = method ? packed : raw;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, raw.length, true);
    h.setUint16(26, n.length, true); h.setUint16(28, 0, true);
    parts.push(h, n, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, raw.length, true);
    c.setUint16(28, n.length, true); c.setUint32(42, off, true);
    central.push(c, n);
    off += 30 + n.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e], { type: 'application/zip' });
}

// ---------- 2D: DXF (R12, millimetres) ----------
// A canvas-2D look-alike that records the plan drawing as CAD entities, so the DXF matches the screen.
const INK_RE = /^#1f2328$/i;
class DxfRecorder {
  constructor() {
    this.m = [1, 0, 0, 1, 0, 0]; this.stack = []; this.subs = []; this.lp = null; this.layer = '0'; this.dash = false; this.clipped = 0;
    this.font = '10px sans-serif'; this.textAlign = 'start'; this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.ents = [];
    this.width = 0; this.height = 0;
  }
  getContext() { return this; }
  setLayer(n) { this.layer = n; }
  save() { this.stack.push({ m: [...this.m], dash: this.dash, clipped: this.clipped, font: this.font, textAlign: this.textAlign, fillStyle: this.fillStyle }); }
  restore() { const s = this.stack.pop(); if (s) Object.assign(this, s); }
  translate(x, y) { const m = this.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; }
  rotate(a) { const m = this.m, c = Math.cos(a), s = Math.sin(a); this.m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, -m[0] * s + m[2] * c, -m[1] * s + m[3] * c, m[4], m[5]]; }
  P(x, y) { const m = this.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  get rot() { return Math.atan2(this.m[1], this.m[0]); }
  setLineDash(a) { this.dash = !!(a && a.length); }
  clip() { this.clipped++; }
  clearRect() {}
  beginPath() { this.subs = []; this.lp = null; }
  cur() { return this.subs[this.subs.length - 1]; }
  moveTo(x, y) { this.subs.push({ pts: [this.P(x, y)], closed: false, arc: null }); this.lp = [x, y]; }
  lineTo(x, y) { if (!this.cur()) return this.moveTo(x, y); const s = this.cur(); s.pts.push(this.P(x, y)); s.arc = null; s.mixed = true; this.lp = [x, y]; }
  closePath() { const s = this.cur(); if (!s) return; s.closed = true; const p = s.pts[0]; this.subs.push({ pts: [p], closed: false, arc: null }); }
  rect(x, y, w, h) { this.subs.push({ pts: [this.P(x, y), this.P(x + w, y), this.P(x + w, y + h), this.P(x, y + h)], closed: true }); this.moveTo(x, y); }
  arc(cx, cy, r, a0, a1, ccw = false) {
    const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
    let sweep = a1 - a0;
    if (full) sweep = ccw ? -Math.PI * 2 : Math.PI * 2;
    else if (!ccw && sweep < 0) sweep += Math.PI * 2 * Math.ceil(-sweep / (Math.PI * 2));
    else if (ccw && sweep > 0) sweep -= Math.PI * 2 * Math.ceil(sweep / (Math.PI * 2));
    const n = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
    const pts = []; for (let i = 0; i <= n; i++) { const a = a0 + (sweep * i) / n; pts.push(this.P(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
    const s = this.cur(), fresh = !s || (s.pts.length <= 1 && !s.mixed);
    const prim = { c: this.P(cx, cy), r, a0: a0 + this.rot, sweep, full };
    if (fresh) { if (s) this.subs.pop(); this.subs.push({ pts, closed: false, arc: prim }); }
    else { s.pts.push(...pts); s.arc = null; s.mixed = true; }
    this.lp = [cx + r * Math.cos(a0 + sweep), cy + r * Math.sin(a0 + sweep)];
  }
  ellipse(cx, cy, rx, ry, rot, a0, a1) {
    const n = 48, pts = [];
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n, x = rx * Math.cos(a), y = ry * Math.sin(a); pts.push(this.P(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot))); }
    this.subs.push({ pts, closed: false, arc: null, mixed: true });
  }
  arcTo(x1, y1, x2, y2, r) {
    const p0 = this.lp || [x1, y1];
    let v1 = [p0[0] - x1, p0[1] - y1], v2 = [x2 - x1, y2 - y1];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (l1 < 1e-9 || l2 < 1e-9 || r < 1e-9) return this.lineTo(x1, y1);
    v1 = [v1[0] / l1, v1[1] / l1]; v2 = [v2[0] / l2, v2[1] / l2];
    const th = Math.acos(Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1])));
    if (th < 1e-6 || Math.PI - th < 1e-6) return this.lineTo(x1, y1);
    const d = r / Math.tan(th / 2), t1 = [x1 + v1[0] * d, y1 + v1[1] * d], t2 = [x1 + v2[0] * d, y1 + v2[1] * d];
    let bx = v1[0] + v2[0], by = v1[1] + v2[1]; const bl = Math.hypot(bx, by); bx /= bl; by /= bl;
    const k = r / Math.sin(th / 2), c = [x1 + bx * k, y1 + by * k];
    this.lineTo(...t1);
    const a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0]); let da = Math.atan2(t2[1] - c[1], t2[0] - c[0]) - a0;
    while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    for (let i = 1; i <= 8; i++) { const a = a0 + (da * i) / 8; this.lineTo(c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)); }
  }
  quadraticCurveTo(cx, cy, x, y) {
    const p0 = this.lp || [cx, cy];
    for (let i = 1; i <= 16; i++) { const t = i / 16, u = 1 - t; this.lineTo(u * u * p0[0] + 2 * u * t * cx + t * t * x, u * u * p0[1] + 2 * u * t * cy + t * t * y); }
  }
  emitPath(fillSolid) {
    if (this.clipped) return;
    for (const s of this.subs) {
      if (s.arc) { this.ents.push({ t: s.arc.full ? 'circle' : 'arc', layer: this.layer, dash: this.dash, ...s.arc }); continue; }
      if (s.pts.length < 2) continue;
      if (fillSolid && s.closed && s.pts.length >= 3 && s.pts.length <= 4) this.ents.push({ t: 'solid', layer: this.layer, pts: s.pts });
      this.ents.push({ t: 'poly', layer: this.layer, dash: this.dash, pts: s.pts, closed: s.closed });
    }
  }
  stroke() { this.emitPath(false); }
  fill() { if (INK_RE.test(String(this.fillStyle))) this.emitPath(true); }
  strokeRect(x, y, w, h) { if (this.clipped) return; this.ents.push({ t: 'poly', layer: this.layer, dash: this.dash, closed: true, pts: [this.P(x, y), this.P(x + w, y), this.P(x + w, y + h), this.P(x, y + h)] }); }
  fillRect(x, y, w, h) {
    if (this.clipped || !INK_RE.test(String(this.fillStyle)) || w <= 0 || h <= 0) return;
    const pts = [this.P(x, y), this.P(x + w, y), this.P(x + w, y + h), this.P(x, y + h)];
    this.ents.push({ t: 'solid', layer: this.layer, pts }, { t: 'poly', layer: this.layer, closed: true, pts });
  }
  fillText(text, x, y) {
    if (this.clipped || !String(text).trim()) return;
    const size = parseFloat((this.font.match(/([\d.]+)px/) || [])[1] || 100);
    this.ents.push({ t: 'text', layer: this.layer, p: this.P(x, y), h: size * 0.72, text: String(text), rot: this.rot, center: this.textAlign === 'center' });
  }
}

const LAYERS = [
  ['A-WALL', 7], ['A-DOOR', 4], ['A-GLAZ', 5], ['A-RAIL', 7], ['A-ZONE', 8], ['A-FURN', 8], ['A-FIXT', 6], ['A-CASE', 41],
  ['A-FLOR-STRS', 30], ['A-FLOR-OVHD', 9], ['A-AREA', 9], ['A-ANNO-TEXT', 2], ['A-ANNO-DIMS', 1], ['A-ANNO-TTLB', 7],
];
const esc = s => [...s].map(ch => { const c = ch.codePointAt(0); return c < 128 ? ch : c > 0xffff ? '?' : '\\U+' + c.toString(16).toUpperCase().padStart(4, '0'); }).join('');
const f = v => (Math.round(v * 1000) / 1000).toString();

export function exportDXF(plan, title) {
  const MM = 1000, frame = planFrame(plan), out = [];
  const g = (code, v) => out.push(String(code), String(v));
  let ents = [], shiftX = 0;
  for (const L of plan.levels) {
    const rec = new DxfRecorder();
    drawLevel(plan, L, { canvas: rec, pxPerM: MM, frame, noGrid: true, furniture: true });
    // world millimetres, y up (plan z points down the sheet)
    const W = p => [p[0] + frame.x0 * MM + shiftX, -(p[1] + frame.z0 * MM)];
    for (const e of rec.ents) ents.push({ ...e, W });
    for (const r of L.rooms) ents.push({ t: 'poly', layer: 'A-AREA', closed: true, pts: r.polygon.map(([x, z]) => [(x - frame.x0) * MM, (z - frame.z0) * MM]), W });
    if (plan.levels.length > 1) ents.push({ t: 'text', layer: 'A-ANNO-TTLB', p: [frame.w * MM / 2, -600], h: 350, text: [L.name, L.nameEn].filter(Boolean).join(' '), rot: 0, center: true, W });
    shiftX += (frame.w + 2) * MM;
  }
  ents.push({ t: 'text', layer: 'A-ANNO-TTLB', p: [0, frame.h * MM + 700], h: 250, text: `${title} · 單位 mm · PrimeStride Spatial Lab`, rot: 0, center: false, W: p => [p[0] + frame.x0 * MM, -(p[1] + frame.z0 * MM)] });

  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(9, '$MEASUREMENT'); g(70, 1); g(9, '$DWGCODEPAGE'); g(3, 'ANSI_950');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, '__ __ __'); g(72, 65); g(73, 2); g(40, 150); g(49, 100); g(49, -50);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, LAYERS.length + 1);
  for (const [n, c] of [['0', 7], ...LAYERS]) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, c); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 2);
  g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 250); g(3, 'txt'); g(4, '');
  g(0, 'STYLE'); g(2, 'CJK'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 250); g(3, 'msjh.ttc'); g(4, '');
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const deg = a => ((-a * 180) / Math.PI % 360 + 360) % 360;
  for (const e of ents) {
    const lt = () => { if (e.dash) g(6, 'DASHED'); };
    if (e.t === 'poly') {
      const pts = e.pts.map(e.W);
      if (pts.length === 2) { g(0, 'LINE'); g(8, e.layer); lt(); g(10, f(pts[0][0])); g(20, f(pts[0][1])); g(30, 0); g(11, f(pts[1][0])); g(21, f(pts[1][1])); g(31, 0); continue; }
      g(0, 'POLYLINE'); g(8, e.layer); lt(); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, e.closed ? 1 : 0);
      for (const p of pts) { g(0, 'VERTEX'); g(8, e.layer); g(10, f(p[0])); g(20, f(p[1])); g(30, 0); }
      g(0, 'SEQEND'); g(8, e.layer);
    } else if (e.t === 'solid') {
      const p = e.pts.map(e.W), q = p.length === 3 ? [p[0], p[1], p[2], p[2]] : [p[0], p[1], p[3], p[2]];
      g(0, 'SOLID'); g(8, e.layer); q.forEach((v, i) => { g(10 + i, f(v[0])); g(20 + i, f(v[1])); g(30 + i, 0); });
    } else if (e.t === 'circle' || e.t === 'arc') {
      const c = e.W(e.c);
      g(0, e.t === 'circle' ? 'CIRCLE' : 'ARC'); g(8, e.layer); lt(); g(10, f(c[0])); g(20, f(c[1])); g(30, 0); g(40, f(e.r));
      if (e.t === 'arc') {
        // canvas angles run clockwise on screen; the sheet is flipped, so they become CAD angles negated
        const s = deg(e.a0), t = deg(e.a0 + e.sweep);
        if (e.sweep > 0) { g(50, f(t)); g(51, f(s)); } else { g(50, f(s)); g(51, f(t)); }
      }
    } else if (e.t === 'text') {
      const p = e.W(e.p), cjk = /[^\x00-\x7f]/.test(e.text);
      g(0, 'TEXT'); g(8, e.layer); g(10, f(p[0])); g(20, f(p[1])); g(30, 0); g(40, f(e.h)); g(1, esc(e.text));
      if (e.rot) g(50, f(deg(e.rot))); g(7, cjk ? 'CJK' : 'STANDARD');
      if (e.center) { g(72, 1); g(11, f(p[0])); g(21, f(p[1])); g(31, 0); }
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return new Blob([out.join('\r\n') + '\r\n'], { type: 'application/dxf' });
}

export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
