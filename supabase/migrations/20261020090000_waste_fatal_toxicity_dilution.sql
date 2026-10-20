-- Concentration-aware fatal acute-toxicity hold (waste rule 2.7.0).
--
-- A component with H300/H310/H330 is held for special review. A prepared
-- solution of a vetted substance whose concentration is known and below the
-- lowest threshold of its hazardous classes under the Chemicals Control Act
-- (KECO chemSbstnList, read 2026-10-20) is no longer held for that reason and
-- is routed by the ordinary rules. A neat product, a solid, an unknown or
-- unconvertible concentration, and a substance without a vetted limit stay
-- held. The limits mirror src/utils/fatalToxicityDilutionLimits.ts; a unit test
-- keeps the two tables equal.
--
-- The client payload is unchanged: the concentration, materialForm and the %
-- basis (analysisSnapshot.phPredictionInput.concentrationBasis) are already
-- sent, so the pH-prediction fingerprint of existing batches does not move.
-- analyze_waste_batch_v2 is redefined only to call the helper; the rest of its
-- body is byte-identical to the production baseline.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function private.waste_fatal_toxicity_diluted_below_limit_v1(
    p_component jsonb,
    p_analysis jsonb,
    p_cas text
) returns boolean
    language plpgsql immutable
    set search_path to 'pg_catalog'
    as $$
declare
    v_limit numeric;
    v_molecular_weight numeric;
    v_worst_case_density numeric;
    v_concentration jsonb;
    v_value numeric;
    v_unit text;
    v_basis text;
    v_percent numeric;
begin
    -- cas, lowest legal threshold (w/w %), molecular weight, worst-case density (g/mL)
    select limits.percent, limits.molecular_weight, limits.worst_case_density
    into v_limit, v_molecular_weight, v_worst_case_density
    from (values
        ('7664-93-9', 10::numeric, 98.079::numeric, 1.84::numeric),
        ('50-00-0', 0.1::numeric, 30.026::numeric, 1.09::numeric),
        ('111-30-8', 1::numeric, 100.117::numeric, 1.13::numeric),
        ('60-24-2', 1::numeric, 78.13::numeric, 1.114::numeric)
    ) as limits(cas, percent, molecular_weight, worst_case_density)
    where limits.cas = p_cas;
    if not found then
        return false;
    end if;

    -- Undefined is a prepared solution; neat products and solids are judged as supplied.
    if coalesce(p_analysis->>'materialForm', 'solution') <> 'solution' then
        return false;
    end if;

    v_concentration := p_component->'concentration';
    if v_concentration is null
       or jsonb_typeof(v_concentration) <> 'object'
       or jsonb_typeof(v_concentration->'value') <> 'number' then
        return false;
    end if;
    v_value := (v_concentration->>'value')::numeric;
    v_unit := v_concentration->>'unit';
    if v_value <= 0 then
        return false;
    end if;

    v_basis := p_analysis->'phPredictionInput'->>'concentrationBasis';
    v_percent := case v_unit
        -- A volume or unspecified % is counted as the dense liquid measured out.
        when '%' then case
            when v_basis in ('w_w', 'w_v') then v_value
            else v_value * greatest(1, v_worst_case_density)
        end
        when 'mg/mL' then v_value / 10
        when 'M' then v_value * v_molecular_weight / 10
        when 'mM' then v_value / 1000 * v_molecular_weight / 10
        else null
    end;

    -- Published rules read "N% 이상", so the limit itself is held.
    return v_percent is not null and v_percent <= 100 and v_percent < v_limit;
end;
$$;

revoke all on function private.waste_fatal_toxicity_diluted_below_limit_v1(jsonb, jsonb, text) from public;
grant execute on function private.waste_fatal_toxicity_diluted_below_limit_v1(jsonb, jsonb, text) to service_role;

create or replace function private.analyze_waste_batch_v2(p_components jsonb, p_matrix text, p_confirmation jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $_$
declare
    v_component jsonb;
    v_analysis jsonb;
    v_ghs jsonb;
    v_claimed_flags jsonb;
    v_claimed_flag text;
    v_hcode text;
    v_hcodes text[];
    v_category text;
    v_name text;
    v_cas text;
    v_formula text;
    v_formula_normalized text;
    v_identity_text text;
    v_identity_confidence numeric;
    v_ghs_data_status text;
    v_hazard_data_confirmed boolean;
    v_hazard_data_needs_input boolean := false;
    v_component_is_acid boolean;
    v_component_is_alkali boolean;
    v_component_is_cyanide boolean;
    v_component_is_sulfide boolean;
    v_component_is_reactive boolean;
    v_component_is_special boolean;
    v_component_is_heavy_metal boolean;
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
    v_has_alkali boolean := false;
    v_has_cyanide boolean := false;
    v_has_sulfide boolean := false;
    v_has_reactive boolean := false;
    v_has_special boolean := false;
    v_has_heavy_metal boolean := false;
    v_has_organic_halogen boolean := false;
    v_has_organic_non_halogen boolean := false;
    v_has_verified_halogenated_solvent boolean := false;
    v_has_verified_non_halogenated_solvent boolean := false;
    v_has_unknown boolean := false;
    v_identity_needs_input boolean := false;
    v_server_flags text[] := array[]::text[];
    v_blocking_codes text[] := array[]::text[];
    v_missing_fields text[] := array[]::text[];
    v_server_stream text;
    v_server_status text;
    v_measured_ph_status text;
    v_measured_ph_text text;
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
    v_approved_predicted_ph jsonb;
    v_predicted_batch_ph numeric;
    v_has_approved_predicted_ph boolean := false;
    v_route_ph numeric;
    v_component_is_hydrofluoric boolean;
    v_component_is_fluoride boolean;
    v_additional_components_status text;
    v_fluoride_container_status text;
    v_incident_context text;
begin
    if p_components is null
       or jsonb_typeof(p_components) <> 'array'
       or jsonb_array_length(p_components) < 1
       or jsonb_array_length(p_components) > 100 then
        raise exception 'components must contain between 1 and 100 items' using errcode = '22023';
    end if;

    if p_matrix not in (
        'aqueous', 'organic_non_halogenated', 'organic_halogenated',
        'mixed_biphasic', 'solid_slurry', 'unknown'
    ) then
        raise exception 'Unsupported matrix: %', p_matrix using errcode = '22023';
    end if;

    if p_confirmation is null or jsonb_typeof(p_confirmation) <> 'object' then
        raise exception 'confirmation snapshot must be a JSON object' using errcode = '22023';
    end if;

    if not (p_confirmation ? 'incidentContext')
       and not (p_confirmation ? 'incident_context') then
        raise exception 'confirmationSnapshot.incidentContext is required'
            using errcode = '22023';
    end if;
    if (p_confirmation ? 'incidentContext'
            and jsonb_typeof(p_confirmation->'incidentContext') <> 'string')
       or (p_confirmation ? 'incident_context'
            and jsonb_typeof(p_confirmation->'incident_context') <> 'string') then
        raise exception 'incidentContext must be one of none, broken, or leak'
            using errcode = '22023';
    end if;
    if p_confirmation ? 'incidentContext'
       and p_confirmation ? 'incident_context'
       and p_confirmation->>'incidentContext' is distinct from p_confirmation->>'incident_context' then
        raise exception 'Conflicting incidentContext aliases are not allowed'
            using errcode = '22023';
    end if;
    v_incident_context := coalesce(
        p_confirmation->>'incidentContext',
        p_confirmation->>'incident_context'
    );
    if v_incident_context not in ('none', 'broken', 'leak') then
        raise exception 'incidentContext must be one of none, broken, or leak'
            using errcode = '22023';
    end if;

    -- The canonical client serializes an unanswered optional field as JSON
    -- null. Treat that exactly like an omitted key, while continuing to reject
    -- every non-null value outside the closed enum below.
    if (p_confirmation ? 'additionalComponentsStatus'
            and jsonb_typeof(p_confirmation->'additionalComponentsStatus') not in ('string', 'null'))
       or (p_confirmation ? 'additional_components_status'
            and jsonb_typeof(p_confirmation->'additional_components_status') not in ('string', 'null')) then
        raise exception 'additionalComponentsStatus must be one of none, present, or unknown'
            using errcode = '22023';
    end if;
    if p_confirmation->>'additionalComponentsStatus' is not null
       and p_confirmation->>'additional_components_status' is not null
       and p_confirmation->>'additionalComponentsStatus'
           is distinct from p_confirmation->>'additional_components_status' then
        raise exception 'Conflicting additionalComponentsStatus aliases are not allowed'
            using errcode = '22023';
    end if;
    v_additional_components_status := coalesce(
        p_confirmation->>'additionalComponentsStatus',
        p_confirmation->>'additional_components_status'
    );
    if v_additional_components_status is not null
       and v_additional_components_status not in ('none', 'present', 'unknown') then
        raise exception 'additionalComponentsStatus must be one of none, present, or unknown'
            using errcode = '22023';
    end if;

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
    loop
        if jsonb_typeof(v_component) <> 'object' then
            raise exception 'Every component must be a JSON object' using errcode = '22023';
        end if;

        v_analysis := coalesce(
            nullif(v_component->'analysisSnapshot', 'null'::jsonb),
            nullif(v_component->'analysis_snapshot', 'null'::jsonb),
            '{}'::jsonb
        );
        if jsonb_typeof(v_analysis) <> 'object' then
            raise exception 'component analysisSnapshot must be an object' using errcode = '22023';
        end if;

        v_ghs_data_status := coalesce(
            v_component->>'ghsDataStatus',
            v_component->>'ghs_data_status'
        );
        if v_ghs_data_status not in ('verified', 'lookup_failed', 'not_checked') then
            raise exception 'component ghsDataStatus must be verified, lookup_failed, or not_checked'
                using errcode = '22023';
        end if;
        if (v_analysis ? 'hazardDataConfirmedByUser'
                and jsonb_typeof(v_analysis->'hazardDataConfirmedByUser') <> 'boolean')
           or (v_analysis ? 'hazard_data_confirmed_by_user'
                and jsonb_typeof(v_analysis->'hazard_data_confirmed_by_user') <> 'boolean') then
            raise exception 'hazardDataConfirmedByUser must be boolean' using errcode = '22023';
        end if;
        v_hazard_data_confirmed := coalesce(
            (v_analysis->>'hazardDataConfirmedByUser')::boolean,
            (v_analysis->>'hazard_data_confirmed_by_user')::boolean,
            false
        );
        if v_ghs_data_status <> 'verified' and not v_hazard_data_confirmed then
            v_hazard_data_needs_input := true;
        end if;

        v_category := upper(coalesce(nullif(trim(v_analysis->>'category'), ''), 'UNKNOWN'));
        if v_category not in (
            'ACID', 'ALKALI', 'NEUTRAL', 'ORGANIC_HALOGEN',
            'ORGANIC_NON_HALOGEN', 'HEAVY_METAL', 'CYANIDE',
            'REACTIVE', 'SOLID_WASTE', 'SPECIAL_HAZARD', 'UNKNOWN'
        ) then
            raise exception 'Unsupported component analysis category: %', v_category using errcode = '22023';
        end if;

        v_name := trim(coalesce(
            v_component->>'chemicalName',
            v_component->>'chemical_name',
            v_component->>'name',
            ''
        ));
        v_cas := trim(coalesce(v_component->>'casNumber', v_component->>'cas_number', ''));
        if v_cas <> '' and not private.is_valid_cas_number(v_cas) then
            raise exception 'Invalid CAS Registry Number: %', v_cas using errcode = '22023';
        end if;
        v_formula := trim(coalesce(v_component->>'formula', ''));
        v_formula_normalized := upper(regexp_replace(v_formula, '[[:space:]]', '', 'g'));
        v_formula_normalized := regexp_replace(
            v_formula_normalized,
            '\((AQ|S|L|G)\)$',
            '',
            'i'
        );

        v_ghs := coalesce(nullif(v_analysis->'ghs', 'null'::jsonb), '{}'::jsonb);
        if jsonb_typeof(v_ghs) <> 'object' then
            raise exception 'analysisSnapshot.ghs must be an object or null' using errcode = '22023';
        end if;

        select coalesce(array_agg(distinct matches.code order by matches.code), array[]::text[])
        into v_hcodes
        from (
            select matched[1] as code
            from regexp_matches(
                upper(v_ghs::text || ' ' || coalesce(v_analysis->'hCodes', '[]'::jsonb)::text),
                '(H[0-9]{3})',
                'g'
            ) as matched
        ) matches;

        v_claimed_flags := coalesce(
            nullif(v_component->'hazardFlags', 'null'::jsonb),
            nullif(v_component->'hazard_flags', 'null'::jsonb),
            '[]'::jsonb
        );
        if jsonb_typeof(v_claimed_flags) <> 'array'
           or jsonb_array_length(v_claimed_flags) > 32 then
            raise exception 'component hazardFlags must contain at most 32 values' using errcode = '22023';
        end if;

        for v_claimed_flag in select jsonb_array_elements_text(v_claimed_flags)
        loop
            if v_claimed_flag not in (
                'FLAMMABLE', 'OXIDIZER', 'EXPLOSIVE', 'SELF_REACTIVE',
                'WATER_REACTIVE', 'PYROPHORIC', 'CORROSIVE', 'ACUTE_TOXIC',
                'CMR', 'ENVIRONMENTAL_HAZARD', 'CYANIDE', 'SULFIDE',
                'HEAVY_METAL', 'HYDROFLUORIC_ACID', 'FLUORIDE',
                'REACTIVE', 'UNKNOWN_COMPONENT'
            ) then
                raise exception 'component hazardFlags contains an unsupported value' using errcode = '22023';
            end if;
            v_server_flags := array_append(v_server_flags, v_claimed_flag);
        end loop;

        if v_hcodes && array['H220','H221','H222','H223','H224','H225','H226','H227','H228']::text[] then
            v_server_flags := array_append(v_server_flags, 'FLAMMABLE');
        end if;
        if v_hcodes && array['H270','H271','H272']::text[] then
            v_server_flags := array_append(v_server_flags, 'OXIDIZER');
        end if;
        if v_hcodes && array['H200','H201','H202','H203','H204','H205']::text[] then
            v_server_flags := array_append(v_server_flags, 'EXPLOSIVE');
        end if;
        if v_hcodes && array['H240','H241','H242']::text[] then
            v_server_flags := array_append(v_server_flags, 'SELF_REACTIVE');
        end if;
        if v_hcodes && array['H260','H261']::text[] then
            v_server_flags := array_append(v_server_flags, 'WATER_REACTIVE');
        end if;
        if v_hcodes && array['H250']::text[] then
            v_server_flags := array_append(v_server_flags, 'PYROPHORIC');
        end if;
        if v_hcodes && array['H290','H314']::text[] then
            v_server_flags := array_append(v_server_flags, 'CORROSIVE');
        end if;
        if v_hcodes && array['H300','H301','H310','H311','H330','H331']::text[] then
            v_server_flags := array_append(v_server_flags, 'ACUTE_TOXIC');
        end if;
        if v_hcodes && array['H340','H341','H350','H351','H360','H361','H362']::text[] then
            v_server_flags := array_append(v_server_flags, 'CMR');
        end if;
        if v_hcodes && array['H400','H410','H411','H412','H413']::text[] then
            v_server_flags := array_append(v_server_flags, 'ENVIRONMENTAL_HAZARD');
        end if;

        v_component_has_acid_identity := v_category = 'ACID'
            or v_cas in ('7647-01-0','7664-93-9','7697-37-2','7664-38-2','64-19-7','64-18-6')
            or v_formula_normalized in ('HCL','HBR','HI','HF','H2SO4','HNO3','H3PO4','HCLO4','CH3COOH','HCOOH')
            or v_name ~* '(hydrochloric acid|sulfuric acid|sulphuric acid|nitric acid|phosphoric acid|perchloric acid|acetic acid|formic acid|염산|황산|질산|인산|과염소산|아세트산|개미산|불산)';
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
        v_component_is_cyanide := v_category = 'CYANIDE'
            or v_cas in ('143-33-9','151-50-8','74-90-8')
            or v_formula_normalized in ('HCN','NACN','KCN','LICN','CA(CN)2')
            or v_name ~* '(cyanide|cyanid|시안화|시안|청산)';
        v_component_is_sulfide := v_cas in ('1313-82-2','1312-73-8','7783-06-4')
            or v_formula_normalized in ('NA2S','K2S','FES','H2S')
            or v_name ~* '(sulfide|sulphide|황화)';
        v_component_is_reactive := v_category = 'REACTIVE'
            or v_hcodes && array[
                'H200','H201','H202','H203','H204','H205','H206','H207','H208',
                'H240','H241','H242','H250','H251','H252','H260','H261',
                'H270','H271','H272'
            ]::text[]
            or v_formula_normalized in ('HNO3','HCLO4','NABH4','LIALH4','NAH','KH','LIH','CAH2')
            or v_name ~* '(peroxide|superoxide|hydroperoxide|nitrate|nitrite|hypochlorite|chlorate|perchlorate|permanganate|persulfate|azide|diazomethane|hydrazine|picric acid|borohydride|butyllithium|organolithium|sodium metal|potassium metal)';
        v_component_is_special := (
                v_category = 'SPECIAL_HAZARD'
                or (
                    v_hcodes && array['H300','H310','H330']::text[]
                    and not v_component_is_reactive
                    and not v_component_is_cyanide
                    and not v_component_is_sulfide
                    and not v_component_is_hydrofluoric
                    and not v_component_is_fluoride
                )
            )
            -- Rule 2.7.0: a solution proven below its legal limit leaves only
            -- the fatal-toxicity hold. Reactive, cyanide, sulfide, fluoride,
            -- heavy-metal and acid/alkali checks are evaluated independently.
            and not (
                v_hcodes && array['H300','H310','H330']::text[]
                and private.waste_fatal_toxicity_diluted_below_limit_v1(v_component, v_analysis, v_cas)
            );
        v_component_is_heavy_metal := v_category = 'HEAVY_METAL'
            or v_formula ~ '(Ag|Cd|Pb|Hg|Cr|As|Ni|Cu|Zn|Ba|Be|Co|Mn|Os|Sb|Tl|Pd|Pt|Rh|Ru|Ir|Au|Sn|Se|Mo|V)';
        v_component_is_organic_halogen := v_category = 'ORGANIC_HALOGEN'
            or (v_formula ~ 'C([0-9]|[A-Z]|$)' and v_formula ~ '(F|Cl|Br|I)');
        v_component_is_organic_non_halogen := v_category = 'ORGANIC_NON_HALOGEN';

        if v_component_is_cyanide then
            v_server_flags := array_append(v_server_flags, 'CYANIDE');
        end if;
        if v_component_is_sulfide then
            v_server_flags := array_append(v_server_flags, 'SULFIDE');
        end if;
        if v_component_is_heavy_metal then
            v_server_flags := array_append(v_server_flags, 'HEAVY_METAL');
        end if;
        if v_component_is_reactive or v_component_is_special then
            v_server_flags := array_append(v_server_flags, 'REACTIVE');
        end if;
        if v_category = 'UNKNOWN' then
            v_server_flags := array_append(v_server_flags, 'UNKNOWN_COMPONENT');
            v_has_unknown := true;
        end if;

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
        if v_identity_text is null
           or v_identity_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$' then
            v_identity_needs_input := true;
        else
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
        v_has_alkali := v_has_alkali or v_component_is_alkali;
        v_has_acid_identity := v_has_acid_identity or v_component_has_acid_identity;
        v_has_alkali_identity := v_has_alkali_identity or v_component_has_alkali_identity;
        v_has_cyanide := v_has_cyanide or v_component_is_cyanide;
        v_has_sulfide := v_has_sulfide or v_component_is_sulfide;
        v_has_reactive := v_has_reactive or v_component_is_reactive;
        v_has_special := v_has_special or v_component_is_special;
        v_has_heavy_metal := v_has_heavy_metal or v_component_is_heavy_metal;
        v_has_organic_halogen := v_has_organic_halogen or v_component_is_organic_halogen;
        v_has_organic_non_halogen := v_has_organic_non_halogen or v_component_is_organic_non_halogen;
        v_has_verified_halogenated_solvent :=
            coalesce(v_has_verified_halogenated_solvent, false)
            or coalesce(v_component_has_verified_halogenated_solvent, false);
        v_has_verified_non_halogenated_solvent :=
            coalesce(v_has_verified_non_halogenated_solvent, false)
            or coalesce(v_component_has_verified_non_halogenated_solvent, false);
    end loop;

    select coalesce(array_agg(distinct flag order by flag), array[]::text[])
    into v_server_flags
    from unnest(v_server_flags) as derived(flag);

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
        v_blocking_codes := array_append(v_blocking_codes, 'acid_cyanide');
    end if;
    if v_has_acid and v_has_sulfide then
        v_blocking_codes := array_append(v_blocking_codes, 'acid_sulfide');
    end if;
    if 'OXIDIZER' = any(v_server_flags) and 'FLAMMABLE' = any(v_server_flags) then
        v_blocking_codes := array_append(v_blocking_codes, 'oxidizer_flammable');
    end if;
    if 'WATER_REACTIVE' = any(v_server_flags)
       and p_matrix in ('aqueous', 'mixed_biphasic') then
        v_blocking_codes := array_append(v_blocking_codes, 'water_reactive_aqueous');
    end if;
    if 'EXPLOSIVE' = any(v_server_flags) or 'SELF_REACTIVE' = any(v_server_flags) then
        v_blocking_codes := array_append(v_blocking_codes, 'explosive_or_self_reactive');
    end if;
    if 'PYROPHORIC' = any(v_server_flags) then
        v_blocking_codes := array_append(v_blocking_codes, 'pyrophoric');
    end if;
    if v_has_special then
        v_blocking_codes := array_append(v_blocking_codes, 'special_hazard');
    end if;
    if v_has_reactive or 'REACTIVE' = any(v_server_flags) then
        v_blocking_codes := array_append(v_blocking_codes, 'reactive_waste');
    end if;
    if v_incident_context in ('broken', 'leak') then
        v_blocking_codes := array_append(
            v_blocking_codes,
            'physical_incident_' || v_incident_context
        );
    end if;

    v_measured_ph_status := coalesce(
        p_confirmation->>'measuredPhStatus',
        p_confirmation->>'measured_ph_status'
    );
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
    if v_measured_ph_status = 'measured' then
        if v_measured_ph_text is null
           or v_measured_ph_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$' then
            raise exception 'Measured pH must be a number between 0 and 14' using errcode = '22023';
        end if;
        v_measured_ph := v_measured_ph_text::numeric;
        if v_measured_ph < 0 or v_measured_ph > 14 then
            raise exception 'Measured pH must be a number between 0 and 14' using errcode = '22023';
        end if;
    end if;

    v_approved_predicted_ph := p_confirmation->'approvedPredictedPh';
    if v_approved_predicted_ph is not null then
        if jsonb_typeof(v_approved_predicted_ph) <> 'object'
           or v_approved_predicted_ph->>'status' <> 'available'
           or v_approved_predicted_ph->>'confidence' <> 'good'
           or jsonb_typeof(v_approved_predicted_ph->'value') <> 'number'
           or jsonb_typeof(coalesce(v_approved_predicted_ph->'issueCodes', '[]'::jsonb)) <> 'array'
           or jsonb_array_length(coalesce(v_approved_predicted_ph->'issueCodes', '[]'::jsonb)) <> 0 then
            raise exception 'approvedPredictedPh is invalid' using errcode = '22023';
        end if;
        v_predicted_batch_ph := (v_approved_predicted_ph->>'value')::numeric;
        if v_predicted_batch_ph <= 2.2 or v_predicted_batch_ph >= 12.3 then
            raise exception 'approvedPredictedPh is outside the routing-safe pH range' using errcode = '22023';
        end if;
        v_has_approved_predicted_ph := true;
    end if;

    if p_matrix = 'aqueous' and v_measured_ph_status = 'measured' then
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

    if v_has_acid and v_has_alkali then
        if v_mixing_state = 'separate' then
            v_blocking_codes := array_append(v_blocking_codes, 'acid_alkali_separate');
        elsif v_mixing_state = 'unknown' then
            v_missing_fields := array_append(v_missing_fields, 'mixing_state');
        elsif p_matrix = 'aqueous'
           and v_measured_ph_status <> 'measured'
           and not v_has_approved_predicted_ph then
            v_missing_fields := array_append(v_missing_fields, 'measured_ph');
        elsif p_matrix not in ('aqueous', 'unknown') then
            v_blocking_codes := array_append(
                v_blocking_codes,
                'acid_alkali_non_aqueous_mixed'
            );
        end if;
    end if;

    -- Broken containers and leaks are incident-response records, not ordinary
    -- stream deposits. Keep the server stream aligned with the shared client
    -- rule so no matrix-specific stream can downgrade the incident path.
    if v_incident_context in ('broken', 'leak') then
        v_server_stream := 'SPECIAL_REVIEW';
    elsif 'HYDROFLUORIC_ACID' = any(v_server_flags)
       or 'FLUORIDE' = any(v_server_flags) then
        v_server_stream := 'SPECIAL_REVIEW';
    elsif v_has_special then
        v_server_stream := 'SPECIAL_REVIEW';
    elsif v_has_reactive
       or 'REACTIVE' = any(v_server_flags)
       or 'OXIDIZER' = any(v_server_flags)
       or 'EXPLOSIVE' = any(v_server_flags)
       or 'SELF_REACTIVE' = any(v_server_flags)
       or 'PYROPHORIC' = any(v_server_flags) then
        v_server_stream := 'REACTIVE_OXIDIZER';
    elsif v_has_cyanide or v_has_sulfide then
        v_server_stream := 'CYANIDE_SULFIDE';
    elsif v_has_heavy_metal then
        v_server_stream := 'HEAVY_METAL';
    elsif v_has_acid and v_has_alkali and p_matrix <> 'aqueous' then
        v_server_stream := 'SPECIAL_REVIEW';
    elsif p_matrix = 'organic_halogenated'
       or (p_matrix <> 'mixed_biphasic' and v_has_organic_halogen) then
        v_server_stream := 'ORGANIC_HALOGENATED';
    elsif p_matrix = 'organic_non_halogenated' then
        v_server_stream := 'ORGANIC_NON_HALOGENATED';
    elsif p_matrix = 'solid_slurry' then
        v_server_stream := 'SOLID_CONTAMINATED';
    elsif p_matrix = 'aqueous' then
        if v_has_acid and v_has_alkali then
            if v_mixing_state = 'already_mixed'
               and (v_measured_ph_status = 'measured' or v_has_approved_predicted_ph) then
                v_route_ph := case
                    when v_measured_ph_status = 'measured' then v_measured_ph
                    else v_predicted_batch_ph
                end;
                if v_route_ph <= 2 then
                    v_server_stream := 'ACID_AQUEOUS';
                elsif v_route_ph >= 12.5 then
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
    else
        v_server_stream := 'SPECIAL_REVIEW';
    end if;

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
        when v_has_acid and v_has_alkali then
            case
                when p_matrix = 'aqueous'
                     and v_mixing_state = 'already_mixed'
                     and v_measured_ph_status = 'measured'
                    then 'measured_batch_ph'
                when p_matrix = 'aqueous'
                      and v_mixing_state = 'already_mixed'
                      and v_has_acid
                      and v_has_alkali
                      and v_has_approved_predicted_ph
                    then 'predicted_batch_ph'
                when p_matrix not in ('aqueous', 'unknown')
                     and v_mixing_state = 'already_mixed'
                    then 'special_rule'
                else 'unresolved'
            end
        when p_matrix = 'aqueous' and (v_has_acid_identity or v_has_alkali_identity)
            then 'identity'
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
    end;

    if p_matrix = 'unknown' then
        if coalesce(
            p_confirmation->>'matrixSource',
            p_confirmation->>'matrix_source'
        ) = 'user' then
            v_blocking_codes := array_append(
                v_blocking_codes,
                'unknown_matrix_review'
            );
        else
            v_missing_fields := array_append(v_missing_fields, 'matrix');
        end if;
    end if;
    if v_has_unknown then
        v_missing_fields := array_append(v_missing_fields, 'hazard_data');
    end if;
    if v_hazard_data_needs_input then
        v_missing_fields := array_append(v_missing_fields, 'hazard_data');
    end if;
    if v_identity_needs_input then
        v_missing_fields := array_append(v_missing_fields, 'identity');
    end if;
    -- Mixing state and measured final pH are handled together before routing.
    -- `present` means the user has declared a known component that is not yet
    -- represented in the component list. No matrix can make that omission
    -- safe to ignore. `unknown`, by contrast, only blocks when the missing
    -- composition can change an otherwise unresolved biphasic classification.
    if v_additional_components_status = 'present'
       or (
           p_matrix = 'mixed_biphasic'
           and not coalesce(v_has_verified_halogenated_solvent, false)
           and not coalesce(v_has_verified_non_halogenated_solvent, false)
       ) then
        v_missing_fields := array_append(v_missing_fields, 'additional_components');
    end if;

    select coalesce(array_agg(distinct code order by code), array[]::text[])
    into v_blocking_codes
    from unnest(v_blocking_codes) as blocked(code);
    select coalesce(array_agg(distinct field order by field), array[]::text[])
    into v_missing_fields
    from unnest(v_missing_fields) as missing(field);

    v_server_status := case
        when cardinality(v_blocking_codes) > 0 then 'blocked'
        when cardinality(v_missing_fields) > 0 then 'needs_input'
        else 'ready'
    end;

    return jsonb_build_object(
        'decisionStatus', v_server_status,
        'streamCode', v_server_stream,
        'hazardFlags', to_jsonb(v_server_flags),
        'allowedActions', case
            when v_server_status = 'ready' then jsonb_build_array('container_deposit')
            when v_server_status = 'blocked' then jsonb_build_array('isolated', 'handover')
            else '[]'::jsonb
        end,
        'blockingCodes', to_jsonb(v_blocking_codes),
        'missingFields', to_jsonb(v_missing_fields),
        'legalWastePhClass', v_legal_waste_ph_class,
        'corrosivityPhScreen', v_corrosivity_ph_screen,
        'routingBasis', v_routing_basis
    );
end;
$_$;

commit;
