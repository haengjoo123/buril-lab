-- Persist a cabinet layout and its dimensions in one transaction. The function
-- intentionally runs as the caller so the existing cabinet RLS policies remain
-- the authorization boundary.
create or replace function public.save_cabinet_state_atomic(
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
    v_shelf_id uuid;
    v_item_id uuid;
    v_existing_cabinet_id uuid;
    v_shelf_ids uuid[] := array[]::uuid[];
    v_item_ids uuid[] := array[]::uuid[];
    v_level integer;
    v_template text;
    v_name text;
    v_width numeric;
    v_position numeric;
    v_depth_position numeric;
    v_remaining_percent integer;
begin
    if (select auth.uid()) is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_cabinet_id is null then
        raise exception 'cabinet_id is required' using errcode = '22023';
    end if;
    if jsonb_typeof(p_shelves) is distinct from 'array' then
        raise exception 'shelves must be a JSON array' using errcode = '22023';
    end if;
    if p_width not between 4 and 20 then
        raise exception 'cabinet width must be between 4 and 20' using errcode = '22023';
    end if;
    if p_height not between 2 and 15 then
        raise exception 'cabinet height must be between 2 and 15' using errcode = '22023';
    end if;
    if p_depth not between 1 and 4 then
        raise exception 'cabinet depth must be between 1 and 4' using errcode = '22023';
    end if;

    -- This row lock serializes saves for the same cabinet. RLS hides cabinets
    -- the caller cannot update, which produces the same not-found result.
    perform 1
    from public.cabinets c
    where c.id = p_cabinet_id
    for update;

    if not found then
        raise exception 'Cabinet not found or access denied: %', p_cabinet_id using errcode = 'P0002';
    end if;

    for v_shelf in
        select value
        from jsonb_array_elements(p_shelves)
    loop
        if jsonb_typeof(v_shelf) is distinct from 'object' then
            raise exception 'Each shelf must be a JSON object' using errcode = '22023';
        end if;
        if jsonb_typeof(v_shelf->'dividers') is distinct from 'array' then
            raise exception 'Shelf dividers must be a JSON array' using errcode = '22023';
        end if;
        if jsonb_typeof(v_shelf->'items') is distinct from 'array' then
            raise exception 'Shelf items must be a JSON array' using errcode = '22023';
        end if;

        begin
            v_shelf_id := (v_shelf->>'id')::uuid;
            v_level := (v_shelf->>'level')::integer;
        exception
            when invalid_text_representation or null_value_not_allowed then
                raise exception 'Shelf id and level must be valid' using errcode = '22023';
        end;

        if v_shelf_id = any(v_shelf_ids) then
            raise exception 'Duplicate shelf id: %', v_shelf_id using errcode = '22023';
        end if;
        if v_level < 0 then
            raise exception 'Shelf level cannot be negative' using errcode = '22023';
        end if;

        select cs.cabinet_id
        into v_existing_cabinet_id
        from public.cabinet_shelves cs
        where cs.id = v_shelf_id;

        if found and v_existing_cabinet_id is distinct from p_cabinet_id then
            raise exception 'Shelf % belongs to another cabinet', v_shelf_id using errcode = '23505';
        end if;

        v_shelf_ids := array_append(v_shelf_ids, v_shelf_id);

        insert into public.cabinet_shelves (id, cabinet_id, level, dividers)
        values (v_shelf_id, p_cabinet_id, v_level, v_shelf->'dividers')
        on conflict (id) do update
        set level = excluded.level,
            dividers = excluded.dividers;

        for v_item in
            select value
            from jsonb_array_elements(v_shelf->'items')
        loop
            if jsonb_typeof(v_item) is distinct from 'object' then
                raise exception 'Each cabinet item must be a JSON object' using errcode = '22023';
            end if;

            begin
                v_item_id := (v_item->>'id')::uuid;
                v_width := (v_item->>'width')::numeric;
                v_position := (v_item->>'position')::numeric;
                v_depth_position := coalesce((v_item->>'depth_position')::numeric, 50);
                v_remaining_percent := case
                    when v_item ? 'remaining_percent' and v_item->>'remaining_percent' is not null
                        then (v_item->>'remaining_percent')::integer
                    else null
                end;
            exception
                when invalid_text_representation or null_value_not_allowed then
                    raise exception 'Cabinet item id and numeric placement fields must be valid' using errcode = '22023';
            end;

            v_template := v_item->>'template';
            v_name := nullif(trim(v_item->>'name'), '');

            if v_item_id = any(v_item_ids) then
                raise exception 'Duplicate cabinet item id: %', v_item_id using errcode = '22023';
            end if;
            if v_template is null or v_template <> all(array['A', 'B', 'C', 'D']::text[]) then
                raise exception 'Unsupported cabinet item template: %', coalesce(v_template, '<null>') using errcode = '22023';
            end if;
            if v_name is null then
                raise exception 'Cabinet item name cannot be empty' using errcode = '22023';
            end if;
            if v_width <= 0 or v_width > 100 then
                raise exception 'Cabinet item width must be greater than 0 and at most 100' using errcode = '22023';
            end if;
            if v_position < 0 or v_position + v_width > 100 then
                raise exception 'Cabinet item horizontal placement is outside the shelf' using errcode = '22023';
            end if;
            if v_depth_position not between 0 and 100 then
                raise exception 'Cabinet item depth position must be between 0 and 100' using errcode = '22023';
            end if;
            if v_remaining_percent is not null and v_remaining_percent not between 0 and 100 then
                raise exception 'remaining_percent must be between 0 and 100' using errcode = '22023';
            end if;

            select ci.cabinet_id
            into v_existing_cabinet_id
            from public.cabinet_items ci
            where ci.id = v_item_id;

            if found and v_existing_cabinet_id is distinct from p_cabinet_id then
                raise exception 'Cabinet item % belongs to another cabinet', v_item_id using errcode = '23505';
            end if;

            v_item_ids := array_append(v_item_ids, v_item_id);

            insert into public.cabinet_items (
                id,
                cabinet_id,
                shelf_id,
                template,
                name,
                width,
                position,
                depth_position,
                expiry_date,
                capacity,
                product_number,
                brand,
                notes,
                cas_no,
                inventory_item_id,
                remaining_percent
            ) values (
                v_item_id,
                p_cabinet_id,
                v_shelf_id,
                v_template,
                v_name,
                v_width,
                v_position,
                v_depth_position,
                nullif(v_item->>'expiry_date', '')::date,
                nullif(trim(v_item->>'capacity'), ''),
                nullif(trim(v_item->>'product_number'), ''),
                nullif(trim(v_item->>'brand'), ''),
                nullif(trim(v_item->>'notes'), ''),
                nullif(trim(v_item->>'cas_no'), ''),
                nullif(v_item->>'inventory_item_id', '')::uuid,
                v_remaining_percent
            )
            on conflict (id) do update
            set shelf_id = excluded.shelf_id,
                template = excluded.template,
                name = excluded.name,
                width = excluded.width,
                position = excluded.position,
                depth_position = excluded.depth_position,
                expiry_date = excluded.expiry_date,
                capacity = excluded.capacity,
                product_number = excluded.product_number,
                brand = excluded.brand,
                notes = excluded.notes,
                cas_no = excluded.cas_no,
                inventory_item_id = excluded.inventory_item_id,
                remaining_percent = excluded.remaining_percent;
        end loop;
    end loop;

    delete from public.cabinet_items ci
    where ci.cabinet_id = p_cabinet_id
      and (cardinality(v_item_ids) = 0 or not (ci.id = any(v_item_ids)));

    delete from public.cabinet_shelves cs
    where cs.cabinet_id = p_cabinet_id
      and (cardinality(v_shelf_ids) = 0 or not (cs.id = any(v_shelf_ids)));

    update public.cabinets c
    set width = p_width,
        height = p_height,
        depth = p_depth
    where c.id = p_cabinet_id;
end;
$$;

revoke all on function public.save_cabinet_state_atomic(uuid, jsonb, integer, integer, integer) from public, anon;
grant execute on function public.save_cabinet_state_atomic(uuid, jsonb, integer, integer, integer) to authenticated;
