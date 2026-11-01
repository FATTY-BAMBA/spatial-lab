# PrimeStride Spatial Lab

2D floor plan → walkable 3D, from one plan dataset.

**Live demo flow**
- **導覽 Story**: scroll from the top-down drawing → walls rise from the plan → materials and light → room-by-room walk → up the stair → 2F → exploded two-level view.
- **探索 Explore**: tap/click the floor to walk there; ink mini-map with your position and view cone; time-of-day slider (morning → dusk → night with lit city and interior lights); **A/B 對比** split view per finish with price delta and one-click adopt.
- Also in Explore: first-person walk (drag to look, WASD / arrows, *hold to walk* on phones) with wall + furniture collision and real stair climbing between floors. Overview mode with 1F / 1F+2F / exploded cutaways. Finish toggles (flooring, countertop, cabinet doors, wall paint) update the 3D and the quote live.
- **平面圖 Plan**: the ink plan per level, rendered from the same data, plus an auto-computed room schedule (m² / 坪). Click a room to walk into it.

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
