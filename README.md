# PrimeStride Spatial Lab

2D floor plan → walkable 3D, from one plan dataset.

**Live demo flow**
- **導覽 Story**: scroll from the top-down drawing → walls rise from the plan → materials and light → room-by-room walk → up the stair → 2F → exploded two-level view.
- **探索 Explore**: tap/click the floor to walk there; ink mini-map with your position and view cone; time-of-day slider (morning → dusk → night with lit city and interior lights); **A/B 對比** split view per finish with price delta and one-click adopt.
- **風格 Styles** (Explore panel, first tab): 原始提案 / 奶油風 / 侘寂風 / 現代輕奢 / 日式無印 / 工業風. Each style is a bundle of finishes + furniture fabric/wood palette + light temperature (`data/styles.json`), applied to the measured space with a wipe transition; cards show the resulting total and the difference; **A/B** splits the screen style vs style.
- Also in Explore: first-person walk (drag to look, WASD / arrows, *hold to walk* on phones) with wall + furniture collision and real stair climbing between floors. Overview mode with 1F / 1F+2F / exploded cutaways. Finish toggles (flooring, countertop, cabinet doors, wall paint) update the 3D and the quote live.
- **平面圖 Plan**: the ink plan per level, rendered from the same data, plus an auto-computed room schedule (m² / 坪). Click a room to walk into it.

## AI 效果圖 (geometry-locked renders)

`AI 效果圖` in the top bar opens a dark viewer: each real-time 3D frame sits under a photoreal render made from that exact frame, with a drag split, day/dusk toggle, style chips, download, and "walk into this space".

Pipeline (`tools/` + `.github/workflows/fetch-renders.yml`):
1. Photo cameras live in the plan JSON (`shots`: pos, look, fov). `window.__spatial.photo(shot)` locks the camera; captures are saved to `assets/ai/3d/<shot>[-<style>].jpg`.
2. Each capture is rendered with Nano Banana Pro (Higgsfield) using a prompt that locks camera, walls, openings and furniture and only upgrades materials/light (and swaps placeholder towers for the real skyline).
3. Render URLs go into `assets/ai/fetch.txt`; the GitHub Action downloads them, writes web JPGs + thumbnails to `assets/ai/render/`.
4. `python3 tools/ai_manifest.py apartment` writes `assets/ai/apartment.json`, which the viewer and proposal read.

## 提案模式 (proposal)

`提案` / `建立提案 →`: two schemes side by side (any two styles), each with its AI render, finish list, 材質工程 vs 家具暫估, 未稅/含稅 totals and the price difference. `核准此方案` stamps the scheme with time + reference number (stored per project in localStorage), unlocks a one-page A4 proposal (print / PDF) and the StrideBrain hand-off (demo stub).

Quote basis (`plan.quoteBasis`, defaults in `src/plan.js`, replaced by the firm's 價目表 when it has one — `src/prices.js`): price book + date, 含工帶料, waste per finish group, 5% 營業稅, works lines, written assumptions — shown under the total and in the proposal.

## 公司資料 + 提案書 (firm branding, client proposal)

- 我的專案 → **公司資料**: firm name, logo (PNG/JPG/WebP, resized in the browser, stored in the `spatial-logos` bucket),
  phone, LINE ID, email, address, 統一編號 (checksum-validated, optional), brand colour. One profile per account
  (`spatial_firms`, owner-only RLS). Each project card also takes the 業主名稱 shown on the proposal cover.
- Saved projects (`?id=` and client `?share=` links) show the firm's logo and name in the top bar, with
  "Powered by PrimeStride Spatial Lab" under the opening text, and a **提案書** button.
- **提案書** `/proposal?share=<token>` (client) or `/proposal?id=<project>` (owner preview); `/?share=…&view=proposal`
  redirects there. Cover (render, project, 業主, date, style, 坪), AI renders, floor plans + room table (m² / 坪),
  finishes, quote (未稅 / 營業稅 5% / 含稅), contact block and signature lines. `&style=<id>` picks the quoted style
  (default: the style with the most AI renders). 列印 / 存成 PDF prints A4 portrait.
- Database: `supabase/migrations/20261116090000_spatial_firms.sql` (`spatial_shared(token)` also returns `client` and
  the firm's public fields).

## 價目表 + Excel 報價單 (the firm's own prices)

- 我的專案 → **價目表**: name and 價格基準 month, 營業稅 (外加 5% or 不另計), 計價方式, and four tabs — 材質 (every
  finish option per 坪 or m² for floors/walls, per m for counters/cabinets, waste % per group), 工程項目 (保護工程,
  垃圾清運, 完工清潔, 工程管理 seeded switched off; add your own per 坪 / m² of floor or per 式), 家具 (catalogue prices;
  a piece in a plan takes the firm's price when its name and default price match) and 備註 (the quotation notes).
  Stored in `spatial_firms.prices`. Without a list, quotes use the PrimeStride sample price book as before.
- The 3D quote (owner and client link), 方案比較 and the 提案書 use the firm's prices; the basis line names the firm's
  list and date. Quantities are rounded to 0.01 before pricing, so 數量 × 單價 = 複價 on every line.
- **Excel 報價單** (3D quote panel and 提案書 toolbar, owner only): firm header and contact, project / 業主 / date / style /
  price list, rows grouped by trade (裝修材質, 工程項目) and by room (家具) with 項目 · 規格 · 數量 · 單位 · 單價 · 複價 ·
  備註, 小計 per section, 合計（未稅）, 營業稅, 總計（含稅）, notes and signature lines. Amounts are live formulas, so the
  designer can edit quantities and prices in Excel / Google Sheets. Written in the browser by `src/xlsx.js` (no library).
- Database: `supabase/migrations/20261116150000_spatial_firm_prices.sql` (`spatial_shared` returns a trimmed copy:
  switched-on works lines and only the furniture prices of pieces in that project).

## AI 服務狀態 (check the AI keys before a demo)

- 我的專案 → bottom link **檢查 AI 服務狀態**, or open `/projects?check`: a free check (`GET /api/health`, signed in) that
  each key is set, valid and can see the configured model — Anthropic `GET /v1/models/{id}` for room naming, Gemini
  `GET models/{id}` (same model order as `api/render.js`) for renders. No generation, no cost.
- **確認額度** (`POST /api/health`): one 1-token, text-only call per provider (no image, under NT$0.5) — the only way
  to see an empty Anthropic balance or a Gemini project on the free tier (image models have no free tier). One per
  minute per account, 20 per hour per server instance.
- The answer is a short code + model id per provider; never a key or the provider's error text. Model lists live in
  `api/_models.js`, shared by `api/vision.js`, `api/render.js` and `api/health.js`.

## 匯出 (export to the designer's tools)

Top bar → 匯出. Exports what is on screen, in the current style:

- **`.glb`**: SketchUp (File → Import), Blender, D5 Render, Twinmotion. Metres; one named group per room floor, wall set, door/window set and furniture item; plain-colour materials (SketchUp turns textured glTF materials white, and designers swap in their own library anyway). Quantised furniture GLBs are converted to float geometry.
- **`.obj` (zip with `.mtl` + README)**: 3ds Max, Rhino and the rest. Metres, Y up.
- **`.dxf` (R12, mm)**: the 2D plan for AutoCAD, drawn by the same `drawLevel` code as the screen through a canvas-like recorder (`src/export.js`). Layers: A-WALL (poché as SOLID), A-DOOR, A-GLAZ, A-FURN, A-FIXT, A-CASE, A-AREA (room polygons), A-ANNO-TEXT, A-ANNO-DIMS, A-RAIL, A-FLOR-STRS. Chinese text is written as `\U+XXXX` with a `CJK` text style (msjh.ttc).

The export is geometry, not parametric objects: walls arrive as faces/groups, not native SketchUp or Revit walls.

## Plan editor (`editor.html`)
Draw your own plan and open it in 3D:
- **牆 W**: click-to-click walls with snapping (endpoints, walls, orthogonal/45°, alignment, 5 cm grid); type a length (`360` = cm, `3.6` = m) + Enter.
- **門 D / 窗 N / 拉門 S**: click a wall to place; drag along the wall to move; edit width / sill / head in the panel.
- **分界 Z**: dashed boundary to split an open space into rooms (客廳 / 餐廳); not built in 3D.
- Rooms are **detected automatically** from closed walls, with m² / 坪; exterior walls are found and thickened automatically.
- **家具 F**: furniture catalogue (sofa, beds, dining set, kitchen run, bath fixtures…), R to rotate.
- **樓梯 T**: drag the stair footprint; the floor above is created with the exterior walls copied and the stairwell cut out.
- **Trace a real plan**: *匯入平面圖照片* (photo/scan) → *比例* tool: click two points of a known dimension and type it. *匯入 DXF*: plan drawn as underlay with endpoint snapping; **自動辨識牆體** pairs parallel wall lines into walls, finds door/window/slider gaps (glazing lines → window), closes corners, and names rooms from the drawing's text. Try *開啟範例 → DXF 範例* (`samples/sample-2br-apartment.dxf`). *DWG* (AutoCAD R12–2018 formats, i.e. files saved by AutoCAD 2018–2025 too): converted to DXF in the browser (acad-ts in a Web Worker; the file is not uploaded anywhere), then the same DXF import. A DXF or DWG dropped into an empty project (editor or 我的專案) now goes straight to walls, rooms and furniture with the progress screen (DWG adds a 轉檔 step); into a plan that already has walls it only becomes the underlay. Limit 50 MB.
- Undo/redo, autosave in the browser, JSON download/open, **在 3D 中查看** builds spots, a door-aware camera tour and quantities automatically (`?p=custom`).

## Demo projects
- `?p=apartment` (default): 大樓住宅 3房2廳2衛, 9F of a 14F tower, front balcony + service balcony, city and mountain view.
- `?p=townhouse`: 透天 2F with a real stair between levels.

## Quality tiers
`?q=high` (default on desktop): shadows 2048, GTAO ambient occlusion, bloom, 4× MSAA.
`?q=med` (default on touch / low-memory devices): shadows 1024, no post-processing.
`?q=lite`: no shadows, pixel ratio 1.

## The core idea
Everything is derived from `data/house.json`:

| Output | Source |
| --- | --- |
| 2D ink drawing (walls, doors, windows, stair, dims, labels) | `src/drawing.js` |
| 3D walls with openings, floors, ceilings, stair, furniture | `src/scene.js` |
| Walk collision + stair heights | `src/explore.js` |
| Areas, quantities, quote lines | `src/plan.js` |
| 價目表 (firm prices), Excel 報價單 | `src/prices.js`, `src/prices-ui.js`, `src/quote-xlsx.js`, `src/xlsx.js` |

### Plan schema (v0.1)
`project` → `levels[]` (each with `elevation`, `height`, `walls[]` with `openings[]`, `rooms[]` with polygons + standing spot, `voids[]`, `furniture[]`) → `stairs[]` (linking levels) → `finishes[]` (option prices + quantity basis) → `defaultFinishes`.
Plan coordinates are metres, `[x, z]`, with z toward the street.

Multi-storey is native: each level has an elevation; stairs link `from`/`to` levels; voids cut the floor above; the level above is hidden or exploded in overview.

## Languages (繁中 / English)
- Shareable links: `/zh` (Chinese) and `/en` (English). `/` opens Chinese, or the last language the visitor chose. The editor takes `?lang=en` / `?lang=zh`.
- The 繁中 | EN switch sits in the top bar of the viewer and the editor.
- Strings live next to the code as `t('中文', 'English')` (`src/i18n.js`); static markup in `index.html` is translated from `src/i18n-dict.js`. Data files carry `nameEn`, `taglineEn`, `typeLabelEn`, `captionsEn`, which replace the Chinese in English mode.
- `zh.html` and `en.html` are generated from `index.html` (English title, share-preview tags and markup). **After editing `index.html` or `src/i18n-dict.js`, run `node tools/lang_pages.mjs`.**

## Run
Plain static files, no build step. Any static server:
```
python3 -m http.server 8000   # then open http://localhost:8000
```
`?lite` disables shadows and caps pixel ratio (slow devices). `#explore` / `#plan` deep-link a mode.

Libraries are vendored in `vendor/` (three.js r170 + addons, Lenis 1.1.13). Third-party models/HDRIs: see `CREDITS.md`.

## Deploy (Vercel)
Import the repo in Vercel → Framework preset **Other** → no build command, output directory `.` (root).

## Next
1. Plan editor: draw walls / place openings / name rooms (writes the same JSON).
2. DXF import → plan JSON. Then raster floor-plan recognition.
3. Baked lighting + glTF export per project; client share link.
4. Push the quote lines into StrideBrain AI 報價.

Prices in the demo are illustrative.
