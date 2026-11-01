// Scroll story: one camera path from the top-down drawing, through the house, up the
// stair, and out to an exploded view. Time is in "beats"; scroll maps to beats.
import * as THREE from 'three';

export const NODES = [
  { id: 'plan', pos: [4, 62, 7.6], look: [4, 0, 7], fov: 13, hold: 1.1 },
  { id: 'aerial', pos: [16.5, 15.5, 25], look: [3.6, 0.6, 6.6], fov: 36, travel: 1.7, hold: 1.5 },
  { pos: [1.1, 1.7, 17.4], look: [1.1, 1.5, 12.5], fov: 58, travel: 1.0 },
  { id: 'entrance', room: 'entrance', level: '1F', pos: [1.0, 1.6, 13.55], look: [5.2, 1.2, 10.8], fov: 64, travel: 0.6, hold: 0.8 },
  { pos: [2.2, 1.6, 12.25], look: [6.2, 1.4, 11.4], travel: 0.45 },
  { id: 'living', room: 'living', level: '1F', pos: [7.35, 1.6, 13.35], look: [3.4, 1.0, 9.6], travel: 0.7, hold: 0.8 },
  { id: 'kitchen', room: 'kitchen', level: '1F', pos: [7.4, 1.6, 7.6], look: [4.0, 1.0, 1.6], travel: 0.9, hold: 0.8 },
  { id: 'stair', room: 'stair1', level: '1F', pos: [2.0, 1.6, 6.55], look: [0.6, 2.9, 10.5], travel: 0.8, hold: 0.5 },
  { pos: [0.65, 1.75, 6.55], look: [0.65, 2.7, 11.0], travel: 0.4 },
  { pos: [0.65, 3.05, 8.3], look: [0.9, 3.75, 12.2], travel: 0.6 },
  { pos: [0.72, 4.45, 10.3], look: [3.0, 4.5, 9.2], travel: 0.6 },
  { pos: [2.25, 4.8, 10.15], look: [3.8, 4.7, 9.45], travel: 0.4 },
  { pos: [2.75, 4.8, 9.45], look: [6, 4.6, 9.45], travel: 0.35 },
  { pos: [3.9, 4.8, 9.45], look: [7, 4.5, 10.5], travel: 0.35 },
  { id: 'master', room: 'master', level: '2F', pos: [7.35, 4.8, 9.0], look: [4.2, 3.9, 12.4], travel: 0.6, hold: 0.9 },
  { id: 'outro', pos: [21, 12.5, 26], look: [3.6, 3.6, 6.4], fov: 36, travel: 1.6, hold: 1.4 },
];

const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createStory() {
  // timeline
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

  // beat -> curve parameter u (index space). Easing spans a whole move between holds,
  // so the camera glides through via-points instead of stopping at each.
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
    const s = u / (NODES.length - 1);
    posCurve.getPoint(Math.min(1, s), _p);
    lookCurve.getPoint(Math.min(1, s), _l);
    const i = Math.floor(u), f = u - i;
    const f0 = NODES[i].fov, f1 = NODES[Math.min(NODES.length - 1, i + 1)].fov;
    camera.fov = f0 + (f1 - f0) * f;
    camera.position.copy(_p);
    camera.lookAt(_l);
    camera.near = Math.min(40, Math.max(0.06, (_p.y - 6) * 0.4));
    camera.updateProjectionMatrix();
    return u;
  }

  // which stop are we "at" (for the room plate)
  function stopAt(beat) {
    for (const n of NODES) {
      if (!n.room) continue;
      if (beat >= n.arrive - 0.25 && beat <= n.depart + 0.2) return n;
    }
    return null;
  }

  // scene events derived from the same beats
  const clamp01 = x => Math.min(1, Math.max(0, x));
  function eventsAt(beat) {
    const plan = byId.plan, aerial = byId.aerial, stair = byId.stair, master = byId.master, outro = byId.outro;
    const climbEnd = NODES[10].arrive;
    return {
      rise1: clamp01((beat - plan.depart) / (aerial.arrive - plan.depart - 0.2)),
      real: clamp01((beat - aerial.arrive - 0.15) / (aerial.depart - aerial.arrive - 0.3)),
      rise2: clamp01((beat - stair.depart + 0.1) / (climbEnd - stair.depart)),
      explode: clamp01((beat - master.depart - outro.travel * 0.45) / (outro.travel * 0.55 + 0.3)),
      phase: beat < plan.depart ? 'hero' : beat < aerial.arrive ? 'rise' : beat < aerial.depart ? 'real' : beat >= outro.arrive - 0.3 ? 'outro' : 'walk',
    };
  }

  // Frame the top-down drawing beside the hero copy (desktop) or below it (phone).
  function layout(aspect) {
    const tanH = Math.tan((NODES[0].fov * Math.PI) / 360);
    const n = NODES[0];
    let d, x = 4, z = 7;
    if (aspect >= 0.95) {
      const visH = 18.8, visW = visH * aspect;
      d = Math.max(visH, 13.5 / Math.max(0.35, aspect - 0.35)) / (2 * tanH);
      const vw = 2 * d * tanH * aspect;
      x = 4 - Math.min(0.17, 0.5 - 6.8 / vw) * vw;
    } else {
      const visH = 30, vw = visH * aspect;
      d = Math.max(visH, 11.5 / aspect) / (2 * tanH);
      z = 7 - 0.17 * (2 * d * tanH);
    }
    n.pos = [x, d, z + 0.6];
    n.look = [x, 0, z];
    posCurve.points[0].set(...n.pos);
    lookCurve.points[0].set(...n.look);
  }

  return { total, cameraAt, stopAt, eventsAt, layout, nodes: NODES };
}
