---
status: review
priority: P1
owner: import-engineer
depends: []
---
# T-005 Room/balcony split behind undetected sliders

**Problem.** When the glass slider between a bedroom/living room and its balcony isn't detected as a wall, the room
absorbs the balcony (fixture `591-sanrui-e`, the green bedroom; see `qa/reports/index.html`).

**Ideas.** Use the AI's room list (it names 陽台) and drawn railings/pavers; continue a room's wall line across the
opening where an adjacent closed room's boundary is collinear; split open rooms where the floor pattern changes.

**Acceptance criteria.** On `591-sanrui-e` the bedroom and the balcony are separate rooms (balcony `outdoor`), unit test
with a synthetic room + balcony separated only by a slider gap; no regression elsewhere.

## Build (import-engineer, 2026-11-16) — branch `agent/T-005-balcony-split`, status: review

**Approach: facade cut** (`splitAtFacade` in `src/editor/geometry.js`, called by `detectRooms` on every open room).
An exterior wall whose outer face looks onto open air (no other room behind it, no wall within 3 m) and which ends at
an open room's edge is run on across that room; when the line reaches a wall or the building's extent within 0.6–5 m
without crossing a wall, the room is cut there. The cut is kept only if the inside part is walled like a room
(≥ 60 % of its edge on walls, ≥ 4 m²) and the part beyond is not (≤ 85 % and less than the inside part). A stepped
facade, where the room really sticks out, is walled all round and stays whole. The part beyond becomes a new room
`陽台 / Balcony` (`outdoor: true`, `finish: 'balcony'`), or is dropped when it is a sliver (< 2 m² or < 45 cm wide).
Pure geometry, no AI, no new step in `qa/lib/pipeline.mjs` (it runs inside `detectRooms`).

Decisions: the image (slider glyph, railings, pavers) and the AI's 陽台 are not used: geometry alone fixes both
fixtures, costs nothing and needs no recording. AI naming in the editor still has the last word on `outdoor`. The
two-sided rule (collinear stubs on both sides of a gap inside a *closed* face) is not built: no fixture needs it,
and it would touch every DXF door gap. It is a follow-up if a plan shows it.

**Tests.** `qa/unit/balcony.test.mjs` covers four cases: bedroom + balcony behind a slider gap (split, balcony
outdoor), a sliver past the facade (trimmed), a stepped facade (not cut), and a living room open on its whole front
(not cut). The first two fail before the change.

**Results** (regression; no regressions on 33 fixtures, the others are unchanged):

| Fixture | Before | After |
|---|---|---|
| 591-sanrui-e | 3 rooms (bedroom + balcony one 26.5 m² room), furnished 3 | 4 rooms: bedroom 14.7 m² + 陽台 11.8 m² (outdoor), furnished 4 |
| 591-sanrui-d | bedroom 3 pokes 0.45 × 2.4 m past the east facade, room area 96.4 | bedroom ends on the facade line, room area 95.3 (−1.1 m² sliver) |

Import time (median of 3, same machine): sanrui-e 805 → 730 ms, sanrui-d 663 → 657 ms, 591-A3 598 → 578 ms,
dxf-d12 1066 → 1010 ms (no change, within noise). Unit 19/19, regress OK, e2e all passed.

For the validator: baseline not updated. The sanrui-e gain (rooms 3 → 4, furnishedRooms 3 → 4) is ready to lock in.
