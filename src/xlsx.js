// A minimal .xlsx (Office Open XML spreadsheet) writer: one or more sheets of text, numbers and formulas with a fixed
// set of styles, merged cells, column widths and A4 print setup. The zip is written with stored (uncompressed)
// entries, so there is no dependency and no build step; a quote is a few KB. Pure: returns a Uint8Array (browser + Node).
//
//   xlsx({ title, author, sheets: [{ name, cols: [width…], rows: [row…], merges: ['A1:G1'], printTitles: '9:9' }] })
//   row:  [cell…] or { cells: [cell…], ht: 24 }
//   cell: null | 'text' | 123 | { v, s: 'style', f: 'ROUND(C10*E10,0)' }   (f without '='; v is the cached result)

const enc = new TextEncoder();
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const colName = i => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
export const ref = (r, c) => `${colName(c)}${r + 1}`;

// ---- styles: fonts, fills, borders, number formats → named cell formats ----
const FONT = 'Microsoft JhengHei';
const fonts = [
  { sz: 11 }, { sz: 11, b: true }, { sz: 16, b: true }, { sz: 20, b: true }, { sz: 9.5, color: 'FF6B645A' }, { sz: 12, b: true }, { sz: 10, color: 'FF6B645A' },
];
const fills = ['none', 'gray125', 'FFF1ECE3', 'FFFAF7F2']; // 0 and 1 are required by Excel
const borders = [{}, { bottom: 'thin' }, { top: 'thin' }, { top: 'thin', bottom: 'double' }, { top: 'thin', bottom: 'thin' }, { bottom: 'medium' }];
const NUMFMT = { 164: '#,##0', 165: '"NT$ "#,##0', 166: '0.00', 167: '0%' };
// name: [font, fill, border, numFmt, align]
const XF = {
  text: [0, 0, 0, 0, 'left'], wrap: [0, 0, 0, 0, 'wrap'], bold: [1, 0, 0, 0, 'left'], muted: [6, 0, 0, 0, 'left'], small: [4, 0, 0, 0, 'wrap'],
  firm: [2, 0, 0, 0, 'left'], title: [3, 0, 5, 0, 'center'], label: [6, 0, 0, 0, 'left'], value: [1, 0, 0, 0, 'left'],
  head: [1, 2, 4, 0, 'center'], headL: [1, 2, 4, 0, 'left'], section: [5, 3, 1, 0, 'left'], room: [1, 0, 0, 0, 'left'],
  cell: [0, 0, 1, 0, 'left'], cellWrap: [0, 0, 1, 0, 'wrap'], unit: [0, 0, 1, 0, 'center'], qty: [0, 0, 1, 166, 'right'], int: [0, 0, 1, 164, 'right'], money: [0, 0, 1, 164, 'right'], note: [4, 0, 1, 0, 'wrap'],
  subL: [1, 0, 2, 0, 'right'], sub: [1, 0, 2, 164, 'right'], totL: [1, 0, 0, 0, 'right'], tot: [1, 0, 0, 165, 'right'], pct: [0, 0, 0, 167, 'right'],
  grandL: [5, 0, 3, 0, 'right'], grand: [5, 0, 3, 165, 'right'], sign: [6, 0, 1, 0, 'left'],
};
const XF_NAMES = Object.keys(XF);
export const STYLE_NAMES = XF_NAMES;

function stylesXml() {
  const fontXml = fonts.map(f => `<font>${f.b ? '<b/>' : ''}<sz val="${f.sz}"/><color ${f.color ? `rgb="${f.color}"` : 'rgb="FF1F1C18"'}/><name val="${FONT}"/><family val="2"/><charset val="136"/></font>`).join('');
  const fillXml = fills.map(f => (f === 'none' || f === 'gray125' ? `<fill><patternFill patternType="${f}"/></fill>` : `<fill><patternFill patternType="solid"><fgColor rgb="${f}"/><bgColor indexed="64"/></patternFill></fill>`)).join('');
  const side = (b, k) => (b[k] ? `<${k} style="${b[k]}"><color rgb="FF9A9286"/></${k}>` : `<${k}/>`);
  const borderXml = borders.map(b => `<border>${side(b, 'left')}${side(b, 'right')}${side(b, 'top')}${side(b, 'bottom')}<diagonal/></border>`).join('');
  const align = a => (a === 'wrap' ? '<alignment vertical="top" wrapText="1"/>' : `<alignment horizontal="${a}" vertical="center"/>`);
  const xfs = XF_NAMES.map(n => { const [fo, fi, bo, nf, al] = XF[n]; return `<xf numFmtId="${nf}" fontId="${fo}" fillId="${fi}" borderId="${bo}" xfId="0"${nf ? ' applyNumberFormat="1"' : ''} applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align(al)}</xf>`; });
  return `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<numFmts count="${Object.keys(NUMFMT).length}">${Object.entries(NUMFMT).map(([id, c]) => `<numFmt numFmtId="${id}" formatCode="${esc(c)}"/>`).join('')}</numFmts>`
    + `<fonts count="${fonts.length}">${fontXml}</fonts><fills count="${fills.length}">${fillXml}</fills><borders count="${borders.length}">${borderXml}</borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="${xfs.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${xfs.join('')}</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}
const styleId = s => (s ? XF_NAMES.indexOf(s) + 1 || 0 : 0);

// ---- sheets ----
function sheetXml(sh, sst) {
  const rows = sh.rows.map(r => (Array.isArray(r) ? { cells: r } : r));
  const width = Math.max(1, ...rows.map(r => r.cells.length), (sh.cols || []).length);
  const out = [];
  rows.forEach((row, ri) => {
    const cells = [];
    row.cells.forEach((c, ci) => {
      if (c === null || c === undefined || c === '') return;
      const cell = typeof c === 'object' ? c : { v: c };
      const s = styleId(cell.s), r = ref(ri, ci), sa = s ? ` s="${s}"` : '';
      if (cell.f) {
        const v = typeof cell.v === 'number' && Number.isFinite(cell.v) ? `<v>${cell.v}</v>` : '';
        cells.push(`<c r="${r}"${sa}><f>${esc(cell.f)}</f>${v}</c>`);
      } else if (typeof cell.v === 'number' && Number.isFinite(cell.v)) cells.push(`<c r="${r}"${sa}><v>${cell.v}</v></c>`);
      else if (cell.v === null || cell.v === undefined || cell.v === '') cells.push(`<c r="${r}"${sa}/>`);
      else cells.push(`<c r="${r}"${sa} t="s"><v>${sst(String(cell.v))}</v></c>`);
    });
    out.push(`<row r="${ri + 1}"${row.ht ? ` ht="${row.ht}" customHeight="1"` : ''}>${cells.join('')}</row>`);
  });
  const cols = (sh.cols || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const merges = sh.merges || [];
  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${ref(Math.max(0, rows.length - 1), width - 1)}"/>`
    + `<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="18" customHeight="1"/>`
    + (cols ? `<cols>${cols}</cols>` : '') + `<sheetData>${out.join('')}</sheetData>`
    + (merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '')
    + `<printOptions horizontalCentered="1"/><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>`
    + `<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>`
    + `<headerFooter><oddFooter>${esc(`&C&9&P / &N`)}</oddFooter></headerFooter></worksheet>`;
}

const sheetName = (n, i) => (String(n || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`);

export function xlsx({ title = '', author = '', sheets }) {
  const strings = [], index = new Map();
  const sst = s => { if (!index.has(s)) { index.set(s, strings.length); strings.push(s); } return index.get(s); };
  const sheetFiles = sheets.map(sh => sheetXml(sh, sst));
  const names = sheets.map((sh, i) => sheetName(sh.name, i));
  const defined = sheets.map((sh, i) => (sh.printTitles ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(names[i].replace(/'/g, "''"))}'!$${sh.printTitles.replace(':', ':$')}</definedName>` : '')).join('');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`
      + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'docProps/core.xml': `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PrimeStride Spatial Lab</Application></Properties>`,
    'xl/workbook.xml': `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    'xl/styles.xml': stylesXml(),
  };
  sheetFiles.forEach((x, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = x; });
  files['xl/sharedStrings.xml'] = `${XML}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;
  return zip(Object.entries(files).map(([name, text]) => [name, enc.encode(text)]));
}

// ---- zip (stored entries, CRC-32) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(entries) {
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = []; let off = 0;
  for (const [name, data] of entries) {
    const nb = enc.encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0)); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
