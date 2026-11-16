-- T-003 check for spatial_firms.prices + spatial_shared. Run after the migration (SQL editor or MCP execute_sql).
-- Everything happens in one transaction that is rolled back: no rows stay, the dropped FKs come back.
-- Raises an exception on the first failure; ends with a NOTICE 'spatial_firm_prices: all checks passed'.
begin;
alter table public.spatial_firms drop constraint spatial_firms_owner_fkey;
alter table public.spatial_projects drop constraint spatial_projects_owner_fkey;
insert into public.spatial_firms (owner, name, prices) values
  ('00000000-0000-4000-8000-0000000000a1', 'A 設計', '{"v":1,"name":"A 2026 價目表","date":"2026-11","labour":"含工帶料","taxRate":0.05,
    "waste":{"floor":0.08},"units":{"floor":"坪"},"finishes":{"floor.oak":6000},
    "furniture":{"雙人床@45000":40000,"冰箱@52000":50000},
    "lines":[{"id":"protect","name":"保護工程","unit":"坪","qty":1,"price":600,"on":true},{"id":"secret","name":"內部成本","unit":"式","qty":1,"price":999,"on":false}],
    "notes":["材質單價含施工"],"internal":"不給客戶看"}'),
  ('00000000-0000-4000-8000-0000000000b2', 'B 設計', null);
insert into public.spatial_projects (owner, name, doc, client, share_token) values
  ('00000000-0000-4000-8000-0000000000a1', 'A 的專案', '{"levels":[{"id":"1F","furniture":[{"name":"雙人床","price":45000},{"name":"茶几","price":16000}]}]}', '王小姐', 'qa-rls-token-0123456789');

-- the column's check: an object of at most 64 KB
do $$ begin
  begin update public.spatial_firms set prices = '[]' where owner = '00000000-0000-4000-8000-0000000000b2'; raise exception 'non-object prices accepted';
  exception when check_violation then null; end;
  begin update public.spatial_firms set prices = jsonb_build_object('notes', repeat('x', 70000)) where owner = '00000000-0000-4000-8000-0000000000b2'; raise exception '70 KB prices accepted';
  exception when check_violation then null; end;
end $$;

-- signed in as B: cannot read or change A's prices; can change its own
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.spatial_firms where prices is not null; if n <> 0 then raise exception 'B sees % priced firm rows', n; end if;
  update public.spatial_firms set prices = '{"name":"hacked"}' where owner = '00000000-0000-4000-8000-0000000000a1'; get diagnostics n = row_count; if n <> 0 then raise exception 'B updated A''s prices'; end if;
  update public.spatial_firms set prices = '{"v":1,"name":"B 價目表"}' where owner = '00000000-0000-4000-8000-0000000000b2'; get diagnostics n = row_count; if n <> 1 then raise exception 'B cannot save its own prices'; end if;
end $$;
reset role;
do $$ begin
  if (select prices ->> 'name' from public.spatial_firms where owner = '00000000-0000-4000-8000-0000000000a1') <> 'A 2026 價目表' then raise exception 'A''s prices changed'; end if;
end $$;

-- the public: only the trimmed list through the share function
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare r record; pr jsonb;
begin
  select * into r from public.spatial_shared('qa-rls-token-0123456789');
  if r.name is distinct from 'A 的專案' or r.client is distinct from '王小姐' or r.doc is null then raise exception 'spatial_shared row wrong'; end if;
  if exists (select 1 from jsonb_object_keys(r.firm) k where k not in ('name', 'logo', 'phone', 'line_id', 'email', 'address', 'tax_id', 'color', 'prices')) then raise exception 'firm leaks fields: %', r.firm; end if;
  pr := r.firm -> 'prices';
  if pr ->> 'name' is distinct from 'A 2026 價目表' or (pr -> 'finishes' ->> 'floor.oak')::int <> 6000 or (pr ->> 'taxRate')::numeric <> 0.05 then raise exception 'prices wrong: %', pr; end if;
  if pr ? 'internal' then raise exception 'non-whitelisted price key leaked'; end if;
  if jsonb_array_length(pr -> 'lines') <> 1 or pr -> 'lines' -> 0 ->> 'id' <> 'protect' then raise exception 'switched-off works line leaked: %', pr -> 'lines'; end if;
  if pr -> 'furniture' <> '{"雙人床@45000": 40000}'::jsonb then raise exception 'furniture not trimmed to the project: %', pr -> 'furniture'; end if;
  raise notice 'spatial_firm_prices: all checks passed';
end $$;
rollback;
