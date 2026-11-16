// AutoCAD DWG → ASCII DXF text, so the existing DXF import (decodeDXF → parseDXF → wallsFromDXF) takes it from there.
// The converter is acad-ts (MIT, vendor/acad-ts), loaded only when a .dwg arrives. In the editor it runs in a module
// Worker (dwg-worker.js) so the page keeps responding; the drawing never leaves the browser.
// convertDWG() is pure (no DOM, no Worker) so qa/ runs the same code under Node.
export const ACAD_TS = '../../vendor/acad-ts/acad-ts-3.7.0.min.js';
export const DWG_MAX_BYTES = 50 * 1024 * 1024;
export const DWG_TIMEOUT_MS = 120000;

// AutoCAD file-format codes acad-ts reads (AC1009 = R11/12 … AC1032 = 2018, which AutoCAD 2018–2025 still saves)
export const DWG_VERSIONS = { AC1009: 'R12', AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018' };

// code: 'too-large' | 'not-dwg' | 'old-version' | 'new-version' | 'unsupported-version' | 'failed' | 'empty' | 'timeout'
export class DwgError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'DwgError'; this.code = code; Object.assign(this, extra); }
}

// "AC1032" from the first bytes of a DWG, or null when it is not a DWG
export function dwgVersion(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf, 0, Math.min(6, buf.byteLength));
  if (b.length < 6) return null;
  const s = String.fromCharCode(...b.subarray(0, 6));
  return /^AC\d{4}$/.test(s) ? s : /^(AC[12]\.\d\d|MC0\.0)$/.test(s) ? s : null;
}

// Cheap checks before any parsing: size cap and a version we can read. Returns { version, year }.
export function checkDWG(buf, { maxBytes = DWG_MAX_BYTES } = {}) {
  const n = buf.byteLength;
  if (n > maxBytes) throw new DwgError('too-large', `DWG is ${(n / 1048576).toFixed(1)} MB (limit ${maxBytes / 1048576} MB)`, { bytes: n });
  const version = n >= 64 ? dwgVersion(buf) : null;
  if (!version) throw new DwgError('not-dwg', 'Not a DWG file (no AutoCAD version header)');
  if (DWG_VERSIONS[version]) return { version, year: DWG_VERSIONS[version] };
  if (/^AC\d{4}$/.test(version) && +version.slice(2) > 1032) throw new DwgError('new-version', `DWG format ${version} is newer than this converter`, { version });
  throw new DwgError('old-version', `DWG format ${version} is older than R12`, { version });
}

let lib = null;
export async function loadAcad(url = new URL(ACAD_TS, import.meta.url)) { return lib || (lib = await import(url.href || url)); }

// The conversion itself. `A` is the acad-ts module (loadAcad()). Returns { dxf, version, year, ms: { read, write }, warnings }.
export function convertDWG(A, buf, opts = {}) {
  const { version, year } = checkDWG(buf, opts);
  const t0 = now();
  let doc, warnings = 0;
  try { doc = A.DwgReader.readFromStream(buf, (_s, e) => { if (e && e.notificationType >= 2) warnings++; }); }
  catch (err) { throw wrap(err, version); }
  const t1 = now();
  const parts = [];
  try { A.DxfWriter.writeToStream({ write: s => { parts.push(s); } }, doc, false); }
  catch (err) { throw wrap(err, version); }
  const dxf = parts.join('');
  const t2 = now();
  if (!/\nENTITIES\r?\n/.test(dxf) || !/\n(LINE|LWPOLYLINE|POLYLINE|INSERT|ARC|CIRCLE)\r?\n/.test(dxf)) throw new DwgError('empty', 'The DWG has no drawing entities we can read', { version });
  return { dxf, version, year, ms: { read: Math.round(t1 - t0), write: Math.round(t2 - t1) }, warnings };
}
function wrap(err, version) {
  if (err instanceof DwgError) return err;
  const name = (err && err.constructor && err.constructor.name) || '';
  const msg = String((err && err.message) || err);
  if (/NotSupported/i.test(name) || /not supported|not recognized/i.test(msg)) return new DwgError('unsupported-version', msg, { version });
  return new DwgError('failed', `DWG could not be read: ${msg}`, { version });
}
const now = () => (globalThis.performance ? performance.now() : Date.now());

// ---- browser: convert in a module Worker (falls back to this thread when module workers are unavailable)
// Resolves to { dxf, version, year, ms: { read, write, total }, warnings, thread: 'worker' | 'main' }.
export function dwgToDXFInfo(arrayBuffer, { timeout = DWG_TIMEOUT_MS, maxBytes = DWG_MAX_BYTES } = {}) {
  const t0 = now();
  try { checkDWG(arrayBuffer, { maxBytes }); } catch (err) { return Promise.reject(err); }
  const onMain = async () => { const r = convertDWG(await loadAcad(), arrayBuffer, { maxBytes }); return { ...r, ms: { ...r.ms, total: Math.round(now() - t0) }, thread: 'main' }; };
  if (typeof Worker === 'undefined') return onMain();
  return new Promise((resolve, reject) => {
    let w, done = false, answered = false;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { w && w.terminate(); } catch {} fn(v); };
    const timer = setTimeout(() => end(reject, new DwgError('timeout', `DWG conversion took longer than ${Math.round(timeout / 1000)} s`)), timeout);
    try { w = new Worker(new URL('./dwg-worker.js', import.meta.url), { type: 'module' }); }
    catch { clearTimeout(timer); done = true; onMain().then(resolve, reject); return; }
    w.onmessage = e => {
      answered = true;
      const m = e.data || {};
      if (m.ok) end(resolve, { ...m.result, ms: { ...m.result.ms, total: Math.round(now() - t0) }, thread: 'worker' });
      else end(reject, new DwgError(m.code || 'failed', m.message || 'DWG conversion failed', { version: m.version }));
    };
    // the worker script itself failed to load (old browser without module workers): convert here instead
    w.onerror = e => { if (answered || done) return; e.preventDefault && e.preventDefault(); done = true; clearTimeout(timer); try { w.terminate(); } catch {} onMain().then(resolve, reject); };
    // the buffer is handed over, not copied (a 50 MB drawing stays 50 MB)
    w.postMessage({ buf: arrayBuffer, maxBytes }, [arrayBuffer]);
  });
}
// DWG bytes → DXF text
export function dwgToDXF(arrayBuffer, opts) { return dwgToDXFInfo(arrayBuffer, opts).then(r => r.dxf); }
