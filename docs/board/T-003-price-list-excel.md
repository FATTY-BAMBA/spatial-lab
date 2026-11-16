---
status: review
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

## Status (2026-11-16, product-engineer) — review

Branch `agent/T-003-price-list-excel`. Gate green locally (`QA_FIXTURES` synced): unit 54/54 (7 new in
`qa/unit/prices.test.mjs`) · regress OK, no regressions · e2e 20/20 (4 new). Numbers from the e2e (DXF/591 sample with
floor 4,800 → 6,000, one furniture row +1,000, 保護工程 on): viewer 未稅 NT$ 2,113,323 = xlsx subtotal; 稅 105,666;
含稅 2,218,989 = 提案書 = proposal xlsx; 106 rows. The T-002 proposal figure moved from 1,985,259 to 1,985,327 (+68)
because of the 0.01 quantity rounding. e2e: `QA_ONLY=<regex>` runs a subset; the browser runs with a UTF-8 locale so
Chinese download names survive (a POSIX locale made Chrome name every download "download").

**Shipped**
- 我的專案 → **價目表** (header button, `/projects#prices`): name, 價格基準 month, 營業稅 (外加 5% / 不另計), 計價方式, and
  tabs 材質 (every finish option of the plan data + style catalogue, per 坪 or m² for 地坪/牆面 — switching converts the
  typed prices — per m for 檯面/櫥櫃, waste % per group), 工程項目 (保護工程, 垃圾清運, 完工清潔, 工程管理 seeded
  switched off; add/remove lines per 坪 / m² of floor or per 式), 家具 (55 catalogue rows, default shown), 備註.
  Validation: whole NT$ 0–10,000,000, waste 0–50 %, names required; bad cells are flagged and the tab opens. 恢復預設.
  Phone layout checked at 360 px. Stored in `spatial_firms.prices` (`src/prices.js` documents the shape).
- Quote engine (`src/plan.js` `buildQuote`): area units 坪 / m², works lines (`labour: true`), furniture flagged,
  `labourTotal`; quantities rounded to 0.01 before pricing so 數量 × 單價 = 複價 on every line (totals move by a few NT$
  against before). `src/prices.js` `applyPrices(plan, prices)` puts a firm list into a loaded plan: option prices,
  units, furniture prices (matched by `<name>@<catalogue price>`, so a price typed on one piece in the editor stays),
  quote basis (name, date, 計價方式, waste, tax, notes, works lines).
- Viewer (owner `?id=` and client `?share=`), 方案比較 and 提案書 price from the firm's list; the client-visible basis line
  names the firm's list and date instead of "PrimeStride 示範價目表 v0" (the sample name stays only when there is no list).
  Owner sees 「編輯價目表 →」/「設定你的價目表 →」 in the basis details. 提案書 lists works lines; 0 % tax reads 不另計.
- **Excel 報價單** (`src/quote-xlsx.js` + `src/xlsx.js`): button in the 3D quote panel and on the 提案書 toolbar (owner
  only; hidden on client links). Firm name + contact line, 報價單 QUOTATION, 專案名稱 / 報價日期 / 業主 / 風格 / 價目表 /
  計價方式, header row repeated on every printed page, sections 一、裝修材質 二、工程項目 三、家具（暫估） grouped by
  room, columns 項目 · 規格 · 數量 · 單位 · 單價 · 複價 · 備註 (含損耗 n% / 暫估, furniture 規格 = size in cm), 小計 per
  section, 合計（未稅）, 營業稅 5%, 總計（含稅）, notes, 業主簽認 / 報價人 lines. Every amount is a formula
  (`ROUND(C*E,0)`, `SUM`, tax, total) with its value cached; `fullCalcOnLoad` so Excel recalculates. A4 portrait, fit to
  width. File name `報價單-<專案>-<YYYYMMDD>.xlsx`.
- T-002 follow-ups: 公司資料 preview escapes the initials (and the logo URL); logo hint now says 8 MB (what is accepted,
  resized before upload); 我的專案 header no longer overflows a 360 px phone (brand text hides).

**Database — to apply (not applied by me):** `supabase/migrations/20261116150000_spatial_firm_prices.sql`
- `alter table spatial_firms add column if not exists prices jsonb` with check `spatial_firms_prices_check` (null or a
  JSON object ≤ 64 KB). RLS unchanged (the row is already owner-only on all four verbs).
- `spatial_shared(token)` dropped + recreated with the same 6 columns (name, doc, renders, updated_at, client, firm),
  `security definer`, `search_path ''`; `firm` gains `prices`, trimmed for the client: whitelisted keys only
  (v, name, date, labour, taxRate, waste, units, finishes, notes), works lines with `on: true` only, and furniture prices
  only for `<name>@<price>` keys of pieces in that project's doc. Re-granted to anon, authenticated, service_role.
- Down: recreate the T-002 function (section 4 of `20261116090000_spatial_firms.sql`), re-grant, drop the column.
- Check script: `supabase/tests/spatial_firm_prices_rls.sql` (rolled-back transaction): check constraint rejects an
  array and a 70 KB list; B cannot read or change A's prices but can save its own; anon gets only the trimmed list
  (no extra keys, no switched-off line, only the project's furniture). `supabase/tests/spatial_firms_rls.sql` now allows
  the `prices` key. Both scripts ran green on a local Postgres 16 with a Supabase-like scaffold (roles, `auth.uid()`,
  storage stubs) after applying the T-002 and T-003 migrations in order; the prices script fails as intended against an
  untrimmed RPC.
- Until applied the site degrades: `getFirm()` retries without `prices` on 42703; the 價目表 dialog opens, explains
  「價目表即將開放…」 and 儲存 is disabled; quotes use the sample price book; share links work as before.

**Decisions**
- No xlsx library: SheetJS CE (~400 KB min, distributed from its own CDN) and ExcelJS (~1 MB) are heavy for one sheet;
  `src/xlsx.js` (~150 lines) writes SpreadsheetML + a stored (uncompressed) zip with CRC-32. Nothing vendored, so no
  licence to add. Validated with an independent reader in `qa/lib/xlsx-read.mjs` (CRC, well-formed XML), openpyxl and
  LibreOffice (opens, recalculates to the same totals, prints 2 A4 pages). Not opened in desktop Excel / Google Sheets
  from here — validator: please open the sample once in each.
- Furniture is priced by catalogue row (name + default price), not by kind: the catalogue has the same name at several
  prices (雙人床 5尺/6尺, 系統衣櫃 ×3). A unit test fails if a new priced piece appears in `src/editor/*.js` or the sample
  plans without a 價目表 row. Sheer curtains (priced by window width) are not in the list.
- Works lines start switched off so saving a list never adds lines the designer did not choose; area-based lines use
  the interior floor area (the 地坪 quantity before waste).
- Excel export is the designer's editable copy: owner only (viewer `?id=`, demo plans, 提案書 `?id=`); the client gets
  the PDF 提案書. The share RPC returns only what the client's quote can show (see above).
- 營業稅 is 5 % 外加 or 不另計 (no free rate): the only rates a Taiwan design firm quotes in practice.
- Quantity rounding to 0.01 (see above) is a small product change: totals differ from yesterday's by a few NT$.

**Open / owner**
- Apply the migration, run `supabase/tests/spatial_firm_prices_rls.sql`, `get_advisors security`, then a live check.
- Owner sign-off: the seeded works lines and their sample prices (保護工程 NT$600/坪, 垃圾清運 NT$15,000/式, 完工清潔
  NT$450/坪, 工程管理 NT$30,000/式) and the extra xlsx note 「數量依平面圖計算，實際以現場丈量為準。」.
- Follow-ups: per-room 規格 for finishes (e.g. 地坪 by room) if designers ask; a 價目表 import/export (CSV) for firms
  with an existing price book.
