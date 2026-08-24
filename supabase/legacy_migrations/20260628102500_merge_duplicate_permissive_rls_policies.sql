do $$
declare
  policy_group record;
  old_policy_name text;
  roles_sql text;
  create_sql text;
  consolidated_policy_name text;
begin
  for policy_group in
    with grouped as (
      select
        schemaname,
        tablename,
        cmd,
        roles,
        count(*) as policy_count,
        array_agg(policyname order by policyname) as policy_names,
        string_agg(format('(%s)', qual), ' or ' order by policyname) filter (where qual is not null) as using_expr,
        string_agg(format('(%s)', coalesce(with_check, qual)), ' or ' order by policyname) filter (where coalesce(with_check, qual) is not null) as check_expr
      from pg_policies
      where schemaname = 'public'
        and permissive = 'PERMISSIVE'
      group by schemaname, tablename, cmd, roles
      having count(*) > 1
    )
    select *
    from grouped
    where cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    order by tablename, cmd
  loop
    consolidated_policy_name := 'consolidated_' || policy_group.tablename || '_' || lower(policy_group.cmd) || '_access';

    select string_agg(
      case when role_name::text = 'public' then 'public' else format('%I', role_name::text) end,
      ', '
      order by role_name::text
    )
    into roles_sql
    from unnest(policy_group.roles) as role_name;

    execute format(
      'drop policy if exists %I on %I.%I',
      consolidated_policy_name,
      policy_group.schemaname,
      policy_group.tablename
    );

    create_sql := format(
      'create policy %I on %I.%I as permissive for %s to %s',
      consolidated_policy_name,
      policy_group.schemaname,
      policy_group.tablename,
      lower(policy_group.cmd),
      roles_sql
    );

    if policy_group.cmd in ('SELECT', 'DELETE') then
      create_sql := create_sql || format(' using (%s)', policy_group.using_expr);
    elsif policy_group.cmd = 'INSERT' then
      create_sql := create_sql || format(' with check (%s)', policy_group.check_expr);
    elsif policy_group.cmd = 'UPDATE' then
      create_sql := create_sql || format(' using (%s) with check (%s)', policy_group.using_expr, policy_group.check_expr);
    end if;

    execute create_sql;

    foreach old_policy_name in array policy_group.policy_names loop
      execute format(
        'drop policy %I on %I.%I',
        old_policy_name,
        policy_group.schemaname,
        policy_group.tablename
      );
    end loop;
  end loop;
end $$;
