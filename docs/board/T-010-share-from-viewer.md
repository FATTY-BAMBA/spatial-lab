---
status: review
priority: P1
owner: viewer-engineer
depends: [T-002]
---
# T-010 Share from the 3D viewer + QR code

**Found in.** T-007 demo rehearsal.

**Problem.** The share link can only be made on 我的專案 (project card → 分享 → 複製). In a demo or a client meeting the
designer is in the 3D viewer and has to leave it, find the card, copy, then send the link through LINE. There is no QR
code, so a client sitting across the table cannot just scan it.

**Scope.** Owner view of a saved project: a 分享 button in the top bar that turns sharing on (same `setShare`), shows
the link with 複製 / LINE 分享 (`https://line.me/R/share?text=`) and a QR code drawn in the browser (small vendored
encoder, no build step), plus 停止分享. Same in English. Hidden in the client's read-only view.

**Acceptance criteria.** e2e: owner opens a project → 分享 → link + QR shown; the QR decodes to the share URL (decode in
the test); the client view has no 分享 button; phone 360 px layout fits.

## What shipped (branch `agent/T-011-demo-polish`, with T-011)

- `src/share.js`: **分享** in the 3D top bar for the owner of a saved project (not on `?share=`, not on demo plans or
  unsaved previews). Opens a panel: QR code, 「請客戶用手機相機掃描…」, the link with **複製** (clipboard, falls back to
  select + copy), **LINE 分享** (`https://line.me/R/share?text=` with 「「案名」的 3D 提案…：<link>」), **其他 App**
  (`navigator.share`, phones only) and **停止分享** → 「已停止分享，舊連結和 QR code 都已失效。」 + 開啟分享連結.
  An existing token is reused (no `setShare` call); none → `setShare(id, true)` (same as 我的專案). Before the link is
  made, the designer's latest style is saved (T-011), so the client opens on it. Errors say what to do.
- `src/qr.js`: QR encoder written for this (byte mode, level M, versions 1–40, 8 masks with the standard penalty,
  ≈ 150 lines, 9 KB, no dependency) → inline SVG on a white quiet zone; a production share link is version 5 (37 × 37),
  200 px on screen.
- **Phone bar** (≤ 480 px, project views): 提案書, 我的專案 and the language move into a ⋯ menu (the same elements, so
  their links and the 提案書 save-first handler stay); the owner's PrimeStride mark is hidden; tabs tighter under
  400 px. Before this, the owner bar already overflowed at 360 px on main (提案 ended at 369 px; in English at 402 px,
  still clipped at 412 px) and on the client's link the tabs covered the firm logo. Now every item is on screen with no
  overlap at 360 px, zh and en, owner and client.
- Copy is zh + en (t()).

## Tests
- unit `qa/unit/qr.test.mjs` (5): every code decodes back with jsQR (independent decoder, `qa` devDependency only):
  share links (production, Vercel preview, localhost), every length 1–300 bytes plus 400…2331 (versions 1–40 incl.
  version info and multi-block interleave, ≥ 4 masks used), Chinese UTF-8, too-long throws, SVG shape.
- e2e 「T-010 share from the 3D」: owner → 分享 → link = share URL, exactly one `setShare(true)`, LINE href carries the
  link, the **QR on screen decodes** (screenshot → jsQR) to the link, 複製 puts it on the clipboard; 停止分享 →
  `setShare(false)` + message; 開啟分享連結 turns it back on; reopened with a token → shown at once, **no new token**;
  360 × 780: button on screen, bar fits with no overlap, panel inside the screen, QR ≥ 150 px and decodes, ⋯ menu holds
  提案書 / 我的專案 / language; English: no Chinese in the panel, bar fits; client link at 360 px: no 分享 button,
  bar fits. Failed before (no 分享 button), passes now.
- Screenshots (our sample plan only): `docs/demo/t010-share-phone.png`, `docs/demo/t010-bar-360-before-after.png` (rows: owner zh, client zh, owner en; each main then this branch).

## Decisions
- Own encoder instead of vendoring a QR library: 9 KB source, pure, tested by decoding; nothing to vendor or update.
- Level M (15 % recovery) keeps the code small enough to scan from a laptop screen across a table.
- The share URL stays language-neutral (`/?share=`): the client's phone picks its own language.

## Gate (2026-11-17, branch head)
unit 65/65 · regress: no regressions · **e2e 28/28** in 5 m 21 s (T-011 12.0 s + 4.8 s, T-010 51.9 s, N9 4.0 s, N10 2.7 s).
The first full run had one timeout in the older 「share link shows the firm logo」 step (10 s wait for the brand, rAF
polling starved by software GL while another worktree ran tests): main's code takes the same 36–44 s there. The wait now
polls on a timer (3/3 alone, 23 s), and the next full run was all green.
