# Spatial Lab — agent playbook

This file is the operating manual for every agent working on this repo (OpenAI Codex reads it directly; Claude Code
reads it through `CLAUDE.md`). Read it fully before you touch code.

## The product
PrimeStride Spatial Lab turns a 2D floor plan into a furnished, walkable 3D proposal for Taiwan interior-design firms.
A designer uploads a 格局圖 picture, PDF or DXF; within about a minute they get walls, floors, named rooms, the
drawing's own furniture, decor, a live quote, photoreal AI renders of their 3D, and a read-only link for their client.

- Live: https://spatial.primestrideai.com (Vercel, auto-deploys `main`). Every branch gets a Vercel preview URL.
- Users: designers at small Taiwan design firms (Traditional Chinese first, English second); their clients view share links.
- Owner: Abdoulie Fatty (PrimeStride AI). He wants direct, concise reporting and finished, tested work.

## Code map
| Area | Files |
|---|---|
| Viewer (3D, story, explore, quote, AI renders, share) | `index.html`, `src/main.js`, `src/scene.js`, `src/explore.js`, `src/story.js`, `src/ai.js`, `src/proposal.js`, `src/drawing.js`, `src/textures.js`, `src/export.js` |
| Plan model + helpers | `src/plan.js` (geometry helpers, stairs, quote basis), `data/*.json` (demo plans, styles) |
| Editor (import, edit, AI naming, flow) | `editor.html`, `src/editor/editor.js` |
| Import pipeline (pure, testable) | `src/editor/raster.js` (picture → walls/floors), `src/editor/dxf.js`, `src/editor/geometry.js` (rooms, open areas, completePlan), `src/editor/openings.js`, `src/editor/drawn.js` (furniture from the drawing, merge), `src/editor/furnish.js` (generic layouts), `src/editor/dress.js` (curtains, lights, art…), `src/editor/issues.js` (檢查) |
| Accounts / storage | `src/cloud.js` (Supabase client), `projects.html` (我的專案), `src/handoff.js` |
| Server functions (Vercel, CommonJS) | `api/vision.js` (Claude: room names, drawn furniture, floors), `api/render.js` (Gemini image model: photoreal render of a 3D frame) |
| i18n | `src/i18n.js`, `src/i18n-dict.js`, `tools/lang_pages.mjs` (regenerates `zh.html`/`en.html` from `index.html` — run it after editing `index.html`) |
| QA | `qa/` (see below) |
| Agent system | `AGENTS.md`, `.claude/agents/*.md` (role briefs), `docs/board/` (tasks), `docs/research/` (research notes) |

Conventions in the plan data: metres; x right, z down (south); a piece's back faces (−sin r, −cos r) for rotation r°
(r = 0 → front faces +z); rooms are polygons at wall centre lines; `open: true` marks rooms found by `openAreas`;
furniture flags: `auto` (generated), `drawn` (read from the drawing), `dress` (decor pass).

## Infrastructure
- Supabase project "PrimeStride Client OS" (`mhzdimntfcovzffidfxf`), shared with another product: touch only `spatial_*`
  objects. Table `spatial_projects` (owner-only RLS; `doc`, `thumb`, `renders`, `share_token`), RPC `spatial_shared(token)`,
  Storage bucket `spatial-renders` (public read, writes only under the user's own id folder). Every new table needs RLS.
- Vercel env vars: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (optional `VISION_MODEL`, `RENDER_MODEL`). Never print, log or commit secrets.
- AI costs: vision ≈ NT$1 per call (an import makes 2–3), render ≈ NT$4. Tests never call AI: they replay recordings.

## How we work (the loop)
1. **Pick** a task from `docs/board/` (status `todo`, highest priority first). Set `status: research` or `building`, `owner: <role>`.
2. **Research** (when the task says so, or the approach is unclear): `researcher` writes `docs/research/<task>.md`
   — options, evidence with sources, costs, recommendation. Decisions that cost money or change the product go to the owner.
3. **Spec**: turn the acceptance criteria into tests first (unit in `qa/unit/`, a fixture + baseline in the regression,
   or an e2e step). A task without a failing-then-passing test is not done.
4. **Build** on a branch `agent/T-xxx-short-name` (or a worktree). Small commits. Keep modules pure where possible so
   `qa/` can import them under Node.
5. **Gate**: `npm --prefix qa run all` must pass (unit → regress → e2e). CI runs the same on every PR.
6. **Validate**: the `validator` reviews the diff and the QA report against the task's acceptance criteria and the
   checklist below, on the Vercel preview URL. Only the validator may run `npm --prefix qa run baseline`, and only to
   lock in a reviewed improvement (say why in the commit).
7. **Merge** to `main` (auto-deploys), then **verify live** (load the page, run the changed journey once).
8. **Close**: update the task file (`status: done`, what shipped, numbers), `docs/board/README.md`, and report to the owner
   in 3–6 lines: what changed, measured result, anything he must do.

## Definition of done
- Acceptance criteria met and covered by tests; `qa` all green; no new page errors in e2e.
- No regression in `qa/baseline.json` (rooms, furnished rooms, drawn pieces, walls, room area).
- Works in Traditional Chinese and English, on a phone (≥360 px) and desktop.
- Live site checked after deploy.
- Docs: task file updated; user-visible changes noted in `README.md` when they change how the product is used.

## Validator checklist
Correctness against the criteria · tests actually exercise the change · no secrets / client data / third-party plans in
the diff (this repo is **public**) · Supabase changes have RLS · no new heavy dependency on the site (static site,
vendored libs only) · performance (import time in the report, 3D frame time) · i18n (zh + en strings) · mobile layout ·
error states (signed out, AI unavailable, slow network) · copy is clear Traditional Chinese a designer would use.

## Rules
- Never commit test plans, client files, recordings of client plans or secrets to this repo. Fixtures live in the private
  repo `FATTY-BAMBA/spatial-lab-fixtures` (`npm --prefix qa run fixtures` → `qa/.fixtures`, or set `QA_FIXTURES`). Client
  fixtures get neutral ids (`client-01`…).
- Don't push to `main` without a green gate (docs-only changes excepted).
- Don't add build steps: the site is plain ES modules served as files. Vendored libraries go in `vendor/`.
- Keep the Supabase project's other tables untouched; migrations are additive and reversible.
- Spend money (AI calls, paid APIs, new services) only when the task says so or the owner approved it.
- Ask the owner only for decisions that are really his (pricing, money, client-facing wording he must sign off, accounts).
  Otherwise decide, note the decision in the task file, and continue.

## QA commands (`qa/`)
| Command | What |
|---|---|
| `npm --prefix qa install` | decoders for the Node pipeline (Playwright comes from the environment or `npm i -D playwright`) |
| `npm --prefix qa run fixtures` | clone/update the private fixtures |
| `npm --prefix qa run unit` | unit tests (`qa/unit/*.test.mjs`, node:test) |
| `npm --prefix qa run regress` | every fixture through the real import pipeline → metrics vs `qa/baseline.json`; report in `qa/reports/index.html` |
| `npm --prefix qa run e2e` | browser journeys with cloud + AI stubbed (projects → upload → progress → 3D → read-only share) |
| `npm --prefix qa run all` | the full gate |
| `npm --prefix qa run baseline` | validator only: accept current regression results |
| `npm --prefix qa run serve` | the site on http://localhost:8080 |
| `npm --prefix qa run rehearse -- <id\|file>` | the client-demo journey, timed, AI stubbed (`docs/demo.md`, `docs/demo-rehearsal.md`) |

Recording AI answers for a fixture (so the gate covers the AI steps for free): import the plan once in the live editor
while signed in, then copy `window.__qaVision` into `qa/recordings/<fixture-id>.json` (shape: `{ S, size, passes }`).

## Roles
Role briefs live in `.claude/agents/` (Claude Code loads them as subagents; Codex: read the brief for the role you are
playing). `researcher` · `import-engineer` · `viewer-engineer` · `product-engineer` · `qa-engineer` · `validator`.
