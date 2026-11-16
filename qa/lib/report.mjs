// qa/reports/index.html — one card per fixture: metrics vs baseline and a top-down drawing of each floor
// (walls, rooms with names, furniture; open-area rooms dashed). Self-contained, no fixture pictures embedded
// (those are private), so the report can be shared as a CI artifact.
import { writeFileSync } from 'node:fs';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COLORS = ['#e8d9c4', '#cfe0e8', '#dfe8cf', '#ead2d2', '#ddd3ea', '#efe6c2', '#cfe8de', '#e8d4c8'];

function svgLevel(L) {
  const pts = L.walls.flatMap(w => [w.a, w.b]);
  if (!pts.length) return '<div class="empty">no walls</div>';
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const x0 = Math.min(...xs) - 0.5, z0 = Math.min(...zs) - 0.5, w = Math.max(...xs) - x0 + 0.5, h = Math.max(...zs) - z0 + 0.5;
  const P = p => `${(p[0] - x0).toFixed(2)},${(p[1] - z0).toFixed(2)}`;
  let s = `<svg viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}" xmlns="http://www.w3.org/2000/svg">`;
  L.rooms.forEach((r, i) => {
    s += `<polygon points="${r.polygon.map(P).join(' ')}" fill="${COLORS[i % COLORS.length]}" stroke="${r.open ? '#b4532a' : 'none'}" stroke-width="0.06" stroke-dasharray="${r.open ? '0.25 0.15' : ''}"/>`;
  });
  for (const f of L.furniture || []) {
    const q = Math.abs(Math.round((f.rot || 0) / 90)) % 2 === 1, fw = q ? f.d : f.w, fd = q ? f.w : f.d;
    s += `<rect x="${(f.x - fw / 2 - x0).toFixed(2)}" y="${(f.z - fd / 2 - z0).toFixed(2)}" width="${fw.toFixed(2)}" height="${fd.toFixed(2)}" fill="${f.drawn ? '#c9a26a' : f.dress ? 'none' : '#9aa3ad'}" stroke="${f.dress ? '#7d8a74' : 'none'}" stroke-width="0.03" opacity="0.85"/>`;
  }
  for (const wl of L.walls) s += `<line x1="${(wl.a[0] - x0).toFixed(2)}" y1="${(wl.a[1] - z0).toFixed(2)}" x2="${(wl.b[0] - x0).toFixed(2)}" y2="${(wl.b[1] - z0).toFixed(2)}" stroke="${wl.kind === 'zone' ? '#c33' : '#222'}" stroke-width="${wl.kind === 'zone' ? 0.03 : Math.max(0.08, wl.t || 0.12)}" stroke-linecap="square"/>`;
  for (const r of L.rooms) { const c = r.labelAt || r.polygon[0]; s += `<text x="${(c[0] - x0).toFixed(2)}" y="${(c[1] - z0).toFixed(2)}" font-size="0.45" text-anchor="middle" fill="#333">${esc(r.name)}</text>`; }
  return s + '</svg>';
}

export function writeReport(path, { summary, results, baseline, docs, fixtures }) {
  const delta = (k, m, b) => { if (!b || b[k] == null || m[k] == null || m[k] === b[k]) return ''; const d = m[k] - b[k]; return `<sup class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${+d.toFixed(1)}</sup>`; };
  const cards = fixtures.map(fx => {
    const m = results[fx.id] || {}, b = baseline[fx.id];
    if (m.missing) return `<section class="card miss"><h3>${esc(fx.id)}</h3><p>missing — private fixtures not synced</p></section>`;
    if (m.error) return `<section class="card err"><h3>${esc(fx.id)}</h3><pre>${esc(m.error)}</pre></section>`;
    const keys = ['floors', 'walls', 'rooms', 'openRooms', 'furnishedRooms', 'furniture', 'drawn', 'decor', 'issues', 'ms', ...(m.msConvert != null ? ['msConvert', 'dwgVersion'] : [])];
    const doc = docs[fx.id];
    return `<section class="card"><h3>${esc(fx.id)} <small>${esc(fx.note || '')}${m.pair ? ` · ${m.pair.same ? 'matches' : '<b style="color:var(--dn)">differs from</b>'} DXF twin ${esc(m.pair.id)}` : ''}</small></h3>
      <table><tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr><tr>${keys.map(k => `<td>${m[k] ?? '–'}${delta(k, m, b)}</td>`).join('')}</tr></table>
      <div class="levels">${doc ? doc.levels.map(L => `<figure><figcaption>${esc(L.id)}</figcaption>${svgLevel(L)}</figure>`).join('') : ''}</div></section>`;
  }).join('\n');
  const list = (cls, arr) => arr.length ? `<ul class="${cls}">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  writeFileSync(path, `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spatial Lab QA</title>
<style>
:root { --bg:#f6f4f0; --ink:#1d1b18; --mute:#6d675e; --card:#fff; --line:#e4dfd6; --up:#2f7d4f; --dn:#b4332a; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#161411; --ink:#ede6da; --mute:#a09888; --card:#1f1c18; --line:#332e27; --up:#6cc28f; --dn:#ff8a7a; } }
body { margin:0; padding:16px; background:var(--bg); color:var(--ink); font:14px/1.5 system-ui, "PingFang TC", sans-serif; }
h1 { font-size:20px; margin:0 0 4px; } .meta { color:var(--mute); margin-bottom:14px; }
ul.fail li { color:var(--dn); } ul.gain li { color:var(--up); } ul.warn li { color:var(--mute); }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin:12px 0; }
.card h3 { margin:0 0 8px; font-size:15px; } .card h3 small { color:var(--mute); font-weight:400; }
.card.miss { opacity:.6; } .card.err pre { color:var(--dn); white-space:pre-wrap; }
table { border-collapse:collapse; font-variant-numeric:tabular-nums; overflow-x:auto; display:block; } th, td { padding:3px 8px; text-align:right; border-bottom:1px solid var(--line); } th { color:var(--mute); font-weight:500; font-size:12px; }
sup.up { color:var(--up); } sup.dn { color:var(--dn); }
.levels { display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; } figure { margin:0; flex:1 1 220px; max-width:420px; } figcaption { color:var(--mute); font-size:12px; }
svg { width:100%; height:auto; background:#fbfaf7; border-radius:8px; }
</style></head><body>
<h1>Spatial Lab QA</h1><div class="meta">${esc(summary.at)} · ran ${summary.ran} · missing ${summary.missing} · ${summary.fails.length ? `<b style="color:var(--dn)">${summary.fails.length} regression(s)</b>` : 'no regressions'}</div>
${list('fail', summary.fails)}${list('gain', summary.gains)}${list('warn', summary.warns)}
${cards}
</body></html>`);
}
