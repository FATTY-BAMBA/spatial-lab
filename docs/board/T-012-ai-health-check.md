---
status: done
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

## What was built (branch `agent/T-012-ai-health-check`)

- **`api/health.js`** (Vercel function, signed-in via the Supabase session like `api/vision.js`):
  - `GET` — free check, both providers in parallel, 6 s timeout per call, cached 30 s per instance:
    Anthropic `GET /v1/models/{VISION_MODEL}` (401 bad key, 403 denied, 404 / `lifecycle: retired` → no model);
    Gemini `GET /v1beta/models/{id}` walking the same model order as `api/render.js` (404 → next model; 400
    `API_KEY_INVALID` → bad key; 403 → denied). No generation, no cost.
  - `POST` — **確認額度**: the free check, then one generation per provider capped at 1 output token, text only
    (Anthropic `messages` `max_tokens: 1`; Gemini `generateContent` `responseModalities: ['TEXT']`, `maxOutputTokens: 1`,
    no image in or out). Maps 402 / "credit balance" / spend limit → `no-credit`, Gemini 429 with the
    `generate_content_free_tier_requests` metric (the "limit 0" we saw) or 400 "enable billing" → `free-tier`, other 429
    → `quota`, 5xx/529 → `down`, an unrelated 400 → `unknown` (says nothing about billing). Rate limit: 1 per minute per
    account and 20 per hour per server instance (429 `slow-down` + `Retry-After`).
  - Answer: `{ checked_at, probe, vision: { code, model }, render: { code, model } }` — never a key, never the provider's
    error text (Google's can name the project number and quota ids). Keys go only in headers, never in URLs (logs).
- **`api/_models.js`**: the model ids (`VISION_MODEL` default, `RENDER_MODEL` + Gemini fallback list) in one place,
  now used by `api/vision.js`, `api/render.js` and `api/health.js` (behaviour of vision/render unchanged).
- **`src/ai-health.js`** (pure): `fetchHealth()` and `describe()` → summary, one row per service (zh/en), tone, and
  whether 確認額度 makes sense. Room naming failing is a warning (the editor falls back to rule-based names); renders
  failing is red.
- **我的專案** (`projects.html`): an **AI 服務狀態** panel, closed by default (no calls on a normal visit). Opens from the
  bottom link 「檢查 AI 服務狀態」 or automatically on `/projects?check` (also `#check`). Rows: AI 房間命名 / AI 效果圖, each
  with a dot (green confirmed, brass unconfirmed/temporary, red broken), the reason in designer words and the model id.
  Buttons: 重新檢查（免費） and 確認額度 (cost stated: 不到 NT$0.5). 360 px OK, zh + en.
- **`docs/demo.md`**: the NT$4 test render step is replaced by `/projects?check` → 確認額度, with what to do for each red
  answer; the NT$4 render stays only as the fallback when the answer is 「無法確認額度」. Day-of checklist re-runs the free check.
- `vercel.json`: `api/health.js` maxDuration 40 s.

## Decisions

- **No free way to see Gemini billing / free tier.** Model metadata and token counting succeed on a free-tier key; the
  tier is only visible in AI Studio (rate-limits page: "Navigate to the Projects page in AI Studio to check your tiers";
  no API is documented). Image models have **no free tier** ("Not available" on the pricing page), so a free-tier project
  gets 429 "limit: 0" on its first image call. Hence the opt-in 確認額度: one text-only, 1-token call to the same image
  model. Quota is per model, so a free-tier project still gets the free-tier 429; a billed one answers. Cost: input
  ≈ 10 tokens; output ≤ 1 token (+ any thinking, which `maxOutputTokens` should also cap) — worst case under NT$0.5
  at Gemini 3 Pro Image's $2 / $12 per M text tokens; Anthropic side < NT$0.01. Stated in the UI.
- **Anthropic credit is not visible for free either** (models / count_tokens are free and don't say), so 確認額度 also
  makes one `max_tokens: 1` call. Token counting was not used: it would add nothing over the models call.
- **Any signed-in account can open the panel**, not only the owner: there is no owner role, and adding an allow-list
  would need a new Vercel env var. The free check costs nothing and is cached; the paid confirm is rate-limited and capped
  per instance, so abuse costs at most a few NT cents per hour per instance. If wanted later: `HEALTH_EMAILS` allow-list.
- **Not done here** (to stay off `src/main.js`, which T-011 is editing): hiding / warning on the viewer's ✦ buttons from
  this status. Follow-up: call `GET /api/health` when the AI panel opens and show 「AI 效果圖目前無法使用」 for `no-key`,
  `bad-key`, `free-tier`, `no-credit`.
- **Assumption to verify once live** (needs real keys, so not done by the agent): that the Gemini image model accepts
  a text-only `responseModalities: ['TEXT']` request. If it answers 400 instead, the panel says 「無法確認額度：請產生一張
  效果圖測試」 (code `unknown`) — safe, but then the NT$4 render is still the confirmation.

## Tests

- `qa/unit/health.test.mjs` (fetch stubbed, never the real APIs): keys OK (free check makes only GET metadata calls;
  keys only in headers) · signed out / bad session → 401, no provider called · keys missing → `no-key`, no call · invalid
  keys (Anthropic 401, Gemini 400 `API_KEY_INVALID`) → `bad-key`; 403 → `denied` · model not found (404, retired) →
  `no-model`; Gemini falls through to the next model; `RENDER_MODEL` first · timeout → `timeout` in < 2 s; 529 / network →
  `down` · confirm: 1-token text-only bodies → `ready` · Gemini free-tier 429 (limit 0) and FAILED_PRECONDITION →
  `free-tier`; Anthropic "credit balance too low" and 402 → `no-credit`; plain 429 → `quota`; unrelated 400 → `unknown`
  · confirm rate limit per account + per-instance hourly cap; free check cached · every response checked for the key
  strings and Google's project/quota text · panel wording for every code in zh and en · `fetchHealth` GET/POST/401/429/404/offline.
- `qa/e2e.mjs` step 12 (`/api/health` stubbed): plain visit makes no call and the panel stays closed; `/projects?check`
  at 360 px → both 「金鑰有效」, Bearer token sent, 確認額度 POSTs → render row 「Google 專案是免費方案…開啟付費」, red,
  summary points to the backup project; no horizontal scroll; English + expired session → "Sign in again".

## Owner

- Nothing to set in Vercel: the function uses the existing `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` (and optional
  `VISION_MODEL` / `RENDER_MODEL`).
- After merge: open `/projects?check` signed in, press 確認額度 once (< NT$0.5). If it says 「Google 專案是免費方案」, turn
  on billing for the key's project in Google AI Studio and press it again.

## Sources

- Anthropic, Get a Model — `GET /v1/models/{model_id}`, returns `lifecycle` (active / deprecated / retired):
  https://platform.claude.com/docs/en/api/http/models/retrieve
- Anthropic, Token counting — "Token counting is free to use but subject to requests per minute rate limits":
  https://platform.claude.com/docs/build-with-claude/token-counting
- Anthropic, Errors — 400 (also spend limit), 401 authentication_error, 402 billing_error, 403, 404, 429 (also spend cap),
  500, 529 overloaded: https://platform.claude.com/docs/en/api/errors
- Gemini API, Models — `GET /v1beta/{name=models/*}`, `supportedGenerationMethods`: https://ai.google.dev/api/models
- Gemini API, Rate limits — tiers (Free: active project; Tier 1: linked billing account), check the tier in AI Studio:
  https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini API, Pricing — Gemini 3 Pro Image / 3.1 Flash Image / 2.5 Flash Image: Free Tier "Not available"; 3 Pro Image
  $2 input, $12 text output per M tokens: https://ai.google.dev/gemini-api/docs/pricing
- The free-tier image error (429 RESOURCE_EXHAUSTED, `generate_content_free_tier_requests`, quotaValue "0"):
  https://discuss.ai.google.dev/t/bug-paid-tier-1-account-getting-free-tier-requests-limit-0-on-image-generation-models-gemini-2-5-flash-image-gemini-3-pro-image-preview/123906

## Validation (validator, 2026-11-17)

**Verdict: ship.** Nothing blocking. Owner decision and follow-ups below. Not merged here (left to the orchestrator).

Evidence (6df1e9f, base d3d37ae):
- **Gate** `npm --prefix qa run all`: unit 66/66 (11 new in `health.test.mjs`), regress 51 fixtures "OK: no
  regressions" (import pipeline untouched, baseline unchanged, no baseline update), e2e 24/24 incl. step 12 (1.6 s).
- **Auth**: `signedInUser` sends the bearer to Supabase `GET /auth/v1/user`, which checks the JWT signature and session on
  the server. Having a header is not enough. A 401 comes before any provider call or cache read (unit test). `SB_ANON` is the public
  anon key that `vision.js` and `render.js` already use.
- **Secrets**: keys go only in the `x-api-key` / `x-goog-api-key` headers, never in a URL, a response or a log (no `console.*`).
  The response holds only `{code, model}` per provider. Provider error text is matched by regex and then dropped. Every
  unit response is checked for the key strings and Google project or quota text. The diff has no secrets, client data or plans.
- **Refactor**: `api/_models.js` returns the same `claude-sonnet-5-5` default and the same five Gemini ids in the same order,
  with `RENDER_MODEL`/`VISION_MODEL` first. `render.js` still builds `MODELS` at module load and `vision.js` still reads at request time.
  All three modules load under Node. The Vercel build succeeded for 6df1e9f, so the `_models.js` bundle is fine. `.vercelignore` does not exclude it.
- **Mapping vs docs**: the Anthropic Errors page confirms 401/402/403/404/429/5xx/529, and that a spend limit set by the account is 400 (caught by regex).
  Gemini `models.get` 404 makes the check try the next model, same as `render.js`. I could not reach the Anthropic retrieve page from here. The
  `lifecycle === 'retired'` check does no harm if the field is missing.
- **Tests exercise the change**: fetch is stubbed for every case, and the stub throws on any URL it doesn't know, so no real API is called.
  Removing any branch of the code mapping, the 1-token body, the rate limit or the cache makes a named assertion fail. The e2e step
  fails if the panel or the auto-open is removed.
- **Cost / abuse**: the probe is about 10 input tokens and at most 1 output token per provider (Gemini thinking counts toward
  `maxOutputTokens`), well under NT$0.01 in practice, so "不到 NT$0.5" is conservative. Limits are per instance, so parallel
  requests across instances or cold starts can get around them. Even so, any free Google account spends far less here than through the existing
  `/api/render` (NT$4 a call, no rate limit) or `/api/vision`. This adds no new kind of abuse.
- **UI** (local server, cloud and `/api/health` stubbed; the preview and live hosts are blocked by this sandbox's egress proxy):
  a plain `/projects` visit makes no call and the panel stays closed. Signed out plus `?check` makes no call. `?check` and `#check` open the panel.
  Checked zh and en at 1280 px and 360 px with ok/ok, ready/ready, no-key/bad-key, no-credit/unknown, ready/free-tier, down/timeout,
  500 and 404: no horizontal scroll and no page errors. The buttons are disabled while a request runs, so a double-click sends one POST.
  The copy is clear Traditional Chinese.
- **docs/demo.md**: correct. It replaces the NT$4 test render with `?check` → 確認額度, gives a fix for each red answer and keeps the NT$4
  render as the fallback for 無法確認額度.

**Owner decision**
- The task scope says "for the owner account", but the footer link 「檢查 AI 服務狀態」 shows for **every** signed-in designer.
  A client firm pressing 確認額度 would see 「Google 專案是免費方案…請到 Google AI Studio 開啟付費」 and the model ids, which is
  platform wording, not something a designer can act on. Options: keep it as is; show the panel only on `?check` (hide the footer
  link); or add a `HEALTH_EMAILS` allow-list (one new Vercel env var). Recommendation: hide the footer link now, and add the allow-list
  when paying firms come on.

**Follow-ups (non-blocking)**
1. Anthropic 429 for a usage tier's *monthly spend cap* maps to `quota` 「幾分鐘後再試」, but that error doesn't clear. If the message
   says spend cap, map it to `no-credit`.
2. After merge (needs real keys): confirm the Gemini image model answers a text-only `responseModalities: ['TEXT']` request. If it
   gives 400, the panel shows 無法確認額度 and the NT$4 render stays the check.
3. With 20 confirms an hour per instance, one account can block the confirm on that instance for up to 1 h (1 a minute × 20 min).
   The NT$4 render is the fallback. Accepted for now.
4. Separate task: rate-limit `/api/render` and `/api/vision` per account. Their spend exposure is bigger than this endpoint's.
5. Nit: the en summary "backup project’s" shows a gap before the curly apostrophe at 360 px (CJK font). Use a straight `'`.
6. Edge case: `render.js` also tries the next model on a 400 "not found|not supported|imageSize|imageConfig", but health
   tries it only on a 404 or when `generateContent` is missing. The two can report different models in that case only.

**Live check after merge (owner, signed in)**: open `/projects?check` and press 確認額度 once. Both rows should read 可用（已確認額度）.

## Shipped (2026-11-17)

Merged to `main` in db94728. Before merging (main session): the status link is hidden for designers and the panel opens
only from `/projects?check` (owner decision taken per AGENTS.md, e2e asserts it); an Anthropic workspace spend-cap
message maps to `no-credit` (unit test); straight apostrophe in the English free-tier text.

Live check (owner account, signed in, free GET only): `/projects?check` opens the panel; AI 房間命名 claude-sonnet-5-5 and
AI 效果圖 gemini-3-pro-image both 「金鑰有效，額度未確認」; footer link hidden. 確認額度 (paid, < NT$0.01) not pressed:
left to the owner. Open: validator follow-ups 3, 4 (rate-limit /api/render and /api/vision per account), 6.
