// Ink-style plan drawing rendered from plan data. Used both as the floor of the 3D
// model (transparent background) and as the 2D plan view (paper background).
import { polygonArea, polygonCentroid, bbox, wallFrame, toPing, pointInPolygon, itemFootprint } from './plan.js';
import { t as tr, isEn } from './i18n.js';

export const INK = '#1f2328';
export const INK_SOFT = 'rgba(31,35,40,0.55)';
export const PAPER = '#eceee8';
const SANS = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const MONO = SANS; // numbers set in the UI face with tabular figures, not a separate mono
// Two inks: the light one is the printed sheet (and DXF); the dark one reads like linework on a lightbox.
const THEMES = {
  light: { ink: INK, soft: INK_SOFT, paper: PAPER, room: 'rgba(255,255,255,0.55)', grid: 'rgba(31,35,40,0.10)', gridPaper: 'rgba(31,35,40,0.07)', hl: 'rgba(200,138,30,0.16)', hatch: 'rgba(31,35,40,0.13)', tile: 'rgba(31,35,40,0.16)', furn: 'rgba(31,35,40,0.72)', zone: 'rgba(31,35,40,0.45)', glaz: 'rgba(31,35,40,0.08)' },
  dark: { ink: '#ede5d7', soft: 'rgba(237,229,215,0.5)', paper: '#16130f', room: 'rgba(237,229,215,0.035)', grid: 'rgba(237,229,215,0.06)', gridPaper: 'rgba(237,229,215,0.045)', hl: 'rgba(201,162,106,0.24)', hatch: 'rgba(237,229,215,0.11)', tile: 'rgba(237,229,215,0.1)', furn: 'rgba(237,229,215,0.6)', zone: 'rgba(237,229,215,0.38)', glaz: 'rgba(237,229,215,0.12)' },
};
let T = THEMES.light;

export function planFrame(plan, margin = 2.2) {
  const pts = [...plan.project.footprint];
  for (const L of plan.levels) for (const r of L.rooms) pts.push(...r.polygon);
  const b = bbox(pts);
  return { x0: b.x0 - margin, z0: b.z0 - margin, w: b.x1 - b.x0 + margin * 2, h: b.z1 - b.z0 + margin * 2 };
}

export function drawLevel(plan, level, opts = {}) {
  const s = opts.pxPerM || 128;
  const canvas = opts.canvas || document.createElement('canvas');
  let frame;
  if (opts.view) {
    // draw into an existing canvas at a given pan/zoom (editor)
    frame = { x0: opts.view.x0, z0: opts.view.z0, w: canvas.width / s, h: canvas.height / s };
  } else {
    frame = opts.frame || planFrame(plan);
    canvas.width = Math.round(frame.w * s);
    canvas.height = Math.round(frame.h * s);
  }
  T = THEMES[opts.theme] || THEMES.light;
  const ctx = canvas.getContext('2d');
  const lay = n => ctx.setLayer && ctx.setLayer(n); // CAD layer hook (DXF export); no-op on a real canvas
  const X = x => (x - frame.x0) * s;
  const Z = z => (z - frame.z0) * s;
  const px = m => m * s;
  if (!opts.view) ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';

  if (opts.paper) {
    ctx.fillStyle = T.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // 1 m grid
  if (!opts.noGrid) {
  ctx.strokeStyle = opts.paper ? T.gridPaper : T.grid;
  ctx.lineWidth = Math.max(1, s / 110);
  ctx.beginPath();
  for (let x = Math.ceil(frame.x0); x <= frame.x0 + frame.w; x++) { ctx.moveTo(X(x), 0); ctx.lineTo(X(x), canvas.height); }
  for (let z = Math.ceil(frame.z0); z <= frame.z0 + frame.h; z++) { ctx.moveTo(0, Z(z)); ctx.lineTo(canvas.width, Z(z)); }
  ctx.stroke();
  }

  // Room fills
  for (const r of level.rooms) {
    ctx.beginPath();
    r.polygon.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
    ctx.closePath();
    if (opts.highlight === r.id) { ctx.fillStyle = T.hl; ctx.fill(); }
    else if (opts.paper) { ctx.fillStyle = T.room; ctx.fill(); }
    if (r.outdoor) {
      ctx.save(); ctx.clip();
      ctx.strokeStyle = T.hatch; ctx.lineWidth = Math.max(1, s / 160);
      const b = bbox(r.polygon); ctx.beginPath();
      for (let k = -(b.z1 - b.z0); k < b.x1 - b.x0; k += 0.25) { ctx.moveTo(X(b.x0 + k), Z(b.z0)); ctx.lineTo(X(b.x0 + k + (b.z1 - b.z0)), Z(b.z1)); }
      ctx.stroke(); ctx.restore();
    } else if (r.finish === 'tile') {
      ctx.save(); ctx.clip();
      ctx.strokeStyle = T.tile; ctx.lineWidth = Math.max(1, s / 160);
      const b = bbox(r.polygon); ctx.beginPath();
      for (let x = b.x0; x <= b.x1; x += 0.3) { ctx.moveTo(X(x), Z(b.z0)); ctx.lineTo(X(x), Z(b.z1)); }
      for (let z = b.z0; z <= b.z1; z += 0.3) { ctx.moveTo(X(b.x0), Z(z)); ctx.lineTo(X(b.x1), Z(z)); }
      ctx.stroke(); ctx.restore();
    }
  }

  // Voids (stairwell seen from above): diagonal cross
  lay('A-FLOR-OVHD');
  for (const v of level.voids || []) {
    const b = bbox(v.polygon);
    ctx.strokeStyle = T.soft; ctx.lineWidth = Math.max(1, s / 90);
    ctx.setLineDash([px(0.12), px(0.08)]);
    ctx.beginPath(); ctx.moveTo(X(b.x0), Z(b.z0)); ctx.lineTo(X(b.x1), Z(b.z1));
    ctx.moveTo(X(b.x1), Z(b.z0)); ctx.lineTo(X(b.x0), Z(b.z1)); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Stairs
  lay('A-FLOR-STRS');
  for (const st of plan.stairs) {
    if (st.from !== level.id && st.to !== level.id) continue;
    const n = st.risers - 1, run = (st.zEnd - st.zStart) / n;
    ctx.strokeStyle = T.ink; ctx.lineWidth = Math.max(1, s / 80);
    ctx.strokeRect(X(st.x0), Z(st.zStart), px(st.x1 - st.x0), px(st.zEnd - st.zStart));
    ctx.beginPath();
    for (let i = 1; i < n; i++) { const z = st.zStart + i * run; ctx.moveTo(X(st.x0), Z(z)); ctx.lineTo(X(st.x1), Z(z)); }
    ctx.stroke();
    const cx = (st.x0 + st.x1) / 2;
    const up = st.from === level.id;
    ctx.lineWidth = Math.max(1.5, s / 60);
    ctx.beginPath(); ctx.moveTo(X(cx), Z(st.zStart + 0.25)); ctx.lineTo(X(cx), Z(st.zEnd - 0.3)); ctx.stroke();
    const tip = up ? st.zEnd - 0.2 : st.zStart + 0.2, dir = up ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(X(cx), Z(tip)); ctx.lineTo(X(cx - 0.12), Z(tip + dir * 0.22)); ctx.lineTo(X(cx + 0.12), Z(tip + dir * 0.22)); ctx.closePath();
    ctx.fillStyle = T.ink; ctx.fill();
    if (!up) { ctx.beginPath(); ctx.arc(X(cx), Z(st.zEnd - 0.3), px(0.05), 0, Math.PI * 2); ctx.fill(); }
    ctx.save(); ctx.translate(X(cx), Z(st.zStart + 0.75)); ctx.fillStyle = T.ink;
    ctx.font = `600 ${px(0.16)}px ${MONO}`; ctx.textAlign = 'center';
    ctx.fillText(up ? tr('UP 上', 'UP') : tr('DN 下', 'DN'), 0, 0); ctx.restore();
  }

  // Furniture (thin outlines)
  if (opts.furniture !== false) {
    ctx.strokeStyle = T.furn;
    ctx.lineWidth = Math.max(1, s / 120);
    for (const f of level.furniture) drawItem(ctx, f, X, Z, px);
  }

  // Walls: poché for solid parts, windows and door swings at openings
  const rooms = level.rooms;
  for (const w of level.walls) {
    const { len, ux, uz, angle } = wallFrame(w);
    lay(w.kind === 'zone' ? 'A-ZONE' : w.kind === 'railing' ? 'A-RAIL' : 'A-WALL');
    if (w.kind === 'zone' || w.kind === 'railing') {
      ctx.save();
      ctx.strokeStyle = w.kind === 'zone' ? T.zone : T.ink;
      ctx.lineWidth = Math.max(1, s / 90);
      if (w.kind === 'zone') { ctx.setLineDash([px(0.15), px(0.1)]); ctx.beginPath(); ctx.moveTo(X(w.a[0]), Z(w.a[1])); ctx.lineTo(X(w.b[0]), Z(w.b[1])); ctx.stroke(); }
      else { const o = 0.04; ctx.beginPath(); for (const k of [o, -o]) { ctx.moveTo(X(w.a[0] - uz * k), Z(w.a[1] + ux * k)); ctx.lineTo(X(w.b[0] - uz * k), Z(w.b[1] + ux * k)); } ctx.stroke(); }
      ctx.restore();
      continue;
    }
    const nx = -uz, nz = ux;
    ctx.save();
    ctx.translate(X(w.a[0]), Z(w.a[1]));
    ctx.rotate(angle);
    const t = px(w.t);
    const ops = [...(w.openings || [])].sort((a, b) => a.offset - b.offset);
    let cursor = -w.t / 2;
    ctx.fillStyle = T.ink;
    for (const o of ops) {
      if (o.offset > cursor) ctx.fillRect(px(cursor), -t / 2, px(o.offset - cursor), t);
      cursor = Math.max(cursor, o.offset + o.width);
    }
    if (cursor < len + w.t / 2) ctx.fillRect(px(cursor), -t / 2, px(len + w.t / 2 - cursor), t);
    ctx.lineWidth = Math.max(1, s / 110);
    ctx.strokeStyle = T.ink;
    for (const o of ops) {
      const a0 = px(o.offset), a1 = px(o.offset + o.width);
      lay(o.type === 'door' || o.type === 'passage' ? 'A-DOOR' : 'A-GLAZ');
      if (o.type === 'window') {
        ctx.strokeRect(a0, -t / 2, a1 - a0, t);
        ctx.beginPath(); ctx.moveTo(a0, 0); ctx.lineTo(a1, 0); ctx.stroke();
        ctx.fillStyle = T.glaz; ctx.fillRect(a0, -t / 2, a1 - a0, t); ctx.fillStyle = T.ink;
      } else if (o.type === 'door') {
        // swing into the smaller adjoining room (or inward for an exterior door)
        const mid = o.offset + o.width / 2;
        const mx = w.a[0] + ux * mid, mz = w.a[1] + uz * mid;
        const side = sideFor(rooms, w, mx, mz, nx, nz);
        const r = a1 - a0;
        ctx.beginPath();
        ctx.moveTo(a0, 0); ctx.lineTo(a0, side * r);
        ctx.stroke();
        ctx.beginPath();
        ctx.setLineDash([px(0.06), px(0.05)]);
        if (side > 0) ctx.arc(a0, 0, r, Math.PI / 2, 0, true); else ctx.arc(a0, 0, r, -Math.PI / 2, 0, false);
        ctx.stroke(); ctx.setLineDash([]);
        if (o.main) { ctx.lineWidth = Math.max(2, s / 50); ctx.beginPath(); ctx.moveTo(a0, side * r); ctx.lineTo(a0 + px(0.04), side * r); ctx.stroke(); ctx.lineWidth = Math.max(1, s / 110); }
      } else if (o.type === 'slider') {
        const n = o.panels || 2, pw = (a1 - a0) / n;
        ctx.lineWidth = Math.max(1.5, s / 70);
        for (let i = 0; i < n; i++) {
          const off = (i % 2 ? 1 : -1) * t * 0.18;
          ctx.beginPath(); ctx.moveTo(a0 + i * pw - (i ? px(0.04) : 0), off); ctx.lineTo(a0 + (i + 1) * pw + (i < n - 1 ? px(0.04) : 0), off); ctx.stroke();
        }
        ctx.lineWidth = Math.max(1, s / 110);
        ctx.beginPath(); ctx.moveTo(a0, -t / 2); ctx.lineTo(a0, t / 2); ctx.moveTo(a1, -t / 2); ctx.lineTo(a1, t / 2); ctx.stroke();
      } else if (o.type === 'passage') {
        ctx.setLineDash([px(0.1), px(0.06)]);
        ctx.beginPath(); ctx.moveTo(a0, -t / 2); ctx.lineTo(a1, -t / 2); ctx.moveTo(a0, t / 2); ctx.lineTo(a1, t / 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  // Railings: double thin line
  lay('A-RAIL');
  for (const rl of level.railings || []) {
    const dx = rl.b[0] - rl.a[0], dz = rl.b[1] - rl.a[1], len = Math.hypot(dx, dz);
    const nx = -dz / len * 0.04, nz = dx / len * 0.04;
    ctx.strokeStyle = T.ink; ctx.lineWidth = Math.max(1, s / 90);
    ctx.beginPath();
    ctx.moveTo(X(rl.a[0] + nx), Z(rl.a[1] + nz)); ctx.lineTo(X(rl.b[0] + nx), Z(rl.b[1] + nz));
    ctx.moveTo(X(rl.a[0] - nx), Z(rl.a[1] - nz)); ctx.lineTo(X(rl.b[0] - nx), Z(rl.b[1] - nz));
    ctx.stroke();
  }

  // Room labels
  lay('A-ANNO-TEXT');
  for (const r of level.rooms) {
    const [cx, cz] = r.labelAt || labelPoint(r);
    const area = polygonArea(r.polygon);
    const b = bbox(r.polygon);
    ctx.save();
    ctx.translate(X(cx), Z(cz));
    ctx.textAlign = 'center';
    ctx.fillStyle = T.ink;
    const big = area > 12;
    const title = isEn ? (r.nameEn || r.name) : r.name, sub = isEn ? '' : r.nameEn;
    let fs = px(isEn ? (big ? 0.26 : 0.19) : (big ? 0.34 : 0.24));
    ctx.font = `700 ${fs}px ${SANS}`;
    const room = (X(b.x1) - X(b.x0)) * 0.86;
    while (fs > px(0.12) && ctx.measureText(title).width > room) { fs *= 0.92; ctx.font = `700 ${fs}px ${SANS}`; }
    ctx.fillText(title, 0, 0);
    ctx.font = `500 ${px(big ? 0.14 : 0.11)}px ${MONO}`;
    ctx.fillStyle = T.soft;
    if (sub) ctx.fillText(sub, 0, px(big ? 0.26 : 0.2));
    ctx.font = `500 ${px(big ? 0.15 : 0.12)}px ${MONO}`;
    ctx.fillStyle = T.ink;
    ctx.fillText(`${area.toFixed(1)} m²  ·  ${toPing(area).toFixed(1)} ${tr('坪', 'ping')}`, 0, px(big ? 0.5 : 0.38));
    if (big) {
      ctx.fillStyle = T.soft;
      ctx.fillText(`${(b.x1 - b.x0).toFixed(2)} × ${(b.z1 - b.z0).toFixed(2)}`, 0, px(0.72));
    }
    ctx.restore();
  }

  lay('A-ANNO-DIMS');
  if (!opts.noDims) drawDimensions(ctx, plan, level, X, Z, px);

  lay('A-ANNO-TTLB');
  if (opts.paper && opts.titleBlock !== false) drawNorth(ctx, X, Z, px, frame);
  return { canvas, frame, pxPerM: s };
}

function labelPoint(r) {
  const c = polygonCentroid(r.polygon);
  return pointInPolygon(c, r.polygon) ? c : r.polygon[0].map((v, i) => v + (i ? 0.6 : 0.6));
}

function sideFor(rooms, w, mx, mz, nx, nz) {
  const p1 = [mx + nx * 0.4, mz + nz * 0.4], p2 = [mx - nx * 0.4, mz - nz * 0.4];
  const r1 = rooms.find(r => pointInPolygon(p1, r.polygon));
  const r2 = rooms.find(r => pointInPolygon(p2, r.polygon));
  if (w.ext) return r1 ? 1 : -1;
  if (!r1) return -1;
  if (!r2) return 1;
  return polygonArea(r1.polygon) <= polygonArea(r2.polygon) ? 1 : -1;
}

const FIXT = new Set(['counter', 'vanity', 'toilet', 'tub', 'shower', 'washer', 'fridge', 'hood', 'uppercab']);
const CASE = new Set(['tallcab', 'wardrobe', 'shelf', 'shoe', 'tvwall', 'headboard']);
function drawItem(ctx, f, X, Z, px) {
  if (ctx.setLayer) ctx.setLayer(FIXT.has(f.kind) ? 'A-FIXT' : CASE.has(f.kind) ? 'A-CASE' : 'A-FURN');
  ctx.save();
  ctx.translate(X(f.x), Z(f.z));
  ctx.rotate((-(f.rot || 0) * Math.PI) / 180);
  const w = px(f.w), d = px(f.d);
  const k = f.kind;
  if (f.decor || k === 'heater') { ctx.restore(); return; }
  if (k === 'uppercab' || k === 'hood' || k === 'linear') { ctx.setLineDash([px(0.06), px(0.04)]); ctx.strokeRect(-w / 2, -d / 2, w, d); ctx.setLineDash([]); ctx.restore(); return; }
  if (k === 'curtain') { ctx.beginPath(); for (let x = -w / 2; x <= w / 2; x += px(0.02)) { const y = Math.sin((x / px(1)) * 18) * px(0.03); x === -w / 2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); ctx.restore(); return; }
  if (k === 'roundtable' || k === 'sidetable') { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return; }
  if (k === 'model' && /Plant/.test(f.model || '')) { ctx.beginPath(); ctx.arc(0, 0, w * 0.45, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, w * 0.2, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return; }
  if (k === 'model' && /Pouf/.test(f.model || '')) { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return; }
  if (k === 'model' && /Sofa/.test(f.model || '')) { roundRect(ctx, -w / 2, -d / 2, w, d, px(0.25)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-w / 2 + px(0.2), -d / 2 + px(0.25)); ctx.quadraticCurveTo(0, -d / 2 + px(0.4), w / 2 - px(0.2), -d / 2 + px(0.25)); ctx.stroke(); ctx.restore(); return; }
  if (k === 'model' && /Chair/.test(f.model || '')) { roundRect(ctx, -w / 2, -d / 2, w, d, px(0.12)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-w / 2 + px(0.05), -d / 2 + px(0.15)); ctx.lineTo(w / 2 - px(0.05), -d / 2 + px(0.15)); ctx.stroke(); ctx.restore(); return; }
  if (k === 'pendant') {
    ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.moveTo(0, -w / 2); ctx.lineTo(0, w / 2);
    ctx.setLineDash([px(0.03), px(0.03)]); ctx.stroke(); ctx.setLineDash([]); ctx.restore(); return;
  }
  if (k === 'rug') { ctx.setLineDash([px(0.05), px(0.05)]); ctx.strokeRect(-w / 2, -d / 2, w, d); ctx.setLineDash([]); ctx.restore(); return; }
  if (k === 'plant') { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, w / 4, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return; }
  if (k === 'toilet') {
    ctx.strokeRect(-w / 2, -d / 2, w, d * 0.28);
    ctx.beginPath(); ctx.ellipse(0, d * 0.12, w * 0.42, d * 0.36, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return;
  }
  if (k === 'chair' || k === 'outdoorchair') { roundRect(ctx, -w / 2, -d / 2, w, d, px(0.06)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-w / 2, -d / 2 + px(0.08)); ctx.lineTo(w / 2, -d / 2 + px(0.08)); ctx.stroke(); ctx.restore(); return; }
  ctx.strokeRect(-w / 2, -d / 2, w, d);
  ctx.beginPath();
  if (k === 'sofa') { ctx.moveTo(-w / 2, -d / 2 + px(0.22)); ctx.lineTo(w / 2, -d / 2 + px(0.22)); ctx.moveTo(-w / 2 + px(0.2), -d / 2 + px(0.22)); ctx.lineTo(-w / 2 + px(0.2), d / 2); ctx.moveTo(w / 2 - px(0.2), -d / 2 + px(0.22)); ctx.lineTo(w / 2 - px(0.2), d / 2); }
  if (k === 'bed') {
    ctx.moveTo(-w / 2, -d / 2 + px(0.08)); ctx.lineTo(w / 2, -d / 2 + px(0.08));
    ctx.rect(-w / 2 + px(0.12), -d / 2 + px(0.16), w / 2 - px(0.18), px(0.32));
    ctx.rect(px(0.06), -d / 2 + px(0.16), w / 2 - px(0.18), px(0.32));
    ctx.moveTo(-w / 2, -d / 2 + px(0.65)); ctx.lineTo(w / 2, -d / 2 + px(0.65));
  }
  if (k === 'counter') { ctx.moveTo(-w / 2, d / 2 - px(0.04)); ctx.lineTo(w / 2, d / 2 - px(0.04)); }
  if (k === 'tub') { roundRect(ctx, -w / 2 + px(0.08), -d / 2 + px(0.08), w - px(0.16), d - px(0.16), px(0.2)); }
  if (k === 'wardrobe' || k === 'shelf' || k === 'shoe') { ctx.moveTo(-w / 2, -d / 2); ctx.lineTo(w / 2, d / 2); }
  if (k === 'table' || k === 'desk' || k === 'coffee') { ctx.rect(-w / 2 + px(0.04), -d / 2 + px(0.04), w - px(0.08), d - px(0.08)); }
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawDimensions(ctx, plan, level, X, Z, px) {
  const fp = bbox(plan.project.footprint);
  ctx.strokeStyle = T.ink; ctx.fillStyle = T.ink;
  ctx.lineWidth = Math.max(1, px(0.008));
  ctx.font = `500 ${px(0.15)}px ${MONO}`;
  ctx.textAlign = 'center';
  // chain along the back (z0): x-edges of rooms touching the back wall
  const xs = new Set([fp.x0, fp.x1]);
  const zs = new Set([fp.z0, fp.z1]);
  for (const r of level.rooms) {
    const b = bbox(r.polygon);
    if (Math.abs(b.z0 - fp.z0) < 0.01) { xs.add(b.x0); xs.add(b.x1); }
    if (Math.abs(b.x1 - fp.x1) < 0.01) { zs.add(b.z0); zs.add(b.z1); }
  }
  const xArr = [...xs].sort((a, b) => a - b), zArr = [...zs].sort((a, b) => a - b);
  const y1 = fp.z0 - 0.7, y2 = fp.z0 - 1.3;
  chainH(ctx, xArr, y1, X, Z, px);
  chainH(ctx, [fp.x0, fp.x1], y2, X, Z, px);
  const x1 = fp.x1 + 0.7, x2 = fp.x1 + 1.3;
  chainV(ctx, zArr, x1, X, Z, px);
  chainV(ctx, [fp.z0, fp.z1], x2, X, Z, px);
}

function tick(ctx, x, y, px) { ctx.moveTo(x - px(0.07), y + px(0.07)); ctx.lineTo(x + px(0.07), y - px(0.07)); }

function chainH(ctx, xs, z, X, Z, px) {
  ctx.beginPath();
  ctx.moveTo(X(xs[0]), Z(z)); ctx.lineTo(X(xs[xs.length - 1]), Z(z));
  for (const x of xs) { tick(ctx, X(x), Z(z), px); ctx.moveTo(X(x), Z(z) - px(0.12)); ctx.lineTo(X(x), Z(z) + px(0.3)); }
  ctx.stroke();
  for (let i = 0; i < xs.length - 1; i++) ctx.fillText((xs[i + 1] - xs[i]).toFixed(2), X((xs[i] + xs[i + 1]) / 2), Z(z) - px(0.09));
}

function chainV(ctx, zs, x, X, Z, px) {
  ctx.beginPath();
  ctx.moveTo(X(x), Z(zs[0])); ctx.lineTo(X(x), Z(zs[zs.length - 1]));
  for (const z of zs) { tick(ctx, X(x), Z(z), px); ctx.moveTo(X(x) - px(0.3), Z(z)); ctx.lineTo(X(x) + px(0.12), Z(z)); }
  ctx.stroke();
  for (let i = 0; i < zs.length - 1; i++) {
    ctx.save(); ctx.translate(X(x) + px(0.09), Z((zs[i] + zs[i + 1]) / 2)); ctx.rotate(Math.PI / 2);
    ctx.fillText((zs[i + 1] - zs[i]).toFixed(2), 0, 0); ctx.restore();
  }
}

function drawNorth(ctx, X, Z, px, frame) {
  const cx = X(frame.x0 + 0.9), cz = Z(frame.z0 + 1.0), r = px(0.35);
  ctx.strokeStyle = T.ink; ctx.fillStyle = T.ink; ctx.lineWidth = Math.max(1, px(0.01));
  ctx.beginPath(); ctx.arc(cx, cz, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cz - r * 0.85); ctx.lineTo(cx + r * 0.3, cz + r * 0.5); ctx.lineTo(cx, cz + r * 0.25); ctx.closePath(); ctx.fill();
  ctx.font = `600 ${px(0.16)}px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText('N', cx, cz - r - px(0.08));
}

export function worldFromCanvas(frame, s, cx, cy) {
  return [cx / s + frame.x0, cy / s + frame.z0];
}

export { itemFootprint };
