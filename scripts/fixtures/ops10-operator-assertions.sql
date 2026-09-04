do $assertions$
declare
  v_role text;
  v_signature text;
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid='private.operator_role_assignments_v1'::regclass)
     or not (select relrowsecurity from pg_catalog.pg_class where oid='private.operator_action_audit_v1'::regclass) then
    raise exception 'operator role or audit RLS is disabled';
  end if;

  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'private.operator_role_assignments_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege(v_role, 'private.operator_action_audit_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'direct operator table access is exposed to %', v_role;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.set_operator_role_v1(uuid,text,boolean,uuid,uuid,text)',
    'public.authorize_operator_action_v1(uuid,text,text,text,uuid,uuid,text)',
    'public.authorize_operator_fallback_v1(uuid,text,text,text,uuid,text)',
    'public.operator_feedback_status_v1(uuid,uuid,text,uuid,text)',
    'public.operator_safety_center_status_v1(uuid,uuid,text,uuid,text)',
    'public.operator_analytics_review_decide_v1(uuid,uuid,text,text,jsonb,text,text,text,uuid,text)'
  ] loop
    if has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'service-only operator RPC grants changed: %', v_signature;
    end if;
  end loop;

  if (select count(*) from pg_catalog.pg_trigger
      where tgrelid='private.operator_action_audit_v1'::regclass and not tgisinternal) <> 2 then
    raise exception 'append-only operator audit triggers changed';
  end if;
end;
$assertions$;

select 'OPS10_OPERATOR_SQL_ASSERTIONS_PASSED';
