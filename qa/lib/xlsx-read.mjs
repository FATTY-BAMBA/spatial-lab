// A small, independent .xlsx reader for tests: unzips (stored or deflated entries, CRC checked), checks every XML part
// is well formed (balanced tags), and reads the first sheet into rows of values with each cell's formula and number
// format. Not a general parser — enough to check what our 報價單 writer produces and what Excel would see.
import { inflateRawSync, crc32 } from 'node:zlib';

export function unzip(buf) {
  buf = Buffer.from(buf);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip: no end of central directory');
  const n = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0, p = cdOff; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory entry ${i}`);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`${name}: compression method ${method}`);
    if (data.length !== size) throw new Error(`${name}: size ${data.length} ≠ ${size}`);
    if (crc32(data) !== crc) throw new Error(`${name}: CRC mismatch`);
    files.set(name, data);
    p += 46 + nl + xl + cl;
  }
  return files;
}

// balanced start/end tags, one root, a declaration first
export function wellFormed(xml, name = 'xml') {
  if (!/^<\?xml [^>]*\?>/.test(xml)) throw new Error(`${name}: no XML declaration`);
  const stack = []; let roots = 0;
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"<]*")*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g)) {
    if (!m[2]) throw new Error(`${name}: stray "${m[0]}" at ${m.index}`);
    if (m[1]) { if (stack.pop() !== m[2]) throw new Error(`${name}: </${m[2]}> does not close the open tag`); continue; }
    if (!stack.length) roots++;
    if (!m[4]) stack.push(m[2]);
  }
  if (stack.length || roots !== 1) throw new Error(`${name}: unbalanced (${stack.join(',')}) or ${roots} roots`);
  return true;
}

const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const colIndex = c => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function readXlsx(buf) {
  const files = unzip(buf);
  for (const [name, data] of files) if (/\.(xml|rels)$/.test(name)) wellFormed(data.toString('utf8'), name);
  for (const need of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']) if (!files.has(need)) throw new Error(`missing ${need}`);
  const text = n => (files.get(n) || Buffer.alloc(0)).toString('utf8');
  const strings = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  const styles = text('xl/styles.xml');
  const numFmts = Object.fromEntries([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)].map(m => [m[1], unesc(m[2])]));
  const builtin = { 0: 'General', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%' };
  const xfs = [...(styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || ['', ''])[1].matchAll(/<xf [^>]*numFmtId="(\d+)"/g)].map(m => numFmts[m[1]] || builtin[m[1]] || `#${m[1]}`);
  const sheetNames = [...text('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map(m => unesc(m[1]));
  const sheet = text('xl/worksheets/sheet1.xml');
  const rows = [], cells = {};
  for (const r of sheet.matchAll(/<row r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ri = +r[1] - 1, row = rows[ri] = [];
    for (const c of (r[2] || '').matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ci = colIndex(c[1]), attrs = c[3], inner = c[4] || '';
      const t = (attrs.match(/ t="(\w+)"/) || [])[1], s = +((attrs.match(/ s="(\d+)"/) || [])[1] || 0);
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1], f = (inner.match(/<f>([\s\S]*?)<\/f>/) || [])[1];
      const value = v === undefined ? null : t === 's' ? strings[+v] : t === 'str' || t === 'inlineStr' ? unesc(v) : +v;
      row[ci] = value;
      cells[`${c[1]}${c[2]}`] = { v: value, f: f ? unesc(f) : null, fmt: xfs[s] || 'General' };
    }
  }
  const merges = [...sheet.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m => m[1]);
  return { files, strings, sheetNames, rows, cells, merges, numFmts: Object.values(numFmts), sheet };
}

// rows as [label, …] text for quick finding: row index of the first row whose cell `col` matches
export const findRow = (x, re, col = 0) => x.rows.findIndex(r => r && typeof r[col] === 'string' && re.test(r[col]));
