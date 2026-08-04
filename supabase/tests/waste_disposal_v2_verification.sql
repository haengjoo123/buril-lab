-- Run after applying 20260801162628_waste_disposal_v2_security_and_schema.sql
-- to a local Supabase database. These assertions are read-only and abort on a
-- missing security invariant.

do $$
declare
    v_definition text;
    v_count integer;
begin
    select lower(pg_get_functiondef(
        'public.delete_inventory_item_atomic(uuid,text,text,uuid,uuid,text,text,text,text)'::regprocedure
    )) into v_definition;

    if position('insert into public.waste_logs' in v_definition) > 0 then
        raise exception 'delete_inventory_item_atomic must not create a physical waste log';
    end if;

    select lower(pg_get_functiondef(
        'public.remove_inventory_record_v2(jsonb,uuid,text,text)'::regprocedure
    )) into v_definition;

    if position('insert into public.waste_logs' in v_definition) > 0 then
        raise exception 'remove_inventory_record_v2 must not create a physical waste log';
    end if;

    if exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'waste_logs'
          and cmd <> 'SELECT'
    ) then
        raise exception 'waste_logs must not expose mutation policies';
    end if;

    if exists (
        select 1
        from information_schema.table_privileges
        where table_schema = 'public'
          and table_name = 'waste_logs'
          and (
              grantee in ('PUBLIC', 'anon')
              or (grantee = 'authenticated' and privilege_type <> 'SELECT')
          )
    ) then
        raise exception 'waste_logs client ACL is broader than authenticated SELECT';
    end if;

    if has_function_privilege(
        'anon',
        'public.record_waste_handling_v2(uuid,jsonb,uuid)',
        'EXECUTE'
    ) then
        raise exception 'anon must not execute record_waste_handling_v2';
    end if;

    if not has_function_privilege(
        'authenticated',
        'public.record_waste_handling_v2(uuid,jsonb,uuid)',
        'EXECUTE'
    ) then
        raise exception 'authenticated must execute record_waste_handling_v2';
    end if;

    select lower(pg_get_functiondef(
        'public.record_waste_handling_v2(uuid,jsonb,uuid)'::regprocedure
    )) into v_definition;

    if position('unsupported batch payload key' in v_definition) = 0 then
        raise exception 'record_waste_handling_v2 must reject unrecognized payload keys';
    end if;

    if position('allowedactions' in v_definition) = 0 then
        raise exception 'record_waste_handling_v2 must validate the selected allowed action';
    end if;

    if position('request_payload_hash' in v_definition) = 0 then
        raise exception 'record_waste_handling_v2 must bind idempotency keys to the batch payload';
    end if;

    select lower(pg_get_functiondef(
        'public.record_inventory_disposal_v2(uuid,jsonb,jsonb,uuid,text)'::regprocedure
    )) into v_definition;

    if position('items must exactly match the inventory-linked batch components' in v_definition) = 0 then
        raise exception 'record_inventory_disposal_v2 must cover every inventory-linked component';
    end if;

    if position('request_id was already used with different inventory targets' in v_definition) = 0 then
        raise exception 'record_inventory_disposal_v2 must reject idempotency-key target drift';
    end if;

    if position('inventorydisposaltargets' in v_definition) = 0 then
        raise exception 'inventory-disposal retry targets must be preserved in a durable snapshot';
    end if;

    if position('quantity_to_remove' in v_definition) = 0
       or position('update_inventory_item_atomic' in v_definition) = 0 then
        raise exception 'inventory disposal must support validated partial quantity decrements';
    end if;

    if position('request_items_hash' in v_definition) = 0 then
        raise exception 'inventory-disposal idempotency must be bound to canonical targets';
    end if;

    select lower(pg_get_functiondef(
        'public.record_inventory_usage_completion_v2(uuid,uuid,text)'::regprocedure
    )) into v_definition;
    if position('v_remaining_quantity := v_previous_quantity - 1' in v_definition) = 0
       or position('inventory_usage_completion_receipts' in v_definition) = 0
       or position('insert into public.waste_logs' in v_definition) > 0 then
        raise exception 'used/empty completion must decrement one, be idempotent, and avoid waste logs';
    end if;

    select lower(pg_get_functiondef(
        'public.move_inventory_records_v2(jsonb,jsonb,uuid)'::regprocedure
    )) into v_definition;
    if position('cabinet placement collides with an existing destination item' in v_definition) = 0
       or position('cabinet placements in the move payload collide' in v_definition) = 0
       or position('atomic move did not produce an exact receipt' in v_definition) = 0
       or position('inventory_move_receipts' in v_definition) = 0
       or position('insert into public.waste_logs' in v_definition) > 0 then
        raise exception 'bulk inventory move lacks collision, receipt, idempotency, or non-waste invariants';
    end if;
    if has_function_privilege(
        'anon', 'public.move_inventory_records_v2(jsonb,jsonb,uuid)', 'EXECUTE'
    ) or not has_function_privilege(
        'authenticated', 'public.move_inventory_records_v2(jsonb,jsonb,uuid)', 'EXECUTE'
    ) then
        raise exception 'bulk inventory move RPC grants are invalid';
    end if;

    select lower(pg_get_functiondef(
        'public.save_safety_center_waste_policy_draft_v2(uuid,text,text,jsonb,jsonb)'::regprocedure
    )) into v_definition;
    if position('safety-center owner or manager permission is required' in v_definition) = 0
       or position('each source reference requires a title; a provided url must use https' in v_definition) = 0
       or position('unsupported policy stream key' in v_definition) = 0
       or position('a hazard flag cannot be both allowed and blocked' in v_definition) = 0 then
        raise exception 'safety-center policy authoring lacks required permission or payload gates';
    end if;

    select lower(pg_get_functiondef(
        'public.get_active_waste_policy_v2(uuid)'::regprocedure
    )) into v_definition;
    if position('ps.is_enabled' in v_definition) = 0
       or position('where rs.is_enabled' in v_definition) = 0
       or position('effective_is_enabled' in v_definition) = 0
       or position('inheritedphysical' in v_definition) = 0
       or position('laboverride' in v_definition) = 0
       or position('waste_management' in v_definition) = 0
       or position('multiple active safety-center waste policies' in v_definition) = 0
       or position('lo.display_name' in v_definition) > 0 then
        raise exception 'policy resolution lacks physical settings, delegated scope, or ambiguity protection';
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'waste_policy_lab_overrides'
          and column_name = 'sop_url'
    ) then
        raise exception 'lab overrides must not own or replace policy SOP URLs';
    end if;
    if to_regprocedure(
        'public.upsert_lab_waste_stream_override_v2(uuid,text,text,text,text,text,text)'
    ) is not null
       or to_regprocedure(
           'public.upsert_lab_waste_stream_override_v2(uuid,text,text,text,text,text)'
       ) is not null
       or to_regprocedure(
           'public.upsert_lab_waste_stream_override_v2(uuid,text,text,text,text,text,text,boolean)'
       ) is null then
        raise exception 'lab override RPC signature does not match physical availability inputs';
    end if;
    select lower(pg_get_functiondef(
        'public.upsert_lab_waste_stream_override_v2(uuid,text,text,text,text,text,text,boolean)'::regprocedure
    )) into v_definition;
    if position('p_sop_url' in v_definition) > 0
       or position('sop_url' in v_definition) > 0 then
        raise exception 'lab override RPC must contain no SOP URL input or persistence path';
    end if;

    select lower(pg_get_functiondef(
        'public.get_active_waste_policy_v2(uuid)'::regprocedure
    )) into v_definition;
    if position('lo.sop_url' in v_definition) > 0
       or position('ps.sop_url' in v_definition) = 0 then
        raise exception 'resolved SOP URL must come only from system/institution policy streams';
    end if;

    select lower(pg_get_functiondef(
        'public.record_waste_handling_v2(uuid,jsonb,uuid)'::regprocedure
    )) into v_definition;
    if position('policy_stream_code' in v_definition) = 0
       or position('special_review' in v_definition) = 0
       or position('v_handling_action = ''container_deposit''' in v_definition) = 0
       or position('decision policyversion is required' in v_definition) = 0
       or position('waste policy changed after analysis' in v_definition) = 0
       or position('waste_management' in v_definition) = 0
       or position('multiple active safety-center waste policies' in v_definition) = 0
       or position('lo.display_name' in v_definition) > 0 then
        raise exception 'waste recorder lacks audit, delegated-policy, ambiguity, or TOCTOU protection';
    end if;

    if position('component hazardflags contains an unsupported value' in v_definition) = 0
       or position(
           '''hydrofluoric_acid'', ''fluoride''' in
           substring(
               v_definition
               from greatest(
                   position('component hazardflags contains an unsupported value' in v_definition) - 900,
                   1
               )
               for 900
           )
       ) = 0 then
        raise exception 'waste recorder component hazard whitelist lacks HF/fluoride flags';
    end if;

    select count(*)
    into v_count
    from public.waste_stream_catalog;

    if v_count <> 10 then
        raise exception 'Expected 10 stable waste stream codes, found %', v_count;
    end if;

    if not exists (
        select 1
        from public.waste_policy_versions
        where policy_key = 'buril_kr_default_2026_03'
          and scope_type = 'system'
          and status = 'active'
          and version_label = 'KR-2026.3'
          and source_refs @> jsonb_build_array(jsonb_build_object(
              'title', '폐기물관리법 시행규칙 별표 5',
              'url', 'https://www.law.go.kr/flDownload.do?bylClsCd=110201&flSeq=162812925&gubun='
          ))
    ) then
        raise exception 'The current immutable Korean default policy source/version is missing or inactive';
    end if;

    select count(*)
    into v_count
    from public.waste_policy_versions
    where scope_type = 'system'
      and status = 'active';
    if v_count <> 1 then
        raise exception 'Exactly one immutable system policy version must be active';
    end if;

    if not exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'waste_logs'
          and indexname = 'waste_logs_user_request_id_uidx'
    ) then
        raise exception 'The waste-log idempotency index is missing';
    end if;
end;
$$;

-- Pure server-rule checks: these do not mutate production data and verify
-- that a client cannot redefine the minimum safety result in its snapshot.
do $$
declare
    v_result jsonb;
    v_definition text;
    v_status text;
    v_case record;
    v_acid_alkali_components jsonb := '[
        {
            "chemicalName": "Hydrochloric acid",
            "ghsDataStatus": "verified",
            "casNumber": "7647-01-0",
            "formula": "HCl",
            "identityConfidence": 1,
            "hazardFlags": ["CORROSIVE"],
            "analysisSnapshot": {
                "category": "ACID",
                "ghs": {"hazardStatements": ["H314"]}
            }
        },
        {
            "chemicalName": "Sodium hydroxide",
            "ghsDataStatus": "verified",
            "casNumber": "1310-73-2",
            "formula": "NaOH",
            "identityConfidence": 1,
            "hazardFlags": ["CORROSIVE"],
            "analysisSnapshot": {
                "category": "ALKALI",
                "ghs": {"hazardStatements": ["H314"]}
            }
        }
    ]'::jsonb;
    v_confirmation jsonb := '{
        "measuredPhStatus": "not_required",
        "additionalComponentsStatus": "none",
        "incidentContext": "none"
    }'::jsonb;
begin
    if not private.is_valid_cas_number('67-64-1')
       or private.is_valid_cas_number('67-64-2')
       or private.is_valid_cas_number('Acetone') then
        raise exception 'CAS syntax/checksum validation is not enforcing the CAS algorithm';
    end if;

    begin
        perform private.analyze_waste_batch_v2(
            jsonb_build_array(jsonb_build_object(
                'chemicalName', 'Acetone',
                'ghsDataStatus', 'verified',
                'casNumber', '67-64-1',
                'identityConfidence', 1,
                'analysisSnapshot', jsonb_build_object('category', 'ORGANIC_NON_HALOGEN')
            )),
            'organic_non_halogenated',
            v_confirmation - 'incidentContext'
        );
        raise exception 'Server analysis accepted a missing incidentContext';
    exception
        when sqlstate '22023' then null;
    end;

    begin
        perform private.analyze_waste_batch_v2(
            jsonb_build_array(jsonb_build_object(
                'chemicalName', 'Acetone',
                'ghsDataStatus', 'verified',
                'casNumber', '67-64-1',
                'identityConfidence', 1,
                'analysisSnapshot', jsonb_build_object('category', 'ORGANIC_NON_HALOGEN')
            )),
            'organic_non_halogenated',
            jsonb_set(v_confirmation, '{incidentContext}', '"spill"'::jsonb)
        );
        raise exception 'Server analysis accepted an unsupported incidentContext';
    exception
        when sqlstate '22023' then null;
    end;

    begin
        perform private.analyze_waste_batch_v2(
            jsonb_build_array(jsonb_build_object(
                'chemicalName', 'Acetone',
                'ghsDataStatus', 'verified',
                'casNumber', '67-64-1',
                'identityConfidence', 1,
                'analysisSnapshot', jsonb_build_object('category', 'ORGANIC_NON_HALOGEN')
            )),
            'organic_non_halogenated',
            jsonb_set(v_confirmation, '{additionalComponentsStatus}', '"maybe"'::jsonb)
        );
        raise exception 'Server analysis accepted an unsupported additionalComponentsStatus';
    exception
        when sqlstate '22023' then null;
    end;

    begin
        perform private.analyze_waste_batch_v2(
            jsonb_build_array(jsonb_build_object(
                'chemicalName', 'Acetone',
                'ghsDataStatus', 'verified',
                'casNumber', '67-64-2',
                'identityConfidence', 1,
                'analysisSnapshot', jsonb_build_object('category', 'ORGANIC_NON_HALOGEN')
            )),
            'organic_non_halogenated',
            v_confirmation
        );
        raise exception 'Server analysis accepted an invalid CAS checksum';
    exception
        when sqlstate '22023' then null;
    end;

    begin
        perform private.analyze_waste_batch_v2(
            jsonb_build_array(jsonb_build_object(
                'chemicalName', 'Acetone',
                'ghsDataStatus', 'verified',
                'casNumber', 'Acetone',
                'identityConfidence', 1,
                'analysisSnapshot', jsonb_build_object('category', 'ORGANIC_NON_HALOGEN')
            )),
            'organic_non_halogenated',
            v_confirmation
        );
        raise exception 'Server analysis accepted a material name in the CAS field';
    exception
        when sqlstate '22023' then null;
    end;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Acetone',
            'ghsDataStatus', 'verified',
            'casNumber', '67-64-1',
            'formula', 'C3H6O',
            'identityConfidence', 1,
            'hazardFlags', jsonb_build_array('FLAMMABLE'),
            'analysisSnapshot', jsonb_build_object(
                'category', 'ORGANIC_NON_HALOGEN',
                'ghs', jsonb_build_object('hazardStatements', jsonb_build_array('H225'))
            )
        )),
        'organic_non_halogenated',
        v_confirmation
    );
    if v_result->>'decisionStatus' <> 'ready'
       or v_result->>'streamCode' <> 'ORGANIC_NON_HALOGENATED'
       or not (v_result->'hazardFlags' @> '["FLAMMABLE"]'::jsonb) then
        raise exception 'Server analysis must allow configured-policy Acetone while retaining FLAMMABLE';
    end if;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Hydrofluoric acid',
            'ghsDataStatus', 'verified',
            'casNumber', '7664-39-3',
            'formula', 'HF',
            'identityConfidence', 1,
            'hazardFlags', jsonb_build_array('HYDROFLUORIC_ACID', 'CORROSIVE', 'ACUTE_TOXIC'),
            'analysisSnapshot', jsonb_build_object(
                'category', 'ACID',
                'ghs', jsonb_build_object(
                    'hazardStatements',
                    jsonb_build_array('H300', 'H310', 'H330', 'H314')
                )
            )
        )),
        'aqueous',
        v_confirmation
    );
    if v_result->>'decisionStatus' <> 'needs_input'
       or v_result->>'streamCode' <> 'SPECIAL_REVIEW'
       or not (v_result->'hazardFlags' @> '["HYDROFLUORIC_ACID"]'::jsonb)
       or not (v_result->'missingFields' @> '["fluoride_container"]'::jsonb) then
        raise exception 'HF must require a compatible-container confirmation in SPECIAL_REVIEW';
    end if;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Hydrofluoric acid',
            'ghsDataStatus', 'verified',
            'casNumber', '7664-39-3',
            'formula', 'HF',
            'identityConfidence', 1,
            'hazardFlags', jsonb_build_array('HYDROFLUORIC_ACID', 'CORROSIVE'),
            'analysisSnapshot', jsonb_build_object('category', 'ACID')
        )),
        'aqueous',
        jsonb_set(v_confirmation, '{fluorideContainerStatus}', '"incompatible"'::jsonb)
    );
    if v_result->>'decisionStatus' <> 'blocked'
       or not (
           v_result->'blockingCodes' @> '["hf_fluoride_incompatible_container"]'::jsonb
       ) then
        raise exception 'HF in an incompatible container must be blocked';
    end if;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Hydrofluoric acid',
            'ghsDataStatus', 'verified',
            'casNumber', '7664-39-3',
            'formula', 'HF',
            'identityConfidence', 1,
            'hazardFlags', jsonb_build_array('HYDROFLUORIC_ACID', 'CORROSIVE'),
            'analysisSnapshot', jsonb_build_object('category', 'ACID')
        )),
        'aqueous',
        jsonb_set(v_confirmation, '{fluorideContainerStatus}', '"compatible"'::jsonb)
    );
    if v_result->>'decisionStatus' <> 'ready'
       or v_result->>'streamCode' <> 'SPECIAL_REVIEW'
       or v_result->'missingFields' @> '["fluoride_container"]'::jsonb then
        raise exception 'Confirmed compatible HF containers must clear only the container gate';
    end if;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Ammonium fluoride',
            'ghsDataStatus', 'verified',
            'casNumber', '12125-01-8',
            'formula', 'NH4F',
            'identityConfidence', 1,
            'analysisSnapshot', jsonb_build_object('category', 'NEUTRAL')
        )),
        'aqueous',
        v_confirmation
    );
    if not (v_result->'hazardFlags' @> '["FLUORIDE"]'::jsonb)
       or not (v_result->'missingFields' @> '["fluoride_container"]'::jsonb) then
        raise exception 'Explicit fluoride compounds must trigger the compatible-container gate';
    end if;

    begin
        perform private.analyze_waste_batch_v2(
            jsonb_build_array(jsonb_build_object(
                'chemicalName', 'Hydrofluoric acid',
                'ghsDataStatus', 'verified',
                'casNumber', '7664-39-3',
                'formula', 'HF',
                'identityConfidence', 1,
                'analysisSnapshot', jsonb_build_object('category', 'ACID')
            )),
            'aqueous',
            jsonb_set(v_confirmation, '{fluorideContainerStatus}', '"plastic"'::jsonb)
        );
        raise exception 'Server analysis accepted an unsupported fluoride container status';
    exception
        when sqlstate '22023' then null;
    end;

    -- The client serializes this optional unanswered question as JSON null for
    -- an ordinary single-component batch. JSON null must behave like omission,
    -- not make an otherwise-ready Acetone batch fail validation.
    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Acetone',
            'ghsDataStatus', 'verified',
            'casNumber', '67-64-1',
            'formula', 'C3H6O',
            'identityConfidence', 1,
            'hazardFlags', jsonb_build_array('FLAMMABLE'),
            'analysisSnapshot', jsonb_build_object(
                'category', 'ORGANIC_NON_HALOGEN',
                'ghs', jsonb_build_object('hazardStatements', jsonb_build_array('H225'))
            )
        )),
        'organic_non_halogenated',
        jsonb_set(v_confirmation, '{additionalComponentsStatus}', 'null'::jsonb)
    );
    if v_result->>'decisionStatus' <> 'ready'
       or v_result->>'streamCode' <> 'ORGANIC_NON_HALOGENATED' then
        raise exception 'JSON-null additionalComponentsStatus broke a ready single-component Acetone batch';
    end if;

    foreach v_status in array array['broken', 'leak']::text[]
    loop
        v_result := private.analyze_waste_batch_v2(
            jsonb_build_array(jsonb_build_object(
                'chemicalName', 'Acetone',
                'ghsDataStatus', 'verified',
                'casNumber', '67-64-1',
                'formula', 'C3H6O',
                'identityConfidence', 1,
                'hazardFlags', jsonb_build_array('FLAMMABLE'),
                'analysisSnapshot', jsonb_build_object('category', 'ORGANIC_NON_HALOGEN')
            )),
            'organic_non_halogenated',
            jsonb_set(v_confirmation, '{incidentContext}', to_jsonb(v_status))
        );
        if v_result->>'decisionStatus' <> 'blocked'
           or v_result->>'streamCode' <> 'SPECIAL_REVIEW'
           or not (
               v_result->'blockingCodes'
                   @> jsonb_build_array('physical_incident_' || v_status)
           )
           or not (
               v_result->'allowedActions' @> '["isolated","handover"]'::jsonb
               and jsonb_array_length(v_result->'allowedActions') = 2
           ) then
            raise exception '% incidents must be blocked with isolation and handover actions only', v_status;
        end if;
    end loop;

    -- `present` declares that the component list is incomplete, regardless of
    -- whether the current matrix alone would otherwise resolve a destination.
    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Acetone',
            'ghsDataStatus', 'verified',
            'casNumber', '67-64-1',
            'formula', 'C3H6O',
            'identityConfidence', 1,
            'hazardFlags', jsonb_build_array('FLAMMABLE'),
            'analysisSnapshot', jsonb_build_object('category', 'ORGANIC_NON_HALOGEN')
        )),
        'organic_non_halogenated',
        jsonb_set(v_confirmation, '{additionalComponentsStatus}', '"present"'::jsonb)
    );
    if v_result->>'decisionStatus' <> 'needs_input'
       or not (v_result->'missingFields' @> '["additional_components"]'::jsonb) then
        raise exception 'Declared-but-unlisted components must require input for every matrix';
    end if;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Water',
            'ghsDataStatus', 'verified',
            'casNumber', '7732-18-5',
            'formula', 'H2O',
            'identityConfidence', 1,
            'analysisSnapshot', jsonb_build_object('category', 'NEUTRAL')
        )),
        'mixed_biphasic',
        v_confirmation
    );
    if v_result->>'decisionStatus' <> 'ready'
       or v_result->'missingFields' @> '["additional_components"]'::jsonb then
        raise exception 'Explicit no-additional-components confirmation must remain usable for a mixed batch';
    end if;

    foreach v_status in array array['present', 'unknown']::text[]
    loop
        v_result := private.analyze_waste_batch_v2(
            jsonb_build_array(jsonb_build_object(
                'chemicalName', 'Water',
                'ghsDataStatus', 'verified',
                'casNumber', '7732-18-5',
                'formula', 'H2O',
                'identityConfidence', 1,
                'analysisSnapshot', jsonb_build_object('category', 'NEUTRAL')
            )),
            'mixed_biphasic',
            jsonb_set(
                v_confirmation,
                '{additionalComponentsStatus}',
                to_jsonb(v_status)
            )
        );
        if v_result->>'decisionStatus' <> 'needs_input'
           or not (v_result->'missingFields' @> '["additional_components"]'::jsonb) then
            raise exception 'Mixed batch status % must require additional component input', v_status;
        end if;
    end loop;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Water',
            'ghsDataStatus', 'verified',
            'casNumber', '7732-18-5',
            'formula', 'H2O',
            'identityConfidence', 1,
            'analysisSnapshot', jsonb_build_object('category', 'NEUTRAL')
        )),
        'mixed_biphasic',
        v_confirmation - 'additionalComponentsStatus'
    );
    if v_result->>'decisionStatus' <> 'needs_input'
       or not (v_result->'missingFields' @> '["additional_components"]'::jsonb) then
        raise exception 'Mixed batch with missing additional component status must need input';
    end if;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Acetone',
            'ghsDataStatus', 'lookup_failed',
            'casNumber', '67-64-1',
            'formula', 'C3H6O',
            'identityConfidence', 1,
            'hazardFlags', jsonb_build_array('FLAMMABLE'),
            'analysisSnapshot', jsonb_build_object(
                'category', 'ORGANIC_NON_HALOGEN',
                'hazardDataConfirmedByUser', false
            )
        )),
        'organic_non_halogenated',
        v_confirmation
    );
    if v_result->>'decisionStatus' <> 'needs_input'
       or not (v_result->'missingFields' @> '["hazard_data"]'::jsonb) then
        raise exception 'lookup_failed without explicit confirmation must require hazard_data';
    end if;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Acetone',
            'ghsDataStatus', 'lookup_failed',
            'casNumber', '67-64-1',
            'formula', 'C3H6O',
            'identityConfidence', 1,
            'hazardFlags', jsonb_build_array('FLAMMABLE'),
            'analysisSnapshot', jsonb_build_object(
                'category', 'ORGANIC_NON_HALOGEN',
                'hazardDataConfirmedByUser', true
            )
        )),
        'organic_non_halogenated',
        v_confirmation
    );
    if v_result->>'decisionStatus' <> 'ready'
       or v_result->'missingFields' @> '["hazard_data"]'::jsonb then
        raise exception 'Explicitly confirmed lookup failure should not force hazard_data input';
    end if;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(
            jsonb_build_object(
                'chemicalName', 'Hydrochloric acid',
                'ghsDataStatus', 'verified',
                'casNumber', '7647-01-0',
                'formula', 'HCl',
                'identityConfidence', 1,
                'hazardFlags', jsonb_build_array('CORROSIVE'),
                'analysisSnapshot', jsonb_build_object(
                    'category', 'ACID',
                    'ghs', jsonb_build_object('hazardStatements', jsonb_build_array('H314'))
                )
            ),
            jsonb_build_object(
                'chemicalName', 'Sodium cyanide',
                'ghsDataStatus', 'verified',
                'casNumber', '143-33-9',
                'formula', 'NaCN',
                'identityConfidence', 1,
                'hazardFlags', jsonb_build_array('ACUTE_TOXIC', 'CYANIDE'),
                'analysisSnapshot', jsonb_build_object(
                    'category', 'CYANIDE',
                    'ghs', jsonb_build_object('hazardStatements', jsonb_build_array('H300'))
                )
            )
        ),
        'aqueous',
        v_confirmation || jsonb_build_object(
            'measuredPhStatus', 'measured',
            'measuredBatchPh', 7
        )
    );
    if v_result->>'decisionStatus' <> 'blocked'
       or v_result->>'streamCode' <> 'CYANIDE_SULFIDE'
       or not (v_result->'blockingCodes' @> '["acid_cyanide"]'::jsonb) then
        raise exception 'Server analysis must block forged-ready acid plus cyanide';
    end if;

    v_result := private.analyze_waste_batch_v2(
        v_acid_alkali_components,
        'aqueous',
        v_confirmation || jsonb_build_object('mixingState', 'unknown')
    );
    if v_result->>'decisionStatus' <> 'needs_input'
       or v_result->>'streamCode' <> 'SPECIAL_REVIEW'
       or not (v_result->'missingFields' @> '["mixing_state"]'::jsonb)
       or v_result->>'routingBasis' <> 'unresolved' then
        raise exception 'Separate acid/base inputs must require an explicit mixing state';
    end if;

    v_result := private.analyze_waste_batch_v2(
        v_acid_alkali_components,
        'aqueous',
        v_confirmation || jsonb_build_object('mixingState', 'separate')
    );
    if v_result->>'decisionStatus' <> 'blocked'
       or v_result->>'streamCode' <> 'SPECIAL_REVIEW'
       or not (v_result->'blockingCodes' @> '["acid_alkali_separate"]'::jsonb) then
        raise exception 'Separate acid/base waste must not be combined or deposited';
    end if;

    v_result := private.analyze_waste_batch_v2(
        v_acid_alkali_components,
        'aqueous',
        v_confirmation || jsonb_build_object(
            'mixingState', 'already_mixed',
            'measuredPhStatus', 'unknown'
        )
    );
    if v_result->>'decisionStatus' <> 'needs_input'
       or v_result->>'streamCode' <> 'SPECIAL_REVIEW'
       or not (v_result->'missingFields' @> '["measured_ph"]'::jsonb) then
        raise exception 'Already-mixed acid/base waste must require a measured final pH';
    end if;

    v_result := private.analyze_waste_batch_v2(
        v_acid_alkali_components,
        'mixed_biphasic',
        v_confirmation || jsonb_build_object('mixingState', 'unknown')
    );
    if v_result->>'decisionStatus' <> 'needs_input'
       or v_result->>'streamCode' <> 'SPECIAL_REVIEW'
       or not (v_result->'missingFields' @> '["mixing_state"]'::jsonb)
       or v_result->>'routingBasis' <> 'unresolved' then
        raise exception 'Every matrix must require acid/base mixing state before routing';
    end if;

    v_result := private.analyze_waste_batch_v2(
        v_acid_alkali_components,
        'mixed_biphasic',
        v_confirmation || jsonb_build_object('mixingState', 'separate')
    );
    if v_result->>'decisionStatus' <> 'blocked'
       or not (v_result->'blockingCodes' @> '["acid_alkali_separate"]'::jsonb) then
        raise exception 'Separate acid/base material must remain blocked in every matrix';
    end if;

    v_result := private.analyze_waste_batch_v2(
        v_acid_alkali_components,
        'mixed_biphasic',
        v_confirmation || jsonb_build_object(
            'mixingState', 'already_mixed',
            'measuredPhStatus', 'measured',
            'measuredBatchPh', 7
        )
    );
    if v_result->>'decisionStatus' <> 'blocked'
       or v_result->>'streamCode' <> 'SPECIAL_REVIEW'
       or not (
           v_result->'blockingCodes' @> '["acid_alkali_non_aqueous_mixed"]'::jsonb
       )
       or v_result->'missingFields' @> '["measured_ph"]'::jsonb
       or v_result->>'legalWastePhClass' <> 'unknown'
       or v_result->>'corrosivityPhScreen' <> 'unknown'
       or v_result->>'routingBasis' <> 'special_rule' then
        raise exception 'Already-mixed non-aqueous acid/base waste must be escalated: %',
            v_result;
    end if;

    v_result := private.analyze_waste_batch_v2(
        v_acid_alkali_components,
        'aqueous',
        v_confirmation || jsonb_build_object(
            'alreadyMixed', true,
            'measuredPhStatus', 'measured',
            'measuredPh', 7
        )
    );
    if v_result->>'decisionStatus' <> 'ready'
       or v_result->>'streamCode' <> 'AQUEOUS_OTHER'
       or v_result->>'routingBasis' <> 'measured_batch_ph' then
        raise exception 'Legacy alreadyMixed/measuredPh records must remain readable';
    end if;

    for v_case in
        select *
        from (values
            (2.00::numeric, 'ACID_AQUEOUS', 'waste_acid', 'review_required'),
            (2.01::numeric, 'AQUEOUS_OTHER', 'none', 'not_indicated'),
            (7.00::numeric, 'AQUEOUS_OTHER', 'none', 'not_indicated'),
            (11.00::numeric, 'AQUEOUS_OTHER', 'none', 'not_indicated'),
            (11.50::numeric, 'AQUEOUS_OTHER', 'none', 'review_required'),
            (12.49::numeric, 'AQUEOUS_OTHER', 'none', 'review_required'),
            (12.50::numeric, 'ALKALI_AQUEOUS', 'waste_alkali', 'review_required')
        ) as cases(measured_ph, expected_stream, expected_legal_class, expected_screen)
    loop
        v_result := private.analyze_waste_batch_v2(
            v_acid_alkali_components,
            'aqueous',
            v_confirmation || jsonb_build_object(
                'mixingState', 'already_mixed',
                'measuredPhStatus', 'measured',
                'measuredBatchPh', v_case.measured_ph
            )
        );
        if v_result->>'decisionStatus' <> 'ready'
           or v_result->>'streamCode' <> v_case.expected_stream
           or v_result->>'legalWastePhClass' <> v_case.expected_legal_class
           or v_result->>'corrosivityPhScreen' <> v_case.expected_screen
           or v_result->>'routingBasis' <> 'measured_batch_ph' then
            raise exception 'Measured pH boundary mismatch for pH %: %',
                v_case.measured_ph,
                v_result;
        end if;
    end loop;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(jsonb_build_object(
            'chemicalName', 'Reference-only acidic sample',
            'ghsDataStatus', 'verified',
            'identityConfidence', 1,
            'hazardFlags', jsonb_build_array(),
            'analysisSnapshot', jsonb_build_object(
                'category', 'NEUTRAL',
                'referencePh', 3,
                'ghs', jsonb_build_object('hazardStatements', jsonb_build_array())
            )
        )),
        'aqueous',
        v_confirmation
    );
    if v_result->>'decisionStatus' <> 'ready'
       or v_result->>'streamCode' <> 'AQUEOUS_OTHER'
       or v_result->>'routingBasis' <> 'matrix' then
        raise exception 'Reference pH alone must not select an acid waste stream';
    end if;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(
            jsonb_build_object(
                'chemicalName', 'Reference-only acidic sample',
                'ghsDataStatus', 'verified',
                'identityConfidence', 1,
                'hazardFlags', jsonb_build_array(),
                'analysisSnapshot', jsonb_build_object(
                    'category', 'NEUTRAL',
                    'referencePh', 3,
                    'ghs', jsonb_build_object('hazardStatements', jsonb_build_array())
                )
            ),
            jsonb_build_object(
                'chemicalName', 'Reference-only alkaline sample',
                'ghsDataStatus', 'verified',
                'identityConfidence', 1,
                'hazardFlags', jsonb_build_array(),
                'analysisSnapshot', jsonb_build_object(
                    'category', 'NEUTRAL',
                    'referencePh', 11,
                    'ghs', jsonb_build_object('hazardStatements', jsonb_build_array())
                )
            )
        ),
        'aqueous',
        v_confirmation || jsonb_build_object('mixingState', 'unknown')
    );
    if v_result->>'decisionStatus' <> 'needs_input'
       or not (v_result->'missingFields' @> '["mixing_state"]'::jsonb) then
        raise exception 'Reference pH may only trigger the conservative pre-mix gate';
    end if;

    v_result := private.analyze_waste_batch_v2(
        jsonb_build_array(
            jsonb_build_object(
                'chemicalName', 'Hydrogen peroxide',
                'ghsDataStatus', 'verified',
                'casNumber', '7722-84-1',
                'formula', 'H2O2',
                'identityConfidence', 1,
                'hazardFlags', jsonb_build_array('OXIDIZER', 'REACTIVE'),
                'analysisSnapshot', jsonb_build_object(
                    'category', 'REACTIVE',
                    'ghs', jsonb_build_object('hazardStatements', jsonb_build_array('H271'))
                )
            ),
            jsonb_build_object(
                'chemicalName', 'Acetone',
                'ghsDataStatus', 'verified',
                'casNumber', '67-64-1',
                'formula', 'C3H6O',
                'identityConfidence', 1,
                'hazardFlags', jsonb_build_array('FLAMMABLE'),
                'analysisSnapshot', jsonb_build_object(
                    'category', 'ORGANIC_NON_HALOGEN',
                    'ghs', jsonb_build_object('hazardStatements', jsonb_build_array('H225'))
                )
            )
        ),
        'organic_non_halogenated',
        v_confirmation
    );
    if v_result->>'decisionStatus' <> 'blocked'
       or v_result->>'streamCode' <> 'REACTIVE_OXIDIZER'
       or not (v_result->'blockingCodes' @> '["oxidizer_flammable"]'::jsonb) then
        raise exception 'Server analysis must block forged-ready oxidizer plus flammable';
    end if;

    select lower(pg_get_functiondef(
        'public.record_waste_handling_v2(uuid,jsonb,uuid)'::regprocedure
    )) into v_definition;
    if position('server-derived stream' in v_definition) = 0
       or position('blocked_hazard_flags' in v_definition) = 0
       or position('allowed_hazard_flags' in v_definition) = 0
       or position('configured container label is required for container_deposit' in v_definition) > 0
       or position('configured container label and location' in v_definition) > 0 then
        raise exception 'record_waste_handling_v2 is missing server stream or policy enforcement';
    end if;

    select lower(pg_get_functiondef(
        'public.get_active_waste_policy_v2(uuid)'::regprocedure
    )) into v_definition;
    if position('pv.scope_type = ''lab''' in v_definition) > 0 then
        raise exception 'Lab safety-rule policies must not override institution/system rules';
    end if;

    select lower(pg_get_functiondef(
        'public.activate_waste_policy_v2(uuid)'::regprocedure
    )) into v_definition;
    if position('lab safety-rule policies cannot be activated' in v_definition) = 0
       or position('only a draft policy version can be activated' in v_definition) = 0
       or position('exactly 10 waste streams' in v_definition) = 0
       or position('between 1 and 20 source references' in v_definition) = 0
       or position('requires prohibitions and label_requirements' in v_definition) = 0
       or position('requires container_label, prohibitions, and label_requirements' in v_definition) > 0
       or position('requires container_label, location, prohibitions, and label_requirements' in v_definition) > 0
       or position('requires handler_contact before activation' in v_definition) = 0 then
        raise exception 'activate_waste_policy_v2 lacks required lifecycle or publish-time completeness gates';
    end if;

    select lower(pg_get_functiondef(
        'public.create_inventory_item_atomic(text,text,text,text,text,integer,text,uuid,uuid,uuid,date,text,integer,uuid,uuid,text)'::regprocedure
    )) into v_definition;
    if position('private.is_valid_cas_number' in v_definition) = 0 then
        raise exception 'create_inventory_item_atomic must validate nonempty CAS values';
    end if;

    select lower(pg_get_functiondef(
        'public.update_inventory_item_atomic(uuid,text,jsonb,text)'::regprocedure
    )) into v_definition;
    if position('private.is_valid_cas_number' in v_definition) = 0 then
        raise exception 'update_inventory_item_atomic must validate nonempty CAS values';
    end if;
end;
$$;
