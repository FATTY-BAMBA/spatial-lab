// 報價單 as an Excel workbook: firm header, project + client, rows grouped by trade (材質, 工程) and by room (家具) with
// 項目 / 規格 / 數量 / 單位 / 單價 / 複價 / 備註, section 小計, 合計（未稅）, 營業稅, 總計（含稅）, notes and sign-off lines.
// Amounts are live formulas (=ROUND(數量×單價)) with their values cached, so the designer can edit quantities and prices
// in Excel / Google Sheets and the totals follow. Pure: the same numbers as buildQuote (checked in qa/unit).
import { buildQuote, pointInPolygon, polygonArea } from './plan.js';
import { t, isEn, unitLabel } from './i18n.js';
import { contactLines } from './firm.js';
import { xlsx, ref } from './xlsx.js';

const NUM = isEn ? ['1.', '2.', '3.', '4.', '5.'] : ['一、', '二、', '三、', '四、', '五、'];
const day = d => { const x = d ? new Date(d) : new Date(); return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`; };
const cm = v => Math.round(v * 100);

// Furniture by room: [{ room, items: [{ name, spec, qty, unitPrice, total }] }] in plan order; pieces outside every room → 其他
export function furnitureByRoom(plan) {
  const multi = plan.levels.length > 1, groups = new Map(), other = t('其他', 'Other');
  for (const L of plan.levels) {
    const rooms = L.rooms.filter(r => r.polygon && r.polygon.length > 2).map(r => ({ r, a: polygonArea(r.polygon) })).sort((a, b) => a.a - b.a);
    for (const f of L.furniture) {
      if (!f.price) continue;
      const hit = rooms.find(x => pointInPolygon([f.x, f.z], x.r.polygon));
      const room = `${multi ? `${L.id} ` : ''}${hit ? hit.r.name || t('空間', 'Space') : other}`;
      const sc = f.scale || 1, spec = f.w && f.d ? `${cm(f.w * sc)}×${cm(f.d * sc)} cm` : '';
      const g = groups.get(room) || { room, order: hit ? L.rooms.indexOf(hit.r) + plan.levels.indexOf(L) * 1000 : 1e9, items: new Map() };
      const k = `${f.name}|${f.price}|${spec}`;
      const it = g.items.get(k) || { name: f.name, spec, qty: 0, unitPrice: f.price };
      it.qty += 1; g.items.set(k, it); groups.set(room, g);
    }
  }
  return [...groups.values()].sort((a, b) => a.order - b.order).map(g => ({ room: g.room, items: [...g.items.values()].map(i => ({ ...i, total: i.qty * i.unitPrice })) }));
}

// The workbook model + its totals (so tests and the page can compare with the on-screen quote)
export function quoteSheet({ plan, chosen, firm = null, project = '', client = '', style = '', date = null }) {
  const Q = buildQuote(plan, chosen), B = Q.basis;
  const rows = [], merges = [];
  const push = (cells, ht) => { rows.push(ht ? { cells, ht } : cells); return rows.length - 1; }; // 0-based row index
  const merge = (r, c0, c1) => merges.push(`${ref(r, c0)}:${ref(r, c1)}`);
  const title = t('報價單', 'Quotation');

  // header: firm, contact, title, project facts
  const head = firm && firm.name ? firm.name : project || title;
  merge(push([{ v: head, s: 'firm' }], 28), 0, 6);
  const reach = firm ? contactLines(firm).map(l => `${l.label} ${l.value}`).join('　') : '';
  merge(push([{ v: reach, s: 'muted' }]), 0, 6);
  push([]);
  merge(push([{ v: isEn ? 'QUOTATION' : `${title}  QUOTATION`, s: 'title' }, ...Array(6).fill({ v: '', s: 'title' })], 34), 0, 6);
  push([]);
  const fact = (a, b, c, d) => { const r = push([{ v: a, s: 'label' }, { v: b || '—', s: 'value' }, null, null, { v: c, s: 'label' }, { v: d || '—', s: 'value' }]); merge(r, 1, 3); merge(r, 5, 6); };
  fact(t('專案名稱', 'Project'), project, t('報價日期', 'Date'), day(date));
  fact(t('業主', 'Client'), client, t('風格', 'Style'), style);
  fact(t('價目表', 'Price list'), [B.priceBook, B.priceDate].filter(Boolean).join(' · '), t('計價方式', 'Basis'), `${B.labour} · ${t('未稅', 'excl. tax')}`);
  push([]);
  const headRow = push(['項目', '規格', '數量', '單位', '單價', '複價', '備註'].map((v, i) => ({ v: t(v, ['Item', 'Specification', 'Qty', 'Unit', 'Unit price', 'Amount', 'Notes'][i]), s: i < 2 || i === 6 ? 'headL' : 'head' })), 22);

  // sections
  const subs = [];
  let n = 0;
  const section = (name, fill) => {
    merge(push([{ v: `${NUM[n++]}${name}`, s: 'section' }, ...Array(6).fill({ v: '', s: 'section' })], 22), 0, 6);
    const first = rows.length;
    let sum = 0;
    fill(l => {
      const r = rows.length;
      push([{ v: l.item, s: 'cellWrap' }, { v: l.spec || '', s: 'cellWrap' }, { v: l.qty, s: l.int ? 'int' : 'qty' }, { v: unitLabel(l.unit), s: 'unit' }, { v: l.unitPrice, s: 'money' },
        { v: l.total, f: `ROUND(${ref(r, 2)}*${ref(r, 4)},0)`, s: 'money' }, { v: l.note || '', s: 'note' }]);
      sum += l.total;
    }, label => push([{ v: label, s: 'room' }]));
    const last = rows.length - 1;
    const r = push([null, null, { v: t('小計', 'Subtotal'), s: 'subL' }, { v: '', s: 'subL' }, { v: '', s: 'subL' }, { v: sum, f: `SUM(${ref(first, 5)}:${ref(last, 5)})`, s: 'sub' }, { v: '', s: 'subL' }]);
    merge(r, 2, 4);
    subs.push({ r, sum });
  };
  const finish = Q.lines.filter(l => l.finish && l.qty > 0);
  if (finish.length) section(t('裝修材質', 'Finishes'), add => finish.forEach(l => add({ item: l.group, spec: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, total: l.total, note: l.waste ? t(`含損耗 ${Math.round(l.waste * 100)}%`, `incl. ${Math.round(l.waste * 100)}% waste`) : '' })));
  const works = Q.lines.filter(l => l.labour);
  if (works.length) section(t('工程項目', 'Works'), add => works.forEach(l => add({ item: l.name, spec: l.spec, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, total: l.total, int: l.unit === '式' })));
  const rooms = furnitureByRoom(plan);
  if (rooms.length) section(t('家具（暫估）', 'Furniture (allowance)'), (add, label) => rooms.forEach(g => { label(g.room); g.items.forEach(i => add({ item: i.name, spec: i.spec, qty: i.qty, unit: '件', unitPrice: i.unitPrice, total: i.total, int: true, note: t('暫估', 'allowance') })); }));

  // totals
  push([]);
  const subtotal = subs.reduce((a, s) => a + s.sum, 0), tax = Math.round(subtotal * B.taxRate), grand = subtotal + tax;
  const tot = (label, v, f, sl, sv) => { const r = push([null, null, { v: label, s: sl }, { v: '', s: sl }, { v: '', s: sl }, { v, f, s: sv }], sl === 'grandL' ? 24 : 0); merge(r, 2, 4); return r; };
  const rs = tot(t('合計（未稅）', 'Subtotal (excl. tax)'), subtotal, subs.length ? subs.map(s => ref(s.r, 5)).join('+') : '0', 'totL', 'tot');
  const rt = tot(B.taxRate ? t(`營業稅 ${Math.round(B.taxRate * 100)}%`, `Business tax ${Math.round(B.taxRate * 100)}%`) : t('營業稅（不另計）', 'Business tax (not added)'), tax, `ROUND(${ref(rs, 5)}*${B.taxRate},0)`, 'totL', 'tot');
  tot(t('總計（含稅）', 'Total (incl. tax)'), grand, `${ref(rs, 5)}+${ref(rt, 5)}`, 'grandL', 'grand');

  // notes + sign-off
  push([]);
  push([{ v: t('備註', 'Notes'), s: 'bold' }]);
  const notes = [...B.notes, t('數量依平面圖計算，實際以現場丈量為準。', 'Quantities are taken from the plan; site measurements prevail.')];
  notes.forEach((x, i) => merge(push([{ v: `${i + 1}. ${x}`, s: 'small' }], 16 * Math.max(1, Math.ceil(x.length / (isEn ? 110 : 52)))), 0, 6));
  push([]); push([]);
  const sr = push([{ v: t('業主簽認：', 'Client signature:'), s: 'sign' }, { v: '', s: 'sign' }, { v: '', s: 'sign' }, null, { v: t('報價人：', 'Quoted by:'), s: 'sign' }, { v: '', s: 'sign' }, { v: '', s: 'sign' }], 30);
  merge(sr, 0, 2); merge(sr, 4, 6);
  const dr = push([{ v: t('日期：', 'Date:'), s: 'sign' }, { v: '', s: 'sign' }, { v: '', s: 'sign' }, null, { v: t('日期：', 'Date:'), s: 'sign' }, { v: '', s: 'sign' }, { v: '', s: 'sign' }], 30);
  merge(dr, 0, 2); merge(dr, 4, 6);

  const stamp = day(date).replace(/\//g, '');
  const safe = s => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return {
    book: { title: `${title} ${project}`.trim(), author: firm && firm.name ? firm.name : 'PrimeStride Spatial Lab', sheets: [{ name: title, cols: [16, 30, 9, 6, 12, 17, 16], rows, merges, printTitles: `${headRow + 1}:${headRow + 1}` }] },
    totals: { subtotal, tax, grand, taxRate: B.taxRate, quote: Q.total },
    filename: `${[t('報價單', 'Quotation'), safe(project), stamp].filter(Boolean).join('-')}.xlsx`,
  };
}

export function quoteXlsx(opts) {
  const S = quoteSheet(opts);
  return { bytes: xlsx(S.book), totals: S.totals, filename: S.filename };
}
