import * as THREE from 'three';
import { loadPlan, polygonArea, bbox, toPing, buildQuote, pointInPolygon } from './plan.js';
import { drawLevel, planFrame, worldFromCanvas } from './drawing.js';
import { createWorld } from './scene.js';
import { createStory } from './story.js';
import { createExplore } from './explore.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const PROJECTS = { apartment: 'data/apartment.json', townhouse: 'data/house.json' };

const $ = s => document.querySelector(s);
const fmt = n => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function boot() {
  const params = new URLSearchParams(location.search);
  const projectKey = PROJECTS[params.get('p')] ? params.get('p') : 'apartment';
  const plan = await loadPlan(PROJECTS[projectKey]);
  document.body.dataset.project = projectKey;
  document.querySelectorAll('[data-project-link]').forEach(a => a.setAttribute('aria-current', String(a.dataset.projectLink === projectKey)));
  // quality tier: high (AO + bloom + MSAA), med (no post), lite (no shadows)
  const coarse = matchMedia('(pointer: coarse)').matches;
  const tier = ['high', 'med', 'lite'].includes(params.get('q')) ? params.get('q') : params.has('lite') ? 'lite' : coarse || (navigator.deviceMemory && navigator.deviceMemory <= 4) ? 'med' : 'high';
  await Promise.all([
    document.fonts.load('700 20px "Noto Sans TC"'), document.fonts.load('500 20px "Noto Sans TC"'),
    document.fonts.load('500 20px "IBM Plex Mono"'), document.fonts.load('600 20px "IBM Plex Mono"'),
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
  const world = await createWorld(plan, renderer, { shadows: tier !== 'lite', shadowSize: tier === 'high' ? 2048 : 1024 });
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
    const cells = [
      ['案名 Project', pr.name],
      st[0] ? [st[0].label, st[0].value] : ['基地 Footprint', `${(fb.x1 - fb.x0).toFixed(2)} × ${(fb.z1 - fb.z0).toFixed(2)} m`],
      ['室內面積 Interior', `${interior.toFixed(1)} m² · ${toPing(interior).toFixed(1)} 坪`],
      st[1] ? [st[1].label, st[1].value] : ['基地 Footprint', `${(fb.x1 - fb.x0).toFixed(2)} × ${(fb.z1 - fb.z0).toFixed(2)} m`],
    ];
    $('#titleblock').innerHTML = cells.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    for (const key of ['rise', 'real', 'outro']) {
      const c = story.captions[key];
      if (!c) continue;
      const el = $(`#cap-${key}`);
      el.querySelector('h2').textContent = c[0];
      el.querySelector('p').textContent = c[1];
      el.querySelector('.en').textContent = c[2];
    }
  }
  const explore = createExplore(plan, camera, canvas);

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
      row.innerHTML = `<legend><span>${g.name}</span><small>${g.nameEn}</small></legend>`;
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
          try { localStorage.setItem('spatial.finishes', JSON.stringify(chosen)); } catch {}
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
    const { lines, total, q } = buildQuote(plan, chosen);
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
    $('#qty-line').textContent = `地坪 ${toPing(q.floorArea).toFixed(1)} 坪 · 檯面 ${q.counterLength.toFixed(2)} m · 牆面 ${toPing(q.wallArea).toFixed(1)} 坪`;
    const tb = $('#quote-lines tbody');
    tb.innerHTML = '';
    let group = null;
    for (const l of lines) {
      if (l.group !== group) {
        group = l.group;
        const tr = document.createElement('tr'); tr.className = 'grp';
        tr.innerHTML = `<th colspan="4">${l.finish ? '材質 Finishes' : l.group}</th>`;
        tb.appendChild(tr);
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${l.finish ? `<b>${l.group}</b> ` : ''}${l.name}</td>
        <td class="num">${l.unit === '件' ? l.qty : l.qty.toFixed(l.unit === 'm' ? 2 : 1)} ${l.unit}</td>
        <td class="num">${fmt(l.unitPrice)}</td><td class="num">${fmt(l.total)}</td>`;
      tb.appendChild(tr);
    }
  }
  renderFinishes();
  renderQuote(false);
  $('#quote-toggle').addEventListener('click', e => {
    const open = $('#quote-lines').hidden;
    $('#quote-lines').hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
    e.currentTarget.textContent = open ? '收合清單' : '查看清單';
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

  // ---------------- modes ----------------
  let mode = 'story';
  const levelIds = plan.levels.map(L => L.id);
  let cutaway = String(levelIds.length - 1); // index of highest visible level, or 'x' for exploded
  {
    const seg = $('#level-seg');
    seg.innerHTML = '';
    if (levelIds.length > 1) {
      levelIds.forEach((id, i) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.cut = String(i); b.textContent = levelIds.slice(0, i + 1).join('+'); seg.appendChild(b); });
      const x = document.createElement('button'); x.type = 'button'; x.dataset.cut = 'x'; x.textContent = '分層展開'; seg.appendChild(x);
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

  function setMode(m) {
    if (m === mode) return;
    const prev = mode;
    mode = m;
    document.body.dataset.mode = m;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    explore.active = m === 'explore';
    if (m === 'story') {
      lenis?.start();
      requestAnimationFrame(() => window.scrollTo(0, storyY));
    } else {
      if (prev === 'story') storyY = window.scrollY;
      lenis?.stop();
    }
    if (m === 'explore') {
      for (const id of levelIds) world.setRise(id, 1);
      applyCutaway();
      realTarget = sketchMode ? 0 : 1;
      if (prev === 'story') {
        const stop = story.stopAt(beatNow);
        const room = stop ? roomsById[stop.room] : roomsById.living || Object.values(roomsById)[0];
        explore.goToRoom(room, room.level, 0.001);
      }
      setView(explore.mode);
    }
    if (m === 'plan') drawPlanView();
  }
  let storyY = 0;
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#cta-explore').addEventListener('click', () => setMode('explore'));

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
    drawLevel(plan, L, { pxPerM: s, frame, paper: true, canvas: planCanvas, highlight: planHover });
    planCanvas.style.width = `${(frame.w * s) / Math.min(devicePixelRatio, 2)}px`;
    planGeom = { frame, s, L };
    document.querySelectorAll('#plan-levels button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === planLevel)));
    renderSchedule(L);
  }
  function renderSchedule(L) {
    const tb = $('#schedule tbody');
    tb.innerHTML = '';
    let sum = 0;
    for (const r of L.rooms) {
      const a = polygonArea(r.polygon); sum += a;
      const b = bbox(r.polygon);
      const tr = document.createElement('tr');
      tr.dataset.room = r.id;
      tr.innerHTML = `<td>${r.name}<small>${r.nameEn}</small></td><td class="num">${(b.x1 - b.x0).toFixed(2)}×${(b.z1 - b.z0).toFixed(2)}</td><td class="num">${a.toFixed(1)}</td><td class="num">${toPing(a).toFixed(1)}</td>`;
      tr.addEventListener('mouseenter', () => { planHover = r.id; drawPlanView(); });
      tr.addEventListener('mouseleave', () => { planHover = null; drawPlanView(); });
      tr.addEventListener('click', () => { setMode('explore'); setView('walk'); explore.goToRoom(r, L.id); });
      tb.appendChild(tr);
    }
    $('#schedule tfoot').innerHTML = `<tr><td>${L.id} 室內合計</td><td></td><td class="num">${sum.toFixed(1)}</td><td class="num">${toPing(sum).toFixed(1)}</td></tr>`;
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
    plate.querySelector('.p-area').textContent = `${a.toFixed(1)} m² · ${toPing(a).toFixed(1)} 坪`;
    plate.querySelector('.p-dim').textContent = `${(b.x1 - b.x0).toFixed(2)} × ${(b.z1 - b.z0).toFixed(2)} m`;
    plate.classList.add('on');
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
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
      const stop = story.stopAt(beatNow);
      showPlate(stop ? roomsById[stop.room] : null, stop ? stop.level : '');
      rail.querySelectorAll('button').forEach(b => b.classList.toggle('on', !!stop && b.dataset.stop === stop.id));
      $('#progress').style.transform = `scaleY(${beatNow / story.total})`;
    } else if (mode === 'explore') {
      realNow += (realTarget - realNow) * Math.min(1, dt * 4);
      if (Math.abs(realTarget - realNow) < 0.002) realNow = realTarget;
      world.setReal(realNow);
      explore.step(dt);
      if (explore.mode === 'walk') {
        const r = explore.currentRoom();
        showPlate(r, explore.currentLevel());
        spots.querySelectorAll('.spot').forEach(b => b.classList.toggle('on', !!r && b.dataset.room === r.id));
      } else showPlate(null);
    }
    world.setInterior(isInside(camera.position));
    if (mode !== 'plan') { if (composer) composer.render(); else renderer.render(world.scene, camera); }
    requestAnimationFrame(frame);
  }
  document.body.dataset.mode = 'story';
  // deep link: #explore or #plan
  const hash = location.hash.replace('#', '');
  if (hash === 'explore' || hash === 'plan') setMode(hash);
  addEventListener('hashchange', () => { const h = location.hash.replace('#', ''); if (['story', 'explore', 'plan'].includes(h)) setMode(h); });
  requestAnimationFrame(frame);
  document.body.classList.add('ready');
  window.__spatial = { world, camera, story, explore, setMode, setView, scrollToBeat, plan };
}

boot().catch(err => {
  console.error(err);
  const el = document.getElementById('boot-error');
  if (el) { el.hidden = false; el.querySelector('code').textContent = String(err.message || err); }
});
