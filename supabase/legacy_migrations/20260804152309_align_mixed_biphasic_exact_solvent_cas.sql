-- Keep mixed/biphasic routing aligned with the client solvent classifier.
-- A broad AI/category label is not sufficient evidence that a component is a
-- solvent: only an identity-confirmed exact CAS from the reviewed allowlists,
-- either on the component or in a verified organic-solvent solution context
-- whose class matches that CAS,
-- may select an organic stream. Otherwise the batch remains in SPECIAL_REVIEW
-- and asks for the unlisted/additional composition even after a prior "none".
-- Once an organic phase is verified, halogenated-organic content conservatively
-- promotes that phase to the halogenated waste stream.

do $patch_mixed_biphasic_exact_solvent_cas$
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
    v_component_is_organic_halogen boolean;
    v_component_is_organic_non_halogen boolean;
    v_has_acid boolean := false;
$fragment$;
    v_replacement_fragment := $replacement$
    v_component_is_organic_halogen boolean;
    v_component_is_organic_non_halogen boolean;
    v_component_has_verified_halogenated_solvent boolean;
    v_component_has_verified_non_halogenated_solvent boolean;
    v_solution_context jsonb;
    v_solution_solvent_cas text;
    v_solution_solvent_class text;
    v_solution_physical_form text;
    v_solution_solvent_verified boolean;
    v_halogenated_solvent_cas constant text[] := array[
        '75-09-2', '67-66-3', '56-23-5', '79-01-6', '127-18-4',
        '107-06-2', '108-90-7'
    ]::text[];
    v_non_halogenated_solvent_cas constant text[] := array[
        '67-68-5', '67-64-1', '64-17-5', '67-56-1', '75-05-8',
        '108-88-3', '110-54-3', '142-82-5', '1330-20-7', '71-43-2',
        '60-29-7', '109-99-9', '68-12-2', '67-63-0', '141-78-6'
    ]::text[];
    v_has_acid boolean := false;
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer component solvent declarations were not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    v_has_organic_halogen boolean := false;
    v_has_organic_non_halogen boolean := false;
    v_has_unknown boolean := false;
$fragment$;
    v_replacement_fragment := $replacement$
    v_has_organic_halogen boolean := false;
    v_has_organic_non_halogen boolean := false;
    v_has_verified_halogenated_solvent boolean := false;
    v_has_verified_non_halogenated_solvent boolean := false;
    v_has_unknown boolean := false;
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer solvent accumulator declarations were not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
        v_identity_text := nullif(coalesce(
            v_component->>'identityConfidence',
            v_component->>'identity_confidence'
        ), '');
$fragment$;
    v_replacement_fragment := $replacement$
        v_component_has_verified_halogenated_solvent := false;
        v_component_has_verified_non_halogenated_solvent := false;
        v_solution_context := v_analysis->'solutionContext';
        if v_solution_context is not null
           and jsonb_typeof(v_solution_context) <> 'object' then
            raise exception 'component solutionContext must be an object'
                using errcode = '22023';
        end if;
        v_solution_solvent_cas := nullif(trim(
            coalesce(v_solution_context->>'solventCasNumber', '')
        ), '');
        v_solution_solvent_class := nullif(trim(
            coalesce(v_solution_context->>'solventClass', '')
        ), '');
        v_solution_physical_form := nullif(trim(
            coalesce(v_solution_context->>'physicalForm', '')
        ), '');
        v_solution_solvent_verified := coalesce(
            case
                when jsonb_typeof(v_solution_context->'isSolventVerified') = 'boolean'
                    then (v_solution_context->>'isSolventVerified')::boolean
                else false
            end,
            false
        );
        v_identity_text := nullif(coalesce(
            v_component->>'identityConfidence',
            v_component->>'identity_confidence'
        ), '');
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer identity preamble was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
            v_identity_confidence := v_identity_text::numeric;
            if v_identity_confidence < 1 then
                v_identity_needs_input := true;
            end if;
        end if;

        v_has_acid := v_has_acid or v_component_is_acid;
$fragment$;
    v_replacement_fragment := $replacement$
            v_identity_confidence := v_identity_text::numeric;
            if v_identity_confidence < 1 then
                v_identity_needs_input := true;
            else
                -- The component identity CAS is direct evidence. A serialized
                -- solution context is accepted only when its verified boolean,
                -- organic-solvent physical form, solvent class, and exact
                -- allowlisted CAS agree. This prevents a client-controlled
                -- class label from becoming routing proof.
                v_component_has_verified_halogenated_solvent :=
                    coalesce(v_cas = any(v_halogenated_solvent_cas), false)
                    or coalesce((
                        v_solution_solvent_verified
                        and v_solution_physical_form = 'organic_solvent'
                        and v_solution_solvent_class = 'organic_halogen'
                        and coalesce(
                            v_solution_solvent_cas = any(v_halogenated_solvent_cas),
                            false
                        )
                    ), false);
                v_component_has_verified_non_halogenated_solvent :=
                    coalesce(v_cas = any(v_non_halogenated_solvent_cas), false)
                    or coalesce((
                        v_solution_solvent_verified
                        and v_solution_physical_form = 'organic_solvent'
                        and v_solution_solvent_class = 'organic_non_halogen'
                        and coalesce(
                            v_solution_solvent_cas = any(v_non_halogenated_solvent_cas),
                            false
                        )
                    ), false);
            end if;
        end if;

        v_has_acid := v_has_acid or v_component_is_acid;
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer identity confidence fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
        v_has_organic_halogen := v_has_organic_halogen or v_component_is_organic_halogen;
        v_has_organic_non_halogen := v_has_organic_non_halogen or v_component_is_organic_non_halogen;
    end loop;
$fragment$;
    v_replacement_fragment := $replacement$
        v_has_organic_halogen := v_has_organic_halogen or v_component_is_organic_halogen;
        v_has_organic_non_halogen := v_has_organic_non_halogen or v_component_is_organic_non_halogen;
        v_has_verified_halogenated_solvent :=
            coalesce(v_has_verified_halogenated_solvent, false)
            or coalesce(v_component_has_verified_halogenated_solvent, false);
        v_has_verified_non_halogenated_solvent :=
            coalesce(v_has_verified_non_halogenated_solvent, false)
            or coalesce(v_component_has_verified_non_halogenated_solvent, false);
    end loop;
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer solvent accumulator fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    elsif p_matrix = 'organic_halogenated' or v_has_organic_halogen then
        v_server_stream := 'ORGANIC_HALOGENATED';
$fragment$;
    v_replacement_fragment := $replacement$
    elsif p_matrix = 'organic_halogenated'
       or (p_matrix <> 'mixed_biphasic' and v_has_organic_halogen) then
        v_server_stream := 'ORGANIC_HALOGENATED';
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer halogenated stream fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    elsif p_matrix = 'mixed_biphasic' then
        if v_has_organic_non_halogen then
            v_server_stream := 'ORGANIC_NON_HALOGENATED';
        else
            v_server_stream := 'SPECIAL_REVIEW';
        end if;
$fragment$;
    v_replacement_fragment := $replacement$
    elsif p_matrix = 'mixed_biphasic' then
        -- A generic halogenated-organic classification is content evidence,
        -- not phase evidence. It may promote a verified organic phase to the
        -- halogenated stream, but cannot establish that phase by itself.
        if not coalesce(v_has_verified_halogenated_solvent, false)
           and not coalesce(v_has_verified_non_halogenated_solvent, false) then
            v_server_stream := 'SPECIAL_REVIEW';
        elsif coalesce(v_has_verified_halogenated_solvent, false)
              or coalesce(v_has_organic_halogen, false) then
            v_server_stream := 'ORGANIC_HALOGENATED';
        elsif coalesce(v_has_verified_non_halogenated_solvent, false) then
            v_server_stream := 'ORGANIC_NON_HALOGENATED';
        else
            v_server_stream := 'SPECIAL_REVIEW';
        end if;
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer mixed-biphasic stream fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
        when p_matrix in (
            'aqueous', 'organic_non_halogenated', 'organic_halogenated',
            'solid_slurry'
        ) then 'matrix'
        else 'unresolved'
$fragment$;
    v_replacement_fragment := $replacement$
        when p_matrix in (
            'aqueous', 'organic_non_halogenated', 'organic_halogenated',
            'solid_slurry'
        ) then 'matrix'
        when p_matrix = 'mixed_biphasic'
             and (
                 coalesce(v_has_verified_halogenated_solvent, false)
                 or coalesce(v_has_verified_non_halogenated_solvent, false)
             ) then 'matrix'
        else 'unresolved'
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer matrix routing-basis fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    v_required_fragment := $fragment$
    if v_additional_components_status = 'present'
       or (
           p_matrix = 'mixed_biphasic'
           and not v_has_organic_halogen
           and not v_has_organic_non_halogen
           and (
               v_additional_components_status is null
               or v_additional_components_status = 'unknown'
           )
       ) then
        v_missing_fields := array_append(v_missing_fields, 'additional_components');
    end if;
$fragment$;
    v_replacement_fragment := $replacement$
    if v_additional_components_status = 'present'
       or (
           p_matrix = 'mixed_biphasic'
           and not coalesce(v_has_verified_halogenated_solvent, false)
           and not coalesce(v_has_verified_non_halogenated_solvent, false)
       ) then
        v_missing_fields := array_append(v_missing_fields, 'additional_components');
    end if;
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected analyzer additional-components fragment was not found'
            using errcode = '55000';
    end if;
    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    execute v_function_definition;
end;
$patch_mixed_biphasic_exact_solvent_cas$;

revoke all on function private.analyze_waste_batch_v2(jsonb, text, jsonb)
    from public, anon, authenticated;
