---
status: done
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

## Validation (validator, 2026-11-16)

**Verdict: ship after fixes.** One small blocking fix (B1) and one owner check (O1). Everything else holds up.

**Evidence**
- Gate (idle machine, `QA_FIXTURES` synced): unit 54/54 · regress 51 fixtures, no regressions, metrics identical to
  baseline, so no baseline update. e2e was red in 2 of 4 branch runs: 3 failures (T-002 share-branding 10 s wait, DWG
  screenshot timeout, 40k-DWG frame gap 7.5 s). One of those red runs was competing with my own CPU-heavy script; the
  other was on an idle machine. The branch was green 21/21 when run alone and on a third full `npm run all`. Main
  (ce0aa91) was green in all 3 runs. In both red runs the Explore step ran slowly (122–130 s instead of ~67 s). Then the
  first failed step skipped `ctx.close()`, its software-WebGL page kept running, and every later step slowed down,
  including untouched DWG/editor steps. Nothing in the diff explains it; I count it as a harness flake (N4), not a branch
  regression. New timeouts are only on the new steps (download wait 90 s, screenshot 120 s). The new viewer step takes
  69–70 s, the same as the existing Explore step (software-WebGL boot), so the timeouts don't hide a slowdown.
- Quote with no price list (main vs branch, 53 plans × 6 styles = 318 quotes): every line has the same name and unit
  price; every line differs only within its 0.01-quantity rounding; largest total change 0.05 %. Sample 提案書 goes
  1,985,259 → 1,985,327 (+68), reproduced in e2e on main and on the branch.
- Hand-computed unit case re-derived independently: 52,500 + 50,000 + 27,500 + 9,240 + 6,000 + 15,000 + 40,000 +
  14,000 + 33,333 = 247,573; tax 12,378.65 → 12,379. Correct. The tests would fail if the change were reverted.
- Migration, on local PG16 with my own Supabase-like scaffold: T-002 then T-003 apply; both check scripts pass. Down
  path (T-002 function + grants, drop column) runs, the T-002 check (main's version) passes, then re-apply passes.
  Function is `security definer`, `search_path=""`, ACL anon/authenticated/service_role only, nothing for PUBLIC. anon
  gets `permission denied for table spatial_firms`. Switched-off lines and other projects' furniture are not returned.
  Touches only spatial_* objects.
- xlsx sample (`報價單-sample-viewer.xlsx`):
  - Zip: CRC OK, UTF-8 name flag set.
  - Package: all 9 parts well-formed, each with an XML declaration; content types and rels complete.
  - Styles: style counts match their elements, every style index is in range.
  - Cells: rows and cell refs in order, dimension A1:G106 matches the used range, no overlapping or single-cell merges
    (26).
  - Sheet: worksheet children in schema order. Formulas have no leading '='. Sheet name 報價單 and Print_Titles
    `'報價單'!$10:$10` are valid.
  - Shared strings: 136 strings, escaped correctly; CJK intact. Number formats: `#,##0`, `"NT$ "#,##0`, `0.00`.
  - openpyxl reads it. A forced LibreOffice recalc (UNO calculateAll) leaves all 73 formulas unchanged, totals
    2,113,323 / 105,666 / 2,218,989. Plain headless conversion does not recalc: LibreOffice keeps cached values, so the
    builder's "recalculates" note was not actually tested by that method.
- Owner-only: Excel button hidden on `?share=` (JS + CSS) and absent on `/proposal?share=`. Shown for the owner and on
  demo plans. Price list dialog: hidden signed out; migration-missing state and bad input are covered by e2e; zh + en.
- 360 px (own Playwright check, owner + firm price list, zh + en): 提案書 toolbar wraps, page width 360, no overflow.
  Viewer quote buttons (查看清單 / Excel 報價單 / 建立提案) are 94 px each with no clipped text. No page errors.
- T-002 follow-ups: initials and logo URL escaped in the preview (projects.html); logo hint says 8 MB, which matches
  the 8 MB check at projects.html:382.
- No secrets, client data, fixture content or binaries in the diff. No new dependency (xlsx written by hand). No AI
  cost.

**Blocking**
- B1 `src/plan.js:149` and `:153`: `total: Math.round(qty * price)` rounds in binary floating point, so a half-dollar
  product rounds down. Example: 1.13 坪 × 450 = 508.5 should be 509, but JS gives 508 (because 1.13 × 450 =
  508.49999999999994). This hits 2–4 % of lines at unit prices ending in 50 (seeded 完工清潔 450/坪, and common firm
  prices like 350/850/1,250). The on-screen quote and 提案書 then differ by NT$1 from a calculator, and very likely
  from Excel/Sheets after `fullCalcOnLoad` recalculates `ROUND(C*E,0)` (LibreOffice happens to agree with JS).
  Fix: `Math.round(Math.round(qty * 100) * price / 100)` (exact for 2-decimal quantities and whole-NT$ prices) on both
  lines. Add a unit case (1.13 × 450 → 509). The checks at `qa/unit/prices.test.mjs:158` and `qa/e2e.mjs:332` use the
  same JS rounding, so they can't catch this.

**Owner check before merge (O1)**
- Acceptance says "opens cleanly in Excel and Google Sheets"; neither is available here. My structural review found
  nothing Excel would reject, but someone must open the sample once in desktop Excel and in Google Sheets: no repair
  prompt, Chinese text, NT$ format, totals 2,113,323 / 105,666 / 2,218,989. The Excel button goes live on merge
  (demo plans too), independent of the migration.

**Non-blocking**
- N1 migration line 23: `jsonb_agg(l)` returns whole line objects, so any extra key on a switched-on line reaches anon.
  Today the UI stores `normPrices` output, so there are no extra keys. Whitelist id/name/spec/unit/qty/price/on with
  `jsonb_build_object` for defence in depth. Line 10: `create or replace` would work (same signature and columns) and
  avoids drop/re-grant.
- N2 Owner awareness: a share link's payload carries the firm's full 材質 price table (every option), waste % and
  notes. The client's 方案比較 needs it, but a client with dev tools can read it.
- N3 Print: LibreOffice paginates the sample to 3 A4 pages. Page 3 holds only note 4 and the sign-off under a repeated
  header row. Keep notes and sign-off together (row break before 備註, or `rowBreaks`). Excel pagination may differ.
- N4 e2e harness (qa-engineer): wrap each step's page in try/finally `ctx.close()` so one failure doesn't leave a
  WebGL page running and cascade. The 10 s branding wait is tight under software WebGL.
- N5 `src/prices-ui.js:35`: `<input type=month>` is a plain text box in desktop Firefox and Safari, and a value that
  isn't YYYY-MM is silently dropped. Add `placeholder="2026-11"` or validate.

## Validation round 2 (validator, 2026-11-16)

**Verdict: ship.** B1 is fixed (928daf8). O1 (opening the xlsx in Excel and Google Sheets) is pending with the owner
and does not block this verdict; do it before telling designers about the Excel button. N1–N3 and N5 remain optional
follow-ups.

- Diff b959fc3..928daf8: `money()` in `src/plan.js` (half away from zero, `toFixed(6)` absorbs binary error) is now used
  for finish lines, works lines and tax in `buildQuote`, and for the cached tax in `src/quote-xlsx.js`. It is exact
  here: line amounts are whole cents (2-decimal quantity × whole NT$), tax bases are multiples of 0.05, and neither
  ever sits within 1e-6 of .5 unless it is .5. The unit test and e2e `checkXlsx` use the same rule. No raw
  `Math.round` on money is left in `src/`.
- Sweep against exact decimal half-up: 0 mismatches over 1.2 M quantity × price cases at prices
  150/250/350/450/650/850/1,250/1,650/2,850/4,800/6,000/13 (round 1 had 4,790 mismatches in 380 k), and 0 over 714 k
  tax cases.
- Main vs round 1 vs round 2 over 53 plans × 6 styles (318 quotes, 5,202 lines): 0 lines, totals or grand totals
  changed against round 1. The fixture prices never produce a .5 amount: sample prices are multiples of 100 and works
  lines are off. Every line and tax equals exact half-up. No line moved against main beyond the stated 0.01-quantity
  rounding. e2e totals unchanged: 1,985,327; 2,113,323 / 105,666 / 2,218,989.
- N4 done (separate commit): `qa/e2e.mjs` registers each `page()` context and closes them in `step()`'s `finally`, so a
  failed step no longer leaves a WebGL page running.
- Gate (idle machine, with N4): unit 55/55 · regress 51, no regressions · e2e 21/21, normal timings (Explore 65 s,
  Excel viewer step 61 s).

## Rebase on main (2026-11-16, product-engineer)

Rebased onto origin/main 642a63a (T-007 merged in 94843d8), on top of the validator's round 2 (2012e1a, B1 928daf8,
harness 7ef7415). Conflicts: `qa/e2e.mjs` only (step filter + both new step blocks) and the board row (kept main's).
- One step filter: `QA_ONLY=<regex>` (T-007's `E2E_ONLY` substring filter dropped; its note in T-007-demo-kit.md updated);
  the validator's `openCtx` close-in-finally kept; T-007's demo steps and T-003's price-list steps both kept.
- `src/main.js` merged cleanly: T-007's per-project keys (`stateKey`, `finKey`) and T-003's firm prices / Excel button
  coexist; `src/ai.js` is unchanged from main.
- `docs/demo.md`: the 「下一版（開發中）」 line is replaced by the real flow — the day before, fill 我的專案 → 價目表 and test
  the download; at 6:00–7:30 open ⓘ (shows the firm's price-list name) and press 「Excel 報價單」 (designer only, not on
  the client link); 提案書 mentions the Excel button next to 列印; question 3 and the English summary updated; a
  fallback if the migration is not live yet. The O1 neutral wording on pricing is unchanged.
- Gate, run alone on an idle box: unit 55/55 · regress OK, no regressions · e2e 23/23 (T-007 demo journey: 原始提案
  1,985,327 → 侘寂風 2,761,505; T-003: viewer 未稅 2,113,323 = xlsx, 含稅 2,218,989 = 提案書 = proposal xlsx).
- Still not merged; migration `20261116150000_spatial_firm_prices.sql` still not applied (needs the owner's approval).

## Shipped (2026-11-17)

Owner approved everything on 2026-11-17 ("APPLY ALL"): the migration, the seeded works lines (保護工程 600/坪, 垃圾清運
15,000/式, 完工清潔 450/坪, 工程管理 30,000/式, all off by default), the xlsx note 「數量依平面圖計算，實際以現場丈量為準。」,
the quote fine print 「本報價為初步估算，實際金額以正式報價單與現場丈量為準。」, and Excel for the designer only.

- Migration `spatial_firm_prices` applied to the live project; `supabase/tests/spatial_firm_prices_rls.sql` passed there
  (rolled back: owner FKs present, no test rows left). `spatial_shared` grants: anon, authenticated, service_role.
  Security advisor: nothing new (the share RPC is public by design, token-gated; other warnings are the other product's tables).
- Merged to `main` in 43de2cc (gate on b6fcf2a: unit 55/55, regress no regressions, e2e 23/23).
- Live check (signed in): `plan.js` serves `money`, 我的專案 → 價目表 opens with the migration detected (no "coming"
  notice), the 提案書 shows 「下載 Excel 報價單（可編輯）」 with no console errors, an existing share link still resolves
  through the new `spatial_shared`. The owner's firm data was not changed.
- Still open: O1, opening a downloaded 報價單 once in desktop Excel and Google Sheets (structure-checked, not run here).
  Non-blocking follow-ups from validation: whitelist works-line fields in the RPC, print page break, 價格基準 field on
  Safari/Firefox desktop.
