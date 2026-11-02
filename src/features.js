// Sprint 2 experience features: click-to-walk, plan mini-map, time of day, finish A/B split.
import * as THREE from 'three';
import { drawLevel, planFrame, worldFromCanvas } from './drawing.js';
import { pointInPolygon } from './plan.js';

const $ = s => document.querySelector(s);
const fmt = n => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

// ---------------------------------------------------------------- click to walk
export function setupClickWalk({ world, camera, explore, canvas, getMode, setView }) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ring = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  const disc = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false, fog: false });
  const r1 = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.235, 40), mat);
  const r2 = new THREE.Mesh(new THREE.CircleGeometry(0.2, 40), disc);
  for (const m of [r1, r2]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 10; ring.add(m); }
  ring.visible = false;
  world.scene.add(ring);
  const fine = matchMedia('(pointer: fine)').matches;

  function pick(cx, cy, full) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const walking = explore.mode === 'walk';
    const lv = explore.currentLevel();
    const floors = world.floors.filter(f => isVisible(f) && (!walking || f.userData.level === lv));
    const hit = ray.intersectObjects(floors, false)[0];
    if (!hit) return null;
    if (full) {
      // make sure nothing (wall, furniture) is in front of the floor point
      const levelGroups = Object.values(world.levels).filter(L => L.group.visible).map(L => L.group);
      const first = ray.intersectObjects(levelGroups, true).find(h => h.object.isMesh && h.object.visible && !h.object.material.transparent && h.object !== r1 && h.object !== r2);
      if (first && first.object !== hit.object && first.distance < hit.distance - 0.05) return null;
    }
    return hit;
  }
  function isVisible(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }

  let pending = null;
  canvas.addEventListener('pointermove', e => {
    if (!fine || getMode() !== 'explore') return;
    pending = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointerleave', () => { ring.visible = false; pending = null; });

  explore.onTap = (cx, cy) => {
    if (getMode() !== 'explore') return;
    const hit = pick(cx, cy, true);
    if (!hit) return;
    const p = hit.point;
    if (explore.mode === 'orbit') {
      // drop in at that point, looking the way the overview camera was facing
      const d = new THREE.Vector3(); camera.getWorldDirection(d);
      setView('walk');
      explore.walkTo(p.x, p.z, p.y, Math.atan2(-d.x, -d.z));
    } else explore.walkTo(p.x, p.z, p.y);
  };

  return {
    update() {
      if (!pending) return;
      const [cx, cy] = pending; pending = null;
      const hit = explore.mode === 'walk' ? pick(cx, cy, false) : null;
      ring.visible = !!hit && getMode() === 'explore';
      if (hit) ring.position.set(hit.point.x, hit.point.y + 0.012, hit.point.z);
      canvas.style.cursor = hit ? 'pointer' : 'grab';
    },
    hide() { ring.visible = false; },
  };
}

// ---------------------------------------------------------------- mini-map
export function setupMinimap({ plan, explore, camera, getMode }) {
  const host = $('#minimap');
  const base = host.querySelector('.mm-base'), over = host.querySelector('.mm-over');
  const frame = planFrame(plan, 0.6);
  const dpr = Math.min(devicePixelRatio, 2);
  let levelId = null, s = 1, cssW = 0;
  function drawBase(L) {
    cssW = host.clientWidth || 200;
    s = (cssW / frame.w) * dpr;
    drawLevel(plan, L, { pxPerM: s, frame, paper: true, titleBlock: false, canvas: base, theme: 'dark', noDims: true });
    over.width = base.width; over.height = base.height;
    host.style.setProperty('--mm-h', `${(frame.h / frame.w) * cssW}px`);
    host.querySelector('.mm-lv').textContent = `${L.id} ${L.name}`;
    levelId = L.id;
  }
  const ctx = over.getContext('2d');
  function update() {
    if (getMode() !== 'explore' || explore.mode !== 'walk') { host.hidden = true; return; }
    host.hidden = false;
    const lv = explore.currentLevel();
    if (lv !== levelId || (host.clientWidth && Math.abs(host.clientWidth - cssW) > 1)) drawBase(plan.levels.find(L => L.id === lv));
    const { x, z, yaw } = explore.walk;
    const X = (x - frame.x0) * s, Z = (z - frame.z0) * s;
    ctx.clearRect(0, 0, over.width, over.height);
    const hf = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    const dir = Math.atan2(-Math.cos(yaw), -Math.sin(yaw)); // canvas angle of forward (x, z)
    const R = 2.4 * s;
    const g = ctx.createRadialGradient(X, Z, 0, X, Z, R);
    g.addColorStop(0, 'rgba(201,162,106,0.6)'); g.addColorStop(1, 'rgba(201,162,106,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(X, Z); ctx.arc(X, Z, R, dir - hf, dir + hf); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#16130f';
    ctx.beginPath(); ctx.arc(X, Z, 0.16 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c9a26a'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(X, Z, 0.16 * s, 0, Math.PI * 2); ctx.stroke();
  }
  over.addEventListener('click', e => {
    const rect = over.getBoundingClientRect();
    const k = over.width / rect.width;
    const [wx, wz] = worldFromCanvas(frame, s, (e.clientX - rect.left) * k, (e.clientY - rect.top) * k);
    const L = plan.levels.find(l => l.id === levelId);
    if (L && L.rooms.some(r => pointInPolygon([wx, wz], r.polygon))) explore.walkTo(wx, wz, L.elevation);
  });
  return { update };
}

// ---------------------------------------------------------------- time of day
export function setupTime({ world, plan }) {
  const input = $('#tod'), out = $('#tod-out'), label = $('#tod-label');
  const def = plan.project.hour ?? 15;
  const name = h => (h < 10.5 ? '早晨' : h < 13.5 ? '正午' : h < 16.8 ? '午後' : h < 18.4 ? '黃昏' : '夜晚');
  function set(h) {
    world.setTime(h);
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    out.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    label.textContent = name(h);
  }
  input.value = def;
  input.addEventListener('input', () => set(+input.value));
  set(def);
  return { reset() { input.value = def; set(def); }, set };
}

// ---------------------------------------------------------------- A/B split (finishes or whole styles)
// cfg: { title, applyA(), applyB(), restore(), side(which) -> {tag,name,sub}, chips: [{id,label}], current: id, pick(id), adopt() }
export function setupCompare({ renderer }) {
  const bar = $('#compare'), handle = $('#compare-handle');
  let cmp = null, sweep = null;
  function open(cfg) {
    cmp = { ...cfg, x: 0.5 };
    sweep = null;
    document.body.classList.add('comparing');
    handle.classList.remove('sweeping');
    bar.hidden = false; handle.hidden = false;
    renderBar();
  }
  function close() {
    if (!cmp) return;
    const c = cmp; cmp = null;
    c.restore();
    document.body.classList.remove('comparing');
    bar.hidden = true; handle.hidden = true;
  }
  function renderBar() {
    const a = cmp.side('a'), b = cmp.side('b');
    bar.querySelector('.cmp-a').innerHTML = `<span class="tag">${a.tag}</span><b>${a.name}</b><small>${a.sub}</small>`;
    bar.querySelector('.cmp-b').innerHTML = `<span class="tag">${b.tag}</span><b>${b.name}</b><small>${b.sub}</small>`;
    const chips = bar.querySelector('.cmp-opts');
    chips.innerHTML = '';
    for (const o of cmp.chips) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = o.label; btn.setAttribute('aria-pressed', String(o.id === cmp.current));
      btn.addEventListener('click', () => { cmp.current = o.id; cmp.pick(o.id); renderBar(); });
      chips.appendChild(btn);
    }
    bar.querySelector('.cmp-title').textContent = cmp.title;
    placeHandle();
  }
  function placeHandle() { handle.style.left = `${(sweep ? sweep.x : cmp.x) * 100}%`; }
  bar.querySelector('.cmp-adopt').addEventListener('click', () => { const c = cmp; close(); c.adopt(); });
  bar.querySelector('.cmp-close').addEventListener('click', close);
  let dragging = false;
  handle.addEventListener('pointerdown', e => { if (!cmp) return; dragging = true; handle.setPointerCapture(e.pointerId); e.stopPropagation(); });
  handle.addEventListener('pointermove', e => { if (!dragging || !cmp) return; cmp.x = Math.min(0.92, Math.max(0.08, e.clientX / innerWidth)); placeHandle(); });
  handle.addEventListener('pointerup', () => { dragging = false; });
  handle.addEventListener('keydown', e => { if (!cmp) return; if (e.key === 'ArrowLeft') cmp.x = Math.max(0.08, cmp.x - 0.04); if (e.key === 'ArrowRight') cmp.x = Math.min(0.92, cmp.x + 0.04); placeHandle(); });

  // A wipe from the old state (right) to the new state (left edge sweeping across)
  function transition(applyOld, applyNew, done, dur = 1.1) {
    if (cmp) close();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { applyNew(); done && done(); return; }
    sweep = { applyOld, applyNew, done, t0: performance.now(), dur: dur * 1000, x: 0 };
    handle.hidden = false; handle.classList.add('sweeping');
  }

  function split(draw, x, left, right) {
    const w = innerWidth, h = innerHeight, sx = Math.round(w * x);
    renderer.setScissorTest(true);
    left(); renderer.setScissor(0, 0, sx, h); draw();
    right(); renderer.setScissor(sx, 0, w - sx, h); draw();
    renderer.setScissorTest(false);
  }
  function render(draw) {
    if (sweep) {
      const k = Math.min(1, (performance.now() - sweep.t0) / sweep.dur);
      sweep.x = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      placeHandle();
      if (k >= 1) {
        const s = sweep; sweep = null; handle.hidden = true; handle.classList.remove('sweeping');
        s.applyNew(); s.done && s.done(); draw(); return true;
      }
      split(draw, sweep.x, sweep.applyNew, sweep.applyOld);
      sweep.applyNew();
      return true;
    }
    if (!cmp) return false;
    split(draw, cmp.x, cmp.applyA, cmp.applyB);
    cmp.applyA();
    return true;
  }
  return { open, close, transition, render, get active() { return !!cmp; } };
}
