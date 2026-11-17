// Browser smoke tests of the main journeys, with the cloud and AI stubbed (no account, no AI cost):
//   1. 我的專案 (signed in): upload panel, empty state
//   2. upload a plan picture → progress screen → summary (AI answers replayed from a recording when there is one)
//   3. the 3D opens in Explore on the result, no page errors
//   4. a client share link: read-only (no edit, no sign-in, no product pitch)
//   5. 公司資料: the designer fills the firm profile (logo, name, contact, 統一編號) → saved
//   6. the share link shows the firm's logo and name (ours only as "Powered by")
//   7. 提案書: renders, rooms (m² / 坪), totals (未稅 / 含稅); fits A4 portrait in print; phone + English
//   7b. 價目表 (T-003): change prices + a works line on 我的專案 → the 3D quote, share link and 提案書 use them →
//       Excel 報價單 downloaded from the viewer and the proposal is parsed and checked; before the DB column exists the
//       dialog explains and does not save
//   8. DWG (T-001): a .dwg dropped on 我的專案 → 轉檔 step → walls and rooms; the file never leaves the page; the UI keeps
//      painting while it converts; a damaged .dwg shows the zh error; the converter is not loaded for a picture
//   9. no CAD Worker (404, old browsers): a valid DWG and DXF still import on the page; a Worker that dies mid-import
//      shows the clear error at once instead of waiting for the timeout
//  10. big drawings (40k-line DWG, 72×80 m mall DXF): the whole import keeps every frame under 250 ms and ends in 20 s
//  11. demo journey (T-007): style switch → quote; ✦ 一鍵產生提案圖 → renders saved in that style; offline → zh message
//      (960 and 360 px); style and 核准 remembered per project; the editor's 在 3D 中查看 opens the saved project, or an
//      unsaved plan's own preview (old shared keys ignored); the 3D opens with site storage blocked
//  12. AI 服務狀態 (T-012): /projects?check runs the free check, 確認額度 shows a Gemini free-tier warning (360 px);
//      not run on a plain visit; English + expired session
// Writes screenshots to qa/reports/e2e-*.png. Exit 1 on any failure.
// QA_ONLY=<regex> runs only the matching steps (the gate always runs them all).
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { QA } from './lib/node-env.mjs';
import { serve } from './lib/serve.mjs';
import { playwright } from './lib/browser.mjs';
import { loadFixtures, recordingPath } from './lib/fixtures.mjs';
import { readXlsx, findRow } from './lib/xlsx-read.mjs';

const OUT = join(QA, 'reports');
// a 240 × 80 test logo (brand-colour block on transparent), made here so no picture is committed
function logoPng() {
  const { PNG } = createRequire(import.meta.url)('pngjs');
  const png = new PNG({ width: 240, height: 80 });
  for (let y = 0; y < 80; y++) for (let x = 0; x < 240; x++) { const i = (y * 240 + x) * 4, on = x < 70 || (y > 30 && y < 50); png.data[i] = 47; png.data[i + 1] = 93; png.data[i + 2] = 80; png.data[i + 3] = on ? 255 : 0; }
  return PNG.sync.write(png);
} mkdirSync(OUT, { recursive: true });
const fx = loadFixtures().find(f => f.kind === 'image' && f.present && existsSync(recordingPath(f.id))) || loadFixtures().find(f => f.kind === 'image' && f.present);
const dwgFx = loadFixtures().find(f => f.id === 'dwg-libredwg-example-2018' && f.present) || loadFixtures().find(f => f.kind === 'dwg' && f.pair && f.present);
const rec = fx && existsSync(recordingPath(fx.id)) ? JSON.parse(readFileSync(recordingPath(fx.id), 'utf8')) : null;
const srv = await serve();
const { chromium } = playwright();
// a UTF-8 locale so downloads keep their Chinese file names (a POSIX locale makes Chrome fall back to "download")
const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const results = []; let failed = 0;
// QA_ONLY=<regex>: run only the matching steps, e.g. QA_ONLY='demo journey|價目表' (plans the skipped steps would make
// come from the DXF sample)
// every context a step opens (page()); closed after the step even when it fails, so a failed step cannot leave a
// software-WebGL page running that slows every later step
const openCtx = new Set();
async function step(name, fn) {
  if (process.env.QA_ONLY && !new RegExp(process.env.QA_ONLY).test(name)) return; // e.g. QA_ONLY='公司資料|價目表' while iterating
  const t0 = Date.now();
  try { await fn(); results.push(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (e) { failed++; results.push(`✗ ${name}: ${String(e.message || e).split('\n')[0]}`); }
  finally { for (const c of openCtx) await c.close().catch(() => {}); openCtx.clear(); }
}
// The cloud stub keeps its state in localStorage so a test can hand it to the next page: qa-doc (plan), qa-firm
// (公司資料), qa-renders (AI renders), qa-projects (我的專案 list).
const cloudStub = (doc = null, share = false) => `
  const U = { id: 'qa-user', email: 'qa@example.com', user_metadata: { full_name: 'QA Designer', given_name: 'QA' } };
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  let renders = ls('qa-renders', []);
  export const client = async () => ({});
  export const currentUser = async () => ${share ? 'null' : 'U'}; export const accessToken = async () => ${share ? 'null' : "'qa-token'"};
  export const onAuth = async () => {}; export const signIn = async () => {}; export const signOut = async () => {};
  export const listProjects = async () => ls('qa-projects', []); export const saveProject = async () => '11111111-2222-3333-4444-555555555555';
  export const loadProject = async () => ({ id: 'p', name: 'QA 專案', client: '王小姐', share_token: null, doc: ${doc ? 'JSON.parse(localStorage.getItem("qa-doc"))' : 'null'}, renders });
  export const sharedProject = async () => ({ name: 'QA 分享專案', client: '王小姐', updated_at: '2026-11-16T08:00:00Z', doc: JSON.parse(localStorage.getItem('qa-doc')), renders, firm: ls('qa-firm', null) });
  export const renameProject = async () => {}; export const deleteProject = async () => {}; export const setShare = async () => 'tok';
  export const setClient = async (id, c) => { window.__qaClient = c; };
  export const putImage = async (p, b) => URL.createObjectURL(b); export const removeImages = async () => {};
  export const getRenders = async () => renders.slice(); export const setRenders = async (id, l) => { renders = l; };
  export const publicUrl = p => p; export const shareUrl = t => location.origin + '/?share=' + t;
  export const proposalUrl = ({ token, id }) => location.origin + '/proposal?' + (token ? 'share=' + token : 'id=' + id);
  export const FIRM_FIELDS = ['name', 'logo', 'phone', 'line_id', 'email', 'address', 'tax_id', 'color'];
  export const getFirm = async () => ls('qa-firm', null);
  export const saveFirm = async f => { const row = { ...f }; localStorage.setItem('qa-firm', JSON.stringify(row)); return row; };
  export const putLogo = async b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  export const removeLogo = async () => {};
  export const pricesAvailable = () => !localStorage.getItem('qa-noprices');
  export const savePrices = async pr => { const f = ls('qa-firm', null) || { name: '' }; f.prices = pr; localStorage.setItem('qa-firm', JSON.stringify(f)); return pr; };`;
async function page({ doc = false, share = false, viewport = { width: 1280, height: 800 }, store = {} } = {}) {
  const ctx = await browser.newContext({ viewport });
  openCtx.add(ctx);
  if (Object.keys(store).length) await ctx.addInitScript(st => { for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); }, store);
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push(String(e)));
  if (process.env.QA_CONSOLE) p.on('console', m => { if (m.type() !== 'log') console.log('  [console]', m.type(), m.text().slice(0, 300)); });
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
  const acad = []; p.on('request', r => { if (/acad-ts|dwg-worker|cad-worker/.test(r.url())) acad.push(r.url()); });
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
  if (acad.length) throw new Error(`DWG converter loaded for a picture: ${acad[0]}`);
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

// ---------- T-002: firm profile → branded share link → 提案書 ----------
let firmJSON = null;
await step('公司資料: designer saves logo, name, contact and 統一編號', async () => {
  const { p, ctx } = await page({ viewport: { width: 390, height: 844 } });
  await p.goto(`${srv.url}/projects`);
  await p.waitForSelector('#firm-open:not([hidden])', { timeout: 15000 });
  if (!(await p.isVisible('#nudge'))) throw new Error('no nudge to set up the firm profile');
  await p.click('#nudge-b');
  await p.waitForSelector('dialog#firm[open]');
  await p.fill('[name=name]', '木與石室內設計');
  await p.fill('[name=phone]', '02-2345-6789');
  await p.fill('[name=line_id]', '@woodstone');
  await p.fill('[name=email]', 'hello@example.com');
  await p.fill('[name=address]', '台北市中山區松江路 1 號');
  await p.fill('[name=tax_id]', '12345678');
  await p.$eval('[name=color]', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, '#2f5d50');
  await p.setInputFiles('#logo-pick', { name: 'logo.png', mimeType: 'image/png', buffer: logoPng() });
  await p.waitForSelector('#logo-box img');
  await p.click('#fm-save');
  const err = await p.textContent('[data-err=tax_id]');
  if (!/統一編號/.test(err)) throw new Error(`bad 統一編號 accepted (${err})`);
  await p.fill('[name=tax_id]', '12345675');
  if ((await p.textContent('#pv-bar b')) !== '木與石室內設計') throw new Error('preview not updated');
  await p.screenshot({ path: join(OUT, 'e2e-5-firm-phone.png') });
  await p.click('#fm-save');
  await p.waitForFunction(() => !document.querySelector('dialog#firm').open, null, { timeout: 10000 });
  firmJSON = await p.evaluate(() => localStorage.getItem('qa-firm'));
  const f = JSON.parse(firmJSON || 'null');
  if (!f || f.name !== '木與石室內設計' || f.tax_id !== '12345675' || f.color !== '#2f5d50' || !/^data:image\/png/.test(f.logo || '')) throw new Error(`saved ${String(firmJSON).slice(0, 160)}`);
  if (await p.isVisible('#nudge')) throw new Error('nudge still shown after saving');
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

// a plan for the share + proposal steps: the imported picture if there was one, else our own DXF sample (always in CI)
if (!docJSON) {
  const { runFixture } = await import('./lib/pipeline.mjs');
  const dx = loadFixtures().find(f => f.kind === 'dxf' && f.present);
  if (dx) { const { doc } = await runFixture(dx); for (const [i, r] of doc.levels[0].rooms.entries()) r.name = r.name || ['客廳', '主臥', '廚房', '衛浴'][i % 4]; docJSON = JSON.stringify(doc); }
}
const RENDERS = JSON.stringify([
  { id: 'r1', room: '主臥', roomEn: 'Master bedroom', style: 'original', after: '/assets/ai/render/master.jpg', thumb: '/assets/ai/render/master.thumb.jpg' },
  { id: 'r2', room: '客廳', roomEn: 'Living room', style: 'original', after: '/assets/ai/render/living.jpg', thumb: '/assets/ai/render/living.thumb.jpg' },
  { id: 'r3', room: '餐廳', roomEn: 'Dining room', style: 'original', after: '/assets/ai/render/dining.jpg', thumb: '/assets/ai/render/dining.thumb.jpg' },
]);
const TOKEN = 'qa-share-token-0123456789';

if (docJSON && firmJSON) await step('share link shows the firm logo and name (PrimeStride only as "Powered by")', async () => {
  const { p, ctx } = await page({ doc: true, share: true, store: { 'qa-doc': docJSON, 'qa-firm': firmJSON, 'qa-renders': RENDERS } });
  await p.goto(`${srv.url}/?share=${TOKEN}`);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 });
  await p.waitForFunction(() => document.querySelector('.bar .brand.firm'), null, { timeout: 10000 }).catch(async e => { throw new Error(`${String(e.message).slice(0, 120)} bar not branded: ${await p.evaluate(() => document.querySelector('.bar .brand').outerHTML.slice(0, 160) + ' · ' + document.body.className)}`); });
  const st = await p.evaluate(() => {
    const b = document.querySelector('.bar .brand'), img = b.querySelector('img'), doc = document.querySelector('#doc-link');
    return { name: b.textContent.trim(), img: img ? img.src.slice(0, 22) : '', imgOk: !!img && img.complete && img.naturalWidth > 0, title: document.title, doc: doc && !doc.hidden ? doc.getAttribute('href') : '', powered: (document.querySelector('.hero-copy .powered') || {}).textContent || '', lede: document.querySelector('.hero-copy > p').textContent };
  });
  if (st.name !== '木與石室內設計') throw new Error(`brand text ${st.name}`);
  if (!st.img.startsWith('data:image/png') || !st.imgOk) throw new Error('firm logo missing in the bar');
  if (!/木與石室內設計/.test(st.title) || /PrimeStride/.test(st.title)) throw new Error(`title ${st.title}`);
  if (!st.doc.includes(`/proposal?share=${TOKEN}`)) throw new Error(`提案書 link ${st.doc}`);
  if (!/Powered by PrimeStride/.test(st.powered)) throw new Error('no Powered by line');
  if (!/木與石室內設計/.test(st.lede)) throw new Error('lede does not name the firm');
  await p.screenshot({ path: join(OUT, 'e2e-6-share-branded.png') });
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

async function readProposal(p) {
  return p.evaluate(() => {
    const num = s => +String(s).replace(/[^\d.]/g, '');
    const rows = [...document.querySelectorAll('table.rooms tbody tr')].map(tr => [...tr.querySelectorAll('td.num')].map(td => num(td.textContent)));
    const tot = document.querySelector('.totals');
    return {
      firm: (document.querySelector('.mast .firm b') || {}).textContent || '', logo: !!document.querySelector('.mast .firm img'),
      imgs: [...document.querySelectorAll('.gallery img, .cover .hero img')].map(i => i.complete && i.naturalWidth > 0), rows,
      total: tot ? +tot.dataset.total : NaN, grand: tot ? +tot.dataset.grand : NaN, text: document.body.innerText,
      client: document.querySelector('.facts') ? document.querySelector('.facts').textContent : '', sheets: document.querySelectorAll('.sheet').length,
    };
  });
}
if (docJSON && firmJSON) await step('提案書: renders, rooms (m²/坪), totals 未稅/含稅; A4 portrait in print', async () => {
  const { p, ctx } = await page({ share: true, store: { 'qa-doc': docJSON, 'qa-firm': firmJSON, 'qa-renders': RENDERS } });
  await p.goto(`${srv.url}/?share=${TOKEN}&view=proposal`); // the share link's proposal view redirects to /proposal
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
  if (!p.url().includes('/proposal?share=')) throw new Error(`not redirected: ${p.url()}`);
  await p.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 20000 });
  const d = await readProposal(p);
  if (d.firm !== '木與石室內設計' || !d.logo) throw new Error('firm name/logo missing on the proposal');
  if (d.imgs.length < 4 || d.imgs.some(x => !x)) throw new Error(`renders ${JSON.stringify(d.imgs)}`);
  if (!d.rows.length) throw new Error('no rooms');
  for (const [m2, ping] of d.rows) if (!(m2 > 0) || Math.abs(ping - m2 / 3.305785) > 0.11) throw new Error(`room ${m2} m² / ${ping} 坪`);
  if (!(d.total > 0) || d.grand !== d.total + Math.round(d.total * 0.05)) throw new Error(`totals ${d.total} / ${d.grand}`);
  for (const w of ['小計（未稅）', '營業稅 5%', '合計（含稅）', '王小姐', '12345675', '@woodstone', 'Powered by PrimeStride']) if (!d.text.includes(w)) throw new Error(`missing “${w}”`);
  if (!d.text.includes(`NT$ ${d.grand.toLocaleString('en-US')}`)) throw new Error('含稅 total not shown');
  await p.screenshot({ path: join(OUT, 'e2e-7-proposal.png'), fullPage: true });
  // print: A4 portrait. The printable width is 210 − 2 × 12 mm = 186 mm ≈ 703 px; nothing may be wider than that.
  await p.emulateMedia({ media: 'print' });
  await p.setViewportSize({ width: 703, height: 1000 });
  const pr = await p.evaluate(() => ({ w: document.documentElement.scrollWidth, tools: getComputedStyle(document.querySelector('#tools')).display, wide: [...document.querySelectorAll('#doc *')].filter(e => e.getBoundingClientRect().right > 704).length }));
  if (pr.w > 703 || pr.wide) throw new Error(`print layout wider than A4: ${pr.w}px, ${pr.wide} elements`);
  if (pr.tools !== 'none') throw new Error('toolbar prints');
  const pdf = await p.pdf({ path: join(OUT, 'e2e-7-proposal.pdf'), preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const box = (pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/) || []).slice(1).map(Number);
  if (!(Math.abs(box[0] - 595.9) < 2 && Math.abs(box[1] - 842.9) < 2)) throw new Error(`PDF page ${box.join('×')} pt is not A4 portrait`);
  if (pages < 2 || pages > 5) throw new Error(`PDF has ${pages} pages`);
  results.push(`    PDF: ${pages} A4 pages, ${(pdf.length / 1024).toFixed(0)} KB · 未稅 NT$ ${d.total.toLocaleString('en-US')} · 含稅 NT$ ${d.grand.toLocaleString('en-US')} · ${d.rows.length} rooms`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

if (docJSON && firmJSON) await step('提案書 on a phone (360 px) and in English', async () => {
  const { p, ctx } = await page({ share: true, viewport: { width: 360, height: 780 }, store: { 'qa-doc': docJSON, 'qa-firm': firmJSON, 'qa-renders': RENDERS } });
  await p.goto(`${srv.url}/proposal?share=${TOKEN}`);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
  await p.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 20000 });
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  if (w > 360) throw new Error(`phone: page is ${w}px wide`);
  await p.screenshot({ path: join(OUT, 'e2e-8-proposal-phone.png'), fullPage: true });
  await p.goto(`${srv.url}/proposal?share=${TOKEN}&lang=en`);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
  const d = await readProposal(p);
  for (const w of ['Design proposal', 'Subtotal (excl. tax)', 'Total (incl. tax)', 'Interior total']) if (!d.text.includes(w)) throw new Error(`English: missing “${w}”`);
  if (/[未含]稅）/.test(d.text)) throw new Error('English page still shows Chinese tax labels');
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

if (docJSON) await step('owner preview of 提案書 without a firm profile points to 公司資料', async () => {
  const { p, ctx } = await page({ doc: true, store: { 'qa-doc': docJSON } });
  await p.goto(`${srv.url}/proposal?id=11111111-2222-3333-4444-555555555555`);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
  const n = await p.evaluate(() => { const e = document.querySelector('#note'); return e && !e.hidden ? e.innerHTML : ''; });
  if (!n.includes('/projects#firm')) throw new Error(`note: ${n.slice(0, 120)}`);
  if (!(await p.textContent('.mast .firm b')).includes('QA 專案')) throw new Error('no project name in the masthead');
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

// ---------- T-007: the client-demo journey in the viewer ----------
// style switch → quote follows; ✦ 一鍵產生提案圖 (render API stubbed) → renders listed and saved on the project; offline →
// a zh message that says what to do; style and 核准 are remembered per project (they used to leak between projects)
if (docJSON) await step('demo journey: style → quote, ✦ 一鍵產生提案圖 → renders saved, offline → zh message, choices kept per project', async () => {
  const A = 'aaaaaaaa-2222-3333-4444-555555555555', B = 'bbbbbbbb-2222-3333-4444-555555555555';
  const oldShared = { 'spatial.style.custom': 'wabi', 'spatial.finishes': JSON.stringify({ floor: 'oak' }), 'spatial.approval.custom': JSON.stringify({ style: 'wabi', name: '侘寂風', at: '2026/11/01 10:00', ref: 'P-20261101-1000', total: 1, grand: 1, finishes: {} }) };
  const { p, ctx } = await page({ doc: true, viewport: { width: 960, height: 600 }, store: { 'qa-doc': docJSON, ...oldShared } });
  let n = 0, offline = false;
  await p.route('**/api/render', async r => {
    if (offline) return r.abort('internetdisconnected');
    const i = n++ % 3, img = ['living', 'dining', 'master'][i];
    await new Promise(x => setTimeout(x, 200));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: `qa-r${n}`, before: `/assets/ai/render/${img}.thumb.jpg`, after: `/assets/ai/render/${img}.jpg`, path: `qa-user/p/qa-r${n}.png`, model: 'stub' }) });
  });
  const open = async id => {
    await p.goto(`${srv.url}/?id=${id}&q=lite#explore`); // lite: no post-processing, so the software-GL captures stay quick
    await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 });
    return p.evaluate(() => ({ style: document.querySelector('#style-now').textContent, total: document.querySelector('#quote-total').textContent, approved: !!window.__spatial.proposal.approval }));
  };
  let st = await open(A);
  if (st.style !== '原始提案' || st.approved) throw new Error(`a new project opened with another project's choices: ${JSON.stringify(st)}`);
  // style switch: the 3D wipes to 侘寂風 and the quote follows
  await p.evaluate(() => [...document.querySelectorAll('#styles .style-card')].find(c => /侘寂/.test(c.textContent)).querySelector('.sc-main').click());
  await p.waitForFunction(b => document.querySelector('#style-now').textContent === '侘寂風' && document.querySelector('#quote-total').textContent !== b, st.total, { timeout: 60000 });
  await p.waitForTimeout(400);
  const wabiTotal = await p.textContent('#quote-total');
  // ✦ 一鍵產生提案圖 (DOM clicks: software GL frames are slow and Playwright's stability wait would time out)
  await p.evaluate(() => document.querySelector('#ai-open').click());
  await p.waitForSelector('#ai:not([hidden]) .ai-set:not([hidden])', { timeout: 20000 });
  const t0 = Date.now();
  await p.evaluate(() => document.querySelector('#ai .ai-set').click());
  await p.waitForFunction(() => document.querySelector('#ai').classList.contains('generating'), null, { timeout: 10000 }).catch(() => {});
  await p.waitForFunction(() => !document.querySelector('#ai').classList.contains('generating'), null, { timeout: 180000 });
  const ai = await p.evaluate(async () => ({ thumbs: [...document.querySelectorAll('#ai .ai-thumbs button span')].map(s => s.textContent), status: document.querySelector('#ai .ai-status').hidden ? '' : document.querySelector('#ai .ai-status').textContent, saved: (await (await import('/src/cloud.js')).getRenders()).map(r => `${r.room}:${r.style}`) }));
  if (!n || ai.thumbs.length !== n || ai.saved.length !== n) throw new Error(`renders: ${n} requests, thumbs ${JSON.stringify(ai.thumbs)}, saved ${JSON.stringify(ai.saved)}`);
  if (!ai.saved.every(s => s.endsWith(':wabi'))) throw new Error(`renders not in the chosen style: ${ai.saved.join(', ')}`);
  if (ai.status) throw new Error(`status left on screen: ${ai.status}`);
  results.push(`    style 原始提案 ${st.total} → 侘寂風 ${wabiTotal} · ${n} renders (${ai.saved.map(s => s.split(':')[0]).join('、')}) in ${((Date.now() - t0) / 1000).toFixed(1)} s with a 0.2 s stub`);
  // the network drops on stage: the set fails with a message that says what to do (not "Failed to fetch")
  offline = true;
  await p.evaluate(() => document.querySelector('#ai .ai-set').click());
  await p.waitForFunction(() => !document.querySelector('#ai').classList.contains('generating') && /失敗/.test(document.querySelector('#ai .ai-status').textContent), null, { timeout: 180000 });
  const msg = await p.textContent('#ai .ai-status');
  if (!/網路連線中斷/.test(msg) || /fetch/i.test(msg)) throw new Error(`offline message: ${msg}`);
  const box = await p.evaluate(() => { const s = document.querySelector('#ai .ai-status').getBoundingClientRect(); return { l: s.left, r: s.right, w: innerWidth }; });
  if (box.l < 0 || box.r > box.w) throw new Error(`status runs off the screen: ${JSON.stringify(box)}`);
  // the same message on a phone (360 px): it wraps and stays on screen
  await p.setViewportSize({ width: 360, height: 780 }); await p.waitForTimeout(300);
  const box360 = await p.evaluate(() => { const s = document.querySelector('#ai .ai-status').getBoundingClientRect(); return { l: s.left, r: s.right, w: innerWidth, sw: document.documentElement.scrollWidth }; });
  if (box360.l < 0 || box360.r > box360.w || box360.sw > 360) throw new Error(`status at 360 px: ${JSON.stringify(box360)}`);
  await p.setViewportSize({ width: 960, height: 600 });
  results.push(`    offline: ${msg}`);
  // choices stay with their project: A keeps 侘寂風, B (never touched) opens on 原始提案
  st = await open(A); if (st.style !== '侘寂風') throw new Error(`project A forgot its style: ${st.style}`);
  st = await open(B); if (st.style !== '原始提案' || st.approved) throw new Error(`project B shows project A's choices: ${JSON.stringify(st)}`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

// the editor's 在 3D 中查看: a saved project opens as the project (AI 效果圖, 提案書); an unsaved plan opens the local
// preview with its own choices — old shared keys (spatial.style.custom, spatial.approval.custom, spatial.finishes) ignored
if (docJSON) await step('editor 在 3D 中查看: saved → the project; unsaved → own preview, old shared style/核准 ignored', async () => {
  const A = 'aaaaaaaa-2222-3333-4444-555555555555';
  { // signed in, project in the account
    const { p, ctx } = await page({ doc: true, store: { 'qa-doc': docJSON } });
    await p.goto(`${srv.url}/editor?id=${A}`);
    await p.waitForFunction(() => window.__editor && window.__editor.doc.levels[0].rooms.length > 0, null, { timeout: 30000 });
    await p.evaluate(() => document.querySelector('#btn-3d').click());
    await p.waitForURL(u => u.pathname === '/' && u.searchParams.get('id') === A, { timeout: 20000 });
    if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
  }
  { // signed out: local preview, with the stale keys every browser that used main has
    const old = { 'spatial.style.custom': 'wabi', 'spatial.finishes': JSON.stringify({ floor: 'oak' }), 'spatial.approval.custom': JSON.stringify({ style: 'wabi', name: '侘寂風', at: '2026/11/01 10:00', ref: 'P-20261101-1000', total: 1, grand: 1, finishes: {} }) };
    const { p, ctx } = await page({ share: true, viewport: { width: 960, height: 600 }, store: { 'spatial.editor.doc': docJSON, ...old } });
    await p.goto(`${srv.url}/editor`);
    await p.waitForFunction(() => window.__editor && window.__editor.doc.levels[0].rooms.length > 0, null, { timeout: 30000 });
    await p.evaluate(() => document.querySelector('#btn-3d').click());
    await p.waitForURL(/[?&]p=custom/, { timeout: 20000 });
    await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 });
    const st = await p.evaluate(() => ({ style: document.querySelector('#style-now').textContent, approved: !!window.__spatial.proposal.approval, id: JSON.parse(localStorage.getItem('spatial.custom')).localId, left: ['spatial.style.custom', 'spatial.approval.custom'].filter(k => localStorage.getItem(k) != null) }));
    if (st.style !== '原始提案' || st.approved) throw new Error(`preview opened with stale choices: ${JSON.stringify(st)}`);
    if (!st.id) throw new Error('the handed-over plan has no localId');
    if (st.left.length) throw new Error(`old shared keys not removed: ${st.left.join(', ')}`);
    if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
  }
});

// a browser that blocks site storage (Chrome "block all cookies", some in-app browsers) still opens the 3D
await step('3D opens with site storage blocked', async () => {
  const { p, ctx } = await page({ viewport: { width: 960, height: 600 } });
  await p.addInitScript(() => { for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }); });
  await p.goto(`${srv.url}/?p=apartment&q=lite#explore`);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 });
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

// ---------- T-003: 價目表 → quote → Excel 報價單 ----------
const money = s => +String(s).replace(/[^\d.-]/g, '');
let pricedFirm = null, furnKey = null;
if (docJSON && firmJSON) await step('價目表: designer changes a finish price, a furniture price and adds a works line (phone)', async () => {
  const { p, ctx } = await page({ viewport: { width: 360, height: 780 }, store: { 'qa-firm': firmJSON } });
  await p.goto(`${srv.url}/projects`);
  await p.waitForSelector('#prices-open:not([hidden])', { timeout: 15000 });
  await p.click('#prices-open');
  await p.waitForSelector('dialog#prices[open] .pl-p[data-k="floor.oak"]');
  if (await p.isVisible('.pl-off')) throw new Error('"not available yet" note shown although the column exists');
  if (await p.inputValue('[data-k="floor.oak"]') !== '4800') throw new Error('not seeded from the sample prices');
  const over = await p.evaluate(() => { const d = document.querySelector('dialog#prices'); return [d.getBoundingClientRect().right, d.querySelector('.fm-b').scrollWidth - d.querySelector('.fm-b').clientWidth, document.documentElement.scrollWidth]; });
  if (over[0] > 360 || over[1] > 0 || over[2] > 360) throw new Error(`wider than the phone: dialog right ${over[0]} px, overflow ${over[1]} px, page ${over[2]} px`);
  await p.fill('[name=pl-name]', '木與石 2026 價目表');
  await p.fill('[data-k="floor.oak"]', '-5');
  await p.click('#pl-save');
  if (!/單價/.test(await p.textContent('.pl-err')) || !(await p.evaluate(() => document.querySelector('dialog#prices').open))) throw new Error('a negative price was accepted');
  await p.fill('[data-k="floor.oak"]', '6000');
  // a furniture piece that is in this project
  const keys = [...new Set(JSON.parse(docJSON).levels.flatMap(L => L.furniture).filter(f => f.price > 0).map(f => `${f.name}@${f.price}`))];
  await p.click('[data-tab=furn]');
  for (const k of keys) if (await p.$(`[data-k="f:${k}"]`)) { furnKey = k; break; }
  if (!furnKey) throw new Error(`no catalogue row for the project's furniture (${keys.slice(0, 4).join(', ')})`);
  await p.fill(`[data-k="f:${furnKey}"]`, String(+furnKey.split('@')[1] + 1000));
  await p.click('[data-tab=works]');
  await p.check('.pl-line[data-i="0"] [data-f=on]');
  await p.screenshot({ path: join(OUT, 'e2e-9-prices-phone.png') });
  await p.click('#pl-save');
  await p.waitForFunction(() => !document.querySelector('dialog#prices').open, null, { timeout: 10000 });
  pricedFirm = await p.evaluate(() => localStorage.getItem('qa-firm'));
  const pr = JSON.parse(pricedFirm).prices;
  if (pr.name !== '木與石 2026 價目表' || pr.finishes['floor.oak'] !== 6000 || !pr.lines[0].on || pr.furniture[furnKey] !== +furnKey.split('@')[1] + 1000) throw new Error(`saved ${JSON.stringify(pr).slice(0, 200)}`);
  if (JSON.parse(pricedFirm).name !== '木與石室內設計') throw new Error('saving prices changed the firm profile');
  results.push(`    floor.oak 4,800 → 6,000 · ${furnKey} +1,000 · ${pr.lines[0].name} on`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

async function grabXlsx(p, sel, dom = false) {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 90000 }), // software WebGL keeps the page busy in CI
    dom ? p.$eval(sel, b => b.click()) : p.click(sel)]);
  const name = dl.suggestedFilename();
  if (!/\.xlsx$/.test(name)) throw new Error(`download name ${name}`);
  const file = join(OUT, `e2e-quote-${sel.replace(/\W/g, '')}.xlsx`);
  await dl.saveAs(file);
  return { name, X: readXlsx(readFileSync(file)), file };
}
function checkXlsx(X, { total, grand, oak, works, furn }) {
  const oakRow = X.rows.find(r => r && r[1] === oak);
  if (!oakRow || oakRow[4] !== 6000 || oakRow[5] !== Math.round(+(oakRow[2] * 6000).toFixed(6))) throw new Error(`xlsx floor row ${JSON.stringify(oakRow)}`);
  const w = X.rows.find(r => r && r[0] === works);
  if (!w || !(w[5] > 0)) throw new Error(`xlsx works line ${JSON.stringify(w)}`);
  if (furn && !X.rows.some(r => r && r[0] === furn.name && r[4] === furn.price)) throw new Error(`xlsx furniture ${furn.name} not at ${furn.price}`);
  const ti = X.rows.findIndex(r => r && /^(合計（未稅）|Subtotal)/.test(r[2] || ''));
  const [sub, tax, all] = [X.rows[ti][5], X.rows[ti + 1][5], X.rows[ti + 2][5]];
  const items = Object.entries(X.cells).filter(([, c]) => c.f && /^ROUND\(C\d+\*E\d+,0\)$/.test(c.f)).reduce((a, [, c]) => a + c.v, 0);
  if (sub !== total || items !== total) throw new Error(`xlsx subtotal ${sub}, rows ${items}, on screen ${total}`);
  if (tax !== Math.round(+(total * 0.05).toFixed(6)) || all !== grand) throw new Error(`xlsx tax ${tax} / total ${all} vs ${grand}`);
  if (!X.strings.includes('木與石室內設計') || !X.strings.some(s => s.includes('木與石 2026 價目表'))) throw new Error('xlsx header without the firm / price list');
  return { sub, tax, all, rows: X.rows.filter(Boolean).length };
}

if (pricedFirm) await step('3D quote uses the firm price list → Excel 報價單 from the viewer matches it', async () => {
  const { p, ctx } = await page({ doc: true, store: { 'qa-doc': docJSON, 'qa-firm': pricedFirm } });
  await p.goto(`${srv.url}/?id=11111111-2222-3333-4444-555555555555&q=lite#explore`);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 });
  const q = await p.evaluate(() => ({
    rows: [...document.querySelectorAll('#quote-lines tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim())),
    total: document.querySelector('#quote-total').textContent, basis: document.querySelector('#quote-basis').textContent,
    btn: !document.querySelector('#quote-xlsx').hidden, edit: (document.querySelector('#quote-basis a') || {}).href || '',
  }));
  const oak = q.rows.find(r => /海島型木地板/.test(r[0]));
  if (!oak || money(oak[2]) !== 6000) throw new Error(`floor line ${JSON.stringify(oak)}`);
  if (!q.rows.some(r => /保護工程/.test(r[0]))) throw new Error('works line missing from the quote');
  const fname = furnKey.split('@')[0], fprice = +furnKey.split('@')[1] + 1000;
  if (!q.rows.some(r => r[0].startsWith(fname) && money(r[2]) === fprice)) throw new Error(`${fname} not at ${fprice}`);
  if (!/木與石 2026 價目表/.test(q.basis) || /PrimeStride 示範價目表/.test(q.basis)) throw new Error(`basis: ${q.basis}`);
  if (!q.edit.endsWith('/projects#prices')) throw new Error('no link to edit the price list');
  if (!q.btn) throw new Error('Excel button hidden for the owner');
  const total = money(q.total);
  // the button is on screen and not covered (a real click target); the click itself is dispatched in the page because
  // Playwright's stability wait can take minutes while software WebGL renders the explore view
  const hit = await p.evaluate(() => { const b = document.querySelector('#quote-xlsx'), r = b.getBoundingClientRect(); return r.width > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b; });
  if (!hit) throw new Error('Excel button not visible in the quote panel');
  const { name, X } = await grabXlsx(p, '#quote-xlsx', true);
  if (!/^報價單-/.test(name)) throw new Error(`file name ${name}`);
  const r = checkXlsx(X, { total, grand: total + Math.round(+(total * 0.05).toFixed(6)), oak: oak[0].replace(/^地坪\s*/, ''), works: '保護工程', furn: { name: fname, price: fprice } });
  if (!X.strings.includes('王小姐')) throw new Error('client name missing in the xlsx');
  await p.screenshot({ path: join(OUT, 'e2e-10-quote-firm-prices.png'), timeout: 120000 });
  results.push(`    viewer 未稅 NT$ ${total.toLocaleString('en-US')} = xlsx ${r.sub.toLocaleString('en-US')} + 稅 ${r.tax.toLocaleString('en-US')} = ${r.all.toLocaleString('en-US')} · ${r.rows} rows · ${name}`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

if (pricedFirm) await step('share link + 提案書 use the firm prices; Excel 報價單 only for the owner, matching the proposal', async () => {
  const st = { 'qa-doc': docJSON, 'qa-firm': pricedFirm, 'qa-renders': RENDERS };
  const { p, ctx } = await page({ doc: true, share: true, store: st });
  await p.goto(`${srv.url}/?share=${TOKEN}`);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 });
  const sv = await p.evaluate(() => ({ btn: getComputedStyle(document.querySelector('#quote-xlsx')).display !== 'none' && !document.querySelector('#quote-xlsx').hidden, oak: [...document.querySelectorAll('#quote-lines tbody tr')].map(tr => tr.textContent).find(t => /海島型木地板/.test(t)) || '', edit: !!document.querySelector('#quote-basis a') }));
  if (sv.btn) throw new Error('Excel export offered on the client share link');
  if (!/6,000/.test(sv.oak)) throw new Error(`share quote floor line: ${sv.oak}`);
  if (sv.edit) throw new Error('client sees the price-list edit link');
  await p.goto(`${srv.url}/proposal?share=${TOKEN}`);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
  const pv = await p.evaluate(() => ({ text: document.querySelector('[data-page=quote]').innerText, works: document.querySelectorAll('table.q tr[data-works]').length, xlsx: !!document.querySelector('#xlsx'), total: +document.querySelector('.totals').dataset.total, grand: +document.querySelector('.totals').dataset.grand }));
  if (!/6,000/.test(pv.text) || pv.works !== 1) throw new Error(`proposal quote: works ${pv.works}, ${pv.text.slice(0, 160)}`);
  if (!/木與石 2026 價目表/.test(pv.text) || /PrimeStride 示範價目表/.test(pv.text)) throw new Error('proposal basis line does not name the firm price list');
  if (pv.xlsx) throw new Error('Excel export offered on the client proposal');
  await ctx.close();
  const o = await page({ doc: true, store: st });
  await o.p.goto(`${srv.url}/proposal?id=11111111-2222-3333-4444-555555555555`);
  await o.p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
  const tot = await o.p.evaluate(() => ({ total: +document.querySelector('.totals').dataset.total, grand: +document.querySelector('.totals').dataset.grand }));
  if (tot.total !== pv.total) throw new Error(`owner and client proposal differ: ${tot.total} vs ${pv.total}`);
  const { X, file } = await grabXlsx(o.p, '#xlsx');
  const r = checkXlsx(X, { total: tot.total, grand: tot.grand, oak: X.rows.find(r => r && r[0] === '地坪')[1], works: '保護工程' });
  await o.p.screenshot({ path: join(OUT, 'e2e-11-proposal-firm-prices.png'), fullPage: true, timeout: 120000 });
  results.push(`    提案書 未稅 NT$ ${tot.total.toLocaleString('en-US')} / 含稅 ${tot.grand.toLocaleString('en-US')} = xlsx ${r.all.toLocaleString('en-US')} · ${file.split('/').pop()}`);
  if (p.errors.length || o.p.errors.length) throw new Error(p.errors[0] || o.p.errors[0]); await o.ctx.close();
});

await step('價目表 before the database column exists: explains, does not save (English)', async () => {
  const { p, ctx } = await page({ store: { 'qa-noprices': '1' } });
  await p.goto(`${srv.url}/projects?lang=en`);
  await p.waitForSelector('#prices-open:not([hidden])', { timeout: 15000 });
  if ((await p.textContent('#prices-open')).trim() !== 'Price list') throw new Error('English label');
  await p.click('#prices-open');
  await p.waitForSelector('dialog#prices[open]');
  const st = await p.evaluate(() => ({ off: !document.querySelector('.pl-off').hidden, save: document.querySelector('#pl-save').disabled, title: document.querySelector('#pl-title').textContent, tabs: [...document.querySelectorAll('.pl-tabs button')].map(b => b.textContent) }));
  if (!st.off || !st.save) throw new Error(`note ${st.off}, save disabled ${st.save}`);
  if (st.title !== 'Price list' || st.tabs.join() !== 'Finishes,Works,Furniture,Notes') throw new Error(`English: ${st.title} / ${st.tabs}`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

if (dwgFx) await step(`DWG ${dwgFx.id} dropped on 我的專案 → 轉檔 → walls + rooms, file stays in the browser`, async () => {
  const { p, ctx } = await page();
  const sent = []; p.on('request', r => { const u = new URL(r.url()); if (r.method() !== 'GET' || (u.hostname !== 'localhost' && !/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname))) sent.push(`${r.method()} ${u.host}${u.pathname}`); });
  await p.goto(`${srv.url}/projects`);
  await p.waitForSelector('#list:not([hidden])', { timeout: 15000 });
  await p.setInputFiles('#pick', dwgFx.path);
  await p.waitForURL(/\/editor\?new=1/, { timeout: 15000 });
  // frame gaps while the 轉檔 step is active: the page must keep painting (conversion runs in a Worker)
  await p.waitForSelector('#flow li[data-k="convert"].active, #flow li[data-k="convert"].done', { timeout: 20000 });
  await p.evaluate(() => { window.__gaps = []; let last = performance.now(); const f = now => { window.__gaps.push(now - last); last = now; if (!document.querySelector('#flow.done')) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await p.waitForSelector('#flow.done', { timeout: 120000 });
  const st = await p.evaluate(() => ({
    steps: [...document.querySelectorAll('#flow li')].map(l => `${l.dataset.k}:${l.className}`),
    conv: document.querySelector('#flow li[data-k="convert"] small').textContent,
    sum: document.querySelector('#flow .sum').textContent,
    walls: window.__editor.doc.levels.reduce((n, L) => n + L.walls.length, 0),
    rooms: window.__editor.doc.levels.reduce((n, L) => n + L.rooms.length, 0),
    maxGap: Math.round(Math.max(0, ...window.__gaps)),
  }));
  await p.screenshot({ path: join(OUT, 'e2e-5-dwg-flow.png') });
  if (!st.steps.includes('convert:done')) throw new Error(`轉檔 step: ${st.steps.join(',')}`);
  if (st.steps.some(c => !/:(done|skip)$/.test(c))) throw new Error(`steps ${st.steps.join(',')}`);
  if (!(st.walls > 0 && st.rooms > 0)) throw new Error(`walls ${st.walls}, rooms ${st.rooms}`);
  if (sent.length) throw new Error(`requests left the page: ${sent.slice(0, 3).join(', ')}`);
  results.push(`    轉檔 ${st.conv} · ${st.walls} walls, ${st.rooms} rooms · longest frame gap after 轉檔 started ${st.maxGap} ms`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

// the page must keep painting through the whole import of a big drawing (it all runs in the CAD Worker)
for (const big of loadFixtures().filter(f => ['dwg-perf-40k', 'dxf-d10-mall-gf'].includes(f.id) && f.present)) await step(`big drawing ${big.id}: no frame over 250 ms, done within 20 s`, async () => {
  const { p, ctx } = await page();
  await p.goto(`${srv.url}/editor?new=1`); await p.waitForTimeout(800);
  await p.evaluate(() => { window.__gaps = []; let last = performance.now(); const f = now => { window.__gaps.push(now - last); last = now; if (!document.querySelector('#flow.done')) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const t0 = Date.now();
  await p.setInputFiles('#file-dxf', big.path);
  await p.waitForSelector('#flow.done', { timeout: 60000 });
  const secs = (Date.now() - t0) / 1000;
  const st = await p.evaluate(() => ({ maxGap: Math.round(Math.max(0, ...window.__gaps)), frames: window.__gaps.length, steps: [...document.querySelectorAll('#flow li')].map(l => `${l.dataset.k}:${l.className}`), walls: window.__editor.doc.levels[0].walls.length, rooms: window.__editor.doc.levels[0].rooms.length }));
  results.push(`    ${secs.toFixed(1)} s · longest frame ${st.maxGap} ms over ${st.frames} frames · ${st.walls} walls, ${st.rooms} rooms`);
  if (st.steps.some(c => !/:(done|skip)$/.test(c))) throw new Error(`steps ${st.steps.join(',')}`);
  if (!(st.walls > 0)) throw new Error('no walls');
  if (st.maxGap > 250) throw new Error(`frame gap ${st.maxGap} ms`);
  if (secs > 20) throw new Error(`took ${secs.toFixed(1)} s`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

const dxfFx = loadFixtures().find(f => f.id === 'dxf-sample-2br' && f.present);
for (const cad of [dwgFx, dxfFx].filter(Boolean)) await step(`cad-worker.js missing (404): ${cad.id} still imports on the page`, async () => {
  const { p, ctx } = await page();
  await p.route('**/src/editor/cad-worker.js', r => r.fulfill({ status: 404, body: 'not found' }));
  await p.goto(`${srv.url}/editor?new=1`); await p.waitForTimeout(800);
  await p.setInputFiles('#file-dxf', cad.path);
  await p.waitForSelector('#flow.done', { timeout: 60000 });
  const st = await p.evaluate(() => ({ h: document.querySelector('#flow-h').textContent, sum: document.querySelector('#flow .sum').textContent, walls: window.__editor.doc.levels[0].walls.length, rooms: window.__editor.doc.levels[0].rooms.length }));
  if (!(st.walls > 0 && st.rooms > 0)) throw new Error(`${st.h}: ${st.sum.slice(0, 80)} (walls ${st.walls}, rooms ${st.rooms})`);
  results.push(`    fallback: ${st.walls} walls, ${st.rooms} rooms`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

if (dwgFx) await step('CAD Worker dies after its first progress message → clear zh error within seconds', async () => {
  const { p, ctx } = await page();
  await p.route('**/src/editor/cad-worker.js', r => r.fulfill({ contentType: 'text/javascript', body: `self.onmessage = () => { self.postMessage({ stage: 'convert', info: { version: 'AC1032', year: '2018', ms: { total: 5, read: 4, write: 1 } } }); setTimeout(() => { throw new Error('simulated out of memory'); }, 100); };` }));
  await p.goto(`${srv.url}/editor?new=1`); await p.waitForTimeout(800);
  const t0 = Date.now();
  await p.setInputFiles('#file-dxf', dwgFx.path);
  await p.waitForSelector('#flow.done', { timeout: 20000 });
  const st = await p.evaluate(() => ({ sum: document.querySelector('#flow .sum').textContent, conv: document.querySelector('#flow li[data-k="convert"]').className }));
  if (!/中斷/.test(st.sum)) throw new Error(`message: ${st.sum}`);
  if (st.conv !== 'done') throw new Error(`轉檔 step ${st.conv}`);
  results.push(`    ${((Date.now() - t0) / 1000).toFixed(1)} s · ${st.sum.slice(0, 60)}`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

await step('damaged .dwg in the editor → clear zh error, no page error', async () => {
  const { p, ctx } = await page();
  await p.goto(`${srv.url}/editor?new=1`); await p.waitForTimeout(800);
  const bad = Buffer.concat([Buffer.from('AC1032'), Buffer.alloc(4000, 7)]);
  await p.setInputFiles('#file-dxf', { name: '壞掉的平面.dwg', mimeType: 'application/acad', buffer: bad });
  await p.waitForSelector('#flow.done', { timeout: 30000 });
  const st = await p.evaluate(() => ({ h: document.querySelector('#flow-h').textContent, sum: document.querySelector('#flow .sum').textContent, conv: document.querySelector('#flow li[data-k="convert"]').className, toast: document.querySelector('#toast').textContent }));
  if (!/DWG/.test(st.sum) || !/[\u4e00-\u9fff]/.test(st.sum)) throw new Error(`message: ${st.sum}`);
  if (st.conv !== 'skip') throw new Error(`轉檔 step ${st.conv}`);
  await p.screenshot({ path: join(OUT, 'e2e-6-dwg-error.png') });
  results.push(`    ${st.sum.slice(0, 90)}`);
  if (p.errors.length) throw new Error(p.errors[0]); await ctx.close();
});

// ---------- T-012: AI 服務狀態 on 我的專案 (free check, then the paid confirm), /api/health stubbed ----------
await step('AI 服務狀態: /projects?check → keys valid → 確認額度 → free-tier warning (360 px); hidden by default; English', async () => {
  const { p } = await page({ viewport: { width: 360, height: 780 } });
  const hits = [];
  await p.route('**/api/health', r => {
    const m = r.request().method(); hits.push([m, r.request().headers().authorization]);
    const body = m === 'POST'
      ? { checked_at: '2026-11-17T08:00:00Z', probe: true, vision: { code: 'ready', model: 'claude-sonnet-5-5' }, render: { code: 'free-tier', model: 'gemini-3-pro-image' } }
      : { checked_at: '2026-11-17T08:00:00Z', probe: false, vision: { code: 'ok', model: 'claude-sonnet-5-5' }, render: { code: 'ok', model: 'gemini-3-pro-image' } };
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  // a plain visit does not run the check
  await p.goto(`${srv.url}/projects`);
  await p.waitForSelector('#list:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(300);
  if (!(await p.isHidden('#aih')) || hits.length) throw new Error('AI status opened / checked on a plain visit');
  // the pre-demo link
  await p.goto(`${srv.url}/projects?check`);
  await p.waitForSelector('#aih:not([hidden]) li[data-id=render]', { timeout: 15000 });
  let st = await p.evaluate(() => ({ sum: document.querySelector('#aih-sum').textContent, rows: [...document.querySelectorAll('#aih li')].map(l => l.dataset.tone + ':' + l.textContent), probe: !document.querySelector('#aih-probe').hidden, sw: document.documentElement.scrollWidth }));
  if (!/確認額度/.test(st.sum) || !st.rows.every(r => /^warn:.*金鑰有效/.test(r))) throw new Error(`free check: ${JSON.stringify(st)}`);
  if (!st.probe) throw new Error('確認額度 button missing');
  if (st.sw > 360) throw new Error(`horizontal scroll at 360 px: ${st.sw}`);
  if (!hits.length || hits[0][0] !== 'GET' || hits[0][1] !== 'Bearer qa-token') throw new Error(`request ${JSON.stringify(hits)}`);
  await p.click('#aih-probe');
  await p.waitForFunction(() => document.querySelector('#aih').dataset.tone === 'bad', null, { timeout: 10000 });
  st = await p.evaluate(() => ({ sum: document.querySelector('#aih-sum').textContent, render: document.querySelector('#aih li[data-id=render]').textContent, vision: document.querySelector('#aih li[data-id=vision]').dataset.tone, sw: document.documentElement.scrollWidth }));
  if (hits[hits.length - 1][0] !== 'POST') throw new Error('confirm did not POST');
  if (!/免費方案.*開啟付費/.test(st.render) || !/備用專案/.test(st.sum) || st.vision !== 'ok') throw new Error(`confirm: ${JSON.stringify(st)}`);
  if (st.sw > 360) throw new Error(`horizontal scroll at 360 px: ${st.sw}`);
  await p.screenshot({ path: join(OUT, 'e2e-12-ai-health-phone.png'), fullPage: true });
  if (p.errors.length) throw new Error(p.errors[0]);
  // English: no status link for designers; ?check opens it; session expired (401) → asks to sign in again
  const { p: q } = await page();
  await q.route('**/api/health', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"sign-in required"}' }));
  await q.goto(`${srv.url}/projects?lang=en`);
  await q.waitForSelector('#list:not([hidden])', { timeout: 15000 });
  if (await q.isVisible('#aih-open')) throw new Error('AI status link visible to every designer (owner-only via ?check)');
  if (!(await q.isHidden('#aih'))) throw new Error('AI panel open without ?check');
  await q.goto(`${srv.url}/projects?lang=en&check`);
  await q.waitForFunction(() => /Sign in again/.test(document.querySelector('#aih-sum').textContent), null, { timeout: 10000 });
  if ((await q.textContent('#aih-t')) !== 'AI services') throw new Error('panel title not in English');
  if (q.errors.length) throw new Error(q.errors[0]);
});

await browser.close(); srv.close();
console.log(results.join('\n'));
if (!fx) console.log('(no image fixture available: upload/3D/share steps skipped — sync private fixtures)');
if (!dwgFx) console.log('(no DWG fixture available: DWG upload step skipped — sync private fixtures)');
console.log(failed ? `\nE2E: ${failed} failed` : '\nE2E: all passed');
process.exit(failed ? 1 : 0);
