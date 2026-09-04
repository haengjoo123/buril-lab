do $assertions$
declare
  v_role text;
  v_signature text;
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid='private.deletion_file_targets_v1'::regclass)
     or not (select relrowsecurity from pg_catalog.pg_class where oid='private.deletion_worker_lease_v1'::regclass) then
    raise exception 'Ops11 private table RLS is disabled';
  end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'private.deletion_file_targets_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege(v_role, 'private.deletion_worker_lease_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'direct Ops11 table access is exposed to %', v_role;
    end if;
  end loop;
  foreach v_signature in array array[
    'public.acquire_deletion_worker_run_v1(uuid,integer)',
    'public.release_deletion_worker_run_v1(uuid)',
    'public.prepare_deletion_job_database_v1(uuid,uuid)',
    'public.list_deletion_file_targets_v1(uuid,uuid)',
    'public.mark_deletion_storage_complete_v1(uuid,uuid)',
    'public.mark_deletion_auth_complete_v1(uuid,uuid)',
    'public.finalize_deletion_job_v1(uuid,uuid)',
    'public.schedule_deletion_job_retry_v1(uuid,uuid,text)'
  ] loop
    if has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'service-only Ops11 RPC grants changed: %', v_signature;
    end if;
  end loop;
  if (select count(*) from private.deletion_worker_lease_v1) <> 1 then
    raise exception 'deletion worker lease singleton changed';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='private.deletion_jobs_v1'::regclass
      and pg_get_constraintdef(oid) like '%attempt_count%12%'
  ) then
    raise exception 'deletion retry attempt cap changed';
  end if;
end;
$assertions$;

select 'OPS11_DELETION_WORKER_SQL_ASSERTIONS_PASSED';
