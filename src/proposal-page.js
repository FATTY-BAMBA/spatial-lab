// 提案書: the client-facing, printable proposal of a saved project, branded with the design firm.
//   /proposal?share=<token>  the client (read-only, no sign-in; firm fields come from spatial_shared)
//   /proposal?id=<project>   the owner's own preview (signed in; firm from 公司資料)
//   &style=<id>              which style is quoted (default: the style with the most AI renders)
import { loadPlan } from './plan.js';
import { t, isEn, unitLabel, localizeData, langSwitch } from './i18n.js';
import { drawLevel } from './drawing.js';
import { styleList, pickStyle, proposalData, money } from './proposal-doc.js';
import { normFirm, onColor, contactLines, initials } from './firm.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const params = new URLSearchParams(location.search);
const token = params.get('share'), pid = params.get('id');
const day = d => new Date(d || Date.now()).toLocaleDateString(isEn ? 'en-GB' : 'zh-TW', { year: 'numeric', month: isEn ? 'short' : '2-digit', day: '2-digit' });

function fail(title, body) {
  $('#doc').innerHTML = `<div class="state"><b>${esc(title)}</b>${esc(body)}</div>`;
  document.title = t('設計提案書', 'Design proposal');
}

async function boot() {
  document.title = t('設計提案書', 'Design proposal');
  if (!token && !pid) return fail(t('找不到提案', 'No proposal here'), t('請用設計師提供的連結開啟。', 'Open this page from the link your designer sent you.'));
  let C, row = null, firm = null;
  try {
    C = await import('./cloud.js');
    if (token) { row = await C.sharedProject(token); firm = row && row.firm; }
    else {
      if (!(await C.currentUser())) { location.href = `/projects`; return; }
      [row, firm] = await Promise.all([C.loadProject(pid), C.getFirm()]);
    }
  } catch (e) { console.warn('proposal', e); }
  if (!row || !row.doc) return fail(t('這個提案連結已失效', 'This proposal link no longer works'), t('設計師可能已停止分享。請向設計師索取新的連結。', 'Your designer may have stopped sharing it. Ask them for a new link.'));

  const [{ completePlan }, base, catalog] = await Promise.all([import('./editor/geometry.js'), loadPlan('data/apartment.json'), loadPlan('data/styles.json').catch(() => ({}))]);
  const plan = localizeData(completePlan(row.doc, base));
  // only the project's own type label: completePlan fills gaps from the sample apartment, which is not this home
  const own = row.doc.project || {}, typeLabel = (isEn ? own.typeLabelEn : own.typeLabel) || '';
  localizeData(catalog);
  const styles = styleList(plan, catalog);
  const renders = row.renders || [];
  let styleId = pickStyle(styles, renders, params.get('style'));
  const F = normFirm(firm);
  if (F) { document.documentElement.style.setProperty('--brand', F.color); document.documentElement.style.setProperty('--on-brand', onColor(F.color)); document.documentElement.style.setProperty('--tint', F.color + '14'); }
  const name = row.name || plan.project.name || t('設計提案', 'Design proposal');
  document.title = F ? `${name} · ${F.name}` : `${name} · ${t('設計提案書', 'Design proposal')}`;

  // toolbar
  const who = $('#who');
  who.innerHTML = F ? `${F.logo ? `<img src="${esc(F.logo)}" alt="">` : ''}<span>${esc(F.name)}</span>` : `<span>${esc(name)}</span>`;
  $('#style-l').textContent = t('報價風格', 'Quoted style');
  const sel = $('#style');
  sel.innerHTML = styles.map(s => `<option value="${esc(s.id)}">${esc(s.name)}${renders.some(r => r.style === s.id) ? ' ✦' : ''}</option>`).join('');
  sel.value = styleId;
  sel.addEventListener('change', () => { styleId = sel.value; const u = new URL(location.href); u.searchParams.set('style', styleId); history.replaceState(null, '', u); draw(); });
  const view3d = token ? `/?share=${encodeURIComponent(token)}` : `/?id=${encodeURIComponent(pid)}`;
  const o3 = $('#open3d'); o3.href = view3d; o3.textContent = t('開啟 3D 導覽', 'Open the 3D');
  $('#print').textContent = t('列印 / 存成 PDF', 'Print / save as PDF');
  $('#print').addEventListener('click', printNow);
  $('#tools').append(langSwitch());
  $('#tools').hidden = false;
  if (!token) {
    const n = $('#note');
    n.innerHTML = F
      ? `${t('這是客戶看到的提案書預覽。', 'This is the proposal your client sees.')} ${row.share_token ? '' : t('專案尚未開啟分享，客戶還打不開。', 'Sharing is off for this project, so your client cannot open it yet.')} <a href="/projects">${t('回到我的專案', 'Back to my projects')}</a>`
      : `${t('尚未設定公司資料：提案書與分享連結會顯示你的 Logo、公司名稱與聯絡方式。', 'No firm profile yet: add it and the proposal and share link show your logo, name and contact details.')} <a href="/projects#firm">${t('設定公司資料 →', 'Set up your firm profile →')}</a>`;
    n.hidden = false;
  }

  // floor plans, drawn once (they do not change with the style)
  const planImgs = plan.levels.map(L => { try { return { id: L.id, name: L.name, src: drawLevel(plan, L, { pxPerM: 56, paper: true, noGrid: true }).canvas.toDataURL('image/png') }; } catch (e) { console.warn('plan drawing', e); return null; } }).filter(Boolean);
  const shareLink = token ? `${location.origin}/?share=${encodeURIComponent(token)}` : row.share_token ? `${location.origin}/?share=${encodeURIComponent(row.share_token)}` : '';

  function draw() {
    const D = proposalData({ plan, renders, styles, styleId });
    const st = D.style, hero = D.renders[0];
    const mast = `<header class="mast"><div class="firm">${F ? (F.logo ? `<img src="${esc(F.logo)}" alt="${esc(F.name)}">` : `<span class="ini" aria-hidden="true">${esc(initials(F.name))}</span>`) + `<b>${esc(F.name)}</b>` : `<b>${esc(name)}</b>`}</div><div class="kind">PROPOSAL<b>${t('設計提案書', 'Design proposal')}</b></div></header>`;
    const reach = F ? contactLines(F).filter(l => l.k !== 'tax').map(l => `<span><b>${esc(l.label)}</b>${l.href ? `<a href="${esc(l.href)}">${esc(l.value)}</a>` : esc(l.value)}</span>`).join('') : '';
    const powered = `<p class="powered">Powered by <a href="https://spatial.primestrideai.com" target="_blank" rel="noopener">PrimeStride Spatial Lab</a></p>`;
    const facts = [
      [t('業主', 'Client'), row.client || '—'],
      [t('提案日期', 'Date'), day(row.updated_at)],
      [t('風格', 'Style'), st.name],
      [t('室內面積', 'Interior'), `${D.rooms.interior.ping} ${unitLabel('坪')}`],
    ];
    const cover = `<section class="sheet cover" data-page="cover">${mast}
      <figure class="hero">${hero ? `<img src="${esc(hero.src)}" alt="${esc(hero.room)}">${hero.room ? `<figcaption>${esc(hero.room)} · ${t('AI 效果圖', 'AI render')}</figcaption>` : ''}` : planImgs[0] ? `<img class="plan" src="${planImgs[0].src}" alt="${t('平面圖', 'Floor plan')}">` : ''}</figure>
      <h1>${esc(name)}</h1>
      <p class="sub">${esc([typeLabel, plan.levels.length > 1 ? plan.levels.map(L => L.id).join(' / ') : ''].filter(Boolean).join(' · '))}</p>
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="reach">${reach}</div>
    </section>`;

    const gallery = D.renders.slice(0, 6);
    const multi = plan.levels.length > 1;
    const p2 = `<section class="sheet" data-page="space">
      <section class="part"><h2>${t('空間效果圖', 'Renders')}<small>RENDERS</small></h2>
        <p class="lede">${t('依本案 3D 模型以 AI 生成，牆體、門窗與家具位置與平面一致，材質與光線僅供示意。', 'Generated by AI from this project\'s 3D model: walls, openings and furniture match the plan; materials and light are illustrative.')}</p>
        ${gallery.length ? `<div class="gallery">${gallery.map(g => `<figure><img src="${esc(g.src)}" alt="${esc(g.room)}" loading="eager"><figcaption>${esc(g.room || t('空間', 'Space'))}<span>${esc(g.style)}</span></figcaption></figure>`).join('')}</div>` : `<div class="empty">${t('這個專案還沒有 AI 效果圖。可在 3D 導覽中查看各空間。', 'No AI renders for this project yet. Walk the 3D to see each room.')}</div>`}
      </section>
      <section class="part"><h2>${t('平面與面積', 'Plan and areas')}<small>PLAN</small></h2>
        <div class="plans${planImgs.length > 2 ? ' three' : planImgs.length > 1 ? ' two' : ''}">${planImgs.map(p => `<figure><img src="${p.src}" alt="${esc(p.name)} ${t('平面圖', 'floor plan')}">${multi ? `<figcaption>${esc(p.name)}</figcaption>` : ''}</figure>`).join('')}</div>
        <table class="rooms"><thead><tr>${multi ? `<th>${t('樓層', 'Floor')}</th>` : ''}<th>${t('空間', 'Room')}</th><th class="num">m²</th><th class="num">${unitLabel('坪')}</th></tr></thead>
          <tbody>${D.rooms.rows.map(r => `<tr>${multi ? `<td class="muted">${esc(r.level)}</td>` : ''}<td>${esc(r.name)}${r.outdoor ? ` <span class="muted">${t('（戶外）', '(outdoor)')}</span>` : ''}</td><td class="num">${r.m2.toFixed(1)}</td><td class="num">${r.ping.toFixed(1)}</td></tr>`).join('')}</tbody>
          <tfoot><tr>${multi ? '<td></td>' : ''}<td>${t('室內合計', 'Interior total')}</td><td class="num">${D.rooms.interior.m2.toFixed(1)}</td><td class="num">${D.rooms.interior.ping.toFixed(1)}</td></tr>
          ${D.rooms.outdoor.m2 ? `<tr class="muted">${multi ? '<td></td>' : ''}<td>${t('陽台與戶外', 'Balconies and outdoor')}</td><td class="num">${D.rooms.outdoor.m2.toFixed(1)}</td><td class="num">${D.rooms.outdoor.ping.toFixed(1)}</td></tr>` : ''}</tfoot></table>
        <p class="basis">${t('面積依平面圖牆中心線計算，僅供規劃參考，以實際丈量為準。', 'Areas are measured to wall centre lines from the plan, for planning only; site measurements prevail.')}</p>
      </section>
    </section>`;

    const Q = D.quote;
    const contact = F ? `<div class="card"><b>${esc(F.name)}</b>${contactLines(F).map(l => `<p><span>${esc(l.label)}</span>${l.href ? `<a href="${esc(l.href)}">${esc(l.value)}</a>` : esc(l.value)}</p>`).join('')}</div>` : `<div class="card"><b>${t('設計師', 'Designer')}</b><p class="muted">${t('聯絡方式請洽您的設計師。', 'Contact your designer for details.')}</p></div>`;
    const p3 = `<section class="sheet" data-page="quote">
      <section class="part"><h2>${t('風格與材質', 'Style and finishes')}<small>${esc(st.nameEn || st.name).toUpperCase()}</small></h2>
        <p class="lede">${esc(st.tagline || '')}</p>
        <ul class="swatches">${D.finishes.map(f => `<li><i style="background:${esc(f.color)}"></i><span>${esc(f.group)}</span><b>${esc(f.name)}</b></li>`).join('')}</ul>
      </section>
      <section class="part"><h2>${t('報價摘要', 'Quote summary')}<small>QUOTATION</small></h2>
        <table class="q"><thead><tr><th>${t('項目', 'Item')}</th><th>${t('品項', 'Selection')}</th><th class="num">${t('數量', 'Qty')}</th><th class="num">${t('單價', 'Unit price')}</th><th class="num">${t('複價', 'Amount')}</th></tr></thead>
          <tbody>${Q.finish.filter(l => l.total > 0).map(l => `<tr><td>${esc(l.group)}</td><td>${esc(l.name)}</td><td class="num">${l.qty.toFixed(1)} ${esc(unitLabel(l.unit))}</td><td class="num">${money(l.unitPrice)}</td><td class="num">${money(l.total)}</td></tr>`).join('')}
          <tr><td>${t('家具', 'Furniture')}</td><td>${t(`暫估預算（${Q.furniture} 件）`, `Allowance (${Q.furniture} pcs)`)}</td><td class="num">1 ${unitLabel('式')}</td><td class="num"></td><td class="num">${money(Q.allowance)}</td></tr></tbody></table>
        <dl class="totals" data-total="${Q.total}" data-grand="${Q.grand}">
          <div class="sub"><dt>${t('小計（未稅）', 'Subtotal (excl. tax)')}</dt><dd>NT$ ${money(Q.total)}</dd></div>
          <div><dt>${t(`營業稅 ${Math.round(Q.taxRate * 100)}%`, `Business tax ${Math.round(Q.taxRate * 100)}%`)}</dt><dd>NT$ ${money(Q.tax)}</dd></div>
          <div class="grand"><dt>${t('合計（含稅）', 'Total (incl. tax)')}</dt><dd>NT$ ${money(Q.grand)}</dd></div>
        </dl>
        <p class="basis">${t('本報價為初步估算，實際金額以正式報價單與現場丈量為準。', 'This is a preliminary estimate; the formal quotation and site measurements prevail.')} ${esc(Q.basis.priceBook)} · ${t('價格基準', 'prices as of')} ${esc(Q.basis.priceDate)} · ${esc(Q.basis.labour)} · ${t('已含損耗', 'waste included')}<br>${esc(Q.basis.notes.join(t('；', '; ')))}</p>
      </section>
      <div class="contact">${contact}<div class="sign"><div>${t('業主確認', 'Client')}</div><div>${t('設計師', 'Designer')}</div></div></div>
      ${shareLink ? `<p class="link3d">${t('線上 3D 導覽：', 'Walk it in 3D: ')}<a href="${esc(shareLink)}">${esc(shareLink)}</a></p>` : ''}
      ${powered}
    </section>`;
    $('#doc').innerHTML = cover + p2 + p3;
  }
  draw();
  document.body.classList.add('ready');
  window.__proposal = { plan, styles, get styleId() { return styleId; }, draw };
}

async function printNow() {
  const imgs = [...document.querySelectorAll('#doc img')];
  await Promise.all(imgs.map(i => (i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
  window.print();
}

boot().catch(e => { console.error(e); fail(t('無法載入提案', 'Could not load the proposal'), String(e.message || e)); });
