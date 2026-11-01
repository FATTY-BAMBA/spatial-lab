// Explore mode: first-person walk with wall/furniture collision and real stair climbing,
// plus an orbit "overview" camera for level cutaways.
import * as THREE from 'three';
import { collisionSegments, itemFootprint, isBlocking, pointInPolygon, stairHeightAt } from './plan.js';

const EYE = 1.6, RADIUS = 0.24, STEP = 0.5;

export function createExplore(plan, camera, dom) {
  const levels = plan.levels;
  const segs = Object.fromEntries(levels.map(L => [L.id, collisionSegments(L)]));
  const boxes = Object.fromEntries(levels.map(L => [L.id, L.furniture.filter(isBlocking).map(itemFootprint)]));
  const stair = plan.stairs[0] || null;
  const multi = levels.length > 1;
  const rise = multi ? levels[1].elevation - levels[0].elevation : 3;

  const walk = { x: 1, z: 1, y: levels[0].elevation, yaw: 0, pitch: -0.08, vy: 0 };
  const orbit = { theta: 0.8, phi: 0.98, radius: 34, target: new THREE.Vector3(5.6, 2.6, 6.2) };
  let mode = 'walk';
  const keys = new Set();
  let holdWalk = false;
  let active = false;
  let tween = null;

  function levelAtY(y) { return !multi || y < rise / 2 ? levels[0] : levels[1]; }

  function floorAt(x, z, y) {
    if (!multi) return levels[0].elevation;
    if (stair && x >= stair.x0 && x <= stair.x1 && z >= stair.zStart && z <= stair.zEnd) {
      const h = stairHeightAt(stair, z, rise);
      return Math.abs(h - y) <= STEP ? h : null;
    }
    const cands = [levels[0].elevation];
    const up = levels[1];
    if (!(up.voids || []).some(v => pointInPolygon([x, z], v.polygon))) cands.push(up.elevation);
    let best = null;
    for (const c of cands) if (Math.abs(c - y) <= STEP && (best === null || Math.abs(c - y) < Math.abs(best - y))) best = c;
    return best;
  }

  function resolve(x, z, y) {
    const L = levelAtY(y);
    for (let iter = 0; iter < 3; iter++) {
      for (const s of segs[L.id]) {
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const len2 = dx * dx + dz * dz || 1e-6;
        let t = ((x - s.ax) * dx + (z - s.az) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = s.ax + dx * t, pz = s.az + dz * t;
        const ox = x - px, oz = z - pz;
        const d = Math.hypot(ox, oz), min = RADIUS + s.r;
        if (d < min && d > 1e-6) { x = px + (ox / d) * min; z = pz + (oz / d) * min; }
      }
      if (Math.abs(y - L.elevation) < 0.3) {
        for (const b of boxes[L.id]) {
          const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
          const ox = x - cx, oz = z - cz, d = Math.hypot(ox, oz);
          if (d < RADIUS) {
            if (d > 1e-6) { x = cx + (ox / d) * RADIUS; z = cz + (oz / d) * RADIUS; }
            else { // centre inside the box: push out the shortest way
              const opts = [[b.x0 - RADIUS, z, x - b.x0], [b.x1 + RADIUS, z, b.x1 - x], [x, b.z0 - RADIUS, z - b.z0], [x, b.z1 + RADIUS, b.z1 - z]];
              opts.sort((p, q) => p[2] - q[2]); x = opts[0][0]; z = opts[0][1];
            }
          }
        }
      }
    }
    return [x, z];
  }

  function step(rawDt) {
    const dt = Math.min(0.05, rawDt);
    if (tween) {
      tween.t = Math.min(1, tween.t + Math.min(0.25, rawDt) / tween.dur);
      const e = tween.t < 0.5 ? 2 * tween.t * tween.t : 1 - Math.pow(-2 * tween.t + 2, 2) / 2;
      for (const k of ['x', 'z', 'y', 'pitch']) walk[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * e;
      let dy = tween.to.yaw - tween.from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      walk.yaw = tween.from.yaw + dy * e;
      if (tween.t >= 1) tween = null;
    } else if (mode === 'walk') {
      let f = 0, r = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp') || holdWalk) f += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
      if (keys.has('KeyA')) r -= 1;
      if (keys.has('KeyD')) r += 1;
      if (keys.has('ArrowLeft')) walk.yaw += 1.6 * dt;
      if (keys.has('ArrowRight')) walk.yaw -= 1.6 * dt;
      if (f || r) {
        const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.8 : 1.5) * dt;
        const n = Math.hypot(f, r);
        const sx = -Math.sin(walk.yaw), sz = -Math.cos(walk.yaw);
        const rx = Math.cos(walk.yaw), rz = -Math.sin(walk.yaw);
        const mx = ((sx * f + rx * r) / n) * speed, mz = ((sz * f + rz * r) / n) * speed;
        tryMove(mx, mz);
      }
    }
    if (mode === 'walk' || tween) {
      camera.position.set(walk.x, walk.y + EYE, walk.z);
      camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
      camera.fov = 66; camera.near = 0.06;
    } else {
      const { theta, phi, target } = orbit;
      const portrait = camera.aspect < 1;
      const radius = orbit.radius * (portrait ? 0.8 / Math.max(0.42, camera.aspect) : 1);
      if (portrait) target.set(4, 2.6, 7); else target.set(5.6, 2.6, 6.2);
      camera.position.set(target.x + radius * Math.sin(phi) * Math.sin(theta), target.y + radius * Math.cos(phi), target.z + radius * Math.sin(phi) * Math.cos(theta));
      camera.lookAt(target);
      camera.fov = 38; camera.near = 0.5;
    }
    camera.updateProjectionMatrix();
  }

  function tryMove(mx, mz) {
    // move in two axes separately so you slide along walls
    for (const [dx, dz] of [[mx, 0], [0, mz]]) {
      const nx = walk.x + dx, nz = walk.z + dz;
      const h = floorAt(nx, nz, walk.y);
      if (h === null) continue;
      const [rx, rz] = resolve(nx, nz, h);
      const h2 = floorAt(rx, rz, walk.y);
      if (h2 === null) continue;
      walk.x = rx; walk.z = rz; walk.y = h2;
    }
  }

  function goToRoom(room, levelId, dur = 1.1) {
    const L = levels.find(l => l.id === levelId);
    const [x, z] = room.spot.pos, [lx, lz] = room.spot.look;
    const yaw = Math.atan2(-(lx - x), -(lz - z));
    const to = { x, z, y: L.elevation, yaw, pitch: room.spot.pitch ?? -0.12 };
    if (mode !== 'walk' || !active) { Object.assign(walk, to); setMode('walk'); return; }
    tween = { t: 0, dur, from: { ...walk }, to };
  }

  // walk to a floor point (x, z on level elevation y), turning toward the direction of travel
  function walkTo(x, z, y, faceYaw) {
    const L = levelAtY(y + 0.1);
    const [rx, rz] = resolve(x, z, L.elevation);
    const dx = rx - walk.x, dz = rz - walk.z, dist = Math.hypot(dx, dz);
    const yaw = faceYaw ?? (dist > 0.4 ? Math.atan2(-dx, -dz) : walk.yaw);
    const to = { x: rx, z: rz, y: L.elevation, yaw, pitch: mode === 'walk' ? walk.pitch * 0.5 : -0.1 };
    if (mode !== 'walk') { Object.assign(walk, to); setMode('walk'); return; }
    tween = { t: 0, dur: Math.min(1.6, 0.45 + dist * 0.22), from: { ...walk }, to };
  }

  function setMode(m) { if (m !== mode) tween = null; mode = m; dom.dataset.view = m; }

  // ---- input ----
  let drag = null;
  const pinch = new Map();
  dom.addEventListener('pointerdown', e => {
    if (!active) return;
    dom.setPointerCapture(e.pointerId);
    pinch.set(e.pointerId, [e.clientX, e.clientY]);
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
  });
  dom.addEventListener('pointermove', e => {
    if (!active || !drag) return;
    if (pinch.has(e.pointerId)) {
      const prev = pinch.get(e.pointerId);
      if (pinch.size === 2 && mode === 'orbit') {
        const [a, b] = [...pinch.values()];
        const d0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
        pinch.set(e.pointerId, [e.clientX, e.clientY]);
        const [c, d] = [...pinch.values()];
        const d1 = Math.hypot(c[0] - d[0], c[1] - d[1]);
        orbit.radius = Math.min(60, Math.max(8, orbit.radius * (d0 / Math.max(1, d1))));
        return;
      }
      pinch.set(e.pointerId, [e.clientX, e.clientY]);
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (mode === 'walk') {
        walk.yaw += dx * 0.0042; walk.pitch = Math.max(-1.2, Math.min(1.1, walk.pitch + dy * 0.0036));
      } else {
        orbit.theta -= dx * 0.006; orbit.phi = Math.max(0.12, Math.min(1.45, orbit.phi - dy * 0.005));
      }
    }
  });
  const end = e => {
    const wasTap = drag && pinch.size === 1 && drag.moved < 6 && performance.now() - drag.t < 450 && e.type === 'pointerup';
    pinch.delete(e.pointerId);
    if (!pinch.size) drag = null;
    if (wasTap && api.onTap) api.onTap(e.clientX, e.clientY);
  };
  dom.addEventListener('pointerup', end);
  dom.addEventListener('pointercancel', end);
  dom.addEventListener('wheel', e => {
    if (!active || mode !== 'orbit') return;
    e.preventDefault();
    orbit.radius = Math.min(60, Math.max(8, orbit.radius * (1 + Math.sign(e.deltaY) * 0.08)));
  }, { passive: false });
  addEventListener('keydown', e => { if (!active) return; if (e.target.closest && e.target.closest('input,textarea')) return; keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const api = {
    step, goToRoom, setMode, walkTo, onTap: null,
    get mode() { return mode; },
    set active(v) { active = v; if (!v) { keys.clear(); holdWalk = false; } },
    get active() { return active; },
    set holdWalk(v) { holdWalk = v; },
    walk, orbit,
    currentLevel() { return levelAtY(walk.y).id; },
    currentRoom() {
      const L = levelAtY(walk.y);
      return L.rooms.find(r => pointInPolygon([walk.x, walk.z], r.polygon)) || null;
    },
  };
  return api;
}
