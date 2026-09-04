begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(30);

select ok((select relrowsecurity from pg_catalog.pg_class where oid='private.deletion_file_targets_v1'::regclass),
  'deletion file targets have RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='private.deletion_worker_lease_v1'::regclass),
  'deletion worker lease has RLS');
select ok(not has_table_privilege('anon', 'private.deletion_file_targets_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'private.deletion_file_targets_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'private.deletion_file_targets_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
  'no API role can directly access deletion file targets');
select ok(not has_table_privilege('anon', 'private.deletion_worker_lease_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'private.deletion_worker_lease_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'private.deletion_worker_lease_v1', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
  'no API role can directly access the worker lease');

select ok(not has_function_privilege('anon', 'public.acquire_deletion_worker_run_v1(uuid,integer)', 'EXECUTE'), 'anon cannot acquire worker run');
select ok(not has_function_privilege('authenticated', 'public.acquire_deletion_worker_run_v1(uuid,integer)', 'EXECUTE'), 'authenticated cannot acquire worker run');
select ok(has_function_privilege('service_role', 'public.acquire_deletion_worker_run_v1(uuid,integer)', 'EXECUTE'), 'service can acquire worker run');
select ok(not has_function_privilege('anon', 'public.release_deletion_worker_run_v1(uuid)', 'EXECUTE'), 'anon cannot release worker run');
select ok(not has_function_privilege('authenticated', 'public.release_deletion_worker_run_v1(uuid)', 'EXECUTE'), 'authenticated cannot release worker run');
select ok(has_function_privilege('service_role', 'public.release_deletion_worker_run_v1(uuid)', 'EXECUTE'), 'service can release worker run');
select ok(not has_function_privilege('anon', 'public.prepare_deletion_job_database_v1(uuid,uuid)', 'EXECUTE'), 'anon cannot prepare deletion');
select ok(not has_function_privilege('authenticated', 'public.prepare_deletion_job_database_v1(uuid,uuid)', 'EXECUTE'), 'authenticated cannot prepare deletion');
select ok(has_function_privilege('service_role', 'public.prepare_deletion_job_database_v1(uuid,uuid)', 'EXECUTE'), 'service can prepare deletion');
select ok(not has_function_privilege('anon', 'public.list_deletion_file_targets_v1(uuid,uuid)', 'EXECUTE'), 'anon cannot list deletion paths');
select ok(not has_function_privilege('authenticated', 'public.list_deletion_file_targets_v1(uuid,uuid)', 'EXECUTE'), 'authenticated cannot list deletion paths');
select ok(has_function_privilege('service_role', 'public.list_deletion_file_targets_v1(uuid,uuid)', 'EXECUTE'), 'service can list deletion paths');
select ok(not has_function_privilege('anon', 'public.mark_deletion_storage_complete_v1(uuid,uuid)', 'EXECUTE'), 'anon cannot finish storage stage');
select ok(not has_function_privilege('authenticated', 'public.mark_deletion_storage_complete_v1(uuid,uuid)', 'EXECUTE'), 'authenticated cannot finish storage stage');
select ok(has_function_privilege('service_role', 'public.mark_deletion_storage_complete_v1(uuid,uuid)', 'EXECUTE'), 'service can finish storage stage');
select ok(not has_function_privilege('anon', 'public.mark_deletion_auth_complete_v1(uuid,uuid)', 'EXECUTE'), 'anon cannot finish auth stage');
select ok(not has_function_privilege('authenticated', 'public.mark_deletion_auth_complete_v1(uuid,uuid)', 'EXECUTE'), 'authenticated cannot finish auth stage');
select ok(has_function_privilege('service_role', 'public.mark_deletion_auth_complete_v1(uuid,uuid)', 'EXECUTE'), 'service can finish auth stage');
select ok(not has_function_privilege('anon', 'public.finalize_deletion_job_v1(uuid,uuid)', 'EXECUTE'), 'anon cannot finalize deletion');
select ok(not has_function_privilege('authenticated', 'public.finalize_deletion_job_v1(uuid,uuid)', 'EXECUTE'), 'authenticated cannot finalize deletion');
select ok(has_function_privilege('service_role', 'public.finalize_deletion_job_v1(uuid,uuid)', 'EXECUTE'), 'service can finalize deletion');
select ok(not has_function_privilege('anon', 'public.schedule_deletion_job_retry_v1(uuid,uuid,text)', 'EXECUTE'), 'anon cannot schedule deletion retry');
select ok(not has_function_privilege('authenticated', 'public.schedule_deletion_job_retry_v1(uuid,uuid,text)', 'EXECUTE'), 'authenticated cannot schedule deletion retry');
select ok(has_function_privilege('service_role', 'public.schedule_deletion_job_retry_v1(uuid,uuid,text)', 'EXECUTE'), 'service can schedule deletion retry');
select is((select count(*)::integer from private.deletion_worker_lease_v1), 1, 'one worker lease slot exists');
select is((select count(*)::integer from pg_catalog.pg_proc p where p.oid=any(array[
  'public.acquire_deletion_worker_run_v1(uuid,integer)'::regprocedure,
  'public.release_deletion_worker_run_v1(uuid)'::regprocedure,
  'public.prepare_deletion_job_database_v1(uuid,uuid)'::regprocedure,
  'public.list_deletion_file_targets_v1(uuid,uuid)'::regprocedure,
  'public.mark_deletion_storage_complete_v1(uuid,uuid)'::regprocedure,
  'public.mark_deletion_auth_complete_v1(uuid,uuid)'::regprocedure,
  'public.finalize_deletion_job_v1(uuid,uuid)'::regprocedure,
  'public.schedule_deletion_job_retry_v1(uuid,uuid,text)'::regprocedure
]) and p.prosecdef and 'search_path=""'=any(p.proconfig)), 8, 'all public deletion worker RPCs are fixed-path definers');

select * from finish();
rollback;
