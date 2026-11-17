// T-010: the share link's QR code. Every code src/qr.js draws must decode back to the exact text (decoded here with
// jsQR, an independent decoder), across versions 1–40 (incl. version info ≥ 7, several blocks, 16-bit lengths ≥ 10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from '../lib/node-env.mjs';
const Q = await import(join(REPO, 'src/qr.js'));
const jsQR = createRequire(import.meta.url)('jsqr');

// the matrix as an RGBA picture: `px` pixels per module, 4-module white quiet zone
function picture(m, px = 4, quiet = 4) {
  const n = (m.size + quiet * 2) * px, data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dark = m.at(Math.floor(x / px) - quiet, Math.floor(y / px) - quiet), i = (y * n + x) * 4, c = dark ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = c; data[i + 3] = 255;
  }
  return { data, n };
}
const decode = m => { const { data, n } = picture(m); const r = jsQR(data, n, n, { inversionAttempts: 'dontInvert' }); return r && r.data; };

test('share links decode back exactly (production, preview and long tokens)', () => {
  for (const url of [
    'https://spatial.primestrideai.com/?share=k3j9x0a1b2c3d4e5f6g7h8i9j0kl',
    'https://spatial-lab-git-agent-t-011-demo-polish-primestride.vercel.app/?share=k3j9x0a1b2c3d4e5f6g7h8i9j0kl',
    'http://localhost:8080/?share=qa-share-token-0123456789',
  ]) {
    const m = Q.qrMatrix(url);
    assert.equal(decode(m), url, `v${m.version}`);
  }
});

test('the production share link fits a small code (version ≤ 5, 37 × 37 modules)', () => {
  const m = Q.qrMatrix('https://spatial.primestrideai.com/?share=k3j9x0a1b2c3d4e5f6g7h8i9j0kl');
  assert.ok(m.version <= 5, `version ${m.version}`);
  assert.equal(m.size, m.version * 4 + 17);
});

test('every length from 1 to 300 bytes and a few large ones decode (versions 1–40, all masks in play)', () => {
  const seen = new Set(), masks = new Set();
  const lengths = [...Array.from({ length: 300 }, (_, i) => i + 1), 400, 600, 900, 1300, 1800, 2331];
  for (const len of lengths) {
    const s = Array.from({ length: len }, (_, i) => 'abcdefghijklmnopqrstuvwxyz0123456789-/?=.:'[(i * 7 + len) % 42]).join('');
    const m = Q.qrMatrix(s);
    seen.add(m.version); masks.add(m.mask);
    assert.equal(decode(m), s, `length ${len} (v${m.version}, mask ${m.mask})`);
  }
  assert.ok(seen.has(1) && seen.has(7) && seen.has(10) && seen.has(40), `versions ${[...seen].join(',')}`);
  assert.ok(masks.size >= 4, `masks used ${[...masks].join(',')}`);
});

test('Chinese text is UTF-8 and decodes', () => {
  const s = '木與石室內設計 3D 提案：https://spatial.primestrideai.com/?share=abc123abc123abc123';
  assert.equal(decode(Q.qrMatrix(s)), s);
});

test('too long throws; svg has the quiet zone and only dark modules in the path', () => {
  assert.throws(() => Q.qrMatrix('x'.repeat(2400)), /too long/);
  const m = Q.qrMatrix('hi'), svg = Q.qrSvg('hi', { label: 'QR "x"' });
  assert.match(svg, new RegExp(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`));
  assert.match(svg, /aria-label="QR x"/);
  let dark = 0; for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.at(x, y)) dark++;
  assert.equal((Q.qrSvgPath(m).match(/M/g) || []).length, dark);
});
