// Module Worker: DWG bytes in, DXF text out (see dwg.js). Loads acad-ts on the first message only.
import { convertDWG, loadAcad } from './dwg.js';

self.onmessage = async e => {
  const { buf, maxBytes } = e.data || {};
  try {
    const r = convertDWG(await loadAcad(), buf, { maxBytes });
    self.postMessage({ ok: true, result: r });
  } catch (err) {
    self.postMessage({ ok: false, code: (err && err.code) || 'failed', message: String((err && err.message) || err), version: err && err.version });
  }
};
