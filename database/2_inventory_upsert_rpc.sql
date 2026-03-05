-- RPC for atomic inventory creation and update with audit logging

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
    p_lab_id uuid default null,
    p_actor_user_id uuid default null,
    p_actor_name text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
    v_user_id uuid := coalesce(p_actor_user_id, auth.uid());
    v_new_id uuid;
    v_after_data jsonb;
begin
    insert into inventory (
        lab_id, user_id, name, brand, product_number, cas_number, quantity, capacity,
        storage_type, cabinet_id, storage_location_id, product_id, expiry_date, memo
    ) values (
        p_lab_id, v_user_id, p_name, p_brand, p_product_number, p_cas_number, p_quantity, p_capacity,
        p_storage_type, p_cabinet_id, p_storage_location_id, p_product_id, p_expiry_date, p_memo
    ) returning id into v_new_id;

    select to_jsonb(i.*) into v_after_data from inventory i where id = v_new_id;

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
    p_item_source text, -- 'inventory' or 'cabinet_item'
    p_updates jsonb,
    p_actor_name text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_lab_id uuid;
    v_before_data jsonb;
    v_after_data jsonb;
    v_diff_data jsonb := '{}'::jsonb;
    v_key text;
    v_val_before jsonb;
    v_val_after jsonb;
    v_cabinet_id uuid;
begin
    if p_item_source = 'inventory' then
        select to_jsonb(i.*) into v_before_data from inventory i where i.id = p_item_id for update;
        if not found then raise exception 'Inventory item % not found', p_item_id; end if;
        v_lab_id := (v_before_data->>'lab_id')::uuid;
        
        update inventory
        set
            name = coalesce((p_updates->>'name'), name),
            brand = case when p_updates ? 'brand' then (p_updates->>'brand') else brand end,
            product_number = case when p_updates ? 'product_number' then (p_updates->>'product_number') else product_number end,
            cas_number = case when p_updates ? 'cas_number' then (p_updates->>'cas_number') else cas_number end,
            quantity = coalesce((p_updates->>'quantity')::integer, quantity),
            capacity = case when p_updates ? 'capacity' then (p_updates->>'capacity') else capacity end,
            storage_type = coalesce((p_updates->>'storage_type'), storage_type),
            cabinet_id = case when p_updates ? 'cabinet_id' then (p_updates->>'cabinet_id')::uuid else cabinet_id end,
            storage_location_id = case when p_updates ? 'storage_location_id' then (p_updates->>'storage_location_id')::uuid else storage_location_id end,
            product_id = case when p_updates ? 'product_id' then (p_updates->>'product_id')::uuid else product_id end,
            expiry_date = case when p_updates ? 'expiry_date' then (p_updates->>'expiry_date')::date else expiry_date end,
            memo = case when p_updates ? 'memo' then (p_updates->>'memo') else memo end,
            updated_at = now()
        where id = p_item_id;

        select to_jsonb(i.*) into v_after_data from inventory i where i.id = p_item_id;

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
        select to_jsonb(ci.*) into v_before_data from cabinet_items ci where ci.id = p_item_id for update;
        if not found then raise exception 'Cabinet item % not found', p_item_id; end if;
        v_cabinet_id := (v_before_data->>'cabinet_id')::uuid;
        select lab_id into v_lab_id from cabinets c where c.id = v_cabinet_id;

        update cabinet_items
        set
            name = coalesce((p_updates->>'name'), name),
            brand = case when p_updates ? 'brand' then (p_updates->>'brand') else brand end,
            product_number = case when p_updates ? 'product_number' then (p_updates->>'product_number') else product_number end,
            cas_no = case when p_updates ? 'cas_no' then (p_updates->>'cas_no') else cas_no end,
            capacity = case when p_updates ? 'capacity' then (p_updates->>'capacity') else capacity end,
            expiry_date = case when p_updates ? 'expiry_date' then (p_updates->>'expiry_date')::date else expiry_date end,
            notes = case when p_updates ? 'notes' then (p_updates->>'notes') else notes end
        where id = p_item_id;
        
        select to_jsonb(ci.*) into v_after_data from cabinet_items ci where ci.id = p_item_id;

        for v_key in select jsonb_object_keys(p_updates) loop
            if v_key = 'cas_number' then v_key := 'cas_no'; end if;
            if v_key = 'memo' then v_key := 'notes'; end if;
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
        raise exception 'Unsupported item source %', p_item_source;
    end if;

    return v_after_data;
end;
$$;
