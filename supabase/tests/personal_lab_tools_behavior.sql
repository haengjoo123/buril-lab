begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(30);

select has_table('public','tool_documents','Tool documents exist');
select has_table('public','tool_attachments','Tool attachments exist');
select ok((select relrowsecurity from pg_class where oid='public.tool_documents'::regclass),'Document RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.tool_attachments'::regclass),'Attachment RLS is enabled');
select ok(not has_table_privilege('anon','public.tool_documents','select'),'Anonymous document reads are denied');
select ok(has_table_privilege('authenticated','public.tool_documents','select'),'Authenticated document reads are available through RLS');
select ok(not has_table_privilege('authenticated','public.tool_documents','insert'),'Direct document inserts cannot bypass revisions');
select ok(not has_table_privilege('authenticated','public.tool_documents','update'),'Direct document updates cannot bypass revisions');
select ok(not has_table_privilege('authenticated','public.tool_documents','delete'),'Direct document deletes cannot bypass revisions');
select ok(not has_function_privilege('anon','public.save_tool_document(uuid,text,text,jsonb,text,integer,timestamptz)','execute'),'Anonymous saves are denied');
select ok(has_function_privilege('authenticated','public.save_tool_document(uuid,text,text,jsonb,text,integer,timestamptz)','execute'),'Authenticated saves use the guarded RPC');
select ok(not has_function_privilege('service_role','public.save_tool_document(uuid,text,text,jsonb,text,integer,timestamptz)','execute'),'Save RPC has no unused service-role grant');
select is((select public from storage.buckets where id='tool-images'),false,'Tool image bucket is private');
select ok(not has_function_privilege('authenticated','public.prepare_deletion_job_database_before_tools_v1(uuid,uuid)','execute'),'Old deletion implementation is inaccessible to users');
select ok(has_function_privilege('service_role','public.prepare_deletion_job_database_v1(uuid,uuid)','execute'),'Deletion worker keeps its entry point');

insert into auth.users(id,email) values
 ('f9110000-0000-4000-8000-000000000001','tools-owner@example.invalid'),
 ('f9110000-0000-4000-8000-000000000002','tools-outsider@example.invalid');
set request.jwt.claims='{"sub":"f9110000-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((public.save_tool_document('f9120000-0000-4000-8000-000000000001','notes','Tool test','{}','1',0)).revision,1,'New document starts at revision one');
select is((public.save_tool_document('f9120000-0000-4000-8000-000000000001','notes','Updated','{}','1',1)).revision,2,'Expected revision advances exactly once');
select throws_ok($$select public.save_tool_document('f9120000-0000-4000-8000-000000000001','notes','Stale','{}','1',1)$$,'40001','Document conflict','Stale saves are rejected');
select throws_ok($$update public.tool_documents set title='Bypass'$$,'42501','permission denied for table tool_documents','Direct table writes are rejected');
select lives_ok($$insert into public.tool_attachments(id,owner_id,document_id,path,mime_type) values('f9130000-0000-4000-8000-000000000001','f9110000-0000-4000-8000-000000000001','f9120000-0000-4000-8000-000000000001','f9110000-0000-4000-8000-000000000001/test.png','image/png')$$,'Owner can attach an image to their document');
select lives_ok($$insert into storage.objects(bucket_id,name) values('tool-images','f9110000-0000-4000-8000-000000000001/test.png')$$,'Owner can store a private image');

set request.jwt.claims='{"sub":"f9110000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.tool_documents),0::bigint,'Another account cannot read the document');
select is((select count(*) from public.tool_attachments),0::bigint,'Another account cannot read attachment metadata');
select is((select count(*) from storage.objects where bucket_id='tool-images'),0::bigint,'Another account cannot read the image');
select throws_ok($$select public.save_tool_document('f9120000-0000-4000-8000-000000000001','notes','Steal','{}','1',2)$$,'40001','Document conflict','Another account cannot update the document');
select throws_ok($$insert into public.tool_attachments(id,owner_id,document_id,path,mime_type) values('f9130000-0000-4000-8000-000000000002','f9110000-0000-4000-8000-000000000002','f9120000-0000-4000-8000-000000000001','f9110000-0000-4000-8000-000000000002/test.png','image/png')$$,'42501','new row violates row-level security policy for table "tool_attachments"','Another account cannot attach to a foreign document');
select throws_ok($$insert into storage.objects(bucket_id,name) values('tool-images','f9110000-0000-4000-8000-000000000001/foreign.png')$$,'42501','new row violates row-level security policy for table "objects"','Another account cannot upload to the owner folder');
reset role;
select ok(strpos(pg_get_functiondef('public.prepare_deletion_job_database_v1(uuid,uuid)'::regprocedure),'tool-images')>0,'Account deletion includes private tool images');
select ok(exists(select 1 from pg_constraint where conrelid='public.feedback'::regclass and conname='feedback_source_screen_check' and strpos(pg_get_constraintdef(oid),'tools')>0),'Feedback accepts the tools source');
select ok(exists(select 1 from pg_constraint where conrelid='private.deletion_file_targets_v1'::regclass and conname='deletion_file_targets_v1_bucket_id_check' and strpos(pg_get_constraintdef(oid),'tool-images')>0),'Deletion queue accepts private tool images');

select * from finish();
rollback;
