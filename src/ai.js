// AI 效果圖: photoreal renders generated from our own 3D views (geometry-locked),
// shown against the real-time frame they came from with a before/after split.
import { t, localizeData } from './i18n.js';
const $ = s => document.querySelector(s);

export async function setupAI({ projectKey, styles, currentStyle, onStyle, onWalk }) {
  let manifest = null;
  try { manifest = localizeData(await (await fetch(`assets/ai/${projectKey}.json`, { cache: 'no-cache' })).json()); } catch { manifest = null; }
  const btn = $('#ai-open');
  if (!manifest || !manifest.shots || !manifest.shots.length) { btn.hidden = true; return { open() {} }; }
  btn.hidden = false;

  const root = $('#ai'), stage = root.querySelector('.ai-stage'), imgA = root.querySelector('.ai-a'), imgB = root.querySelector('.ai-b');
  const handle = root.querySelector('.ai-handle'), thumbs = root.querySelector('.ai-thumbs'), chips = root.querySelector('.ai-styles');
  const dayBtn = root.querySelector('.ai-tod'), dl = root.querySelector('.ai-dl'), walkBtn = root.querySelector('.ai-walk');
  const playBtn = root.querySelector('.ai-play'), vid = root.querySelector('.ai-vid');
  let shot = manifest.shots[0], style = 'original', dusk = false, split = 0.5, anim = 0;

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
    const r = rendersOf(shot, style) || rendersOf(shot, 'original');
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
      b.innerHTML = `<img alt="" loading="lazy" src="${r.thumb || r.after}"><span>${s.name}</span>`;
      b.addEventListener('click', () => { shot = s; if (!rendersOf(s, style)) style = 'original'; dusk = dusk && !!rendersOf(s, style).dusk; load(); });
      thumbs.appendChild(b);
    }
  }
  function open(shotId) {
    if (shotId) shot = manifest.shots.find(s => s.id === shotId) || shot;
    const cur = currentStyle();
    style = cur && rendersOf(shot, cur) ? cur : 'original';
    renderThumbs();
    root.hidden = false; document.body.classList.add('ai-on');
    load();
    root.querySelector('.ai-close').focus({ preventScroll: true });
  }
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
  return { open, close, manifest };
}
