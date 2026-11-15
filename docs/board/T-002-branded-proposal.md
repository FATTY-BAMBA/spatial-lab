---
status: todo
priority: P0
owner: product-engineer
depends: []
---
# T-002 Firm profile + branded proposal

**Goal.** What the client receives looks like it comes from the design firm: their logo, name, contact, and a clean
proposal page with the AI renders, the 3D link, rooms, finishes and the quote.

**Scope**
- Firm profile (one per account): firm name, logo (upload → Storage), phone, LINE ID, email, address, 統一編號 (optional),
  brand colour. New table `spatial_firms` (owner-only RLS); shown on 我的專案 → 公司資料.
- Share link header and the proposal page use the firm's logo/name instead of PrimeStride's (small "Powered by PrimeStride" footer).
- Proposal page (`?share=…&view=proposal` or a tab in the share view): cover (render + project name + client name +
  date), AI renders gallery, room list with areas (m² / 坪), finishes per style, quote summary (未稅/含稅), contact block.
  Print / PDF friendly (A4).

**Acceptance criteria**
- e2e: signed-in designer fills the firm profile → share link shows the logo and firm name; proposal page renders
  with renders, rooms and totals; print preview fits A4 portrait.
- RLS: another account cannot read or change the firm row; the share RPC returns only public firm fields.
- zh/en, phone layout.
