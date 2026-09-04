begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select is(
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='labs'
      and column_name='join_password_needs_change'),
  1::bigint,
  'labs exposes one reviewed password-replacement flag'
);

select is(
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='labs'
      and column_name='join_password_needs_change'),
  'boolean',
  'the replacement flag is boolean'
);

select ok(
  (select is_nullable='NO' from information_schema.columns
    where table_schema='public' and table_name='labs'
      and column_name='join_password_needs_change'),
  'the replacement flag cannot be null'
);

select ok(
  (select column_default in ('false', 'false::boolean') from information_schema.columns
    where table_schema='public' and table_name='labs'
      and column_name='join_password_needs_change'),
  'new passwordless labs do not start with a false warning'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid='public.labs'::regclass),
  'labs retains row level security'
);

select ok(
  not has_function_privilege('anon', 'private.assert_lab_join_password_v1(text,text)', 'EXECUTE'),
  'anon cannot call the private policy helper'
);

select ok(
  not has_function_privilege('authenticated', 'private.assert_lab_join_password_v1(text,text)', 'EXECUTE'),
  'authenticated clients cannot call the private policy helper'
);

select ok(
  has_function_privilege('service_role', 'private.assert_lab_join_password_v1(text,text)', 'EXECUTE'),
  'service role retains reviewed policy-helper execution'
);

select ok(
  not has_function_privilege('authenticated', 'public.normalize_lab_join_password()', 'EXECUTE'),
  'authenticated clients cannot call the password trigger directly'
);

select ok(
  has_function_privilege('service_role', 'public.normalize_lab_join_password()', 'EXECUTE'),
  'service role retains reviewed trigger execution'
);

select ok(
  not has_function_privilege('anon', 'public.create_lab_secure(text,text,text,text,text,text)', 'EXECUTE'),
  'anon cannot create a protected lab'
);

select ok(
  has_function_privilege('authenticated', 'public.create_lab_secure(text,text,text,text,text,text)', 'EXECUTE'),
  'authenticated users can create a lab through the reviewed writer'
);

select ok(
  not has_function_privilege('anon', 'public.set_lab_join_password(uuid,text)', 'EXECUTE'),
  'anon cannot change a lab password'
);

select ok(
  has_function_privilege('authenticated', 'public.set_lab_join_password(uuid,text)', 'EXECUTE'),
  'authenticated lab admins can use the reviewed password writer'
);

select ok(
  has_function_privilege('service_role', 'public.join_lab_server_v1(uuid,uuid,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.join_lab_server_v1(uuid,uuid,text,text,text,text)', 'EXECUTE'),
  'the rate-limited join writer remains server only'
);

select is(
  (select count(*) from unnest(array[
      'public.join_lab(uuid,text,text)',
      'public.join_lab_with_password(uuid,uuid,text,text,text)'
    ]) signature
    where has_function_privilege('authenticated', signature, 'EXECUTE')),
  0::bigint,
  'legacy browser join functions remain revoked'
);

select ok(
  (select bool_and(coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%')
    from pg_catalog.pg_proc p
    where p.oid = any(array[
      'private.assert_lab_join_password_v1(text,text)'::regprocedure,
      'public.normalize_lab_join_password()'::regprocedure,
      'public.create_lab_secure(text,text,text,text,text,text)'::regprocedure,
      'public.set_lab_join_password(uuid,text)'::regprocedure
    ])),
  'all password-policy functions fix an empty search path'
);

select is(
  (select count(*) from pg_catalog.pg_trigger
    where tgrelid='public.labs'::regclass
      and tgname='normalize_lab_join_password_before_write'
      and not tgisinternal),
  1::bigint,
  'the reviewed password trigger remains installed once'
);

select * from finish();
rollback;
