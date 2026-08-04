-- Separate material acid/base identity, legal pH classification, corrosivity
-- screening, and physical waste-stream routing. Acid/alkali components that
-- are still separate must never be treated as a combined disposable batch;
-- an already-mixed batch requires a directly measured final pH.

do $patch_analyze_aqueous_mixing$
declare
    v_function_definition text;
    v_required_fragment text;
    v_replacement_fragment text;
begin
    select replace(
        pg_get_functiondef(
            'private.analyze_waste_batch_v2(jsonb,text,jsonb)'::regprocedure
        ),
        E'\r\n',
        E'\n'
    ) into v_function_definition;

    v_required_fragment := $fragment$
    v_measured_ph numeric;
    v_component_is_hydrofluoric boolean;
$fragment$;
    v_replacement_fragment := $replacement$
    v_measured_ph numeric;
    v_reference_ph_text text;
    v_reference_ph numeric;
    v_component_has_acid_identity boolean;
    v_component_has_alkali_identity boolean;
    v_has_acid_identity boolean := false;
    v_has_alkali_identity boolean := false;
    v_mixing_state text;
    v_already_mixed_text text;
    v_legal_waste_ph_class text := 'unknown';
    v_corrosivity_ph_screen text := 'unknown';
    v_routing_basis text := 'unresolved';
    v_component_is_hydrofluoric boolean;
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer pH declaration fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    if (p_confirmation ? 'fluorideContainerStatus'
$fragment$;
    v_replacement_fragment := $replacement$
    if (p_confirmation ? 'mixingState'
            and jsonb_typeof(p_confirmation->'mixingState') not in ('string', 'null'))
       or (p_confirmation ? 'mixing_state'
            and jsonb_typeof(p_confirmation->'mixing_state') not in ('string', 'null')) then
        raise exception 'mixingState must be unknown, separate, or already_mixed'
            using errcode = '22023';
    end if;
    if p_confirmation->>'mixingState' is not null
       and p_confirmation->>'mixing_state' is not null
       and p_confirmation->>'mixingState' is distinct from p_confirmation->>'mixing_state' then
        raise exception 'Conflicting mixingState aliases are not allowed'
            using errcode = '22023';
    end if;
    if (p_confirmation ? 'alreadyMixed'
            and jsonb_typeof(p_confirmation->'alreadyMixed') not in ('boolean', 'null'))
       or (p_confirmation ? 'already_mixed'
            and jsonb_typeof(p_confirmation->'already_mixed') not in ('boolean', 'null')) then
        raise exception 'alreadyMixed must be boolean'
            using errcode = '22023';
    end if;
    if p_confirmation->>'alreadyMixed' is not null
       and p_confirmation->>'already_mixed' is not null
       and p_confirmation->>'alreadyMixed' is distinct from p_confirmation->>'already_mixed' then
        raise exception 'Conflicting alreadyMixed aliases are not allowed'
            using errcode = '22023';
    end if;

    v_already_mixed_text := coalesce(
        p_confirmation->>'alreadyMixed',
        p_confirmation->>'already_mixed'
    );
    v_mixing_state := coalesce(
        p_confirmation->>'mixingState',
        p_confirmation->>'mixing_state',
        case v_already_mixed_text
            when 'true' then 'already_mixed'
            when 'false' then 'separate'
            else null
        end,
        'unknown'
    );
    if v_mixing_state not in ('unknown', 'separate', 'already_mixed') then
        raise exception 'mixingState must be unknown, separate, or already_mixed'
            using errcode = '22023';
    end if;
    if v_already_mixed_text is not null
       and v_mixing_state is distinct from (case v_already_mixed_text
            when 'true' then 'already_mixed'
            else 'separate'
       end) then
        raise exception 'mixingState conflicts with legacy alreadyMixed'
            using errcode = '22023';
    end if;

    if (p_confirmation ? 'fluorideContainerStatus'
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer fluoride validation fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := '        v_component_is_acid := v_category = ''ACID''';
    v_replacement_fragment := '        v_component_has_acid_identity := v_category = ''ACID''';
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer acid identity fragment was not found'
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
        v_component_has_alkali_identity := v_category = 'ALKALI'
            or v_cas in ('1310-73-2','1310-58-3','1310-65-2','1305-62-0','1336-21-6','7664-41-7')
            or v_formula_normalized in ('NAOH','KOH','LIOH','CA(OH)2','BA(OH)2','NH3','NH4OH')
            or v_name ~* '(sodium[[:space:]]+hydroxide|potassium[[:space:]]+hydroxide|lithium[[:space:]]+hydroxide|calcium[[:space:]]+hydroxide|barium[[:space:]]+hydroxide|ammonium[[:space:]]+hydroxide|ammonia)';

        if v_analysis->>'referencePh' is not null
           and v_analysis->>'reference_ph' is not null
           and v_analysis->>'referencePh' is distinct from v_analysis->>'reference_ph' then
            raise exception 'Conflicting referencePh aliases are not allowed'
                using errcode = '22023';
        end if;
        v_reference_ph_text := coalesce(
            v_analysis->>'referencePh',
            v_analysis->>'reference_ph'
        );
        v_reference_ph := null;
        if v_reference_ph_text is not null then
            if v_reference_ph_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$' then
                raise exception 'referencePh must be a number between 0 and 14'
                    using errcode = '22023';
            end if;
            v_reference_ph := v_reference_ph_text::numeric;
            if v_reference_ph < 0 or v_reference_ph > 14 then
                raise exception 'referencePh must be a number between 0 and 14'
                    using errcode = '22023';
            end if;
        end if;

        -- A reference pH may conservatively trigger the pre-mix gate, but it
        -- can never select a final waste stream for a single component.
        v_component_is_acid := v_component_has_acid_identity
            or (v_reference_ph is not null and v_reference_ph < 4);
        v_component_is_alkali := v_component_has_alkali_identity
            or (v_reference_ph is not null and v_reference_ph > 10);
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer alkali identity fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
        v_has_acid := v_has_acid or v_component_is_acid;
        v_has_alkali := v_has_alkali or v_component_is_alkali;
$fragment$;
    v_replacement_fragment := $replacement$
        v_has_acid := v_has_acid or v_component_is_acid;
        v_has_alkali := v_has_alkali or v_component_is_alkali;
        v_has_acid_identity := v_has_acid_identity or v_component_has_acid_identity;
        v_has_alkali_identity := v_has_alkali_identity or v_component_has_alkali_identity;
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer acid/alkali accumulator fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    v_measured_ph_text := coalesce(
        p_confirmation->>'measuredPh',
        p_confirmation->>'measured_ph'
    );
$fragment$;
    v_replacement_fragment := $replacement$
    if p_confirmation->>'measuredBatchPh' is not null
       and p_confirmation->>'measured_batch_ph' is not null
       and p_confirmation->>'measuredBatchPh'
           is distinct from p_confirmation->>'measured_batch_ph' then
        raise exception 'Conflicting measuredBatchPh aliases are not allowed'
            using errcode = '22023';
    end if;
    if coalesce(
            p_confirmation->>'measuredBatchPh',
            p_confirmation->>'measured_batch_ph'
       ) is not null
       and coalesce(
            p_confirmation->>'measuredPh',
            p_confirmation->>'measured_ph'
       ) is not null
       and coalesce(
            p_confirmation->>'measuredBatchPh',
            p_confirmation->>'measured_batch_ph'
       ) is distinct from coalesce(
            p_confirmation->>'measuredPh',
            p_confirmation->>'measured_ph'
       ) then
        raise exception 'measuredBatchPh conflicts with legacy measuredPh'
            using errcode = '22023';
    end if;
    v_measured_ph_text := coalesce(
        p_confirmation->>'measuredBatchPh',
        p_confirmation->>'measured_batch_ph',
        p_confirmation->>'measuredPh',
        p_confirmation->>'measured_ph'
    );
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer measured pH fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    -- Broken containers and leaks are incident-response records, not ordinary
$fragment$;
    v_replacement_fragment := $replacement$
    if v_measured_ph_status = 'measured' then
        v_legal_waste_ph_class := case
            when v_measured_ph <= 2 then 'waste_acid'
            when v_measured_ph >= 12.5 then 'waste_alkali'
            else 'none'
        end;
        v_corrosivity_ph_screen := case
            when v_measured_ph <= 2 or v_measured_ph >= 11.5
                then 'review_required'
            else 'not_indicated'
        end;
    end if;

    if p_matrix = 'aqueous' and v_has_acid and v_has_alkali then
        if v_mixing_state = 'separate' then
            v_blocking_codes := array_append(v_blocking_codes, 'acid_alkali_separate');
        elsif v_mixing_state = 'unknown' then
            v_missing_fields := array_append(v_missing_fields, 'mixing_state');
        elsif v_measured_ph_status <> 'measured' then
            v_missing_fields := array_append(v_missing_fields, 'measured_ph');
        end if;
    end if;

    -- Broken containers and leaks are incident-response records, not ordinary
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer stream preamble was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    elsif p_matrix = 'aqueous' then
        if v_has_acid and v_has_alkali and v_measured_ph_status = 'measured' then
            if v_measured_ph < 7 then
                v_server_stream := 'ACID_AQUEOUS';
            elsif v_measured_ph > 7 then
                v_server_stream := 'ALKALI_AQUEOUS';
            else
                v_server_stream := 'AQUEOUS_OTHER';
            end if;
        elsif v_has_acid then
            v_server_stream := 'ACID_AQUEOUS';
        elsif v_has_alkali then
            v_server_stream := 'ALKALI_AQUEOUS';
        else
            v_server_stream := 'AQUEOUS_OTHER';
        end if;
$fragment$;
    v_replacement_fragment := $replacement$
    elsif p_matrix = 'aqueous' then
        if v_has_acid and v_has_alkali then
            if v_mixing_state = 'already_mixed' and v_measured_ph_status = 'measured' then
                if v_measured_ph <= 2 then
                    v_server_stream := 'ACID_AQUEOUS';
                elsif v_measured_ph >= 12.5 then
                    v_server_stream := 'ALKALI_AQUEOUS';
                else
                    v_server_stream := 'AQUEOUS_OTHER';
                end if;
            else
                v_server_stream := 'SPECIAL_REVIEW';
            end if;
        elsif v_has_acid_identity then
            v_server_stream := 'ACID_AQUEOUS';
        elsif v_has_alkali_identity then
            v_server_stream := 'ALKALI_AQUEOUS';
        else
            v_server_stream := 'AQUEOUS_OTHER';
        end if;
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer aqueous stream fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    if p_matrix = 'unknown' then
$fragment$;
    v_replacement_fragment := $replacement$
    v_routing_basis := case
        when v_incident_context in ('broken', 'leak')
          or 'HYDROFLUORIC_ACID' = any(v_server_flags)
          or 'FLUORIDE' = any(v_server_flags)
          or v_has_special or v_has_reactive
          or 'REACTIVE' = any(v_server_flags)
          or 'OXIDIZER' = any(v_server_flags)
          or 'EXPLOSIVE' = any(v_server_flags)
          or 'SELF_REACTIVE' = any(v_server_flags)
          or 'PYROPHORIC' = any(v_server_flags)
          or v_has_cyanide or v_has_sulfide or v_has_heavy_metal
            then 'special_rule'
        when p_matrix = 'aqueous' and v_has_acid and v_has_alkali then
            case
                when v_mixing_state = 'already_mixed'
                     and v_measured_ph_status = 'measured'
                    then 'measured_batch_ph'
                else 'unresolved'
            end
        when p_matrix = 'aqueous' and (v_has_acid_identity or v_has_alkali_identity)
            then 'identity'
        when p_matrix in (
            'aqueous', 'organic_non_halogenated', 'organic_halogenated',
            'solid_slurry'
        ) then 'matrix'
        else 'unresolved'
    end;

    if p_matrix = 'unknown' then
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer missing-field preamble was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    if p_matrix = 'aqueous'
       and v_has_acid
       and v_has_alkali
       and v_measured_ph_status <> 'measured' then
        v_missing_fields := array_append(v_missing_fields, 'measured_ph');
    end if;
$fragment$;
    v_replacement_fragment := $replacement$
    -- Mixing state and measured final pH are handled together before routing.
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer legacy measured-pH gate was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
        'blockingCodes', to_jsonb(v_blocking_codes),
        'missingFields', to_jsonb(v_missing_fields)
$fragment$;
    v_replacement_fragment := $replacement$
        'blockingCodes', to_jsonb(v_blocking_codes),
        'missingFields', to_jsonb(v_missing_fields),
        'legalWastePhClass', v_legal_waste_ph_class,
        'corrosivityPhScreen', v_corrosivity_ph_screen,
        'routingBasis', v_routing_basis
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer return fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    execute v_function_definition;
end;
$patch_analyze_aqueous_mixing$;

do $patch_record_aqueous_mixing$
declare
    v_function_definition text;
    v_required_fragment text;
    v_replacement_fragment text;
begin
    select replace(
        pg_get_functiondef(
            'public.record_waste_handling_v2(uuid,jsonb,uuid)'::regprocedure
        ),
        E'\r\n',
        E'\n'
    ) into v_function_definition;

    v_required_fragment := $fragment$
        'policyVersion', 'policy_version',
        'ruleVersion', 'rule_version'
$fragment$;
    v_replacement_fragment := $replacement$
        'policyVersion', 'policy_version',
        'ruleVersion', 'rule_version',
        'legalWastePhClass', 'legal_waste_ph_class',
        'corrosivityPhScreen', 'corrosivity_ph_screen',
        'routingBasis', 'routing_basis'
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected record decision snapshot whitelist was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
        'measuredPh', 'measured_ph',
        'measuredPhStatus', 'measured_ph_status',
        'additionalComponentsStatus', 'additional_components_status',
        'fluorideContainerStatus', 'fluoride_container_status',
        'incidentContext', 'incident_context',
        'alreadyMixed', 'already_mixed'
$fragment$;
    v_replacement_fragment := $replacement$
        'measuredBatchPh', 'measured_batch_ph',
        'measuredPh', 'measured_ph',
        'measuredPhStatus', 'measured_ph_status',
        'mixingState', 'mixing_state',
        'additionalComponentsStatus', 'additional_components_status',
        'fluorideContainerStatus', 'fluoride_container_status',
        'incidentContext', 'incident_context',
        'alreadyMixed', 'already_mixed'
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
                  'identity', 'hazard_data', 'additional_components',
                  'fluoride_container', 'inventory_quantity',
                  'policy_stream', 'policy_destination'
$fragment$;
    v_replacement_fragment := $replacement$
                  'identity', 'hazard_data', 'additional_components',
                  'mixing_state', 'fluoride_container', 'inventory_quantity',
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

    v_required_fragment := $fragment$
    if v_stream_code is distinct from v_server_stream_code then
        raise exception 'streamCode % does not match server-derived stream %',
            v_stream_code, v_server_stream_code using errcode = '22023';
    end if;
    if v_decision_status = 'ready' then
$fragment$;
    v_replacement_fragment := $replacement$
    if v_stream_code is distinct from v_server_stream_code then
        raise exception 'streamCode % does not match server-derived stream %',
            v_stream_code, v_server_stream_code using errcode = '22023';
    end if;
    if coalesce(
            v_decision_snapshot->>'legalWastePhClass',
            v_decision_snapshot->>'legal_waste_ph_class'
       ) is not null
       and coalesce(
            v_decision_snapshot->>'legalWastePhClass',
            v_decision_snapshot->>'legal_waste_ph_class'
       ) is distinct from v_server_analysis->>'legalWastePhClass' then
        raise exception 'legalWastePhClass does not match server analysis'
            using errcode = '22023';
    end if;
    if coalesce(
            v_decision_snapshot->>'corrosivityPhScreen',
            v_decision_snapshot->>'corrosivity_ph_screen'
       ) is not null
       and coalesce(
            v_decision_snapshot->>'corrosivityPhScreen',
            v_decision_snapshot->>'corrosivity_ph_screen'
       ) is distinct from v_server_analysis->>'corrosivityPhScreen' then
        raise exception 'corrosivityPhScreen does not match server analysis'
            using errcode = '22023';
    end if;
    if coalesce(
            v_decision_snapshot->>'routingBasis',
            v_decision_snapshot->>'routing_basis'
       ) is not null
       and coalesce(
            v_decision_snapshot->>'routingBasis',
            v_decision_snapshot->>'routing_basis'
       ) is distinct from v_server_analysis->>'routingBasis' then
        raise exception 'routingBasis does not match server analysis'
            using errcode = '22023';
    end if;
    if v_decision_status = 'ready' then
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected record server-decision comparison fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    execute v_function_definition;
end;
$patch_record_aqueous_mixing$;

revoke all on function private.analyze_waste_batch_v2(jsonb, text, jsonb)
    from public, anon, authenticated;
