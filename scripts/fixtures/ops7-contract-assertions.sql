do $assertions$
declare
  v_role text;
  v_signature text;
  v_privilege text;
begin
  foreach v_signature in array array[
    'public.join_lab(uuid,text,text)',
    'public.join_lab_with_password(uuid,uuid,text,text,text)',
    'public.insert_audit_log_rpc(uuid,text,uuid,text,uuid,text,text,jsonb,jsonb,jsonb,text,uuid)'
  ] loop
    foreach v_role in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(v_role, v_signature, 'EXECUTE') then
        raise exception 'legacy function remains executable: % by %', v_signature, v_role;
      end if;
    end loop;
  end loop;

  if not has_function_privilege(
      'service_role', 'public.join_lab_server_v1(uuid,uuid,text,text,text,text)', 'EXECUTE'
    ) or has_function_privilege(
      'authenticated', 'public.join_lab_server_v1(uuid,uuid,text,text,text,text)', 'EXECUTE'
    ) then
    raise exception 'bounded server join grants changed';
  end if;
  if not has_function_privilege(
      'authenticated', 'public.record_cabinet_activity_v2(uuid,text,text,text,text,uuid)', 'EXECUTE'
    ) then
    raise exception 'safe activity writer is unavailable';
  end if;

  foreach v_role in array array['anon','authenticated'] loop
    foreach v_privilege in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(v_role, 'public.audit_logs', v_privilege) then
        raise exception 'browser audit write privilege remains: % %', v_role, v_privilege;
      end if;
    end loop;
  end loop;
  if has_table_privilege('anon', 'public.audit_logs', 'SELECT')
     or not has_table_privilege('authenticated', 'public.audit_logs', 'SELECT') then
    raise exception 'reviewed audit read grants changed';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid='public.audit_logs'::regclass) then
    raise exception 'audit RLS is disabled';
  end if;
  if exists (select 1 from pg_catalog.pg_policy
      where polrelid='public.audit_logs'::regclass
        and polname='Users can insert audit_logs for their labs') then
    raise exception 'legacy audit insert policy remains';
  end if;
end;
$assertions$;

select 'OPS7_CONTRACT_SQL_ASSERTIONS_PASSED';
