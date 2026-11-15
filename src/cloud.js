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
export async function onAuth(fn) { const sb = await client(); sb.auth.onAuthStateChange((_e, session) => fn(session ? session.user : null)); }

// Google sign-in; comes back to `next` (default: the projects page)
export async function signIn(next = '/projects') {
  const sb = await client();
  const redirectTo = new URL(next, location.origin).href;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
}
export async function signOut() { const sb = await client(); await sb.auth.signOut(); }

export async function listProjects() {
  const sb = await client();
  const { data, error } = await sb.from('spatial_projects').select('id,name,thumb,share_token,updated_at').order('updated_at', { ascending: false });
  if (error) throw error; return data;
}
export async function loadProject(id) {
  const sb = await client();
  const { data, error } = await sb.from('spatial_projects').select('id,name,doc,share_token,updated_at').eq('id', id).single();
  if (error) throw error; return data;
}
// Insert (no id) or update; returns the id
export async function saveProject({ id, name, doc, thumb }) {
  const sb = await client();
  const row = { name: (name || '新專案').slice(0, 120), doc, ...(thumb ? { thumb } : {}) };
  if (id) { const { error } = await sb.from('spatial_projects').update(row).eq('id', id); if (error) throw error; return id; }
  const { data, error } = await sb.from('spatial_projects').insert(row).select('id').single();
  if (error) throw error; return data.id;
}
export async function renameProject(id, name) { const sb = await client(); const { error } = await sb.from('spatial_projects').update({ name }).eq('id', id); if (error) throw error; }
export async function deleteProject(id) { const sb = await client(); const { error } = await sb.from('spatial_projects').delete().eq('id', id); if (error) throw error; }
// Turn the read-only share link on (returns the token) or off (null)
export async function setShare(id, on) {
  const sb = await client();
  const token = on ? Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 28) : null;
  const { error } = await sb.from('spatial_projects').update({ share_token: token }).eq('id', id);
  if (error) throw error; return token;
}
export async function sharedProject(token) {
  const sb = await client();
  const { data, error } = await sb.rpc('spatial_shared', { token });
  if (error) throw error; return data && data[0] ? data[0] : null;
}
export const shareUrl = token => `${location.origin}/?share=${encodeURIComponent(token)}`;
