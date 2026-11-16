// Demo rehearsal (T-007): the whole client-demo journey on any plan, timed step by step, with the cloud and AI stubbed
// (no account, no AI cost). Use it the day before a demo on the client's own plans:
//   node qa/rehearse.mjs                       # the three rehearsal plans (591-A3, d00 apartment DXF, AC1032 DWG)
//   node qa/rehearse.mjs <fixture-id|file> …   # any fixture id from fixtures.json, or a path to a picture/PDF/DXF/DWG
// Steps: 我的專案 upload → progress screen → 3D (Explore) → style switch + quote → ✦ 一鍵產生提案圖 → client share link
// on a phone → 提案書. AI answers are replayed from qa/recordings when there is one (else a generic stub), each after
// VISION_MS (default 300 ms); each render answers after RENDER_MS (default 1500 ms). Real AI adds about 20–40 s for
// room naming and 30–40 s for the renders — the report adds those on top of what it measured here.
// Headless Chrome draws with software GL, so the viewer starts at its lightest quality level (QA_QUALITY=0 for full);
// 3D frame times here say nothing about a laptop GPU. Screenshots go to qa/reports/rehearsal/ (git-ignored: they can show third-party or client plans).
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { QA } from './lib/node-env.mjs';
import { serve } from './lib/serve.mjs';
import { playwright } from './lib/browser.mjs';
import { loadFixtures, recordingPath } from './lib/fixtures.mjs';

const OUT = join(QA, 'reports', 'rehearsal'); mkdirSync(OUT, { recursive: true });
const VISION_MS = +process.env.VISION_MS || 300, RENDER_MS = +process.env.RENDER_MS || 1500;
const DEFAULT = ['591-A3', 'dxf-d00-own-apartment', 'dwg-acadsharp-sample-ac1032'];
const all = loadFixtures();
const plans = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT).map(a => {
  const f = all.find(x => x.id === a);
  if (f) return f.present ? f : (console.log(`skip ${a}: fixture file missing (set QA_FIXTURES)`), null);
  // a file path: as given, or relative to where `npm --prefix qa run rehearse` was started
  const file = [a, resolve(process.env.INIT_CWD || '.', a)].find(x => existsSync(x));
  if (file) return { id: basename(file), path: file, kind: /\.dwg$/i.test(file) ? 'dwg' : /\.dxf$/i.test(file) ? 'dxf' : 'image' };
  console.log(`skip ${a}: not a fixture id or a file`); return null;
}).filter(Boolean);

// cloud stub: like qa/e2e.mjs, plus saveProject keeps the imported plan so the 3D page opens on it
const cloudStub = share => `
  const U = { id: 'qa-user', email: 'qa@example.com', user_metadata: { full_name: 'QA Designer', given_name: 'QA' } };
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  let renders = ls('qa-renders', []);
  export const client = async () => ({});
  export const currentUser = async () => ${share ? 'null' : 'U'}; export const accessToken = async () => ${share ? 'null' : "'qa-token'"};
  export const onAuth = async () => {}; export const signIn = async () => {}; export const signOut = async () => {};
  export const listProjects = async () => ls('qa-projects', []);
  export const saveProject = async ({ doc }) => { localStorage.setItem('qa-doc', JSON.stringify(doc)); return '11111111-2222-3333-4444-555555555555'; };
  export const loadProject = async () => ({ id: 'p', name: '演練專案', client: '王小姐', share_token: null, doc: JSON.parse(localStorage.getItem('qa-doc')), renders });
  export const sharedProject = async () => ({ name: '演練專案', client: '王小姐', updated_at: '2026-11-16T08:00:00Z', doc: JSON.parse(localStorage.getItem('qa-doc')), renders, firm: ls('qa-firm', null) });
  export const renameProject = async () => {}; export const deleteProject = async () => {}; export const setShare = async () => 'tok';
  export const setClient = async () => {};
  export const putImage = async (p, b) => URL.createObjectURL(b); export const removeImages = async () => {};
  export const getRenders = async () => renders.slice(); export const setRenders = async (id, l) => { renders = l; };
  export const publicUrl = p => p; export const shareUrl = t => location.origin + '/?share=' + t;
  export const proposalUrl = ({ token, id }) => location.origin + '/proposal?' + (token ? 'share=' + token : 'id=' + id);
  export const FIRM_FIELDS = ['name', 'logo', 'phone', 'line_id', 'email', 'address', 'tax_id', 'color'];
  export const getFirm = async () => ls('qa-firm', null);
  export const saveFirm = async f => f; export const putLogo = async () => ''; export const removeLogo = async () => {};`;
const FIRM = JSON.stringify({ name: '木與石室內設計', phone: '02-2345-6789', line_id: '@woodstone', email: 'hello@example.com', address: '台北市中山區松江路 1 號', tax_id: '22099131', color: '#2f5d50' });
const RENDER_IMG = ['living', 'dining', 'master'];

const srv = await serve();
const { chromium } = playwright();
const browser = await chromium.launch();
async function page(rec, { share = false, viewport = { width: +process.env.QA_W || 1024, height: +process.env.QA_H || 640 }, store = {} } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript(st => { for (const [k, v] of Object.entries(st)) if (localStorage.getItem(k) == null) localStorage.setItem(k, v); }, { 'qa-firm': FIRM, 'sl-q': process.env.QA_QUALITY || '3', ...store });
  const p = await ctx.newPage(); p.errors = []; p.warns = [];
  p.on('pageerror', e => p.errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') p.warns.push(m.text().slice(0, 160)); });
  await ctx.route('**/src/cloud.js', r => r.fulfill({ contentType: 'text/javascript', body: cloudStub(share) }));
  let pass = 0;
  await ctx.route('**/api/vision', async r => {
    const req = JSON.parse(r.request().postData());
    let body;
    if (rec) { const ps = req.focus ? rec.passes[2] : rec.passes[Math.min(pass++, rec.passes.length - 1)]; body = ps || { rooms: [], items: [] }; }
    else body = { rooms: Array.from({ length: req.count }, (_, i) => ({ n: i + 1, type: ['客廳', '餐廳', '主臥'][i] || '臥室', name: ['客廳', '餐廳', '主臥'][i] || '臥室', nameEn: ['Living room', 'Dining room', 'Master bedroom'][i] || 'Bedroom', label: '', stairs: false })), items: [], scale: null };
    await new Promise(x => setTimeout(x, VISION_MS));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  let nr = 0;
  await ctx.route('**/api/render', async r => {
    const req = JSON.parse(r.request().postData()), i = nr++ % 3, id = `qa${Date.now().toString(36)}${i}`;
    p.renderReqs = (p.renderReqs || 0) + 1; p.renderKB = Math.max(p.renderKB || 0, Math.round(req.image.length * 0.75 / 1024));
    await new Promise(x => setTimeout(x, RENDER_MS));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id, before: `/assets/ai/render/${RENDER_IMG[i]}.thumb.jpg`, after: `/assets/ai/render/${RENDER_IMG[i]}.jpg`, path: `qa-user/p/${id}.png`, model: 'stub' }) });
  });
  return { p, ctx };
}
const secs = t0 => +((Date.now() - t0) / 1000).toFixed(1);
const report = [];

for (const fx of plans) {
  const rec = existsSync(recordingPath(fx.id)) ? JSON.parse(readFileSync(recordingPath(fx.id), 'utf8')) : null;
  const R = { id: fx.id, kind: fx.kind, ai: fx.kind === 'image' ? (rec ? 'recorded' : 'generic stub') : 'none (CAD)', t: {}, notes: [], errors: [] };
  report.push(R);
  const shot = async (p, name) => p.screenshot({ path: join(OUT, `${fx.id}-${name}.jpg`), type: 'jpeg', quality: 70 }).catch(() => {});
  try {
    // 1. 我的專案 → pick the plan → editor import with the progress screen
    const { p, ctx } = await page(rec);
    await p.goto(`${srv.url}/projects`);
    await p.waitForSelector('#list:not([hidden])', { timeout: 15000 });
    let t0 = Date.now();
    await p.setInputFiles('#pick', fx.path);
    await p.waitForURL(/\/editor\?new=1/, { timeout: 15000 });
    await p.waitForSelector('#flow:not([hidden])', { timeout: 20000 });
    R.t.handoff = secs(t0);
    await p.waitForSelector('#flow.done', { timeout: 180000 });
    R.t.import = secs(t0);
    const f = await p.evaluate(() => ({
      h: document.querySelector('#flow-h').textContent,
      steps: [...document.querySelectorAll('#flow li')].filter(l => !l.hidden).map(l => `${l.querySelector('span').textContent}: ${l.className}${l.querySelector('small').textContent ? ' (' + l.querySelector('small').textContent + ')' : ''}`),
      sum: document.querySelector('#flow .sum').textContent.trim(),
      go: !document.querySelector('#flow .acts .go').hidden,
      rooms: window.__editor.doc.levels.flatMap(L => L.rooms.map(r => r.name || '')),
      area: window.__editor.doc.levels.reduce((s, L) => s + L.rooms.reduce((a, r) => { let A = 0; const P = r.polygon; for (let i = 0; i < P.length; i++) { const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % P.length]; A += x1 * z2 - x2 * z1; } return a + Math.abs(A) / 2; }, 0), 0),
    }));
    Object.assign(R, { flow: f.steps, summary: f.sum, rooms: f.rooms, area: Math.round(f.area * 10) / 10 });
    await shot(p, '1-flow');
    if (!f.go) throw new Error(`import did not finish: ${f.h} — ${f.sum}`);
    // 2. 開啟 3D 導覽 → the viewer on the saved project, in Explore
    t0 = Date.now();
    // the progress screen opens the 3D by itself after a 5 s countdown; click if it is still there
    await p.click('#flow .acts .go', { timeout: 2000 }).catch(() => {});
    await p.waitForURL(/\/\?id=/, { timeout: 15000 });
    await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 120000 });
    R.t.open3d = secs(t0);
    await p.waitForTimeout(1500);
    R.frame = await p.evaluate(() => window.__slBench ? window.__slBench(10) : null).catch(() => null);
    await shot(p, '2-explore');
    // 3. style switch: the 3D wipes to the new style and the quote follows
    const before = await p.textContent('#quote-total');
    t0 = Date.now();
    const target = await p.evaluate(() => { const c = [...document.querySelectorAll('#styles .style-card')].find(c => c.dataset.on !== 'true' && /侘寂|Wabi/.test(c.textContent)) || [...document.querySelectorAll('#styles .style-card')].find(c => c.dataset.on !== 'true'); c.querySelector('.sc-main').click(); return c.querySelector('.sc-name').firstChild.textContent; });
    await p.waitForFunction(b => document.querySelector('#quote-total').textContent !== b && document.querySelector('#style-now').textContent.length > 0, before, { timeout: 60000 });
    await p.waitForTimeout(600);
    R.t.style = secs(t0);
    R.quote = { before, after: await p.textContent('#quote-total'), style: target };
    // 4. ✦ 一鍵產生提案圖 (renders stubbed): the main rooms are captured from photographer corners and rendered
    t0 = Date.now();
    // clicks go through the DOM: with software GL a frame can take seconds and Playwright's stability wait times out
    await p.evaluate(() => document.querySelector('#ai-open').click());
    await p.waitForSelector('#ai:not([hidden]) .ai-set:not([hidden])', { timeout: 30000 });
    await p.evaluate(() => document.querySelector('#ai .ai-set').click());
    await p.waitForFunction(() => !document.querySelector('#ai').classList.contains('generating'), null, { timeout: 180000 });
    R.t.renders = secs(t0);
    const ai = await p.evaluate(() => ({ thumbs: [...document.querySelectorAll('#ai .ai-thumbs button span')].map(s => s.textContent), status: document.querySelector('#ai .ai-status').textContent, room: document.querySelector('#ai .ai-room').textContent }));
    R.renders = { count: ai.thumbs.length, rooms: ai.thumbs, status: ai.status, requests: p.renderReqs || 0, frameKB: p.renderKB || 0 };
    R.t.capture = +(R.t.renders - RENDER_MS / 1000).toFixed(1);
    await shot(p, '3-renders');
    R.errors.push(...p.errors);
    const docJSON = await p.evaluate(() => localStorage.getItem('qa-doc'));
    await ctx.close();
    const RENDERS = JSON.stringify(R.renders.rooms.map((n, i) => ({ id: `r${i}`, room: n.split(' · ')[0], style: 'original', after: `/assets/ai/render/${RENDER_IMG[i % 3]}.jpg`, thumb: `/assets/ai/render/${RENDER_IMG[i % 3]}.thumb.jpg` })));
    // 5. the client's phone: share link (read-only, firm-branded)
    {
      const { p, ctx } = await page(null, { share: true, viewport: { width: 390, height: 844 }, store: { 'qa-doc': docJSON, 'qa-renders': RENDERS } });
      t0 = Date.now();
      await p.goto(`${srv.url}/?share=qa-share-token-0123456789`);
      await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 120000 });
      R.t.share = secs(t0);
      const st = await p.evaluate(() => ({ shared: document.body.classList.contains('shared-view'), brand: (document.querySelector('.bar .brand') || {}).textContent || '', wide: document.documentElement.scrollWidth, edit: !!document.querySelector('#edit-link:not([hidden])') && getComputedStyle(document.querySelector('#edit-link')).display !== 'none' }));
      if (!st.shared || st.edit) R.errors.push(`share link not read-only: ${JSON.stringify(st)}`);
      if (st.wide > 390) R.notes.push(`share page ${st.wide}px wide on a 390px phone`);
      R.shareBrand = st.brand.trim();
      await shot(p, '4-share-phone');
      // 6. 提案書 from the share link
      t0 = Date.now();
      await p.goto(`${srv.url}/proposal?share=qa-share-token-0123456789`);
      await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 60000 });
      await p.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 30000 }).catch(() => {});
      R.t.proposal = secs(t0);
      R.proposal = await p.evaluate(() => { const t = document.querySelector('.totals'); return { total: t ? +t.dataset.total : null, grand: t ? +t.dataset.grand : null, rooms: document.querySelectorAll('table.rooms tbody tr').length, wide: document.documentElement.scrollWidth }; });
      await shot(p, '5-proposal-phone');
      R.errors.push(...p.errors);
      await ctx.close();
    }
  } catch (e) { R.errors.push(String(e.message || e).split('\n')[0]); }
  // what the live site adds: AI room naming for pictures (≈20–40 s, the progress screen's own estimate) and the
  // renders (≈30–40 s for the set, in parallel) in place of the stubs' VISION_MS / RENDER_MS
  const vis = fx.kind === 'image' ? 30 : 0;
  // (capturing a view takes well under a second on a laptop GPU, so the live estimate counts 1 s per view and 1.5 s
  // for the style wipe instead of the software-GL times measured here)
  R.uploadToFirstRender = R.t.renders != null ? { local: +(R.t.import + R.t.open3d + R.t.style + R.t.renders).toFixed(1), live: +(R.t.import + vis + R.t.open3d + 1.5 + R.renders.requests + 35).toFixed(1) } : null;
  console.log(`\n■ ${fx.id} (${fx.kind}, AI ${R.ai})`);
  console.log(`  import ${R.t.import ?? '–'} s · open 3D ${R.t.open3d ?? '–'} s · style ${R.t.style ?? '–'} s · renders ${R.t.renders ?? '–'} s (capture ${R.t.capture ?? '–'} s) · share ${R.t.share ?? '–'} s · 提案書 ${R.t.proposal ?? '–'} s`);
  if (R.summary) console.log(`  ${R.summary.slice(0, 140)}`);
  if (R.rooms) console.log(`  rooms (${R.rooms.length}, ${R.area} m²): ${R.rooms.join('、').slice(0, 140)}`);
  if (R.quote) console.log(`  quote ${R.quote.before} → ${R.quote.after} (${R.quote.style})`);
  if (R.renders) console.log(`  renders: ${R.renders.count} (${R.renders.rooms.join(' / ')}) ${R.renders.status ? '· ' + R.renders.status : ''} · frame ${R.renders.frameKB} KB`);
  if (R.frame) console.log(`  3D frame (headless, software GL): ${R.frame.msPerFrame} ms at ${R.frame.px.join('×')}`);
  if (R.uploadToFirstRender) console.log(`  upload → renders: ${R.uploadToFirstRender.local} s here, ≈ ${R.uploadToFirstRender.live} s live (est.)`);
  for (const n of R.notes) console.log(`  note: ${n}`);
  for (const e of R.errors) console.log(`  ✗ ${e}`);
}
await browser.close(); srv.close();
writeFileSync(join(OUT, 'rehearsal.json'), JSON.stringify({ at: new Date().toISOString(), VISION_MS, RENDER_MS, plans: report }, null, 1));
console.log(`\nreport: ${join(OUT, 'rehearsal.json')} · screenshots: ${OUT}`);
process.exit(report.some(r => r.errors.length) ? 1 : 0);
