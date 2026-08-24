-- Transactional integration checks for safety-center waste-policy authoring.
-- The final rollback leaves the database unchanged.

begin;

do $$
declare
    v_owner_id uuid := gen_random_uuid();
    v_viewer_id uuid := gen_random_uuid();
    v_outsider_id uuid := gen_random_uuid();
    v_center_id uuid := gen_random_uuid();
    v_lab_id uuid := gen_random_uuid();
    v_system_policy_id uuid;
    v_first_policy_id uuid;
    v_second_policy_id uuid;
    v_ready_request_id uuid := gen_random_uuid();
    v_blocked_request_id uuid := gen_random_uuid();
    v_incident_request_id uuid := gen_random_uuid();
    v_ready_batch jsonb;
    v_blocked_log_id uuid;
    v_blocked_batch jsonb;
    v_incident_batch jsonb;
    v_incident_stream_snapshot jsonb;
    v_result jsonb;
    v_before_count integer;
    v_after_count integer;
begin
    insert into auth.users (id, email, raw_user_meta_data)
    values
        (v_owner_id, 'policy-owner@example.test', '{"name":"Policy owner"}'::jsonb),
        (v_viewer_id, 'policy-viewer@example.test', '{}'::jsonb),
        (v_outsider_id, 'policy-outsider@example.test', '{}'::jsonb);
    insert into public.safety_centers (
        id, institution_name, institution_domain, center_name,
        status, created_by, approved_by, approved_at
    ) values (
        v_center_id, 'Policy test institution', 'policy.example.test',
        'Policy test center', 'approved', v_owner_id, v_owner_id, now()
    );
    insert into public.safety_center_members (center_id, user_id, role)
    values
        (v_center_id, v_owner_id, 'owner'),
        (v_center_id, v_viewer_id, 'viewer');
    insert into public.labs (id) values (v_lab_id);
    insert into public.lab_members (lab_id, user_id, role, nickname)
    values (v_lab_id, v_owner_id, 'admin', 'Policy lab admin');
    insert into public.safety_center_lab_links (
        center_id, lab_id, status, scope
    ) values (
        v_center_id, v_lab_id, 'approved',
        array['summary', 'risk_detail', 'exports', 'waste_management']::text[]
    );

    select id into v_system_policy_id
    from public.waste_policy_versions
    where scope_type = 'system' and status = 'active';
    if v_system_policy_id is null then
        raise exception 'active system policy fixture is missing';
    end if;

    perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
    v_result := public.save_safety_center_waste_policy_draft_v2(
        v_center_id,
        'CENTER-2026.1',
        'Institution waste policy',
        jsonb_build_array(
            jsonb_build_object(
                'streamCode', 'ORGANIC_NON_HALOGENATED',
                'displayNameKo', '비할로겐 유기용매 폐액',
                'displayNameEn', 'Non-halogenated organic waste',
                'descriptionKo', '기관 전용 비할로겐 폐액 스트림',
                'containerLabel', '비할로겐 폐액통 A',
                'containerColor', '#2563EB',
                'location', '화학관 1층 폐기물 보관실',
                'handlerContact', '내선 1234',
                'sopUrl', 'https://policy.example.test/sop/non-halogenated',
                'allowedHazardFlags', jsonb_build_array('FLAMMABLE'),
                'blockedHazardFlags', jsonb_build_array('OXIDIZER'),
                'prohibitions', jsonb_build_array('산화제를 넣지 마세요'),
                'labelRequirements', jsonb_build_array('성분과 총량을 표시하세요'),
                'isEnabled', true,
                'sortOrder', 30
            ),
            jsonb_build_object(
                'streamCode', 'AQUEOUS_OTHER',
                'isEnabled', false,
                'sortOrder', 90
            ),
            jsonb_build_object(
                'streamCode', 'CYANIDE_SULFIDE',
                'handlerContact', 'Institution emergency extension 119',
                'isEnabled', false,
                'sortOrder', 100
            ),
            jsonb_build_object(
                'streamCode', 'ACID_AQUEOUS',
                'isEnabled', false,
                'sortOrder', 10
            ),
            jsonb_build_object(
                'streamCode', 'ALKALI_AQUEOUS',
                'isEnabled', false,
                'sortOrder', 20
            ),
            jsonb_build_object(
                'streamCode', 'ORGANIC_HALOGENATED',
                'isEnabled', false,
                'sortOrder', 40
            ),
            jsonb_build_object(
                'streamCode', 'HEAVY_METAL',
                'isEnabled', false,
                'sortOrder', 50
            ),
            jsonb_build_object(
                'streamCode', 'REACTIVE_OXIDIZER',
                'handlerContact', 'Institution emergency extension 119',
                'isEnabled', false,
                'sortOrder', 70
            ),
            jsonb_build_object(
                'streamCode', 'SOLID_CONTAMINATED',
                'isEnabled', false,
                'sortOrder', 80
            ),
            jsonb_build_object(
                'streamCode', 'SPECIAL_REVIEW',
                'handlerContact', 'Institution emergency extension 119',
                'isEnabled', false,
                'sortOrder', 100
            )
        ),
        jsonb_build_array(jsonb_build_object(
            'title', '기관 폐액 관리 지침',
            'url', 'https://policy.example.test/waste-guide'
        ), jsonb_build_object(
            'title', 'Institution title-only evidence',
            'url', null
        ))
    );
    v_first_policy_id := (v_result->>'id')::uuid;

    if v_result->>'centerId' <> v_center_id::text
       or v_result->>'versionLabel' <> 'CENTER-2026.1'
       or v_result->>'status' <> 'draft'
       or (v_result->>'streamCount')::integer <> 10
       or (v_result->>'parentPolicyVersionId')::uuid is distinct from v_system_policy_id then
        raise exception 'policy draft returned an invalid receipt';
    end if;
    if not exists (
        select 1
        from public.waste_policy_versions pv
        where pv.id = v_first_policy_id
          and pv.scope_type = 'safety_center'
          and pv.safety_center_id = v_center_id
          and pv.parent_policy_version_id = v_system_policy_id
          and pv.status = 'draft'
          and pv.created_by = v_owner_id
    ) then
        raise exception 'policy draft row did not preserve scope, parent, or actor';
    end if;
    if not exists (
        select 1
        from public.waste_policy_versions pv
        where pv.id = v_first_policy_id
          and pv.source_refs @> '[{"title":"Institution title-only evidence","url":null}]'::jsonb
    ) then
        raise exception 'policy draft rejected or lost a title-only source reference';
    end if;
    if not exists (
        select 1
        from public.waste_policy_streams ps
        where ps.policy_version_id = v_first_policy_id
          and ps.stream_code = 'ORGANIC_NON_HALOGENATED'
          and ps.container_label = '비할로겐 폐액통 A'
          and ps.location = '화학관 1층 폐기물 보관실'
          and ps.allowed_hazard_flags = array['FLAMMABLE']::text[]
          and ps.blocked_hazard_flags = array['OXIDIZER']::text[]
          and ps.is_enabled
    ) then
        raise exception 'policy stream did not preserve the validated camelCase payload';
    end if;
    if not exists (
        select 1
        from public.waste_policy_streams ps
        where ps.policy_version_id = v_first_policy_id
          and ps.stream_code = 'AQUEOUS_OTHER'
          and not ps.is_enabled
    ) then
        raise exception 'policy draft did not preserve an explicit disabled stream winner';
    end if;
    if not exists (
        select 1
        from public.waste_policy_streams ps
        where ps.policy_version_id = v_first_policy_id
          and ps.stream_code = 'CYANIDE_SULFIDE'
          and not ps.is_enabled
    ) then
        raise exception 'policy draft did not preserve the disabled hazardous stream';
    end if;

    begin
        perform public.save_safety_center_waste_policy_draft_v2(
            v_center_id,
            'CENTER-HTTP-REJECT',
            'Reject insecure evidence URL',
            jsonb_build_array(jsonb_build_object(
                'streamCode', 'AQUEOUS_OTHER',
                'isEnabled', true,
                'sortOrder', 90
            )),
            jsonb_build_array(jsonb_build_object(
                'title', 'Insecure evidence',
                'url', 'http://policy.example.test/insecure'
            ))
        );
        raise exception 'policy draft accepted a non-HTTPS source reference';
    exception
        when sqlstate '22023' then null;
    end;

    -- Viewer and outsider roles cannot author or activate institution policy.
    perform set_config('request.jwt.claim.sub', v_viewer_id::text, true);
    begin
        perform public.activate_waste_policy_v2(v_first_policy_id);
        raise exception 'viewer activated a safety-center policy';
    exception
        when insufficient_privilege then null;
    end;
    begin
        perform public.save_safety_center_waste_policy_draft_v2(
            v_center_id,
            'VIEWER-DRAFT',
            'Viewer draft',
            jsonb_build_array(jsonb_build_object(
                'streamCode', 'AQUEOUS_OTHER',
                'isEnabled', true
            )),
            '[]'::jsonb
        );
        raise exception 'viewer authored a safety-center policy';
    exception
        when insufficient_privilege then null;
    end;
    perform set_config('request.jwt.claim.sub', v_outsider_id::text, true);
    begin
        perform public.save_safety_center_waste_policy_draft_v2(
            v_center_id,
            'OUTSIDER-DRAFT',
            'Outsider draft',
            jsonb_build_array(jsonb_build_object(
                'streamCode', 'AQUEOUS_OTHER',
                'isEnabled', true
            )),
            '[]'::jsonb
        );
        raise exception 'outsider authored a safety-center policy';
    exception
        when insufficient_privilege then null;
    end;

    perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
    v_result := public.activate_waste_policy_v2(v_first_policy_id);
    if v_result->>'status' <> 'active'
       or (v_result->>'activatedBy')::uuid is distinct from v_owner_id then
        raise exception 'owner activation returned an invalid receipt';
    end if;
    if not exists (
        select 1 from public.waste_policy_versions
        where id = v_system_policy_id and status = 'active'
    ) then
        raise exception 'institution activation retired the immutable system policy';
    end if;

    begin
        perform public.activate_waste_policy_v2(v_first_policy_id);
        raise exception 'an already-active policy was accepted as an activation draft';
    exception
        when sqlstate '22023' then null;
    end;

    -- Activation revalidates durable rows instead of trusting the draft RPC.
    -- This protects against service-role/manual edits between save and publish.
    declare
        v_bad_policy_id uuid := gen_random_uuid();
    begin
        insert into public.waste_policy_versions (
            id, policy_key, scope_type, safety_center_id,
            parent_policy_version_id, version_label, name, jurisdiction,
            status, source_refs, created_by
        ) values (
            v_bad_policy_id, 'test_missing_sources_' || replace(v_bad_policy_id::text, '-', ''),
            'safety_center', v_center_id, v_first_policy_id,
            'BAD-SOURCES', 'Missing policy evidence', 'KR', 'draft', '[]'::jsonb, v_owner_id
        );
        insert into public.waste_policy_streams (
            policy_version_id, stream_code, display_name_ko, display_name_en,
            description_ko, container_label, container_color, location,
            handler_contact, sop_url, allowed_hazard_flags, blocked_hazard_flags,
            prohibitions, label_requirements, is_enabled, sort_order
        )
        select
            v_bad_policy_id, stream_code, display_name_ko, display_name_en,
            description_ko, container_label, container_color, location,
            handler_contact, sop_url, allowed_hazard_flags, blocked_hazard_flags,
            prohibitions, label_requirements, is_enabled, sort_order
        from public.waste_policy_streams
        where policy_version_id = v_first_policy_id;

        perform public.activate_waste_policy_v2(v_bad_policy_id);
        raise exception 'policy activation accepted zero source references';
    exception
        when sqlstate '22023' then null;
    end;

    declare
        v_bad_policy_id uuid := gen_random_uuid();
    begin
        insert into public.waste_policy_versions (
            id, policy_key, scope_type, safety_center_id,
            parent_policy_version_id, version_label, name, jurisdiction,
            status, source_refs, created_by
        )
        select
            v_bad_policy_id, 'test_incomplete_streams_' || replace(v_bad_policy_id::text, '-', ''),
            'safety_center', v_center_id, v_first_policy_id,
            'BAD-STREAM-COUNT', 'Incomplete stream policy', jurisdiction,
            'draft', source_refs, v_owner_id
        from public.waste_policy_versions
        where id = v_first_policy_id;
        insert into public.waste_policy_streams (
            policy_version_id, stream_code, display_name_ko, display_name_en,
            description_ko, container_label, container_color, location,
            handler_contact, sop_url, allowed_hazard_flags, blocked_hazard_flags,
            prohibitions, label_requirements, is_enabled, sort_order
        )
        select
            v_bad_policy_id, stream_code, display_name_ko, display_name_en,
            description_ko, container_label, container_color, location,
            handler_contact, sop_url, allowed_hazard_flags, blocked_hazard_flags,
            prohibitions, label_requirements, is_enabled, sort_order
        from public.waste_policy_streams
        where policy_version_id = v_first_policy_id
          and stream_code <> 'AQUEOUS_OTHER';

        perform public.activate_waste_policy_v2(v_bad_policy_id);
        raise exception 'policy activation accepted fewer than 10 streams';
    exception
        when sqlstate '22023' then null;
    end;

    -- Lab members can record from the stable category without any local
    -- container metadata. Names and locations are optional operational hints.
    declare
        v_optional_location_policy_id uuid := gen_random_uuid();
    begin
        insert into public.waste_policy_versions (
            id, policy_key, scope_type, safety_center_id,
            parent_policy_version_id, version_label, name, jurisdiction,
            status, source_refs, created_by
        )
        select
            v_optional_location_policy_id, 'test_optional_destination_' || replace(v_optional_location_policy_id::text, '-', ''),
            'safety_center', v_center_id, v_first_policy_id,
            'OPTIONAL-DESTINATION', 'Optional container metadata', jurisdiction,
            'draft', source_refs, v_owner_id
        from public.waste_policy_versions
        where id = v_first_policy_id;
        insert into public.waste_policy_streams (
            policy_version_id, stream_code, display_name_ko, display_name_en,
            description_ko, container_label, container_color, location,
            handler_contact, sop_url, allowed_hazard_flags, blocked_hazard_flags,
            prohibitions, label_requirements, is_enabled, sort_order
        )
        select
            v_optional_location_policy_id, stream_code, display_name_ko, display_name_en,
            description_ko, null, container_color,
            case when stream_code = 'ORGANIC_NON_HALOGENATED' then null else location end,
            handler_contact, sop_url, allowed_hazard_flags, blocked_hazard_flags,
            prohibitions, label_requirements, is_enabled, sort_order
        from public.waste_policy_streams
        where policy_version_id = v_first_policy_id;

        v_result := public.activate_waste_policy_v2(v_optional_location_policy_id);
        if v_result->>'status' <> 'active'
           or not exists (
               select 1
               from public.waste_policy_streams ps
               where ps.policy_version_id = v_optional_location_policy_id
                 and ps.stream_code = 'ORGANIC_NON_HALOGENATED'
                 and ps.container_label is null
                 and ps.location is null
        ) then
            raise exception 'policy activation did not allow an enabled category without local container metadata';
        end if;
        -- Keep the active-policy fixture unchanged for the checks below.
        raise exception 'optional-destination activation verification complete' using errcode = 'P0001';
    exception
        when sqlstate 'P0001' then null;
    end;

    declare
        v_bad_policy_id uuid := gen_random_uuid();
    begin
        insert into public.waste_policy_versions (
            id, policy_key, scope_type, safety_center_id,
            parent_policy_version_id, version_label, name, jurisdiction,
            status, source_refs, created_by
        )
        select
            v_bad_policy_id, 'test_missing_handler_' || replace(v_bad_policy_id::text, '-', ''),
            'safety_center', v_center_id, v_first_policy_id,
            'BAD-HANDLER', 'Missing special handler', jurisdiction,
            'draft', source_refs, v_owner_id
        from public.waste_policy_versions
        where id = v_first_policy_id;
        insert into public.waste_policy_streams (
            policy_version_id, stream_code, display_name_ko, display_name_en,
            description_ko, container_label, container_color, location,
            handler_contact, sop_url, allowed_hazard_flags, blocked_hazard_flags,
            prohibitions, label_requirements, is_enabled, sort_order
        )
        select
            v_bad_policy_id, stream_code, display_name_ko, display_name_en,
            description_ko, container_label, container_color, location,
            case when stream_code = 'CYANIDE_SULFIDE' then null else handler_contact end,
            sop_url, allowed_hazard_flags, blocked_hazard_flags,
            prohibitions, label_requirements, is_enabled, sort_order
        from public.waste_policy_streams
        where policy_version_id = v_first_policy_id;

        perform public.activate_waste_policy_v2(v_bad_policy_id);
        raise exception 'policy activation accepted a special stream without handler_contact';
    exception
        when sqlstate '22023' then null;
    end;

    update public.safety_center_lab_links
    set scope = array['summary', 'risk_detail', 'exports']::text[]
    where center_id = v_center_id and lab_id = v_lab_id;
    v_result := public.get_active_waste_policy_v2(v_lab_id);
    if v_result->>'institutionPolicyVersionId' is not null
       or exists (
           select 1
           from jsonb_array_elements(v_result->'resolvedStreams') stream(value)
           where (stream.value->>'policyVersionId')::uuid = v_first_policy_id
       ) then
        raise exception 'institution policy resolved without explicit waste_management scope';
    end if;

    update public.safety_center_lab_links
    set scope = array['summary', 'risk_detail', 'exports', 'waste_management']::text[]
    where center_id = v_center_id and lab_id = v_lab_id;

    v_result := public.get_active_waste_policy_v2(v_lab_id);
    if (v_result->>'institutionPolicyVersionId')::uuid is distinct from v_first_policy_id
       or exists (
           select 1
           from jsonb_array_elements(v_result->'resolvedStreams') stream(value)
           where stream.value->>'streamCode' = 'AQUEOUS_OTHER'
       ) then
        raise exception 'disabled institution stream incorrectly fell back to the system stream';
    end if;
    if not exists (
        select 1
        from jsonb_array_elements(v_result->'resolvedStreams') stream(value)
        where stream.value->>'streamCode' = 'ORGANIC_NON_HALOGENATED'
          and (stream.value->>'policyVersionId')::uuid = v_first_policy_id
    ) then
        raise exception 'enabled institution stream did not win policy resolution';
    end if;

    -- A lab can change only physical destination details. The governing SOP
    -- URL remains the one in the active institution policy stream.
    v_result := public.upsert_lab_waste_stream_override_v2(
        v_lab_id,
        'ORGANIC_NON_HALOGENATED',
        'Lab organic waste container',
        '#334155',
        'Lab 402 local collection point',
        'Lab safety extension 402'
    );
    if v_result ? 'sopUrl' then
        raise exception 'lab override receipt exposed a lab-owned SOP URL';
    end if;
    -- Legacy/manual rows may still contain deprecated display-name columns.
    -- They are not lab-owned policy fields and must never affect resolution.
    update public.waste_policy_lab_overrides
    set display_name_ko = '현장 임의 표시명',
        display_name_en = 'Spoofed lab policy name'
    where lab_id = v_lab_id
      and stream_code = 'ORGANIC_NON_HALOGENATED';
    v_result := public.get_active_waste_policy_v2(v_lab_id);
    if not exists (
        select 1
        from jsonb_array_elements(v_result->'resolvedStreams') stream(value)
        where stream.value->>'streamCode' = 'ORGANIC_NON_HALOGENATED'
          and stream.value->>'containerLabel' = 'Lab organic waste container'
          and stream.value->>'location' = 'Lab 402 local collection point'
          and stream.value->>'displayNameKo' = '비할로겐 유기용매 폐액'
          and stream.value->>'displayNameEn' = 'Non-halogenated organic waste'
          and stream.value->>'sopUrl' = 'https://policy.example.test/sop/non-halogenated'
          and stream.value->'inheritedPhysical'->>'containerLabel' = '비할로겐 폐액통 A'
          and stream.value->'inheritedPhysical'->>'location' = '화학관 1층 폐기물 보관실'
          and stream.value->'labOverride'->>'containerLabel' = 'Lab organic waste container'
          and stream.value->'labOverride'->>'location' = 'Lab 402 local collection point'
          and (stream.value->'labOverride'->>'isDisabled')::boolean = false
    ) then
        raise exception 'lab physical override lost its raw/inherited split or institution SOP URL';
    end if;

    -- A partial edit persists only the raw lab field. It must continue to
    -- inherit untouched institution values instead of copying and pinning them.
    perform public.upsert_lab_waste_stream_override_v2(
        v_lab_id,
        'ORGANIC_NON_HALOGENATED',
        null,
        null,
        'Lab 403 local collection point',
        null,
        null,
        false
    );
    v_result := public.get_active_waste_policy_v2(v_lab_id);
    if not exists (
        select 1
        from jsonb_array_elements(v_result->'resolvedStreams') stream(value)
        where stream.value->>'streamCode' = 'ORGANIC_NON_HALOGENATED'
          and stream.value->>'containerLabel' = '비할로겐 폐액통 A'
          and stream.value->>'location' = 'Lab 403 local collection point'
          and stream.value->'labOverride'->>'containerLabel' is null
          and stream.value->'labOverride'->>'location' = 'Lab 403 local collection point'
          and stream.value->'inheritedPhysical'->>'containerLabel' = '비할로겐 폐액통 A'
          and stream.value->>'sopUrl' = 'https://policy.example.test/sop/non-halogenated'
    ) then
        raise exception 'partial lab override copied or replaced inherited institution fields';
    end if;
    perform public.upsert_lab_waste_stream_override_v2(
        v_lab_id,
        'ORGANIC_NON_HALOGENATED',
        null,
        null,
        null,
        null,
        null,
        false
    );

    -- A normal single-component batch sends JSON null for the conditional
    -- additional-component question. It must still record successfully.
    v_ready_batch := jsonb_build_object(
        'components', jsonb_build_array(jsonb_build_object(
            'cartLineId', 'ready-acetone-line',
            'sourceType', 'search',
            'chemicalName', 'Acetone',
            'casNumber', '67-64-1',
            'formula', 'C3H6O',
            'identityConfidence', 1,
            'ghsDataStatus', 'verified',
            'hazardFlags', jsonb_build_array('FLAMMABLE'),
            'dataSources', '[]'::jsonb,
            'analysisSnapshot', jsonb_build_object(
                'category', 'ORGANIC_NON_HALOGEN',
                'ghs', jsonb_build_object('hazardStatements', jsonb_build_array('H225'))
            )
        )),
        'handlingAction', 'container_deposit',
        'decisionStatus', 'ready',
        'streamCode', 'ORGANIC_NON_HALOGENATED',
        'matrix', 'organic_non_halogenated',
        'totalAmount', jsonb_build_object(
            'value', 250,
            'unit', 'mL',
            'approximate', false,
            'unknown', false
        ),
        'decision', jsonb_build_object(
            'decisionStatus', 'ready',
            'streamCode', 'ORGANIC_NON_HALOGENATED',
            'hazardFlags', jsonb_build_array('FLAMMABLE'),
            'allowedActions', jsonb_build_array('container_deposit'),
            'blockingReasons', '[]'::jsonb,
            'missingFields', '[]'::jsonb,
            'policyVersion', v_first_policy_id,
            'ruleVersion', 'waste-rules-2.0.0'
        ),
        'confirmationSnapshot', jsonb_build_object(
            'measuredPhStatus', 'not_required',
            'additionalComponentsStatus', null,
            'incidentContext', 'none'
        )
    );
    v_result := public.record_waste_handling_v2(
        v_ready_request_id,
        v_ready_batch,
        v_lab_id
    );
    if v_result->>'decisionStatus' <> 'ready'
       or v_result->>'streamCode' <> 'ORGANIC_NON_HALOGENATED' then
        raise exception 'JSON-null additionalComponentsStatus blocked a normal Acetone record';
    end if;

    begin
        perform public.record_waste_handling_v2(
            gen_random_uuid(),
            jsonb_set(
                v_ready_batch,
                '{decision,policyVersion}',
                to_jsonb(gen_random_uuid()),
                true
            ),
            v_lab_id
        );
        raise exception 'recorder accepted a stale client policyVersion';
    exception
        when sqlstate '40001' then null;
    end;

    begin
        perform public.record_waste_handling_v2(
            gen_random_uuid(),
            v_ready_batch - 'totalAmount',
            v_lab_id
        );
        raise exception 'recorder silently converted a missing totalAmount to unknown';
    exception
        when sqlstate '22023' then null;
    end;
    begin
        perform public.record_waste_handling_v2(
            gen_random_uuid(),
            jsonb_set(v_ready_batch, '{totalAmount}', '{}'::jsonb, true),
            v_lab_id
        );
        raise exception 'recorder accepted an empty totalAmount object';
    exception
        when sqlstate '22023' then null;
    end;
    begin
        perform public.record_waste_handling_v2(
            gen_random_uuid(),
            jsonb_set(
                v_ready_batch,
                '{totalAmount}',
                '{"value":null,"unit":null,"approximate":true,"unknown":true}'::jsonb,
                true
            ),
            v_lab_id
        );
        raise exception 'recorder accepted an amount that is both unknown and approximate';
    exception
        when sqlstate '22023' then null;
    end;

    v_result := public.record_waste_handling_v2(
        gen_random_uuid(),
        jsonb_set(
            v_ready_batch,
            '{totalAmount}',
            '{"value":null,"unit":null,"approximate":false,"unknown":true}'::jsonb,
            true
        ),
        v_lab_id
    );
    if not exists (
        select 1
        from public.waste_logs wl
        where wl.id = (v_result->>'id')::uuid
          and wl.amount_is_unknown
          and not wl.amount_is_approximate
          and wl.total_amount_value is null
          and wl.total_amount_unit is null
          and wl.normalized_amount_value is null
          and wl.normalized_amount_unit is null
    ) then
        raise exception 'explicit unknown amount was not preserved as an unquantified batch';
    end if;

    -- Broken/leaking inventory starts may still be recorded as an actual
    -- isolation/handover, but never as a normal destination deposit.
    v_incident_batch := jsonb_build_object(
        'components', jsonb_build_array(jsonb_build_object(
            'cartLineId', 'leaking-acetone-line',
            'sourceType', 'search',
            'chemicalName', 'Acetone',
            'casNumber', '67-64-1',
            'formula', 'C3H6O',
            'identityConfidence', 1,
            'ghsDataStatus', 'verified',
            'hazardFlags', jsonb_build_array('FLAMMABLE'),
            'dataSources', '[]'::jsonb,
            'analysisSnapshot', jsonb_build_object(
                'category', 'ORGANIC_NON_HALOGEN',
                'ghs', jsonb_build_object(
                    'hazardStatements', jsonb_build_array('H225')
                )
            )
        )),
        'handlingAction', 'isolated',
        'decisionStatus', 'blocked',
        'streamCode', 'SPECIAL_REVIEW',
        'matrix', 'organic_non_halogenated',
        'totalAmount', jsonb_build_object(
            'value', 250,
            'unit', 'mL',
            'approximate', true,
            'unknown', false
        ),
        'decision', jsonb_build_object(
            'decisionStatus', 'blocked',
            'streamCode', 'SPECIAL_REVIEW',
            'hazardFlags', jsonb_build_array('FLAMMABLE'),
            'allowedActions', jsonb_build_array('isolated', 'handover'),
            'blockingReasons', jsonb_build_array(jsonb_build_object(
                'code', 'physical_incident_leak',
                'message', 'Leaking container requires isolation'
            )),
            'missingFields', '[]'::jsonb,
            'policyVersion', v_first_policy_id,
            'ruleVersion', 'waste-rules-2.0.0'
        ),
        'confirmationSnapshot', jsonb_build_object(
            'measuredPhStatus', 'not_required',
            'additionalComponentsStatus', 'none',
            'incidentContext', 'leak'
        )
    );
    v_result := public.record_waste_handling_v2(
        v_incident_request_id,
        v_incident_batch,
        v_lab_id
    );
    v_incident_stream_snapshot := v_result->'streamSnapshot';
    if v_result->>'decisionStatus' <> 'blocked'
       or v_result->>'handlingAction' <> 'isolated'
       or v_result->>'streamCode' <> 'SPECIAL_REVIEW'
       or v_result->'stream_snapshot' is distinct from v_incident_stream_snapshot
       or v_incident_stream_snapshot->>'streamCode' <> 'SPECIAL_REVIEW'
       or v_incident_stream_snapshot is distinct from (
           select wl.stream_snapshot
           from public.waste_logs wl
           where wl.id = (v_result->>'id')::uuid
       ) then
        raise exception 'new incident receipt omitted or altered the stored stream snapshot';
    end if;

    v_result := public.record_waste_handling_v2(
        v_incident_request_id,
        v_incident_batch,
        v_lab_id
    );
    if not (v_result->>'idempotent')::boolean
       or v_result->'stream_snapshot' is distinct from v_incident_stream_snapshot
       or v_result->'streamSnapshot' is distinct from v_incident_stream_snapshot then
        raise exception 'idempotent incident receipt omitted the stored stream snapshot';
    end if;

    v_incident_batch := jsonb_set(
        v_incident_batch,
        '{handlingAction}',
        '"container_deposit"'::jsonb,
        true
    );
    v_incident_batch := jsonb_set(
        v_incident_batch,
        '{decisionStatus}',
        '"ready"'::jsonb,
        true
    );
    v_incident_batch := jsonb_set(
        v_incident_batch,
        '{decision,decisionStatus}',
        '"ready"'::jsonb,
        true
    );
    v_incident_batch := jsonb_set(
        v_incident_batch,
        '{decision,allowedActions}',
        '["container_deposit"]'::jsonb,
        true
    );
    v_incident_batch := jsonb_set(
        v_incident_batch,
        '{decision,blockingReasons}',
        '[]'::jsonb,
        true
    );
    begin
        perform public.record_waste_handling_v2(
            gen_random_uuid(),
            v_incident_batch,
            v_lab_id
        );
        raise exception 'leak incident accepted a normal container deposit';
    exception
        when sqlstate '22023' then null;
    end;

    -- Disabling a hazardous destination blocks normal deposit but must not
    -- block the required isolation/handover audit record.
    v_blocked_batch := jsonb_build_object(
        'components', jsonb_build_array(
            jsonb_build_object(
                'cartLineId', 'acid-line',
                'sourceType', 'search',
                'chemicalName', 'Hydrochloric acid',
                'casNumber', '7647-01-0',
                'formula', 'HCl',
                'identityConfidence', 1,
                'ghsDataStatus', 'verified',
                'hazardFlags', jsonb_build_array('CORROSIVE'),
                'dataSources', '[]'::jsonb,
                'analysisSnapshot', jsonb_build_object(
                    'category', 'ACID',
                    'ghs', jsonb_build_object(
                        'hazardStatements', jsonb_build_array('H314')
                    )
                )
            ),
            jsonb_build_object(
                'cartLineId', 'cyanide-line',
                'sourceType', 'search',
                'chemicalName', 'Sodium cyanide',
                'casNumber', '143-33-9',
                'formula', 'NaCN',
                'identityConfidence', 1,
                'ghsDataStatus', 'verified',
                'hazardFlags', jsonb_build_array('ACUTE_TOXIC', 'CYANIDE'),
                'dataSources', '[]'::jsonb,
                'analysisSnapshot', jsonb_build_object(
                    'category', 'CYANIDE',
                    'ghs', jsonb_build_object(
                        'hazardStatements', jsonb_build_array('H300')
                    )
                )
            )
        ),
        'handlingAction', 'isolated',
        'decisionStatus', 'blocked',
        'streamCode', 'CYANIDE_SULFIDE',
        'matrix', 'aqueous',
        'totalAmount', jsonb_build_object(
            'value', 100,
            'unit', 'mL',
            'approximate', false,
            'unknown', false
        ),
        'decision', jsonb_build_object(
            'decisionStatus', 'blocked',
            'streamCode', 'CYANIDE_SULFIDE',
            'hazardFlags', jsonb_build_array('ACUTE_TOXIC', 'CORROSIVE', 'CYANIDE'),
            'allowedActions', jsonb_build_array('isolated', 'handover'),
            'blockingReasons', jsonb_build_array(jsonb_build_object(
                'code', 'acid_cyanide',
                'message', '산과 시안 혼합 위험'
            )),
            'missingFields', '[]'::jsonb,
            'policyVersion', v_first_policy_id,
            'ruleVersion', 'waste-rules-2.0.0'
        ),
        'confirmationSnapshot', jsonb_build_object(
            'measuredPhStatus', 'not_required',
            'additionalComponentsStatus', 'none',
            'incidentContext', 'none',
            'alreadyMixed', true
        )
    );
    v_result := public.record_waste_handling_v2(
        v_blocked_request_id,
        v_blocked_batch,
        v_lab_id
    );
    v_blocked_log_id := (v_result->>'id')::uuid;
    if v_result->>'decision_status' <> 'blocked'
       or v_result->>'stream_code' <> 'CYANIDE_SULFIDE'
       or v_result->>'handling_action' <> 'isolated'
       or not exists (
           select 1
           from public.waste_logs wl
           where wl.id = v_blocked_log_id
             and wl.policy_version_id = v_first_policy_id
             and wl.stream_code = 'CYANIDE_SULFIDE'
             and wl.handling_action = 'isolated'
       ) then
        raise exception 'disabled hazardous stream prevented or corrupted isolation recording';
    end if;

    begin
        perform public.record_waste_handling_v2(
            gen_random_uuid(),
            jsonb_set(
                jsonb_set(
                    v_blocked_batch,
                    '{handlingAction}',
                    '"container_deposit"'::jsonb,
                    true
                ),
                '{decision,allowedActions}',
                '["container_deposit"]'::jsonb,
                true
            ),
            v_lab_id
        );
        raise exception 'blocked acid-cyanide batch accepted container deposit';
    exception
        when sqlstate '22023' then null;
    end;

    begin
        perform public.record_waste_handling_v2(
            gen_random_uuid(),
            jsonb_build_object(
                'components', jsonb_build_array(jsonb_build_object(
                    'cartLineId', 'disabled-aqueous-stream',
                    'sourceType', 'search',
                    'chemicalName', 'Water',
                    'casNumber', '7732-18-5',
                    'formula', 'H2O',
                    'identityConfidence', 1,
                    'ghsDataStatus', 'verified',
                    'hazardFlags', '[]'::jsonb,
                    'dataSources', '[]'::jsonb,
                    'analysisSnapshot', jsonb_build_object('category', 'AQUEOUS')
                )),
                'handlingAction', 'container_deposit',
                'decisionStatus', 'ready',
                'streamCode', 'AQUEOUS_OTHER',
                'matrix', 'aqueous',
                'totalAmount', jsonb_build_object(
                    'value', 100,
                    'unit', 'mL',
                    'approximate', false,
                    'unknown', false
                ),
                'decision', jsonb_build_object(
                    'decisionStatus', 'ready',
                    'streamCode', 'AQUEOUS_OTHER',
                    'hazardFlags', '[]'::jsonb,
                    'allowedActions', jsonb_build_array('container_deposit'),
                    'blockingReasons', '[]'::jsonb,
                    'missingFields', '[]'::jsonb,
                    'policyVersion', v_first_policy_id,
                    'ruleVersion', 'waste-rules-2.0.0'
                ),
                'confirmationSnapshot', jsonb_build_object(
                    'measuredPhStatus', 'not_required',
                    'additionalComponentsStatus', 'none',
                    'incidentContext', 'none'
                )
            ),
            v_lab_id
        );
        raise exception 'recorder fell back to the system version of a disabled institution stream';
    exception
        when sqlstate '22023' then null;
    end;

    -- A locally unavailable destination remains visible to settings but cannot
    -- be used for a normal deposit until a replacement location is configured.
    perform public.upsert_lab_waste_stream_override_v2(
        v_lab_id,
        'ORGANIC_NON_HALOGENATED',
        null,
        null,
        null,
        null,
        null,
        true
    );
    v_result := public.get_active_waste_policy_v2(v_lab_id);
    if not exists (
        select 1
        from jsonb_array_elements(v_result->'resolvedStreams') stream(value)
        where stream.value->>'streamCode' = 'ORGANIC_NON_HALOGENATED'
          and (stream.value->>'isEnabled')::boolean = false
          and (stream.value->'labOverride'->>'isDisabled')::boolean = true
          and stream.value->'labOverride'->>'replacementLocation' is null
    ) then
        raise exception 'disabled lab destination was hidden or remained enabled';
    end if;
    begin
        perform public.record_waste_handling_v2(
            gen_random_uuid(),
            v_ready_batch,
            v_lab_id
        );
        raise exception 'disabled lab destination accepted a container deposit without replacement';
    exception
        when sqlstate '22023' then null;
    end;

    perform public.upsert_lab_waste_stream_override_v2(
        v_lab_id,
        'ORGANIC_NON_HALOGENATED',
        null,
        null,
        null,
        null,
        'Annex replacement collection point',
        true
    );
    v_result := public.get_active_waste_policy_v2(v_lab_id);
    if not exists (
        select 1
        from jsonb_array_elements(v_result->'resolvedStreams') stream(value)
        where stream.value->>'streamCode' = 'ORGANIC_NON_HALOGENATED'
          and (stream.value->>'isEnabled')::boolean = true
          and stream.value->>'location' = 'Annex replacement collection point'
          and (stream.value->'labOverride'->>'isDisabled')::boolean = true
          and stream.value->'labOverride'->>'replacementLocation' = 'Annex replacement collection point'
    ) then
        raise exception 'replacement location did not reactivate the local destination';
    end if;
    v_result := public.record_waste_handling_v2(
        gen_random_uuid(),
        v_ready_batch,
        v_lab_id
    );
    if v_result->'streamSnapshot'->>'location' <> 'Annex replacement collection point'
       or v_result->'streamSnapshot'->>'displayNameKo' <> '비할로겐 유기용매 폐액'
       or v_result->'streamSnapshot'->>'displayNameEn' <> 'Non-halogenated organic waste' then
        raise exception 'replacement location or institution display name was not preserved in the receipt snapshot';
    end if;
    perform public.upsert_lab_waste_stream_override_v2(
        v_lab_id,
        'ORGANIC_NON_HALOGENATED',
        null,
        null,
        null,
        null,
        null,
        false
    );

    -- Once a center policy is active, subsequent drafts inherit that immutable
    -- version instead of rewriting the system policy or prior center version.
    v_result := public.save_safety_center_waste_policy_draft_v2(
        v_center_id,
        'CENTER-2026.2',
        'Institution waste policy revision',
        jsonb_build_array(jsonb_build_object(
            'streamCode', 'AQUEOUS_OTHER',
            'containerLabel', '기타 수계 폐액통',
            'location', '화학관 1층 폐기물 보관실',
            'allowedHazardFlags', '[]'::jsonb,
            'blockedHazardFlags', '[]'::jsonb,
            'isEnabled', true
        )),
        '[]'::jsonb
    );
    v_second_policy_id := (v_result->>'id')::uuid;
    if (v_result->>'parentPolicyVersionId')::uuid is distinct from v_first_policy_id
       or not exists (
           select 1 from public.waste_policy_versions
           where id = v_first_policy_id and status = 'active'
       ) then
        raise exception 'policy revision did not preserve the active center policy as parent';
    end if;

    select count(*) into v_before_count
    from public.waste_policy_versions
    where safety_center_id = v_center_id;

    begin
        perform public.save_safety_center_waste_policy_draft_v2(
            v_center_id,
            'BAD-HTTP',
            'Invalid source URL',
            jsonb_build_array(jsonb_build_object(
                'streamCode', 'AQUEOUS_OTHER',
                'isEnabled', true
            )),
            jsonb_build_array(jsonb_build_object(
                'title', 'Insecure source',
                'url', 'http://policy.example.test/insecure'
            ))
        );
        raise exception 'policy draft accepted a non-HTTPS source';
    exception
        when sqlstate '22023' then null;
    end;

    begin
        perform public.save_safety_center_waste_policy_draft_v2(
            v_center_id,
            'BAD-OVERLAP',
            'Overlapping hazard flags',
            jsonb_build_array(jsonb_build_object(
                'streamCode', 'AQUEOUS_OTHER',
                'allowedHazardFlags', jsonb_build_array('CORROSIVE'),
                'blockedHazardFlags', jsonb_build_array('CORROSIVE'),
                'isEnabled', true
            )),
            '[]'::jsonb
        );
        raise exception 'policy draft accepted overlapping hazard flags';
    exception
        when sqlstate '22023' then null;
    end;

    begin
        perform public.save_safety_center_waste_policy_draft_v2(
            v_center_id,
            'BAD-KEY',
            'Unsupported payload key',
            jsonb_build_array(jsonb_build_object(
                'stream_code', 'AQUEOUS_OTHER',
                'isEnabled', true
            )),
            '[]'::jsonb
        );
        raise exception 'policy draft accepted an unsupported snake_case key';
    exception
        when sqlstate '22023' then null;
    end;

    -- Two independently approved centers must never be merged by per-stream
    -- priority. The lab must resolve which center owns waste_management first.
    declare
        v_second_center_id uuid := gen_random_uuid();
        v_conflicting_policy_id uuid := gen_random_uuid();
    begin
        insert into public.safety_centers (
            id, institution_name, institution_domain, center_name,
            status, created_by, approved_by, approved_at
        ) values (
            v_second_center_id, 'Conflicting policy institution',
            'conflict-' || replace(v_second_center_id::text, '-', '') || '.example.test',
            'Conflicting policy center', 'approved', v_owner_id, v_owner_id, now()
        );
        insert into public.safety_center_members (center_id, user_id, role)
        values (v_second_center_id, v_owner_id, 'owner');
        insert into public.safety_center_lab_links (center_id, lab_id, status, scope)
        values (
            v_second_center_id, v_lab_id, 'approved',
            array['waste_management']::text[]
        );
        insert into public.waste_policy_versions (
            id, policy_key, scope_type, safety_center_id,
            parent_policy_version_id, version_label, name, jurisdiction,
            status, source_refs, created_by, activated_by, activated_at
        ) values (
            v_conflicting_policy_id,
            'test_conflicting_center_' || replace(v_conflicting_policy_id::text, '-', ''),
            'safety_center', v_second_center_id, v_system_policy_id,
            'CONFLICT-2026.1', 'Conflicting active policy', 'KR', 'active',
            jsonb_build_array(jsonb_build_object('title', 'Conflict fixture evidence')),
            v_owner_id, v_owner_id, now()
        );
        insert into public.waste_policy_streams (
            policy_version_id, stream_code, display_name_ko, display_name_en,
            description_ko, container_label, container_color, location,
            handler_contact, sop_url, allowed_hazard_flags, blocked_hazard_flags,
            prohibitions, label_requirements, is_enabled, sort_order
        )
        select
            v_conflicting_policy_id, stream_code, display_name_ko, display_name_en,
            description_ko, container_label, container_color, location,
            handler_contact, sop_url, allowed_hazard_flags, blocked_hazard_flags,
            prohibitions, label_requirements, is_enabled, sort_order
        from public.waste_policy_streams
        where policy_version_id = v_first_policy_id;

        begin
            perform public.get_active_waste_policy_v2(v_lab_id);
            raise exception 'resolver silently merged two active safety-center policies';
        exception
            when sqlstate 'P0003' then null;
        end;
        begin
            perform public.record_waste_handling_v2(
                gen_random_uuid(),
                v_ready_batch,
                v_lab_id
            );
            raise exception 'recorder accepted an ambiguous safety-center policy authority';
        exception
            when sqlstate 'P0003' then null;
        end;

        update public.safety_center_lab_links
        set status = 'revoked'
        where center_id = v_second_center_id and lab_id = v_lab_id;
    end;

    select count(*) into v_after_count
    from public.waste_policy_versions
    where safety_center_id = v_center_id;
    if v_after_count <> v_before_count
       or v_after_count <> 2
       or not exists (
           select 1 from public.waste_policy_versions
           where id = v_second_policy_id and status = 'draft'
       ) then
        raise exception 'invalid policy payload left a partial policy version behind';
    end if;
end;
$$;

rollback;
