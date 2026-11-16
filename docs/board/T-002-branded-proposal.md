---
status: review
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

## Status (2026-11-16, product-engineer) — review

Branch `agent/T-002-branded-proposal`. Gate green locally (unit 22/22 · regress 33 fixtures, no regressions · e2e 10/10).

**Shipped**
- 我的專案 → **公司資料** dialog: 公司名稱 (required), Logo (PNG/JPG/WebP → resized in the browser to ≤ 600×240 PNG →
  bucket `spatial-logos/<uid>/`), 電話, LINE ID, Email, 地址, 統一編號 (MOF checksum incl. the 2023 ÷5 rule), 品牌色,
  live preview of the share bar and proposal masthead. A nudge on 我的專案 until a profile exists; `/projects#firm` opens it.
- Each project card: 業主名稱 (shown on the proposal cover) and a 提案書 link.
- Saved projects (`?id=`, `?share=`): firm logo + name in the top bar, "Powered by PrimeStride Spatial Lab" under the
  opening text, the lede names the firm for clients, a 提案書 button in the bar.
- **提案書** `proposal.html` (`/proposal?share=…`, `/proposal?id=…`; `/?share=…&view=proposal` redirects): cover (render,
  project, 業主, date, style, 室內坪), AI renders, plan drawings + room table (m² / 坪, interior and outdoor totals),
  style finishes, quote (finish lines, 家具暫估, 小計未稅, 營業稅 5%, 合計含稅), contact block, signature lines, 3D link.
  A4 portrait print (cover alone on page 1); 3 pages for both test plans (3-floor 透天 and the DXF flat). Style picker on screen (`&style=`).
- Pure modules with unit tests: `src/firm.js`, `src/proposal-doc.js` (`qa/unit/proposal.test.mjs`, 7 tests).
- e2e: firm saved (bad 統編 rejected first) → share bar shows logo + name → 提案書 numbers (ping = m²/3.3058,
  含稅 = 未稅 + 5%), PDF is A4 portrait 595×842 pt with 2–5 pages, nothing wider than the 186 mm print width,
  360 px without horizontal scroll, English labels, owner preview without a profile links to 公司資料.
  The share/proposal steps use the builtin DXF sample when no image fixture is present, so CI covers them.

**Database** — `supabase/migrations/20261116090000_spatial_firms.sql`: `spatial_firms` (owner PK → auth.users,
owner-only RLS on all four verbs, anon revoked, length/format checks, logo URL must be in our bucket),
`spatial_projects.client`, bucket `spatial-logos` (public read, 2 MB, png/jpeg/webp; writes only under the user's
uid folder), `spatial_shared(token)` dropped + recreated with `client` and `firm` (public fields only) and re-granted to
anon, authenticated, service_role. **Not applied yet**: the apply call was cancelled by the permission prompt in the
agent session. RLS check script: `supabase/tests/spatial_firms_rls.sql` (rolled-back transaction; run after applying).
Until applied, the site degrades safely: project lists/loads fall back to the old columns, the 業主 field is disabled,
the firm profile cannot be saved (toast), share links work unbranded.

**Decisions**
- Separate light, print-first page instead of a tab inside the 3D viewer: loads without three.js, prints cleanly.
- Brand colour only on the white proposal (rules, total, initials badge); the dark viewer keeps its own palette and
  shows the logo on a white plate so dark logos stay visible.
- Logo SVG not accepted (script risk on a public bucket); PNG keeps transparency.
- Quoted style defaults to the one with the most AI renders, so cover, gallery and price agree.
- Client wording: "本報價為初步估算，實際金額以正式報價單與現場丈量為準", the sample price book is still named in the
  basis line until T-003 brings the firm's own price list.
- Project type label is taken only from the project itself (completePlan fills gaps from the sample apartment, which
  would print "3房2廳2衛" on any imported home).

**Open**
- Apply the migration, run the RLS script, then a live check on the preview (save a profile, open a share link + 提案書).
- QR code to the 3D on the printed proposal (needs a small vendored QR lib) — follow-up.
- Viewer's old 方案比較 one-page print still carries PrimeStride branding (owner-side tool); align in a follow-up.

## Validation (2026-11-16, validator) — **blocked on migration approval**

- Merged origin/main (T-005, T-001, T-001b) into the branch; conflicts in `qa/e2e.mjs` (both suites kept) and the board.
- Gate on the merged branch: unit 47/47 · regress OK, no regressions · e2e 16/16 (T-002: 5/5 + the earlier steps;
  PDF 3 A4 pages, 未稅 NT$ 1,985,259 / 含稅 NT$ 2,084,522, 10 rooms). Tests would fail without the change (they assert
  the firm bar, the 提案書 DOM numbers, A4 MediaBox, 360 px width, English labels).
- SQL reviewed line by line against the live DB: only `spatial_*` objects + `spatial-logos` bucket/policies (names do not
  clash with `spatial renders *`); RLS on with four owner-only policies, anon revoked; `spatial_touch()` exists;
  `spatial_shared` keeps `security definer`, `search_path ''`, returns the current 4 columns (name, doc, renders,
  updated_at) + client + firm (whitelisted public fields, no owner id); grants match today's (anon, authenticated,
  service_role); additive, down block present. **Sound.**
- `apply_migration spatial_firms` was **cancelled at the confirmation prompt** — nothing ran; not retried.
  Not merged. To finish: apply the migration (owner approval), run `supabase/tests/spatial_firms_rls.sql`,
  `get_advisors security`, check `spatial_shared('<real token>')` still returns name/renders, then merge.

Non-blocking notes (follow-ups, not fixes for this merge):
- The client-facing quote basis line names the sample price book ("PrimeStride 示範價目表 v0") — fine until T-003.
- 公司資料 logo hint says "2 MB 以內" but files up to 8 MB are accepted (shrunk before upload); align the hint.
- `projects.html` preview puts `initials(name)` into innerHTML unescaped (own-profile only, self-XSS); escape it.

Owner decision: client wording 「本報價為初步估算，實際金額以正式報價單與現場丈量為準」 (sign-off).
