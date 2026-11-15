---
status: todo
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
