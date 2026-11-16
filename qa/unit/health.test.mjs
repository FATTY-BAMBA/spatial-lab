// AI health check (T-012): /api/health maps every provider answer to a short code with fetch stubbed — keys missing,
// invalid, model not found, Gemini free tier ("limit 0"), Anthropic out of credit, timeouts, 5xx — never calls a real
// API, never returns a key or the provider's own error text; the free check makes no generation call; the paid confirm
// is rate-limited. Then the zh/en wording the 我的專案 panel shows for those codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { REPO } from '../lib/node-env.mjs';
const require = createRequire(import.meta.url);
const handler = require(join(REPO, 'api/health.js'));
const H = await import(join(REPO, 'src/ai-health.js'));

const AKEY = 'fake-anthropic-SECRET-aaaa', GKEY = 'fake-gemini-SECRET-gggg'; // not real keys
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const hang = (url, init) => new Promise((_, no) => init.signal.addEventListener('abort', () => no(init.signal.reason)));
const GEM_FREE_TIER = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3-pro-image (project 123456789)', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateContentRequestsPerModelPerMinutePerProjectPerRegion', quotaValue: '0' }] }] } };
const GEM_BAD_KEY = { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } };
const ANT_OK_MODEL = { type: 'model', id: 'claude-sonnet-5-5', lifecycle: 'active' };

// routes: { anthropicModel, anthropicMsg, gemini: { [model]: resp }, geminiGen, user } — each a response or a fn
function stub(routes = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url); calls.push({ url, init });
    const pick = r => (typeof r === 'function' ? r(url, init) : r);
    if (url.includes('supabase.co/auth/v1/user')) return pick(routes.user ?? json(200, { id: 'u1' }));
    if (url.startsWith('https://api.anthropic.com/v1/models/')) return pick(routes.anthropicModel ?? json(200, ANT_OK_MODEL));
    if (url === 'https://api.anthropic.com/v1/messages') return pick(routes.anthropicMsg ?? json(200, { content: [{ type: 'text', text: 'OK' }] }));
    const g = /generativelanguage\.googleapis\.com\/v1beta\/models\/([^:?]+)(:generateContent)?/.exec(url);
    if (g && g[2]) return pick(routes.geminiGen ?? json(200, { candidates: [{ content: { parts: [{ text: 'OK' }] } }] }));
    if (g) { const m = decodeURIComponent(g[1]); const r = routes.gemini && (m in routes.gemini ? routes.gemini[m] : routes.gemini['*']); return pick(r ?? json(200, { name: `models/${m}`, supportedGenerationMethods: ['generateContent'] })); }
    throw new Error(`unexpected fetch ${url}`);
  };
  return calls;
}
async function call({ method = 'GET', auth = 'Bearer user-token', env = { ANTHROPIC_API_KEY: AKEY, GEMINI_API_KEY: GKEY } } = {}) {
  for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'VISION_MODEL', 'RENDER_MODEL']) delete process.env[k];
  Object.assign(process.env, env);
  const res = { statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method, headers: auth ? { authorization: auth } : {} }, res);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('SECRET'), 'a key leaked into the response');
  assert.ok(!/project 123456789|quotaId|billing details/.test(text), 'provider error text leaked into the response');
  return res;
}
const realFetch = globalThis.fetch;
test.beforeEach(() => { handler._test.reset(); Object.assign(handler._test.T, { timeoutMs: 40, probeTimeoutMs: 40, cacheMs: 0, perUserMs: 60000, perHour: 20 }); });
test.after(() => { globalThis.fetch = realFetch; });

test('both keys valid: free check says ok, uses only metadata endpoints, keys only in headers', async () => {
  const calls = stub();
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual([res.body.vision.code, res.body.render.code], ['ok', 'ok']);
  assert.equal(res.body.vision.model, 'claude-sonnet-5-5');
  assert.equal(res.body.render.model, 'gemini-3-pro-image');
  assert.equal(res.body.probe, false);
  const up = calls.filter(c => !c.url.includes('supabase'));
  assert.ok(up.every(c => (c.init.method || 'GET') === 'GET'), 'free check made a POST');
  assert.ok(up.every(c => !/messages$|generateContent/.test(c.url)), 'free check called a generation endpoint');
  assert.ok(up.every(c => !/SECRET/.test(c.url)), 'key in a URL (would end up in logs)');
  assert.equal(up.find(c => c.url.includes('anthropic')).init.headers['x-api-key'], AKEY);
  assert.equal(up.find(c => c.url.includes('googleapis')).init.headers['x-goog-api-key'], GKEY);
});

test('signed out / bad session: 401 and no provider is called', async () => {
  let calls = stub();
  assert.equal((await call({ auth: '' })).statusCode, 401);
  calls = stub({ user: json(401, { msg: 'bad jwt' }) });
  assert.equal((await call()).statusCode, 401);
  assert.ok(calls.every(c => c.url.includes('supabase')));
  stub();
  assert.equal((await call({ method: 'DELETE' })).statusCode, 405);
});

test('missing keys: no-key for both, no provider call', async () => {
  const calls = stub();
  const res = await call({ env: {} });
  assert.deepEqual([res.body.vision.code, res.body.render.code], ['no-key', 'no-key']);
  assert.ok(calls.every(c => c.url.includes('supabase')));
});

test('invalid keys: Anthropic 401 and Gemini 400 API_KEY_INVALID → bad-key; 403 restricted key → denied', async () => {
  stub({ anthropicModel: json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), gemini: { '*': json(400, GEM_BAD_KEY) } });
  let res = await call();
  assert.deepEqual([res.body.vision.code, res.body.render.code], ['bad-key', 'bad-key']);
  stub({ anthropicModel: json(403, { error: { type: 'permission_error', message: 'no' } }), gemini: { '*': json(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Requests to this API method are blocked.' } }) } });
  res = await call();
  assert.deepEqual([res.body.vision.code, res.body.render.code], ['denied', 'denied']);
});

test('model not found: Anthropic 404 or retired → no-model; Gemini falls through to the next model like api/render.js', async () => {
  stub({ anthropicModel: json(404, { error: { type: 'not_found_error', message: 'model: claude-x' } }), gemini: { 'gemini-3-pro-image': json(404, { error: { code: 404, status: 'NOT_FOUND' } }) } });
  let res = await call({ env: { ANTHROPIC_API_KEY: AKEY, GEMINI_API_KEY: GKEY, VISION_MODEL: 'claude-x' } });
  assert.equal(res.body.vision.code, 'no-model'); assert.equal(res.body.vision.model, 'claude-x');
  assert.equal(res.body.render.code, 'ok'); assert.equal(res.body.render.model, 'gemini-3-pro-image-preview');
  stub({ anthropicModel: json(200, { ...ANT_OK_MODEL, lifecycle: 'retired' }), gemini: { '*': json(404, { error: { code: 404 } }) } });
  res = await call();
  assert.deepEqual([res.body.vision.code, res.body.render.code], ['no-model', 'no-model']);
  // RENDER_MODEL is tried first
  const calls = stub();
  res = await call({ env: { ANTHROPIC_API_KEY: AKEY, GEMINI_API_KEY: GKEY, RENDER_MODEL: 'my-image-model' } });
  assert.equal(res.body.render.model, 'my-image-model');
  assert.ok(calls.some(c => c.url.endsWith('/models/my-image-model')));
});

test('timeouts and outages: timeout / down, the check still answers', async () => {
  stub({ anthropicModel: hang, gemini: { '*': hang } });
  const t0 = Date.now();
  let res = await call();
  assert.deepEqual([res.body.vision.code, res.body.render.code], ['timeout', 'timeout']);
  assert.ok(Date.now() - t0 < 2000);
  stub({ anthropicModel: json(529, { error: { type: 'overloaded_error' } }), gemini: { '*': () => { throw new TypeError('fetch failed'); } } });
  res = await call();
  assert.deepEqual([res.body.vision.code, res.body.render.code], ['down', 'down']);
});

test('confirm (POST): 1-token text-only calls; ok → ready', async () => {
  const calls = stub();
  const res = await call({ method: 'POST' });
  assert.deepEqual([res.body.vision.code, res.body.render.code], ['ready', 'ready']);
  assert.equal(res.body.probe, true);
  const a = JSON.parse(calls.find(c => c.url.endsWith('/v1/messages')).init.body);
  assert.equal(a.max_tokens, 1); assert.equal(a.model, 'claude-sonnet-5-5');
  const g = JSON.parse(calls.find(c => c.url.includes(':generateContent')).init.body);
  assert.equal(g.generationConfig.maxOutputTokens, 1);
  assert.deepEqual(g.generationConfig.responseModalities, ['TEXT']);
  assert.ok(!JSON.stringify(g).includes('inlineData'));
});

test('confirm: Gemini free tier (429 limit 0) → free-tier; Anthropic low balance → no-credit; plain 429 → quota', async () => {
  stub({ geminiGen: json(429, GEM_FREE_TIER), anthropicMsg: json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }) });
  let res = await call({ method: 'POST' });
  assert.deepEqual([res.body.vision.code, res.body.render.code], ['no-credit', 'free-tier']);
  handler._test.reset();
  stub({ geminiGen: json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted (e.g. check quota).' } }), anthropicMsg: json(402, { error: { type: 'billing_error', message: 'x' } }) });
  res = await call({ method: 'POST' });
  assert.deepEqual([res.body.vision.code, res.body.render.code], ['no-credit', 'quota']);
  handler._test.reset();
  // FAILED_PRECONDITION: the free tier is not offered here → billing needed
  stub({ geminiGen: json(400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio.' } }), anthropicMsg: json(400, { error: { type: 'invalid_request_error', message: 'max_tokens: something unrelated' } }) });
  res = await call({ method: 'POST' });
  assert.deepEqual([res.body.vision.code, res.body.render.code], ['unknown', 'free-tier']);
});

test('confirm is rate-limited per account; the free check is not and is cached', async () => {
  let calls = stub();
  assert.equal((await call({ method: 'POST' })).statusCode, 200);
  const again = await call({ method: 'POST' });
  assert.equal(again.statusCode, 429); assert.equal(again.body.error, 'slow-down'); assert.ok(+again.headers['retry-after'] > 0);
  stub({ user: json(200, { id: 'u2' }) });
  assert.equal((await call({ method: 'POST' })).statusCode, 200, 'another account is not blocked');
  handler._test.reset(); handler._test.T.perHour = 1;
  stub({ user: json(200, { id: 'u3' }) }); await call({ method: 'POST' });
  stub({ user: json(200, { id: 'u4' }) });
  assert.equal((await call({ method: 'POST' })).statusCode, 429, 'instance-wide hourly cap');
  handler._test.reset(); handler._test.T.cacheMs = 60000;
  const up = c => !c.url.includes('supabase');
  calls = stub(); await call(); const n = calls.filter(up).length; await call();
  assert.ok(n > 0); assert.equal(calls.filter(up).length, n, 'second free check within the cache window hit the providers');
});

// ---------- wording on 我的專案 ----------
const zh = (a) => a, en = (a, b) => b;
const ok = (vision, render, probe = false) => ({ status: 'ok', data: { vision: { code: vision, model: 'claude-sonnet-5-5' }, render: { code: render, model: 'gemini-3-pro-image' }, probe } });

test('panel wording: ready, keys valid, free tier, missing key, errors (zh + en)', async () => {
  let v = H.describe(ok('ready', 'ready', true), zh);
  assert.equal(v.tone, 'ok'); assert.match(v.summary, /可以示範/); assert.equal(v.canProbe, false);
  assert.match(v.rows[1].text, /可用/); assert.equal(v.rows[1].model, 'gemini-3-pro-image');
  v = H.describe(ok('ok', 'ok'), zh);
  assert.equal(v.tone, 'warn'); assert.match(v.summary, /確認額度/); assert.equal(v.canProbe, true);
  v = H.describe(ok('ready', 'free-tier', true), zh);
  assert.equal(v.tone, 'bad'); assert.match(v.rows[1].text, /免費方案.*開啟付費/); assert.match(v.summary, /備用專案/);
  v = H.describe(ok('no-key', 'no-key'), zh);
  assert.equal(v.rows[0].tone, 'warn', 'room naming falls back to rule-based names: a warning'); assert.equal(v.rows[1].tone, 'bad');
  assert.match(v.rows[1].text, /未啟用/); assert.equal(v.canProbe, false);
  v = H.describe(ok('ok', 'free-tier', true), en);
  assert.match(v.rows[1].text, /free tier.*billing/); assert.match(v.rows[0].text, /Key valid/);
  for (const [st, re] of [['signed-out', /登入/], ['slow-down', /秒後/], ['offline', /網路/], ['missing', /正式站/], ['error', /失敗/]]) {
    v = H.describe({ status: st, retry: 42 }, zh); assert.match(v.summary, re, st); assert.equal(v.rows.length, 0);
  }
  for (const c of ['ok', 'ready', 'no-key', 'bad-key', 'denied', 'no-model', 'no-credit', 'free-tier', 'quota', 'timeout', 'down', 'unknown', 'error']) {
    const r = H.describe(ok(c, c), en).rows[1]; assert.ok(r.text && !/[一-鿿]/.test(r.text), `en text for ${c}`);
    assert.ok(/[一-鿿]/.test(H.describe(ok(c, c), zh).rows[1].text), `zh text for ${c}`);
  }
});

test('fetchHealth: GET for the check, POST for confirm, maps 401 / 429 / 404 / network', async () => {
  const seen = [];
  const f = status => async (url, init) => { seen.push([url, init.method, init.headers.authorization]); return json(status, status === 429 ? { retry_after: 33 } : ok('ok', 'ok').data); };
  assert.equal((await H.fetchHealth({ token: 'tk', fetchImpl: f(200) })).status, 'ok');
  assert.deepEqual(seen[0], ['/api/health', 'GET', 'Bearer tk']);
  await H.fetchHealth({ token: 'tk', probe: true, fetchImpl: f(200) }); assert.equal(seen[1][1], 'POST');
  assert.deepEqual(await H.fetchHealth({ token: 'tk', fetchImpl: f(429) }), { status: 'slow-down', retry: 33 });
  assert.equal((await H.fetchHealth({ token: 'tk', fetchImpl: f(401) })).status, 'signed-out');
  assert.equal((await H.fetchHealth({ token: 'tk', fetchImpl: f(404) })).status, 'missing');
  assert.equal((await H.fetchHealth({ token: 'tk', fetchImpl: f(500) })).status, 'error');
  assert.equal((await H.fetchHealth({ token: 'tk', fetchImpl: async () => { throw new TypeError('offline'); } })).status, 'offline');
  assert.equal((await H.fetchHealth({ token: null, fetchImpl: f(200) })).status, 'signed-out');
});
