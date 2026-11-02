// 提案模式: two style schemes side by side with AI renders, priced from the same plan data,
// a client approval stamp, a printable one-page proposal and a StrideBrain hand-off.
import { buildQuote, polygonArea, toPing } from './plan.js';
import { drawLevel } from './drawing.js';

const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString('en-US');
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function setupProposal({ plan, projectKey, styles, currentStyle, manifest, snapshot, onView }) {
  const root = $('#proposal');
  const key = `spatial.approval.${projectKey}`;
  let approval = null;
  try { approval = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
  const pick = { A: null, B: null };
  const styleById = id => styles().find(s => s.id === id);
  const quoteOf = st => buildQuote(plan, { ...plan.defaultFinishes, ...st.finishes });
  const shotsWith = sid => (manifest && manifest.shots || []).map(s => ({ s, r: (s.renders || {})[sid] })).filter(x => x.r);
  const finishRows = st => plan.finishes.map(g => {
    const o = g.options.find(x => x.id === (st.finishes[g.id] || plan.defaultFinishes[g.id])) || g.options[0];
    return { group: g.name, name: o.name, color: o.tint || o.color || '#ccc' };
  });
  let interior = 0;
  for (const L of plan.levels) for (const r of L.rooms) if (!r.outdoor) interior += polygonArea(r.polygon);

  function heroOf(sid) {
    const list = shotsWith(sid);
    const hero = list.find(x => x.s.id === 'living') || list[0];
    return { hero, rest: list.filter(x => x !== hero).slice(0, 3) };
  }

  function renderSide(side) {
    const el = root.querySelector(`.pp-opt[data-side="${side}"]`);
    const st = styleById(pick[side]), other = styleById(pick[side === 'A' ? 'B' : 'A']);
    const q = quoteOf(st), qo = quoteOf(other), delta = q.total - qo.total;
    const { hero, rest } = heroOf(st.id);
    const approved = approval && approval.style === st.id;
    el.classList.toggle('approved', !!approved);
    el.classList.toggle('dim', !!approval && !approved);
    el.innerHTML = `
      <div class="pp-head"><span class="pp-letter">方案 ${side}</span>
        <label class="pp-pick"><span class="sr">風格</span><select>${styles().map(s => `<option value="${s.id}"${s.id === st.id ? ' selected' : ''}>${s.name}</option>`).join('')}</select></label>
        <span class="pp-tag">${st.tagline || ''}</span></div>
      <figure class="pp-hero">${hero ? `<img src="${hero.r.after}" alt="${st.name} ${hero.s.name} AI 效果圖">` : '<div class="pp-none">正在產生這個風格的 3D 畫面</div>'}
        <figcaption>${hero ? `${hero.s.name}，AI 效果圖` : ''}</figcaption>
        ${approved ? `<div class="pp-seal"><b>核准</b><span>APPROVED</span><i>${approval.at}</i></div>` : ''}</figure>
      <div class="pp-thumbs">${rest.map(x => `<img src="${x.r.thumb || x.r.after}" alt="${x.s.name}" title="${x.s.name}">`).join('')}</div>
      <ul class="pp-fin">${finishRows(st).map(f => `<li><i style="background:${f.color}"></i><span>${f.group}</span><b>${f.name}</b></li>`).join('')}</ul>
      <dl class="pp-sum">
        <div><dt>材質工程（含工帶料、含損耗）</dt><dd>${fmt(q.finishTotal)}</dd></div>
        <div><dt>家具（暫估）</dt><dd>${fmt(q.allowance)}</dd></div>
        <div class="tot"><dt>小計（未稅）</dt><dd>NT$ ${fmt(q.total)}</dd></div>
        <div><dt>含稅 ${Math.round(q.basis.taxRate * 100)}%</dt><dd>${fmt(q.grand)}</dd></div>
      </dl>
      <div class="pp-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta === 0 ? '與另一方案同價' : `比方案 ${side === 'A' ? 'B' : 'A'} ${delta > 0 ? '多' : '省'} NT$ ${fmt(Math.abs(delta))}`}</div>
      <div class="pp-btns">
        <button type="button" class="pp-view">在 3D 中查看</button>
        ${approved ? '<button type="button" class="pp-undo">撤銷核准</button>' : `<button type="button" class="pp-approve"${approval ? ' disabled' : ''}>核准此方案</button>`}
      </div>`;
    if (!hero && snapshot) snapshot(st.id).then(url => {
      const fig = el.querySelector('.pp-hero');
      if (!fig || pick[side] !== st.id) return;
      if (!url) { fig.querySelector('.pp-none').textContent = '這個風格還沒有效果圖'; return; }
      const img = new Image(); img.alt = `${st.name} 即時 3D 畫面`; img.src = url;
      fig.querySelector('.pp-none').replaceWith(img); fig.querySelector('figcaption').textContent = '即時 3D 畫面';
    });
    el.querySelector('select').addEventListener('change', e => { pick[side] = e.target.value; render(); });
    el.querySelector('.pp-view').addEventListener('click', () => { close(); onView(st.id); });
    const ap = el.querySelector('.pp-approve'); if (ap) ap.addEventListener('click', () => approve(st, q));
    const un = el.querySelector('.pp-undo'); if (un) un.addEventListener('click', () => { approval = null; save(); render(); });
  }

  function approve(st, q) {
    const now = new Date();
    approval = { style: st.id, name: st.name, at: stamp(now), iso: now.toISOString(), total: q.total, grand: q.grand, finishes: { ...plan.defaultFinishes, ...st.finishes }, ref: `P-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}` };
    save(); render();
    root.querySelector('.pp-bar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function save() { try { approval ? localStorage.setItem(key, JSON.stringify(approval)) : localStorage.removeItem(key); } catch {} }

  function renderBar() {
    const bar = root.querySelector('.pp-bar');
    if (!approval) { bar.innerHTML = '<p>客戶選定後按「核准此方案」：系統記錄核准時間、所選材質與當時價格，並產生一頁式提案。</p>'; return; }
    bar.innerHTML = `<p><b>已核准：${approval.name}</b> · ${approval.at} · 編號 ${approval.ref} · 含稅 NT$ ${fmt(approval.grand)}</p>
      <div><button type="button" class="pp-print">列印 / 存成 PDF</button><button type="button" class="pp-send primary">送至 StrideBrain</button></div>`;
    bar.querySelector('.pp-print').addEventListener('click', print);
    bar.querySelector('.pp-send').addEventListener('click', send);
  }

  function send() {
    const m = root.querySelector('.pp-modal');
    const q = buildQuote(plan, approval.finishes);
    m.hidden = false;
    m.innerHTML = `<div class="pp-card" role="alertdialog" aria-label="StrideBrain">
      <span class="pp-demo">示範流程 DEMO</span>
      <h3>已建立報價單草稿</h3>
      <p class="mono">${approval.ref.replace('P-', 'Q-')} · ${plan.project.name}</p>
      <ol><li class="done">核准方案：${approval.name}（${approval.at}）</li><li class="done">${q.lines.length} 項計價項目，含稅 NT$ ${fmt(q.grand)}</li><li>StrideBrain：報價單 → 業主簽回 → 開立工單</li></ol>
      <button type="button">好</button></div>`;
    m.querySelector('button').addEventListener('click', () => { m.hidden = true; });
  }

  async function print() {
    const st = styleById(approval.style), q = buildQuote(plan, approval.finishes), { rest } = heroOf(st.id);
    let { hero } = heroOf(st.id);
    if (!hero && snapshot) { const sn = await snapshot(st.id); if (sn) hero = { r: { after: sn }, s: { name: '' } }; }
    const L = plan.levels[0];
    const { canvas } = drawLevel(plan, L, { pxPerM: 60 });
    const sheet = root.querySelector('.pp-sheet');
    sheet.innerHTML = `
      <header><div><b>${plan.project.name}</b><span>${plan.project.typeLabel || ''} · 室內 ${toPing(interior).toFixed(1)} 坪</span></div><div class="r"><b>設計提案 PROPOSAL</b><span>${approval.ref} · ${approval.at}</span></div></header>
      <div class="sh-main">
        <div class="sh-left">${hero ? `<img class="sh-hero" src="${hero.r.after}" alt="">` : `<img class="sh-hero sh-plan" src="${canvas.toDataURL('image/png')}" alt="平面圖">`}<div class="sh-row">${rest.map(x => `<img src="${x.r.after}" alt="">`).join('')}${hero ? `<img class="sh-plan" src="${canvas.toDataURL('image/png')}" alt="平面圖">` : ''}</div></div>
        <div class="sh-right">
          <h2>${st.name} <small>${st.nameEn || ''}</small></h2>
          <table><tbody>${finishRows(st).map(f => `<tr><td><i style="background:${f.color}"></i>${f.group}</td><td>${f.name}</td></tr>`).join('')}</tbody></table>
          <table class="q"><tbody>
            ${q.lines.filter(l => l.finish).map(l => `<tr><td>${l.group} · ${l.name}</td><td>${l.qty.toFixed(1)} ${l.unit}</td><td>${fmt(l.total)}</td></tr>`).join('')}
            <tr><td>家具（暫估）</td><td></td><td>${fmt(q.allowance)}</td></tr>
            <tr class="s"><td>小計（未稅）</td><td></td><td>${fmt(q.total)}</td></tr>
            <tr><td>營業稅 ${Math.round(q.basis.taxRate * 100)}%</td><td></td><td>${fmt(q.tax)}</td></tr>
            <tr class="g"><td>合計（含稅）</td><td></td><td>NT$ ${fmt(q.grand)}</td></tr></tbody></table>
          <p class="basis">參考價格，正式估價以貴公司價目表為準。${q.basis.priceBook} · 價格基準 ${q.basis.priceDate} · ${q.basis.labour} · 損耗已計入<br>${q.basis.notes.join('；')}</p>
          <div class="sign"><div><span>業主確認</span></div><div><span>設計師</span></div><div class="seal"><b>核准</b><i>${approval.at}</i></div></div>
        </div>
      </div>
      <footer>PrimeStride Spatial Lab · 平面、3D、材質與報價來自同一份資料 · 效果圖依本案 3D 幾何以 AI 生成，僅供示意</footer>`;
    const imgs = [...sheet.querySelectorAll('img')];
    Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => window.print());
  }

  function render() {
    renderSide('A'); renderSide('B'); renderBar();
    root.querySelector('.pp-basis').textContent = (() => { const b = quoteOf(styleById(pick.A)).basis; return `以下價格僅供參考，正式估價將以貴公司價目表為準。計價依據：${b.priceBook}，價格基準 ${b.priceDate}，${b.labour}，地坪損耗 ${Math.round(b.waste.floor * 100)}%、牆面 ${Math.round(b.waste.paint * 100)}%。${b.notes.join('；')}。`; })();
  }

  function open() {
    const cur = currentStyle() || 'original';
    pick.A = approval ? approval.style : cur;
    pick.B = styles().find(s => s.id !== pick.A && shotsWith(s.id).length && s.id !== 'original')?.id || styles().find(s => s.id !== pick.A).id;
    const pr = plan.project;
    root.querySelector('.pp-title').innerHTML = `<b>${pr.name}</b><span>${pr.typeLabel || ''} · 室內 ${interior.toFixed(1)} m² · ${toPing(interior).toFixed(1)} 坪</span>`;
    render();
    root.hidden = false; document.body.classList.add('pp-on');
    root.querySelector('.pp-close').focus({ preventScroll: true });
  }
  function close() { root.hidden = true; document.body.classList.remove('pp-on'); }
  root.querySelector('.pp-close').addEventListener('click', close);
  root.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  $('#proposal-open').addEventListener('click', open);
  const top = $('#proposal-top'); if (top) top.addEventListener('click', open);
  return { open, close, get approval() { return approval; } };
}
