// Scroll story driven by the project's `story` block: camera nodes (with holds at
// rooms), which levels rise between which nodes, when materials appear, and the outro.
import * as THREE from 'three';

const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = x => Math.min(1, Math.max(0, x));

export function createStory(cfg) {
  const NODES = cfg.nodes.map(n => ({ ...n }));
  let t = 0;
  NODES.forEach((n, i) => {
    if (i > 0) t += n.travel || 0;
    n.arrive = t;
    t += n.hold || 0;
    n.depart = t;
  });
  const total = t;
  let fov = NODES[0].fov;
  NODES.forEach(n => { if (n.fov) fov = n.fov; else n.fov = fov; });

  const posCurve = new THREE.CatmullRomCurve3(NODES.map(n => new THREE.Vector3(...n.pos)), false, 'centripetal');
  const lookCurve = new THREE.CatmullRomCurve3(NODES.map(n => new THREE.Vector3(...n.look)), false, 'centripetal');
  const holds = NODES.map((n, i) => (n.hold ? i : -1)).filter(i => i >= 0);
  const byId = Object.fromEntries(NODES.filter(n => n.id).map(n => [n.id, n]));
  const plan0 = { pos: [...NODES[0].pos], look: [...NODES[0].look] };

  function uAt(beat) {
    for (let h = 0; h < holds.length; h++) {
      const a = NODES[holds[h]];
      if (beat <= a.depart) return holds[h];
      const bIdx = holds[h + 1];
      if (bIdx === undefined) return holds[h];
      const b = NODES[bIdx];
      if (beat < b.arrive) {
        const dur = b.arrive - a.depart;
        let e = easeInOut((beat - a.depart) / dur) * dur;
        for (let k = holds[h] + 1; k <= bIdx; k++) {
          const tr = NODES[k].travel;
          if (e <= tr) return k - 1 + e / tr;
          e -= tr;
        }
        return bIdx;
      }
    }
    return NODES.length - 1;
  }

  const _p = new THREE.Vector3(), _l = new THREE.Vector3();
  function cameraAt(beat, camera) {
    const u = uAt(beat);
    const s = Math.min(1, u / (NODES.length - 1));
    posCurve.getPoint(s, _p);
    lookCurve.getPoint(s, _l);
    const i = Math.floor(u), f = u - i;
    const f0 = NODES[i].fov, f1 = NODES[Math.min(NODES.length - 1, i + 1)].fov;
    camera.fov = f0 + (f1 - f0) * f;
    camera.position.copy(_p);
    camera.lookAt(_l);
    camera.near = Math.min(40, Math.max(0.06, (_p.y - 6) * 0.4));
    camera.updateProjectionMatrix();
    return u;
  }

  function stopAt(beat) {
    for (const n of NODES) {
      if (!n.room) continue;
      if (beat >= n.arrive - 0.25 && beat <= n.depart + 0.2) return n;
    }
    return null;
  }

  function eventsAt(beat) {
    const rise = {};
    for (const [lv, [from, to]] of Object.entries(cfg.rise || {})) {
      const a = byId[from], b = byId[to];
      rise[lv] = clamp01((beat - a.depart + 0.05) / Math.max(0.2, b.arrive - a.depart - 0.15));
    }
    const r = byId[cfg.real];
    const real = clamp01((beat - r.arrive - 0.15) / Math.max(0.3, r.depart - r.arrive - 0.3));
    let explode = 0;
    const ex = cfg.explode && byId[cfg.explode];
    if (ex) explode = clamp01((beat - (ex.arrive - ex.travel * 0.55)) / (ex.travel * 0.55 + 0.3));
    const plan = NODES[0], last = NODES[NODES.length - 1];
    const phase = beat < plan.depart ? 'hero' : beat < r.arrive ? 'rise' : beat < r.depart ? 'real' : beat >= last.arrive - 0.3 ? 'outro' : 'walk';
    return { rise, real, explode, phase };
  }

  // Frame the opening top-down drawing beside the hero copy (wide) or below it (tall).
  function layout(aspect, frame) {
    const tanH = Math.tan((NODES[0].fov * Math.PI) / 360);
    const cx = frame.x0 + frame.w / 2, cz = frame.z0 + frame.h / 2;
    let d, x = cx, z = cz;
    if (aspect >= 0.95) {
      const visH = frame.h * 1.04;
      d = Math.max(visH, (frame.w * 1.05) / Math.max(0.35, aspect - 0.42)) / (2 * tanH);
      const vw = 2 * d * tanH * aspect;
      x = cx - Math.min(0.2, 0.5 - (frame.w * 0.55) / vw) * vw;
    } else {
      const visW = frame.w * 1.06;
      d = Math.max(visW / aspect, frame.h * 1.9) / (2 * tanH);
      z = cz - 0.2 * (2 * d * tanH);
    }
    const n = NODES[0];
    n.pos = [x, d, z + 0.6];
    n.look = [x, 0, z];
    posCurve.points[0].set(...n.pos);
    lookCurve.points[0].set(...n.look);
  }

  return { total, cameraAt, stopAt, eventsAt, layout, nodes: NODES, captions: cfg.captions || {} };
}
