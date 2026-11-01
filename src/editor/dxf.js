// Minimal ASCII DXF reader for floor plans: LINE, LWPOLYLINE, POLYLINE/VERTEX, ARC,
// CIRCLE, TEXT, MTEXT and INSERT (block references, one level deep with transforms).
// Output is in metres with plan coordinates [x, z] (DXF y flipped to z).
const UNIT = { 0: null, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };

export function parseDXF(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].replace(/\s+$/, '')]);
  let insunits = null;
  const blocks = {}, entities = [];
  let section = null, i = 0;
  const readEntity = start => {
    const type = pairs[start][1];
    const e = { type, layer: '0', pts: [], codes: {} };
    let j = start + 1;
    for (; j < pairs.length && pairs[j][0] !== 0; j++) {
      const [c, v] = pairs[j];
      if (c === 8) e.layer = v;
      else if (c === 10) e.pts.push([+v, 0]);
      else if (c === 20 && e.pts.length) e.pts[e.pts.length - 1][1] = +v;
      else if (c === 11) e.p2 = [+v, 0];
      else if (c === 21 && e.p2) e.p2[1] = +v;
      else if (c === 1 || c === 3) e.text = (e.text || '') + v;
      else if (c === 2) e.name = v;
      else e.codes[c] = v;
    }
    return { e, next: j };
  };
  function collect(at, out) {
    const { e, next } = readEntity(at);
    let j = next;
    if (e.type === 'POLYLINE') {
      while (j < pairs.length && pairs[j][0] === 0 && pairs[j][1] === 'VERTEX') { const r = readEntity(j); if (r.e.pts[0]) e.pts.push(r.e.pts[0]); j = r.next; }
      if (j < pairs.length && pairs[j][1] === 'SEQEND') j = readEntity(j).next;
    }
    if (e.type !== 'SEQEND' && e.type !== 'VERTEX') out.push(e);
    return j;
  }
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'SECTION') { section = pairs[i + 1] && pairs[i + 1][1]; i += 2; continue; }
    if (c === 0 && v === 'ENDSEC') { section = null; i++; continue; }
    if (section === 'HEADER' && c === 9 && v === '$INSUNITS') { insunits = parseInt(pairs[i + 1][1], 10); i += 2; continue; }
    if (section === 'BLOCKS' && c === 0 && v === 'BLOCK') {
      const { e: head, next } = readEntity(i);
      const blk = { name: head.name, base: head.pts[0] || [0, 0], ents: [] };
      i = next;
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDBLK')) {
        if (pairs[i][0] === 0) i = collect(i, blk.ents); else i++;
      }
      blocks[blk.name] = blk;
      continue;
    }
    if (section === 'ENTITIES' && c === 0) { i = collect(i, entities); continue; }
    i++;
  }
  // geometry in drawing units
  const segs = [], texts = [];
  const emit = (e, xf, depth = 0) => {
    const T = p => xf(p);
    switch (e.type) {
      case 'LINE': if (e.pts[0] && e.p2) segs.push({ a: T(e.pts[0]), b: T(e.p2), layer: e.layer }); break;
      case 'LWPOLYLINE': case 'POLYLINE': {
        const P = e.pts.map(T);
        for (let k = 0; k < P.length - 1; k++) segs.push({ a: P[k], b: P[k + 1], layer: e.layer });
        if ((+e.codes[70] & 1) && P.length > 2) segs.push({ a: P[P.length - 1], b: P[0], layer: e.layer });
        break;
      }
      case 'ARC': case 'CIRCLE': {
        const c0 = e.pts[0]; if (!c0) break;
        const r = +e.codes[40];
        const a0 = e.type === 'ARC' ? (+e.codes[50] * Math.PI) / 180 : 0;
        let a1 = e.type === 'ARC' ? (+e.codes[51] * Math.PI) / 180 : Math.PI * 2;
        if (a1 <= a0) a1 += Math.PI * 2;
        const n = Math.max(6, Math.round((a1 - a0) / 0.2));
        let prev = null;
        for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; const p = T([c0[0] + r * Math.cos(a), c0[1] + r * Math.sin(a)]); if (prev) segs.push({ a: prev, b: p, layer: e.layer, arc: true }); prev = p; }
        break;
      }
      case 'TEXT': case 'MTEXT': if (e.pts[0] && e.text) texts.push({ p: T(e.pts[0]), text: cleanText(e.text), layer: e.layer }); break;
      case 'INSERT': {
        const blk = blocks[e.name]; if (!blk || depth > 2) break;
        const ip = e.pts[0] || [0, 0];
        const sx = +(e.codes[41] || 1), sy = +(e.codes[42] || e.codes[41] || 1), rot = ((+e.codes[50] || 0) * Math.PI) / 180;
        const cs = Math.cos(rot), sn = Math.sin(rot);
        const inner = p => { const x = (p[0] - blk.base[0]) * sx, y = (p[1] - blk.base[1]) * sy; return xf([ip[0] + x * cs - y * sn, ip[1] + x * sn + y * cs]); };
        for (const be of blk.ents) emit({ ...be, layer: be.layer === '0' ? e.layer : be.layer }, inner, depth + 1);
        break;
      }
    }
  };
  for (const e of entities) emit(e, p => p);
  // units: header, else guess from extents (plans in mm are usually > 2000 units across)
  let k = UNIT[insunits];
  const all = segs.flatMap(s => [s.a, s.b]);
  const ext = all.length ? all.reduce((m, p) => ({ x0: Math.min(m.x0, p[0]), x1: Math.max(m.x1, p[0]), y0: Math.min(m.y0, p[1]), y1: Math.max(m.y1, p[1]) }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }) : { x0: 0, x1: 1, y0: 0, y1: 1 };
  if (!k) { const span = Math.max(ext.x1 - ext.x0, ext.y1 - ext.y0); k = span > 400 ? 0.001 : span > 40 ? 0.01 : 1; }
  // to metres, origin at the drawing's top-left, y flipped to plan z
  const X = p => [+((p[0] - ext.x0) * k).toFixed(4), +((ext.y1 - p[1]) * k).toFixed(4)];
  const layers = {};
  for (const s of segs) layers[s.layer] = (layers[s.layer] || 0) + 1;
  return {
    units: k, insunits,
    segs: segs.map(s => ({ a: X(s.a), b: X(s.b), layer: s.layer, arc: !!s.arc })).filter(s => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 0.005),
    texts: texts.map(t => ({ ...t, p: X(t.p) })),
    layers,
  };
}

function cleanText(t) { return t.replace(/\\[A-Za-z][^;]*;/g, '').replace(/\\P/g, ' ').replace(/[{}]/g, '').trim(); }

// Pair parallel lines (the two faces of a wall) into centreline walls.
export function detectWalls(segs, { minT = 0.07, maxT = 0.42, minLen = 0.25, others = [] } = {}) {
  const S = segs.filter(s => !s.arc).map(s => {
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], len = Math.hypot(dx, dz);
    let ux = dx / len, uz = dz / len;
    if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uz < 0)) { ux = -ux; uz = -uz; }
    return { ...s, len, ux, uz };
  }).filter(s => s.len > minLen);
  const raw = [];
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    const A = S[i], B = S[j];
    if (Math.abs(A.ux * B.uz - A.uz * B.ux) > 0.02) continue; // not parallel
    const nx = -A.uz, nz = A.ux;
    const d = (B.a[0] - A.a[0]) * nx + (B.a[1] - A.a[1]) * nz;
    const t = Math.abs(d);
    if (t < minT || t > maxT) continue;
    const pa = [A.a, A.b].map(p => p[0] * A.ux + p[1] * A.uz).sort((x, y) => x - y);
    const pb = [B.a, B.b].map(p => p[0] * A.ux + p[1] * A.uz).sort((x, y) => x - y);
    const s0 = Math.max(pa[0], pb[0]), s1 = Math.min(pa[1], pb[1]);
    if (s1 - s0 < minLen) continue;
    const off = (A.a[0] * nx + A.a[1] * nz) + d / 2; // centreline offset along normal
    raw.push({ ux: A.ux, uz: A.uz, nx, nz, off, s0, s1, t });
  }
  // keep the closest partner per stretch: drop pairs that enclose a thinner pair on the same line
  raw.sort((a, b) => a.t - b.t);
  const kept = [];
  for (const r of raw) {
    const clash = kept.some(k => Math.abs(k.ux * r.uz - k.uz * r.ux) < 0.02 && Math.abs(k.off - r.off) < (k.t + r.t) / 2 && Math.min(k.s1, r.s1) - Math.max(k.s0, r.s0) > 0.1);
    if (!clash) kept.push(r);
  }
  // merge collinear pieces of the same thickness; small gaps become openings
  kept.sort((a, b) => a.off - b.off || a.s0 - b.s0);
  const walls = [];
  const used = new Set();
  for (let i = 0; i < kept.length; i++) {
    if (used.has(i)) continue;
    const line = [kept[i]]; used.add(i);
    for (let j = i + 1; j < kept.length; j++) {
      const r = kept[j];
      if (used.has(j)) continue;
      if (Math.abs(r.ux * kept[i].uz - r.uz * kept[i].ux) < 0.02 && Math.abs(r.off - kept[i].off) < 0.03 && Math.abs(r.t - kept[i].t) < 0.03) { line.push(r); used.add(j); }
    }
    line.sort((a, b) => a.s0 - b.s0);
    let cur = { ...line[0], openings: [] };
    const flush = () => walls.push(cur);
    for (let k = 1; k < line.length; k++) {
      const r = line[k], gap = r.s0 - cur.s1;
      if (gap < 0.05) { cur.s1 = Math.max(cur.s1, r.s1); continue; }
      if (gap <= 6.2) { cur.openings.push({ s: cur.s1, w: gap }); cur.s1 = Math.max(cur.s1, r.s1); continue; }
      flush(); cur = { ...r, openings: [] };
    }
    flush();
  }
  // a gap with glazing lines (parallel lines from other layers inside the wall band) is a window
  const glazed = (w, o) => others.some(g => {
    const gx = g.b[0] - g.a[0], gz = g.b[1] - g.a[1], gl = Math.hypot(gx, gz);
    if (gl < 0.2 || Math.abs((gx / gl) * w.uz - (gz / gl) * w.ux) > 0.05) return false;
    const m = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2];
    const along = m[0] * w.ux + m[1] * w.uz, across = m[0] * w.nx + m[1] * w.nz - w.off;
    return Math.abs(across) <= w.t / 2 + 0.02 && along > o.s + 0.02 && along < o.s + o.w - 0.02;
  });
  return walls.map(w => {
    const a = [w.ux * w.s0 + w.nx * w.off, w.uz * w.s0 + w.nz * w.off];
    const b = [w.ux * w.s1 + w.nx * w.off, w.uz * w.s1 + w.nz * w.off];
    return {
      a: a.map(v => +v.toFixed(3)), b: b.map(v => +v.toFixed(3)), t: +w.t.toFixed(3), tLocked: true,
      openings: w.openings.map(o => {
        const off = +(o.s - w.s0).toFixed(3), width = +o.w.toFixed(3);
        if (glazed(w, o)) return width >= 2.4 ? { type: 'slider', offset: off, width, sill: 0, head: 2.4, panels: width > 4 ? 4 : 2 } : { type: 'window', offset: off, width, sill: width < 1 ? 1.4 : 0.9, head: 2.2 };
        return width < 1.3 ? { type: 'door', offset: off, width, sill: 0, head: 2.1 } : { type: 'passage', offset: off, width, sill: 0, head: 2.4 };
      }),
    };
  });
}

// Extend wall ends to meet nearby walls so corners close (needed for room detection)
export function closeCorners(walls, reach = 0.45) {
  const inter = (w, v) => {
    const r = [w.b[0] - w.a[0], w.b[1] - w.a[1]], s = [v.b[0] - v.a[0], v.b[1] - v.a[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-6) return null;
    const qp = [v.a[0] - w.a[0], v.a[1] - w.a[1]];
    const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
    return { t, u, p: [w.a[0] + r[0] * t, w.a[1] + r[1] * t] };
  };
  for (const w of walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    for (const end of ['a', 'b']) {
      let best = null;
      for (const v of walls) {
        if (v === w) continue;
        const h = inter(w, v); if (!h) continue;
        const vlen = Math.hypot(v.b[0] - v.a[0], v.b[1] - v.a[1]);
        const dEnd = end === 'a' ? -h.t * len : (h.t - 1) * len; // >0 means beyond this end
        const onV = h.u > -reach / vlen && h.u < 1 + reach / vlen;
        if (onV && dEnd > -reach && dEnd < reach && (!best || Math.abs(dEnd) < Math.abs(best.d))) best = { d: dEnd, p: h.p };
      }
      if (best) {
        if (end === 'a') { const shift = -best.d; for (const o of w.openings) o.offset = +(o.offset - shift).toFixed(3); }
        w[end] = best.p.map(v => +v.toFixed(3));
      }
    }
  }
  return walls;
}
