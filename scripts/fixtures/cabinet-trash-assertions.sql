insert into auth.users(id,email) values ('a1000000-0000-4000-8000-000000000001','cabinet-test@example.invalid'),('a1000000-0000-4000-8000-000000000002','outsider@example.invalid');
insert into public.cabinets(id,name,user_id) values ('a2000000-0000-4000-8000-000000000001','Test cabinet','a1000000-0000-4000-8000-000000000001');
insert into public.cabinet_shelves(id,cabinet_id,level) values ('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',0),('a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001',1);
insert into public.inventory(id,name,user_id,storage_type,cabinet_id) values ('a5000000-0000-4000-8000-000000000001','Test reagent','a1000000-0000-4000-8000-000000000001','cabinet','a2000000-0000-4000-8000-000000000001');
insert into public.inventory(id,name,user_id) values ('a5000000-0000-4000-8000-000000000002','Foreign reagent','a1000000-0000-4000-8000-000000000002');
insert into public.cabinet_items(id,cabinet_id,shelf_id,template,name,width,position,inventory_item_id,cas_no) values ('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002','A','Test reagent',8,30,'a5000000-0000-4000-8000-000000000001','67-64-1');
set request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
do $$
declare cid uuid:='a2000000-0000-4000-8000-000000000001'; snapshot jsonb; revision bigint; tid uuid; after_delete bigint; layout jsonb;
begin
  snapshot:=public.get_cabinet_state_v2(cid); revision:=(snapshot->'cabinet'->>'layout_revision')::bigint;
  select jsonb_agg(s || jsonb_build_object('items',coalesce((select jsonb_agg(i) from jsonb_array_elements(snapshot->'items') i where i->>'shelf_id'=s->>'id'),'[]'::jsonb))) into layout from jsonb_array_elements(snapshot->'shelves') s;
  begin
    perform public.save_cabinet_state_v2(cid,jsonb_set(layout,'{1,items,0,inventory_item_id}','"a5000000-0000-4000-8000-000000000002"'),5,9,2,revision,'{}','{}');
    raise exception 'foreign inventory link accepted';
  exception when insufficient_privilege then null; end;
  revision:=public.save_cabinet_state_v2(cid,jsonb_set(layout,'{1,items,0,name}','"Edited reagent"'),5,9,2,revision,'{}','{}');
  if not exists(select 1 from public.inventory where name='Edited reagent') then raise exception 'metadata was not committed together'; end if;
  -- Change it back for the remaining identity checks.
  revision:=public.save_cabinet_state_v2(cid,layout,5,9,2,revision,'{}','{}');
  begin
    perform public.save_cabinet_state_v2(cid,'[{"id":"a3000000-0000-4000-8000-000000000001","level":0,"dividers":[],"items":[]}]',5,9,2,revision,'{}','{}');
    raise exception 'missing intent accepted';
  exception when others then if SQLERRM not like 'CABINET_EXPLICIT_DELETION_REQUIRED%' then raise; end if; end;
  after_delete:=public.save_cabinet_state_v2(cid,'[{"id":"a3000000-0000-4000-8000-000000000001","level":0,"dividers":[],"items":[]}]',5,9,2,revision,array['a3000000-0000-4000-8000-000000000002']::uuid[],array['a4000000-0000-4000-8000-000000000001']::uuid[]);
  if exists(select 1 from public.inventory) or exists(select 1 from public.cabinet_items) then raise exception 'archived inventory remains active'; end if;
  select id into tid from public.cabinet_trash;
  if not exists(select 1 from public.cabinet_trash where expires_at-deleted_at=interval '240 hours' and cardinality(item_ids)=1 and cardinality(shelf_ids)=1) then raise exception 'invalid retention batch'; end if;
  begin
    perform public.save_cabinet_state_v2(cid,'[]',5,9,2,revision,'{}','{}'); raise exception 'stale save accepted';
  exception when serialization_failure then null; end;
  perform public.restore_cabinet_trash_v2(cid,tid,after_delete);
  if not exists(select 1 from public.inventory) or (select count(*) from public.cabinet_shelves)<>2 or not exists(select 1 from public.cabinet_items where inventory_item_id='a5000000-0000-4000-8000-000000000001') then raise exception 'restore lost data'; end if;
  snapshot:=public.get_cabinet_state_v2(cid); revision:=(snapshot->'cabinet'->>'layout_revision')::bigint;
  select jsonb_agg(s || jsonb_build_object('items',coalesce((select jsonb_agg(i) from jsonb_array_elements(snapshot->'items') i where i->>'shelf_id'=s->>'id'),'[]'::jsonb))) into layout from jsonb_array_elements(snapshot->'shelves') s;
  perform public.update_cabinet_item_ghs_v2(cid,'a4000000-0000-4000-8000-000000000001','wrong-cas','Test reagent','["H999"]','success',now());
  if exists(select 1 from public.cabinet_items where h_codes='["H999"]') then raise exception 'stale GHS accepted'; end if;
  perform public.update_cabinet_item_ghs_v2(cid,'a4000000-0000-4000-8000-000000000001','67-64-1','Test reagent','["H225"]','success',now());
  if (public.get_cabinet_state_v2(cid)->'cabinet'->>'layout_revision')::bigint<>revision then raise exception 'GHS invalidated layout revision'; end if;
  revision:=public.save_cabinet_state_v2(cid,layout,5,9,2,revision,'{}','{}');
  if not exists(select 1 from public.cabinet_items where h_codes='["H225"]') then raise exception 'old layout erased new GHS result'; end if;
  begin
    perform public.save_cabinet_state_v2(cid,jsonb_set(layout,'{1,items}',(layout->1->'items') || jsonb_set(layout->1->'items'->0,'{id}','"a4000000-0000-4000-8000-000000000002"') - 'inventory_item_id'),5,9,2,revision,'{}','{}');
    raise exception 'overlapping placement accepted';
  exception when others then if SQLERRM not like 'CABINET_SPACE_REQUIRED%' and SQLERRM not like 'CABINET_SHARED_INVENTORY_LINK%' then raise; end if; end;
  perform public.save_cabinet_state_v2(cid,'[{"id":"a3000000-0000-4000-8000-000000000001","level":0,"dividers":[],"items":[]}]',5,9,2,revision,array['a3000000-0000-4000-8000-000000000002']::uuid[],array['a4000000-0000-4000-8000-000000000001']::uuid[]);
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.audit_logs where entity_type='cabinet_item' and actor_user_id='a1000000-0000-4000-8000-000000000001') then raise exception 'derived cabinet audit missing'; end if;
end $$;
select set_config('cabinet.test.trash_id',(select id::text from public.cabinet_trash),false);
update public.cabinet_trash set deleted_at=now()-interval '241 hours',expires_at=now()-interval '1 hour';
set role authenticated;
do $$ declare tid uuid; rev bigint; begin
  tid:=current_setting('cabinet.test.trash_id')::uuid;
  if exists(select 1 from public.inventory) or exists(select 1 from public.cabinet_trash) then raise exception 'expired trash is visible before purge'; end if;
  rev:=(public.get_cabinet_state_v2('a2000000-0000-4000-8000-000000000001')->'cabinet'->>'layout_revision')::bigint;
  begin
    perform public.restore_cabinet_trash_v2('a2000000-0000-4000-8000-000000000001',tid,rev); raise exception 'expired restore accepted';
  exception when others then if SQLERRM not like 'CABINET_TRASH_EXPIRED%' then raise; end if; end;
  if has_function_privilege('authenticated','public.purge_expired_cabinet_trash_v2()','EXECUTE') or has_function_privilege('authenticated','public.save_cabinet_state_with_dates(uuid,jsonb,integer,integer,integer)','EXECUTE') then raise exception 'privilege bypass'; end if;
end $$;
reset role;
set request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
do $$ begin
  if exists(select 1 from public.cabinet_trash) then raise exception 'outsider sees trash'; end if;
  begin perform public.get_cabinet_state_v2('a2000000-0000-4000-8000-000000000001'); raise exception 'outsider reads snapshot'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
select public.purge_expired_cabinet_trash_v2();
select public.purge_expired_cabinet_trash_v2();
reset role;
do $$ begin
  if exists(select 1 from public.inventory where user_id='a1000000-0000-4000-8000-000000000001') or exists(select 1 from public.cabinet_trash where payload is not null) then raise exception 'purge left recoverable data'; end if;
  if not exists(select 1 from public.inventory where id='a5000000-0000-4000-8000-000000000002') then raise exception 'purge affected foreign inventory'; end if;
  if not exists(select 1 from public.cabinet_trash where cardinality(item_ids)=1 and cardinality(shelf_ids)=1 and inventory_ids='{}') then raise exception 'purge lost tombstone'; end if;
end $$;
set request.jwt.claims='{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
do $$ declare first_cabinet jsonb; second_cabinet jsonb; first_id uuid; removed_shelf uuid; original_revision bigint; restored_revision bigint; layout jsonb; trash_id uuid; begin
  first_cabinet:=public.create_cabinet_v2('First',null,5,9,2,null);
  second_cabinet:=public.create_cabinet_v2('Second',null,5,9,2,null);
  if (select count(distinct id) from public.cabinet_shelves where cabinet_id in ((first_cabinet->>'id')::uuid,(second_cabinet->>'id')::uuid))<>8 then raise exception 'initial shelf identifiers are reused'; end if;
  first_id:=(first_cabinet->>'id')::uuid;
  original_revision:=(public.get_cabinet_state_v2(first_id)->'cabinet'->>'layout_revision')::bigint;
  select id into removed_shelf from public.cabinet_shelves where cabinet_id=first_id and level=1;
  select jsonb_agg(to_jsonb(s)||jsonb_build_object('level',case when level>1 then level-1 else level end,'items','[]'::jsonb) order by level) into layout from public.cabinet_shelves s where cabinet_id=first_id and id<>removed_shelf;
  restored_revision:=public.save_cabinet_state_v2(first_id,layout,5,9,2,original_revision,array[removed_shelf],'{}');
  select id into trash_id from public.cabinet_trash where cabinet_id=first_id;
  perform public.restore_cabinet_trash_v2(first_id,trash_id,restored_revision);
  if not exists(select 1 from public.cabinet_shelves where id=removed_shelf and level=1) or (select count(distinct level) from public.cabinet_shelves where cabinet_id=first_id)<>4 then raise exception 'restore lost the original shelf order'; end if;
  begin
    insert into public.cabinet_items(id,cabinet_id,shelf_id,template,name,width,position)
    values('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','A','Replay',8,30);
    raise exception 'expired UUID replay accepted';
  exception when others then if SQLERRM not like 'CABINET_RESTORE_REQUIRED%' then raise; end if; end;
end $$;
reset role;
select 'CABINET_TRASH_SQL_ASSERTIONS_PASSED';
