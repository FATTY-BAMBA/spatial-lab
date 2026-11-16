---
status: done
priority: P0
owner: import-engineer
depends: []
---
# T-001 DWG upload

**Goal.** A designer drops an AutoCAD `.dwg` (what Taiwan firms actually have) on 我的專案 or in the editor and gets the
same result as a DXF: walls, rooms, openings, furniture. Today the editor asks them to save as DXF.

**Why now.** The client's plans arrive this week and are likely DWG.

**Research first** (`docs/research/T-001-dwg.md`): ways to turn DWG into DXF/geometry from a static site + Vercel
functions — e.g. LibreDWG compiled to WebAssembly in the browser (licence: GPL — check what that means for us),
ODA File Converter on a small container, Autodesk Platform Services, commercial conversion APIs (CloudConvert, ConvertAPI…).
For each: fidelity on AutoCAD 2013–2025 files, Big5/CJK text, speed, cost per file, privacy (client drawings leave the
browser?), what the owner must sign up for.

Research: docs/research/T-001-dwg.md — recommendation: convert in the browser with acad-ts 3.7.0 (MIT, vendored, 254 KB gzip, Web Worker): NT$0 per file, the drawing never leaves the browser, and no accounts are needed. Tested it on R2000–R2018 DWGs, where it matched AutoCAD's DXF. Fallback if real fixtures fail: LibreDWG wasm in a Vercel function (also free). Owner: add ≥2 DWG+DXF fixture pairs to the private fixtures repo.

**Acceptance criteria**
- `.dwg` accepted in the editor import and the projects drop zone; progress screen shows a 轉檔 step.
- On ≥ 2 DWG fixtures (AutoCAD 2018+, one with Chinese layer names/text): walls/rooms within 10% of the same drawing
  exported to DXF (regression fixtures added as pairs).
- Clear message when conversion fails or the file is too large; no client file is stored by a third party beyond the request.
- Cost per conversion documented; owner approved any paid service.

## Build (2026-11-16, import-engineer, branch `agent/T-001-dwg-upload`)

**Shipped**
- `vendor/acad-ts/acad-ts-3.7.0.min.js` (npm `dist/index-min.js`, unmodified, MIT, LICENSE beside it; version in the file name because `/vendor/` is cached immutable). 1.2 MB, 251 KB gzip. Loaded only when a `.dwg` arrives (e2e checks a picture import never fetches it).
- `src/editor/dwg.js`: `convertDWG` (pure, Node-importable), `checkDWG` (50 MB cap and version header before any parsing), `DwgError` codes (`too-large`, `not-dwg`, `old-version`, `new-version`, `unsupported-version`, `failed`, `empty`, `timeout`), `dwgToDXF` / `dwgToDXFInfo` (module Worker `src/editor/dwg-worker.js`, buffer transferred, 120 s timeout, main-thread fallback if module workers are missing).
- Editor: `.dwg` from 匯入 DXF／DWG, the picture input, or the 我的專案 handoff → 轉檔 step (ticking seconds, then "AutoCAD 2018 · 0.4 秒") → existing DXF import. zh/en error per code in the progress card and toast.
- **Decision (mine, product behaviour):** a DXF *or* DWG dropped into an **empty** project now runs the whole progress flow (walls → rooms named from the drawing text → furniture → save → 3D countdown), like a picture. Into a plan that already has walls it stays an underlay, as before. Sample menu DXF unchanged (underlay). Rooms/furniture step labels read 依圖面文字命名房間 / 擺放家具與佈置 for CAD (no AI call, NT$0).
- Fix found on the way: `autoFurnish` skips rooms whose 5 cm grid would exceed 4 M cells (100 m × 100 m). A non-plan drawing (LibreDWG example: 5 km² open area) built a 2-billion-cell grid and hung the import, DXF too. Largest room in our fixtures: 72 × 80 m (mall), unaffected.
- QA: `kind: "dwg"` in `qa/lib/pipeline.mjs` (convertDWG → DXF path); fixtures may name a DXF `pair` and the regression **fails** if walls, rooms or room area differ by > 10%. Report shows convert time and DWG version. `qa/unit/dwg.test.mjs` (11 tests: R2000/2004/2010/2013/2018 two-room plans written by acad-ts in the test, Chinese layer + text on R2010+, Big5 code page, bad/old/new/too-large inputs, real fixture vs AutoCAD DXF, huge-room furnish cap). e2e: DWG on 我的專案 → 轉檔 → walls/rooms, no non-GET or off-site request carries the file; damaged DWG → zh error, no page error.

**Numbers** (public DWG/DXF twins, fixtures kept in the private folder, not in this repo)

| Drawing | DXF (AutoCAD) walls / rooms / area | DWG R2000–R2018 (6 versions each) | Convert (Node) |
|---|---|---|---|
| LibreDWG example | 38 / 6 / same | 38 / 6 / same on all 6 | 50–213 ms |
| ACadSharp sample | 26 / 2 / 296.9 m² | 25 / 2 / 296.9 m² on all 6 (−4% walls) | 65–144 ms |

- Browser (headless Chrome, this sandbox), worker vs main thread, longest frame gap during conversion:
  synthetic 40,000 lines + 2,000 texts (0.8 MB DWG → 5.8 MB DXF): convert 1.2–1.3 s; **17 ms in the Worker vs 1,167 ms on the main thread**. The DXF parse that follows still runs on the main thread: 0.3–0.45 s.
  ACadSharp sample 1.3 MB: convert 0.19 s (Worker start adds ~0.1 s), 17 ms vs 83 ms.
- Gate (`QA_FIXTURES=… npm --prefix qa run all`): unit 26/26; regress 50 fixtures, 0 regressions, the 33 baseline fixtures unchanged on every metric, 17 new (DWG/DXF twins); e2e 6/6.

**Still unverified / open**
- Real client DWGs (owner to add ≥ 2 AutoCAD 2018+ DWG + DXF pairs to the fixtures repo, one with Chinese layers). Public test drawings are not floor plans.
- Big5 text in R2004-and-older DWGs: the reader maps ANSI_950 → Big5 (unit test checks the code page), but acad-ts's *writer* can't encode Big5, so no test file has real Big5 text; LibreDWG reads its output as "???" too. Needs a real R2004 DWG from a Taiwan office.
- Geometry after conversion is the existing DXF path: on the synthetic 40k-line DWG, `wallsFromDXF` + `detectRooms` took ~60 s in Node (that file is not in the gate). Real large plans may freeze the editor at the walls step; moving `parseDXF` + wall detection into the Worker is the follow-up if client files show it.
- Custom objects (天正 walls, proxy entities), xref-only DWGs: not drawn; the `empty` error tells the designer to bind xrefs or save as DXF.
- Not yet checked on the Vercel preview or Safari/iOS (module Worker needs Safari 15+; older falls back to the main thread).

## Validation (2026-11-16, validator) — **ship after fixes**

Merged `origin/main` (T-005) into the branch: one conflict in `detectDXF`, kept both `named++` and `roomFlagsFromName` (229fd7c).

**Passes**
- Gate with private fixtures: unit 33/33 (11 DWG); regress 50 ran, 0 missing, 0 regressions, 17 new (all DWG twins `=` their DXF, convert 48–200 ms); e2e 6/6.
- Tests exercise the change: DWG unit tests import `dwg.js`; the regress pair check fails on > 10%; e2e drops a DWG on 我的專案 and a damaged DWG in the editor.
- Licence: `vendor/acad-ts/LICENSE` (MIT) + CREDITS line. No .dwg/.dxf/pictures added to the repo (only `samples/sample-2br-apartment.dxf`, already on main); fixtures.json holds only ids/notes of public LibreDWG/ACadSharp drawings. No secrets. No Supabase change. NT$0 per conversion; the file never leaves the browser (e2e checks no non-GET/off-site request).
- Converter is lazy (not fetched for pictures), runs in the Worker: no frame over 250 ms during 轉檔.
- Journey walked locally, zh/en × 1280/390: 我的專案 → DWG → 轉檔「AutoCAD 2018 · 0.4 秒」→ all steps ✓ → 3D opens on the imported plan; no horizontal scroll at 390 px; damaged DWG → clear zh/en message + 手動描牆; 51 MB DWG → too-large message. No page errors.
- Scope change (CAD into an empty project runs the full flow) accepted: it is what the task goal asks for ("same result as a DXF: walls, rooms… furniture") and matches the product promise. But it makes the freeze below automatic for every CAD upload.

**Blocker: the page freezes after conversion on large drawings** (headless Chrome, editor import, longest frame gap):

| File | Total | Frozen (single long task) | Where |
|---|---|---|---|
| big_40k.dwg (synthetic, 40k wall lines, 0.8 MB) | 45.4 s | **42.7 s** | `wallsFromDXF` |
| d10_mall_gf.dxf (72×80 m mall) | 18.6 s | **18.4 s** | `autoFurnish` |
| d19_wilson_basement.dxf | 1.8 s | 1.6 s | furnish |
| d12_babcock_l3.dxf | 1.3 s | 1.1 s | furnish |
| acs_sample_AC1032.dwg, lib_example_2000.dwg | 1.1–1.3 s | < 0.25 s | — |

`detectWalls` pairs every wall-layer segment with every other (`pairUp`, `src/editor/dxf.js` ~l.151): Node 5k segs 0.6 s, 10k 2.6 s, 20k 12.7 s, 40k 55 s. Real Taiwan DWGs (5–30 MB, blocks exploded onto wall layers) will be in the 10k–40k range: 3–55 s of a dead page during the client demo, with the seconds counter stopped.

**Required fixes**
1. Make `detectWalls` pairing sub-quadratic (bucket by direction, sort by normal offset, compare only within `maxT`; same for the zone pass). Target: `wallsFromDXF` on big_40k < 3 s in Node, regress 0 changes on all 50 fixtures.
2. Run the CAD auto-flow geometry (`parseDXF` → `wallsFromDXF` → `detectRooms` → name rooms → `autoFurnish`) in the Worker (all Node-pure already), posting progress per stage; the main thread only applies the level and ticks elapsed seconds on the active step. Target: longest frame gap < 250 ms over the whole import of big_40k.dwg and d10_mall_gf.dxf. (The manual 自動辨識牆體 button may keep the main-thread path.)
3. Gate it: add big_40k.dwg to the private fixtures + `qa/fixtures.json` (kind dwg), and an e2e step that imports it (or d10) and fails if any frame gap > 250 ms or the flow takes > 20 s.

**Also before merge (not code)**: the `dwg/` fixtures exist only in the validator scratch folder; push them to `FATTY-BAMBA/spatial-lab-fixtures`, or CI will report the 17 new fixtures as missing.

**Open, owner-dependent (not blocking)**: no real client DWG yet; the Chinese DWG fixture (`dwg-cjk-r2018`) is one synthetic line with no DXF twin, so the "Chinese layer names/text within 10%" criterion is only met by unit tests. Pre-existing, unrelated: the 我的專案 format chip「格局圖 JPG / PNG」is not translated in en.

## Validator round 1 fixes done (2026-11-16, import-engineer)

Commits: `61dc205` walls, `b14e1f7` furnishing, `1502fbe` Worker, `02116de` gate, `95a668a` en chip.

1. **Wall detection without all-pairs loops** (`src/editor/dxf.js`). Pair candidates come from direction bins plus an (offset, extent) grid in each bin's frame, widened by the measuring error (2·R·Δθ). The clash pass indexes kept pairs; "explained" uses a cell grid of band rectangles; the collinear merge does a binary search on per-bin offsets. Every index returns a superset and the original tests run in the original order. `wallsFromDXF` on big_40k: **78 s → 2.3 s** (Node). Output is **byte-identical** on all 38 CAD fixtures and big_40k. `qa/unit/dxf-index.test.mjs` compares indexed vs `exhaustive: true` on 40 random drawings (it fails if a pruning window is cut; checked).
2. **Furnishing** (`src/editor/furnish.js`). The 18 s on d10 came from `roomGrid` testing every 5 cm cell against every wall (2.3 M cells × 55 walls, `wallFrame` per call), plus the dining-table search scanning each candidate box. Now: a scanline inside-test (same crossing formula), wall clearance only over each wall's nearby cells, and a summed-area table for the dining search. **d10 25.6 s → 0.7 s, wilson 1.7 → 0.05 s, babcock 0.9 → 0.06 s.** Furniture is identical on all 50 fixtures (kind, size, position, rotation).
3. **Whole CAD auto-import in a Worker**: `src/editor/cadimport.js` (pure `runCAD`/`planLevel`) and `src/editor/cad-worker.js`. Stages are posted as they finish; the page ticks seconds on the active step and applies the result in pieces (no redundant room re-detection, preview capped at 6,000 lines). The 自動辨識牆體 button still runs `planLevel` on the page. Into a plan with walls, reading the drawing also happens in the Worker.
4. **Gate**: `dwg-perf-40k` fixture (`dwg/big_40k.dwg`) is in `qa/fixtures.json`. An e2e step imports big_40k.dwg and d10_mall_gf.dxf and fails on any frame > 250 ms or > 20 s.

**Headless Chrome, whole editor import** (validator's `measure-t001.mjs`):

| File | Before: total / longest freeze | After: total / longest frame |
|---|---|---|
| big_40k.dwg | 45.4 s / 42.7 s | **5.1 s / none > 250 ms** (e2e: 100 ms) |
| d10_mall_gf.dxf | 18.6 s / 18.4 s | **1.9 s / none > 250 ms** (e2e: 50 ms) |
| d19_wilson_basement.dxf | 1.8 s / 1.6 s | 0.8 s / none |
| d12_babcock_l3.dxf | 1.3 s / 1.1 s | 0.8 s / none |
| acs_sample_AC1032.dwg, lib_example_2000.dwg | 1.1–1.3 s | 0.8–1.8 s / none |

Regression ms: d10 20.7 s → 0.8 s, babcock 1.2 → 0.3 s, wilson 1.5 → 0.1 s.

**Gate** (`QA_FIXTURES=… npm --prefix qa run all`): unit 38/38; regress 51 fixtures, 0 regressions, the 33 baseline fixtures unchanged on every metric, the 17 round-1 DWG/DXF fixtures unchanged, +1 new (`dwg-perf-40k`); e2e 8/8. Baseline not touched.

Also: the 我的專案 format chip「格局圖 JPG / PNG」now reads "Plan image JPG / PNG" in English.

Still open: push the `dwg/` fixtures (now including `big_40k.dwg`) to the private fixtures repo before merge. Real client DWGs and Big5 R2004 remain unverified.

## Validation round 2 (2026-11-16, validator): **ship**

I checked these myself, not from the builder's numbers:
- **Walls are byte-identical.** I ran `wallsFromDXF` from main and from the branch on the same parsed input: all 19 `dxf/` fixtures, all 19 `dwg/` files (DWGs converted first) and big_40k matched JSON for JSON. big_40k went from 63.4 s to 2.4 s (Node). The LibreDWG example (km-wide extents) got slower, 1 ms → 0.7 s, which is harmless.
- **Furniture is identical.** I ran main's and the branch's `autoFurnish` on the same level for 12 CAD fixtures, including d10, d19, d12 and d13. Everything matches except the per-call `id`/`seed` uids. d10 went from 22.0 s to 0.67 s, d19 from 1.57 s to 0.05 s.
- **Headless Chrome, whole editor import** (`measure-t001.mjs`): no frame over 250 ms on any file.

| File | Before (total / frozen) | Now (total / frozen) |
|---|---|---|
| big_40k.dwg | 45.4 s / 42.7 s | 5.4 s / none |
| d10_mall_gf.dxf | 18.6 s / 18.4 s | 1.9 s / none |
| d19_wilson_basement.dxf | 1.8 s / 1.6 s | 0.8 s / none |
| d12_babcock_l3.dxf | 1.3 s / 1.1 s | 0.9 s / none |
| acs_sample_AC1032.dwg | 1.1 s / none | 1.4 s / none |

The steps tick in order: 轉檔 2.0 s → 讀取 2.6 s → 牆 4.7 s → 房間 5.0 s → 儲存 5.4 s.
- **Gate** (`QA_FIXTURES=…`): unit 38/38; regress 51 fixtures, 0 regressions; e2e 8/8. In the e2e perf step the longest frame was 83 ms for big_40k and 67 ms for d10. The e2e prints these result lines one step early (cosmetic).
- **自動辨識牆體** (sample DXF): 9 walls, 6 named rooms, toast OK. A DWG dropped into a plan that already has walls only becomes the underlay, with walls untouched and no progress screen.
- **Journey, zh/en at 1280 and 390 px:** 我的專案 → DWG → 轉檔 → all steps done → 3D. Damaged and 51 MB DWGs show their messages. No horizontal scroll and no page errors. The en chip now reads "Plan image JPG / PNG".
- **Baseline:** I accepted the 18 new fixtures only. The 33 existing entries are byte-for-byte unchanged, timings included.

**Follow-ups (not blocking the demo):**
- **Worker fallback is broken** (`runCADJob` in `cadimport.js`; same pattern in `dwg.js` `dwgToDXFInfo`). `postMessage(..., [buf])` detaches `buf` before the Worker can fail to load, so `here()` runs on an empty buffer. Checked: with `cad-worker.js` returning 404 or a syntax error, a valid DWG shows「這不是 AutoCAD 的 DWG 檔，或檔案已損毀」and a valid DXF shows「DXF 讀取失敗」. This only happens when the module Worker can't load (browsers before Safari 15 / Firefox 114, or a failed fetch), but the message wrongly blames the designer's file. Fix: keep a copy for the fallback (`buf.slice(0)` before transferring), and add an e2e step that routes `cad-worker.js` to a 404.
- **A Worker that crashes after its first stage message** (e.g. out of memory) is ignored by `onerror` (`answered` is true), so the designer waits until the 180 s timeout. Treat any `error` after start as a failure (or fall back).
- **Dead code:** `dwgToDXFInfo` / `dwg-worker.js` are no longer used by the site, only by unit tests. Remove them, or point the tests at `runCAD`.

**Open (owner):**
- The private fixtures repo doesn't exist yet, so CI shows the 18 `dwg/` fixtures as missing until they're pushed (the files are in the validator's scratch `qa-fixtures/dwg/`).
- No real client DWG yet. The Chinese DWG has no DXF twin. Big5 in R2004 DWGs is unverified.

**Merged** to main as `e57ddab` (2026-11-16); unit 37/38 on main without fixtures (1 skipped: DWG fixtures not synced). Live check: orchestrator.

## T-001b follow-ups (2026-11-16, import-engineer, branch `agent/T-001b-worker-fallback`)

- **Worker fallback fixed** (`runCADJob`, `src/editor/cadimport.js`). The Worker now gets a copy of the file, so when it can't load (404, Safari < 15, Firefox < 114) the import on the page reads the real bytes. Before, a valid DWG showed「這不是 AutoCAD 的 DWG 檔」and a valid DXF「DXF 讀取失敗」.
- **Worker crash.**
  - If the Worker errors **before** its first message, the import runs once on the page.
  - An `error` or `messageerror` **after** it started (out of memory, crash) ends the import at once with code `crashed` and a zh/en message (「瀏覽器處理這張圖時中斷了…」). It used to wait 180 s.
  - A crash does not fall back to the page: the same drawing would most likely freeze the page too.
- **Dead code removed:** `dwgToDXF`, `dwgToDXFInfo` and `src/editor/dwg-worker.js`. Their unit tests now cover `runCADJob` with a stand-in Worker whose `postMessage` really detaches the buffer: load failure → page fallback on an intact file; crash after one progress message → `crashed` in under 1 s with no rerun; answer, error and timeout paths. Both of the first two fail on the old code.
- **e2e:**
  - `cad-worker.js` routed to 404: a valid DWG (38 walls, 6 rooms) and the sample DXF (9 walls, 6 rooms) still import.
  - A Worker that posts 轉檔 and then throws: the error card shows in 0.2 s.
- **Gate** (`QA_FIXTURES=… npm --prefix qa run all`):
  - Unit: 40/40 pass.
  - Regress: 51 fixtures, 0 regressions, all baseline metrics unchanged.
  - E2E: 11/11 pass.

### T-001b validation (2026-11-16, validator): **ship**
- Diff reviewed. The Worker now gets `buf.slice(0)`, so the page keeps the bytes for its fallback. A load error before the first message falls back to the page once; an error or messageerror after that gives `crashed` at once. Not retrying on the page after a crash is the right call: the same drawing would freeze or crash the tab. The cost is a second copy of the file while it imports (≤ 50 MB more).
- Gate (`QA_FIXTURES=…`): unit 40/40, regress 51 fixtures with 0 regressions, e2e 11/11. Crash card in 0.2 s; perf steps' longest frame 67 ms (d10) and 133 ms (big_40k).
- My `fallback-t001.mjs` (`cad-worker.js` → 404 or a syntax error): d05 DXF 6 walls / 3 rooms; lib_example_2018 DWG 38 walls / 6 rooms in both cases, same as with the Worker. Round 2 showed a "damaged file" error here.
- The new unit tests fail on the old code (buffer-intact and no-rerun asserts). No references to the removed code are left outside docs. Baseline unchanged.
- Remaining (not blocking): a real out-of-memory kill may not fire `error` in every browser; that case still ends at the 180 s timeout.
