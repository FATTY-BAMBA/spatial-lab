// POST /api/vision — names the rooms of an imported plan picture.
// The editor sends the plan image with a numbered marker drawn in every detected room; Claude looks at the
// furniture symbols and any printed labels and says what each numbered room is, which one holds the stairs,
// and (when the drawing prints one) a room's real dimensions so the editor can fix the scale.
// Needs ANTHROPIC_API_KEY in the Vercel project settings; without it the editor falls back to rule-based names.

const TYPES = ['客廳', '餐廳', '客餐廳', '廚房', '餐廚', '主臥', '臥室', '書房', '和室', '衛浴', '主浴', '玄關', '樓梯', '走道', '陽台', '後陽台', '儲藏室', '更衣室', '車庫', '庭院', '其他'];
const EN = { 客廳: 'Living', 餐廳: 'Dining', 客餐廳: 'Living & Dining', 廚房: 'Kitchen', 餐廚: 'Kitchen & Dining', 主臥: 'Master Bedroom', 臥室: 'Bedroom', 書房: 'Study', 和室: 'Tatami Room', 衛浴: 'Bathroom', 主浴: 'Master Bath', 玄關: 'Entrance', 樓梯: 'Stairs', 走道: 'Hall', 陽台: 'Balcony', 後陽台: 'Service Balcony', 儲藏室: 'Storage', 更衣室: 'Walk-in Closet', 車庫: 'Garage', 庭院: 'Yard', 其他: 'Room' };

const PROMPT = (n, floors) => `This is an architectural floor plan picture (often a Taiwan real-estate 格局圖${floors > 1 ? `, with ${floors} floors drawn side by side, left to right = 1F, 2F…` : ''}).
Numbered white circles (1–${n}) mark the rooms our software detected. For EACH number, decide what the room is, using printed room labels if any, otherwise the furniture and fixture symbols inside it (bed → bedroom, toilet/bathtub/shower/basin → bathroom, sofa/TV → living, dining table → dining, stove/sink counter → kitchen, stair treads → stairs, car → garage, washing machine outdoors → service balcony, plants/railings outside the main walls → balcony).
Use exactly one of these types: ${TYPES.join('、')}.
Rules: the bedroom with its own bathroom or the largest bed is 主臥 (at most one per floor); a bathroom reached only from 主臥 is 主浴; if a space mixes sofa and dining table use 客餐廳; if kitchen and dining table share a space use 餐廚; use 樓梯 only when the room is mainly a staircase or stair hall; if a larger open space also has living, dining or kitchen furniture, name it by that main use and set "stairs": true.
If the drawing prints the size of any numbered room (like "3.2 x 4.1", "320×410", or metres next to a label), report ONE such room as scale: {"n": number, "w": metres left-to-right, "d": metres top-to-bottom}; otherwise scale is null. Do not guess sizes.
Answer with JSON only, no prose:
{"rooms":[{"n":1,"type":"客廳","label":"<printed label if any, else empty>","stairs":false}],"scale":null}`;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'no-key' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); } }
  const { image, count, floors = 1 } = body || {};
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image || '');
  if (!m || !(count > 0 && count <= 80)) return res.status(400).json({ error: 'need image (data URL) and count' });
  if (m[2].length > 4_000_000) return res.status(413).json({ error: 'image too large' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.VISION_MODEL || 'claude-sonnet-5-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
          { type: 'text', text: PROMPT(count, floors) },
        ] }],
      }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'upstream', detail: j && j.error ? j.error.message : r.status });
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const json = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0]);
    const rooms = (json.rooms || []).filter(x => Number.isInteger(x.n) && x.n >= 1 && x.n <= count && TYPES.includes(x.type))
      .map(x => ({ n: x.n, type: x.type, name: x.type, nameEn: EN[x.type], label: typeof x.label === 'string' ? x.label.slice(0, 16) : '', stairs: x.type === '樓梯' || x.stairs === true }));
    const sc = json.scale && Number.isInteger(json.scale.n) && json.scale.w > 0.5 && json.scale.w < 30 && json.scale.d > 0.5 && json.scale.d < 30 ? { n: json.scale.n, w: +json.scale.w, d: +json.scale.d } : null;
    return res.status(200).json({ rooms, scale: sc, usage: j.usage || null });
  } catch (e) {
    return res.status(500).json({ error: 'failed', detail: String(e).slice(0, 200) });
  }
};
