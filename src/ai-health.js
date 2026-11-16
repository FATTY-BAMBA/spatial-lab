// AI 服務狀態 (T-012): asks /api/health whether AI room naming (Anthropic) and AI renders (Gemini) can work, and puts
// the answer in words a designer can act on before a demo. Pure apart from fetch, so qa/unit can test the wording.

/** GET = free check; probe = one tiny real call per provider (confirms credit / billing, under NT$0.5). */
export async function fetchHealth({ token, probe = false, fetchImpl = globalThis.fetch } = {}) {
  if (!token) return { status: 'signed-out' };
  let r;
  try {
    r = await fetchImpl('/api/health', { method: probe ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(45000) });
  } catch { return { status: 'offline' }; }
  if (r.status === 401) return { status: 'signed-out' };
  if (r.status === 429) { const j = await r.json().catch(() => ({})); return { status: 'slow-down', retry: +j.retry_after || 60 }; }
  if (r.status === 404) return { status: 'missing' }; // not deployed (local static server)
  if (!r.ok) return { status: 'error' };
  const data = await r.json().catch(() => null);
  return data && data.vision && data.render ? { status: 'ok', data } : { status: 'error' };
}

const GOOD = ['ok', 'ready'];
// [tone, zh, en] per code and provider (vision = AI 房間命名, render = AI 效果圖)
function words(code, which, t) {
  const W = {
    ready: ['ok', '可用（已確認額度）', 'Ready (credit confirmed)'],
    ok: ['warn', '金鑰有效，額度未確認', 'Key valid, credit not confirmed'],
    'no-key': ['bad', '未啟用：伺服器沒有設定金鑰', 'Off: no key on the server'],
    'bad-key': ['bad', '金鑰無效、過期或已撤銷', 'Key invalid, expired or revoked'],
    denied: ['bad', '金鑰沒有權限（請檢查金鑰的 API 限制）', 'Key not allowed (check its API restrictions)'],
    'no-model': ['bad', '找不到設定的 AI 模型', 'The configured AI model is not available'],
    'no-credit': ['bad', '餘額不足或已達支出上限', 'Out of credit or spend limit reached'],
    'free-tier': ['bad', 'Google 專案是免費方案，不能出圖：請到 Google AI Studio 開啟付費', 'The Google project is on the free tier and cannot make images: turn on billing in Google AI Studio'],
    quota: ['warn', '暫時達到使用上限，幾分鐘後再試', 'Rate limit reached; try again in a few minutes'],
    timeout: ['warn', '沒有回應（逾時），稍後再檢查一次', 'No answer (timed out); check again shortly'],
    down: ['warn', 'AI 服務暫時連不上', 'The AI service is unreachable right now'],
    unknown: ['warn', '金鑰有效，但無法確認額度：請產生一張效果圖測試', 'Key valid, but credit could not be confirmed: make one render to test'],
  };
  const w = W[code] || ['bad', '檢查失敗', 'Check failed'];
  // room naming falls back to rule-based names, so a dead Anthropic key is a warning, not a stop
  const tone = which === 'vision' && w[0] === 'bad' ? 'warn' : w[0];
  return { tone, text: t(w[1], w[2]) };
}

/** The status panel's content: summary line, one row per service, and whether the paid confirm button makes sense. */
export function describe(res, t) {
  if (!res || res.status !== 'ok') {
    const M = {
      'signed-out': ['warn', '請重新登入後再檢查', 'Sign in again to check'],
      'slow-down': ['warn', `剛剛確認過了，請 ${res && res.retry || 60} 秒後再試`, `Just checked; try again in ${res && res.retry || 60} s`],
      offline: ['warn', '連不到伺服器，請確認網路', 'Cannot reach the server; check the network'],
      missing: ['warn', '這個網址沒有檢查功能（請在正式站檢查）', 'No check on this address (use the live site)'],
    };
    const m = M[res && res.status] || ['bad', '檢查失敗，請稍後再試', 'The check failed; try again shortly'];
    return { tone: m[0], summary: t(m[1], m[2]), rows: [], canProbe: false };
  }
  const { vision, render, probe } = res.data;
  const rows = [
    { id: 'vision', label: t('AI 房間命名', 'AI room naming'), model: vision.model || '', ...words(vision.code, 'vision', t) },
    { id: 'render', label: t('AI 效果圖', 'AI renders'), model: render.model || '', ...words(render.code, 'render', t) },
  ];
  const ready = vision.code === 'ready' && render.code === 'ready';
  const keysOk = GOOD.includes(vision.code) && GOOD.includes(render.code);
  const tone = ready ? 'ok' : rows.some(r => r.tone === 'bad') ? 'bad' : 'warn';
  const summary = ready ? t('可以示範：AI 命名與效果圖都已確認可用。', 'Ready to demo: AI naming and renders both confirmed.')
    : keysOk && !probe ? t('兩把金鑰都有效。按「確認額度」實際試一次，才知道餘額與付費是否正常。', 'Both keys are valid. Press “Confirm credit” to try one real call and confirm credit and billing.')
    : render.code === 'free-tier' ? t('效果圖無法使用：示範時請改用備用專案已做好的效果圖。', 'Renders will not work: use the backup project’s renders in the demo.')
    : tone === 'bad' ? t('有 AI 服務無法使用，請看下方原因。', 'An AI service is not working; see below.')
    : t('部分項目未確認，請看下方說明。', 'Some items are not confirmed; see below.');
  // the paid confirm makes sense once a key looks valid and is not yet confirmed
  const canProbe = [vision, render].some(x => x.code === 'ok' || x.code === 'unknown' || x.code === 'quota' || x.code === 'timeout' || x.code === 'down');
  return { tone, summary, rows, canProbe };
}
