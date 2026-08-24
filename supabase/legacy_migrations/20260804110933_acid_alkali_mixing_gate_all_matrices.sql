-- Acid/base composition is a pre-routing safety gate for every physical
-- matrix. A measured final pH is meaningful for routing only after the batch
-- is confirmed to be aqueous and already mixed.

do $patch_acid_alkali_all_matrices$
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
    if v_measured_ph_status = 'measured' then
        v_legal_waste_ph_class := case
$fragment$;
    v_replacement_fragment := $replacement$
    if p_matrix = 'aqueous' and v_measured_ph_status = 'measured' then
        v_legal_waste_ph_class := case
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected measured-pH classification fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    if p_matrix = 'aqueous' and v_has_acid and v_has_alkali then
        if v_mixing_state = 'separate' then
            v_blocking_codes := array_append(v_blocking_codes, 'acid_alkali_separate');
        elsif v_mixing_state = 'unknown' then
            v_missing_fields := array_append(v_missing_fields, 'mixing_state');
        elsif v_measured_ph_status <> 'measured' then
            v_missing_fields := array_append(v_missing_fields, 'measured_ph');
        end if;
    end if;
$fragment$;
    v_replacement_fragment := $replacement$
    if v_has_acid and v_has_alkali then
        if v_mixing_state = 'separate' then
            v_blocking_codes := array_append(v_blocking_codes, 'acid_alkali_separate');
        elsif v_mixing_state = 'unknown' then
            v_missing_fields := array_append(v_missing_fields, 'mixing_state');
        elsif p_matrix = 'aqueous' and v_measured_ph_status <> 'measured' then
            v_missing_fields := array_append(v_missing_fields, 'measured_ph');
        elsif p_matrix not in ('aqueous', 'unknown') then
            v_blocking_codes := array_append(
                v_blocking_codes,
                'acid_alkali_non_aqueous_mixed'
            );
        end if;
    end if;
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected aqueous-only acid/base gate was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    elsif v_has_heavy_metal then
        v_server_stream := 'HEAVY_METAL';
    elsif p_matrix = 'organic_halogenated' or v_has_organic_halogen then
$fragment$;
    v_replacement_fragment := $replacement$
    elsif v_has_heavy_metal then
        v_server_stream := 'HEAVY_METAL';
    elsif v_has_acid and v_has_alkali and p_matrix <> 'aqueous' then
        v_server_stream := 'SPECIAL_REVIEW';
    elsif p_matrix = 'organic_halogenated' or v_has_organic_halogen then
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected server stream priority fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
        when p_matrix = 'aqueous' and v_has_acid and v_has_alkali then
            case
                when v_mixing_state = 'already_mixed'
                     and v_measured_ph_status = 'measured'
                    then 'measured_batch_ph'
                else 'unresolved'
            end
        when p_matrix = 'aqueous' and (v_has_acid_identity or v_has_alkali_identity)
$fragment$;
    v_replacement_fragment := $replacement$
        when v_has_acid and v_has_alkali then
            case
                when p_matrix = 'aqueous'
                     and v_mixing_state = 'already_mixed'
                     and v_measured_ph_status = 'measured'
                    then 'measured_batch_ph'
                when p_matrix not in ('aqueous', 'unknown')
                     and v_mixing_state = 'already_mixed'
                    then 'special_rule'
                else 'unresolved'
            end
        when p_matrix = 'aqueous' and (v_has_acid_identity or v_has_alkali_identity)
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected aqueous-only routing-basis fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    execute v_function_definition;
end;
$patch_acid_alkali_all_matrices$;

revoke all on function private.analyze_waste_batch_v2(jsonb, text, jsonb)
    from public, anon, authenticated;
