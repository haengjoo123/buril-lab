begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select has_table('private', 'operator_role_assignments_v1', 'operator roles stay outside the Data API schema');
select has_table('private', 'operator_action_audit_v1', 'operator audit stays outside the Data API schema');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='private.operator_role_assignments_v1'::regclass), 'operator roles enable RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='private.operator_action_audit_v1'::regclass), 'operator audit enables RLS');

select is(
  (select count(*) from unnest(array['anon','authenticated','service_role']) role_name
   where has_table_privilege(role_name, 'private.operator_role_assignments_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
  0::bigint, 'no API role directly accesses operator roles'
);
select is(
  (select count(*) from unnest(array['anon','authenticated','service_role']) role_name
   where has_table_privilege(role_name, 'private.operator_action_audit_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
  0::bigint, 'no API role directly accesses operator audit'
);

select ok(
  has_function_privilege('service_role', 'public.set_operator_role_v1(uuid,text,boolean,uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_operator_role_v1(uuid,text,boolean,uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.set_operator_role_v1(uuid,text,boolean,uuid,uuid,text)', 'EXECUTE'),
  'operator role changes are service only'
);
select ok(
  has_function_privilege('service_role', 'public.authorize_operator_action_v1(uuid,text,text,text,uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.authorize_operator_action_v1(uuid,text,text,text,uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.authorize_operator_action_v1(uuid,text,text,text,uuid,uuid,text)', 'EXECUTE'),
  'operator authorization is service only'
);
select ok(
  has_function_privilege('service_role', 'public.authorize_operator_fallback_v1(uuid,text,text,text,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.authorize_operator_fallback_v1(uuid,text,text,text,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.authorize_operator_fallback_v1(uuid,text,text,text,uuid,text)', 'EXECUTE'),
  'emergency fallback authorization is service only'
);
select ok(
  has_function_privilege('service_role', 'public.operator_feedback_status_v1(uuid,uuid,text,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.operator_feedback_status_v1(uuid,uuid,text,uuid,text)', 'EXECUTE'),
  'feedback mutation wrapper is service only'
);
select ok(
  has_function_privilege('service_role', 'public.operator_safety_center_status_v1(uuid,uuid,text,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.operator_safety_center_status_v1(uuid,uuid,text,uuid,text)', 'EXECUTE'),
  'safety-center mutation wrapper is service only'
);
select ok(
  has_function_privilege('service_role', 'public.operator_analytics_review_decide_v1(uuid,uuid,text,text,jsonb,text,text,text,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.operator_analytics_review_decide_v1(uuid,uuid,text,text,jsonb,text,text,text,uuid,text)', 'EXECUTE'),
  'review mutation wrapper is service only'
);

select is(
  (select count(*) from unnest(array[
      'private.guard_operator_audit_append_only_v1()',
      'private.require_operator_service_v1()',
      'private.operator_access_decision_v1(uuid,text,text,text,text)',
      'private.insert_operator_audit_v1(uuid,uuid,text,text,text,uuid,text,text,text)'
    ]) signature cross join unnest(array['anon','authenticated','service_role']) role_name
    where has_function_privilege(role_name, signature, 'EXECUTE')),
  0::bigint, 'private operator helpers are not callable by API roles'
);
select is(
  (select count(*) from pg_catalog.pg_proc p where p.oid=any(array[
      'public.set_operator_role_v1(uuid,text,boolean,uuid,uuid,text)'::regprocedure,
      'public.authorize_operator_action_v1(uuid,text,text,text,uuid,uuid,text)'::regprocedure,
      'public.authorize_operator_fallback_v1(uuid,text,text,text,uuid,text)'::regprocedure,
      'public.operator_feedback_status_v1(uuid,uuid,text,uuid,text)'::regprocedure,
      'public.operator_safety_center_status_v1(uuid,uuid,text,uuid,text)'::regprocedure,
      'public.operator_analytics_review_decide_v1(uuid,uuid,text,text,jsonb,text,text,text,uuid,text)'::regprocedure
    ]) and p.prosecdef),
  6::bigint, 'all public operator RPCs are security definers'
);
select ok(
  (select bool_and('search_path=""'=any(p.proconfig)) from pg_catalog.pg_proc p where p.oid=any(array[
      'private.guard_operator_audit_append_only_v1()'::regprocedure,
      'private.require_operator_service_v1()'::regprocedure,
      'private.operator_access_decision_v1(uuid,text,text,text,text)'::regprocedure,
      'private.insert_operator_audit_v1(uuid,uuid,text,text,text,uuid,text,text,text)'::regprocedure,
      'public.set_operator_role_v1(uuid,text,boolean,uuid,uuid,text)'::regprocedure,
      'public.authorize_operator_action_v1(uuid,text,text,text,uuid,uuid,text)'::regprocedure,
      'public.authorize_operator_fallback_v1(uuid,text,text,text,uuid,text)'::regprocedure,
      'public.operator_feedback_status_v1(uuid,uuid,text,uuid,text)'::regprocedure,
      'public.operator_safety_center_status_v1(uuid,uuid,text,uuid,text)'::regprocedure,
      'public.operator_analytics_review_decide_v1(uuid,uuid,text,text,jsonb,text,text,text,uuid,text)'::regprocedure
    ])),
  'every operator function fixes an empty search path'
);
select is(
  (select count(*) from pg_catalog.pg_proc p where p.oid=any(array[
      'public.set_operator_role_v1(uuid,text,boolean,uuid,uuid,text)'::regprocedure,
      'public.authorize_operator_action_v1(uuid,text,text,text,uuid,uuid,text)'::regprocedure,
      'public.authorize_operator_fallback_v1(uuid,text,text,text,uuid,text)'::regprocedure,
      'public.operator_feedback_status_v1(uuid,uuid,text,uuid,text)'::regprocedure,
      'public.operator_safety_center_status_v1(uuid,uuid,text,uuid,text)'::regprocedure,
      'public.operator_analytics_review_decide_v1(uuid,uuid,text,text,jsonb,text,text,text,uuid,text)'::regprocedure
    ]) and 'lock_timeout=5s'=any(p.proconfig)),
  6::bigint, 'all operator RPCs bound lock waits to five seconds'
);

select is((select count(*) from pg_catalog.pg_trigger where tgrelid='private.operator_action_audit_v1'::regclass and tgname='operator_action_audit_v1_no_rewrite' and not tgisinternal), 1::bigint, 'audit update and delete are blocked');
select is((select count(*) from pg_catalog.pg_trigger where tgrelid='private.operator_action_audit_v1'::regclass and tgname='operator_action_audit_v1_no_truncate' and not tgisinternal), 1::bigint, 'audit truncate is blocked');
select is((select count(*) from information_schema.tables where table_schema='public' and table_name in ('operator_role_assignments_v1','operator_action_audit_v1')), 0::bigint, 'operator tables are not public');
select is((select count(*) from pg_catalog.pg_constraint c where c.conrelid='private.operator_role_assignments_v1'::regclass and c.contype='u' and pg_get_constraintdef(c.oid)='UNIQUE (user_id, role)'), 1::bigint, 'one assignment exists per user and role');
select ok(exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='private.operator_role_assignments_v1'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) like '%reader%approver%raw_exporter%'), 'only the three reviewed roles are accepted');
select ok(exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='private.operator_action_audit_v1'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) like '%authorized%denied%succeeded%'), 'audit outcomes are bounded');
select ok(exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='private.operator_role_assignments_v1'::regclass and c.contype='f' and c.confrelid='auth.users'::regclass and c.confdeltype='r'), 'role assignment cannot silently disappear with a user');
select ok(obj_description('private.operator_role_assignments_v1'::regclass) like '%No email%', 'role table documents that email addresses are excluded');
select ok(obj_description('private.operator_action_audit_v1'::regclass) like '%No names%tokens%raw errors%', 'operator audit documents excluded sensitive values');
select is((select count(*) from pg_catalog.pg_indexes where schemaname='private' and tablename='operator_role_assignments_v1' and indexname='operator_role_assignments_v1_active_idx'), 1::bigint, 'active role lookup is indexed');

select * from finish();
rollback;
