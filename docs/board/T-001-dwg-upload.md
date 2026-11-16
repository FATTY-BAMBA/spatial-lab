---
status: todo
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
