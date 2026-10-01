insert into auth.users(id,email) values
('d1000000-0000-4000-8000-000000000001','import-one@example.invalid'),
('d1000000-0000-4000-8000-000000000002','import-two@example.invalid');
insert into public.labs(id,name,created_by) values('d3000000-0000-4000-8000-000000000001','Import fixture','d1000000-0000-4000-8000-000000000001');
insert into public.lab_members(lab_id,user_id,role) values('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','admin') on conflict do nothing;
-- Supabase Storage grants these in its own schema; the local bootstrap is minimal.
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
set role authenticated;
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.inventory_import_jobs(id,user_id,name) values('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','Fixture');
insert into storage.objects(bucket_id,name) values ('inventory-imports','d2000000-0000-4000-8000-000000000001/source/original.xlsx');
select public.save_inventory_import_v1('d2000000-0000-4000-8000-000000000001',0,'{"sources":[{"id":"source","size":10,"grids":[{"id":"sheet","cells":[]}]}],"tables":[{"id":"table","sourceId":"source","gridId":"sheet"}],"rowIds":["good","bad","race","pending"]}',
'[{"id":"good","sourceId":"source","tableId":"table","fields":{"name":"Ethanol","quantity":"2"},"attributes":[{"label":"Lot","value":"L-001","address":"E2"}]},
{"id":"bad","fields":{"name":"Bad","quantity":"1.5"}}, {"id":"race","fields":{"name":"Concurrent","quantity":"2"}},
{"id":"pending","fields":{"name":"Pending","quantity":"2"},"reviewRequired":true,"reviewed":false}]');
do $$ declare r jsonb; begin
  r := public.commit_inventory_import_batch_v1('d2000000-0000-4000-8000-000000000001',1,
  '[{"rowId":"good","input":{"name":"Ethanol","quantity":2,"storage_type":"other","cas_number":"64-17-5"}},
  {"rowId":"bad","input":{"name":"Bad","quantity":1.5,"storage_type":"other"}},
  {"rowId":"pending","input":{"name":"Pending","quantity":2,"storage_type":"other"}}]');
  if r->0->>'inventoryId' is null or r->1->>'error' is null or r->2->>'error' is null then raise exception 'Partial commit or review validation failed: %',r; end if;
  r := public.commit_inventory_import_batch_v1('d2000000-0000-4000-8000-000000000001',0,
  '[{"rowId":"good","input":{"name":"Ethanol","quantity":2,"storage_type":"other"}}]');
  if (r->0->>'idempotent')::boolean is not true then raise exception 'Idempotent replay failed'; end if;
  if (select count(*) from public.inventory where name='Ethanol')<>1 then raise exception 'Duplicate reagent'; end if;
  if (select source_attributes->0->>'value' from public.inventory where name='Ethanol')<>'L-001' then raise exception 'Source lost'; end if;
  begin perform public.save_inventory_import_v1('d2000000-0000-4000-8000-000000000001',0,null,'[]'); raise exception 'Stale draft accepted'; exception when serialization_failure then null; end;
  begin update public.inventory_import_rows set inventory_id=null; raise exception 'Receipt mutation allowed'; exception when insufficient_privilege then null; end;
  r := public.commit_inventory_import_batch_v1('d2000000-0000-4000-8000-000000000001',1,
    '[{"rowId":"bad","input":{"name":"Bad","quantity":1,"storage_type":"other","capacity":"0 mL"}}]');
  if r->0->>'error' is null then raise exception 'Invalid capacity accepted'; end if;
  r := public.commit_inventory_import_batch_v1('d2000000-0000-4000-8000-000000000001',1,
    '[{"rowId":"bad","input":{"name":"Bad","quantity":1,"storage_type":"other","cas_number":"64-17-9"}}]');
  if r->0->>'error' is null then raise exception 'Invalid CAS accepted'; end if;
  r := public.commit_inventory_import_batch_v1('d2000000-0000-4000-8000-000000000001',1,
    '[{"rowId":"bad","input":{"name":"Bad","quantity":1,"storage_type":"other","expiry_date":"2026-02-30","manufacturer_date_type":"expiry"}}]');
  if r->0->>'error' is null then raise exception 'Invalid date accepted'; end if;
  begin perform public.save_inventory_import_v1('d2000000-0000-4000-8000-000000000001',1,'{}','[]'); raise exception 'Missing metadata arrays accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.save_inventory_import_v1('d2000000-0000-4000-8000-000000000001',1,null,'[{"id":"good","fields":{"name":"Changed","quantity":"2"}}]'); raise exception 'Committed row edited by stale tab'; exception when serialization_failure then null; end;
  begin perform public.save_inventory_import_v1('d2000000-0000-4000-8000-000000000001',1,'{"sources":[],"tables":[],"rowIds":[]}','[]'); raise exception 'Committed source removed by stale tab'; exception when serialization_failure then null; end;
end $$;
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ begin
  if exists(select 1 from public.inventory_import_jobs) then raise exception 'Cross-user read'; end if;
  if exists(select 1 from public.inventory_import_rows) then raise exception 'Cross-user rows'; end if;
  if exists(select 1 from storage.objects where bucket_id='inventory-imports') then raise exception 'Cross-user source read'; end if;
  begin perform public.save_inventory_import_v1('d2000000-0000-4000-8000-000000000001',1,null,'[]'); raise exception 'Cross-user save'; exception when insufficient_privilege then null; end;
  begin perform public.commit_inventory_import_batch_v1('d2000000-0000-4000-8000-000000000001',1,'[{"rowId":"race","input":{"name":"Concurrent","quantity":2,"storage_type":"other"}}]'); raise exception 'Cross-user commit'; exception when insufficient_privilege then null; end;
  begin insert into storage.objects(bucket_id,name) values ('inventory-imports','d2000000-0000-4000-8000-000000000001/source/original.xlsx'); raise exception 'Cross-user file'; exception when insufficient_privilege then null; end;
end $$;

-- An uncertain save can be replayed without advancing the revision twice.
set role authenticated;
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.inventory_import_jobs(id,user_id,name) values('d2000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','Save retry');
do $$ declare a integer; b integer; begin
  a := public.save_inventory_import_v1('d2000000-0000-4000-8000-000000000003',0,null,'[]','d5000000-0000-4000-8000-000000000001');
  b := public.save_inventory_import_v1('d2000000-0000-4000-8000-000000000003',0,null,'[]','d5000000-0000-4000-8000-000000000001');
  if a<>1 or b<>1 then raise exception 'Save retry was not idempotent'; end if;
end $$;
reset role;
do $$ begin
  if not private.valid_import_capacity('2 x 1,000.5 mL') or not private.valid_import_capacity('1,5 L') or private.valid_import_capacity('1..5 g') or private.valid_import_capacity('0 mL') then raise exception 'Capacity contract differs'; end if;
  if has_function_privilege('anon','public.commit_inventory_import_batch_v1(uuid,integer,jsonb)','execute') then raise exception 'Anonymous commit'; end if;
  if has_function_privilege('authenticated','public.prepare_deletion_job_database_before_import_v1(uuid,uuid)','execute') then raise exception 'Legacy deletion bypass'; end if;
  if not exists(select 1 from pg_constraint where conrelid='private.deletion_file_targets_v1'::regclass and pg_get_constraintdef(oid) like '%inventory-imports%') then raise exception 'Import deletion not integrated'; end if;
end $$;

-- Save and commit 10,000 rows through the same 100-row contract as the client.
set role authenticated;
set request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.inventory_import_jobs(id,user_id,name) values('d2000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000001','10k fixture');
do $$ declare batch integer; rev integer := 0; drafts jsonb; inputs jsonb; receipts jsonb; begin
  for batch in 0..99 loop
    select jsonb_agg(jsonb_build_object('id','load-'||n,'fields',jsonb_build_object('name','Load reagent '||n,'quantity','2'))),
      jsonb_agg(jsonb_build_object('rowId','load-'||n,'input',jsonb_build_object('name','Load reagent '||n,'quantity',2,'storage_type','other')))
      into drafts,inputs from generate_series(batch*100+1,batch*100+100) n;
    rev := public.save_inventory_import_v1('d2000000-0000-4000-8000-000000000004',rev,null,drafts);
    receipts := public.commit_inventory_import_batch_v1('d2000000-0000-4000-8000-000000000004',rev,inputs);
    if exists(select 1 from jsonb_array_elements(receipts) r where r ? 'error') then raise exception '10k commit failed: %',receipts; end if;
  end loop;
  if (select count(distinct inventory_id) from public.inventory_import_rows where job_id='d2000000-0000-4000-8000-000000000004')<>10000 then raise exception '10k receipt loss'; end if;
  receipts := public.commit_inventory_import_batch_v1('d2000000-0000-4000-8000-000000000004',rev,inputs);
  if exists(select 1 from jsonb_array_elements(receipts) r where r->>'idempotent'<>'true') then raise exception 'Batch retry was not idempotent'; end if;
  if (select count(*) from public.inventory where name like 'Load reagent %')<>10000 then raise exception '10k inventory loss/duplication'; end if;
end $$;
reset role;
