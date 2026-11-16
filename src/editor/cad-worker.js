// Module Worker: the automatic CAD import (cadimport.js runCAD) off the page. In: { buf, opts }. Out: { stage, info }
// per finished stage, then { ok: true, result } or { ok: false, code, message }.
import { runCAD } from './cadimport.js';

self.onmessage = async e => {
  const { buf, opts } = e.data || {};
  try {
    const result = await runCAD(buf, { ...opts, onStage: (stage, info) => self.postMessage({ stage, info }) });
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, code: (err && err.code) || 'failed', message: String((err && err.message) || err), version: err && err.version, bytes: err && err.bytes });
  }
};
