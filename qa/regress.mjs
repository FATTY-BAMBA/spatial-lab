// Regression gate: runs every available fixture through the real import pipeline, compares the metrics with
// qa/baseline.json and fails on any regression. Writes qa/reports/latest.json and qa/reports/index.html.
//   node regress.mjs                     compare with the baseline (exit 1 on a regression)
//   node regress.mjs --write-baseline    accept the current results as the new baseline (after a validated improvement)
//   node regress.mjs --only 591-A3,dxf   subset by id fragment or tag
//   node regress.mjs --no-ai             skip replaying recorded AI answers
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { QA } from './lib/node-env.mjs';
import { loadFixtures } from './lib/fixtures.mjs';
import { runFixture } from './lib/pipeline.mjs';
import { writeReport } from './lib/report.mjs';

const args = process.argv.slice(2), flag = k => args.includes(k), val = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const fixtures = loadFixtures({ only: val('--only') });
const BASE = join(QA, 'baseline.json');
const baseline = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')).results : {};

const results = {}, docs = {};
for (const fx of fixtures) {
  if (!fx.present) { results[fx.id] = { missing: true }; continue; }
  try {
    const { doc, metrics } = await runFixture(fx, { ai: !flag('--no-ai') });
    results[fx.id] = metrics; docs[fx.id] = doc;
  } catch (e) { results[fx.id] = { error: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }; }
}

// ---- compare
const RULES = [
  // [metric, kind, threshold]: 'drop' fails when the value goes down; 'pct' fails beyond that relative drop
  ['floors', 'change'], ['rooms', 'drop'], ['furnishedRooms', 'drop'], ['drawn', 'drop'], ['walls', 'pct', 0.15], ['roomArea', 'pct', 0.1],
];
const fails = [], warns = [], gains = [];
for (const [id, m] of Object.entries(results)) {
  const b = baseline[id];
  if (m.missing) continue;
  if (m.error) { if (!b || !b.error) fails.push(`${id}: crashed — ${m.error}`); continue; }
  if (!b) { warns.push(`${id}: new fixture (no baseline yet)`); continue; }
  if (b.error) { gains.push(`${id}: no longer crashes`); continue; }
  for (const [k, kind, th] of RULES) {
    if (b[k] == null || m[k] == null) continue;
    if (kind === 'change' && m[k] !== b[k]) fails.push(`${id}: ${k} ${b[k]} → ${m[k]}`);
    if (kind === 'drop' && m[k] < b[k]) fails.push(`${id}: ${k} ${b[k]} → ${m[k]}`);
    if (kind === 'pct' && m[k] < b[k] * (1 - th)) fails.push(`${id}: ${k} ${b[k]} → ${m[k]} (−${Math.round((1 - m[k] / b[k]) * 100)}%)`);
    if (m[k] > b[k] && ['rooms', 'furnishedRooms', 'drawn'].includes(k)) gains.push(`${id}: ${k} ${b[k]} → ${m[k]}`);
  }
  if (b.issues != null && m.issues > b.issues * 1.3 + 2) warns.push(`${id}: issues ${b.issues} → ${m.issues}`);
  if (b.ms && m.ms > Math.max(1500, b.ms * 3)) warns.push(`${id}: slower ${b.ms} → ${m.ms} ms`);
}

// DWG/DXF twins: the same drawing must give the same plan whichever format the designer uploads (T-001: within 10%)
for (const fx of fixtures) {
  if (!fx.pair) continue;
  const m = results[fx.id], t = results[fx.pair];
  if (!m || !t || m.missing || t.missing || m.error || t.error) continue;
  const off = ['walls', 'rooms', 'roomArea'].filter(k => Math.abs(m[k] - t[k]) > 0.1 * Math.max(t[k], 1));
  if (off.length) fails.push(`${fx.id} vs its DXF twin ${fx.pair}: ${off.map(k => `${k} ${t[k]} → ${m[k]}`).join(', ')} (> 10%)`);
  m.pair = { id: fx.pair, same: !off.length };
}

mkdirSync(join(QA, 'reports'), { recursive: true });
const summary = { at: new Date().toISOString(), ran: Object.values(results).filter(r => !r.missing).length, missing: Object.values(results).filter(r => r.missing).length, fails, warns, gains };
writeFileSync(join(QA, 'reports', 'latest.json'), JSON.stringify({ summary, results }, null, 1));
writeReport(join(QA, 'reports', 'index.html'), { summary, results, baseline, docs, fixtures });

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('fixture', 22), pad('floors', 7), pad('walls', 6), pad('rooms', 6), pad('open', 5), pad('furn.rm', 8), pad('drawn', 6), pad('issues', 7), 'ms');
for (const [id, m] of Object.entries(results)) {
  if (m.missing) { console.log(pad(id, 22), '— missing (private fixtures not synced)'); continue; }
  if (m.error) { console.log(pad(id, 22), 'ERROR', m.error.slice(0, 90)); continue; }
  console.log(pad(id, 22), pad(m.floors, 7), pad(m.walls, 6), pad(m.rooms, 6), pad(m.openRooms, 5), pad(m.furnishedRooms, 8), pad(m.drawn, 6), pad(m.issues, 7), m.ms, m.msConvert != null ? `(DWG ${m.dwgVersion}: convert ${m.msConvert} ms${m.pair ? `, ${m.pair.same ? '=' : '≠'} DXF twin` : ''})` : '');
}
console.log(`\nran ${summary.ran}, missing ${summary.missing}`);
for (const g of gains) console.log('  ▲', g);
for (const w of warns) console.log('  !', w);
for (const f of fails) console.log('  ✗', f);

if (flag('--write-baseline')) {
  const keep = Object.fromEntries(Object.entries(results).filter(([, m]) => !m.missing));
  const merged = { ...baseline, ...keep };
  writeFileSync(BASE, JSON.stringify({ _doc: 'Accepted results of qa/regress.mjs. Update only with `npm run baseline` after the validator approved an improvement.', updated: summary.at, results: merged }, null, 1) + '\n');
  console.log('\nbaseline written:', Object.keys(keep).length, 'fixtures');
} else if (fails.length) { console.log(`\nREGRESSION: ${fails.length} failure(s)`); process.exit(1); }
else console.log('\nOK: no regressions');
