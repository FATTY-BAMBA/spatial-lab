---
status: todo
priority: P1
owner: product-engineer + viewer-engineer
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
