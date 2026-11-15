// POST /api/render — a photoreal render of the designer's current 3D view.
// The viewer sends the frame it just drew (walls, openings, furniture, finishes of the chosen style). Google's
// Nano Banana Pro re-lights and re-materials that exact frame, keeping the camera and every object in place.
// Both images go to Supabase Storage under the designer's own folder (their session token does the upload, so
// storage policies apply); the viewer then adds the render to the project.
// Needs GEMINI_API_KEY in the Vercel project settings.

const SB_URL = 'https://mhzdimntfcovzffidfxf.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oemRpbW50ZmNvdnpmZmlkZnhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0Nzg1NDMsImV4cCI6MjEwNDA1NDU0M30.pt2K5dTdLJIg8e2VSgQSsfl9Fh18v4EWSZuVs9AnADM';
const BUCKET = 'spatial-renders';
// newest first; the first one this key can use is remembered for the life of the function instance
const MODELS = [process.env.RENDER_MODEL, 'gemini-3-pro-image', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'].filter(Boolean);
let goodModel = null;

const PROMPT = ({ room, style, styleDesc, outdoor }) => `This image is a real-time 3D render of ${outdoor ? 'an outdoor space of a home' : 'a room in a Taiwan home'}${room ? ` (${room})` : ''}, made by interior-design software from the actual floor plan.
Turn it into a high-end, photorealistic architectural interior photograph of the SAME scene.
Strict rules — this is a design proposal, so the geometry is a contract:
- Keep exactly the same camera position, lens and framing; the same perspective lines.
- Keep every wall, ceiling, floor edge, door, window and opening exactly where it is, same size and shape.
- Keep every piece of furniture and every fixture exactly where it is, same size, shape and orientation. Do not add, remove, move or resize furniture, walls or openings. Do not add rooms or extra windows.
- Keep the colours and materials of the design${style ? ` ("${style}"${styleDesc ? `: ${styleDesc}` : ''})` : ''}, rendered as real materials: real wood grain, stone, fabric, paint, metal.
Improve only realism: physically correct soft daylight through the existing windows, gentle global illumination, contact shadows, subtle reflections, believable textures, small styling details on existing surfaces (a few books, a plant only where there is clearly space).
No people, no text, no logos, no watermark, no borders.`;

async function signedInUser(token) {
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json(); return u && u.id ? u : null;
  } catch { return null; }
}
async function ownsProject(token, id) {
  const r = await fetch(`${SB_URL}/rest/v1/spatial_projects?id=eq.${encodeURIComponent(id)}&select=id,renders`, { headers: { apikey: SB_ANON, authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const rows = await r.json(); return rows && rows[0] ? rows[0] : null;
}
async function upload(token, path, buf, type) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST', headers: { apikey: SB_ANON, authorization: `Bearer ${token}`, 'content-type': type, 'x-upsert': 'true', 'cache-control': '31536000' }, body: buf,
  });
  if (!r.ok) throw new Error(`storage ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return `${SB_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}
async function gemini(key, model, b64, mime, text) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } },
    }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'no-key' });
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || ''); const token = m && m[1];
  const user = token && (await signedInUser(token));
  if (!user) return res.status(401).json({ error: 'sign-in required' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); } }
  const { image, project, room = '', style = '', styleDesc = '', outdoor = false } = body || {};
  const im = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image || '');
  if (!im || !/^[0-9a-f-]{36}$/i.test(project || '')) return res.status(400).json({ error: 'need image and project' });
  if (im[2].length > 3_500_000) return res.status(413).json({ error: 'image too large' });
  const row = await ownsProject(token, project);
  if (!row) return res.status(404).json({ error: 'project not found' });
  if ((row.renders || []).length >= 200) return res.status(429).json({ error: 'render limit for this project' });

  const rid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const dir = `${user.id}/${project}`;
  try {
    const before = await upload(token, `${dir}/${rid}-3d.jpg`, Buffer.from(im[2], 'base64'), im[1]);
    const text = PROMPT({ room: String(room).slice(0, 40), style: String(style).slice(0, 40), styleDesc: String(styleDesc).slice(0, 200), outdoor: !!outdoor });
    let out = null, last = null;
    for (const model of goodModel ? [goodModel] : MODELS) {
      const { status, j } = await gemini(key, model, im[2], im[1], text);
      if (status === 404 || (status === 400 && /not found|not supported|unknown name|imageSize|imageConfig/i.test(JSON.stringify(j)))) { last = { status, j }; continue; }
      if (status !== 200) return res.status(status === 429 ? 429 : 502).json({ error: 'upstream', status, detail: j && j.error ? j.error.message : '' });
      const parts = ((j.candidates || [])[0] || {}).content?.parts || [];
      const img = parts.find(p => p.inlineData && p.inlineData.data);
      if (!img) return res.status(502).json({ error: 'no image', detail: ((j.candidates || [])[0] || {}).finishReason || (j.promptFeedback && j.promptFeedback.blockReason) || '' });
      goodModel = model; out = { model, mime: img.inlineData.mimeType || 'image/png', data: img.inlineData.data };
      break;
    }
    if (!out) return res.status(502).json({ error: 'no model', detail: last && last.j && last.j.error ? last.j.error.message : '' });
    const ext = /jpeg/.test(out.mime) ? 'jpg' : /webp/.test(out.mime) ? 'webp' : 'png';
    const after = await upload(token, `${dir}/${rid}.${ext}`, Buffer.from(out.data, 'base64'), out.mime);
    return res.status(200).json({ id: rid, before, after, path: `${dir}/${rid}.${ext}`, model: out.model });
  } catch (e) {
    return res.status(500).json({ error: 'failed', detail: String(e).slice(0, 200) });
  }
};
