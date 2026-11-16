// Browser smoke tests of the main journeys, with the cloud and AI stubbed (no account, no AI cost):
//   1. 我的專案 (signed in): upload panel, empty state
//   2. upload a plan picture → progress screen → summary (AI answers replayed from a recording when there is one)
//   3. the 3D opens in Explore on the result, no page errors
//   4. a client share link: read-only (no edit, no sign-in, no product pitch)
//   5. 公司資料: the designer fills the firm profile (logo, name, contact, 統一編號) → saved
//   6. the share link shows the firm's logo and name (ours only as "Powered by")
//   7. 提案書: renders, rooms (m² / 坪), totals (未稅 / 含稅); fits A4 portrait in print; phone + English
// Writes screenshots to qa/reports/e2e-*.png. Exit 1 on any failure.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { QA } from './lib/node-env.mjs';
import { serve } from './lib/serve.mjs';
import { playwright } from './lib/browser.mjs';
import { loadFixtures, recordingPath } from './lib/fixtures.mjs';

const OUT = join(QA, 'reports');
// a 240 × 80 test logo (brand-colour block on transparent), made here so no picture is committed
function logoPng() {
  const { PNG } = createRequire(import.meta.url)('pngjs');
  const png = new PNG({ width: 240, height: 80 });
  for (let y = 0; y < 80; y++) for (let x = 0; x < 240; x++) { const i = (y * 240 + x) * 4, on = x < 70 || (y > 30 && y < 50); png.data[i] = 47; png.data[i + 1] = 93; png.data[i + 2] = 80; png.data[i + 3] = on ? 255 : 0; }
  return PNG.sync.write(png);
} mkdirSync(OUT, { recursive: true });
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
  export const removeLogo = async () => {};`;
async function page({ doc = false, share = false, viewport = { width: 1280, height: 800 }, store = {} } = {}) {
  const ctx = await browser.newContext({ viewport });
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
  await p.fill('[name=tax_id]', '22099131');
  if ((await p.textContent('#pv-bar b')) !== '木與石室內設計') throw new Error('preview not updated');
  await p.screenshot({ path: join(OUT, 'e2e-5-firm-phone.png') });
  await p.click('#fm-save');
  await p.waitForFunction(() => !document.querySelector('dialog#firm').open, null, { timeout: 10000 });
  firmJSON = await p.evaluate(() => localStorage.getItem('qa-firm'));
  const f = JSON.parse(firmJSON || 'null');
  if (!f || f.name !== '木與石室內設計' || f.tax_id !== '22099131' || f.color !== '#2f5d50' || !/^data:image\/png/.test(f.logo || '')) throw new Error(`saved ${String(firmJSON).slice(0, 160)}`);
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
  await p.waitForFunction(() => document.querySelector('.bar .brand.firm'), null, { timeout: 10000 }).catch(async () => { throw new Error(`bar not branded: ${await p.evaluate(() => document.querySelector('.bar .brand').outerHTML.slice(0, 160) + ' · ' + document.body.className)}`); });
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
  for (const w of ['小計（未稅）', '營業稅 5%', '合計（含稅）', '王小姐', '22099131', '@woodstone', 'Powered by PrimeStride']) if (!d.text.includes(w)) throw new Error(`missing “${w}”`);
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

await browser.close(); srv.close();
console.log(results.join('\n'));
if (!fx) console.log('(no image fixture available: upload/3D/share steps skipped — sync private fixtures)');
console.log(failed ? `\nE2E: ${failed} failed` : '\nE2E: all passed');
process.exit(failed ? 1 : 0);
