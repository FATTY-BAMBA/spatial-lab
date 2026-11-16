---
status: review
priority: P0
owner: product-engineer
depends: [T-002]
---
# T-007 Client demo kit

**Goal.** Abdoulie can run a flawless 15-minute demo with the client's own plan.

**Scope.** A demo script (docs/demo.md, zh): upload → progress → 3D walk → style switch → quote → one-click renders →
share link on the client's phone → proposal. A "demo account" checklist (fresh project list, firm profile filled,
Gemini/Anthropic quotas OK). A rehearsal run on 3 fixtures with timings and screenshots; known weak spots and how to
avoid them on stage.

**Acceptance criteria.** Rehearsal log with timings < 2 min from upload to first render; zero errors; script reviewed by the owner.

## What shipped (branch `agent/T-007-demo-kit`)

- **`docs/demo.md`** — the 15-minute script (zh, English summary): pre-demo checklist (3–5 days / day before / 1 hour /
  5 minutes), minute-by-minute table (click · say · what the client should notice), fallback table (slow or failed
  renders, weak detection, no walls, DWG error, network, laggy 3D, expired sign-in, LINE browser, total failure →
  demo apartment), questions to ask the client, next step = 2–3 project pilot. T-003 price list/Excel is mentioned as
  "coming"; no prices quoted on site (owner decision, T-008).
- **`docs/demo-rehearsal.md`** — timings per step on 591-A3 (recorded AI), d00 apartment DXF, AC1032 DWG and our sample
  DXF; live estimate of upload → first render; weak spots and how to avoid them; screenshots of our own sample only
  (`docs/demo/`).
- **`qa/rehearse.mjs`** (`npm --prefix qa run rehearse -- <fixture-id|file>`) — the demo journey timed on any plan
  (the client's plans the day before), cloud and AI stubbed, screenshots in git-ignored `qa/reports/rehearsal/`.
  Not part of the gate.
- **e2e step 11 "demo journey"** — new coverage: style switch → quote follows; ✦ 一鍵產生提案圖 with `/api/render`
  stubbed → renders listed and saved in the chosen style; network down → zh message that fits the screen; style and
  核准 remembered per project.

## Rehearsal result
4 plans (591-A3 recorded AI, d00 apartment DXF, AC1032 DWG, sample DXF), 0 errors. Import 1.4–4.0 s, open 3D 1.7–2.2 s,
share link 1.4–2.0 s, 提案書 0.6–1.0 s. Upload → first renders, with the app's own AI estimates added: ≈42–44 s (CAD),
≈72 s (picture) — under the 2-minute target (estimate; live latency not measured, no paid calls). Details:
`docs/demo-rehearsal.md`.

## QA
- unit 47/47 · regress 51 fixtures, no regressions · e2e 15/17 in the full run, incl. new step 11 (78.7 s); the 2 failures are the frame-gap steps below. The new step fails
  on main's `src/main.js` ("a new project opened with another project's choices: 侘寂風, approved").
- The two big-drawing frame-gap steps fail only while another worktree's tests share this 2-CPU box; run alone
  (`E2E_ONLY="big drawing"`) they pass: d10 3.2 s, 40k DWG 6.8 s.

## Bugs and rough edges found

| # | Severity | Issue | Status |
|---|---|---|---|
| 1 | **High** | Style, finishes and the 核准 stamp were stored under one key (`custom`, plus a global `spatial.finishes`) for **every** saved project. After preparing a backup project in 侘寂風 and approving it, the client's freshly uploaded plan opened in 侘寂風 with the other project's total and an "已核准 P-…" stamp. | **Fixed**: keys per project id / share token (`src/main.js` `stateKey`); e2e step 11 seeds the old shared keys and checks a new project ignores them (fails on main). |
| 2 | Medium | Render with the network down showed the raw browser text "Failed to fetch"; a Vercel timeout showed "生成失敗：504"; a failed set ended with only "0 張完成，3 張失敗" (reason lost). | **Fixed**: zh/en messages that say what to do (網路連線中斷… / AI 這次太久沒有回應，請再按一次); the set's final line keeps the reason. e2e step 11 (offline). |
| 3 | Low | AI status pill was `nowrap`: long messages ran off narrow screens. | **Fixed**: wraps within the viewer; e2e checks it stays on screen. |
| 4 | Low | Progress summary said "共 0 秒" for fast DXF imports. | **Fixed**: "不到 1 秒" / "under a second". |
| 5 | Medium | Sharing only from 我的專案; no share button in the viewer, no QR for the client across the table. | New task **T-010**. Script works around it (我的專案 → 分享 → LINE). |
| 6 | Medium | The designer's chosen style is not saved with the project: the client's link always opens in 原始提案. | New task **T-011**. Script: tell the client to tap the style; 提案書 defaults to the style with the most renders. |
| 7 | Medium | No free way to check Gemini billing / Anthropic credit before a demo. | New task **T-012**. Checklist: one paid ✦ 產生目前視角 on the backup project (NT$4). |
| 8 | **High (risk)** | No real Taiwan firm DWG in the fixtures (all foreign/synthetic; LibreDWG sample imports at 5.2 M m²). The client's DWG on stage would be the first. | New task **T-013** (owner gets 2–3 plans; QA adds them as `client-0x` in the private repo and rehearses). |
| 9 | Low | Expired sign-in silently opens the demo apartment with a 6 s toast. | Checklist item (confirm 我的專案 in the bar before starting). |
| 10 | Low | 591-A3 reports 22 檢查 items; opening 檢查 on stage looks bad. | Script: only open 檢查 if something is visibly wrong; use 全部補上. |
| 11 | Low | One-click set picks ≤ 3 rooms by name (客/餐/主臥); plans with generic names (房間 1) get 1 render. | Script: name rooms before rendering in the backup project. |

QA note: the e2e "branded share link", DWG screenshot and big-drawing frame-gap steps time out when another worktree runs
its own browser tests on this 2-CPU box at the same time (software GL); run the gate alone.

## Decisions
- e2e step 11 opens the viewer with `?q=lite` (no post-processing) so the 1600×900 captures stay affordable in software
  GL; the capture code under test is the same.
- Committed screenshots use only our sample DXF (`samples/sample-2br-apartment.dxf`) with the demo apartment's renders as
  stubbed AI output; fixture screenshots stay in `qa/reports/` (git-ignored).
- Live AI latency is not measured here (no paid calls without approval); the rehearsal uses the app's own estimates
  (rooms 20–40 s, renders 30–40 s). The owner's checklist includes one paid render on the backup project.
