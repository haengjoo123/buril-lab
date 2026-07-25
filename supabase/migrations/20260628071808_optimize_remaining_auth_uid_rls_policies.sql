do $$
declare
  generated_sql text;
begin
  for generated_sql in
    with policy_text as (
      select
        schemaname,
        tablename,
        policyname,
        cmd,
        qual,
        with_check,
        replace(
          replace(
            replace(coalesce(qual, ''), 'auth.uid() =', '(select auth.uid()) ='),
            '= auth.uid()', '= (select auth.uid())'
          ),
          ', auth.uid()', ', (select auth.uid())'
        ) as new_qual,
        replace(
          replace(
            replace(coalesce(with_check, ''), 'auth.uid() =', '(select auth.uid()) ='),
            '= auth.uid()', '= (select auth.uid())'
          ),
          ', auth.uid()', ', (select auth.uid())'
        ) as new_with_check
      from pg_policies
      where schemaname = 'public'
    ), changed as (
      select *
      from policy_text
      where (qual is not null and new_qual <> qual)
         or (with_check is not null and new_with_check <> with_check)
    )
    select format(
      'alter policy %I on %I.%I%s%s',
      policyname,
      schemaname,
      tablename,
      case when qual is not null then format(' using (%s)', new_qual) else '' end,
      case when with_check is not null then format(' with check (%s)', new_with_check) else '' end
    )
    from changed
    order by tablename, policyname, cmd
  loop
    execute generated_sql;
  end loop;
end $$;
