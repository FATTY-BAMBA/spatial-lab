// Static server for the site (like Vercel: /editor → editor.html). API routes are mocked per test with page.route.
import http from 'node:http';
import { readFile } from 'node:fs';
import { join, extname } from 'node:path';
import { REPO } from './node-env.mjs';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.ktx2': 'application/octet-stream', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wasm': 'application/wasm' };
export function serve(port = 0) {
  return new Promise(ok => {
    const srv = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html'; else if (!extname(p)) p += '.html';
      readFile(join(REPO, p), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); r.end(d); });
    }).listen(port, () => ok({ url: `http://localhost:${srv.address().port}`, close: () => srv.close() }));
  });
}
