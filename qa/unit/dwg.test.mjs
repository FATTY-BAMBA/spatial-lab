// DWG upload (T-001): DWG bytes → dwg.js (acad-ts) → DXF text → the DXF import. The test DWGs are written here with
// acad-ts's own DwgWriter (a small two-room flat with layer + room text), so no binary plan is committed.
// R2007+ DWGs store text as UTF-16, so those carry Chinese names. R2000/R2004 store text in the drawing's code page and
// acad-ts's *writer* can only encode ASCII there (LibreDWG reads its Big5 output as "???" too), so those use ASCII names;
// reading a real Big5 R2004 drawing needs a real AutoCAD file (open item in T-001).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../lib/node-env.mjs';
import { FIXTURES_DIR } from '../lib/fixtures.mjs';
import { G, X, F, level } from './helpers.mjs';
const DW = await import(join(REPO, 'src/editor/dwg.js'));
const CI = await import(join(REPO, 'src/editor/cadimport.js'));
const A = await DW.loadAcad();

// 8 m × 5 m flat split in two (4 m + 4 m), 15 cm walls drawn as pairs of lines in mm, on layer A-牆面
const UNICODE = v => v >= A.ACadVersion.AC1021;
function planDWG(version, { codePage, names = UNICODE(version) ? ['A-牆面', 'A-文字', '主臥室', '客廳'] : ['A-WALL', 'A-TEXT', 'BEDROOM', 'LIVING'] } = {}) {
  const doc = new A.CadDocument(version, true);
  if (codePage) doc.header.codePage = codePage;
  const wall = new A.Layer(names[0]), txt = new A.Layer(names[1]); doc.layers.add(wall); doc.layers.add(txt);
  const line = (x0, y0, x1, y1) => { const l = new A.Line(new A.XYZ(x0, y0, 0), new A.XYZ(x1, y1, 0)); l.layer = wall; doc.entities.add(l); };
  const h = 75; // half wall thickness
  // outer walls: outside and inside faces
  line(-h, -h, 8000 + h, -h); line(h, h, 8000 - h, h);
  line(8000 + h, -h, 8000 + h, 5000 + h); line(8000 - h, h, 8000 - h, 5000 - h);
  line(8000 + h, 5000 + h, -h, 5000 + h); line(8000 - h, 5000 - h, h, 5000 - h);
  line(-h, 5000 + h, -h, -h); line(h, 5000 - h, h, h);
  // the dividing wall at x = 4 m
  line(4000 - h, h, 4000 - h, 5000 - h); line(4000 + h, h, 4000 + h, 5000 - h);
  for (const [s, x] of [[names[2], 2000], [names[3], 6000]]) { const t = new A.TextEntity(s); t.insertPoint = new A.XYZ(x, 2500, 0); t.height = 250; t.layer = txt; doc.entities.add(t); }
  const b = A.DwgWriter.writeToBuffer(doc);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}
const roomsOf = dxf => {
  const d = X.parseDXF(dxf);
  const walls = X.wallsFromDXF(d, X.defaultWallLayers(d));
  const L = level(walls.map((w, i) => ({ id: `d${i}`, openings: [], ...w }))); G.detectRooms(L);
  return { d, walls, L };
};

for (const [ver, code] of [['AC1015', A.ACadVersion.AC1015], ['AC1018', A.ACadVersion.AC1018], ['AC1024', A.ACadVersion.AC1024], ['AC1027', A.ACadVersion.AC1027], ['AC1032', A.ACadVersion.AC1032]]) {
  const zh = UNICODE(code), [wl, , t1, t2] = zh ? ['A-牆面', '', '主臥室', '客廳'] : ['A-WALL', '', 'BEDROOM', 'LIVING'];
  test(`DWG ${ver} (AutoCAD ${DW.DWG_VERSIONS[ver]}) → DXF → walls, 2 rooms, layer and room text intact${zh ? ' (Chinese)' : ''}`, () => {
    const buf = planDWG(code);
    assert.equal(DW.dwgVersion(buf), ver);
    const r = DW.convertDWG(A, buf);
    assert.equal(r.version, ver);
    const { d, walls, L } = roomsOf(r.dxf);
    assert.equal(d.segs.length, 10);
    assert.ok(Object.keys(d.layers).includes(wl), `layers ${Object.keys(d.layers)}`);
    assert.deepEqual(d.texts.map(t => t.text).sort(), [t1, t2].sort());
    assert.deepEqual(X.defaultWallLayers(d), [wl]);
    assert.ok(walls.length >= 5, `walls ${walls.length}`);
    assert.equal(L.rooms.length, 2);
    // mm drawing comes out in metres: two 4 m × 5 m rooms (at wall centre lines)
    const areas = L.rooms.map(r => Math.abs(r.polygon.reduce((a, p, i, P) => a + p[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * p[1], 0) / 2)).sort();
    for (const a of areas) assert.ok(Math.abs(a - 20) < 1.5, `room areas ${areas}`);
  });
}

test('R2004 DWG saved with the Taiwan code page (ANSI_950) is read as Big5', () => {
  const r = DW.convertDWG(A, planDWG(A.ACadVersion.AC1018, { codePage: 'ANSI_950' }));
  const cp = (r.dxf.match(/\$DWGCODEPAGE\r?\n\s*3\r?\n([^\r\n]+)/) || [])[1];
  assert.match(cp, /big5|950/i);
  assert.equal(roomsOf(r.dxf).L.rooms.length, 2);
});

test('dwgToDXF without Worker (Node) gives the same DXF text', async () => {
  const buf = planDWG(A.ACadVersion.AC1032);
  const text = await DW.dwgToDXF(buf.slice(0));
  assert.equal(typeof text, 'string');
  assert.equal(X.parseDXF(text).segs.length, 10);
});

const code = fn => { try { fn(); } catch (e) { assert.ok(e instanceof DW.DwgError, `not a DwgError: ${e}`); return e.code; } return 'no error'; };
test('bad input fails with a typed DwgError, size checked before parsing', () => {
  const good = new Uint8Array(planDWG(A.ACadVersion.AC1032));
  assert.equal(code(() => DW.convertDWG(A, new Uint8Array(4000).map((_, i) => (i * 37) & 255).buffer)), 'not-dwg');
  assert.equal(code(() => DW.convertDWG(A, new ArrayBuffer(0))), 'not-dwg');
  assert.equal(code(() => DW.convertDWG(A, new TextEncoder().encode('  0\nSECTION\n  2\nHEADER\n'.repeat(20)).buffer)), 'not-dwg');
  assert.equal(code(() => DW.convertDWG(A, good.slice(0, 400).buffer)), 'failed');
  const old = good.slice(); old.set(new TextEncoder().encode('AC1006'), 0);
  assert.equal(code(() => DW.convertDWG(A, old.buffer)), 'old-version');
  const nu = good.slice(); nu.set(new TextEncoder().encode('AC1040'), 0);
  assert.equal(code(() => DW.convertDWG(A, nu.buffer)), 'new-version');
  // too large: rejected from the byte count alone (a fake reader proves nothing was parsed)
  const boom = { DwgReader: { readFromStream() { throw new Error('parsed'); } } };
  assert.equal(code(() => DW.convertDWG(boom, new ArrayBuffer(DW.DWG_MAX_BYTES + 1))), 'too-large');
  assert.equal(code(() => DW.convertDWG(boom, good.buffer, { maxBytes: 1000 })), 'too-large');
});

test('dwgToDXF rejects (does not throw) on a bad file', async () => {
  await assert.rejects(DW.dwgToDXF(new ArrayBuffer(10)), e => e instanceof DW.DwgError && e.code === 'not-dwg');
});

// a real AutoCAD-saved DWG from the private fixtures, when they are synced
const real = join(FIXTURES_DIR, 'dwg/lib_example_2018.dwg'), twin = join(FIXTURES_DIR, 'dwg/lib_example_2018.dxf');
test('fixture: LibreDWG example R2018 DWG matches its AutoCAD DXF', { skip: !(existsSync(real) && existsSync(twin)) && 'DWG fixtures not synced' }, () => {
  const b = readFileSync(real);
  const r = DW.convertDWG(A, b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const a = X.parseDXF(r.dxf), ref = X.parseDXF(X.decodeDXF(readFileSync(twin)));
  assert.equal(a.segs.length, ref.segs.length);
  assert.equal(a.texts.length, ref.texts.length);
  assert.equal(X.wallsFromDXF(a, X.defaultWallLayers(a)).length, X.wallsFromDXF(ref, X.defaultWallLayers(ref)).length);
});

test('a room far too big to be an interior (wrong units) is left unfurnished, quickly', () => {
  // 2 km × 2 km: the 5 cm furnishing grid would be 1.6 billion cells
  const s = 2000, L = level([[0, 0, s, 0], [s, 0, s, s], [s, s, 0, s], [0, s, 0, 0]].map(([a, b, c, d], i) => ({ id: `w${i}`, a: [a, b], b: [c, d], t: 0.15, openings: [] })));
  L.rooms = [{ id: 'r1', name: '客廳', polygon: [[0, 0], [s, 0], [s, s], [0, s]] }];
  const t0 = Date.now();
  F.autoFurnish(L, { replace: true });
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  assert.equal(L.furniture.filter(f => !f.dress).length, 0);
});

test('a 72 m × 80 m hall (mall plan size) furnishes in well under 2 s', () => {
  // was 18–25 s: the furnishing grid tested every cell against every wall, and the dining search scanned each box
  const W = 72, H = 80, L = level([[0, 0, W, 0], [W, 0, W, H], [W, H, 0, H], [0, H, 0, 0], [30, 0, 30, 25], [0, 50, 20, 50]].map(([a, b, c, d], i) => ({ id: `w${i}`, a: [a, b], b: [c, d], t: 0.2, openings: [] })));
  L.rooms = [{ id: 'r1', name: '客廳', polygon: [[0, 0], [W, 0], [W, H], [0, H]] }];
  const t0 = Date.now();
  F.autoFurnish(L, { replace: true });
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  const kinds = L.furniture.filter(f => !f.dress).map(f => f.kind);
  assert.ok(kinds.includes('table') && kinds.length >= 5, kinds.join(','));
});

test('runCAD (the worker job): DWG → walls → rooms named from the drawing → furniture, stages in order', async () => {
  const stages = [];
  const r = await CI.runCAD(planDWG(A.ACadVersion.AC1032), { dwg: true, onStage: (k, info) => stages.push([k, info]) });
  assert.deepEqual(stages.map(s => s[0]), ['convert', 'read', 'walls', 'rooms', 'furniture']);
  assert.equal(stages[0][1].version, 'AC1032');
  assert.deepEqual(r.wallLayers, ['A-牆面']);
  assert.deepEqual(r.level.rooms.map(x => x.name).sort(), ['主臥室', '客廳'].sort());
  assert.equal(r.level.rooms.find(x => x.name === '主臥室').nameEn, 'Master Bedroom');
  assert.equal(r.counts.named, 2);
  assert.ok(r.level.furniture.some(f => f.kind === 'bed'), r.level.furniture.map(f => f.kind).join(','));
  // the result crosses the worker boundary: it must survive structured cloning
  assert.deepEqual(structuredClone(r).level.walls, r.level.walls);
});

test('runCAD: underlay only (plan: false), and typed errors for an unreadable DXF / a drawing without lines', async () => {
  const r = await CI.runCAD(planDWG(A.ACadVersion.AC1027), { dwg: true, plan: false });
  assert.equal(r.level, null); assert.equal(r.d.segs.length, 10);
  await assert.rejects(CI.runCAD(new TextEncoder().encode('  0\nSECTION\n  2\nENTITIES\n  0\nENDSEC\n  0\nEOF\n').buffer), e => e.code === 'no-lines');
  await assert.rejects(CI.runCAD(new ArrayBuffer(10), { dwg: true }), e => e.code === 'not-dwg');
});
