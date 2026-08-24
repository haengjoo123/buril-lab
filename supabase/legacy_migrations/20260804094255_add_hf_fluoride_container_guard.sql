-- Add explicit HF/fluoride hazards to Waste Disposal V2 and make an
-- institution-approved compatible container a server-enforced prerequisite
-- for ordinary container deposit. The existing V2 functions are patched from
-- their deployed definitions so later narrow hardening migrations remain
-- intact.

do $patch_analyze_hf_fluoride$
declare
    v_function_definition text;
    v_required_fragment text;
    v_replacement_fragment text;
begin
    select pg_get_functiondef(
        'private.analyze_waste_batch_v2(jsonb,text,jsonb)'::regprocedure
    ) into v_function_definition;
    v_function_definition := replace(v_function_definition, E'\r\n', E'\n');

    v_required_fragment := $fragment$
    v_additional_components_status text;
    v_incident_context text;
begin
$fragment$;
    v_replacement_fragment := $replacement$
    v_component_is_hydrofluoric boolean;
    v_component_is_fluoride boolean;
    v_additional_components_status text;
    v_fluoride_container_status text;
    v_incident_context text;
begin
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer declaration fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    for v_component in select value from jsonb_array_elements(p_components)
$fragment$;
    v_replacement_fragment := $replacement$
    if (p_confirmation ? 'fluorideContainerStatus'
            and jsonb_typeof(p_confirmation->'fluorideContainerStatus') not in ('string', 'null'))
       or (p_confirmation ? 'fluoride_container_status'
            and jsonb_typeof(p_confirmation->'fluoride_container_status') not in ('string', 'null')) then
        raise exception 'fluorideContainerStatus must be compatible, incompatible, or unknown'
            using errcode = '22023';
    end if;
    if p_confirmation->>'fluorideContainerStatus' is not null
       and p_confirmation->>'fluoride_container_status' is not null
       and p_confirmation->>'fluorideContainerStatus'
           is distinct from p_confirmation->>'fluoride_container_status' then
        raise exception 'Conflicting fluorideContainerStatus aliases are not allowed'
            using errcode = '22023';
    end if;
    v_fluoride_container_status := coalesce(
        p_confirmation->>'fluorideContainerStatus',
        p_confirmation->>'fluoride_container_status'
    );
    if v_fluoride_container_status is not null
       and v_fluoride_container_status not in ('compatible', 'incompatible', 'unknown') then
        raise exception 'fluorideContainerStatus must be compatible, incompatible, or unknown'
            using errcode = '22023';
    end if;

    for v_component in select value from jsonb_array_elements(p_components)
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer component-loop fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
                'HEAVY_METAL', 'REACTIVE', 'UNKNOWN_COMPONENT'
$fragment$;
    v_replacement_fragment := $replacement$
                'HEAVY_METAL', 'HYDROFLUORIC_ACID', 'FLUORIDE',
                'REACTIVE', 'UNKNOWN_COMPONENT'
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer hazard whitelist was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
        v_component_is_alkali := v_category = 'ALKALI';
$fragment$;
    v_replacement_fragment := $replacement$
        v_component_is_hydrofluoric := v_cas = '7664-39-3'
            or v_formula_normalized = 'HF'
            or v_name ~* '(hydrofluoric[[:space:]]+acid|hydrogen[[:space:]]+fluoride|fluorhydric[[:space:]]+acid|불산|불화[[:space:]]*수소|플루오린화[[:space:]]*수소)';
        v_component_is_fluoride := not v_component_is_hydrofluoric
            and (
                v_cas in (
                    '7681-49-4','7789-23-3','12125-01-8','1341-49-7','7789-24-4',
                    '7789-75-5','7783-40-6','7784-18-1','1333-83-1','7789-29-9'
                )
                or v_formula_normalized in (
                    'NAF','KF','NH4F','NH4HF2','LIF','CAF2','MGF2','ALF3',
                    'NAHF2','KHF2','CSF','RBF','BAF2','ZNF2'
                )
                or v_name ~* '((^|[^[:alnum:]])(bi)?fluoride([^[:alnum:]]|$)|hydrogen[[:space:]]+difluoride|불화물|불화암모늄|불화나트륨|불화칼륨)'
            );

        if v_component_is_hydrofluoric then
            v_server_flags := array_append(v_server_flags, 'HYDROFLUORIC_ACID');
        elsif v_component_is_fluoride then
            v_server_flags := array_append(v_server_flags, 'FLUORIDE');
        end if;

        v_component_is_alkali := v_category = 'ALKALI';
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer identity-classification fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
                and not v_component_is_sulfide
            );
$fragment$;
    v_replacement_fragment := $replacement$
                and not v_component_is_sulfide
                and not v_component_is_hydrofluoric
                and not v_component_is_fluoride
            );
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer special-hazard fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    if v_has_acid and v_has_cyanide then
$fragment$;
    v_replacement_fragment := $replacement$
    if 'HYDROFLUORIC_ACID' = any(v_server_flags)
       or 'FLUORIDE' = any(v_server_flags) then
        if v_fluoride_container_status = 'incompatible' then
            v_blocking_codes := array_append(
                v_blocking_codes,
                'hf_fluoride_incompatible_container'
            );
        elsif v_fluoride_container_status is distinct from 'compatible' then
            v_missing_fields := array_append(v_missing_fields, 'fluoride_container');
        end if;
    end if;

    if v_has_acid and v_has_cyanide then
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer blocking-rule fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    if v_incident_context in ('broken', 'leak') then
        v_server_stream := 'SPECIAL_REVIEW';
    elsif v_has_special then
$fragment$;
    v_replacement_fragment := $replacement$
    if v_incident_context in ('broken', 'leak') then
        v_server_stream := 'SPECIAL_REVIEW';
    elsif 'HYDROFLUORIC_ACID' = any(v_server_flags)
       or 'FLUORIDE' = any(v_server_flags) then
        v_server_stream := 'SPECIAL_REVIEW';
    elsif v_has_special then
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer stream-selection fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    execute v_function_definition;
end;
$patch_analyze_hf_fluoride$;

do $patch_record_hf_fluoride$
declare
    v_function_definition text;
    v_required_fragment text;
    v_replacement_fragment text;
begin
    select pg_get_functiondef(
        'public.record_waste_handling_v2(uuid,jsonb,uuid)'::regprocedure
    ) into v_function_definition;
    v_function_definition := replace(v_function_definition, E'\r\n', E'\n');

    v_required_fragment := $fragment$
        'additionalComponentsStatus', 'additional_components_status',
        'incidentContext', 'incident_context',
$fragment$;
    v_replacement_fragment := $replacement$
        'additionalComponentsStatus', 'additional_components_status',
        'fluorideContainerStatus', 'fluoride_container_status',
        'incidentContext', 'incident_context',
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected record confirmation whitelist was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
                  'HEAVY_METAL', 'REACTIVE', 'UNKNOWN_COMPONENT'
$fragment$;
    v_replacement_fragment := $replacement$
                  'HEAVY_METAL', 'HYDROFLUORIC_ACID', 'FLUORIDE',
                  'REACTIVE', 'UNKNOWN_COMPONENT'
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected record hazard whitelist was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
                  'identity', 'hazard_data', 'additional_components',
                  'inventory_quantity', 'policy_stream', 'policy_destination'
$fragment$;
    v_replacement_fragment := $replacement$
                  'identity', 'hazard_data', 'additional_components',
                  'fluoride_container', 'inventory_quantity',
                  'policy_stream', 'policy_destination'
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected record missing-field whitelist was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    execute v_function_definition;
end;
$patch_record_hf_fluoride$;

do $patch_policy_hf_fluoride$
declare
    v_function_definition text;
    v_required_fragment text;
    v_replacement_fragment text;
begin
    select pg_get_functiondef(
        'public.save_safety_center_waste_policy_draft_v2(uuid,text,text,jsonb,jsonb)'::regprocedure
    ) into v_function_definition;
    v_function_definition := replace(v_function_definition, E'\r\n', E'\n');

    v_required_fragment := $fragment$
                      'HEAVY_METAL', 'REACTIVE', 'UNKNOWN_COMPONENT'
$fragment$;
    v_replacement_fragment := $replacement$
                      'HEAVY_METAL', 'HYDROFLUORIC_ACID', 'FLUORIDE',
                      'REACTIVE', 'UNKNOWN_COMPONENT'
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected policy hazard whitelist was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    execute v_function_definition;
end;
$patch_policy_hf_fluoride$;

-- CREATE OR REPLACE preserves the existing RPC grants, but restate the private
-- analyzer boundary explicitly so a future default-privilege change cannot
-- expose it through the API.
revoke all on function private.analyze_waste_batch_v2(jsonb, text, jsonb)
    from public, anon, authenticated;
