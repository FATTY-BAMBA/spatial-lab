---
status: todo
priority: P1
owner: product-engineer
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
