---
status: review
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
