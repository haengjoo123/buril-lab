-- Explicit server and browser privileges for the reviewed import workspace.
-- Preserve the already committed import migration; close inherited ACLs here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
revoke all on public.inventory_import_jobs, public.inventory_import_rows, public.inventory_import_profiles from public, anon, authenticated, service_role;
grant select, insert on public.inventory_import_jobs to authenticated;
grant select on public.inventory_import_rows to authenticated;
grant select, insert, update, delete on public.inventory_import_profiles to authenticated;
grant all on public.inventory_import_jobs, public.inventory_import_rows, public.inventory_import_profiles to service_role;
revoke all on function public.save_inventory_import_v1(uuid,integer,jsonb,jsonb,uuid), public.commit_inventory_import_batch_v1(uuid,integer,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_inventory_import_v1(uuid,integer,jsonb,jsonb,uuid), public.commit_inventory_import_batch_v1(uuid,integer,jsonb) to authenticated;
commit;
