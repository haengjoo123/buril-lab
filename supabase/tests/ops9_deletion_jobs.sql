begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

select has_table('private', 'deletion_jobs_v1', 'deletion jobs stay outside the Data API schema');
select has_table('private', 'deletion_job_events_v1', 'deletion evidence stays outside the Data API schema');

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid='private.deletion_jobs_v1'::regclass),
  'deletion jobs enable RLS in addition to direct privilege denial'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid='private.deletion_job_events_v1'::regclass),
  'deletion evidence enables RLS in addition to direct privilege denial'
);

select is(
  (select count(*) from unnest(array['anon','authenticated','service_role']) r
   where has_table_privilege(r, 'private.deletion_jobs_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
  0::bigint,
  'no API role has direct deletion-job table access'
);
select is(
  (select count(*) from unnest(array['anon','authenticated','service_role']) r
   where has_table_privilege(r, 'private.deletion_job_events_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
  0::bigint,
  'no API role has direct deletion-event table access'
);

select ok(
  has_function_privilege('service_role', 'public.enqueue_account_deletion_v1(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.enqueue_account_deletion_v1(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.enqueue_account_deletion_v1(uuid,uuid)', 'EXECUTE'),
  'account deletion intake is service only'
);
select ok(
  has_function_privilege('service_role', 'public.enqueue_lab_deletion_v1(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.enqueue_lab_deletion_v1(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.enqueue_lab_deletion_v1(uuid,uuid,uuid)', 'EXECUTE'),
  'lab deletion intake is service only'
);
select ok(
  has_function_privilege('service_role', 'public.claim_deletion_jobs_v1(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.claim_deletion_jobs_v1(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_deletion_jobs_v1(integer)', 'EXECUTE'),
  'deletion job claiming is service only'
);
select ok(
  has_function_privilege('service_role', 'public.record_deletion_job_result_v1(uuid,uuid,text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_deletion_job_result_v1(uuid,uuid,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_deletion_job_result_v1(uuid,uuid,text,text,text)', 'EXECUTE'),
  'deletion result recording is service only'
);
select ok(
  has_function_privilege('service_role', 'public.get_deletion_job_status_v1(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_deletion_job_status_v1(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.get_deletion_job_status_v1(uuid,uuid)', 'EXECUTE'),
  'deletion status lookup is service only'
);

select is(
  (select count(*) from unnest(array[
      'private.guard_deletion_event_append_only_v1()',
      'private.require_deletion_service_v1()',
      'private.require_deletion_file_ownership_v1(text,uuid,uuid)'
    ]) signature
    cross join unnest(array['anon','authenticated','service_role']) role_name
    where has_function_privilege(role_name, signature, 'EXECUTE')),
  0::bigint,
  'private deletion helpers are not callable by API roles'
);

select is(
  (select count(*) from pg_catalog.pg_proc p where p.oid=any(array[
      'public.enqueue_account_deletion_v1(uuid,uuid)'::regprocedure,
      'public.enqueue_lab_deletion_v1(uuid,uuid,uuid)'::regprocedure,
      'public.claim_deletion_jobs_v1(integer)'::regprocedure,
      'public.record_deletion_job_result_v1(uuid,uuid,text,text,text)'::regprocedure,
      'public.get_deletion_job_status_v1(uuid,uuid)'::regprocedure
    ]) and p.prosecdef),
  5::bigint,
  'all public deletion RPCs are security definers with explicit checks'
);
select ok(
  (select bool_and(coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%')
   from pg_catalog.pg_proc p where p.oid=any(array[
      'private.guard_deletion_event_append_only_v1()'::regprocedure,
      'private.require_deletion_service_v1()'::regprocedure,
      'private.require_deletion_file_ownership_v1(text,uuid,uuid)'::regprocedure,
      'public.enqueue_account_deletion_v1(uuid,uuid)'::regprocedure,
      'public.enqueue_lab_deletion_v1(uuid,uuid,uuid)'::regprocedure,
      'public.claim_deletion_jobs_v1(integer)'::regprocedure,
      'public.record_deletion_job_result_v1(uuid,uuid,text,text,text)'::regprocedure,
      'public.get_deletion_job_status_v1(uuid,uuid)'::regprocedure
   ])),
  'every deletion function fixes an empty search path'
);
select is(
  (select count(*) from pg_catalog.pg_proc p where p.oid=any(array[
      'public.enqueue_account_deletion_v1(uuid,uuid)'::regprocedure,
      'public.enqueue_lab_deletion_v1(uuid,uuid,uuid)'::regprocedure,
      'public.claim_deletion_jobs_v1(integer)'::regprocedure,
      'public.record_deletion_job_result_v1(uuid,uuid,text,text,text)'::regprocedure
    ]) and 'lock_timeout=5s'=any(p.proconfig)),
  4::bigint,
  'all mutating deletion RPCs bound lock waits to five seconds'
);

select is(
  (select count(*) from pg_catalog.pg_trigger where tgrelid='private.deletion_job_events_v1'::regclass
    and tgname='deletion_job_events_v1_no_rewrite' and not tgisinternal),
  1::bigint,
  'event updates and deletes are blocked by one reviewed trigger'
);
select is(
  (select count(*) from pg_catalog.pg_trigger where tgrelid='private.deletion_job_events_v1'::regclass
    and tgname='deletion_job_events_v1_no_truncate' and not tgisinternal),
  1::bigint,
  'event truncation is blocked by a reviewed statement trigger'
);
select is(
  (select count(*) from pg_catalog.pg_indexes where schemaname='private'
    and tablename='deletion_jobs_v1'
    and indexname in ('deletion_jobs_v1_active_account_idx','deletion_jobs_v1_active_lab_idx')),
  2::bigint,
  'one active deletion per account or lab is enforced'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint c
    where c.conrelid='private.deletion_jobs_v1'::regclass and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%attempt_count >= 0%attempt_count <= 12%'),
  'job attempts are bounded at twelve in the database'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint c
    where c.conrelid='private.deletion_job_events_v1'::regclass and c.contype='f'
      and c.confrelid='private.deletion_jobs_v1'::regclass and c.confdeltype='r'),
  'append-only evidence cannot be cascaded away with a job'
);
select is(
  (select count(*) from information_schema.tables where table_schema='public'
    and table_name in ('deletion_jobs_v1','deletion_job_events_v1')),
  0::bigint,
  'no deletion queue table is exposed through public schema'
);
select is(
  (select count(*) from pg_catalog.pg_constraint c
    where c.conrelid='private.deletion_jobs_v1'::regclass and c.contype='u'
      and pg_get_constraintdef(c.oid)='UNIQUE (request_id)'),
  1::bigint,
  'request identifiers are globally idempotent'
);
select ok(
  obj_description('private.deletion_jobs_v1'::regclass) like '%email%object path%token%raw%',
  'the queue contract documents that sensitive provider data is excluded'
);

select * from finish();
rollback;
