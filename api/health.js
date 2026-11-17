// /api/health — can AI room naming (Anthropic) and AI renders (Gemini) work right now? For the pre-demo checklist.
//   GET  free check: is each key set, valid, and can it see the configured model (model metadata calls, no generation).
//   POST the same, then one tiny generation per provider (1 output token, text only, no image) — the only way to see
//        an empty Anthropic balance or a Gemini project on the free tier (image models have no free tier: "limit: 0").
//        Costs under NT$0.5; limited to one per minute per account and 20 per hour per server instance.
// Signed-in designers only. The answer holds only a short code and the model id per provider: never a key, never the
// provider's own error text (it can name the Google project or quota ids).
// Docs: docs/board/T-012-ai-health-check.md (sources).
const { visionModel, renderModels } = require('./_models');

const SB_URL = 'https://mhzdimntfcovzffidfxf.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oemRpbW50ZmNvdnpmZmlkZnhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0Nzg1NDMsImV4cCI6MjEwNDA1NDU0M30.pt2K5dTdLJIg8e2VSgQSsfl9Fh18v4EWSZuVs9AnADM';
const ANTHROPIC = 'https://api.anthropic.com/v1';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

// tunables (tests shorten them)
const T = { timeoutMs: 6000, probeTimeoutMs: 20000, cacheMs: 30000, perUserMs: 60000, perHour: 20 };
let cache = null; const lastProbe = new Map(); let probes = [];

async function signedInUser(req) {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers && req.headers.authorization) || '');
  if (!m) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, authorization: `Bearer ${m[1]}` }, signal: AbortSignal.timeout(T.timeoutMs) });
    if (!r.ok) return null;
    const u = await r.json(); return u && u.id ? u : null;
  } catch { return null; }
}

// one upstream call → { status, j } or { err: 'timeout' | 'down' }
async function call(url, init, ms) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j: j || {} };
  } catch (e) {
    return { err: ac.signal.aborted ? 'timeout' : 'down' };
  } finally { clearTimeout(timer); }
}

// Codes (the viewer maps them to zh/en words in src/ai-health.js):
//   ok        key valid, model reachable (free check; balance / billing not yet confirmed)
//   ready     a 1-token generation went through: credit / billing confirmed
//   no-key    the env var is not set          bad-key   invalid, revoked, expired or leaked key
//   denied    key lacks permission (API restrictions, disabled API)   no-model  configured model missing or retired
//   no-credit Anthropic balance empty / spend limit / billing error   free-tier Gemini project without billing
//   quota     rate limit for now              timeout / down   no answer / provider unreachable or 5xx
//   unknown   the probe failed for a reason that says nothing about billing   error  anything else
function anthropicCode(r) {
  if (r.err) return r.err;
  const s = r.status, msg = String((r.j.error && r.j.error.message) || '');
  if (s >= 200 && s < 300) return 'ok';
  if (s === 401) return 'bad-key';
  if (s === 402 || /credit balance|spend (limit|cap)|billing|usage limits?|regain access/i.test(msg)) return 'no-credit'; // incl. workspace spend cap (400/429 "…API usage limits. You will regain access on …")
  if (s === 403) return 'denied';
  if (s === 404) return 'no-model';
  if (s === 429) return 'quota';
  if (s >= 500) return 'down';
  return 'error';
}
function geminiCode(r) {
  if (r.err) return r.err;
  const s = r.status, txt = JSON.stringify(r.j.error || {});
  if (s >= 200 && s < 300) return 'ok';
  if (/API_KEY_INVALID|API key not valid|API_KEY_EXPIRED|API key expired|reported as leaked/i.test(txt)) return 'bad-key';
  if (s === 429) return /free_?tier/i.test(txt) ? 'free-tier' : 'quota';
  if (s === 400 && /billing|free tier/i.test(txt)) return 'free-tier'; // FAILED_PRECONDITION: free tier not offered → enable billing
  if (s === 403) return 'denied';
  if (s === 404) return 'no-model';
  if (s >= 500) return 'down';
  return 'error';
}
const probeCode = c => (c === 'ok' ? 'ready' : c === 'error' || c === 'no-model' ? 'unknown' : c);

async function checkVision(key, probe) {
  const model = visionModel();
  if (!key) return { code: 'no-key', model };
  const h = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  // GET /v1/models/{id}: free; 401 bad key, 404 unknown model, lifecycle "retired" = calls would fail
  const r = await call(`${ANTHROPIC}/models/${encodeURIComponent(model)}`, { headers: h }, T.timeoutMs);
  let code = anthropicCode(r);
  if (code === 'ok' && r.j.lifecycle === 'retired') code = 'no-model';
  if (code !== 'ok' || !probe) return { code, model };
  const p = await call(`${ANTHROPIC}/messages`, {
    method: 'POST', headers: { ...h, 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'Reply OK' }] }),
  }, T.probeTimeoutMs);
  return { code: probeCode(anthropicCode(p)), model };
}

async function checkRender(key, probe) {
  const models = renderModels();
  if (!key) return { code: 'no-key', model: models[0] };
  // same order as api/render.js: the first model this key can see is the one renders will use
  for (const model of models) {
    // GET models/{id}: free model metadata; 400 API_KEY_INVALID, 403 restricted key, 404 unknown model
    const r = await call(`${GEMINI}/models/${encodeURIComponent(model)}`, { headers: { 'x-goog-api-key': key } }, T.timeoutMs);
    const code = geminiCode(r);
    const gen = r.j && r.j.supportedGenerationMethods;
    if (code === 'no-model' || (code === 'ok' && Array.isArray(gen) && !gen.includes('generateContent'))) continue;
    if (code !== 'ok' || !probe) return { code, model };
    // text only, at most 1 output token: no image is made; a free-tier project still gets the image model's
    // free-tier 429 (limit 0), a billed one answers
    const p = await call(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the word OK.' }] }], generationConfig: { responseModalities: ['TEXT'], maxOutputTokens: 1 } }),
    }, T.probeTimeoutMs);
    return { code: probeCode(geminiCode(p)), model };
  }
  return { code: 'no-model', model: models[0] };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });
  const user = await signedInUser(req);
  if (!user) return res.status(401).json({ error: 'sign-in required' });
  const probe = req.method === 'POST', now = Date.now();
  if (probe) {
    probes = probes.filter(x => now - x < 3600e3);
    for (const [id, x] of lastProbe) if (now - x >= T.perUserMs) lastProbe.delete(id);
    const mine = lastProbe.get(user.id);
    if (mine || probes.length >= T.perHour) {
      const wait = Math.ceil((mine ? T.perUserMs - (now - mine) : 3600e3 - (now - probes[0])) / 1000);
      res.setHeader('Retry-After', String(wait));
      return res.status(429).json({ error: 'slow-down', retry_after: wait });
    }
    lastProbe.set(user.id, now); probes.push(now);
  } else if (cache && now - cache.at < T.cacheMs) return res.status(200).json(cache.body);
  const [vision, render] = await Promise.all([checkVision(process.env.ANTHROPIC_API_KEY, probe), checkRender(process.env.GEMINI_API_KEY, probe)]);
  const body = { checked_at: new Date(now).toISOString(), probe, vision, render };
  if (!probe) cache = { at: now, body };
  return res.status(200).json(body);
}

module.exports = handler;
// for qa/unit/health.test.mjs only
module.exports._test = { T, reset() { cache = null; lastProbe.clear(); probes = []; } };
