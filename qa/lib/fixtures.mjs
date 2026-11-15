// Test plans. Third-party and client plans live in the PRIVATE repo spatial-lab-fixtures (this repo is public):
// clone it to qa/.fixtures (npm run fixtures) or point QA_FIXTURES at a folder. Each entry in qa/fixtures.json names
// a file there; entries whose file is missing are skipped (reported as "missing"). `builtin:` paths are files in this
// repo, so CI always has something to test.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, QA } from './node-env.mjs';

export const FIXTURES_DIR = process.env.QA_FIXTURES || join(QA, '.fixtures');
export function loadFixtures({ only } = {}) {
  const list = JSON.parse(readFileSync(join(QA, 'fixtures.json'), 'utf8')).fixtures;
  return list
    .filter(f => !only || only.split(',').some(k => f.id.includes(k) || (f.tags || []).includes(k)))
    .map(f => {
      const path = f.file.startsWith('builtin:') ? join(REPO, f.file.slice(8)) : join(FIXTURES_DIR, f.file);
      return { ...f, path, present: existsSync(path) };
    });
}
export const recordingPath = id => join(QA, 'recordings', `${id}.json`);
