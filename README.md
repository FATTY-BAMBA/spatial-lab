# PrimeStride Spatial Lab

2D floor plan → walkable 3D, from one plan dataset.

**Live demo flow**
- **導覽 Story**: scroll from the top-down drawing → walls rise from the plan → materials and light → room-by-room walk → up the stair → 2F → exploded two-level view.
- **探索 Explore**: tap/click the floor to walk there; ink mini-map with your position and view cone; time-of-day slider (morning → dusk → night with lit city and interior lights); **A/B 對比** split view per finish with price delta and one-click adopt.
- **風格 Styles** (Explore panel, first tab): 原始提案 / 奶油風 / 侘寂風 / 現代輕奢 / 日式無印 / 工業風. Each style is a bundle of finishes + furniture fabric/wood palette + light temperature (`data/styles.json`), applied to the measured space with a wipe transition; cards show the resulting total and the difference; **A/B** splits the screen style vs style.
- Also in Explore: first-person walk (drag to look, WASD / arrows, *hold to walk* on phones) with wall + furniture collision and real stair climbing between floors. Overview mode with 1F / 1F+2F / exploded cutaways. Finish toggles (flooring, countertop, cabinet doors, wall paint) update the 3D and the quote live.
- **平面圖 Plan**: the ink plan per level, rendered from the same data, plus an auto-computed room schedule (m² / 坪). Click a room to walk into it.

## Plan editor (`editor.html`)
Draw your own plan and open it in 3D:
- **牆 W**: click-to-click walls with snapping (endpoints, walls, orthogonal/45°, alignment, 5 cm grid); type a length (`360` = cm, `3.6` = m) + Enter.
- **門 D / 窗 N / 拉門 S**: click a wall to place; drag along the wall to move; edit width / sill / head in the panel.
- **分界 Z**: dashed boundary to split an open space into rooms (客廳 / 餐廳); not built in 3D.
- Rooms are **detected automatically** from closed walls, with m² / 坪; exterior walls are found and thickened automatically.
- **家具 F**: furniture catalogue (sofa, beds, dining set, kitchen run, bath fixtures…), R to rotate.
- **樓梯 T**: drag the stair footprint; the floor above is created with the exterior walls copied and the stairwell cut out.
- **Trace a real plan**: *匯入平面圖照片* (photo/scan) → *比例* tool: click two points of a known dimension and type it. *匯入 DXF*: plan drawn as underlay with endpoint snapping; **自動辨識牆體** pairs parallel wall lines into walls, finds door/window/slider gaps (glazing lines → window), closes corners, and names rooms from the drawing's text. Try *開啟範例 → DXF 範例* (`samples/sample-2br-apartment.dxf`).
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

### Plan schema (v0.1)
`project` → `levels[]` (each with `elevation`, `height`, `walls[]` with `openings[]`, `rooms[]` with polygons + standing spot, `voids[]`, `furniture[]`) → `stairs[]` (linking levels) → `finishes[]` (option prices + quantity basis) → `defaultFinishes`.
Plan coordinates are metres, `[x, z]`, with z toward the street.

Multi-storey is native: each level has an elevation; stairs link `from`/`to` levels; voids cut the floor above; the level above is hidden or exploded in overview.

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
