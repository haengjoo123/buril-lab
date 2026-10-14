-- Allow non-spatial saves of legacy layouts without weakening new placement validation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.save_cabinet_state_v2(p_cabinet_id uuid,p_shelves jsonb,p_width integer,p_height integer,p_depth integer,p_expected_revision bigint,p_removed_shelf_ids uuid[],p_removed_item_ids uuid[]) returns bigint
language plpgsql security definer set search_path = '' as $$
declare revision bigint; gone_shelves uuid[]; gone_items uuid[]; linked uuid[]; payload jsonb;
  before_cabinet public.cabinets; before_shelves jsonb; before_items jsonb; old_item jsonb; after_item jsonb; delta jsonb; item record; cabinet_lab uuid;
begin
  perform private.require_cabinet_access_v2(p_cabinet_id);
  select layout_revision into revision from public.cabinets where id=p_cabinet_id for update;
  select * into before_cabinet from public.cabinets where id=p_cabinet_id;
  cabinet_lab:=before_cabinet.lab_id;
  select coalesce(jsonb_agg(jsonb_build_array(s.id,s.level,s.dividers) order by s.id),'[]'::jsonb)
    into before_shelves from public.cabinet_shelves s where s.cabinet_id=p_cabinet_id;
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
  -- Existing layouts may predate geometry validation. Removing an item or
  -- editing metadata cannot introduce a new collision. Compare persisted
  -- geometry, not caller flags, and validate every spatial change/addition.
  if exists(select 1 from public.cabinets c where c.id=p_cabinet_id
      and (c.width,c.height,c.depth) is distinct from
          (before_cabinet.width,before_cabinet.height,before_cabinet.depth))
    or before_shelves is distinct from (
      select coalesce(jsonb_agg(jsonb_build_array(s.id,s.level,s.dividers) order by s.id),'[]'::jsonb)
      from public.cabinet_shelves s where s.cabinet_id=p_cabinet_id)
    or exists(
      select 1 from public.cabinet_items ci
      left join jsonb_array_elements(before_items) old on old->>'id'=ci.id::text
      where ci.cabinet_id=p_cabinet_id and
        jsonb_build_array(ci.shelf_id,ci.template,ci.width,ci.position,ci.depth_position)
          is distinct from jsonb_build_array(old->'shelf_id',old->'template',
            old->'width',old->'position',old->'depth_position')
    ) then
    perform private.validate_cabinet_geometry_v2(p_cabinet_id);
  end if;
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

commit;
