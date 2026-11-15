---
status: todo
priority: P1
owner: import-engineer
depends: [T-004]
---
# T-006 Hand-drawn watercolor plans

**Problem.** The 三銳 watercolor plans (`591-sanrui-a…e`) have thin dark-green walls next to thick black pillars; the
wall-thickness estimate fails and few rooms close (a: 1 room, b/c: 0).

**Ideas.** A vision-model fallback that traces wall centre lines when < 3 rooms close; colour-aware wall extraction
(dark green as wall ink); pillar detection to set thickness.

**Acceptance criteria.** Each of `591-sanrui-a…e` reaches ≥ 4 rooms with sensible shapes in the report, no regression on
rendered 591 plans, import time ≤ 60 s.
