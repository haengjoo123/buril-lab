-- Read-only catalog evidence for the reviewed Supabase Security Advisor surface.
-- This query intentionally returns no application rows, function bodies, or secrets.
with function_access as (
    select
        'function'::text as object_kind,
        namespace.nspname::text as schema_name,
        procedure.proname::text as object_name,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)::text as identity_arguments,
        language.lanname::text as language,
        procedure.prosecdef as security_definer,
        pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
        pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_execute,
        pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE') as service_role_execute,
        null::boolean as rls_enabled,
        null::boolean as rls_forced,
        null::integer as policy_count,
        null::boolean as anon_schema_usage,
        null::boolean as anon_bypass_rls,
        null::boolean as anon_select,
        null::boolean as anon_insert,
        null::boolean as anon_update,
        null::boolean as anon_delete,
        null::boolean as authenticated_schema_usage,
        null::boolean as authenticated_bypass_rls,
        null::boolean as authenticated_select,
        null::boolean as authenticated_insert,
        null::boolean as authenticated_update,
        null::boolean as authenticated_delete,
        null::boolean as service_role_schema_usage,
        null::boolean as service_role_bypass_rls,
        null::boolean as service_role_select,
        null::boolean as service_role_insert,
        null::boolean as service_role_update,
        null::boolean as service_role_delete
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_language as language
      on language.oid = procedure.prolang
    where namespace.nspname = 'public'
      and procedure.prokind = 'f'
      and procedure.prosecdef
      and pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
),
table_access as (
    select
        'table'::text as object_kind,
        namespace.nspname::text as schema_name,
        relation.relname::text as object_name,
        null::text as identity_arguments,
        null::text as language,
        null::boolean as security_definer,
        null::boolean as anon_execute,
        null::boolean as authenticated_execute,
        null::boolean as service_role_execute,
        relation.relrowsecurity as rls_enabled,
        relation.relforcerowsecurity as rls_forced,
        (
            select count(*)::integer
            from pg_catalog.pg_policies as policy
            where policy.schemaname = namespace.nspname
              and policy.tablename = relation.relname
        ) as policy_count,
        pg_catalog.has_schema_privilege('anon', namespace.oid, 'USAGE') as anon_schema_usage,
        (select role.rolbypassrls from pg_catalog.pg_roles as role where role.rolname = 'anon') as anon_bypass_rls,
        (pg_catalog.has_table_privilege('anon', relation.oid, 'SELECT') or pg_catalog.has_any_column_privilege('anon', relation.oid, 'SELECT')) as anon_select,
        (pg_catalog.has_table_privilege('anon', relation.oid, 'INSERT') or pg_catalog.has_any_column_privilege('anon', relation.oid, 'INSERT')) as anon_insert,
        (pg_catalog.has_table_privilege('anon', relation.oid, 'UPDATE') or pg_catalog.has_any_column_privilege('anon', relation.oid, 'UPDATE')) as anon_update,
        pg_catalog.has_table_privilege('anon', relation.oid, 'DELETE') as anon_delete,
        pg_catalog.has_schema_privilege('authenticated', namespace.oid, 'USAGE') as authenticated_schema_usage,
        (select role.rolbypassrls from pg_catalog.pg_roles as role where role.rolname = 'authenticated') as authenticated_bypass_rls,
        (pg_catalog.has_table_privilege('authenticated', relation.oid, 'SELECT') or pg_catalog.has_any_column_privilege('authenticated', relation.oid, 'SELECT')) as authenticated_select,
        (pg_catalog.has_table_privilege('authenticated', relation.oid, 'INSERT') or pg_catalog.has_any_column_privilege('authenticated', relation.oid, 'INSERT')) as authenticated_insert,
        (pg_catalog.has_table_privilege('authenticated', relation.oid, 'UPDATE') or pg_catalog.has_any_column_privilege('authenticated', relation.oid, 'UPDATE')) as authenticated_update,
        pg_catalog.has_table_privilege('authenticated', relation.oid, 'DELETE') as authenticated_delete,
        pg_catalog.has_schema_privilege('service_role', namespace.oid, 'USAGE') as service_role_schema_usage,
        (select role.rolbypassrls from pg_catalog.pg_roles as role where role.rolname = 'service_role') as service_role_bypass_rls,
        (pg_catalog.has_table_privilege('service_role', relation.oid, 'SELECT') or pg_catalog.has_any_column_privilege('service_role', relation.oid, 'SELECT')) as service_role_select,
        (pg_catalog.has_table_privilege('service_role', relation.oid, 'INSERT') or pg_catalog.has_any_column_privilege('service_role', relation.oid, 'INSERT')) as service_role_insert,
        (pg_catalog.has_table_privilege('service_role', relation.oid, 'UPDATE') or pg_catalog.has_any_column_privilege('service_role', relation.oid, 'UPDATE')) as service_role_update,
        pg_catalog.has_table_privilege('service_role', relation.oid, 'DELETE') as service_role_delete
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private')
      and relation.relkind in ('r', 'p')
      and relation.relrowsecurity
      and not exists (
          select 1
          from pg_catalog.pg_policies as policy
          where policy.schemaname = namespace.nspname
            and policy.tablename = relation.relname
      )
)
select * from function_access
union all
select * from table_access
order by object_kind, schema_name, object_name, identity_arguments;
