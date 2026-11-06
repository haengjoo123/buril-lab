begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(65);

-- Fixed fixture (prefix f3). Users: 01 admin, 02 member, 03 other, 04 leaver,
-- 05 outsider, 06 joiner, 07 center owner, 08 doomed, 09 operator, 10 no role,
-- 11 self-deleting account. Labs: 0a = LAB_A, 0b = LAB_B (deleted at the end),
-- 0c = LAB_C. Centers: 1 approved, 2 pending applicant, 3 another approved center.
insert into public.waste_stream_catalog (code, display_name_ko, display_name_en, sort_order) values
  ('ORGANIC_NON_HALOGENATED', '비할로겐 유기 폐액', 'Non-halogenated organic waste', 40)
on conflict (code) do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('f3000000-0000-4000-8000-000000000001', 'f3-admin@example.invalid', '{}'),
  ('f3000000-0000-4000-8000-000000000002', 'f3-member@example.invalid', '{}'),
  ('f3000000-0000-4000-8000-000000000003', 'f3-other@example.invalid', '{}'),
  ('f3000000-0000-4000-8000-000000000004', 'f3-leaver@example.invalid', '{}'),
  ('f3000000-0000-4000-8000-000000000005', 'f3-outsider@example.invalid', '{}'),
  ('f3000000-0000-4000-8000-000000000006', 'f3-joiner@example.invalid', '{}'),
  ('f3000000-0000-4000-8000-000000000007', 'f3-center@example.invalid', '{"full_name": "Center Person"}'),
  ('f3000000-0000-4000-8000-000000000008', 'f3-doomed@example.invalid', '{}'),
  ('f3000000-0000-4000-8000-000000000009', 'f3-operator@example.invalid', '{}'),
  ('f3000000-0000-4000-8000-000000000010', 'f3-norole@example.invalid', '{}'),
  ('f3000000-0000-4000-8000-000000000011', 'f3-selfdel@example.invalid', '{}');

insert into public.labs (id, name, institution_name) values
  ('f3100000-0000-4000-8000-00000000000a', 'F3 audit lab A', 'Audit Univ'),
  ('f3100000-0000-4000-8000-00000000000b', 'F3 audit lab B', 'Audit Univ'),
  ('f3100000-0000-4000-8000-00000000000c', 'F3 audit lab C', 'Other Univ');

insert into public.lab_members (lab_id, user_id, role, nickname) values
  ('f3100000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000001', 'admin', 'Admin A'),
  ('f3100000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000002', 'student', null),
  ('f3100000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000003', 'researcher', null),
  ('f3100000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000004', 'student', null),
  ('f3100000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000008', 'student', null),
  ('f3100000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000011', 'student', null),
  ('f3100000-0000-4000-8000-00000000000b', 'f3000000-0000-4000-8000-000000000001', 'admin', null),
  ('f3100000-0000-4000-8000-00000000000b', 'f3000000-0000-4000-8000-000000000003', 'student', null),
  ('f3100000-0000-4000-8000-00000000000c', 'f3000000-0000-4000-8000-000000000005', 'student', null);

insert into public.safety_centers (id, institution_name, institution_domain, center_name, status, created_by, verification_document_path) values
  ('f3200000-0000-4000-8000-000000000001', 'Audit Univ', 'audit.example', 'Audit center', 'approved', 'f3000000-0000-4000-8000-000000000007', null),
  ('f3200000-0000-4000-8000-000000000002', 'Audit Univ', 'audit.example', 'Audit center 2', 'pending', 'f3000000-0000-4000-8000-000000000007', 'f3/doc.pdf'),
  ('f3200000-0000-4000-8000-000000000003', 'Audit Univ', 'audit.example', 'Other center', 'approved', 'f3000000-0000-4000-8000-000000000007', null);
insert into public.safety_center_members (center_id, user_id, role) values
  ('f3200000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000007', 'owner'),
  ('f3200000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000007', 'owner');

-- LINK_C3A (another center's link to LAB_A) and LINK_C1B (CENTER_1's link to LAB_B).
insert into public.safety_center_lab_links (id, center_id, lab_id, status, scope) values
  ('f3300000-0000-4000-8000-000000000001', 'f3200000-0000-4000-8000-000000000003', 'f3100000-0000-4000-8000-00000000000a', 'approved', array['summary']),
  ('f3300000-0000-4000-8000-000000000002', 'f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000b', 'approved', array['summary']);
insert into public.waste_policy_lab_overrides (id, lab_id, stream_code, container_label) values
  ('f3700000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000b', 'ORGANIC_NON_HALOGENATED', 'B organic'),
  ('f3700000-0000-4000-8000-000000000002', 'f3100000-0000-4000-8000-00000000000c', 'ORGANIC_NON_HALOGENATED', 'C organic');

insert into public.audit_logs (actor_user_id, actor_name, lab_id, entity_type, entity_id, action, after_data) values
  ('f3000000-0000-4000-8000-000000000001', 'Admin A', 'f3100000-0000-4000-8000-00000000000a', 'inventory',
   'f3400000-0000-4000-8000-000000000001', 'create', '{"name": "Acetone"}');

insert into public.waste_logs (id, lab_id, user_id, chemicals, disposal_category, voided_at, voided_by, void_reason) values
  ('f3500000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000001', '[]', 'organic', null, null, null),
  ('f3500000-0000-4000-8000-000000000002', 'f3100000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000001', '[]', 'organic', now(), 'f3000000-0000-4000-8000-000000000001', 'fixture');

insert into public.safety_center_requests (id, center_id, lab_id, title, status) values
  ('f3600000-0000-4000-8000-000000000001', 'f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000a', 'F3 request 1', 'submitted'),
  ('f3600000-0000-4000-8000-000000000002', 'f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000a', 'F3 request 2', 'open'),
  ('f3600000-0000-4000-8000-000000000003', 'f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000a', 'F3 request 3', 'submitted');

insert into public.feedback (id, message, user_id, lab_id, source_screen) values
  ('f3800000-0000-4000-8000-000000000001', 'f3 fixture', 'f3000000-0000-4000-8000-000000000008', 'f3100000-0000-4000-8000-00000000000a', 'logs'),
  ('f3800000-0000-4000-8000-000000000002', 'f3 fixture', 'f3000000-0000-4000-8000-000000000011', 'f3100000-0000-4000-8000-00000000000a', 'search'),
  ('f3800000-0000-4000-8000-000000000003', 'f3 fixture', null, 'f3100000-0000-4000-8000-00000000000b', null);

insert into private.operator_role_assignments_v1 (user_id, role, reason_code) values
  ('f3000000-0000-4000-8000-000000000009', 'approver', 'PHASE3_FIXTURE');

create temp table f3_rpc (k text primary key, r jsonb not null) on commit drop;
grant select, insert on f3_rpc to anon, authenticated, service_role;

-- Structure ---------------------------------------------------------------------

-- 1
select ok(
  (select p.prosecdef and 'search_path=""' = any(p.proconfig)
     from pg_catalog.pg_proc p where p.oid = 'private.audit_lab_admin_change_v1()'::regprocedure),
  'the audit trigger function is a SECURITY DEFINER with an empty search_path');
-- 2
select is(
  (select count(*) from unnest(array[
      'private.audit_lab_admin_change_v1()',
      'private.lab_audit_actor_name_v1(uuid,uuid)',
      'private.feedback_clear_lab_on_user_detach_v1()']) signature
    cross join unnest(array['anon', 'authenticated', 'service_role']) role_name
    where has_function_privilege(role_name, signature, 'EXECUTE')),
  0::bigint, 'no API role executes the new private helpers');
-- 3
select is(
  (select count(*) from pg_catalog.pg_trigger t
    join (values
      ('public.lab_members'::regclass, 'lab_members_audit_admin_change_v1', 'private.audit_lab_admin_change_v1()'::regprocedure),
      ('public.safety_center_lab_links'::regclass, 'safety_center_lab_links_audit_admin_change_v1', 'private.audit_lab_admin_change_v1()'::regprocedure),
      ('public.waste_policy_lab_overrides'::regclass, 'waste_policy_lab_overrides_audit_admin_change_v1', 'private.audit_lab_admin_change_v1()'::regprocedure),
      ('public.feedback'::regclass, 'feedback_clear_lab_on_user_detach_v1', 'private.feedback_clear_lab_on_user_detach_v1()'::regprocedure)
    ) as expected(rel, trigger_name, fn)
      on t.tgrelid = expected.rel::oid and t.tgname::text = expected.trigger_name and t.tgfoid = expected.fn::oid
    where not t.tgisinternal),
  4::bigint, 'the three audit triggers and the feedback detach trigger are installed');
-- 4
select ok(
  has_function_privilege('service_role', 'public.join_lab_server_v2(uuid,uuid,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.join_lab_server_v2(uuid,uuid,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.join_lab_server_v2(uuid,uuid,text,text,text,text)', 'EXECUTE')
  and (select p.prosecdef and 'search_path=""' = any(p.proconfig)
         from pg_catalog.pg_proc p where p.oid = 'public.join_lab_server_v2(uuid,uuid,text,text,text,text)'::regprocedure),
  'join_lab_server_v2 is a service-only SECURITY DEFINER with an empty search_path');
-- 5
select ok(
  has_function_privilege('service_role', 'public.operator_safety_center_status_v2(uuid,uuid,text,uuid,text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.operator_safety_center_status_v2(uuid,uuid,text,uuid,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.operator_safety_center_status_v2(uuid,uuid,text,uuid,text,text,text)', 'EXECUTE')
  and (select p.prosecdef and 'search_path=""' = any(p.proconfig) and 'lock_timeout=5s' = any(p.proconfig)
         from pg_catalog.pg_proc p where p.oid = 'public.operator_safety_center_status_v2(uuid,uuid,text,uuid,text,text,text)'::regprocedure),
  'operator_safety_center_status_v2 is a service-only SECURITY DEFINER with fixed search_path and lock timeout');
-- 6
select ok(
  has_function_privilege('authenticated', 'public.get_my_safety_centers()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.get_my_safety_centers()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_my_safety_centers()', 'EXECUTE')
  and (select p.prosecdef and pg_catalog.pg_get_function_result(p.oid) like '%review_reason text, review_note text)'
         from pg_catalog.pg_proc p where p.oid = 'public.get_my_safety_centers()'::regprocedure),
  'the recreated get_my_safety_centers keeps its grants and returns the review columns');
-- 7
select is(
  (select count(*) from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid in (
        'public.join_lab_server_v2(uuid,uuid,text,text,text,text)'::regprocedure,
        'public.operator_safety_center_status_v2(uuid,uuid,text,uuid,text,text,text)'::regprocedure,
        'public.get_my_safety_centers()'::regprocedure,
        'public.add_safety_center_request_event(uuid,text,text)'::regprocedure,
        'public.request_safety_center_lab_link(uuid,uuid,text[])'::regprocedure,
        'public.get_safety_center_waste_logs(uuid,timestamptz,timestamptz)'::regprocedure,
        'public.get_safety_center_audit_logs(uuid,integer)'::regprocedure)
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  0::bigint, 'PUBLIC executes none of the new or redefined public functions');
-- 8
select ok(
  (select count(*) from pg_catalog.pg_policy
    where polrelid = 'public.audit_logs'::regclass and polcmd = 'r'
      and polname in ('Users can view audit_logs for their labs', 'audit_logs_select_lab_member_admin_v1')) = 2
  and (select count(*) from pg_catalog.pg_policy
    where polrelid = 'public.audit_logs'::regclass and polcmd in ('u', 'd')) = 0,
  'audit_logs keeps the member read policy, adds the admin-only member-record policy, and stays append-only');
-- 9
select ok(
  exists (select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.feedback'::regclass and c.contype = 'f'
      and c.confrelid = 'public.labs'::regclass and c.confdeltype = 'n'
      and c.conkey = array[(select a.attnum from pg_catalog.pg_attribute a
                            where a.attrelid = 'public.feedback'::regclass and a.attname = 'lab_id')])
  and exists (select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.feedback'::regclass and c.conname = 'feedback_source_screen_check')
  and exists (select 1 from pg_catalog.pg_indexes i
    where i.schemaname = 'public' and i.tablename = 'feedback' and i.indexname = 'feedback_lab_id_idx'),
  'feedback.lab_id references labs with ON DELETE SET NULL, source_screen is a closed list, lab_id is indexed');
-- 10
select is(
  (select count(*) from pg_catalog.pg_constraint c
    where c.conrelid = 'public.safety_centers'::regclass
      and c.conname in ('safety_centers_review_reason_check', 'safety_centers_review_note_check')),
  2::bigint, 'safety-center review reason and note are constrained');

-- Member events (LAB_A) -----------------------------------------------------------

set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
-- 11
select lives_ok(
  $$select public.update_lab_member_role('f3100000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000002', 'researcher')$$,
  'a lab admin changes a member role');
reset role;
-- 12
select ok(
  (select count(*) = 1 and bool_and(
      a.entity_id = (select m.id from public.lab_members m
                     where m.lab_id = 'f3100000-0000-4000-8000-00000000000a' and m.user_id = 'f3000000-0000-4000-8000-000000000002')
      and a.actor_user_id = 'f3000000-0000-4000-8000-000000000001'
      and a.actor_name = 'Admin A'
      and a.before_data = '{"user_id": "f3000000-0000-4000-8000-000000000002", "role": "student"}'::jsonb
      and a.after_data = '{"user_id": "f3000000-0000-4000-8000-000000000002", "role": "researcher"}'::jsonb
      and a.diff_data = '{"role": {"from": "student", "to": "researcher"}}'::jsonb
      and a.source = 'database'
      and a.location_context is null)
    from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'lab_member' and a.action = 'role_change'),
  'a role change writes one member record with the account id, both roles and the admin nickname');

set role authenticated;
select public.update_lab_member_role('f3100000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000002', 'researcher');
reset role;
-- 13
select is(
  (select count(*) from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'lab_member' and a.action = 'role_change'),
  1::bigint, 'setting the same role again writes no record');

set role authenticated;
select public.remove_lab_member('f3100000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000003');
reset role;
-- 14
select ok(
  (select count(*) = 1 and bool_and(
      a.actor_user_id = 'f3000000-0000-4000-8000-000000000001'
      and a.actor_name = 'Admin A'
      and a.before_data = '{"user_id": "f3000000-0000-4000-8000-000000000003", "role": "researcher"}'::jsonb
      and a.after_data is null and a.diff_data is null)
    from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'lab_member' and a.action = 'remove'),
  'removing a member writes one remove record');

set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000004","role":"authenticated"}';
set role authenticated;
delete from public.lab_members
where lab_id = 'f3100000-0000-4000-8000-00000000000a' and user_id = 'f3000000-0000-4000-8000-000000000004';
reset role;
-- 15
select ok(
  not exists (select 1 from public.lab_members m
    where m.lab_id = 'f3100000-0000-4000-8000-00000000000a' and m.user_id = 'f3000000-0000-4000-8000-000000000004')
  and (select count(*) = 1 and bool_and(
      a.actor_user_id = 'f3000000-0000-4000-8000-000000000004'
      and a.before_data = '{"user_id": "f3000000-0000-4000-8000-000000000004", "role": "student"}'::jsonb
      and a.after_data is null)
    from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'lab_member' and a.action = 'leave'),
  'a member deleting their own membership through RLS writes one leave record');

set request.jwt.claims = '{"role":"service_role"}';
set role service_role;
delete from public.lab_members where user_id = 'f3000000-0000-4000-8000-000000000008';
delete from public.waste_policy_lab_overrides where id = 'f3700000-0000-4000-8000-000000000002';
reset role;
-- 16
select is(
  (select count(*) from public.audit_logs a
    where a.before_data ->> 'user_id' = 'f3000000-0000-4000-8000-000000000008'
       or a.after_data ->> 'user_id' = 'f3000000-0000-4000-8000-000000000008')
  + (select count(*) from public.lab_members m where m.user_id = 'f3000000-0000-4000-8000-000000000008')
  + (select count(*) from public.audit_logs a
    where a.entity_id = 'f3700000-0000-4000-8000-000000000002' and a.action = 'delete')
  + (select count(*) from public.waste_policy_lab_overrides o where o.id = 'f3700000-0000-4000-8000-000000000002'),
  0::bigint, 'a delete without a caller (deletion worker, service maintenance) removes memberships and site settings without a record');

set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000011","role":"authenticated"}';
delete from auth.users where id = 'f3000000-0000-4000-8000-000000000011';
-- 17
select is(
  (select count(*) from public.audit_logs a
    where a.actor_user_id = 'f3000000-0000-4000-8000-000000000011'
       or a.before_data ->> 'user_id' = 'f3000000-0000-4000-8000-000000000011'
       or a.after_data ->> 'user_id' = 'f3000000-0000-4000-8000-000000000011')
  + (select count(*) from public.lab_members m where m.user_id = 'f3000000-0000-4000-8000-000000000011'),
  0::bigint, 'an account deleted with its own session (legacy delete_user) leaves no member record behind');
-- 18
select ok(
  (select f.user_id is null and f.lab_id is null
    from public.feedback f where f.id = 'f3800000-0000-4000-8000-000000000002'),
  'the Auth deletion clears the feedback account and its lab link together');

set request.jwt.claims = '{"role":"service_role"}';
set role service_role;
-- 19
select is(
  public.join_lab_server_v2('f3000000-0000-4000-8000-000000000006', 'f3100000-0000-4000-8000-00000000000a', '',
    repeat('a', 64), repeat('b', 64), 'New member'),
  '{"success": true, "lab_id": "f3100000-0000-4000-8000-00000000000a"}'::jsonb,
  'the server join v2 returns the v1 result');
reset role;
-- 20
select ok(
  (select count(*) = 1 and bool_and(
      a.actor_user_id = 'f3000000-0000-4000-8000-000000000006'
      and a.actor_name = 'New member'
      and a.before_data is null
      and a.after_data = '{"user_id": "f3000000-0000-4000-8000-000000000006", "role": "student"}'::jsonb
      and a.diff_data is null
      and a.source = 'database'
      and a.entity_id = (select m.id from public.lab_members m
                         where m.lab_id = 'f3100000-0000-4000-8000-00000000000a' and m.user_id = 'f3000000-0000-4000-8000-000000000006'))
    from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'lab_member' and a.action = 'join'),
  'a successful server join writes one join record naming the new member');
set role service_role;
-- 21
select is(
  public.join_lab_server_v2('f3000000-0000-4000-8000-000000000006', 'f3100000-0000-4000-8000-00000000000a', '',
    repeat('a', 64), repeat('b', 64), 'New member'),
  '{"success": false, "code": "already_member"}'::jsonb,
  'joining again returns the v1 already_member result');
reset role;
-- 22
select is(
  (select count(*) from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'lab_member' and a.action = 'join'),
  1::bigint, 'an unsuccessful join writes no record');

set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
-- 23
select throws_ok(
  $$select public.join_lab_server_v2('f3000000-0000-4000-8000-000000000005', 'f3100000-0000-4000-8000-00000000000a', '', repeat('a', 64), repeat('b', 64), null)$$,
  '42501', null, 'a browser session cannot call the server join');
reset role;

-- Center links (CENTER_1 to LAB_A) --------------------------------------------------

set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000007","role":"authenticated"}';
set role authenticated;
select public.request_safety_center_lab_link('f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000a', array['summary', 'risk_detail']);
reset role;
-- 24
select ok(
  (select l.status = 'requested' from public.safety_center_lab_links l
    where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a')
  and (select count(*) = 1 and bool_and(
      a.actor_user_id = 'f3000000-0000-4000-8000-000000000007'
      and a.actor_name = 'Audit center'
      and a.lab_id = 'f3100000-0000-4000-8000-00000000000a'
      and a.before_data is null and a.diff_data is null
      and a.after_data = '{"status": "requested", "scope": ["summary", "risk_detail"], "center_name": "Audit center"}'::jsonb)
    from public.audit_logs a
    where a.entity_type = 'safety_center_link' and a.action = 'link_request'
      and a.entity_id = (select l.id from public.safety_center_lab_links l
        where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a'))
  and (select count(*) = 1 and bool_and(a.actor_user_id is null and a.actor_name is null and a.action = 'link_approve')
    from public.audit_logs a
    where a.entity_type = 'safety_center_link' and a.entity_id = 'f3300000-0000-4000-8000-000000000001'),
  'a center link request writes one record named after the center, not the person; a link written without a caller has no actor');

set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
select public.respond_safety_center_lab_link(
  (select l.id from public.safety_center_lab_links l
    where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a'),
  'approved');
reset role;
-- 25
select ok(
  (select count(*) = 1 and bool_and(
      a.actor_user_id = 'f3000000-0000-4000-8000-000000000001'
      and a.actor_name = 'Admin A'
      and a.before_data = '{"status": "requested", "scope": ["summary", "risk_detail"]}'::jsonb
      and a.diff_data = '{"status": {"from": "requested", "to": "approved"}}'::jsonb)
    from public.audit_logs a
    where a.entity_type = 'safety_center_link' and a.action = 'link_approve'
      and a.entity_id = (select l.id from public.safety_center_lab_links l
        where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a')),
  'a lab admin approving the link writes one approve record with the status change');

set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000007","role":"authenticated"}';
set role authenticated;
select public.request_safety_center_lab_link('f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000a', array['risk_detail', 'summary']);
reset role;
-- 26
select ok(
  (select l.status = 'approved' from public.safety_center_lab_links l
    where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a')
  and (select count(*) = 2 from public.audit_logs a
    where a.entity_type = 'safety_center_link'
      and a.entity_id = (select l.id from public.safety_center_lab_links l
        where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a')),
  'requesting the same scope set again keeps the link approved and writes no record');

set role authenticated;
select public.request_safety_center_lab_link('f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000a', array['summary']);
reset role;
-- 27
select ok(
  (select l.status = 'approved' and l.scope = array['summary'] and l.approved_by = 'f3000000-0000-4000-8000-000000000001'
    from public.safety_center_lab_links l
    where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a')
  and (select count(*) = 1 and bool_and(
      a.diff_data = '{"scope": {"from": ["risk_detail", "summary"], "to": ["summary"]}}'::jsonb
      and a.after_data = '{"status": "approved", "scope": ["summary"], "center_name": "Audit center"}'::jsonb)
    from public.audit_logs a
    where a.entity_type = 'safety_center_link' and a.action = 'scope_change'
      and a.entity_id = (select l.id from public.safety_center_lab_links l
        where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a')),
  'narrowing the scope keeps the approval and writes one scope_change record');

set role authenticated;
-- 28
select is(
  (select array_agg(w.id) from public.get_safety_center_waste_logs('f3200000-0000-4000-8000-000000000001') w
    where w.lab_id = 'f3100000-0000-4000-8000-00000000000a'),
  array['f3500000-0000-4000-8000-000000000001']::uuid[],
  'the center waste log view leaves voided records out');
-- 29
select ok(
  (with r as (
     select * from public.get_safety_center_audit_logs('f3200000-0000-4000-8000-000000000001', 1000) x
     where x.lab_id = 'f3100000-0000-4000-8000-00000000000a')
   select exists (select 1 from r where r.entity_type = 'inventory' and r.entity_id = 'f3400000-0000-4000-8000-000000000001')
     and not exists (select 1 from r where r.entity_type = 'lab_member')
     and not exists (select 1 from r where r.entity_id = 'f3300000-0000-4000-8000-000000000001')
     and exists (select 1 from r where r.entity_id = (select l.id from public.safety_center_lab_links l
       where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a'))),
  'a center audit view shows lab records and its own link, never member records or another center''s link');
select public.request_safety_center_lab_link('f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000a', array['summary', 'exports']);
reset role;
-- 30
select ok(
  (select l.status = 'requested' and l.approved_by is null and l.responded_at is null
    from public.safety_center_lab_links l
    where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a')
  and (select count(*) = 1 and bool_and(
      a.diff_data = '{"status": {"from": "approved", "to": "requested"}, "scope": {"from": ["summary"], "to": ["summary", "exports"]}}'::jsonb)
    from public.audit_logs a
    where a.entity_type = 'safety_center_link' and a.action = 'link_request' and a.diff_data is not null
      and a.entity_id = (select l.id from public.safety_center_lab_links l
        where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a')),
  'widening an approved scope returns the link to requested and records both changes');
set role authenticated;
do $$
begin
  begin
    perform public.request_safety_center_lab_link('f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000a', array['summary', 'everything']);
    insert into f3_rpc values ('scope_unknown', '"accepted"');
  exception when others then
    insert into f3_rpc values ('scope_unknown', pg_catalog.to_jsonb(sqlstate || ' ' || sqlerrm));
  end;
  begin
    perform public.request_safety_center_lab_link('f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000a', array[]::text[]);
    insert into f3_rpc values ('scope_empty', '"accepted"');
  exception when others then
    insert into f3_rpc values ('scope_empty', pg_catalog.to_jsonb(sqlstate || ' ' || sqlerrm));
  end;
  begin
    perform public.request_safety_center_lab_link('f3200000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-00000000000a', array['summary', null]);
    insert into f3_rpc values ('scope_null', '"accepted"');
  exception when others then
    insert into f3_rpc values ('scope_null', pg_catalog.to_jsonb(sqlstate || ' ' || sqlerrm));
  end;
end $$;
reset role;
-- 31
select ok(
  (select count(*) = 3 and bool_and(f.r = '"22023 Unsupported link scope"'::jsonb)
    from f3_rpc f where f.k in ('scope_unknown', 'scope_empty', 'scope_null')),
  'unknown, empty and null scope values are rejected with 22023');

-- Waste-container site settings (LAB_A) ---------------------------------------------

set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
select public.upsert_lab_waste_stream_override_v2('f3100000-0000-4000-8000-00000000000a', 'ORGANIC_NON_HALOGENATED',
  'Org 1', null, 'Room 2', '010-1234-5678', null, false);
reset role;
-- 32
select ok(
  (select count(*) = 1 and bool_and(
      a.actor_user_id = 'f3000000-0000-4000-8000-000000000001'
      and a.actor_name = 'Admin A'
      and a.before_data is null and a.diff_data is null
      and a.after_data = '{"stream_code": "ORGANIC_NON_HALOGENATED", "is_disabled": false, "changed_fields": ["container_label", "handler_contact", "location"]}'::jsonb
      and pg_catalog.strpos(coalesce(a.before_data::text, '') || coalesce(a.after_data::text, '') || coalesce(a.diff_data::text, ''), '010-1234-5678') = 0
      and pg_catalog.strpos(coalesce(a.before_data::text, '') || coalesce(a.after_data::text, '') || coalesce(a.diff_data::text, ''), 'Room 2') = 0)
    from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'waste_policy_override' and a.action = 'create'),
  'saving site settings records the changed field names, never the contact or location');

set role authenticated;
-- identical, then the label only, then disabled with a replacement location
select public.upsert_lab_waste_stream_override_v2('f3100000-0000-4000-8000-00000000000a', 'ORGANIC_NON_HALOGENATED',
  'Org 1', null, 'Room 2', '010-1234-5678', null, false);
select public.upsert_lab_waste_stream_override_v2('f3100000-0000-4000-8000-00000000000a', 'ORGANIC_NON_HALOGENATED',
  'Org 2', null, 'Room 2', '010-1234-5678', null, false);
select public.upsert_lab_waste_stream_override_v2('f3100000-0000-4000-8000-00000000000a', 'ORGANIC_NON_HALOGENATED',
  'Org 2', null, 'Room 2', '010-1234-5678', 'Room 9', true);
reset role;
-- 33
select ok(
  (select count(*) = 3 from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'waste_policy_override')
  and (select count(*) = 1 and bool_and(
      a.actor_user_id = 'f3000000-0000-4000-8000-000000000001'
      and a.before_data = '{"stream_code": "ORGANIC_NON_HALOGENATED", "is_disabled": false}'::jsonb
      and a.after_data = '{"stream_code": "ORGANIC_NON_HALOGENATED", "is_disabled": false, "changed_fields": ["container_label"]}'::jsonb)
    from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'waste_policy_override'
      and a.action = 'update' and a.diff_data is null)
  and (select count(*) = 1 and bool_and(
      a.before_data = '{"stream_code": "ORGANIC_NON_HALOGENATED", "is_disabled": false}'::jsonb
      and a.after_data = '{"stream_code": "ORGANIC_NON_HALOGENATED", "is_disabled": true, "changed_fields": ["is_disabled", "replacement_location"]}'::jsonb
      and a.diff_data = '{"is_disabled": {"from": false, "to": true}}'::jsonb)
    from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'waste_policy_override'
      and a.action = 'update' and a.diff_data is not null)
  and not exists (select 1 from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'waste_policy_override'
      and (pg_catalog.strpos(coalesce(a.before_data::text, '') || coalesce(a.after_data::text, '') || coalesce(a.diff_data::text, ''), 'Org ') > 0
        or pg_catalog.strpos(coalesce(a.before_data::text, '') || coalesce(a.after_data::text, '') || coalesce(a.diff_data::text, ''), 'Room ') > 0)),
  'identical site settings write no record; a change records only the changed field names and the availability change');

set role authenticated;
select public.upsert_lab_waste_stream_override_v2('f3100000-0000-4000-8000-00000000000a', 'ORGANIC_NON_HALOGENATED',
  null, null, null, null, null, false);
reset role;
-- 34
select ok(
  (select count(*) = 1 and bool_and(
      a.actor_user_id = 'f3000000-0000-4000-8000-000000000001'
      and a.before_data = '{"stream_code": "ORGANIC_NON_HALOGENATED", "is_disabled": true}'::jsonb
      and a.after_data is null and a.diff_data is null)
    from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'waste_policy_override' and a.action = 'delete'),
  'resetting site settings to the institution policy writes one delete record');

-- Visibility (RLS) -------------------------------------------------------------------

set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
-- 35
select is(
  (select count(*) from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'lab_member'),
  0::bigint, 'a non-admin member cannot read member-management records');
-- 36
select ok(
  exists (select 1 from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_id = 'f3400000-0000-4000-8000-000000000001')
  and exists (select 1 from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'safety_center_link')
  and exists (select 1 from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'waste_policy_override'),
  'a non-admin member still reads inventory, center-link and site-setting records');
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated"}';
-- 37
select is(
  (select count(*) from public.audit_logs a
    where a.lab_id = 'f3100000-0000-4000-8000-00000000000a' and a.entity_type = 'lab_member'),
  4::bigint, 'the lab admin reads the role change, remove, leave and join records');
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000005","role":"authenticated"}';
-- 38
select is(
  (select count(*) from public.audit_logs a where a.lab_id = 'f3100000-0000-4000-8000-00000000000a'),
  0::bigint, 'a user outside the lab reads no record of it');
reset role;

-- Request events ---------------------------------------------------------------------

set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
select public.respond_safety_center_lab_link(
  (select l.id from public.safety_center_lab_links l
    where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a'),
  'approved');
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000002","role":"authenticated"}';
-- 39
select throws_ok(
  $$select public.add_safety_center_request_event('f3600000-0000-4000-8000-000000000001', 'done', 'resolved')$$,
  '42501', 'LAB_CANNOT_RESOLVE_REQUEST', 'a lab cannot close a request the linked center can still see');
-- 40
select lives_ok(
  $$select public.add_safety_center_request_event('f3600000-0000-4000-8000-000000000002', 'reply', 'submitted')$$,
  'a lab submits its reply');
-- 41
select lives_ok(
  $$select public.add_safety_center_request_event('f3600000-0000-4000-8000-000000000001', 'note', null)$$,
  'a lab comments on a submitted request');
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000007","role":"authenticated"}';
select public.add_safety_center_request_event('f3600000-0000-4000-8000-000000000001', 'closed', 'resolved');
reset role;
-- 42
select ok(
  (select r.status = 'resolved' from public.safety_center_requests r where r.id = 'f3600000-0000-4000-8000-000000000001')
  and exists (select 1 from public.safety_center_request_events e
    where e.request_id = 'f3600000-0000-4000-8000-000000000001'
      and e.actor_scope = 'center' and e.event_type = 'status_change' and e.to_status = 'resolved'),
  'the center closes the request');
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
-- 43
select throws_ok(
  $$select public.add_safety_center_request_event('f3600000-0000-4000-8000-000000000001', null, 'in_progress')$$,
  '42501', 'LAB_CANNOT_REOPEN_REQUEST', 'a lab cannot reopen a closed request');
-- 44
select lives_ok(
  $$select public.add_safety_center_request_event('f3600000-0000-4000-8000-000000000001', 'thanks', null)$$,
  'a lab can still comment on a closed request');
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.respond_safety_center_lab_link(
  (select l.id from public.safety_center_lab_links l
    where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a'),
  'revoked');
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000002","role":"authenticated"}';
-- 45
select lives_ok(
  $$select public.add_safety_center_request_event('f3600000-0000-4000-8000-000000000002', 'center unlinked', 'resolved')$$,
  'a lab closes a request the center can no longer see');
-- An approved link to a center that is no longer approved: the center app
-- cannot list requests either, so the lab may close REQ_3 too.
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.respond_safety_center_lab_link(
  (select l.id from public.safety_center_lab_links l
    where l.center_id = 'f3200000-0000-4000-8000-000000000001' and l.lab_id = 'f3100000-0000-4000-8000-00000000000a'),
  'approved');
reset role;
update public.safety_centers set status = 'pending' where id = 'f3200000-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
do $$
begin
  perform public.add_safety_center_request_event('f3600000-0000-4000-8000-000000000003', 'center paused', 'resolved');
exception when insufficient_privilege then
  null;
end $$;
reset role;
-- 46
select ok(
  (select r.status = 'resolved' from public.safety_center_requests r where r.id = 'f3600000-0000-4000-8000-000000000002')
  and exists (select 1 from public.safety_center_request_events e
    where e.request_id = 'f3600000-0000-4000-8000-000000000002'
      and e.actor_scope = 'lab' and e.event_type = 'status_change'
      and e.from_status = 'submitted' and e.to_status = 'resolved')
  and (select r.status = 'resolved' from public.safety_center_requests r where r.id = 'f3600000-0000-4000-8000-000000000003'),
  'lab-side closes are recorded as lab status changes, also while the center is not approved');

-- Operator rejection reason (F4) -----------------------------------------------------

set request.jwt.claims = '{"role":"service_role"}';
set role service_role;
insert into f3_rpc select 'reject', public.operator_safety_center_status_v2(
  'f3000000-0000-4000-8000-000000000009', 'f3200000-0000-4000-8000-000000000002', 'rejected',
  'f3900000-0000-4000-8000-000000000001', 'aal2', 'document_unverifiable', '  서류 해상도가 낮습니다 ');
reset role;
-- 47
select ok(
  (select f.r ->> 'success' = 'true'
      and f.r -> 'item' ->> 'review_reason' = 'document_unverifiable'
      and f.r -> 'item' ->> 'review_note' = '서류 해상도가 낮습니다'
    from f3_rpc f where f.k = 'reject')
  and (select sc.status = 'rejected' from public.safety_centers sc where sc.id = 'f3200000-0000-4000-8000-000000000002'),
  'an operator rejects with a reason and a trimmed note');
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000007","role":"authenticated"}';
set role authenticated;
-- 48
select ok(
  (select s.status = 'rejected' and s.review_reason = 'document_unverifiable' and s.review_note = '서류 해상도가 낮습니다'
    from public.get_my_safety_centers() s where s.id = 'f3200000-0000-4000-8000-000000000002'),
  'the applicant sees the rejection reason and note');
reset role;
set request.jwt.claims = '{"role":"service_role"}';
set role service_role;
-- 49
select throws_ok(
  $$select public.operator_safety_center_status_v2('f3000000-0000-4000-8000-000000000009', 'f3200000-0000-4000-8000-000000000002', 'approved', 'f3900000-0000-4000-8000-000000000002', 'aal2', 'domain_mismatch', null)$$,
  '22023', 'Invalid safety-center review', 'a review reason is accepted only when rejecting');
-- 50
select throws_ok(
  $$select public.operator_safety_center_status_v2('f3000000-0000-4000-8000-000000000009', 'f3200000-0000-4000-8000-000000000002', 'rejected', 'f3900000-0000-4000-8000-000000000003', 'aal2', 'other', null)$$,
  '22023', 'Invalid safety-center review', 'the other reason needs a note');
-- 51
select throws_ok(
  $$select public.operator_safety_center_status_v2('f3000000-0000-4000-8000-000000000009', 'f3200000-0000-4000-8000-000000000002', 'rejected', 'f3900000-0000-4000-8000-000000000004', 'aal2', null, 'x')$$,
  '22023', 'Invalid safety-center review', 'a note needs a reason');
-- 52
select throws_ok(
  $$select public.operator_safety_center_status_v2('f3000000-0000-4000-8000-000000000009', 'f3200000-0000-4000-8000-000000000002', 'rejected', 'f3900000-0000-4000-8000-000000000005', 'aal2', 'other', repeat('가', 501))$$,
  '22023', 'Invalid safety-center review', 'a note longer than 500 characters is rejected');
-- 53
select throws_ok(
  $$select public.operator_safety_center_status_v2('f3000000-0000-4000-8000-000000000009', 'f3200000-0000-4000-8000-000000000002', 'rejected', 'f3900000-0000-4000-8000-000000000006', 'aal2', 'bogus', null)$$,
  '22023', 'Invalid safety-center review', 'an unknown reason is rejected');
insert into f3_rpc select 'approve', public.operator_safety_center_status_v2(
  'f3000000-0000-4000-8000-000000000009', 'f3200000-0000-4000-8000-000000000002', 'approved',
  'f3900000-0000-4000-8000-000000000007', 'aal2', null, null);
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000007","role":"authenticated"}';
set role authenticated;
-- 54
select ok(
  (select f.r ->> 'success' = 'true' from f3_rpc f where f.k = 'approve')
  and (select s.status = 'approved' and s.review_reason is null and s.review_note is null
    from public.get_my_safety_centers() s where s.id = 'f3200000-0000-4000-8000-000000000002')
  and (select sc.review_reason = 'document_unverifiable'
    from public.safety_centers sc where sc.id = 'f3200000-0000-4000-8000-000000000002'),
  'after approval the applicant view hides the stored reason, which stays in the table');
reset role;
set request.jwt.claims = '{"role":"service_role"}';
set role service_role;
insert into f3_rpc select 'unapprove', public.operator_safety_center_status_v2(
  'f3000000-0000-4000-8000-000000000009', 'f3200000-0000-4000-8000-000000000002', 'rejected',
  'f3900000-0000-4000-8000-000000000008', 'aal2', null, null);
insert into f3_rpc select 'reject_again', public.operator_safety_center_status_v2(
  'f3000000-0000-4000-8000-000000000009', 'f3200000-0000-4000-8000-000000000002', 'rejected',
  'f3900000-0000-4000-8000-000000000011', 'aal2', 'domain_mismatch', null);
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000007","role":"authenticated"}';
set role authenticated;
-- 55
select ok(
  (select f.r ->> 'success' = 'true'
      and f.r -> 'item' ->> 'status' = 'rejected'
      and f.r -> 'item' ->> 'review_reason' = 'document_unverifiable'
      and f.r -> 'item' ->> 'review_note' = '서류 해상도가 낮습니다'
    from f3_rpc f where f.k = 'unapprove')
  and (select f.r ->> 'success' = 'true' from f3_rpc f where f.k = 'reject_again')
  and (select s.status = 'rejected' and s.review_reason = 'domain_mismatch' and s.review_note is null
    from public.get_my_safety_centers() s where s.id = 'f3200000-0000-4000-8000-000000000002'),
  'rejecting again without a reason keeps the stored pair; rejecting with a new reason replaces both');
reset role;
set request.jwt.claims = '{"role":"service_role"}';
set role service_role;
insert into f3_rpc select 'norole', public.operator_safety_center_status_v2(
  'f3000000-0000-4000-8000-000000000010', 'f3200000-0000-4000-8000-000000000002', 'pending',
  'f3900000-0000-4000-8000-000000000009', 'aal2', null, null);
reset role;
-- 56
select ok(
  (select f.r = '{"success": false, "code": "operator_role_required"}'::jsonb from f3_rpc f where f.k = 'norole')
  and (select sc.status = 'rejected' from public.safety_centers sc where sc.id = 'f3200000-0000-4000-8000-000000000002')
  and exists (select 1 from private.operator_action_audit_v1 a
    where a.request_id = 'f3900000-0000-4000-8000-000000000009' and a.outcome = 'denied'
      and a.actor_user_id = 'f3000000-0000-4000-8000-000000000010' and a.reason_code = 'OPERATOR_ROLE_REQUIRED'),
  'an operator without the approver role is denied and the denial is recorded');
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
-- 57
select throws_ok(
  $$select public.operator_safety_center_status_v2('f3000000-0000-4000-8000-000000000009', 'f3200000-0000-4000-8000-000000000002', 'pending', 'f3900000-0000-4000-8000-000000000010', 'aal2', null, null)$$,
  '42501', null, 'a browser session cannot call the operator status function');
reset role;

-- Feedback context (F5) --------------------------------------------------------------

set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
-- 58
select lives_ok(
  $$insert into public.feedback (type, message, user_id, lab_id, source_screen) values ('bug', 'phase3', 'f3000000-0000-4000-8000-000000000002', 'f3100000-0000-4000-8000-00000000000a', 'inventory')$$,
  'a member sends feedback from their lab space');
-- 59
select throws_ok(
  $$insert into public.feedback (type, message, user_id, lab_id, source_screen) values ('bug', 'phase3', 'f3000000-0000-4000-8000-000000000002', 'f3100000-0000-4000-8000-00000000000c', 'inventory')$$,
  '42501', null, 'feedback cannot name a lab the sender does not belong to');
-- 60
select throws_ok(
  $$insert into public.feedback (type, message, user_id, lab_id, source_screen) values ('bug', 'phase3', 'f3000000-0000-4000-8000-000000000002', 'f3100000-0000-4000-8000-00000000000a', 'bogus')$$,
  '23514', null, 'source_screen accepts only app tabs');
reset role;
set request.jwt.claims = '{"role":"anon"}';
set role anon;
-- 61
select throws_ok(
  $$insert into public.feedback (type, message, lab_id) values ('general', 'x', 'f3100000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'anonymous feedback cannot name a lab');
-- 62
select lives_ok(
  $$insert into public.feedback (type, message, lab_id) values ('general', 'x', null)$$,
  'anonymous feedback without a lab still works');
reset role;
update public.feedback set user_id = null, user_email = null, contact = null
where user_id = 'f3000000-0000-4000-8000-000000000008';
-- 63
select ok(
  (select f.user_id is null and f.lab_id is null and f.source_screen = 'logs'
    from public.feedback f where f.id = 'f3800000-0000-4000-8000-000000000001'),
  'the account deletion scrub also clears the feedback lab link');

-- Lab deletion -----------------------------------------------------------------------

create temp table f3_snap on commit drop as
  select count(*) as n from public.audit_logs where lab_id = 'f3100000-0000-4000-8000-00000000000b';
set request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated"}';
delete from public.labs where id = 'f3100000-0000-4000-8000-00000000000b';
-- 64
select ok(
  not exists (select 1 from public.labs l where l.id = 'f3100000-0000-4000-8000-00000000000b')
  and (select count(*) from public.audit_logs where lab_id = 'f3100000-0000-4000-8000-00000000000b') = (select n from f3_snap)
  and (select f.lab_id is null from public.feedback f where f.id = 'f3800000-0000-4000-8000-000000000003'),
  'deleting a lab writes no member or site-setting record and clears feedback links to it');

-- No identifiers ---------------------------------------------------------------------

-- 65
select is(
  (select count(*) from public.audit_logs a
    where a.entity_type in ('lab_member', 'safety_center_link', 'waste_policy_override')
      and a.lab_id in ('f3100000-0000-4000-8000-00000000000a', 'f3100000-0000-4000-8000-00000000000b')
      and pg_catalog.strpos(coalesce(a.actor_name, '') || coalesce(a.before_data::text, '')
        || coalesce(a.after_data::text, '') || coalesce(a.diff_data::text, ''), '@') > 0),
  0::bigint, 'no phase-3 audit record contains an email address');

select * from finish();
rollback;
