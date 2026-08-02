-- Transactional integration checks for actual physical disposal from a linked
-- cabinet/inventory record. The final rollback leaves the database unchanged.

begin;

do $$
declare
    v_user_id uuid := gen_random_uuid();
    v_lab_id uuid := gen_random_uuid();
    v_cabinet_id uuid := gen_random_uuid();
    v_inventory_id uuid := gen_random_uuid();
    v_cabinet_item_id uuid := gen_random_uuid();
    v_system_policy_id uuid;
    v_first_request_id uuid := gen_random_uuid();
    v_final_request_id uuid := gen_random_uuid();
    v_invalid_concentration_request_id uuid := gen_random_uuid();
    v_batch jsonb;
    v_items jsonb;
    v_result jsonb;
    v_first_log_id uuid;
    v_count integer;
begin
    insert into auth.users (id, email, raw_user_meta_data)
    values (
        v_user_id,
        'inventory-disposal@example.test',
        '{"name":"Authenticated disposal actor"}'::jsonb
    );
    insert into public.labs (id) values (v_lab_id);
    insert into public.lab_members (lab_id, user_id, role, nickname)
    values (v_lab_id, v_user_id, 'student', 'Verified disposal actor');
    insert into public.cabinets (id, lab_id, user_id, name)
    values (v_cabinet_id, v_lab_id, v_user_id, 'Disposal cabinet');
    insert into public.inventory (
        id, lab_id, user_id, name, cas_number, quantity,
        storage_type, cabinet_id, remaining_percent
    ) values (
        v_inventory_id, v_lab_id, v_user_id, 'Acetone', '67-64-1', 2,
        'cabinet', v_cabinet_id, 50
    );
    insert into public.cabinet_items (
        id, inventory_item_id, name, cas_no, cabinet_id, remaining_percent
    ) values (
        v_cabinet_item_id, v_inventory_id, 'Acetone', '67-64-1',
        v_cabinet_id, 50
    );
    insert into public.waste_policy_lab_overrides (
        lab_id, stream_code, container_label, location, created_by, updated_by
    ) values (
        v_lab_id,
        'ORGANIC_NON_HALOGENATED',
        '비할로겐 유기용매 폐액통',
        '폐기물 보관실',
        v_user_id,
        v_user_id
    );

    select id
    into v_system_policy_id
    from public.waste_policy_versions
    where scope_type = 'system' and status = 'active';
    if v_system_policy_id is null then
        raise exception 'active system policy fixture is missing';
    end if;

    v_items := jsonb_build_array(jsonb_build_object(
        'item_id', v_cabinet_item_id,
        'item_source', 'cabinet_item',
        'quantity_to_remove', 1
    ));
    v_batch := jsonb_build_object(
        'components', jsonb_build_array(jsonb_build_object(
            'cartLineId', 'cabinet-acetone-line',
            'sourceType', 'cabinet',
            'sourceRef', v_cabinet_item_id,
            'cabinetItemId', v_cabinet_item_id,
            'chemicalName', 'Acetone',
            'casNumber', '67-64-1',
            'formula', 'C3H6O',
            'identityConfidence', 1,
            'ghsDataStatus', 'verified',
            'concentration', jsonb_build_object('value', 0.5, 'unit', 'M'),
            'hazardFlags', jsonb_build_array('FLAMMABLE'),
            'dataSources', '[]'::jsonb,
            'analysisSnapshot', jsonb_build_object(
                'category', 'ORGANIC_NON_HALOGEN',
                'ghs', jsonb_build_object(
                    'hazardStatements', jsonb_build_array('H225')
                )
            )
        )),
        'handlingAction', 'container_deposit',
        'decisionStatus', 'ready',
        'streamCode', 'ORGANIC_NON_HALOGENATED',
        'matrix', 'organic_non_halogenated',
        'totalAmount', jsonb_build_object(
            'value', 500,
            'unit', 'mL',
            'approximate', true,
            'unknown', false
        ),
        'decision', jsonb_build_object(
            'decisionStatus', 'ready',
            'streamCode', 'ORGANIC_NON_HALOGENATED',
            'hazardFlags', jsonb_build_array('FLAMMABLE'),
            'allowedActions', jsonb_build_array('container_deposit'),
            'blockingReasons', '[]'::jsonb,
            'missingFields', '[]'::jsonb,
            'policyVersion', v_system_policy_id,
            'ruleVersion', 'waste-rules-2.0.0'
        ),
        'confirmationSnapshot', jsonb_build_object(
            'measuredPhStatus', 'not_required',
            'additionalComponentsStatus', 'none',
            'incidentContext', 'none'
        )
    );

    perform set_config('request.jwt.claim.sub', v_user_id::text, true);

    begin
        perform public.record_inventory_disposal_v2(
            v_invalid_concentration_request_id,
            v_items,
            jsonb_set(
                v_batch,
                '{components,0,concentration}',
                jsonb_build_object('value', 0, 'unit', 'M'),
                true
            ),
            v_lab_id,
            null
        );
        raise exception 'physical disposal accepted a zero concentration';
    exception
        when sqlstate '22023' then null;
    end;
    if (select quantity from public.inventory where id = v_inventory_id) <> 2
       or exists (
           select 1
           from public.waste_logs wl
           where wl.request_id = v_invalid_concentration_request_id
       ) then
        raise exception 'invalid concentration left a partial inventory or waste-log change';
    end if;

    -- A linked cabinet placement can represent multiple physical containers.
    -- Disposing one decrements quantity and preserves both rows while writing
    -- exactly one physical waste record.
    v_result := public.record_inventory_disposal_v2(
        v_first_request_id,
        v_items,
        v_batch,
        v_lab_id,
        'Spoofed client actor'
    );
    v_first_log_id := (v_result->>'id')::uuid;
    if v_result->>'record_origin' <> 'inventory_disposal'
       or (v_result->>'removed_count')::integer <> 1
       or (v_result->>'idempotent')::boolean then
        raise exception 'quantity 2 -> 1 disposal returned an invalid atomic receipt';
    end if;
    if (select quantity from public.inventory where id = v_inventory_id) <> 1
       or not exists (
           select 1 from public.cabinet_items where id = v_cabinet_item_id
       ) then
        raise exception 'quantity 2 -> 1 did not preserve synchronized inventory placement';
    end if;
    if not exists (
        select 1
        from public.waste_logs wl
        where wl.id = v_first_log_id
          and wl.record_origin = 'inventory_disposal'
          and wl.handler_name = 'Verified disposal actor'
          and wl.confirmation_snapshot->'inventoryDisposalTargets' @> v_items
    ) then
        raise exception 'physical inventory disposal log lost target or server actor evidence';
    end if;
    if not exists (
        select 1
        from public.waste_log_items wli
        where wli.waste_log_id = v_first_log_id
          and wli.concentration_value = 0.5
          and wli.concentration_unit = 'M'
    ) then
        raise exception 'positive structured concentration was not preserved';
    end if;
    if exists (
        select 1
        from public.audit_logs al
        where al.lab_id = v_lab_id
          and al.actor_name = 'Spoofed client actor'
    ) then
        raise exception 'client actor text was trusted as audit identity';
    end if;

    v_result := public.record_inventory_disposal_v2(
        v_first_request_id,
        v_items,
        v_batch,
        v_lab_id,
        'A different spoofed actor'
    );
    if not (v_result->>'idempotent')::boolean
       or (select quantity from public.inventory where id = v_inventory_id) <> 1 then
        raise exception 'inventory-disposal retry was not idempotent';
    end if;
    select count(*) into v_count
    from public.waste_logs
    where request_id = v_first_request_id;
    if v_count <> 1 then
        raise exception 'inventory-disposal retry wrote duplicate waste records';
    end if;

    begin
        perform public.record_inventory_disposal_v2(
            v_first_request_id,
            jsonb_build_array(jsonb_build_object(
                'item_id', v_inventory_id,
                'item_source', 'inventory',
                'quantity_to_remove', 1
            )),
            v_batch,
            v_lab_id,
            null
        );
        raise exception 'inventory-disposal request_id accepted changed targets';
    exception
        when unique_violation then null;
    end;
    if (select quantity from public.inventory where id = v_inventory_id) <> 1 then
        raise exception 'idempotency target-drift failure changed inventory quantity';
    end if;

    -- Disposing the final represented container removes both linked rows and
    -- writes one additional batch log; historical item references survive via
    -- snapshots and ON DELETE SET NULL.
    v_result := public.record_inventory_disposal_v2(
        v_final_request_id,
        v_items,
        v_batch,
        v_lab_id,
        null
    );
    if v_result->>'record_origin' <> 'inventory_disposal'
       or (v_result->>'removed_count')::integer <> 1
       or (v_result->>'idempotent')::boolean then
        raise exception 'quantity 1 -> removed disposal returned an invalid receipt';
    end if;
    if exists (select 1 from public.inventory where id = v_inventory_id)
       or exists (select 1 from public.cabinet_items where id = v_cabinet_item_id) then
        raise exception 'final physical disposal left inventory or placement rows behind';
    end if;
    select count(*) into v_count
    from public.waste_logs
    where request_id in (v_first_request_id, v_final_request_id)
      and record_origin = 'inventory_disposal';
    if v_count <> 2 then
        raise exception 'two physical disposal actions did not create exactly two batch logs';
    end if;
    select count(*) into v_count
    from public.waste_log_items wli
    where wli.waste_log_id in (
        select wl.id
        from public.waste_logs wl
        where wl.request_id in (v_first_request_id, v_final_request_id)
    );
    if v_count <> 2 then
        raise exception 'physical disposal item snapshots were not preserved';
    end if;
end;
$$;

rollback;
