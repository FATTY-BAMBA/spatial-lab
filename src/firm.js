// Firm profile (公司資料) helpers shared by 我的專案, the share view and the proposal page. Pure: no DOM, no cloud.
import { t } from './i18n.js';

export const DEFAULT_COLOR = '#8a6a3f';

// 統一編號: 8 digits with the Ministry of Finance checksum (weights 1,2,1,2,1,2,4,1; digit products are summed digit by
// digit). Since 2023 the sum must be divisible by 5 (was 10, so older numbers still pass); when the 7th digit is 7 the
// sum may also be one more.
export function validTaxId(s) {
  if (!/^\d{8}$/.test(s || '')) return false;
  const w = [1, 2, 1, 2, 1, 2, 4, 1];
  let sum = 0;
  for (let i = 0; i < 8; i++) { const p = +s[i] * w[i]; sum += Math.floor(p / 10) + (p % 10); }
  return sum % 5 === 0 || (s[6] === '7' && (sum + 1) % 5 === 0);
}

export const validColor = c => /^#[0-9a-fA-F]{6}$/.test(c || '');
export const validEmail = e => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Check a profile before saving: returns { ok, errors: { field: message } } (messages in the current language)
export function checkFirm(f) {
  const errors = {};
  if (!(f.name || '').trim()) errors.name = t('請填公司名稱', 'Enter the firm name');
  if (f.tax_id && !validTaxId(f.tax_id.trim())) errors.tax_id = t('統一編號應為 8 碼數字，且檢查碼正確', 'A 統一編號 is 8 digits with a valid check digit');
  if (f.email && !validEmail(f.email.trim())) errors.email = t('Email 格式不正確', 'That email address does not look right');
  if (f.color && !validColor(f.color)) errors.color = t('品牌色應為 #RRGGBB', 'Brand colour must be #RRGGBB');
  if ((f.name || '').length > 120) errors.name = t('公司名稱最多 120 字', 'Firm name: 120 characters at most');
  return { ok: !Object.keys(errors).length, errors };
}

// A usable profile, or null when there is nothing to brand with
export function normFirm(f) {
  if (!f || !(f.name || '').trim()) return null;
  const s = k => (typeof f[k] === 'string' ? f[k].trim() : '') || '';
  return { name: s('name'), logo: s('logo'), phone: s('phone'), line_id: s('line_id'), email: s('email'), address: s('address'), tax_id: s('tax_id'), color: validColor(f.color) ? f.color : DEFAULT_COLOR };
}

// Text colour that reads on the brand colour (WCAG relative luminance)
export function onColor(hex) {
  const c = (validColor(hex) ? hex : DEFAULT_COLOR).slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#1b1712' : '#ffffff';
}

// Contact lines for a firm, in display order: [{ k, label, value, href }]
export function contactLines(f) {
  if (!f) return [];
  const out = [];
  if (f.phone) out.push({ k: 'phone', label: t('電話', 'Phone'), value: f.phone, href: `tel:${f.phone.replace(/[^\d+]/g, '')}` });
  if (f.line_id) out.push({ k: 'line', label: 'LINE', value: f.line_id, href: f.line_id.startsWith('@') ? `https://line.me/R/ti/p/${encodeURIComponent(f.line_id)}` : `https://line.me/ti/p/~${encodeURIComponent(f.line_id)}` });
  if (f.email) out.push({ k: 'email', label: 'Email', value: f.email, href: `mailto:${f.email}` });
  if (f.address) out.push({ k: 'address', label: t('地址', 'Address'), value: f.address, href: '' });
  if (f.tax_id) out.push({ k: 'tax', label: t('統一編號', 'Tax ID (統編)'), value: f.tax_id, href: '' });
  return out;
}

// Initials badge text when there is no logo: first two characters of a CJK name, or initials of a Latin one
export function initials(name) {
  const n = (name || '').trim(); if (!n) return '';
  if (/[㐀-鿿]/.test(n[0])) return n.replace(/(股份)?有限公司|工作室|設計|室內/g, '').slice(0, 2) || n.slice(0, 2);
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}
