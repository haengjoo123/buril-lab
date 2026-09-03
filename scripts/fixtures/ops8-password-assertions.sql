do $assertions$
declare
  v_role text;
  v_signature text;
begin
  if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='labs'
        and column_name='join_password_needs_change'
        and data_type='boolean' and is_nullable='NO'
    ) then
    raise exception 'password replacement flag is missing or nullable';
  end if;

  foreach v_role in array array['anon','authenticated'] loop
    if has_function_privilege(v_role, 'private.assert_lab_join_password_v1(text,text)', 'EXECUTE') then
      raise exception 'private password helper is exposed to %', v_role;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.create_lab_secure(text,text,text,text,text,text)',
    'public.set_lab_join_password(uuid,text)'
  ] loop
    if has_function_privilege('anon', v_signature, 'EXECUTE')
       or not has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'reviewed password-writer grants changed: %', v_signature;
    end if;
  end loop;

  if has_function_privilege('authenticated', 'public.normalize_lab_join_password()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.normalize_lab_join_password()', 'EXECUTE') then
    raise exception 'password trigger grants changed';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid='public.normalize_lab_join_password()'::regprocedure
        and p.prosecdef
        and 'search_path=""'=any(p.proconfig)
    ) then
    raise exception 'password trigger security settings changed';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid='public.set_lab_join_password(uuid,text)'::regprocedure
        and p.prosecdef
        and 'search_path=""'=any(p.proconfig)
        and 'lock_timeout=5s'=any(p.proconfig)
    ) then
    raise exception 'password writer security settings changed';
  end if;

  if not (select relrowsecurity from pg_catalog.pg_class where oid='public.labs'::regclass) then
    raise exception 'labs RLS is disabled';
  end if;
end;
$assertions$;

select 'OPS8_PASSWORD_SQL_ASSERTIONS_PASSED';
