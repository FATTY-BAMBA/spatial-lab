-- T-003 price list (價目表) per design firm. Additive; touches only spatial_* objects.
-- Reverse: see the "down" block at the end.

-- 1. the firm's own unit prices (shape documented in src/prices.js); owner-only like the rest of the row (RLS unchanged)
alter table public.spatial_firms add column if not exists prices jsonb
  constraint spatial_firms_prices_check check (prices is null or (jsonb_typeof(prices) = 'object' and octet_length(prices::text) <= 65536));

-- 2. share RPC: same 6 columns as T-002; firm gains `prices`, trimmed to what the client's quote can show:
--    whitelisted keys only, works lines that are switched on, and furniture prices only for pieces in this project
drop function if exists public.spatial_shared(text);
create function public.spatial_shared(token text)
  returns table(name text, doc jsonb, renders jsonb, updated_at timestamptz, client text, firm jsonb)
  language sql stable security definer set search_path to ''
as $$
  select p.name, p.doc, p.renders, p.updated_at, p.client,
    (select jsonb_build_object('name', f.name, 'logo', f.logo, 'phone', f.phone, 'line_id', f.line_id, 'email', f.email,
                               'address', f.address, 'tax_id', f.tax_id, 'color', f.color,
                               'prices', case when jsonb_typeof(f.prices) = 'object' then jsonb_build_object(
                                 'v', f.prices -> 'v', 'name', f.prices -> 'name', 'date', f.prices -> 'date', 'labour', f.prices -> 'labour',
                                 'taxRate', f.prices -> 'taxRate', 'waste', f.prices -> 'waste', 'units', f.prices -> 'units',
                                 'finishes', f.prices -> 'finishes', 'notes', f.prices -> 'notes',
                                 'lines', coalesce((
                                   select jsonb_agg(l)
                                     from jsonb_array_elements(case when jsonb_typeof(f.prices -> 'lines') = 'array' then f.prices -> 'lines' else '[]'::jsonb end) l
                                    where l -> 'on' = 'true'::jsonb), '[]'::jsonb),
                                 'furniture', coalesce((
                                   select jsonb_object_agg(e.key, e.value)
                                     from jsonb_each(case when jsonb_typeof(f.prices -> 'furniture') = 'object' then f.prices -> 'furniture' else '{}'::jsonb end) e
                                    where e.key in (
                                      select (it ->> 'name') || '@' || (it ->> 'price')
                                        from jsonb_array_elements(case when jsonb_typeof(p.doc -> 'levels') = 'array' then p.doc -> 'levels' else '[]'::jsonb end) lv,
                                             jsonb_array_elements(case when jsonb_typeof(lv -> 'furniture') = 'array' then lv -> 'furniture' else '[]'::jsonb end) it)), '{}'::jsonb))
                               end)
       from public.spatial_firms f where f.owner = p.owner)
  from public.spatial_projects p
  where token is not null and length(token) >= 16 and p.share_token = token
$$;
revoke all on function public.spatial_shared(text) from public;
grant execute on function public.spatial_shared(text) to anon, authenticated, service_role;

-- down (manual):
--   recreate spatial_shared exactly as in 20261116090000_spatial_firms.sql (section 4), then
--   grant execute on function public.spatial_shared(text) to anon, authenticated, service_role;
--   alter table public.spatial_firms drop column prices;
