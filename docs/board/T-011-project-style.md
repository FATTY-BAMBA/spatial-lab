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
