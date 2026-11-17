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
//  13. T-011: the owner's style (and a custom mix) is saved on the project → the client's link, the 提案書 and the owner on
//      another computer open on it with the same total; the client's own switch saves nothing; a failed save is reported;
//      leaving the 3D right after a change (or during its wipe) still saves it; an old browser-local style is not pushed
//  14. T-010: 分享 in the 3D → link, QR (decoded from the screen), 複製, LINE, 停止分享, token reused; 360 px bar and panel;
//      English; no 分享 on the client link
//  15. T-007 N9 (failed save → the preview says what it lacks) and N10 (old spatial.finishes no longer leaks into the demo)
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
  export const listProjects = async () => ls('qa-projects', []);
  export const saveProject = async () => { if (localStorage.getItem('qa-savefail')) throw new Error('qa: save failed'); return '11111111-2222-3333-4444-555555555555'; };
  // per project id: the presented style (T-011) and the share token (T-010), so projects never see each other's
  const docOf = id => { const d = ${doc ? 'JSON.parse(localStorage.getItem("qa-doc"))' : 'null'}; const pr = ls('qa-presented.' + id, null); if (d && pr) d.presented = pr; return d; };
  export const loadProject = async id => ({ id, name: 'QA 專案', client: '王小姐', share_token: ls('qa-share.' + id, null), doc: docOf(id), renders });
  window.__qaPresentedCalls = 0; window.__qaShareCalls = [];
  export const savePresented = async (id, pr) => { window.__qaPresentedCalls++; if (localStorage.getItem('qa-presentfail')) throw new Error('qa: offline'); localStorage.setItem('qa-presented.' + id, JSON.stringify(pr)); return pr; };
  export const sharedProject = async () => ({ name: 'QA 分享專案', client: '王小姐', updated_at: '2026-11-16T08:00:00Z', doc: JSON.parse(localStorage.getItem('qa-doc')), renders, firm: ls('qa-firm', null) });
  export const renameProject = async () => {}; export const deleteProject = async () => {};
  export const setShare = async (id, on) => { window.__qaShareCalls.push(on); if (localStorage.getItem('qa-sharefail')) throw new Error('qa: offline'); const tok = on ? 'qa-share-token-0123456789' : null; localStorage.setItem('qa-share.' + id, JSON.stringify(tok)); return tok; };
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
  // timer polling: rAF polling starves while software GL draws full-quality frames
  await p.waitForFunction(() => document.querySelector('.bar .brand.firm'), null, { timeout: 10000, polling: 250 }).catch(async e => { throw new Error(`${String(e.message).slice(0, 120)} bar not branded: ${await p.evaluate(() => document.querySelector('.bar .brand').outerHTML.slice(0, 160) + ' · ' + document.body.className)}`); });
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
    await p.waitForFunction(() => document.body.classList.contains('ready') && !!window.__spatial, null, { timeout: 90000 });
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
    await p.waitForFunction(() => document.body.classList.contains('ready') && !!window.__spatial, null, { timeout: 90000 });
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

// ---------- T-011: the designer's chosen style is saved with the project ----------
// owner picks 侘寂風 → saved on the project → the client's link opens in 侘寂風 with the same total → 提案書 quotes it →
// the client switching style changes nothing saved (and can go back to the designer's pick); a custom mix travels too.
// Pages open in 平面圖 (#plan): a style switch then applies without the animated 3D wipe, which takes ~40 s per switch in
// software GL on a busy box (the wipe itself is covered by the demo journey step)
const readView = p => p.evaluate(() => ({ style: document.querySelector('#style-now').textContent, total: document.querySelector('#quote-total').textContent }));
const openView = async (p, url) => { await p.goto(url); await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 }); await p.waitForTimeout(300); return readView(p); };
const pickStyleCard = (p, re) => p.evaluate(src => [...document.querySelectorAll('#styles .style-card')].find(c => new RegExp(src).test(c.querySelector('.sc-name').textContent)).querySelector('.sc-main').click(), re);
if (docJSON && firmJSON) await step('T-011 style saved with the project: owner 侘寂風 → client link + 提案書 same style and total; client switch saves nothing', async () => {
  const A = 'aaaaaaaa-2222-3333-4444-555555555555';
  const { p, ctx } = await page({ doc: true, viewport: { width: 960, height: 600 }, store: { 'qa-doc': docJSON, 'qa-firm': firmJSON } });
  let st = await openView(p, `${srv.url}/?id=${A}&q=lite#plan`);
  if (st.style !== '原始提案') throw new Error(`owner opened on ${st.style}`);
  await pickStyleCard(p, '侘寂');
  await p.waitForFunction(() => document.querySelector('#style-now').textContent === '侘寂風', null, { timeout: 60000 });
  await p.waitForFunction(id => { try { return JSON.parse(localStorage.getItem('qa-presented.' + id)).style === 'wabi'; } catch { return false; } }, A, { timeout: 15000 })
    .catch(async () => { throw new Error(`not saved on the project: ${await p.evaluate(id => localStorage.getItem('qa-presented.' + id), A)}`); });
  await p.waitForTimeout(600);
  const owner = await readView(p);
  const saved = await p.evaluate(id => localStorage.getItem('qa-presented.' + id), A);
  const docWith = JSON.stringify({ ...JSON.parse(docJSON), presented: JSON.parse(saved) });
  // the client's phone: opens in the designer's style with the same total
  const c = await page({ doc: true, share: true, viewport: { width: 360, height: 780 }, store: { 'qa-doc': docWith, 'qa-firm': firmJSON } });
  st = await openView(c.p, `${srv.url}/?share=${TOKEN}&q=lite#plan`);
  if (st.style !== '侘寂風' || st.total !== owner.total) throw new Error(`client sees ${JSON.stringify(st)}, designer saw ${JSON.stringify(owner)}`);
  // the client switches to 原始提案 on the phone: nothing is saved anywhere, and 設計師的提案 brings the pick back
  await pickStyleCard(c.p, '原始提案');
  await c.p.waitForFunction(() => document.querySelector('#style-now').textContent === '原始提案', null, { timeout: 60000 });
  const after = await c.p.evaluate(() => ({ calls: window.__qaPresentedCalls, keys: Object.keys(localStorage).filter(k => k.startsWith('qa-presented')), back: (() => { const b = document.querySelector('#presented-back'); return !!b && !b.hidden && getComputedStyle(b).display !== 'none'; })() }));
  if (after.calls || after.keys.length) throw new Error(`the client's switch was saved: ${JSON.stringify(after)}`);
  if (!after.back) throw new Error('no way back to the designer\'s pick');
  await c.p.evaluate(() => document.querySelector('#presented-back').click());
  await c.p.waitForFunction(() => document.querySelector('#style-now').textContent === '侘寂風', null, { timeout: 60000 });
  await c.p.evaluate(() => document.querySelector('#panel-toggle').click()); await c.p.waitForTimeout(500);
  await c.p.screenshot({ path: join(OUT, 'e2e-11-client-style-phone.png'), timeout: 120000 });
  // 提案書 from the client link quotes 侘寂風 with the designer's total
  await c.p.goto(`${srv.url}/proposal?share=${TOKEN}`);
  await c.p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
  const pp = await c.p.evaluate(() => ({ style: document.querySelector('#style').value, total: +document.querySelector('.totals').dataset.total, facts: document.querySelector('.facts').textContent }));
  if (pp.style !== 'wabi' || pp.total !== money(owner.total) || !pp.facts.includes('侘寂風')) throw new Error(`提案書 quotes ${JSON.stringify(pp)}, designer saw ${owner.total}`);
  if (c.p.errors.length) throw new Error(c.p.errors[0]);
  // a custom mix (one finish changed) is saved too: the client and 提案書 get exactly those finishes and that total
  await p.evaluate(() => { document.querySelector('.ptabs [data-tab="finishes"]').click(); const f = [...document.querySelectorAll('#finishes fieldset')][0]; [...f.querySelectorAll('input')].find(i => !i.checked).click(); });
  await p.waitForFunction(() => document.querySelector('#style-now').textContent === '自訂組合', null, { timeout: 30000 });
  await p.waitForFunction(id => { try { return JSON.parse(localStorage.getItem('qa-presented.' + id)).style === null; } catch { return false; } }, A, { timeout: 15000 });
  await p.waitForTimeout(600);
  const mix = await readView(p), mixSaved = await p.evaluate(id => localStorage.getItem('qa-presented.' + id), A);
  const c2 = await page({ doc: true, share: true, viewport: { width: 960, height: 600 }, store: { 'qa-doc': JSON.stringify({ ...JSON.parse(docJSON), presented: JSON.parse(mixSaved) }), 'qa-firm': firmJSON } });
  st = await openView(c2.p, `${srv.url}/?share=${TOKEN}&q=lite&lang=en#plan`);
  if (st.style !== 'Custom mix' || st.total !== mix.total) throw new Error(`custom mix: client sees ${JSON.stringify(st)}, designer saw ${JSON.stringify(mix)}`);
  await c2.p.goto(`${srv.url}/proposal?share=${TOKEN}`);
  await c2.p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
  const pm = await c2.p.evaluate(() => ({ total: +document.querySelector('.totals').dataset.total, opt: document.querySelector('#style').selectedOptions[0].textContent }));
  if (pm.total !== money(mix.total)) throw new Error(`提案書 custom mix ${JSON.stringify(pm)}, designer saw ${mix.total}`);
  // the same designer on another computer (no local choices) opens the project in the saved mix
  const o2 = await page({ doc: true, viewport: { width: 960, height: 600 }, store: { 'qa-doc': docJSON, 'qa-firm': firmJSON, [`qa-presented.${A}`]: mixSaved } });
  st = await openView(o2.p, `${srv.url}/?id=${A}&q=lite#plan`);
  if (st.style !== '自訂組合' || st.total !== mix.total) throw new Error(`owner elsewhere sees ${JSON.stringify(st)}`);
  results.push(`    侘寂風 NT$ ${owner.total} = client = 提案書 · custom mix NT$ ${mix.total} = client (en) = 提案書 = owner on another computer`);
  for (const x of [p, c2.p, o2.p]) if (x.errors.length) throw new Error(x.errors[0]);
});

// the save fails (offline): the designer is told the client link still shows the previous choice
if (docJSON) await step('T-011 style save fails → the designer is told (fits 360 px)', async () => {
  const A = 'aaaaaaaa-2222-3333-4444-555555555555';
  const { p } = await page({ doc: true, viewport: { width: 360, height: 780 }, store: { 'qa-doc': docJSON, 'qa-presentfail': '1' } });
  await openView(p, `${srv.url}/?id=${A}&q=lite`);
  await pickStyleCard(p, '侘寂');
  await p.waitForFunction(() => [...document.querySelectorAll('.cloud-miss')].some(n => /客戶/.test(n.textContent)), null, { timeout: 20000 });
  const n = await p.evaluate(() => { const e = [...document.querySelectorAll('.cloud-miss')].find(n => /客戶/.test(n.textContent)), r = e.getBoundingClientRect(); return { text: e.textContent, l: r.left, r: r.right }; });
  if (n.l < 0 || n.r > 360) throw new Error(`message off screen at 360 px: ${JSON.stringify(n)}`);
  results.push(`    ${n.text}`);
  if (p.errors.length) throw new Error(p.errors[0]);
});

// the designer leaves the 3D right after a change (我的專案 at once, or 編輯平面 during the 3D wipe): the change is still
// saved; and an old project's browser-local style (from before T-011) is not written to the project on open (owner decision)
if (docJSON) await step('T-011 leaving the 3D right after a change still saves it; an old browser-local style is not pushed', async () => {
  const A = 'aaaaaaaa-2222-3333-4444-555555555555';
  const presentedOf = (p, id) => p.evaluate(i => { try { return JSON.parse(localStorage.getItem('qa-presented.' + i)); } catch { return null; } }, id);
  const { p } = await page({ doc: true, viewport: { width: 960, height: 600 }, store: { 'qa-doc': docJSON, [`spatial.style.p.${A}`]: 'wabi', [`spatial.finishes.p.${A}`]: JSON.stringify({ floor: 'oak' }) } });
  let st = await openView(p, `${srv.url}/?id=${A}&q=lite#plan`);
  await p.waitForTimeout(1500);
  const calls = await p.evaluate(() => window.__qaPresentedCalls);
  if (st.style !== '原始提案' || calls) throw new Error(`old project with a browser-local 侘寂風: opened ${st.style}, ${calls} save(s)`);
  // pick 侘寂風 and leave for 我的專案 at once
  await pickStyleCard(p, '侘寂');
  await p.evaluate(() => document.querySelector('#acct-link').click());
  await p.waitForURL(u => u.pathname === '/projects', { timeout: 20000 });
  let pr = await presentedOf(p, A);
  if (!pr || pr.style !== 'wabi') throw new Error(`left for 我的專案 right after 侘寂風: project has ${JSON.stringify(pr && pr.style)}`);
  // explore: 原始提案 starts the 3D wipe; 編輯平面 is clicked before it ends
  st = await openView(p, `${srv.url}/?id=${A}&q=lite#explore`);
  if (st.style !== '侘寂風') throw new Error(`reopened on ${st.style}`);
  await p.evaluate(() => { [...document.querySelectorAll('#styles .style-card')].find(c => /原始提案/.test(c.querySelector('.sc-name').textContent)).querySelector('.sc-main').click(); document.querySelector('#edit-link').click(); });
  await p.waitForURL(u => u.pathname.startsWith('/editor'), { timeout: 60000 });
  pr = await presentedOf(p, A);
  if (!pr || pr.style !== 'original') throw new Error(`left for 編輯平面 during the wipe: project has ${JSON.stringify(pr && pr.style)}`);
  if (p.errors.length) throw new Error(p.errors[0]);
});

// ---------- T-010: share from the 3D viewer + QR code ----------
async function qrText(p, sel) {
  const { PNG } = createRequire(import.meta.url)('pngjs'), jsQR = createRequire(import.meta.url)('jsqr');
  const png = PNG.sync.read(await p.locator(sel).screenshot());
  const r = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return r ? r.data : null;
}
// the top bar on a phone: every visible item on screen and none overlapping (brand, tabs, actions)
const barFits = p => p.evaluate(() => {
  const els = [...document.querySelectorAll('.bar .brand, .bar .tabs, .bar .actions > *')].filter(e => !e.hidden && getComputedStyle(e).display !== 'none');
  const r = els.map(e => { const q = e.getBoundingClientRect(); return { id: e.id || e.className.split(' ')[0], l: Math.round(q.left), r: Math.round(q.right) }; });
  const bad = r.filter((x, i) => x.l < 0 || x.r > innerWidth || (i && x.l < r[i - 1].r - 1));
  return bad.length ? `bar does not fit ${innerWidth} px: ${r.map(x => `${x.id} ${x.l}-${x.r}`).join(', ')}` : '';
});
if (docJSON) await step('T-010 share from the 3D: 分享 → link + QR (decoded) + 複製 + LINE + 停止分享; reuses the token; 360 px; English; not on the client link', async () => {
  const A = 'aaaaaaaa-2222-3333-4444-555555555555', link = `${srv.url}/?share=${TOKEN}`;
  const { p, ctx } = await page({ doc: true, viewport: { width: 1280, height: 800 }, store: { 'qa-doc': docJSON } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.url });
  await openView(p, `${srv.url}/?id=${A}&q=lite`);
  if (!(await p.isVisible('#share-open'))) throw new Error('no 分享 button for the owner');
  await p.evaluate(() => document.querySelector('#share-open').click());
  await p.waitForSelector('#share:not([hidden]) .sh-qr svg', { timeout: 15000 });
  const s1 = await p.evaluate(() => ({ url: document.querySelector('#share .sh-url').value, line: document.querySelector('#share .sh-line').href, calls: window.__qaShareCalls.slice(), h: document.querySelector('#share .sh-h').textContent }));
  if (s1.url !== link) throw new Error(`link ${s1.url}`);
  if (JSON.stringify(s1.calls) !== '[true]') throw new Error(`setShare calls ${JSON.stringify(s1.calls)}`);
  if (!s1.line.startsWith('https://line.me/R/share?text=') || !decodeURIComponent(s1.line.split('text=')[1]).includes(link)) throw new Error(`LINE link ${s1.line}`);
  const q1 = await qrText(p, '#share .sh-qr');
  if (q1 !== link) throw new Error(`QR decodes to ${q1}`);
  if (!(await p.evaluate(() => document.activeElement === document.querySelector('#share .sh-copy')))) throw new Error('focus did not move into the share panel');
  await p.evaluate(() => document.querySelector('#share .sh-copy').click());
  await p.waitForFunction(() => /已複製/.test(document.querySelector('#share .sh-status').textContent), null, { timeout: 5000 });
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  if (clip !== link) throw new Error(`clipboard ${clip}`);
  await p.screenshot({ path: join(OUT, 'e2e-12-share-desktop.png') });
  // 停止分享 → link gone; 重新開啟 makes a new one
  await p.evaluate(() => document.querySelector('#share .sh-stop').click());
  await p.waitForFunction(() => document.querySelector('#share .sh-on').hidden && !document.querySelector('#share .sh-off').hidden, null, { timeout: 5000 });
  const off = await p.evaluate(() => ({ calls: window.__qaShareCalls.slice(), text: document.querySelector('#share .sh-off').textContent }));
  if (JSON.stringify(off.calls) !== '[true,false]' || !/已停止分享/.test(off.text)) throw new Error(`stop: ${JSON.stringify(off)}`);
  await p.evaluate(() => document.querySelector('#share .sh-again').click());
  await p.waitForFunction(() => !document.querySelector('#share .sh-on').hidden, null, { timeout: 5000 });
  // reopened later: the project already has a token → shown at once, no new token
  await openView(p, `${srv.url}/?id=${A}&q=lite`);
  await p.setViewportSize({ width: 360, height: 780 }); await p.waitForTimeout(300);
  const btn = await p.evaluate(() => { const r = document.querySelector('#share-open').getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, vis: getComputedStyle(document.querySelector('#share-open')).display !== 'none' }; });
  if (!btn.vis || btn.l < 0 || btn.r > 360 || btn.w < 32) throw new Error(`分享 button at 360 px: ${JSON.stringify(btn)}`);
  { const e = await barFits(p); if (e) throw new Error(`owner: ${e}`); }
  // 提案書, 我的專案 and the language are in the ⋯ menu on a phone
  await p.evaluate(() => document.querySelector('#more-open').click());
  const menu = await p.evaluate(() => { const m = document.querySelector('#more'), r = m.getBoundingClientRect(); return { open: !m.hidden, doc: !!m.querySelector('#doc-link[href*="/proposal"]'), acct: !!m.querySelector('#acct-link'), lang: !!m.querySelector('.lang-switch a[lang="en"]'), l: r.left, r: r.right }; });
  if (!menu.open || !menu.doc || !menu.acct || !menu.lang || menu.l < 0 || menu.r > 360) throw new Error(`⋯ menu at 360 px: ${JSON.stringify(menu)}`);
  if (!(await p.evaluate(() => document.querySelector('#more').contains(document.activeElement)))) throw new Error('focus did not move into the ⋯ menu');
  await p.evaluate(() => document.querySelector('#more-open').click());
  await p.evaluate(() => document.querySelector('#share-open').click());
  await p.waitForSelector('#share:not([hidden]) .sh-qr svg', { timeout: 15000 });
  const s2 = await p.evaluate(() => { const r = document.querySelector('#share').getBoundingClientRect(), q = document.querySelector('#share .sh-qr').getBoundingClientRect(); return { calls: window.__qaShareCalls.slice(), l: r.left, r: r.right, b: r.bottom, h: innerHeight, sw: document.documentElement.scrollWidth, qr: q.width }; });
  if (s2.calls.length) throw new Error(`token not reused: setShare ${JSON.stringify(s2.calls)}`);
  if (s2.l < 0 || s2.r > 360 || s2.sw > 360 || s2.b > s2.h) throw new Error(`share panel at 360 px: ${JSON.stringify(s2)}`);
  if (s2.qr < 150) throw new Error(`QR only ${s2.qr} px on a phone`);
  if ((await qrText(p, '#share .sh-qr')) !== link) throw new Error('phone QR does not decode to the link');
  await p.screenshot({ path: join(OUT, 'e2e-12-share-phone.png') });
  // English
  await openView(p, `${srv.url}/?id=${A}&q=lite&lang=en`);
  await p.evaluate(() => document.querySelector('#share-open').click());
  await p.waitForSelector('#share:not([hidden]) .sh-qr svg', { timeout: 15000 });
  { const e = await barFits(p); if (e) throw new Error(`owner (English): ${e}`); }
  const en = await p.evaluate(() => ({ h: document.querySelector('#share .sh-h').textContent, copy: document.querySelector('#share .sh-copy').textContent, stop: document.querySelector('#share .sh-stop').textContent, title: document.querySelector('#share-open').title }));
  if (/[一-鿿]/.test(JSON.stringify(en))) throw new Error(`English share panel: ${JSON.stringify(en)}`);
  if (p.errors.length) throw new Error(p.errors[0]);
  // the client's read-only view has no 分享 button
  const c = await page({ doc: true, share: true, viewport: { width: 360, height: 780 }, store: { 'qa-doc': docJSON } });
  await openView(c.p, `${link}&q=lite`);
  if (await c.p.evaluate(() => { const b = document.querySelector('#share-open'); return !!b && !b.hidden && getComputedStyle(b).display !== 'none'; })) throw new Error('分享 button on the client link');
  { const e = await barFits(c.p); if (e) throw new Error(`client: ${e}`); }
  if (c.p.errors.length) throw new Error(c.p.errors[0]);
});

// ---------- T-007 follow-ups ----------
// N9: signed in, the save fails → 在 3D 中查看 opens the local preview and says so (no AI 效果圖 / 提案書 there)
if (docJSON) await step('N9 editor 在 3D 中查看 when the save fails → local preview with a message', async () => {
  const { p } = await page({ doc: true, viewport: { width: 360, height: 780 }, store: { 'qa-doc': docJSON, 'spatial.editor.doc': docJSON, 'qa-savefail': '1' } });
  await p.goto(`${srv.url}/editor`);
  await p.waitForFunction(() => window.__editor && window.__editor.doc.levels[0].rooms.length > 0, null, { timeout: 30000 });
  await p.evaluate(() => document.querySelector('#btn-3d').click());
  await p.waitForURL(/[?&]p=custom/, { timeout: 30000 });
  await p.waitForFunction(() => [...document.querySelectorAll('.cloud-miss')].some(n => /尚未儲存到帳號/.test(n.textContent)), null, { timeout: 90000 });
  const n = await p.evaluate(() => { const e = [...document.querySelectorAll('.cloud-miss')].find(n => /尚未儲存/.test(n.textContent)), r = e.getBoundingClientRect(); return { text: e.textContent, l: r.left, r: r.right, url: location.search }; });
  if (n.l < 0 || n.r > 360) throw new Error(`message off screen: ${JSON.stringify(n)}`);
  if (/unsaved/.test(n.url)) throw new Error(`flag left in the address (a reload would repeat it): ${n.url}`);
  results.push(`    ${n.text}`);
  if (p.errors.length) throw new Error(p.errors[0]);
});
// N10: the old un-keyed spatial.finishes (written by main for every plan) no longer turns the demo apartment into 自訂組合
await step('N10 demo apartment ignores the old shared spatial.finishes → 原始提案', async () => {
  const { p } = await page({ viewport: { width: 960, height: 600 }, store: { 'spatial.finishes': JSON.stringify({ floor: 'oak', paint: 'sage' }) } });
  const st = await openView(p, `${srv.url}/?p=apartment&q=lite`);
  const left = await p.evaluate(() => localStorage.getItem('spatial.finishes'));
  if (st.style !== '原始提案') throw new Error(`demo apartment opened as ${st.style}`);
  if (left != null) throw new Error('old spatial.finishes not removed');
  if (p.errors.length) throw new Error(p.errors[0]);
});
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
