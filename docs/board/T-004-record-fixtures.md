---
status: blocked
priority: P0
owner: qa-engineer
depends: [fixtures repo FATTY-BAMBA/spatial-lab-fixtures]
---
# T-004 Record AI answers for every image fixture

**Goal.** The regression gate covers room naming and drawn furniture on all picture fixtures, not only 591-A3.

**Steps.** Push the current fixtures to the private repo. For each image fixture: import it once in the live editor while
signed in, save `window.__qaVision` to `qa/recordings/<id>.json`, run `npm --prefix qa run regress`, and have the validator
update the baseline. Budget ≈ NT$3 per fixture (13 pictures ≈ NT$40).

**Acceptance criteria.** Every image fixture has a recording; baseline shows drawn > 0 for plans that draw furniture;
the e2e uses a recorded plan.
