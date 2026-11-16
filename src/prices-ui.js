// 我的專案 → 價目表: the firm's own unit prices (finishes per 坪 / m² / m, works lines, furniture, waste %, 營業稅,
// notes). Saved to spatial_firms.prices; the 3D quote, share links, 提案書 and the Excel 報價單 all use it.
import { t, isEn, localizeData } from './i18n.js';
import { loadPlan, M2_PER_PING } from './plan.js';
import { FURNITURE, AREA_BASIS, LINE_UNITS, MAX_LINES, defaultPrices, normPrices, checkPrices, priceChanges } from './prices.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => Math.round(n).toLocaleString('en-US');
const unitText = u => (isEn ? ({ '坪': 'ping', '式': 'lot' }[u] || u) : u);

// The finish groups a quote can use: the sample plan's groups + the style catalogue's extra options
export async function finishGroups() {
  const [base, catalog] = await Promise.all([loadPlan('data/apartment.json'), loadPlan('data/styles.json').catch(() => ({}))]);
  const groups = base.finishes;
  for (const g of groups) for (const o of (catalog.extraOptions || {})[g.id] || []) if (!g.options.some(x => x.id === o.id)) g.options.push(o);
  return localizeData(groups);
}

// stored list over the defaults: every row the table shows has a value
export function withDefaults(stored, groups) {
  const D = defaultPrices(groups), P = normPrices(stored);
  if (!P) return D;
  return { ...D, ...P, waste: { ...D.waste, ...P.waste }, units: { ...D.units, ...P.units }, finishes: { ...D.finishes, ...P.finishes }, lines: P.lines, notes: P.notes.length ? P.notes : D.notes, date: P.date || D.date, labour: P.labour || D.labour };
}

export function setupPriceList({ C, toast, getFirm, setFirm }) {
  let groups = null, W = null;
  const dlg = document.createElement('dialog');
  dlg.id = 'prices'; dlg.setAttribute('aria-labelledby', 'pl-title');
  dlg.innerHTML = `<form class="fm pl" method="dialog" novalidate>
    <div class="fm-h"><div><h2 id="pl-title">${t('價目表', 'Price list')}</h2><small>${t('3D 報價、分享連結、提案書與 Excel 報價單都用這份單價（未稅）。', 'Used by the 3D quote, share links, proposals and the Excel quotation (prices excl. tax).')}</small></div><button type="button" class="x" data-x aria-label="${t('關閉', 'Close')}">×</button></div>
    <div class="fm-b pl-b">
      <p class="pl-off full" hidden>${t('價目表即將開放：資料庫更新完成後就能儲存。目前報價仍使用示範價目表。', 'Price lists open shortly: saving works once the database update is live. Quotes use the sample prices until then.')}</p>
      <label class="fld full"><span>${t('價目表名稱', 'Name')}</span><input type="text" name="pl-name" maxlength="80" placeholder="${t('例：2026 標準價目表', 'e.g. 2026 standard prices')}"></label>
      <label class="fld"><span>${t('價格基準', 'Prices as of')}</span><input type="month" name="pl-date"></label>
      <label class="fld"><span>${t('營業稅', 'Business tax')}</span><select name="pl-tax"><option value="0.05">${t('外加 5% 營業稅', 'Add 5% business tax')}</option><option value="0">${t('不另計', 'Not added')}</option></select></label>
      <label class="fld full"><span>${t('計價方式', 'Pricing basis')}</span><input type="text" name="pl-labour" maxlength="40" list="pl-labours"><datalist id="pl-labours"><option value="${t('含工帶料', 'labour and materials')}"><option value="${t('工料分計', 'labour and materials priced separately')}"><option value="${t('僅含工資', 'labour only')}"></datalist></label>
      <div class="pl-tabs full" role="tablist">${[['fin', t('材質', 'Finishes')], ['works', t('工程項目', 'Works')], ['furn', t('家具', 'Furniture')], ['notes', t('備註', 'Notes')]].map(([k, l], i) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${!i}">${l}</button>`).join('')}</div>
      <div class="pl-panel full" data-panel="fin"></div>
      <div class="pl-panel full" data-panel="works" hidden></div>
      <div class="pl-panel full" data-panel="furn" hidden></div>
      <div class="pl-panel full" data-panel="notes" hidden><label class="fld"><span>${t('報價單備註（一行一項）', 'Quotation notes (one per line)')}</span><textarea name="pl-notes" rows="6" maxlength="1900"></textarea></label></div>
      <p class="pl-err full" role="alert"></p>
    </div>
    <div class="fm-f"><button type="button" class="btn pl-reset">${t('恢復預設', 'Reset')}</button><span class="spacer"></span><button type="button" class="btn" data-x>${t('取消', 'Cancel')}</button><button type="submit" class="btn go" id="pl-save">${t('儲存', 'Save')}</button></div>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form'), $ = s => dlg.querySelector(s);
  const panel = k => dlg.querySelector(`[data-panel="${k}"]`);
  dlg.querySelectorAll('[role=tab]').forEach(b => b.addEventListener('click', () => {
    dlg.querySelectorAll('[role=tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    dlg.querySelectorAll('.pl-panel').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.tab; });
  }));
  const close = () => { if (dlg.open) dlg.close(); if (location.hash === '#prices') history.replaceState(null, '', location.pathname + location.search); };
  dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close));
  const money = (k, v, label) => `<input type="number" class="pl-p" data-k="${esc(k)}" value="${v}" min="0" max="10000000" step="1" inputmode="numeric" aria-label="${esc(label)}">`;

  function draw() {
    form.elements['pl-name'].value = W.name; form.elements['pl-date'].value = (W.date || '').slice(0, 7);
    form.elements['pl-tax'].value = String(W.taxRate); form.elements['pl-labour'].value = W.labour; form.elements['pl-notes'].value = W.notes.join('\n');
    panel('fin').innerHTML = groups.map(g => {
      const area = AREA_BASIS.has(g.basis), unit = area ? W.units[g.id] || '坪' : g.unit;
      return `<section class="pl-g" data-g="${esc(g.id)}"><header><b>${esc(g.name)}</b>
        ${area ? `<label>${t('單位', 'Unit')} <select data-unit="${esc(g.id)}"><option value="坪"${unit === '坪' ? ' selected' : ''}>${unitText('坪')}</option><option value="m²"${unit === 'm²' ? ' selected' : ''}>m²</option></select></label>` : `<span class="muted">${t('每公尺', 'per metre')}</span>`}
        <label>${t('損耗', 'Waste')} <input type="number" class="pl-w" data-waste="${esc(g.id)}" value="${Math.round((W.waste[g.id] || 0) * 1000) / 10}" min="0" max="50" step="0.5" inputmode="decimal"> %</label></header>
        <table>${g.options.map(o => { const k = `${g.id}.${o.id}`; return `<tr><td>${esc(o.name)}</td><td class="num">NT$ ${money(k, W.finishes[k] ?? o.price, `${g.name} ${o.name}`)}<span class="u">/${esc(unitText(unit))}</span></td></tr>`; }).join('')}</table></section>`;
    }).join('');
    drawWorks();
    panel('furn').innerHTML = `<p class="muted">${t('平面上的家具依品名與預設價對應；在編輯器裡單獨改過價格的家具不受影響。', 'Furniture in a plan is matched by name and default price; a piece whose price you changed in the editor keeps it.')}</p>`
      + FURNITURE.map(G => `<section class="pl-g"><header><b>${esc(t(G.group, G.groupEn))}</b></header><table>${G.items.map(i => `<tr><td>${esc(isEn ? i.nameEn : i.name)}<small>${t('預設', 'default')} ${fmt(i.base)}</small></td><td class="num">NT$ ${money('f:' + i.key, W.furniture[i.key] ?? i.base, isEn ? i.nameEn : i.name)}<span class="u">/${t('件', 'pc')}</span></td></tr>`).join('')}</table></section>`).join('');
    dlg.querySelectorAll('[data-unit]').forEach(s => s.addEventListener('change', () => {
      const g = s.dataset.unit, k = s.value === 'm²' ? 1 / M2_PER_PING : M2_PER_PING;
      dlg.querySelectorAll(`[data-g="${g}"] .pl-p`).forEach(i => { if (i.value !== '') i.value = Math.round(+i.value * k); });
      dlg.querySelectorAll(`[data-g="${g}"] .u`).forEach(u => { u.textContent = `/${unitText(s.value)}`; });
    }));
  }
  function drawWorks() {
    panel('works').innerHTML = `<p class="muted">${t('勾選的項目會加進每份報價。依坪或 m² 計價的項目以室內地坪面積計算。', 'Ticked lines are added to every quote. Lines priced per ping or m² use the interior floor area.')}</p>
      <div class="pl-lines">${W.lines.map((l, i) => `<div class="pl-line" data-i="${i}">
        <label class="on" title="${t('納入報價', 'Include in quotes')}"><input type="checkbox" data-f="on"${l.on ? ' checked' : ''} aria-label="${t('納入報價', 'Include in quotes')}"></label>
        <div class="nm"><input type="text" data-f="name" maxlength="60" value="${esc(l.name)}" placeholder="${t('項目名稱', 'Line name')}" aria-label="${t('項目', 'Item')}"><input type="text" data-f="spec" maxlength="80" value="${esc(l.spec)}" placeholder="${t('規格說明（選填）', 'Specification (optional)')}" aria-label="${t('規格', 'Specification')}"></div>
        <select data-f="unit" aria-label="${t('單位', 'Unit')}">${LINE_UNITS.map(u => `<option value="${u}"${u === l.unit ? ' selected' : ''}>${unitText(u)}</option>`).join('')}</select>
        <span class="num">NT$ <input type="number" class="pl-p" data-f="price" value="${l.price}" min="0" max="10000000" step="1" inputmode="numeric" aria-label="${t('單價', 'Unit price')}"></span>
        <button type="button" class="btn rm" title="${t('刪除', 'Delete')}" aria-label="${t('刪除', 'Delete')}">✕</button></div>`).join('')}</div>
      <button type="button" class="btn pl-add"${W.lines.length >= MAX_LINES ? ' disabled' : ''}>＋ ${t('新增工程項目', 'Add a works line')}</button>`;
    panel('works').querySelectorAll('.rm').forEach(b => b.addEventListener('click', () => { collect(); W.lines.splice(+b.closest('.pl-line').dataset.i, 1); drawWorks(); }));
    panel('works').querySelector('.pl-add').addEventListener('click', () => { collect(); W.lines.push({ id: `l${Date.now().toString(36)}`, name: '', spec: '', unit: '式', qty: 1, price: 0, on: true }); drawWorks(); panel('works').querySelector('.pl-line:last-child [data-f=name]').focus(); });
  }
  // the form → W (prices as typed; checkPrices rejects anything not a whole number in range)
  function collect() {
    const num = v => (v === '' ? NaN : +v);
    W.name = form.elements['pl-name'].value.trim(); W.date = form.elements['pl-date'].value || ''; W.taxRate = +form.elements['pl-tax'].value;
    W.labour = form.elements['pl-labour'].value.trim(); W.notes = form.elements['pl-notes'].value.split('\n').map(s => s.trim()).filter(Boolean);
    dlg.querySelectorAll('[data-unit]').forEach(s => { W.units[s.dataset.unit] = s.value; });
    dlg.querySelectorAll('[data-waste]').forEach(i => { W.waste[i.dataset.waste] = num(i.value) / 100; });
    W.furniture = {};
    dlg.querySelectorAll('.pl-p[data-k]').forEach(i => {
      const k = i.dataset.k, v = num(i.value);
      if (k.startsWith('f:')) { const key = k.slice(2); if (v !== +key.split('@').pop()) W.furniture[key] = v; } else W.finishes[k] = v;
    });
    W.lines = [...dlg.querySelectorAll('.pl-line')].map((row, i) => {
      const f = n => row.querySelector(`[data-f=${n}]`);
      return { ...(W.lines[i] || {}), name: f('name').value.trim(), spec: f('spec').value.trim(), unit: f('unit').value, price: num(f('price').value), on: f('on').checked };
    });
    return W;
  }
  $('.pl-reset').addEventListener('click', () => { if (!confirm(t('把所有單價恢復成示範價目表？（儲存後才會生效）', 'Reset every price to the sample list? (Takes effect when you save.)'))) return; W = defaultPrices(groups); draw(); });
  form.addEventListener('input', e => { if (e.target.classList.contains('pl-p') || e.target.classList.contains('pl-w')) e.target.removeAttribute('aria-invalid'); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const P = collect(), chk = checkPrices(P), err = $('.pl-err');
    dlg.querySelectorAll('.pl-p').forEach(i => { const v = i.value === '' ? NaN : +i.value; i.toggleAttribute('aria-invalid', !(Number.isInteger(v) && v >= 0 && v <= 10_000_000)); });
    dlg.querySelectorAll('.pl-w').forEach(i => { const v = i.value === '' ? NaN : +i.value; i.toggleAttribute('aria-invalid', !(v >= 0 && v <= 50)); });
    err.textContent = chk.errors.join(t('；', '; '));
    if (!chk.ok) { const bad = dlg.querySelector('[aria-invalid]'); if (bad) { const p = bad.closest('.pl-panel'); if (p && p.hidden) dlg.querySelector(`[data-tab="${p.dataset.panel}"]`).click(); bad.focus(); } return; }
    const save = $('#pl-save'); save.disabled = true; save.textContent = t('儲存中…', 'Saving…');
    try {
      const clean = normPrices(P);
      await C.savePrices(clean);
      setFirm({ ...(getFirm() || {}), prices: clean });
      close();
      const n = priceChanges(clean, groups);
      toast(t(`已儲存價目表（調整 ${n.finishes} 項材質、${n.furniture} 項家具，${n.lines} 個工程項目）：報價與提案書會使用新單價`, `Price list saved (${n.finishes} finish and ${n.furniture} furniture prices changed, ${n.lines} works lines): quotes and proposals now use it`));
    } catch (er) { console.warn('prices save', er); toast(t('價目表儲存失敗，請稍後再試', 'Could not save the price list; try again shortly')); }
    save.disabled = !C.pricesAvailable(); save.textContent = t('儲存', 'Save');
  });

  async function open() {
    try { groups = groups || await finishGroups(); } catch (e) { console.warn('price list', e); toast(t('無法載入價目表', 'Could not load the price list')); return; }
    const firm = getFirm();
    W = withDefaults(firm && firm.prices, groups);
    draw();
    const off = !C.pricesAvailable();
    $('.pl-off').hidden = !off; $('#pl-save').disabled = off; $('.pl-err').textContent = '';
    if (!dlg.open) dlg.showModal();
  }
  return { open, close };
}
