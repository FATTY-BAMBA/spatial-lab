---
status: review
priority: P1
owner: viewer-engineer
depends: []
---
# T-011 Save the designer's chosen style with the project

**Found in.** T-007 demo rehearsal.

**Problem.** The style and finishes the designer picks in the 3D (and the 核准 stamp) live only in that browser's
localStorage. The client's share link always opens in 原始提案, so the client sees a different look and total from the
one the designer just presented. (T-007 fixed the worse half: choices used to leak between projects on one laptop,
because every saved project used the key `custom`; they are now kept per project id / share token.)

**Scope.** Store `{ style, finishes }` on the project (`spatial_projects.doc.presented` or a new jsonb column, owner-only
RLS as today) when the owner switches style; the share link and 提案書 open on it by default; the client can still
switch styles on their phone without changing the saved one.

**Acceptance criteria.** e2e: owner picks 侘寂風 → client link opens in 侘寂風 with the same total; 提案書 quotes it;
client switching style does not change the owner's saved choice.

## What shipped (branch `agent/T-011-demo-polish`, with T-010 and T-007 N9/N10)

- **Where it is stored: `spatial_projects.doc.presented`** — `{ v, style (null = 自訂組合), palette, finishes, at }`.
  No migration: the doc already has owner-only RLS and `spatial_shared(token)` already returns it. `src/cloud.js`
  `savePresented(id, p)` reads the doc fresh and writes it back with only `presented` changed; `saveProject` (the
  editor's autosave) keeps the server's `presented`, so an editor tab opened before the style was picked cannot put an
  old one back.
- **Owner** (`/?id=`): every style or finish change is saved to the project 0.7 s later (`flushPresented`); 提案書 and
  分享 wait for that save. A failed save says so once (「風格沒有存到帳號（網路中斷？），客戶的連結仍是先前的風格…」) and
  retries on the next change or on 分享. An owner whose browser has a choice the project does not (picked before this
  shipped, or a failed save) pushes it once on open.
- **Client** (`/?share=`) and the owner on another computer open on `doc.presented` (finishes, style, palette). The
  client can switch styles on the phone: kept in that browser only (never saved); a reload keeps the client's switch
  until the designer presents something new (`usePresented`: the saved `at` vs the last one this browser applied). On
  the client's link the designer's style card carries 「設計師提案」, and 「↺ 回到設計師的提案」 appears once the client
  has switched away (needed for a 自訂組合, which has no card).
- **提案書** quotes the presented choice by default (`?style=` still wins): a catalogue style is priced with exactly the
  presented finishes; a 自訂組合 is added as its own entry. The style menu marks it 「（設計師提案）」.
- Pure helpers in `src/presented.js` (`makePresented`, `normPresented` — unknown groups/options/styles dropped,
  `usePresented`, `differs`) and `src/proposal-doc.js` (`withPresented`, `pickStyle(…, presented)`).
- The 核准 stamp stays per browser (out of scope; it is the client's act, not the designer's choice).

## Tests
- unit `qa/unit/presented.test.mjs` (5): normalisation, which choice opens, 提案書 total = `buildQuote` of the same
  finishes for a style and for a custom mix, `?style=` override.
- e2e 「T-011 style saved with the project」: owner picks 侘寂風 → saved on the project → client link (360 px) opens
  侘寂風 with the designer's total → client switches to 原始提案: no save call, nothing written → 「回到設計師的提案」
  restores it → client 提案書 quotes `wabi` with the same total; then a custom mix (one finish changed) → client in English
  shows Custom mix with the same total → 提案書 same total → the owner on another computer opens on it.
  Last run: 侘寂風 NT$ 906,618 = client = 提案書; custom mix NT$ 766,668 = client = 提案書 = owner elsewhere.
- e2e 「T-011 style save fails」: the message appears and fits a 360 px screen.
- Both failed before the change (「not saved on the project」, timeout) and pass now.
- The pages in this step open in 平面圖 (`#plan`): a style switch then applies without the animated 3D wipe, which took
  ~40 s per switch in software GL on this 2-CPU box (the step went from 256 s to 14 s). The wipe is still covered by the
  demo-journey step.

- Screenshot (our sample plan): `docs/demo/t011-client-pick-phone.png` (client switched to 原始提案 → 「↺ 回到設計師的提案」).

## Decisions
- Doc, not a column: no migration to apply before the demo, and the share RPC needs no change. Cost: one extra small
  read per save (the fresh doc for `savePresented`, `doc->presented` for the editor's autosave).
- The client's switch is remembered in their browser (per share token) rather than reset on every visit; a newer
  presentation by the designer wins.
- 3D scene unchanged (only which finishes/palette are applied at start), so the frame-time budget is unaffected.

## Known limits
- Two people editing one project at the same moment: the last `savePresented` wins (read-modify-write, no lock).
- `savePresented`/`saveProject` against the real Supabase are not exercised by the gate (cloud is stubbed); check on the
  Vercel preview: pick a style on a saved project → open the share link in a private window → same style and total.

## Gate (2026-11-17, branch head)
unit 65/65 · regress: no regressions · **e2e 28/28** in 5 m 21 s (T-011 12.0 s + 4.8 s, T-010 51.9 s, N9 4.0 s, N10 2.7 s).
The first full run had one timeout in the older 「share link shows the firm logo」 step (10 s wait for the brand, rAF
polling starved by software GL while another worktree ran tests): main's code takes the same 36–44 s there. The wait now
polls on a timer (3/3 alone, 23 s), and the next full run was all green.

## Rebased on main aa27ac0 (T-012 merged), 2026-11-17
Conflicts resolved, keeping both sides: `qa/e2e.mjs` header (T-012 is step 12; T-011/T-010/N9-N10 are now 13–15),
`docs/demo.md` (T-012's `/projects?check` checklist plus the QR-code phone check), `docs/board/README.md` (T-012 = done).
T-012 touched no viewer files; `zh.html`/`en.html` regenerated with no changes. Gate run alone (no other e2e or
regress process): unit 76/76 · regress: no regressions · **e2e 29/29** in 5 m 08 s (T-011 12.0 s + 5.0 s, T-010 49.8 s,
N9 3.9 s, N10 2.4 s, T-012 step 1.8 s; big drawings: longest frame 50 ms (mall DXF) and 83 ms (40k DWG)).

## Validation (validator, 2026-11-17)
Covers T-011, T-010 and T-007 N9/N10 (branch head 9556033 on main aa27ac0).

**Verdict: ship after fixes** (two small fixes, no re-review needed beyond the gate and the step named in each).

Evidence
- Gate run alone (pgrep clean, 2 CPUs): unit 76/76 · regress OK, no regressions · **e2e 29/29** in 5 m 32 s (T-011 11.5 s +
  4.9 s, T-010 48.9 s, N9 3.8 s, N10 2.5 s; big drawings longest frame 83 ms).
- The 5 new e2e steps run on main's code (aa27ac0 + this branch's `qa/e2e.mjs`): **all 5 fail** as claimed (not saved on
  the project / no message / no 分享 button / no N9 message / demo opens 自訂組合).
- Extra checks run ad hoc (temporary script, not committed):
  - With the firm's 價目表 (T-003 priced firm): owner 侘寂風 NT$ 923,170 = client link = 提案書.
  - Client link: opens 侘寂風 → client switches → real reload keeps the client's switch → designer re-presents (newer `at`)
    → opens 侘寂風 again; 0 `savePresented` calls from the client page.
  - Owner, old project without `presented`: a plain open writes nothing; a browser that still has a pre-T-011 style for
    that project pushes it once on open (see owner decision below).
  - Phone bar fits with no overlap at 412 px zh/en owner, 360/412 px en client, 360 px zh client; ⋯ opens with Enter, Esc
    closes and returns focus to ⋯; desktop after resize puts 提案書/我的專案/language back, no ⋯. Clipboard blocked →
    `execCommand` fallback copies. Share panel Esc closes and returns focus to 分享.
- Code review: no write path on `?share=` (`owner` requires `cloudId && !sharedView`; `savePresented`, `setupShare` and
  the 提案書 save-first handler are all behind it; anon cannot update under RLS anyway). `presented` is ignored for demo
  plans and `?p=custom` (no `cloudRow`); old projects without it fall back to the per-project localStorage path. New keys
  (`spatial.seen.*`, `spatial.palette.*`) are per `stateKey`, so no cross-project leak of style or 核准 (B1 holds); 核准
  stays per browser. 停止分享 nulls `share_token`; `spatial_shared` matches `p.share_token = token`, so the old link and QR
  really stop working. Token reused when present. QR encoder checked line by line against Nayuki's reference (level-M
  ECC/block tables, format/version bits, alignment, interleave, zigzag); unit test decodes every length 1–300 and 400…2331
  (v1–40, version info, 16-bit length, multi-block) with jsQR, and the e2e decodes the on-screen QR at 1280 and 360 px.
  LINE URL `https://line.me/R/share?text=` is LINE's documented format. jsQR is a `qa/` devDependency only (`qa/` is in
  `.vercelignore`); nothing new on the site except `src/qr.js` (9 KB) and `src/share.js`. No secrets or client data in the
  diff; screenshots show the sample plan and the fictional QA firm. zh/en pages regenerate with no change. N9 copy matches
  the editor's 「已儲存到帳號」; N10: `spatial.finishes` has no other reader.

Fixes before merge
1. **A style change is lost if the designer leaves within ~0.7 s** (plus the 3D wipe, during which nothing is queued yet).
   Reproduced: pick 侘寂風 → click 我的專案 at once → nothing saved on the project, so the client's link and the card's
   分享 keep the old style until the 3D is opened again in that browser. Only 提案書 and 分享 wait. Make every way out of
   the 3D wait for `flushPresented()` too — at least `#acct-link`, `#edit-link` and the language links (same handler as
   `#doc-link`) — and start the save on `pagehide`/`visibilitychange: hidden`. Add one e2e line: switch, click 我的專案 at
   once → saved.
2. `qa/e2e.mjs` line 223 (「share link shows the firm logo」): the new `// timer polling…` comment was put **before**
   `.catch(…)` on the same line, so the diagnostic catch is commented out. The step still fails on a timeout (no
   regression hidden), but with a bare Playwright message. Move the comment to its own line.

Not blocking (follow-ups)
- `savePresented` is a read-modify-write of the whole `doc`: an editor save landing inside that one round trip is
  overwritten, and each style switch downloads and uploads the full doc. Later: an RPC that sets only `doc->presented`
  (`jsonb_set`, security invoker, owner RLS) — needs a migration, so not before the demo.
- `src/cloud.js` lost a newline: `}export async function sharedProject` (works; cosmetic).
- a11y: the share panel (`role=dialog`) and the ⋯ menu do not move focus into themselves, and both sit at the end of
  `<body>`, so Tab from ⋯ goes to 提案 rather than into the menu. Esc/focus return are fine.
- Stopping sharing does not remove AI render files from the public bucket (pre-existing; URLs are unguessable).

Owner decisions (Abdoulie)
- **Every style or finish change the designer makes in the 3D is what the client sees** (no separate 「設為提案」
  button), including a style switched by tapping an AI render of another style. The demo script says to finish on the
  style to present; confirm this implicit model is what you want.
- **Existing projects:** the first time the designer opens an old project in 3D on a browser that still has a style from
  before this change, that style is written to the project and the client's link switches from 原始提案 to it. Fine if
  that browser's style is the one presented; otherwise open each live client project once and set the style.

Cannot check from here: the Vercel preview and the live Supabase (gate stubs the cloud). Live check after merge (main
session): signed in, open a saved project `/?id=…` → pick 侘寂風 → wait 2 s → in a private window open its share link:
侘寂風 and the same total, 「設計師提案」 on the card; switch to 原始提案, reload: stays; 「↺ 回到設計師的提案」 works;
`/proposal?share=…` quotes 侘寂風 (same total, with the firm's 價目表). Back as owner: 分享 → scan the QR with a phone →
same link; 停止分享 → the old link shows 「這個分享連結已失效或不存在」; 開啟分享連結 → new link works. Open the project
in the editor, move a wall, let it autosave → the share link still opens 侘寂風. Phone (360–412 px): bar fits, ⋯ menu
works, zh and en.
