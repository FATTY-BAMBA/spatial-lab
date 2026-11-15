// Openings on the outside walls of a picture import: gaps there become windows (higher sill in bathrooms), wide
// openings off the living/dining room become sliding doors, and one door on the ground floor is the main entrance
// (preferring the entrance hall, then living/dining). Shared by the editor and the QA pipeline.
import { pointInPolygon, wallFrame } from '../plan.js';

export function tidyExteriorOpenings(doc) {
  let hasMain = doc.levels.some(L => L.walls.some(w => (w.openings || []).some(o => o.main)));
  doc.levels.forEach((L, li) => {
    const roomAt = p => L.rooms.find(r => pointInPolygon(p, r.polygon));
    const cands = [];
    for (const w of L.walls) {
      if (!w.ext) continue;
      const { ux, uz } = wallFrame(w), n = [-uz, ux];
      for (const o of w.openings || []) {
        if (o.type === 'window' || o.main) continue;
        const m = [w.a[0] + ux * (o.offset + o.width / 2), w.a[1] + uz * (o.offset + o.width / 2)];
        const r = roomAt([m[0] + n[0] * 0.4, m[1] + n[1] * 0.4]) || roomAt([m[0] - n[0] * 0.4, m[1] - n[1] * 0.4]);
        const nm = r ? `${r.name} ${r.nameEn || ''}` : '';
        if (o.width >= 1.8 && /客|餐|living|dining/i.test(nm)) { Object.assign(o, { type: 'slider', sill: 0, head: 2.4, panels: o.width > 3 ? 4 : 2 }); continue; }
        if (li === 0 && o.width >= 0.75 && o.width <= 1.6) cands.push({ o, score: /玄關|玄|entr/i.test(nm) ? 3 : /客|餐|living|dining/i.test(nm) ? 2 : /廚|kitchen/i.test(nm) ? 0.5 : 1 });
        Object.assign(o, { type: 'window', sill: /浴|廁|bath/i.test(nm) ? 1.4 : 0.9, head: 2.2 });
      }
    }
    if (li === 0 && !hasMain && cands.length) { cands.sort((a, b) => b.score - a.score); Object.assign(cands[0].o, { type: 'door', sill: 0, head: 2.1, main: true }); hasMain = true; }
  });
}
