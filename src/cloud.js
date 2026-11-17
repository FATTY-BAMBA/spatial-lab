// Accounts and saved projects. Supabase (PrimeStride shared project); only the public URL and anon key live here —
// every table is protected by row-level security (a designer sees only their own projects) and share links go
// through a read-only function.
const SB_URL = 'https://mhzdimntfcovzffidfxf.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oemRpbW50ZmNvdnpmZmlkZnhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0Nzg1NDMsImV4cCI6MjEwNDA1NDU0M30.pt2K5dTdLJIg8e2VSgQSsfl9Fh18v4EWSZuVs9AnADM';
const LIB = new URL('../vendor/supabase/supabase.js', import.meta.url).href;

let clientP = null;
export function client() {
  if (!clientP) clientP = new Promise((resolve, reject) => {
    const make = () => resolve(window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } }));
    if (window.supabase) return make();
    const s = document.createElement('script'); s.src = LIB; s.onload = make; s.onerror = () => reject(new Error('supabase load failed'));
    document.head.appendChild(s);
  });
  return clientP;
}

export async function currentUser() {
  try { const sb = await client(); const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; } catch { return null; }
}
export async function accessToken() {
  try { const sb = await client(); const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : null; } catch { return null; }
}
// Deferred: calling getSession() inside Supabase's own auth callback deadlocks its lock (the page froze after Google sign-in)
export async function onAuth(fn) { const sb = await client(); sb.auth.onAuthStateChange((_e, session) => { const u = session ? session.user : null; setTimeout(() => fn(u), 0); }); }

// Google sign-in; comes back to `next` (default: the projects page)
export async function signIn(next = '/projects') {
  const sb = await client();
  const redirectTo = new URL(next, location.origin).href;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
}
export async function signOut() { const sb = await client(); await sb.auth.signOut(); }

// `client` (業主名稱) arrived with the firm-profile migration; until it is applied the query falls back without it
const noColumn = e => e && (e.code === '42703' || /column .* does not exist/i.test(e.message || ''));
export async function listProjects() {
  const sb = await client();
  const q = cols => sb.from('spatial_projects').select(cols).order('updated_at', { ascending: false });
  let { data, error } = await q('id,name,client,thumb,share_token,updated_at');
  if (noColumn(error)) ({ data, error } = await q('id,name,thumb,share_token,updated_at'));
  if (error) throw error; return data;
}
export async function loadProject(id) {
  const sb = await client();
  const q = cols => sb.from('spatial_projects').select(cols).eq('id', id).single();
  let { data, error } = await q('id,name,client,doc,renders,share_token,updated_at');
  if (noColumn(error)) ({ data, error } = await q('id,name,doc,renders,share_token,updated_at'));
  if (error) throw error; return data;
}
export async function setClient(id, name) { const sb = await client(); const { error } = await sb.from('spatial_projects').update({ client: (name || '').trim().slice(0, 120) || null }).eq('id', id); if (error) throw error; }
// Insert (no id) or update; returns the id
export async function saveProject({ id, name, doc, thumb }) {
  const sb = await client();
  const row = { name: (name || '新專案').slice(0, 120), doc, ...(thumb ? { thumb } : {}) };
  if (id) {
    // the editor saves its whole doc; keep the style the designer presented in the 3D (T-011, doc.presented) as it is on
    // the server, so an editor tab opened before the style was picked cannot put an old one back
    try {
      const { data: cur, error: e0 } = await sb.from('spatial_projects').select('presented:doc->presented').eq('id', id).maybeSingle();
      if (!e0 && cur) { row.doc = { ...doc }; if (cur.presented != null) row.doc.presented = cur.presented; else delete row.doc.presented; }
    } catch { /* keep the doc as given */ }
    const { error } = await sb.from('spatial_projects').update(row).eq('id', id); if (error) throw error; return id;
  }
  const { data, error } = await sb.from('spatial_projects').insert(row).select('id').single();
  if (error) throw error; return data.id;
}
// T-011: the style and finishes the designer presents (see src/presented.js) live in the project doc, so the share RPC
// already returns them and no migration is needed. Only `doc.presented` changes; the rest of the doc is read fresh
// first so an edit saved by the editor in the meantime is kept.
export async function savePresented(id, presented) {
  const sb = await client();
  const { data, error } = await sb.from('spatial_projects').select('doc').eq('id', id).single();
  if (error) throw error;
  const doc = { ...(data.doc || {}), presented };
  const { error: e2 } = await sb.from('spatial_projects').update({ doc }).eq('id', id);
  if (e2) throw e2; return presented;
}
export async function renameProject(id, name) { const sb = await client(); const { error } = await sb.from('spatial_projects').update({ name }).eq('id', id); if (error) throw error; }
export async function deleteProject(id) { const sb = await client(); const { error } = await sb.from('spatial_projects').delete().eq('id', id); if (error) throw error; }
// Turn the read-only share link on (returns the token) or off (null)
export async function setShare(id, on) {
  const sb = await client();
  const token = on ? Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 28) : null;
  const { error } = await sb.from('spatial_projects').update({ share_token: token }).eq('id', id);
  if (error) throw error; return token;
}export async function sharedProject(token) {
  const sb = await client();
  const { data, error } = await sb.rpc('spatial_shared', { token });
  if (error) throw error; return data && data[0] ? data[0] : null;
}
// AI renders: images live in Storage under <user id>/<project id>/, the list lives on the project row
const BUCKET = 'spatial-renders';
export const publicUrl = path => `${SB_URL}/storage/v1/object/public/${BUCKET}/${path}`;
export async function putImage(path, blob) {
  const sb = await client();
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type, cacheControl: '31536000' });
  if (error) throw error; return publicUrl(path);
}
export async function removeImages(paths) { const sb = await client(); await sb.storage.from(BUCKET).remove(paths).catch(() => {}); }
export async function setRenders(id, renders) {
  const sb = await client(); const { error } = await sb.from('spatial_projects').update({ renders }).eq('id', id); if (error) throw error;
}
export async function getRenders(id) {
  const sb = await client(); const { data, error } = await sb.from('spatial_projects').select('renders').eq('id', id).single(); if (error) throw error; return data.renders || [];
}
export const shareUrl = token => `${location.origin}/?share=${encodeURIComponent(token)}`;
// the printable proposal (提案書): ?share= for the client, ?id= for the owner's own preview
export const proposalUrl = ({ token, id }) => `${location.origin}/proposal?${token ? `share=${encodeURIComponent(token)}` : `id=${encodeURIComponent(id)}`}`;

// 公司資料: one firm profile per account (table spatial_firms, owner-only). Clients see its public fields through
// spatial_shared(token).firm. Returns null when there is none yet (or the table is not there yet).
export const FIRM_FIELDS = ['name', 'logo', 'phone', 'line_id', 'email', 'address', 'tax_id', 'color'];
// 價目表 (spatial_firms.prices) arrived with the price-list migration; until it is applied the firm loads without it
let pricesColumn = null;
export const pricesAvailable = () => pricesColumn !== false;
export async function getFirm() {
  const sb = await client();
  const q = cols => sb.from('spatial_firms').select(cols).maybeSingle();
  let { data, error } = await q([...FIRM_FIELDS, 'prices'].join(','));
  if (noColumn(error)) { pricesColumn = false; ({ data, error } = await q(FIRM_FIELDS.join(','))); } else if (!error) pricesColumn = true;
  if (error) { console.warn('firm', error.message); return null; }
  return data;
}
// Save the price list only (the firm row is created when there is none yet; its name stays empty until 公司資料)
export async function savePrices(prices) {
  if (pricesColumn === false) throw new Error('prices column missing');
  const sb = await client();
  const u = await currentUser(); if (!u) throw new Error('not signed in');
  const { error } = await sb.from('spatial_firms').upsert({ owner: u.id, prices }, { onConflict: 'owner' });
  if (error) throw error; return prices;
}
export async function saveFirm(firm) {
  const sb = await client();
  const u = await currentUser(); if (!u) throw new Error('not signed in');
  const row = { owner: u.id };
  for (const k of FIRM_FIELDS) { const v = typeof firm[k] === 'string' ? firm[k].trim() : firm[k]; row[k] = v || null; }
  row.name = row.name || '';
  const { error } = await sb.from('spatial_firms').upsert(row, { onConflict: 'owner' });
  if (error) throw error; return row;
}
// logos live in their own public bucket under <user id>/; a new file name each time so caches never show the old one
const LOGOS = 'spatial-logos';
const logoUrl = path => `${SB_URL}/storage/v1/object/public/${LOGOS}/${path}`;
export async function putLogo(blob) {
  const sb = await client();
  const u = await currentUser(); if (!u) throw new Error('not signed in');
  const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
  const path = `${u.id}/logo-${Date.now().toString(36)}.${ext}`;
  const { error } = await sb.storage.from(LOGOS).upload(path, blob, { upsert: true, contentType: blob.type, cacheControl: '31536000' });
  if (error) throw error; return logoUrl(path);
}
export async function removeLogo(url) {
  const pre = logoUrl(''); if (!url || !url.startsWith(pre)) return;
  const sb = await client(); await sb.storage.from(LOGOS).remove([url.slice(pre.length)]).catch(() => {});
}
