// Procedural material textures (no image downloads). Each texture covers `size` metres.
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function canvas(n) { const c = document.createElement('canvas'); c.width = c.height = n; return [c, c.getContext('2d')]; }

function finish(c, size, anisotropy) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy || 8;
  t.userData.size = size;
  t.repeat.set(1 / size, 1 / size);
  return t;
}

function grain(ctx, n, amount, r) {
  const img = ctx.getImageData(0, 0, n, n), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const g = (r() - 0.5) * amount; d[i] += g; d[i + 1] += g; d[i + 2] += g; }
  ctx.putImageData(img, 0, 0);
}

const makers = {
  oak() { // 2.4 m square, planks 0.19 m wide
    const n = 1024, [c, ctx] = canvas(n), r = rng(7), size = 2.4, pw = n * 0.19 / size;
    for (let i = 0; i * pw < n; i++) {
      let y = 0;
      const off = r() * n;
      while (y < n + n) {
        const len = n * (0.9 + r() * 0.8) / size;
        const tone = 165 + r() * 40;
        ctx.fillStyle = `rgb(${tone + 22},${tone - 10},${tone - 52})`;
        const yy = (y + off) % n;
        ctx.fillRect(i * pw, yy, pw, len); ctx.fillRect(i * pw, yy - n, pw, len);
        for (let k = 0; k < 14; k++) {
          ctx.strokeStyle = `rgba(90,55,25,${0.05 + r() * 0.08})`; ctx.lineWidth = 1 + r() * 1.5;
          const x = i * pw + r() * pw; ctx.beginPath(); ctx.moveTo(x, yy); ctx.bezierCurveTo(x + 3, yy + len / 3, x - 3, yy + len * 0.66, x + r() * 2, yy + len); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(60,35,15,0.55)'; ctx.fillRect(i * pw, yy, pw, 1.5); ctx.fillRect(i * pw, yy - n, pw, 1.5);
        y += len;
      }
      ctx.fillStyle = 'rgba(60,35,15,0.6)'; ctx.fillRect(i * pw, 0, 1.5, n);
    }
    grain(ctx, n, 10, r);
    return finish(c, size);
  },
  walnut() {
    const n = 512, [c, ctx] = canvas(n), r = rng(11);
    ctx.fillStyle = '#6b4a33'; ctx.fillRect(0, 0, n, n);
    for (let k = 0; k < 140; k++) {
      ctx.strokeStyle = `rgba(${40 + r() * 30},${22 + r() * 15},${10},${0.08 + r() * 0.15})`; ctx.lineWidth = 1 + r() * 3;
      const x = r() * n; ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 10 - r() * 20, n / 3, x - 10 + r() * 20, n * 0.66, x, n); ctx.stroke();
    }
    grain(ctx, n, 8, r);
    return finish(c, 1.2);
  },
  marble() { // 60x120 tiles
    const n = 1024, [c, ctx] = canvas(n), r = rng(3), size = 2.4;
    ctx.fillStyle = '#ebe7df'; ctx.fillRect(0, 0, n, n);
    veins(ctx, n, r, 'rgba(120,112,100,', 26);
    ctx.strokeStyle = 'rgba(80,75,70,0.35)'; ctx.lineWidth = 2;
    for (let x = 0; x <= n; x += n / 4) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, n); ctx.stroke(); }
    for (let y = 0; y <= n; y += n / 2) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(n, y); ctx.stroke(); }
    grain(ctx, n, 5, r);
    return finish(c, size);
  },
  terrazzo() {
    const n = 1024, [c, ctx] = canvas(n), r = rng(5);
    ctx.fillStyle = '#dcd6ca'; ctx.fillRect(0, 0, n, n);
    const cols = ['#8f8a80', '#b8b0a2', '#6e6a64', '#c9a98a', '#f4f1ea', '#5d6a63'];
    for (let k = 0; k < 2600; k++) {
      ctx.fillStyle = cols[(r() * cols.length) | 0];
      const x = r() * n, y = r() * n, s = 2 + r() * (r() < 0.1 ? 14 : 6);
      ctx.beginPath(); ctx.moveTo(x, y); for (let j = 0; j < 5; j++) { const a = j / 5 * Math.PI * 2; ctx.lineTo(x + Math.cos(a) * s * (0.6 + r() * 0.5), y + Math.sin(a) * s * (0.6 + r() * 0.5)); } ctx.fill();
    }
    grain(ctx, n, 6, r);
    return finish(c, 1.6);
  },
  quartz() {
    const n = 512, [c, ctx] = canvas(n), r = rng(13);
    ctx.fillStyle = '#f1efea'; ctx.fillRect(0, 0, n, n);
    for (let k = 0; k < 2500; k++) { ctx.fillStyle = `rgba(150,145,138,${r() * 0.25})`; ctx.fillRect(r() * n, r() * n, 1 + r() * 2, 1 + r() * 2); }
    veins(ctx, n, r, 'rgba(160,150,140,', 6);
    return finish(c, 1.0);
  },
  granite() {
    const n = 512, [c, ctx] = canvas(n), r = rng(17);
    ctx.fillStyle = '#2b2a29'; ctx.fillRect(0, 0, n, n);
    for (let k = 0; k < 9000; k++) { const g = r(); ctx.fillStyle = g < 0.6 ? `rgba(15,15,15,${0.4 + r() * 0.5})` : `rgba(${150 + r() * 80},${150 + r() * 70},${140 + r() * 60},${0.15 + r() * 0.4})`; ctx.fillRect(r() * n, r() * n, 1 + r() * 3, 1 + r() * 3); }
    return finish(c, 0.8);
  },
  steel() {
    const n = 512, [c, ctx] = canvas(n), r = rng(19);
    ctx.fillStyle = '#b9bcbd'; ctx.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y++) { ctx.fillStyle = `rgba(${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},255,${r() * 0.05})`; ctx.fillRect(0, y, n, 1); }
    return finish(c, 0.6);
  },
  tile() { // 30x30 wet-area tile
    const n = 512, [c, ctx] = canvas(n), r = rng(23);
    ctx.fillStyle = '#d9dcd8'; ctx.fillRect(0, 0, n, n);
    const s = n / 4;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const t = 210 + r() * 18; ctx.fillStyle = `rgb(${t},${t + 3},${t})`; ctx.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); }
    return finish(c, 1.2);
  },
  paving() {
    const n = 1024, [c, ctx] = canvas(n), r = rng(29);
    ctx.fillStyle = '#b9b6ae'; ctx.fillRect(0, 0, n, n);
    const s = n / 8;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const t = 170 + r() * 25; ctx.fillStyle = `rgb(${t},${t - 2},${t - 8})`; ctx.fillRect(i * s + 3, j * s + 3, s - 6, s - 6); }
    grain(ctx, n, 14, r);
    return finish(c, 4.8);
  },
  grass() {
    const n = 512, [c, ctx] = canvas(n), r = rng(31);
    ctx.fillStyle = '#77845a'; ctx.fillRect(0, 0, n, n);
    for (let k = 0; k < 9000; k++) { const g = 90 + r() * 70; ctx.fillStyle = `rgba(${g - 30},${g},${g - 55},0.5)`; ctx.fillRect(r() * n, r() * n, 1, 2 + r() * 3); }
    return finish(c, 3);
  },
  fabric() {
    const n = 256, [c, ctx] = canvas(n), r = rng(37);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y += 2) { ctx.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.03})`; ctx.fillRect(0, y, n, 1); }
    for (let x = 0; x < n; x += 2) { ctx.fillStyle = `rgba(0,0,0,${0.02 + r() * 0.03})`; ctx.fillRect(x, 0, 1, n); }
    return finish(c, 0.4);
  },
};

function veins(ctx, n, r, rgba, count) {
  for (let k = 0; k < count; k++) {
    let x = r() * n, y = r() * n, a = r() * Math.PI * 2;
    ctx.lineWidth = 0.6 + r() * 2.2;
    ctx.strokeStyle = rgba + (0.08 + r() * 0.22) + ')';
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 60; s++) { a += (r() - 0.5) * 0.5; x += Math.cos(a) * 9; y += Math.sin(a) * 9; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

// Bump maps for grout lines and plaster (white = high, black = grout)
function groutCanvas(n, cols, rows, line, r, noise = 0) {
  const [c, ctx] = canvas(n);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n, n);
  if (noise) grain(ctx, n, noise, r || rng(41));
  ctx.fillStyle = '#000';
  for (let i = 0; i <= cols; i++) ctx.fillRect((i * n) / cols - line / 2, 0, line, n);
  for (let j = 0; j <= rows; j++) ctx.fillRect(0, (j * n) / rows - line / 2, n, line);
  return c;
}
const bumpMakers = {
  marble: () => finish(groutCanvas(1024, 4, 2, 3, rng(1), 6), 2.4),
  tile: () => finish(groutCanvas(512, 4, 4, 4, rng(2), 8), 1.2),
  paving: () => finish(groutCanvas(1024, 8, 8, 6, rng(3), 20), 4.8),
  balcony: () => finish(groutCanvas(512, 2, 2, 5, rng(4), 18), 1.2),
  plaster: () => {
    const n = 512, [c, ctx] = canvas(n), r = rng(51);
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, n, n);
    for (let k = 0; k < 1400; k++) { ctx.fillStyle = `rgba(${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},0.035)`; const s = 6 + r() * 30; ctx.beginPath(); ctx.arc(r() * n, r() * n, s, 0, 7); ctx.fill(); }
    grain(ctx, n, 18, r);
    return finish(c, 1.6);
  },
};

// Photographic PBR set shipped in assets/textures (three.js example hardwood, 2:1 image)
let hardwood = null;
function loadHardwood() {
  if (hardwood) return hardwood;
  const L = new THREE.TextureLoader();
  const mk = (f, srgb) => {
    const t = L.load(`assets/textures/${f}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(1 / 2.6, 1 / 1.3);
    return t;
  };
  hardwood = { map: mk('hardwood2_diffuse.jpg', true), bumpMap: mk('hardwood2_bump.jpg'), roughnessMap: mk('hardwood2_roughness.jpg') };
  return hardwood;
}

export function texSet(name) {
  if (name === 'hardwood') return loadHardwood();
  const map = tex(name);
  const bump = bumpMakers[name] ? bumpCache(name) : null;
  return { map, bumpMap: bump, roughnessMap: null };
}
const bcache = new Map();
function bumpCache(name) { if (!bcache.has(name)) bcache.set(name, bumpMakers[name]()); return bcache.get(name); }
export const bumpTex = bumpCache;

makers.balcony = () => {
  const n = 512, [c, ctx] = canvas(n), r = rng(61);
  ctx.fillStyle = '#a9a49b'; ctx.fillRect(0, 0, n, n);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const t = 160 + r() * 20; ctx.fillStyle = `rgb(${t},${t - 4},${t - 10})`; ctx.fillRect(i * n / 2 + 3, j * n / 2 + 3, n / 2 - 6, n / 2 - 6); }
  grain(ctx, n, 16, r);
  return finish(c, 1.2);
};
makers.facade = () => { // 4 bays x 6 floors of a city tower, 12 m x 18 m
  const W = 512, H = 768, c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'), r = rng(71);
  ctx.fillStyle = '#b4b6b5'; ctx.fillRect(0, 0, W, H);
  const bw = W / 4, fh = H / 6;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {
    const g = 62 + r() * 40, lit = r() < 0.05;
    ctx.fillStyle = lit ? `rgb(${170 + r() * 30},${165 + r() * 25},${140})` : `rgb(${g},${g + 14},${g + 26})`;
    ctx.fillRect(i * bw + bw * 0.12, j * fh + fh * 0.18, bw * 0.76, fh * 0.6);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(i * bw + bw * 0.12, j * fh + fh * 0.18, bw * 0.76, fh * 0.12);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(i * bw, j * fh + fh * 0.84, bw, fh * 0.06);
  }
  grain(ctx, W, 10, r);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.repeat.set(1 / 12, 1 / 18);
  return t;
};

makers.curtainwall = () => { // glass curtain wall: 1.5 m mullions, 3 m floors
  const W = 256, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'), r = rng(81);
  const grd = ctx.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#5d7484'); grd.addColorStop(1, '#3c4d5a');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) { ctx.fillStyle = `rgba(255,255,255,${r() * 0.07})`; ctx.fillRect(i * W / 8, j * H / 4, W / 8, H / 4); }
  ctx.fillStyle = '#9aa3a8';
  for (let i = 0; i <= 8; i++) ctx.fillRect(i * W / 8 - 1, 0, 2, H);
  for (let j = 0; j <= 4; j++) ctx.fillRect(0, j * H / 4 - 3, W, 6);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.repeat.set(1 / 12, 1 / 12);
  return t;
};

function nightMask(W, H, cols, rows, frac, seed, box) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'), r = rng(seed);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const bw = W / cols, fh = H / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    if (r() > frac) continue;
    const k = 0.55 + r() * 0.45, warm = r() < 0.75;
    ctx.fillStyle = warm ? `rgba(255,${200 + r() * 40},${140 + r() * 40},${k})` : `rgba(${200 + r() * 40},${225},255,${k})`;
    ctx.fillRect(i * bw + bw * box[0], j * fh + fh * box[1], bw * box[2], fh * box[3]);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
makers.facadeNight = () => { const t = nightMask(512, 768, 4, 6, 0.38, 91, [0.12, 0.18, 0.76, 0.6]); t.repeat.set(1 / 12, 1 / 18); return t; };
makers.curtainNight = () => { const t = nightMask(256, 256, 8, 4, 0.3, 93, [0.03, 0.06, 0.94, 0.88]); t.repeat.set(1 / 12, 1 / 12); return t; };

const cache = new Map();
export function tex(name) {
  if (!makers[name]) return null;
  if (!cache.has(name)) cache.set(name, makers[name]());
  return cache.get(name);
}
