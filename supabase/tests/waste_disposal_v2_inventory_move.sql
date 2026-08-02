-- Transactional integration checks for the atomic bulk inventory move RPC.
-- The final rollback leaves the database unchanged.

begin;

do $$
declare
    v_user_id uuid := gen_random_uuid();
    v_other_user_id uuid := gen_random_uuid();
    v_lab_id uuid := gen_random_uuid();
    v_other_lab_id uuid := gen_random_uuid();
    v_source_location_id uuid := gen_random_uuid();
    v_destination_location_id uuid := gen_random_uuid();
    v_other_lab_location_id uuid := gen_random_uuid();
    v_source_cabinet_id uuid := gen_random_uuid();
    v_destination_cabinet_id uuid := gen_random_uuid();
    v_source_shelf_id uuid := gen_random_uuid();
    v_destination_shelf_id uuid := gen_random_uuid();
    v_other_inventory_id uuid := gen_random_uuid();
    v_cabinet_inventory_id uuid := gen_random_uuid();
    v_cabinet_item_id uuid := gen_random_uuid();
    v_atomic_inventory_id uuid := gen_random_uuid();
    v_cross_lab_inventory_id uuid := gen_random_uuid();
    v_blocker_item_id uuid := gen_random_uuid();
    v_to_cabinet_request_id uuid := gen_random_uuid();
    v_cabinet_to_cabinet_request_id uuid := gen_random_uuid();
    v_to_other_request_id uuid := gen_random_uuid();
    v_result jsonb;
    v_created_cabinet_item_id uuid;
    v_count integer;
begin
    insert into auth.users (id, email, raw_user_meta_data)
    values
        (v_user_id, 'move-owner@example.test', '{"name":"Move owner"}'::jsonb),
        (v_other_user_id, 'move-other@example.test', '{}'::jsonb);
    insert into public.labs (id) values (v_lab_id), (v_other_lab_id);
    insert into public.lab_members (lab_id, user_id, role, nickname)
    values (v_lab_id, v_user_id, 'student', 'Atomic move tester');

    insert into public.storage_locations (id, lab_id, user_id, name)
    values
        (v_source_location_id, v_lab_id, v_user_id, 'Move source'),
        (v_destination_location_id, v_lab_id, v_user_id, 'Move destination'),
        (v_other_lab_location_id, v_other_lab_id, v_other_user_id, 'Other lab');
    insert into public.cabinets (id, lab_id, user_id, name, width, depth)
    values
        (v_source_cabinet_id, v_lab_id, v_user_id, 'Source cabinet', 5, 2),
        (v_destination_cabinet_id, v_lab_id, v_user_id, 'Destination cabinet', 5, 2);
    insert into public.cabinet_shelves (id, cabinet_id, level)
    values
        (v_source_shelf_id, v_source_cabinet_id, 0),
        (v_destination_shelf_id, v_destination_cabinet_id, 0);

    insert into public.inventory (
        id, lab_id, user_id, name, cas_number, quantity,
        storage_type, cabinet_id, storage_location_id
    ) values
        (
            v_other_inventory_id, v_lab_id, v_user_id, 'Acetone', '67-64-1', 1,
            'other', null, v_source_location_id
        ),
        (
            v_cabinet_inventory_id, v_lab_id, v_user_id, 'Ethanol', '64-17-5', 1,
            'cabinet', v_source_cabinet_id, null
        ),
        (
            v_atomic_inventory_id, v_lab_id, v_user_id, 'Water', '7732-18-5', 1,
            'other', null, v_source_location_id
        ),
        (
            v_cross_lab_inventory_id, v_other_lab_id, v_other_user_id,
            'Methanol', '67-56-1', 1, 'other', null, v_other_lab_location_id
        );
    insert into public.cabinet_items (
        id, inventory_item_id, name, cas_no, cabinet_id, shelf_id,
        template, width, position, depth_position
    ) values
        (
            v_cabinet_item_id, v_cabinet_inventory_id, 'Ethanol', '64-17-5',
            v_source_cabinet_id, v_source_shelf_id, 'A', 8, 10, 50
        ),
        (
            v_blocker_item_id, null, 'Existing blocker', null,
            v_destination_cabinet_id, v_destination_shelf_id, 'A', 8, 70, 50
        );

    perform set_config('request.jwt.claim.sub', v_user_id::text, true);

    -- Inventory in generic storage can move into a cabinet and gains exactly
    -- one linked cabinet placement.
    v_result := public.move_inventory_records_v2(
        jsonb_build_array(jsonb_build_object(
            'item_id', v_other_inventory_id,
            'item_source', 'inventory',
            'placement', jsonb_build_object(
                'shelf_id', v_destination_shelf_id,
                'template', 'A',
                'width', 8,
                'position', 10,
                'depth_position', 50
            )
        )),
        jsonb_build_object(
            'storage_type', 'cabinet',
            'cabinet_id', v_destination_cabinet_id
        ),
        v_to_cabinet_request_id
    );
    if (v_result->>'moved_count')::integer <> 1
       or (v_result->>'idempotent')::boolean
       or jsonb_array_length(v_result->'moved_items') <> 1 then
        raise exception 'inventory-to-cabinet returned an invalid exact receipt';
    end if;
    select ci.id into v_created_cabinet_item_id
    from public.cabinet_items ci
    where ci.inventory_item_id = v_other_inventory_id;
    if v_created_cabinet_item_id is null
       or (select storage_type from public.inventory where id = v_other_inventory_id) <> 'cabinet'
       or (select cabinet_id from public.inventory where id = v_other_inventory_id)
            is distinct from v_destination_cabinet_id then
        raise exception 'inventory-to-cabinet did not update both linked records';
    end if;

    v_result := public.move_inventory_records_v2(
        jsonb_build_array(jsonb_build_object(
            'item_id', v_other_inventory_id,
            'item_source', 'inventory',
            'placement', jsonb_build_object(
                'shelf_id', v_destination_shelf_id,
                'template', 'A',
                'width', 8,
                'position', 10,
                'depth_position', 50
            )
        )),
        jsonb_build_object(
            'storage_type', 'cabinet',
            'cabinet_id', v_destination_cabinet_id
        ),
        v_to_cabinet_request_id
    );
    if not (v_result->>'idempotent')::boolean then
        raise exception 'bulk-move retry was not idempotent';
    end if;
    select count(*) into v_count
    from public.inventory_move_receipts
    where request_id = v_to_cabinet_request_id;
    if v_count <> 1 then
        raise exception 'bulk-move retry wrote duplicate receipts';
    end if;
    select count(*) into v_count
    from public.audit_logs
    where request_id = v_to_cabinet_request_id;
    if v_count <> 1 then
        raise exception 'bulk-move retry wrote duplicate audit records';
    end if;

    begin
        perform public.move_inventory_records_v2(
            jsonb_build_array(jsonb_build_object(
                'item_id', v_other_inventory_id,
                'item_source', 'inventory',
                'placement', jsonb_build_object(
                    'shelf_id', v_destination_shelf_id,
                    'template', 'A',
                    'width', 8,
                    'position', 30,
                    'depth_position', 50
                )
            )),
            jsonb_build_object(
                'storage_type', 'cabinet',
                'cabinet_id', v_destination_cabinet_id
            ),
            v_to_cabinet_request_id
        );
        raise exception 'bulk-move request_id accepted changed geometry';
    exception
        when unique_violation then null;
    end;

    -- A cabinet-item source retains its item ID and linked inventory row.
    v_result := public.move_inventory_records_v2(
        jsonb_build_array(jsonb_build_object(
            'item_id', v_cabinet_item_id,
            'item_source', 'cabinet_item',
            'placement', jsonb_build_object(
                'shelf_id', v_destination_shelf_id,
                'template', 'A',
                'width', 8,
                'position', 35,
                'depth_position', 50
            )
        )),
        jsonb_build_object(
            'storage_type', 'cabinet',
            'cabinet_id', v_destination_cabinet_id
        ),
        v_cabinet_to_cabinet_request_id
    );
    if (v_result->>'moved_count')::integer <> 1
       or (select cabinet_id from public.cabinet_items where id = v_cabinet_item_id)
            is distinct from v_destination_cabinet_id
       or (select cabinet_id from public.inventory where id = v_cabinet_inventory_id)
            is distinct from v_destination_cabinet_id then
        raise exception 'cabinet-to-cabinet move did not preserve and synchronize linked rows';
    end if;

    -- Moving an inventory record back to generic storage removes only its
    -- placement and keeps the inventory row.
    v_result := public.move_inventory_records_v2(
        jsonb_build_array(jsonb_build_object(
            'item_id', v_other_inventory_id,
            'item_source', 'inventory'
        )),
        jsonb_build_object(
            'storage_type', 'other',
            'storage_location_id', v_destination_location_id
        ),
        v_to_other_request_id
    );
    if (v_result->>'moved_count')::integer <> 1
       or exists (
           select 1 from public.cabinet_items where inventory_item_id = v_other_inventory_id
       )
       or (select storage_type from public.inventory where id = v_other_inventory_id) <> 'other'
       or (select storage_location_id from public.inventory where id = v_other_inventory_id)
            is distinct from v_destination_location_id then
        raise exception 'cabinet-to-other move did not remove placement and preserve inventory';
    end if;

    -- Existing-item and within-payload collisions are rejected before any
    -- target is mutated.
    begin
        perform public.move_inventory_records_v2(
            jsonb_build_array(jsonb_build_object(
                'item_id', v_atomic_inventory_id,
                'item_source', 'inventory',
                'placement', jsonb_build_object(
                    'shelf_id', v_destination_shelf_id,
                    'template', 'A',
                    'width', 8,
                    'position', 70,
                    'depth_position', 50
                )
            )),
            jsonb_build_object(
                'storage_type', 'cabinet',
                'cabinet_id', v_destination_cabinet_id
            ),
            gen_random_uuid()
        );
        raise exception 'bulk move accepted collision with existing destination item';
    exception
        when sqlstate '22023' then null;
    end;
    if (select storage_type from public.inventory where id = v_atomic_inventory_id) <> 'other' then
        raise exception 'collision failure partially changed the source inventory row';
    end if;

    -- One unauthorized target causes the complete call to roll back, including
    -- a valid target that appeared earlier in the array.
    begin
        perform public.move_inventory_records_v2(
            jsonb_build_array(
                jsonb_build_object(
                    'item_id', v_atomic_inventory_id,
                    'item_source', 'inventory',
                    'placement', jsonb_build_object(
                        'shelf_id', v_destination_shelf_id,
                        'template', 'A',
                        'width', 8,
                        'position', 50,
                        'depth_position', 20
                    )
                ),
                jsonb_build_object(
                    'item_id', v_cross_lab_inventory_id,
                    'item_source', 'inventory',
                    'placement', jsonb_build_object(
                        'shelf_id', v_destination_shelf_id,
                        'template', 'A',
                        'width', 8,
                        'position', 50,
                        'depth_position', 80
                    )
                )
            ),
            jsonb_build_object(
                'storage_type', 'cabinet',
                'cabinet_id', v_destination_cabinet_id
            ),
            gen_random_uuid()
        );
        raise exception 'cross-lab bulk move was accepted';
    exception
        when insufficient_privilege then null;
    end;
    if (select storage_type from public.inventory where id = v_atomic_inventory_id) <> 'other'
       or (select storage_location_id from public.inventory where id = v_atomic_inventory_id)
            is distinct from v_source_location_id then
        raise exception 'cross-lab failure partially moved an authorized target';
    end if;

    begin
        perform public.move_inventory_records_v2(
            jsonb_build_array(jsonb_build_object(
                'item_id', v_atomic_inventory_id,
                'item_source', 'inventory',
                'placement', jsonb_build_object(
                    'shelf_id', v_destination_shelf_id,
                    'template', 'A',
                    'width', 20,
                    'position', 90,
                    'depth_position', 50
                )
            )),
            jsonb_build_object(
                'storage_type', 'cabinet',
                'cabinet_id', v_destination_cabinet_id
            ),
            gen_random_uuid()
        );
        raise exception 'bulk move accepted position + width above 100';
    exception
        when sqlstate '22023' then null;
    end;

    select count(*) into v_count from public.waste_logs;
    if v_count <> 0 then
        raise exception 'inventory moves must never create physical waste logs';
    end if;
end;
$$;

rollback;
