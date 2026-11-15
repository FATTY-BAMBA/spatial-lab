---
status: todo
priority: P1
owner: viewer-engineer + qa-engineer
depends: []
---
# T-009 Viewer performance + visual QA

**Goal.** Catch visual and performance regressions in 3D automatically.

**Scope.** `qa/visual.mjs`: load recorded fixtures in the viewer, capture fixed views (hero shots from `photoPose`) and
`__slBench` timings; compare frames with a perceptual diff against stored references (kept in the private fixtures repo);
add to CI as a non-blocking report first.

**Acceptance criteria.** Report with frames + timings per fixture; a deliberate visual change shows up in the diff;
runtime < 5 min in CI.
