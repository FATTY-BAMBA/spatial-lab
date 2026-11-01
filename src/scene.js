// Builds the 3D model from plan data. One global "realism" uniform drives the
// sketch -> finished transition on every material.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wallFrame, wallPieces, bbox, pointInPolygon, polygonArea } from './plan.js';
import { drawLevel, planFrame } from './drawing.js';
import { tex, texSet, bumpTex } from './textures.js';

const REAL = { value: 0 };
const SKETCH_RGB = 'vec3(0.86, 0.872, 0.85)';
const patched = new WeakSet();

function patch(mat) {
  if (patched.has(mat)) return mat;
  patched.add(mat);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev && prev.call(mat, shader, r);
    shader.uniforms.uReal = REAL;
    shader.fragmentShader = 'uniform float uReal;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb = mix(${SKETCH_RGB}, diffuseColor.rgb, uReal);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.95, roughnessFactor, uReal);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor *= uReal;');
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => key() + '|real';
  return mat;
}
const std = p => patch(new THREE.MeshStandardMaterial(p));

// Box with UVs measured in metres so textures keep their real scale.
function boxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
  return g;
}
const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export async function createWorld(plan, renderer, opts = {}) {
  const scene = new THREE.Scene();
  const proj = plan.project;
  const site = proj.site || null;
  const city = !!(site && site.city);
  const bgSketch = new THREE.Color('#eceee8');
  const horizon = new THREE.Color(city ? '#c9d4da' : '#d7dfe2');
  scene.background = bgSketch.clone();

  // ---------- assets ----------
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const modelNames = [...new Set(plan.levels.flatMap(L => L.furniture.filter(f => f.model).map(f => f.model)))];
  const [hdr, ...gltfs] = await Promise.all([
    new RGBELoader().loadAsync('assets/hdri/pedestrian_overpass_1k.hdr').catch(() => null),
    ...modelNames.map(n => loader.loadAsync(`assets/models/${n}.glb`).catch(e => { console.warn('model', n, e); return null; })),
  ]);
  const models = Object.fromEntries(modelNames.map((n, i) => [n, gltfs[i] && gltfs[i].scene]));
  // transmission forces an extra full-scene render each frame; fake glass with opacity instead
  for (const m of Object.values(models)) m && m.traverse(o => {
    if (!o.isMesh) return;
    for (const mat of [].concat(o.material)) if (mat.transmission > 0) { mat.transmission = 0; mat.transparent = true; mat.opacity = 0.28; mat.depthWrite = false; }
  });

  const pmrem = new THREE.PMREMGenerator(renderer);
  if (hdr) { hdr.mapping = THREE.EquirectangularReflectionMapping; scene.environment = pmrem.fromEquirectangular(hdr).texture; hdr.dispose(); }
  scene.environmentIntensity = 0.3;

  // ---------- light ----------
  const fpb = bbox(proj.footprint);
  const center = new THREE.Vector3((fpb.x0 + fpb.x1) / 2, 0, (fpb.z0 + fpb.z1) / 2);
  const sunDir = new THREE.Vector3(...(proj.sun || [0.55, 0.62, 0.55])).normalize();
  const hemi = new THREE.HemisphereLight('#ffffff', '#cfcabf', 2.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff8f0', 1.0);
  sun.position.copy(center).addScaledVector(sunDir, 40);
  sun.target.position.copy(center);
  sun.castShadow = opts.shadows !== false;
  const half = Math.max(fpb.x1 - fpb.x0, fpb.z1 - fpb.z0) / 2 + 5;
  sun.shadow.mapSize.set(opts.shadowSize || 2048, opts.shadowSize || 2048);
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 5, far: 90 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);

  let sky = null;
  if (city) {
    sky = new Sky();
    sky.scale.setScalar(2400);
    const u = sky.material.uniforms;
    u.turbidity.value = 3.2; u.rayleigh.value = 1.3; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(sunDir);
    sky.visible = false;
    scene.add(sky);
  }

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
  finishMats.paint.bumpMap = bumpTex('plaster'); finishMats.paint.bumpScale = 0.6;
  const tileSet = texSet('tile'), balSet = texSet('balcony');
  const M = {
    tile: std({ map: tileSet.map, bumpMap: tileSet.bumpMap, bumpScale: 1.2, roughness: 0.25 }),
    balcony: std({ map: balSet.map, bumpMap: balSet.bumpMap, bumpScale: 1.5, roughness: 0.8 }),
    fabric: std({ color: '#cfc7b8', map: tex('fabric'), roughness: 0.95 }),
    linen: std({ color: '#f1eee7', map: tex('fabric'), roughness: 0.9 }),
    duvet: std({ color: '#e9e4da', map: tex('fabric'), roughness: 0.95 }),
    accent: std({ color: '#9a5b3c', map: tex('fabric'), roughness: 0.9 }),
    upholster: std({ color: '#b9ad9c', map: tex('fabric'), roughness: 0.95 }),
    wood: std({ color: '#ffffff', map: tex('walnut'), roughness: 0.5 }),
    lightWood: std({ color: '#e2cdb0', map: tex('walnut'), roughness: 0.6 }),
    oakSlat: std({ color: '#d9bf9b', map: tex('walnut'), roughness: 0.55 }),
    metal: std({ color: '#2b2d2f', roughness: 0.35, metalness: 0.7 }),
    brass: std({ color: '#b08d57', roughness: 0.3, metalness: 1.0 }),
    ceramic: std({ color: '#f4f4f1', roughness: 0.12 }),
    black: std({ color: '#141516', roughness: 0.3 }),
    screen: std({ color: '#0d0e10', roughness: 0.08, metalness: 0.2 }),
    steel: std({ color: '#c3c6c7', roughness: 0.3, metalness: 0.9 }),
    alu: std({ color: '#5d6266', roughness: 0.4, metalness: 0.75 }),
    stone: std({ color: '#d8d4cc', map: tex('quartz'), roughness: 0.35 }),
    marbleTop: std({ color: '#ffffff', map: tex('marble'), roughness: 0.15 }),
    pot: std({ color: '#7a6f63', roughness: 0.8 }),
    leaf: std({ color: '#566f3e', roughness: 0.8 }),
    trunk: std({ color: '#6b5a48', roughness: 0.9 }),
    shade: std({ color: '#efe6d6', roughness: 0.8, emissive: '#ffcf8a', emissiveIntensity: 0 }),
    led: std({ color: '#fff7ea', emissive: '#ffe2b8', emissiveIntensity: 0 }),
    ceiling: std({ color: '#f5f3ef', roughness: 0.95 }),
    trim: std({ color: '#f2f0eb', roughness: 0.5 }),
    door: std({ color: '#e8e4dc', roughness: 0.55 }),
    steelDoor: std({ color: '#3a3d41', roughness: 0.45, metalness: 0.4 }),
    frame: std({ color: '#3a3d40', roughness: 0.45, metalness: 0.5 }),
    concrete: std({ color: '#c9c6bf', roughness: 0.9 }),
    asphalt: std({ color: '#5a5d60', roughness: 0.95 }),
    facade: std({ color: '#ffffff', map: tex('facade'), roughness: 0.6, envMapIntensity: 0.6 }),
    roof: std({ color: '#9fa09c', roughness: 0.95 }),
    white: std({ color: '#f1f1ef', roughness: 0.4 }),
  };
  const glass = patch(new THREE.MeshPhysicalMaterial({ color: '#a9bfc5', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6 }));
  const sheer = patch(new THREE.MeshStandardMaterial({ color: '#f6f3ec', map: tex('fabric'), transparent: true, opacity: 0.62, side: THREE.DoubleSide, roughness: 1, depthWrite: false }));
  const curtainMat = std({ color: '#cbbfae', map: tex('fabric'), side: THREE.DoubleSide, roughness: 1 });

  // ---------- site ----------
  const siteG = new THREE.Group();
  scene.add(siteG);
  let cityG = null;
  if (site) {
    const ground = -(site.floor * site.floorHeight);
    const [tx0, tz0, tx1, tz1] = site.towerBox;
    const slab = new THREE.Mesh(boxGeo(tx1 - tx0, 0.25, tz1 - tz0), M.concrete);
    slab.position.set((tx0 + tx1) / 2, -0.126, (tz0 + tz1) / 2); slab.receiveShadow = true; siteG.add(slab);
    if (city) {
      cityG = buildCity(ground, [tx0, tz0, tx1, tz1], M);
      cityG.visible = false;
      scene.add(cityG);
      scene.fog = new THREE.Fog(horizon.clone(), 70, 520);
    }
  } else {
    const pav = tex('paving').clone(); pav.needsUpdate = true; pav.repeat.set(1 / 4.8, 1 / 4.8);
    const pb = bumpTex('paving');
    const ground = new THREE.Mesh(planeXZ(-40, -40, 80, 80), std({ map: pav, bumpMap: pb, bumpScale: 1, roughness: 0.9 }));
    ground.position.y = -0.005; ground.receiveShadow = true; siteG.add(ground);
    const road = new THREE.Mesh(planeXZ(-40, 17.5, 80, 7), M.asphalt);
    road.position.y = -0.002; road.receiveShadow = true; siteG.add(road);
    siteG.add(makeTree(6.6, 16.3, M), makeTree(10.2, 3.5, M, 0.8));
  }

  // ---------- levels ----------
  const frame = planFrame(plan);
  const levels = {};
  const ceilings = [];
  const glows = [];
  plan.levels.forEach((L, li) => {
    const group = new THREE.Group();
    group.position.y = L.elevation;
    scene.add(group);
    const H = L.height;
    const ceilY = H - 0.15;

    for (const r of L.rooms) {
      const mat = r.finish === 'tile' ? M.tile : r.finish === 'balcony' ? M.balcony : finishMats.floor;
      const m = new THREE.Mesh(floorGeo(r.polygon), mat);
      m.position.y = 0.002; m.receiveShadow = true; m.userData.room = r.id;
      group.add(m);
    }
    const { canvas } = drawLevel(plan, L, { pxPerM: 128, frame });
    const dTex = new THREE.CanvasTexture(canvas);
    dTex.colorSpace = THREE.SRGBColorSpace; dTex.anisotropy = 8;
    const overlayMat = new THREE.MeshBasicMaterial({ map: dTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(frame.w, frame.h), overlayMat);
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.set(frame.x0 + frame.w / 2, 0.012, frame.z0 + frame.h / 2);
    overlay.renderOrder = 2;
    group.add(overlay);

    const rise = new THREE.Group();
    group.add(rise);

    // walls, skirting, openings
    for (const w of L.walls) {
      const { ux, uz, angle, len } = wallFrame(w);
      const nx = -uz, nz = ux;
      for (const p of wallPieces(w, H)) {
        const plen = p.s1 - p.s0, h = p.y1 - p.y0;
        if (plen <= 0.001 || h <= 0.001) continue;
        const m = addEdges(new THREE.Mesh(boxGeo(plen, h, w.t), finishMats.paint));
        const s = (p.s0 + p.s1) / 2;
        m.position.set(w.a[0] + ux * s, p.y0 + h / 2, w.a[1] + uz * s);
        m.rotation.y = -angle;
        m.castShadow = m.receiveShadow = true;
        rise.add(m);
        if (p.y0 === 0 && !w.outdoor) {
          const sk = new THREE.Mesh(boxGeo(plen, 0.08, w.t + 0.024), M.trim);
          sk.position.set(m.position.x, 0.04, m.position.z); sk.rotation.y = -angle; sk.receiveShadow = true;
          rise.add(sk);
        }
      }
      for (const o of w.openings || []) {
        const s = o.offset + o.width / 2, h = o.head - o.sill;
        const cx = w.a[0] + ux * s, cz = w.a[1] + uz * s;
        const at = (off, y, depthOff = 0) => [cx + ux * off + nx * depthOff, y, cz + uz * off + nz * depthOff];
        const put = (geo, mat, off, y, dOff = 0, shadow = false) => {
          const b = new THREE.Mesh(geo, mat); b.position.set(...at(off, y, dOff)); b.rotation.y = -angle;
          b.castShadow = shadow; b.receiveShadow = true; rise.add(b); return b;
        };
        if (o.type === 'window') {
          put(new THREE.PlaneGeometry(o.width, h), glass, 0, o.sill + h / 2);
          const bars = [[o.width, 0.05, 0, o.sill + 0.025], [o.width, 0.05, 0, o.head - 0.025], [0.05, h, -o.width / 2 + 0.025, o.sill + h / 2], [0.05, h, o.width / 2 - 0.025, o.sill + h / 2]];
          if (o.width > 1.2) bars.push([0.04, h, 0, o.sill + h / 2]);
          for (const [bw, bh, off, y] of bars) put(boxGeo(bw, bh, 0.07), M.frame, off, y);
          if (o.sill > 0.3) put(boxGeo(o.width + 0.08, 0.03, w.t + 0.05), M.stone, 0, o.sill - 0.015, 0, true);
        } else if (o.type === 'slider') {
          const n = o.panels || 2, pw = o.width / n + 0.04;
          // panels slid open: half stacked to each end (or all to one end for 2 panels)
          for (let i = 0; i < n; i++) {
            const left = n === 2 ? true : i < n / 2;
            const k = n === 2 ? i : left ? i : i - n / 2;
            const off = left ? -o.width / 2 + pw / 2 + k * 0.02 : o.width / 2 - pw / 2 - k * 0.02;
            const dOff = (k % 2 ? 1 : -1) * w.t * 0.22;
            put(new THREE.PlaneGeometry(pw - 0.06, h - 0.08), glass, off, o.sill + h / 2, dOff);
            for (const [bw, bh, x, y] of [[pw, 0.05, 0, o.sill + 0.025], [pw, 0.05, 0, o.head - 0.025], [0.045, h, -pw / 2 + 0.022, o.sill + h / 2], [0.045, h, pw / 2 - 0.022, o.sill + h / 2]]) put(boxGeo(bw, bh, 0.045), M.alu, off + x, y, dOff);
          }
          put(boxGeo(o.width, 0.03, w.t + 0.02), M.alu, 0, 0.015);
          put(boxGeo(o.width, 0.05, w.t + 0.02), M.alu, 0, o.head - 0.025);
        } else if (o.type === 'door') {
          const cas = 0.06;
          for (const side of [-1, 1]) {
            put(boxGeo(cas, o.head + cas, w.t + 0.03), M.trim, side * (o.width / 2 + cas / 2), (o.head + cas) / 2);
          }
          put(boxGeo(o.width + cas * 2, cas, w.t + 0.03), M.trim, 0, o.head + cas / 2);
          // open leaf, hinged at the start of the opening, swung 92 degrees into the smaller room
          const side = doorSide(L.rooms, w, cx, cz, nx, nz);
          const leafW = o.width - 0.03;
          const leaf = new THREE.Group();
          const mat = o.main ? M.steelDoor : o.glazed ? M.alu : M.door;
          const panel = new THREE.Mesh(boxGeo(leafW, o.head - 0.02, 0.04), mat);
          panel.position.set(leafW / 2, (o.head - 0.02) / 2, 0); panel.castShadow = true; panel.receiveShadow = true;
          leaf.add(panel);
          if (o.glazed) { const gl = new THREE.Mesh(new THREE.PlaneGeometry(leafW - 0.16, o.head - 0.5), glass); gl.position.set(leafW / 2, o.head / 2 + 0.1, 0.025); leaf.add(gl); }
          const handle = new THREE.Mesh(boxGeo(0.12, 0.02, 0.03), M.steel);
          handle.position.set(leafW - 0.08, 1.0, side * 0.04); leaf.add(handle);
          const hx = w.a[0] + ux * o.offset + nx * side * 0.0, hz = w.a[1] + uz * o.offset + nz * side * 0.0;
          leaf.position.set(hx + nx * side * (w.t / 2), 0.01, hz + nz * side * (w.t / 2));
          leaf.rotation.y = -angle - side * (Math.PI / 2) * 1.02;
          rise.add(leaf);
        }
      }
    }

    // railings
    for (const rl of L.railings || []) {
      const dx = rl.b[0] - rl.a[0], dz = rl.b[1] - rl.a[1], rlen = Math.hypot(dx, dz), ang = Math.atan2(dz, dx);
      const mx = (rl.a[0] + rl.b[0]) / 2, mz = (rl.a[1] + rl.b[1]) / 2;
      if (rl.solid) {
        const m = addEdges(new THREE.Mesh(boxGeo(rlen, rl.h, 0.15), finishMats.paint));
        m.position.set(mx, rl.h / 2, mz); m.rotation.y = -ang; m.castShadow = m.receiveShadow = true; rise.add(m);
      } else {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(rlen, rl.h - 0.08), glass);
        p.position.set(mx, (rl.h - 0.08) / 2 + 0.04, mz); p.rotation.y = -ang; rise.add(p);
        const cap = new THREE.Mesh(boxGeo(rlen + 0.04, 0.05, 0.07), M.alu);
        cap.position.set(mx, rl.h, mz); cap.rotation.y = -ang; cap.castShadow = true; rise.add(cap);
        const base = new THREE.Mesh(boxGeo(rlen, 0.08, 0.1), M.alu);
        base.position.set(mx, 0.04, mz); base.rotation.y = -ang; rise.add(base);
      }
    }

    // ceilings (cast shadows only while the camera is inside, so sun enters through windows)
    const above = plan.levels[li + 1];
    const interior = L.rooms.filter(r => !r.outdoor);
    const ceil = new THREE.Mesh(ceilingGeo(proj.footprint, above ? above.voids || [] : []), M.ceiling);
    ceil.position.y = ceilY; ceil.receiveShadow = true;
    rise.add(ceil); ceilings.push(ceil);
    for (const r of L.rooms.filter(r => r.outdoor)) {
      const c = new THREE.Mesh(ceilingGeo(r.polygon, []), M.concrete);
      c.position.y = H - 0.05; rise.add(c); ceilings.push(c);
    }

    // coves (dropped ceiling band with LED) and downlights
    for (const r of interior) {
      if (r.cove) buildCove(r.polygon, ceilY, rise, M, glows);
      for (const p of downlightPoints(r)) {
        const d = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), M.led);
        d.rotation.x = Math.PI / 2;
        d.position.set(p[0], (r.cove ? ceilY - 0.3 : ceilY) - 0.002, p[1]);
        rise.add(d);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.06, 20), M.white);
        ring.rotation.x = Math.PI / 2; ring.position.copy(d.position); ring.position.y -= 0.001; rise.add(ring);
      }
    }

    for (const v of L.voids || []) {
      const [ax, az] = v.railFrom, [bx, bz] = v.railTo;
      const len = Math.hypot(bx - ax, bz - az);
      const rail = new THREE.Mesh(boxGeo(0.05, 0.05, len), M.metal);
      rail.position.set(ax, 1.0, (az + bz) / 2); rise.add(rail);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.95), glass);
      panel.position.set(ax, 0.5, (az + bz) / 2); panel.rotation.y = Math.PI / 2; rise.add(panel);
      for (let z = az; z <= bz + 0.01; z += len / 4) { const p = new THREE.Mesh(boxGeo(0.04, 1.0, 0.04), M.metal); p.position.set(ax, 0.5, z); rise.add(p); }
    }

    for (const st of plan.stairs.filter(s => s.from === L.id)) rise.add(buildStair(st, H, finishMats.floor, M, addEdges));

    for (const f of L.furniture) {
      const obj = buildItem(f, { finishMats, M, addEdges, models, glass, sheer, curtainMat, ceilY, glows });
      obj.position.set(f.x, f.y || 0, f.z);
      obj.rotation.y = ((f.rot || 0) * Math.PI) / 180;
      rise.add(obj);
    }

    levels[L.id] = { def: L, group, rise, overlay, overlayMat, riseT: 1 };
  });

  // a few warm fill lights in the main rooms
  const fills = [];
  const mainRooms = plan.levels.flatMap(L => L.rooms.filter(r => !r.outdoor && !r.circulation && polygonArea(r.polygon) > 12).map(r => ({ r, L }))).slice(0, 4);
  for (const { r, L } of mainRooms) {
    const b = bbox(r.polygon);
    const l = new THREE.PointLight('#fff0dc', 0, 7, 1.8);
    l.position.set((b.x0 + b.x1) / 2, L.elevation + L.height - 0.6, (b.z0 + b.z1) / 2);
    scene.add(l); fills.push(l);
  }

  // ---------- state ----------
  const state = { real: 0, explode: 0, interior: false };
  function setReal(r) {
    state.real = r;
    REAL.value = r;
    const e = smooth(Math.min(1, Math.max(0, r)));
    lineMat.opacity = 0.9 * (1 - e);
    lineMat.visible = lineMat.opacity > 0.01;
    for (const id in levels) levels[id].overlayMat.opacity = 1 - e;
    hemi.intensity = lerp(2.3, state.interior ? 0.75 : 0.55, e);
    sun.intensity = lerp(0.9, 2.9, e);
    scene.environmentIntensity = lerp(0.25, state.interior ? 1.05 : 0.55, e);
    if (sky) {
      sky.visible = e > 0.35;
      if (cityG) cityG.visible = e > 0.02;
      scene.background = sky.visible ? null : bgSketch.clone().lerp(horizon, Math.min(1, e / 0.35));
    } else {
      if (!scene.background) scene.background = new THREE.Color();
      scene.background.copy(bgSketch).lerp(new THREE.Color('#d7dfe2'), e);
    }
    if (scene.fog) { scene.fog.near = lerp(400, 70, e); scene.fog.far = lerp(2000, 520, e); }
    M.led.emissiveIntensity = 2.2 * e;
    M.shade.emissiveIntensity = 1.1 * e;
    for (const g of glows) g.material.emissiveIntensity = 2.4 * e;
    for (const f of fills) f.intensity = (state.interior ? 2.4 : 1.0) * e;
  }
  function setInterior(v) {
    if (v === state.interior) return;
    state.interior = v;
    for (const c of ceilings) c.castShadow = v;
    setReal(state.real);
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
    const set = o.tex ? texSet(o.tex) : { map: null, bumpMap: groupId === 'paint' ? bumpTex('plaster') : null, roughnessMap: null };
    if (m.map !== set.map || m.bumpMap !== set.bumpMap || m.roughnessMap !== set.roughnessMap) {
      m.map = set.map; m.bumpMap = set.bumpMap; m.roughnessMap = set.roughnessMap;
      m.bumpScale = groupId === 'paint' ? 0.6 : 1.4;
      m.needsUpdate = true;
    }
    m.color.set(set.map ? '#ffffff' : o.color);
    m.roughness = set.roughnessMap ? 1 : o.rough ?? 0.6;
    m.metalness = o.metal ?? 0;
  }
  for (const [g, o] of Object.entries(plan.defaultFinishes)) applyFinish(g, o);
  setReal(0);

  return { scene, levels, frame, sun, setReal, setRise, setLevelVisible, setExplode, setInterior, applyFinish, state, lineMat };
}

// ---------------------------------------------------------------------------

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

function ceilingGeo(outline, voids) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const v of voids) shape.holes.push(new THREE.Path(v.polygon.map(([x, z]) => new THREE.Vector2(x, z))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);
  return g;
}

function doorSide(rooms, w, mx, mz, nx, nz) {
  const p1 = [mx + nx * 0.4, mz + nz * 0.4], p2 = [mx - nx * 0.4, mz - nz * 0.4];
  const r1 = rooms.find(r => pointInPolygon(p1, r.polygon));
  const r2 = rooms.find(r => pointInPolygon(p2, r.polygon));
  if (w.ext) return r1 && !r1.outdoor ? 1 : -1;
  if (!r1) return -1;
  if (!r2) return 1;
  return polygonArea(r1.polygon) <= polygonArea(r2.polygon) ? 1 : -1;
}

function edgesInward(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    let nx = -dz / len, nz = dx / len;
    const mid = [(a[0] + b[0]) / 2 + nx * 0.2, (a[1] + b[1]) / 2 + nz * 0.2];
    if (!pointInPolygon(mid, poly)) { nx = -nx; nz = -nz; }
    out.push({ a, b, len, ux: dx / len, uz: dz / len, nx, nz });
  }
  return out;
}

function buildCove(poly, ceilY, parent, M, glows) {
  const band = 0.42, drop = 0.3, gap = 0.1;
  const ledMat = M.led.clone(); patch(ledMat); glows.push({ material: ledMat });
  for (const e of edgesInward(poly)) {
    const cx = (e.a[0] + e.b[0]) / 2 + e.nx * band / 2, cz = (e.a[1] + e.b[1]) / 2 + e.nz * band / 2;
    const ang = Math.atan2(e.uz, e.ux);
    const box = new THREE.Mesh(boxGeo(e.len, drop - gap, band), M.ceiling);
    box.position.set(cx, ceilY - drop + (drop - gap) / 2, cz); box.rotation.y = -ang; box.castShadow = false; box.receiveShadow = true;
    parent.add(box);
    const led = new THREE.Mesh(boxGeo(e.len - band * 2 + 0.02, 0.015, 0.03), ledMat);
    led.position.set((e.a[0] + e.b[0]) / 2 + e.nx * (band - 0.02), ceilY - gap - 0.005, (e.a[1] + e.b[1]) / 2 + e.nz * (band - 0.02));
    led.rotation.y = -ang; parent.add(led);
  }
}

function downlightPoints(r) {
  if (r.outdoor) return [];
  const pts = [];
  if (r.cove) {
    for (const e of edgesInward(r.polygon)) {
      const n = Math.max(1, Math.floor(e.len / 1.3));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const p = [e.a[0] + (e.b[0] - e.a[0]) * t + e.nx * 0.22, e.a[1] + (e.b[1] - e.a[1]) * t + e.nz * 0.22];
        if (t * e.len > 0.5 && (1 - t) * e.len > 0.5) pts.push(p);
      }
    }
    return pts;
  }
  const b = bbox(r.polygon);
  const nx = Math.max(1, Math.round((b.x1 - b.x0) / 1.5)), nz = Math.max(1, Math.round((b.z1 - b.z0) / 1.5));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const p = [b.x0 + ((i + 0.5) * (b.x1 - b.x0)) / nx, b.z0 + ((j + 0.5) * (b.z1 - b.z0)) / nz];
    if (pointInPolygon(p, r.polygon)) pts.push(p);
  }
  return pts;
}

function buildCity(ground, tower, M) {
  const g = new THREE.Group();
  const r = rng(2026);
  const side = [], top = [];
  function building(x0, z0, x1, z1, h, tint = 1) {
    const y0 = ground, y1 = ground + h;
    const w = x1 - x0, d = z1 - z0;
    const faces = [
      [[x0, z1], [x1, z1], w], [[x1, z1], [x1, z0], d], [[x1, z0], [x0, z0], w], [[x0, z0], [x0, z1], d],
    ];
    const uo = r() * 12;
    for (const [[ax, az], [bx, bz], len] of faces) {
      side.push([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az], [uo, 0, uo + len, 0, uo + len, h, uo, h], tint);
    }
    top.push([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], [0, 0, 1, 0, 1, 1, 0, 1], tint);
  }
  const [tx0, tz0, tx1, tz1] = tower;
  building(tx0, tz0, tx1, tz1, -ground - 0.25, 0.95);
  // streets every 46 m; the view side (+x, +z) stays open, taller towers further out
  const cx = (tx0 + tx1) / 2, cz = (tz0 + tz1) / 2;
  for (let bx = -7; bx <= 7; bx++) for (let bz = -7; bz <= 7; bz++) {
    const X0 = bx * 46 - 17, Z0 = bz * 46 - 12;
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const w = 12 + r() * 14, d = 12 + r() * 14;
      const x = X0 + 3 + r() * (32 - w), z = Z0 + 3 + r() * (32 - d);
      const mx = x + w / 2 - cx, mz = z + d / 2 - cz;
      const dist = Math.hypot(mx, mz);
      const front = mz > 0 || mx > 0;
      if (dist < (front ? 75 : 30)) continue;
      const near = Math.min(1, (dist - 30) / 220);
      const h = 10 + r() * (18 + near * 70) + (front ? 0 : 6);
      const cap = -ground + (front ? 2 : -4) + near * 70;
      const H = Math.max(8, Math.min(h, cap));
      const glassy = r() < 0.4;
      building(x, z, x + w, z + d, H, glassy ? -(0.75 + r() * 0.25) : 0.72 + r() * 0.3);
      if (H > 30 && r() < 0.5) building(x + w * 0.2, z + d * 0.2, x + w * 0.8, z + d * 0.8, H + 4 + r() * 8, glassy ? -0.9 : 0.85);
    }
  }
  // Taipei-basin style mountain ring far out, softened by fog
  {
    const pos = [], idx = [], N = 96;
    const rr = rng(7);
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const R = 700 + rr() * 120;
      const hgt = 70 + 110 * Math.abs(Math.sin(a * 2.3 + 1)) + rr() * 40;
      pos.push(cx + Math.cos(a) * R, ground - 5, cz + Math.sin(a) * R, cx + Math.cos(a) * (R - 60), ground + hgt, cz + Math.sin(a) * (R - 60));
      if (i < N) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mtn = new THREE.Mesh(geo, std({ color: '#6f7d74', roughness: 1, side: THREE.DoubleSide }));
    g.add(mtn);
  }
  const mk = (list, mat) => {
    const pos = [], uv = [], idx = [], col = [];
    for (let i = 0; i < list.length; i += 3) {
      const p = list[i], u = list[i + 1], t = list[i + 2], base = pos.length / 3;
      pos.push(...p); uv.push(...u);
      for (let k = 0; k < 4; k++) col.push(t, t * 1.0, t * 1.02);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; return m;
  };
  const sideMat = M.facade; sideMat.side = THREE.DoubleSide; sideMat.vertexColors = true; M.roof.vertexColors = true;
  const conc = [], gl = [];
  for (let i = 0; i < side.length; i += 3) (side[i + 2] < 0 ? gl : conc).push(side[i], side[i + 1], Math.abs(side[i + 2]));
  const topAbs = []; for (let i = 0; i < top.length; i += 3) topAbs.push(top[i], top[i + 1], Math.abs(top[i + 2]));
  const glassMat = std({ color: '#ffffff', map: tex('curtainwall'), roughness: 0.12, metalness: 0.55, vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 1.2 });
  g.add(mk(conc, sideMat), mk(gl, glassMat), mk(topAbs, M.roof));
  const groundM = new THREE.Mesh(planeXZ(-400, -400, 800, 800), M.asphalt);
  groundM.position.y = ground; g.add(groundM);
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

function buildItem(f, ctx) {
  const { finishMats, M, addEdges, models, glass, sheer, curtainMat, ceilY, glows } = ctx;
  const g = new THREE.Group();
  const w = f.w, d = f.d;
  const P = (geo, mat, x, y, z, e = true) => {
    const m = new THREE.Mesh(geo, mat);
    if (e) addEdges(m);
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
  };
  const doorLines = (n, h, y, depth, x0 = -w / 2, ww = w) => { for (let i = 1; i < n; i++) P(boxGeo(0.005, h, 0.006), M.black, x0 + (i * ww) / n, y, depth, false); };
  switch (f.kind) {
    case 'model': {
      const src = models[f.model];
      if (!src) { P(boxGeo(w, 0.6, d), M.lightWood, 0, 0.3, 0); break; }
      const m = src.clone(true);
      m.scale.setScalar(f.scale || 1);
      m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; (Array.isArray(o.material) ? o.material : [o.material]).forEach(patch); } });
      g.add(m);
      break;
    }
    case 'counter': {
      P(boxGeo(w, 0.1, d - 0.06), M.black, 0, 0.05, -0.03, false);
      P(boxGeo(w, 0.76, d), finishMats.cabinet, 0, 0.48, 0);
      P(boxGeo(w + 0.02, 0.04, d + 0.03), finishMats.counter, 0, 0.88, 0.005);
      doorLines(Math.max(2, Math.round(w / 0.6)), 0.7, 0.48, d / 2 + 0.003);
      P(boxGeo(w, 0.006, 0.006), M.black, 0, 0.72, d / 2 + 0.003, false);
      if (f.sink || (w > 4)) { P(boxGeo(0.62, 0.012, 0.42), M.steel, w > 4 ? 0.4 : -0.15, 0.903, 0, false); P(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 8), M.steel, (w > 4 ? 0.4 : -0.15), 1.06, -d / 2 + 0.08, false); }
      if (f.hob || (w > 4)) P(boxGeo(0.62, 0.008, 0.5), M.screen, w > 4 ? -1.3 : 0.1, 0.902, 0, false);
      break;
    }
    case 'uppercab': P(boxGeo(w, 0.7, d), finishMats.cabinet, 0, 1.85, -0.0); doorLines(Math.max(2, Math.round(w / 0.5)), 0.68, 1.85, d / 2 + 0.003); break;
    case 'hood': P(boxGeo(w, 0.1, d), M.steel, 0, 1.62, 0); P(boxGeo(0.28, ceilY - 1.67, 0.26), M.steel, 0, (ceilY + 1.67) / 2, -d / 2 + 0.13, false); break;
    case 'tallcab': {
      const h = f.h || 2.4;
      P(boxGeo(w, 0.95, d), finishMats.cabinet, 0, 0.475 + 0.08, 0);
      P(boxGeo(w, h - 1.3, d), finishMats.cabinet, 0, 1.3 + (h - 1.3) / 2, 0);
      P(boxGeo(w, 0.3, 0.02), M.lightWood, 0, 1.18, -d / 2 + 0.01, false);
      P(boxGeo(w, 0.02, d), M.lightWood, 0, 1.04, 0, false);
      const strip = P(boxGeo(w - 0.04, 0.008, 0.02), M.led, 0, 1.293, d / 2 - 0.05, false); strip.castShadow = false;
      doorLines(Math.round(w / 0.48), 0.9, 0.555, d / 2 + 0.003); doorLines(Math.round(w / 0.48), h - 1.34, 1.3 + (h - 1.3) / 2, d / 2 + 0.003);
      break;
    }
    case 'sideboard': P(boxGeo(w, 0.62, d), finishMats.cabinet, 0, 0.43, 0); P(boxGeo(w + 0.02, 0.03, d + 0.02), M.stone, 0, 0.755, 0); for (const sx of [-1, 1]) P(boxGeo(0.03, 0.12, 0.03), M.metal, sx * (w / 2 - 0.06), 0.06, 0, false); doorLines(3, 0.6, 0.43, d / 2 + 0.003); break;
    case 'fridge': P(rbox(w, 1.85, d, 0.02), M.steel, 0, 0.925, 0); P(boxGeo(0.02, 0.6, 0.03), M.black, -w / 2 + 0.08, 1.2, d / 2 + 0.01, false); P(boxGeo(w, 0.005, 0.01), M.black, 0, 1.25, d / 2 + 0.002, false); break;
    case 'table': case 'desk':
      P(rbox(w, 0.04, d, 0.012), f.kind === 'desk' ? M.lightWood : M.wood, 0, 0.74, 0);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) P(boxGeo(0.04, 0.72, 0.04), M.metal, sx * (w / 2 - 0.1), 0.36, sz * (d / 2 - 0.08), false);
      break;
    case 'roundtable': {
      const top = new THREE.CylinderGeometry(w / 2, w / 2, 0.035, 48);
      P(top, M.marbleTop, 0, 0.4, 0, false);
      P(new THREE.CylinderGeometry(0.16, 0.22, 0.38, 32), M.metal, 0, 0.19, 0, false);
      break;
    }
    case 'chair':
      P(rbox(w, 0.06, d - 0.06, 0.02), M.upholster, 0, 0.46, 0.03);
      P(rbox(w, 0.4, 0.05, 0.02), M.upholster, 0, 0.7, -d / 2 + 0.04);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) P(new THREE.CylinderGeometry(0.014, 0.011, 0.45, 8), M.lightWood, sx * (w / 2 - 0.05), 0.225, sz * (d / 2 - 0.07), false);
      break;
    case 'sofa':
      P(boxGeo(w, 0.18, d), M.metal, 0, 0.09, 0, false);
      P(rbox(w - 0.36, 0.22, d - 0.22, 0.06), M.fabric, 0, 0.29, 0.1);
      P(rbox(w, 0.6, 0.22, 0.06), M.fabric, 0, 0.48, -d / 2 + 0.11);
      P(rbox(0.18, 0.42, d, 0.05), M.fabric, -w / 2 + 0.09, 0.39, 0);
      P(rbox(0.18, 0.42, d, 0.05), M.fabric, w / 2 - 0.09, 0.39, 0);
      P(rbox(0.45, 0.4, 0.12, 0.05), M.accent, -w / 2 + 0.5, 0.58, -d / 2 + 0.3, false);
      break;
    case 'coffee': P(rbox(w, 0.34, d, 0.02), M.wood, 0, 0.17, 0); break;
    case 'tvconsole':
      P(boxGeo(w, 0.36, d), finishMats.cabinet ? M.wood : M.wood, 0, 0.3, 0);
      if (!f.noTv) P(boxGeo(w * 0.62, 0.72, 0.04), M.screen, 0, 1.25, -d / 2 + 0.05);
      break;
    case 'tvwall': {
      const h = Math.min(2.5, ceilY - 0.32), slats = [];
      for (let x = -w / 2 + 0.03; x < w / 2; x += 0.07) { const s = boxGeo(0.045, h, 0.03); s.translate(x, h / 2, 0.015); slats.push(s); }
      const panel = new THREE.Mesh(mergeGeometries(slats), M.oakSlat); panel.castShadow = panel.receiveShadow = true; g.add(panel);
      P(boxGeo(w, h, 0.01), M.black, 0, h / 2, -0.005, false);
      P(boxGeo(1.46, 0.84, 0.035), M.screen, 0, 1.38, 0.06, false);
      break;
    }
    case 'rug': { const m = new THREE.Mesh(rbox(w, 0.012, d, 0.005), M.linen); m.position.y = 0.008; m.receiveShadow = true; g.add(m); break; }
    case 'bed':
      P(boxGeo(w, 0.28, d), M.lightWood, 0, 0.14, 0);
      P(rbox(w - 0.04, 0.22, d - 0.08, 0.07), M.duvet, 0, 0.39, 0.03);
      P(rbox(w * 0.42, 0.14, 0.36, 0.06), M.linen, -w * 0.23, 0.56, -d / 2 + 0.3, false);
      P(rbox(w * 0.42, 0.14, 0.36, 0.06), M.linen, w * 0.23, 0.56, -d / 2 + 0.3, false);
      P(rbox(w - 0.0, 0.05, d * 0.3, 0.02), M.accent, 0, 0.51, d / 2 - d * 0.15 - 0.03, false);
      if (!f.noHead) P(rbox(w, 1.0, 0.08, 0.03), M.upholster, 0, 0.5, -d / 2 + 0.04);
      break;
    case 'headboard': P(rbox(w, 1.15, 0.08, 0.03), M.upholster, 0, 0.6, 0); for (let i = 1; i < 6; i++) P(boxGeo(0.006, 1.1, 0.01), M.black, -w / 2 + (i * w) / 6, 0.6, 0.042, false); break;
    case 'nightstand': P(rbox(w, 0.48, d, 0.015), M.lightWood, 0, 0.24, 0); P(new THREE.CylinderGeometry(0.1, 0.12, 0.26, 24, 1, true), M.shade, 0, 0.72, 0, false); P(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8), M.brass, 0, 0.55, 0, false); break;
    case 'wardrobe': { const h = f.h || 2.3; P(boxGeo(w, h, d), finishMats.cabinet, 0, h / 2, 0); doorLines(Math.round(w / 0.5), h - 0.1, h / 2, d / 2 + 0.003); break; }
    case 'shelf': {
      const h = f.h || 2.0;
      P(boxGeo(w, h, 0.03), M.lightWood, 0, h / 2, -d / 2 + 0.015);
      P(boxGeo(0.03, h, d), M.lightWood, -w / 2 + 0.015, h / 2, 0); P(boxGeo(0.03, h, d), M.lightWood, w / 2 - 0.015, h / 2, 0);
      const r = rng(Math.round(f.x * 100 + f.z * 7));
      for (let y = 0.02; y < h; y += h / 5) {
        P(boxGeo(w, 0.03, d), M.lightWood, 0, y, 0, false);
        if (y > 0.3 && y < h - 0.3) for (let x = -w / 2 + 0.08; x < w / 2 - 0.15; x += 0.035 + r() * 0.03) { if (r() < 0.25) { x += 0.12; continue; } const bh = 0.2 + r() * 0.12; const col = [M.accent, M.upholster, M.black, M.linen, M.stone][Math.floor(r() * 5)]; P(boxGeo(0.025, bh, d * 0.7), col, x, y + 0.015 + bh / 2, 0, false); }
      }
      break;
    }
    case 'shoe': P(boxGeo(w, 1.0, d), finishMats.cabinet, 0, 0.6, 0); break;
    case 'vanity': P(boxGeo(w, 0.45, d), finishMats.cabinet, 0, 0.6, 0); P(boxGeo(w, 0.04, d + 0.02), M.ceramic, 0, 0.84, 0); P(new THREE.CylinderGeometry(0.17, 0.14, 0.12, 32), M.ceramic, 0, 0.9, 0.02, false); P(boxGeo(w * 0.8, 0.75, 0.02), M.steel, 0, 1.45, -d / 2 + 0.015, false); break;
    case 'toilet': P(rbox(w, 0.38, 0.18, 0.04), M.ceramic, 0, 0.6, -d / 2 + 0.09); P(new THREE.CylinderGeometry(w / 2, w / 2.4, 0.4, 24), M.ceramic, 0, 0.2, 0.08, false); break;
    case 'tub': P(rbox(w, 0.55, d, 0.05), M.ceramic, 0, 0.275, 0); P(boxGeo(w - 0.14, 0.02, d - 0.14), M.tile, 0, 0.555, 0, false); break;
    case 'shower': {
      P(boxGeo(w, 0.04, d), M.ceramic, 0, 0.02, 0, false);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.95), glass); gl.position.set(0, 1.0, d / 2); g.add(gl);
      P(boxGeo(w, 0.025, 0.025), M.steel, 0, 1.98, d / 2, false);
      P(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 8), M.steel, w / 2 - 0.15, 1.4, -d / 2 + 0.05, false);
      P(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 24), M.steel, w / 2 - 0.15, 2.0, -d / 2 + 0.18, false);
      break;
    }
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
    case 'linear': {
      const y = 1.78;
      P(rbox(w, 0.035, 0.04, 0.012), M.black, 0, y, 0, false);
      P(boxGeo(w - 0.04, 0.006, 0.026), M.led, 0, y - 0.019, 0, false).castShadow = false;
      for (const sx of [-1, 1]) P(new THREE.CylinderGeometry(0.002, 0.002, ceilY - y, 4), M.black, sx * (w / 2 - 0.1), (ceilY + y) / 2, 0, false);
      break;
    }
    case 'curtain': {
      const h = ceilY - 0.35, seg = Math.max(12, Math.round(w * 30));
      const geo = new THREE.PlaneGeometry(w, h, seg, 1);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / w) * Math.PI * w * 9) * 0.035);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, f.sheer ? sheer : curtainMat);
      m.position.set(0, 0.02 + h / 2, 0); m.castShadow = !f.sheer; m.receiveShadow = true; g.add(m);
      P(boxGeo(w + 0.1, 0.02, 0.05), M.alu, 0, h + 0.03, 0, false);
      break;
    }
    case 'washer': P(rbox(w, 0.85, d, 0.02), M.white, 0, 0.425, 0); P(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 32), M.screen, 0, 0.5, d / 2 + 0.005, false).rotation.x = Math.PI / 2; break;
    case 'heater': P(rbox(w, 0.62, d, 0.02), M.white, 0, 1.5, 0); break;
    default: P(boxGeo(w, 0.8, d), M.lightWood, 0, 0.4, 0);
  }
  return g;
}
