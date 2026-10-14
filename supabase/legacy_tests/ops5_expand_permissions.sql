begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'cabinets'
      and column_name = 'image_path' and data_type = 'text' and is_nullable = 'YES'),
  1::bigint,
  'Expand adds one nullable cabinet image_path without replacing image_url'
);

select is(
  (select count(*) from pg_catalog.pg_constraint
    where conrelid = 'public.cabinets'::regclass
      and conname = 'cabinets_image_path_v1_check' and convalidated),
  1::bigint,
  'cabinet image paths use the reviewed validated path constraint'
);

select is(
  (select count(*) from pg_catalog.pg_trigger
    where tgrelid = 'public.cabinets'::regclass
      and tgname = 'cabinets_guard_image_path_v1' and not tgisinternal and tgenabled = 'O'),
  1::bigint,
  'the server-managed image path guard is enabled'
);

select is(
  (select count(*) from unnest(array['public', 'anon', 'authenticated']) role_name
    where has_function_privilege(role_name, 'private.guard_cabinet_image_path_v1()', 'EXECUTE')),
  0::bigint,
  'browser roles cannot directly execute the image path guard'
);

select ok(
  (select exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
    where setting like 'search_path=%'
  ) from pg_catalog.pg_proc p
    where p.oid = 'private.guard_cabinet_image_path_v1()'::regprocedure),
  'the image path guard fixes search_path'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class
    where oid = 'private.lab_join_attempts_v1'::regclass),
  'private join counters enable RLS'
);

select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) role_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege_name
    where has_table_privilege(role_name, 'private.lab_join_attempts_v1', privilege_name)),
  0::bigint,
  'no API or service role can access join counters directly'
);

select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) role_name
    where has_function_privilege(
      role_name,
      'public.join_lab_server_v1(uuid,uuid,text,text,text,text)',
      'EXECUTE'
    )),
  1::bigint,
  'only service_role can execute the server join function'
);

select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) role_name
    where has_function_privilege(
      role_name,
      'public.record_cabinet_activity_v2(uuid,text,text,text,text,uuid)',
      'EXECUTE'
    )),
  2::bigint,
  'only authenticated and service roles can execute the safe activity function'
);

select is(
  (select count(*) from pg_catalog.pg_proc p
    where p.oid in (
      'public.join_lab_server_v1(uuid,uuid,text,text,text,text)'::regprocedure,
      'public.record_cabinet_activity_v2(uuid,text,text,text,text,uuid)'::regprocedure
    ) and p.prosecdef),
  2::bigint,
  'both new privileged functions are explicit SECURITY DEFINER functions'
);

select is(
  (select count(*) from pg_catalog.pg_proc p
    where p.oid in (
      'public.join_lab_server_v1(uuid,uuid,text,text,text,text)'::regprocedure,
      'public.record_cabinet_activity_v2(uuid,text,text,text,text,uuid)'::regprocedure
    ) and not exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
      where setting like 'search_path=%'
    )),
  0::bigint,
  'both new privileged functions fix search_path'
);

select ok(
  has_function_privilege('authenticated', 'public.join_lab(uuid,text,text)', 'EXECUTE'),
  'legacy clients retain the old join function during Expand'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.insert_audit_log_rpc(uuid,text,uuid,text,uuid,text,text,jsonb,jsonb,jsonb,text,uuid)',
    'EXECUTE'
  ),
  'legacy clients retain the generic audit function until Contract'
);

select is(
  (select count(*) from pg_catalog.pg_policy
    where polrelid = 'public.audit_logs'::regclass
      and polcmd in ('u', 'd')),
  0::bigint,
  'audit rows remain append-only for browser roles'
);

select * from finish();

rollback;
