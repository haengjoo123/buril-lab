begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(12);

insert into public.waste_stream_catalog (code, display_name_ko, display_name_en, sort_order) values
  ('ORGANIC_NON_HALOGENATED', '비할로겐 유기 폐액', 'Non-halogenated organic waste', 40)
on conflict (code) do nothing;

insert into auth.users(id,email) values
  ('d1000000-0000-4000-8000-000000000001','pickup-admin@example.invalid'),
  ('d1000000-0000-4000-8000-000000000002','pickup-student@example.invalid'),
  ('d1000000-0000-4000-8000-000000000003','pickup-other-student@example.invalid'),
  ('d1000000-0000-4000-8000-000000000004','pickup-outsider@example.invalid'),
  ('d1000000-0000-4000-8000-000000000005','pickup-center@example.invalid'),
  ('d1000000-0000-4000-8000-000000000006','pickup-summary-center@example.invalid');
insert into public.labs(id,name) values
  ('d2000000-0000-4000-8000-000000000001','Pickup lab A'),
  ('d2000000-0000-4000-8000-000000000002','Pickup lab B');
insert into public.lab_members(lab_id,user_id,role) values
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','admin'),
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','student'),
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','student'),
  ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000004','researcher');

-- CENTER_1 manages waste for lab A. CENTER_2 is linked with the summary scope only.
insert into public.safety_centers (id, institution_name, institution_domain, center_name, status, created_by, verification_document_path) values
  ('d3000000-0000-4000-8000-000000000001', 'Pickup Univ', 'pickup.example', 'Waste center', 'approved', 'd1000000-0000-4000-8000-000000000005', null),
  ('d3000000-0000-4000-8000-000000000002', 'Pickup Univ', 'pickup.example', 'Summary center', 'approved', 'd1000000-0000-4000-8000-000000000006', null);
insert into public.safety_center_members (center_id, user_id, role) values
  ('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005', 'owner'),
  ('d3000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000006', 'owner');
insert into public.safety_center_lab_links (id, center_id, lab_id, status, scope) values
  ('d4000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'approved', array['summary','waste_management']),
  ('d4000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'approved', array['summary']);

select ok(
  not has_function_privilege('anon', 'public.request_waste_container_pickup_v1(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.cancel_waste_container_pickup_v1(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_safety_center_waste_pickups_v1(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.request_waste_container_pickup_v1(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.cancel_waste_container_pickup_v1(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_safety_center_waste_pickups_v1(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.audit_waste_container_pickup_v1(public.waste_containers,boolean)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.waste_containers', 'UPDATE'),
  'anon cannot reach pickup functions; clients only reach the public RPCs'
);

-- The admin registers two containers.
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
do $$
begin
  perform public.create_waste_container_v1('d2000000-0000-4000-8000-000000000001','ORGANIC_NON_HALOGENATED','pickup-1','Room 202',20000);
  perform public.create_waste_container_v1('d2000000-0000-4000-8000-000000000001','ORGANIC_NON_HALOGENATED','pickup-2',null,null);
end $$;
reset role;

-- A student asks for pickup; asking again keeps the first request.
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
do $$
declare
  v_id uuid := (select id from public.waste_containers where label = 'pickup-1');
  r jsonb;
  v_first timestamptz;
begin
  r := public.request_waste_container_pickup_v1(v_id, '  full,   please   collect ');
  if r->>'pickup_request_note' is distinct from 'full, please collect' then raise exception 'note was not normalized: %', r; end if;
  if r->>'pickup_requested_by' is distinct from 'd1000000-0000-4000-8000-000000000002' then raise exception 'requester missing: %', r; end if;
  v_first := (r->>'pickup_requested_at')::timestamptz;
  r := public.request_waste_container_pickup_v1(v_id, 'second note');
  if (r->>'pickup_requested_at')::timestamptz is distinct from v_first or r->>'pickup_request_note' <> 'full, please collect' then
    raise exception 'a repeated request replaced the first one: %', r;
  end if;
  begin
    perform public.request_waste_container_pickup_v1(v_id, repeat('x', 501));
    raise exception 'an over-long note was accepted';
  exception when sqlstate '22023' then if sqlerrm <> 'WASTE_CONTAINER_INVALID_INPUT' then raise; end if; end;
end $$;
reset role;
select is(
  (select count(*) from public.waste_containers where label = 'pickup-1' and pickup_requested_at is not null
     and pickup_requested_by = 'd1000000-0000-4000-8000-000000000002' and pickup_request_note = 'full, please collect'),
  1::bigint,
  'a lab member can request pickup, and a repeated request keeps the first one'
);

-- Another student cannot withdraw someone else's request.
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated"}';
set role authenticated;
select throws_ok(
  $$select public.cancel_waste_container_pickup_v1((select id from public.waste_containers where label = 'pickup-1'))$$,
  '42501', 'WASTE_CONTAINER_ADMIN_REQUIRED',
  'a member who did not ask cannot withdraw the request'
);
reset role;

-- A member of another lab can neither request nor withdraw.
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000004","role":"authenticated"}';
set role authenticated;
do $$
declare v_id uuid;
begin
  reset role;
  select id into v_id from public.waste_containers where label = 'pickup-2';
  set role authenticated;
  begin
    perform public.request_waste_container_pickup_v1(v_id, null);
    raise exception 'an outsider requested pickup';
  exception when insufficient_privilege then null; end;
  begin
    perform public.cancel_waste_container_pickup_v1(v_id);
    raise exception 'an outsider withdrew a request';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select is(
  (select count(*) from public.waste_containers where label = 'pickup-2' and pickup_requested_at is not null),
  0::bigint,
  'another lab cannot request pickup for this lab''s container'
);

-- The safety center that manages waste for the lab sees the request.
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000005","role":"authenticated"}';
set role authenticated;
select is(
  (select array_agg(label order by label) from public.get_safety_center_waste_pickups_v1('d3000000-0000-4000-8000-000000000001')),
  array['pickup-1'],
  'a center with the waste_management scope sees containers waiting for pickup'
);
select is(
  (select count(*) from public.get_safety_center_waste_pickups_v1('d3000000-0000-4000-8000-000000000002')),
  0::bigint,
  'a center member cannot read another center''s pickups'
);
reset role;

set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000006","role":"authenticated"}';
set role authenticated;
select is(
  (select count(*) from public.get_safety_center_waste_pickups_v1('d3000000-0000-4000-8000-000000000002')),
  0::bigint,
  'a link without the waste_management scope shows no pickups'
);
reset role;

update public.safety_center_lab_links set status = 'revoked' where id = 'd4000000-0000-4000-8000-000000000001';
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000005","role":"authenticated"}';
set role authenticated;
select is(
  (select count(*) from public.get_safety_center_waste_pickups_v1('d3000000-0000-4000-8000-000000000001')),
  0::bigint,
  'a revoked link shows no pickups'
);
reset role;

-- The requester withdraws; the admin withdraws another member's request.
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
do $$
declare
  v_one uuid := (select id from public.waste_containers where label = 'pickup-1');
  v_two uuid := (select id from public.waste_containers where label = 'pickup-2');
  r jsonb;
begin
  r := public.cancel_waste_container_pickup_v1(v_one);
  if r->>'pickup_requested_at' is not null then raise exception 'the requester could not withdraw: %', r; end if;
  perform public.request_waste_container_pickup_v1(v_one, null);
  perform public.request_waste_container_pickup_v1(v_two, 'second container');
end $$;
reset role;
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.cancel_waste_container_pickup_v1((select id from public.waste_containers where label = 'pickup-2'));
  if r->>'pickup_requested_at' is not null then raise exception 'the admin could not withdraw: %', r; end if;
end $$;
reset role;
select is(
  (select array_agg(label order by label) from public.waste_containers
   where lab_id = 'd2000000-0000-4000-8000-000000000001' and pickup_requested_at is not null),
  array['pickup-1'],
  'the requester and the lab admin can withdraw a request'
);

-- Collecting a container ends its request, and a collected container takes no new one.
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
do $$
declare v_one uuid := (select id from public.waste_containers where label = 'pickup-1');
begin
  perform public.set_waste_container_status_v1(v_one, 'sealed');
  if (select pickup_requested_at from public.waste_containers where id = v_one) is null then
    raise exception 'sealing dropped the pickup request';
  end if;
  perform public.set_waste_container_status_v1(v_one, 'collected', 'contractor A');
  begin
    perform public.request_waste_container_pickup_v1(v_one, null);
    raise exception 'a collected container accepted a pickup request';
  exception when sqlstate '55000' then if sqlerrm <> 'WASTE_CONTAINER_COLLECTED' then raise; end if; end;
end $$;
reset role;
select is(
  (select count(*) from public.waste_containers
   where label = 'pickup-1' and status = 'collected'
     and pickup_requested_at is null and pickup_requested_by is null and pickup_request_note is null),
  1::bigint,
  'collecting a container clears its pickup request'
);

select is(
  (select count(*) from public.audit_logs
   where entity_type = 'waste_container' and lab_id = 'd2000000-0000-4000-8000-000000000001'
     and diff_data->'pickup'->>'to' = 'requested'),
  3::bigint,
  'each new pickup request is written to audit_logs'
);
select ok(
  (select count(*) from public.audit_logs
   where entity_type = 'waste_container' and lab_id = 'd2000000-0000-4000-8000-000000000001'
     and diff_data->'pickup'->>'to' = 'none') = 2
  and not exists (
    select 1 from public.audit_logs
    where entity_type = 'waste_container' and lab_id = 'd2000000-0000-4000-8000-000000000001'
      and (before_data::text like '%please collect%' or after_data::text like '%please collect%' or diff_data::text like '%please collect%')
  ),
  'withdrawals are audited and the free-text note stays out of audit rows'
);

select * from finish();
rollback;
