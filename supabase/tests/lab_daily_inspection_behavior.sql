begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(7);

insert into auth.users(id,email) values
  ('e1000000-0000-4000-8000-000000000001','inspection-member@example.invalid'),
  ('e1000000-0000-4000-8000-000000000002','inspection-admin@example.invalid'),
  ('e1000000-0000-4000-8000-000000000003','inspection-outsider@example.invalid'),
  ('e1000000-0000-4000-8000-000000000004','inspection-center@example.invalid');
insert into public.labs(id,name) values
  ('e2000000-0000-4000-8000-000000000001','Inspection lab A'),
  ('e2000000-0000-4000-8000-000000000002','Inspection lab B'),
  ('e2000000-0000-4000-8000-000000000003','Inspection lab C');
insert into public.lab_members(lab_id,user_id,role) values
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','student'),
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','admin'),
  ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','researcher');

-- The center reads lab A and B through the summary scope; lab C is linked without it.
insert into public.safety_centers (id, institution_name, institution_domain, center_name, status, created_by, verification_document_path) values
  ('e3000000-0000-4000-8000-000000000001', 'Inspection Univ', 'inspection.example', 'Inspection center', 'approved', 'e1000000-0000-4000-8000-000000000004', null),
  ('e3000000-0000-4000-8000-000000000002', 'Inspection Univ', 'inspection.example', 'Other center', 'approved', 'e1000000-0000-4000-8000-000000000004', null);
insert into public.safety_center_members (center_id, user_id, role) values
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'owner');
insert into public.safety_center_lab_links (id, center_id, lab_id, status, scope) values
  ('e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'approved', array['summary']),
  ('e4000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002', 'approved', array['summary','risk_detail']),
  ('e4000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000003', 'approved', array['waste_management']),
  ('e4000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'approved', array['summary']);

select ok(
  not has_table_privilege('anon', 'public.lab_daily_inspections', 'SELECT')
  and has_table_privilege('authenticated', 'public.lab_daily_inspections', 'SELECT')
  and not has_table_privilege('authenticated', 'public.lab_daily_inspections', 'INSERT')
  and not has_table_privilege('authenticated', 'public.lab_daily_inspections', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.lab_daily_inspections', 'DELETE')
  and not has_function_privilege('anon', 'public.save_lab_daily_inspection_v1(uuid,text,jsonb,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_safety_center_inspection_summary_v1(uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.save_lab_daily_inspection_v1(uuid,text,jsonb,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_safety_center_inspection_summary_v1(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.daily_inspection_results_valid_v1(jsonb)', 'EXECUTE'),
  'clients read inspections but write only through the RPC, and anon reaches nothing'
);

-- A member records today's inspection, then the admin records it again the same day.
set request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.save_lab_daily_inspection_v1(
    'e2000000-0000-4000-8000-000000000001', 'kr-daily-v1',
    '{"general_tidy":"ok","chemical_waste":"bad","gas_storage":"na"}'::jsonb, '  lid open  ');
  if (r->>'issue_count')::integer <> 1 or r->>'note' <> 'lid open'
     or (r->>'inspection_date')::date <> (now() at time zone 'Asia/Seoul')::date then
    raise exception 'unexpected first save: %', r;
  end if;
  begin
    perform public.save_lab_daily_inspection_v1('e2000000-0000-4000-8000-000000000001', 'kr-daily-v1', '{"general_tidy":"fine"}'::jsonb, null);
    raise exception 'an unknown result value was accepted';
  exception when sqlstate '22023' then if sqlerrm <> 'DAILY_INSPECTION_INVALID_INPUT' then raise; end if; end;
  begin
    perform public.save_lab_daily_inspection_v1('e2000000-0000-4000-8000-000000000001', 'kr-daily-v1', '{}'::jsonb, null);
    raise exception 'an empty result set was accepted';
  exception when sqlstate '22023' then if sqlerrm <> 'DAILY_INSPECTION_INVALID_INPUT' then raise; end if; end;
  begin
    perform public.save_lab_daily_inspection_v1('e2000000-0000-4000-8000-000000000001', 'kr-daily-v1', '{"general_tidy":"ok"}'::jsonb, repeat('x', 1001));
    raise exception 'an over-long note was accepted';
  exception when sqlstate '22023' then if sqlerrm <> 'DAILY_INSPECTION_INVALID_INPUT' then raise; end if; end;
end $$;
reset role;
set request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
do $$
begin
  perform public.save_lab_daily_inspection_v1('e2000000-0000-4000-8000-000000000001', 'kr-daily-v1', '{"general_tidy":"ok","chemical_waste":"ok"}'::jsonb, null);
end $$;
reset role;
select is(
  (select count(*) from public.lab_daily_inspections
   where lab_id = 'e2000000-0000-4000-8000-000000000001' and issue_count = 0 and note is null
     and inspected_by = 'e1000000-0000-4000-8000-000000000002'),
  1::bigint,
  'saving again on the same day replaces that day''s record'
);
select is(
  (select count(*) from public.lab_daily_inspections where lab_id = 'e2000000-0000-4000-8000-000000000001'),
  1::bigint,
  'a lab has one inspection record per day'
);

-- Another lab's member can neither record nor read lab A's inspections.
set request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated"}';
set role authenticated;
select throws_ok(
  $$select public.save_lab_daily_inspection_v1('e2000000-0000-4000-8000-000000000001', 'kr-daily-v1', '{"general_tidy":"ok"}'::jsonb, null)$$,
  '42501', 'DAILY_INSPECTION_ACCESS_DENIED',
  'a member of another lab cannot record this lab''s inspection'
);
select is((select count(*) from public.lab_daily_inspections), 0::bigint, 'another lab cannot read this lab''s inspections');
do $$
begin
  perform public.save_lab_daily_inspection_v1('e2000000-0000-4000-8000-000000000002', 'kr-daily-v1', '{"fire_exit":"bad"}'::jsonb, null);
end $$;
reset role;

-- Earlier days, written as the table owner: one with issues, one outside a 30-day window.
insert into public.lab_daily_inspections(lab_id, inspection_date, checklist_version, results, issue_count)
select 'e2000000-0000-4000-8000-000000000001', (now() at time zone 'Asia/Seoul')::date - n, 'kr-daily-v1',
       '{"general_tidy":"ok"}'::jsonb, case when n = 2 then 3 else 0 end
from unnest(array[1, 2, 40]) as n;

set request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000004","role":"authenticated"}';
set role authenticated;
select is(
  (select array_agg(lab_name || ':' || inspected_days || ':' || issue_days order by lab_name)
   from public.get_safety_center_inspection_summary_v1('e3000000-0000-4000-8000-000000000001')),
  array['Inspection lab A:3:1', 'Inspection lab B:1:1'],
  'a center reads per-lab counts for summary-scoped labs within the period'
);
select is(
  (select count(*) from public.get_safety_center_inspection_summary_v1('e3000000-0000-4000-8000-000000000002')),
  0::bigint,
  'a center member cannot read another center''s summary'
);
reset role;

select * from finish();
rollback;
