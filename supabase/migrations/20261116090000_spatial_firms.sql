-- T-002 firm profile + branded proposal. Additive; touches only spatial_* objects.
-- Reverse: see the "down" block at the end.

-- 1. one firm profile per account (owner-only)
create table if not exists public.spatial_firms (
  owner      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name       text not null default '' check (length(name) <= 120),
  logo       text check (logo is null or (length(logo) <= 400 and logo like 'https://mhzdimntfcovzffidfxf.supabase.co/storage/v1/object/public/spatial-logos/%')),
  phone      text check (phone is null or length(phone) <= 40),
  line_id    text check (line_id is null or length(line_id) <= 60),
  email      text check (email is null or length(email) <= 120),
  address    text check (address is null or length(address) <= 200),
  tax_id     text check (tax_id is null or tax_id ~ '^[0-9]{8}$'),
  color      text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.spatial_firms enable row level security;
revoke all on public.spatial_firms from anon;
create policy "spatial firms: owner read"   on public.spatial_firms for select to authenticated using (owner = (select auth.uid()));
create policy "spatial firms: owner insert" on public.spatial_firms for insert to authenticated with check (owner = (select auth.uid()));
create policy "spatial firms: owner update" on public.spatial_firms for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "spatial firms: owner delete" on public.spatial_firms for delete to authenticated using (owner = (select auth.uid()));
create trigger spatial_firms_touch before update on public.spatial_firms for each row execute function public.spatial_touch();

-- 2. the client's name on a project (shown on the proposal cover)
alter table public.spatial_projects add column if not exists client text check (client is null or length(client) <= 120);

-- 3. logos: public read, writes only under the user's own id folder (mirrors spatial-renders)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spatial-logos', 'spatial-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
create policy "spatial logos select own" on storage.objects for select to authenticated using (bucket_id = 'spatial-logos' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "spatial logos insert own" on storage.objects for insert to authenticated with check (bucket_id = 'spatial-logos' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "spatial logos update own" on storage.objects for update to authenticated using (bucket_id = 'spatial-logos' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "spatial logos delete own" on storage.objects for delete to authenticated using (bucket_id = 'spatial-logos' and (storage.foldername(name))[1] = (auth.uid())::text);

-- 4. share RPC: same columns as before + client + the firm's public fields (via the project's owner)
drop function if exists public.spatial_shared(text);
create function public.spatial_shared(token text)
  returns table(name text, doc jsonb, renders jsonb, updated_at timestamptz, client text, firm jsonb)
  language sql stable security definer set search_path to ''
as $$
  select p.name, p.doc, p.renders, p.updated_at, p.client,
    (select jsonb_build_object('name', f.name, 'logo', f.logo, 'phone', f.phone, 'line_id', f.line_id, 'email', f.email,
                               'address', f.address, 'tax_id', f.tax_id, 'color', f.color)
       from public.spatial_firms f where f.owner = p.owner)
  from public.spatial_projects p
  where token is not null and length(token) >= 16 and p.share_token = token
$$;
revoke all on function public.spatial_shared(text) from public;
grant execute on function public.spatial_shared(text) to anon, authenticated, service_role;

-- down (manual):
--   drop function public.spatial_shared(text);
--   create function public.spatial_shared(token text) returns table(name text, doc jsonb, renders jsonb, updated_at timestamptz)
--     language sql stable security definer set search_path to '' as $$ select p.name, p.doc, p.renders, p.updated_at
--     from public.spatial_projects p where token is not null and length(token) >= 16 and p.share_token = token $$;
--   grant execute on function public.spatial_shared(text) to anon, authenticated, service_role;
--   drop policy "spatial logos select own" on storage.objects; (… insert / update / delete own)
--   delete from storage.buckets where id = 'spatial-logos';   -- after emptying it
--   alter table public.spatial_projects drop column client;
--   drop table public.spatial_firms;
