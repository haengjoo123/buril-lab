begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select is(
  (select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'join_lab', 'join_lab_with_password', 'insert_audit_log_rpc'
    )),
  3::bigint,
  'Contract revokes legacy paths without dropping recovery definitions'
);

select is(
  (select count(*) from unnest(array[
      'public.join_lab(uuid,text,text)',
      'public.join_lab_with_password(uuid,uuid,text,text,text)',
      'public.insert_audit_log_rpc(uuid,text,uuid,text,uuid,text,text,jsonb,jsonb,jsonb,text,uuid)'
    ]) signature
    cross join unnest(array['anon','authenticated','service_role']) role_name
    where has_function_privilege(role_name, signature, 'EXECUTE')),
  0::bigint,
  'no Data API or service role can execute a legacy join or generic audit writer'
);

select ok(
  has_function_privilege(
    'service_role', 'public.join_lab_server_v1(uuid,uuid,text,text,text,text)', 'EXECUTE'
  ),
  'the bounded server join path remains executable by service_role'
);

select is(
  (select count(*) from unnest(array['anon','authenticated']) role_name
    where has_function_privilege(
      role_name, 'public.join_lab_server_v1(uuid,uuid,text,text,text,text)', 'EXECUTE'
    )),
  0::bigint,
  'browser roles cannot bypass the server join endpoint'
);

select is(
  (select count(*) from unnest(array['anon','authenticated','service_role']) role_name
    where has_function_privilege(
      role_name, 'public.record_cabinet_activity_v2(uuid,text,text,text,text,uuid)', 'EXECUTE'
    )),
  2::bigint,
  'only authenticated and service_role retain the bounded activity writer'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid='public.audit_logs'::regclass),
  'audit_logs retains row level security'
);

select is(
  (select count(*) from pg_catalog.pg_policy
    where polrelid='public.audit_logs'::regclass
      and polname='Users can insert audit_logs for their labs'),
  0::bigint,
  'the generic browser insert policy is removed'
);

select is(
  (select count(*) from pg_catalog.pg_policy
    where polrelid='public.audit_logs'::regclass
      and polname='Users can view audit_logs for their labs'
      and polcmd='r'),
  1::bigint,
  'the tenant-scoped audit read policy remains'
);

select is(
  (select count(*) from unnest(array[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
    ]) privilege_name
    where has_table_privilege('anon', 'public.audit_logs', privilege_name)),
  0::bigint,
  'anon has no direct audit table privilege'
);

select ok(
  has_table_privilege('authenticated', 'public.audit_logs', 'SELECT'),
  'authenticated keeps tenant-scoped audit reads'
);

select is(
  (select count(*) from unnest(array[
      'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
    ]) privilege_name
    where has_table_privilege('authenticated', 'public.audit_logs', privilege_name)),
  0::bigint,
  'authenticated cannot forge, rewrite, or delete audit rows'
);

select is(
  (select count(*) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege_name
    where has_table_privilege('service_role', 'public.audit_logs', privilege_name)),
  4::bigint,
  'service_role retains the table operations required by reviewed server and erasure paths'
);

select * from finish();

rollback;
