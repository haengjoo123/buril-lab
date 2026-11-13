begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(9);

insert into auth.users(id,email) values
  ('a1000000-0000-4000-8000-000000000001','sds-admin@example.invalid'),
  ('a1000000-0000-4000-8000-000000000002','sds-member@example.invalid'),
  ('a1000000-0000-4000-8000-000000000003','sds-outsider@example.invalid');
insert into public.labs(id,name) values
  ('a2000000-0000-4000-8000-000000000001','SDS lab'),
  ('a2000000-0000-4000-8000-000000000002','SDS other lab');
insert into public.lab_members(lab_id,user_id,role) values
  ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','admin'),
  ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','student'),
  ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','researcher');

select ok(
  (select not public from storage.buckets where id = 'inventory-sds')
  and not has_table_privilege('anon', 'public.inventory_sds_documents', 'SELECT')
  and has_table_privilege('authenticated', 'public.inventory_sds_documents', 'SELECT')
  and not has_table_privilege('authenticated', 'public.inventory_sds_documents', 'INSERT')
  and not has_table_privilege('authenticated', 'public.inventory_sds_documents', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.inventory_sds_documents', 'DELETE')
  and not has_function_privilege('anon', 'public.create_inventory_sds_document_v1(uuid,text,text,text,text,text,date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.delete_inventory_sds_document_v1(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_inventory_sds_document_v1(uuid,text,text,text,text,text,date)', 'EXECUTE'),
  'the SDS bucket is private and clients write records only through RPCs'
);

set request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
select lives_ok(
  $$insert into storage.objects(bucket_id, name, metadata) values ('inventory-sds', 'a2000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000001.pdf', '{"mimetype":"application/pdf","size":4096}'::jsonb)$$,
  'a lab member uploads into the lab folder'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata) values ('inventory-sds', 'a2000000-0000-4000-8000-000000000002/b3000000-0000-4000-8000-000000000002.pdf', '{"mimetype":"application/pdf","size":10}'::jsonb)$$,
  '42501', 'new row violates row-level security policy for table "objects"',
  'a member cannot upload into another lab''s folder'
);
select is(
  (public.create_inventory_sds_document_v1('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000001.pdf', 'acetone.pdf', ' 67-64-1 '))->>'size_bytes',
  '4096',
  'registration takes the type and size from the stored object'
);
select throws_ok(
  $$select public.create_inventory_sds_document_v1('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000009.pdf', 'missing.pdf', '67-64-1')$$,
  'P0002', 'INVENTORY_SDS_FILE_MISSING',
  'a record cannot point at a file that was never uploaded'
);
reset role;

set request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}';
set role authenticated;
select is(
  (select count(*) from public.inventory_sds_documents) + (select count(*) from storage.objects where bucket_id = 'inventory-sds'),
  0::bigint,
  'another lab sees neither SDS records nor files'
);
select throws_ok(
  $$select public.delete_inventory_sds_document_v1((select id from public.inventory_sds_documents limit 1))$$,
  '42501', 'INVENTORY_SDS_ACCESS_DENIED',
  'another lab cannot remove a record'
);
reset role;

set request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
select is(
  public.delete_inventory_sds_document_v1((select id from public.inventory_sds_documents where file_name = 'acetone.pdf')),
  'a2000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000001.pdf',
  'a lab admin removes a record and gets the file path back'
);
reset role;

select ok(
  strpos(pg_get_functiondef('public.prepare_deletion_job_database_v1(uuid,uuid)'::regprocedure), 'inventory-sds') > 0
  and strpos(pg_get_functiondef('public.prepare_deletion_job_database_v1(uuid,uuid)'::regprocedure), 'tool-images') > 0
  and exists (
    select 1 from pg_constraint
    where conrelid = 'private.deletion_file_targets_v1'::regclass and conname = 'deletion_file_targets_v1_bucket_id_check'
      and strpos(pg_get_constraintdef(oid), 'inventory-sds') > 0
  ),
  'lab and account deletion queue SDS files alongside tool images'
);

select * from finish();
rollback;
