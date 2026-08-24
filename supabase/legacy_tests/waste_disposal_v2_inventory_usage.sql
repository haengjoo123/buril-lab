-- Transactional integration checks for the non-waste inventory completion RPC.
-- The final rollback leaves the database unchanged.

begin;

do $$
declare
    v_user_id uuid := gen_random_uuid();
    v_other_user_id uuid := gen_random_uuid();
    v_lab_id uuid := gen_random_uuid();
    v_cabinet_id uuid := gen_random_uuid();
    v_inventory_id uuid := gen_random_uuid();
    v_cabinet_item_id uuid := gen_random_uuid();
    v_unlinked_cabinet_item_id uuid := gen_random_uuid();
    v_first_request_id uuid := gen_random_uuid();
    v_final_request_id uuid := gen_random_uuid();
    v_result jsonb;
    v_created_inventory jsonb;
    v_count integer;
begin
    insert into auth.users (id) values (v_user_id), (v_other_user_id);
    insert into public.labs (id) values (v_lab_id);
    insert into public.lab_members (lab_id, user_id, role, nickname)
    values (v_lab_id, v_user_id, 'student', 'DB verification user');
    insert into public.cabinets (id, lab_id, user_id, name)
    values (v_cabinet_id, v_lab_id, v_user_id, 'Usage completion test cabinet');
    insert into public.inventory (
        id, lab_id, user_id, name, cas_number, quantity,
        storage_type, cabinet_id, remaining_percent
    ) values (
        v_inventory_id, v_lab_id, v_user_id, 'Acetone', '67-64-1', 2,
        'cabinet', v_cabinet_id, 0
    );
    insert into public.cabinet_items (
        id, inventory_item_id, name, cas_no, cabinet_id, remaining_percent
    ) values (
        v_cabinet_item_id, v_inventory_id, 'Acetone', '67-64-1', v_cabinet_id, 0
    );
    insert into public.cabinet_items (
        id, inventory_item_id, name, cas_no, cabinet_id, remaining_percent
    ) values (
        v_unlinked_cabinet_item_id, null, 'Legacy unlinked item', null, v_cabinet_id, 0
    );

    perform set_config('request.jwt.claim.sub', v_user_id::text, true);

    begin
        perform public.create_inventory_item_atomic(
            p_name => 'Invalid CAS inventory',
            p_storage_type => 'other',
            p_cas_number => 'Acetone',
            p_lab_id => v_lab_id
        );
        raise exception 'create_inventory_item_atomic accepted a name in the CAS field';
    exception
        when sqlstate '22023' then null;
    end;

    v_created_inventory := public.create_inventory_item_atomic(
        p_name => 'Ethanol',
        p_storage_type => 'other',
        p_cas_number => '64-17-5',
        p_lab_id => v_lab_id
    );
    if v_created_inventory->>'cas_number' <> '64-17-5' then
        raise exception 'create_inventory_item_atomic rejected or changed a valid CAS value';
    end if;

    begin
        perform public.update_inventory_item_atomic(
            (v_created_inventory->>'id')::uuid,
            'inventory',
            '{"cas_number":"64-17-6"}'::jsonb,
            null
        );
        raise exception 'update_inventory_item_atomic accepted an invalid CAS checksum';
    exception
        when sqlstate '22023' then null;
    end;
    if (select cas_number from public.inventory where id = (v_created_inventory->>'id')::uuid) <> '64-17-5' then
        raise exception 'invalid CAS update changed the stored inventory value';
    end if;

    v_result := public.record_inventory_usage_completion_v2(
        v_cabinet_item_id,
        v_first_request_id,
        'used'
    );

    if (v_result->>'previous_quantity')::integer <> 2
       or (v_result->>'remaining_quantity')::integer <> 1
       or (v_result->>'cabinet_item_removed')::boolean
       or (v_result->>'inventory_item_removed')::boolean
       or (v_result->>'idempotent')::boolean then
        raise exception 'quantity 2 -> 1 returned an invalid usage-completion receipt';
    end if;
    if (select quantity from public.inventory where id = v_inventory_id) <> 1 then
        raise exception 'quantity 2 -> 1 did not decrement inventory by exactly one';
    end if;
    if not exists (select 1 from public.cabinet_items where id = v_cabinet_item_id) then
        raise exception 'quantity 2 -> 1 removed the cabinet placement before zero';
    end if;

    v_result := public.record_inventory_usage_completion_v2(
        v_cabinet_item_id,
        v_first_request_id,
        'used'
    );
    if not (v_result->>'idempotent')::boolean
       or (select quantity from public.inventory where id = v_inventory_id) <> 1 then
        raise exception 'usage-completion retry was not idempotent';
    end if;

    select count(*) into v_count
    from public.inventory_usage_completion_receipts
    where request_id = v_first_request_id;
    if v_count <> 1 then
        raise exception 'idempotent usage completion wrote duplicate receipts';
    end if;
    select count(*) into v_count
    from public.cabinet_activity_logs
    where cabinet_id = v_cabinet_id;
    if v_count <> 1 then
        raise exception 'idempotent usage completion wrote duplicate activity records';
    end if;
    select count(*) into v_count
    from public.audit_logs
    where request_id = v_first_request_id;
    if v_count <> 1 then
        raise exception 'idempotent usage completion wrote duplicate audit records';
    end if;

    v_result := public.record_inventory_usage_completion_v2(
        v_cabinet_item_id,
        v_final_request_id,
        'empty_container'
    );
    if (v_result->>'previous_quantity')::integer <> 1
       or (v_result->>'remaining_quantity')::integer <> 0
       or not (v_result->>'cabinet_item_removed')::boolean
       or not (v_result->>'inventory_item_removed')::boolean
       or (v_result->>'idempotent')::boolean then
        raise exception 'quantity 1 -> removed returned an invalid usage-completion receipt';
    end if;
    if exists (select 1 from public.inventory where id = v_inventory_id)
       or exists (select 1 from public.cabinet_items where id = v_cabinet_item_id) then
        raise exception 'quantity 1 -> removed left inventory or placement data behind';
    end if;

    select count(*) into v_count from public.waste_logs;
    if v_count <> 0 then
        raise exception 'used/empty-container completion must never create waste_logs';
    end if;

    begin
        perform public.record_inventory_usage_completion_v2(
            v_unlinked_cabinet_item_id,
            gen_random_uuid(),
            'used'
        );
        raise exception 'unlinked legacy cabinet item was accepted';
    exception
        when sqlstate '22023' then null;
    end;

    -- A non-member cannot operate on a lab cabinet; scope is derived from the
    -- locked cabinet row rather than a client-provided lab or actor value.
    perform set_config('request.jwt.claim.sub', v_other_user_id::text, true);
    begin
        perform public.record_inventory_usage_completion_v2(
            v_unlinked_cabinet_item_id,
            gen_random_uuid(),
            'used'
        );
        raise exception 'cross-lab usage completion was accepted';
    exception
        when sqlstate '42501' then null;
    end;
end;
$$;

rollback;
