do $assertions$
declare
  v_role text;
  v_signature text;
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid='private.deletion_jobs_v1'::regclass)
     or not (select relrowsecurity from pg_catalog.pg_class where oid='private.deletion_job_events_v1'::regclass) then
    raise exception 'deletion queue RLS is disabled';
  end if;

  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'private.deletion_jobs_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege(v_role, 'private.deletion_job_events_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'direct deletion table access is exposed to %', v_role;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.enqueue_account_deletion_v1(uuid,uuid)',
    'public.enqueue_lab_deletion_v1(uuid,uuid,uuid)',
    'public.claim_deletion_jobs_v1(integer)',
    'public.record_deletion_job_result_v1(uuid,uuid,text,text,text)',
    'public.get_deletion_job_status_v1(uuid,uuid)'
  ] loop
    if has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'service-only deletion RPC grants changed: %', v_signature;
    end if;
  end loop;

  if (select count(*) from pg_catalog.pg_trigger
      where tgrelid='private.deletion_job_events_v1'::regclass and not tgisinternal) <> 2 then
    raise exception 'append-only deletion event triggers changed';
  end if;

  if (select count(*) from pg_catalog.pg_proc p where p.oid=any(array[
      'public.enqueue_account_deletion_v1(uuid,uuid)'::regprocedure,
      'public.enqueue_lab_deletion_v1(uuid,uuid,uuid)'::regprocedure,
      'public.claim_deletion_jobs_v1(integer)'::regprocedure,
      'public.record_deletion_job_result_v1(uuid,uuid,text,text,text)'::regprocedure,
      'public.get_deletion_job_status_v1(uuid,uuid)'::regprocedure
    ]) and p.prosecdef and 'search_path=""'=any(p.proconfig)) <> 5 then
    raise exception 'deletion RPC security settings changed';
  end if;
end;
$assertions$;

select 'OPS9_DELETION_SQL_ASSERTIONS_PASSED';
