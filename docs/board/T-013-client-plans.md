---
status: todo
priority: P0
owner: owner (Abdoulie) → qa-engineer
depends: []
---
# T-013 The demo client's own plans in the private fixtures

**Found in.** T-007 demo rehearsal.

**Problem.** Every DWG fixture we have is a foreign sample or synthetic (LibreDWG/ACadSharp examples, `cjk_25`,
`big_40k`); none is a real Taiwan design-firm drawing (mm units, 中文圖層, blocks for furniture, hatch for walls). The
LibreDWG example imports at 5.2 million m², so units can go wrong. The demo will use the client's own plans, so the
first real Taiwan DWG the pipeline sees should not be on stage.

**Scope.** Owner: ask the client for 2–3 plans before the demo (see `docs/demo.md`). QA: add them to the private repo
`spatial-lab-fixtures` under `client/` as `client-01…` (never in this repo), entries in `qa/fixtures.json`, run
`node qa/rehearse.mjs client-01 …` and `npm --prefix qa run regress`; record the AI answers for picture plans
in the private repo only (recordings of client plans never go into this public repo). File new import tasks for
anything wrong (rooms, area, walls, names).

**Acceptance criteria.** Rehearsal report on each client plan with rooms/area checked by hand against the drawing;
any blocker fixed or a backup project prepared before the demo.
