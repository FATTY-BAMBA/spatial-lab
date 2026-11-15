// AI 效果圖: photoreal renders generated from our own 3D views (geometry-locked),
// shown against the real-time frame they came from with a before/after split.
import { t, localizeData } from './i18n.js';
const $ = s => document.querySelector(s);

// cloud (saved projects): { renders, canGenerate, generate(onFrame) → render | null, remove(id) }
// A saved render is { id, room, roomEn, style, before, after, thumb, pose }; each one is a shot.
const shotOf = r => ({ id: r.id, name: r.room || t('空間', 'Space'), nameEn: r.roomEn || '', pose: r.pose, renders: { [r.style || 'original']: { before: r.before, after: r.after, thumb: r.thumb || r.after } } });

export async function setupAI({ projectKey, styles, currentStyle, onStyle, onWalk, cloud = null }) {
  let manifest = null;
  if (cloud) manifest = { project: projectKey, shots: (cloud.renders || []).map(shotOf).reverse() };
  else try { manifest = localizeData(await (await fetch(`assets/ai/${projectKey}.json`, { cache: 'no-cache' })).json()); } catch { manifest = null; }
  const btn = $('#ai-open');
  const canGen = !!(cloud && cloud.canGenerate);
  if (!canGen && (!manifest || !manifest.shots || !manifest.shots.length)) { btn.hidden = true; return { open() {} }; }
  btn.hidden = false;

  const root = $('#ai'), stage = root.querySelector('.ai-stage'), imgA = root.querySelector('.ai-a'), imgB = root.querySelector('.ai-b');
  const handle = root.querySelector('.ai-handle'), thumbs = root.querySelector('.ai-thumbs'), chips = root.querySelector('.ai-styles');
  const dayBtn = root.querySelector('.ai-tod'), dl = root.querySelector('.ai-dl'), walkBtn = root.querySelector('.ai-walk');
  const playBtn = root.querySelector('.ai-play'), vid = root.querySelector('.ai-vid');
  let shot = manifest.shots[0] || null, style = 'original', dusk = false, split = 0.5, anim = 0, busy = false;
  const genBtn = root.querySelector('.ai-gen'), setBtn = root.querySelector('.ai-set'), delBtn = root.querySelector('.ai-del'), status = root.querySelector('.ai-status');
  genBtn.hidden = !canGen; delBtn.hidden = !canGen; setBtn.hidden = !(canGen && cloud.generateSet);
  root.querySelector('.ai-film').hidden = !!cloud;

  const rendersOf = (s, st) => (s.renders || {})[st];
  const stylesFor = s => Object.keys(s.renders || {});
  const styleName = id => (styles().find(x => x.id === id) || { name: id }).name;

  function setSplit(v) {
    split = Math.max(0, Math.min(1, v));
    imgB.style.clipPath = `inset(0 0 0 ${(split * 100).toFixed(2)}%)`;
    handle.style.left = `${split * 100}%`;
    handle.setAttribute('aria-valuenow', Math.round(split * 100));
  }
  function sweep() { // reveal: the AI frame wipes in over the real-time frame
    cancelAnimationFrame(anim);
    const t0 = performance.now(), dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 1500;
    root.classList.add('scanning');
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      setSplit(1 - e * 0.5 - (k < 1 ? 0 : 0));
      if (k < 1) anim = requestAnimationFrame(step); else root.classList.remove('scanning');
    };
    setSplit(1); anim = requestAnimationFrame(step);
  }
  function load(animate = true) {
    const empty = !shot; root.classList.toggle('empty', empty);
    if (empty) { imgA.removeAttribute('src'); imgB.removeAttribute('src'); renderThumbs(); chips.innerHTML = ''; root.querySelector('.ai-room').textContent = ''; root.querySelector('.ai-room-en').textContent = ''; root.querySelector('.ai-style-now').textContent = ''; dl.hidden = true; delBtn.hidden = true; walkBtn.hidden = true; return; }
    dl.hidden = false; delBtn.hidden = !canGen; walkBtn.hidden = false;
    const r = rendersOf(shot, style) || rendersOf(shot, 'original') || Object.values(shot.renders)[0];
    const after = dusk && r.dusk ? r.dusk : r.after;
    root.classList.add('loading');
    let n = 0; const done = () => { if (++n === 2) { root.classList.remove('loading'); if (animate) sweep(); } };
    imgA.onload = imgB.onload = done; imgA.onerror = imgB.onerror = done;
    imgA.src = r.before; imgB.src = after;
    dl.href = after; dl.download = `${manifest.project || 'spatial'}-${shot.id}-${style}${dusk ? '-dusk' : ''}.jpg`;
    stopVideo(); playBtn.hidden = !(shot.video && style === 'original');
    dayBtn.hidden = !r.dusk; dayBtn.setAttribute('aria-pressed', String(dusk));
    dayBtn.textContent = dusk ? t('黃昏 ☾', 'Dusk ☾') : t('白天 ☀', 'Day ☀');
    root.querySelector('.ai-room').textContent = shot.name;
    root.querySelector('.ai-room-en').textContent = shot.nameEn || '';
    root.querySelector('.ai-style-now').textContent = styleName(style);
    thumbs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shot === shot.id)));
    renderChips();
  }
  function renderChips() {
    chips.innerHTML = '';
    for (const id of stylesFor(shot)) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = styleName(id);
      b.setAttribute('aria-pressed', String(id === style));
      b.addEventListener('click', () => { if (id === style) return; style = id; onStyle && onStyle(id); load(); });
      chips.appendChild(b);
    }
  }
  function renderThumbs() {
    thumbs.innerHTML = '';
    for (const s of manifest.shots) {
      const r = rendersOf(s, 'original') || Object.values(s.renders)[0];
      const b = document.createElement('button'); b.type = 'button'; b.dataset.shot = s.id;
      b.innerHTML = `<img alt="" loading="lazy" src="${r.thumb || r.after}"><span></span>`;
      b.querySelector('span').textContent = cloud ? `${s.name} · ${styleName(Object.keys(s.renders)[0])}` : s.name;
      b.addEventListener('click', () => { if (busy) return; shot = s; style = rendersOf(s, style) ? style : Object.keys(s.renders)[0]; dusk = dusk && !!rendersOf(s, style).dusk; load(); });
      thumbs.appendChild(b);
    }
  }
  function open(shotId) {
    if (shotId) shot = manifest.shots.find(s => s.id === shotId) || shot;
    const cur = currentStyle();
    if (shot) style = cur && rendersOf(shot, cur) ? cur : rendersOf(shot, 'original') ? 'original' : Object.keys(shot.renders)[0];
    renderThumbs();
    root.hidden = false; document.body.classList.add('ai-on');
    load();
    root.querySelector('.ai-close').focus({ preventScroll: true });
  }
  // a new render from the designer's current 3D view: the frame shows at once, the AI picture wipes in when ready
  async function generate() {
    if (busy || !canGen) return;
    busy = true; root.classList.add('generating'); genBtn.disabled = true;
    const say = m => { status.textContent = m; status.hidden = !m; };
    say(t('擷取目前視角…', 'Capturing this view…'));
    try {
      const rec = await cloud.generate(frame => {
        root.hidden = false; document.body.classList.add('ai-on'); root.classList.remove('empty');
        imgA.src = frame; imgB.removeAttribute('src'); setSplit(1);
        say(t('AI 正在生成效果圖，約 20–40 秒…', 'AI is rendering this view, about 20–40 s…'));
      });
      if (!rec) { say(''); if (!shot) close(); return; }
      const s = shotOf(rec); manifest.shots.unshift(s); shot = s; style = Object.keys(s.renders)[0]; dusk = false;
      say(''); open(s.id);
    } catch (e) {
      console.warn('render', e);
      say(e && e.message ? e.message : t('生成失敗，請稍後再試', 'Render failed; try again later'));
      setTimeout(() => say(''), 7000);
      if (shot) load(false);
    } finally { busy = false; root.classList.remove('generating'); genBtn.disabled = false; }
  }
  genBtn.addEventListener('click', () => { close(); setTimeout(generate, 60); });
  // ✦ proposal set: the main rooms from photographer angles, rendered together; each wipes in as it lands
  async function generateSet() {
    if (busy || !canGen || !cloud.generateSet) return;
    busy = true; root.classList.add('generating'); genBtn.disabled = setBtn.disabled = true;
    const say = m => { status.textContent = m; status.hidden = !m; };
    root.hidden = false; document.body.classList.add('ai-on'); root.classList.remove('empty');
    say(t('擷取主要空間的視角…', 'Capturing the main rooms…'));
    let jobs = [];
    try {
      jobs = await cloud.generateSet((i, frame, room) => { imgA.src = frame; imgB.removeAttribute('src'); setSplit(1); root.querySelector('.ai-room').textContent = room ? room.name : ''; });
      if (!jobs.length) { say(t('找不到可以拍的房間', 'No rooms to shoot')); setTimeout(() => say(''), 5000); return; }
      let done = 0, failed = 0, first = null;
      say(t(`AI 正在生成 ${jobs.length} 張效果圖，約 30–50 秒…`, `AI is rendering ${jobs.length} views, about 30–50 s…`));
      await Promise.all(jobs.map(j => j.then(rec => {
        const sh = shotOf(rec); manifest.shots.unshift(sh); done++; first = first || sh; renderThumbs();
        say(t(`已完成 ${done} / ${jobs.length}`, `${done} of ${jobs.length} done`));
      }).catch(e => { failed++; console.warn('render', e); say(e && e.message ? e.message : t('部分效果圖失敗', 'Some renders failed')); })));
      root.classList.remove('generating'); say(failed ? t(`${done} 張完成，${failed} 張失敗`, `${done} done, ${failed} failed`) : '');
      if (failed) setTimeout(() => say(''), 6000);
      if (first) open(first.id); else if (!shot) load(false);
    } catch (e) { console.warn('render set', e); say(e && e.message ? e.message : t('生成失敗，請稍後再試', 'Render failed; try again later')); setTimeout(() => say(''), 7000); }
    finally { busy = false; root.classList.remove('generating'); genBtn.disabled = setBtn.disabled = false; }
  }
  setBtn.addEventListener('click', generateSet);
  delBtn.addEventListener('click', async () => {
    if (!shot || busy || !window.confirm(t('刪除這張效果圖？', 'Delete this render?'))) return;
    const id = shot.id; manifest.shots = manifest.shots.filter(s => s.id !== id); shot = manifest.shots[0] || null;
    renderThumbs(); load(false);
    try { await cloud.remove(id); } catch (e) { console.warn(e); }
  });
  function close() { cancelAnimationFrame(anim); stopVideo(); root.hidden = true; document.body.classList.remove('ai-on'); btn.focus({ preventScroll: true }); }

  function stopVideo() { vid.pause(); vid.hidden = true; root.classList.remove('playing'); }
  playBtn.addEventListener('click', () => {
    cancelAnimationFrame(anim); dusk = false;
    const r = rendersOf(shot, 'original'); imgB.src = r.after; setSplit(0);
    vid.src = shot.video; vid.hidden = false; root.classList.add('playing'); vid.currentTime = 0; vid.play().catch(() => stopVideo());
  });
  vid.addEventListener('ended', () => { vid.hidden = true; root.classList.remove('playing'); });
  // drag / keys
  let drag = false;
  const toSplit = e => { const r = stage.getBoundingClientRect(); setSplit((e.clientX - r.left) / r.width); };
  stage.addEventListener('pointerdown', e => { if (e.target.closest('button,a')) return; if (!vid.hidden) stopVideo(); drag = true; cancelAnimationFrame(anim); stage.setPointerCapture(e.pointerId); toSplit(e); });
  stage.addEventListener('pointermove', e => { if (drag) toSplit(e); });
  stage.addEventListener('pointerup', () => { drag = false; });
  handle.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') setSplit(split - 0.05); if (e.key === 'ArrowRight') setSplit(split + 0.05); });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  root.querySelector('.ai-close').addEventListener('click', close);
  dayBtn.addEventListener('click', () => { dusk = !dusk; load(); });
  walkBtn.addEventListener('click', () => { close(); onWalk && onWalk(shot); });
  btn.addEventListener('click', () => open());
  return { open, close, generate, manifest: cloud ? null : manifest };
}
