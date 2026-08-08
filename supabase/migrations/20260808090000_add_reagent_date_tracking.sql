-- Manufacturer-labelled dates and internal receipt/open tracking are distinct
-- concepts. Keep the existing expiry_date column as the persisted manufacturer
-- date for backwards compatibility with older clients and exports.

alter table public.inventory
    add column if not exists manufacturer_date_type text,
    add column if not exists received_date date,
    add column if not exists opened_date date;

alter table public.cabinet_items
    add column if not exists manufacturer_date_type text,
    add column if not exists received_date date,
    add column if not exists opened_date date;

-- Every historical non-null expiry_date was entered as an expiry date. Rows
-- without one are intentionally recorded as not printed, never as "unknown".
update public.inventory
set manufacturer_date_type = case when expiry_date is null then 'unlabeled' else 'expiry' end
where manufacturer_date_type is null
   or manufacturer_date_type not in ('expiry', 'minimum_shelf_life', 'unlabeled');

update public.cabinet_items
set manufacturer_date_type = case when expiry_date is null then 'unlabeled' else 'expiry' end
where manufacturer_date_type is null
   or manufacturer_date_type not in ('expiry', 'minimum_shelf_life', 'unlabeled');

alter table public.inventory
    alter column manufacturer_date_type set default 'unlabeled',
    alter column manufacturer_date_type set not null;

alter table public.cabinet_items
    alter column manufacturer_date_type set default 'unlabeled',
    alter column manufacturer_date_type set not null;

alter table public.inventory
    drop constraint if exists inventory_manufacturer_date_type_check,
    add constraint inventory_manufacturer_date_type_check
        check (manufacturer_date_type in ('expiry', 'minimum_shelf_life', 'unlabeled'));

alter table public.cabinet_items
    drop constraint if exists cabinet_items_manufacturer_date_type_check,
    add constraint cabinet_items_manufacturer_date_type_check
        check (manufacturer_date_type in ('expiry', 'minimum_shelf_life', 'unlabeled'));

-- New wrappers preserve the hardened legacy RPC signatures, then apply the
-- date fields in the same transaction. This avoids an overloaded RPC name,
-- which PostgREST cannot resolve reliably during rolling client deployments.
create or replace function public.create_inventory_item_with_dates_atomic(
    p_name text,
    p_storage_type text,
    p_brand text default null,
    p_product_number text default null,
    p_cas_number text default null,
    p_quantity integer default 1,
    p_capacity text default null,
    p_cabinet_id uuid default null,
    p_storage_location_id uuid default null,
    p_product_id uuid default null,
    p_expiry_date date default null,
    p_manufacturer_date_type text default 'unlabeled',
    p_received_date date default null,
    p_opened_date date default null,
    p_memo text default null,
    p_remaining_percent integer default 100,
    p_lab_id uuid default null,
    p_actor_user_id uuid default null,
    p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_created jsonb;
    v_after_data jsonb;
    v_item_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if coalesce(p_manufacturer_date_type, 'unlabeled') not in ('expiry', 'minimum_shelf_life', 'unlabeled') then
        raise exception 'Unsupported manufacturer_date_type: %', p_manufacturer_date_type using errcode = '22023';
    end if;

    v_created := public.create_inventory_item_atomic(
        p_name, p_storage_type, p_brand, p_product_number, p_cas_number,
        p_quantity, p_capacity, p_cabinet_id, p_storage_location_id,
        p_product_id,
        case when coalesce(p_manufacturer_date_type, 'unlabeled') = 'unlabeled' then null else p_expiry_date end,
        p_memo, p_remaining_percent, p_lab_id, p_actor_user_id, p_actor_name
    );
    v_item_id := (v_created->>'id')::uuid;

    update public.inventory
    set manufacturer_date_type = coalesce(p_manufacturer_date_type, 'unlabeled'),
        expiry_date = case
            when coalesce(p_manufacturer_date_type, 'unlabeled') = 'unlabeled' then null
            else p_expiry_date
        end,
        received_date = p_received_date,
        opened_date = p_opened_date,
        updated_at = now()
    where id = v_item_id;

    select to_jsonb(i.*) into v_after_data
    from public.inventory i
    where i.id = v_item_id;

    -- The legacy create audit remains authoritative for identity and scope.
    -- This additional event keeps all newly introduced date fields visible.
    if v_after_data is distinct from v_created then
        insert into public.audit_logs (
            actor_user_id, actor_name, lab_id, entity_type, entity_id, action,
            before_data, after_data, diff_data, source
        ) values (
            v_user_id, private.actor_display_name_v2(v_user_id, p_lab_id), p_lab_id,
            'inventory', v_item_id, 'update', v_created, v_after_data,
            jsonb_build_object(
                'manufacturer_date_type', jsonb_build_object('from', v_created->'manufacturer_date_type', 'to', v_after_data->'manufacturer_date_type'),
                'received_date', jsonb_build_object('from', v_created->'received_date', 'to', v_after_data->'received_date'),
                'opened_date', jsonb_build_object('from', v_created->'opened_date', 'to', v_after_data->'opened_date')
            ),
            'rpc'
        );
    end if;

    return v_after_data;
end;
$$;

create or replace function public.update_inventory_item_with_dates_atomic(
    p_item_id uuid,
    p_item_source text,
    p_updates jsonb,
    p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_user_id uuid := auth.uid();
    v_before_data jsonb;
    v_after_data jsonb;
    v_lab_id uuid;
    v_effective_date_type text;
    v_legacy_updates jsonb;
    v_key text;
    v_diff_data jsonb := '{}'::jsonb;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if p_item_source not in ('inventory', 'cabinet_item') then
        raise exception 'Unsupported item source: %', p_item_source using errcode = '22023';
    end if;
    if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
        raise exception 'updates must be a JSON object' using errcode = '22023';
    end if;
    if p_updates ? 'manufacturer_date_type'
       and coalesce(nullif(trim(p_updates->>'manufacturer_date_type'), ''), 'unlabeled') not in ('expiry', 'minimum_shelf_life', 'unlabeled') then
        raise exception 'Unsupported manufacturer_date_type: %', p_updates->>'manufacturer_date_type' using errcode = '22023';
    end if;

    v_legacy_updates := p_updates - array['manufacturer_date_type', 'received_date', 'opened_date'];

    -- The legacy RPC retains all validation, row locking and authorization for
    -- both inventory rows and direct cabinet items.
    perform public.update_inventory_item_atomic(p_item_id, p_item_source, v_legacy_updates, p_actor_name);

    if p_item_source = 'inventory' then
        select to_jsonb(i.*), i.lab_id into v_before_data, v_lab_id
        from public.inventory i where i.id = p_item_id for update;
    else
        select to_jsonb(ci.*), c.lab_id into v_before_data, v_lab_id
        from public.cabinet_items ci
        join public.cabinets c on c.id = ci.cabinet_id
        where ci.id = p_item_id
        for update of ci;
    end if;

    v_effective_date_type := case
        when p_updates ? 'manufacturer_date_type' then coalesce(nullif(trim(p_updates->>'manufacturer_date_type'), ''), 'unlabeled')
        else coalesce(v_before_data->>'manufacturer_date_type', 'unlabeled')
    end;

    if p_updates ? 'expiry_date'
       and nullif(trim(p_updates->>'expiry_date'), '') is not null
       and v_effective_date_type = 'unlabeled' then
        raise exception 'manufacturer_date_type must be selected before saving a manufacturer date' using errcode = '22023';
    end if;

    if p_item_source = 'inventory' then
        update public.inventory
        set manufacturer_date_type = v_effective_date_type,
            expiry_date = case
                when v_effective_date_type = 'unlabeled' then null
                when p_updates ? 'expiry_date' then nullif(trim(p_updates->>'expiry_date'), '')::date
                else expiry_date
            end,
            received_date = case when p_updates ? 'received_date' then nullif(trim(p_updates->>'received_date'), '')::date else received_date end,
            opened_date = case when p_updates ? 'opened_date' then nullif(trim(p_updates->>'opened_date'), '')::date else opened_date end,
            updated_at = now()
        where id = p_item_id;
        select to_jsonb(i.*) into v_after_data from public.inventory i where i.id = p_item_id;
    else
        update public.cabinet_items
        set manufacturer_date_type = v_effective_date_type,
            expiry_date = case
                when v_effective_date_type = 'unlabeled' then null
                when p_updates ? 'expiry_date' then nullif(trim(p_updates->>'expiry_date'), '')::date
                else expiry_date
            end,
            received_date = case when p_updates ? 'received_date' then nullif(trim(p_updates->>'received_date'), '')::date else received_date end,
            opened_date = case when p_updates ? 'opened_date' then nullif(trim(p_updates->>'opened_date'), '')::date else opened_date end
        where id = p_item_id;
        select to_jsonb(ci.*) into v_after_data from public.cabinet_items ci where ci.id = p_item_id;
    end if;

    foreach v_key in array array['manufacturer_date_type', 'expiry_date', 'received_date', 'opened_date']
    loop
        if p_updates ? v_key and v_before_data->v_key is distinct from v_after_data->v_key then
            v_diff_data := jsonb_set(
                v_diff_data,
                array[v_key],
                jsonb_build_object('from', v_before_data->v_key, 'to', v_after_data->v_key)
            );
        end if;
    end loop;

    if v_diff_data <> '{}'::jsonb then
        insert into public.audit_logs (
            actor_user_id, actor_name, lab_id, entity_type, entity_id, action,
            before_data, after_data, diff_data, source
        ) values (
            v_user_id, private.actor_display_name_v2(v_user_id, v_lab_id), v_lab_id,
            p_item_source, p_item_id, 'update', v_before_data, v_after_data, v_diff_data, 'rpc'
        );
    end if;

    return v_after_data;
end;
$$;

-- The base writer owns layout validation. This companion writer follows the
-- established invoker/RLS model for cabinet state and stores date metadata
-- after a successful layout write in the same transaction.
create or replace function public.save_cabinet_state_with_dates(
    p_cabinet_id uuid,
    p_shelves jsonb,
    p_width integer,
    p_height integer,
    p_depth integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_shelf jsonb;
    v_item jsonb;
    v_item_id uuid;
    v_date_type text;
begin
    perform public.save_cabinet_state_with_ghs(p_cabinet_id, p_shelves, p_width, p_height, p_depth);

    for v_shelf in select value from jsonb_array_elements(p_shelves)
    loop
        for v_item in select value from jsonb_array_elements(coalesce(v_shelf->'items', '[]'::jsonb))
        loop
            begin
                v_item_id := (v_item->>'id')::uuid;
            exception when invalid_text_representation or null_value_not_allowed then
                raise exception 'Cabinet item id must be valid' using errcode = '22023';
            end;

            v_date_type := coalesce(nullif(trim(v_item->>'manufacturer_date_type'), ''), 'unlabeled');
            if v_date_type not in ('expiry', 'minimum_shelf_life', 'unlabeled') then
                raise exception 'Unsupported manufacturer_date_type: %', v_date_type using errcode = '22023';
            end if;
            if v_date_type = 'unlabeled' and nullif(trim(v_item->>'expiry_date'), '') is not null then
                raise exception 'manufacturer_date_type must be selected before saving a manufacturer date' using errcode = '22023';
            end if;

            update public.cabinet_items
            set manufacturer_date_type = v_date_type,
                expiry_date = case
                    when v_date_type = 'unlabeled' then null
                    else nullif(trim(v_item->>'expiry_date'), '')::date
                end,
                received_date = nullif(trim(v_item->>'received_date'), '')::date,
                opened_date = nullif(trim(v_item->>'opened_date'), '')::date
            where id = v_item_id
              and cabinet_id = p_cabinet_id;

            if not found then
                raise exception 'Cabinet item not found or access denied: %', v_item_id using errcode = 'P0002';
            end if;
        end loop;
    end loop;
end;
$$;

revoke all on function public.create_inventory_item_with_dates_atomic(
    text, text, text, text, text, integer, text, uuid, uuid, uuid, date, text, date, date, text, integer, uuid, uuid, text
) from public, anon;
grant execute on function public.create_inventory_item_with_dates_atomic(
    text, text, text, text, text, integer, text, uuid, uuid, uuid, date, text, date, date, text, integer, uuid, uuid, text
) to authenticated, service_role;

revoke all on function public.update_inventory_item_with_dates_atomic(uuid, text, jsonb, text) from public, anon;
grant execute on function public.update_inventory_item_with_dates_atomic(uuid, text, jsonb, text) to authenticated, service_role;

revoke all on function public.save_cabinet_state_with_dates(uuid, jsonb, integer, integer, integer) from public, anon;
grant execute on function public.save_cabinet_state_with_dates(uuid, jsonb, integer, integer, integer) to authenticated, service_role;

-- The Safety Center function's return type changes, so replace rather than
-- overload it. Only expiry/minimum-shelf-life dates are exposed as risk dates.
drop function if exists public.get_safety_center_risk_items(uuid);

create function public.get_safety_center_risk_items(p_center_id uuid)
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
    manufacturer_date_type text,
    received_date date,
    opened_date date,
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
        'inventory'::text, i.id, i.lab_id, l.name, i.name, i.brand,
        i.product_number, i.cas_number, i.quantity, i.capacity, i.storage_type,
        c.name, sl.name,
        case when i.manufacturer_date_type in ('expiry', 'minimum_shelf_life') then i.expiry_date else null end,
        i.manufacturer_date_type, i.received_date, i.opened_date,
        i.remaining_percent,
        coalesce(array(select jsonb_array_elements_text(coalesce(ghs.result -> 'hCodes', '[]'::jsonb))), array[]::text[]),
        ghs.cache_status, ghs.fetched_at, ghs.expires_at, i.created_at, i.updated_at
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.inventory i on i.lab_id = scl.lab_id
    left join public.cabinets c on c.id = i.cabinet_id
    left join public.storage_locations sl on sl.id = i.storage_location_id
    left join lateral (
        select gc.result, gc.cache_status, gc.fetched_at, gc.expires_at, gc.updated_at
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
        'cabinet_item'::text, ci.id, c.lab_id, l.name, ci.name, ci.brand,
        ci.product_number, ci.cas_no, 1, ci.capacity, 'cabinet'::text,
        c.name, null::text,
        case when ci.manufacturer_date_type in ('expiry', 'minimum_shelf_life') then ci.expiry_date else null end,
        ci.manufacturer_date_type, ci.received_date, ci.opened_date,
        ci.remaining_percent,
        coalesce(array(select jsonb_array_elements_text(coalesce(ghs.result -> 'hCodes', '[]'::jsonb))), array[]::text[]),
        ghs.cache_status, ghs.fetched_at, ghs.expires_at, ci.created_at, ci.created_at
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.cabinets c on c.lab_id = scl.lab_id
    join public.cabinet_items ci on ci.cabinet_id = c.id
    left join lateral (
        select gc.result, gc.cache_status, gc.fetched_at, gc.expires_at, gc.updated_at
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
