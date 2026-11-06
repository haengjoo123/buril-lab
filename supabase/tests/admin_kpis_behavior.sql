begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
set local timezone = 'UTC';
select plan(36);

-- Privileges: service_role only, not SECURITY DEFINER, fixed search_path.
select ok(not has_function_privilege('anon', 'public.analytics_admin_kpis_v1(integer)', 'EXECUTE'),
  'anon cannot execute analytics_admin_kpis_v1');
select ok(not has_function_privilege('authenticated', 'public.analytics_admin_kpis_v1(integer)', 'EXECUTE'),
  'authenticated cannot execute analytics_admin_kpis_v1');
select ok(has_function_privilege('service_role', 'public.analytics_admin_kpis_v1(integer)', 'EXECUTE'),
  'service_role executes analytics_admin_kpis_v1');
select is(
  (select count(*) from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid in ('public.analytics_admin_kpis_v1(integer)'::regprocedure, 'private.analytics_kpi_days_v1(integer)'::regprocedure)
      and a.grantee = 0),
  0::bigint, 'PUBLIC has no EXECUTE on the KPI functions');
select ok(
  (select not p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""', 'TimeZone=UTC']
    from pg_catalog.pg_proc p where p.oid = 'public.analytics_admin_kpis_v1(integer)'::regprocedure),
  'the KPI function is STABLE SECURITY INVOKER with a fixed empty search_path and UTC output');
select ok(
  not has_function_privilege('anon', 'private.analytics_kpi_days_v1(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.analytics_kpi_days_v1(integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'private.analytics_kpi_days_v1(integer)', 'EXECUTE'),
  'only service_role executes the p_days guard');
select ok(
  not has_table_privilege('anon', 'private.analytics_internal_labs', 'SELECT')
  and not has_table_privilege('authenticated', 'private.analytics_internal_labs', 'SELECT')
  and has_table_privilege('service_role', 'private.analytics_internal_labs', 'SELECT')
  and not has_table_privilege('service_role', 'private.analytics_internal_labs', 'INSERT'),
  'the internal-lab list is readable by service_role only');
select is(
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'analytics_internal_labs'),
  0::bigint, 'the internal-lab list stays outside the Data API schema');
set local role authenticated;
select throws_ok($$select public.analytics_admin_kpis_v1(7)$$, '42501', null,
  'a signed-in browser session cannot call the KPI function');
reset role;

-- p_days: same range as analytics_admin_summary, rejected instead of clamped.
set local role service_role;
select throws_ok($$select public.analytics_admin_kpis_v1(0)$$, '22023', 'p_days must be an integer between 1 and 365', 'p_days 0 is rejected');
select throws_ok($$select public.analytics_admin_kpis_v1(366)$$, '22023', 'p_days must be an integer between 1 and 365', 'p_days 366 is rejected');
select throws_ok($$select public.analytics_admin_kpis_v1(null)$$, '22023', 'p_days must be an integer between 1 and 365', 'a null p_days is rejected');
reset role;

-- F1: no onboarding row keeps the raw search text after the migration.
select is((select count(*) from public.onboarding_events where jsonb_typeof(metadata) = 'object' and metadata ? 'query'), 0::bigint,
  'no onboarding row keeps metadata.query');

-- Value checks need a database without other rows (CI). Hosted runs skip them.
create temp table kpi_env on commit drop as
select (
  not exists (select 1 from auth.users)
  and not exists (select 1 from public.labs)
  and not exists (select 1 from public.feedback)
  and not exists (select 1 from public.safety_centers)
  and not exists (select 1 from public.analytics_review_candidates)
  and not exists (select 1 from public.search_analytics_events)
) as blank;
-- Fixed dataset for admin_kpis_behavior.sql (relative to now(), which is fixed inside the test transaction).
insert into public.waste_stream_catalog (code, display_name_ko, display_name_en, sort_order) values
  ('ORGANIC_NON_HALOGENATED', '비할로겐 유기 폐액', 'Non-halogenated organic waste', 40),
  ('SPECIAL_REVIEW', '분리 보관·특별 검토', 'Isolate and review', 100)
on conflict (code) do nothing;
insert into public.waste_policy_versions (id, policy_key, scope_type, version_label, name, status)
values ('d0000000-0000-4000-8000-000000000001', 'admin_kpis_test', 'system', 'KPI-TEST', 'admin kpi test policy', 'draft');

insert into auth.users (id, email) values
  ('d1000000-0000-4000-8000-000000000001', 'kpi-u1@example.invalid'),
  ('d1000000-0000-4000-8000-000000000002', 'kpi-u2@example.invalid'),
  ('d1000000-0000-4000-8000-000000000003', 'kpi-u3@example.invalid'),
  ('d1000000-0000-4000-8000-000000000004', 'kpi-u4-internal@example.invalid'),
  ('d1000000-0000-4000-8000-000000000005', 'kpi-u5@example.invalid'),
  ('d1000000-0000-4000-8000-000000000006', 'kpi-u6@example.invalid'),
  ('d1000000-0000-4000-8000-000000000007', 'kpi-u7@example.invalid'),
  ('d1000000-0000-4000-8000-000000000008', 'kpi-center-owner@example.invalid'),
  ('d1000000-0000-4000-8000-000000000010', 'kpi-u10@example.invalid'),
  ('d1000000-0000-4000-8000-000000000011', 'kpi-u11@example.invalid');

-- A, B: customer labs of one institution (spelled differently); I: internal; C, D: older labs of a second institution.
insert into public.labs (id, name, created_at, institution_name) values
  ('d2000000-0000-4000-8000-00000000000a', 'KPI lab A', now() - interval '20 days', ' Buril Univ '),
  ('d2000000-0000-4000-8000-00000000000b', 'KPI lab B', now() - interval '30 days', 'BURIL UNIV'),
  ('d2000000-0000-4000-8000-00000000000c', 'KPI lab C', now() - interval '200 days', 'Hanbit Univ'),
  ('d2000000-0000-4000-8000-00000000000d', 'KPI lab D', now() - interval '200 days', 'hanbit univ'),
  ('d2000000-0000-4000-8000-0000000000ff', 'KPI internal lab', now() - interval '20 days', 'buril univ');
insert into private.analytics_internal_labs (lab_id, reason) values ('d2000000-0000-4000-8000-0000000000ff', 'internal');

insert into public.lab_members (lab_id, user_id, role, joined_at) values
  ('d2000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', 'admin', now() - interval '20 days'),
  ('d2000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000002', 'student', now() - interval '18 days'),
  ('d2000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000003', 'admin', now() - interval '30 days'),
  ('d2000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000010', 'student', now() - interval '12 days'),
  ('d2000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000011', 'student', now() - interval '10 days'),
  ('d2000000-0000-4000-8000-00000000000c', 'd1000000-0000-4000-8000-000000000005', 'admin', now() - interval '200 days'),
  ('d2000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-000000000006', 'admin', now() - interval '200 days'),
  ('d2000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-000000000007', 'student', now() - interval '199 days'),
  ('d2000000-0000-4000-8000-0000000000ff', 'd1000000-0000-4000-8000-000000000004', 'admin', now() - interval '20 days');

-- Lab A's first item (D4 b) and its audit row.
insert into public.inventory (id, lab_id, user_id, name, created_at) values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', 'Acetone', now() - interval '19 days');
insert into public.audit_logs (actor_user_id, lab_id, entity_type, entity_id, action, created_at) values
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'inventory', 'd3000000-0000-4000-8000-000000000001', 'create', now() - interval '19 days'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'cabinet_item', gen_random_uuid(), 'update', now() - interval '10 days'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'cabinet', gen_random_uuid(), 'update', now() - interval '24 days'),
  ('d1000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-00000000000c', 'cabinet_activity', gen_random_uuid(), 'create', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-00000000000d', 'cabinet_item', gen_random_uuid(), 'update', now() - interval '1 day'),
  -- Not core records: unknown lab (no FK on audit_logs), non-core entity, no actor.
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-0000000000ee', 'inventory', gen_random_uuid(), 'update', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-00000000000a', 'ui', gen_random_uuid(), 'update', now() - interval '1 day'),
  (null, 'd2000000-0000-4000-8000-00000000000b', 'inventory', gen_random_uuid(), 'update', now() - interval '1 day'),
  -- The same exclusions in weeks where the lab is otherwise idle, so counting them would change the series.
  (null, 'd2000000-0000-4000-8000-00000000000c', 'inventory', gen_random_uuid(), 'update', now() - interval '52 days'),
  ('d1000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-00000000000d', 'ui', gen_random_uuid(), 'update', now() - interval '40 days');

-- Waste records. v2 rows use amount_is_unknown so the amount CHECK needs no totals.
insert into public.waste_logs (id, lab_id, user_id, created_at, chemicals, disposal_category, schema_version, record_origin,
  handling_action, decision_status, stream_code, matrix_code, policy_version_id, request_id, request_payload_hash,
  amount_is_unknown, decision_snapshot, voided_at, voided_by, void_reason) values
  ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', now() - interval '17 days', '[]', 'x', 2, 'waste_batch',
   'container_deposit', 'ready', 'ORGANIC_NON_HALOGENATED', 'organic_non_halogenated', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true, '{}', null, null, null),
  ('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', now() - interval '2 days', '[]', 'x', 2, 'waste_batch',
   'isolated', 'needs_input', 'SPECIAL_REVIEW', 'unknown', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true,
   '{"missingFields": ["measured_ph", "mixing_state"]}', null, null, null),
  ('d4000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000002', now() - interval '3 days', '[]', 'x', 2, 'waste_batch',
   'container_deposit', 'ready', 'ORGANIC_NON_HALOGENATED', 'organic_non_halogenated', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true, '{}',
   now() - interval '3 days' + interval '1 hour', 'd1000000-0000-4000-8000-000000000002', '중복 기록'),
  ('d4000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', now() - interval '4 days', '[]', 'x', 2, 'waste_batch',
   'container_deposit', 'ready', 'ORGANIC_NON_HALOGENATED', 'organic_non_halogenated', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true, '{}',
   now() - interval '4 days' + interval '1 hour', 'd1000000-0000-4000-8000-000000000001', 'Wrong  amount'),
  ('d4000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000003', now() - interval '5 days', '[]', 'x', 2, 'waste_batch',
   'container_deposit', 'ready', 'ORGANIC_NON_HALOGENATED', 'organic_non_halogenated', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true, '{}', null, null, null),
  ('d4000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000003', now() - interval '6 days', '[]', 'x', 2, 'waste_batch',
   'handover', 'blocked', 'SPECIAL_REVIEW', 'unknown', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true,
   '{"missing_fields": ["hazard_data", "not_a_field"]}', null, null, null),
  ('d4000000-0000-4000-8000-000000000007', 'd2000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000003', now() - interval '2 days', '[]', 'x', 2, 'waste_batch',
   'container_deposit', 'ready', 'ORGANIC_NON_HALOGENATED', 'organic_non_halogenated', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true, '{}',
   now() - interval '2 days' + interval '1 hour', 'd1000000-0000-4000-8000-000000000003', '비커 라벨을 다시 확인함'),
  ('d4000000-0000-4000-8000-000000000008', null, 'd1000000-0000-4000-8000-000000000002', now() - interval '1 day', '[]', 'x', 2, 'waste_batch',
   'container_deposit', 'ready', 'ORGANIC_NON_HALOGENATED', 'organic_non_halogenated', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true, '{}', null, null, null),
  ('d4000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-0000000000ff', 'd1000000-0000-4000-8000-000000000004', now() - interval '1 day', '[]', 'x', 2, 'waste_batch',
   'container_deposit', 'ready', 'ORGANIC_NON_HALOGENATED', 'organic_non_halogenated', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true, '{}', null, null, null),
  ('d4000000-0000-4000-8000-000000000011', 'd2000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000003', now() - interval '8 days', '[]', 'x', 2, 'waste_batch',
   'container_deposit', 'ready', 'ORGANIC_NON_HALOGENATED', 'organic_non_halogenated', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true, '{}', null, null, null),
  -- Never counted: W12 personal record of the internal user; W13 internal lab without a user (deleted account);
  -- W14 voided in a week where lab C is otherwise idle.
  ('d4000000-0000-4000-8000-000000000012', null, 'd1000000-0000-4000-8000-000000000004', now() - interval '1 day', '[]', 'x', 2, 'waste_batch',
   'container_deposit', 'ready', 'ORGANIC_NON_HALOGENATED', 'organic_non_halogenated', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true, '{}', null, null, null),
  ('d4000000-0000-4000-8000-000000000013', 'd2000000-0000-4000-8000-0000000000ff', null, now() - interval '1 day', '[]', 'x', 2, 'waste_batch',
   'container_deposit', 'ready', 'ORGANIC_NON_HALOGENATED', 'organic_non_halogenated', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true, '{}', null, null, null),
  ('d4000000-0000-4000-8000-000000000014', 'd2000000-0000-4000-8000-00000000000c', 'd1000000-0000-4000-8000-000000000005', now() - interval '38 days', '[]', 'x', 2, 'waste_batch',
   'container_deposit', 'ready', 'ORGANIC_NON_HALOGENATED', 'organic_non_halogenated', 'd0000000-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 32), true, '{}',
   now() - interval '38 days' + interval '1 hour', 'd1000000-0000-4000-8000-000000000005', '분류 오선택');
-- A legacy v1 record never counts (W15: inside lab B's first 14 days, in a week where B is otherwise idle).
insert into public.waste_logs (id, lab_id, user_id, created_at, chemicals, disposal_category) values
  ('d4000000-0000-4000-8000-000000000010', 'd2000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', now() - interval '1 day', '[]', 'legacy'),
  ('d4000000-0000-4000-8000-000000000015', 'd2000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000003', now() - interval '18 days', '[]', 'legacy');

insert into public.waste_log_items (waste_log_id, line_number, cart_line_id, chemical_name, ghs_data_status) values
  ('d4000000-0000-4000-8000-000000000002', 1, 'l1', 'Acetone', 'verified'),
  ('d4000000-0000-4000-8000-000000000002', 2, 'l2', 'Unknown A', 'lookup_failed'),
  ('d4000000-0000-4000-8000-000000000003', 1, 'l1', 'Unknown B', 'lookup_failed'),
  ('d4000000-0000-4000-8000-000000000005', 1, 'l1', 'Ethanol', 'not_checked'),
  ('d4000000-0000-4000-8000-000000000006', 1, 'l1', 'Sodium cyanide', 'verified'),
  ('d4000000-0000-4000-8000-000000000008', 1, 'l1', 'Methanol', 'verified'),
  ('d4000000-0000-4000-8000-000000000009', 1, 'l1', 'Unknown C', 'lookup_failed'),
  ('d4000000-0000-4000-8000-000000000011', 1, 'l1', 'Hexane', 'verified'),
  ('d4000000-0000-4000-8000-000000000012', 1, 'l1', 'Unknown D', 'not_checked'),
  ('d4000000-0000-4000-8000-000000000013', 1, 'l1', 'Unknown E', 'lookup_failed');

-- Signed-in activity events.
insert into public.search_analytics_events (id, user_id, lab_id, session_id, query_sanitized, query_normalized, query_type, search_channel, outcome, created_at) values
  (gen_random_uuid(), 'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-00000000000a', gen_random_uuid(), 'acetone', 'acetone', 'name', 'manual', 'matched', now() - interval '1 day'),
  (gen_random_uuid(), 'd1000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-0000000000ff', gen_random_uuid(), 'acetone', 'acetone', 'name', 'manual', 'matched', now() - interval '1 day'),
  (gen_random_uuid(), 'd1000000-0000-4000-8000-000000000004', null, gen_random_uuid(), 'acetone', 'acetone', 'name', 'manual', 'matched', now() - interval '1 day');

insert into public.onboarding_events (user_id, lab_id, event_type, step_key, platform, metadata, created_at) values
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'shown', 'search', 'web', '{}', now() - interval '3 days'),
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'step_completed', 'search', 'web', '{}', now() - interval '3 days' + interval '1 hour'),
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'first_value_reached', 'search', 'web', '{"query_length": 7}', now() - interval '3 days' + interval '1 hour'),
  ('d1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-00000000000a', 'shown', 'search', 'native', '{}', now() - interval '2 days'),
  ('d1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-00000000000a', 'skipped', 'search', 'native', '{}', now() - interval '2 days' + interval '5 minutes'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'shown', 'search', 'web', '{}', now() - interval '10 days'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'step_completed', 'search', 'web', '{}', now() - interval '9 days'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'step_completed', 'disposal', 'web', '{}', now() - interval '9 days'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'step_completed', 'cabinet', 'web', '{}', now() - interval '9 days'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'step_completed', 'inventory', 'web', '{}', now() - interval '9 days'),
  ('d1000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-0000000000ff', 'shown', 'search', 'web', '{}', now() - interval '1 day'),
  -- Never counted: the internal user's personal shown, and u1's earlier shown tagged with the internal lab.
  ('d1000000-0000-4000-8000-000000000004', null, 'shown', 'search', 'web', '{}', now() - interval '2 days'),
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-0000000000ff', 'shown', 'search', 'native', '{}', now() - interval '4 days'),
  -- A later shown on another platform does not move u1 out of the web cohort.
  ('d1000000-0000-4000-8000-000000000001', null, 'shown', 'search', 'native', '{}', now() - interval '1 day');

insert into public.commerce_intent_events (user_id, lab_id, event_type, brand_name, cas_number, cas_input_method, created_at) values
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'inventory_registered', 'Sigma', '67-64-1', 'suggested_confirmed', now() - interval '2 days'),
  ('d1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-00000000000a', 'cabinet_item_placed', 'Sigma', null, 'unknown', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-00000000000c', 'inventory_registered', 'SIGMA ', '7647-01-0', 'bulk_confirmed', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-00000000000d', 'inventory_registered', 'sigma', null, 'manual', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000007', 'd2000000-0000-4000-8000-00000000000d', 'inventory_updated', 'Sigma', null, 'manual', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'inventory_registered', 'Daejung', '64-17-5', 'catalog', now() - interval '4 days'),
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'cas_suggestion_dismissed', 'acetone', '67-64-1', 'suggestion_dismissed', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-0000000000ff', 'inventory_registered', 'Sigma', null, 'manual', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'inventory_registered', 'Sigma', null, 'manual', now() - interval '10 days'),
  -- Never counted: the internal user in a personal space, a customer's event tagged with the internal lab.
  ('d1000000-0000-4000-8000-000000000004', null, 'inventory_registered', 'Sigma', null, 'manual', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-0000000000ff', 'inventory_registered', 'Sigma', null, 'manual', now() - interval '1 day');

insert into public.safety_compliance_events (user_id, lab_id, event_type, warning_severity, rule_id, primary_chemical_name, secondary_chemical_name, created_at) values
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'storage_warning_ignored', 'DANGER', 'store_flam_oxid', 'Ethanol', 'Nitric acid', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'storage_warning_ignored', 'DANGER', 'store_flam_oxid', 'Acetone', 'Hydrogen peroxide', now() - interval '2 days'),
  ('d1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-00000000000a', 'storage_warning_ignored', 'DANGER', 'Bad Rule!', 'X', 'Y', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-00000000000a', 'storage_warning_ignored', 'DANGER', 'store_unlisted_rule', 'X', 'Y', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'storage_warning_ignored', 'DANGER', 'store_acid_cyanide', 'HCl', 'NaCN', now() - interval '3 days'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'storage_warning_ignored', 'WARNING', 'store_acid_base', 'HCl', 'NaOH', now() - interval '3 days'),
  ('d1000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-0000000000ff', 'storage_warning_ignored', 'DANGER', 'store_flam_oxid', 'A', 'B', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-00000000000b', 'storage_warning_ignored', 'DANGER', 'store_flam_acid', 'Ethanol', 'HCl', now() - interval '9 days'),
  -- Never counted: the internal user in a personal space, a customer's event tagged with the internal lab.
  ('d1000000-0000-4000-8000-000000000004', null, 'storage_warning_ignored', 'DANGER', 'store_flam_oxid', 'A', 'B', now() - interval '1 day'),
  ('d1000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-0000000000ff', 'storage_warning_ignored', 'DANGER', 'store_flam_oxid', 'A', 'B', now() - interval '1 day');

-- Safety centers: C1 approved (Buril Univ), C2 pending (Hanbit Univ), C3 rejected, C4 approved with internal-lab activity only.
insert into public.safety_centers (id, institution_name, institution_domain, center_name, status, created_by, approved_by, approved_at, created_at) values
  ('d5000000-0000-4000-8000-000000000001', 'Buril Univ', 'buril.example', 'Buril safety center', 'approved', 'd1000000-0000-4000-8000-000000000008', null, now() - interval '40 days' + interval '60 hours', now() - interval '40 days'),
  ('d5000000-0000-4000-8000-000000000002', 'Hanbit Univ ', 'hanbit.example', 'Hanbit safety center', 'pending', 'd1000000-0000-4000-8000-000000000008', null, null, now() - interval '5 days'),
  ('d5000000-0000-4000-8000-000000000003', 'Third Univ', 'third.example', 'Third safety center', 'rejected', 'd1000000-0000-4000-8000-000000000008', null, null, now() - interval '10 days'),
  ('d5000000-0000-4000-8000-000000000004', 'Fourth Univ', 'fourth.example', 'Fourth safety center', 'approved', 'd1000000-0000-4000-8000-000000000008', null, now() - interval '100 days' + interval '36 hours', now() - interval '100 days');
insert into public.safety_center_lab_links (center_id, lab_id, status) values
  ('d5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'approved'),
  ('d5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000b', 'requested'),
  ('d5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-0000000000ff', 'approved');
insert into public.safety_center_requests (id, center_id, lab_id, title, status, due_date, created_at) values
  ('d6000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'R1', 'open', (now() at time zone 'Asia/Seoul')::date - 2, now() - interval '6 days'),
  ('d6000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'R2', 'in_progress', (now() at time zone 'Asia/Seoul')::date + 2, now() - interval '3 days'),
  ('d6000000-0000-4000-8000-000000000003', 'd5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'R3', 'submitted', (now() at time zone 'Asia/Seoul')::date - 5, now() - interval '12 days'),
  ('d6000000-0000-4000-8000-000000000004', 'd5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-00000000000a', 'R4', 'open', null, now() - interval '1 day'),
  ('d6000000-0000-4000-8000-000000000005', 'd5000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-0000000000ff', 'R5', 'open', (now() at time zone 'Asia/Seoul')::date - 1, now() - interval '2 days');
insert into public.safety_center_request_events (request_id, actor_user_id, actor_scope, event_type, created_at) values
  ('d6000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000008', 'center', 'created', now() - interval '6 days'),
  ('d6000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'lab', 'comment', now() - interval '6 days' + interval '4 hours'),
  ('d6000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'lab', 'comment', now() - interval '5 days'),
  ('d6000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 'lab', 'status_change', now() - interval '3 days' + interval '10 hours'),
  ('d6000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'lab', 'status_change', now() - interval '12 days' + interval '6 hours'),
  ('d6000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000008', 'center', 'comment', now() - interval '1 day' + interval '1 hour');
insert into public.safety_center_exports (center_id, format, datasets, created_at) values
  ('d5000000-0000-4000-8000-000000000001', 'xlsx', array['waste_logs'], now() - interval '2 days');

insert into public.feedback (type, message, status, created_at) values
  ('bug', 'kpi fixture bug', 'new', now() - interval '4 days'),
  ('improvement', 'kpi fixture idea', 'new', now() - interval '1 day'),
  ('general', 'kpi fixture resolved', 'resolved', now() - interval '10 days');

insert into public.analytics_review_candidates (candidate_type, source_key, title, summary, status, created_at, updated_at) values
  ('search_alias', 'kpi:a', 'a', 'a', 'pending', now() - interval '6 days', now() - interval '2 days'),
  ('search_alias', 'kpi:b', 'b', 'b', 'pending', now() - interval '3 days', now() - interval '1 day'),
  ('search_alias', 'kpi:c', 'c', 'c', 'approved', now() - interval '9 days', now() - interval '8 days');

create temp table kpi_result (days integer primary key, k jsonb not null) on commit drop;
grant select, insert on kpi_result to service_role;
set local role service_role;
insert into kpi_result select v.d, public.analytics_admin_kpis_v1(v.d) from (values (7), (30)) as v(d);
reset role;

select case when (select blank from kpi_env) then is(
  (select (k -> 'product' -> 'wsal') - 'weekly' from kpi_result where days = 7),
  '{"current": 4, "previous": 1, "totalLabs": 4}'::jsonb,
  'WSAL counts customer labs with a core record in the last 7 days, not internal, voided, legacy, personal or unknown-lab rows')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select pg_catalog.jsonb_agg(e.w -> 'labs' order by e.ord) from kpi_result r
    cross join lateral pg_catalog.jsonb_array_elements(r.k -> 'product' -> 'wsal' -> 'weekly') with ordinality as e(w, ord)
    where r.days = 7),
  '[0, 0, 0, 0, 1, 1, 1, 4]'::jsonb,
  'the 8 weekly WSAL points run oldest to newest and end with the current week')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'product' -> 'activeUsers' from kpi_result where days = 7),
  '{"wau": {"current": 6, "previous": 1}, "mau": {"current": 6, "previous": 0},
    "stickiness": {"current": {"numerator": 6, "denominator": 6}, "previous": {"numerator": 1, "denominator": 2}}}'::jsonb,
  'WAU and MAU count signed-in activity and leave internal-lab members out')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'product' -> 'activation14d' from kpi_result where days = 7),
  '{"current": {"cohortLabs": 2, "secondMember": 1, "firstItem": 1, "firstWasteRecord": 1, "fullyActivated": 1},
    "previous": {"cohortLabs": 0, "secondMember": 0, "firstItem": 0, "firstWasteRecord": 0, "fullyActivated": 0}}'::jsonb,
  '14-day activation checks member, item and valid waste record within 14 days of lab creation')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'product' -> 'retentionW4' from kpi_result where days = 7),
  '{"current": {"numerator": 1, "denominator": 1}, "previous": {"numerator": 0, "denominator": 0}}'::jsonb,
  'week-4 retention counts labs with a core record on days 22-28')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'product' -> 'onboarding' from kpi_result where days = 7),
  '{"web": {"current": {"shown": 1, "stepCompleted": 1, "allStepsCompleted": 0, "firstValueReached": 1, "skipped": 0},
            "previous": {"shown": 1, "stepCompleted": 1, "allStepsCompleted": 1, "firstValueReached": 0, "skipped": 0}},
    "native": {"current": {"shown": 1, "stepCompleted": 0, "allStepsCompleted": 0, "firstValueReached": 0, "skipped": 1},
               "previous": {"shown": 0, "stepCompleted": 0, "allStepsCompleted": 0, "firstValueReached": 0, "skipped": 0}}}'::jsonb,
  'the onboarding funnel follows each user from the first shown event, per platform')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'safety' -> 'needsReview' from kpi_result where days = 7),
  '{"current": {"numerator": 2, "denominator": 4, "needsInput": 1, "blocked": 1},
    "previous": {"numerator": 0, "denominator": 1, "needsInput": 0, "blocked": 0},
    "topMissingFields": [{"field": "hazard_data", "records": 1}, {"field": "measured_ph", "records": 1}, {"field": "mixing_state", "records": 1}]}'::jsonb,
  'needs-review decisions use valid v2 records and only known missing-field codes')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'safety' -> 'corrections' from kpi_result where days = 7),
  '{"current": {"numerator": 3, "denominator": 7}, "previous": {"numerator": 0, "denominator": 1},
    "byReason": {"amount": 1, "duplicate": 1, "category": 0, "other": 1}}'::jsonb,
  'corrections count voided v2 records by preset reason and never return the text')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'safety' -> 'dangerIgnored' from kpi_result where days = 7),
  '{"current": {"events": 5, "labs": 2}, "previous": {"events": 1, "labs": 1},
    "topRules": [{"ruleId": "store_flam_oxid", "events": 2}, {"ruleId": "store_acid_cyanide", "events": 1}]}'::jsonb,
  'ignored DANGER warnings are counted per lab; only known rule ids are named, without actors')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'safety' -> 'centerRequests' from kpi_result where days = 7),
  '{"open": 3, "overdue": 1, "overdueLabs": 1, "dueSoon": 1,
    "firstResponse": {"current": {"requests": 3, "responded": 2, "medianHours": 7.0},
                      "previous": {"requests": 1, "responded": 1, "medianHours": 6.0}}}'::jsonb,
  'center requests waiting on the lab are split into overdue and due within 3 days')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'safety' -> 'ghsCheckGaps' from kpi_result where days = 7),
  '{"current": {"numerator": 2, "denominator": 5, "lookupFailed": 1, "notChecked": 1},
    "previous": {"numerator": 0, "denominator": 1, "lookupFailed": 0, "notChecked": 0}}'::jsonb,
  'GHS check gaps count components of valid v2 records')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'b2b' -> 'centerPipeline' from kpi_result where days = 7),
  '{"applications": {"current": 1, "previous": 1}, "pending": 1, "approved": 2, "rejected": 1,
    "approvalDays": {"centers": 2, "median": 2.0}, "activeCenters": {"current": 1, "previous": 1},
    "linkedLabs": 1, "linkRequestsPending": 1,
    "requests": {"current": 3, "previous": 1}, "exports": {"current": 1, "previous": 0}}'::jsonb,
  'the center pipeline counts applications, approvals, links, requests and exports; internal-lab requests do not make a center active')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'b2b' -> 'institutions' from kpi_result where days = 7),
  '{"labsTotal": 4, "labsWithInstitution": 4, "institutions": 2, "institutionsWithApprovedCenter": 1, "coveredLabs": 2,
    "salesCandidates": {"count": 1, "top": [{"institution": "hanbit univ", "activeLabs": 2, "hasPendingCenter": true}]}}'::jsonb,
  'institutions group by lower(trim(name)); a sales candidate has 2+ active labs and no approved center')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'b2b' -> 'labProReadiness' from kpi_result where days = 7),
  '{"current": {"habitualLabs": 1, "readyLabs": 1, "seats": {"upTo2": 0, "from3To5": 1, "from6To10": 0, "over10": 0}},
    "previous": {"habitualLabs": 0, "readyLabs": 0, "seats": {"upTo2": 0, "from3To5": 0, "from6To10": 0, "over10": 0}}}'::jsonb,
  'Lab Pro readiness needs 3 of 4 active weeks and 3 or more members')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then is(
  (select k -> 'b2b' -> 'purchaseIntent' from kpi_result where days = 7),
  '{"current": {"events": 6, "labs": 4, "users": 6, "withCas": 3}, "previous": {"events": 1, "labs": 1, "users": 1, "withCas": 0},
    "topBrands": [{"brand": "sigma", "events": 5, "labs": 3, "users": 5}], "hiddenBrands": 1}'::jsonb,
  'brands are shown only with 3+ labs and 5+ users; dismissed CAS suggestions are not purchase intent')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then ok(
  (select
      r.k #>> '{inbox,centers,count}' = '1'
      and (r.k #>> '{inbox,centers,oldestCreatedAt}')::timestamptz = now() - interval '5 days'
      and (r.k #> '{inbox,feedback}') - 'oldestCreatedAt' = '{"count": 2, "byType": {"bug": 1, "improvement": 1, "general": 0}}'::jsonb
      and (r.k #>> '{inbox,feedback,oldestCreatedAt}')::timestamptz = now() - interval '4 days'
      and r.k #>> '{inbox,reviews,count}' = '2'
      and (r.k #>> '{inbox,reviews,oldestCreatedAt}')::timestamptz = now() - interval '6 days'
      and (r.k #>> '{inbox,reviews,lastUpdatedAt}')::timestamptz = now() - interval '1 day'
    from kpi_result r where r.days = 7),
  'the inbox returns exact counts, oldest waits and the last candidate update')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then ok(
  (select
      r.k -> 'schemaVersion' = '1'::jsonb
      and r.k -> 'exclusions' = '{"internalLabs": 1, "internalUsers": 1}'::jsonb
      and r.k #>> '{period,days}' = '7'
      and r.k #>> '{period,timeZone}' = 'Asia/Seoul'
      and (r.k ->> 'generatedAt')::timestamptz = now()
      and (r.k #>> '{period,currentEnd}')::timestamptz = now()
      and (r.k #>> '{period,currentStart}')::timestamptz = now() - interval '7 days'
      and (r.k #>> '{period,previousStart}')::timestamptz = now() - interval '14 days'
    from kpi_result r where r.days = 7),
  'the envelope reports its version, period and exclusions')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;
select case when (select blank from kpi_env) then ok(
  (select
      r30.k #> '{safety,corrections,current}' = '{"numerator": 3, "denominator": 9}'::jsonb
      and r30.k -> 'product' -> 'wsal' = r7.k -> 'product' -> 'wsal'
    from kpi_result r7 join kpi_result r30 on r7.days = 7 and r30.days = 30),
  'period metrics follow p_days while fixed-window metrics do not')
else skip('this database already has rows; KPI values are checked on the blank CI database') end;

-- Privacy: an institution name typed by a single active customer lab is never returned, whatever the data.
insert into public.labs (id, name, created_at, institution_name) values
  ('d2000000-0000-4000-8000-0000000000e5', 'KPI solo lab', now() - interval '200 days', 'Kpi Solo Institute');
insert into public.audit_logs (actor_user_id, lab_id, entity_type, entity_id, action, created_at) values
  ('d1000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-0000000000e5', 'inventory', gen_random_uuid(), 'update', now() - interval '1 day');
set local role service_role;
insert into kpi_result select 1, public.analytics_admin_kpis_v1(1);
reset role;
select ok(
  (select pg_catalog.strpos(pg_catalog.lower(r1.k::text), 'solo institute') = 0
      and r1.k #> '{b2b,institutions,salesCandidates}' = r7.k #> '{b2b,institutions,salesCandidates}'
    from kpi_result r1 join kpi_result r7 on r1.days = 1 and r7.days = 7),
  'an institution typed by only one active customer lab is never named');

-- Privacy: no identifiers or free text, whatever the data.
select ok(
  not exists (
    select 1 from kpi_result r
    cross join (values ('d1000000-'), ('d2000000-'), ('d4000000-'), ('d5000000-'), ('d6000000-'), ('example.invalid'),
      ('KPI lab'), ('비커 라벨'), ('kpi fixture'), ('Bad Rule!'), ('store_unlisted'), ('Nitric acid'), ('Buril safety center'),
      ('Fourth'), ('Acetone')) as s(needle)
    where pg_catalog.strpos(r.k::text, s.needle) > 0
  ),
  'KPIs carry no user or lab ids, emails, names or free text');

-- F2: events the client already sends are now accepted; unknown values are still refused.
select lives_ok($$
  insert into public.commerce_intent_events (user_id, event_type, brand_name, cas_input_method) values
    ('d1000000-0000-4000-8000-000000000001', 'cas_suggestion_dismissed', 'acetone', 'suggestion_dismissed'),
    ('d1000000-0000-4000-8000-000000000001', 'inventory_registered', 'Sigma', 'suggested_confirmed'),
    ('d1000000-0000-4000-8000-000000000001', 'inventory_registered', 'Sigma', 'bulk_confirmed')
$$, 'commerce events accept the dismissed suggestion event and the three CAS assist methods');
select throws_ok($$
  insert into public.commerce_intent_events (user_id, event_type, brand_name) values
    ('d1000000-0000-4000-8000-000000000001', 'page_view', 'Sigma')
$$, '23514', null, 'commerce events still refuse an unknown event type');

-- Deleting a lab removes it from the internal list.
delete from public.labs where id = 'd2000000-0000-4000-8000-0000000000ff';
select is((select count(*) from private.analytics_internal_labs where lab_id = 'd2000000-0000-4000-8000-0000000000ff'),
  0::bigint, 'deleting a lab removes it from the internal-lab list');

select * from finish();
rollback;
