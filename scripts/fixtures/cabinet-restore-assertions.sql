-- Synthetic data; no user layouts are modified or retained.
begin;
set local statement_timeout = '30s';
do $test$
declare
  uid uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  cid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); sid2 uuid:=gen_random_uuid();
  iid uuid:=gen_random_uuid(); inv uuid:=gen_random_uuid(); blocker uuid:=gen_random_uuid();
  big_id uuid:=gen_random_uuid(); tid uuid; revision bigint;
  layout jsonb; original jsonb; restored public.cabinet_items; batch jsonb;
begin
  insert into auth.users(id,email) values(uid,uid::text||'@example.invalid'),(outsider,outsider::text||'@example.invalid');
  insert into public.cabinets(id,name,user_id,width,height,depth) values(cid,'Restore regression',uid,6,9,2);
  insert into public.cabinet_shelves(id,cabinet_id,level,dividers) values(sid,cid,0,'[]'),(sid2,cid,1,'[]');
  insert into public.inventory(id,name,user_id,storage_type,cabinet_id) values(inv,'Restored reagent',uid,'cabinet',cid);
  insert into public.cabinet_items(id,cabinet_id,shelf_id,template,name,width,position,depth_position,inventory_item_id)
    values(iid,cid,sid,'A','Restored reagent',8,52,84,inv);
  insert into public.cabinet_items(cabinet_id,shelf_id,template,name,width,position,depth_position)
    values(cid,sid,'A','Unrelated overlap 1',8,12,36),(cid,sid,'A','Unrelated overlap 2',8,12,36);
  select to_jsonb(i) into original from public.cabinet_items i where id=iid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select jsonb_agg(to_jsonb(s)||jsonb_build_object('items',coalesce((
    select jsonb_agg(to_jsonb(i)) from public.cabinet_items i where i.shelf_id=s.id and i.id<>iid
  ),'[]'::jsonb)) order by s.level) into layout from public.cabinet_shelves s where s.cabinet_id=cid;
  select layout_revision into revision from public.cabinets where id=cid;
  revision:=public.save_cabinet_state_v2(cid,layout,6,9,2,revision,'{}',array[iid]);
  select id into tid from public.cabinet_trash where cabinet_id=cid;
  perform public.restore_cabinet_trash_v2(cid,tid,revision);
  select * into restored from public.cabinet_items where id=iid;
  if restored.shelf_id<>sid or restored.position<>52 or restored.depth_position<>84
    or restored.inventory_item_id<>inv or restored.name<>'Restored reagent'
    or not exists(select 1 from public.inventory where id=inv)
    or exists(select 1 from public.cabinet_trash where id=tid) then
    raise exception 'original-position restore failed despite unrelated overlaps';
  end if;

  -- Occupied original position: move only the restored item, on its own shelf.
  execute 'reset role';
  delete from public.cabinet_items where id=iid;
  insert into public.cabinet_items(id,cabinet_id,shelf_id,template,name,width,position,depth_position)
    values(blocker,cid,sid,'A','Occupying item',8,52,84);
  insert into public.cabinet_trash(cabinet_id,payload,item_ids,inventory_ids)
    values(cid,jsonb_build_object('shelves','[]'::jsonb,'items',jsonb_build_array(original)),array[iid],array[inv]) returning id into tid;
  execute 'set local role authenticated';
  select layout_revision into revision from public.cabinets where id=cid;
  perform public.restore_cabinet_trash_v2(cid,tid,revision);
  select * into restored from public.cabinet_items where id=iid;
  if restored.shelf_id<>sid or (restored.position=52 and restored.depth_position=84)
    or exists(select 1 from public.cabinet_items a where a.id<>iid and a.shelf_id=sid
      and abs(restored.position-a.position)<(.37088/6*100)+.5
      and abs(restored.depth_position-a.depth_position)<(.37934/2*100)+.5)
    or not exists(select 1 from public.cabinet_items where id=blocker and position=52 and depth_position=84) then
    raise exception 'nearest free position failed or moved an existing item';
  end if;

  -- No slot on the original shelf: use another shelf.
  execute 'reset role';
  delete from public.cabinet_items where id=iid;
  update public.cabinet_shelves set dividers=(select jsonb_agg(n) from generate_series(0,100) n) where id=sid;
  insert into public.cabinet_trash(cabinet_id,payload,item_ids,inventory_ids)
    values(cid,jsonb_build_object('shelves','[]'::jsonb,'items',jsonb_build_array(original)),array[iid],array[inv]) returning id into tid;
  execute 'set local role authenticated';
  select layout_revision into revision from public.cabinets where id=cid;
  perform public.restore_cabinet_trash_v2(cid,tid,revision);
  if not exists(select 1 from public.cabinet_items where id=iid and shelf_id=sid2) then
    raise exception 'alternate shelf not used';
  end if;

  -- The original shelf no longer exists.
  execute 'reset role';
  delete from public.cabinet_items where id=iid;
  insert into public.cabinet_trash(cabinet_id,payload,item_ids,inventory_ids)
    values(cid,jsonb_build_object('shelves','[]'::jsonb,'items',jsonb_build_array(
      original||jsonb_build_object('shelf_id',gen_random_uuid()))),array[iid],array[inv]) returning id into tid;
  execute 'set local role authenticated';
  select layout_revision into revision from public.cabinets where id=cid;
  perform public.restore_cabinet_trash_v2(cid,tid,revision);
  if not exists(select 1 from public.cabinet_items where id=iid and shelf_id=sid2) then
    raise exception 'missing original shelf prevented fallback';
  end if;

  -- A batch with one fitting and one oversized item must roll back completely.
  execute 'reset role';
  delete from public.cabinet_items where id=iid;
  batch:=jsonb_build_array(original,original||jsonb_build_object('id',big_id,'width',100,'inventory_item_id',null));
  insert into public.cabinet_trash(cabinet_id,payload,item_ids,inventory_ids)
    values(cid,jsonb_build_object('shelves','[]'::jsonb,'items',batch),array[iid,big_id],array[inv]) returning id into tid;
  execute 'set local role authenticated';
  select layout_revision into revision from public.cabinets where id=cid;
  begin
    perform public.restore_cabinet_trash_v2(cid,tid,revision);
    raise exception 'oversized batch accepted';
  exception when others then if SQLERRM<>'CABINET_RESTORE_SPACE_REQUIRED' then raise; end if; end;
  if exists(select 1 from public.cabinet_items where id in (iid,big_id))
    or not exists(select 1 from public.cabinet_trash where id=tid and payload is not null)
    or (select layout_revision from public.cabinets where id=cid)<>revision
    or exists(select 1 from public.inventory where id=inv) then
    raise exception 'failed batch was partially restored';
  end if;
  begin
    perform public.restore_cabinet_trash_v2(cid,tid,revision-1);
    raise exception 'stale restore accepted';
  exception when serialization_failure then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin
    perform public.restore_cabinet_trash_v2(cid,tid,revision);
    raise exception 'outsider restore accepted';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end $test$;
select 'CABINET_RESTORE_SQL_ASSERTIONS_PASSED' as result;
rollback;
