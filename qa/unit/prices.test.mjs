// 價目表 + Excel 報價單 (T-003): a firm's own prices change the quote exactly as computed by hand; stored lists are
// cleaned; the furniture catalogue covers every priced piece; the .xlsx is a valid workbook with Chinese text, number
// formats, live formulas and the same totals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../lib/node-env.mjs';
import { readXlsx, findRow } from '../lib/xlsx-read.mjs';
import { P } from './helpers.mjs';
const PR = await import(join(REPO, 'src/prices.js'));
const QX = await import(join(REPO, 'src/quote-xlsx.js'));
const PD = await import(join(REPO, 'src/proposal-doc.js'));
const base = JSON.parse(readFileSync(join(REPO, 'data/apartment.json'), 'utf8'));

// a plan whose quantities are easy to work out by hand:
//   one room 10 × 3.305785 m = 33.05785 m² = 10 坪 of floor; one exterior wall 10 m long, ceiling 3.0 − 0.2 = 2.8 m → 28 m²
//   a 2.5 m kitchen run (counter + cabinet); 雙人床 (catalogue 45000), 2 × 餐椅 (6800), a sofa at a typed price 33333
function plan() {
  const finishes = JSON.parse(JSON.stringify(base.finishes));
  const room = { id: 'r', name: '客廳', polygon: [[0, 0], [10, 0], [10, 3.305785], [0, 3.305785]], finish: 'floor' };
  const furniture = [
    { kind: 'counter', name: '廚具', price: 0, counter: true, cabinet: true, x: 2, z: 0.5, w: 2.5, d: 0.6, rot: 0 },
    { kind: 'bed', name: '雙人床', nameEn: 'Queen bed', price: 45000, x: 5, z: 1.5, w: 1.8, d: 2.1, rot: 0 },
    { kind: 'chair', name: '餐椅', price: 6800, x: 8, z: 1, w: 0.46, d: 0.5, rot: 0 },
    { kind: 'chair', name: '餐椅', price: 6800, x: 8.6, z: 1, w: 0.46, d: 0.5, rot: 0 },
    { kind: 'sofa', name: '訂製沙發', price: 33333, x: 3, z: 2.5, w: 2.2, d: 0.9, rot: 0 },
  ];
  return { project: { name: 'QA 住宅', footprint: room.polygon }, finishes, defaultFinishes: { ...base.defaultFinishes },
    levels: [{ id: '1F', name: '1F', height: 3.0, rooms: [room], walls: [{ id: 'w', a: [0, 0], b: [10, 0], t: 0.1, ext: true, openings: [] }], furniture }] };
}
const LIST = {
  v: 1, name: 'QA 價目表', date: '2026-10', labour: '含工帶料', taxRate: 0.05,
  waste: { floor: 0.05, counter: 0, cabinet: 0.1, paint: 0.1 }, units: { floor: '坪', paint: 'm²' },
  finishes: { 'floor.oak': 5000, 'counter.quartz': 20000, 'cabinet.walnut': 10000, 'paint.warm': 300 },
  furniture: { '雙人床@45000': 40000, '餐椅@6800': 7000 },
  lines: [
    { id: 'protect', name: '保護工程', spec: '地坪保護', unit: '坪', qty: 1, price: 600, on: true },
    { id: 'debris', name: '垃圾清運', unit: '式', qty: 1, price: 15000, on: true },
    { id: 'clean', name: '完工清潔', unit: '坪', qty: 1, price: 450, on: false },
  ],
  notes: ['單價含施工'],
};
// by hand: floor 10 坪 × 1.05 = 10.5 × 5000 = 52,500 · counter 2.5 m × 20000 = 50,000 · cabinet 2.5 × 1.1 = 2.75 × 10000
// = 27,500 · paint 28 m² × 1.1 = 30.8 × 300 = 9,240 · 保護工程 10 坪 × 600 = 6,000 · 垃圾清運 1 式 15,000 ·
// 雙人床 40,000 · 餐椅 2 × 7,000 = 14,000 · 訂製沙發 33,333 (typed price, not in the list)
const HAND = { floor: 52500, counter: 50000, cabinet: 27500, paint: 9240, works: 21000, furniture: 87333 };
const HAND_TOTAL = 247573, HAND_TAX = 12379; // round(247,573 × 5%) = round(12,378.65)

test('quote with a custom price list matches the hand-computed case', () => {
  const p = PR.applyPrices(plan(), LIST);
  const q = P.buildQuote(p, p.defaultFinishes);
  const line = gid => q.lines.find(l => l.gid === gid);
  assert.deepEqual([line('floor').qty, line('counter').qty, line('cabinet').qty, line('paint').qty], [10.5, 2.5, 2.75, 30.8]);
  assert.equal(line('paint').unit, 'm²');
  for (const g of ['floor', 'counter', 'cabinet', 'paint']) assert.equal(line(g).total, HAND[g], g);
  assert.deepEqual(q.lines.filter(l => l.labour).map(l => [l.name, l.qty, l.unit, l.total]), [['保護工程', 10, '坪', 6000], ['垃圾清運', 1, '式', 15000]]);
  assert.equal(q.labourTotal, HAND.works);
  assert.equal(q.allowance, HAND.furniture);
  assert.equal(q.lines.find(l => l.name === '雙人床').unitPrice, 40000);
  assert.equal(q.lines.find(l => l.name === '訂製沙發').unitPrice, 33333, 'a typed price is kept');
  assert.equal(q.total, HAND_TOTAL);
  assert.equal(q.tax, HAND_TAX);
  assert.equal(q.grand, HAND_TOTAL + HAND_TAX);
  assert.equal(q.basis.priceBook, 'QA 價目表');
  assert.equal(q.basis.priceDate, '2026-10');
  // the 提案書 shows the same numbers, with the works lines
  const s = PD.quoteSummary(p, { finishes: {} });
  assert.equal(s.total, HAND_TOTAL); assert.equal(s.grand, HAND_TOTAL + HAND_TAX); assert.equal(s.allowance, HAND.furniture);
  assert.deepEqual(s.works.map(l => l.total), [6000, 15000]);
});

test('no price list → the sample price book, unchanged; 0% tax; applying twice is the same', () => {
  const p0 = plan(), q0 = P.buildQuote(p0, p0.defaultFinishes);
  assert.equal(PR.applyPrices(plan(), null).quoteBasis, undefined);
  assert.match(q0.basis.priceBook, /PrimeStride/);
  assert.equal(q0.lines.find(l => l.name === '雙人床').unitPrice, 45000);
  const p = PR.applyPrices(PR.applyPrices(plan(), LIST), LIST);
  assert.equal(P.buildQuote(p, p.defaultFinishes).total, HAND_TOTAL);
  PR.applyPrices(p, { ...LIST, furniture: {}, taxRate: 0 }); // a second list re-prices from the catalogue price
  const q = P.buildQuote(p, p.defaultFinishes);
  assert.equal(q.lines.find(l => l.name === '雙人床').unitPrice, 45000);
  assert.equal(q.tax, 0); assert.equal(q.grand, q.total);
});

test('switching a group to m² converts unlisted options from the per-坪 catalogue price', () => {
  const p = PR.applyPrices(plan(), { units: { floor: 'm²' }, finishes: {} });
  const g = p.finishes.find(x => x.id === 'floor');
  assert.equal(g.unit, 'm²');
  assert.equal(g.options.find(o => o.id === 'oak').price, Math.round(4800 / 3.305785));
  assert.equal(P.buildQuote(p, p.defaultFinishes).lines.find(l => l.gid === 'floor').qty, P.r2(33.05785 * 1.08));
});

test('stored lists are cleaned: bad prices, keys, units and lines are dropped', () => {
  const n = PR.normPrices({ name: 'x'.repeat(200), date: 'yesterday', taxRate: 0.2, waste: { floor: 0.9, paint: 0.1, 'bad key': 0.1 }, units: { floor: 'ft²', paint: 'm²' },
    finishes: { 'floor.oak': -5, 'floor.marble': 5600.4, 'paint.warm': 'abc', '<script>': 1, 'counter.quartz': 2e7 }, furniture: { '雙人床@45000': 40000, 'nokey': 5 },
    lines: [{ name: '', price: 5 }, { name: '保護', price: 600, unit: 'ft', on: 'yes' }, { name: 'x', price: -1 }], notes: ['a', 7, '', 'b'] });
  assert.equal(n.name.length, 80); assert.equal(n.date, ''); assert.equal(n.taxRate, 0.05);
  assert.deepEqual(n.waste, { paint: 0.1 }); assert.deepEqual(n.units, { paint: 'm²' });
  assert.deepEqual(n.finishes, { 'floor.marble': 5600 });
  assert.deepEqual(n.furniture, { '雙人床@45000': 40000 });
  assert.deepEqual(n.lines.map(l => [l.name, l.unit, l.on]), [['保護', '式', false]]);
  assert.deepEqual(n.notes, ['a', 'b']);
  assert.equal(PR.normPrices([]), null); assert.equal(PR.normPrices('x'), null);
  assert.equal(PR.checkPrices({ finishes: { 'floor.oak': 1.5 }, waste: { floor: 0.6 }, lines: [{ name: '', price: 1 }] }).errors.length, 3);
  assert.ok(PR.checkPrices(PR.defaultPrices(base.finishes)).ok);
});

test('the default list reproduces today\'s sample quote; every priced catalogue piece has a furniture row', () => {
  const D = PR.defaultPrices(base.finishes);
  assert.ok(D.lines.every(l => !l.on), 'works lines start switched off');
  const a = JSON.parse(JSON.stringify(base)), b = PR.applyPrices(JSON.parse(JSON.stringify(base)), D);
  assert.equal(P.buildQuote(b, b.defaultFinishes).total, P.buildQuote(a, a.defaultFinishes).total);
  const keys = new Set(PR.FURNITURE.flatMap(g => g.items.map(i => i.key)));
  assert.equal(keys.size, PR.FURNITURE.flatMap(g => g.items).length, 'no duplicate rows');
  const seen = new Set();
  for (const f of readdirSync(join(REPO, 'src/editor')).filter(f => f.endsWith('.js'))) {
    for (const m of readFileSync(join(REPO, 'src/editor', f), 'utf8').matchAll(/name: '([^']+)', nameEn: '[^']+',(?: [^}]*?)?price: (\d+)/g)) if (+m[2]) seen.add(`${m[1]}@${m[2]}`);
  }
  for (const f of ['apartment.json', 'house.json']) for (const L of JSON.parse(readFileSync(join(REPO, 'data', f), 'utf8')).levels) for (const it of L.furniture) if (it.price) seen.add(`${it.name}@${it.price}`);
  const missing = [...seen].filter(k => !keys.has(k));
  assert.deepEqual(missing, [], 'priced pieces without a 價目表 row');
});

test('xlsx: a valid workbook with Chinese text, number formats, live formulas and the hand-computed totals', () => {
  const p = PR.applyPrices(plan(), LIST);
  const firm = { name: '木與石室內設計', phone: '02-2345-6789', line_id: '@woodstone', tax_id: '22099131' };
  const out = QX.quoteXlsx({ plan: p, chosen: p.defaultFinishes, firm, project: 'QA <住宅> & 透天', client: '王小姐', style: '原始提案', date: '2026-11-16T08:00:00Z' });
  assert.deepEqual(out.totals, { subtotal: HAND_TOTAL, tax: HAND_TAX, grand: HAND_TOTAL + HAND_TAX, taxRate: 0.05, quote: HAND_TOTAL });
  assert.match(out.filename, /^報價單-QA-住宅-&-透天-20261116\.xlsx$/);
  const bytes = Buffer.from(out.bytes);
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  const X = readXlsx(bytes); // unzips with CRC checks and checks every XML part is well formed
  assert.ok(X.files.has('xl/worksheets/sheet1.xml') && X.files.has('xl/sharedStrings.xml') && X.files.has('docProps/core.xml'));
  assert.match(X.files.get('[Content_Types].xml').toString(), /spreadsheetml\.sheet\.main\+xml/);
  assert.deepEqual(X.sheetNames, ['報價單']);
  for (const s of ['木與石室內設計', '報價單  QUOTATION', 'QA <住宅> & 透天', '王小姐', '海島型木地板・橡木', '保護工程', '垃圾清運', '雙人床', '小計', '合計（未稅）', '營業稅 5%', '總計（含稅）', '業主簽認：']) assert.ok(X.strings.includes(s), `missing “${s}”`);
  assert.ok(!X.strings.includes('完工清潔'), 'a switched-off works line is not quoted');
  assert.ok(X.strings.some(s => s.includes('22099131')), 'firm 統一編號 in the header');
  assert.match(X.files.get('xl/sharedStrings.xml').toString(), /QA &lt;住宅&gt; &amp; 透天/);
  for (const f of ['#,##0', '"NT$ "#,##0', '0.00']) assert.ok(X.numFmts.includes(f), `number format ${f}`);
  assert.match(X.sheet, /<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"\/>/);
  // header row and columns
  const h = findRow(X, /^項目$/);
  assert.deepEqual(X.rows[h], ['項目', '規格', '數量', '單位', '單價', '複價', '備註']);
  // rows: 數量 × 單價 = 複價 as a formula with its value, money and quantity formats
  const floor = findRow(X, /^地坪$/), r = floor + 1;
  assert.deepEqual(X.rows[floor].slice(0, 6), ['地坪', '海島型木地板・橡木', 10.5, '坪', 5000, 52500]);
  assert.equal(X.cells[`F${r}`].f, `ROUND(C${r}*E${r},0)`);
  assert.equal(X.cells[`C${r}`].fmt, '0.00'); assert.equal(X.cells[`E${r}`].fmt, '#,##0');
  const paint = X.rows[findRow(X, /^牆面塗料$/)]; assert.deepEqual([paint[2], paint[3], paint[5]], [30.8, 'm²', 9240]);
  const bed = X.rows[findRow(X, /^雙人床$/)]; assert.deepEqual([bed[1], bed[2], bed[4], bed[5], bed[6]], ['180×210 cm', 1, 40000, 40000, '暫估']);
  const chair = X.rows[findRow(X, /^餐椅$/)]; assert.deepEqual([chair[2], chair[4], chair[5]], [2, 7000, 14000]);
  assert.ok(findRow(X, /^客廳$/) > findRow(X, /^三、家具/), 'furniture grouped under its room');
  // every item row's cached amount = round(qty × price); the 小計 rows sum their section; totals chain by formula
  const items = Object.entries(X.cells).filter(([, c]) => c.f && /^ROUND\(C\d+\*E\d+,0\)$/.test(c.f));
  assert.equal(items.length, 4 + 2 + 3);
  for (const [k, c] of items) { const n = k.slice(1); assert.equal(c.v, Math.round(X.cells[`C${n}`].v * X.cells[`E${n}`].v), k); }
  const subs = Object.values(X.cells).filter(c => c.f && c.f.startsWith('SUM('));
  assert.deepEqual(subs.map(c => c.v), [HAND.floor + HAND.counter + HAND.cabinet + HAND.paint, HAND.works, HAND.furniture]);
  const total = X.rows.findIndex(row => row && row[2] === '合計（未稅）');
  assert.deepEqual([X.rows[total][5], X.rows[total + 1][5], X.rows[total + 2][5]], [HAND_TOTAL, HAND_TAX, HAND_TOTAL + HAND_TAX]);
  assert.equal(X.cells[`F${total + 2}`].f, `ROUND(F${total + 1}*0.05,0)`);
  assert.equal(X.cells[`F${total + 3}`].f, `F${total + 1}+F${total + 2}`);
  assert.equal(X.cells[`F${total + 3}`].fmt, '"NT$ "#,##0');
  assert.ok(X.merges.includes('A1:G1'));
});

test('xlsx without a firm profile or works lines: project as the header, sample price book named', () => {
  const p = plan();
  const out = QX.quoteXlsx({ plan: p, chosen: p.defaultFinishes, project: 'Demo' });
  const X = readXlsx(out.bytes);
  assert.equal(X.rows[0][0], 'Demo');
  assert.ok(X.strings.some(s => /PrimeStride 示範價目表/.test(s)));
  assert.ok(!X.strings.some(s => /工程項目/.test(s)));
  assert.equal(out.totals.subtotal, P.buildQuote(p, p.defaultFinishes).total);
});
