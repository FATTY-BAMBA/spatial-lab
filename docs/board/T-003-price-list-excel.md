---
status: todo
priority: P0
owner: product-engineer
depends: [T-002]
---
# T-003 Price list + Excel quote

**Goal.** Each firm sets its own unit prices (labour and materials) and gets the quote as an Excel 報價單 they can edit and send.

**Scope**
- Price list per firm (finish options per m²/坪, furniture items, labour lines, waste %, tax), seeded from `src/plan.js`
  defaults; editable table on 我的專案 → 價目表. Stored in `spatial_firms.prices` (jsonb).
- The viewer's quote uses the firm's prices (designer and share link).
- Export `.xlsx` from the viewer/proposal: firm header, project, item rows grouped by room/trade (項目, 規格, 數量, 單位,
  單價, 複價), subtotal, 5% 營業稅, total, notes. Generated in the browser (small vendored library, no build step).

**Acceptance criteria**
- Unit: quote totals with a custom price list match a hand-computed fixture.
- e2e: change a price → the quote and the exported xlsx reflect it (parse the downloaded file in the test).
- The xlsx opens cleanly in Excel and Google Sheets with Chinese text and number formats.
