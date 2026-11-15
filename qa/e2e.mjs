// Browser smoke tests of the main journeys, with the cloud and AI stubbed (no account, no AI cost):
//   1. 我的專案 (signed in): upload panel, empty state
//   2. upload a plan picture → progress screen → summary (AI answers replayed from a recording when there is one)
//   3. the 3D opens in Explore on the result, no page errors
//   4. a client share link: read-only (no edit, no sign-in, no product pitch)
// Writes screenshots to qa/reports/e2e-*.png. Exit 1 on any failure.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { QA } from './lib/node-env.mjs';
import { serve } from './lib/serve.mjs';
import { playwright } from './lib/browser.mjs';
import { loadFixtures, recordingPath } from './lib/fixtures.mjs';

const OUT = join(QA, 'reports'); mkdirSync(OUT, { recursive: true });
const fx = loadFixtures().find(f => f.kind === 'image' && f.present && existsSync(recordingPath(f.id))) || loadFixtures().find(f => f.kind === 'image' && f.present);
const rec = fx && existsSync(recordingPath(fx.id)) ? JSON.parse(readFileSync(recordingPath(fx.id), 'utf8')) : null;
const srv = await serve();
const { chromium } = playwright();
const browser = await chromium.launch();
const results = []; let failed = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (e) { failed++; results.push(`✗ ${name}: ${String(e.message || e).split('\n')[0]}`); }
}
const cloudStub = (doc = null, share = false) => `
  const U = { id: 'qa-user', email: 'qa@example.com', user_metadata: { full_name: 'QA Designer', given_name: 'QA' } };
  let renders = [];
  export const client = async () => ({});
  export const currentUser = async () => ${share ? 'null' : 'U'}; export const accessToken = async () => ${share ? 'null' : "'qa-token'"};
  export const onAuth = async () => {}; export const signIn = async () => {}; export const signOut = async () => {};
  export const listProjects = async () => []; export const saveProject = async () => '11111111-2222-3333-4444-555555555555';
  export const loadProject = async () => ({ id: 'p', name: 'QA 專案', doc: ${doc ? 'JSON.parse(localStorage.getItem("qa-doc"))' : 'null'}, renders });
  export const sharedProject = async () => ({ name: 'QA 分享專案', doc: JSON.parse(localStorage.getItem('qa-doc')), renders: [] });
  export const renameProject = async () => {}; export const deleteProject = async () => {}; export const setShare = async () => 'tok';
  export const putImage = async (p, b) => URL.createObjectURL(b); export const removeImages = async () => {};
  export const getRenders = async () => renders.slice(); export const setRenders = async (id, l) => { renders = l; };
  export const publicUrl = p => p; export const shareUrl = t => location.origin + '/?share=' + t;`;
async function page({ doc = false, share = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push(String(e)));
  await p.route('**/src/cloud.js', r => r.fulfill({ contentType: 'text/javascript', body: cloudStub(doc, share) }));
  let pass = 0;
  await p.route('**/api/vision', async r => {
    const req = JSON.parse(r.request().postData());
    let body;
    if (rec) { const ps = req.focus ? rec.passes[2] : rec.passes[Math.min(pass++, rec.passes.length - 1)]; body = ps || { rooms: [], items: [] }; }
    else body = { rooms: Array.from({ length: req.count }, (_, i) => ({ n: i + 1, type: '臥室', name: '臥室', nameEn: 'Bedroom', label: '', stairs: false })), items: [], scale: null };
    await new Promise(x => setTimeout(x, 300));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { p, ctx };
}

await step('projects page (signed in): upload panel + empty state', async () => {
  const { p, ctx } = await page();
  await p.goto(`${srv.url}/projects`);
  await p.waitForSelector('#list:not([hidden])', { timeout: 15000 });
  if (!(await p.isVisible('#drop'))) throw new Error('upload panel missing');
  await p.waitForSelector('#grid .empty', { timeout: 10000 });
  await p.screenshot({ path: join(OUT, 'e2e-1-projects.png') });
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

let docJSON = null;
if (fx) await step(`upload ${fx.id} → progress → summary${rec ? ' (recorded AI)' : ' (no recording: generic AI stub)'}`, async () => {
  const { p, ctx } = await page();
  await p.goto(`${srv.url}/editor?new=1`); await p.waitForTimeout(800);
  await p.setInputFiles('#file-img', fx.path);
  await p.waitForSelector('#flow.done', { timeout: 120000 });
  const steps = await p.$$eval('#flow li', ls => ls.map(l => l.className));
  if (steps.some(c => c !== 'done' && c !== 'skip')) throw new Error(`steps ${steps.join(',')}`);
  const sum = await p.textContent('#flow .sum');
  if (!/\d+ 個房間/.test(sum)) throw new Error(`summary: ${sum}`);
  await p.screenshot({ path: join(OUT, 'e2e-2-flow.png') });
  docJSON = await p.evaluate(() => JSON.stringify(window.__editor.doc));
  results.push(`    ${sum.trim().slice(0, 120)}`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

if (docJSON) await step('3D opens in Explore on the imported plan', async () => {
  const { p, ctx } = await page({ doc: true });
  await p.addInitScript(d => { localStorage.setItem('qa-doc', d); }, docJSON);
  await p.goto(`${srv.url}/?id=11111111-2222-3333-4444-555555555555#explore`);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 });
  await p.waitForFunction(() => ((document.querySelector('#plate') || {}).textContent || '').trim().length > 0, null, { timeout: 60000 }).catch(() => {});
  const st = await p.evaluate(() => ({ mode: document.body.dataset.mode, plate: (document.querySelector('#plate') || {}).textContent || '', ai: !document.querySelector('#ai-open').hidden }));
  if (st.mode !== 'explore') throw new Error(`mode ${st.mode}`);
  if (!st.plate.trim()) throw new Error('no room plate');
  if (!st.ai) throw new Error('AI renders button hidden for the owner');
  await p.screenshot({ path: join(OUT, 'e2e-3-explore.png'), timeout: 120000 });
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

if (docJSON) await step('client share link is read-only', async () => {
  const { p, ctx } = await page({ doc: true, share: true });
  await p.addInitScript(d => { localStorage.setItem('qa-doc', d); }, docJSON);
  await p.goto(`${srv.url}/?share=qa-share-token-0123456789`);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 });
  const st = await p.evaluate(() => {
    const vis = s => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; };
    return { shared: document.body.classList.contains('shared-view'), edit: vis('#edit-link'), login: vis('#acct-link'), film: [...document.querySelectorAll('.hero-cta [data-film]')].some(e => getComputedStyle(e).display !== 'none'), title: document.querySelector('.hero-copy h1').textContent };
  });
  if (!st.shared) throw new Error('not in shared view');
  if (st.edit || st.login || st.film) throw new Error(`visible: ${JSON.stringify(st)}`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

await browser.close(); srv.close();
console.log(results.join('\n'));
if (!fx) console.log('(no image fixture available: upload/3D/share steps skipped — sync private fixtures)');
console.log(failed ? `\nE2E: ${failed} failed` : '\nE2E: all passed');
process.exit(failed ? 1 : 0);
