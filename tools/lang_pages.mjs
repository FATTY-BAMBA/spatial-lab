// Builds the shareable language pages from index.html:
//   zh.html → https://<domain>/zh   (same as index.html)
//   en.html → https://<domain>/en   (English markup, title and share-preview tags)
// Run after editing index.html:  node tools/lang_pages.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { INDEX_EN } from '../src/i18n-dict.js';

const root = new URL('../', import.meta.url);
const src = readFileSync(new URL('index.html', root), 'utf8');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

writeFileSync(new URL('zh.html', root), src);

let [head, body] = src.split(/(?=<body)/);
const swap = (re, to) => {
  if (!re.test(head)) throw new Error('lang_pages: missing ' + re);
  head = head.replace(re, to);
};
swap(/<html lang="[^"]*">/, '<html lang="en">');
swap(/<title>[^<]*<\/title>/, '<title>PrimeStride Spatial Lab: from floor plan to a signable proposal</title>');
swap(/<meta name="description" content="[^"]*">/, '<meta name="description" content="A 3D proposal tool for interior designers: a floor plan becomes a walkable 3D space. Switch styles, see AI renders, update the quote live and get approval on the spot.">');
swap(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="https://spatial.primestrideai.com/en">');
swap(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="https://spatial.primestrideai.com/en">');
swap(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="PrimeStride Spatial Lab | From floor plan to a signable proposal">');
swap(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="A 3D proposal tool for interior designers: a floor plan becomes a walkable 3D space. Switch styles, see AI renders, update the quote live and get approval on the spot.">');
swap(/<meta property="og:locale" content="[^"]*">/, '<meta property="og:locale" content="en_US">');

// Translate the static markup now so the first paint (and anyone without JS) is already English.
const keys = Object.keys(INDEX_EN).sort((a, b) => b.length - a.length);
for (const k of keys) {
  const en = INDEX_EN[k].replace(/\$/g, '$$$$');
  body = body.replace(new RegExp('>(\\s*)' + esc(k) + '(\\s*)<', 'g'), `>$1${en}$2<`);
  body = body.replace(new RegExp('="' + esc(k) + '"', 'g'), `="${en.replace(/"/g, '&quot;')}"`);
}
writeFileSync(new URL('en.html', root), head + body);

const left = (body.match(/>[^<]*[一-鿿][^<]*</g) || []).filter(s => !/繁中/.test(s));
console.log('zh.html, en.html written.' + (left.length ? ' Chinese left in en.html markup: ' + left.join(' | ') : ''));
