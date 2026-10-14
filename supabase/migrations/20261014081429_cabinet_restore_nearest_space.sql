-- Restore only the requested batch. Existing unrelated overlaps are not a
-- reason to reject it. Match the renderer/placement validator's footprints.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function private.find_cabinet_restore_position_v3(p_cabinet_id uuid,p_item jsonb)
returns table(shelf_id uuid,slot_position numeric,depth_position numeric)
language plpgsql set search_path = '' as $$
declare
  c public.cabinets; shelf public.cabinet_shelves; shelf_count integer;
  w numeric:=(p_item->>'width')::numeric; template text:=p_item->>'template';
  v_hx numeric; v_hz numeric; physical_height numeric;
  origin_x numeric:=coalesce((p_item->>'position')::numeric,0)+w/2;
  origin_z numeric:=coalesce((p_item->>'depth_position')::numeric,50);
  min_x numeric; max_x numeric; min_z numeric; max_z numeric;
begin
  select * into c from public.cabinets where id=p_cabinet_id;
  select count(*) into shelf_count from public.cabinet_shelves where cabinet_id=p_cabinet_id;
  if c.id is null or c.width<=0 or c.depth<=0 or shelf_count=0
    or w is null or w<=0 or w>100 or template not in ('A','B','C','D') then return; end if;
  v_hx:=(case template when 'A' then .37088/8 when 'B' then .44455/10 when 'C' then .48773/8 else .40191/10 end)*w/c.width*50;
  v_hz:=(case template when 'A' then .37934/8 when 'B' then .44560/10 when 'C' then .48572/8 else .40690/10 end)*w/c.depth*50;
  physical_height:=(case template when 'A' then .87685/8 when 'B' then .99359/10 when 'C' then .99768/8 else .99735/10 end)*w;
  if physical_height+.05>(c.height-.02-(shelf_count-1)*.2)/shelf_count then return; end if;
  min_x:=greatest(w/2,1+v_hx); max_x:=least(100-w/2,99-v_hx);
  min_z:=1+v_hz; max_z:=99-v_hz;
  if min_x>max_x or min_z>max_z then return; end if;

  for shelf in select s.* from public.cabinet_shelves s where s.cabinet_id=p_cabinet_id
    order by (s.id=(p_item->>'shelf_id')::uuid) desc,s.level,s.id
  loop
    -- Rectangle obstacle edges partition all available space. Include the
    -- original coordinates first and test the nearest valid edge combination,
    -- instead of a coarse grid that can overlook a narrow free slot.
    return query
    with obstacles as materialized (
      select ci.position+ci.width/2 as x,ci.depth_position as z,
        (case ci.template when 'A' then .37088/8 when 'B' then .44455/10 when 'C' then .48773/8 else .40191/10 end)*ci.width/c.width*50 as hx,
        (case ci.template when 'A' then .37934/8 when 'B' then .44560/10 when 'C' then .48572/8 else .40690/10 end)*ci.width/c.depth*50 as hz
      from public.cabinet_items ci where ci.cabinet_id=p_cabinet_id and ci.shelf_id=shelf.id
    ), xs(x) as (
      select greatest(min_x,least(max_x,origin_x))
      union select min_x union select max_x
      union select o.x+sign.n*(v_hx+o.hx+.500001) from obstacles o cross join (values(-1),(1)) sign(n)
      union select d::numeric+sign.n*(v_hx+1.000001) from jsonb_array_elements_text(shelf.dividers) d cross join (values(-1),(1)) sign(n)
    ), zs(z) as (
      select greatest(min_z,least(max_z,origin_z))
      union select min_z union select max_z
      union select o.z+sign.n*(v_hz+o.hz+.500001) from obstacles o cross join (values(-1),(1)) sign(n)
    )
    select shelf.id,xs.x-w/2,zs.z from xs cross join zs
    where xs.x between min_x and max_x and zs.z between min_z and max_z
      and not exists(select 1 from jsonb_array_elements_text(shelf.dividers) d
        where d::numeric between xs.x-v_hx-1 and xs.x+v_hx+1)
      and not exists(select 1 from obstacles o
        where abs(xs.x-o.x)<v_hx+o.hx+.5 and abs(zs.z-o.z)<v_hz+o.hz+.5)
    order by power((xs.x-origin_x)*c.width,2)+power((zs.z-origin_z)*c.depth,2),xs.x,zs.z
    limit 1;
    if found then return; end if;
  end loop;
end $$;
revoke all on function private.find_cabinet_restore_position_v3(uuid,jsonb) from public,anon,authenticated;

create or replace function public.restore_cabinet_trash_v2(p_cabinet_id uuid,p_trash_id uuid,p_expected_revision bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.cabinet_trash; c public.cabinets; s jsonb; i jsonb; slot integer; shelf_count integer; placement record;
begin
  perform private.require_cabinet_access_v2(p_cabinet_id);
  select * into c from public.cabinets where id=p_cabinet_id for update;
  if c.layout_revision is distinct from p_expected_revision then raise exception 'CABINET_VERSION_CONFLICT' using errcode='40001'; end if;
  select * into t from public.cabinet_trash where id=p_trash_id and cabinet_id=p_cabinet_id for update;
  if not found or t.payload is null or t.expires_at<=now() then raise exception 'CABINET_TRASH_EXPIRED'; end if;
  if exists(select 1 from public.cabinet_items where id=any(t.item_ids) or inventory_item_id=any(t.inventory_ids))
    or exists(select 1 from public.cabinet_shelves where id=any(t.shelf_ids)) then raise exception 'CABINET_RESTORE_CONFLICT'; end if;
  select count(*) into shelf_count from public.cabinet_shelves where cabinet_id=p_cabinet_id;
  delete from public.cabinet_trash where id=t.id;
  for s in select value from jsonb_array_elements(t.payload->'shelves') order by (value->>'level')::integer loop
    slot:=greatest(0,least((s->>'level')::integer,shelf_count));
    update public.cabinet_shelves set level=level+1 where cabinet_id=p_cabinet_id and level>=slot;
    insert into public.cabinet_shelves(id,cabinet_id,level,dividers,created_at)
    values((s->>'id')::uuid,p_cabinet_id,slot,s->'dividers',(s->>'created_at')::timestamptz);
    shelf_count:=shelf_count+1;
  end loop;
  -- Restoring shelves changes clearance for existing items; retain this check,
  -- but do not revalidate unrelated horizontal overlaps.
  if shelf_count=0 or (c.height-.02-(shelf_count-1)*.2)/shelf_count<.2
    or exists(select 1 from public.cabinet_items a where a.cabinet_id=p_cabinet_id
      and (case a.template when 'A' then .87685/8 when 'B' then .99359/10 when 'C' then .99768/8 else .99735/10 end)*a.width+.05
        >(c.height-.02-(shelf_count-1)*.2)/shelf_count
      and cardinality(t.shelf_ids)>0)
  then raise exception 'CABINET_RESTORE_SPACE_REQUIRED'; end if;
  for i in select value from jsonb_array_elements(t.payload->'items') loop
    select * into placement from private.find_cabinet_restore_position_v3(p_cabinet_id,i);
    if not found then raise exception 'CABINET_RESTORE_SPACE_REQUIRED'; end if;
    i:=i || jsonb_build_object('shelf_id',placement.shelf_id,
      'position',placement.slot_position,'depth_position',placement.depth_position);
    insert into public.cabinet_items select * from jsonb_populate_record(null::public.cabinet_items,i);
  end loop;
  -- Any failure rolls back the entire batch, including the trash deletion.
end $$;

commit;
