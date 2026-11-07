// Language for the whole site: 繁中 (default) or English.
// Chosen by path (/zh, /en), then ?lang=, then the last choice saved in this browser.
// Shareable links: https://<domain>/zh and https://<domain>/en
const KEY = 'sl-lang';

function detect() {
  const path = location.pathname.replace(/\/+$/, '');
  if (/^\/en(\/|$)/.test(path)) return 'en';
  if (/^\/zh(\/|$)/.test(path)) return 'zh';
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'zh') return q;
  try { const saved = localStorage.getItem(KEY); if (saved === 'en' || saved === 'zh') return saved; } catch { /* storage off */ }
  return 'zh';
}

export const lang = detect();
export const isEn = lang === 'en';
try { localStorage.setItem(KEY, lang); } catch { /* storage off */ }
document.documentElement.lang = isEn ? 'en' : 'zh-Hant-TW';

/** Contact page for demo requests, in the current language. */
export const bookUrl = () => `https://primestrideai.com/${isEn ? 'en' : 'zh'}/contact?p=spatial-lab`;

/** Pick the string for the current language: t('查看清單', 'View list'). */
export const t = (zh, en) => (isEn ? en : zh);

/** Display a unit: 坪 → ping, 件 → pc. Never use this for comparisons. */
export const unitLabel = u => (isEn ? ({ '坪': 'ping', '件': 'pc', '式': 'lot', '組': 'set' }[u] || u) : u);

/** Translate static markup once: text nodes and common attributes whose text is a key in `dict`. */
export function translateDom(dict, root = document) {
  if (!isEn) return;
  const tr = s => {
    const k = s.trim();
    if (!k || !(k in dict)) return null;
    return s.replace(k, dict[k]);
  };
  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) { const v = tr(n.nodeValue); if (v !== null) n.nodeValue = v; }
  for (const el of (root.querySelectorAll ? root : document).querySelectorAll('[title],[aria-label],[alt],[placeholder]')) {
    for (const a of ['title', 'aria-label', 'alt', 'placeholder']) {
      const cur = el.getAttribute(a);
      if (cur == null) continue;
      const v = tr(cur);
      if (v !== null) el.setAttribute(a, v);
    }
  }
}

/** Swap Chinese names in loaded data for their English ones (keeps the Chinese in nameZh). */
export function localizeData(obj) {
  if (!isEn || !obj || typeof obj !== 'object') return obj;
  const visit = o => {
    if (Array.isArray(o)) { o.forEach(visit); return; }
    if (!o || typeof o !== 'object') return;
    if (typeof o.name === 'string' && typeof o.nameEn === 'string' && o.nameEn) {
      o.nameZh = o.name; o.name = o.nameEn; o.nameEn = '';
    }
    for (const k of ['tagline', 'typeLabel', 'value', 'label', 'note']) {
      if (typeof o[k + 'En'] === 'string') { o[k + 'Zh'] = o[k]; o[k] = o[k + 'En']; }
    }
    if (o.captionsEn) { o.captionsZh = o.captions; o.captions = o.captionsEn; }
    for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v);
  };
  visit(obj);
  return obj;
}

/** URL of this page in the other language, keeping the query and hash. */
export function urlFor(target) {
  const params = new URLSearchParams(location.search);
  params.delete('lang');
  const qs = params.toString();
  const tail = (qs ? '?' + qs : '') + location.hash;
  const page = location.pathname.replace(/\/+$/, '').replace(/^\/(en|zh)(?=\/|$)/, '').replace(/\.html$/, '');
  if (page === '' || page === '/index') return '/' + target + tail;
  // Other pages (the editor) keep their path and carry the language as ?lang=
  const p2 = new URLSearchParams(qs); p2.set('lang', target);
  return page + '?' + p2.toString() + location.hash;
}

/** A small 繁中 | EN switch. Put it in a container; it navigates to the other language. */
export function langSwitch(className = 'lang-switch') {
  const nav = document.createElement('div');
  nav.className = className;
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', isEn ? 'Language' : '語言');
  for (const [code, label] of [['zh', '繁中'], ['en', 'EN']]) {
    const a = document.createElement('a');
    a.href = urlFor(code);
    a.textContent = label;
    a.lang = code === 'en' ? 'en' : 'zh-Hant-TW';
    a.setAttribute('aria-current', String(code === lang));
    a.addEventListener('click', () => { try { localStorage.setItem(KEY, code); } catch { /* storage off */ } });
    nav.append(a);
  }
  return nav;
}
