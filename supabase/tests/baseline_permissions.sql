begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  ),
  49::bigint,
  'reviewed baseline exposes exactly 49 public tables'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ),
  0::bigint,
  'every public table enables RLS'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not exists (
        select 1
        from pg_catalog.aclexplode(c.relacl) acl
        join pg_catalog.pg_roles r on r.oid = acl.grantee
        where r.rolname in ('anon', 'authenticated', 'service_role')
      )
  ),
  0::bigint,
  'every public table has an explicit Data API or server role GRANT'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not exists (
        select 1
        from pg_catalog.aclexplode(c.relacl) acl
        join pg_catalog.pg_roles r on r.oid = acl.grantee
        where r.rolname = 'service_role'
      )
  ),
  0::bigint,
  'every public table has an explicit service_role GRANT'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(c.relacl) acl
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and acl.grantee = 0
  ),
  0::bigint,
  'no public table grants privileges to PUBLIC'
);

select is(
  (
    select count(distinct c.oid)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(c.relacl) acl
    join pg_catalog.pg_roles r on r.oid = acl.grantee
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and r.rolname = 'anon'
  ),
  25::bigint,
  'anon has the reviewed explicit table GRANT set'
);

select is(
  (
    select count(distinct c.oid)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(c.relacl) acl
    join pg_catalog.pg_roles r on r.oid = acl.grantee
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and r.rolname = 'authenticated'
  ),
  32::bigint,
  'authenticated has the reviewed explicit table GRANT set'
);

select is(
  (
    select count(distinct c.oid)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(c.relacl) acl
    join pg_catalog.pg_roles r on r.oid = acl.grantee
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and r.rolname = 'service_role'
  ),
  49::bigint,
  'service_role has an explicit GRANT on all public tables'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ),
  0::bigint,
  'every application SECURITY DEFINER function fixes search_path'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where n.nspname = 'public'
      and p.prosecdef
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  0::bigint,
  'no public SECURITY DEFINER function is executable by PUBLIC'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
  ),
  3::bigint,
  'anon, authenticated, and service_role exist in the local stack'
);

select * from finish();

rollback;
