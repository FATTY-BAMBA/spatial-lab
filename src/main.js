import * as THREE from 'three';
import { loadPlan, polygonArea, bbox, toPing, buildQuote, pointInPolygon } from './plan.js';
import { t, t as tr, isEn, unitLabel, localizeData, translateDom, langSwitch, bookUrl } from './i18n.js';
import { INDEX_EN } from './i18n-dict.js';
import { drawLevel, planFrame, worldFromCanvas } from './drawing.js';
import { createWorld } from './scene.js';
import { createStory } from './story.js';
import { createExplore } from './explore.js';
import { setupClickWalk, setupMinimap, setupTime, setupCompare } from './features.js';
import { setupAI } from './ai.js';
import { setupProposal } from './proposal.js';
import { exportGLB, exportOBJ, exportDXF, download } from './export.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const PROJECTS = { apartment: 'data/apartment.json', townhouse: 'data/house.json' };

const $ = s => document.querySelector(s);
function toast(msg, ms = 5000) { const n = document.createElement('div'); n.className = 'cloud-miss'; n.setAttribute('role', 'status'); n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), ms); }
const fmt = n => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function boot() {
  translateDom(INDEX_EN);
  for (const a of document.querySelectorAll('[data-book]')) a.href = bookUrl();
  // count demo-request clicks in Vercel Analytics (custom event), by where on the page they came from
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-book], .pp-book'); if (!a) return;
    const where = a.closest('.bar') ? 'topbar' : a.closest('.hero') ? 'hero' : a.closest('.pp-bar') ? 'proposal' : 'tour-end';
    try { window.va?.('event', { name: 'book_demo', data: { where, lang: isEn ? 'en' : 'zh' } }); } catch { /* analytics off */ }
  });
  document.querySelector('.bar .actions')?.prepend(langSwitch());
  if (isEn) document.title = 'PrimeStride Spatial Lab: from floor plan to a signable proposal';
  const params = new URLSearchParams(location.search);
  let customPlan = null, sharedView = false, cloudName = '', cloudRow = null, Cloud = null;
  if (params.get('p') === 'custom') { try { customPlan = JSON.parse(localStorage.getItem('spatial.custom') || 'null'); } catch {} }
  // saved projects: ?id= (the owner, signed in) or ?share= (anyone with the link, read-only)
  const cloudId = params.get('id'), shareTok = params.get('share');
  if (!customPlan && (cloudId || shareTok)) {
    try {
      const C = Cloud = await import('./cloud.js');
      const row = cloudRow = shareTok ? await C.sharedProject(shareTok) : await C.loadProject(cloudId);
      if (row) {
        const [{ completePlan }, base] = await Promise.all([import('./editor/geometry.js'), loadPlan('data/apartment.json')]);
        customPlan = completePlan(row.doc, base); sharedView = !!shareTok; cloudName = row.name || '';
      }
    } catch (e) { console.warn('cloud plan', e); }
    if (!customPlan) { const note = document.createElement('div'); note.className = 'cloud-miss'; note.textContent = shareTok ? t('這個分享連結已失效或不存在。', 'This share link has expired or does not exist.') : t('找不到這個專案，請先登入。', 'Project not found — please sign in.'); document.body.appendChild(note); setTimeout(() => note.remove(), 6000); }
  }
  const projectKey = customPlan ? 'custom' : PROJECTS[params.get('p')] ? params.get('p') : 'apartment';
  const plan = localizeData(customPlan || (await loadPlan(PROJECTS[projectKey])));
  const editLink = document.getElementById('edit-link');
  if (editLink) editLink.href = cloudId && customPlan ? `/editor?id=${encodeURIComponent(cloudId)}` : `editor.html${projectKey === 'custom' ? '' : `?from=${projectKey}`}`;
  if (sharedView) { document.body.classList.add('shared-view'); if (editLink) editLink.hidden = true; }
  // a saved project (owner or client link): the opening screen is about this house, not our product pitch
  if (customPlan && (cloudId || shareTok)) {
    document.body.classList.add('project-view');
    const h1 = document.querySelector('.hero-copy h1'), lede = document.querySelector('.hero-copy > p'), cue = document.querySelector('.scroll-cue span');
    if (h1) h1.textContent = cloudName || t('你的 3D 提案', 'Your 3D proposal');
    if (lede) lede.textContent = sharedView
      ? t('設計師為你準備的 3D 提案。往下捲動，看平面圖長成空間；或直接走進去，換風格、看即時報價。', 'A 3D proposal prepared by your designer. Scroll to watch the plan become a space, or walk straight in, switch styles and see the live quote.')
      : t('客戶打開分享連結時會看到這個畫面。先走一遍，確認房間、家具與報價。', 'This is what your client sees from the share link. Walk it once to check rooms, furniture and the quote.');
    if (cue) cue.textContent = t('往下捲動，看這個家從平面圖長出來', 'Scroll to watch this home rise from the plan');
    const start = document.getElementById('hero-start'); if (start) { start.classList.replace('btn-ghost', 'btn-brass'); }
    if (cloudName) document.title = `${cloudName} · PrimeStride Spatial Lab`;
  }
  // account link: 登入 → 我的專案 once signed in (checked lazily so the page never waits on it)
  const acct = document.getElementById('acct-link');
  if (acct) {
    acct.querySelector('.lbl').textContent = t('登入', 'Sign in');
    const hero = document.querySelector('.hero-try'), or = document.querySelector('.hero-book .or');
    if (hero) hero.textContent = t('登入，上傳你的平面圖 →', 'Sign in and upload your plan →');
    if (or) or.textContent = t('或', 'or');
    // a stored session means signed in; reading it directly avoids loading the auth library on every visit
    try { if (localStorage.getItem('sb-mhzdimntfcovzffidfxf-auth-token')) acct.querySelector('.lbl').textContent = t('我的專案', 'My projects'); } catch {}
  }
  const catalog = localizeData(await loadPlan('data/styles.json').catch(() => ({ extraOptions: {}, styles: [] })));
  for (const g of plan.finishes) for (const o of catalog.extraOptions[g.id] || []) if (!g.options.some(x => x.id === o.id)) g.options.push(o);
  document.body.dataset.project = projectKey;
  try { if (localStorage.getItem('spatial.custom')) document.getElementById('custom-link').hidden = false; } catch {}
  document.querySelectorAll('[data-project-link]').forEach(a => a.setAttribute('aria-current', String(a.dataset.projectLink === projectKey)));
  // quality tier: high (AO + bloom + MSAA), med (no post), lite (no shadows)
  const coarse = matchMedia('(pointer: coarse)').matches;
  const tier = ['high', 'med', 'lite'].includes(params.get('q')) ? params.get('q') : params.has('lite') ? 'lite' : coarse || (navigator.deviceMemory && navigator.deviceMemory <= 4) ? 'med' : 'high';
  await Promise.all([
    document.fonts.load('700 20px "Noto Sans TC"'), document.fonts.load('500 20px "Noto Sans TC"'),
    document.fonts.load('900 40px "Noto Serif TC"'), document.fonts.load('400 20px "Noto Sans TC"'),
  ]).catch(() => {});

  const canvas = $('#gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'high', powerPreference: 'high-performance' });
  const pixelRatio = tier === 'lite' ? 1 : Math.min(devicePixelRatio, tier === 'high' ? 1.75 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = tier !== 'lite';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.06, 3000);
  const world = await createWorld(plan, renderer, { shadows: tier !== 'lite', shadowSize: tier === 'high' ? 2048 : 1024, onExposure: v => { renderer.toneMappingExposure = 0.86 * v; } });
  // the opening hold covers the hero render dissolving into the plan, then the plan card
  if (plan.story && plan.story.nodes && plan.story.nodes[0]) plan.story.nodes[0].hold = Math.max(plan.story.nodes[0].hold || 0, 1.8);
  const story = createStory(plan.story);
  let composer = null, gtao = null;
  if (tier === 'high') {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(world.scene, camera));
    gtao = new GTAOPass(world.scene, camera, 1, 1, undefined,
      { radius: 0.55, distanceExponent: 1.6, thickness: 1.2, scale: 1.25, samples: 16, distanceFallOff: 1, screenSpaceRadius: false },
      { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    gtao.blendIntensity = 1.0;
    composer.addPass(gtao);
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.5, 1.6));
    composer.addPass(new OutputPass());
  }
  const fp = bbox(plan.project.footprint);
  const isInside = p => plan.levels.some(L => p.y > L.elevation && p.y < L.elevation + L.height - 0.2) && p.x > fp.x0 && p.x < fp.x1 && p.z > fp.z0 - 1.5 && p.z < fp.z1 + 1.5;

  // hero + captions from project data
  {
    const pr = plan.project;
    let interior = 0;
    for (const L of plan.levels) for (const r of L.rooms) if (!r.outdoor) interior += polygonArea(r.polygon);
    const fb = bbox(pr.footprint);
    const st = pr.stats || [];
    const zh = l => isEn ? String(l).split(' ').slice(1).join(' ') || String(l) : String(l).split(' ')[0];
    const cells = [
      [t('案名', 'Project'), pr.name],
      st[0] ? [zh(st[0].label), st[0].value] : [t('基地', 'Footprint'), `${(fb.x1 - fb.x0).toFixed(2)} × ${(fb.z1 - fb.z0).toFixed(2)} m`],
      [t('室內面積', 'Interior area'), t(`${interior.toFixed(1)} m²（${toPing(interior).toFixed(1)} 坪）`, `${interior.toFixed(1)} m² (${toPing(interior).toFixed(1)} ping)`)],
      st[1] ? [zh(st[1].label), st[1].value] : [t('基地', 'Footprint'), `${(fb.x1 - fb.x0).toFixed(2)} × ${(fb.z1 - fb.z0).toFixed(2)} m`],
    ];
    $('#titleblock').innerHTML = cells.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    for (const key of ['rise', 'real', 'outro']) {
      const c = story.captions[key];
      if (!c) continue;
      const el = $(`#cap-${key}`);
      el.querySelector('h2').textContent = c[0];
      el.querySelector('p').textContent = c[1];
      el.querySelector('.en').textContent = c[2] || '';
    }
  }
  const explore = createExplore(plan, camera, canvas);

  // hero: open on the AI render of this very plan, then let scrolling dissolve it into the drawing it came from
  const heroEl = $('#hero'), heroVid = $('#hero-video');
  if (projectKey !== 'apartment') { document.body.classList.add('no-hero-media'); heroVid.removeAttribute('src'); heroVid.removeAttribute('poster'); }
  let heroK = -1;
  function updateHero() {
    const k = Math.min(1, Math.max(0, window.scrollY / (innerHeight * 0.55)));
    if (Math.abs(k - heroK) < 0.002) return;
    heroK = k;
    heroEl.style.setProperty('--hk', k.toFixed(3));
    document.body.classList.toggle('hero-gone', k > 0.97);
    if (k > 0.97 && !heroVid.paused) heroVid.pause();
  }

  const roomsById = {};
  for (const L of plan.levels) for (const r of L.rooms) roomsById[r.id] = { ...r, level: L.id, levelName: L.name };

  // ---------------- finishes + quote ----------------
  const chosen = { ...plan.defaultFinishes };
  try { Object.assign(chosen, JSON.parse(localStorage.getItem('spatial.finishes') || '{}')); } catch {}
  for (const [g, o] of Object.entries(chosen)) world.applyFinish(g, o);

  function renderFinishes() {
    const host = $('#finishes');
    host.innerHTML = '';
    for (const g of plan.finishes) {
      const row = document.createElement('fieldset');
      row.className = 'finish';
      row.innerHTML = `<legend><span>${g.name}</span><small>${g.nameEn}</small><button type="button" class="cmp-btn" data-group="${g.id}">${t('A/B 對比', 'A/B compare')}</button></legend>`;
      row.querySelector('.cmp-btn').addEventListener('click', () => openFinishCompare(g.id));
      const opts = document.createElement('div');
      opts.className = 'swatches';
      for (const o of g.options) {
        const id = `f-${g.id}-${o.id}`;
        const b = document.createElement('label');
        b.className = 'swatch';
        b.htmlFor = id;
        b.innerHTML = `<input type="radio" name="f-${g.id}" id="${id}" value="${o.id}" ${chosen[g.id] === o.id ? 'checked' : ''}>
          <i style="--c:${o.color}" class="chip chip-${o.tex || 'flat'}"></i>
          <span class="sw-name">${o.name}</span>
          <span class="sw-price">NT$ ${fmt(o.price)}<em>/${g.unit}</em></span>`;
        b.querySelector('input').addEventListener('change', () => {
          chosen[g.id] = o.id;
          world.applyFinish(g.id, o.id);
          markCustom();
          saveState();
          renderQuote(true);
        });
        opts.appendChild(b);
      }
      row.appendChild(opts);
      host.appendChild(row);
    }
  }

  let lastTotal = null;
  function renderQuote(animate) {
    const { lines, total, q, tax, grand, basis } = buildQuote(plan, chosen);
    const totalEl = $('#quote-total');
    const from = lastTotal ?? total;
    lastTotal = total;
    if (animate && !reduceMotion && from !== total) {
      const t0 = performance.now();
      const tick = now => {
        const k = Math.min(1, (now - t0) / 450);
        totalEl.textContent = fmt(from + (total - from) * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      totalEl.closest('.quote-head').classList.remove('bump'); void totalEl.offsetWidth; totalEl.closest('.quote-head').classList.add('bump');
    } else totalEl.textContent = fmt(total);
    $('#quote-total-mini').textContent = `NT$ ${fmt(total)}`;
    $('#qty-line').textContent = t(`地坪 ${toPing(q.floorArea).toFixed(1)} 坪 · 檯面 ${q.counterLength.toFixed(2)} m · 牆面 ${toPing(q.wallArea).toFixed(1)} 坪`, `Floor ${toPing(q.floorArea).toFixed(1)} ping · Counter ${q.counterLength.toFixed(2)} m · Walls ${toPing(q.wallArea).toFixed(1)} ping`);
    const tb = $('#quote-lines tbody');
    tb.innerHTML = '';
    let group = null;
    for (const l of lines) {
      if (l.group !== group) {
        group = l.group;
        const tr = document.createElement('tr'); tr.className = 'grp';
        tr.innerHTML = `<th colspan="4">${l.finish ? t('材質 Finishes', 'Finishes') : l.group}</th>`;
        tb.appendChild(tr);
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${l.finish ? `<b>${l.group}</b> ` : ''}${l.name}</td>
        <td class="num"${l.waste ? ` title="${t('淨量', 'Net')} ${l.net.toFixed(2)} + ${t('損耗', 'waste')} ${Math.round(l.waste * 100)}%"` : ''}>${l.unit === '件' ? l.qty : l.qty.toFixed(l.unit === 'm' ? 2 : 1)} ${unitLabel(l.unit)}${l.waste ? `<small class="w">${t('含損耗', 'incl. waste')} ${Math.round(l.waste * 100)}%</small>` : ''}${l.status === 'allowance' ? `<small class="w">${t('暫估', 'allowance')}</small>` : ''}</td>
        <td class="num">${fmt(l.unitPrice)}</td><td class="num">${fmt(l.total)}</td>`;
      tb.appendChild(tr);
    }
    for (const [k, v, cls] of [[t('小計（未稅）', 'Subtotal (excl. tax)'), total, ''], [`${t('營業稅', 'Business tax')} ${Math.round(basis.taxRate * 100)}%`, tax, ''], [t('合計（含稅）', 'Total (incl. tax)'), grand, 'sum']]) {
      const tr = document.createElement('tr'); tr.className = 'foot ' + cls;
      tr.innerHTML = `<td colspan="3">${k}</td><td class="num">${fmt(v)}</td>`; tb.appendChild(tr);
    }
    $('#quote-basis').innerHTML = `${t('參考價 · 未稅', 'Reference prices · excl. tax')} · ${basis.labour} · ${t('損耗已計入', 'waste included')} · ${t('價格基準', 'prices as of')} ${basis.priceDate.replace('-', '/')} <button type="button" class="basis-i" aria-expanded="false" title="${t('計價依據', 'Pricing basis')}">ⓘ</button><span class="basis-more" hidden>${basis.priceBook}<br>${basis.notes.join('<br>')}<br>${t('含稅合計', 'Total incl. tax')} NT$ ${fmt(grand)}</span>`;
    $('#quote-basis .basis-i').onclick = e => { const m = $('#quote-basis .basis-more'); m.hidden = !m.hidden; e.currentTarget.setAttribute('aria-expanded', String(!m.hidden)); };
  }
  renderFinishes();
  renderQuote(false);
  $('#quote-toggle').addEventListener('click', e => {
    const open = $('#quote-lines').hidden;
    $('#quote-lines').hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
    e.currentTarget.textContent = open ? t('收合清單', 'Hide line items') : t('查看清單', 'View line items');
  });
  $('#panel-toggle').addEventListener('click', () => {
    const p = $('#panel');
    p.classList.toggle('open');
    $('#panel-toggle').setAttribute('aria-expanded', String(p.classList.contains('open')));
  });

  // ---------------- spots ----------------
  const spots = $('#spots');
  for (const L of plan.levels) {
    const g = document.createElement('div');
    g.className = 'spot-group';
    g.innerHTML = `<span class="lv">${L.id}</span>`;
    for (const r of L.rooms) {
      if (r.circulation && r.id !== 'landing') continue;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'spot'; b.dataset.room = r.id;
      b.textContent = r.name;
      b.addEventListener('click', () => { setView('walk'); explore.goToRoom(r, L.id); });
      g.appendChild(b);
    }
    spots.appendChild(g);
  }

  // ---------------- sprint 2 features ----------------
  const clickWalk = setupClickWalk({ world, camera, explore, canvas, getMode: () => mode, setView: v => setView(v) });
  const minimap = setupMinimap({ plan, explore, camera, getMode: () => mode });
  const tod = setupTime({ world, plan });
  const compare = setupCompare({ renderer });
  function goToFocus(g) {
    const room = roomsById[g.focus] || roomsById.living;
    if (mode !== 'explore') setMode('explore');
    setView('walk');
    if (room) explore.goToRoom(room, room.level, 1.2);
  }
  function syncRadios() {
    for (const [gid, oid] of Object.entries(chosen)) { const el = document.getElementById(`f-${gid}-${oid}`); if (el) el.checked = true; }
  }
  function openFinishCompare(gid) {
    const g = plan.finishes.find(f => f.id === gid);
    const a = chosen[gid];
    let b = (g.options.find(o => o.id !== a) || g.options[0]).id;
    const opt = id => g.options.find(o => o.id === id);
    goToFocus(g);
    compare.open({
      title: t(`${g.name} 對比`, `Compare ${g.name.toLowerCase()}`),
      applyA: () => world.applyFinish(gid, a),
      applyB: () => world.applyFinish(gid, b),
      restore: () => world.applyFinish(gid, chosen[gid]),
      side: w => {
        const o = opt(w === 'a' ? a : b), d = opt(b).price - opt(a).price;
        return w === 'a'
          ? { tag: t('A 目前', 'A Current'), name: o.name, sub: `NT$ ${fmt(o.price)}/${unitLabel(g.unit)}` }
          : { tag: t('B 比較', 'B Compare'), name: o.name, sub: `NT$ ${fmt(o.price)}/${unitLabel(g.unit)} · ${d === 0 ? t('同價', 'same price') : (d > 0 ? '+' : '−') + 'NT$ ' + fmt(Math.abs(d)) + '/' + unitLabel(g.unit)}` };
      },
      chips: g.options.filter(o => o.id !== a).map(o => ({ id: o.id, label: o.name })),
      current: b,
      pick: id => { b = id; },
      adopt: () => { chosen[gid] = b; world.applyFinish(gid, b); syncRadios(); markCustom(); saveState(); renderQuote(true); },
    });
  }

  // ---------------- styles ----------------
  const ORIGINAL = { id: 'original', name: t('原始提案', 'Original'), nameEn: t('Original', ''), tagline: t('本案預設材質', 'This project\'s default finishes'), finishes: { ...plan.defaultFinishes }, palette: plan.defaultPalette || {} };
  const styles = [ORIGINAL, ...catalog.styles];
  let styleId = null; // null = custom mix
  let palette = ORIGINAL.palette;
  try {
    const sid = localStorage.getItem(`spatial.style.${projectKey}`);
    const st = styles.find(x => x.id === sid);
    if (st) { styleId = st.id; palette = st.palette; Object.assign(chosen, st.finishes); }
  } catch {}
  if (styleId === null && !localStorage.getItem('spatial.finishes')) styleId = 'original';
  function applyState(fin, pal) { for (const [gid, oid] of Object.entries(fin)) world.applyFinish(gid, oid); world.applyPalette(pal); }
  applyState(chosen, palette);
  function saveState() {
    try { localStorage.setItem('spatial.finishes', JSON.stringify(chosen)); localStorage.setItem(`spatial.style.${projectKey}`, styleId || ''); } catch {}
  }
  function markCustom() { styleId = null; renderStyles(); }
  const totalFor = fin => buildQuote(plan, { ...chosen, ...fin }).total;
  const chipColor = (gid, oid) => { const o = plan.finishes.find(f => f.id === gid).options.find(x => x.id === oid); return o ? o.tint || o.color : '#ccc'; };
  function selectStyle(id, animate = true) {
    const st = styles.find(x => x.id === id);
    const oldFin = { ...chosen }, oldPal = palette;
    const finish = () => {
      Object.assign(chosen, st.finishes); palette = st.palette; styleId = st.id;
      applyState(chosen, palette); syncRadios(); saveState(); renderQuote(true); renderStyles();
    };
    if (animate && mode !== 'plan') compare.transition(() => applyState(oldFin, oldPal), () => applyState(st.finishes, st.palette), finish);
    else finish();
  }
  function openStyleCompare(bId) {
    let b = bId;
    const cur = { fin: { ...chosen }, pal: palette, name: styleId ? styles.find(x => x.id === styleId).name : t('自訂組合', 'Custom mix') };
    const curTotal = totalFor(cur.fin);
    compare.open({
      title: t('風格 對比', 'Compare styles'),
      applyA: () => applyState(cur.fin, cur.pal),
      applyB: () => { const st = styles.find(x => x.id === b); applyState(st.finishes, st.palette); },
      restore: () => applyState(chosen, palette),
      side: w => {
        if (w === 'a') return { tag: tr('A 目前', 'A Current'), name: cur.name, sub: `${tr('材質合計', 'Finishes total')} NT$ ${fmt(curTotal)}` };
        const st = styles.find(x => x.id === b), t = totalFor(st.finishes), d = t - curTotal;
        return { tag: tr('B 比較', 'B Compare'), name: st.name, sub: `NT$ ${fmt(t)} · ${d === 0 ? tr('同價', 'same price') : (d > 0 ? '+' : '−') + 'NT$ ' + fmt(Math.abs(d))}` };
      },
      chips: styles.filter(x => x.id !== styleId).map(x => ({ id: x.id, label: x.name })),
      current: b,
      pick: id => { b = id; },
      adopt: () => selectStyle(b, false),
    });
  }
  function renderStyles() {
    const host = $('#styles');
    host.innerHTML = '';
    const base = totalFor(chosen);
    for (const st of styles) {
      const t = totalFor(st.finishes), d = t - base;
      const card = document.createElement('div');
      card.className = 'style-card';
      card.dataset.on = String(st.id === styleId);
      const p = st.palette || {}, f = st.finishes;
      const chips = [chipColor('paint', f.paint), chipColor('floor', f.floor), chipColor('cabinet', f.cabinet), (p.models && p.models.GlamVelvetSofa) || '#2c3550', p.accent || '#9a5b3c'];
      card.innerHTML = `<button type="button" class="sc-main" aria-pressed="${st.id === styleId}">
          <span class="sc-chips">${chips.map(c => `<i style="background:${c}"></i>`).join('')}</span>
          <span class="sc-name">${st.name}<small>${st.nameEn}</small></span>
          <span class="sc-tag">${st.tagline || ''}</span>
          <span class="sc-price">NT$ ${fmt(t)}${st.id === styleId ? `<em>${tr('目前', 'Current')}</em>` : d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</em>` : ''}</span>
        </button>
        ${st.id === styleId ? '' : `<button type="button" class="sc-ab" title="${tr('與目前風格分割對比', 'Split-screen compare with the current style')}">A/B</button>`}`;
      card.querySelector('.sc-main').addEventListener('click', () => { if (st.id !== styleId) selectStyle(st.id); });
      const ab = card.querySelector('.sc-ab');
      if (ab) ab.addEventListener('click', () => openStyleCompare(st.id));
      host.appendChild(card);
    }
    $('#style-now').textContent = styleId ? styles.find(x => x.id === styleId).name : t('自訂組合', 'Custom mix');
  }
  renderStyles();
  syncRadios();
  renderQuote(false);
  document.querySelectorAll('.ptabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.ptabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $('#tab-styles').hidden = b.dataset.tab !== 'styles';
    $('#tab-finishes').hidden = b.dataset.tab !== 'finishes';
  }));

  // ---------------- modes ----------------
  let mode = 'story';
  const levelIds = plan.levels.map(L => L.id);
  let cutaway = String(levelIds.length - 1); // index of highest visible level, or 'x' for exploded
  {
    const seg = $('#level-seg');
    seg.innerHTML = '';
    if (levelIds.length > 1) {
      levelIds.forEach((id, i) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.cut = String(i); b.textContent = levelIds.slice(0, i + 1).join('+'); seg.appendChild(b); });
      const x = document.createElement('button'); x.type = 'button'; x.dataset.cut = 'x'; x.textContent = t('分層展開', 'Exploded'); seg.appendChild(x);
    }
    const pl = $('#plan-levels');
    pl.innerHTML = '';
    for (const L of plan.levels) { const b = document.createElement('button'); b.type = 'button'; b.dataset.level = L.id; b.textContent = `${L.id} ${L.name}`; pl.appendChild(b); }
    pl.hidden = levelIds.length < 2;
  }
  let realTarget = 1, realNow = 1;
  const storyScroll = $('#story-scroll');
  storyScroll.style.height = `${story.total * 88 + 100}vh`;

  let lenis = null;
  if (window.Lenis && !reduceMotion && !params.has('nolenis')) {
    lenis = new window.Lenis({ lerp: 0.085, smoothWheel: true });
  }

  // the main living space of a plan: the largest living / dining room on the lowest floor, else the largest room
  function mainRoom() {
    const all = Object.values(roomsById).filter(r => r.spot && !r.outdoor);
    const L0 = plan.levels[0] && plan.levels[0].id, on0 = all.filter(r => r.level === L0), pool = on0.length ? on0 : all;
    const area = r => polygonArea(r.polygon), big = a => a.sort((x, y) => area(y) - area(x))[0];
    return big(pool.filter(r => /客|餐|起居|living|dining|lounge/i.test(`${r.name} ${r.nameEn || ''} ${r.type || ''}`))) || big(pool) || null;
  }
  function setMode(m) {
    if (m === mode) return;
    const prev = mode;
    mode = m;
    document.body.dataset.mode = m;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    explore.active = m === 'explore';
    if (m !== 'explore') { clickWalk.hide(); compare.close(); }
    if (m === 'story') {
      tod.reset();
      lenis?.start();
      requestAnimationFrame(() => window.scrollTo(0, storyY));
    } else {
      if (prev === 'story') storyY = window.scrollY;
      lenis?.stop();
    }
    if (m === 'explore') {
      document.body.classList.remove('hint-done');
      clearTimeout(hintTimer); hintTimer = setTimeout(() => document.body.classList.add('hint-done'), 7000);
      for (const id of levelIds) world.setRise(id, 1);
      applyCutaway();
      realTarget = sketchMode ? 0 : 1;
      if (prev === 'story') {
        const stop = beatNow > 0.5 ? story.stopAt(beatNow) : null; // at the very top: start in the main living space
        const room = stop ? roomsById[stop.room] : roomsById.living || mainRoom() || Object.values(roomsById)[0];
        explore.goToRoom(room, room.level, 0.001);
      }
      setView(explore.mode);
    }
    if (m === 'plan') drawPlanView();
  }
  let storyY = 0;
  let hintTimer = 0;
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#cta-explore').addEventListener('click', () => setMode('explore'));
  $('#hero-start').addEventListener('click', () => { const y = innerHeight * 0.62; if (lenis) lenis.scrollTo(y, { duration: 1.4 }); else window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' }); });

  function setView(v) {
    explore.setMode(v);
    document.querySelectorAll('#view-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    applyCutaway();
  }
  document.querySelectorAll('#view-seg button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  function applyCutaway() {
    const walking = explore.mode === 'walk';
    const top = walking || cutaway === 'x' ? levelIds.length - 1 : +cutaway;
    levelIds.forEach((id, i) => world.setLevelVisible(id, i <= top));
    world.setExplode(!walking && cutaway === 'x' ? 1 : 0);
    document.querySelectorAll('#level-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cut === cutaway)));
    $('#level-seg').hidden = walking || levelIds.length < 2;
  }
  $('#level-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { cutaway = b.dataset.cut; applyCutaway(); } });

  let sketchMode = false;
  $('#sketch-toggle').addEventListener('click', e => {
    sketchMode = !sketchMode;
    realTarget = sketchMode ? 0 : 1;
    e.currentTarget.setAttribute('aria-pressed', String(sketchMode));
  });

  const hold = $('#hold-walk');
  const holdOn = e => { e.preventDefault(); explore.holdWalk = true; hold.classList.add('on'); };
  const holdOff = () => { explore.holdWalk = false; hold.classList.remove('on'); };
  hold.addEventListener('pointerdown', holdOn);
  hold.addEventListener('pointerup', holdOff);
  hold.addEventListener('pointerleave', holdOff);
  hold.addEventListener('pointercancel', holdOff);

  // story stops rail
  const rail = $('#rail');
  for (const n of story.nodes.filter(n => n.room)) {
    const r = roomsById[n.room];
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.stop = n.id;
    b.innerHTML = `<span>${r.level}</span>${r.name}`;
    b.addEventListener('click', () => scrollToBeat((n.arrive + n.depart) / 2));
    rail.appendChild(b);
  }
  function scrollToBeat(beat) {
    const max = document.documentElement.scrollHeight - innerHeight;
    const y = (beat / story.total) * max;
    if (lenis) lenis.scrollTo(y, { duration: 1.6 }); else window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  // ---------------- plan view ----------------
  let planLevel = levelIds[0];
  let planHover = null;
  const planCanvas = $('#plan-canvas');
  let planGeom = null;
  function drawPlanView() {
    const L = plan.levels.find(l => l.id === planLevel);
    const frame = planFrame(plan, 2.2);
    const box = $('#plan-stage').getBoundingClientRect();
    const s = Math.max(12, Math.min(box.width / frame.w, box.height / frame.h)) * Math.min(devicePixelRatio, 2);
    drawLevel(plan, L, { pxPerM: s, frame, paper: true, canvas: planCanvas, highlight: planHover, theme: 'dark' });
    planCanvas.style.width = `${(frame.w * s) / Math.min(devicePixelRatio, 2)}px`;
    planGeom = { frame, s, L };
    document.querySelectorAll('#plan-levels button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === planLevel)));
    renderSchedule(L);
  }
  function renderSchedule(L) {
    const tb = $('#schedule tbody');
    tb.innerHTML = '';
    let sum = 0, out = 0;
    for (const r of L.rooms) {
      const a = polygonArea(r.polygon); if (r.outdoor) out += a; else sum += a;
      const b = bbox(r.polygon);
      const tr = document.createElement('tr');
      tr.dataset.room = r.id;
      if (r.outdoor) tr.className = 'out';
      tr.innerHTML = `<td>${r.name}<small>${r.nameEn}${r.outdoor ? t('，戶外', 'Outdoor') : ''}</small></td><td class="num">${(b.x1 - b.x0).toFixed(2)}×${(b.z1 - b.z0).toFixed(2)}</td><td class="num">${a.toFixed(1)}</td><td class="num">${toPing(a).toFixed(1)}</td>`;
      tr.addEventListener('mouseenter', () => { planHover = r.id; drawPlanView(); });
      tr.addEventListener('mouseleave', () => { planHover = null; drawPlanView(); });
      tr.addEventListener('click', () => { setMode('explore'); setView('walk'); explore.goToRoom(r, L.id); });
      tb.appendChild(tr);
    }
    $('#schedule tfoot').innerHTML = `<tr><td>${L.id} ${t('室內合計', 'interior total')}</td><td></td><td class="num">${sum.toFixed(1)}</td><td class="num">${toPing(sum).toFixed(1)}</td></tr>`
      + (out ? `<tr class="sub"><td>${t('含陽台', 'Incl. balconies')}</td><td></td><td class="num">${(sum + out).toFixed(1)}</td><td class="num">${toPing(sum + out).toFixed(1)}</td></tr>` : '');
  }
  $('#plan-levels').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { planLevel = b.dataset.level; drawPlanView(); } });
  function roomAtPlan(e) {
    if (!planGeom) return null;
    const rect = planCanvas.getBoundingClientRect();
    const k = planCanvas.width / rect.width;
    const [x, z] = worldFromCanvas(planGeom.frame, planGeom.s, (e.clientX - rect.left) * k, (e.clientY - rect.top) * k);
    return planGeom.L.rooms.find(r => pointInPolygon([x, z], r.polygon)) || null;
  }
  planCanvas.addEventListener('pointermove', e => {
    const r = roomAtPlan(e);
    const id = r ? r.id : null;
    planCanvas.style.cursor = r ? 'pointer' : 'default';
    if (id !== planHover) { planHover = id; drawPlanView(); }
  });
  planCanvas.addEventListener('click', e => {
    const r = roomAtPlan(e);
    if (r) { setMode('explore'); setView('walk'); explore.goToRoom(r, planGeom.L.id); }
  });

  // ---------------- resize + loop ----------------
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    if (composer) { composer.setPixelRatio(pixelRatio); composer.setSize(w, h); }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    story.layout(w / h, world.frame);
    if (mode === 'plan') drawPlanView();
  }
  addEventListener('resize', resize);
  resize();

  let beatNow = 0;
  let last = performance.now();
  const plate = $('#plate');
  let plateRoom = null;
  function showPlate(room, levelId) {
    const key = room ? room.id : null;
    if (key === plateRoom) return;
    plateRoom = key;
    if (!room) { plate.classList.remove('on'); return; }
    const a = polygonArea(room.polygon), b = bbox(room.polygon);
    plate.querySelector('.p-lv').textContent = levelId;
    plate.querySelector('.p-name').textContent = room.name;
    plate.querySelector('.p-en').textContent = room.nameEn;
    plate.querySelector('.p-area').textContent = `${a.toFixed(1)} m² · ${toPing(a).toFixed(1)} ${t('坪', 'ping')}`;
    plate.querySelector('.p-dim').textContent = `${(b.x1 - b.x0).toFixed(2)} × ${(b.z1 - b.z0).toFixed(2)} m`;
    plate.classList.add('on');
  }

  let photoCam = null, baseFov = camera.fov;
  function photo(shot) {
    photoCam = shot || null;
    if (!shot && camera.fov !== baseFov) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
  }
  function frame(now) {
    const rawDt = Math.min(0.25, (now - last) / 1000);
    const dt = Math.min(0.05, rawDt);
    last = now;
    lenis?.raf(now);
    if (mode === 'story') {
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      beatNow = Math.min(1, Math.max(0, window.scrollY / max)) * story.total;
      const ev = story.eventsAt(beatNow);
      levelIds.forEach((id, i) => {
        const t = ev.rise[id] ?? 1;
        world.setRise(id, t);
        world.setLevelVisible(id, i === 0 || t > 0.001);
      });
      world.setReal(ev.real);
      world.setExplode(ev.explode);
      story.cameraAt(beatNow, camera);
      document.body.dataset.phase = ev.phase;
      updateHero();
      const stop = story.stopAt(beatNow);
      showPlate(stop ? roomsById[stop.room] : null, stop ? stop.level : '');
      rail.querySelectorAll('button').forEach(b => b.classList.toggle('on', !!stop && b.dataset.stop === stop.id));
      $('#progress').style.transform = `scaleY(${beatNow / story.total})`;
    } else if (mode === 'explore') {
      realNow += (realTarget - realNow) * Math.min(1, dt * 4);
      if (Math.abs(realTarget - realNow) < 0.002) realNow = realTarget;
      world.setReal(realNow);
      explore.step(rawDt);
      clickWalk.update();
      if (explore.mode === 'walk') {
        const r = explore.currentRoom();
        showPlate(r, explore.currentLevel());
        spots.querySelectorAll('.spot').forEach(b => b.classList.toggle('on', !!r && b.dataset.room === r.id));
      } else showPlate(null);
    }
    if (photoCam) { // fixed photographer camera (AI render shots)
      camera.position.set(...photoCam.pos); camera.lookAt(...photoCam.look);
      if (camera.fov !== (photoCam.fov || 60)) { camera.fov = photoCam.fov || 60; camera.updateProjectionMatrix(); }
    }
    world.setInterior(isInside(camera.position));
    minimap.update();
    // skip the 3D frame while a full-screen room (AI viewer, proposal, film) covers it
    const covered = document.body.classList.contains('ai-on') || document.body.classList.contains('pp-on') || !$('#film').hidden;
    if (mode !== 'plan' && !covered) {
      const draw = () => (composer ? composer.render() : renderer.render(world.scene, camera));
      if (!compare.render(draw)) draw();
    }
    requestAnimationFrame(frame);
  }
  document.body.dataset.mode = 'story';
  // deep link: #explore or #plan
  const hash = location.hash.replace('#', '');
  if (hash === 'explore' || hash === 'plan') setMode(hash);
  addEventListener('hashchange', () => { const h = location.hash.replace('#', ''); if (['story', 'explore', 'plan'].includes(h)) setMode(h); });
  requestAnimationFrame(frame);
  document.body.classList.add('ready');
  if (!document.body.classList.contains('no-hero-media') && mode === 'story' && window.scrollY < 40) setTimeout(() => heroVid.play().catch(() => {}), 500);
  // saved projects: renders come from the project; the owner can make new ones from the current view
  const cloudAI = customPlan && cloudRow && Cloud ? {
    renders: cloudRow.renders || [],
    canGenerate: !!cloudId && !sharedView,
    generate: onFrame => renderCurrentView(onFrame),
    generateSet: onFrame => renderSet(onFrame),
    remove: async id => {
      const list = (await Cloud.getRenders(cloudId)).filter(r => r.id !== id);
      await Cloud.setRenders(cloudId, list);
      const gone = (cloudRow.renders || []).find(r => r.id === id);
      cloudRow.renders = list;
      if (gone && gone.files) Cloud.removeImages(gone.files);
    },
  } : null;
  const ai = await setupAI({
    projectKey, styles: () => styles, currentStyle: () => styleId, cloud: cloudAI,
    onStyle: id => selectStyle(id, false),
    onWalk: m => {
      if (m.pose) { // a saved render: stand where it was taken
        if (mode !== 'explore') setMode('explore');
        const p = m.pose; setTimeout(() => explore.walkTo(p.pos[0], p.pos[2], p.elev || 0, p.yaw || 0), 60);
        return;
      }
      const shot = (plan.shots || []).find(x => x.id === m.id);
      if (mode !== 'explore') setMode('explore');
      if (!shot) return;
      const yaw = Math.atan2(-(shot.look[0] - shot.pos[0]), -(shot.look[2] - shot.pos[2]));
      const L = plan.levels[0];
      setTimeout(() => explore.walkTo(shot.pos[0], shot.pos[2], L.elevation, yaw), 60);
    },
  });
  if (ai.manifest) { const c = $('#cta-ai'); c.hidden = false; c.addEventListener('click', () => ai.open('living')); }
  { // film player: any [data-film] link opens the in-page player
    const film = $('#film'), v = film.querySelector('video');
    const close = () => { v.pause(); film.hidden = true; };
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-film]'); if (!a) return;
      e.preventDefault(); v.src = isEn ? a.getAttribute('href').replace('-zh.mp4', '-en.mp4') : a.getAttribute('href'); film.hidden = false; v.currentTime = 0; v.play().catch(() => {});
    });
    film.querySelector('.film-close').addEventListener('click', close);
    film.addEventListener('click', e => { if (e.target === film) close(); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && !film.hidden) close(); });
  }
  // ✦ AI renders. A frame of the 3D at 16:9 in the current style goes to /api/render, which makes it photoreal while
  // keeping camera, walls and furniture; the photo comes back, is re-saved as JPEG + thumbnail and listed on the project.
  async function captureFrame(pose) { // pose: { pos:[x,y,z], look:[x,y,z], fov } or null for the current camera
    for (let i = 0; i < 50 && texturesPending(); i++) await new Promise(r => setTimeout(r, 100));
    const W = 1600, H = 900, keepReal = world.state.real, keepInside = world.state.interior, keepAspect = camera.aspect;
    const keepCam = { p: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov };
    try {
      world.setReal(1); renderer.setPixelRatio(1); renderer.setSize(W, H, false);
      if (composer) { composer.setPixelRatio(1); composer.setSize(W, H); }
      if (pose) { camera.position.set(...pose.pos); camera.lookAt(...pose.look); camera.fov = pose.fov || 62; world.setInterior(true); }
      camera.aspect = W / H; camera.updateProjectionMatrix();
      composer ? composer.render() : renderer.render(world.scene, camera);
      return renderer.domElement.toDataURL('image/jpeg', 0.9);
    } finally {
      renderer.setPixelRatio(pixelRatio); world.setReal(keepReal); world.setInterior(keepInside);
      camera.position.copy(keepCam.p); camera.quaternion.copy(keepCam.q); camera.fov = keepCam.fov; camera.aspect = keepAspect; resize();
    }
  }
  async function submitRender({ frame, room, pose }) {
    const token = await Cloud.accessToken();
    if (!token) throw new Error(t('請先登入', 'Please sign in first'));
    const st = styles.find(x => x.id === styleId);
    const r = await fetch('/api/render', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ image: frame, project: cloudId, room: room ? room.name : '', style: st ? `${st.name}${st.nameEn ? ' / ' + st.nameEn : ''}` : '', styleDesc: st ? st.tagline || '' : '', outdoor: !!(room && room.outdoor) }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = r.status === 503 ? t('AI 效果圖尚未啟用（伺服器未設定 Gemini 金鑰）。', 'AI renders are not enabled yet (no Gemini key on the server).')
        : r.status === 401 ? t('請重新登入後再試', 'Please sign in again')
        : r.status === 429 && /free.?tier/i.test(out.detail || '') ? t('Gemini 金鑰目前是免費方案，不能產生圖片：請在 Google AI Studio 為這個金鑰的專案開啟付費（Billing）。', 'The Gemini key is on the free tier, which cannot make images: turn on billing for its project in Google AI Studio.')
        : r.status === 429 ? t('AI 服務忙碌或已達上限，請稍後再試。', 'The AI service is busy or at its limit; try again shortly.')
        : t('生成失敗：', 'Render failed: ') + (out.detail || out.error || r.status);
      throw new Error(msg);
    }
    // smaller files for viewing: JPEG full size + 480 px thumbnail, uploaded to the same folder; the PNG is removed
    const dirPath = out.path.replace(/\/[^/]+$/, ''), files = [`${dirPath}/${out.id}-3d.jpg`];
    let after = out.after, thumb = out.after;
    try {
      const img = new Image(); img.crossOrigin = 'anonymous';
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = out.after; });
      const draw = (w, q) => new Promise(res => { const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * img.height / img.width); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(res, 'image/jpeg', q); });
      after = await Cloud.putImage(`${dirPath}/${out.id}.jpg`, await draw(Math.min(2560, img.width), 0.9)); files.push(`${dirPath}/${out.id}.jpg`);
      thumb = await Cloud.putImage(`${dirPath}/${out.id}.thumb.jpg`, await draw(480, 0.82)); files.push(`${dirPath}/${out.id}.thumb.jpg`);
      if (!/\.jpg$/.test(out.path)) Cloud.removeImages([out.path]);
    } catch (e) { console.warn('render resize', e); files.push(out.path); }
    const rec = { id: out.id, room: room ? room.name : '', roomEn: room ? room.nameEn || '' : '', style: st ? st.id : 'custom', before: out.before, after, thumb, pose, files, model: out.model, at: new Date().toISOString() };
    // several renders can finish together: append under a simple queue so none is lost
    saveQ = saveQ.then(async () => { const list = await Cloud.getRenders(cloudId); list.push(rec); await Cloud.setRenders(cloudId, list); cloudRow.renders = list; });
    await saveQ;
    return rec;
  }
  let saveQ = Promise.resolve();
  const poseOf = (pos, look, lvl) => { const dx = look[0] - pos[0], dz = look[2] - pos[2]; return { pos: pos.map(v => +v.toFixed(3)), yaw: +Math.atan2(-dx, -dz).toFixed(4), elev: lvl.elevation || 0, fov: camera.fov, level: lvl.id, look: look.map(v => +v.toFixed(3)) }; };
  async function renderCurrentView(onFrame) {
    if (mode !== 'explore' || explore.mode !== 'walk') {
      if (mode !== 'explore') setMode('explore');
      toast(t('先在「探索」的「走動」中走到想呈現的角度，再按 AI 效果圖。', 'In Explore → Walk, stand where you want the picture, then press AI renders.'));
      return null;
    }
    if (!(await Cloud.accessToken())) { toast(t('請先登入', 'Please sign in first')); return null; }
    const frame = await captureFrame(null);
    onFrame && onFrame(frame);
    const room = explore.currentRoom(), lvl = plan.levels.find(L => L.id === explore.currentLevel()) || plan.levels[0];
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const pos = camera.position.toArray(), look = [pos[0] + dir.x * 3, pos[1] + dir.y * 3, pos[2] + dir.z * 3];
    return submitRender({ frame, room, pose: poseOf(pos, look, lvl) });
  }
  // the proposal set: main living space, a separate dining room, the master bedroom — each from a photographer's corner
  function heroRooms() {
    const all = plan.levels.flatMap(L => L.rooms.filter(r => !r.outdoor && !r.wet && !r.circulation).map(r => ({ r, L })));
    const area = x => polygonArea(x.r.polygon), big = list => list.sort((a, b) => area(b) - area(a))[0];
    const by = re => all.filter(x => re.test(`${x.r.name} ${x.r.nameEn || ''}`));
    const picks = [big(by(/客|起居|living/i)) || big(by(/餐|dining/i)), big(by(/^餐廳|dining$/i)), big(by(/主臥|master/i)) || big(by(/臥|bed/i))];
    return picks.filter((x, i) => x && picks.findIndex(y => y && y.r === x.r) === i);
  }
  function photoPose({ r, L }) {
    const items = (L.furniture || []).filter(f => pointInPolygon([f.x, f.z], r.polygon));
    const hero = items.find(f => f.kind === 'sofa' || /Sofa/.test(f.model || '')) || items.find(f => f.kind === 'bed') || items.find(f => f.kind === 'table' || f.kind === 'roundtable');
    const b = bbox(r.polygon), tgt = hero ? [hero.x, hero.z] : [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
    const fp = items.filter(f => f.kind !== 'rug' && f.kind !== 'curtain' && f.kind !== 'art').map(f => { const q = Math.abs(Math.round((f.rot || 0) / 90)) % 2, hw = (q ? f.d : f.w) / 2 + 0.25, hd = (q ? f.w : f.d) / 2 + 0.25; return [f.x - hw, f.x + hw, f.z - hd, f.z + hd]; });
    const edge = q => { let m = Infinity; const P = r.polygon; for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length], dx = c[0] - a[0], dz = c[1] - a[1], l2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / l2)); m = Math.min(m, Math.hypot(q[0] - a[0] - u * dx, q[1] - a[1] - u * dz)); } return m; };
    // a clear view: the sight line to the hero piece (and lines 0.5 m either side) crosses no wall
    const walls = (L.walls || []).filter(w => w.kind !== 'zone');
    const cross = (p1, p2, a, c) => { const d = (x1, y1, x2, y2, x3, y3) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1); const d1 = d(a[0], a[1], c[0], c[1], p1[0], p1[1]), d2 = d(a[0], a[1], c[0], c[1], p2[0], p2[1]), d3 = d(p1[0], p1[1], p2[0], p2[1], a[0], a[1]), d4 = d(p1[0], p1[1], p2[0], p2[1], c[0], c[1]); return d1 * d2 < 0 && d3 * d4 < 0; };
    const clear = q => { const dx = tgt[0] - q[0], dz = tgt[1] - q[1], l = Math.hypot(dx, dz) || 1, n = [-dz / l, dx / l]; return [-0.5, 0, 0.5].every(o => { const p1 = [q[0] + n[0] * o, q[1] + n[1] * o], p2 = [tgt[0] + n[0] * o * 0.4, tgt[1] + n[1] * o * 0.4]; return !walls.some(w => cross(p1, p2, w.a, w.b)); }); };
    // and an open foreground: across the wide lens (±40°) the first 1–2 m are floor of this room, not a wall
    // corner, a doorway jamb or a wardrobe side
    const tall = items.filter(f => /wardrobe|tallcab|shelf|fridge|tvwall/.test(f.kind)).map(f => { const q = Math.abs(Math.round((f.rot || 0) / 90)) % 2, hw = (q ? f.d : f.w) / 2, hd = (q ? f.w : f.d) / 2; return [f.x - hw, f.x + hw, f.z - hd, f.z + hd]; });
    const openFront = q => { const a0 = Math.atan2(tgt[1] - q[1], tgt[0] - q[0]); let bad = 0; for (const da of [-40, -20, 0, 20, 40]) for (const dist of [1.0, 1.8]) { const a = a0 + (da * Math.PI) / 180, p = [q[0] + Math.cos(a) * dist, q[1] + Math.sin(a) * dist]; if (!pointInPolygon(p, r.polygon) || edge(p) < 0.12 || tall.some(k => p[0] > k[0] && p[0] < k[1] && p[1] > k[2] && p[1] < k[3])) bad++; } return bad; };
    let best = null;
    for (let x = b.x0 + 0.25; x < b.x1; x += 0.25) for (let z = b.z0 + 0.25; z < b.z1; z += 0.25) {
      const q = [x, z]; if (!pointInPolygon(q, r.polygon) || edge(q) < 0.45 || fp.some(k => x > k[0] && x < k[1] && z > k[2] && z < k[3]) || !clear(q)) continue;
      const d = Math.hypot(x - tgt[0], z - tgt[1]); if (d > 7.5 || d < 2) continue; // far enough for a wide shot, not across a whole 透天 floor
      const score = d - openFront(q) * 1.2; // each blocked foreground sample costs about a metre of distance
      if (!best || score > best.score) best = { q, d, score };
    }
    const q = best ? best.q : r.spot ? r.spot.pos : [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2], y0 = L.elevation || 0;
    return { pos: [q[0], y0 + 1.42, q[1]], look: [tgt[0], y0 + 0.85, tgt[1]], fov: 60, room: r, L };
  }
  // capture each hero view, then render them all at once; onFrame(i, frame, room) as each frame is ready
  async function renderSet(onFrame) {
    if (!(await Cloud.accessToken())) { toast(t('請先登入', 'Please sign in first')); return []; }
    if (mode !== 'explore') setMode('explore');
    const jobs = [];
    for (const [i, h] of heroRooms().entries()) {
      const p = photoPose(h), frame = await captureFrame(p);
      onFrame && onFrame(i, frame, h.r);
      jobs.push(submitRender({ frame, room: h.r, pose: poseOf(p.pos, p.look, h.L) }));
    }
    return jobs;
  }
  // a real-time 3D still of a style, for schemes that have no AI render yet (any plan, any style)
  const snaps = {};
  let snapQueue = Promise.resolve();
  const texturesPending = () => {
    let pending = false;
    world.scene.traverse(o => { if (!o.isMesh || pending) return; for (const m of [].concat(o.material)) for (const k of ['map', 'bumpMap', 'roughnessMap']) { const t = m && m[k]; if (t && t.isTexture && !t.isCanvasTexture && !t.image) pending = true; } });
    return pending;
  };
  // queued so two schemes never fight over the scene; waits for photo textures (hardwood) to arrive
  function snapshot(sid) {
    if (snaps[sid]) return snaps[sid];
    const st = styles.find(x => x.id === sid); if (!st) return Promise.resolve(null);
    snaps[sid] = snapQueue = snapQueue.then(async () => {
      const L = plan.levels[0];
      let pos, look, fov = 64;
      const shot = (plan.shots || []).find(x => x.id === 'living');
      if (shot) { pos = shot.pos; look = shot.look; fov = shot.fov || fov; }
      else {
        const room = L.rooms.filter(r => !r.outdoor && r.spot).sort((x, y) => polygonArea(y.polygon) - polygonArea(x.polygon))[0];
        if (!room) return null;
        pos = [room.spot.pos[0], L.elevation + 1.5, room.spot.pos[1]]; look = [room.spot.look[0], L.elevation + 1.1, room.spot.look[1]];
      }
      let url = null;
      applyState(st.finishes, st.palette);
      for (let i = 0; i < 50 && texturesPending(); i++) await new Promise(r => setTimeout(r, 100));
      const keep = { p: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov, real: world.state.real, inside: world.state.interior };
      try {
        applyState(st.finishes, st.palette); world.setReal(1); world.setInterior(true);
        camera.position.set(...pos); camera.lookAt(...look); camera.fov = fov; camera.updateProjectionMatrix();
        composer ? composer.render() : renderer.render(world.scene, camera);
        const src = renderer.domElement, W = 1280, H = 720, k = Math.min(src.width / W, src.height / H);
        const out = document.createElement('canvas'); out.width = W; out.height = H;
        out.getContext('2d').drawImage(src, (src.width - W * k) / 2, (src.height - H * k) / 2, W * k, H * k, 0, 0, W, H);
        url = out.toDataURL('image/jpeg', 0.86);
      } catch (e) { console.warn('snapshot', e); }
      applyState(chosen, palette); world.setReal(keep.real); world.setInterior(keep.inside);
      camera.position.copy(keep.p); camera.quaternion.copy(keep.q); camera.fov = keep.fov; camera.updateProjectionMatrix();
      return url;
    });
    return snaps[sid];
  }
  const proposal = setupProposal({
    plan, projectKey, styles: () => styles, currentStyle: () => styleId, manifest: ai.manifest, snapshot,
    onView: id => { if (mode !== 'explore') setMode('explore'); selectStyle(id, true); },
  });
  { // 匯出: GLB / OBJ for SketchUp, 3ds Max…; DXF plan for AutoCAD
    const box = $('#export'), btn = $('#export-open'), status = box.querySelector('.xp-status');
    const style = () => styles.find(s => s.id === styleId);
    const show = v => { box.hidden = !v; btn.setAttribute('aria-expanded', String(v)); if (v) { const st = style(); box.querySelector('.xp-style').textContent = st ? `${st.name} ${st.nameEn || ''}` : t('自訂材質 Custom', 'Custom'); status.textContent = ''; } };
    btn.addEventListener('click', e => { e.stopPropagation(); show(box.hidden); });
    document.addEventListener('click', e => { if (!box.hidden && !box.contains(e.target)) show(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) { show(false); btn.focus(); } });
    box.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', async () => {
      const fmt = b.dataset.fmt, st = style(), sid = st ? st.id : 'custom';
      const title = `${plan.project.name} · ${st ? st.name : t('自訂', 'Custom')}`, base = `${projectKey}-${sid}`;
      box.querySelectorAll('button').forEach(x => { x.disabled = true; }); status.textContent = t('產生中… Preparing…', 'Preparing…');
      await new Promise(r => setTimeout(r, 30));
      try {
        if (fmt === 'glb') download(await exportGLB(world, plan, title), `${base}.glb`);
        else if (fmt === 'obj') download(await exportOBJ(world, plan, title, base), `${base}-obj.zip`);
        else download(exportDXF(plan, plan.project.name), `${projectKey}-plan.dxf`);
        status.textContent = t('已下載 Downloaded ✓', 'Downloaded ✓');
      } catch (err) { console.error(err); status.textContent = t('匯出失敗 Export failed', 'Export failed'); }
      box.querySelectorAll('button').forEach(x => { x.disabled = false; });
    }));
  }
  window.__spatial = { ai, proposal, world, camera, story, explore, setMode, setView, scrollToBeat, plan, compare, tod, selectStyle, openStyleCompare, openFinishCompare, photo };
}

boot().catch(err => {
  console.error(err);
  const el = document.getElementById('boot-error');
  if (el) { el.hidden = false; el.querySelector('code').textContent = String(err.message || err); }
});
