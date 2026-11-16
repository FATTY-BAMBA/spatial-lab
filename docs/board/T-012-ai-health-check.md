---
status: todo
priority: P1
owner: product-engineer
depends: []
---
# T-012 AI health check before a demo

**Found in.** T-007 pre-demo checklist ("Gemini/Anthropic quotas OK").

**Problem.** The only way to know the Gemini key can make images (billing on, not free tier) and the Anthropic key has
credit is to spend money on a real render/import. A free check would make the pre-demo checklist one click, and would
let the viewer hide or warn on ✦ buttons when renders cannot work.

**Scope.** `GET /api/health` (signed-in only): which keys are set, and a free call per provider (model list / token
count, no generation) to confirm the key is valid; never returns or logs the keys. A small status line on 我的專案 for
the owner account ("AI 效果圖：可用 / 未啟用"). Note: a valid Gemini key on the free tier still cannot make images;
check whether the API exposes that without generating, otherwise say so in the status.

**Acceptance criteria.** Unit test of the handler with stubbed fetch (keys missing / invalid / OK); no secret in the
response; e2e of the status line with the endpoint stubbed.
