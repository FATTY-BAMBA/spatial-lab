// T-011: the designer's presented style/finishes saved on the project: checked against the plan, what a page opens on,
// and the 提案書 quoting exactly the presented finishes (same total as the 3D).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../lib/node-env.mjs';
import { G, P, rect } from './helpers.mjs';
const PR = await import(join(REPO, 'src/presented.js'));
const PD = await import(join(REPO, 'src/proposal-doc.js'));
const base = JSON.parse(readFileSync(join(REPO, 'data/apartment.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(REPO, 'data/styles.json'), 'utf8'));

function setup() {
  const doc = { levels: [{ id: '1F', name: '1F', elevation: 0, height: 3, walls: rect(0, 0, 8, 5), rooms: [], furniture: [], voids: [] }], stairs: [], project: { name: 'QA', type: 'apartment' } };
  const plan = G.completePlan(doc, base);
  const styles = PD.styleList(plan, catalog);
  return { plan, styles, ids: styles.map(s => s.id) };
}

test('makePresented: style or custom mix, every finish, palette of the style it came from', () => {
  const p = PR.makePresented('wabi', { floor: 'oak' }, 'nordic', new Date('2026-11-17T01:02:03Z'));
  assert.deepEqual(p, { v: 1, style: 'wabi', palette: 'wabi', finishes: { floor: 'oak' }, at: '2026-11-17T01:02:03.000Z' });
  const m = PR.makePresented(null, { floor: 'oak' }, 'wabi');
  assert.equal(m.style, null); assert.equal(m.palette, 'wabi');
});

test('normPresented keeps only this plan\'s groups, options and styles; junk → null', () => {
  const { plan, ids } = setup();
  const g = plan.finishes[0], opt = g.options[g.options.length - 1].id;
  const n = PR.normPresented({ style: 'wabi', finishes: { [g.id]: opt, nope: 'x', [plan.finishes[1].id]: 'not-an-option' }, at: 'T1' }, plan, ids);
  assert.deepEqual(n.finishes, { [g.id]: opt });
  assert.equal(n.style, 'wabi'); assert.equal(n.palette, 'wabi'); assert.equal(n.at, 'T1');
  assert.equal(PR.normPresented({ style: 'gone', palette: 'gone', finishes: { [g.id]: opt } }, plan, ids).style, null);
  assert.equal(PR.normPresented({ style: null, palette: 'nordic', finishes: { [g.id]: opt } }, plan, ids).palette, ids.includes('nordic') ? 'nordic' : null);
  for (const bad of [null, 'x', {}, { finishes: 'x' }, { finishes: { nope: 'x' } }]) assert.equal(PR.normPresented(bad, plan, ids), null);
});

test('usePresented: the saved choice wins until this browser has seen it; a newer one wins again', () => {
  const p = { at: 'T2' };
  assert.equal(PR.usePresented(p, null), true);   // first visit (client, or the owner on another computer)
  assert.equal(PR.usePresented(p, 'T2'), false);  // seen: this browser's own later switch is kept
  assert.equal(PR.usePresented(p, 'T1'), true);   // the designer presented again
  assert.equal(PR.usePresented(null, null), false);
});

test('differs: style or any presented finish changed', () => {
  const p = { style: 'wabi', finishes: { floor: 'oak', paint: 'white' } };
  assert.equal(PR.differs(p, 'wabi', { floor: 'oak', paint: 'white', extra: 'x' }), false);
  assert.equal(PR.differs(p, null, { floor: 'oak', paint: 'white' }), true);
  assert.equal(PR.differs(p, 'wabi', { floor: 'tile', paint: 'white' }), true);
  assert.equal(PR.differs(null, 'wabi', {}), false);
});

test('提案書: quotes the presented style with exactly its finishes, or adds the custom mix; ?style= still wins', () => {
  const { plan, styles, ids } = setup();
  // a custom mix: wabi with one finish changed
  const wabi = styles.find(s => s.id === 'wabi'), g = plan.finishes[0];
  const fin = { ...plan.defaultFinishes, ...wabi.finishes, [g.id]: g.options.find(o => o.id !== wabi.finishes[g.id]).id };
  const mix = PR.normPresented(PR.makePresented(null, fin, 'wabi'), plan, ids);
  const S = PD.withPresented(styles, mix);
  assert.equal(S.length, styles.length + 1);
  const id = PD.pickStyle(S, [{ style: 'original' }], '', mix);
  assert.equal(id, 'custom');
  const d = PD.proposalData({ plan, renders: [], styles: S, styleId: id });
  assert.equal(d.quote.total, P.buildQuote(plan, fin).total, 'the 3D total for the same finishes');
  // a catalogue style: quoted with the presented finishes (the viewer's chosen), not only the style's own
  const pw = PR.normPresented(PR.makePresented('wabi', { ...plan.defaultFinishes, ...wabi.finishes }), plan, ids);
  const S2 = PD.withPresented(styles, pw);
  assert.equal(S2.length, styles.length);
  assert.equal(PD.pickStyle(S2, [], '', pw), 'wabi');
  assert.equal(PD.proposalData({ plan, renders: [], styles: S2, styleId: 'wabi' }).quote.total, P.buildQuote(plan, { ...plan.defaultFinishes, ...wabi.finishes }).total);
  assert.equal(PD.pickStyle(S2, [], 'original', pw), 'original');
  // nothing presented: unchanged (most renders, else 原始提案)
  assert.equal(PD.withPresented(styles, null), styles);
  assert.equal(PD.pickStyle(styles, [{ style: 'wabi' }], '', null), 'wabi');
});
