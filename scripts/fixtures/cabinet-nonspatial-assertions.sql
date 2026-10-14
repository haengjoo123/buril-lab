-- Synthetic regression data only; all writes are rolled back.
begin;
set local statement_timeout = '30s';
do $test$
declare
  uid uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid();
  iid uuid:=gen_random_uuid(); survivor uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
  revision bigint; layout jsonb; candidate jsonb; mutation jsonb; trash_id uuid;
begin
  insert into auth.users(id,email) values(uid,uid::text||'@example.invalid');
  insert into public.cabinets(id,name,user_id,width,height,depth) values(cid,'Geometry regression',uid,5,9,2);
  insert into public.cabinet_shelves(id,cabinet_id,level,dividers) values(sid,cid,0,'[]');
  -- Simulate a legacy layout with three overlapping items.
  insert into public.cabinet_items(id,cabinet_id,shelf_id,template,name,width,position,depth_position)
    select id,cid,sid,'A','Legacy reagent',8,30,50 from unnest(array[iid,survivor,other]) id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select layout_revision into revision from public.cabinets where id=cid;
  select jsonb_build_array(jsonb_build_object('id',sid,'level',0,'dividers','[]'::jsonb,
    'items',jsonb_agg(to_jsonb(i) order by i.id))) into layout
    from public.cabinet_items i where i.cabinet_id=cid and i.id<>iid;

  begin
    perform public.save_cabinet_state_v2(cid,layout,5,9,2,revision,'{}','{}');
    raise exception 'deletion without explicit intent accepted';
  exception when others then
    if SQLERRM not like 'CABINET_EXPLICIT_DELETION_REQUIRED%' then raise; end if;
  end;
  revision:=public.save_cabinet_state_v2(cid,layout,5,9,2,revision,'{}',array[iid]);
  if (select count(*) from public.cabinet_items where cabinet_id=cid)<>2
    or not exists(select 1 from public.cabinet_trash where cabinet_id=cid and iid=any(item_ids)
      and expires_at-deleted_at=interval '240 hours') then
    raise exception 'legacy deletion did not preserve trash and remaining items';
  end if;
  -- A retry and metadata edits must not be blocked by the untouched overlap.
  revision:=public.save_cabinet_state_v2(cid,layout,5,9,2,revision,'{}','{}');
  layout:=jsonb_set(layout,'{0,items,0,name}','"Renamed reagent"');
  revision:=public.save_cabinet_state_v2(cid,layout,5,9,2,revision,'{}','{}');

  -- Every spatial field and a new UUID must still invoke validation.
  for mutation in select value from jsonb_array_elements(jsonb_build_array(
    '{"position":31}'::jsonb,'{"depth_position":51}'::jsonb,
    '{"width":9}'::jsonb,'{"template":"B"}'::jsonb,
    jsonb_build_object('id',gen_random_uuid())
  )) loop
    candidate:=jsonb_set(layout,'{0,items,0}',layout->0->'items'->0 || mutation);
    -- A changed UUID is an addition alongside the existing items.
    if mutation ? 'id' then
      candidate:=jsonb_set(layout,'{0,items}',(layout->0->'items') || (candidate->0->'items'->0));
    end if;
    begin
      perform public.save_cabinet_state_v2(cid,candidate,5,9,2,revision,'{}','{}');
      raise exception 'invalid spatial edit accepted: %',mutation;
    exception when others then
      if SQLERRM not like 'CABINET_SPACE_REQUIRED%' then raise; end if;
    end;
  end loop;
  begin
    perform public.save_cabinet_state_v2(cid,layout,6,9,2,revision,'{}','{}');
    raise exception 'invalid dimension edit accepted';
  exception when others then if SQLERRM not like 'CABINET_SPACE_REQUIRED%' then raise; end if; end;
  begin
    perform public.save_cabinet_state_v2(cid,jsonb_set(layout,'{0,dividers}','[34]'),5,9,2,revision,'{}','{}');
    raise exception 'invalid divider edit accepted';
  exception when others then if SQLERRM not like 'CABINET_SPACE_REQUIRED%' then raise; end if; end;
  select id into trash_id from public.cabinet_trash where cabinet_id=cid;
  if (select layout_revision from public.cabinets where id=cid)<>revision
    or not exists(select 1 from public.cabinet_trash where id=trash_id) then
    raise exception 'rejected edits were not rolled back';
  end if;
  -- Moving all survivors to valid positions remains supported.
  layout:=jsonb_set(jsonb_set(layout,'{0,items,0,position}','20'),'{0,items,1,position}','60');
  revision:=public.save_cabinet_state_v2(cid,layout,5,9,2,revision,'{}','{}');
  execute 'reset role';
end $test$;
select 'CABINET_NONSPATIAL_SQL_ASSERTIONS_PASSED' as result;
rollback;
