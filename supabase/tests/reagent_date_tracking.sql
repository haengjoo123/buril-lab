-- Transactional coverage for manufacturer date types plus receipt/open dates.
-- Run after the migration set; rollback keeps the development database clean.

begin;

do $$
declare
    v_user_id uuid := gen_random_uuid();
    v_lab_id uuid := gen_random_uuid();
    v_location_id uuid := gen_random_uuid();
    v_cabinet_id uuid := gen_random_uuid();
    v_shelf_id uuid := gen_random_uuid();
    v_cabinet_item_id uuid := gen_random_uuid();
    v_inventory_id uuid;
    v_created jsonb;
    v_failed boolean := false;
begin
    insert into auth.users (id, email, raw_user_meta_data)
    values (v_user_id, 'date-tracking@example.test', '{"name":"Date tracking tester"}'::jsonb);

    insert into public.labs (id, name, created_by)
    values (v_lab_id, 'Date tracking test lab', v_user_id);

    insert into public.lab_members (lab_id, user_id, role, nickname)
    values (v_lab_id, v_user_id, 'student', 'Date tracking tester');

    insert into public.storage_locations (id, lab_id, user_id, name)
    values (v_location_id, v_lab_id, v_user_id, 'Date tracking location');

    insert into public.cabinets (id, lab_id, user_id, name, width, height, depth)
    values (v_cabinet_id, v_lab_id, v_user_id, 'Date tracking cabinet', 5, 9, 2);

    perform set_config('request.jwt.claim.sub', v_user_id::text, true);

    v_created := public.create_inventory_item_with_dates_atomic(
        p_name => 'Minimum-shelf-life reagent',
        p_storage_type => 'other',
        p_quantity => 1,
        p_storage_location_id => v_location_id,
        p_expiry_date => date '2028-06-30',
        p_manufacturer_date_type => 'minimum_shelf_life',
        p_received_date => date '2026-08-01',
        p_opened_date => date '2026-08-02',
        p_lab_id => v_lab_id,
        p_actor_user_id => v_user_id
    );
    v_inventory_id := (v_created->>'id')::uuid;

    if not exists (
        select 1 from public.inventory i
        where i.id = v_inventory_id
          and i.manufacturer_date_type = 'minimum_shelf_life'
          and i.expiry_date = date '2028-06-30'
          and i.received_date = date '2026-08-01'
          and i.opened_date = date '2026-08-02'
    ) then
        raise exception 'create wrapper did not persist all reagent date fields';
    end if;

    perform public.update_inventory_item_with_dates_atomic(
        v_inventory_id,
        'inventory',
        '{"manufacturer_date_type":"unlabeled"}'::jsonb
    );

    if not exists (
        select 1 from public.inventory i
        where i.id = v_inventory_id
          and i.manufacturer_date_type = 'unlabeled'
          and i.expiry_date is null
          and i.received_date = date '2026-08-01'
          and i.opened_date = date '2026-08-02'
    ) then
        raise exception 'unlabeled transition did not clear only the manufacturer date';
    end if;

    begin
        perform public.update_inventory_item_with_dates_atomic(
            v_inventory_id,
            'inventory',
            '{"manufacturer_date_type":"unsupported"}'::jsonb
        );
    exception when others then
        v_failed := true;
    end;
    if not v_failed then
        raise exception 'invalid manufacturer date type unexpectedly succeeded';
    end if;

    perform public.save_cabinet_state_with_dates(
        v_cabinet_id,
        jsonb_build_array(jsonb_build_object(
            'id', v_shelf_id,
            'level', 0,
            'dividers', '[]'::jsonb,
            'items', jsonb_build_array(jsonb_build_object(
                'id', v_cabinet_item_id,
                'template', 'A',
                'name', 'Expiry reagent',
                'width', 8,
                'position', 10,
                'depth_position', 50,
                'manufacturer_date_type', 'expiry',
                'expiry_date', '2027-01-31',
                'received_date', '2026-08-03',
                'opened_date', '2026-08-04'
            ))
        )),
        5, 9, 2
    );

    if not exists (
        select 1 from public.cabinet_items ci
        where ci.id = v_cabinet_item_id
          and ci.manufacturer_date_type = 'expiry'
          and ci.expiry_date = date '2027-01-31'
          and ci.received_date = date '2026-08-03'
          and ci.opened_date = date '2026-08-04'
    ) then
        raise exception 'cabinet date writer did not persist all reagent date fields';
    end if;

    if not exists (
        select 1 from public.audit_logs a
        where a.entity_id = v_inventory_id
          and a.after_data ? 'manufacturer_date_type'
          and a.after_data ? 'received_date'
          and a.after_data ? 'opened_date'
    ) then
        raise exception 'date tracking fields were not captured by inventory audit data';
    end if;
end;
$$;

rollback;
