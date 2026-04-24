-- Harden security-definer RPCs that bypass table RLS.

create or replace function public.create_inventory_item_atomic(
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
    p_memo text default null,
    p_remaining_percent integer default 100,
    p_lab_id uuid default null,
    p_actor_user_id uuid default null,
    p_actor_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_new_id uuid;
    v_after_data jsonb;
    v_cabinet_lab_id uuid;
    v_cabinet_user_id uuid;
    v_storage_lab_id uuid;
    v_storage_user_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_storage_type not in ('cabinet', 'other') then
        raise exception 'Unsupported storage type: %', p_storage_type using errcode = '22023';
    end if;

    if p_lab_id is not null and not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = v_user_id
    ) then
        raise exception 'Access denied for lab %', p_lab_id using errcode = '42501';
    end if;

    if p_storage_type = 'cabinet' and p_cabinet_id is null then
        raise exception 'cabinet_id is required for cabinet storage' using errcode = '22023';
    end if;

    if p_cabinet_id is not null then
        select c.lab_id, c.user_id
        into v_cabinet_lab_id, v_cabinet_user_id
        from public.cabinets c
        where c.id = p_cabinet_id;

        if not found then
            raise exception 'Cabinet not found: %', p_cabinet_id using errcode = 'P0002';
        end if;

        if p_lab_id is null then
            if v_cabinet_lab_id is not null or v_cabinet_user_id is distinct from v_user_id then
                raise exception 'Access denied for cabinet %', p_cabinet_id using errcode = '42501';
            end if;
        elsif v_cabinet_lab_id is distinct from p_lab_id then
            raise exception 'Cabinet does not belong to the requested lab' using errcode = '42501';
        end if;
    end if;

    if p_storage_location_id is not null then
        select sl.lab_id, sl.user_id
        into v_storage_lab_id, v_storage_user_id
        from public.storage_locations sl
        where sl.id = p_storage_location_id;

        if not found then
            raise exception 'Storage location not found: %', p_storage_location_id using errcode = 'P0002';
        end if;

        if p_lab_id is null then
            if v_storage_lab_id is not null or v_storage_user_id is distinct from v_user_id then
                raise exception 'Access denied for storage location %', p_storage_location_id using errcode = '42501';
            end if;
        elsif v_storage_lab_id is distinct from p_lab_id then
            raise exception 'Storage location does not belong to the requested lab' using errcode = '42501';
        end if;
    end if;

    insert into public.inventory (
        lab_id, user_id, name, brand, product_number, cas_number, quantity, capacity,
        storage_type, cabinet_id, storage_location_id, product_id, expiry_date, memo, remaining_percent
    ) values (
        p_lab_id, v_user_id, p_name, p_brand, p_product_number, p_cas_number, greatest(coalesce(p_quantity, 1), 1), p_capacity,
        p_storage_type, p_cabinet_id, p_storage_location_id, p_product_id, p_expiry_date, p_memo, p_remaining_percent
    ) returning id into v_new_id;

    select to_jsonb(i.*) into v_after_data from public.inventory i where i.id = v_new_id;

    insert into public.audit_logs (
        actor_user_id, actor_name, lab_id, entity_type, entity_id, action, before_data, after_data, diff_data, source
    ) values (
        v_user_id, p_actor_name, p_lab_id, 'inventory', v_new_id, 'create', null, v_after_data, null, 'rpc'
    );

    return v_after_data;
end;
$$;

create or replace function public.update_inventory_item_atomic(
    p_item_id uuid,
    p_item_source text,
    p_updates jsonb,
    p_actor_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_lab_id uuid;
    v_owner_user_id uuid;
    v_before_data jsonb;
    v_after_data jsonb;
    v_diff_data jsonb := '{}'::jsonb;
    v_key text;
    v_source_key text;
    v_val_before jsonb;
    v_val_after jsonb;
    v_cabinet_id uuid;
    v_cabinet_lab_id uuid;
    v_cabinet_user_id uuid;
    v_storage_location_id uuid;
    v_storage_lab_id uuid;
    v_storage_user_id uuid;
    v_new_storage_type text;
    v_new_cabinet_id uuid;
    v_new_storage_location_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_item_source = 'inventory' then
        select to_jsonb(i.*), i.lab_id, i.user_id
        into v_before_data, v_lab_id, v_owner_user_id
        from public.inventory i
        where i.id = p_item_id
        for update;

        if not found then
            raise exception 'Inventory item % not found', p_item_id using errcode = 'P0002';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for inventory item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        v_new_storage_type := coalesce(p_updates->>'storage_type', v_before_data->>'storage_type');

        if p_updates ? 'cabinet_id' then
            v_new_cabinet_id := nullif(p_updates->>'cabinet_id', '')::uuid;
        else
            v_new_cabinet_id := nullif(v_before_data->>'cabinet_id', '')::uuid;
        end if;

        if p_updates ? 'storage_location_id' then
            v_new_storage_location_id := nullif(p_updates->>'storage_location_id', '')::uuid;
        else
            v_new_storage_location_id := nullif(v_before_data->>'storage_location_id', '')::uuid;
        end if;

        if v_new_storage_type = 'cabinet' and v_new_cabinet_id is null then
            raise exception 'cabinet_id is required for cabinet storage' using errcode = '22023';
        end if;

        if v_new_cabinet_id is not null then
            select c.lab_id, c.user_id
            into v_cabinet_lab_id, v_cabinet_user_id
            from public.cabinets c
            where c.id = v_new_cabinet_id;

            if not found then
                raise exception 'Cabinet not found: %', v_new_cabinet_id using errcode = 'P0002';
            end if;

            if v_lab_id is null then
                if v_cabinet_lab_id is not null or v_cabinet_user_id is distinct from v_user_id then
                    raise exception 'Access denied for cabinet %', v_new_cabinet_id using errcode = '42501';
                end if;
            elsif v_cabinet_lab_id is distinct from v_lab_id then
                raise exception 'Cabinet does not belong to the item lab' using errcode = '42501';
            end if;
        end if;

        if v_new_storage_location_id is not null then
            select sl.lab_id, sl.user_id
            into v_storage_lab_id, v_storage_user_id
            from public.storage_locations sl
            where sl.id = v_new_storage_location_id;

            if not found then
                raise exception 'Storage location not found: %', v_new_storage_location_id using errcode = 'P0002';
            end if;

            if v_lab_id is null then
                if v_storage_lab_id is not null or v_storage_user_id is distinct from v_user_id then
                    raise exception 'Access denied for storage location %', v_new_storage_location_id using errcode = '42501';
                end if;
            elsif v_storage_lab_id is distinct from v_lab_id then
                raise exception 'Storage location does not belong to the item lab' using errcode = '42501';
            end if;
        end if;

        update public.inventory
        set
            name = coalesce((p_updates->>'name'), name),
            brand = case when p_updates ? 'brand' then (p_updates->>'brand') else brand end,
            product_number = case when p_updates ? 'product_number' then (p_updates->>'product_number') else product_number end,
            cas_number = case when p_updates ? 'cas_number' then (p_updates->>'cas_number') else cas_number end,
            quantity = case when p_updates ? 'quantity' then greatest((p_updates->>'quantity')::integer, 1) else quantity end,
            capacity = case when p_updates ? 'capacity' then (p_updates->>'capacity') else capacity end,
            storage_type = case when p_updates ? 'storage_type' then (p_updates->>'storage_type') else storage_type end,
            cabinet_id = case when p_updates ? 'cabinet_id' then nullif(p_updates->>'cabinet_id', '')::uuid else cabinet_id end,
            storage_location_id = case when p_updates ? 'storage_location_id' then nullif(p_updates->>'storage_location_id', '')::uuid else storage_location_id end,
            product_id = case when p_updates ? 'product_id' then nullif(p_updates->>'product_id', '')::uuid else product_id end,
            expiry_date = case when p_updates ? 'expiry_date' then nullif(p_updates->>'expiry_date', '')::date else expiry_date end,
            memo = case when p_updates ? 'memo' then (p_updates->>'memo') else memo end,
            remaining_percent = case when p_updates ? 'remaining_percent' then (p_updates->>'remaining_percent')::integer else remaining_percent end,
            updated_at = now()
        where id = p_item_id;

        select to_jsonb(i.*) into v_after_data from public.inventory i where i.id = p_item_id;

        for v_key in select jsonb_object_keys(p_updates) loop
            v_val_before := v_before_data->v_key;
            v_val_after := v_after_data->v_key;
            if v_val_before is distinct from v_val_after then
                v_diff_data := jsonb_set(
                    v_diff_data,
                    array[v_key],
                    jsonb_build_object('from', v_val_before, 'to', v_val_after)
                );
            end if;
        end loop;

        if v_diff_data != '{}'::jsonb then
            insert into public.audit_logs (
                actor_user_id, actor_name, lab_id, entity_type, entity_id, action, before_data, after_data, diff_data, source
            ) values (
                v_user_id, p_actor_name, v_lab_id, 'inventory', p_item_id, 'update', v_before_data, v_after_data, v_diff_data, 'rpc'
            );
        end if;

    elsif p_item_source = 'cabinet_item' then
        select to_jsonb(ci.*), ci.cabinet_id
        into v_before_data, v_cabinet_id
        from public.cabinet_items ci
        where ci.id = p_item_id
        for update;

        if not found then
            raise exception 'Cabinet item % not found', p_item_id using errcode = 'P0002';
        end if;

        select c.lab_id, c.user_id
        into v_lab_id, v_owner_user_id
        from public.cabinets c
        where c.id = v_cabinet_id;

        if not found then
            raise exception 'Cabinet not found: %', v_cabinet_id using errcode = 'P0002';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for cabinet item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        update public.cabinet_items
        set
            name = coalesce((p_updates->>'name'), name),
            brand = case when p_updates ? 'brand' then (p_updates->>'brand') else brand end,
            product_number = case when p_updates ? 'product_number' then (p_updates->>'product_number') else product_number end,
            cas_no = case when p_updates ? 'cas_no' then (p_updates->>'cas_no') else cas_no end,
            capacity = case when p_updates ? 'capacity' then (p_updates->>'capacity') else capacity end,
            expiry_date = case when p_updates ? 'expiry_date' then nullif(p_updates->>'expiry_date', '')::date else expiry_date end,
            notes = case when p_updates ? 'notes' then (p_updates->>'notes') else notes end,
            remaining_percent = case when p_updates ? 'remaining_percent' then (p_updates->>'remaining_percent')::integer else remaining_percent end
        where id = p_item_id;

        select to_jsonb(ci.*) into v_after_data from public.cabinet_items ci where ci.id = p_item_id;

        for v_source_key in select jsonb_object_keys(p_updates) loop
            v_key := v_source_key;
            v_val_before := v_before_data->v_key;
            v_val_after := v_after_data->v_key;
            if v_val_before is distinct from v_val_after then
                v_diff_data := jsonb_set(
                    v_diff_data,
                    array[v_key],
                    jsonb_build_object('from', v_val_before, 'to', v_val_after)
                );
            end if;
        end loop;

        if v_diff_data != '{}'::jsonb then
            insert into public.audit_logs (
                actor_user_id, actor_name, lab_id, entity_type, entity_id, action, before_data, after_data, diff_data, source
            ) values (
                v_user_id, p_actor_name, v_lab_id, 'cabinet_item', p_item_id, 'update', v_before_data, v_after_data, v_diff_data, 'rpc'
            );
        end if;
    else
        raise exception 'Unsupported item source %', p_item_source using errcode = '22023';
    end if;

    return v_after_data;
end;
$$;

create or replace function public.delete_inventory_item_atomic(
    p_item_id uuid,
    p_item_source text,
    p_item_name text,
    p_lab_id uuid default null,
    p_cabinet_id uuid default null,
    p_cabinet_name text default null,
    p_storage_location_name text default null,
    p_disposal_reason text default 'Deleted from inventory list',
    p_actor_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_owner_user_id uuid;
    v_item_name text := p_item_name;
    v_brand text := null;
    v_product_number text := null;
    v_cas text := null;
    v_capacity text := null;
    v_quantity integer := 1;
    v_storage_type text := 'other';
    v_location text := coalesce(p_storage_location_name, 'Other storage');
    v_cabinet_id uuid := p_cabinet_id;
    v_cabinet_lab_id uuid := null;
    v_lab_id uuid := p_lab_id;
    v_match_cabinet_item_id uuid := null;
    v_linked_inventory_item_id uuid := null;
    v_chemical jsonb;
    v_before_data jsonb;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_item_source not in ('inventory', 'cabinet_item') then
        raise exception 'Unsupported item source: %', p_item_source using errcode = '22023';
    end if;

    if p_item_source = 'inventory' then
        select
            i.name,
            i.brand,
            i.product_number,
            i.cas_number,
            i.capacity,
            i.quantity,
            i.storage_type,
            i.cabinet_id,
            i.lab_id,
            i.user_id
        into
            v_item_name,
            v_brand,
            v_product_number,
            v_cas,
            v_capacity,
            v_quantity,
            v_storage_type,
            v_cabinet_id,
            v_lab_id,
            v_owner_user_id
        from public.inventory i
        where i.id = p_item_id
        for update;

        if not found then
            raise exception 'Inventory row not found: %', p_item_id using errcode = 'P0002';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for inventory item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        if v_cabinet_id is not null then
            select c.lab_id, c.user_id
            into v_cabinet_lab_id, v_owner_user_id
            from public.cabinets c
            where c.id = v_cabinet_id;

            if not found then
                raise exception 'Cabinet not found: %', v_cabinet_id using errcode = 'P0002';
            end if;

            if v_lab_id is null then
                if v_cabinet_lab_id is not null or v_owner_user_id is distinct from v_user_id then
                    raise exception 'Access denied for cabinet %', v_cabinet_id using errcode = '42501';
                end if;
            elsif v_cabinet_lab_id is distinct from v_lab_id then
                raise exception 'Cabinet does not belong to the item lab' using errcode = '42501';
            end if;
        end if;

        if v_storage_type = 'cabinet' and v_cabinet_id is not null then
            v_location := coalesce(p_cabinet_name, 'Cabinet');

            select ci.id
            into v_match_cabinet_item_id
            from public.cabinet_items ci
            where ci.cabinet_id = v_cabinet_id
              and ci.inventory_item_id = p_item_id
            order by ci.created_at asc
            limit 1;

            if v_match_cabinet_item_id is null then
                select ci.id
                into v_match_cabinet_item_id
                from public.cabinet_items ci
                where ci.cabinet_id = v_cabinet_id
                  and ci.inventory_item_id is null
                  and lower(trim(coalesce(ci.name, ''))) = lower(trim(coalesce(v_item_name, '')))
                  and (
                        v_product_number is null
                        or lower(trim(coalesce(ci.product_number, ''))) = lower(trim(v_product_number))
                  )
                  and (
                        v_brand is null
                        or lower(trim(coalesce(ci.brand, ''))) = lower(trim(v_brand))
                  )
                  and (
                        v_capacity is null
                        or lower(trim(coalesce(ci.capacity, ''))) = lower(trim(v_capacity))
                  )
                order by ci.created_at asc
                limit 1;
            end if;

            if v_match_cabinet_item_id is null then
                select ci.id
                into v_match_cabinet_item_id
                from public.cabinet_items ci
                where ci.cabinet_id = v_cabinet_id
                  and ci.inventory_item_id is null
                  and lower(trim(coalesce(ci.name, ''))) = lower(trim(coalesce(v_item_name, '')))
                order by ci.created_at asc
                limit 1;
            end if;

            if v_match_cabinet_item_id is not null then
                delete from public.cabinet_items where id = v_match_cabinet_item_id;
            end if;

            insert into public.cabinet_disposal_logs (cabinet_id, item_name, reason, disposed_by)
            values (v_cabinet_id, v_item_name, coalesce(p_disposal_reason, 'Removed'), v_user_id);

            insert into public.cabinet_activity_logs (cabinet_id, action_type, item_name, reason, performed_by)
            values (v_cabinet_id, 'remove', v_item_name, coalesce(p_disposal_reason, 'Removed'), v_user_id);
        end if;

        v_before_data := jsonb_build_object(
            'id', p_item_id,
            'name', v_item_name,
            'brand', v_brand,
            'product_number', v_product_number,
            'cas_number', v_cas,
            'capacity', v_capacity,
            'quantity', v_quantity,
            'storage_type', v_storage_type,
            'cabinet_id', v_cabinet_id,
            'lab_id', v_lab_id
        );

        insert into public.audit_logs (
            actor_user_id, actor_name, lab_id, entity_type, entity_id, action, location_context, before_data, source
        ) values (
            v_user_id, p_actor_name, v_lab_id, 'inventory', p_item_id, 'delete', v_location, v_before_data, 'rpc'
        );

        delete from public.inventory where id = p_item_id;
    else
        select
            ci.name,
            ci.brand,
            ci.product_number,
            ci.cas_no,
            ci.capacity,
            ci.cabinet_id,
            ci.inventory_item_id
        into
            v_item_name,
            v_brand,
            v_product_number,
            v_cas,
            v_capacity,
            v_cabinet_id,
            v_linked_inventory_item_id
        from public.cabinet_items ci
        where ci.id = p_item_id
        for update;

        if not found then
            raise exception 'Cabinet item row not found: %', p_item_id using errcode = 'P0002';
        end if;

        select c.lab_id, c.user_id
        into v_lab_id, v_owner_user_id
        from public.cabinets c
        where c.id = v_cabinet_id;

        if not found then
            raise exception 'Cabinet not found: %', v_cabinet_id using errcode = 'P0002';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for cabinet item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        v_storage_type := 'cabinet';
        v_location := coalesce(p_cabinet_name, 'Cabinet');

        delete from public.cabinet_items where id = p_item_id;

        if v_linked_inventory_item_id is not null then
            delete from public.inventory where id = v_linked_inventory_item_id;
        end if;

        if v_cabinet_id is not null then
            insert into public.cabinet_disposal_logs (cabinet_id, item_name, reason, disposed_by)
            values (v_cabinet_id, v_item_name, coalesce(p_disposal_reason, 'Removed'), v_user_id);

            insert into public.cabinet_activity_logs (cabinet_id, action_type, item_name, reason, performed_by)
            values (v_cabinet_id, 'remove', v_item_name, coalesce(p_disposal_reason, 'Removed'), v_user_id);
        end if;

        v_before_data := jsonb_build_object(
            'id', p_item_id,
            'inventory_item_id', v_linked_inventory_item_id,
            'name', v_item_name,
            'brand', v_brand,
            'product_number', v_product_number,
            'cas_no', v_cas,
            'capacity', v_capacity,
            'cabinet_id', v_cabinet_id,
            'lab_id', v_lab_id
        );

        insert into public.audit_logs (
            actor_user_id, actor_name, lab_id, entity_type, entity_id, action, location_context, before_data, source
        ) values (
            v_user_id, p_actor_name, v_lab_id, 'cabinet_item', p_item_id, 'delete', v_location, v_before_data, 'rpc'
        );
    end if;

    v_chemical := jsonb_build_object(
        'id', coalesce(v_linked_inventory_item_id::text, p_item_id::text),
        'name', coalesce(v_item_name, p_item_name),
        'brand', v_brand,
        'product_number', v_product_number,
        'cas_number', v_cas,
        'quantity', coalesce(v_quantity, 1),
        'capacity', v_capacity,
        'storage_type', v_storage_type,
        'deleted_location', v_location
    );

    begin
        insert into public.waste_logs (user_id, lab_id, chemicals, disposal_category, handler_name, memo)
        values (
            v_user_id,
            v_lab_id,
            jsonb_build_array(v_chemical),
            coalesce(v_item_name, p_item_name),
            null,
            coalesce(p_disposal_reason, 'Removed')
        );
    exception
        when undefined_column then
            insert into public.waste_logs (user_id, lab_id, chemicals, disposal_category, memo)
            values (
                v_user_id,
                v_lab_id,
                jsonb_build_array(v_chemical),
                coalesce(v_item_name, p_item_name),
                coalesce(p_disposal_reason, 'Removed')
            );
    end;
end;
$$;

create or replace function public.insert_audit_log_rpc(
    p_actor_user_id uuid,
    p_actor_name text,
    p_lab_id uuid,
    p_entity_type text,
    p_entity_id uuid,
    p_action text,
    p_location_context text default null,
    p_before_data jsonb default null,
    p_after_data jsonb default null,
    p_diff_data jsonb default null,
    p_source text default 'ui',
    p_request_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_lab_id is not null and not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = v_user_id
    ) then
        raise exception 'Access denied for lab %', p_lab_id using errcode = '42501';
    end if;

    insert into public.audit_logs (
        actor_user_id,
        actor_name,
        lab_id,
        entity_type,
        entity_id,
        action,
        location_context,
        before_data,
        after_data,
        diff_data,
        source,
        request_id
    ) values (
        v_user_id,
        p_actor_name,
        p_lab_id,
        p_entity_type,
        p_entity_id,
        p_action,
        p_location_context,
        p_before_data,
        p_after_data,
        p_diff_data,
        p_source,
        p_request_id
    );
end;
$$;

create or replace function public.get_cabinet_audit_logs(
    p_cabinet_id uuid,
    p_limit integer default 50
)
returns table (
    id uuid,
    created_at timestamp with time zone,
    actor_user_id uuid,
    actor_name text,
    lab_id uuid,
    entity_type text,
    entity_id uuid,
    action text,
    location_context text,
    before_data jsonb,
    after_data jsonb,
    diff_data jsonb,
    source text,
    request_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_lab_id uuid;
    v_owner_user_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    select c.lab_id, c.user_id
    into v_lab_id, v_owner_user_id
    from public.cabinets c
    where c.id = p_cabinet_id;

    if not found then
        raise exception 'Cabinet not found: %', p_cabinet_id using errcode = 'P0002';
    end if;

    if v_lab_id is null then
        if v_owner_user_id is distinct from v_user_id then
            raise exception 'Access denied for cabinet %', p_cabinet_id using errcode = '42501';
        end if;
    elsif not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = v_lab_id
          and lm.user_id = v_user_id
    ) then
        raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
    end if;

    return query
    select
        a.id, a.created_at, a.actor_user_id, a.actor_name, a.lab_id, a.entity_type, a.entity_id,
        a.action, a.location_context, a.before_data, a.after_data, a.diff_data, a.source, a.request_id
    from public.audit_logs a
    where (a.entity_type = 'cabinet_item' and ((a.before_data->>'cabinet_id') = p_cabinet_id::text or (a.after_data->>'cabinet_id') = p_cabinet_id::text))
       or (a.entity_type = 'inventory' and ((a.before_data->>'cabinet_id') = p_cabinet_id::text or (a.after_data->>'cabinet_id') = p_cabinet_id::text))
       or (a.entity_type = 'cabinet' and a.entity_id = p_cabinet_id)
    order by a.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.create_inventory_item_atomic(text, text, text, text, text, integer, text, uuid, uuid, uuid, date, text, integer, uuid, uuid, text) from public, anon;
revoke all on function public.update_inventory_item_atomic(uuid, text, jsonb, text) from public, anon;
revoke all on function public.delete_inventory_item_atomic(uuid, text, text, uuid, uuid, text, text, text, text) from public, anon;
revoke all on function public.insert_audit_log_rpc(uuid, text, uuid, text, uuid, text, text, jsonb, jsonb, jsonb, text, uuid) from public, anon;
revoke all on function public.get_cabinet_audit_logs(uuid, integer) from public, anon;

grant execute on function public.create_inventory_item_atomic(text, text, text, text, text, integer, text, uuid, uuid, uuid, date, text, integer, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.update_inventory_item_atomic(uuid, text, jsonb, text) to authenticated, service_role;
grant execute on function public.delete_inventory_item_atomic(uuid, text, text, uuid, uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.insert_audit_log_rpc(uuid, text, uuid, text, uuid, text, text, jsonb, jsonb, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.get_cabinet_audit_logs(uuid, integer) to authenticated, service_role;
