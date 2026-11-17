// T-010: 分享 from the 3D viewer (owner of a saved project only). Turns the read-only share link on (or reuses the
// project's token), shows it with 複製, LINE 分享 and a QR code the client across the table can scan, plus 停止分享.
import { t } from './i18n.js';
import { qrSvg } from './qr.js';

const ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="12" cy="3.5" r="2"/><circle cx="4" cy="8" r="2"/><circle cx="12" cy="12.5" r="2"/><path d="m5.8 7 4.4-2.5M5.8 9l4.4 2.5"/></svg>';
export const lineShareUrl = text => `https://line.me/R/share?text=${encodeURIComponent(text)}`;

/**
 * Cloud: src/cloud.js · id: project id · token: its current share token (or null) · name: project name ·
 * beforeOpen(): resolves once the designer's latest style is saved, so the link opens on it (T-011)
 */
export function setupShare({ Cloud, id, token = null, name = '', beforeOpen = async () => {} }) {
  const btn = Object.assign(document.createElement('button'), { type: 'button', id: 'share-open', className: 'act', title: t('分享給客戶', 'Share with your client') });
  btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `${ICON}<span class="lbl">${t('分享', 'Share')}</span>`;
  const bar = document.querySelector('.bar .actions'), anchor = document.getElementById('doc-link');
  if (anchor) anchor.before(btn); else bar.append(btn);

  const box = document.createElement('div');
  box.id = 'share'; box.className = 'xp sh'; box.hidden = true; box.tabIndex = -1; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', t('分享給客戶', 'Share with your client'));
  box.innerHTML = `<p class="xp-h sh-h">${t('分享給客戶', 'Share with your client')}<small>${t('唯讀連結：客戶可以走進 3D、換風格、看報價，不能修改。', 'Read-only link: your client can walk the 3D, switch styles and see the quote, but not change anything.')}</small></p>
    <p class="sh-wait">${t('建立連結中…', 'Creating the link…')}</p>
    <div class="sh-on" hidden>
      <div class="sh-qr"></div>
      <p class="sh-scan">${t('請客戶用手機相機掃描，直接打開 3D 提案', 'Your client scans this with the phone camera to open the 3D proposal')}</p>
      <div class="sh-row"><input class="sh-url" readonly aria-label="${t('分享連結', 'Share link')}"><button type="button" class="sh-copy">${t('複製', 'Copy')}</button></div>
      <div class="sh-btns"><a class="sh-line" target="_blank" rel="noopener">${t('LINE 分享', 'Share on LINE')}</a>${navigator.share ? `<button type="button" class="sh-more">${t('其他 App', 'Other apps')}</button>` : ''}<button type="button" class="sh-stop">${t('停止分享', 'Stop sharing')}</button></div>
    </div>
    <div class="sh-off" hidden><p class="sh-off-t"></p><button type="button" class="sh-again">${t('開啟分享連結', 'Turn the share link on')}</button></div>
    <p class="sh-status" aria-live="polite"></p>`;
  document.body.append(box);
  const $ = s => box.querySelector(s), status = msg => { $('.sh-status').textContent = msg || ''; };
  const url = () => Cloud.shareUrl(token);
  const message = () => t(`「${name || '3D 提案'}」的 3D 提案，可以走進去看、換風格、看報價：${url()}`, `The 3D proposal for "${name || 'your home'}": walk it, switch styles and see the quote: ${url()}`);

  function show(state, offText = '') {
    $('.sh-wait').hidden = state !== 'wait'; $('.sh-on').hidden = state !== 'on'; $('.sh-off').hidden = state !== 'off';
    if (state === 'on') {
      $('.sh-url').value = url();
      $('.sh-line').href = lineShareUrl(message());
      $('.sh-qr').innerHTML = qrSvg(url(), { label: t('分享連結的 QR code', 'QR code of the share link') });
    }
    if (state === 'off') $('.sh-off-t').textContent = offText;
    btn.classList.toggle('on', state === 'on' && !!token);
    // keyboard and screen readers land in the panel: on its first action, or on the panel while the link is made
    if (!box.hidden) (state === 'on' ? $('.sh-copy') : state === 'off' ? $('.sh-again') : box).focus({ preventScroll: true });
  }
  async function turnOn() {
    show('wait'); status('');
    try { await beforeOpen(); token = await Cloud.setShare(id, true); show('on'); }
    catch (e) { console.warn('share', e); show('off', t('無法建立分享連結，請確認網路後再試一次。', 'Could not create the share link. Check the network and try again.')); }
  }
  function open(v) {
    box.hidden = !v; btn.setAttribute('aria-expanded', String(v));
    if (!v) return;
    status('');
    if (token) { show('on'); beforeOpen(); } else turnOn();
  }
  btn.addEventListener('click', e => { e.stopPropagation(); open(box.hidden); });
  document.addEventListener('click', e => { if (!box.hidden && !box.contains(e.target) && e.target !== btn) open(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) { open(false); btn.focus(); } });
  $('.sh-url').addEventListener('focus', e => e.target.select());
  $('.sh-copy').addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(url()); ok = true; } catch {
      try { const i = $('.sh-url'); i.focus(); i.select(); ok = document.execCommand('copy'); } catch { /* old browsers */ }
    }
    status(ok ? t('已複製連結，可以貼到 LINE 或 Email', 'Link copied: paste it into LINE or an email') : t('請長按連結複製', 'Press and hold the link to copy it'));
  });
  $('.sh-more')?.addEventListener('click', () => navigator.share({ title: name || t('3D 提案', '3D proposal'), text: message(), url: url() }).catch(() => {}));
  $('.sh-stop').addEventListener('click', async () => {
    try { await Cloud.setShare(id, false); token = null; show('off', t('已停止分享，舊連結和 QR code 都已失效。', 'Sharing stopped: the old link and QR code no longer work.')); status(''); }
    catch (e) { console.warn('share', e); status(t('無法停止分享，請確認網路後再試一次。', 'Could not stop sharing. Check the network and try again.')); }
  });
  $('.sh-again').addEventListener('click', turnOn);
  show(token ? 'on' : 'wait');
  return { open, get token() { return token; } };
}
