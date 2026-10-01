-- Cabinet snapshots use optimistic concurrency. Deleted layout data remains
-- recoverable for exactly 240 hours; only UUID tombstones survive expiry.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.cabinets add column layout_revision bigint not null default 0;
create function private.cabinet_dimension_revision_v2() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.lab_id,new.user_id) is distinct from (old.lab_id,old.user_id) and
    (exists(select 1 from public.cabinet_items where cabinet_id=old.id) or exists(select 1 from public.cabinet_trash where cabinet_id=old.id and payload is not null)) then
    raise exception 'CABINET_OWNERSHIP_CHANGE_BLOCKED';
  end if;
  if (new.width,new.height,new.depth) is distinct from (old.width,old.height,old.depth) then new.layout_revision:=old.layout_revision+1; end if;
  return new;
end $$;
revoke all on function private.cabinet_dimension_revision_v2() from public;
create trigger cabinet_dimension_revision before update on public.cabinets for each row execute function private.cabinet_dimension_revision_v2();
create table public.cabinet_trash (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '240 hours'),
  payload jsonb,
  shelf_ids uuid[] not null default '{}',
  item_ids uuid[] not null default '{}',
  inventory_ids uuid[] not null default '{}'
);
create index cabinet_trash_expiry on public.cabinet_trash(expires_at) where payload is not null;
alter table public.cabinet_trash enable row level security;
create policy cabinet_trash_read on public.cabinet_trash for select to authenticated
using (payload is not null and expires_at>now() and exists(select 1 from public.cabinets c where c.id = cabinet_id));
revoke all on public.cabinet_trash from public, anon, authenticated, service_role;
grant select on public.cabinet_trash to authenticated;
grant all on public.cabinet_trash to service_role;

create function private.inventory_in_cabinet_trash_v2(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.cabinet_trash t where p_id=any(t.inventory_ids));
$$;
revoke all on function private.inventory_in_cabinet_trash_v2(uuid) from public;
grant execute on function private.inventory_in_cabinet_trash_v2(uuid) to authenticated;

create function private.require_cabinet_access_v2(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.cabinets c where c.id=p_id and
    (c.user_id=auth.uid() or exists(select 1 from public.lab_members m where m.lab_id=c.lab_id and m.user_id=auth.uid()))
  ) then raise exception 'CABINET_ACCESS_DENIED' using errcode='42501'; end if;
end $$;
revoke all on function private.require_cabinet_access_v2(uuid) from public;

create function private.bump_cabinet_revision_v2() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- GHS is a conditional item update and must not invalidate a layout save.
  if TG_OP='UPDATE' and (to_jsonb(new)-array['h_codes','ghs_status','ghs_checked_at']) = (to_jsonb(old)-array['h_codes','ghs_status','ghs_checked_at']) then return new; end if;
  update public.cabinets set layout_revision=layout_revision+1 where id=coalesce(new.cabinet_id,old.cabinet_id);
  if TG_OP='UPDATE' and old.cabinet_id <> new.cabinet_id then
    update public.cabinets set layout_revision=layout_revision+1 where id=old.cabinet_id;
  end if;
  return coalesce(new,old);
end $$;
revoke all on function private.bump_cabinet_revision_v2() from public;
create trigger cabinet_items_revision after insert or update or delete on public.cabinet_items for each row execute function private.bump_cabinet_revision_v2();
create trigger cabinet_shelves_revision after insert or update or delete on public.cabinet_shelves for each row execute function private.bump_cabinet_revision_v2();

create function private.guard_cabinet_trash_v2() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_TABLE_NAME='inventory' then
    if current_setting('role',true) <> 'service_role' and auth.uid() is not null and exists(select 1 from public.cabinet_trash t where old.id=any(t.inventory_ids)) then raise exception 'CABINET_INVENTORY_IN_TRASH'; end if;
    if TG_OP='UPDATE' then return new; end if;
    return old;
  end if;
  if TG_TABLE_NAME='cabinet_shelves' then
    if exists(select 1 from public.cabinet_trash t where new.id=any(t.shelf_ids)) then raise exception 'CABINET_RESTORE_REQUIRED'; end if;
  else
    if new.inventory_item_id is not null and not exists(
      select 1 from public.inventory inv join public.cabinets c on c.id=new.cabinet_id
      where inv.id=new.inventory_item_id and inv.lab_id is not distinct from c.lab_id
        and ((c.lab_id is null and inv.user_id is not distinct from c.user_id)
          or (c.lab_id is not null and (auth.uid() is null or current_setting('role',true)='service_role' or exists(select 1 from public.lab_members m where m.lab_id=c.lab_id and m.user_id=auth.uid()))))
    ) then raise exception 'CABINET_INVENTORY_SCOPE_DENIED' using errcode='42501'; end if;
    if exists(select 1 from public.cabinet_trash t where new.id=any(t.item_ids) or new.inventory_item_id=any(t.inventory_ids)) then raise exception 'CABINET_RESTORE_REQUIRED'; end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_cabinet_trash_v2() from public;
create trigger cabinet_inventory_trash_guard before update or delete on public.inventory for each row execute function private.guard_cabinet_trash_v2();
create trigger cabinet_shelf_trash_guard before insert on public.cabinet_shelves for each row execute function private.guard_cabinet_trash_v2();
create trigger cabinet_item_trash_guard before insert or update on public.cabinet_items for each row execute function private.guard_cabinet_trash_v2();

create function public.get_cabinet_state_v2(p_cabinet_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_cabinet_access_v2(p_cabinet_id);
  -- One SQL statement supplies one MVCC snapshot for all three tables.
  select jsonb_build_object('cabinet',to_jsonb(c),
    'shelves',coalesce((select jsonb_agg(to_jsonb(s) order by s.level) from public.cabinet_shelves s where s.cabinet_id=c.id),'[]'),
    'items',coalesce((select jsonb_agg(to_jsonb(i)) from public.cabinet_items i where i.cabinet_id=c.id),'[]')) into result
  from public.cabinets c where c.id=p_cabinet_id;
  return result;
end $$;

create function public.create_cabinet_v2(p_name text,p_location text,p_width integer,p_height integer,p_depth integer,p_lab_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cabinet_id uuid; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='28000'; end if;
  if p_lab_id is not null and not exists(select 1 from public.lab_members where lab_id=p_lab_id and user_id=auth.uid()) then raise exception 'CABINET_ACCESS_DENIED' using errcode='42501'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 200 or p_width is null or p_width not between 4 and 20 or p_height is null or p_height not between 2 and 15 or p_depth is null or p_depth not between 1 and 4 then raise exception 'CABINET_INVALID_INPUT'; end if;
  insert into public.cabinets(name,location,width,height,depth,user_id,lab_id) values(trim(p_name),p_location,p_width,p_height,p_depth,auth.uid(),p_lab_id) returning id into cabinet_id;
  insert into public.cabinet_shelves(cabinet_id,level) select cabinet_id,n from generate_series(0,3) n;
  select to_jsonb(c) into result from public.cabinets c where id=cabinet_id;
  return result;
end $$;

create function public.get_cabinet_trash_v2(p_cabinet_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_cabinet_access_v2(p_cabinet_id);
  return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'deleted_at',t.deleted_at,'expires_at',t.expires_at,'payload',t.payload) order by t.deleted_at desc)
    from public.cabinet_trash t where t.cabinet_id=p_cabinet_id and t.payload is not null and t.expires_at>now()),'[]'::jsonb);
end $$;

create function private.validate_cabinet_geometry_v2(p_cabinet_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.cabinet_shelves where cabinet_id=p_cabinet_id) then raise exception 'CABINET_FLOOR_REQUIRED'; end if;
  if exists(
    with footprints as (
      select i.*, i.position+i.width/2 as x,
        (case i.template when 'A' then .37088/8 when 'B' then .44455/10 when 'C' then .48773/8 else .40191/10 end)*i.width/c.width*50 as hx,
        (case i.template when 'A' then .37934/8 when 'B' then .44560/10 when 'C' then .48572/8 else .40690/10 end)*i.width/c.depth*50 as hz,
        (case i.template when 'A' then .87685/8 when 'B' then .99359/10 when 'C' then .99768/8 else .99735/10 end)*i.width as physical_height,
        (c.height-.02-(sc.n-1)*.2)/sc.n as clearance, s.dividers
      from public.cabinet_items i join public.cabinets c on c.id=i.cabinet_id
      join public.cabinet_shelves s on s.id=i.shelf_id
      cross join lateral (select count(*)::numeric n from public.cabinet_shelves where cabinet_id=c.id) sc
      where c.id=p_cabinet_id
    ) select 1 from footprints a where
      a.width<=0 or a.width>100 or a.position<0 or a.position+a.width>100 or a.depth_position<0 or a.depth_position>100
      or a.x-a.hx<1 or a.x+a.hx>99 or a.depth_position-a.hz<1 or a.depth_position+a.hz>99
      or a.physical_height+.05>a.clearance
      or exists(select 1 from jsonb_array_elements_text(a.dividers) d where d::numeric between a.x-a.hx-1 and a.x+a.hx+1)
      or exists(select 1 from footprints b where b.id<>a.id and b.shelf_id=a.shelf_id and abs(a.x-b.x)<a.hx+b.hx+.5 and abs(a.depth_position-b.depth_position)<a.hz+b.hz+.5)
  ) then raise exception 'CABINET_SPACE_REQUIRED: 시약이 겹치거나 선반 공간이 부족합니다.'; end if;
  if exists(select 1 from public.cabinets c cross join lateral (select count(*)::numeric n from public.cabinet_shelves where cabinet_id=c.id) sc where c.id=p_cabinet_id and (c.height-.02-(sc.n-1)*.2)/sc.n<.2) then raise exception 'CABINET_SHELF_LIMIT'; end if;
end $$;
revoke all on function private.validate_cabinet_geometry_v2(uuid) from public;

create function public.save_cabinet_state_v2(p_cabinet_id uuid,p_shelves jsonb,p_width integer,p_height integer,p_depth integer,p_expected_revision bigint,p_removed_shelf_ids uuid[],p_removed_item_ids uuid[]) returns bigint
language plpgsql security definer set search_path = '' as $$
declare revision bigint; gone_shelves uuid[]; gone_items uuid[]; linked uuid[]; payload jsonb;
  before_items jsonb; old_item jsonb; after_item jsonb; delta jsonb; item record; cabinet_lab uuid;
begin
  perform private.require_cabinet_access_v2(p_cabinet_id);
  select layout_revision into revision from public.cabinets where id=p_cabinet_id for update;
  select lab_id into cabinet_lab from public.cabinets where id=p_cabinet_id;
  select coalesce(jsonb_agg(to_jsonb(i)),'[]') into before_items from public.cabinet_items i where cabinet_id=p_cabinet_id;
  if revision is distinct from p_expected_revision then raise exception 'CABINET_VERSION_CONFLICT: 다시 불러온 후 저장해 주세요.' using errcode='40001'; end if;
  select coalesce(array_agg(id),'{}') into gone_shelves from public.cabinet_shelves where cabinet_id=p_cabinet_id
    and not exists(select 1 from jsonb_array_elements(p_shelves) s where (s->>'id')::uuid=id);
  select coalesce(array_agg(id),'{}') into gone_items from public.cabinet_items where cabinet_id=p_cabinet_id
    and not exists(select 1 from jsonb_array_elements(p_shelves) s cross join lateral jsonb_array_elements(s->'items') i where (i->>'id')::uuid=id);
  -- Missing rows alone are not authorization to delete them.
  if not (gone_shelves <@ coalesce(p_removed_shelf_ids,'{}') and coalesce(p_removed_shelf_ids,'{}') <@ gone_shelves
      and gone_items <@ coalesce(p_removed_item_ids,'{}') and coalesce(p_removed_item_ids,'{}') <@ gone_items) then
    raise exception 'CABINET_EXPLICIT_DELETION_REQUIRED';
  end if;
  -- SECURITY DEFINER must validate inventory references explicitly. Foreign keys
  -- alone would allow another tenant's inventory to be linked and later purged.
  if exists(
    with refs as (
      select nullif(i->>'inventory_item_id','')::uuid id from jsonb_array_elements(p_shelves) s cross join lateral jsonb_array_elements(s->'items') i
      union select inventory_item_id from public.cabinet_items where id=any(gone_items)
    ) select 1 from refs r join public.cabinets c on c.id=p_cabinet_id left join public.inventory inv on inv.id=r.id
    where r.id is not null and (inv.id is null or inv.lab_id is distinct from c.lab_id
      or (c.lab_id is null and inv.user_id is distinct from c.user_id)
      or (c.lab_id is not null and not exists(select 1 from public.lab_members m where m.lab_id=c.lab_id and m.user_id=auth.uid())))
  ) then raise exception 'CABINET_INVENTORY_SCOPE_DENIED' using errcode='42501'; end if;
  if exists(select 1 from jsonb_array_elements(p_shelves) s cross join lateral jsonb_array_elements(s->'items') i
    where nullif(i->>'inventory_item_id','') is not null group by i->>'inventory_item_id' having count(*)>1)
    or exists(select 1 from public.cabinet_items ci cross join lateral jsonb_array_elements(p_shelves) s cross join lateral jsonb_array_elements(s->'items') i
      where ci.cabinet_id<>p_cabinet_id and ci.inventory_item_id=nullif(i->>'inventory_item_id','')::uuid) then raise exception 'CABINET_SHARED_INVENTORY_LINK'; end if;
  if exists(select 1 from public.cabinet_trash t cross join lateral jsonb_array_elements(p_shelves) s
      where (s->>'id')::uuid=any(t.shelf_ids)) or exists(select 1 from public.cabinet_trash t cross join lateral jsonb_array_elements(p_shelves) s cross join lateral jsonb_array_elements(s->'items') i
      where (i->>'id')::uuid=any(t.item_ids)) then raise exception 'CABINET_RESTORE_REQUIRED'; end if;
  if cardinality(gone_shelves)>0 or cardinality(gone_items)>0 then
    select coalesce(array_agg(inventory_item_id) filter(where inventory_item_id is not null),'{}') into linked from public.cabinet_items where id=any(gone_items);
    if exists(select 1 from public.cabinet_items where inventory_item_id=any(linked) and not(id=any(gone_items))) then raise exception 'CABINET_SHARED_INVENTORY_LINK'; end if;
    select jsonb_build_object(
      'shelves',coalesce((select jsonb_agg(to_jsonb(s)) from public.cabinet_shelves s where id=any(gone_shelves)),'[]'),
      'items',coalesce((select jsonb_agg(to_jsonb(i)) from public.cabinet_items i where id=any(gone_items)),'[]')) into payload;
    insert into public.cabinet_trash(cabinet_id,payload,shelf_ids,item_ids,inventory_ids) values(p_cabinet_id,payload,gone_shelves,gone_items,linked);
  end if;
  -- Preserve a newer item-only enrichment when an older layout snapshot arrives.
  select coalesce(jsonb_agg(s || jsonb_build_object('items',coalesce((
    select jsonb_agg(case when ci.id is not null and ci.cas_no is not distinct from nullif(i->>'cas_no','') and ci.name=i->>'name'
      and ci.ghs_checked_at>coalesce(nullif(i->>'ghs_checked_at','')::timestamptz,'-infinity'::timestamptz)
      then i || jsonb_build_object('h_codes',ci.h_codes,'ghs_status',ci.ghs_status,'ghs_checked_at',ci.ghs_checked_at) else i end)
    from jsonb_array_elements(s->'items') i left join public.cabinet_items ci on ci.id=(i->>'id')::uuid and ci.cabinet_id=p_cabinet_id
  ),'[]'::jsonb))),'[]'::jsonb) into p_shelves from jsonb_array_elements(p_shelves) s;
  perform public.save_cabinet_state_with_dates(p_cabinet_id,p_shelves,p_width,p_height,p_depth);
  perform private.validate_cabinet_geometry_v2(p_cabinet_id);
  -- Update linked metadata in this same transaction and retain its derived audit.
  for item in select ci.* from public.cabinet_items ci join public.inventory inv on inv.id=ci.inventory_item_id where ci.cabinet_id=p_cabinet_id
    and (ci.name,ci.brand,ci.product_number,ci.cas_no,ci.capacity,ci.notes,ci.expiry_date,ci.manufacturer_date_type,ci.received_date,ci.opened_date,ci.remaining_percent)
      is distinct from (inv.name,inv.brand,inv.product_number,inv.cas_number,inv.capacity,inv.memo,inv.expiry_date,inv.manufacturer_date_type,inv.received_date,inv.opened_date,inv.remaining_percent)
  loop
    perform public.update_inventory_item_with_dates_atomic(item.inventory_item_id,'inventory',jsonb_build_object(
      'name',item.name,'brand',item.brand,'product_number',item.product_number,'cas_number',item.cas_no,'capacity',item.capacity,'memo',item.notes,
      'expiry_date',item.expiry_date,'manufacturer_date_type',item.manufacturer_date_type,'received_date',item.received_date,'opened_date',item.opened_date,'remaining_percent',item.remaining_percent),null);
  end loop;
  for old_item in select value from jsonb_array_elements(before_items) loop
    select to_jsonb(ci) into after_item from public.cabinet_items ci where ci.id=(old_item->>'id')::uuid and ci.cabinet_id=p_cabinet_id;
    if after_item is null then continue; end if;
    select coalesce(jsonb_object_agg(a.key,jsonb_build_object('from',old_item->a.key,'to',a.value)),'{}') into delta
      from jsonb_each(after_item) a where a.key not in ('h_codes','ghs_status','ghs_checked_at') and old_item->a.key is distinct from a.value;
    if delta<>'{}'::jsonb then
      insert into public.audit_logs(actor_user_id,actor_name,lab_id,entity_type,entity_id,action,before_data,after_data,diff_data,source)
      values(auth.uid(),private.actor_display_name_v2(auth.uid(),cabinet_lab),cabinet_lab,'cabinet_item',(old_item->>'id')::uuid,'update',old_item,after_item,delta,'rpc');
    end if;
  end loop;
  update public.cabinets set layout_revision=layout_revision+1 where id=p_cabinet_id returning layout_revision into revision;
  return revision;
end $$;

-- Read/update/delete of linked inventory is suspended while it is in trash.
-- The privileged purge removes it, and restoring a batch makes it visible again.
create policy inventory_exclude_cabinet_trash on public.inventory as restrictive for all to authenticated
using (not private.inventory_in_cabinet_trash_v2(inventory.id))
with check (not private.inventory_in_cabinet_trash_v2(inventory.id));

create function public.update_cabinet_item_ghs_v2(p_cabinet_id uuid,p_item_id uuid,p_expected_cas text,p_expected_name text,p_h_codes jsonb,p_status text,p_checked_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_cabinet_access_v2(p_cabinet_id);
  perform 1 from public.cabinets where id=p_cabinet_id for update;
  update public.cabinet_items set h_codes=p_h_codes,ghs_status=p_status,ghs_checked_at=p_checked_at
  where id=p_item_id and cabinet_id=p_cabinet_id and cas_no is not distinct from p_expected_cas and name=p_expected_name;
end $$;

create function public.restore_cabinet_trash_v2(p_cabinet_id uuid,p_trash_id uuid,p_expected_revision bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.cabinet_trash; c public.cabinets; s jsonb; i jsonb; slot integer; shelf_count integer;
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
  for i in select value from jsonb_array_elements(t.payload->'items') loop
    if not exists(select 1 from public.cabinet_shelves where id=(i->>'shelf_id')::uuid and cabinet_id=p_cabinet_id) then raise exception 'CABINET_RESTORE_SHELF_MISSING'; end if;
    insert into public.cabinet_items select * from jsonb_populate_record(null::public.cabinet_items,i);
  end loop;
  -- Reject restoration into a physically incompatible current cabinet.
  if exists(select 1 from public.cabinet_items a where a.cabinet_id=p_cabinet_id and (
    (case a.template when 'A' then .87685/8 when 'B' then .99359/10 when 'C' then .99768/8 else .99735/10 end)*a.width+.05 > (c.height-.02-(shelf_count-1)*.2)/greatest(shelf_count,1)
    or a.position<0 or a.position+a.width>100
    or a.depth_position-(case a.template when 'A' then .37934/8 when 'B' then .44560/10 when 'C' then .48572/8 else .40690/10 end)*a.width/c.depth*50<1
    or a.depth_position+(case a.template when 'A' then .37934/8 when 'B' then .44560/10 when 'C' then .48572/8 else .40690/10 end)*a.width/c.depth*50>99
  )) then raise exception 'CABINET_RESTORE_SPACE_REQUIRED'; end if;
  perform private.validate_cabinet_geometry_v2(p_cabinet_id);
  delete from public.cabinet_trash where id=t.id;
end $$;

create function public.purge_expired_cabinet_trash_v2() returns integer
language plpgsql security definer set search_path = '' as $$
declare t public.cabinet_trash; count integer:=0;
begin
  for t in select * from public.cabinet_trash where expires_at<=now() and payload is not null order by expires_at limit 100 for update skip locked loop
    delete from public.inventory where id=any(t.inventory_ids)
      and not exists(select 1 from public.cabinet_items i where i.inventory_item_id=inventory.id);
    update public.cabinet_trash set payload=null,inventory_ids='{}' where id=t.id;
    count:=count+1;
  end loop;
  return count;
end $$;

revoke all on function public.get_cabinet_state_v2(uuid),public.save_cabinet_state_v2(uuid,jsonb,integer,integer,integer,bigint,uuid[],uuid[]),public.restore_cabinet_trash_v2(uuid,uuid,bigint),public.update_cabinet_item_ghs_v2(uuid,uuid,text,text,jsonb,text,timestamptz),public.purge_expired_cabinet_trash_v2() from public, anon, authenticated, service_role;
revoke all on function public.get_cabinet_trash_v2(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_cabinet_v2(text,text,integer,integer,integer,uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_cabinet_v2(text,text,integer,integer,integer,uuid) to authenticated;
grant execute on function public.get_cabinet_trash_v2(uuid) to authenticated;
grant execute on function public.get_cabinet_state_v2(uuid),public.save_cabinet_state_v2(uuid,jsonb,integer,integer,integer,bigint,uuid[],uuid[]),public.restore_cabinet_trash_v2(uuid,uuid,bigint),public.update_cabinet_item_ghs_v2(uuid,uuid,text,text,jsonb,text,timestamptz) to authenticated;
grant execute on function public.purge_expired_cabinet_trash_v2() to service_role;
revoke execute on function public.save_cabinet_state_atomic(uuid,jsonb,integer,integer,integer),public.save_cabinet_state_with_ghs(uuid,jsonb,integer,integer,integer),public.save_cabinet_state_with_dates(uuid,jsonb,integer,integer,integer) from authenticated;
revoke delete on public.cabinet_shelves, public.cabinet_items from authenticated;

-- The safety-center RPC bypasses RLS; exclude trash from its inventory branch.
do $$ declare definition text; begin
  select pg_get_functiondef('public.get_safety_center_risk_items(uuid)'::regprocedure) into definition;
  definition:=replace(definition,'join public.inventory i on i.lab_id = scl.lab_id','join public.inventory i on i.lab_id = scl.lab_id and not private.inventory_in_cabinet_trash_v2(i.id)');
  execute definition;
end $$;
commit;
