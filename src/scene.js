// Builds the 3D model from plan data. One global "realism" uniform drives the
// sketch -> finished transition on every material.
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/three-addons/environments/RoomEnvironment.js';
import { wallFrame, wallPieces, bbox } from './plan.js';
import { drawLevel, planFrame } from './drawing.js';
import { tex } from './textures.js';

const REAL = { value: 0 };
const SKETCH_RGB = 'vec3(0.86, 0.872, 0.85)';

function patch(mat) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uReal = REAL;
    shader.fragmentShader = 'uniform float uReal;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb = mix(${SKETCH_RGB}, diffuseColor.rgb, uReal);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.95, roughnessFactor, uReal);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor *= uReal;');
  };
  mat.customProgramCacheKey = () => 'spatial-real';
  return mat;
}

function std(params) { return patch(new THREE.MeshStandardMaterial(params)); }

// Box with UVs measured in metres so textures keep their real scale.
function boxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  return g;
}

const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export function createWorld(plan, renderer) {
  const scene = new THREE.Scene();
  const bgSketch = new THREE.Color('#eceee8');
  const bgReal = new THREE.Color('#d7dfe2');
  scene.background = bgSketch.clone();

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.25;

  const hemi = new THREE.HemisphereLight('#ffffff', '#cfcabf', 2.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1dc', 1.0);
  sun.position.set(4 + 11, 17, 7 + 9);
  sun.target.position.set(4, 0, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 60 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const lineMat = new THREE.LineBasicMaterial({ color: '#1f2328', transparent: true, opacity: 0.9, depthWrite: false });
  const addEdges = (mesh, angle = 25) => {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), lineMat);
    e.raycast = () => {};
    mesh.add(e);
    return mesh;
  };

  // ---------- materials ----------
  const finishMats = {};
  for (const g of plan.finishes) finishMats[g.id] = std({ color: '#ffffff' });
  const M = {
    tile: std({ map: tex('tile'), roughness: 0.3 }),
    fabric: std({ color: '#cfc7b8', map: tex('fabric'), roughness: 0.95 }),
    linen: std({ color: '#f1eee7', map: tex('fabric'), roughness: 0.9 }),
    accent: std({ color: '#9a5b3c', map: tex('fabric'), roughness: 0.9 }),
    wood: std({ color: '#ffffff', map: tex('walnut'), roughness: 0.5 }),
    lightWood: std({ color: '#d8c0a0', map: tex('walnut'), roughness: 0.6 }),
    metal: std({ color: '#2b2d2f', roughness: 0.35, metalness: 0.7 }),
    ceramic: std({ color: '#f4f4f1', roughness: 0.15 }),
    black: std({ color: '#141516', roughness: 0.3 }),
    steel: std({ color: '#c3c6c7', roughness: 0.3, metalness: 0.9 }),
    pot: std({ color: '#7a6f63', roughness: 0.8 }),
    leaf: std({ color: '#566f3e', roughness: 0.8 }),
    trunk: std({ color: '#6b5a48', roughness: 0.9 }),
    shade: std({ color: '#efe6d6', roughness: 0.8, emissive: '#ffcf8a', emissiveIntensity: 0 }),
    ceiling: std({ color: '#f3f1ec', roughness: 0.95 }),
    frame: std({ color: '#3a3d40', roughness: 0.5, metalness: 0.3 }),
    neighbor: std({ color: '#cfccc4', roughness: 0.9 }),
    asphalt: std({ color: '#55585a', roughness: 0.95 }),
  };
  const glass = new THREE.MeshPhysicalMaterial({ color: '#a8c1c8', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });

  // ---------- ground & context ----------
  const site = new THREE.Group();
  scene.add(site);
  const pav = tex('paving').clone(); pav.needsUpdate = true; pav.repeat.set(1 / 4.8, 1 / 4.8);
  const groundMat = std({ map: pav, roughness: 0.9 });
  const ground = new THREE.Mesh(planeXZ(-40, -40, 80, 80), groundMat);
  ground.position.y = -0.005; ground.receiveShadow = true; site.add(ground);
  const road = new THREE.Mesh(planeXZ(-40, 17.5, 80, 7), M.asphalt);
  road.position.y = -0.002; road.receiveShadow = true; site.add(road);
  site.add(makeTree(6.6, 16.3, M), makeTree(10.2, 3.5, M, 0.8));

  // ---------- levels ----------
  const frame = planFrame(plan);
  const levels = {};
  const pendants = [];
  plan.levels.forEach((L, li) => {
    const group = new THREE.Group();
    group.position.y = L.elevation;
    scene.add(group);

    // floors
    for (const r of L.rooms) {
      const mat = r.finish === 'tile' ? M.tile : finishMats.floor;
      const m = new THREE.Mesh(floorGeo(r.polygon), mat);
      m.position.y = 0.002; m.receiveShadow = true; m.userData.room = r.id;
      group.add(m);
    }
    // drawing overlay
    const { canvas } = drawLevel(plan, L, { pxPerM: 128, frame });
    const dTex = new THREE.CanvasTexture(canvas);
    dTex.colorSpace = THREE.SRGBColorSpace; dTex.anisotropy = 8;
    const overlayMat = new THREE.MeshBasicMaterial({ map: dTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(frame.w, frame.h), overlayMat);
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.set(frame.x0 + frame.w / 2, 0.012, frame.z0 + frame.h / 2);
    overlay.renderOrder = 2;
    group.add(overlay);

    const rise = new THREE.Group();
    group.add(rise);

    // walls
    for (const w of L.walls) {
      const { ux, uz, angle } = wallFrame(w);
      for (const p of wallPieces(w, L.height)) {
        const len = p.s1 - p.s0, h = p.y1 - p.y0;
        if (len <= 0.001 || h <= 0.001) continue;
        const m = addEdges(new THREE.Mesh(boxGeo(len, h, w.t), finishMats.paint));
        const s = (p.s0 + p.s1) / 2;
        m.position.set(w.a[0] + ux * s, p.y0 + h / 2, w.a[1] + uz * s);
        m.rotation.y = -angle;
        m.castShadow = m.receiveShadow = true;
        m.userData.wall = w.id;
        rise.add(m);
      }
      for (const o of w.openings || []) {
        if (o.type !== 'window') continue;
        const s = o.offset + o.width / 2, h = o.head - o.sill;
        const cx = w.a[0] + ux * s, cz = w.a[1] + uz * s;
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(o.width, h), glass);
        pane.position.set(cx, o.sill + h / 2, cz); pane.rotation.y = -angle;
        rise.add(pane);
        const bars = [
          [o.width, 0.05, 0, o.sill + 0.025], [o.width, 0.05, 0, o.head - 0.025],
          [0.05, h, -o.width / 2 + 0.025, o.sill + h / 2], [0.05, h, o.width / 2 - 0.025, o.sill + h / 2],
        ];
        if (o.width > 1.4) bars.push([0.04, h, 0, o.sill + h / 2]);
        for (const [bw, bh, off, y] of bars) {
          const b = new THREE.Mesh(boxGeo(bw, bh, 0.07), M.frame);
          b.position.set(cx + ux * off, y, cz + uz * off); b.rotation.y = -angle;
          rise.add(b);
        }
      }
    }

    // ceiling (seen only from below)
    const above = plan.levels[li + 1];
    const ceil = new THREE.Mesh(ceilingGeo(plan.project.footprint, above ? above.voids || [] : []), M.ceiling);
    ceil.position.y = L.height - 0.15;
    rise.add(ceil);

    // stair voids: railing
    for (const v of L.voids || []) {
      const [ax, az] = v.railFrom, [bx, bz] = v.railTo;
      const len = Math.hypot(bx - ax, bz - az);
      const rail = new THREE.Mesh(boxGeo(0.05, 0.05, len), M.metal);
      rail.position.set(ax, 1.0, (az + bz) / 2); rise.add(rail);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.95), glass);
      panel.position.set(ax, 0.5, (az + bz) / 2); panel.rotation.y = Math.PI / 2; rise.add(panel);
      for (let z = az; z <= bz + 0.01; z += len / 4) { const p = new THREE.Mesh(boxGeo(0.04, 1.0, 0.04), M.metal); p.position.set(ax, 0.5, z); rise.add(p); }
    }

    // stairs that start on this level
    for (const st of plan.stairs.filter(s => s.from === L.id)) rise.add(buildStair(st, L.height, finishMats.floor, M, addEdges));

    // furniture
    for (const f of L.furniture) {
      const obj = buildItem(f, { finishMats, M, addEdges });
      obj.position.set(f.x, 0, f.z);
      obj.rotation.y = ((f.rot || 0) * Math.PI) / 180;
      obj.userData.item = f;
      rise.add(obj);
      if (f.kind === 'pendant') {
        const light = new THREE.PointLight('#ffcf94', 0, 7, 1.6);
        light.position.set(f.x, 1.9, f.z);
        rise.add(light); pendants.push(light);
      }
    }

    levels[L.id] = { def: L, group, rise, overlay, overlayMat, riseT: 1, baseY: L.elevation };
  });

  // ---------- state setters ----------
  const state = { real: 0, explode: 0 };
  function setReal(r) {
    state.real = r;
    REAL.value = r;
    const e = smooth(Math.min(1, Math.max(0, r)));
    lineMat.opacity = 0.9 * (1 - e) + 0.0;
    lineMat.visible = lineMat.opacity > 0.01;
    for (const id in levels) levels[id].overlayMat.opacity = 1 - e;
    hemi.intensity = lerp(2.3, 0.75, e);
    sun.intensity = lerp(0.9, 3.2, e);
    scene.environmentIntensity = lerp(0.25, 0.7, e);
    scene.background.copy(bgSketch).lerp(bgReal, e);
    for (const p of pendants) p.intensity = 2.6 * e;
    M.shade.emissiveIntensity = 0.9 * e;
  }
  function setRise(id, t) {
    const L = levels[id]; L.riseT = t;
    L.rise.scale.y = Math.max(0.001, smooth(Math.min(1, Math.max(0, t))));
    L.rise.visible = t > 0.001;
  }
  function setLevelVisible(id, v) { levels[id].group.visible = v; }
  function setExplode(e) {
    state.explode = e;
    plan.levels.forEach((L, i) => { levels[L.id].group.position.y = L.elevation + i * 2.8 * smooth(e); });
  }
  function applyFinish(groupId, optionId) {
    const g = plan.finishes.find(x => x.id === groupId);
    const o = g.options.find(x => x.id === optionId) || g.options[0];
    const m = finishMats[groupId];
    const map = o.tex ? tex(o.tex) : null;
    if (m.map !== map) { m.map = map; m.needsUpdate = true; }
    m.color.set(map ? '#ffffff' : o.color);
    m.roughness = o.rough ?? 0.6;
    m.metalness = o.metal ?? 0;
  }
  for (const [g, o] of Object.entries(plan.defaultFinishes)) applyFinish(g, o);
  setReal(0);

  // things the camera should be able to click (floors)
  const pickables = [];
  scene.traverse(o => { if (o.isMesh && o.userData.room) pickables.push(o); });

  return { scene, levels, frame, sun, setReal, setRise, setLevelVisible, setExplode, applyFinish, state, pickables, lineMat };
}

function planeXZ(x0, z0, w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateX(-Math.PI / 2);
  g.translate(x0 + w / 2, 0, z0 + h / 2);
  const uv = g.attributes.uv; const pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i));
  return g;
}

function floorGeo(poly) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

function ceilingGeo(footprint, voids) {
  const shape = new THREE.Shape(footprint.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const v of voids) shape.holes.push(new THREE.Path(v.polygon.map(([x, z]) => new THREE.Vector2(x, z))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);
  return g;
}

function buildStair(st, rise, treadMat, M, addEdges) {
  const g = new THREE.Group();
  const n = st.risers - 1, r = rise / st.risers, run = (st.zEnd - st.zStart) / n;
  const w = st.x1 - st.x0, cx = (st.x0 + st.x1) / 2;
  for (let i = 0; i < n; i++) {
    const top = (i + 1) * r, h = r + 0.16;
    const m = addEdges(new THREE.Mesh(boxGeo(w, h, run + 0.02), treadMat));
    m.position.set(cx, top - h / 2, st.zStart + (i + 0.5) * run);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  // handrail on the open side
  const len = Math.hypot(st.zEnd - st.zStart, rise);
  const ang = Math.atan2(rise, st.zEnd - st.zStart);
  const rail = new THREE.Mesh(boxGeo(0.045, 0.045, len), M.metal);
  rail.position.set(st.x1 - 0.03, rise / 2 + 0.95, (st.zStart + st.zEnd) / 2);
  rail.rotation.x = -ang;
  g.add(rail);
  for (let i = 1; i < n; i += 3) {
    const y = (i + 1) * r, z = st.zStart + (i + 0.5) * run;
    const p = new THREE.Mesh(boxGeo(0.03, 0.95, 0.03), M.metal);
    p.position.set(st.x1 - 0.03, y + 0.475, z); g.add(p);
  }
  return g;
}

function makeTree(x, z, M, s = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * s, 0.14 * s, 2.6 * s, 8), M.trunk);
  trunk.position.y = 1.3 * s; trunk.castShadow = true; g.add(trunk);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  [[0, 3.1, 0, 1.25], [0.7, 2.7, 0.3, 0.9], [-0.6, 2.8, -0.4, 0.95], [0.1, 3.7, -0.3, 0.8]].forEach(([dx, dy, dz, r]) => {
    const b = new THREE.Mesh(geo, M.leaf); b.position.set(dx * s, dy * s, dz * s); b.scale.setScalar(r * s); b.castShadow = true; g.add(b);
  });
  g.position.set(x, 0, z);
  return g;
}

function part(parent, geo, mat, x, y, z, addEdges, edges = true) {
  const m = new THREE.Mesh(geo, mat);
  if (edges) addEdges(m);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

function buildItem(f, { finishMats, M, addEdges }) {
  const g = new THREE.Group();
  const w = f.w, d = f.d;
  const P = (geo, mat, x, y, z, e) => part(g, geo, mat, x, y, z, addEdges, e);
  switch (f.kind) {
    case 'counter': {
      P(boxGeo(w, 0.1, d - 0.06), M.black, 0, 0.05, -0.02);
      P(boxGeo(w, 0.76, d), finishMats.cabinet, 0, 0.48, 0);
      P(boxGeo(w + 0.02, 0.04, d + 0.03), finishMats.counter, 0, 0.88, 0);
      const doors = Math.max(2, Math.round(w / 0.6));
      for (let i = 1; i < doors; i++) P(boxGeo(0.006, 0.7, 0.01), M.black, -w / 2 + (i * w) / doors, 0.48, d / 2 + 0.003, false);
      if (w > 4) { P(boxGeo(0.6, 0.02, 0.42), M.steel, 0.4, 0.905, 0, false); P(boxGeo(0.6, 0.012, 0.5), M.black, -1.3, 0.905, 0, false); }
      break;
    }
    case 'fridge': P(boxGeo(w, 1.85, d), M.steel, 0, 0.925, 0); P(boxGeo(0.02, 0.6, 0.03), M.black, -w / 2 + 0.08, 1.2, d / 2 + 0.01, false); break;
    case 'table': case 'desk':
      P(boxGeo(w, 0.04, d), M.wood, 0, 0.74, 0);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) P(boxGeo(0.05, 0.72, 0.05), M.metal, sx * (w / 2 - 0.08), 0.36, sz * (d / 2 - 0.08), false);
      break;
    case 'chair':
      P(boxGeo(w, 0.05, d - 0.06), M.lightWood, 0, 0.45, 0.03);
      P(boxGeo(w, 0.42, 0.04), M.lightWood, 0, 0.68, -d / 2 + 0.03);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) P(boxGeo(0.03, 0.45, 0.03), M.metal, sx * (w / 2 - 0.04), 0.225, sz * (d / 2 - 0.06), false);
      break;
    case 'sofa':
      P(boxGeo(w, 0.18, d), M.metal, 0, 0.09, 0, false);
      P(boxGeo(w - 0.36, 0.22, d - 0.22), M.fabric, 0, 0.29, 0.1);
      P(boxGeo(w, 0.6, 0.22), M.fabric, 0, 0.48, -d / 2 + 0.11);
      P(boxGeo(0.18, 0.42, d), M.fabric, -w / 2 + 0.09, 0.39, 0);
      P(boxGeo(0.18, 0.42, d), M.fabric, w / 2 - 0.09, 0.39, 0);
      P(boxGeo(0.45, 0.4, 0.12), M.accent, -w / 2 + 0.5, 0.58, -d / 2 + 0.3, false);
      break;
    case 'coffee': P(boxGeo(w, 0.34, d), M.wood, 0, 0.17, 0); break;
    case 'tvconsole':
      P(boxGeo(w, 0.42, d), M.wood, 0, 0.26, 0);
      P(boxGeo(w * 0.62, 0.72, 0.04), M.black, 0, 1.25, -d / 2 + 0.05);
      break;
    case 'rug': { const m = new THREE.Mesh(boxGeo(w, 0.012, d), M.linen); m.position.y = 0.008; m.receiveShadow = true; g.add(m); break; }
    case 'bed':
      P(boxGeo(w, 0.3, d), M.lightWood, 0, 0.15, 0);
      P(boxGeo(w - 0.04, 0.2, d - 0.08), M.linen, 0, 0.4, 0.03);
      P(boxGeo(w, 1.0, 0.08), M.fabric, 0, 0.5, -d / 2 + 0.04);
      P(boxGeo(w * 0.4, 0.12, 0.3), M.linen, -w * 0.23, 0.56, -d / 2 + 0.3, false);
      P(boxGeo(w * 0.4, 0.12, 0.3), M.linen, w * 0.23, 0.56, -d / 2 + 0.3, false);
      P(boxGeo(w - 0.02, 0.05, d * 0.32), M.accent, 0, 0.52, d / 2 - d * 0.16 - 0.02, false);
      break;
    case 'nightstand': P(boxGeo(w, 0.5, d), M.lightWood, 0, 0.25, 0); P(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 16), M.shade, 0, 0.65, 0, false); break;
    case 'wardrobe': { const h = f.h || 2.3; P(boxGeo(w, h, d), M.lightWood, 0, h / 2, 0); const n = Math.round(w / 0.5); for (let i = 1; i < n; i++) P(boxGeo(0.006, h - 0.1, 0.01), M.black, -w / 2 + (i * w) / n, h / 2, d / 2 + 0.003, false); break; }
    case 'shelf': {
      const h = f.h || 2.0;
      P(boxGeo(w, h, 0.03), M.lightWood, 0, h / 2, -d / 2 + 0.015);
      P(boxGeo(0.03, h, d), M.lightWood, -w / 2 + 0.015, h / 2, 0); P(boxGeo(0.03, h, d), M.lightWood, w / 2 - 0.015, h / 2, 0);
      for (let y = 0.02; y < h; y += h / 5) P(boxGeo(w, 0.03, d), M.lightWood, 0, y, 0, false);
      break;
    }
    case 'shoe': P(boxGeo(w, 1.0, d), finishMats.cabinet, 0, 0.6, 0); break;
    case 'vanity': P(boxGeo(w, 0.5, d), finishMats.cabinet, 0, 0.55, 0); P(boxGeo(w, 0.05, d + 0.02), M.ceramic, 0, 0.82, 0); P(boxGeo(w * 0.7, 0.7, 0.02), M.steel, 0, 1.5, -d / 2 + 0.02, false); break;
    case 'toilet': P(boxGeo(w, 0.4, 0.2), M.ceramic, 0, 0.6, -d / 2 + 0.1); P(new THREE.CylinderGeometry(w / 2, w / 2.4, 0.4, 20), M.ceramic, 0, 0.2, 0.08, false); break;
    case 'tub': P(boxGeo(w, 0.55, d), M.ceramic, 0, 0.275, 0); P(boxGeo(w - 0.14, 0.02, d - 0.14), M.tile, 0, 0.555, 0, false); break;
    case 'plant': {
      P(new THREE.CylinderGeometry(0.2, 0.15, 0.42, 16), M.pot, 0, 0.21, 0, false);
      const geo = new THREE.IcosahedronGeometry(0.34, 1);
      P(geo, M.leaf, 0, 0.85, 0, false); P(geo, M.leaf, 0.12, 1.2, 0.05, false).scale.setScalar(0.7);
      break;
    }
    case 'pendant':
      P(new THREE.CylinderGeometry(0.004, 0.004, 0.9, 4), M.black, 0, 2.6, 0, false);
      P(new THREE.ConeGeometry(0.18, 0.24, 24, 1, true), M.shade, 0, 2.05, 0, false);
      break;
    default: P(boxGeo(w, 0.8, d), M.lightWood, 0, 0.4, 0);
  }
  if (f.kind === 'pendant') g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return g;
}
