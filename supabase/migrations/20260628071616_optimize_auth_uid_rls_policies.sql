set local search_path = public, auth;

do $$
declare
  policy_record record;
  new_qual text;
  new_with_check text;
begin
  for policy_record in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    new_qual := policy_record.qual;
    new_with_check := policy_record.with_check;

    if new_qual is not null then
      new_qual := replace(new_qual, 'auth.uid() =', '(select auth.uid()) =');
      new_qual := replace(new_qual, '= auth.uid()', '= (select auth.uid())');
      new_qual := replace(new_qual, ', auth.uid()', ', (select auth.uid())');
    end if;

    if new_with_check is not null then
      new_with_check := replace(new_with_check, 'auth.uid() =', '(select auth.uid()) =');
      new_with_check := replace(new_with_check, '= auth.uid()', '= (select auth.uid())');
      new_with_check := replace(new_with_check, ', auth.uid()', ', (select auth.uid())');
    end if;

    if (policy_record.qual is not null and new_qual <> policy_record.qual)
      or (policy_record.with_check is not null and new_with_check <> policy_record.with_check) then
      execute format(
        'alter policy %I on %I.%I%s%s',
        policy_record.policyname,
        policy_record.schemaname,
        policy_record.tablename,
        case
          when policy_record.qual is not null then format(' using (%s)', new_qual)
          else ''
        end,
        case
          when policy_record.with_check is not null then format(' with check (%s)', new_with_check)
          else ''
        end
      );
    end if;
  end loop;
end $$;
