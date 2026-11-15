// Clone or update the private fixtures repo into qa/.fixtures.
// Auth: the git credentials of this environment, or FIXTURES_TOKEN (CI secret: a fine-grained read-only token).
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { FIXTURES_DIR } from './lib/fixtures.mjs';
const repo = process.env.FIXTURES_REPO || 'FATTY-BAMBA/spatial-lab-fixtures';
const tok = process.env.FIXTURES_TOKEN;
const url = tok ? `https://x-access-token:${tok}@github.com/${repo}.git` : `https://github.com/${repo}.git`;
const git = (...a) => execFileSync('git', a, { stdio: 'inherit' });
try {
  if (existsSync(`${FIXTURES_DIR}/.git`)) git('-C', FIXTURES_DIR, 'pull', '--ff-only', '-q');
  else git('clone', '-q', '--depth', '1', url, FIXTURES_DIR);
  console.log('fixtures ready in', FIXTURES_DIR);
} catch {
  console.warn(`could not fetch ${repo}; only builtin fixtures will run (set FIXTURES_TOKEN or QA_FIXTURES)`);
}
