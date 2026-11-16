// 提案書 numbers and the firm profile checks (T-002): areas in m² / 坪, the quote 未稅 / 含稅, style and render order,
// 統一編號 checksum, brand colour contrast.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../lib/node-env.mjs';
import { G, P, W, rect } from './helpers.mjs';
const PD = await import(join(REPO, 'src/proposal-doc.js'));
const FM = await import(join(REPO, 'src/firm.js'));
const base = JSON.parse(readFileSync(join(REPO, 'data/apartment.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(REPO, 'data/styles.json'), 'utf8'));

// a 8 × 5 m flat split into two 4 × 5 rooms, plus a 4 × 1.5 balcony
function plan() {
  const walls = [...rect(0, 0, 8, 5), W([4, 0], [4, 5]), W([0, 5], [0, 6.5]), W([0, 6.5], [4, 6.5]), W([4, 6.5], [4, 5])];
  const doc = { levels: [{ id: '1F', name: '1F', elevation: 0, height: 3, walls, rooms: [], furniture: [], voids: [] }], stairs: [], project: { name: 'QA 住宅', type: 'apartment' } };
  const p = G.completePlan(doc, base);
  const rooms = p.levels[0].rooms.sort((a, b) => P.polygonArea(b.polygon) - P.polygonArea(a.polygon));
  rooms[0].name = '客廳'; rooms[1].name = '主臥'; if (rooms[2]) { rooms[2].name = '陽台'; rooms[2].outdoor = true; }
  p.levels[0].furniture.push({ kind: 'sofa', name: '三人沙發', price: 30000, x: 2, z: 2, w: 2, d: 0.9, rot: 0 });
  return p;
}

test('room table: m² and 坪 per room, interior and outdoor totals', () => {
  const R = PD.roomRows(plan());
  assert.equal(R.rows.length, 3);
  const liv = R.rows.find(r => r.name === '客廳');
  assert.ok(Math.abs(liv.m2 - 20) < 1.5, `living ${liv.m2}`);
  assert.equal(liv.ping, Math.round(liv.m2 / 3.305785 * 10) / 10);
  assert.ok(Math.abs(R.interior.m2 - 40) < 3, `interior ${R.interior.m2}`);
  assert.ok(R.outdoor.m2 > 4 && R.outdoor.m2 < 8, `outdoor ${R.outdoor.m2}`);
  assert.equal(R.rows.find(r => r.name === '陽台').outdoor, true);
  assert.equal(R.rows[0].level, '', 'single floor: no floor column');
});

test('quote summary: 未稅 total, 5% 營業稅, 含稅 grand; furniture as an allowance', () => {
  const p = plan(), styles = PD.styleList(p, catalog);
  const q = PD.quoteSummary(p, styles[0]);
  assert.equal(q.taxRate, 0.05);
  assert.equal(q.tax, Math.round(q.total * 0.05));
  assert.equal(q.grand, q.total + q.tax);
  assert.equal(q.finish.length, p.finishes.length);
  assert.equal(q.total, q.finish.reduce((a, l) => a + l.total, 0) + q.allowance);
  assert.equal(q.allowance, 30000); assert.equal(q.furniture, 1);
  // same numbers as the viewer's quote for the same finishes
  const v = P.buildQuote(p, { ...p.defaultFinishes });
  assert.equal(q.grand, v.grand);
});

test('every catalogue style can be priced, and styles differ in price', () => {
  const p = plan(), styles = PD.styleList(p, catalog);
  assert.ok(styles.length >= 3);
  const totals = styles.map(s => PD.quoteSummary(p, s).total);
  assert.ok(totals.every(n => Number.isFinite(n) && n > 0));
  assert.ok(new Set(totals).size > 1);
  for (const s of styles) for (const f of PD.finishRows(p, s)) assert.ok(f.name && f.color);
});

test('quoted style: the one asked for, else the one with most renders, else 原始提案', () => {
  const p = plan(), styles = PD.styleList(p, catalog), other = styles[2].id;
  assert.equal(PD.pickStyle(styles, []), 'original');
  assert.equal(PD.pickStyle(styles, [{ style: other }, { style: other }, { style: 'original' }]), other);
  assert.equal(PD.pickStyle(styles, [{ style: other }], 'original'), 'original');
  assert.equal(PD.pickStyle(styles, [], 'no-such-style'), 'original');
});

test('renders: quoted style first, living room first; renders without a picture are skipped', () => {
  const p = plan(), styles = PD.styleList(p, catalog), other = styles[2].id;
  const list = PD.orderRenders([{ room: '主臥', style: 'original', after: 'a' }, { room: '客廳', style: other, after: 'b' }, { room: '客廳', style: 'original', after: 'c' }, { room: '廚房', style: 'original' }], 'original', styles);
  assert.deepEqual(list.map(r => r.src), ['c', 'a', 'b']);
  assert.equal(list[0].same, true); assert.equal(list[2].same, false);
  assert.equal(list[2].style, styles[2].name);
});

test('統一編號 checksum (incl. the 7th-digit-7 rule) and profile checks', () => {
  for (const ok of ['22099131', '04595257', '10458570']) assert.ok(FM.validTaxId(ok), ok);
  for (const bad of ['12345678', '22099132', '2209913', 'abcdefgh', '']) assert.ok(!FM.validTaxId(bad), bad);
  assert.equal(FM.checkFirm({ name: '木與石設計' }).ok, true);
  const c = FM.checkFirm({ name: '', tax_id: '12345678', email: 'x@', color: 'red' });
  assert.deepEqual(Object.keys(c.errors).sort(), ['color', 'email', 'name', 'tax_id']);
});

test('firm display: null without a name, readable text on the brand colour, contact lines', () => {
  assert.equal(FM.normFirm({ name: '  ' }), null);
  const f = FM.normFirm({ name: '木與石設計', color: 'nope', phone: '02-2345-6789', line_id: '@wood', email: 'hi@example.com' });
  assert.equal(f.color, FM.DEFAULT_COLOR);
  assert.equal(FM.onColor('#111111'), '#ffffff'); assert.equal(FM.onColor('#f4ead2'), '#1b1712');
  const lines = FM.contactLines(f);
  assert.deepEqual(lines.map(l => l.k), ['phone', 'line', 'email']);
  assert.equal(lines[0].href, 'tel:0223456789');
  assert.ok(lines[1].href.startsWith('https://line.me/R/ti/p/'));
  assert.equal(FM.initials('木與石室內設計有限公司'), '木與');
});
