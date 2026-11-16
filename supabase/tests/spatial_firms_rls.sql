-- T-002 RLS check for spatial_firms + spatial_shared. Run after the migration (SQL editor or MCP execute_sql).
-- Everything happens in one transaction that is rolled back: no rows stay, the dropped FKs come back.
-- Raises an exception on the first failure; ends with a NOTICE 'spatial_firms RLS: all checks passed'.
begin;
-- two throwaway owners without touching auth.users: lift the owner FKs inside this transaction only
alter table public.spatial_firms drop constraint spatial_firms_owner_fkey;
alter table public.spatial_projects drop constraint spatial_projects_owner_fkey;
insert into public.spatial_firms (owner, name, phone, tax_id, color) values
  ('00000000-0000-4000-8000-0000000000a1', 'A 設計', '02-1111-1111', '22099131', '#2f5d50'),
  ('00000000-0000-4000-8000-0000000000b2', 'B 設計', '02-2222-2222', null, null);
insert into public.spatial_projects (owner, name, doc, client, share_token) values
  ('00000000-0000-4000-8000-0000000000a1', 'A 的專案', '{"levels":[]}', '王小姐', 'qa-rls-token-0123456789');

-- signed in as B
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.spatial_firms; if n <> 1 then raise exception 'B sees % firm rows (expected only its own)', n; end if;
  select count(*) into n from public.spatial_firms where owner = '00000000-0000-4000-8000-0000000000a1'; if n <> 0 then raise exception 'B can read A''s firm'; end if;
  update public.spatial_firms set name = 'hacked' where owner = '00000000-0000-4000-8000-0000000000a1'; get diagnostics n = row_count; if n <> 0 then raise exception 'B updated A''s firm'; end if;
  delete from public.spatial_firms where owner = '00000000-0000-4000-8000-0000000000a1'; get diagnostics n = row_count; if n <> 0 then raise exception 'B deleted A''s firm'; end if;
  begin
    insert into public.spatial_firms (owner, name) values ('00000000-0000-4000-8000-0000000000c3', 'spoof');
    raise exception 'B inserted a firm row for another owner';
  exception when insufficient_privilege then null; -- new row violates row-level security policy
  end;
  update public.spatial_firms set owner = '00000000-0000-4000-8000-0000000000a1' where owner = '00000000-0000-4000-8000-0000000000b2';
  raise exception 'B moved its row to A';
exception
  when insufficient_privilege or unique_violation then null; -- either refusal is fine
end $$;
-- the B checks above end in the exception handler on purpose; re-check that A's row is untouched
reset role;
do $$ begin
  if (select name from public.spatial_firms where owner = '00000000-0000-4000-8000-0000000000a1') <> 'A 設計' then raise exception 'A''s firm changed'; end if;
end $$;

-- the public: no direct table access, only the share function's public fields
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare r record; n int;
begin
  begin
    select count(*) into n from public.spatial_firms;
    if n > 0 then raise exception 'anon can read spatial_firms'; end if;
  exception when insufficient_privilege then null;
  end;
  select * into r from public.spatial_shared('qa-rls-token-0123456789');
  if r.name is distinct from 'A 的專案' or r.client is distinct from '王小姐' then raise exception 'spatial_shared row wrong'; end if;
  if r.firm ->> 'name' is distinct from 'A 設計' or r.firm ->> 'tax_id' is distinct from '22099131' then raise exception 'spatial_shared firm wrong: %', r.firm; end if;
  if exists (select 1 from jsonb_object_keys(r.firm) k where k not in ('name', 'logo', 'phone', 'line_id', 'email', 'address', 'tax_id', 'color')) then raise exception 'spatial_shared leaks firm fields: %', r.firm; end if;
  if r.firm ? 'owner' then raise exception 'owner id leaked'; end if;
  select count(*) into n from public.spatial_shared('short'); if n <> 0 then raise exception 'short token accepted'; end if;
  raise notice 'spatial_firms RLS: all checks passed';
end $$;
rollback;
