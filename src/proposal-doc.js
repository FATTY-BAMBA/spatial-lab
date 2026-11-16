// 提案書 (the printable client proposal): everything it shows, computed from the saved project. Pure — no DOM — so
// qa/unit can check the numbers the client sees (areas in m² and 坪, the quote 未稅 / 含稅).
import { buildQuote, polygonArea, toPing } from './plan.js';
import { t, isEn } from './i18n.js';

// The style catalogue as the viewer builds it: the project's own finishes first (原始提案), then data/styles.json.
// Adds the catalogue's extra finish options to the plan so every style can be priced (same as the viewer does).
export function styleList(plan, catalog = {}) {
  for (const g of plan.finishes) for (const o of (catalog.extraOptions || {})[g.id] || []) if (!g.options.some(x => x.id === o.id)) g.options.push(o);
  const original = { id: 'original', name: t('原始提案', 'Original'), nameEn: '', tagline: t('本案預設材質', 'This project\'s default finishes'), finishes: { ...plan.defaultFinishes } };
  return [original, ...(catalog.styles || [])];
}

// Which style the proposal quotes: the one asked for, else the one with the most AI renders, else 原始提案
export function pickStyle(styles, renders = [], wanted = '') {
  if (wanted && styles.some(s => s.id === wanted)) return wanted;
  const n = id => renders.filter(r => r.style === id).length;
  const best = styles.filter(s => n(s.id)).sort((a, b) => n(b.id) - n(a.id))[0];
  return best ? best.id : 'original';
}

const r1 = v => Math.round(v * 10) / 10;

export function roomRows(plan) {
  const rows = [];
  const multi = plan.levels.length > 1;
  for (const L of plan.levels) for (const r of L.rooms) {
    const m2 = polygonArea(r.polygon); if (m2 < 0.3) continue;
    rows.push({ level: multi ? L.id : '', name: r.name || t('空間', 'Space'), m2: r1(m2), ping: r1(toPing(m2)), outdoor: !!r.outdoor });
  }
  const sum = list => list.reduce((a, r) => a + polygonArea(r.polygon), 0);
  const all = plan.levels.flatMap(L => L.rooms.filter(r => polygonArea(r.polygon) >= 0.3));
  const inM2 = sum(all.filter(r => !r.outdoor)), outM2 = sum(all.filter(r => r.outdoor));
  return { rows, interior: { m2: r1(inM2), ping: r1(toPing(inM2)) }, outdoor: { m2: r1(outM2), ping: r1(toPing(outM2)) } };
}

export function quoteSummary(plan, style) {
  const q = buildQuote(plan, { ...plan.defaultFinishes, ...(style ? style.finishes : {}) });
  const finish = q.lines.filter(l => l.finish).map(l => ({ group: l.group, name: l.name, qty: r1(l.qty), unit: l.unit, unitPrice: l.unitPrice, total: l.total }));
  const works = q.lines.filter(l => l.labour).map(l => ({ group: l.group, name: l.name, spec: l.spec, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, total: l.total }));
  const furniture = q.lines.filter(l => l.furniture).reduce((n, l) => n + l.qty, 0);
  return { finish, works, furniture, allowance: q.allowance, total: q.total, tax: q.tax, grand: q.grand, taxRate: q.basis.taxRate, basis: q.basis };
}

export function finishRows(plan, style) {
  return plan.finishes.map(g => {
    const id = (style && style.finishes[g.id]) || plan.defaultFinishes[g.id];
    const o = g.options.find(x => x.id === id) || g.options[0];
    return { group: g.name, name: o.name, color: o.tint || o.color || '#ccc' };
  });
}

// Renders for the proposal: the quoted style first, living spaces first within it; the first one is the cover
export function orderRenders(renders = [], styleId, styles = []) {
  const name = id => { const s = styles.find(x => x.id === id); return s ? s.name : ''; };
  const living = r => /客|起居|living/i.test(`${r.room || ''} ${r.roomEn || ''}`);
  return renders.filter(r => r && r.after)
    .map((r, i) => ({ r, i, k: (r.style === styleId ? 0 : 2) + (living(r) ? 0 : 1) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map(({ r }) => ({ src: r.after, thumb: r.thumb || r.after, room: isEn ? r.roomEn || r.room || '' : r.room || '', style: name(r.style), same: r.style === styleId }));
}

export function proposalData({ plan, renders = [], styles, styleId }) {
  const style = styles.find(s => s.id === styleId) || styles[0];
  return { style, rooms: roomRows(plan), quote: quoteSummary(plan, style), finishes: finishRows(plan, style), renders: orderRenders(renders, style.id, styles) };
}

// NT$ amounts as written on a 報價單: thousands separators, no decimals
export const money = n => Math.round(n).toLocaleString('en-US');
