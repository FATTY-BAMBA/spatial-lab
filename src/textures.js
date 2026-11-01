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

const cache = new Map();
export function tex(name) {
  if (!makers[name]) return null;
  if (!cache.has(name)) cache.set(name, makers[name]());
  return cache.get(name);
}
