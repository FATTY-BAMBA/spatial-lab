# qa — Spatial Lab test & validation suite

See `AGENTS.md` → "QA commands" for how to run it. In short: `npm install`, `npm run fixtures`, `npm run all`.

- `lib/pipeline.mjs` — the import pipeline under Node (same modules as the editor) + metrics
- `regress.mjs` — every fixture vs `baseline.json`; report `reports/index.html`
- `unit/` — node:test unit tests (synthetic plans)
- `e2e.mjs` — browser journeys with cloud + AI stubbed
- `fixtures.json` — the fixture list (files live in the private repo `spatial-lab-fixtures`)
- `recordings/` — recorded AI answers per fixture (replayed, so tests never call AI)
