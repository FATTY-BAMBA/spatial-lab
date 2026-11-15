// Playwright from this folder's node_modules, or the environment's own install (sandboxes ship one).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function playwright() {
  for (const from of [import.meta.url, `${process.cwd()}/`, '/usr/lib/node_modules/', `${process.env.HOME}/.npm-global/lib/node_modules/`]) {
    try { return createRequire(from)('playwright'); } catch {}
  }
  try { return require('playwright'); } catch { throw new Error('playwright not found: npm i -D playwright && npx playwright install chromium'); }
}
