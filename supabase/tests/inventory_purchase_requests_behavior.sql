begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(10);

insert into auth.users(id,email) values
  ('e1000000-0000-4000-8000-000000000001','purchase-admin@example.invalid'),
  ('e1000000-0000-4000-8000-000000000002','purchase-student@example.invalid'),
  ('e1000000-0000-4000-8000-000000000003','purchase-outsider@example.invalid');
insert into public.labs(id,name) values
  ('e2000000-0000-4000-8000-000000000001','Purchase lab'),
  ('e2000000-0000-4000-8000-000000000002','Purchase other lab');
insert into public.lab_members(lab_id,user_id,role) values
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','admin'),
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','student'),
  ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','researcher');
insert into public.inventory(id, lab_id, user_id, name, quantity) values
  ('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Acetone',2);

select ok(
  not has_table_privilege('authenticated', 'public.inventory_purchase_requests', 'SELECT')
  and not has_table_privilege('authenticated', 'public.inventory_purchase_requests', 'INSERT')
  and not has_function_privilege('anon', 'public.create_inventory_purchase_request_v1(uuid,text,integer,text,text,text,text,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.update_inventory_purchase_request_v1(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_inventory_purchase_requests_v1(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_inventory_usage_counts_v1(uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_inventory_purchase_request_v1(uuid,text,integer,text,text,text,text,text,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.purchase_request_json_v1(public.inventory_purchase_requests)', 'EXECUTE'),
  'clients reach purchase requests only through the public RPCs'
);

set request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
select is(
  (public.create_inventory_purchase_request_v1('e2000000-0000-4000-8000-000000000001', ' Acetone ', 2, null, null, '67-64-1', '500 mL', null, 'e3000000-0000-4000-8000-000000000001'))->>'status',
  'requested',
  'a lab member asks for a reagent'
);
select is(
  (select jsonb_array_length(public.list_inventory_purchase_requests_v1('e2000000-0000-4000-8000-000000000001'))),
  1,
  'asking again for the same bottle keeps one open request'
);
select throws_ok(
  $$select public.update_inventory_purchase_request_v1((select (public.list_inventory_purchase_requests_v1('e2000000-0000-4000-8000-000000000001')->0->>'id')::uuid), 'approved')$$,
  '42501', 'PURCHASE_REQUEST_ADMIN_REQUIRED',
  'a member cannot approve'
);
reset role;

set request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated"}';
set role authenticated;
select throws_ok(
  $$select public.list_inventory_purchase_requests_v1('e2000000-0000-4000-8000-000000000001')$$,
  '42501', 'PURCHASE_REQUEST_ACCESS_DENIED',
  'another lab cannot read the requests'
);
select throws_ok(
  $$select public.create_inventory_purchase_request_v1('e2000000-0000-4000-8000-000000000001', 'Acetone')$$,
  '42501', 'PURCHASE_REQUEST_ACCESS_DENIED',
  'another lab cannot ask'
);
reset role;

set request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
select throws_ok(
  $$select public.update_inventory_purchase_request_v1((select (public.list_inventory_purchase_requests_v1('e2000000-0000-4000-8000-000000000001')->0->>'id')::uuid), 'received')$$,
  '55000', 'PURCHASE_REQUEST_INVALID_TRANSITION',
  'arrival cannot be recorded before approval and ordering'
);
select is(
  (public.update_inventory_purchase_request_v1((select (public.list_inventory_purchase_requests_v1('e2000000-0000-4000-8000-000000000001')->0->>'id')::uuid), 'approved', 'vendor A'))->>'status',
  'approved',
  'the lab admin approves'
);
select is(
  (select count(*) from public.get_inventory_usage_counts_v1('e2000000-0000-4000-8000-000000000001', 180)),
  0::bigint,
  'a lab without completed bottles has no usage counts'
);
reset role;

select is(
  (select count(*) from public.audit_logs
   where entity_type = 'purchase_request'
     and lab_id = 'e2000000-0000-4000-8000-000000000001'
     and coalesce(after_data::text, '') not like '%vendor A%'),
  2::bigint,
  'asking and approving are audited without the note'
);

select * from finish();
rollback;
