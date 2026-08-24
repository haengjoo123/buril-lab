-- Safety Center risk scoring v2 needs the same fresh GHS H-codes used by
-- Inventory filtering. The previous RPC only returned CAS/name fields, so
-- Safety Center could not distinguish ordinary flammable/corrosive/toxic
-- materials from special-high hazards.

drop function if exists public.get_safety_center_risk_items(uuid);

create function public.get_safety_center_risk_items(
    p_center_id uuid
)
returns table (
    source_type text,
    item_id uuid,
    lab_id uuid,
    lab_name text,
    inventory_name text,
    brand text,
    product_number text,
    cas_number text,
    quantity integer,
    capacity text,
    storage_type text,
    cabinet_name text,
    storage_location_name text,
    expiry_date date,
    remaining_percent integer,
    ghs_h_codes text[],
    ghs_data_status text,
    ghs_fetched_at timestamptz,
    ghs_expires_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    return query
    select
        'inventory'::text,
        i.id,
        i.lab_id,
        l.name,
        i.name,
        i.brand,
        i.product_number,
        i.cas_number,
        i.quantity,
        i.capacity,
        i.storage_type,
        c.name,
        sl.name,
        i.expiry_date,
        i.remaining_percent,
        coalesce(
            array(
                select jsonb_array_elements_text(coalesce(ghs.result -> 'hCodes', '[]'::jsonb))
            ),
            array[]::text[]
        ),
        ghs.cache_status,
        ghs.fetched_at,
        ghs.expires_at,
        i.created_at,
        i.updated_at
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.inventory i on i.lab_id = scl.lab_id
    left join public.cabinets c on c.id = i.cabinet_id
    left join public.storage_locations sl on sl.id = i.storage_location_id
    left join lateral (
        select
            gc.result,
            gc.cache_status,
            gc.fetched_at,
            gc.expires_at,
            gc.updated_at
        from public.ghs_cas_cache gc
        where gc.scope_type = 'lab'
          and gc.scope_id = i.lab_id
          and gc.cas_number = regexp_replace(coalesce(i.cas_number, ''), '\s+', '', 'g')
          and gc.expires_at > now()
        order by gc.updated_at desc
        limit 1
    ) ghs on true
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'risk_detail' = any(scl.scope)

    union all

    select
        'cabinet_item'::text,
        ci.id,
        c.lab_id,
        l.name,
        ci.name,
        ci.brand,
        ci.product_number,
        ci.cas_no,
        1,
        ci.capacity,
        'cabinet'::text,
        c.name,
        null::text,
        ci.expiry_date,
        ci.remaining_percent,
        coalesce(
            array(
                select jsonb_array_elements_text(coalesce(ghs.result -> 'hCodes', '[]'::jsonb))
            ),
            array[]::text[]
        ),
        ghs.cache_status,
        ghs.fetched_at,
        ghs.expires_at,
        ci.created_at,
        ci.created_at
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.cabinets c on c.lab_id = scl.lab_id
    join public.cabinet_items ci on ci.cabinet_id = c.id
    left join lateral (
        select
            gc.result,
            gc.cache_status,
            gc.fetched_at,
            gc.expires_at,
            gc.updated_at
        from public.ghs_cas_cache gc
        where gc.scope_type = 'lab'
          and gc.scope_id = c.lab_id
          and gc.cas_number = regexp_replace(coalesce(ci.cas_no, ''), '\s+', '', 'g')
          and gc.expires_at > now()
        order by gc.updated_at desc
        limit 1
    ) ghs on true
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'risk_detail' = any(scl.scope)
      and ci.inventory_item_id is null
    order by updated_at desc;
end;
$$;

revoke all on function public.get_safety_center_risk_items(uuid) from public, anon;
grant execute on function public.get_safety_center_risk_items(uuid) to authenticated, service_role;
