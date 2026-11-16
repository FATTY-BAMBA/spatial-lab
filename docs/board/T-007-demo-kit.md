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
- unit 47/47 · regress 51 fixtures, no regressions · e2e 16/17 in the last full run (4 m 46 s), incl. new step 11
  (58.6 s). Step 11 fails on main's `src/main.js` ("a new project opened with another project's choices: 侘寂風,
  approved").
- The one failure is the 40k-line DWG frame-gap step (400 ms > 250 ms), which this branch does not touch. It fails only
  while other worktrees' tests share this 2-CPU box (load 2.5–4.8 during the run); run alone
  (`E2E_ONLY="big drawing"`) it passes: d10 3.2 s, 40k DWG 6.8 s. Validator: rerun the gate on a quiet box / CI.

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

## Validation (validator, 2026-11-16)

**Verdict: ship after fixes** (B1–B3 blocking; O1 needs the owner; N1–N8 non-blocking). Not merged.

**Evidence**
- Gate on a quiet box (load 1.0–1.8, nothing else running), branch at ca1616d: unit 47/47 · regress 51 fixtures, no
  regressions · e2e **all 17 passed**, incl. step 11 (43.8 s) and the 40k DWG frame-gap step (longest frame 83 ms, 6.7 s;
  mall DXF 67 ms). The branch does not touch import/CAD/frame code (diff: `src/main.js` keys + render message,
  `src/ai.js` status text, `src/editor/editor.js` one summary string, `.ai-status` CSS).
- Step 11 really tests the change: with main's `src/main.js`, `src/ai.js`, `editor.js`, html and the branch's
  `qa/e2e.mjs`, it fails: `a new project opened with another project's choices: {"style":"侘寂風","approved":true}`.
- Probes (Playwright, cloud + render stubbed, no AI calls): 504 and offline at 360 px, zh and en —
  「0 張完成，2 張失敗。AI 這次太久沒有回應，請再按一次。」/「…網路連線中斷，效果圖沒有送出。請確認網路後再按一次。」,
  "0 done, 2 failed. The AI took too long to answer; press again." / "…No connection: the render was not sent…";
  the status stays on screen (x 30–330 of 360, wraps to 2–3 lines, no horizontal scroll). "不到 1 秒" seen in rehearse.
- `npm --prefix qa run rehearse -- dxf-d00-own-apartment`: works, 0 errors (import 1.3 s, 3D 1.4 s, share 1.3 s,
  提案書 0.5 s, same rooms/area/quote as the log); output only in git-ignored `qa/reports/rehearsal/`.
- `docs/demo/*.jpg`: our sample DXF, the demo apartment and its renders, a made-up firm (木與石室內設計, example.com,
  王小姐) — no third-party or client plan. No secrets in the diff; no Supabase / `api/` / `vendor/` changes; no paid calls.
- Script checked against the UI: 上傳平面圖, the progress steps, 開啟 3D 導覽（5）countdown, 先檢查平面, 檢查 → 全部補上,
  小地圖 top-left, 鳥瞰, 平面圖 tab, 風格 cards + A/B, 查看清單, AI 效果圖 → ✦ 一鍵產生提案圖 / ✦ 產生目前視角, 分享 → 複製,
  開始導覽, 提案書 (doc icon) vs 提案, 列印 / 存成 PDF, 業主確認/設計師 sign block, the error texts — all exist as described.
  The Traditional Chinese reads naturally for Taiwan designers (業主, 坪, 未稅/含稅, 統一編號, 透天, 格局圖).

**Blocking**
- **B1 — the leak is still there for unsaved / editor-preview plans.** `stateKey` falls back to `'custom'` for
  `/?p=custom`, which is what the editor's top-right 「在 3D 中查看」 (`#btn-3d` → `open3D()`, `editor.js:1278`) always
  opens — even for a saved project — and what the progress screen opens when the project is not saved (signed out,
  save failed). Every browser that approved anything on main has `spatial.approval.custom` / `spatial.style.custom`
  (main used `custom` for all saved projects). Probe: those legacy keys + `/?p=custom` → opens in **侘寂風 with
  已核准 P-20261101-1000**. Unsaved plans also still share `spatial.finishes` with the demo apartment
  (`finKey` = global when `stateKey === projectKey`). Fix: give each unsaved preview its own key (e.g. an id written
  into `spatial.custom` by `open3D`, with its own finishes key), remove or ignore the legacy `spatial.approval.custom` /
  `spatial.style.custom` / un-keyed `spatial.finishes` for it, and extend e2e step 11: legacy keys seeded →
  `/?p=custom` opens on 原始提案, not approved.
- **B2 — demo.md sends the owner into that preview on stage.** Fallback "房間辨識不好 → … → 然後「在 3D 中查看」"
  opens `/?p=custom`: no ✦ AI 效果圖 buttons (no cloud), no 提案書 link, and B1's stale state. Either make `#btn-3d`
  open `/?id=<cloud.id>#explore` after the pending save is flushed (preferred; then the script is right), or change the
  script to go back through 我的專案 → 專案卡「3D 導覽」 after 「已儲存」.
- **B3 — storage-blocked browsers never open the viewer.** `src/main.js:348`
  `if (styleId === null && !localStorage.getItem(finKey)) styleId = 'original';` is the only unguarded storage access
  (a line this branch edited). With `localStorage` throwing (Chrome "block all cookies", some in-app browsers) the page
  logs `SecurityError` and never becomes ready; wrapped in `try {} catch {}` it boots (verified both ways).

**Owner decision**
- **O1** — demo.md tells the owner to answer price questions with 「試用期間不收費」. That commits to a free pilot,
  which is pricing (owner's call, T-008). Until Abdoulie confirms it, use neutral wording, e.g.
  「試用的方式和費用，我整理好再跟您確認。」

**Non-blocking**
- **N1 — merge conflict with T-003** (`git merge origin/agent/T-003-price-list-excel`): only `qa/e2e.mjs` conflicts —
  the `step()` header (this branch's `E2E_ONLY` vs T-003's `QA_ONLY` regex + `openCtx` closing) and both new step blocks
  added at the same place. `src/main.js`, html, board README merge cleanly. Rebase after T-003 lands: keep T-003's
  `QA_ONLY`/`openCtx`, drop `E2E_ONLY` (fix the "QA" note above that cites `E2E_ONLY="big drawing"`), keep both steps,
  rerun the gate.
- **N2 — after T-003 merges**, update demo.md (6:00–7:30 「下一版（開發中）」, question 3, English summary) to show the
  firm price list and Excel export for real, and rehearse it once.
- **N3** — 3D 卡頓 fallback: the project URL already has `?id=…`, so it is 「網址加 `&q=med`」, not `?q=med`.
- **N4** — the ask 「只在示範時用」 conflicts with keeping the plans as a live backup project and as private QA fixtures
  (T-013). Word the request to cover testing (「示範與內部測試用，不外流」) or delete them after the demo — owner's call.
- **N5** — phone (360 px), first set fails with no renders yet: the status bubble sits over the empty-state text, and a
  broken-image icon with alt 「即時 3D 畫面」/"Live 3D view" shows at the card's top-left (zh and en). Likely older than
  this branch; the client's fresh upload has no renders, so this is what a failure looks like on stage.
- **N6** — e2e step 11 checks the status fits at 960 px only; add the 360 px check (passes today by probe).
- **N7** — T-013: the harness reads recordings only from the public `qa/recordings/`; the task should include reading
  client recordings from the private fixtures dir, or picture plans can't be covered without breaking the rule.
- **N8** — acceptance: "< 2 min upload → first render" is an estimate (no live latency) and "script reviewed by the
  owner" is pending; after merge keep status `review` (awaiting owner + the NT$4 live render check), not `done`. Also:
  `qa/rehearse.mjs` (copied from e2e) uses 統一編號 22099131 for the made-up firm, which looks like a real company's
  number; use a checksum-valid made-up one in both files (not visible in the committed screenshots).

Board tasks T-010–T-013: sensible, front matter and README rows correct; T-013 correctly keeps client plans and their
recordings out of this repo (see N7).

## Fixes after validation (product-engineer, 2026-11-16)
- **B1 fixed.** Unsaved previews (`/?p=custom`) get their own key: the editor writes a per-plan `localId` into the doc it
  hands over (`open3D`), and the viewer keys style, finishes and 核准 on `local.<localId>` (saved projects `p.<id|token>`,
  demo plans by name). Custom plans never read the un-keyed `spatial.finishes`; the legacy `spatial.style.custom` /
  `spatial.approval.custom` are deleted on load. e2e: legacy keys seeded → editor (signed out) → 在 3D 中查看 → preview
  opens on 原始提案, not approved, legacy keys gone, `localId` present.
- **B2 fixed.** The editor's 「在 3D 中查看」 saves first and, when the account has exactly this plan, opens
  `/?id=…` (AI 效果圖, 提案書, share); only a plan that is not saved (signed out, save failed) opens the local preview.
  `cloudFlush` now reports a real save (an earlier id with a failed update no longer counts). demo.md's weak-detection
  fallback says to wait for 「已儲存到帳號」 and what each path gives. e2e: signed-in editor `?id=A` → `/?id=A`.
- **B3 fixed.** `src/main.js` 「styleId === null && !localStorage…」 wrapped (falls back to 原始提案). All other storage
  accesses on the viewer/editor/proposal paths were already in try/catch (grep: main, proposal, i18n, editor; handoff's
  `indexedDB.open` runs inside a Promise). e2e: `localStorage`/`sessionStorage` getters throw → demo apartment opens.
- Both new e2e steps fail on the previous commit (waitForURL / never ready) and pass now.
- **O1 — pending owner.** demo.md now says 「試用的方式和費用，我整理好再跟您確認。」; whether the pilot is free is
  Abdoulie's call (T-008).
- Non-blocking done: N3 `&q=med`; N4 the plan request asks permission for 示範與內部測試 (or delete after the demo);
  N6 step 11 also checks the status at 360 px; N8 made-up 統一編號 `12345675` (checksum-valid, obviously fake) in e2e and
  rehearse. Not done: N1/N2 wait for T-003 to merge; N5 (phone empty-state overlap, broken-image icon) and N7 (T-013
  recordings from the private dir) left as noted.
- Gate alone on a quiet box: unit 47/47 · regress 51, no regressions · **e2e all 19 passed** (step 11 43.3 s; 40k DWG
  longest frame 83 ms, 6.6 s).
- Status stays `review`: awaiting the owner's script review, O1, and the NT$4 live render check.
