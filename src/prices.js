// 價目表 (a design firm's own price list): unit prices for finishes (per 坪 / m² / m), furniture, works lines, waste % and
// 營業稅. Stored as spatial_firms.prices (jsonb); clients get a trimmed copy through spatial_shared(token).firm.prices.
// Pure: no DOM, no cloud — qa/unit checks the numbers.
//
// Shape (v 1):
//   { v: 1, name, date: 'YYYY-MM', labour: '含工帶料', taxRate: 0.05 | 0,
//     waste: { floor: 0.08, … }, units: { floor: '坪' | 'm²', paint: … },
//     finishes: { 'floor.oak': 4800, … },          // finish option prices (per the group's unit)
//     furniture: { '雙人床@45000': 42000, … },     // overrides of catalogue prices: '<name>@<catalogue price>' → price
//     lines: [{ id, name, spec, unit: '坪' | 'm²' | '式', qty, price, on }],   // works lines (保護工程, 清運…)
//     notes: ['…'] }
import { t } from './i18n.js';
import { DEFAULT_BASIS, M2_PER_PING } from './plan.js';

export const MAX_PRICE = 10_000_000;
export const MAX_LINES = 40;
export const MAX_NOTES = 12;
export const AREA_BASIS = new Set(['floorArea', 'wallArea']);
export const LINE_UNITS = ['坪', 'm²', '式'];

// Every priced piece the editor, the importer and the decor pass can place, at its catalogue price. A plan's piece
// takes the firm's price when its name and price match a row here; a price the designer typed on one piece stays.
// (Sheer curtains are priced by window width and are not listed.)
export const FURNITURE = [
  ['客廳', 'Living', [['絲絨弧形沙發', 'Velvet sofa', 72000], ['沙發', 'Sofa', 68000], ['三人沙發', '3-seat sofa', 68000], ['單椅', 'Lounge chair', 18800], ['坐墩', 'Pouf', 5200], ['大理石茶几', 'Coffee table', 16000], ['茶几', 'Coffee table', 16000], ['茶几', 'Coffee table, small', 12000], ['電視主牆', 'TV wall', 45000], ['電視櫃', 'TV console', 26000], ['地毯', 'Rug', 9800], ['窗簾', 'Curtain', 9000], ['紗簾', 'Sheer curtain', 12000], ['掛畫', 'Wall art', 6800], ['植栽', 'Plant', 3200], ['花器', 'Vase', 1800]]],
  ['餐廚', 'Kitchen & dining', [['餐桌', 'Dining table', 38000], ['圓餐桌', 'Round dining table', 32000], ['餐椅', 'Dining chair', 6800], ['椅子', 'Chair', 6800], ['餐桌吊燈', 'Linear pendant', 12800], ['吊燈', 'Pendant', 8800], ['吊燈', 'Pendant, small', 5800], ['中島', 'Kitchen island', 85000], ['冰箱', 'Refrigerator', 52000], ['冰箱', 'Refrigerator, large', 72000], ['排油煙機', 'Range hood', 18000], ['餐邊櫃', 'Sideboard', 28000]]],
  ['臥室', 'Bedroom', [['雙人床', 'Bed 180 cm', 45000], ['雙人床', 'Bed 150 cm', 32000], ['單人床', 'Single bed', 18000], ['床頭櫃', 'Nightstand', 6500], ['床頭板', 'Headboard panel', 22000], ['系統衣櫃', 'Wardrobe', 48000], ['系統衣櫃', 'Wardrobe, small', 32000], ['系統衣櫃', 'Wardrobe, large', 85000], ['床邊地毯', 'Bedroom rug', 7800], ['書桌', 'Desk', 16000], ['書桌椅', 'Desk chair', 6800], ['書桌椅', 'Desk chair, ergonomic', 9800], ['書櫃', 'Bookcase', 22000], ['和室架高地板', 'Tatami platform', 30000]]],
  ['衛浴', 'Bath', [['馬桶', 'Toilet', 15000], ['浴櫃', 'Vanity', 16000], ['浴櫃', 'Vanity, medium', 18000], ['浴櫃', 'Vanity, large', 22000], ['淋浴拉門', 'Shower screen', 14000], ['浴缸', 'Bathtub', 38000]]],
  ['其他', 'Other', [['玄關櫃', 'Entry cabinet', 42000], ['玄關鞋櫃', 'Shoe cabinet', 18000], ['收納櫃', 'Storage cabinet', 32000], ['收納層架', 'Storage shelving', 9000], ['洗衣機', 'Washer', 24000], ['熱水器', 'Water heater', 15000], ['戶外柚木躺椅', 'Teak lounge chair', 12800], ['戶外邊桌', 'Side table', 3600]]],
].map(([group, groupEn, items]) => ({ group, groupEn, items: items.map(([name, nameEn, base]) => ({ key: `${name}@${base}`, name, nameEn, base })) }));

// Works lines a Taiwan 報價單 usually carries; seeded switched off so a saved list never adds lines nobody chose
export const LINES = [
  { id: 'protect', name: '保護工程', nameEn: 'Site protection', spec: '地坪、電梯與公共區域保護', specEn: 'Floors, lift and common areas', unit: '坪', price: 600 },
  { id: 'debris', name: '垃圾清運', nameEn: 'Debris removal', spec: '施工廢料清運', specEn: 'Construction waste', unit: '式', price: 15000 },
  { id: 'clean', name: '完工清潔', nameEn: 'Final cleaning', spec: '細清（含玻璃、櫃內）', specEn: 'Detailed clean incl. glass and cabinets', unit: '坪', price: 450 },
  { id: 'manage', name: '工程管理', nameEn: 'Project management', spec: '現場監工與進度管理', specEn: 'Site supervision and schedule', unit: '式', price: 30000 },
];

export const furnitureKey = f => `${f.nameZh || f.name}@${f.price0 ?? f.price}`;
const int = v => (Number.isFinite(+v) && v !== '' && v !== null ? Math.round(+v) : NaN);
const okPrice = v => Number.isInteger(v) && v >= 0 && v <= MAX_PRICE;
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');

// The list a firm starts from: today's sample prices (the finish groups of the plan data + the style catalogue's options)
export function defaultPrices(finishes = []) {
  const P = { v: 1, name: '', date: new Date().toISOString().slice(0, 7), labour: DEFAULT_BASIS.labour, taxRate: DEFAULT_BASIS.taxRate, waste: { ...DEFAULT_BASIS.waste }, units: {}, finishes: {}, furniture: {}, lines: LINES.map(l => ({ id: l.id, name: t(l.name, l.nameEn), spec: t(l.spec, l.specEn), unit: l.unit, qty: 1, price: l.price, on: false })), notes: [...DEFAULT_BASIS.notes] };
  for (const g of finishes) {
    if (AREA_BASIS.has(g.basis)) P.units[g.id] = g.unit === 'm²' ? 'm²' : '坪';
    for (const o of g.options) P.finishes[`${g.id}.${o.id}`] = o.price;
  }
  return P;
}

// A clean, bounded copy of a stored list (anything malformed is dropped), or null when there is none
export function normPrices(P) {
  if (!P || typeof P !== 'object' || Array.isArray(P)) return null;
  const out = { v: 1, name: str(P.name, 80), date: /^\d{4}-\d{2}(-\d{2})?$/.test(P.date || '') ? P.date : '', labour: str(P.labour, 40), taxRate: P.taxRate === 0 ? 0 : 0.05, waste: {}, units: {}, finishes: {}, furniture: {}, lines: [], notes: [] };
  for (const [k, v] of Object.entries(P.waste || {})) if (/^[a-z]\w{0,30}$/.test(k) && Number.isFinite(+v) && +v >= 0 && +v <= 0.5) out.waste[k] = Math.round(+v * 1000) / 1000;
  for (const [k, v] of Object.entries(P.units || {})) if (/^[a-z]\w{0,30}$/.test(k) && (v === '坪' || v === 'm²')) out.units[k] = v;
  for (const [k, v] of Object.entries(P.finishes || {})) if (/^[\w-]{1,40}\.[\w-]{1,40}$/.test(k) && okPrice(int(v))) out.finishes[k] = int(v);
  for (const [k, v] of Object.entries(P.furniture || {})) if (k.length <= 80 && /@\d+$/.test(k) && okPrice(int(v))) out.furniture[k] = int(v);
  for (const l of (Array.isArray(P.lines) ? P.lines : []).slice(0, MAX_LINES)) {
    const name = str(l && l.name, 60), price = int(l && l.price);
    if (!name || !okPrice(price)) continue;
    const unit = LINE_UNITS.includes(l.unit) ? l.unit : '式', qty = Number.isFinite(+l.qty) && +l.qty > 0 ? Math.min(9999, Math.round(+l.qty * 100) / 100) : 1;
    out.lines.push({ id: str(l.id, 24) || `l${out.lines.length + 1}`, name, spec: str(l.spec, 80), unit, qty, price, on: l.on === true });
  }
  out.notes = (Array.isArray(P.notes) ? P.notes : []).map(n => str(n, 160)).filter(Boolean).slice(0, MAX_NOTES);
  return out;
}

// Check a list before saving: { ok, errors: [message] } (messages in the current language)
export function checkPrices(P) {
  const errors = [];
  const whole = v => v !== '' && v !== null && typeof v !== 'boolean' && okPrice(+v); // typed prices must already be whole NT$
  const bad = Object.values(P.finishes || {}).filter(v => !whole(v)).length + Object.values(P.furniture || {}).filter(v => !whole(v)).length + (P.lines || []).filter(l => !whole(l.price)).length;
  if (bad) errors.push(t(`有 ${bad} 個單價不正確（應為 0 到 1,000 萬的整數）`, `${bad} unit price(s) are not valid (whole NT$ from 0 to 10,000,000)`));
  if (Object.values(P.waste || {}).some(v => !(Number.isFinite(+v) && +v >= 0 && +v <= 0.5))) errors.push(t('損耗應在 0% 到 50% 之間', 'Waste must be between 0% and 50%'));
  if ((P.lines || []).some(l => !str(l.name, 60))) errors.push(t('工程項目需要名稱', 'Every works line needs a name'));
  if ((P.lines || []).length > MAX_LINES) errors.push(t(`工程項目最多 ${MAX_LINES} 項`, `At most ${MAX_LINES} works lines`));
  if (new TextEncoder().encode(JSON.stringify(P)).length > 60000) errors.push(t('價目表太大', 'The price list is too large')); // the column allows 64 KB
  return { ok: !errors.length, errors };
}

// Put a firm's prices into a loaded plan (after the style catalogue's extra options were added to plan.finishes).
// Changes option prices, units, furniture prices and plan.quoteBasis in place; returns the plan. No list → unchanged.
export function applyPrices(plan, stored) {
  const P = normPrices(stored); if (!P || !plan) return plan;
  for (const g of plan.finishes || []) {
    const toM2 = AREA_BASIS.has(g.basis) && P.units[g.id] === 'm²' && g.unit !== 'm²';
    if (AREA_BASIS.has(g.basis) && P.units[g.id]) g.unit = P.units[g.id];
    for (const o of g.options) {
      const v = P.finishes[`${g.id}.${o.id}`];
      o.price = v != null ? v : toM2 ? Math.round(o.price / M2_PER_PING) : o.price;
    }
  }
  for (const L of plan.levels || []) for (const f of L.furniture || []) {
    if (!f.price && f.price0 == null) continue;
    if (f.price0 == null) f.price0 = f.price;
    const v = P.furniture[furnitureKey(f)];
    f.price = v != null ? v : f.price0;
  }
  plan.quoteBasis = {
    ...(plan.quoteBasis || {}),
    priceBook: P.name || t('設計公司價目表', 'Firm price list'), priceDate: P.date, labour: P.labour || DEFAULT_BASIS.labour,
    waste: { ...DEFAULT_BASIS.waste, ...P.waste }, taxRate: P.taxRate, notes: P.notes.length ? P.notes : DEFAULT_BASIS.notes,
    lines: P.lines.filter(l => l.on), firm: true,
  };
  return plan;
}

// What a stored list changes against the defaults (for the 價目表 summary line): { finishes, furniture, lines }
export function priceChanges(stored, finishes = []) {
  const P = normPrices(stored); if (!P) return { finishes: 0, furniture: 0, lines: 0 };
  const D = defaultPrices(finishes);
  return {
    finishes: Object.entries(P.finishes).filter(([k, v]) => k in D.finishes && D.finishes[k] !== v).length,
    furniture: Object.entries(P.furniture).filter(([k, v]) => +k.split('@').pop() !== v).length,
    lines: P.lines.filter(l => l.on).length,
  };
}
