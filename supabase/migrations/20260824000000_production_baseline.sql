-- BurilLab production baseline captured 2026-08-24.
-- DO NOT execute this file against the existing production database.
-- Existing production is reconciled by marking this version applied only after restore verification.

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

DROP SCHEMA IF EXISTS private CASCADE;
CREATE SCHEMA private;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: actor_display_name_v2(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.actor_display_name_v2(p_user_id uuid, p_lab_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    select coalesce(
        case when p_lab_id is not null then (
            select nullif(trim(lm.nickname), '')
            from public.lab_members lm
            where lm.lab_id = p_lab_id
              and lm.user_id = p_user_id
        ) end,
        (
            select coalesce(
                nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
                nullif(trim(u.raw_user_meta_data->>'name'), ''),
                nullif(trim(u.email), '')
            )
            from auth.users u
            where u.id = p_user_id
        )
    )
$$;


--
-- Name: analytics_normalize_query(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.analytics_normalize_query(input text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    SET search_path TO 'pg_catalog'
    AS $$
    select nullif(lower(regexp_replace(trim(input), '\s+', ' ', 'g')), '');
$$;


--
-- Name: analytics_sanitize_legacy_query(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.analytics_sanitize_legacy_query(input text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO 'pg_catalog'
    AS $_$
declare
    v_value text;
begin
    v_value := regexp_replace(input, '[[:cntrl:]]', '', 'g');
    v_value := regexp_replace(trim(v_value), '\s+', ' ', 'g');
    v_value := regexp_replace(v_value, '(https?://|www\.)[^[:space:]]+', '[URL]', 'gi');
    v_value := regexp_replace(
        v_value,
        '[[:alnum:]._%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}',
        '[EMAIL]',
        'gi'
    );
    if v_value !~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$' then
        v_value := regexp_replace(v_value, '(^|[^0-9])([0-9][0-9 ()+\-]{8,}[0-9])($|[^0-9])', '\1[PHONE]\3', 'g');
    end if;
    v_value := regexp_replace(v_value, '(^|[^[:alnum:]_])([[:alnum:]_\-]{32,})($|[^[:alnum:]_])', '\1[TOKEN]\3', 'g');
    return nullif(left(v_value, 200), '');
end;
$_$;


--
-- Name: analyze_waste_batch_v2(jsonb, text, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.analyze_waste_batch_v2(p_components jsonb, p_matrix text, p_confirmation jsonb) RETURNS jsonb
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
        v_component_is_special := v_category = 'SPECIAL_HAZARD'
            or (
                v_hcodes && array['H300','H310','H330']::text[]
                and not v_component_is_reactive
                and not v_component_is_cyanide
                and not v_component_is_sulfide
                and not v_component_is_hydrofluoric
                and not v_component_is_fluoride
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


--
-- Name: cabinet_depth_pct_v2(text, numeric, numeric); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.cabinet_depth_pct_v2(p_template text, p_width numeric, p_cabinet_depth numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE STRICT
    SET search_path TO 'pg_catalog'
    AS $$
    select (
        case p_template when 'A' then 0.44 when 'B' then 0.35
            when 'C' then 0.44 when 'D' then 0.44 end
        * (p_width / case p_template when 'A' then 8 when 'B' then 10
            when 'C' then 8 when 'D' then 10 end)
        / p_cabinet_depth
    ) * 100
$$;


--
-- Name: cabinet_visual_width_pct_v2(text, numeric, numeric); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.cabinet_visual_width_pct_v2(p_template text, p_width numeric, p_cabinet_width numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE STRICT
    SET search_path TO 'pg_catalog'
    AS $$
    select (
        case p_template when 'A' then 0.44 when 'B' then 0.50
            when 'C' then 0.44 when 'D' then 0.50 end
        * (p_width / case p_template when 'A' then 8 when 'B' then 10
            when 'C' then 8 when 'D' then 10 end)
        / p_cabinet_width
    ) * 100
$$;


--
-- Name: capture_ph_prediction_audit_v1(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.capture_ph_prediction_audit_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $_$
declare
    v_input jsonb := new.analysis_snapshot->'phPredictionInput';
    v_volume jsonb;
    v_density jsonb;
    v_prediction jsonb := new.analysis_snapshot->'phPredictionSnapshot';
    v_unknown_key text;
    v_value_text text;
    v_normalized_text text;
    v_density_text text;
    v_temperature_text text;
    v_expected_ml numeric;
    v_status text;
    v_confidence text;
begin
    if v_input is not null then
        if jsonb_typeof(v_input) <> 'object' or octet_length(v_input::text) > 8192 then
            raise exception 'phPredictionInput must be a JSON object no larger than 8 KiB'
                using errcode = '22023';
        end if;

        select key into v_unknown_key
        from jsonb_object_keys(v_input) input_key(key)
        where key not in ('solutionVolume', 'concentrationBasis', 'density', 'phCatalogId')
        limit 1;
        if found then
            raise exception 'Unsupported phPredictionInput key: %', v_unknown_key
                using errcode = '22023';
        end if;

        new.ph_catalog_id := nullif(trim(v_input->>'phCatalogId'), '');
        if new.ph_catalog_id is not null and (
            length(new.ph_catalog_id) > 200
            or new.ph_catalog_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
        ) then
            raise exception 'Invalid phCatalogId' using errcode = '22023';
        end if;

        new.concentration_basis := nullif(v_input->>'concentrationBasis', '');
        if new.concentration_basis is not null
           and new.concentration_basis not in ('w_w', 'w_v', 'v_v') then
            raise exception 'Invalid concentrationBasis' using errcode = '22023';
        end if;

        v_volume := v_input->'solutionVolume';
        if v_volume is not null and v_volume <> 'null'::jsonb then
            if jsonb_typeof(v_volume) <> 'object' then
                raise exception 'solutionVolume must be a JSON object' using errcode = '22023';
            end if;
            select key into v_unknown_key
            from jsonb_object_keys(v_volume) volume_key(key)
            where key not in ('value', 'unit', 'normalizedMl', 'isEstimate')
            limit 1;
            if found then
                raise exception 'Unsupported solutionVolume key: %', v_unknown_key
                    using errcode = '22023';
            end if;

            v_value_text := v_volume->>'value';
            v_normalized_text := v_volume->>'normalizedMl';
            if v_value_text is null
               or v_normalized_text is null
               or v_value_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)(?:[eE][+-]?[0-9]+)?$'
               or v_normalized_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)(?:[eE][+-]?[0-9]+)?$' then
                raise exception 'solutionVolume requires positive finite value and normalizedMl'
                    using errcode = '22023';
            end if;

            new.solution_volume_value := v_value_text::numeric;
            new.solution_volume_unit := v_volume->>'unit';
            new.solution_volume_normalized_ml := v_normalized_text::numeric;
            if v_volume ? 'isEstimate' and jsonb_typeof(v_volume->'isEstimate') <> 'boolean' then
                raise exception 'solutionVolume.isEstimate must be boolean' using errcode = '22023';
            end if;
            new.solution_volume_is_estimate := coalesce((v_volume->>'isEstimate')::boolean, false);

            if new.solution_volume_value <= 0
               or new.solution_volume_normalized_ml <= 0
               or new.solution_volume_unit not in ('uL', 'mL', 'L') then
                raise exception 'Invalid solutionVolume value or unit' using errcode = '22023';
            end if;

            v_expected_ml := case new.solution_volume_unit
                when 'uL' then new.solution_volume_value / 1000
                when 'mL' then new.solution_volume_value
                when 'L' then new.solution_volume_value * 1000
            end;
            if abs(new.solution_volume_normalized_ml - v_expected_ml)
               > greatest(0.000000001, v_expected_ml * 0.000000001) then
                raise exception 'solutionVolume.normalizedMl does not match value and unit'
                    using errcode = '22023';
            end if;
        end if;

        v_density := v_input->'density';
        if v_density is not null and v_density <> 'null'::jsonb then
            if jsonb_typeof(v_density) <> 'object' then
                raise exception 'density must be a JSON object' using errcode = '22023';
            end if;
            select key into v_unknown_key
            from jsonb_object_keys(v_density) density_key(key)
            where key not in ('value', 'unit', 'kind', 'temperatureC', 'source', 'isEstimate')
            limit 1;
            if found then
                raise exception 'Unsupported density key: %', v_unknown_key using errcode = '22023';
            end if;

            v_density_text := v_density->>'value';
            v_temperature_text := nullif(v_density->>'temperatureC', '');
            if v_density_text is null
               or v_density_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)(?:[eE][+-]?[0-9]+)?$'
               or (v_temperature_text is not null and v_temperature_text !~ '^-?(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$') then
                raise exception 'density requires a positive finite value' using errcode = '22023';
            end if;

            new.density_value := v_density_text::numeric;
            new.density_unit := v_density->>'unit';
            new.density_kind := v_density->>'kind';
            new.density_temperature_c := v_temperature_text::numeric;
            new.density_source := nullif(v_density->>'source', '');
            if v_density ? 'isEstimate' and jsonb_typeof(v_density->'isEstimate') <> 'boolean' then
                raise exception 'density.isEstimate must be boolean' using errcode = '22023';
            end if;
            new.density_is_estimate := coalesce((v_density->>'isEstimate')::boolean, false);

            if new.density_value <= 0
               or new.density_unit <> 'g/mL'
               or new.density_kind not in ('solution', 'solute')
               or (new.density_temperature_c is not null and new.density_temperature_c not between -100 and 300)
               or (new.density_source is not null and new.density_source not in ('catalog', 'user')) then
                raise exception 'Invalid density metadata' using errcode = '22023';
            end if;
        end if;
    end if;

    if v_prediction is not null then
        if new.line_number <> 1 then
            raise exception 'phPredictionSnapshot is allowed only on the first component'
                using errcode = '22023';
        end if;
        if jsonb_typeof(v_prediction) <> 'object' or octet_length(v_prediction::text) > 32768 then
            raise exception 'phPredictionSnapshot must be a JSON object no larger than 32 KiB'
                using errcode = '22023';
        end if;

        select key into v_unknown_key
        from jsonb_object_keys(v_prediction) prediction_key(key)
        where key not in (
            'origin', 'capturedAt', 'status', 'value', 'displayValue', 'ionicStrength',
            'confidence', 'issueCodes', 'assumptions', 'modelVersion', 'catalogVersion', 'inputHash'
        )
        limit 1;
        if found then
            raise exception 'Unsupported phPredictionSnapshot key: %', v_unknown_key
                using errcode = '22023';
        end if;

        v_status := v_prediction->>'status';
        v_confidence := v_prediction->>'confidence';
        if v_prediction->>'origin' <> 'client_generated'
           or coalesce(v_prediction->>'capturedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
           or v_status not in ('available', 'approximate', 'unsupported', 'blocked', 'failed')
           or v_confidence not in ('good', 'approximate', 'unavailable')
           or nullif(v_prediction->>'modelVersion', '') is null
           or length(v_prediction->>'modelVersion') > 100
           or nullif(v_prediction->>'catalogVersion', '') is null
           or length(v_prediction->>'catalogVersion') > 100
           or coalesce(v_prediction->>'inputHash', '') !~ '^[A-Za-z0-9:_-]{8,128}$'
           or jsonb_typeof(coalesce(v_prediction->'issueCodes', '[]'::jsonb)) <> 'array'
           or jsonb_array_length(coalesce(v_prediction->'issueCodes', '[]'::jsonb)) > 32
           or jsonb_typeof(coalesce(v_prediction->'assumptions', '[]'::jsonb)) <> 'array'
           or jsonb_array_length(coalesce(v_prediction->'assumptions', '[]'::jsonb)) > 32 then
            raise exception 'Invalid phPredictionSnapshot metadata' using errcode = '22023';
        end if;

        if exists (
            select 1
            from jsonb_array_elements(coalesce(v_prediction->'issueCodes', '[]'::jsonb)) item(value)
            where jsonb_typeof(item.value) <> 'string' or length(item.value #>> '{}') > 100
        ) or exists (
            select 1
            from jsonb_array_elements(coalesce(v_prediction->'assumptions', '[]'::jsonb)) item(value)
            where jsonb_typeof(item.value) <> 'string' or length(item.value #>> '{}') > 500
        ) then
            raise exception 'Invalid phPredictionSnapshot list entry' using errcode = '22023';
        end if;

        if v_status in ('available', 'approximate') then
            if jsonb_typeof(v_prediction->'value') is distinct from 'number'
               or (v_prediction->>'value')::numeric not between 0 and 14
               or jsonb_typeof(v_prediction->'displayValue') is distinct from 'number'
               or (v_prediction->>'displayValue')::numeric not between 0 and 14
               or jsonb_typeof(v_prediction->'ionicStrength') is distinct from 'number'
               or (v_prediction->>'ionicStrength')::numeric < 0
               or (v_prediction->>'ionicStrength')::numeric > 0.10 then
                raise exception 'Available pH predictions require bounded numeric results'
                    using errcode = '22023';
            end if;
        elsif v_prediction ? 'value' or v_prediction ? 'displayValue' then
            raise exception 'Unavailable pH predictions cannot contain a pH result'
                using errcode = '22023';
        elsif v_prediction ? 'ionicStrength' and (
            jsonb_typeof(v_prediction->'ionicStrength') is distinct from 'number'
            or (v_prediction->>'ionicStrength')::numeric < 0
            or (v_prediction->>'ionicStrength')::numeric > 100
        ) then
            raise exception 'Unavailable pH prediction ionicStrength is invalid' using errcode = '22023';
        end if;

        update public.waste_logs
        set ph_prediction_snapshot = v_prediction
        where id = new.waste_log_id;
    end if;

    return new;
end;
$_$;


--
-- Name: cleanup_expired_guest_search_analytics(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.cleanup_expired_guest_search_analytics() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $$
declare
    v_event_count integer := 0;
    v_action_count integer := 0;
begin
    select count(*)
    into v_action_count
    from public.search_analytics_actions action
    join public.search_analytics_events event on event.id = action.event_id
    where event.guest_subject_id is not null
      and event.created_at < now() - interval '90 days';

    delete from public.search_analytics_events
    where guest_subject_id is not null
      and created_at < now() - interval '90 days';
    get diagnostics v_event_count = row_count;

    delete from public.search_analytics_guest_subjects subject
    where not exists (
        select 1 from public.search_analytics_events event
        where event.guest_subject_id = subject.id
    );

    if v_event_count > 0 then
        insert into public.analytics_deletion_audits (
            subject_type, reason, deleted_event_count, deleted_action_count
        ) values ('guest', 'guest_expired', v_event_count, v_action_count);
    end if;

    return v_event_count;
end;
$$;


--
-- Name: delete_search_analytics_for_history_row(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.delete_search_analytics_for_history_row() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $$
declare
    v_event_count integer := 0;
    v_action_count integer := 0;
    v_normalized text;
begin
    v_normalized := private.analytics_normalize_query(old.query);
    if v_normalized is null then
        return old;
    end if;

    select count(*)
    into v_action_count
    from public.search_analytics_actions action
    join public.search_analytics_events event on event.id = action.event_id
    where event.user_id = old.user_id
      and event.query_normalized = v_normalized;

    delete from public.search_analytics_events event
    where event.user_id = old.user_id
      and event.query_normalized = v_normalized;
    get diagnostics v_event_count = row_count;

    if v_event_count > 0 then
        insert into public.analytics_deletion_audits (
            subject_type, reason, deleted_event_count, deleted_action_count
        ) values (
            'authenticated', 'history_item_deleted', v_event_count, v_action_count
        );
    end if;
    return old;
end;
$$;


--
-- Name: is_valid_cas_number(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_valid_cas_number(p_cas text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO 'pg_catalog'
    AS $_$
declare
    v_cas text := trim(p_cas);
    v_body text;
    v_reversed text;
    v_check_digit integer;
    v_sum integer := 0;
    v_position integer;
begin
    -- CAS Registry Numbers contain 2..7 digits, two digits, and one checksum
    -- digit. The checksum is the reversed body weighted by 1..n modulo 10.
    if v_cas !~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$' then
        return false;
    end if;

    v_body := replace(left(v_cas, length(v_cas) - 2), '-', '');
    v_reversed := reverse(v_body);
    v_check_digit := right(v_cas, 1)::integer;

    for v_position in 1..length(v_reversed)
    loop
        v_sum := v_sum
            + substring(v_reversed from v_position for 1)::integer * v_position;
    end loop;

    return (v_sum % 10) = v_check_digit;
end;
$_$;


--
-- Name: refresh_analytics_review_candidates(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_analytics_review_candidates() RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $$
declare
    v_alias_count integer := 0;
    v_safety_count integer := 0;
begin
    with metrics as (
        select
            event.query_normalized,
            max(event.query_sanitized) as representative_query,
            count(*)::integer as sample_count,
            count(*) filter (where event.outcome = 'no_result')::integer as no_result_count,
            max(next_event.matched_standard_name) filter (where next_event.outcome = 'matched') as canonical_name,
            max(next_event.matched_cas) filter (where next_event.outcome = 'matched') as canonical_cas
        from public.search_analytics_events event
        left join public.search_analytics_actions action
          on action.event_id = event.id and action.action_type = 'query_reformulated'
        left join public.search_analytics_events next_event on next_event.id = action.related_event_id
        where event.created_at >= now() - interval '30 days'
          and event.outcome <> 'technical_error'
        group by event.query_normalized
        having count(*) >= 3
           and (
               count(*) filter (where event.outcome = 'no_result') >= 2
               or count(*) filter (where action.id is not null) >= 2
           )
    )
    insert into public.analytics_review_candidates (
        candidate_type, source_key, title, summary, proposed_alias,
        canonical_name, canonical_cas, evidence, sample_count
    )
    select
        'search_alias',
        metrics.query_normalized,
        '검색 별칭 후보: ' || metrics.representative_query,
        '결과 없음 또는 반복 수정이 누적된 검색어입니다. 승인 전 표준 시약을 확인하세요.',
        metrics.representative_query,
        metrics.canonical_name,
        metrics.canonical_cas,
        jsonb_build_object(
            'noResultCount', metrics.no_result_count,
            'windowDays', 30,
            'automaticDecision', false
        ),
        metrics.sample_count
    from metrics
    where not exists (
        select 1
        from public.analytics_review_candidates decided
        where decided.candidate_type = 'search_alias'
          and decided.source_key = metrics.query_normalized
          and decided.status in ('approved', 'rejected')
    )
    on conflict (candidate_type, source_key) where status = 'pending'
    do update set
        sample_count = excluded.sample_count,
        evidence = excluded.evidence,
        canonical_name = coalesce(excluded.canonical_name, public.analytics_review_candidates.canonical_name),
        canonical_cas = coalesce(excluded.canonical_cas, public.analytics_review_candidates.canonical_cas),
        updated_at = now();
    get diagnostics v_alias_count = row_count;

    with eligible_batches as (
        select wl.id, wl.user_id, wl.lab_id
        from public.waste_logs wl
        where wl.schema_version = 2
          and wl.voided_at is null
          and coalesce(
              wl.confirmation_snapshot->>'mixingState',
              wl.confirmation_snapshot->>'mixing_state',
              case when lower(wl.confirmation_snapshot->>'alreadyMixed') = 'true' then 'already_mixed' end
          ) = 'already_mixed'
          and wl.created_at >= now() - interval '90 days'
    ), components as (
        select
            item.waste_log_id,
            item.line_number,
            coalesce(
                nullif('cas:' || nullif(trim(item.cas_number), ''), 'cas:'),
                'name:' || private.analytics_normalize_query(item.chemical_name)
            ) as component_key,
            item.chemical_name,
            item.hazard_flags
        from public.waste_log_items item
        join eligible_batches batch on batch.id = item.waste_log_id
    ), pairs as (
        select
            least(a.component_key, b.component_key) as component_a_key,
            greatest(a.component_key, b.component_key) as component_b_key,
            case when a.component_key <= b.component_key then a.chemical_name else b.chemical_name end as component_a_name,
            case when a.component_key <= b.component_key then b.chemical_name else a.chemical_name end as component_b_name,
            a.waste_log_id,
            array(select distinct flag from unnest(
                coalesce(a.hazard_flags, array[]::text[]) || coalesce(b.hazard_flags, array[]::text[])
            ) flag) as hazard_flags
        from components a
        join components b on b.waste_log_id = a.waste_log_id and b.line_number > a.line_number
    ), metrics as (
        select
            pair.component_a_key,
            pair.component_b_key,
            max(pair.component_a_name) as component_a_name,
            max(pair.component_b_name) as component_b_name,
            count(distinct pair.waste_log_id)::integer as sample_count,
            array_agg(distinct flag) filter (where flag is not null) as hazard_flags
        from pairs pair
        left join lateral unnest(pair.hazard_flags) flag on true
        group by pair.component_a_key, pair.component_b_key
        having count(distinct pair.waste_log_id) >= 2
    )
    insert into public.analytics_review_candidates (
        candidate_type, source_key, title, summary, evidence, sample_count
    )
    select
        case
            when metrics.hazard_flags && array[
                'OXIDIZER', 'WATER_REACTIVE', 'PYROPHORIC', 'CYANIDE',
                'SULFIDE', 'HYDROFLUORIC_ACID', 'EXPLOSIVE', 'SELF_REACTIVE'
            ]::text[] then 'safety_rule'
            else 'education_content'
        end,
        metrics.component_a_key || '|' || metrics.component_b_key,
        '혼합 검토 후보: ' || metrics.component_a_name || ' + ' || metrics.component_b_name,
        '실제 혼합 빈도만으로 위험을 확정하지 않습니다. 문헌·골든셋·담당자 검토가 필요합니다.',
        jsonb_build_object(
            'componentAKey', metrics.component_a_key,
            'componentBKey', metrics.component_b_key,
            'hazardFlags', to_jsonb(metrics.hazard_flags),
            'automaticRuleChange', false,
            'windowDays', 90
        ),
        metrics.sample_count
    from metrics
    where not exists (
        select 1
        from public.analytics_review_candidates decided
        where decided.candidate_type = case
                when metrics.hazard_flags && array[
                    'OXIDIZER', 'WATER_REACTIVE', 'PYROPHORIC', 'CYANIDE',
                    'SULFIDE', 'HYDROFLUORIC_ACID', 'EXPLOSIVE', 'SELF_REACTIVE'
                ]::text[] then 'safety_rule'
                else 'education_content'
            end
          and decided.source_key = metrics.component_a_key || '|' || metrics.component_b_key
          and decided.status in ('approved', 'rejected')
    )
    on conflict (candidate_type, source_key) where status = 'pending'
    do update set
        sample_count = excluded.sample_count,
        evidence = excluded.evidence,
        updated_at = now();
    get diagnostics v_safety_count = row_count;

    return jsonb_build_object('aliasCandidates', v_alias_count, 'mixtureCandidates', v_safety_count);
end;
$$;


--
-- Name: rollup_search_batch_analytics(date); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.rollup_search_batch_analytics(p_month_start date) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $_$
declare
    v_search_count integer := 0;
    v_mixture_count integer := 0;
begin
    with event_flags as (
        select
            event.*,
            exists (
                select 1 from public.search_analytics_actions action
                where action.event_id = event.id
                  and action.action_type = 'query_reformulated'
                  and action.created_at >= event.created_at
                  and action.created_at <= event.created_at + interval '10 minutes'
            ) as reformulated,
            exists (
                select 1 from public.search_analytics_actions action
                where action.event_id = event.id and action.action_type = 'scan_corrected'
            ) as scan_corrected,
            not exists (
                select 1 from public.search_analytics_actions action
                where action.event_id = event.id
                  and action.action_type in ('result_selected', 'added_to_batch', 'query_reformulated')
                  and action.created_at >= event.created_at
                  and action.created_at <= event.created_at + interval '10 minutes'
            ) as unresolved
        from public.search_analytics_events event
        where event.created_at >= p_month_start::timestamptz
          and event.created_at < (p_month_start + interval '1 month')::timestamptz
          and event.outcome <> 'technical_error'
          and event.user_id is not null
          and event.lab_id is not null
    ), metrics as (
        select
            commercial_cohort,
            query_normalized,
            max(query_sanitized) as representative_query,
            count(*)::integer as total_events,
            count(*) filter (where outcome = 'matched')::integer as matched_events,
            count(*) filter (where outcome = 'no_result')::integer as no_result_events,
            count(*) filter (where outcome in ('matched', 'no_result', 'invalid_query'))::integer as valid_events,
            count(distinct user_id)::integer as distinct_users,
            count(distinct lab_id)::integer as distinct_labs,
            avg(reformulated::integer) filter (
                where outcome in ('matched', 'no_result', 'invalid_query')
            )::numeric as reformulation_rate,
            avg(scan_corrected::integer) filter (
                where outcome in ('matched', 'no_result', 'invalid_query')
            )::numeric as scan_correction_rate,
            avg(unresolved::integer) filter (
                where outcome in ('matched', 'no_result', 'invalid_query')
            )::numeric as unresolved_rate
        from event_flags
        group by commercial_cohort, query_normalized
        having count(*) >= 30
           and count(distinct user_id) >= 5
           and count(distinct lab_id) >= 3
    )
    insert into public.analytics_monthly_search_rollups (
        month_start, commercial_cohort, query_normalized, representative_query,
        total_events, matched_events, no_result_events, distinct_users, distinct_labs,
        reformulation_rate, scan_correction_rate, unresolved_rate, confusion_score
    )
    select
        p_month_start,
        metrics.commercial_cohort,
        metrics.query_normalized,
        metrics.representative_query,
        metrics.total_events,
        metrics.matched_events,
        metrics.no_result_events,
        metrics.distinct_users,
        metrics.distinct_labs,
        metrics.reformulation_rate,
        metrics.scan_correction_rate,
        metrics.unresolved_rate,
        100 * (
            0.45 * metrics.no_result_events::numeric / nullif(metrics.valid_events, 0)
            + 0.30 * metrics.reformulation_rate
            + 0.15 * metrics.scan_correction_rate
            + 0.10 * metrics.unresolved_rate
        )
    from metrics
    on conflict do nothing;
    get diagnostics v_search_count = row_count;

    with eligible_batches as (
        select
            wl.id,
            wl.user_id,
            wl.lab_id,
            wl.created_at,
            case
                when exists (
                    select 1
                    from public.waste_log_items linked_item
                    join public.search_analytics_events linked_event
                      on linked_event.id = linked_item.source_search_event_id
                    where linked_item.waste_log_id = wl.id
                      and linked_event.commercial_cohort = 'institution_contract'
                ) then 'institution_contract'
                else 'internal_only'
            end as commercial_cohort,
            case
                when coalesce(wl.confirmation_snapshot->>'measuredBatchPh', wl.confirmation_snapshot->>'measured_batch_ph')
                    ~ '(^[0-9]+([.][0-9]+)?$)|(^[.][0-9]+$)'
                then coalesce(wl.confirmation_snapshot->>'measuredBatchPh', wl.confirmation_snapshot->>'measured_batch_ph')::numeric
            end as measured_ph
        from public.waste_logs wl
        where wl.schema_version = 2
          and wl.voided_at is null
          and wl.created_at >= p_month_start::timestamptz
          and wl.created_at < (p_month_start + interval '1 month')::timestamptz
          and wl.user_id is not null
          and wl.lab_id is not null
          and coalesce(
              wl.confirmation_snapshot->>'mixingState',
              wl.confirmation_snapshot->>'mixing_state',
              case when lower(wl.confirmation_snapshot->>'alreadyMixed') = 'true' then 'already_mixed' end
          ) = 'already_mixed'
    ), components as (
        select
            batch.*,
            item.line_number,
            item.chemical_name,
            coalesce(
                nullif('cas:' || nullif(trim(item.cas_number), ''), 'cas:'),
                'name:' || private.analytics_normalize_query(item.chemical_name)
            ) as component_key,
            item.solution_volume_normalized_ml,
            item.concentration_value,
            item.concentration_unit
        from eligible_batches batch
        join public.waste_log_items item on item.waste_log_id = batch.id
    ), pairs as (
        select
            a.commercial_cohort,
            a.id as waste_log_id,
            a.user_id,
            a.lab_id,
            a.measured_ph,
            least(a.component_key, b.component_key) as component_a_key,
            greatest(a.component_key, b.component_key) as component_b_key,
            case when a.component_key <= b.component_key then a.chemical_name else b.chemical_name end as component_a_name,
            case when a.component_key <= b.component_key then b.chemical_name else a.chemical_name end as component_b_name,
            a.solution_volume_normalized_ml as a_volume,
            b.solution_volume_normalized_ml as b_volume,
            a.concentration_value as a_concentration,
            a.concentration_unit as a_concentration_unit,
            b.concentration_value as b_concentration,
            b.concentration_unit as b_concentration_unit
        from components a
        join components b on b.id = a.id and b.line_number > a.line_number
    ), base_metrics as (
        select
            commercial_cohort,
            component_a_key,
            component_b_key,
            max(component_a_name) as component_a_name,
            max(component_b_name) as component_b_name,
            count(distinct waste_log_id)::integer as batch_count,
            count(distinct user_id)::integer as user_count,
            count(distinct lab_id)::integer as lab_count,
            jsonb_strip_nulls(jsonb_build_object(
                'medianMl', percentile_cont(0.5) within group (order by (coalesce(a_volume, 0) + coalesce(b_volume, 0)))
                    filter (where a_volume is not null or b_volume is not null),
                'q1Ml', percentile_cont(0.25) within group (order by (coalesce(a_volume, 0) + coalesce(b_volume, 0)))
                    filter (where a_volume is not null or b_volume is not null),
                'q3Ml', percentile_cont(0.75) within group (order by (coalesce(a_volume, 0) + coalesce(b_volume, 0)))
                    filter (where a_volume is not null or b_volume is not null),
                'p10Ml', percentile_cont(0.10) within group (order by (coalesce(a_volume, 0) + coalesce(b_volume, 0)))
                    filter (where a_volume is not null or b_volume is not null),
                'p90Ml', percentile_cont(0.90) within group (order by (coalesce(a_volume, 0) + coalesce(b_volume, 0)))
                    filter (where a_volume is not null or b_volume is not null)
            )) as volume_distribution,
            jsonb_strip_nulls(jsonb_build_object(
                'median', percentile_cont(0.5) within group (order by measured_ph),
                'q1', percentile_cont(0.25) within group (order by measured_ph),
                'q3', percentile_cont(0.75) within group (order by measured_ph),
                'p10', percentile_cont(0.10) within group (order by measured_ph),
                'p90', percentile_cont(0.90) within group (order by measured_ph)
            )) as ph_distribution
        from pairs
        group by commercial_cohort, component_a_key, component_b_key
        having count(distinct waste_log_id) >= 10
           and count(distinct user_id) >= 5
           and count(distinct lab_id) >= 3
    ), concentrations as (
        select commercial_cohort, component_a_key, component_b_key, concentration_unit, concentration_value
        from (
            select commercial_cohort, component_a_key, component_b_key,
                a_concentration_unit as concentration_unit, a_concentration as concentration_value
            from pairs
            union all
            select commercial_cohort, component_a_key, component_b_key,
                b_concentration_unit, b_concentration
            from pairs
        ) values_by_unit
        where concentration_unit is not null and concentration_value is not null
    ), concentration_metrics as (
        select
            commercial_cohort,
            component_a_key,
            component_b_key,
            jsonb_object_agg(concentration_unit, distribution) as distributions
        from (
            select
                commercial_cohort,
                component_a_key,
                component_b_key,
                concentration_unit,
                jsonb_build_object(
                    'median', percentile_cont(0.5) within group (order by concentration_value),
                    'q1', percentile_cont(0.25) within group (order by concentration_value),
                    'q3', percentile_cont(0.75) within group (order by concentration_value),
                    'p10', percentile_cont(0.10) within group (order by concentration_value),
                    'p90', percentile_cont(0.90) within group (order by concentration_value)
                ) as distribution
            from concentrations
            group by commercial_cohort, component_a_key, component_b_key, concentration_unit
        ) grouped
        group by commercial_cohort, component_a_key, component_b_key
    )
    insert into public.analytics_monthly_mixture_rollups (
        month_start, commercial_cohort, component_a_key, component_a_name,
        component_b_key, component_b_name, finalized_batch_count,
        distinct_users, distinct_labs, volume_distribution, ph_distribution,
        concentration_distributions
    )
    select
        p_month_start,
        base.commercial_cohort,
        base.component_a_key,
        base.component_a_name,
        base.component_b_key,
        base.component_b_name,
        base.batch_count,
        base.user_count,
        base.lab_count,
        base.volume_distribution,
        base.ph_distribution,
        coalesce(concentration.distributions, '{}'::jsonb)
    from base_metrics base
    left join concentration_metrics concentration
      on concentration.commercial_cohort = base.commercial_cohort
     and concentration.component_a_key = base.component_a_key
     and concentration.component_b_key = base.component_b_key
    on conflict do nothing;
    get diagnostics v_mixture_count = row_count;

    return jsonb_build_object('searchCells', v_search_count, 'mixtureCells', v_mixture_count);
end;
$_$;


--
-- Name: waste_log_item_validate_search_event_link(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.waste_log_item_validate_search_event_link() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $_$
declare
    v_snapshot_id text;
    v_log_user_id uuid;
    v_log_lab_id uuid;
begin
    v_snapshot_id := nullif(new.analysis_snapshot->>'sourceSearchEventId', '');
    if new.source_search_event_id is null and v_snapshot_id is not null then
        if v_snapshot_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
            raise exception 'sourceSearchEventId must be a UUID' using errcode = '22023';
        end if;
        new.source_search_event_id := v_snapshot_id::uuid;
    end if;

    if new.source_search_event_id is null then
        return new;
    end if;

    select wl.user_id, wl.lab_id
    into v_log_user_id, v_log_lab_id
    from public.waste_logs wl
    where wl.id = new.waste_log_id;

    if not found then
        raise exception 'Waste log does not exist for linked search event' using errcode = '23503';
    end if;

    if not exists (
        select 1
        from public.search_analytics_events event
        where event.id = new.source_search_event_id
          and event.user_id is not null
          and event.outcome = 'matched'
          and event.user_id is not distinct from v_log_user_id
          and event.lab_id is not distinct from v_log_lab_id
    ) then
        raise exception 'Search event is outside the waste log user/lab scope' using errcode = '42501';
    end if;

    return new;
end;
$_$;


--
-- Name: activate_waste_policy_v2(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_waste_policy_v2(p_policy_version_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
declare
    v_user_id uuid := auth.uid();
    v_policy public.waste_policy_versions%rowtype;
    v_source_ref jsonb;
    v_unknown_key text;
    v_stream_count integer;
    v_enabled_stream_count integer;
    v_invalid_stream_code text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    select *
    into v_policy
    from public.waste_policy_versions pv
    where pv.id = p_policy_version_id
    for update;

    if not found then
        raise exception 'Waste policy version not found: %', p_policy_version_id using errcode = 'P0002';
    end if;

    if v_policy.scope_type = 'system' then
        raise exception 'System policies can only be activated by a database migration' using errcode = '42501';
    elsif v_policy.scope_type = 'safety_center' then
        if not exists (
            select 1
            from public.safety_centers sc
            where sc.id = v_policy.safety_center_id
              and sc.status = 'approved'
        ) or not public.is_safety_center_member(
            v_policy.safety_center_id,
            array['owner', 'manager']::text[]
        ) then
            raise exception 'Safety-center owner or manager permission is required' using errcode = '42501';
        end if;
    elsif v_policy.scope_type = 'lab' then
        raise exception 'Lab safety-rule policies cannot be activated; use physical stream overrides instead'
            using errcode = '42501';
    end if;

    if v_policy.status <> 'draft' then
        raise exception 'Only a draft policy version can be activated; current status is %', v_policy.status
            using errcode = '22023';
    end if;

    if jsonb_typeof(v_policy.source_refs) <> 'array'
       or jsonb_array_length(v_policy.source_refs) < 1
       or jsonb_array_length(v_policy.source_refs) > 20 then
        raise exception 'An activatable policy requires between 1 and 20 source references'
            using errcode = '22023';
    end if;

    for v_source_ref in select value from jsonb_array_elements(v_policy.source_refs)
    loop
        if jsonb_typeof(v_source_ref) <> 'object' then
            raise exception 'Every source reference must be an object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_source_ref) source_key(key)
        where key not in ('title', 'url')
        limit 1;
        if found then
            raise exception 'Unsupported source reference key: %', v_unknown_key using errcode = '22023';
        end if;

        if not (v_source_ref ? 'title')
           or jsonb_typeof(v_source_ref->'title') <> 'string'
           or nullif(trim(v_source_ref->>'title'), '') is null
           or length(trim(v_source_ref->>'title')) > 500
           or (
               v_source_ref ? 'url'
               and jsonb_typeof(v_source_ref->'url') not in ('string', 'null')
           )
           or (
               nullif(trim(v_source_ref->>'url'), '') is not null
               and (
                   length(trim(v_source_ref->>'url')) > 2000
                   or trim(v_source_ref->>'url') !~ '^https://[^[:space:]]+$'
               )
           ) then
            raise exception 'Each source reference requires a title; a provided URL must use HTTPS'
                using errcode = '22023';
        end if;
    end loop;

    select count(*), count(*) filter (where ps.is_enabled)
    into v_stream_count, v_enabled_stream_count
    from public.waste_policy_streams ps
    where ps.policy_version_id = p_policy_version_id;

    if v_stream_count <> 10 then
        raise exception 'A policy must define exactly 10 waste streams before activation; found %',
            v_stream_count using errcode = '22023';
    end if;

    if v_enabled_stream_count < 1 then
        raise exception 'A policy must have at least one enabled stream before activation' using errcode = '22023';
    end if;

    select ps.stream_code
    into v_invalid_stream_code
    from public.waste_policy_streams ps
    where ps.policy_version_id = p_policy_version_id
      and ps.is_enabled
      and (
          cardinality(ps.prohibitions) < 1
          or cardinality(ps.label_requirements) < 1
          or exists (
              select 1 from unnest(ps.prohibitions) item(value)
              where nullif(trim(item.value), '') is null
          )
          or exists (
              select 1 from unnest(ps.label_requirements) item(value)
              where nullif(trim(item.value), '') is null
          )
      )
    order by ps.stream_code
    limit 1;
    if found then
        raise exception
            'Enabled category % requires prohibitions and label_requirements',
            v_invalid_stream_code
            using errcode = '22023';
    end if;

    select ps.stream_code
    into v_invalid_stream_code
    from public.waste_policy_streams ps
    where ps.policy_version_id = p_policy_version_id
      and ps.stream_code in ('CYANIDE_SULFIDE', 'REACTIVE_OXIDIZER', 'SPECIAL_REVIEW')
      and nullif(trim(ps.handler_contact), '') is null
    order by ps.stream_code
    limit 1;
    if found then
        raise exception 'Special-handling stream % requires handler_contact before activation',
            v_invalid_stream_code using errcode = '22023';
    end if;

    update public.waste_policy_versions
    set status = 'retired'
    where scope_type = 'safety_center'
      and safety_center_id = v_policy.safety_center_id
      and status = 'active'
      and id <> p_policy_version_id;

    update public.waste_policy_versions
    set status = 'active',
        activated_by = v_user_id,
        activated_at = now()
    where id = p_policy_version_id
    returning * into v_policy;

    return jsonb_build_object(
        'id', v_policy.id,
        'policyKey', v_policy.policy_key,
        'scopeType', v_policy.scope_type,
        'status', v_policy.status,
        'activatedAt', v_policy.activated_at,
        'activatedBy', v_policy.activated_by
    );
end;
$_$;


--
-- Name: add_safety_center_request_event(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_safety_center_request_event(p_request_id uuid, p_body text DEFAULT NULL::text, p_to_status text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_center_id uuid;
    v_lab_id uuid;
    v_from_status text;
    v_actor_scope text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    select r.center_id, r.lab_id, r.status
    into v_center_id, v_lab_id, v_from_status
    from public.safety_center_requests r
    where r.id = p_request_id;

    if not found then
        raise exception 'Safety center request not found' using errcode = 'P0002';
    end if;

    if public.is_safety_center_member(v_center_id, array['owner', 'manager']) then
        v_actor_scope := 'center';
    elsif exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = v_lab_id
          and lm.user_id = v_user_id
    ) then
        v_actor_scope := 'lab';
    else
        raise exception 'Access denied for request %', p_request_id using errcode = '42501';
    end if;

    if p_to_status is not null and p_to_status not in ('open', 'in_progress', 'submitted', 'resolved') then
        raise exception 'Unsupported request status: %', p_to_status using errcode = '22023';
    end if;

    if p_to_status is not null and p_to_status is distinct from v_from_status then
        update public.safety_center_requests
        set status = p_to_status
        where id = p_request_id;
    end if;

    insert into public.safety_center_request_events (
        request_id,
        actor_user_id,
        actor_scope,
        event_type,
        from_status,
        to_status,
        body
    ) values (
        p_request_id,
        v_user_id,
        v_actor_scope,
        case when p_to_status is not null and p_to_status is distinct from v_from_status then 'status_change' else 'comment' end,
        v_from_status,
        p_to_status,
        nullif(p_body, '')
    );
end;
$$;


--
-- Name: analytics_admin_governance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_admin_governance() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $$
select jsonb_build_object(
    'collection', jsonb_build_object(
        'authenticatedEvents', (select count(*) from public.search_analytics_events where user_id is not null),
        'guestEvents', (select count(*) from public.search_analytics_events where guest_subject_id is not null),
        'guestSubjects', (select count(*) from public.search_analytics_guest_subjects),
        'guestEventsExpiringIn7Days', (
            select count(*) from public.search_analytics_events
            where guest_subject_id is not null
              and created_at < now() - interval '83 days'
        ),
        'oldestGuestEventAt', (
            select min(created_at) from public.search_analytics_events where guest_subject_id is not null
        )
    ),
    'deletions', jsonb_build_object(
        'requestCount', (select count(*) from public.analytics_deletion_audits),
        'deletedEvents', (select coalesce(sum(deleted_event_count), 0) from public.analytics_deletion_audits),
        'deletedActions', (select coalesce(sum(deleted_action_count), 0) from public.analytics_deletion_audits)
    ),
    'exports', jsonb_build_object(
        'count', (select count(*) from public.analytics_export_audits),
        'lastExportAt', (select max(created_at) from public.analytics_export_audits),
        'allAudited', true
    ),
    'monthlyRollups', jsonb_build_object(
        'searchCells', (select count(*) from public.analytics_monthly_search_rollups),
        'mixtureCells', (select count(*) from public.analytics_monthly_mixture_rollups),
        'externalSearchCells', (
            select count(*) from public.analytics_monthly_search_rollups
            where commercial_cohort = 'institution_contract'
        ),
        'externalMixtureCells', (
            select count(*) from public.analytics_monthly_mixture_rollups
            where commercial_cohort = 'institution_contract'
        )
    ),
    'commercialization', jsonb_build_object(
        'externalProductEnabled', (
            select external_product_enabled from public.analytics_commercialization_settings where singleton
        ),
        'institutionDataAgreementReady', (
            select institution_data_agreement_ready from public.analytics_commercialization_settings where singleton
        ),
        'reidentificationRiskReviewReady', (
            select reidentification_risk_review_ready from public.analytics_commercialization_settings where singleton
        ),
        'legalReviewReady', (
            select legal_review_ready from public.analytics_commercialization_settings where singleton
        ),
        'searchThreshold', jsonb_build_object('events', 30, 'users', 5, 'labs', 3),
        'mixtureThreshold', jsonb_build_object('batches', 10, 'users', 5, 'labs', 3),
        'monthlyOnly', true,
        'retroactiveInclusion', false
    ),
    'reviews', jsonb_build_object(
        'pending', (select count(*) from public.analytics_review_candidates where status = 'pending'),
        'approved', (select count(*) from public.analytics_review_candidates where status = 'approved'),
        'rejected', (select count(*) from public.analytics_review_candidates where status = 'rejected')
    )
);
$$;


--
-- Name: analytics_admin_mixtures(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_admin_mixtures(p_days integer DEFAULT 90, p_limit integer DEFAULT 100) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $_$
with bounds as (
    select now() - make_interval(days => least(greatest(p_days, 1), 365)) as since
), eligible_batches as (
    select
        log.*,
        case
            when coalesce(log.confirmation_snapshot->>'measuredBatchPh', log.confirmation_snapshot->>'measured_batch_ph')
                ~ '(^[0-9]+([.][0-9]+)?$)|(^[.][0-9]+$)'
            then coalesce(log.confirmation_snapshot->>'measuredBatchPh', log.confirmation_snapshot->>'measured_batch_ph')::numeric
        end as measured_ph
    from public.waste_logs log, bounds
    where log.schema_version = 2
      and log.voided_at is null
      and log.created_at >= bounds.since
      and coalesce(
          log.confirmation_snapshot->>'mixingState',
          log.confirmation_snapshot->>'mixing_state',
          case when lower(log.confirmation_snapshot->>'alreadyMixed') = 'true' then 'already_mixed' end
      ) = 'already_mixed'
), components as (
    select
        batch.id as waste_log_id,
        batch.user_id,
        batch.lab_id,
        batch.stream_code,
        batch.handling_action,
        batch.matrix_code,
        batch.measured_ph,
        item.line_number,
        item.chemical_name,
        coalesce(
            nullif('cas:' || nullif(trim(item.cas_number), ''), 'cas:'),
            'name:' || private.analytics_normalize_query(item.chemical_name)
        ) as component_key,
        item.solution_volume_normalized_ml,
        item.concentration_value,
        item.concentration_unit,
        item.hazard_flags,
        item.source_search_event_id
    from eligible_batches batch
    join public.waste_log_items item on item.waste_log_id = batch.id
), pairs as (
    select
        a.waste_log_id,
        a.user_id,
        a.lab_id,
        a.stream_code,
        a.handling_action,
        a.matrix_code,
        a.measured_ph,
        least(a.component_key, b.component_key) as component_a_key,
        greatest(a.component_key, b.component_key) as component_b_key,
        case when a.component_key <= b.component_key then a.chemical_name else b.chemical_name end as component_a_name,
        case when a.component_key <= b.component_key then b.chemical_name else a.chemical_name end as component_b_name,
        a.solution_volume_normalized_ml as a_volume,
        b.solution_volume_normalized_ml as b_volume,
        a.concentration_value as a_concentration,
        a.concentration_unit as a_concentration_unit,
        b.concentration_value as b_concentration,
        b.concentration_unit as b_concentration_unit,
        coalesce(a.hazard_flags, array[]::text[]) || coalesce(b.hazard_flags, array[]::text[]) as hazard_flags,
        (a.source_search_event_id is not null or b.source_search_event_id is not null) as linked_to_search
    from components a
    join components b on b.waste_log_id = a.waste_log_id and b.line_number > a.line_number
), pair_metrics as (
    select
        component_a_key,
        component_b_key,
        max(component_a_name) as component_a_name,
        max(component_b_name) as component_b_name,
        count(distinct waste_log_id)::integer as batch_count,
        count(distinct user_id)::integer as user_count,
        count(distinct lab_id)::integer as lab_count,
        count(distinct waste_log_id) filter (where linked_to_search)::integer as linked_batch_count,
        round((percentile_cont(0.5) within group (order by measured_ph))::numeric, 3) as ph_median,
        round((percentile_cont(0.25) within group (order by measured_ph))::numeric, 3) as ph_q1,
        round((percentile_cont(0.75) within group (order by measured_ph))::numeric, 3) as ph_q3,
        round((percentile_cont(0.10) within group (order by measured_ph))::numeric, 3) as ph_p10,
        round((percentile_cont(0.90) within group (order by measured_ph))::numeric, 3) as ph_p90,
        round((percentile_cont(0.5) within group (
            order by (coalesce(a_volume, 0) + coalesce(b_volume, 0))
        ) filter (where a_volume is not null or b_volume is not null))::numeric, 3) as volume_median,
        round((percentile_cont(0.25) within group (
            order by (coalesce(a_volume, 0) + coalesce(b_volume, 0))
        ) filter (where a_volume is not null or b_volume is not null))::numeric, 3) as volume_q1,
        round((percentile_cont(0.75) within group (
            order by (coalesce(a_volume, 0) + coalesce(b_volume, 0))
        ) filter (where a_volume is not null or b_volume is not null))::numeric, 3) as volume_q3,
        round((percentile_cont(0.10) within group (
            order by (coalesce(a_volume, 0) + coalesce(b_volume, 0))
        ) filter (where a_volume is not null or b_volume is not null))::numeric, 3) as volume_p10,
        round((percentile_cont(0.90) within group (
            order by (coalesce(a_volume, 0) + coalesce(b_volume, 0))
        ) filter (where a_volume is not null or b_volume is not null))::numeric, 3) as volume_p90
    from pairs
    group by component_a_key, component_b_key
    order by count(distinct waste_log_id) desc, component_a_key, component_b_key
    limit least(greatest(p_limit, 1), 500)
), pair_hazards as (
    select
        pair.component_a_key,
        pair.component_b_key,
        jsonb_agg(distinct flag) filter (where flag is not null) as flags
    from pairs pair
    left join lateral unnest(pair.hazard_flags) flag on true
    group by pair.component_a_key, pair.component_b_key
), concentrations as (
    select component_a_key, component_b_key, concentration_unit, concentration_value
    from (
        select component_a_key, component_b_key, a_concentration_unit as concentration_unit, a_concentration as concentration_value
        from pairs
        union all
        select component_a_key, component_b_key, b_concentration_unit, b_concentration
        from pairs
    ) values_by_unit
    where concentration_unit is not null and concentration_value is not null
), concentration_metrics as (
    select
        component_a_key,
        component_b_key,
        jsonb_object_agg(concentration_unit, distribution) as distributions
    from (
        select
            component_a_key,
            component_b_key,
            concentration_unit,
            jsonb_build_object(
                'median', round((percentile_cont(0.5) within group (order by concentration_value))::numeric, 4),
                'q1', round((percentile_cont(0.25) within group (order by concentration_value))::numeric, 4),
                'q3', round((percentile_cont(0.75) within group (order by concentration_value))::numeric, 4),
                'p10', round((percentile_cont(0.10) within group (order by concentration_value))::numeric, 4),
                'p90', round((percentile_cont(0.90) within group (order by concentration_value))::numeric, 4)
            ) as distribution
        from concentrations
        group by component_a_key, component_b_key, concentration_unit
    ) grouped
    group by component_a_key, component_b_key
), stream_distributions as (
    select
        component_a_key,
        component_b_key,
        jsonb_object_agg(coalesce(stream_code, 'unknown'), stream_count) as streams
    from (
        select
            component_a_key,
            component_b_key,
            stream_code,
            count(distinct waste_log_id)::integer as stream_count
        from pairs
        group by component_a_key, component_b_key, stream_code
    ) grouped
    group by component_a_key, component_b_key
), action_distributions as (
    select
        component_a_key,
        component_b_key,
        jsonb_object_agg(coalesce(handling_action, 'unknown'), action_count) as actions
    from (
        select
            component_a_key,
            component_b_key,
            handling_action,
            count(distinct waste_log_id)::integer as action_count
        from pairs
        group by component_a_key, component_b_key, handling_action
    ) grouped
    group by component_a_key, component_b_key
), matrix_distributions as (
    select
        component_a_key,
        component_b_key,
        jsonb_object_agg(coalesce(matrix_code, 'unknown'), matrix_count) as matrices
    from (
        select
            component_a_key,
            component_b_key,
            matrix_code,
            count(distinct waste_log_id)::integer as matrix_count
        from pairs
        group by component_a_key, component_b_key, matrix_code
    ) grouped
    group by component_a_key, component_b_key
), combinations as (
    select
        combination_key,
        max(combination_name) as combination_name,
        count(*)::integer as batch_count
    from (
        select
            component_set.waste_log_id,
            string_agg(component_set.component_key, ' + ' order by component_set.component_key) as combination_key,
            string_agg(component_set.chemical_name, ' + ' order by component_set.component_key) as combination_name
        from (
            select distinct waste_log_id, component_key, chemical_name from components
        ) component_set
        group by component_set.waste_log_id
        having count(*) >= 2
    ) batch_combinations
    group by combination_key
    order by count(*) desc, combination_key
    limit least(greatest(p_limit, 1), 500)
), state_counts as (
    select
        count(*) filter (where coalesce(
            log.confirmation_snapshot->>'mixingState', log.confirmation_snapshot->>'mixing_state'
        ) = 'separate')::integer as separate_count,
        count(*) filter (where coalesce(
            log.confirmation_snapshot->>'mixingState', log.confirmation_snapshot->>'mixing_state', 'unknown'
        ) = 'unknown')::integer as unknown_count
    from public.waste_logs log, bounds
    where log.schema_version = 2 and log.voided_at is null and log.created_at >= bounds.since
), handling_summary as (
    select
        count(*)::integer as total,
        count(*) filter (where handling_action = 'isolated')::integer as isolated,
        count(*) filter (where handling_action = 'handover')::integer as handover
    from eligible_batches
)
select jsonb_build_object(
    'pairs', coalesce((
        select jsonb_agg(jsonb_build_object(
            'componentAKey', metric.component_a_key,
            'componentAName', metric.component_a_name,
            'componentBKey', metric.component_b_key,
            'componentBName', metric.component_b_name,
            'batchCount', metric.batch_count,
            'uniqueUsers', metric.user_count,
            'uniqueLabs', metric.lab_count,
            'searchLinkedBatchCount', metric.linked_batch_count,
            'smallSample', metric.batch_count < 10,
            'phDistribution', jsonb_strip_nulls(jsonb_build_object(
                'median', metric.ph_median, 'q1', metric.ph_q1, 'q3', metric.ph_q3,
                'p10', metric.ph_p10, 'p90', metric.ph_p90
            )),
            'volumeDistributionMl', jsonb_strip_nulls(jsonb_build_object(
                'median', metric.volume_median, 'q1', metric.volume_q1, 'q3', metric.volume_q3,
                'p10', metric.volume_p10, 'p90', metric.volume_p90
            )),
            'concentrationDistributions', coalesce(concentration.distributions, '{}'::jsonb),
            'hazardFlags', coalesce(hazard.flags, '[]'::jsonb),
            'streams', coalesce(stream_distribution.streams, '{}'::jsonb),
            'actions', coalesce(action_distribution.actions, '{}'::jsonb),
            'matrices', coalesce(matrix_distribution.matrices, '{}'::jsonb)
        ) order by metric.batch_count desc, metric.component_a_key, metric.component_b_key)
        from pair_metrics metric
        left join pair_hazards hazard using (component_a_key, component_b_key)
        left join concentration_metrics concentration using (component_a_key, component_b_key)
        left join stream_distributions stream_distribution using (component_a_key, component_b_key)
        left join action_distributions action_distribution using (component_a_key, component_b_key)
        left join matrix_distributions matrix_distribution using (component_a_key, component_b_key)
    ), '[]'::jsonb),
    'combinations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'key', combinations.combination_key,
            'name', combinations.combination_name,
            'batchCount', combinations.batch_count,
            'smallSample', combinations.batch_count < 10
        ) order by combinations.batch_count desc, combinations.combination_key)
        from combinations
    ), '[]'::jsonb),
    'excludedStates', jsonb_build_object(
        'separate', coalesce((select separate_count from state_counts), 0),
        'unknown', coalesce((select unknown_count from state_counts), 0)
    ),
    'handlingSummary', jsonb_build_object(
        'total', coalesce((select total from handling_summary), 0),
        'isolated', coalesce((select isolated from handling_summary), 0),
        'handover', coalesce((select handover from handling_summary), 0),
        'isolatedRate', coalesce((
            select round(100.0 * isolated / nullif(total, 0), 2) from handling_summary
        ), 0),
        'handoverRate', coalesce((
            select round(100.0 * handover / nullif(total, 0), 2) from handling_summary
        ), 0)
    )
);
$_$;


--
-- Name: analytics_admin_refresh_reviews(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_admin_refresh_reviews() RETURNS jsonb
    LANGUAGE sql
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $$
    select private.refresh_analytics_review_candidates();
$$;


--
-- Name: analytics_admin_search(integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_admin_search(p_days integer DEFAULT 90, p_limit integer DEFAULT 100, p_order text DEFAULT 'demand'::text) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $$
with bounds as (
    select now() - make_interval(days => least(greatest(p_days, 1), 365)) as since
), base as (
    select
        event.*,
        exists (
            select 1 from public.search_analytics_actions action
            where action.event_id = event.id
              and action.action_type = 'query_reformulated'
              and action.created_at >= event.created_at
              and action.created_at <= event.created_at + interval '10 minutes'
        ) as reformulated,
        exists (
            select 1 from public.search_analytics_actions action
            where action.event_id = event.id and action.action_type = 'scan_corrected'
        ) as scan_corrected,
        (
            event.created_at < now() - interval '10 minutes'
            and not exists (
                select 1 from public.search_analytics_actions action
                where action.event_id = event.id
                  and action.action_type in ('result_selected', 'added_to_batch', 'query_reformulated')
                  and action.created_at >= event.created_at
                  and action.created_at <= event.created_at + interval '10 minutes'
            )
        ) as unresolved
    from public.search_analytics_events event, bounds
    where event.created_at >= bounds.since
), metrics as (
    select
        query_normalized,
        max(query_sanitized) as representative_query,
        count(*)::integer as total_events,
        count(*) filter (where created_at >= now() - interval '7 days')::integer as events_7d,
        count(*) filter (where created_at >= now() - interval '30 days')::integer as events_30d,
        count(*) filter (where created_at >= now() - interval '90 days')::integer as events_90d,
        count(*) filter (where outcome = 'matched')::integer as matched_count,
        count(*) filter (where outcome = 'no_result')::integer as no_result_count,
        count(*) filter (where outcome = 'technical_error')::integer as technical_error_count,
        count(*) filter (
            where outcome in ('matched', 'no_result', 'invalid_query') and reformulated
        )::integer as reformulated_count,
        count(*) filter (
            where outcome in ('matched', 'no_result', 'invalid_query') and scan_corrected
        )::integer as scan_corrected_count,
        count(*) filter (
            where outcome in ('matched', 'no_result', 'invalid_query') and unresolved
        )::integer as unresolved_count,
        count(distinct coalesce('u:' || user_id::text, 'g:' || guest_subject_id::text))::integer as subject_count,
        count(*) filter (where outcome in ('matched', 'no_result', 'invalid_query'))::numeric as valid_count
    from base
    group by query_normalized
), scored as (
    select
        metrics.*,
        coalesce(no_result_count / nullif(valid_count, 0), 0) as no_result_rate,
        coalesce(reformulated_count::numeric / nullif(valid_count, 0), 0) as reformulation_rate,
        coalesce(scan_corrected_count::numeric / nullif(valid_count, 0), 0) as scan_correction_rate,
        coalesce(unresolved_count::numeric / nullif(valid_count, 0), 0) as unresolved_rate,
        100 * (
            0.45 * coalesce(no_result_count / nullif(valid_count, 0), 0)
            + 0.30 * coalesce(reformulated_count::numeric / nullif(valid_count, 0), 0)
            + 0.15 * coalesce(scan_corrected_count::numeric / nullif(valid_count, 0), 0)
            + 0.10 * coalesce(unresolved_count::numeric / nullif(valid_count, 0), 0)
        ) as confusion_score
    from metrics
), ranked as (
    select *
    from scored
    order by
        case when p_order = 'confusion' then scored.confusion_score end desc nulls last,
        case when p_order <> 'confusion' then scored.total_events end desc nulls last,
        scored.total_events desc,
        scored.query_normalized
    limit least(greatest(p_limit, 1), 500)
)
select jsonb_build_object(
    'items', coalesce(jsonb_agg(
        jsonb_build_object(
            'query', ranked.representative_query,
            'normalizedQuery', ranked.query_normalized,
            'demandIndex', ranked.total_events,
            'events7d', ranked.events_7d,
            'events30d', ranked.events_30d,
            'events90d', ranked.events_90d,
            'matchedCount', ranked.matched_count,
            'noResultCount', ranked.no_result_count,
            'technicalErrorCount', ranked.technical_error_count,
            'uniqueSubjects', ranked.subject_count,
            'smallSample', ranked.total_events < 10,
            'confusionScore', round(ranked.confusion_score, 2),
            'components', jsonb_build_object(
                'noResultRate', round(100 * ranked.no_result_rate, 2),
                'reformulationRate', round(100 * ranked.reformulation_rate, 2),
                'scanCorrectionRate', round(100 * ranked.scan_correction_rate, 2),
                'unresolvedRate', round(100 * ranked.unresolved_rate, 2)
            ),
            'variants', coalesce((
                select jsonb_agg(variant.query_sanitized order by variant.usage_count desc, variant.query_sanitized)
                from (
                    select event.query_sanitized, count(*) as usage_count
                    from base event
                    where event.query_normalized = ranked.query_normalized
                    group by event.query_sanitized
                    order by count(*) desc, event.query_sanitized
                    limit 10
                ) variant
            ), '[]'::jsonb),
            'resolvedStandards', coalesce((
                select jsonb_agg(resolved.standard_name order by resolved.usage_count desc, resolved.standard_name)
                from (
                    select event.matched_standard_name as standard_name, count(*) as usage_count
                    from base event
                    where event.query_normalized = ranked.query_normalized
                      and event.matched_standard_name is not null
                    group by event.matched_standard_name
                    order by count(*) desc, event.matched_standard_name
                    limit 10
                ) resolved
            ), '[]'::jsonb)
        ) order by
            case when p_order = 'confusion' then ranked.confusion_score end desc nulls last,
            ranked.total_events desc,
            ranked.query_normalized
    ), '[]'::jsonb)
)
from ranked;
$$;


--
-- Name: analytics_admin_summary(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_admin_summary(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $$
with bounds as (
    select now() - make_interval(days => least(greatest(p_days, 1), 365)) as since
), events as (
    select event.*
    from public.search_analytics_events event, bounds
    where event.created_at >= bounds.since
), batches as (
    select log.*
    from public.waste_logs log, bounds
    where log.created_at >= bounds.since
      and log.schema_version = 2
      and log.voided_at is null
), mixed_batches as (
    select batch.*
    from batches batch
    where coalesce(
        batch.confirmation_snapshot->>'mixingState',
        batch.confirmation_snapshot->>'mixing_state',
        case when lower(batch.confirmation_snapshot->>'alreadyMixed') = 'true' then 'already_mixed' end
    ) = 'already_mixed'
), item_completeness as (
    select
        count(*)::integer as total,
        count(*) filter (where nullif(trim(item.cas_number), '') is not null)::integer as cas_complete,
        count(*) filter (where item.concentration_value is not null and item.concentration_unit is not null)::integer as concentration_complete,
        count(*) filter (where item.solution_volume_normalized_ml is not null)::integer as volume_complete
    from public.waste_log_items item
    join batches batch on batch.id = item.waste_log_id
), daily as (
    select
        date(event.created_at at time zone 'Asia/Seoul') as day,
        count(*)::integer as searches,
        count(*) filter (where event.outcome = 'no_result')::integer as no_results
    from events event
    group by date(event.created_at at time zone 'Asia/Seoul')
    order by day
)
select jsonb_build_object(
    'periodDays', least(greatest(p_days, 1), 365),
    'submittedSearches', (select count(*) from events),
    'uniqueUsers', (
        select count(distinct coalesce('u:' || user_id::text, 'g:' || guest_subject_id::text)) from events
    ),
    'noResultRate', coalesce((
        select round(
            100.0 * count(*) filter (where outcome = 'no_result')
            / nullif(count(*) filter (where outcome in ('matched', 'no_result')), 0),
            2
        ) from events
    ), 0),
    'technicalErrorRate', coalesce((
        select round(100.0 * count(*) filter (where outcome = 'technical_error') / nullif(count(*), 0), 2)
        from events
    ), 0),
    'ingestionRecoveryCount', coalesce((select sum(previous_ingestion_failures) from events), 0),
    'analyticsIngestionFailureRate', coalesce((
        select round(
            100.0 * sum(previous_ingestion_failures)
            / nullif(count(*) + sum(previous_ingestion_failures), 0),
            2
        )
        from events
        where search_channel <> 'legacy'
    ), 0),
    'batchConversionRate', coalesce((
        select round(
            100.0 * count(distinct item.source_search_event_id)
            / nullif(count(*) filter (where event.outcome = 'matched'), 0),
            2
        )
        from events event
        left join public.waste_log_items item on item.source_search_event_id = event.id
    ), 0),
    'finalizedBatches', (select count(*) from batches),
    'mixedBatches', (select count(*) from mixed_batches),
    'dataCompleteness', jsonb_build_object(
        'itemCount', coalesce((select total from item_completeness), 0),
        'casPercent', coalesce((select round(100.0 * cas_complete / nullif(total, 0), 2) from item_completeness), 0),
        'concentrationPercent', coalesce((select round(100.0 * concentration_complete / nullif(total, 0), 2) from item_completeness), 0),
        'volumePercent', coalesce((select round(100.0 * volume_complete / nullif(total, 0), 2) from item_completeness), 0)
    ),
    'dailyTrend', coalesce((
        select jsonb_agg(jsonb_build_object('date', daily.day, 'searches', daily.searches, 'noResults', daily.no_results))
        from daily
    ), '[]'::jsonb)
);
$$;


--
-- Name: analytics_delete_guest_subject(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_delete_guest_subject(p_guest_subject_id uuid, p_delete_token_hash text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
    v_event_count integer := 0;
    v_action_count integer := 0;
    v_stored_hash text;
begin
    select delete_token_hash into v_stored_hash
    from public.search_analytics_guest_subjects
    where id = p_guest_subject_id
    for update;

    if not found or v_stored_hash <> p_delete_token_hash then
        raise exception 'Guest analytics subject was not found' using errcode = 'P0002';
    end if;

    select count(*) into v_event_count
    from public.search_analytics_events
    where guest_subject_id = p_guest_subject_id;

    select count(*) into v_action_count
    from public.search_analytics_actions action
    join public.search_analytics_events event on event.id = action.event_id
    where event.guest_subject_id = p_guest_subject_id;

    delete from public.search_analytics_guest_subjects
    where id = p_guest_subject_id;

    insert into public.analytics_deletion_audits (
        subject_type, reason, deleted_event_count, deleted_action_count
    ) values ('guest', 'guest_request', v_event_count, v_action_count);

    return jsonb_build_object(
        'success', true,
        'deletedEvents', v_event_count,
        'deletedActions', v_action_count
    );
end;
$$;


--
-- Name: analytics_delete_user_search(uuid, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_delete_user_search(p_user_id uuid, p_query_normalized text, p_delete_all boolean, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
    v_event_count integer := 0;
    v_action_count integer := 0;
begin
    if p_user_id is null then
        raise exception 'User is required' using errcode = '22023';
    end if;
    if p_reason not in ('history_item_deleted', 'history_cleared', 'account_deleted') then
        raise exception 'Invalid deletion reason' using errcode = '22023';
    end if;
    if not coalesce(p_delete_all, false) and nullif(trim(p_query_normalized), '') is null then
        raise exception 'Normalized query is required' using errcode = '22023';
    end if;

    select count(*) into v_action_count
    from public.search_analytics_actions action
    join public.search_analytics_events event on event.id = action.event_id
    where event.user_id = p_user_id
      and (coalesce(p_delete_all, false) or event.query_normalized = p_query_normalized);

    delete from public.search_analytics_events event
    where event.user_id = p_user_id
      and (coalesce(p_delete_all, false) or event.query_normalized = p_query_normalized);
    get diagnostics v_event_count = row_count;

    insert into public.analytics_deletion_audits (
        subject_type, reason, deleted_event_count, deleted_action_count
    ) values ('authenticated', p_reason, v_event_count, v_action_count);

    return jsonb_build_object(
        'success', true,
        'deletedEvents', v_event_count,
        'deletedActions', v_action_count
    );
end;
$$;


--
-- Name: analytics_normalize_cas(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_normalize_cas(input text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
    select nullif(regexp_replace(coalesce(input, ''), '[^0-9-]', '', 'g'), '');
$$;


--
-- Name: analytics_normalize_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_normalize_text(input text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
    select nullif(lower(trim(regexp_replace(coalesce(input, ''), '\s+', ' ', 'g'))), '');
$$;


--
-- Name: analytics_review_candidate_decide(uuid, text, text, jsonb, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_review_candidate_decide(p_candidate_id uuid, p_status text, p_notes text, p_evidence jsonb, p_operator_user_id uuid, p_proposed_alias text DEFAULT NULL::text, p_canonical_name text DEFAULT NULL::text, p_canonical_cas text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'private'
    AS $$
declare
    v_candidate public.analytics_review_candidates%rowtype;
begin
    if p_status not in ('approved', 'rejected') then
        raise exception 'status must be approved or rejected' using errcode = '22023';
    end if;
    if p_operator_user_id is null then
        raise exception 'operator is required' using errcode = '22023';
    end if;
    if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
        raise exception 'evidence must be an object' using errcode = '22023';
    end if;

    select * into v_candidate
    from public.analytics_review_candidates
    where id = p_candidate_id
    for update;

    if not found then
        raise exception 'Review candidate not found' using errcode = 'P0002';
    end if;
    if v_candidate.status <> 'pending' then
        raise exception 'Review candidate has already been decided' using errcode = '22023';
    end if;

    if v_candidate.candidate_type = 'search_alias' then
        v_candidate.proposed_alias := coalesce(
            nullif(trim(p_proposed_alias), ''),
            v_candidate.proposed_alias
        );
        v_candidate.canonical_name := coalesce(
            nullif(trim(p_canonical_name), ''),
            v_candidate.canonical_name
        );
        v_candidate.canonical_cas := coalesce(
            nullif(trim(p_canonical_cas), ''),
            v_candidate.canonical_cas
        );
        if v_candidate.canonical_cas is not null
           and not private.is_valid_cas_number(v_candidate.canonical_cas) then
            raise exception 'Canonical CAS number is invalid' using errcode = '22023';
        end if;
    end if;

    update public.analytics_review_candidates
    set status = p_status,
        proposed_alias = v_candidate.proposed_alias,
        canonical_name = v_candidate.canonical_name,
        canonical_cas = v_candidate.canonical_cas,
        review_notes = nullif(trim(p_notes), ''),
        reviewed_by = p_operator_user_id,
        reviewed_at = now(),
        updated_at = now()
    where id = p_candidate_id
    returning * into v_candidate;

    insert into public.analytics_review_audit_logs (
        candidate_id, action, notes, evidence, operator_user_id
    ) values (
        p_candidate_id, p_status, nullif(trim(p_notes), ''), p_evidence, p_operator_user_id
    );

    if p_status = 'approved' and v_candidate.candidate_type = 'search_alias' then
        if nullif(trim(v_candidate.proposed_alias), '') is null
           or nullif(trim(v_candidate.canonical_name), '') is null then
            raise exception 'Approved alias candidates require an alias and canonical name' using errcode = '22023';
        end if;
        insert into public.global_reagent_aliases (
            alias, normalized_alias, canonical_name, cas_number,
            source_review_id, approved_by
        ) values (
            trim(v_candidate.proposed_alias),
            private.analytics_normalize_query(v_candidate.proposed_alias),
            trim(v_candidate.canonical_name),
            nullif(trim(v_candidate.canonical_cas), ''),
            v_candidate.id,
            p_operator_user_id
        )
        on conflict (normalized_alias) do update set
            alias = excluded.alias,
            canonical_name = excluded.canonical_name,
            cas_number = excluded.cas_number,
            source_review_id = excluded.source_review_id,
            approved_by = excluded.approved_by,
            is_active = true,
            updated_at = now();
    end if;

    return to_jsonb(v_candidate);
end;
$$;


--
-- Name: attach_safety_center_verification_document(uuid, text, text, text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attach_safety_center_verification_document(p_center_id uuid, p_path text, p_name text, p_mime_type text, p_size bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_status text;
    v_expected_prefix text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if nullif(trim(p_path), '') is null
       or nullif(trim(p_name), '') is null
       or nullif(trim(p_mime_type), '') is null
       or coalesce(p_size, 0) <= 0 then
        raise exception 'Verification document metadata is required' using errcode = '22023';
    end if;

    if p_size > 10485760 then
        raise exception 'Verification document must be 10MB or smaller' using errcode = '22023';
    end if;

    if lower(trim(p_mime_type)) not in (
        'application/pdf',
        'application/x-hwp',
        'application/haansofthwp',
        'application/vnd.hancom.hwp',
        'application/vnd.hancom.hwpx',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg'
    ) then
        raise exception 'Unsupported verification document type: %', p_mime_type using errcode = '22023';
    end if;

    if not public.is_safety_center_member(p_center_id, array['owner', 'manager']) then
        raise exception 'Only center owners and managers can attach verification documents' using errcode = '42501';
    end if;

    select sc.status
    into v_status
    from public.safety_centers sc
    where sc.id = p_center_id;

    if not found then
        raise exception 'Safety center not found' using errcode = 'P0002';
    end if;

    if v_status not in ('pending', 'rejected') then
        raise exception 'Verification documents can only be attached before approval' using errcode = '42501';
    end if;

    v_expected_prefix := v_user_id::text || '/' || p_center_id::text || '/';
    if trim(p_path) not like (v_expected_prefix || '%') then
        raise exception 'Verification document path is invalid' using errcode = '42501';
    end if;

    update public.safety_centers
    set
        verification_document_path = trim(p_path),
        verification_document_name = trim(p_name),
        verification_document_mime_type = lower(trim(p_mime_type)),
        verification_document_size = p_size,
        verification_document_uploaded_at = now()
    where id = p_center_id;
end;
$$;


--
-- Name: chemical_enrichment_cache_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chemical_enrichment_cache_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
    new.updated_at = now();
    return new;
end;
$$;


--
-- Name: commerce_intent_events_set_normalized_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.commerce_intent_events_set_normalized_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
    new.brand_normalized := public.analytics_normalize_text(new.brand_name);
    new.cas_number_normalized := public.analytics_normalize_cas(new.cas_number);
    return new;
end;
$$;


--
-- Name: create_inventory_item_atomic(text, text, text, text, text, integer, text, uuid, uuid, uuid, date, text, integer, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_inventory_item_atomic(p_name text, p_storage_type text, p_brand text DEFAULT NULL::text, p_product_number text DEFAULT NULL::text, p_cas_number text DEFAULT NULL::text, p_quantity integer DEFAULT 1, p_capacity text DEFAULT NULL::text, p_cabinet_id uuid DEFAULT NULL::uuid, p_storage_location_id uuid DEFAULT NULL::uuid, p_product_id uuid DEFAULT NULL::uuid, p_expiry_date date DEFAULT NULL::date, p_memo text DEFAULT NULL::text, p_remaining_percent integer DEFAULT 100, p_lab_id uuid DEFAULT NULL::uuid, p_actor_user_id uuid DEFAULT NULL::uuid, p_actor_name text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_new_id uuid;
    v_after_data jsonb;
    v_ref_lab_id uuid;
    v_ref_user_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_actor_user_id is not null and p_actor_user_id is distinct from v_user_id then
        raise exception 'actor_user_id must match the authenticated user' using errcode = '42501';
    end if;

    if nullif(trim(p_name), '') is null or length(trim(p_name)) > 500 then
        raise exception 'Inventory name is required and must be 500 characters or fewer' using errcode = '22023';
    end if;

    if p_storage_type not in ('cabinet', 'other') then
        raise exception 'Unsupported storage type: %', p_storage_type using errcode = '22023';
    end if;

    if coalesce(p_quantity, 1) < 1 or coalesce(p_quantity, 1) > 1000000 then
        raise exception 'quantity must be between 1 and 1000000' using errcode = '22023';
    end if;

    if coalesce(p_remaining_percent, 100) not between 0 and 100 then
        raise exception 'remaining_percent must be between 0 and 100' using errcode = '22023';
    end if;

    if nullif(trim(p_cas_number), '') is not null
       and not private.is_valid_cas_number(trim(p_cas_number)) then
        raise exception 'Invalid CAS Registry Number: %', p_cas_number using errcode = '22023';
    end if;

    if p_lab_id is not null and not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = v_user_id
    ) then
        raise exception 'Access denied for lab %', p_lab_id using errcode = '42501';
    end if;

    if p_storage_type = 'cabinet' then
        if p_cabinet_id is null then
            raise exception 'cabinet_id is required for cabinet storage' using errcode = '22023';
        end if;
        if p_storage_location_id is not null then
            raise exception 'storage_location_id cannot be combined with cabinet storage' using errcode = '22023';
        end if;
    elsif p_cabinet_id is not null then
        raise exception 'cabinet_id is only valid for cabinet storage' using errcode = '22023';
    end if;

    if p_cabinet_id is not null then
        select c.lab_id, c.user_id
        into v_ref_lab_id, v_ref_user_id
        from public.cabinets c
        where c.id = p_cabinet_id;

        if not found then
            raise exception 'Cabinet not found: %', p_cabinet_id using errcode = 'P0002';
        end if;

        if p_lab_id is null then
            if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                raise exception 'Cabinet is outside the personal scope' using errcode = '42501';
            end if;
        elsif v_ref_lab_id is distinct from p_lab_id then
            raise exception 'Cabinet is outside the selected lab' using errcode = '42501';
        end if;
    end if;

    if p_storage_location_id is not null then
        select sl.lab_id, sl.user_id
        into v_ref_lab_id, v_ref_user_id
        from public.storage_locations sl
        where sl.id = p_storage_location_id;

        if not found then
            raise exception 'Storage location not found: %', p_storage_location_id using errcode = 'P0002';
        end if;

        if p_lab_id is null then
            if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                raise exception 'Storage location is outside the personal scope' using errcode = '42501';
            end if;
        elsif v_ref_lab_id is distinct from p_lab_id then
            raise exception 'Storage location is outside the selected lab' using errcode = '42501';
        end if;
    end if;

    insert into public.inventory (
        lab_id,
        user_id,
        name,
        brand,
        product_number,
        cas_number,
        quantity,
        capacity,
        storage_type,
        cabinet_id,
        storage_location_id,
        product_id,
        expiry_date,
        memo,
        remaining_percent
    ) values (
        p_lab_id,
        v_user_id,
        trim(p_name),
        nullif(trim(p_brand), ''),
        nullif(trim(p_product_number), ''),
        nullif(trim(p_cas_number), ''),
        coalesce(p_quantity, 1),
        nullif(trim(p_capacity), ''),
        p_storage_type,
        p_cabinet_id,
        p_storage_location_id,
        p_product_id,
        p_expiry_date,
        nullif(trim(p_memo), ''),
        coalesce(p_remaining_percent, 100)
    )
    returning id into v_new_id;

    select to_jsonb(i.*)
    into v_after_data
    from public.inventory i
    where i.id = v_new_id;

    insert into public.audit_logs (
        actor_user_id,
        actor_name,
        lab_id,
        entity_type,
        entity_id,
        action,
        before_data,
        after_data,
        diff_data,
        source
    ) values (
        v_user_id,
        private.actor_display_name_v2(v_user_id, p_lab_id),
        p_lab_id,
        'inventory',
        v_new_id,
        'create',
        null,
        v_after_data,
        null,
        'rpc'
    );

    return v_after_data;
end;
$$;


--
-- Name: create_inventory_item_with_dates_atomic(text, text, text, text, text, integer, text, uuid, uuid, uuid, date, text, date, date, text, integer, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_inventory_item_with_dates_atomic(p_name text, p_storage_type text, p_brand text DEFAULT NULL::text, p_product_number text DEFAULT NULL::text, p_cas_number text DEFAULT NULL::text, p_quantity integer DEFAULT 1, p_capacity text DEFAULT NULL::text, p_cabinet_id uuid DEFAULT NULL::uuid, p_storage_location_id uuid DEFAULT NULL::uuid, p_product_id uuid DEFAULT NULL::uuid, p_expiry_date date DEFAULT NULL::date, p_manufacturer_date_type text DEFAULT 'unlabeled'::text, p_received_date date DEFAULT NULL::date, p_opened_date date DEFAULT NULL::date, p_memo text DEFAULT NULL::text, p_remaining_percent integer DEFAULT 100, p_lab_id uuid DEFAULT NULL::uuid, p_actor_user_id uuid DEFAULT NULL::uuid, p_actor_name text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_created jsonb;
    v_after_data jsonb;
    v_item_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if coalesce(p_manufacturer_date_type, 'unlabeled') not in ('expiry', 'minimum_shelf_life', 'unlabeled') then
        raise exception 'Unsupported manufacturer_date_type: %', p_manufacturer_date_type using errcode = '22023';
    end if;

    v_created := public.create_inventory_item_atomic(
        p_name, p_storage_type, p_brand, p_product_number, p_cas_number,
        p_quantity, p_capacity, p_cabinet_id, p_storage_location_id,
        p_product_id,
        case when coalesce(p_manufacturer_date_type, 'unlabeled') = 'unlabeled' then null else p_expiry_date end,
        p_memo, p_remaining_percent, p_lab_id, p_actor_user_id, p_actor_name
    );
    v_item_id := (v_created->>'id')::uuid;

    update public.inventory
    set manufacturer_date_type = coalesce(p_manufacturer_date_type, 'unlabeled'),
        expiry_date = case
            when coalesce(p_manufacturer_date_type, 'unlabeled') = 'unlabeled' then null
            else p_expiry_date
        end,
        received_date = p_received_date,
        opened_date = p_opened_date,
        updated_at = now()
    where id = v_item_id;

    select to_jsonb(i.*) into v_after_data
    from public.inventory i
    where i.id = v_item_id;

    -- The legacy create audit remains authoritative for identity and scope.
    -- This additional event keeps all newly introduced date fields visible.
    if v_after_data is distinct from v_created then
        insert into public.audit_logs (
            actor_user_id, actor_name, lab_id, entity_type, entity_id, action,
            before_data, after_data, diff_data, source
        ) values (
            v_user_id, private.actor_display_name_v2(v_user_id, p_lab_id), p_lab_id,
            'inventory', v_item_id, 'update', v_created, v_after_data,
            jsonb_build_object(
                'manufacturer_date_type', jsonb_build_object('from', v_created->'manufacturer_date_type', 'to', v_after_data->'manufacturer_date_type'),
                'received_date', jsonb_build_object('from', v_created->'received_date', 'to', v_after_data->'received_date'),
                'opened_date', jsonb_build_object('from', v_created->'opened_date', 'to', v_after_data->'opened_date')
            ),
            'rpc'
        );
    end if;

    return v_after_data;
end;
$$;


--
-- Name: create_lab_secure(text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_lab_secure(p_name text, p_password text DEFAULT NULL::text, p_nickname text DEFAULT NULL::text, p_institution_type text DEFAULT NULL::text, p_research_field text DEFAULT NULL::text, p_institution_name text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_lab_id uuid;
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    insert into public.labs (
        name,
        join_password,
        created_by,
        institution_type,
        research_field,
        institution_name
    ) values (
        p_name,
        nullif(p_password, ''),
        v_user_id,
        nullif(p_institution_type, ''),
        nullif(p_research_field, ''),
        nullif(trim(p_institution_name), '')
    )
    returning id into v_lab_id;

    insert into public.lab_members (lab_id, user_id, role, nickname)
    values (v_lab_id, v_user_id, 'admin', nullif(p_nickname, ''));

    return jsonb_build_object(
        'success', true,
        'lab_id', v_lab_id,
        'message', 'Lab successfully created'
    );
exception
    when others then
        return jsonb_build_object(
            'success', false,
            'error', sqlerrm
        );
end;
$$;


--
-- Name: create_safety_center(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_safety_center(p_institution_name text, p_institution_domain text, p_center_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_center_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if nullif(trim(p_institution_name), '') is null
       or nullif(trim(p_institution_domain), '') is null
       or nullif(trim(p_center_name), '') is null then
        raise exception 'Institution name, domain, and center name are required' using errcode = '22023';
    end if;

    insert into public.safety_centers (
        institution_name,
        institution_domain,
        center_name,
        status,
        created_by
    ) values (
        trim(p_institution_name),
        lower(trim(p_institution_domain)),
        trim(p_center_name),
        'pending',
        v_user_id
    )
    returning id into v_center_id;

    insert into public.safety_center_members (center_id, user_id, role)
    values (v_center_id, v_user_id, 'owner');

    return v_center_id;
end;
$$;


--
-- Name: create_safety_center_request(uuid, uuid, text, text, text, date, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_safety_center_request(p_center_id uuid, p_lab_id uuid, p_title text, p_description text DEFAULT NULL::text, p_priority text DEFAULT 'normal'::text, p_due_date date DEFAULT NULL::date, p_target_type text DEFAULT NULL::text, p_target_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_request_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id, array['owner', 'manager']) then
        raise exception 'Only center owners and managers can create requests' using errcode = '42501';
    end if;

    if not exists (
        select 1
        from public.safety_center_lab_links scl
        where scl.center_id = p_center_id
          and scl.lab_id = p_lab_id
          and scl.status = 'approved'
    ) then
        raise exception 'Request target lab is not approved for this center' using errcode = '42501';
    end if;

    insert into public.safety_center_requests (
        center_id,
        lab_id,
        target_type,
        target_id,
        title,
        description,
        priority,
        due_date,
        created_by
    ) values (
        p_center_id,
        p_lab_id,
        nullif(p_target_type, ''),
        p_target_id,
        p_title,
        nullif(p_description, ''),
        coalesce(nullif(p_priority, ''), 'normal'),
        p_due_date,
        v_user_id
    )
    returning id into v_request_id;

    insert into public.safety_center_request_events (
        request_id,
        actor_user_id,
        actor_scope,
        event_type,
        to_status,
        body
    ) values (
        v_request_id,
        v_user_id,
        'center',
        'created',
        'open',
        nullif(p_description, '')
    );

    return v_request_id;
end;
$$;


--
-- Name: delete_inventory_item_atomic(uuid, text, text, uuid, uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_inventory_item_atomic(p_item_id uuid, p_item_source text, p_item_name text, p_lab_id uuid DEFAULT NULL::uuid, p_cabinet_id uuid DEFAULT NULL::uuid, p_cabinet_name text DEFAULT NULL::text, p_storage_location_name text DEFAULT NULL::text, p_disposal_reason text DEFAULT 'Deleted from inventory list'::text, p_actor_name text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_lab_id uuid;
    v_owner_user_id uuid;
    v_cabinet_id uuid;
    v_linked_inventory_item_id uuid;
    v_before_data jsonb;
    v_item_name text;
    v_location text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_item_source not in ('inventory', 'cabinet_item') then
        raise exception 'Unsupported item source: %', p_item_source using errcode = '22023';
    end if;

    if p_item_source = 'inventory' then
        select to_jsonb(i.*), i.name, i.lab_id, i.user_id, i.cabinet_id
        into v_before_data, v_item_name, v_lab_id, v_owner_user_id, v_cabinet_id
        from public.inventory i
        where i.id = p_item_id
        for update;

        if not found then
            raise exception 'Inventory item not found: %', p_item_id using errcode = 'P0002';
        end if;

        if p_lab_id is distinct from v_lab_id then
            raise exception 'Requested lab scope does not match the inventory row' using errcode = '42501';
        end if;
        if p_cabinet_id is not null and p_cabinet_id is distinct from v_cabinet_id then
            raise exception 'Requested cabinet does not match the inventory row' using errcode = '42501';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for inventory item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        if v_cabinet_id is not null then
            delete from public.cabinet_items ci
            where ci.inventory_item_id = p_item_id
              and ci.cabinet_id = v_cabinet_id;

            insert into public.cabinet_activity_logs (
                cabinet_id,
                action_type,
                item_name,
                reason,
                performed_by
            ) values (
                v_cabinet_id,
                'remove',
                v_item_name,
                coalesce(nullif(trim(p_disposal_reason), ''), 'Deleted from inventory list'),
                v_user_id
            );
        end if;

        delete from public.inventory where id = p_item_id;
        v_location := coalesce(nullif(trim(p_cabinet_name), ''), nullif(trim(p_storage_location_name), ''), 'Inventory');
    else
        select to_jsonb(ci.*), ci.name, ci.cabinet_id, ci.inventory_item_id
        into v_before_data, v_item_name, v_cabinet_id, v_linked_inventory_item_id
        from public.cabinet_items ci
        where ci.id = p_item_id
        for update;

        if not found then
            raise exception 'Cabinet item not found: %', p_item_id using errcode = 'P0002';
        end if;

        select c.lab_id, c.user_id
        into v_lab_id, v_owner_user_id
        from public.cabinets c
        where c.id = v_cabinet_id;

        if not found then
            raise exception 'Cabinet not found: %', v_cabinet_id using errcode = 'P0002';
        end if;

        if p_lab_id is distinct from v_lab_id then
            raise exception 'Requested lab scope does not match the cabinet row' using errcode = '42501';
        end if;
        if p_cabinet_id is not null and p_cabinet_id is distinct from v_cabinet_id then
            raise exception 'Requested cabinet does not match the cabinet item' using errcode = '42501';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for cabinet item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        if v_linked_inventory_item_id is not null then
            perform 1
            from public.inventory i
            where i.id = v_linked_inventory_item_id
              and i.lab_id is not distinct from v_lab_id
              and (
                  v_lab_id is not null
                  or i.user_id = v_user_id
              )
            for update;

            if not found then
                raise exception 'Linked inventory item is outside the cabinet scope' using errcode = '42501';
            end if;
        end if;

        delete from public.cabinet_items where id = p_item_id;

        if v_linked_inventory_item_id is not null then
            delete from public.inventory where id = v_linked_inventory_item_id;
        end if;

        insert into public.cabinet_activity_logs (
            cabinet_id,
            action_type,
            item_name,
            reason,
            performed_by
        ) values (
            v_cabinet_id,
            'remove',
            v_item_name,
            coalesce(nullif(trim(p_disposal_reason), ''), 'Deleted from inventory list'),
            v_user_id
        );

        v_location := coalesce(nullif(trim(p_cabinet_name), ''), 'Cabinet');
    end if;

    insert into public.audit_logs (
        actor_user_id,
        actor_name,
        lab_id,
        entity_type,
        entity_id,
        action,
        location_context,
        before_data,
        source
    ) values (
        v_user_id,
        private.actor_display_name_v2(v_user_id, v_lab_id),
        v_lab_id,
        p_item_source,
        p_item_id,
        'delete',
        v_location,
        v_before_data || jsonb_build_object(
            'client_item_name', p_item_name,
            'deletion_reason', coalesce(nullif(trim(p_disposal_reason), ''), 'Deleted from inventory list')
        ),
        'rpc'
    );

    -- Intentionally no waste_logs or cabinet_disposal_logs insert here. A
    -- database-record deletion is not evidence of physical waste handling.
end;
$$;


--
-- Name: FUNCTION delete_inventory_item_atomic(p_item_id uuid, p_item_source text, p_item_name text, p_lab_id uuid, p_cabinet_id uuid, p_cabinet_name text, p_storage_location_name text, p_disposal_reason text, p_actor_name text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.delete_inventory_item_atomic(p_item_id uuid, p_item_source text, p_item_name text, p_lab_id uuid, p_cabinet_id uuid, p_cabinet_name text, p_storage_location_name text, p_disposal_reason text, p_actor_name text) IS 'Deletes an inventory/cabinet record with scope checks and audit logging. Does not create a physical waste-disposal record.';


--
-- Name: delete_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_user() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;


--
-- Name: enforce_lab_creation_membership_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_lab_creation_membership_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    membership_count integer;
    max_memberships constant integer := 3;
    owner_user_id uuid;
begin
    owner_user_id := coalesce(new.created_by, auth.uid());

    if owner_user_id is null then
        return new;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(owner_user_id::text, 0));

    select count(*)
    into membership_count
    from public.lab_members lm
    where lm.user_id = owner_user_id;

    if membership_count >= max_memberships then
        raise exception 'max_lab_memberships_exceeded: each account may join up to % labs, including admin-owned labs.', max_memberships
            using errcode = 'P0001',
                  hint = 'Leave or delete another lab before joining or creating a new one.';
    end if;

    return new;
end;
$$;


--
-- Name: enforce_lab_membership_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_lab_membership_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    membership_count integer;
    max_memberships constant integer := 3;
begin
    if new.user_id is null then
        return new;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

    if tg_op = 'UPDATE' then
        select count(*)
        into membership_count
        from public.lab_members lm
        where lm.user_id = new.user_id
          and lm.id <> old.id;
    else
        select count(*)
        into membership_count
        from public.lab_members lm
        where lm.user_id = new.user_id;
    end if;

    if membership_count >= max_memberships then
        raise exception 'max_lab_memberships_exceeded: each account may join up to % labs, including admin-owned labs.', max_memberships
            using errcode = 'P0001',
                  hint = 'Leave or delete another lab before joining or creating a new one.';
    end if;

    return new;
end;
$$;


--
-- Name: get_active_waste_policy_v2(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_waste_policy_v2(p_lab_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_result jsonb;
    v_institution_policy_count integer;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_lab_id is not null and not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = v_user_id
    ) then
        raise exception 'Access denied for lab %', p_lab_id using errcode = '42501';
    end if;

    -- A lab link must explicitly delegate waste-management policy authority.
    -- Generic summary/risk-detail access is not sufficient to change the
    -- destination policy used for a physical disposal decision.
    select count(distinct pv.id)
    into v_institution_policy_count
    from public.waste_policy_versions pv
    join public.safety_center_lab_links scl
      on scl.center_id = pv.safety_center_id
     and scl.lab_id = p_lab_id
     and scl.status = 'approved'
     and 'waste_management' = any(scl.scope)
    join public.safety_centers sc
      on sc.id = pv.safety_center_id
     and sc.status = 'approved'
    where p_lab_id is not null
      and pv.scope_type = 'safety_center'
      and pv.status = 'active';

    if v_institution_policy_count > 1 then
        raise exception
            'Multiple active safety-center waste policies are linked to lab %; resolve the waste_management policy authority before continuing',
            p_lab_id
            using errcode = 'P0003';
    end if;

    with candidate_versions as (
        select pv.id, pv.scope_type, pv.activated_at, 10 as priority
        from public.waste_policy_versions pv
        where pv.scope_type = 'system'
          and pv.status = 'active'

        union all

        select pv.id, pv.scope_type, pv.activated_at, 20 as priority
        from public.waste_policy_versions pv
        join public.safety_center_lab_links scl
          on scl.center_id = pv.safety_center_id
         and scl.lab_id = p_lab_id
         and scl.status = 'approved'
         and 'waste_management' = any(scl.scope)
        join public.safety_centers sc
          on sc.id = pv.safety_center_id
         and sc.status = 'approved'
        where p_lab_id is not null
          and pv.scope_type = 'safety_center'
          and pv.status = 'active'

    ),
    ranked_streams as (
        select distinct on (ps.stream_code)
            ps.stream_code,
            ps.display_name_ko,
            ps.display_name_en,
            ps.description_ko,
            coalesce(nullif(trim(lo.container_label), ''), ps.container_label) as container_label,
            coalesce(nullif(trim(lo.container_color), ''), ps.container_color) as container_color,
            coalesce(
                nullif(trim(lo.replacement_location), ''),
                nullif(trim(lo.location), ''),
                ps.location
            ) as location,
            coalesce(nullif(trim(lo.handler_contact), ''), ps.handler_contact) as handler_contact,
            ps.container_label as inherited_container_label,
            ps.container_color as inherited_container_color,
            ps.location as inherited_location,
            ps.handler_contact as inherited_handler_contact,
            lo.id as lab_override_id,
            lo.container_label as lab_container_label,
            lo.container_color as lab_container_color,
            lo.location as lab_location,
            lo.handler_contact as lab_handler_contact,
            lo.replacement_location,
            lo.updated_at as lab_override_updated_at,
            ps.sop_url,
            ps.allowed_hazard_flags,
            ps.blocked_hazard_flags,
            ps.prohibitions,
            ps.label_requirements,
            ps.is_enabled,
            coalesce(lo.is_disabled, false) as is_disabled,
            (
                not coalesce(lo.is_disabled, false)
                or nullif(trim(lo.replacement_location), '') is not null
            ) as effective_is_enabled,
            ps.policy_version_id,
            cv.scope_type,
            pv.source_refs,
            cv.priority,
            cv.activated_at,
            ps.sort_order
        from candidate_versions cv
        join public.waste_policy_versions pv on pv.id = cv.id
        join public.waste_policy_streams ps on ps.policy_version_id = cv.id
        left join public.waste_policy_lab_overrides lo
          on lo.lab_id = p_lab_id
         and lo.stream_code = ps.stream_code
        order by
            ps.stream_code,
            cv.priority desc,
            cv.activated_at desc nulls last,
            ps.policy_version_id
    )
    select jsonb_build_object(
        'systemPolicyVersionId', (
            select cv.id
            from candidate_versions cv
            where cv.scope_type = 'system'
            order by cv.activated_at desc nulls last
            limit 1
        ),
        'institutionPolicyVersionId', (
            select cv.id
            from candidate_versions cv
            where cv.scope_type = 'safety_center'
            order by cv.activated_at desc nulls last
            limit 1
        ),
        -- Labs may overlay physical container details, but never activate a
        -- safety-rule policy that outranks the institution/system policy.
        'labPolicyVersionId', null,
        'resolvedStreams', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'streamCode', rs.stream_code,
                    'displayNameKo', rs.display_name_ko,
                    'displayNameEn', rs.display_name_en,
                    'descriptionKo', rs.description_ko,
                    'containerLabel', rs.container_label,
                    'containerColor', rs.container_color,
                    'location', rs.location,
                    'handlerContact', rs.handler_contact,
                    'sopUrl', rs.sop_url,
                    'allowedHazardFlags', to_jsonb(rs.allowed_hazard_flags),
                    'blockedHazardFlags', to_jsonb(rs.blocked_hazard_flags),
                    'prohibitions', to_jsonb(rs.prohibitions),
                    'labelRequirements', to_jsonb(rs.label_requirements),
                    'policyVersionId', rs.policy_version_id,
                    'policyScope', rs.scope_type,
                    'sourceRefs', rs.source_refs,
                    'isEnabled', rs.effective_is_enabled,
                    'inheritedPhysical', jsonb_build_object(
                        'containerLabel', rs.inherited_container_label,
                        'containerColor', rs.inherited_container_color,
                        'location', rs.inherited_location,
                        'handlerContact', rs.inherited_handler_contact
                    ),
                    'labOverride', case
                        when rs.lab_override_id is null then null
                        else jsonb_build_object(
                            'id', rs.lab_override_id,
                            'containerLabel', rs.lab_container_label,
                            'containerColor', rs.lab_container_color,
                            'location', rs.lab_location,
                            'handlerContact', rs.lab_handler_contact,
                            'replacementLocation', rs.replacement_location,
                            'isDisabled', rs.is_disabled,
                            'updatedAt', rs.lab_override_updated_at
                        )
                    end
                )
                order by rs.sort_order, rs.stream_code
            )
            from ranked_streams rs
            where rs.is_enabled
        ), '[]'::jsonb)
    )
    into v_result;

    return v_result;
end;
$$;


--
-- Name: get_cabinet_activity_logs(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_cabinet_activity_logs(target_cabinet_id uuid) RETURNS TABLE(id uuid, cabinet_id uuid, action_type text, item_name text, reason text, memo text, performed_by uuid, performed_by_nickname text, performed_by_email text, performed_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT
        al.id,
        al.cabinet_id,
        al.action_type,
        al.item_name,
        al.reason,
        al.memo,
        al.performed_by,
        COALESCE(lm.nickname, au.email, '알 수 없음') AS performed_by_nickname,
        au.email AS performed_by_email,
        al.performed_at
    FROM public.cabinet_activity_logs al
    LEFT JOIN auth.users au ON au.id = al.performed_by
    LEFT JOIN public.lab_members lm ON lm.user_id = al.performed_by
        AND lm.lab_id = (SELECT c.lab_id FROM public.cabinets c WHERE c.id = target_cabinet_id LIMIT 1)
    WHERE al.cabinet_id = target_cabinet_id
    ORDER BY al.performed_at DESC
    LIMIT 200;
$$;


--
-- Name: get_cabinet_audit_logs(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_cabinet_audit_logs(p_cabinet_id uuid, p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, created_at timestamp with time zone, actor_user_id uuid, actor_name text, lab_id uuid, entity_type text, entity_id uuid, action text, location_context text, before_data jsonb, after_data jsonb, diff_data jsonb, source text, request_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    return query
    select
        a.id, a.created_at, a.actor_user_id, a.actor_name, a.lab_id, a.entity_type, a.entity_id,
        a.action, a.location_context, a.before_data, a.after_data, a.diff_data, a.source, a.request_id
    from public.audit_logs a
    where (a.entity_type = 'cabinet_item' and ((a.before_data->>'cabinet_id') = p_cabinet_id::text or (a.after_data->>'cabinet_id') = p_cabinet_id::text))
       or (a.entity_type = 'inventory' and ((a.before_data->>'cabinet_id') = p_cabinet_id::text or (a.after_data->>'cabinet_id') = p_cabinet_id::text))
       or (a.entity_type = 'cabinet' and a.entity_id = p_cabinet_id)
    order by a.created_at desc
    limit p_limit;
end;
$$;


--
-- Name: get_cabinet_disposal_logs(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_cabinet_disposal_logs(target_cabinet_id uuid) RETURNS TABLE(id uuid, cabinet_id uuid, item_name text, reason text, memo text, disposed_by uuid, disposed_at timestamp with time zone, disposed_by_email character varying, disposed_by_nickname text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        l.id,
        l.cabinet_id,
        l.item_name,
        l.reason,
        l.memo,
        l.disposed_by,
        l.disposed_at,
        au.email::VARCHAR as disposed_by_email,
        lm.nickname as disposed_by_nickname
    FROM public.cabinet_disposal_logs l
    LEFT JOIN auth.users au ON au.id = l.disposed_by
    LEFT JOIN public.cabinets c ON c.id = l.cabinet_id
    LEFT JOIN public.lab_members lm ON lm.user_id = l.disposed_by AND (lm.lab_id = c.lab_id OR c.lab_id IS NULL)
    WHERE l.cabinet_id = target_cabinet_id
    ORDER BY l.disposed_at DESC;
END;
$$;


--
-- Name: get_lab_members(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lab_members(target_lab_id uuid) RETURNS TABLE(user_id uuid, role text, joined_at timestamp with time zone, email character varying, nickname text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.lab_members
        WHERE lab_id = target_lab_id
        AND public.lab_members.user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not authorized to view members of this lab';
    END IF;

    RETURN QUERY
    SELECT
        lm.user_id,
        lm.role,
        lm.joined_at,
        au.email::VARCHAR,
        lm.nickname
    FROM public.lab_members lm
    LEFT JOIN auth.users au ON au.id = lm.user_id
    WHERE lm.lab_id = target_lab_id
    ORDER BY lm.joined_at ASC;
END;
$$;


--
-- Name: get_lab_safety_center_link_requests(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lab_safety_center_link_requests(p_lab_id uuid) RETURNS TABLE(link_id uuid, center_id uuid, center_name text, institution_name text, institution_domain text, center_status text, link_status text, link_scope text[], requested_at timestamp with time zone, responded_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_lab_admin(p_lab_id) then
        raise exception 'Only lab admins can view center link requests' using errcode = '42501';
    end if;

    return query
    select
        scl.id,
        sc.id,
        sc.center_name,
        sc.institution_name,
        sc.institution_domain,
        sc.status,
        scl.status,
        scl.scope,
        scl.requested_at,
        scl.responded_at
    from public.safety_center_lab_links scl
    join public.safety_centers sc on sc.id = scl.center_id
    where scl.lab_id = p_lab_id
    order by scl.requested_at desc;
end;
$$;


--
-- Name: get_lab_safety_center_requests(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lab_safety_center_requests(p_lab_id uuid) RETURNS TABLE(id uuid, center_id uuid, center_name text, lab_id uuid, target_type text, target_id uuid, title text, description text, priority text, status text, due_date date, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = auth.uid()
    ) then
        raise exception 'Access denied for lab %', p_lab_id using errcode = '42501';
    end if;

    return query
    select
        r.id,
        r.center_id,
        sc.center_name,
        r.lab_id,
        r.target_type,
        r.target_id,
        r.title,
        r.description,
        r.priority,
        r.status,
        r.due_date,
        r.created_at,
        r.updated_at
    from public.safety_center_requests r
    join public.safety_centers sc on sc.id = r.center_id
    where r.lab_id = p_lab_id
    order by r.created_at desc;
end;
$$;


--
-- Name: get_my_safety_centers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_safety_centers() RETURNS TABLE(id uuid, institution_name text, institution_domain text, center_name text, status text, created_by uuid, approved_at timestamp with time zone, created_at timestamp with time zone, member_role text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    return query
    select
        sc.id,
        sc.institution_name,
        sc.institution_domain,
        sc.center_name,
        sc.status,
        sc.created_by,
        sc.approved_at,
        sc.created_at,
        scm.role as member_role
    from public.safety_center_members scm
    join public.safety_centers sc on sc.id = scm.center_id
    where scm.user_id = auth.uid()
    order by sc.created_at desc;
end;
$$;


--
-- Name: get_safety_center_audit_logs(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_safety_center_audit_logs(p_center_id uuid, p_limit integer DEFAULT 100) RETURNS TABLE(id uuid, lab_id uuid, lab_name text, created_at timestamp with time zone, actor_name text, entity_type text, entity_id uuid, action text, location_context text, before_data jsonb, after_data jsonb, diff_data jsonb, source text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    return query
    select
        a.id,
        a.lab_id,
        l.name,
        a.created_at,
        a.actor_name,
        a.entity_type,
        a.entity_id,
        a.action,
        a.location_context,
        a.before_data,
        a.after_data,
        a.diff_data,
        a.source
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.audit_logs a on a.lab_id = scl.lab_id
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'summary' = any(scl.scope)
    order by a.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end;
$$;


--
-- Name: get_safety_center_lab_candidates(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_safety_center_lab_candidates(p_center_id uuid, p_search text DEFAULT ''::text) RETURNS TABLE(lab_id uuid, lab_name text, institution_name text, institution_type text, research_field text, created_at timestamp with time zone, link_id uuid, link_status text, link_scope text[], requested_at timestamp with time zone, responded_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_institution_name text;
    v_status text;
    v_search text := '%' || coalesce(trim(p_search), '') || '%';
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    select sc.institution_name, sc.status
    into v_institution_name, v_status
    from public.safety_centers sc
    where sc.id = p_center_id;

    if v_status <> 'approved' then
        return;
    end if;

    return query
    select
        l.id,
        l.name,
        l.institution_name,
        l.institution_type,
        l.research_field,
        l.created_at,
        scl.id,
        scl.status,
        scl.scope,
        scl.requested_at,
        scl.responded_at
    from public.labs l
    left join public.safety_center_lab_links scl
      on scl.center_id = p_center_id
     and scl.lab_id = l.id
    where lower(coalesce(l.institution_name, '')) = lower(v_institution_name)
      and (
          coalesce(trim(p_search), '') = ''
          or l.name ilike v_search
          or coalesce(l.research_field, '') ilike v_search
      )
    order by
        case coalesce(scl.status, 'unlinked')
            when 'approved' then 0
            when 'requested' then 1
            when 'rejected' then 2
            when 'revoked' then 3
            else 4
        end,
        l.name asc
    limit 200;
end;
$$;


--
-- Name: get_safety_center_requests(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_safety_center_requests(p_center_id uuid) RETURNS TABLE(id uuid, center_id uuid, lab_id uuid, lab_name text, target_type text, target_id uuid, title text, description text, priority text, status text, due_date date, created_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    return query
    select
        r.id,
        r.center_id,
        r.lab_id,
        l.name,
        r.target_type,
        r.target_id,
        r.title,
        r.description,
        r.priority,
        r.status,
        r.due_date,
        r.created_by,
        r.created_at,
        r.updated_at
    from public.safety_center_requests r
    join public.labs l on l.id = r.lab_id
    join public.safety_center_lab_links scl
      on scl.center_id = r.center_id
     and scl.lab_id = r.lab_id
     and scl.status = 'approved'
    where r.center_id = p_center_id
    order by
        case r.status
            when 'open' then 0
            when 'in_progress' then 1
            when 'submitted' then 2
            else 3
        end,
        r.created_at desc;
end;
$$;


--
-- Name: get_safety_center_risk_items(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_safety_center_risk_items(p_center_id uuid) RETURNS TABLE(source_type text, item_id uuid, lab_id uuid, lab_name text, inventory_name text, brand text, product_number text, cas_number text, quantity integer, capacity text, storage_type text, cabinet_name text, storage_location_name text, expiry_date date, manufacturer_date_type text, received_date date, opened_date date, remaining_percent integer, ghs_h_codes text[], ghs_data_status text, ghs_fetched_at timestamp with time zone, ghs_expires_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    return query
    select
        'inventory'::text, i.id, i.lab_id, l.name, i.name, i.brand,
        i.product_number, i.cas_number, i.quantity, i.capacity, i.storage_type,
        c.name, sl.name,
        case when i.manufacturer_date_type in ('expiry', 'minimum_shelf_life') then i.expiry_date else null end,
        i.manufacturer_date_type, i.received_date, i.opened_date,
        i.remaining_percent,
        coalesce(array(select jsonb_array_elements_text(coalesce(ghs.result -> 'hCodes', '[]'::jsonb))), array[]::text[]),
        ghs.cache_status, ghs.fetched_at, ghs.expires_at, i.created_at, i.updated_at
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.inventory i on i.lab_id = scl.lab_id
    left join public.cabinets c on c.id = i.cabinet_id
    left join public.storage_locations sl on sl.id = i.storage_location_id
    left join lateral (
        select gc.result, gc.cache_status, gc.fetched_at, gc.expires_at, gc.updated_at
        from public.ghs_cas_cache gc
        where gc.scope_type = 'lab'
          and gc.scope_id = i.lab_id
          and gc.cas_number = regexp_replace(coalesce(i.cas_number, ''), '\s+', '', 'g')
          and gc.expires_at > now()
        order by gc.updated_at desc
        limit 1
    ) ghs on true
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'risk_detail' = any(scl.scope)

    union all

    select
        'cabinet_item'::text, ci.id, c.lab_id, l.name, ci.name, ci.brand,
        ci.product_number, ci.cas_no, 1, ci.capacity, 'cabinet'::text,
        c.name, null::text,
        case when ci.manufacturer_date_type in ('expiry', 'minimum_shelf_life') then ci.expiry_date else null end,
        ci.manufacturer_date_type, ci.received_date, ci.opened_date,
        ci.remaining_percent,
        coalesce(array(select jsonb_array_elements_text(coalesce(ghs.result -> 'hCodes', '[]'::jsonb))), array[]::text[]),
        ghs.cache_status, ghs.fetched_at, ghs.expires_at, ci.created_at, ci.created_at
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.cabinets c on c.lab_id = scl.lab_id
    join public.cabinet_items ci on ci.cabinet_id = c.id
    left join lateral (
        select gc.result, gc.cache_status, gc.fetched_at, gc.expires_at, gc.updated_at
        from public.ghs_cas_cache gc
        where gc.scope_type = 'lab'
          and gc.scope_id = c.lab_id
          and gc.cas_number = regexp_replace(coalesce(ci.cas_no, ''), '\s+', '', 'g')
          and gc.expires_at > now()
        order by gc.updated_at desc
        limit 1
    ) ghs on true
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'risk_detail' = any(scl.scope)
      and ci.inventory_item_id is null
    order by updated_at desc;
end;
$$;


--
-- Name: get_safety_center_waste_logs(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_safety_center_waste_logs(p_center_id uuid, p_created_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_created_before timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(id uuid, lab_id uuid, lab_name text, created_at timestamp with time zone, disposal_category text, total_volume_ml numeric, handler_name text, memo text, chemicals jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    return query
    select
        wl.id,
        wl.lab_id,
        l.name,
        wl.created_at,
        wl.disposal_category,
        wl.total_volume_ml,
        wl.handler_name,
        wl.memo,
        wl.chemicals
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.waste_logs wl on wl.lab_id = scl.lab_id
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'summary' = any(scl.scope)
      and (p_created_after is null or wl.created_at >= p_created_after)
      and (p_created_before is null or wl.created_at <= p_created_before)
    order by wl.created_at desc
    limit 5000;
end;
$$;


--
-- Name: ghs_cas_cache_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ghs_cas_cache_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
    new.updated_at = now();
    new.updated_by = auth.uid();
    return new;
end;
$$;


--
-- Name: insert_audit_log_rpc(uuid, text, uuid, text, uuid, text, text, jsonb, jsonb, jsonb, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.insert_audit_log_rpc(p_actor_user_id uuid, p_actor_name text, p_lab_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_location_context text DEFAULT NULL::text, p_before_data jsonb DEFAULT NULL::jsonb, p_after_data jsonb DEFAULT NULL::jsonb, p_diff_data jsonb DEFAULT NULL::jsonb, p_source text DEFAULT 'ui'::text, p_request_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    insert into public.audit_logs (
        actor_user_id,
        actor_name,
        lab_id,
        entity_type,
        entity_id,
        action,
        location_context,
        before_data,
        after_data,
        diff_data,
        source,
        request_id
    ) values (
        p_actor_user_id,
        p_actor_name,
        p_lab_id,
        p_entity_type,
        p_entity_id,
        p_action,
        p_location_context,
        p_before_data,
        p_after_data,
        p_diff_data,
        p_source,
        p_request_id
    );
end;
$$;


--
-- Name: is_lab_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_lab_admin(target_lab_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    select exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = target_lab_id
          and lm.user_id = auth.uid()
          and lm.role = 'admin'
    );
$$;


--
-- Name: is_safety_center_member(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_safety_center_member(target_center_id uuid, allowed_roles text[] DEFAULT NULL::text[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    select exists (
        select 1
        from public.safety_center_members scm
        where scm.center_id = target_center_id
          and scm.user_id = auth.uid()
          and (allowed_roles is null or scm.role = any(allowed_roles))
    );
$$;


--
-- Name: join_lab(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_lab(p_lab_id uuid, p_password text, p_nickname text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_lab_id uuid;
    v_password_hash text;
    v_legacy_password text;
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        return jsonb_build_object('success', false, 'error', 'Unauthenticated');
    end if;

    select id, join_password_hash, join_password
    into v_lab_id, v_password_hash, v_legacy_password
    from public.labs
    where id = p_lab_id;

    if v_lab_id is null then
        return jsonb_build_object('success', false, 'error', 'Lab not found');
    end if;

    if v_password_hash is not null then
        if v_password_hash <> extensions.crypt(coalesce(p_password, ''), v_password_hash) then
            return jsonb_build_object('success', false, 'error', 'Incorrect password');
        end if;
    elsif nullif(v_legacy_password, '') is not null then
        if v_legacy_password <> coalesce(p_password, '') then
            return jsonb_build_object('success', false, 'error', 'Incorrect password');
        end if;
    end if;

    if exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = v_user_id
    ) then
        return jsonb_build_object('success', false, 'error', 'Already a member');
    end if;

    insert into public.lab_members (lab_id, user_id, role, nickname)
    values (p_lab_id, v_user_id, 'student', nullif(p_nickname, ''));

    return jsonb_build_object('success', true, 'lab_id', p_lab_id);
end;
$$;


--
-- Name: join_lab_with_password(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_lab_with_password(target_lab_id uuid, joining_user_id uuid, requested_role text, provided_password text, p_nickname text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    actual_password TEXT;
BEGIN
    SELECT join_password INTO actual_password
    FROM public.labs
    WHERE id = target_lab_id;

    -- 연구실에 비밀번호가 설정된 경우
    IF actual_password IS NOT NULL AND actual_password <> '' THEN
        IF provided_password IS NULL OR provided_password = '' OR provided_password <> actual_password THEN
            RAISE EXCEPTION 'Incorrect password';
        END IF;
    END IF;

    -- 역할 검증 추가
    IF requested_role NOT IN ('pi', 'postdoc', 'graduate', 'undergrad', 'researcher', 'student') THEN
        RAISE EXCEPTION 'Invalid role provided: %', requested_role;
    END IF;

    INSERT INTO public.lab_members (lab_id, user_id, role, nickname)
    VALUES (target_lab_id, joining_user_id, requested_role, p_nickname);

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'User is already a member of this lab';
    WHEN OTHERS THEN
        RAISE EXCEPTION '%', SQLERRM;
END;
$$;


--
-- Name: leave_lab(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leave_lab(target_lab_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    my_role TEXT;
    admin_count INT;
BEGIN
    -- 내 역할 확인
    SELECT role INTO my_role
    FROM public.lab_members
    WHERE lab_id = target_lab_id AND user_id = auth.uid();

    IF my_role IS NULL THEN
        RAISE EXCEPTION 'You are not a member of this lab';
    END IF;

    -- admin인 경우 다른 admin이 있는지 확인
    IF my_role = 'admin' THEN
        SELECT COUNT(*) INTO admin_count
        FROM public.lab_members
        WHERE lab_id = target_lab_id AND role = 'admin';

        IF admin_count <= 1 THEN
            RAISE EXCEPTION 'Admin cannot leave: transfer admin rights to another member first';
        END IF;
    END IF;

    DELETE FROM public.lab_members
    WHERE lab_id = target_lab_id AND user_id = auth.uid();

    RETURN jsonb_build_object('success', true);
END;
$$;


--
-- Name: log_safety_center_export(uuid, text, text[], uuid[], jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_safety_center_export(p_center_id uuid, p_format text, p_datasets text[], p_lab_ids uuid[] DEFAULT ARRAY[]::uuid[], p_filters jsonb DEFAULT '{}'::jsonb, p_row_count integer DEFAULT 0) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_export_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id, array['owner', 'manager']) then
        raise exception 'Only center owners and managers can export data' using errcode = '42501';
    end if;

    if p_format not in ('xlsx', 'pdf') then
        raise exception 'Unsupported export format: %', p_format using errcode = '22023';
    end if;

    if exists (
        select 1
        from unnest(coalesce(p_datasets, array[]::text[])) as selected_dataset(dataset_name)
        where selected_dataset.dataset_name not in ('risks', 'waste', 'audit')
    ) then
        raise exception 'Unsupported export dataset' using errcode = '22023';
    end if;

    if coalesce(array_length(p_lab_ids, 1), 0) > 0 and exists (
        select 1
        from unnest(p_lab_ids) requested_lab_id
        where not exists (
            select 1
            from public.safety_center_lab_links scl
            where scl.center_id = p_center_id
              and scl.lab_id = requested_lab_id
              and scl.status = 'approved'
              and 'exports' = any(scl.scope)
        )
    ) then
        raise exception 'Export includes a lab that is not approved for this center' using errcode = '42501';
    end if;

    insert into public.safety_center_exports (
        center_id,
        user_id,
        format,
        datasets,
        lab_ids,
        filters,
        row_count
    ) values (
        p_center_id,
        v_user_id,
        p_format,
        coalesce(p_datasets, array[]::text[]),
        coalesce(p_lab_ids, array[]::uuid[]),
        coalesce(p_filters, '{}'::jsonb),
        greatest(coalesce(p_row_count, 0), 0)
    )
    returning id into v_export_id;

    return v_export_id;
end;
$$;


--
-- Name: move_inventory_records_v2(jsonb, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_inventory_records_v2(p_targets jsonb, p_destination jsonb, p_request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
declare
    v_user_id uuid := auth.uid();
    v_existing public.inventory_move_receipts%rowtype;
    v_target jsonb;
    v_placement jsonb;
    v_normalized_targets jsonb := '[]'::jsonb;
    v_normalized_destination jsonb;
    v_moved_items jsonb := '[]'::jsonb;
    v_targets_hash text;
    v_destination_hash text;
    v_unknown_key text;
    v_item_id uuid;
    v_item_source text;
    v_seen_keys text[] := array[]::text[];
    v_seen_inventory_ids uuid[] := array[]::uuid[];
    v_destination_type text;
    v_destination_cabinet_id uuid;
    v_destination_location_id uuid;
    v_destination_lab_id uuid;
    v_destination_owner_id uuid;
    v_destination_cabinet_width numeric;
    v_destination_cabinet_depth numeric;
    v_shelf_id uuid;
    v_template text;
    v_width_text text;
    v_position_text text;
    v_depth_text text;
    v_width numeric;
    v_position numeric;
    v_depth numeric;
    v_visual_width numeric;
    v_depth_span numeric;
    v_other_target jsonb;
    v_other_placement jsonb;
    v_other_visual_width numeric;
    v_other_depth_span numeric;
    v_source_lab_id uuid;
    v_source_owner_id uuid;
    v_source_cabinet_id uuid;
    v_source_location_id uuid;
    v_inventory_item_id uuid;
    v_cabinet_item_id uuid;
    v_item_name text;
    v_inventory_before jsonb;
    v_inventory_after jsonb;
    v_cabinet_item_before jsonb;
    v_cabinet_item_after jsonb;
    v_cabinet_item_source_cabinet_id uuid;
    v_receipt jsonb;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if p_request_id is null then
        raise exception 'request_id is required' using errcode = '22023';
    end if;
    if p_targets is null
       or jsonb_typeof(p_targets) <> 'array'
       or jsonb_array_length(p_targets) < 1
       or jsonb_array_length(p_targets) > 100 then
        raise exception 'targets must contain between 1 and 100 records' using errcode = '22023';
    end if;
    if octet_length(p_targets::text) > 262144 then
        raise exception 'targets payload must be 256 KiB or smaller' using errcode = '22023';
    end if;
    if p_destination is null or jsonb_typeof(p_destination) <> 'object' then
        raise exception 'destination must be a JSON object' using errcode = '22023';
    end if;

    select key
    into v_unknown_key
    from jsonb_object_keys(p_destination) destination_key(key)
    where key not in ('storage_type', 'cabinet_id', 'storage_location_id')
    limit 1;
    if found then
        raise exception 'Unsupported destination key: %', v_unknown_key using errcode = '22023';
    end if;

    v_destination_type := p_destination->>'storage_type';
    if v_destination_type not in ('cabinet', 'other') then
        raise exception 'destination.storage_type must be cabinet or other' using errcode = '22023';
    end if;

    if v_destination_type = 'cabinet' then
        if p_destination ? 'storage_location_id'
           or nullif(p_destination->>'cabinet_id', '') is null then
            raise exception 'Cabinet destination requires only cabinet_id' using errcode = '22023';
        end if;
        v_destination_cabinet_id := (p_destination->>'cabinet_id')::uuid;

        select c.lab_id, c.user_id, c.width, c.depth
        into
            v_destination_lab_id,
            v_destination_owner_id,
            v_destination_cabinet_width,
            v_destination_cabinet_depth
        from public.cabinets c
        where c.id = v_destination_cabinet_id
        for share;
        if not found then
            raise exception 'Destination cabinet not found: %', v_destination_cabinet_id using errcode = 'P0002';
        end if;
        if v_destination_cabinet_width is null or v_destination_cabinet_width <= 0
           or v_destination_cabinet_depth is null or v_destination_cabinet_depth <= 0 then
            raise exception 'Destination cabinet dimensions are invalid' using errcode = '22023';
        end if;

        v_normalized_destination := jsonb_build_object(
            'storage_type', 'cabinet',
            'cabinet_id', v_destination_cabinet_id
        );
    else
        if p_destination ? 'cabinet_id'
           or nullif(p_destination->>'storage_location_id', '') is null then
            raise exception 'Other-storage destination requires only storage_location_id' using errcode = '22023';
        end if;
        v_destination_location_id := (p_destination->>'storage_location_id')::uuid;

        select sl.lab_id, sl.user_id
        into v_destination_lab_id, v_destination_owner_id
        from public.storage_locations sl
        where sl.id = v_destination_location_id
        for share;
        if not found then
            raise exception 'Destination storage location not found: %', v_destination_location_id using errcode = 'P0002';
        end if;

        v_normalized_destination := jsonb_build_object(
            'storage_type', 'other',
            'storage_location_id', v_destination_location_id
        );
    end if;

    if v_destination_lab_id is null then
        if v_destination_owner_id is distinct from v_user_id then
            raise exception 'Destination is outside the personal scope' using errcode = '42501';
        end if;
    elsif not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = v_destination_lab_id
          and lm.user_id = v_user_id
    ) then
        raise exception 'Access denied for destination lab %', v_destination_lab_id using errcode = '42501';
    end if;

    -- Strictly normalize the entire payload before the idempotency lookup. A
    -- retry with changed targets, geometry, or destination cannot reuse a key.
    for v_target in select value from jsonb_array_elements(p_targets)
    loop
        if jsonb_typeof(v_target) <> 'object' then
            raise exception 'Every move target must be a JSON object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_target) target_key(key)
        where key not in ('item_id', 'item_source', 'placement')
        limit 1;
        if found then
            raise exception 'Unsupported move target key: %', v_unknown_key using errcode = '22023';
        end if;

        v_item_id := nullif(v_target->>'item_id', '')::uuid;
        v_item_source := v_target->>'item_source';
        if v_item_id is null or v_item_source not in ('inventory', 'cabinet_item') then
            raise exception 'Each target requires item_id and a valid item_source' using errcode = '22023';
        end if;
        if (v_item_source || ':' || v_item_id::text) = any(v_seen_keys) then
            raise exception 'Duplicate move target: %:%', v_item_source, v_item_id using errcode = '22023';
        end if;
        v_seen_keys := array_append(v_seen_keys, v_item_source || ':' || v_item_id::text);

        v_placement := v_target->'placement';
        if v_destination_type = 'other' then
            if v_item_source <> 'inventory' then
                raise exception 'Only inventory records can move to other storage' using errcode = '22023';
            end if;
            if v_target ? 'placement' then
                raise exception 'Other-storage targets must not contain placement' using errcode = '22023';
            end if;
            v_normalized_targets := v_normalized_targets || jsonb_build_array(
                jsonb_build_object('item_id', v_item_id, 'item_source', v_item_source)
            );
        else
            if v_placement is null or jsonb_typeof(v_placement) <> 'object' then
                raise exception 'Cabinet targets require a placement object' using errcode = '22023';
            end if;
            select key
            into v_unknown_key
            from jsonb_object_keys(v_placement) placement_key(key)
            where key not in ('shelf_id', 'template', 'width', 'position', 'depth_position')
            limit 1;
            if found then
                raise exception 'Unsupported placement key: %', v_unknown_key using errcode = '22023';
            end if;

            v_shelf_id := nullif(v_placement->>'shelf_id', '')::uuid;
            v_template := v_placement->>'template';
            v_width_text := v_placement->>'width';
            v_position_text := v_placement->>'position';
            v_depth_text := v_placement->>'depth_position';
            if v_shelf_id is null
               or v_template not in ('A', 'B', 'C', 'D')
               or v_width_text is null or v_width_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$'
               or v_position_text is null or v_position_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$'
               or v_depth_text is null or v_depth_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$' then
                raise exception 'Cabinet placement fields are invalid' using errcode = '22023';
            end if;
            v_width := v_width_text::numeric;
            v_position := v_position_text::numeric;
            v_depth := v_depth_text::numeric;
            if v_width <= 0 or v_width > 100
               or v_position < 0 or v_position > 100
               or v_position + v_width > 100
               or v_depth < 0 or v_depth > 100 then
                raise exception 'Cabinet placement geometry is outside the allowed range' using errcode = '22023';
            end if;
            if not exists (
                select 1
                from public.cabinet_shelves cs
                where cs.id = v_shelf_id
                  and cs.cabinet_id = v_destination_cabinet_id
            ) then
                raise exception 'Placement shelf is outside the destination cabinet' using errcode = '42501';
            end if;

            v_normalized_targets := v_normalized_targets || jsonb_build_array(
                jsonb_build_object(
                    'item_id', v_item_id,
                    'item_source', v_item_source,
                    'placement', jsonb_build_object(
                        'shelf_id', v_shelf_id,
                        'template', v_template,
                        'width', v_width,
                        'position', v_position,
                        'depth_position', v_depth
                    )
                )
            );
        end if;
    end loop;

    select coalesce(jsonb_agg(target.value order by
        target.value->>'item_source', target.value->>'item_id'
    ), '[]'::jsonb)
    into v_normalized_targets
    from jsonb_array_elements(v_normalized_targets) target(value);

    v_targets_hash := md5(v_normalized_targets::text);
    v_destination_hash := md5(v_normalized_destination::text);

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('inventory-move:' || p_request_id::text, 0)
    );

    select receipt_row.*
    into v_existing
    from public.inventory_move_receipts receipt_row
    where receipt_row.request_id = p_request_id;

    if found then
        if v_existing.actor_user_id is distinct from v_user_id
           or v_existing.targets_hash is distinct from v_targets_hash
           or v_existing.destination_hash is distinct from v_destination_hash then
            raise exception 'request_id was already used with a different inventory-move payload'
                using errcode = '23505';
        end if;
        return jsonb_set(v_existing.receipt, '{idempotent}', 'true'::jsonb, true);
    end if;

    if v_destination_type = 'cabinet' then
        -- Serialize geometry validation and insertion for this destination.
        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
                'inventory-move-destination-cabinet:' || v_destination_cabinet_id::text,
                0
            )
        );

        for v_target in select value from jsonb_array_elements(v_normalized_targets)
        loop
            v_placement := v_target->'placement';
            v_shelf_id := (v_placement->>'shelf_id')::uuid;
            v_template := v_placement->>'template';
            v_width := (v_placement->>'width')::numeric;
            v_position := (v_placement->>'position')::numeric;
            v_depth := (v_placement->>'depth_position')::numeric;
            v_visual_width := private.cabinet_visual_width_pct_v2(
                v_template, v_width, v_destination_cabinet_width
            );
            v_depth_span := private.cabinet_depth_pct_v2(
                v_template, v_width, v_destination_cabinet_depth
            );

            if v_position + v_width / 2 - v_visual_width / 2 < 0
               or v_position + v_width / 2 + v_visual_width / 2 > 100
               or v_depth - v_depth_span / 2 < 0
               or v_depth + v_depth_span / 2 > 100 then
                raise exception 'Cabinet placement physical bounds exceed the shelf'
                    using errcode = '22023';
            end if;

            if exists (
                select 1
                from public.cabinet_items ci
                where ci.cabinet_id = v_destination_cabinet_id
                  and ci.shelf_id = v_shelf_id
                  and not (
                      v_position + v_width / 2 + v_visual_width / 2
                          <= ci.position + ci.width / 2
                             - private.cabinet_visual_width_pct_v2(
                                 ci.template, ci.width, v_destination_cabinet_width
                             ) / 2
                      or v_position + v_width / 2 - v_visual_width / 2
                          >= ci.position + ci.width / 2
                             + private.cabinet_visual_width_pct_v2(
                                 ci.template, ci.width, v_destination_cabinet_width
                             ) / 2
                      or v_depth + v_depth_span / 2
                          <= coalesce(ci.depth_position, 50)
                             - private.cabinet_depth_pct_v2(
                                 ci.template, ci.width, v_destination_cabinet_depth
                             ) / 2
                      or v_depth - v_depth_span / 2
                          >= coalesce(ci.depth_position, 50)
                             + private.cabinet_depth_pct_v2(
                                 ci.template, ci.width, v_destination_cabinet_depth
                             ) / 2
                  )
            ) then
                raise exception 'Cabinet placement collides with an existing destination item'
                    using errcode = '22023';
            end if;

            for v_other_target in
                select other.value
                from jsonb_array_elements(v_normalized_targets) other(value)
                where ((other.value->>'item_source') || ':' || (other.value->>'item_id'))
                    < ((v_target->>'item_source') || ':' || (v_target->>'item_id'))
            loop
                v_other_placement := v_other_target->'placement';
                if v_other_placement->>'shelf_id' <> v_shelf_id::text then
                    continue;
                end if;
                v_other_visual_width := private.cabinet_visual_width_pct_v2(
                    v_other_placement->>'template',
                    (v_other_placement->>'width')::numeric,
                    v_destination_cabinet_width
                );
                v_other_depth_span := private.cabinet_depth_pct_v2(
                    v_other_placement->>'template',
                    (v_other_placement->>'width')::numeric,
                    v_destination_cabinet_depth
                );

                if not (
                    v_position + v_width / 2 + v_visual_width / 2
                        <= (v_other_placement->>'position')::numeric
                           + (v_other_placement->>'width')::numeric / 2
                           - v_other_visual_width / 2
                    or v_position + v_width / 2 - v_visual_width / 2
                        >= (v_other_placement->>'position')::numeric
                           + (v_other_placement->>'width')::numeric / 2
                           + v_other_visual_width / 2
                    or v_depth + v_depth_span / 2
                        <= (v_other_placement->>'depth_position')::numeric
                           - v_other_depth_span / 2
                    or v_depth - v_depth_span / 2
                        >= (v_other_placement->>'depth_position')::numeric
                           + v_other_depth_span / 2
                ) then
                    raise exception 'Cabinet placements in the move payload collide'
                        using errcode = '22023';
                end if;
            end loop;
        end loop;
    end if;

    -- Lock and authorize all source rows in canonical order before changing
    -- any row. Logical duplicates (an inventory row plus its placement) are
    -- rejected even if their source IDs differ.
    for v_target in select value from jsonb_array_elements(v_normalized_targets)
    loop
        v_item_id := (v_target->>'item_id')::uuid;
        v_item_source := v_target->>'item_source';
        v_inventory_item_id := null;
        v_cabinet_item_id := null;

        if v_item_source = 'inventory' then
            select i.lab_id, i.user_id, i.cabinet_id, i.storage_location_id
            into v_source_lab_id, v_source_owner_id, v_source_cabinet_id, v_source_location_id
            from public.inventory i
            where i.id = v_item_id
            for update;
            if not found then
                raise exception 'Inventory move source not found: %', v_item_id using errcode = 'P0002';
            end if;
            v_inventory_item_id := v_item_id;
        else
            select ci.inventory_item_id, ci.cabinet_id
            into v_inventory_item_id, v_source_cabinet_id
            from public.cabinet_items ci
            where ci.id = v_item_id
            for update;
            if not found then
                raise exception 'Cabinet move source not found: %', v_item_id using errcode = 'P0002';
            end if;
            v_cabinet_item_id := v_item_id;

            select c.lab_id, c.user_id
            into v_source_lab_id, v_source_owner_id
            from public.cabinets c
            where c.id = v_source_cabinet_id;
            if not found then
                raise exception 'Source cabinet not found: %', v_source_cabinet_id using errcode = 'P0002';
            end if;

            if v_inventory_item_id is not null then
                perform 1
                from public.inventory i
                where i.id = v_inventory_item_id
                  and i.lab_id is not distinct from v_source_lab_id
                  and i.cabinet_id is not distinct from v_source_cabinet_id
                for update;
                if not found then
                    raise exception 'Linked inventory row is outside the source cabinet scope'
                        using errcode = '42501';
                end if;
            end if;
        end if;

        if v_source_lab_id is distinct from v_destination_lab_id then
            raise exception 'Move source and destination are in different scopes' using errcode = '42501';
        end if;
        if v_source_lab_id is null and v_source_owner_id is distinct from v_user_id then
            raise exception 'Move source is outside the personal scope' using errcode = '42501';
        end if;
        if v_inventory_item_id is not null then
            if v_inventory_item_id = any(v_seen_inventory_ids) then
                raise exception 'Move targets refer to the same logical inventory record more than once'
                    using errcode = '22023';
            end if;
            v_seen_inventory_ids := array_append(v_seen_inventory_ids, v_inventory_item_id);
        end if;

        if v_destination_type = 'cabinet'
           and v_source_cabinet_id is not distinct from v_destination_cabinet_id then
            raise exception 'Move target is already in the destination cabinet' using errcode = '22023';
        elsif v_destination_type = 'other'
          and v_source_cabinet_id is null
          and v_source_location_id is not distinct from v_destination_location_id then
            raise exception 'Move target is already in the destination storage location' using errcode = '22023';
        end if;
    end loop;

    for v_target in select value from jsonb_array_elements(v_normalized_targets)
    loop
        v_item_id := (v_target->>'item_id')::uuid;
        v_item_source := v_target->>'item_source';
        v_placement := v_target->'placement';
        v_inventory_item_id := null;
        v_cabinet_item_id := null;
        v_cabinet_item_before := null;
        v_cabinet_item_after := null;
        v_inventory_before := null;
        v_inventory_after := null;
        v_cabinet_item_source_cabinet_id := null;

        if v_item_source = 'inventory' then
            select to_jsonb(i.*), i.name, i.cabinet_id, i.storage_location_id
            into v_inventory_before, v_item_name, v_source_cabinet_id, v_source_location_id
            from public.inventory i
            where i.id = v_item_id;
            v_inventory_item_id := v_item_id;

            select to_jsonb(ci.*), ci.id, ci.cabinet_id
            into v_cabinet_item_before, v_cabinet_item_id, v_cabinet_item_source_cabinet_id
            from public.cabinet_items ci
            where ci.inventory_item_id = v_inventory_item_id
            order by ci.created_at, ci.id
            limit 1;

            if v_destination_type = 'other' then
                if v_cabinet_item_id is not null then
                    delete from public.cabinet_items ci where ci.id = v_cabinet_item_id;
                end if;
                update public.inventory
                set storage_type = 'other',
                    cabinet_id = null,
                    storage_location_id = v_destination_location_id,
                    updated_at = now()
                where id = v_inventory_item_id;

                if v_cabinet_item_source_cabinet_id is not null then
                    insert into public.cabinet_activity_logs (
                        cabinet_id, action_type, item_name, reason, performed_by
                    ) values (
                        v_cabinet_item_source_cabinet_id, 'remove', v_item_name,
                        'Moved to another storage location through atomic bulk move', v_user_id
                    );
                end if;
                v_cabinet_item_after := null;
            else
                v_shelf_id := (v_placement->>'shelf_id')::uuid;
                v_template := v_placement->>'template';
                v_width := (v_placement->>'width')::numeric;
                v_position := (v_placement->>'position')::numeric;
                v_depth := (v_placement->>'depth_position')::numeric;

                if v_cabinet_item_id is null then
                    insert into public.cabinet_items (
                        inventory_item_id, cabinet_id, shelf_id, template,
                        name, width, position, depth_position,
                        expiry_date, capacity, product_number, brand, notes,
                        cas_no, remaining_percent
                    )
                    select
                        i.id, v_destination_cabinet_id, v_shelf_id, v_template,
                        i.name, v_width, v_position, v_depth,
                        i.expiry_date, i.capacity, i.product_number, i.brand, i.memo,
                        i.cas_number, i.remaining_percent
                    from public.inventory i
                    where i.id = v_inventory_item_id
                    returning id into v_cabinet_item_id;
                else
                    update public.cabinet_items
                    set cabinet_id = v_destination_cabinet_id,
                        shelf_id = v_shelf_id,
                        template = v_template,
                        width = v_width,
                        position = v_position,
                        depth_position = v_depth
                    where id = v_cabinet_item_id;
                end if;

                update public.inventory
                set storage_type = 'cabinet',
                    cabinet_id = v_destination_cabinet_id,
                    storage_location_id = null,
                    updated_at = now()
                where id = v_inventory_item_id;

                if v_cabinet_item_source_cabinet_id is not null then
                    insert into public.cabinet_activity_logs (
                        cabinet_id, action_type, item_name, reason, performed_by
                    ) values (
                        v_cabinet_item_source_cabinet_id, 'remove', v_item_name,
                        'Moved to another cabinet through atomic bulk move', v_user_id
                    );
                end if;
                insert into public.cabinet_activity_logs (
                    cabinet_id, action_type, item_name, reason, performed_by
                ) values (
                    v_destination_cabinet_id, 'add', v_item_name,
                    'Moved from inventory through atomic bulk move', v_user_id
                );

                select to_jsonb(ci.*)
                into v_cabinet_item_after
                from public.cabinet_items ci
                where ci.id = v_cabinet_item_id;
            end if;

            select to_jsonb(i.*)
            into v_inventory_after
            from public.inventory i
            where i.id = v_inventory_item_id;

            insert into public.audit_logs (
                actor_user_id, actor_name, lab_id, entity_type, entity_id,
                action, before_data, after_data, diff_data, source, request_id
            ) values (
                v_user_id,
                private.actor_display_name_v2(v_user_id, v_destination_lab_id),
                v_destination_lab_id,
                'inventory',
                v_inventory_item_id,
                'update',
                jsonb_build_object('inventory', v_inventory_before, 'cabinet_item', v_cabinet_item_before),
                jsonb_build_object('inventory', v_inventory_after, 'cabinet_item', v_cabinet_item_after),
                jsonb_build_object('destination', v_normalized_destination),
                'rpc',
                p_request_id
            );
        else
            select to_jsonb(ci.*), ci.inventory_item_id, ci.name, ci.cabinet_id
            into v_cabinet_item_before, v_inventory_item_id, v_item_name, v_source_cabinet_id
            from public.cabinet_items ci
            where ci.id = v_item_id;
            v_cabinet_item_id := v_item_id;

            if v_inventory_item_id is not null then
                select to_jsonb(i.*)
                into v_inventory_before
                from public.inventory i
                where i.id = v_inventory_item_id;
            end if;

            v_shelf_id := (v_placement->>'shelf_id')::uuid;
            v_template := v_placement->>'template';
            v_width := (v_placement->>'width')::numeric;
            v_position := (v_placement->>'position')::numeric;
            v_depth := (v_placement->>'depth_position')::numeric;

            update public.cabinet_items
            set cabinet_id = v_destination_cabinet_id,
                shelf_id = v_shelf_id,
                template = v_template,
                width = v_width,
                position = v_position,
                depth_position = v_depth
            where id = v_cabinet_item_id;

            if v_inventory_item_id is not null then
                update public.inventory
                set storage_type = 'cabinet',
                    cabinet_id = v_destination_cabinet_id,
                    storage_location_id = null,
                    updated_at = now()
                where id = v_inventory_item_id;
                select to_jsonb(i.*)
                into v_inventory_after
                from public.inventory i
                where i.id = v_inventory_item_id;
            end if;

            select to_jsonb(ci.*)
            into v_cabinet_item_after
            from public.cabinet_items ci
            where ci.id = v_cabinet_item_id;

            insert into public.cabinet_activity_logs (
                cabinet_id, action_type, item_name, reason, performed_by
            ) values
                (v_source_cabinet_id, 'remove', v_item_name,
                    'Moved to another cabinet through atomic bulk move', v_user_id),
                (v_destination_cabinet_id, 'add', v_item_name,
                    'Moved from another cabinet through atomic bulk move', v_user_id);

            insert into public.audit_logs (
                actor_user_id, actor_name, lab_id, entity_type, entity_id,
                action, before_data, after_data, diff_data, source, request_id
            ) values (
                v_user_id,
                private.actor_display_name_v2(v_user_id, v_destination_lab_id),
                v_destination_lab_id,
                'cabinet_item',
                v_cabinet_item_id,
                'update',
                jsonb_build_object('cabinet_item', v_cabinet_item_before, 'inventory', v_inventory_before),
                jsonb_build_object('cabinet_item', v_cabinet_item_after, 'inventory', v_inventory_after),
                jsonb_build_object('destination', v_normalized_destination),
                'rpc',
                p_request_id
            );
        end if;

        v_moved_items := v_moved_items || jsonb_build_array(jsonb_build_object(
            'item_id', v_item_id,
            'item_source', v_item_source,
            'inventory_item_id', v_inventory_item_id,
            'cabinet_item_id', v_cabinet_item_id,
            'source', case
                when v_item_source = 'inventory' then jsonb_build_object(
                    'storage_type', v_inventory_before->>'storage_type',
                    'cabinet_id', v_inventory_before->'cabinet_id',
                    'storage_location_id', v_inventory_before->'storage_location_id'
                )
                else jsonb_build_object(
                    'storage_type', 'cabinet',
                    'cabinet_id', v_cabinet_item_before->'cabinet_id'
                )
            end,
            'destination', v_normalized_destination
        ));
    end loop;

    if jsonb_array_length(v_moved_items) <> jsonb_array_length(v_normalized_targets) then
        raise exception 'Atomic move did not produce an exact receipt' using errcode = 'P0001';
    end if;

    v_receipt := jsonb_build_object(
        'request_id', p_request_id,
        'moved_count', jsonb_array_length(v_moved_items),
        'moved_items', v_moved_items,
        'destination', v_normalized_destination,
        'idempotent', false
    );

    insert into public.inventory_move_receipts (
        request_id, actor_user_id, targets_hash, destination_hash, receipt
    ) values (
        p_request_id, v_user_id, v_targets_hash, v_destination_hash, v_receipt
    );

    return v_receipt;
end;
$_$;


--
-- Name: FUNCTION move_inventory_records_v2(p_targets jsonb, p_destination jsonb, p_request_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.move_inventory_records_v2(p_targets jsonb, p_destination jsonb, p_request_id uuid) IS 'Moves 1..100 inventory/cabinet records in one authenticated transaction. Validates exact scope, destination, cabinet shelf geometry, and idempotency before returning an exact receipt.';


--
-- Name: normalize_lab_join_password(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_lab_join_password() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if tg_op = 'INSERT' then
        if nullif(new.join_password, '') is null then
            new.join_password_hash := null;
        else
            new.join_password_hash := extensions.crypt(new.join_password, extensions.gen_salt('bf'));
        end if;

        new.join_password := null;
        return new;
    end if;

    if new.join_password is distinct from old.join_password then
        if nullif(new.join_password, '') is null then
            new.join_password_hash := null;
        else
            new.join_password_hash := extensions.crypt(new.join_password, extensions.gen_salt('bf'));
        end if;

        new.join_password := null;
    elsif new.join_password_hash is distinct from old.join_password_hash then
        raise exception 'Use set_lab_join_password to change lab passwords'
            using errcode = '42501';
    end if;

    return new;
end;
$$;


--
-- Name: protect_lab_member_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_lab_member_role() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- If the role is being changed
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    -- Check if the performing user is an admin of this lab
    -- We use SECURITY DEFINER inside the trigger context to check members table safely
    IF NOT EXISTS (
      SELECT 1 FROM lab_members
      WHERE lab_id = OLD.lab_id
        AND user_id = auth.uid()
        AND role = 'admin'
    ) THEN
      -- If they are trying to change someone's role (including their own)
      -- but are not an admin themselves, they should fail.
      RAISE EXCEPTION 'Only admins can change roles.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: record_inventory_disposal_v2(uuid, jsonb, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_inventory_disposal_v2(p_request_id uuid, p_items jsonb, p_batch jsonb, p_lab_id uuid DEFAULT NULL::uuid, p_actor_name text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
declare
    v_user_id uuid := auth.uid();
    v_components jsonb;
    v_item jsonb;
    v_item_id uuid;
    v_item_source text;
    v_item_name text;
    v_cabinet_id uuid;
    v_quantity_text text;
    v_quantity_to_remove integer;
    v_available_quantity integer;
    v_key text;
    v_seen_keys text[] := array[]::text[];
    v_removed_items jsonb := '[]'::jsonb;
    v_requested_items jsonb := '[]'::jsonb;
    v_expected_items jsonb := '[]'::jsonb;
    v_result jsonb;
    v_log_id uuid;
    v_unknown_key text;
    v_items_hash text;
    v_stored_items_hash text;
    v_linked_inventory_item_id uuid;
    v_linked_inventory_lab_id uuid;
    v_linked_inventory_cabinet_id uuid;
    v_linked_inventory_quantity integer;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) < 1
       or jsonb_array_length(p_items) > 100 then
        raise exception 'items must contain between 1 and 100 records' using errcode = '22023';
    end if;

    if octet_length(p_items::text) > 65536 then
        raise exception 'items payload must be 64 KiB or smaller' using errcode = '22023';
    end if;

    if p_batch is null or jsonb_typeof(p_batch) <> 'object' then
        raise exception 'batch must be a JSON object' using errcode = '22023';
    end if;

    v_components := p_batch->'components';
    if v_components is null or jsonb_typeof(v_components) <> 'array' then
        raise exception 'batch.components must be an array' using errcode = '22023';
    end if;

    -- Normalize and validate the requested inventory targets before the core
    -- idempotency shortcut. This prevents a retry with malformed or different
    -- targets from being reported as a successful inventory disposal.
    for v_item in select value from jsonb_array_elements(p_items)
    loop
        if jsonb_typeof(v_item) <> 'object' then
            raise exception 'Every inventory record must be a JSON object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_item) as item_key(key)
        where key not in (
            'item_id', 'itemId', 'item_source', 'itemSource',
            'quantity_to_remove', 'quantityToRemove'
        )
        limit 1;

        if found then
            raise exception 'Unsupported inventory record key: %', v_unknown_key using errcode = '22023';
        end if;

        v_item_id := nullif(coalesce(v_item->>'item_id', v_item->>'itemId'), '')::uuid;
        v_item_source := coalesce(v_item->>'item_source', v_item->>'itemSource');
        v_quantity_text := coalesce(
            v_item->>'quantity_to_remove',
            v_item->>'quantityToRemove'
        );

        if v_item_id is null or v_item_source not in ('inventory', 'cabinet_item') then
            raise exception 'Each record requires item_id and a valid item_source' using errcode = '22023';
        end if;
        if v_quantity_text is null
           or v_quantity_text !~ '^[1-9][0-9]*$'
           or v_quantity_text::numeric > 2147483647 then
            raise exception 'quantity_to_remove must be a positive integer' using errcode = '22023';
        end if;
        v_quantity_to_remove := v_quantity_text::integer;
        if v_item_source = 'cabinet_item' and v_quantity_to_remove <> 1 then
            raise exception 'cabinet_item quantity_to_remove must be exactly 1' using errcode = '22023';
        end if;

        v_key := v_item_source || ':' || v_item_id::text;
        if v_key = any(v_seen_keys) then
            raise exception 'Duplicate inventory record in request: %', v_key using errcode = '22023';
        end if;
        v_seen_keys := array_append(v_seen_keys, v_key);
        v_requested_items := v_requested_items || jsonb_build_array(
            jsonb_build_object(
                'item_id', v_item_id,
                'item_source', v_item_source,
                'quantity_to_remove', v_quantity_to_remove
            )
        );
    end loop;

    select coalesce(jsonb_agg(target.value order by
        target.value->>'item_source',
        target.value->>'item_id'
    ), '[]'::jsonb)
    into v_requested_items
    from jsonb_array_elements(v_requested_items) target(value);
    v_items_hash := md5(v_requested_items::text);

    -- Let the core recorder acquire the idempotency lock first. On an initial
    -- call, any later target-validation failure rolls this insert back. On a
    -- retry after the inventory rows were deleted, the existing durable log
    -- can be returned without trying to resolve those deleted rows again.
    v_result := public.record_waste_handling_v2(p_request_id, p_batch, p_lab_id);
    v_log_id := (v_result->>'id')::uuid;

    if coalesce((v_result->>'idempotent')::boolean, false) then
        if coalesce(v_result->>'record_origin', v_result->>'recordOrigin') <> 'inventory_disposal' then
            raise exception 'request_id belongs to a non-inventory waste record' using errcode = '23505';
        end if;

        select
            coalesce(wl.confirmation_snapshot->'inventoryDisposalTargets', '[]'::jsonb),
            wl.request_items_hash
        into v_removed_items, v_stored_items_hash
        from public.waste_logs wl
        where wl.id = v_log_id;

        if v_stored_items_hash is distinct from v_items_hash then
            raise exception 'request_id was already used with a different inventory items payload'
                using errcode = '23505';
        end if;

        if jsonb_typeof(v_removed_items) <> 'array' then
            raise exception 'Stored inventory-disposal targets are invalid' using errcode = '22023';
        end if;

        if jsonb_array_length(v_removed_items) <> jsonb_array_length(v_requested_items)
           or not (v_removed_items @> v_requested_items and v_requested_items @> v_removed_items) then
            raise exception 'request_id was already used with different inventory targets' using errcode = '23505';
        end if;

        return v_result || jsonb_build_object(
            'record_origin', 'inventory_disposal',
            'recordOrigin', 'inventory_disposal',
            'removed_count', jsonb_array_length(v_removed_items),
            'removed_items', v_removed_items
        );
    end if;

    -- Validate every target and its batch linkage before creating the log.
    -- A later error would roll the whole function back as well, but this
    -- ordering avoids unnecessary work on malformed requests.
    v_seen_keys := array[]::text[];
    for v_item in select value from jsonb_array_elements(p_items)
    loop
        if jsonb_typeof(v_item) <> 'object' then
            raise exception 'Every inventory record must be a JSON object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_item) as item_key(key)
        where key not in (
            'item_id', 'itemId', 'item_source', 'itemSource',
            'quantity_to_remove', 'quantityToRemove'
        )
        limit 1;

        if found then
            raise exception 'Unsupported inventory record key: %', v_unknown_key using errcode = '22023';
        end if;

        v_item_id := nullif(coalesce(v_item->>'item_id', v_item->>'itemId'), '')::uuid;
        v_item_source := coalesce(v_item->>'item_source', v_item->>'itemSource');
        v_quantity_to_remove := coalesce(
            v_item->>'quantity_to_remove',
            v_item->>'quantityToRemove'
        )::integer;

        if v_item_id is null or v_item_source not in ('inventory', 'cabinet_item') then
            raise exception 'Each record requires item_id and a valid item_source' using errcode = '22023';
        end if;

        v_key := v_item_source || ':' || v_item_id::text;
        if v_key = any(v_seen_keys) then
            raise exception 'Duplicate inventory record in request: %', v_key using errcode = '22023';
        end if;
        v_seen_keys := array_append(v_seen_keys, v_key);

        if v_item_source = 'inventory' then
            if not exists (
                select 1
                from jsonb_array_elements(v_components) component(value)
                where coalesce(
                    component.value->>'inventory_item_id',
                    component.value->>'inventoryItemId'
                ) = v_item_id::text
            ) then
                raise exception 'Inventory record % is not linked from batch.components', v_item_id using errcode = '22023';
            end if;

            select i.name, i.cabinet_id, i.quantity
            into v_item_name, v_cabinet_id, v_available_quantity
            from public.inventory i
            where i.id = v_item_id;

            if found and (v_available_quantity is null or v_available_quantity < 1) then
                raise exception 'Inventory record % has an invalid available quantity', v_item_id
                    using errcode = '22023';
            elsif found and v_quantity_to_remove > v_available_quantity then
                raise exception 'quantity_to_remove % exceeds available inventory quantity % for %',
                    v_quantity_to_remove, v_available_quantity, v_item_id using errcode = '22023';
            end if;
        else
            if not exists (
                select 1
                from jsonb_array_elements(v_components) component(value)
                where coalesce(
                    component.value->>'cabinet_item_id',
                    component.value->>'cabinetItemId'
                ) = v_item_id::text
            ) then
                raise exception 'Cabinet record % is not linked from batch.components', v_item_id using errcode = '22023';
            end if;

            select ci.name, ci.cabinet_id
            into v_item_name, v_cabinet_id
            from public.cabinet_items ci
            where ci.id = v_item_id;
        end if;

        if not found then
            raise exception 'Inventory record not found: %', v_key using errcode = 'P0002';
        end if;

        v_removed_items := v_removed_items || jsonb_build_array(
            jsonb_build_object(
                'item_id', v_item_id,
                'item_source', v_item_source,
                'quantity_to_remove', v_quantity_to_remove
            )
        );
    end loop;

    -- The inventory transaction must cover every linked component, not merely
    -- an arbitrary subset supplied by the caller. This mirrors the client rule:
    -- an inventory reference takes precedence; otherwise a cabinet-origin line
    -- uses its cabinet item reference. Duplicate component references collapse
    -- to one atomic target, while inventory quantities are summed across lines.
    for v_item in select value from jsonb_array_elements(v_components)
    loop
        if nullif(coalesce(
            v_item->>'inventoryItemId',
            v_item->>'inventory_item_id'
        ), '') is not null then
            v_quantity_text := coalesce(
                v_item #>> '{analysisSnapshot,inventoryDisposalQuantity}',
                v_item #>> '{analysis_snapshot,inventoryDisposalQuantity}',
                v_item #>> '{analysisSnapshot,inventory_disposal_quantity}',
                v_item #>> '{analysis_snapshot,inventory_disposal_quantity}'
            );
            if v_quantity_text is null
               or v_quantity_text !~ '^[1-9][0-9]*$'
               or v_quantity_text::numeric > 2147483647 then
                raise exception 'Each inventory-linked component requires a positive integer inventoryDisposalQuantity'
                    using errcode = '22023';
            end if;
        end if;
    end loop;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'item_id', linked.item_id,
            'item_source', linked.item_source,
            'quantity_to_remove', linked.quantity_to_remove
        )
        order by linked.first_line
    ), '[]'::jsonb)
    into v_expected_items
    from (
        select
            candidate.item_id,
            candidate.item_source,
            sum(candidate.quantity_to_remove) as quantity_to_remove,
            min(candidate.line_number) as first_line
        from (
            select
                case
                    when nullif(coalesce(
                        component.value->>'inventoryItemId',
                        component.value->>'inventory_item_id'
                    ), '') is not null then coalesce(
                        component.value->>'inventoryItemId',
                        component.value->>'inventory_item_id'
                    )
                    when coalesce(
                        component.value->>'sourceType',
                        component.value->>'source_type'
                    ) = 'cabinet' then nullif(coalesce(
                        component.value->>'cabinetItemId',
                        component.value->>'cabinet_item_id'
                    ), '')
                    else null
                end as item_id,
                case
                    when nullif(coalesce(
                        component.value->>'inventoryItemId',
                        component.value->>'inventory_item_id'
                    ), '') is not null then 'inventory'
                    when coalesce(
                        component.value->>'sourceType',
                        component.value->>'source_type'
                    ) = 'cabinet'
                     and nullif(coalesce(
                        component.value->>'cabinetItemId',
                        component.value->>'cabinet_item_id'
                    ), '') is not null then 'cabinet_item'
                    else null
                end as item_source,
                case
                    when nullif(coalesce(
                        component.value->>'inventoryItemId',
                        component.value->>'inventory_item_id'
                    ), '') is not null then coalesce(
                        component.value #>> '{analysisSnapshot,inventoryDisposalQuantity}',
                        component.value #>> '{analysis_snapshot,inventoryDisposalQuantity}',
                        component.value #>> '{analysisSnapshot,inventory_disposal_quantity}',
                        component.value #>> '{analysis_snapshot,inventory_disposal_quantity}'
                    )::integer
                    when coalesce(
                        component.value->>'sourceType',
                        component.value->>'source_type'
                    ) = 'cabinet' then 1
                    else null
                end as quantity_to_remove,
                component.ordinality as line_number
            from jsonb_array_elements(v_components) with ordinality as component(value, ordinality)
        ) candidate
        where candidate.item_id is not null
          and candidate.item_source is not null
          and candidate.quantity_to_remove is not null
        group by candidate.item_id, candidate.item_source
    ) linked;

    if jsonb_array_length(v_expected_items) <> jsonb_array_length(v_requested_items)
       or not (v_expected_items @> v_requested_items and v_requested_items @> v_expected_items) then
        raise exception 'items must exactly match the inventory-linked batch components' using errcode = '22023';
    end if;

    -- Re-read each target inside the deleting RPC. All deletions and the waste
    -- record remain in this one transaction and roll back together on error.
    for v_item in select value from jsonb_array_elements(p_items)
    loop
        v_item_id := nullif(coalesce(v_item->>'item_id', v_item->>'itemId'), '')::uuid;
        v_item_source := coalesce(v_item->>'item_source', v_item->>'itemSource');
        v_quantity_to_remove := coalesce(
            v_item->>'quantity_to_remove',
            v_item->>'quantityToRemove'
        )::integer;

        if v_item_source = 'inventory' then
            select i.name, i.cabinet_id, i.quantity
            into v_item_name, v_cabinet_id, v_available_quantity
            from public.inventory i
            where i.id = v_item_id
            for update;
        else
            select ci.name, ci.cabinet_id, ci.inventory_item_id
            into v_item_name, v_cabinet_id, v_linked_inventory_item_id
            from public.cabinet_items ci
            where ci.id = v_item_id
            for update;
        end if;

        if not found then
            raise exception 'Inventory record disappeared during disposal: %:%', v_item_source, v_item_id using errcode = 'P0002';
        end if;

        if v_item_source = 'inventory' then
            if v_available_quantity is null or v_available_quantity < 1 then
                raise exception 'Inventory record % has an invalid available quantity', v_item_id
                    using errcode = '22023';
            elsif v_quantity_to_remove > v_available_quantity then
                raise exception 'quantity_to_remove % exceeds available inventory quantity % for %',
                    v_quantity_to_remove, v_available_quantity, v_item_id using errcode = '22023';
            elsif v_quantity_to_remove < v_available_quantity then
                perform public.update_inventory_item_atomic(
                    v_item_id,
                    'inventory',
                    jsonb_build_object('quantity', v_available_quantity - v_quantity_to_remove),
                    p_actor_name
                );
            else
                perform public.delete_inventory_item_atomic(
                    p_item_id => v_item_id,
                    p_item_source => v_item_source,
                    p_item_name => v_item_name,
                    p_lab_id => p_lab_id,
                    p_cabinet_id => v_cabinet_id,
                    p_cabinet_name => null,
                    p_storage_location_name => null,
                    p_disposal_reason => 'Disposed through Waste Disposal V2',
                    p_actor_name => p_actor_name
                );
            end if;
        else
            if v_quantity_to_remove <> 1 then
                raise exception 'cabinet_item quantity_to_remove must be exactly 1' using errcode = '22023';
            end if;

            if v_linked_inventory_item_id is not null then
                select i.lab_id, i.cabinet_id, i.quantity
                into
                    v_linked_inventory_lab_id,
                    v_linked_inventory_cabinet_id,
                    v_linked_inventory_quantity
                from public.inventory i
                where i.id = v_linked_inventory_item_id
                for update;

                if not found then
                    raise exception 'Linked inventory item disappeared during disposal: %',
                        v_linked_inventory_item_id using errcode = 'P0002';
                end if;
                if v_linked_inventory_lab_id is distinct from p_lab_id
                   or v_linked_inventory_cabinet_id is distinct from v_cabinet_id then
                    raise exception 'Linked inventory item is outside the cabinet disposal scope'
                        using errcode = '42501';
                end if;
                if v_linked_inventory_quantity is null
                   or v_linked_inventory_quantity not between 1 and 1000000 then
                    raise exception 'Linked inventory item has an invalid available quantity'
                        using errcode = '22023';
                end if;
            end if;

            if v_linked_inventory_item_id is not null
               and v_linked_inventory_quantity > 1 then
                -- A cabinet placement can represent an aggregated inventory
                -- count. Disposing one physical container decrements exactly
                -- one and keeps that placement for the remaining containers.
                perform public.update_inventory_item_atomic(
                    v_linked_inventory_item_id,
                    'inventory',
                    jsonb_build_object('quantity', v_linked_inventory_quantity - 1),
                    null
                );

                insert into public.cabinet_activity_logs (
                    cabinet_id,
                    action_type,
                    item_name,
                    reason,
                    performed_by
                ) values (
                    v_cabinet_id,
                    'update',
                    v_item_name,
                    format(
                        'Disposed one container through Waste Disposal V2; inventory quantity reduced from %s to %s',
                        v_linked_inventory_quantity,
                        v_linked_inventory_quantity - 1
                    ),
                    v_user_id
                );
            else
                perform public.delete_inventory_item_atomic(
                    p_item_id => v_item_id,
                    p_item_source => v_item_source,
                    p_item_name => v_item_name,
                    p_lab_id => p_lab_id,
                    p_cabinet_id => v_cabinet_id,
                    p_cabinet_name => null,
                    p_storage_location_name => null,
                    p_disposal_reason => 'Disposed through Waste Disposal V2',
                    p_actor_name => null
                );
            end if;
        end if;
    end loop;

    update public.waste_logs
    set record_origin = 'inventory_disposal',
        request_items_hash = v_items_hash,
        confirmation_snapshot = coalesce(confirmation_snapshot, '{}'::jsonb)
            || jsonb_build_object('inventoryDisposalTargets', v_requested_items)
    where id = v_log_id
      and user_id = v_user_id;

    return v_result || jsonb_build_object(
        'record_origin', 'inventory_disposal',
        'recordOrigin', 'inventory_disposal',
        'removed_count', jsonb_array_length(v_removed_items),
        'removed_items', v_removed_items
    );
end;
$_$;


--
-- Name: record_inventory_usage_completion_v2(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_inventory_usage_completion_v2(p_cabinet_item_id uuid, p_request_id uuid, p_completion_kind text DEFAULT 'used'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_existing public.inventory_usage_completion_receipts%rowtype;
    v_cabinet_item_before jsonb;
    v_inventory_before jsonb;
    v_inventory_after jsonb;
    v_inventory_item_id uuid;
    v_cabinet_id uuid;
    v_cabinet_name text;
    v_item_name text;
    v_lab_id uuid;
    v_cabinet_owner_id uuid;
    v_inventory_lab_id uuid;
    v_inventory_owner_id uuid;
    v_inventory_cabinet_id uuid;
    v_inventory_storage_type text;
    v_previous_quantity integer;
    v_remaining_quantity integer;
    v_actor_name text;
    v_cabinet_item_removed boolean;
    v_inventory_item_removed boolean;
    v_activity_action text;
    v_activity_reason text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if p_cabinet_item_id is null then
        raise exception 'cabinet_item_id is required' using errcode = '22023';
    end if;
    if p_request_id is null then
        raise exception 'request_id is required' using errcode = '22023';
    end if;
    if p_completion_kind not in ('used', 'empty_container') then
        raise exception 'completion_kind must be used or empty_container' using errcode = '22023';
    end if;

    -- A request ID is globally serialized so another account cannot race the
    -- same idempotency key and obtain an ambiguous receipt.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('inventory-usage-completion:' || p_request_id::text, 0)
    );

    select receipt.*
    into v_existing
    from public.inventory_usage_completion_receipts receipt
    where receipt.request_id = p_request_id;

    if found then
        if v_existing.actor_user_id is distinct from v_user_id
           or v_existing.cabinet_item_id is distinct from p_cabinet_item_id
           or v_existing.completion_kind is distinct from p_completion_kind then
            raise exception 'request_id was already used with a different usage-completion payload'
                using errcode = '23505';
        end if;

        return jsonb_build_object(
            'request_id', v_existing.request_id,
            'cabinet_item_id', v_existing.cabinet_item_id,
            'inventory_item_id', v_existing.inventory_item_id,
            'completion_kind', v_existing.completion_kind,
            'previous_quantity', v_existing.previous_quantity,
            'remaining_quantity', v_existing.remaining_quantity,
            'cabinet_item_removed', v_existing.cabinet_item_removed,
            'inventory_item_removed', v_existing.inventory_item_removed,
            'idempotent', true
        );
    end if;

    select
        to_jsonb(ci.*),
        ci.inventory_item_id,
        ci.cabinet_id,
        ci.name
    into
        v_cabinet_item_before,
        v_inventory_item_id,
        v_cabinet_id,
        v_item_name
    from public.cabinet_items ci
    where ci.id = p_cabinet_item_id
    for update;

    if not found then
        raise exception 'Cabinet item not found: %', p_cabinet_item_id using errcode = 'P0002';
    end if;

    select c.lab_id, c.user_id, c.name
    into v_lab_id, v_cabinet_owner_id, v_cabinet_name
    from public.cabinets c
    where c.id = v_cabinet_id;

    if not found then
        raise exception 'Cabinet not found: %', v_cabinet_id using errcode = 'P0002';
    end if;

    if v_lab_id is null then
        if v_cabinet_owner_id is distinct from v_user_id then
            raise exception 'Access denied for cabinet item %', p_cabinet_item_id using errcode = '42501';
        end if;
    else
        select nullif(trim(lm.nickname), '')
        into v_actor_name
        from public.lab_members lm
        where lm.lab_id = v_lab_id
          and lm.user_id = v_user_id;

        if not found then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;
    end if;

    -- Only reveal linkage state after the caller's cabinet scope is proven.
    if v_inventory_item_id is null then
        raise exception 'Cabinet item % is not linked to an inventory record', p_cabinet_item_id
            using errcode = '22023';
    end if;

    select
        to_jsonb(i.*),
        i.lab_id,
        i.user_id,
        i.cabinet_id,
        i.storage_type,
        i.quantity
    into
        v_inventory_before,
        v_inventory_lab_id,
        v_inventory_owner_id,
        v_inventory_cabinet_id,
        v_inventory_storage_type,
        v_previous_quantity
    from public.inventory i
    where i.id = v_inventory_item_id
    for update;

    if not found then
        raise exception 'Linked inventory item not found: %', v_inventory_item_id using errcode = 'P0002';
    end if;
    if v_inventory_lab_id is distinct from v_lab_id
       or v_inventory_cabinet_id is distinct from v_cabinet_id
       or v_inventory_storage_type is distinct from 'cabinet' then
        raise exception 'Linked inventory item is outside the cabinet scope' using errcode = '42501';
    end if;
    if v_lab_id is null and v_inventory_owner_id is distinct from v_user_id then
        raise exception 'Linked inventory item is outside the personal scope' using errcode = '42501';
    end if;
    if v_previous_quantity is null or v_previous_quantity not between 1 and 1000000 then
        raise exception 'Linked inventory quantity must be between 1 and 1000000' using errcode = '22023';
    end if;

    v_remaining_quantity := v_previous_quantity - 1;
    v_cabinet_item_removed := v_remaining_quantity = 0;
    v_inventory_item_removed := v_remaining_quantity = 0;

    if v_remaining_quantity > 0 then
        update public.inventory
        set quantity = v_remaining_quantity,
            updated_at = now()
        where id = v_inventory_item_id;

        select to_jsonb(i.*)
        into v_inventory_after
        from public.inventory i
        where i.id = v_inventory_item_id;

        v_activity_action := 'update';
        v_activity_reason := format(
            '%s recorded; inventory quantity reduced from %s to %s',
            case p_completion_kind when 'empty_container' then 'Empty container' else 'Full use' end,
            v_previous_quantity,
            v_remaining_quantity
        );
    else
        delete from public.cabinet_items ci
        where ci.id = p_cabinet_item_id
          and ci.inventory_item_id = v_inventory_item_id;

        if not found then
            raise exception 'Cabinet placement disappeared during usage completion' using errcode = 'P0002';
        end if;

        delete from public.inventory i
        where i.id = v_inventory_item_id;

        if not found then
            raise exception 'Inventory item disappeared during usage completion' using errcode = 'P0002';
        end if;

        v_inventory_after := null;
        v_activity_action := 'remove';
        v_activity_reason := case p_completion_kind
            when 'empty_container' then 'Empty container recorded; inventory closed'
            else 'Full use recorded; inventory closed'
        end;
    end if;

    insert into public.cabinet_activity_logs (
        cabinet_id,
        action_type,
        item_name,
        reason,
        performed_by
    ) values (
        v_cabinet_id,
        v_activity_action,
        v_item_name,
        v_activity_reason,
        v_user_id
    );

    insert into public.audit_logs (
        actor_user_id,
        actor_name,
        lab_id,
        entity_type,
        entity_id,
        action,
        location_context,
        before_data,
        after_data,
        diff_data,
        source,
        request_id
    ) values (
        v_user_id,
        v_actor_name,
        v_lab_id,
        'inventory',
        v_inventory_item_id,
        case when v_inventory_item_removed then 'delete' else 'update' end,
        coalesce(nullif(trim(v_cabinet_name), ''), 'Cabinet'),
        jsonb_build_object(
            'inventory', v_inventory_before,
            'cabinet_item', v_cabinet_item_before
        ),
        jsonb_build_object(
            'inventory', v_inventory_after,
            'cabinet_item', case
                when v_cabinet_item_removed then null
                else v_cabinet_item_before
            end,
            'completion_kind', p_completion_kind
        ),
        jsonb_build_object(
            'quantity', jsonb_build_object(
                'from', v_previous_quantity,
                'to', v_remaining_quantity
            ),
            'cabinet_item_removed', v_cabinet_item_removed,
            'inventory_item_removed', v_inventory_item_removed
        ),
        'rpc',
        p_request_id
    );

    insert into public.inventory_usage_completion_receipts (
        request_id,
        actor_user_id,
        lab_id,
        cabinet_item_id,
        inventory_item_id,
        completion_kind,
        previous_quantity,
        remaining_quantity,
        cabinet_item_removed,
        inventory_item_removed
    ) values (
        p_request_id,
        v_user_id,
        v_lab_id,
        p_cabinet_item_id,
        v_inventory_item_id,
        p_completion_kind,
        v_previous_quantity,
        v_remaining_quantity,
        v_cabinet_item_removed,
        v_inventory_item_removed
    );

    return jsonb_build_object(
        'request_id', p_request_id,
        'cabinet_item_id', p_cabinet_item_id,
        'inventory_item_id', v_inventory_item_id,
        'completion_kind', p_completion_kind,
        'previous_quantity', v_previous_quantity,
        'remaining_quantity', v_remaining_quantity,
        'cabinet_item_removed', v_cabinet_item_removed,
        'inventory_item_removed', v_inventory_item_removed,
        'idempotent', false
    );
end;
$$;


--
-- Name: FUNCTION record_inventory_usage_completion_v2(p_cabinet_item_id uuid, p_request_id uuid, p_completion_kind text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_inventory_usage_completion_v2(p_cabinet_item_id uuid, p_request_id uuid, p_completion_kind text) IS 'Records one fully used or empty linked cabinet container. Decrements inventory by exactly one, removes inventory and placement only at zero, writes activity/audit records, and never creates a waste log.';


--
-- Name: record_waste_handling_v2(uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_waste_handling_v2(p_request_id uuid, p_batch jsonb, p_lab_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
declare
    v_user_id uuid := auth.uid();
    v_existing waste_logs%rowtype;
    v_log_id uuid;
    v_handling_action text;
    v_decision_status text;
    v_stream_code text;
    v_matrix_code text;
    v_rule_version text;
    v_components jsonb;
    v_decision_snapshot jsonb;
    v_confirmation_snapshot jsonb;
    v_stream_snapshot jsonb;
    v_blocking_reasons jsonb;
    v_missing_fields jsonb;
    v_total_amount jsonb;
    v_amount_unknown boolean;
    v_amount_approximate boolean;
    v_amount_text text;
    v_amount_value numeric;
    v_amount_unit text;
    v_normalized_value numeric;
    v_normalized_unit text;
    v_handler_name text;
    v_memo text;
    v_stream record;
    v_component jsonb;
    v_ordinality bigint;
    v_cart_line_id text;
    v_source_type text;
    v_inventory_item_id uuid;
    v_cabinet_item_id uuid;
    v_ref_lab_id uuid;
    v_ref_user_id uuid;
    v_chemical_name text;
    v_concentration jsonb;
    v_concentration_text text;
    v_concentration_value numeric;
    v_concentration_unit text;
    v_hazard_flags jsonb;
    v_ghs_data_status text;
    v_decision_hazard_flags jsonb;
    v_allowed_actions jsonb;
    v_server_analysis jsonb;
    v_server_decision_status text;
    v_server_stream_code text;
    v_server_hazard_flags jsonb;
    v_server_blocking_codes jsonb;
    v_client_hazard_array text[];
    v_server_hazard_array text[];
    v_policy_flag text;
    v_policy_blocks boolean := false;
    v_payload_hash text;
    v_identity_confidence numeric;
    v_unknown_key text;
    v_client_policy_version text;
    v_institution_policy_count integer;
    v_predicted_ph_authorization_id uuid;
    v_predicted_ph_authorization record;
    v_prediction_input_fingerprint text;
    v_analysis_confirmation_snapshot jsonb;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_request_id is null then
        raise exception 'request_id is required' using errcode = '22023';
    end if;

    if p_batch is null or jsonb_typeof(p_batch) <> 'object' then
        raise exception 'batch must be a JSON object' using errcode = '22023';
    end if;

    if octet_length(p_batch::text) > 2097152 then
        raise exception 'batch payload must be 2 MiB or smaller' using errcode = '22023';
    end if;

    select key
    into v_unknown_key
    from jsonb_object_keys(p_batch) as payload(key)
    where not (key = any(array[
        'components',
        'handlingAction', 'handling_action',
        'decisionStatus', 'decision_status',
        'streamCode', 'stream_code',
        'matrix', 'matrixCode', 'matrix_code',
        'totalAmount', 'total_amount',
        'decision', 'decisionSnapshot', 'decision_snapshot',
        'confirmationSnapshot', 'confirmation_snapshot',
        'ruleVersion', 'rule_version',
        'memo',
        'batch_id', 'scope_key', 'matrix_source',
        'measured_ph', 'measured_ph_status', 'additional_components_status'
    ]::text[]))
    limit 1;

    if found then
        raise exception 'Unsupported batch payload key: %', v_unknown_key using errcode = '22023';
    end if;

    -- jsonb text output has deterministic key ordering, so this hash is stable
    -- across equivalent object-key orderings while preserving array order.
    -- Authorization IDs are deliberately excluded from idempotency identity:
    -- a retried network request obtains a fresh one-time ID for the exact same
    -- physical batch, and must still resolve to the original durable record.
    v_payload_hash := md5((
        p_batch
        #- array['confirmationSnapshot', 'predictedPhAuthorizationId']
        #- array['confirmationSnapshot', 'predicted_ph_authorization_id']
        #- array['confirmation_snapshot', 'predictedPhAuthorizationId']
        #- array['confirmation_snapshot', 'predicted_ph_authorization_id']
    )::text);

    if p_lab_id is not null and not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = v_user_id
    ) then
        raise exception 'Access denied for lab %', p_lab_id using errcode = '42501';
    end if;

    -- Serialize retries for the same user/request pair before checking the
    -- unique index, so concurrent retries return one durable record.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_user_id::text || ':' || p_request_id::text, 0)
    );

    select wl.*
    into v_existing
    from public.waste_logs wl
    where wl.user_id = v_user_id
      and wl.request_id = p_request_id
    limit 1;

    if found then
        if v_existing.lab_id is distinct from p_lab_id then
            raise exception 'request_id was already used in another scope' using errcode = '23505';
        end if;
        if v_existing.request_payload_hash is distinct from v_payload_hash then
            raise exception 'request_id was already used with a different waste batch payload'
                using errcode = '23505';
        end if;

        return jsonb_build_object(
            'id', v_existing.id,
            'request_id', v_existing.request_id,
            'created_at', v_existing.created_at,
            'schema_version', v_existing.schema_version,
            'record_origin', v_existing.record_origin,
            'decision_status', v_existing.decision_status,
            'stream_code', v_existing.stream_code,
            'handling_action', v_existing.handling_action,
            'policy_version_id', v_existing.policy_version_id,
            'stream_snapshot', v_existing.stream_snapshot,
            'idempotent', true,
            'schemaVersion', v_existing.schema_version,
            'recordOrigin', v_existing.record_origin,
            'decisionStatus', v_existing.decision_status,
            'streamCode', v_existing.stream_code,
            'handlingAction', v_existing.handling_action,
            'policyVersionId', v_existing.policy_version_id,
            'streamSnapshot', v_existing.stream_snapshot,
            'createdAt', v_existing.created_at
        );
    end if;

    v_components := p_batch->'components';
    if v_components is null
       or jsonb_typeof(v_components) <> 'array'
       or jsonb_array_length(v_components) < 1
       or jsonb_array_length(v_components) > 100 then
        raise exception 'components must contain between 1 and 100 items' using errcode = '22023';
    end if;

    v_handling_action := coalesce(p_batch->>'handlingAction', p_batch->>'handling_action');
    v_decision_status := coalesce(
        p_batch->>'decisionStatus',
        p_batch->>'decision_status',
        p_batch #>> '{decision,decisionStatus}',
        p_batch #>> '{decision,decision_status}'
    );
    v_stream_code := coalesce(
        p_batch->>'streamCode',
        p_batch->>'stream_code',
        p_batch #>> '{decision,streamCode}',
        p_batch #>> '{decision,stream_code}'
    );
    v_matrix_code := coalesce(p_batch->>'matrix', p_batch->>'matrixCode', p_batch->>'matrix_code');
    v_decision_snapshot := coalesce(
        p_batch->'decision',
        p_batch->'decisionSnapshot',
        p_batch->'decision_snapshot',
        '{}'::jsonb
    );
    v_confirmation_snapshot := coalesce(
        p_batch->'confirmationSnapshot',
        p_batch->'confirmation_snapshot',
        jsonb_strip_nulls(jsonb_build_object(
            'batch_id', p_batch->>'batch_id',
            'scope_key', p_batch->>'scope_key',
            'matrix_source', p_batch->>'matrix_source',
            'measured_ph', p_batch->'measured_ph',
            'measured_ph_status', p_batch->>'measured_ph_status',
            'additional_components_status', p_batch->>'additional_components_status'
        ))
    );

    if jsonb_typeof(v_decision_snapshot) <> 'object'
       or jsonb_typeof(v_confirmation_snapshot) <> 'object' then
        raise exception 'decisionSnapshot and confirmationSnapshot must be JSON objects' using errcode = '22023';
    end if;

    select key
    into v_unknown_key
    from jsonb_object_keys(v_decision_snapshot) as snapshot(key)
    where not (key = any(array[
        'decisionStatus', 'decision_status',
        'streamCode', 'stream_code',
        'hazardFlags', 'hazard_flags',
        'allowedActions', 'allowed_actions',
        'blockingReasons', 'blocking_reasons',
        'missingFields', 'missing_fields',
        'policyVersion', 'policy_version',
        'ruleVersion', 'rule_version',
        'legalWastePhClass', 'legal_waste_ph_class',
        'corrosivityPhScreen', 'corrosivity_ph_screen',
        'routingBasis', 'routing_basis'
    ]::text[]))
    limit 1;

    if found then
        raise exception 'Unsupported decision snapshot key: %', v_unknown_key using errcode = '22023';
    end if;

    select key
    into v_unknown_key
    from jsonb_object_keys(v_confirmation_snapshot) as snapshot(key)
    where not (key = any(array[
        'batchId', 'batch_id',
        'scopeKey', 'scope_key',
        'matrixSource', 'matrix_source',
        'measuredBatchPh', 'measured_batch_ph',
        'measuredPh', 'measured_ph',
        'measuredPhStatus', 'measured_ph_status',
        'mixingState', 'mixing_state',
        'additionalComponentsStatus', 'additional_components_status',
        'fluorideContainerStatus', 'fluoride_container_status',
        'incidentContext', 'incident_context',
        'alreadyMixed', 'already_mixed',
        'predictedPhAuthorizationId', 'predicted_ph_authorization_id'
    ]::text[]))
    limit 1;

    if found then
        raise exception 'Unsupported confirmation snapshot key: %', v_unknown_key using errcode = '22023';
    end if;

    if coalesce(
            v_confirmation_snapshot->>'predictedPhAuthorizationId',
            v_confirmation_snapshot->>'predicted_ph_authorization_id'
       ) is not null then
        v_predicted_ph_authorization_id := coalesce(
            v_confirmation_snapshot->>'predictedPhAuthorizationId',
            v_confirmation_snapshot->>'predicted_ph_authorization_id'
        )::uuid;
        v_prediction_input_fingerprint := public.waste_ph_prediction_fingerprint(
            v_components,
            v_matrix_code,
            coalesce(p_batch->'totalAmount', p_batch->'total_amount'),
            v_confirmation_snapshot
        );
        select approval.*
        into v_predicted_ph_authorization
        from public.waste_ph_prediction_authorizations approval
        where approval.id = v_predicted_ph_authorization_id
          and approval.user_id = v_user_id
          and approval.used_at is null
          and approval.expires_at > now()
          and approval.input_fingerprint = v_prediction_input_fingerprint
        for update;
        if not found then
            raise exception 'Predicted pH authorization is missing, expired, used, or does not match this batch'
                using errcode = '22023';
        end if;
        v_analysis_confirmation_snapshot := jsonb_set(
            v_confirmation_snapshot,
            '{approvedPredictedPh}',
            v_predicted_ph_authorization.prediction_snapshot,
            true
        );
    else
        v_analysis_confirmation_snapshot := v_confirmation_snapshot;
    end if;

    -- The one-time approval is validated above and never becomes durable log
    -- metadata. Retaining it would expose a transient credential in audit reads.
    v_confirmation_snapshot := v_confirmation_snapshot
        - 'predictedPhAuthorizationId'
        - 'predicted_ph_authorization_id';

    v_rule_version := coalesce(
        v_decision_snapshot->>'ruleVersion',
        v_decision_snapshot->>'rule_version',
        p_batch->>'ruleVersion',
        p_batch->>'rule_version'
    );
    v_client_policy_version := nullif(trim(coalesce(
        v_decision_snapshot->>'policyVersion',
        v_decision_snapshot->>'policy_version'
    )), '');

    if nullif(trim(v_rule_version), '') is null then
        raise exception 'ruleVersion is required' using errcode = '22023';
    end if;

    if v_client_policy_version is null then
        raise exception 'decision policyVersion is required' using errcode = '22023';
    end if;

    if v_handling_action is null
       or v_handling_action not in ('container_deposit', 'isolated', 'handover') then
        raise exception 'Unsupported handlingAction: %', v_handling_action using errcode = '22023';
    end if;

    if v_decision_status is null
       or v_decision_status not in ('ready', 'needs_input', 'blocked') then
        raise exception 'Unsupported decisionStatus: %', v_decision_status using errcode = '22023';
    end if;

    if v_matrix_code is null or v_matrix_code not in (
        'aqueous',
        'organic_non_halogenated',
        'organic_halogenated',
        'mixed_biphasic',
        'solid_slurry',
        'unknown'
    ) then
        raise exception 'Unsupported matrix: %', v_matrix_code using errcode = '22023';
    end if;

    v_blocking_reasons := coalesce(
        v_decision_snapshot->'blockingReasons',
        v_decision_snapshot->'blocking_reasons',
        '[]'::jsonb
    );
    v_missing_fields := coalesce(
        v_decision_snapshot->'missingFields',
        v_decision_snapshot->'missing_fields',
        '[]'::jsonb
    );
    v_decision_hazard_flags := coalesce(
        v_decision_snapshot->'hazardFlags',
        v_decision_snapshot->'hazard_flags',
        '[]'::jsonb
    );
    v_allowed_actions := coalesce(
        v_decision_snapshot->'allowedActions',
        v_decision_snapshot->'allowed_actions',
        '[]'::jsonb
    );

    if jsonb_typeof(v_blocking_reasons) <> 'array'
       or jsonb_typeof(v_missing_fields) <> 'array'
       or jsonb_typeof(v_decision_hazard_flags) <> 'array'
       or jsonb_typeof(v_allowed_actions) <> 'array' then
        raise exception 'Decision hazards, actions, reasons, and missing fields must be arrays' using errcode = '22023';
    end if;

    if jsonb_array_length(v_allowed_actions) < 1
       or jsonb_array_length(v_allowed_actions) > 3
       or exists (
           select 1
           from jsonb_array_elements(v_allowed_actions) action(value)
           where jsonb_typeof(action.value) <> 'string'
              or action.value #>> '{}' not in ('container_deposit', 'isolated', 'handover')
       )
       or not exists (
           select 1
           from jsonb_array_elements_text(v_allowed_actions) action(value)
           where action.value = v_handling_action
       ) then
        raise exception 'handlingAction must be present in a valid allowedActions array' using errcode = '22023';
    end if;

    if jsonb_array_length(v_decision_hazard_flags) > 32
       or exists (
           select 1
           from jsonb_array_elements(v_decision_hazard_flags) flag(value)
           where jsonb_typeof(flag.value) <> 'string'
              or flag.value #>> '{}' not in (
                  'FLAMMABLE', 'OXIDIZER', 'EXPLOSIVE', 'SELF_REACTIVE',
                  'WATER_REACTIVE', 'PYROPHORIC', 'CORROSIVE', 'ACUTE_TOXIC',
                  'CMR', 'ENVIRONMENTAL_HAZARD', 'CYANIDE', 'SULFIDE',
                  'HEAVY_METAL', 'HYDROFLUORIC_ACID', 'FLUORIDE',
                  'REACTIVE', 'UNKNOWN_COMPONENT'
              )
       ) then
        raise exception 'decision hazardFlags contains an unsupported value' using errcode = '22023';
    end if;

    if jsonb_array_length(v_blocking_reasons) > 100
       or exists (
           select 1
           from jsonb_array_elements(v_blocking_reasons) reason(value)
           where jsonb_typeof(reason.value) <> 'object'
       ) then
        raise exception 'blockingReasons must contain at most 100 objects' using errcode = '22023';
    end if;

    if jsonb_array_length(v_missing_fields) > 20
       or exists (
           select 1
           from jsonb_array_elements(v_missing_fields) missing(value)
           where jsonb_typeof(missing.value) <> 'string'
              or missing.value #>> '{}' not in (
                  'components', 'matrix', 'total_amount', 'measured_ph',
                  'identity', 'hazard_data', 'additional_components',
                  'mixing_state', 'fluoride_container', 'inventory_quantity',
                  'policy_stream', 'policy_destination'
              )
       ) then
        raise exception 'missingFields contains an unsupported value' using errcode = '22023';
    end if;

    -- Recalculate the safety result from component identity/category/GHS data,
    -- claimed component flags, and the batch matrix. The client decision is
    -- evidence for the UI only; it is never the authority for a write.
    v_server_analysis := private.analyze_waste_batch_v2(
        v_components,
        v_matrix_code,
        v_analysis_confirmation_snapshot
    );
    v_server_decision_status := v_server_analysis->>'decisionStatus';
    v_server_stream_code := v_server_analysis->>'streamCode';
    v_server_hazard_flags := v_server_analysis->'hazardFlags';
    v_server_blocking_codes := v_server_analysis->'blockingCodes';

    select coalesce(array_agg(distinct value order by value), array[]::text[])
    into v_client_hazard_array
    from jsonb_array_elements_text(v_decision_hazard_flags) flags(value);
    select coalesce(array_agg(distinct value order by value), array[]::text[])
    into v_server_hazard_array
    from jsonb_array_elements_text(v_server_hazard_flags) flags(value);

    if v_client_hazard_array is distinct from v_server_hazard_array then
        raise exception 'decision hazardFlags does not match server-derived component hazards'
            using errcode = '22023';
    end if;
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
        if v_handling_action <> 'container_deposit'
           or jsonb_array_length(v_blocking_reasons) > 0
           or jsonb_array_length(v_missing_fields) > 0 then
            raise exception 'ready decisions require container_deposit and no blocking or missing reasons' using errcode = '22023';
        end if;
    elsif v_decision_status = 'needs_input' then
        if v_handling_action = 'container_deposit'
           or jsonb_array_length(v_missing_fields) = 0 then
            raise exception 'needs_input decisions require a missing field and a non-deposit action' using errcode = '22023';
        end if;
    else
        if v_handling_action = 'container_deposit'
           or jsonb_array_length(v_blocking_reasons) = 0 then
            raise exception 'blocked decisions require a blocking reason and a non-deposit action' using errcode = '22023';
        end if;
    end if;

    select count(distinct pv.id)
    into v_institution_policy_count
    from public.waste_policy_versions pv
    join public.safety_center_lab_links scl
      on scl.center_id = pv.safety_center_id
     and scl.lab_id = p_lab_id
     and scl.status = 'approved'
     and 'waste_management' = any(scl.scope)
    join public.safety_centers sc
      on sc.id = pv.safety_center_id
     and sc.status = 'approved'
    where p_lab_id is not null
      and pv.scope_type = 'safety_center'
      and pv.status = 'active';

    if v_institution_policy_count > 1 then
        raise exception
            'Multiple active safety-center waste policies are linked to lab %; resolve the waste_management policy authority before recording',
            p_lab_id
            using errcode = 'P0003';
    end if;

    with candidate_versions as (
        select pv.id, pv.scope_type, pv.activated_at, 10 as priority
        from public.waste_policy_versions pv
        where pv.scope_type = 'system'
          and pv.status = 'active'

        union all

        select pv.id, pv.scope_type, pv.activated_at, 20 as priority
        from public.waste_policy_versions pv
        join public.safety_center_lab_links scl
          on scl.center_id = pv.safety_center_id
         and scl.lab_id = p_lab_id
         and scl.status = 'approved'
         and 'waste_management' = any(scl.scope)
        join public.safety_centers sc
          on sc.id = pv.safety_center_id
         and sc.status = 'approved'
        where p_lab_id is not null
          and pv.scope_type = 'safety_center'
          and pv.status = 'active'

    )
    select
        ps.policy_version_id,
        pv.version_label as policy_version_label,
        ps.stream_code as policy_stream_code,
        cv.scope_type,
        ps.display_name_ko,
        ps.display_name_en,
        ps.description_ko,
        coalesce(nullif(trim(lo.container_label), ''), ps.container_label) as container_label,
        coalesce(nullif(trim(lo.container_color), ''), ps.container_color) as container_color,
        coalesce(
            nullif(trim(lo.replacement_location), ''),
            nullif(trim(lo.location), ''),
            ps.location
        ) as location,
        coalesce(nullif(trim(lo.handler_contact), ''), ps.handler_contact) as handler_contact,
        ps.sop_url,
        ps.allowed_hazard_flags,
        ps.blocked_hazard_flags,
        ps.prohibitions,
        ps.label_requirements,
        ps.is_enabled,
        coalesce(lo.is_disabled, false) as is_disabled,
        (
            not coalesce(lo.is_disabled, false)
            or nullif(trim(lo.replacement_location), '') is not null
        ) as effective_is_enabled,
        pv.source_refs
    into v_stream
    from candidate_versions cv
    join public.waste_policy_versions pv on pv.id = cv.id
    join public.waste_policy_streams ps on ps.policy_version_id = cv.id
    left join public.waste_policy_lab_overrides lo
      on lo.lab_id = p_lab_id
     and lo.stream_code = ps.stream_code
    where ps.stream_code in (v_stream_code, 'SPECIAL_REVIEW')
    order by
        case when ps.stream_code = v_stream_code then 0 else 1 end,
        cv.priority desc,
        cv.activated_at desc nulls last,
        ps.policy_version_id
    limit 1;

    if not found then
        raise exception 'No active policy or SPECIAL_REVIEW audit stream is available for %',
            v_stream_code using errcode = '22023';
    end if;

    -- The client analyzed the batch against a specific immutable policy
    -- version. Accept the UUID returned by the resolver or its immutable
    -- version label for the built-in policy, but never silently write against
    -- a different version activated after that analysis.
    if v_client_policy_version is distinct from v_stream.policy_version_id::text
       and not (
           v_stream.scope_type = 'system'
           and v_client_policy_version is not distinct from v_stream.policy_version_label
       ) then
        raise exception
            'Waste policy changed after analysis (client %, current %); refresh the policy and analyze the batch again',
            v_client_policy_version,
            v_stream.policy_version_id
            using errcode = '40001';
    end if;

    -- A disabled institution/lab stream prohibits normal container deposit,
    -- but it must never prevent recording an isolation or handover that the
    -- safety decision already requires. If a policy omitted the derived stream
    -- entirely, SPECIAL_REVIEW supplies immutable audit instructions while the
    -- server-derived stream code remains unchanged in the waste record.
    if v_handling_action = 'container_deposit'
       and (
           v_stream.policy_stream_code is distinct from v_stream_code
           or not v_stream.is_enabled
           or not v_stream.effective_is_enabled
       ) then
        raise exception 'No enabled policy destination is available for %', v_stream_code
            using errcode = '22023';
    end if;

    select flag
    into v_policy_flag
    from unnest(v_stream.blocked_hazard_flags) blocked(flag)
    where flag = any(v_server_hazard_array)
    order by flag
    limit 1;
    if found then
        v_policy_blocks := true;
        v_server_blocking_codes := v_server_blocking_codes
            || jsonb_build_array('policy_blocked:' || v_policy_flag);
    end if;

    if cardinality(v_stream.allowed_hazard_flags) > 0 then
        select flag
        into v_policy_flag
        from unnest(v_server_hazard_array) derived(flag)
        where not (flag = any(v_stream.allowed_hazard_flags))
        order by flag
        limit 1;
        if found then
            v_policy_blocks := true;
            v_server_blocking_codes := v_server_blocking_codes
                || jsonb_build_array('policy_disallowed:' || v_policy_flag);
        end if;
    end if;

    if v_policy_blocks then
        v_server_decision_status := 'blocked';
        v_server_analysis := jsonb_set(
            jsonb_set(
                jsonb_set(
                    v_server_analysis,
                    '{decisionStatus}',
                    to_jsonb(v_server_decision_status),
                    true
                ),
                '{allowedActions}',
                jsonb_build_array('isolated', 'handover'),
                true
            ),
            '{blockingCodes}',
            v_server_blocking_codes,
            true
        );
    end if;

    if v_decision_status is distinct from v_server_decision_status then
        raise exception 'decisionStatus % does not match server-derived status %',
            v_decision_status, v_server_decision_status using errcode = '22023';
    end if;
    v_total_amount := coalesce(p_batch->'totalAmount', p_batch->'total_amount');
    if v_total_amount is null or jsonb_typeof(v_total_amount) <> 'object' then
        raise exception 'totalAmount must be an object with a positive value and unit or explicit unknown=true'
            using errcode = '22023';
    end if;

    select key
    into v_unknown_key
    from jsonb_object_keys(v_total_amount) as amount(key)
    where not (key = any(array[
        'value', 'unit',
        'approximate', 'is_approximate',
        'unknown', 'is_unknown'
    ]::text[]))
    limit 1;

    if found then
        raise exception 'Unsupported totalAmount key: %', v_unknown_key using errcode = '22023';
    end if;

    if (v_total_amount ? 'unknown'
            and jsonb_typeof(v_total_amount->'unknown') <> 'boolean')
       or (v_total_amount ? 'is_unknown'
            and jsonb_typeof(v_total_amount->'is_unknown') <> 'boolean') then
        raise exception 'totalAmount.unknown must be boolean' using errcode = '22023';
    end if;
    if v_total_amount ? 'unknown'
       and v_total_amount ? 'is_unknown'
       and v_total_amount->>'unknown' is distinct from v_total_amount->>'is_unknown' then
        raise exception 'Conflicting totalAmount unknown aliases are not allowed' using errcode = '22023';
    end if;
    if (v_total_amount ? 'approximate'
            and jsonb_typeof(v_total_amount->'approximate') <> 'boolean')
       or (v_total_amount ? 'is_approximate'
            and jsonb_typeof(v_total_amount->'is_approximate') <> 'boolean') then
        raise exception 'totalAmount.approximate must be boolean' using errcode = '22023';
    end if;
    if v_total_amount ? 'approximate'
       and v_total_amount ? 'is_approximate'
       and v_total_amount->>'approximate' is distinct from v_total_amount->>'is_approximate' then
        raise exception 'Conflicting totalAmount approximate aliases are not allowed' using errcode = '22023';
    end if;

    v_amount_unknown := coalesce(
        (v_total_amount->>'unknown')::boolean,
        (v_total_amount->>'is_unknown')::boolean,
        false
    );
    v_amount_approximate := coalesce(
        (v_total_amount->>'approximate')::boolean,
        (v_total_amount->>'is_approximate')::boolean,
        false
    );

    if v_amount_unknown then
        if v_amount_approximate then
            raise exception 'An unknown amount cannot also be approximate' using errcode = '22023';
        end if;
        if v_total_amount->>'value' is not null or v_total_amount->>'unit' is not null then
            raise exception 'An unknown amount cannot include a value or unit' using errcode = '22023';
        end if;
    else
        v_amount_text := v_total_amount->>'value';
        v_amount_unit := v_total_amount->>'unit';

        if v_amount_text is null
           or v_amount_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)(?:[eE][+-]?[0-9]+)?$' then
            raise exception 'totalAmount.value must be a positive finite number' using errcode = '22023';
        end if;

        v_amount_value := v_amount_text::numeric;
        if v_amount_value <= 0 or v_amount_value::text in ('NaN', 'Infinity', '-Infinity') then
            raise exception 'totalAmount.value must be a positive finite number' using errcode = '22023';
        end if;

        if v_matrix_code = 'solid_slurry' and v_amount_unit not in ('mg', 'g') then
            raise exception 'Solid or slurry amounts must use mg or g' using errcode = '22023';
        elsif v_matrix_code = 'unknown' and v_amount_unit not in ('mL', 'L', 'mg', 'g') then
            raise exception 'Unknown-matrix amounts must use mL, L, mg, or g' using errcode = '22023';
        elsif v_matrix_code not in ('solid_slurry', 'unknown') and v_amount_unit not in ('mL', 'L') then
            raise exception 'Liquid amounts must use mL or L' using errcode = '22023';
        end if;

        if v_amount_unit = 'L' then
            v_normalized_value := v_amount_value * 1000;
            v_normalized_unit := 'mL';
        elsif v_amount_unit = 'mL' then
            v_normalized_value := v_amount_value;
            v_normalized_unit := 'mL';
        elsif v_amount_unit = 'g' then
            v_normalized_value := v_amount_value * 1000;
            v_normalized_unit := 'mg';
        else
            v_normalized_value := v_amount_value;
            v_normalized_unit := 'mg';
        end if;
    end if;

    -- The recorded handler is always derived from the authenticated session.
    -- Delegated handling needs a separate authorized workflow; a free client
    -- string is not accepted as audit identity.
    v_handler_name := private.actor_display_name_v2(v_user_id, p_lab_id);
    v_memo := nullif(trim(p_batch->>'memo'), '');

    if length(coalesce(v_memo, '')) > 2000 then
        raise exception 'memo must be 2000 characters or fewer' using errcode = '22023';
    end if;

    v_stream_snapshot := jsonb_build_object(
        'streamCode', v_stream_code,
        'displayNameKo', v_stream.display_name_ko,
        'displayNameEn', v_stream.display_name_en,
        'descriptionKo', v_stream.description_ko,
        'containerLabel', v_stream.container_label,
        'containerColor', v_stream.container_color,
        'location', v_stream.location,
        'handlerContact', v_stream.handler_contact,
        'sopUrl', v_stream.sop_url,
        'allowedHazardFlags', to_jsonb(v_stream.allowed_hazard_flags),
        'blockedHazardFlags', to_jsonb(v_stream.blocked_hazard_flags),
        'prohibitions', to_jsonb(v_stream.prohibitions),
        'labelRequirements', to_jsonb(v_stream.label_requirements),
        'policyVersionId', v_stream.policy_version_id,
        'policyScope', v_stream.scope_type,
        'sourceRefs', v_stream.source_refs
    );

    if v_predicted_ph_authorization_id is not null
       and v_server_analysis->>'routingBasis' = 'predicted_batch_ph' then
        update public.waste_ph_prediction_authorizations
        set used_at = now()
        where id = v_predicted_ph_authorization_id
          and used_at is null;
        if not found then
            raise exception 'Predicted pH authorization was already consumed' using errcode = '40001';
        end if;
    end if;

    v_decision_snapshot := v_decision_snapshot || jsonb_build_object(
        'decisionStatus', v_decision_status,
        'streamCode', v_stream_code,
        'handlingAction', v_handling_action,
        'ruleVersion', v_rule_version,
        'policyVersionId', v_stream.policy_version_id,
        'serverAnalysis', v_server_analysis,
        'validatedAt', now()
    );

    insert into public.waste_logs (
        user_id,
        lab_id,
        chemicals,
        disposal_category,
        total_volume_ml,
        handler_name,
        memo,
        schema_version,
        record_origin,
        handling_action,
        decision_status,
        stream_code,
        matrix_code,
        policy_version_id,
        rule_version,
        total_amount_value,
        total_amount_unit,
        normalized_amount_value,
        normalized_amount_unit,
        amount_is_approximate,
        amount_is_unknown,
        decision_snapshot,
        stream_snapshot,
        confirmation_snapshot,
        request_id,
        request_payload_hash
    ) values (
        v_user_id,
        p_lab_id,
        v_components,
        v_stream.display_name_ko,
        case when v_normalized_unit = 'mL' then v_normalized_value else null end,
        v_handler_name,
        v_memo,
        2,
        'waste_batch',
        v_handling_action,
        v_decision_status,
        v_stream_code,
        v_matrix_code,
        v_stream.policy_version_id,
        v_rule_version,
        v_amount_value,
        v_amount_unit,
        v_normalized_value,
        v_normalized_unit,
        v_amount_approximate,
        v_amount_unknown,
        v_decision_snapshot,
        v_stream_snapshot,
        v_confirmation_snapshot,
        p_request_id,
        v_payload_hash
    )
    returning id, stream_snapshot into v_log_id, v_stream_snapshot;

    for v_component, v_ordinality in
        select component.value, component.ordinality
        from jsonb_array_elements(v_components) with ordinality as component(value, ordinality)
    loop
        if jsonb_typeof(v_component) <> 'object' then
            raise exception 'Every component must be a JSON object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_component) as component_key(key)
        where not (key = any(array[
            'cartLineId', 'cart_line_id',
            'sourceType', 'source_type',
            'sourceRef', 'source_ref',
            'inventoryItemId', 'inventory_item_id',
            'cabinetItemId', 'cabinet_item_id',
            'chemicalName', 'chemical_name', 'name',
            'casNumber', 'cas_number',
            'formula',
            'molecularWeight', 'molecular_weight',
            'pubchemCid', 'pubchem_cid',
            'koshaChemId', 'kosha_chem_id',
            'identityConfidence', 'identity_confidence',
            'ghsDataStatus', 'ghs_data_status',
            'concentration', 'concentration_value', 'concentration_unit',
            'hazardFlags', 'hazard_flags',
            'dataSources', 'data_sources',
            'analysisSnapshot', 'analysis_snapshot'
        ]::text[]))
        limit 1;

        if found then
            raise exception 'Unsupported component payload key: %', v_unknown_key using errcode = '22023';
        end if;

        v_cart_line_id := nullif(trim(coalesce(
            v_component->>'cartLineId',
            v_component->>'cart_line_id'
        )), '');
        v_chemical_name := nullif(trim(coalesce(
            v_component->>'chemicalName',
            v_component->>'chemical_name',
            v_component->>'name'
        )), '');
        v_source_type := coalesce(
            nullif(trim(v_component->>'sourceType'), ''),
            nullif(trim(v_component->>'source_type'), ''),
            'search'
        );

        if v_cart_line_id is null or length(v_cart_line_id) > 200 then
            raise exception 'Each component requires a cartLineId of 200 characters or fewer' using errcode = '22023';
        end if;
        if v_chemical_name is null or length(v_chemical_name) > 500 then
            raise exception 'Each component requires a chemical name of 500 characters or fewer' using errcode = '22023';
        end if;
        if v_source_type not in ('search', 'scan', 'inventory', 'cabinet', 'manual', 'import') then
            raise exception 'Unsupported component sourceType: %', v_source_type using errcode = '22023';
        end if;

        v_inventory_item_id := nullif(coalesce(
            v_component->>'inventoryItemId',
            v_component->>'inventory_item_id'
        ), '')::uuid;
        v_cabinet_item_id := nullif(coalesce(
            v_component->>'cabinetItemId',
            v_component->>'cabinet_item_id'
        ), '')::uuid;

        if v_source_type = 'inventory' and v_inventory_item_id is null then
            raise exception 'inventory source components require inventoryItemId' using errcode = '22023';
        end if;
        if v_source_type = 'cabinet' and v_cabinet_item_id is null then
            raise exception 'cabinet source components require cabinetItemId' using errcode = '22023';
        end if;

        if v_inventory_item_id is not null then
            select i.lab_id, i.user_id
            into v_ref_lab_id, v_ref_user_id
            from public.inventory i
            where i.id = v_inventory_item_id;

            if not found then
                raise exception 'Inventory component not found: %', v_inventory_item_id using errcode = 'P0002';
            end if;

            if p_lab_id is null then
                if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                    raise exception 'Inventory component is outside the personal scope' using errcode = '42501';
                end if;
            elsif v_ref_lab_id is distinct from p_lab_id then
                raise exception 'Inventory component is outside the selected lab' using errcode = '42501';
            end if;
        end if;

        if v_cabinet_item_id is not null then
            select c.lab_id, c.user_id
            into v_ref_lab_id, v_ref_user_id
            from public.cabinet_items ci
            join public.cabinets c on c.id = ci.cabinet_id
            where ci.id = v_cabinet_item_id;

            if not found then
                raise exception 'Cabinet component not found: %', v_cabinet_item_id using errcode = 'P0002';
            end if;

            if p_lab_id is null then
                if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                    raise exception 'Cabinet component is outside the personal scope' using errcode = '42501';
                end if;
            elsif v_ref_lab_id is distinct from p_lab_id then
                raise exception 'Cabinet component is outside the selected lab' using errcode = '42501';
            end if;
        end if;

        -- The canonical client payload uses `concentration: null` when the
        -- optional value is absent. JSON null is distinct from SQL NULL, so
        -- normalize both forms to an empty object before validating it.
        v_concentration := coalesce(
            nullif(v_component->'concentration', 'null'::jsonb),
            '{}'::jsonb
        );
        if jsonb_typeof(v_concentration) <> 'object' then
            raise exception 'component concentration must be an object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_concentration) as concentration_key(key)
        where key not in ('value', 'unit')
        limit 1;

        if found then
            raise exception 'Unsupported concentration key: %', v_unknown_key using errcode = '22023';
        end if;

        v_concentration_value := null;
        v_concentration_text := coalesce(
            v_concentration->>'value',
            v_component->>'concentration_value'
        );
        v_concentration_unit := coalesce(
            v_concentration->>'unit',
            v_component->>'concentration_unit'
        );
        if v_concentration_text is not null then
            if v_concentration_text !~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)(?:[eE][+-]?[0-9]+)?$' then
                raise exception 'concentration.value must be a positive finite number' using errcode = '22023';
            end if;
            v_concentration_value := v_concentration_text::numeric;
            if v_concentration_value <= 0
               or v_concentration_value::text in ('NaN', 'Infinity', '-Infinity')
               or v_concentration_unit not in ('M', 'mM', '%', 'mg/mL') then
                raise exception 'Invalid concentration value or unit' using errcode = '22023';
            end if;
        elsif v_concentration_unit is not null then
            raise exception 'concentration.unit requires concentration.value' using errcode = '22023';
        end if;

        v_hazard_flags := coalesce(v_component->'hazardFlags', v_component->'hazard_flags', '[]'::jsonb);
        if jsonb_typeof(v_hazard_flags) <> 'array'
           or jsonb_array_length(v_hazard_flags) > 32
           or exists (
               select 1
               from jsonb_array_elements(v_hazard_flags) flag(value)
               where jsonb_typeof(flag.value) <> 'string'
                  or flag.value #>> '{}' not in (
                      'FLAMMABLE', 'OXIDIZER', 'EXPLOSIVE', 'SELF_REACTIVE',
                      'WATER_REACTIVE', 'PYROPHORIC', 'CORROSIVE', 'ACUTE_TOXIC',
                      'CMR', 'ENVIRONMENTAL_HAZARD', 'CYANIDE', 'SULFIDE',
                      'HEAVY_METAL', 'HYDROFLUORIC_ACID', 'FLUORIDE',
                      'REACTIVE', 'UNKNOWN_COMPONENT'
                  )
           ) then
            raise exception 'component hazardFlags contains an unsupported value' using errcode = '22023';
        end if;

        v_ghs_data_status := coalesce(
            v_component->>'ghsDataStatus',
            v_component->>'ghs_data_status'
        );
        if v_ghs_data_status not in ('verified', 'lookup_failed', 'not_checked') then
            raise exception 'component ghsDataStatus must be verified, lookup_failed, or not_checked'
                using errcode = '22023';
        end if;

        if jsonb_typeof(coalesce(v_component->'dataSources', v_component->'data_sources', '[]'::jsonb)) <> 'array'
           or jsonb_array_length(coalesce(v_component->'dataSources', v_component->'data_sources', '[]'::jsonb)) > 20 then
            raise exception 'component dataSources must contain at most 20 records' using errcode = '22023';
        end if;

        if jsonb_typeof(coalesce(v_component->'analysisSnapshot', v_component->'analysis_snapshot', '{}'::jsonb)) <> 'object' then
            raise exception 'component analysisSnapshot must be an object' using errcode = '22023';
        end if;

        v_identity_confidence := nullif(coalesce(
            v_component->>'identityConfidence',
            v_component->>'identity_confidence'
        ), '')::numeric;
        if v_identity_confidence is not null and (v_identity_confidence < 0 or v_identity_confidence > 1) then
            raise exception 'identityConfidence must be between 0 and 1' using errcode = '22023';
        end if;

        insert into public.waste_log_items (
            waste_log_id,
            line_number,
            cart_line_id,
            source_type,
            source_ref,
            inventory_item_id,
            cabinet_item_id,
            chemical_name,
            cas_number,
            formula,
            molecular_weight,
            pubchem_cid,
            kosha_chem_id,
            identity_confidence,
            ghs_data_status,
            concentration_value,
            concentration_unit,
            hazard_flags,
            data_sources,
            analysis_snapshot
        ) values (
            v_log_id,
            v_ordinality::integer,
            v_cart_line_id,
            v_source_type,
            coalesce(
                v_component->>'sourceRef',
                v_component->>'source_ref',
                v_inventory_item_id::text,
                v_cabinet_item_id::text
            ),
            v_inventory_item_id,
            v_cabinet_item_id,
            v_chemical_name,
            nullif(coalesce(v_component->>'casNumber', v_component->>'cas_number'), ''),
            nullif(v_component->>'formula', ''),
            nullif(coalesce(v_component->>'molecularWeight', v_component->>'molecular_weight'), '')::numeric,
            nullif(coalesce(v_component->>'pubchemCid', v_component->>'pubchem_cid'), '')::bigint,
            nullif(coalesce(v_component->>'koshaChemId', v_component->>'kosha_chem_id'), ''),
            v_identity_confidence,
            v_ghs_data_status,
            v_concentration_value,
            v_concentration_unit,
            array(select jsonb_array_elements_text(v_hazard_flags)),
            coalesce(v_component->'dataSources', v_component->'data_sources', '[]'::jsonb),
            coalesce(v_component->'analysisSnapshot', v_component->'analysis_snapshot', '{}'::jsonb)
        );
    end loop;

    return jsonb_build_object(
        'id', v_log_id,
        'request_id', p_request_id,
        'created_at', now(),
        'schema_version', 2,
        'record_origin', 'waste_batch',
        'decision_status', v_decision_status,
        'stream_code', v_stream_code,
        'handling_action', v_handling_action,
        'policy_version_id', v_stream.policy_version_id,
        'stream_snapshot', v_stream_snapshot,
        'idempotent', false,
        'schemaVersion', 2,
        'recordOrigin', 'waste_batch',
        'decisionStatus', v_decision_status,
        'streamCode', v_stream_code,
        'handlingAction', v_handling_action,
        'policyVersionId', v_stream.policy_version_id,
        'streamSnapshot', v_stream_snapshot,
        'createdAt', now()
    );
end;
$_$;


--
-- Name: release_chemical_enrichment_lease(text, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_chemical_enrichment_lease(p_lease_key text, p_result_version integer, p_owner_token uuid) RETURNS boolean
    LANGUAGE sql
    SET search_path TO ''
    AS $$
    with deleted as (
        delete from public.chemical_enrichment_leases
        where lease_key = p_lease_key
          and result_version = p_result_version
          and owner_token = p_owner_token
        returning 1
    )
    select exists(select 1 from deleted);
$$;


--
-- Name: remove_inventory_record_v2(jsonb, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_inventory_record_v2(p_items jsonb, p_lab_id uuid DEFAULT NULL::uuid, p_actor_name text DEFAULT NULL::text, p_reason text DEFAULT 'Incorrect inventory record'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_item jsonb;
    v_item_id uuid;
    v_item_source text;
    v_item_name text;
    v_cabinet_id uuid;
    v_key text;
    v_seen_keys text[] := array[]::text[];
    v_removed_items jsonb := '[]'::jsonb;
    v_unknown_key text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) < 1
       or jsonb_array_length(p_items) > 100 then
        raise exception 'items must contain between 1 and 100 records' using errcode = '22023';
    end if;

    if octet_length(p_items::text) > 65536 then
        raise exception 'items payload must be 64 KiB or smaller' using errcode = '22023';
    end if;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        if jsonb_typeof(v_item) <> 'object' then
            raise exception 'Every inventory record must be a JSON object' using errcode = '22023';
        end if;

        select key
        into v_unknown_key
        from jsonb_object_keys(v_item) as item_key(key)
        where key not in ('item_id', 'itemId', 'item_source', 'itemSource')
        limit 1;

        if found then
            raise exception 'Unsupported inventory record key: %', v_unknown_key using errcode = '22023';
        end if;

        v_item_id := nullif(coalesce(v_item->>'item_id', v_item->>'itemId'), '')::uuid;
        v_item_source := coalesce(v_item->>'item_source', v_item->>'itemSource');

        if v_item_id is null or v_item_source not in ('inventory', 'cabinet_item') then
            raise exception 'Each record requires item_id and a valid item_source' using errcode = '22023';
        end if;

        v_key := v_item_source || ':' || v_item_id::text;
        if v_key = any(v_seen_keys) then
            raise exception 'Duplicate inventory record in request: %', v_key using errcode = '22023';
        end if;
        v_seen_keys := array_append(v_seen_keys, v_key);

        if v_item_source = 'inventory' then
            select i.name, i.cabinet_id
            into v_item_name, v_cabinet_id
            from public.inventory i
            where i.id = v_item_id;
        else
            select ci.name, ci.cabinet_id
            into v_item_name, v_cabinet_id
            from public.cabinet_items ci
            where ci.id = v_item_id;
        end if;

        if not found then
            raise exception 'Inventory record not found: %', v_key using errcode = 'P0002';
        end if;

        perform public.delete_inventory_item_atomic(
            p_item_id => v_item_id,
            p_item_source => v_item_source,
            p_item_name => v_item_name,
            p_lab_id => p_lab_id,
            p_cabinet_id => v_cabinet_id,
            p_cabinet_name => null,
            p_storage_location_name => null,
            p_disposal_reason => coalesce(nullif(trim(p_reason), ''), 'Incorrect inventory record'),
            p_actor_name => p_actor_name
        );

        v_removed_items := v_removed_items || jsonb_build_array(
            jsonb_build_object('item_id', v_item_id, 'item_source', v_item_source)
        );
    end loop;

    return jsonb_build_object(
        'removed_count', jsonb_array_length(v_removed_items),
        'removed_items', v_removed_items
    );
end;
$$;


--
-- Name: remove_lab_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_lab_member(target_lab_id uuid, target_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- Check if caller is an admin OR the user is removing themselves
    IF auth.uid() != target_user_id AND NOT EXISTS (
        SELECT 1 FROM public.lab_members
        WHERE lab_id = target_lab_id
        AND user_id = auth.uid()
        AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Only admins can remove other members';
    END IF;

    -- Remove member
    DELETE FROM public.lab_members
    WHERE lab_id = target_lab_id
    AND user_id = target_user_id;

    RETURN jsonb_build_object('success', true);
END;
$$;


--
-- Name: request_safety_center_lab_link(uuid, uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_safety_center_lab_link(p_center_id uuid, p_lab_id uuid, p_scope text[] DEFAULT ARRAY['summary'::text, 'risk_detail'::text, 'exports'::text]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_center_status text;
    v_center_institution text;
    v_lab_institution text;
    v_link_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id, array['owner', 'manager']) then
        raise exception 'Only center owners and managers can request lab links' using errcode = '42501';
    end if;

    select sc.status, sc.institution_name
    into v_center_status, v_center_institution
    from public.safety_centers sc
    where sc.id = p_center_id;

    if v_center_status <> 'approved' then
        raise exception 'Safety center must be approved before requesting labs' using errcode = '42501';
    end if;

    select l.institution_name
    into v_lab_institution
    from public.labs l
    where l.id = p_lab_id;

    if lower(coalesce(v_lab_institution, '')) <> lower(v_center_institution) then
        raise exception 'Lab institution does not match this safety center' using errcode = '42501';
    end if;

    insert into public.safety_center_lab_links (
        center_id,
        lab_id,
        status,
        scope,
        requested_by,
        approved_by,
        responded_at
    ) values (
        p_center_id,
        p_lab_id,
        'requested',
        coalesce(p_scope, array['summary', 'risk_detail', 'exports']::text[]),
        v_user_id,
        null,
        null
    )
    on conflict (center_id, lab_id) do update
    set
        status = case
            when public.safety_center_lab_links.status = 'approved' then 'approved'
            else 'requested'
        end,
        scope = excluded.scope,
        requested_by = excluded.requested_by,
        requested_at = now(),
        approved_by = case
            when public.safety_center_lab_links.status = 'approved' then public.safety_center_lab_links.approved_by
            else null
        end,
        responded_at = case
            when public.safety_center_lab_links.status = 'approved' then public.safety_center_lab_links.responded_at
            else null
        end
    returning id into v_link_id;

    return v_link_id;
end;
$$;


--
-- Name: respond_safety_center_lab_link(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_safety_center_lab_link(p_link_id uuid, p_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_lab_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_status not in ('approved', 'rejected', 'revoked') then
        raise exception 'Unsupported link response status: %', p_status using errcode = '22023';
    end if;

    select scl.lab_id
    into v_lab_id
    from public.safety_center_lab_links scl
    where scl.id = p_link_id;

    if not found then
        raise exception 'Center link not found' using errcode = 'P0002';
    end if;

    if not public.is_lab_admin(v_lab_id) then
        raise exception 'Only lab admins can respond to center links' using errcode = '42501';
    end if;

    update public.safety_center_lab_links
    set
        status = p_status,
        approved_by = case when p_status = 'approved' then v_user_id else approved_by end,
        responded_at = now()
    where id = p_link_id;
end;
$$;


--
-- Name: safety_center_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.safety_center_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
    new.updated_at := now();
    return new;
end;
$$;


--
-- Name: safety_compliance_events_set_normalized_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.safety_compliance_events_set_normalized_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
    new.primary_chemical_name_normalized := public.analytics_normalize_text(new.primary_chemical_name);
    new.primary_cas_number_normalized := public.analytics_normalize_cas(new.primary_cas_number);
    new.secondary_chemical_name_normalized := public.analytics_normalize_text(new.secondary_chemical_name);
    new.secondary_cas_number_normalized := public.analytics_normalize_cas(new.secondary_cas_number);
    return new;
end;
$$;


--
-- Name: save_cabinet_state_atomic(uuid, jsonb, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_cabinet_state_atomic(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
    v_shelf jsonb;
    v_item jsonb;
    v_shelf_id uuid;
    v_item_id uuid;
    v_existing_cabinet_id uuid;
    v_shelf_ids uuid[] := array[]::uuid[];
    v_item_ids uuid[] := array[]::uuid[];
    v_level integer;
    v_template text;
    v_name text;
    v_width numeric;
    v_position numeric;
    v_depth_position numeric;
    v_remaining_percent integer;
begin
    if (select auth.uid()) is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_cabinet_id is null then
        raise exception 'cabinet_id is required' using errcode = '22023';
    end if;
    if jsonb_typeof(p_shelves) is distinct from 'array' then
        raise exception 'shelves must be a JSON array' using errcode = '22023';
    end if;
    if p_width not between 4 and 20 then
        raise exception 'cabinet width must be between 4 and 20' using errcode = '22023';
    end if;
    if p_height not between 2 and 15 then
        raise exception 'cabinet height must be between 2 and 15' using errcode = '22023';
    end if;
    if p_depth not between 1 and 4 then
        raise exception 'cabinet depth must be between 1 and 4' using errcode = '22023';
    end if;

    -- This row lock serializes saves for the same cabinet. RLS hides cabinets
    -- the caller cannot update, which produces the same not-found result.
    perform 1
    from public.cabinets c
    where c.id = p_cabinet_id
    for update;

    if not found then
        raise exception 'Cabinet not found or access denied: %', p_cabinet_id using errcode = 'P0002';
    end if;

    for v_shelf in
        select value
        from jsonb_array_elements(p_shelves)
    loop
        if jsonb_typeof(v_shelf) is distinct from 'object' then
            raise exception 'Each shelf must be a JSON object' using errcode = '22023';
        end if;
        if jsonb_typeof(v_shelf->'dividers') is distinct from 'array' then
            raise exception 'Shelf dividers must be a JSON array' using errcode = '22023';
        end if;
        if jsonb_typeof(v_shelf->'items') is distinct from 'array' then
            raise exception 'Shelf items must be a JSON array' using errcode = '22023';
        end if;

        begin
            v_shelf_id := (v_shelf->>'id')::uuid;
            v_level := (v_shelf->>'level')::integer;
        exception
            when invalid_text_representation or null_value_not_allowed then
                raise exception 'Shelf id and level must be valid' using errcode = '22023';
        end;

        if v_shelf_id = any(v_shelf_ids) then
            raise exception 'Duplicate shelf id: %', v_shelf_id using errcode = '22023';
        end if;
        if v_level < 0 then
            raise exception 'Shelf level cannot be negative' using errcode = '22023';
        end if;

        select cs.cabinet_id
        into v_existing_cabinet_id
        from public.cabinet_shelves cs
        where cs.id = v_shelf_id;

        if found and v_existing_cabinet_id is distinct from p_cabinet_id then
            raise exception 'Shelf % belongs to another cabinet', v_shelf_id using errcode = '23505';
        end if;

        v_shelf_ids := array_append(v_shelf_ids, v_shelf_id);

        insert into public.cabinet_shelves (id, cabinet_id, level, dividers)
        values (v_shelf_id, p_cabinet_id, v_level, v_shelf->'dividers')
        on conflict (id) do update
        set level = excluded.level,
            dividers = excluded.dividers;

        for v_item in
            select value
            from jsonb_array_elements(v_shelf->'items')
        loop
            if jsonb_typeof(v_item) is distinct from 'object' then
                raise exception 'Each cabinet item must be a JSON object' using errcode = '22023';
            end if;

            begin
                v_item_id := (v_item->>'id')::uuid;
                v_width := (v_item->>'width')::numeric;
                v_position := (v_item->>'position')::numeric;
                v_depth_position := coalesce((v_item->>'depth_position')::numeric, 50);
                v_remaining_percent := case
                    when v_item ? 'remaining_percent' and v_item->>'remaining_percent' is not null
                        then (v_item->>'remaining_percent')::integer
                    else null
                end;
            exception
                when invalid_text_representation or null_value_not_allowed then
                    raise exception 'Cabinet item id and numeric placement fields must be valid' using errcode = '22023';
            end;

            v_template := v_item->>'template';
            v_name := nullif(trim(v_item->>'name'), '');

            if v_item_id = any(v_item_ids) then
                raise exception 'Duplicate cabinet item id: %', v_item_id using errcode = '22023';
            end if;
            if v_template is null or v_template <> all(array['A', 'B', 'C', 'D']::text[]) then
                raise exception 'Unsupported cabinet item template: %', coalesce(v_template, '<null>') using errcode = '22023';
            end if;
            if v_name is null then
                raise exception 'Cabinet item name cannot be empty' using errcode = '22023';
            end if;
            if v_width <= 0 or v_width > 100 then
                raise exception 'Cabinet item width must be greater than 0 and at most 100' using errcode = '22023';
            end if;
            if v_position < 0 or v_position + v_width > 100 then
                raise exception 'Cabinet item horizontal placement is outside the shelf' using errcode = '22023';
            end if;
            if v_depth_position not between 0 and 100 then
                raise exception 'Cabinet item depth position must be between 0 and 100' using errcode = '22023';
            end if;
            if v_remaining_percent is not null and v_remaining_percent not between 0 and 100 then
                raise exception 'remaining_percent must be between 0 and 100' using errcode = '22023';
            end if;

            select ci.cabinet_id
            into v_existing_cabinet_id
            from public.cabinet_items ci
            where ci.id = v_item_id;

            if found and v_existing_cabinet_id is distinct from p_cabinet_id then
                raise exception 'Cabinet item % belongs to another cabinet', v_item_id using errcode = '23505';
            end if;

            v_item_ids := array_append(v_item_ids, v_item_id);

            insert into public.cabinet_items (
                id,
                cabinet_id,
                shelf_id,
                template,
                name,
                width,
                position,
                depth_position,
                expiry_date,
                capacity,
                product_number,
                brand,
                notes,
                cas_no,
                inventory_item_id,
                remaining_percent
            ) values (
                v_item_id,
                p_cabinet_id,
                v_shelf_id,
                v_template,
                v_name,
                v_width,
                v_position,
                v_depth_position,
                nullif(v_item->>'expiry_date', '')::date,
                nullif(trim(v_item->>'capacity'), ''),
                nullif(trim(v_item->>'product_number'), ''),
                nullif(trim(v_item->>'brand'), ''),
                nullif(trim(v_item->>'notes'), ''),
                nullif(trim(v_item->>'cas_no'), ''),
                nullif(v_item->>'inventory_item_id', '')::uuid,
                v_remaining_percent
            )
            on conflict (id) do update
            set shelf_id = excluded.shelf_id,
                template = excluded.template,
                name = excluded.name,
                width = excluded.width,
                position = excluded.position,
                depth_position = excluded.depth_position,
                expiry_date = excluded.expiry_date,
                capacity = excluded.capacity,
                product_number = excluded.product_number,
                brand = excluded.brand,
                notes = excluded.notes,
                cas_no = excluded.cas_no,
                inventory_item_id = excluded.inventory_item_id,
                remaining_percent = excluded.remaining_percent;
        end loop;
    end loop;

    delete from public.cabinet_items ci
    where ci.cabinet_id = p_cabinet_id
      and (cardinality(v_item_ids) = 0 or not (ci.id = any(v_item_ids)));

    delete from public.cabinet_shelves cs
    where cs.cabinet_id = p_cabinet_id
      and (cardinality(v_shelf_ids) = 0 or not (cs.id = any(v_shelf_ids)));

    update public.cabinets c
    set width = p_width,
        height = p_height,
        depth = p_depth
    where c.id = p_cabinet_id;
end;
$$;


--
-- Name: save_cabinet_state_with_dates(uuid, jsonb, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_cabinet_state_with_dates(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
    v_shelf jsonb;
    v_item jsonb;
    v_item_id uuid;
    v_date_type text;
begin
    perform public.save_cabinet_state_with_ghs(p_cabinet_id, p_shelves, p_width, p_height, p_depth);

    for v_shelf in select value from jsonb_array_elements(p_shelves)
    loop
        for v_item in select value from jsonb_array_elements(coalesce(v_shelf->'items', '[]'::jsonb))
        loop
            begin
                v_item_id := (v_item->>'id')::uuid;
            exception when invalid_text_representation or null_value_not_allowed then
                raise exception 'Cabinet item id must be valid' using errcode = '22023';
            end;

            v_date_type := coalesce(nullif(trim(v_item->>'manufacturer_date_type'), ''), 'unlabeled');
            if v_date_type not in ('expiry', 'minimum_shelf_life', 'unlabeled') then
                raise exception 'Unsupported manufacturer_date_type: %', v_date_type using errcode = '22023';
            end if;
            if v_date_type = 'unlabeled' and nullif(trim(v_item->>'expiry_date'), '') is not null then
                raise exception 'manufacturer_date_type must be selected before saving a manufacturer date' using errcode = '22023';
            end if;

            update public.cabinet_items
            set manufacturer_date_type = v_date_type,
                expiry_date = case
                    when v_date_type = 'unlabeled' then null
                    else nullif(trim(v_item->>'expiry_date'), '')::date
                end,
                received_date = nullif(trim(v_item->>'received_date'), '')::date,
                opened_date = nullif(trim(v_item->>'opened_date'), '')::date
            where id = v_item_id
              and cabinet_id = p_cabinet_id;

            if not found then
                raise exception 'Cabinet item not found or access denied: %', v_item_id using errcode = 'P0002';
            end if;
        end loop;
    end loop;
end;
$$;


--
-- Name: save_cabinet_state_with_ghs(uuid, jsonb, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_cabinet_state_with_ghs(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
    v_shelf jsonb;
    v_item jsonb;
    v_item_id uuid;
    v_h_codes jsonb;
    v_ghs_status text;
begin
    perform public.save_cabinet_state_atomic(
        p_cabinet_id,
        p_shelves,
        p_width,
        p_height,
        p_depth
    );

    for v_shelf in
        select value from jsonb_array_elements(p_shelves)
    loop
        for v_item in
            select value from jsonb_array_elements(v_shelf->'items')
        loop
            begin
                v_item_id := (v_item->>'id')::uuid;
            exception
                when invalid_text_representation or null_value_not_allowed then
                    raise exception 'Cabinet item id must be valid' using errcode = '22023';
            end;

            v_h_codes := coalesce(v_item->'h_codes', '[]'::jsonb);
            if jsonb_typeof(v_h_codes) is distinct from 'array' then
                raise exception 'Cabinet item h_codes must be a JSON array' using errcode = '22023';
            end if;

            v_ghs_status := nullif(trim(v_item->>'ghs_status'), '');
            if v_ghs_status is not null and v_ghs_status not in (
                'not_checked', 'pending', 'success', 'no_ghs',
                'not_found', 'transient_error', 'invalid_cas'
            ) then
                raise exception 'Unsupported cabinet item ghs_status: %', v_ghs_status
                    using errcode = '22023';
            end if;

            update public.cabinet_items
            set h_codes = v_h_codes,
                ghs_status = v_ghs_status,
                ghs_checked_at = nullif(trim(v_item->>'ghs_checked_at'), '')::timestamptz
            where id = v_item_id
              and cabinet_id = p_cabinet_id;

            if not found then
                raise exception 'Cabinet item not found or access denied: %', v_item_id
                    using errcode = 'P0002';
            end if;
        end loop;
    end loop;
end;
$$;


--
-- Name: save_safety_center_waste_policy_draft_v2(uuid, text, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_safety_center_waste_policy_draft_v2(p_center_id uuid, p_version_label text, p_name text, p_streams jsonb, p_source_refs jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
declare
    v_user_id uuid := auth.uid();
    v_parent_policy_id uuid;
    v_policy_id uuid := gen_random_uuid();
    v_policy_key text;
    v_stream jsonb;
    v_source_ref jsonb;
    v_stream_code text;
    v_seen_stream_codes text[] := array[]::text[];
    v_unknown_key text;
    v_allowed_flags jsonb;
    v_blocked_flags jsonb;
    v_prohibitions jsonb;
    v_label_requirements jsonb;
    v_sop_url text;
    v_is_enabled boolean;
    v_sort_order integer;
    v_catalog record;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if p_center_id is null then
        raise exception 'center_id is required' using errcode = '22023';
    end if;
    if nullif(trim(p_version_label), '') is null or length(trim(p_version_label)) > 100 then
        raise exception 'version_label is required and must be 100 characters or fewer'
            using errcode = '22023';
    end if;
    if nullif(trim(p_name), '') is null or length(trim(p_name)) > 200 then
        raise exception 'name is required and must be 200 characters or fewer'
            using errcode = '22023';
    end if;
    if p_streams is null
       or jsonb_typeof(p_streams) <> 'array'
       or jsonb_array_length(p_streams) < 1
       or jsonb_array_length(p_streams) > 10 then
        raise exception 'streams must contain between 1 and 10 records' using errcode = '22023';
    end if;
    if p_source_refs is null
       or jsonb_typeof(p_source_refs) <> 'array'
       or jsonb_array_length(p_source_refs) > 20 then
        raise exception 'source_refs must be an array with at most 20 records' using errcode = '22023';
    end if;
    if octet_length(p_streams::text) > 262144
       or octet_length(p_source_refs::text) > 65536 then
        raise exception 'policy draft payload is too large' using errcode = '22023';
    end if;

    if not exists (
        select 1
        from public.safety_centers sc
        where sc.id = p_center_id
          and sc.status = 'approved'
    ) then
        raise exception 'Approved safety center not found: %', p_center_id using errcode = '42501';
    end if;
    if not public.is_safety_center_member(
        p_center_id,
        array['owner', 'manager']::text[]
    ) then
        raise exception 'Safety-center owner or manager permission is required' using errcode = '42501';
    end if;

    for v_source_ref in select value from jsonb_array_elements(p_source_refs)
    loop
        if jsonb_typeof(v_source_ref) <> 'object' then
            raise exception 'Every source reference must be an object' using errcode = '22023';
        end if;
        select key
        into v_unknown_key
        from jsonb_object_keys(v_source_ref) source_key(key)
        where key not in ('title', 'url')
        limit 1;
        if found then
            raise exception 'Unsupported source reference key: %', v_unknown_key using errcode = '22023';
        end if;
        if not (v_source_ref ? 'title')
           or jsonb_typeof(v_source_ref->'title') <> 'string'
           or nullif(trim(v_source_ref->>'title'), '') is null
           or length(trim(v_source_ref->>'title')) > 500
           or (
               v_source_ref ? 'url'
               and jsonb_typeof(v_source_ref->'url') not in ('string', 'null')
           )
           or (
               nullif(trim(v_source_ref->>'url'), '') is not null
               and (
                   length(trim(v_source_ref->>'url')) > 2000
                   or trim(v_source_ref->>'url') !~ '^https://[^[:space:]]+$'
               )
           ) then
            raise exception 'Each source reference requires a title; a provided URL must use HTTPS'
                using errcode = '22023';
        end if;
    end loop;

    -- Validate the complete stream set before inserting any row.
    for v_stream in select value from jsonb_array_elements(p_streams)
    loop
        if jsonb_typeof(v_stream) <> 'object' then
            raise exception 'Every policy stream must be an object' using errcode = '22023';
        end if;
        select key
        into v_unknown_key
        from jsonb_object_keys(v_stream) stream_key(key)
        where key not in (
            'streamCode', 'displayNameKo', 'displayNameEn', 'descriptionKo',
            'containerLabel', 'containerColor', 'location', 'handlerContact',
            'sopUrl', 'allowedHazardFlags', 'blockedHazardFlags',
            'prohibitions', 'labelRequirements', 'isEnabled', 'sortOrder'
        )
        limit 1;
        if found then
            raise exception 'Unsupported policy stream key: %', v_unknown_key using errcode = '22023';
        end if;

        v_stream_code := v_stream->>'streamCode';
        select c.* into v_catalog
        from public.waste_stream_catalog c
        where c.code = v_stream_code;
        if not found then
            raise exception 'Unknown waste stream code: %', v_stream_code using errcode = '22023';
        end if;
        if v_stream_code = any(v_seen_stream_codes) then
            raise exception 'Duplicate policy stream code: %', v_stream_code using errcode = '22023';
        end if;
        v_seen_stream_codes := array_append(v_seen_stream_codes, v_stream_code);

        if length(coalesce(v_stream->>'displayNameKo', '')) > 200
           or length(coalesce(v_stream->>'displayNameEn', '')) > 200
           or length(coalesce(v_stream->>'descriptionKo', '')) > 2000
           or length(coalesce(v_stream->>'containerLabel', '')) > 200
           or length(coalesce(v_stream->>'containerColor', '')) > 100
           or length(coalesce(v_stream->>'location', '')) > 500
           or length(coalesce(v_stream->>'handlerContact', '')) > 500 then
            raise exception 'Policy stream text field exceeds its length limit' using errcode = '22023';
        end if;

        v_sop_url := nullif(trim(v_stream->>'sopUrl'), '');
        if v_sop_url is not null
           and (length(v_sop_url) > 2000 or v_sop_url !~ '^https://[^[:space:]]+$') then
            raise exception 'sopUrl must be an HTTPS URL' using errcode = '22023';
        end if;

        v_allowed_flags := coalesce(v_stream->'allowedHazardFlags', '[]'::jsonb);
        v_blocked_flags := coalesce(v_stream->'blockedHazardFlags', '[]'::jsonb);
        if jsonb_typeof(v_allowed_flags) <> 'array'
           or jsonb_typeof(v_blocked_flags) <> 'array'
           or jsonb_array_length(v_allowed_flags) > 32
           or jsonb_array_length(v_blocked_flags) > 32
           or exists (
               select 1
               from jsonb_array_elements(v_allowed_flags || v_blocked_flags) flag(value)
               where jsonb_typeof(flag.value) <> 'string'
                  or flag.value #>> '{}' not in (
                      'FLAMMABLE', 'OXIDIZER', 'EXPLOSIVE', 'SELF_REACTIVE',
                      'WATER_REACTIVE', 'PYROPHORIC', 'CORROSIVE', 'ACUTE_TOXIC',
                      'CMR', 'ENVIRONMENTAL_HAZARD', 'CYANIDE', 'SULFIDE',
                      'HEAVY_METAL', 'HYDROFLUORIC_ACID', 'FLUORIDE',
                      'REACTIVE', 'UNKNOWN_COMPONENT'
                  )
           ) then
            raise exception 'Policy hazard flags are invalid' using errcode = '22023';
        end if;
        if exists (
            select 1
            from jsonb_array_elements_text(v_allowed_flags) allowed(flag)
            join jsonb_array_elements_text(v_blocked_flags) blocked(flag) using (flag)
        ) then
            raise exception 'A hazard flag cannot be both allowed and blocked' using errcode = '22023';
        end if;

        v_prohibitions := coalesce(v_stream->'prohibitions', '[]'::jsonb);
        v_label_requirements := coalesce(v_stream->'labelRequirements', '[]'::jsonb);
        if jsonb_typeof(v_prohibitions) <> 'array'
           or jsonb_typeof(v_label_requirements) <> 'array'
           or jsonb_array_length(v_prohibitions) > 20
           or jsonb_array_length(v_label_requirements) > 20
           or exists (
               select 1
               from jsonb_array_elements(v_prohibitions || v_label_requirements) entry(value)
               where jsonb_typeof(entry.value) <> 'string'
                  or length(entry.value #>> '{}') > 500
           ) then
            raise exception 'Policy instruction arrays are invalid' using errcode = '22023';
        end if;

        if v_stream ? 'isEnabled'
           and jsonb_typeof(v_stream->'isEnabled') <> 'boolean' then
            raise exception 'isEnabled must be boolean' using errcode = '22023';
        end if;
        if v_stream ? 'sortOrder'
           and (v_stream->>'sortOrder' !~ '^[0-9]+$'
                or (v_stream->>'sortOrder')::numeric > 10000) then
            raise exception 'sortOrder must be an integer between 0 and 10000'
                using errcode = '22023';
        end if;
    end loop;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('safety-center-policy-draft:' || p_center_id::text, 0)
    );

    select pv.id
    into v_parent_policy_id
    from public.waste_policy_versions pv
    where pv.scope_type = 'safety_center'
      and pv.safety_center_id = p_center_id
      and pv.status = 'active'
    order by pv.activated_at desc nulls last, pv.created_at desc
    limit 1;

    if v_parent_policy_id is null then
        select pv.id
        into v_parent_policy_id
        from public.waste_policy_versions pv
        where pv.scope_type = 'system'
          and pv.status = 'active'
        order by pv.activated_at desc nulls last, pv.created_at desc
        limit 1;
    end if;
    if v_parent_policy_id is null then
        raise exception 'No active parent waste policy is available' using errcode = 'P0002';
    end if;

    v_policy_key := 'safety_center_' || replace(p_center_id::text, '-', '')
        || '_' || replace(v_policy_id::text, '-', '');

    insert into public.waste_policy_versions (
        id, policy_key, scope_type, safety_center_id,
        parent_policy_version_id, version_label, name, jurisdiction,
        status, source_refs, created_by
    ) values (
        v_policy_id, v_policy_key, 'safety_center', p_center_id,
        v_parent_policy_id, trim(p_version_label), trim(p_name), 'KR',
        'draft', p_source_refs, v_user_id
    );

    for v_stream in select value from jsonb_array_elements(p_streams)
    loop
        v_stream_code := v_stream->>'streamCode';
        select c.* into v_catalog
        from public.waste_stream_catalog c
        where c.code = v_stream_code;
        v_allowed_flags := coalesce(v_stream->'allowedHazardFlags', '[]'::jsonb);
        v_blocked_flags := coalesce(v_stream->'blockedHazardFlags', '[]'::jsonb);
        v_prohibitions := coalesce(v_stream->'prohibitions', '[]'::jsonb);
        v_label_requirements := coalesce(v_stream->'labelRequirements', '[]'::jsonb);
        v_is_enabled := coalesce((v_stream->>'isEnabled')::boolean, true);
        v_sort_order := coalesce((v_stream->>'sortOrder')::integer, v_catalog.sort_order);

        insert into public.waste_policy_streams (
            policy_version_id, stream_code, display_name_ko, display_name_en,
            description_ko, container_label, container_color, location,
            handler_contact, sop_url, allowed_hazard_flags,
            blocked_hazard_flags, prohibitions, label_requirements,
            is_enabled, sort_order
        ) values (
            v_policy_id,
            v_stream_code,
            coalesce(nullif(trim(v_stream->>'displayNameKo'), ''), v_catalog.display_name_ko),
            coalesce(nullif(trim(v_stream->>'displayNameEn'), ''), v_catalog.display_name_en),
            nullif(trim(v_stream->>'descriptionKo'), ''),
            nullif(trim(v_stream->>'containerLabel'), ''),
            nullif(trim(v_stream->>'containerColor'), ''),
            nullif(trim(v_stream->>'location'), ''),
            nullif(trim(v_stream->>'handlerContact'), ''),
            nullif(trim(v_stream->>'sopUrl'), ''),
            array(select jsonb_array_elements_text(v_allowed_flags)),
            array(select jsonb_array_elements_text(v_blocked_flags)),
            array(select jsonb_array_elements_text(v_prohibitions)),
            array(select jsonb_array_elements_text(v_label_requirements)),
            v_is_enabled,
            v_sort_order
        );
    end loop;

    return jsonb_build_object(
        'id', v_policy_id,
        'centerId', p_center_id,
        'policyKey', v_policy_key,
        'versionLabel', trim(p_version_label),
        'status', 'draft',
        'streamCount', jsonb_array_length(p_streams),
        'parentPolicyVersionId', v_parent_policy_id
    );
end;
$_$;


--
-- Name: search_labs(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_labs(search_query text) RETURNS TABLE(id uuid, name text, created_by uuid, created_at timestamp with time zone, institution_type text, research_field text, institution_name text, has_password boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Not authenticated';
    end if;

    return query
    select
        l.id,
        l.name,
        l.created_by,
        l.created_at,
        l.institution_type,
        l.research_field,
        l.institution_name,
        (l.join_password_hash is not null or nullif(l.join_password, '') is not null) as has_password
    from public.labs l
    where l.name ilike '%' || search_query || '%'
       or coalesce(l.institution_name, '') ilike '%' || search_query || '%'
    order by l.name asc
    limit 20;
end;
$$;


--
-- Name: set_lab_join_password(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_lab_join_password(target_lab_id uuid, p_password text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    if not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = target_lab_id
          and lm.user_id = auth.uid()
          and lm.role = 'admin'
    ) then
        raise exception 'Only lab admins can change the join password'
            using errcode = '42501';
    end if;

    update public.labs
    set join_password = coalesce(p_password, '')
    where id = target_lab_id;

    if not found then
        raise exception 'Lab not found' using errcode = 'P0002';
    end if;

    return jsonb_build_object('success', true);
end;
$$;


--
-- Name: transfer_admin(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_admin(target_lab_id uuid, new_admin_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- 호출자가 해당 연구실의 admin인지 확인
    IF NOT EXISTS (
        SELECT 1 FROM public.lab_members
        WHERE lab_id = target_lab_id
          AND user_id = auth.uid()
          AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Only the current admin can transfer admin rights';
    END IF;

    -- 대상이 같은 연구실 멤버인지 확인
    IF NOT EXISTS (
        SELECT 1 FROM public.lab_members
        WHERE lab_id = target_lab_id
          AND user_id = new_admin_user_id
    ) THEN
        RAISE EXCEPTION 'Target user is not a member of this lab';
    END IF;

    -- 자기 자신에게 이전 방지
    IF auth.uid() = new_admin_user_id THEN
        RAISE EXCEPTION 'Cannot transfer admin to yourself';
    END IF;

    -- 새 admin 승격
    UPDATE public.lab_members
    SET role = 'admin'
    WHERE lab_id = target_lab_id
      AND user_id = new_admin_user_id;

    -- 현재 admin을 pi(책임연구원)로 변경 (기존 researcher 대신 pi 사용)
    UPDATE public.lab_members
    SET role = 'pi'
    WHERE lab_id = target_lab_id
      AND user_id = auth.uid();

    RETURN jsonb_build_object('success', true);
END;
$$;


--
-- Name: try_acquire_chemical_enrichment_lease(text, integer, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.try_acquire_chemical_enrichment_lease(p_lease_key text, p_result_version integer, p_owner_token uuid, p_lease_seconds integer DEFAULT 30) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
    acquired_owner uuid;
begin
    if char_length(p_lease_key) not between 1 and 500
        or p_result_version < 1
        or p_lease_seconds not between 1 and 120 then
        raise exception 'invalid chemical enrichment lease input';
    end if;

    insert into public.chemical_enrichment_leases (
        lease_key,
        result_version,
        owner_token,
        lease_until,
        updated_at
    ) values (
        p_lease_key,
        p_result_version,
        p_owner_token,
        now() + make_interval(secs => p_lease_seconds),
        now()
    )
    on conflict (lease_key, result_version) do update
    set owner_token = excluded.owner_token,
        lease_until = excluded.lease_until,
        updated_at = now()
    where public.chemical_enrichment_leases.lease_until <= now()
       or public.chemical_enrichment_leases.owner_token = excluded.owner_token
    returning owner_token into acquired_owner;

    return acquired_owner = p_owner_token;
end;
$$;


--
-- Name: update_inventory_item_atomic(uuid, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_inventory_item_atomic(p_item_id uuid, p_item_source text, p_updates jsonb, p_actor_name text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_lab_id uuid;
    v_owner_user_id uuid;
    v_before_data jsonb;
    v_after_data jsonb;
    v_diff_data jsonb := '{}'::jsonb;
    v_key text;
    v_before_value jsonb;
    v_after_value jsonb;
    v_cabinet_id uuid;
    v_new_storage_type text;
    v_new_cabinet_id uuid;
    v_new_storage_location_id uuid;
    v_ref_lab_id uuid;
    v_ref_user_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
        raise exception 'updates must be a JSON object' using errcode = '22023';
    end if;

    if p_item_source not in ('inventory', 'cabinet_item') then
        raise exception 'Unsupported item source: %', p_item_source using errcode = '22023';
    end if;

    if p_item_source = 'inventory' then
        if exists (
            select 1
            from jsonb_object_keys(p_updates) as keys(key_name)
            where key_name <> all (array[
                'name', 'brand', 'product_number', 'cas_number', 'quantity', 'capacity',
                'storage_type', 'cabinet_id', 'storage_location_id', 'product_id',
                'expiry_date', 'memo', 'remaining_percent'
            ]::text[])
        ) then
            raise exception 'updates contains an unsupported inventory field' using errcode = '22023';
        end if;

        select to_jsonb(i.*), i.lab_id, i.user_id
        into v_before_data, v_lab_id, v_owner_user_id
        from public.inventory i
        where i.id = p_item_id
        for update;

        if not found then
            raise exception 'Inventory item not found: %', p_item_id using errcode = 'P0002';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for inventory item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        if p_updates ? 'name' and nullif(trim(p_updates->>'name'), '') is null then
            raise exception 'Inventory name cannot be empty' using errcode = '22023';
        end if;
        if p_updates ? 'cas_number'
           and nullif(trim(p_updates->>'cas_number'), '') is not null
           and not private.is_valid_cas_number(trim(p_updates->>'cas_number')) then
            raise exception 'Invalid CAS Registry Number: %', p_updates->>'cas_number' using errcode = '22023';
        end if;
        if p_updates ? 'quantity'
           and (p_updates->>'quantity')::integer not between 1 and 1000000 then
            raise exception 'quantity must be between 1 and 1000000' using errcode = '22023';
        end if;
        if p_updates ? 'remaining_percent'
           and (p_updates->>'remaining_percent')::integer not between 0 and 100 then
            raise exception 'remaining_percent must be between 0 and 100' using errcode = '22023';
        end if;

        v_new_storage_type := case
            when p_updates ? 'storage_type' then p_updates->>'storage_type'
            else v_before_data->>'storage_type'
        end;
        v_new_cabinet_id := case
            when p_updates ? 'cabinet_id' then nullif(p_updates->>'cabinet_id', '')::uuid
            else nullif(v_before_data->>'cabinet_id', '')::uuid
        end;
        v_new_storage_location_id := case
            when p_updates ? 'storage_location_id' then nullif(p_updates->>'storage_location_id', '')::uuid
            else nullif(v_before_data->>'storage_location_id', '')::uuid
        end;

        if v_new_storage_type not in ('cabinet', 'other') then
            raise exception 'Unsupported storage type: %', v_new_storage_type using errcode = '22023';
        end if;
        if v_new_storage_type = 'cabinet' then
            if v_new_cabinet_id is null then
                raise exception 'cabinet_id is required for cabinet storage' using errcode = '22023';
            end if;
            if v_new_storage_location_id is not null then
                raise exception 'storage_location_id cannot be combined with cabinet storage' using errcode = '22023';
            end if;
        elsif v_new_cabinet_id is not null then
            raise exception 'cabinet_id is only valid for cabinet storage' using errcode = '22023';
        end if;

        if v_new_cabinet_id is not null then
            select c.lab_id, c.user_id
            into v_ref_lab_id, v_ref_user_id
            from public.cabinets c
            where c.id = v_new_cabinet_id;

            if not found then
                raise exception 'Cabinet not found: %', v_new_cabinet_id using errcode = 'P0002';
            end if;

            if v_lab_id is null then
                if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                    raise exception 'Cabinet is outside the personal scope' using errcode = '42501';
                end if;
            elsif v_ref_lab_id is distinct from v_lab_id then
                raise exception 'Cabinet is outside the item lab' using errcode = '42501';
            end if;
        end if;

        if v_new_storage_location_id is not null then
            select sl.lab_id, sl.user_id
            into v_ref_lab_id, v_ref_user_id
            from public.storage_locations sl
            where sl.id = v_new_storage_location_id;

            if not found then
                raise exception 'Storage location not found: %', v_new_storage_location_id using errcode = 'P0002';
            end if;

            if v_lab_id is null then
                if v_ref_lab_id is not null or v_ref_user_id is distinct from v_user_id then
                    raise exception 'Storage location is outside the personal scope' using errcode = '42501';
                end if;
            elsif v_ref_lab_id is distinct from v_lab_id then
                raise exception 'Storage location is outside the item lab' using errcode = '42501';
            end if;
        end if;

        update public.inventory
        set name = case when p_updates ? 'name' then trim(p_updates->>'name') else name end,
            brand = case when p_updates ? 'brand' then nullif(trim(p_updates->>'brand'), '') else brand end,
            product_number = case when p_updates ? 'product_number' then nullif(trim(p_updates->>'product_number'), '') else product_number end,
            cas_number = case when p_updates ? 'cas_number' then nullif(trim(p_updates->>'cas_number'), '') else cas_number end,
            quantity = case when p_updates ? 'quantity' then (p_updates->>'quantity')::integer else quantity end,
            capacity = case when p_updates ? 'capacity' then nullif(trim(p_updates->>'capacity'), '') else capacity end,
            storage_type = case when p_updates ? 'storage_type' then p_updates->>'storage_type' else storage_type end,
            cabinet_id = case when p_updates ? 'cabinet_id' then nullif(p_updates->>'cabinet_id', '')::uuid else cabinet_id end,
            storage_location_id = case when p_updates ? 'storage_location_id' then nullif(p_updates->>'storage_location_id', '')::uuid else storage_location_id end,
            product_id = case when p_updates ? 'product_id' then nullif(p_updates->>'product_id', '')::uuid else product_id end,
            expiry_date = case when p_updates ? 'expiry_date' then nullif(p_updates->>'expiry_date', '')::date else expiry_date end,
            memo = case when p_updates ? 'memo' then nullif(trim(p_updates->>'memo'), '') else memo end,
            remaining_percent = case when p_updates ? 'remaining_percent' then (p_updates->>'remaining_percent')::integer else remaining_percent end,
            updated_at = now()
        where id = p_item_id;

        select to_jsonb(i.*)
        into v_after_data
        from public.inventory i
        where i.id = p_item_id;
    else
        if exists (
            select 1
            from jsonb_object_keys(p_updates) as keys(key_name)
            where key_name <> all (array[
                'name', 'brand', 'product_number', 'cas_no', 'capacity',
                'expiry_date', 'notes', 'remaining_percent'
            ]::text[])
        ) then
            raise exception 'updates contains an unsupported cabinet-item field' using errcode = '22023';
        end if;

        select to_jsonb(ci.*), ci.cabinet_id
        into v_before_data, v_cabinet_id
        from public.cabinet_items ci
        where ci.id = p_item_id
        for update;

        if not found then
            raise exception 'Cabinet item not found: %', p_item_id using errcode = 'P0002';
        end if;

        select c.lab_id, c.user_id
        into v_lab_id, v_owner_user_id
        from public.cabinets c
        where c.id = v_cabinet_id;

        if not found then
            raise exception 'Cabinet not found: %', v_cabinet_id using errcode = 'P0002';
        end if;

        if v_lab_id is null then
            if v_owner_user_id is distinct from v_user_id then
                raise exception 'Access denied for cabinet item %', p_item_id using errcode = '42501';
            end if;
        elsif not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_lab_id using errcode = '42501';
        end if;

        if p_updates ? 'name' and nullif(trim(p_updates->>'name'), '') is null then
            raise exception 'Cabinet item name cannot be empty' using errcode = '22023';
        end if;
        if p_updates ? 'cas_no'
           and nullif(trim(p_updates->>'cas_no'), '') is not null
           and not private.is_valid_cas_number(trim(p_updates->>'cas_no')) then
            raise exception 'Invalid CAS Registry Number: %', p_updates->>'cas_no' using errcode = '22023';
        end if;
        if p_updates ? 'remaining_percent'
           and (p_updates->>'remaining_percent')::integer not between 0 and 100 then
            raise exception 'remaining_percent must be between 0 and 100' using errcode = '22023';
        end if;

        update public.cabinet_items
        set name = case when p_updates ? 'name' then trim(p_updates->>'name') else name end,
            brand = case when p_updates ? 'brand' then nullif(trim(p_updates->>'brand'), '') else brand end,
            product_number = case when p_updates ? 'product_number' then nullif(trim(p_updates->>'product_number'), '') else product_number end,
            cas_no = case when p_updates ? 'cas_no' then nullif(trim(p_updates->>'cas_no'), '') else cas_no end,
            capacity = case when p_updates ? 'capacity' then nullif(trim(p_updates->>'capacity'), '') else capacity end,
            expiry_date = case when p_updates ? 'expiry_date' then nullif(p_updates->>'expiry_date', '')::date else expiry_date end,
            notes = case when p_updates ? 'notes' then nullif(trim(p_updates->>'notes'), '') else notes end,
            remaining_percent = case when p_updates ? 'remaining_percent' then (p_updates->>'remaining_percent')::integer else remaining_percent end
        where id = p_item_id;

        select to_jsonb(ci.*)
        into v_after_data
        from public.cabinet_items ci
        where ci.id = p_item_id;
    end if;

    for v_key in select jsonb_object_keys(p_updates)
    loop
        v_before_value := v_before_data->v_key;
        v_after_value := v_after_data->v_key;
        if v_before_value is distinct from v_after_value then
            v_diff_data := jsonb_set(
                v_diff_data,
                array[v_key],
                jsonb_build_object('from', v_before_value, 'to', v_after_value)
            );
        end if;
    end loop;

    if v_diff_data <> '{}'::jsonb then
        insert into public.audit_logs (
            actor_user_id,
            actor_name,
            lab_id,
            entity_type,
            entity_id,
            action,
            before_data,
            after_data,
            diff_data,
            source
        ) values (
            v_user_id,
            private.actor_display_name_v2(v_user_id, v_lab_id),
            v_lab_id,
            p_item_source,
            p_item_id,
            'update',
            v_before_data,
            v_after_data,
            v_diff_data,
            'rpc'
        );
    end if;

    return v_after_data;
end;
$$;


--
-- Name: update_inventory_item_with_dates_atomic(uuid, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_inventory_item_with_dates_atomic(p_item_id uuid, p_item_source text, p_updates jsonb, p_actor_name text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_before_data jsonb;
    v_after_data jsonb;
    v_lab_id uuid;
    v_effective_date_type text;
    v_legacy_updates jsonb;
    v_key text;
    v_diff_data jsonb := '{}'::jsonb;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if p_item_source not in ('inventory', 'cabinet_item') then
        raise exception 'Unsupported item source: %', p_item_source using errcode = '22023';
    end if;
    if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
        raise exception 'updates must be a JSON object' using errcode = '22023';
    end if;
    if p_updates ? 'manufacturer_date_type'
       and coalesce(nullif(trim(p_updates->>'manufacturer_date_type'), ''), 'unlabeled') not in ('expiry', 'minimum_shelf_life', 'unlabeled') then
        raise exception 'Unsupported manufacturer_date_type: %', p_updates->>'manufacturer_date_type' using errcode = '22023';
    end if;

    v_legacy_updates := p_updates - array['manufacturer_date_type', 'received_date', 'opened_date'];

    -- The legacy RPC retains all validation, row locking and authorization for
    -- both inventory rows and direct cabinet items.
    perform public.update_inventory_item_atomic(p_item_id, p_item_source, v_legacy_updates, p_actor_name);

    if p_item_source = 'inventory' then
        select to_jsonb(i.*), i.lab_id into v_before_data, v_lab_id
        from public.inventory i where i.id = p_item_id for update;
    else
        select to_jsonb(ci.*), c.lab_id into v_before_data, v_lab_id
        from public.cabinet_items ci
        join public.cabinets c on c.id = ci.cabinet_id
        where ci.id = p_item_id
        for update of ci;
    end if;

    v_effective_date_type := case
        when p_updates ? 'manufacturer_date_type' then coalesce(nullif(trim(p_updates->>'manufacturer_date_type'), ''), 'unlabeled')
        else coalesce(v_before_data->>'manufacturer_date_type', 'unlabeled')
    end;

    if p_updates ? 'expiry_date'
       and nullif(trim(p_updates->>'expiry_date'), '') is not null
       and v_effective_date_type = 'unlabeled' then
        raise exception 'manufacturer_date_type must be selected before saving a manufacturer date' using errcode = '22023';
    end if;

    if p_item_source = 'inventory' then
        update public.inventory
        set manufacturer_date_type = v_effective_date_type,
            expiry_date = case
                when v_effective_date_type = 'unlabeled' then null
                when p_updates ? 'expiry_date' then nullif(trim(p_updates->>'expiry_date'), '')::date
                else expiry_date
            end,
            received_date = case when p_updates ? 'received_date' then nullif(trim(p_updates->>'received_date'), '')::date else received_date end,
            opened_date = case when p_updates ? 'opened_date' then nullif(trim(p_updates->>'opened_date'), '')::date else opened_date end,
            updated_at = now()
        where id = p_item_id;
        select to_jsonb(i.*) into v_after_data from public.inventory i where i.id = p_item_id;
    else
        update public.cabinet_items
        set manufacturer_date_type = v_effective_date_type,
            expiry_date = case
                when v_effective_date_type = 'unlabeled' then null
                when p_updates ? 'expiry_date' then nullif(trim(p_updates->>'expiry_date'), '')::date
                else expiry_date
            end,
            received_date = case when p_updates ? 'received_date' then nullif(trim(p_updates->>'received_date'), '')::date else received_date end,
            opened_date = case when p_updates ? 'opened_date' then nullif(trim(p_updates->>'opened_date'), '')::date else opened_date end
        where id = p_item_id;
        select to_jsonb(ci.*) into v_after_data from public.cabinet_items ci where ci.id = p_item_id;
    end if;

    foreach v_key in array array['manufacturer_date_type', 'expiry_date', 'received_date', 'opened_date']
    loop
        if p_updates ? v_key and v_before_data->v_key is distinct from v_after_data->v_key then
            v_diff_data := jsonb_set(
                v_diff_data,
                array[v_key],
                jsonb_build_object('from', v_before_data->v_key, 'to', v_after_data->v_key)
            );
        end if;
    end loop;

    if v_diff_data <> '{}'::jsonb then
        insert into public.audit_logs (
            actor_user_id, actor_name, lab_id, entity_type, entity_id, action,
            before_data, after_data, diff_data, source
        ) values (
            v_user_id, private.actor_display_name_v2(v_user_id, v_lab_id), v_lab_id,
            p_item_source, p_item_id, 'update', v_before_data, v_after_data, v_diff_data, 'rpc'
        );
    end if;

    return v_after_data;
end;
$$;


--
-- Name: update_inventory_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_inventory_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: update_lab_member_role(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_lab_member_role(target_lab_id uuid, target_user_id uuid, new_role text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- 디버깅용: 입력값 확인 (필요 시 로그 확인 가능)
    -- RAISE NOTICE 'Changing role for user % in lab % to %', target_user_id, target_lab_id, new_role;

    -- 호출자가 admin인지 확인
    IF NOT EXISTS (
        SELECT 1 FROM public.lab_members
        WHERE lab_id = target_lab_id
          AND user_id = auth.uid()
          AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Only admins can change roles. Your current role is not admin.';
    END IF;

    -- 자기 자신의 역할을 변경하는 것은 허용하지 않음
    IF auth.uid() = target_user_id THEN
        RAISE EXCEPTION 'Cannot change your own role. Use transfer admin instead.';
    END IF;

    -- admin으로 승급하는 경우
    IF new_role = 'admin' THEN
        RAISE EXCEPTION 'Use transfer_admin function to promote someone to admin';
    END IF;

    -- 새 역할 검증
    IF new_role NOT IN ('pi', 'postdoc', 'graduate', 'undergrad', 'researcher', 'student') THEN
        RAISE EXCEPTION 'Invalid role provided: %', new_role;
    END IF;

    -- 실제 업데이트 수행
    UPDATE public.lab_members
    SET role = new_role
    WHERE lab_id = target_lab_id
      AND user_id = target_user_id;

    -- 업데이트 결과 확인
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member not found in this lab';
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;


--
-- Name: upsert_lab_waste_stream_override_v2(uuid, text, text, text, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_lab_waste_stream_override_v2(p_lab_id uuid, p_stream_code text, p_container_label text DEFAULT NULL::text, p_container_color text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_handler_contact text DEFAULT NULL::text, p_replacement_location text DEFAULT NULL::text, p_is_disabled boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
declare
    v_user_id uuid := auth.uid();
    v_container_label text := nullif(trim(p_container_label), '');
    v_container_color text := nullif(trim(p_container_color), '');
    v_location text := nullif(trim(p_location), '');
    v_handler_contact text := nullif(trim(p_handler_contact), '');
    v_replacement_location text := case
        when coalesce(p_is_disabled, false) then nullif(trim(p_replacement_location), '')
        else null
    end;
    v_is_disabled boolean := coalesce(p_is_disabled, false);
    v_override public.waste_policy_lab_overrides%rowtype;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_lab_admin(p_lab_id) then
        raise exception 'Lab admin permission is required' using errcode = '42501';
    end if;

    if not exists (
        select 1
        from public.waste_stream_catalog c
        where c.code = p_stream_code
    ) then
        raise exception 'Unknown waste stream: %', p_stream_code using errcode = '22023';
    end if;

    if length(coalesce(v_container_label, '')) > 200 then
        raise exception 'container_label must be 200 characters or fewer' using errcode = '22023';
    end if;
    if length(coalesce(v_container_color, '')) > 40
       or (
           v_container_color is not null
           and v_container_color !~ '^(#[0-9A-Fa-f]{6}|[A-Za-z0-9 _-]+)$'
       ) then
        raise exception 'container_color must be a hex color or a short safe label' using errcode = '22023';
    end if;
    if length(coalesce(v_location, '')) > 500 then
        raise exception 'location must be 500 characters or fewer' using errcode = '22023';
    end if;
    if length(coalesce(v_handler_contact, '')) > 300 then
        raise exception 'handler_contact must be 300 characters or fewer' using errcode = '22023';
    end if;
    if length(coalesce(v_replacement_location, '')) > 500 then
        raise exception 'replacement_location must be 500 characters or fewer' using errcode = '22023';
    end if;
    if v_container_label is null
       and v_container_color is null
       and v_location is null
       and v_handler_contact is null
       and v_replacement_location is null
       and not v_is_disabled then
        delete from public.waste_policy_lab_overrides
        where lab_id = p_lab_id
          and stream_code = p_stream_code;

        return jsonb_build_object(
            'id', null,
            'labId', p_lab_id,
            'streamCode', p_stream_code,
            'containerLabel', null,
            'containerColor', null,
            'location', null,
            'handlerContact', null,
            'replacementLocation', null,
            'isDisabled', false,
            'updatedAt', now(),
            'reset', true
        );
    end if;

    insert into public.waste_policy_lab_overrides (
        lab_id,
        stream_code,
        container_label,
        container_color,
        location,
        handler_contact,
        replacement_location,
        is_disabled,
        created_by,
        updated_by,
        updated_at
    ) values (
        p_lab_id,
        p_stream_code,
        v_container_label,
        v_container_color,
        v_location,
        v_handler_contact,
        v_replacement_location,
        v_is_disabled,
        v_user_id,
        v_user_id,
        now()
    )
    on conflict (lab_id, stream_code) do update
    set container_label = excluded.container_label,
        container_color = excluded.container_color,
        location = excluded.location,
        handler_contact = excluded.handler_contact,
        replacement_location = excluded.replacement_location,
        is_disabled = excluded.is_disabled,
        updated_by = v_user_id,
        updated_at = now()
    returning * into v_override;

    return jsonb_build_object(
        'id', v_override.id,
        'labId', v_override.lab_id,
        'streamCode', v_override.stream_code,
        'containerLabel', v_override.container_label,
        'containerColor', v_override.container_color,
        'location', v_override.location,
        'handlerContact', v_override.handler_contact,
        'replacementLocation', v_override.replacement_location,
        'isDisabled', v_override.is_disabled,
        'updatedAt', v_override.updated_at,
        'reset', false
    );
end;
$_$;


--
-- Name: void_waste_log_v2(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_waste_log_v2(p_waste_log_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_log public.waste_logs%rowtype;
    v_is_lab_admin boolean := false;
    v_reason text := nullif(trim(p_reason), '');
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
        raise exception 'A void reason between 3 and 500 characters is required' using errcode = '22023';
    end if;

    select wl.*
    into v_log
    from public.waste_logs wl
    where wl.id = p_waste_log_id
    for update;

    if not found then
        raise exception 'Waste log not found: %', p_waste_log_id using errcode = 'P0002';
    end if;

    if v_log.voided_at is not null then
        return jsonb_build_object(
            'id', v_log.id,
            'voidedAt', v_log.voided_at,
            'voidedBy', v_log.voided_by,
            'voidReason', v_log.void_reason,
            'idempotent', true
        );
    end if;

    if v_log.lab_id is null then
        if v_log.user_id is distinct from v_user_id or now() > v_log.created_at + interval '15 minutes' then
            raise exception 'Personal waste logs can only be voided by their author within 15 minutes' using errcode = '42501';
        end if;
    else
        if not exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = v_log.lab_id
              and lm.user_id = v_user_id
        ) then
            raise exception 'Access denied for lab %', v_log.lab_id using errcode = '42501';
        end if;

        v_is_lab_admin := public.is_lab_admin(v_log.lab_id);
        if not (
            (v_log.user_id = v_user_id and now() <= v_log.created_at + interval '15 minutes')
            or (v_is_lab_admin and now() <= v_log.created_at + interval '24 hours')
        ) then
            raise exception 'The correction window for this waste log has expired' using errcode = '42501';
        end if;
    end if;

    update public.waste_logs
    set voided_at = now(),
        voided_by = v_user_id,
        void_reason = v_reason
    where id = p_waste_log_id
    returning * into v_log;

    return jsonb_build_object(
        'id', v_log.id,
        'schemaVersion', v_log.schema_version,
        'recordOrigin', v_log.record_origin,
        'decisionStatus', v_log.decision_status,
        'streamCode', v_log.stream_code,
        'handlingAction', v_log.handling_action,
        'voidedAt', v_log.voided_at,
        'voidedBy', v_log.voided_by,
        'voidReason', v_log.void_reason,
        'idempotent', false
    );
end;
$$;


--
-- Name: waste_ph_prediction_fingerprint(jsonb, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.waste_ph_prediction_fingerprint(p_components jsonb, p_matrix text, p_total_amount jsonb, p_confirmation jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
    with normalized_components as (
        select coalesce(
            jsonb_agg(
                case
                    when jsonb_typeof(component.value->'analysisSnapshot') = 'object' then
                        jsonb_set(
                            component.value,
                            '{analysisSnapshot}',
                            (component.value->'analysisSnapshot')
                                - 'phPredictionSnapshot'
                                - 'ph_prediction_snapshot',
                            true
                        )
                    else component.value
                end
                order by component.ordinality
            ),
            '[]'::jsonb
        ) as value
        from jsonb_array_elements(coalesce(p_components, '[]'::jsonb))
            with ordinality as component(value, ordinality)
    )
    select encode(
        extensions.digest(
            jsonb_build_object(
                'components', normalized_components.value,
                'matrix', p_matrix,
                'totalAmount', p_total_amount,
                'matrixSource', coalesce(p_confirmation->'matrixSource', p_confirmation->'matrix_source'),
                'mixingState', coalesce(p_confirmation->'mixingState', p_confirmation->'mixing_state'),
                'additionalComponentsStatus', coalesce(
                    p_confirmation->'additionalComponentsStatus',
                    p_confirmation->'additional_components_status'
                ),
                'incidentContext', coalesce(p_confirmation->'incidentContext', p_confirmation->'incident_context')
            )::text,
            'sha256'
        ),
        'hex'
    )
    from normalized_components;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_api_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_api_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    api_type text NOT NULL,
    cache_key text NOT NULL,
    response_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_commercialization_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_commercialization_settings (
    singleton boolean DEFAULT true NOT NULL,
    external_product_enabled boolean DEFAULT false NOT NULL,
    institution_data_agreement_ready boolean DEFAULT false NOT NULL,
    reidentification_risk_review_ready boolean DEFAULT false NOT NULL,
    legal_review_ready boolean DEFAULT false NOT NULL,
    activated_at timestamp with time zone,
    activated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analytics_commercialization_sett_external_product_enabled_check CHECK ((NOT external_product_enabled)),
    CONSTRAINT analytics_commercialization_settings_singleton_check CHECK (singleton)
);


--
-- Name: analytics_deletion_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_deletion_audits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    reason text NOT NULL,
    deleted_event_count integer NOT NULL,
    deleted_action_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analytics_deletion_audits_deleted_action_count_check CHECK ((deleted_action_count >= 0)),
    CONSTRAINT analytics_deletion_audits_deleted_event_count_check CHECK ((deleted_event_count >= 0)),
    CONSTRAINT analytics_deletion_audits_reason_check CHECK ((reason = ANY (ARRAY['history_item_deleted'::text, 'history_cleared'::text, 'account_deleted'::text, 'guest_request'::text, 'guest_expired'::text]))),
    CONSTRAINT analytics_deletion_audits_subject_type_check CHECK ((subject_type = ANY (ARRAY['authenticated'::text, 'guest'::text])))
);


--
-- Name: analytics_export_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_export_audits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operator_user_id uuid,
    operator_email text NOT NULL,
    reason text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    row_count integer NOT NULL,
    file_sha256 text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analytics_export_audits_file_sha256_check CHECK ((file_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT analytics_export_audits_filters_check CHECK (((jsonb_typeof(filters) = 'object'::text) AND (octet_length((filters)::text) <= 16384))),
    CONSTRAINT analytics_export_audits_reason_check CHECK (((char_length(reason) >= 5) AND (char_length(reason) <= 1000))),
    CONSTRAINT analytics_export_audits_row_count_check CHECK (((row_count >= 0) AND (row_count <= 50000)))
);


--
-- Name: analytics_monthly_mixture_rollups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_monthly_mixture_rollups (
    month_start date NOT NULL,
    commercial_cohort text NOT NULL,
    component_a_key text NOT NULL,
    component_a_name text NOT NULL,
    component_b_key text NOT NULL,
    component_b_name text NOT NULL,
    finalized_batch_count integer NOT NULL,
    distinct_users integer NOT NULL,
    distinct_labs integer NOT NULL,
    volume_distribution jsonb DEFAULT '{}'::jsonb NOT NULL,
    ph_distribution jsonb DEFAULT '{}'::jsonb NOT NULL,
    concentration_distributions jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analytics_monthly_mixture_rollups_commercial_cohort_check CHECK ((commercial_cohort = ANY (ARRAY['internal_only'::text, 'institution_contract'::text]))),
    CONSTRAINT analytics_monthly_mixture_rollups_threshold_check CHECK (((finalized_batch_count >= 10) AND (distinct_users >= 5) AND (distinct_labs >= 3)))
);


--
-- Name: TABLE analytics_monthly_mixture_rollups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.analytics_monthly_mixture_rollups IS 'Thresholded monthly mixture distributions. Never contains individual batch rows.';


--
-- Name: analytics_monthly_search_rollups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_monthly_search_rollups (
    month_start date NOT NULL,
    commercial_cohort text NOT NULL,
    query_normalized text NOT NULL,
    representative_query text NOT NULL,
    total_events integer NOT NULL,
    matched_events integer NOT NULL,
    no_result_events integer NOT NULL,
    distinct_users integer NOT NULL,
    distinct_labs integer NOT NULL,
    reformulation_rate numeric,
    scan_correction_rate numeric,
    unresolved_rate numeric,
    confusion_score numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analytics_monthly_search_rollups_commercial_cohort_check CHECK ((commercial_cohort = ANY (ARRAY['internal_only'::text, 'institution_contract'::text]))),
    CONSTRAINT analytics_monthly_search_rollups_threshold_check CHECK (((total_events >= 30) AND (distinct_users >= 5) AND (distinct_labs >= 3)))
);


--
-- Name: TABLE analytics_monthly_search_rollups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.analytics_monthly_search_rollups IS 'Irreversible thresholded monthly aggregates. Current API rows remain internal_only and are not externally releasable.';


--
-- Name: analytics_review_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_review_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    action text NOT NULL,
    notes text,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    operator_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analytics_review_audit_logs_action_check CHECK ((action = ANY (ARRAY['approved'::text, 'rejected'::text]))),
    CONSTRAINT analytics_review_audit_logs_evidence_check CHECK (((jsonb_typeof(evidence) = 'object'::text) AND (octet_length((evidence)::text) <= 65536)))
);


--
-- Name: analytics_review_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_review_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_type text NOT NULL,
    source_key text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    proposed_alias text,
    canonical_name text,
    canonical_cas text,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    sample_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    review_notes text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analytics_review_candidates_candidate_type_check CHECK ((candidate_type = ANY (ARRAY['search_alias'::text, 'safety_rule'::text, 'education_content'::text]))),
    CONSTRAINT analytics_review_candidates_evidence_check CHECK (((jsonb_typeof(evidence) = 'object'::text) AND (octet_length((evidence)::text) <= 65536))),
    CONSTRAINT analytics_review_candidates_sample_count_check CHECK ((sample_count >= 0)),
    CONSTRAINT analytics_review_candidates_source_key_check CHECK (((char_length(source_key) >= 1) AND (char_length(source_key) <= 500))),
    CONSTRAINT analytics_review_candidates_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id uuid,
    actor_name text,
    lab_id uuid,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    action text NOT NULL,
    location_context text,
    before_data jsonb,
    after_data jsonb,
    diff_data jsonb,
    source text DEFAULT 'system'::text,
    request_id uuid
);


--
-- Name: cabinet_activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cabinet_activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cabinet_id uuid NOT NULL,
    action_type text NOT NULL,
    item_name text NOT NULL,
    reason text,
    memo text,
    performed_by uuid,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cabinet_activity_logs_action_type_check CHECK ((action_type = ANY (ARRAY['add'::text, 'update'::text, 'remove'::text, 'clear_all'::text])))
);


--
-- Name: cabinet_disposal_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cabinet_disposal_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cabinet_id uuid NOT NULL,
    item_name text NOT NULL,
    reason text NOT NULL,
    memo text,
    disposed_by uuid,
    disposed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cabinet_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cabinet_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cabinet_id uuid NOT NULL,
    shelf_id uuid NOT NULL,
    template text NOT NULL,
    name text NOT NULL,
    width numeric NOT NULL,
    "position" numeric NOT NULL,
    depth_position numeric DEFAULT 50 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    expiry_date date,
    capacity text,
    product_number text,
    brand text,
    notes text,
    cas_no text,
    remaining_percent integer,
    inventory_item_id uuid,
    h_codes jsonb DEFAULT '[]'::jsonb NOT NULL,
    ghs_status text,
    ghs_checked_at timestamp with time zone,
    manufacturer_date_type text DEFAULT 'unlabeled'::text NOT NULL,
    received_date date,
    opened_date date,
    CONSTRAINT cabinet_items_ghs_status_check CHECK (((ghs_status IS NULL) OR (ghs_status = ANY (ARRAY['not_checked'::text, 'pending'::text, 'success'::text, 'no_ghs'::text, 'not_found'::text, 'transient_error'::text, 'invalid_cas'::text])))),
    CONSTRAINT cabinet_items_h_codes_array_check CHECK ((jsonb_typeof(h_codes) = 'array'::text)),
    CONSTRAINT cabinet_items_manufacturer_date_type_check CHECK ((manufacturer_date_type = ANY (ARRAY['expiry'::text, 'minimum_shelf_life'::text, 'unlabeled'::text])))
);


--
-- Name: cabinet_shelves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cabinet_shelves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cabinet_id uuid NOT NULL,
    level integer NOT NULL,
    dividers jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: cabinets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cabinets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    width integer DEFAULT 5 NOT NULL,
    height integer DEFAULT 9 NOT NULL,
    depth integer DEFAULT 2 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    user_id uuid,
    location text,
    image_url text,
    lab_id uuid
);


--
-- Name: chemical_enrichment_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chemical_enrichment_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lookup_key text NOT NULL,
    result_version integer NOT NULL,
    canonical_identity_key text NOT NULL,
    cache_status text NOT NULL,
    result jsonb NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chemical_enrichment_cache_expiry_check CHECK ((expires_at > fetched_at)),
    CONSTRAINT chemical_enrichment_cache_identity_key_length CHECK (((char_length(canonical_identity_key) >= 1) AND (char_length(canonical_identity_key) <= 500))),
    CONSTRAINT chemical_enrichment_cache_lookup_key_length CHECK (((char_length(lookup_key) >= 1) AND (char_length(lookup_key) <= 500))),
    CONSTRAINT chemical_enrichment_cache_status_check CHECK ((cache_status = ANY (ARRAY['complete'::text, 'classified'::text, 'not_classified'::text, 'source_absent'::text, 'identity_ambiguous'::text, 'not_found'::text])))
);


--
-- Name: chemical_enrichment_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chemical_enrichment_leases (
    lease_key text NOT NULL,
    result_version integer NOT NULL,
    owner_token uuid NOT NULL,
    lease_until timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chemical_enrichment_leases_key_length CHECK (((char_length(lease_key) >= 1) AND (char_length(lease_key) <= 500)))
);


--
-- Name: chemical_source_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chemical_source_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    record_type text NOT NULL,
    lookup_key text NOT NULL,
    result_version integer NOT NULL,
    cache_status text NOT NULL,
    result jsonb NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chemical_source_cache_expiry_check CHECK ((expires_at > fetched_at)),
    CONSTRAINT chemical_source_cache_lookup_key_length CHECK (((char_length(lookup_key) >= 1) AND (char_length(lookup_key) <= 500))),
    CONSTRAINT chemical_source_cache_record_type_check CHECK ((record_type = ANY (ARRAY['identity'::text, 'reference_ph'::text]))),
    CONSTRAINT chemical_source_cache_result_object_check CHECK ((jsonb_typeof(result) = 'object'::text)),
    CONSTRAINT chemical_source_cache_source_check CHECK ((source = 'kosha'::text)),
    CONSTRAINT chemical_source_cache_status_check CHECK ((cache_status = ANY (ARRAY['complete'::text, 'source_absent'::text])))
);


--
-- Name: commerce_intent_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commerce_intent_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    source_screen text,
    storage_type text,
    product_id uuid,
    source_item_type text,
    source_item_id uuid,
    brand_name text,
    brand_normalized text,
    product_number text,
    quantity integer,
    capacity_text text,
    capacity_value numeric,
    capacity_unit text,
    capacity_ml numeric,
    cas_number text,
    cas_number_normalized text,
    cas_input_method text DEFAULT 'unknown'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    lab_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commerce_intent_events_capacity_ml_check CHECK (((capacity_ml IS NULL) OR (capacity_ml >= (0)::numeric))),
    CONSTRAINT commerce_intent_events_capacity_value_check CHECK (((capacity_value IS NULL) OR (capacity_value >= (0)::numeric))),
    CONSTRAINT commerce_intent_events_cas_input_method_check CHECK ((cas_input_method = ANY (ARRAY['manual'::text, 'catalog'::text, 'scan'::text, 'ocr'::text, 'voice'::text, 'unknown'::text]))),
    CONSTRAINT commerce_intent_events_event_type_check CHECK ((event_type = ANY (ARRAY['inventory_registered'::text, 'inventory_updated'::text, 'cabinet_item_placed'::text, 'cabinet_item_scanned'::text, 'cabinet_item_updated'::text]))),
    CONSTRAINT commerce_intent_events_quantity_check CHECK (((quantity IS NULL) OR (quantity > 0))),
    CONSTRAINT commerce_intent_events_source_item_type_check CHECK ((source_item_type = ANY (ARRAY['inventory'::text, 'cabinet_item'::text, 'product'::text]))),
    CONSTRAINT commerce_intent_events_storage_type_check CHECK ((storage_type = ANY (ARRAY['cabinet'::text, 'other'::text])))
);


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    type text DEFAULT 'general'::text NOT NULL,
    message text NOT NULL,
    contact text,
    user_id uuid,
    user_agent text,
    resolved boolean DEFAULT false,
    developer_note text,
    status text DEFAULT 'new'::text NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    user_email text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'in_progress'::text, 'resolved'::text]))),
    CONSTRAINT feedback_type_check CHECK ((type = ANY (ARRAY['bug'::text, 'improvement'::text, 'general'::text])))
);


--
-- Name: ghs_cas_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ghs_cas_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope_type text NOT NULL,
    scope_id uuid NOT NULL,
    cas_number text NOT NULL,
    result jsonb NOT NULL,
    result_version integer DEFAULT 1 NOT NULL,
    source text DEFAULT 'pubchem'::text NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    updated_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cache_status text NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT ghs_cas_cache_cas_number_check CHECK ((cas_number ~ '^\d{1,7}-\d{2}-\d$'::text)),
    CONSTRAINT ghs_cas_cache_scope_type_check CHECK ((scope_type = ANY (ARRAY['lab'::text, 'user'::text]))),
    CONSTRAINT ghs_cas_cache_status_check CHECK ((cache_status = ANY (ARRAY['success'::text, 'not_found'::text, 'no_ghs'::text, 'transient_error'::text])))
);


--
-- Name: global_reagent_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.global_reagent_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alias text NOT NULL,
    normalized_alias text NOT NULL,
    canonical_name text NOT NULL,
    cas_number text,
    source_review_id uuid,
    approved_by uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT global_reagent_aliases_alias_check CHECK (((char_length(alias) >= 1) AND (char_length(alias) <= 200))),
    CONSTRAINT global_reagent_aliases_canonical_check CHECK (((char_length(canonical_name) >= 1) AND (char_length(canonical_name) <= 300))),
    CONSTRAINT global_reagent_aliases_normalized_check CHECK (((char_length(normalized_alias) >= 1) AND (char_length(normalized_alias) <= 200)))
);


--
-- Name: inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lab_id uuid,
    user_id uuid,
    name text NOT NULL,
    brand text,
    product_number text,
    cas_number text,
    quantity integer DEFAULT 1 NOT NULL,
    capacity text,
    storage_type text DEFAULT 'other'::text NOT NULL,
    cabinet_id uuid,
    storage_location_id uuid,
    product_id uuid,
    expiry_date date,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    remaining_percent integer,
    manufacturer_date_type text DEFAULT 'unlabeled'::text NOT NULL,
    received_date date,
    opened_date date,
    CONSTRAINT inventory_manufacturer_date_type_check CHECK ((manufacturer_date_type = ANY (ARRAY['expiry'::text, 'minimum_shelf_life'::text, 'unlabeled'::text]))),
    CONSTRAINT inventory_storage_type_check CHECK ((storage_type = ANY (ARRAY['cabinet'::text, 'other'::text])))
);


--
-- Name: inventory_move_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_move_receipts (
    request_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    targets_hash text NOT NULL,
    destination_hash text NOT NULL,
    receipt jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_move_receipts_destination_hash_check CHECK ((destination_hash ~ '^[0-9a-f]{32}$'::text)),
    CONSTRAINT inventory_move_receipts_receipt_check CHECK ((jsonb_typeof(receipt) = 'object'::text)),
    CONSTRAINT inventory_move_receipts_targets_hash_check CHECK ((targets_hash ~ '^[0-9a-f]{32}$'::text))
);


--
-- Name: inventory_usage_completion_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_usage_completion_receipts (
    request_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    lab_id uuid,
    cabinet_item_id uuid NOT NULL,
    inventory_item_id uuid NOT NULL,
    completion_kind text NOT NULL,
    previous_quantity integer NOT NULL,
    remaining_quantity integer NOT NULL,
    cabinet_item_removed boolean NOT NULL,
    inventory_item_removed boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_usage_completion_receipts_completion_kind_check CHECK ((completion_kind = ANY (ARRAY['used'::text, 'empty_container'::text]))),
    CONSTRAINT inventory_usage_completion_receipts_previous_quantity_check CHECK ((previous_quantity > 0)),
    CONSTRAINT inventory_usage_completion_receipts_remaining_quantity_check CHECK ((remaining_quantity >= 0)),
    CONSTRAINT inventory_usage_completion_receipts_removal_check CHECK (((cabinet_item_removed = (remaining_quantity = 0)) AND (inventory_item_removed = (remaining_quantity = 0)))),
    CONSTRAINT inventory_usage_completion_receipts_transition_check CHECK ((remaining_quantity = (previous_quantity - 1)))
);


--
-- Name: lab_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lab_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lab_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    joined_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    nickname text,
    CONSTRAINT lab_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'pi'::text, 'postdoc'::text, 'graduate'::text, 'undergrad'::text, 'researcher'::text, 'student'::text])))
);


--
-- Name: labs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.labs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    join_password text,
    institution_type text,
    research_field text,
    join_password_hash text,
    institution_name text
);


--
-- Name: COLUMN labs.join_password; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.labs.join_password IS 'Deprecated compatibility column. Values are normalized into join_password_hash by trigger.';


--
-- Name: COLUMN labs.join_password_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.labs.join_password_hash IS 'Bcrypt hash for the optional lab join password.';


--
-- Name: onboarding_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    step_key text,
    source_screen text,
    platform text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    lab_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT onboarding_events_event_type_check CHECK ((event_type = ANY (ARRAY['shown'::text, 'step_completed'::text, 'skipped'::text, 'first_value_reached'::text, 'replayed'::text]))),
    CONSTRAINT onboarding_events_platform_check CHECK ((platform = ANY (ARRAY['web'::text, 'native'::text]))),
    CONSTRAINT onboarding_events_step_key_check CHECK (((step_key IS NULL) OR (step_key = ANY (ARRAY['search'::text, 'disposal'::text, 'cabinet'::text, 'inventory'::text]))))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid NOT NULL,
    brand text,
    product_name text,
    product_numbers text[],
    thumbnail_url text,
    url_slug text
);


--
-- Name: reagent_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reagent_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_item_type text NOT NULL,
    source_item_id uuid NOT NULL,
    canonical_name text NOT NULL,
    alias text NOT NULL,
    normalized_alias text NOT NULL,
    cas_number text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    lab_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reagent_aliases_source_item_type_check CHECK ((source_item_type = ANY (ARRAY['cabinet_item'::text, 'inventory'::text])))
);


--
-- Name: safety_center_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_center_exports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    user_id uuid DEFAULT auth.uid(),
    format text NOT NULL,
    datasets text[] NOT NULL,
    lab_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT safety_center_exports_format_check CHECK ((format = ANY (ARRAY['xlsx'::text, 'pdf'::text]))),
    CONSTRAINT safety_center_exports_row_count_check CHECK ((row_count >= 0))
);


--
-- Name: safety_center_lab_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_center_lab_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    lab_id uuid NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    scope text[] DEFAULT ARRAY['summary'::text, 'risk_detail'::text, 'exports'::text] NOT NULL,
    requested_by uuid,
    approved_by uuid,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT safety_center_lab_links_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'approved'::text, 'rejected'::text, 'revoked'::text])))
);


--
-- Name: safety_center_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_center_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT safety_center_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])))
);


--
-- Name: safety_center_request_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_center_request_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_user_id uuid,
    actor_scope text NOT NULL,
    event_type text NOT NULL,
    from_status text,
    to_status text,
    body text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT safety_center_request_events_actor_scope_check CHECK ((actor_scope = ANY (ARRAY['center'::text, 'lab'::text, 'system'::text]))),
    CONSTRAINT safety_center_request_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'comment'::text, 'status_change'::text])))
);


--
-- Name: safety_center_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_center_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    center_id uuid NOT NULL,
    lab_id uuid NOT NULL,
    target_type text,
    target_id uuid,
    title text NOT NULL,
    description text,
    priority text DEFAULT 'normal'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    due_date date,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT safety_center_requests_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT safety_center_requests_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'submitted'::text, 'resolved'::text])))
);


--
-- Name: safety_centers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_centers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_name text NOT NULL,
    institution_domain text NOT NULL,
    center_name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_by uuid DEFAULT auth.uid() NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    verification_document_path text,
    verification_document_name text,
    verification_document_mime_type text,
    verification_document_size bigint,
    verification_document_uploaded_at timestamp with time zone,
    CONSTRAINT safety_centers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT safety_centers_verification_document_size_check CHECK (((verification_document_size IS NULL) OR ((verification_document_size >= 1) AND (verification_document_size <= 10485760))))
);


--
-- Name: safety_compliance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_compliance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    source_screen text,
    trigger_source text,
    warning_severity text,
    rule_id text,
    message_key text,
    cabinet_id uuid,
    shelf_id uuid,
    primary_chemical_name text,
    primary_chemical_name_normalized text,
    primary_cas_number text,
    primary_cas_number_normalized text,
    secondary_chemical_name text,
    secondary_chemical_name_normalized text,
    secondary_cas_number text,
    secondary_cas_number_normalized text,
    guide_scope text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    lab_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT safety_compliance_events_ai_guide_fields_check CHECK (((event_type <> 'ai_disposal_guide_viewed'::text) OR (primary_chemical_name IS NOT NULL))),
    CONSTRAINT safety_compliance_events_event_type_check CHECK ((event_type = ANY (ARRAY['storage_warning_ignored'::text, 'ai_disposal_guide_viewed'::text]))),
    CONSTRAINT safety_compliance_events_guide_scope_check CHECK ((guide_scope = ANY (ARRAY['single'::text, 'mixture'::text]))),
    CONSTRAINT safety_compliance_events_storage_warning_fields_check CHECK (((event_type <> 'storage_warning_ignored'::text) OR ((rule_id IS NOT NULL) AND (warning_severity IS NOT NULL) AND (primary_chemical_name IS NOT NULL) AND (secondary_chemical_name IS NOT NULL)))),
    CONSTRAINT safety_compliance_events_warning_severity_check CHECK ((warning_severity = ANY (ARRAY['DANGER'::text, 'WARNING'::text])))
);


--
-- Name: search_analytics_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_analytics_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    related_event_id uuid,
    action_type text NOT NULL,
    target_type text,
    target_ref text,
    matched_cas text,
    matched_standard_name text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT search_analytics_actions_action_type_check CHECK ((action_type = ANY (ARRAY['result_opened'::text, 'result_selected'::text, 'query_reformulated'::text, 'scan_corrected'::text, 'added_to_batch'::text]))),
    CONSTRAINT search_analytics_actions_metadata_check CHECK (((jsonb_typeof(metadata) = 'object'::text) AND (octet_length((metadata)::text) <= 16384))),
    CONSTRAINT search_analytics_actions_target_type_check CHECK (((target_type IS NULL) OR (target_type = ANY (ARRAY['chemical'::text, 'product'::text, 'cabinet'::text, 'query'::text, 'batch'::text]))))
);


--
-- Name: search_analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_analytics_events (
    id uuid NOT NULL,
    user_id uuid,
    guest_subject_id uuid,
    lab_id uuid,
    session_id uuid NOT NULL,
    previous_event_id uuid,
    source_history_id uuid,
    query_sanitized text NOT NULL,
    query_normalized text NOT NULL,
    query_type text NOT NULL,
    search_channel text NOT NULL,
    chemical_result_count integer DEFAULT 0 NOT NULL,
    product_result_count integer DEFAULT 0 NOT NULL,
    cabinet_result_count integer DEFAULT 0 NOT NULL,
    latency_ms integer,
    outcome text NOT NULL,
    matched_cas text,
    matched_pubchem_cid bigint,
    matched_kosha_id text,
    matched_standard_name text,
    previous_ingestion_failures integer DEFAULT 0 NOT NULL,
    commercial_cohort text DEFAULT 'internal_only'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT search_analytics_events_cabinet_result_count_check CHECK (((cabinet_result_count >= 0) AND (cabinet_result_count <= 100000))),
    CONSTRAINT search_analytics_events_chemical_result_count_check CHECK (((chemical_result_count >= 0) AND (chemical_result_count <= 100000))),
    CONSTRAINT search_analytics_events_commercial_cohort_check CHECK ((commercial_cohort = ANY (ARRAY['internal_only'::text, 'institution_contract'::text]))),
    CONSTRAINT search_analytics_events_latency_ms_check CHECK (((latency_ms >= 0) AND (latency_ms <= 300000))),
    CONSTRAINT search_analytics_events_matched_pubchem_cid_check CHECK (((matched_pubchem_cid IS NULL) OR (matched_pubchem_cid > 0))),
    CONSTRAINT search_analytics_events_outcome_check CHECK ((outcome = ANY (ARRAY['matched'::text, 'no_result'::text, 'invalid_query'::text, 'technical_error'::text, 'legacy_success_unknown'::text]))),
    CONSTRAINT search_analytics_events_previous_ingestion_failures_check CHECK (((previous_ingestion_failures >= 0) AND (previous_ingestion_failures <= 1000))),
    CONSTRAINT search_analytics_events_product_result_count_check CHECK (((product_result_count >= 0) AND (product_result_count <= 100000))),
    CONSTRAINT search_analytics_events_query_normalized_check CHECK (((char_length(query_normalized) >= 1) AND (char_length(query_normalized) <= 200))),
    CONSTRAINT search_analytics_events_query_sanitized_check CHECK (((char_length(query_sanitized) >= 1) AND (char_length(query_sanitized) <= 200))),
    CONSTRAINT search_analytics_events_query_type_check CHECK ((query_type = ANY (ARRAY['name'::text, 'cas'::text, 'formula'::text, 'unknown'::text]))),
    CONSTRAINT search_analytics_events_search_channel_check CHECK ((search_channel = ANY (ARRAY['manual'::text, 'autocomplete'::text, 'history'::text, 'scan'::text, 'voice'::text, 'url'::text, 'legacy'::text]))),
    CONSTRAINT search_analytics_events_subject_check CHECK ((((user_id IS NOT NULL) AND (guest_subject_id IS NULL)) OR ((user_id IS NULL) AND (guest_subject_id IS NOT NULL) AND (lab_id IS NULL))))
);


--
-- Name: TABLE search_analytics_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.search_analytics_events IS 'Server-only submitted-search analytics. No keystrokes, IP addresses, user agents, or browser fingerprints are stored.';


--
-- Name: search_analytics_guest_subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_analytics_guest_subjects (
    id uuid NOT NULL,
    delete_token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT search_analytics_guest_subjects_hash_check CHECK ((delete_token_hash ~ '^[a-f0-9]{64}$'::text))
);


--
-- Name: storage_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lab_id uuid,
    name text NOT NULL,
    icon text DEFAULT '📦'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);


--
-- Name: user_search_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_search_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    query text NOT NULL,
    searched_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: voice_query_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_query_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    raw_input text NOT NULL,
    normalized_query text,
    intent text,
    failure_reason text NOT NULL,
    correction_text text,
    selected_match_source text,
    selected_match_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    lab_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT voice_query_feedback_failure_reason_check CHECK ((failure_reason = ANY (ARRAY['no_match'::text, 'ambiguous'::text, 'user_corrected'::text]))),
    CONSTRAINT voice_query_feedback_intent_check CHECK ((intent = ANY (ARRAY['location'::text, 'expiration'::text, 'remaining'::text, 'disposal'::text]))),
    CONSTRAINT voice_query_feedback_selected_match_source_check CHECK ((selected_match_source = ANY (ARRAY['cabinet_item'::text, 'inventory'::text])))
);


--
-- Name: waste_log_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waste_log_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waste_log_id uuid NOT NULL,
    line_number integer NOT NULL,
    cart_line_id text NOT NULL,
    source_type text DEFAULT 'search'::text NOT NULL,
    source_ref text,
    inventory_item_id uuid,
    cabinet_item_id uuid,
    chemical_name text NOT NULL,
    cas_number text,
    formula text,
    molecular_weight numeric,
    pubchem_cid bigint,
    kosha_chem_id text,
    identity_confidence numeric,
    ghs_data_status text,
    concentration_value numeric,
    concentration_unit text,
    hazard_flags text[] DEFAULT ARRAY[]::text[] NOT NULL,
    data_sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    analysis_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    solution_volume_value numeric,
    solution_volume_unit text,
    solution_volume_normalized_ml numeric,
    solution_volume_is_estimate boolean DEFAULT false NOT NULL,
    concentration_basis text,
    density_value numeric,
    density_unit text,
    density_kind text,
    density_temperature_c numeric,
    density_source text,
    density_is_estimate boolean DEFAULT false NOT NULL,
    ph_catalog_id text,
    source_search_event_id uuid,
    CONSTRAINT waste_log_items_concentration_basis_check CHECK (((concentration_basis IS NULL) OR (concentration_basis = ANY (ARRAY['w_w'::text, 'w_v'::text, 'v_v'::text])))),
    CONSTRAINT waste_log_items_concentration_check CHECK ((((concentration_value IS NULL) AND (concentration_unit IS NULL)) OR ((concentration_value IS NOT NULL) AND (concentration_value > (0)::numeric) AND (concentration_unit IS NOT NULL)))),
    CONSTRAINT waste_log_items_concentration_unit_check CHECK (((concentration_unit IS NULL) OR (concentration_unit = ANY (ARRAY['M'::text, 'mM'::text, '%'::text, 'mg/mL'::text])))),
    CONSTRAINT waste_log_items_density_check CHECK ((((density_value IS NULL) AND (density_unit IS NULL) AND (density_kind IS NULL) AND (density_temperature_c IS NULL) AND (density_source IS NULL)) OR ((density_value > (0)::numeric) AND ((density_value)::text <> 'NaN'::text) AND (density_unit = 'g/mL'::text) AND (density_kind = ANY (ARRAY['solution'::text, 'solute'::text])) AND ((density_temperature_c IS NULL) OR ((density_temperature_c >= ('-100'::integer)::numeric) AND (density_temperature_c <= (300)::numeric))) AND ((density_source IS NULL) OR (density_source = ANY (ARRAY['catalog'::text, 'user'::text])))))),
    CONSTRAINT waste_log_items_ghs_data_status_check CHECK (((ghs_data_status IS NULL) OR (ghs_data_status = ANY (ARRAY['verified'::text, 'lookup_failed'::text, 'not_checked'::text])))),
    CONSTRAINT waste_log_items_identity_confidence_check CHECK (((identity_confidence IS NULL) OR ((identity_confidence >= (0)::numeric) AND (identity_confidence <= (1)::numeric)))),
    CONSTRAINT waste_log_items_line_number_check CHECK ((line_number > 0)),
    CONSTRAINT waste_log_items_solution_volume_check CHECK ((((solution_volume_value IS NULL) AND (solution_volume_unit IS NULL) AND (solution_volume_normalized_ml IS NULL)) OR ((solution_volume_value > (0)::numeric) AND ((solution_volume_value)::text <> 'NaN'::text) AND (solution_volume_unit = ANY (ARRAY['uL'::text, 'mL'::text, 'L'::text])) AND (solution_volume_normalized_ml > (0)::numeric) AND ((solution_volume_normalized_ml)::text <> 'NaN'::text)))),
    CONSTRAINT waste_log_items_source_type_check CHECK ((source_type = ANY (ARRAY['search'::text, 'scan'::text, 'inventory'::text, 'cabinet'::text, 'manual'::text, 'import'::text])))
);


--
-- Name: COLUMN waste_log_items.ph_catalog_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.waste_log_items.ph_catalog_id IS 'Pinned offline pH catalog identifier for the exact chemical form selected by the user.';


--
-- Name: COLUMN waste_log_items.source_search_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.waste_log_items.source_search_event_id IS 'Optional direct provenance link to the successful submitted search that produced this finalized component; validated to the same user/lab at insert time.';


--
-- Name: waste_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waste_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    chemicals jsonb NOT NULL,
    disposal_category text NOT NULL,
    total_volume_ml numeric,
    handler_name text,
    memo text,
    user_id uuid,
    lab_id uuid,
    schema_version integer DEFAULT 1 NOT NULL,
    record_origin text DEFAULT 'legacy'::text NOT NULL,
    handling_action text,
    decision_status text DEFAULT 'legacy_unverified'::text NOT NULL,
    stream_code text,
    matrix_code text,
    policy_version_id uuid,
    rule_version text,
    total_amount_value numeric,
    total_amount_unit text,
    normalized_amount_value numeric,
    normalized_amount_unit text,
    amount_is_approximate boolean DEFAULT false NOT NULL,
    amount_is_unknown boolean DEFAULT false NOT NULL,
    decision_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    stream_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    confirmation_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    request_id uuid,
    request_payload_hash text,
    request_items_hash text,
    voided_at timestamp with time zone,
    voided_by uuid,
    void_reason text,
    ph_prediction_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT waste_logs_amount_state_check CHECK (((schema_version = 1) OR ((NOT (amount_is_unknown AND amount_is_approximate)) AND ((amount_is_unknown AND (total_amount_value IS NULL) AND (total_amount_unit IS NULL) AND (normalized_amount_value IS NULL) AND (normalized_amount_unit IS NULL)) OR ((NOT amount_is_unknown) AND (total_amount_value IS NOT NULL) AND (total_amount_unit IS NOT NULL) AND (normalized_amount_value IS NOT NULL) AND (normalized_amount_unit IS NOT NULL) AND (total_amount_value > (0)::numeric) AND (normalized_amount_value > (0)::numeric)))))),
    CONSTRAINT waste_logs_decision_status_check CHECK ((decision_status = ANY (ARRAY['ready'::text, 'needs_input'::text, 'blocked'::text, 'legacy_unverified'::text]))),
    CONSTRAINT waste_logs_handling_action_check CHECK (((handling_action IS NULL) OR (handling_action = ANY (ARRAY['container_deposit'::text, 'isolated'::text, 'handover'::text])))),
    CONSTRAINT waste_logs_matrix_code_check CHECK (((matrix_code IS NULL) OR (matrix_code = ANY (ARRAY['aqueous'::text, 'organic_non_halogenated'::text, 'organic_halogenated'::text, 'mixed_biphasic'::text, 'solid_slurry'::text, 'unknown'::text])))),
    CONSTRAINT waste_logs_normalized_amount_unit_check CHECK (((normalized_amount_unit IS NULL) OR (normalized_amount_unit = ANY (ARRAY['mL'::text, 'mg'::text])))),
    CONSTRAINT waste_logs_ph_prediction_snapshot_object_check CHECK (((jsonb_typeof(ph_prediction_snapshot) = 'object'::text) AND (octet_length((ph_prediction_snapshot)::text) <= 32768))),
    CONSTRAINT waste_logs_record_origin_check CHECK ((record_origin = ANY (ARRAY['legacy'::text, 'legacy_inventory_delete'::text, 'legacy_cabinet_clear'::text, 'waste_batch'::text, 'inventory_disposal'::text, 'import'::text]))),
    CONSTRAINT waste_logs_request_items_hash_check CHECK ((((request_items_hash IS NULL) OR (request_items_hash ~ '^[0-9a-f]{32}$'::text)) AND ((schema_version = 1) OR (record_origin <> 'inventory_disposal'::text) OR (request_items_hash IS NOT NULL)))),
    CONSTRAINT waste_logs_request_payload_hash_check CHECK (((schema_version = 1) OR (request_payload_hash ~ '^[0-9a-f]{32}$'::text))),
    CONSTRAINT waste_logs_schema_version_check CHECK ((schema_version = ANY (ARRAY[1, 2]))),
    CONSTRAINT waste_logs_total_amount_unit_check CHECK (((total_amount_unit IS NULL) OR (total_amount_unit = ANY (ARRAY['mL'::text, 'L'::text, 'mg'::text, 'g'::text])))),
    CONSTRAINT waste_logs_v2_action_status_check CHECK (((schema_version = 1) OR ((handling_action IS NOT NULL) AND (stream_code IS NOT NULL) AND (matrix_code IS NOT NULL) AND (policy_version_id IS NOT NULL) AND (request_id IS NOT NULL) AND (((decision_status = 'ready'::text) AND (handling_action = 'container_deposit'::text)) OR ((decision_status = ANY (ARRAY['needs_input'::text, 'blocked'::text])) AND (handling_action = ANY (ARRAY['isolated'::text, 'handover'::text]))))))),
    CONSTRAINT waste_logs_void_check CHECK ((((voided_at IS NULL) AND (voided_by IS NULL) AND (void_reason IS NULL)) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM void_reason), ''::text) IS NOT NULL))))
);


--
-- Name: COLUMN waste_logs.ph_prediction_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.waste_logs.ph_prediction_snapshot IS 'Audited pH model output. It is never routing evidence by itself; routing requires a separate server-issued authorization.';


--
-- Name: waste_ph_prediction_authorizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waste_ph_prediction_authorizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    input_fingerprint text NOT NULL,
    prediction_snapshot jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT waste_ph_prediction_authorizations_expiry_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:15:00'::interval)))),
    CONSTRAINT waste_ph_prediction_authorizations_input_fingerprint_check CHECK ((input_fingerprint ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT waste_ph_prediction_authorizations_prediction_check CHECK (((jsonb_typeof(prediction_snapshot) = 'object'::text) AND ((prediction_snapshot ->> 'status'::text) = 'available'::text) AND ((prediction_snapshot ->> 'confidence'::text) = 'good'::text) AND (jsonb_typeof((prediction_snapshot -> 'value'::text)) = 'number'::text) AND (((prediction_snapshot ->> 'value'::text))::numeric > 2.2) AND (((prediction_snapshot ->> 'value'::text))::numeric < 12.3) AND (jsonb_typeof((prediction_snapshot -> 'displayValue'::text)) = 'number'::text) AND (jsonb_typeof((prediction_snapshot -> 'ionicStrength'::text)) = 'number'::text) AND (jsonb_typeof(COALESCE((prediction_snapshot -> 'issueCodes'::text), '[]'::jsonb)) = 'array'::text) AND (jsonb_array_length(COALESCE((prediction_snapshot -> 'issueCodes'::text), '[]'::jsonb)) = 0) AND (NULLIF((prediction_snapshot ->> 'modelVersion'::text), ''::text) IS NOT NULL) AND (NULLIF((prediction_snapshot ->> 'catalogVersion'::text), ''::text) IS NOT NULL) AND (COALESCE((prediction_snapshot ->> 'inputHash'::text), ''::text) ~ '^[A-Za-z0-9:_-]{8,128}$'::text)))
);


--
-- Name: TABLE waste_ph_prediction_authorizations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.waste_ph_prediction_authorizations IS 'Server-issued, single-use predicted-pH routing approvals bound to an exact waste RPC payload.';


--
-- Name: waste_policy_lab_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waste_policy_lab_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lab_id uuid NOT NULL,
    stream_code text NOT NULL,
    display_name_ko text,
    display_name_en text,
    container_label text,
    container_color text,
    location text,
    handler_contact text,
    replacement_location text,
    is_disabled boolean DEFAULT false NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: waste_policy_streams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waste_policy_streams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    policy_version_id uuid NOT NULL,
    stream_code text NOT NULL,
    display_name_ko text NOT NULL,
    display_name_en text NOT NULL,
    description_ko text,
    container_label text,
    container_color text,
    location text,
    handler_contact text,
    sop_url text,
    allowed_hazard_flags text[] DEFAULT ARRAY[]::text[] NOT NULL,
    blocked_hazard_flags text[] DEFAULT ARRAY[]::text[] NOT NULL,
    prohibitions text[] DEFAULT ARRAY[]::text[] NOT NULL,
    label_requirements text[] DEFAULT ARRAY[]::text[] NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: waste_policy_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waste_policy_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    policy_key text NOT NULL,
    scope_type text NOT NULL,
    safety_center_id uuid,
    lab_id uuid,
    parent_policy_version_id uuid,
    version_label text NOT NULL,
    name text NOT NULL,
    jurisdiction text DEFAULT 'KR'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid,
    activated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    CONSTRAINT waste_policy_versions_scope_check CHECK ((((scope_type = 'system'::text) AND (safety_center_id IS NULL) AND (lab_id IS NULL)) OR ((scope_type = 'safety_center'::text) AND (safety_center_id IS NOT NULL) AND (lab_id IS NULL)) OR ((scope_type = 'lab'::text) AND (safety_center_id IS NULL) AND (lab_id IS NOT NULL)))),
    CONSTRAINT waste_policy_versions_scope_type_check CHECK ((scope_type = ANY (ARRAY['system'::text, 'safety_center'::text, 'lab'::text]))),
    CONSTRAINT waste_policy_versions_source_refs_check CHECK ((jsonb_typeof(source_refs) = 'array'::text)),
    CONSTRAINT waste_policy_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'retired'::text])))
);


--
-- Name: waste_stream_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waste_stream_catalog (
    code text NOT NULL,
    display_name_ko text NOT NULL,
    display_name_en text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT waste_stream_catalog_code_check CHECK ((code = ANY (ARRAY['ACID_AQUEOUS'::text, 'ALKALI_AQUEOUS'::text, 'ORGANIC_HALOGENATED'::text, 'ORGANIC_NON_HALOGENATED'::text, 'HEAVY_METAL'::text, 'CYANIDE_SULFIDE'::text, 'REACTIVE_OXIDIZER'::text, 'SOLID_CONTAMINATED'::text, 'AQUEOUS_OTHER'::text, 'SPECIAL_REVIEW'::text])))
);


--
-- Name: ai_api_cache ai_api_cache_api_type_cache_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_api_cache
    ADD CONSTRAINT ai_api_cache_api_type_cache_key_key UNIQUE (api_type, cache_key);


--
-- Name: ai_api_cache ai_api_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_api_cache
    ADD CONSTRAINT ai_api_cache_pkey PRIMARY KEY (id);


--
-- Name: analytics_commercialization_settings analytics_commercialization_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_commercialization_settings
    ADD CONSTRAINT analytics_commercialization_settings_pkey PRIMARY KEY (singleton);


--
-- Name: analytics_deletion_audits analytics_deletion_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_deletion_audits
    ADD CONSTRAINT analytics_deletion_audits_pkey PRIMARY KEY (id);


--
-- Name: analytics_export_audits analytics_export_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_export_audits
    ADD CONSTRAINT analytics_export_audits_pkey PRIMARY KEY (id);


--
-- Name: analytics_monthly_mixture_rollups analytics_monthly_mixture_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_monthly_mixture_rollups
    ADD CONSTRAINT analytics_monthly_mixture_rollups_pkey PRIMARY KEY (month_start, commercial_cohort, component_a_key, component_b_key);


--
-- Name: analytics_monthly_search_rollups analytics_monthly_search_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_monthly_search_rollups
    ADD CONSTRAINT analytics_monthly_search_rollups_pkey PRIMARY KEY (month_start, commercial_cohort, query_normalized);


--
-- Name: analytics_review_audit_logs analytics_review_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_review_audit_logs
    ADD CONSTRAINT analytics_review_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: analytics_review_candidates analytics_review_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_review_candidates
    ADD CONSTRAINT analytics_review_candidates_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: cabinet_activity_logs cabinet_activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_activity_logs
    ADD CONSTRAINT cabinet_activity_logs_pkey PRIMARY KEY (id);


--
-- Name: cabinet_disposal_logs cabinet_disposal_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_disposal_logs
    ADD CONSTRAINT cabinet_disposal_logs_pkey PRIMARY KEY (id);


--
-- Name: cabinet_items cabinet_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_items
    ADD CONSTRAINT cabinet_items_pkey PRIMARY KEY (id);


--
-- Name: cabinet_shelves cabinet_shelves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_shelves
    ADD CONSTRAINT cabinet_shelves_pkey PRIMARY KEY (id);


--
-- Name: cabinets cabinets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinets
    ADD CONSTRAINT cabinets_pkey PRIMARY KEY (id);


--
-- Name: chemical_enrichment_cache chemical_enrichment_cache_lookup_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_enrichment_cache
    ADD CONSTRAINT chemical_enrichment_cache_lookup_version_unique UNIQUE (lookup_key, result_version);


--
-- Name: chemical_enrichment_cache chemical_enrichment_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_enrichment_cache
    ADD CONSTRAINT chemical_enrichment_cache_pkey PRIMARY KEY (id);


--
-- Name: chemical_enrichment_leases chemical_enrichment_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_enrichment_leases
    ADD CONSTRAINT chemical_enrichment_leases_pkey PRIMARY KEY (lease_key, result_version);


--
-- Name: chemical_source_cache chemical_source_cache_lookup_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_source_cache
    ADD CONSTRAINT chemical_source_cache_lookup_unique UNIQUE (source, record_type, lookup_key, result_version);


--
-- Name: chemical_source_cache chemical_source_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chemical_source_cache
    ADD CONSTRAINT chemical_source_cache_pkey PRIMARY KEY (id);


--
-- Name: commerce_intent_events commerce_intent_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commerce_intent_events
    ADD CONSTRAINT commerce_intent_events_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: ghs_cas_cache ghs_cas_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghs_cas_cache
    ADD CONSTRAINT ghs_cas_cache_pkey PRIMARY KEY (id);


--
-- Name: ghs_cas_cache ghs_cas_cache_scope_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghs_cas_cache
    ADD CONSTRAINT ghs_cas_cache_scope_unique UNIQUE (scope_type, scope_id, cas_number);


--
-- Name: global_reagent_aliases global_reagent_aliases_normalized_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_reagent_aliases
    ADD CONSTRAINT global_reagent_aliases_normalized_alias_key UNIQUE (normalized_alias);


--
-- Name: global_reagent_aliases global_reagent_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_reagent_aliases
    ADD CONSTRAINT global_reagent_aliases_pkey PRIMARY KEY (id);


--
-- Name: global_reagent_aliases global_reagent_aliases_source_review_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_reagent_aliases
    ADD CONSTRAINT global_reagent_aliases_source_review_id_key UNIQUE (source_review_id);


--
-- Name: inventory_move_receipts inventory_move_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_move_receipts
    ADD CONSTRAINT inventory_move_receipts_pkey PRIMARY KEY (request_id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);


--
-- Name: inventory_usage_completion_receipts inventory_usage_completion_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_usage_completion_receipts
    ADD CONSTRAINT inventory_usage_completion_receipts_pkey PRIMARY KEY (request_id);


--
-- Name: lab_members lab_members_lab_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_members
    ADD CONSTRAINT lab_members_lab_id_user_id_key UNIQUE (lab_id, user_id);


--
-- Name: lab_members lab_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_members
    ADD CONSTRAINT lab_members_pkey PRIMARY KEY (id);


--
-- Name: labs labs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs
    ADD CONSTRAINT labs_pkey PRIMARY KEY (id);


--
-- Name: products media_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT media_products_pkey PRIMARY KEY (id);


--
-- Name: products media_products_url_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT media_products_url_slug_key UNIQUE (url_slug);


--
-- Name: onboarding_events onboarding_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_events
    ADD CONSTRAINT onboarding_events_pkey PRIMARY KEY (id);


--
-- Name: reagent_aliases reagent_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reagent_aliases
    ADD CONSTRAINT reagent_aliases_pkey PRIMARY KEY (id);


--
-- Name: safety_center_exports safety_center_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_exports
    ADD CONSTRAINT safety_center_exports_pkey PRIMARY KEY (id);


--
-- Name: safety_center_lab_links safety_center_lab_links_center_id_lab_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_lab_links
    ADD CONSTRAINT safety_center_lab_links_center_id_lab_id_key UNIQUE (center_id, lab_id);


--
-- Name: safety_center_lab_links safety_center_lab_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_lab_links
    ADD CONSTRAINT safety_center_lab_links_pkey PRIMARY KEY (id);


--
-- Name: safety_center_members safety_center_members_center_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_members
    ADD CONSTRAINT safety_center_members_center_id_user_id_key UNIQUE (center_id, user_id);


--
-- Name: safety_center_members safety_center_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_members
    ADD CONSTRAINT safety_center_members_pkey PRIMARY KEY (id);


--
-- Name: safety_center_request_events safety_center_request_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_request_events
    ADD CONSTRAINT safety_center_request_events_pkey PRIMARY KEY (id);


--
-- Name: safety_center_requests safety_center_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_requests
    ADD CONSTRAINT safety_center_requests_pkey PRIMARY KEY (id);


--
-- Name: safety_centers safety_centers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_centers
    ADD CONSTRAINT safety_centers_pkey PRIMARY KEY (id);


--
-- Name: safety_compliance_events safety_compliance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_compliance_events
    ADD CONSTRAINT safety_compliance_events_pkey PRIMARY KEY (id);


--
-- Name: search_analytics_actions search_analytics_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_analytics_actions
    ADD CONSTRAINT search_analytics_actions_pkey PRIMARY KEY (id);


--
-- Name: search_analytics_events search_analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_analytics_events
    ADD CONSTRAINT search_analytics_events_pkey PRIMARY KEY (id);


--
-- Name: search_analytics_events search_analytics_events_source_history_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_analytics_events
    ADD CONSTRAINT search_analytics_events_source_history_id_key UNIQUE (source_history_id);


--
-- Name: search_analytics_guest_subjects search_analytics_guest_subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_analytics_guest_subjects
    ADD CONSTRAINT search_analytics_guest_subjects_pkey PRIMARY KEY (id);


--
-- Name: storage_locations storage_locations_lab_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_lab_name_unique UNIQUE (lab_id, name);


--
-- Name: storage_locations storage_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_pkey PRIMARY KEY (id);


--
-- Name: user_search_history user_search_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_search_history
    ADD CONSTRAINT user_search_history_pkey PRIMARY KEY (id);


--
-- Name: voice_query_feedback voice_query_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_query_feedback
    ADD CONSTRAINT voice_query_feedback_pkey PRIMARY KEY (id);


--
-- Name: waste_log_items waste_log_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_log_items
    ADD CONSTRAINT waste_log_items_pkey PRIMARY KEY (id);


--
-- Name: waste_log_items waste_log_items_waste_log_id_cart_line_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_log_items
    ADD CONSTRAINT waste_log_items_waste_log_id_cart_line_id_key UNIQUE (waste_log_id, cart_line_id);


--
-- Name: waste_log_items waste_log_items_waste_log_id_line_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_log_items
    ADD CONSTRAINT waste_log_items_waste_log_id_line_number_key UNIQUE (waste_log_id, line_number);


--
-- Name: waste_logs waste_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_logs
    ADD CONSTRAINT waste_logs_pkey PRIMARY KEY (id);


--
-- Name: waste_ph_prediction_authorizations waste_ph_prediction_authorizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_ph_prediction_authorizations
    ADD CONSTRAINT waste_ph_prediction_authorizations_pkey PRIMARY KEY (id);


--
-- Name: waste_policy_lab_overrides waste_policy_lab_overrides_lab_id_stream_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_lab_overrides
    ADD CONSTRAINT waste_policy_lab_overrides_lab_id_stream_code_key UNIQUE (lab_id, stream_code);


--
-- Name: waste_policy_lab_overrides waste_policy_lab_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_lab_overrides
    ADD CONSTRAINT waste_policy_lab_overrides_pkey PRIMARY KEY (id);


--
-- Name: waste_policy_streams waste_policy_streams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_streams
    ADD CONSTRAINT waste_policy_streams_pkey PRIMARY KEY (id);


--
-- Name: waste_policy_streams waste_policy_streams_policy_version_id_stream_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_streams
    ADD CONSTRAINT waste_policy_streams_policy_version_id_stream_code_key UNIQUE (policy_version_id, stream_code);


--
-- Name: waste_policy_versions waste_policy_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_versions
    ADD CONSTRAINT waste_policy_versions_pkey PRIMARY KEY (id);


--
-- Name: waste_policy_versions waste_policy_versions_policy_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_versions
    ADD CONSTRAINT waste_policy_versions_policy_key_key UNIQUE (policy_key);


--
-- Name: waste_stream_catalog waste_stream_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_stream_catalog
    ADD CONSTRAINT waste_stream_catalog_pkey PRIMARY KEY (code);


--
-- Name: analytics_commercialization_activator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_commercialization_activator_idx ON public.analytics_commercialization_settings USING btree (activated_by) WHERE (activated_by IS NOT NULL);


--
-- Name: analytics_deletion_audits_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_deletion_audits_created_idx ON public.analytics_deletion_audits USING btree (created_at DESC, id DESC);


--
-- Name: analytics_export_audits_operator_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_export_audits_operator_created_idx ON public.analytics_export_audits USING btree (operator_user_id, created_at DESC) WHERE (operator_user_id IS NOT NULL);


--
-- Name: analytics_review_audit_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_review_audit_candidate_idx ON public.analytics_review_audit_logs USING btree (candidate_id, created_at DESC);


--
-- Name: analytics_review_audit_operator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_review_audit_operator_idx ON public.analytics_review_audit_logs USING btree (operator_user_id, created_at DESC) WHERE (operator_user_id IS NOT NULL);


--
-- Name: analytics_review_candidates_pending_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX analytics_review_candidates_pending_key_idx ON public.analytics_review_candidates USING btree (candidate_type, source_key) WHERE (status = 'pending'::text);


--
-- Name: analytics_review_candidates_reviewer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_review_candidates_reviewer_idx ON public.analytics_review_candidates USING btree (reviewed_by) WHERE (reviewed_by IS NOT NULL);


--
-- Name: analytics_review_candidates_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_review_candidates_status_created_idx ON public.analytics_review_candidates USING btree (status, created_at DESC, id DESC);


--
-- Name: cabinet_activity_logs_performed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cabinet_activity_logs_performed_by_idx ON public.cabinet_activity_logs USING btree (performed_by);


--
-- Name: cabinet_disposal_logs_cabinet_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cabinet_disposal_logs_cabinet_id_idx ON public.cabinet_disposal_logs USING btree (cabinet_id);


--
-- Name: cabinet_disposal_logs_disposed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cabinet_disposal_logs_disposed_by_idx ON public.cabinet_disposal_logs USING btree (disposed_by);


--
-- Name: cabinet_items_cabinet_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cabinet_items_cabinet_id_idx ON public.cabinet_items USING btree (cabinet_id);


--
-- Name: cabinet_items_inventory_item_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cabinet_items_inventory_item_id_unique ON public.cabinet_items USING btree (inventory_item_id) WHERE (inventory_item_id IS NOT NULL);


--
-- Name: cabinet_items_shelf_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cabinet_items_shelf_id_idx ON public.cabinet_items USING btree (shelf_id);


--
-- Name: cabinet_shelves_cabinet_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cabinet_shelves_cabinet_id_idx ON public.cabinet_shelves USING btree (cabinet_id);


--
-- Name: cabinets_lab_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cabinets_lab_id_idx ON public.cabinets USING btree (lab_id);


--
-- Name: cabinets_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cabinets_user_id_idx ON public.cabinets USING btree (user_id);


--
-- Name: chemical_enrichment_cache_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chemical_enrichment_cache_expiry_idx ON public.chemical_enrichment_cache USING btree (expires_at);


--
-- Name: chemical_enrichment_cache_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chemical_enrichment_cache_identity_idx ON public.chemical_enrichment_cache USING btree (canonical_identity_key, result_version);


--
-- Name: chemical_enrichment_leases_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chemical_enrichment_leases_expiry_idx ON public.chemical_enrichment_leases USING btree (lease_until);


--
-- Name: chemical_source_cache_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chemical_source_cache_expiry_idx ON public.chemical_source_cache USING btree (expires_at);


--
-- Name: commerce_intent_events_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commerce_intent_events_brand_idx ON public.commerce_intent_events USING btree (brand_normalized, created_at DESC) WHERE (brand_normalized IS NOT NULL);


--
-- Name: commerce_intent_events_capacity_ml_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commerce_intent_events_capacity_ml_idx ON public.commerce_intent_events USING btree (capacity_ml, created_at DESC) WHERE (capacity_ml IS NOT NULL);


--
-- Name: commerce_intent_events_cas_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commerce_intent_events_cas_idx ON public.commerce_intent_events USING btree (cas_number_normalized, created_at DESC) WHERE (cas_number_normalized IS NOT NULL);


--
-- Name: commerce_intent_events_lab_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commerce_intent_events_lab_created_at_idx ON public.commerce_intent_events USING btree (lab_id, created_at DESC);


--
-- Name: commerce_intent_events_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commerce_intent_events_product_idx ON public.commerce_intent_events USING btree (product_id, created_at DESC) WHERE (product_id IS NOT NULL);


--
-- Name: commerce_intent_events_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commerce_intent_events_type_created_at_idx ON public.commerce_intent_events USING btree (event_type, created_at DESC);


--
-- Name: commerce_intent_events_user_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commerce_intent_events_user_created_at_idx ON public.commerce_intent_events USING btree (user_id, created_at DESC);


--
-- Name: feedback_created_at_desc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_created_at_desc_idx ON public.feedback USING btree (created_at DESC);


--
-- Name: feedback_resolved_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_resolved_by_idx ON public.feedback USING btree (resolved_by);


--
-- Name: feedback_status_created_at_desc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_status_created_at_desc_idx ON public.feedback USING btree (status, created_at DESC);


--
-- Name: feedback_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_user_id_idx ON public.feedback USING btree (user_id);


--
-- Name: ghs_cas_cache_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghs_cas_cache_created_by_idx ON public.ghs_cas_cache USING btree (created_by);


--
-- Name: ghs_cas_cache_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghs_cas_cache_expires_at_idx ON public.ghs_cas_cache USING btree (expires_at);


--
-- Name: ghs_cas_cache_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghs_cas_cache_lookup_idx ON public.ghs_cas_cache USING btree (scope_type, scope_id, cas_number);


--
-- Name: ghs_cas_cache_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghs_cas_cache_updated_at_idx ON public.ghs_cas_cache USING btree (updated_at DESC);


--
-- Name: ghs_cas_cache_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghs_cas_cache_updated_by_idx ON public.ghs_cas_cache USING btree (updated_by);


--
-- Name: global_reagent_aliases_active_normalized_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX global_reagent_aliases_active_normalized_idx ON public.global_reagent_aliases USING btree (normalized_alias) WHERE is_active;


--
-- Name: global_reagent_aliases_approver_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX global_reagent_aliases_approver_idx ON public.global_reagent_aliases USING btree (approved_by) WHERE (approved_by IS NOT NULL);


--
-- Name: idx_audit_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_entity_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_entity_type_id ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_audit_logs_lab_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_lab_id ON public.audit_logs USING btree (lab_id);


--
-- Name: idx_cabinet_activity_logs_cabinet_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cabinet_activity_logs_cabinet_id ON public.cabinet_activity_logs USING btree (cabinet_id, performed_at DESC);


--
-- Name: idx_inventory_cabinet_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_cabinet_id ON public.inventory USING btree (cabinet_id);


--
-- Name: idx_inventory_lab_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_lab_id ON public.inventory USING btree (lab_id);


--
-- Name: idx_inventory_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_name ON public.inventory USING btree (name);


--
-- Name: idx_user_search_history_searched_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_search_history_searched_at ON public.user_search_history USING btree (searched_at DESC);


--
-- Name: idx_user_search_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_search_history_user_id ON public.user_search_history USING btree (user_id);


--
-- Name: inventory_move_receipts_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_move_receipts_actor_idx ON public.inventory_move_receipts USING btree (actor_user_id, created_at DESC);


--
-- Name: inventory_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_product_id_idx ON public.inventory USING btree (product_id);


--
-- Name: inventory_storage_location_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_storage_location_id_idx ON public.inventory USING btree (storage_location_id);


--
-- Name: inventory_usage_completion_receipts_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_usage_completion_receipts_actor_idx ON public.inventory_usage_completion_receipts USING btree (actor_user_id, created_at DESC);


--
-- Name: inventory_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_user_id_idx ON public.inventory USING btree (user_id);


--
-- Name: lab_members_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lab_members_user_id_idx ON public.lab_members USING btree (user_id);


--
-- Name: labs_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX labs_created_by_idx ON public.labs USING btree (created_by);


--
-- Name: labs_institution_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX labs_institution_name_idx ON public.labs USING btree (lower(institution_name)) WHERE (institution_name IS NOT NULL);


--
-- Name: onboarding_events_lab_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_events_lab_created_at_idx ON public.onboarding_events USING btree (lab_id, created_at DESC) WHERE (lab_id IS NOT NULL);


--
-- Name: onboarding_events_step_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_events_step_created_at_idx ON public.onboarding_events USING btree (step_key, created_at DESC) WHERE (step_key IS NOT NULL);


--
-- Name: onboarding_events_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_events_type_created_at_idx ON public.onboarding_events USING btree (event_type, created_at DESC);


--
-- Name: onboarding_events_user_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_events_user_created_at_idx ON public.onboarding_events USING btree (user_id, created_at DESC);


--
-- Name: reagent_aliases_lab_alias_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reagent_aliases_lab_alias_idx ON public.reagent_aliases USING btree (lab_id, normalized_alias);


--
-- Name: reagent_aliases_source_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reagent_aliases_source_item_idx ON public.reagent_aliases USING btree (source_item_type, source_item_id);


--
-- Name: reagent_aliases_unique_source_alias_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reagent_aliases_unique_source_alias_idx ON public.reagent_aliases USING btree (source_item_type, source_item_id, normalized_alias);


--
-- Name: reagent_aliases_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reagent_aliases_user_id_idx ON public.reagent_aliases USING btree (user_id);


--
-- Name: safety_center_exports_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_exports_center_idx ON public.safety_center_exports USING btree (center_id, created_at DESC);


--
-- Name: safety_center_exports_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_exports_user_id_idx ON public.safety_center_exports USING btree (user_id);


--
-- Name: safety_center_lab_links_approved_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_lab_links_approved_by_idx ON public.safety_center_lab_links USING btree (approved_by);


--
-- Name: safety_center_lab_links_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_lab_links_center_idx ON public.safety_center_lab_links USING btree (center_id, status);


--
-- Name: safety_center_lab_links_lab_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_lab_links_lab_idx ON public.safety_center_lab_links USING btree (lab_id, status);


--
-- Name: safety_center_lab_links_requested_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_lab_links_requested_by_idx ON public.safety_center_lab_links USING btree (requested_by);


--
-- Name: safety_center_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_members_user_idx ON public.safety_center_members USING btree (user_id, center_id);


--
-- Name: safety_center_request_events_actor_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_request_events_actor_user_id_idx ON public.safety_center_request_events USING btree (actor_user_id);


--
-- Name: safety_center_request_events_request_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_request_events_request_id_idx ON public.safety_center_request_events USING btree (request_id);


--
-- Name: safety_center_requests_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_requests_center_idx ON public.safety_center_requests USING btree (center_id, status, created_at DESC);


--
-- Name: safety_center_requests_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_requests_created_by_idx ON public.safety_center_requests USING btree (created_by);


--
-- Name: safety_center_requests_lab_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_center_requests_lab_idx ON public.safety_center_requests USING btree (lab_id, status, created_at DESC);


--
-- Name: safety_centers_approved_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_centers_approved_by_idx ON public.safety_centers USING btree (approved_by);


--
-- Name: safety_centers_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_centers_created_by_idx ON public.safety_centers USING btree (created_by);


--
-- Name: safety_compliance_events_cabinet_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_compliance_events_cabinet_created_at_idx ON public.safety_compliance_events USING btree (cabinet_id, created_at DESC) WHERE (cabinet_id IS NOT NULL);


--
-- Name: safety_compliance_events_lab_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_compliance_events_lab_created_at_idx ON public.safety_compliance_events USING btree (lab_id, created_at DESC);


--
-- Name: safety_compliance_events_primary_cas_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_compliance_events_primary_cas_idx ON public.safety_compliance_events USING btree (primary_cas_number_normalized, created_at DESC) WHERE (primary_cas_number_normalized IS NOT NULL);


--
-- Name: safety_compliance_events_primary_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_compliance_events_primary_name_idx ON public.safety_compliance_events USING btree (primary_chemical_name_normalized, created_at DESC) WHERE (primary_chemical_name_normalized IS NOT NULL);


--
-- Name: safety_compliance_events_rule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_compliance_events_rule_idx ON public.safety_compliance_events USING btree (rule_id, created_at DESC) WHERE (rule_id IS NOT NULL);


--
-- Name: safety_compliance_events_shelf_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_compliance_events_shelf_id_idx ON public.safety_compliance_events USING btree (shelf_id);


--
-- Name: safety_compliance_events_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_compliance_events_type_created_at_idx ON public.safety_compliance_events USING btree (event_type, created_at DESC);


--
-- Name: safety_compliance_events_user_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safety_compliance_events_user_created_at_idx ON public.safety_compliance_events USING btree (user_id, created_at DESC);


--
-- Name: search_analytics_actions_event_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_actions_event_created_idx ON public.search_analytics_actions USING btree (event_id, created_at, id);


--
-- Name: search_analytics_actions_related_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_actions_related_event_idx ON public.search_analytics_actions USING btree (related_event_id) WHERE (related_event_id IS NOT NULL);


--
-- Name: search_analytics_actions_type_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_actions_type_created_idx ON public.search_analytics_actions USING btree (action_type, created_at DESC, id DESC);


--
-- Name: search_analytics_events_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_events_created_idx ON public.search_analytics_events USING btree (created_at DESC, id DESC);


--
-- Name: search_analytics_events_guest_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_events_guest_created_idx ON public.search_analytics_events USING btree (guest_subject_id, created_at DESC, id DESC) WHERE (guest_subject_id IS NOT NULL);


--
-- Name: search_analytics_events_guest_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_events_guest_expiry_idx ON public.search_analytics_events USING btree (created_at, id) WHERE (guest_subject_id IS NOT NULL);


--
-- Name: search_analytics_events_lab_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_events_lab_created_idx ON public.search_analytics_events USING btree (lab_id, created_at DESC, id DESC) WHERE (lab_id IS NOT NULL);


--
-- Name: search_analytics_events_outcome_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_events_outcome_created_idx ON public.search_analytics_events USING btree (outcome, created_at DESC, id DESC);


--
-- Name: search_analytics_events_previous_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_events_previous_event_idx ON public.search_analytics_events USING btree (previous_event_id) WHERE (previous_event_id IS NOT NULL);


--
-- Name: search_analytics_events_query_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_events_query_created_idx ON public.search_analytics_events USING btree (query_normalized, created_at DESC, id DESC);


--
-- Name: search_analytics_events_session_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_events_session_created_idx ON public.search_analytics_events USING btree (session_id, created_at, id);


--
-- Name: search_analytics_events_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_analytics_events_user_created_idx ON public.search_analytics_events USING btree (user_id, created_at DESC, id DESC) WHERE (user_id IS NOT NULL);


--
-- Name: storage_locations_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX storage_locations_user_id_idx ON public.storage_locations USING btree (user_id);


--
-- Name: voice_query_feedback_lab_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voice_query_feedback_lab_created_at_idx ON public.voice_query_feedback USING btree (lab_id, created_at DESC);


--
-- Name: voice_query_feedback_user_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voice_query_feedback_user_created_at_idx ON public.voice_query_feedback USING btree (user_id, created_at DESC);


--
-- Name: waste_log_items_inventory_item_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_log_items_inventory_item_id_idx ON public.waste_log_items USING btree (inventory_item_id) WHERE (inventory_item_id IS NOT NULL);


--
-- Name: waste_log_items_source_search_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_log_items_source_search_event_idx ON public.waste_log_items USING btree (source_search_event_id) WHERE (source_search_event_id IS NOT NULL);


--
-- Name: waste_log_items_waste_log_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_log_items_waste_log_id_idx ON public.waste_log_items USING btree (waste_log_id, line_number);


--
-- Name: waste_logs_analytics_eligible_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_logs_analytics_eligible_idx ON public.waste_logs USING btree (created_at DESC, id DESC) WHERE ((schema_version = 2) AND (voided_at IS NULL));


--
-- Name: waste_logs_decision_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_logs_decision_status_idx ON public.waste_logs USING btree (decision_status, created_at DESC);


--
-- Name: waste_logs_lab_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_logs_lab_id_idx ON public.waste_logs USING btree (lab_id);


--
-- Name: waste_logs_stream_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_logs_stream_code_idx ON public.waste_logs USING btree (stream_code, created_at DESC) WHERE (stream_code IS NOT NULL);


--
-- Name: waste_logs_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_logs_user_id_idx ON public.waste_logs USING btree (user_id);


--
-- Name: waste_logs_user_request_id_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX waste_logs_user_request_id_uidx ON public.waste_logs USING btree (user_id, request_id) WHERE (request_id IS NOT NULL);


--
-- Name: waste_ph_prediction_authorizations_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_ph_prediction_authorizations_active_idx ON public.waste_ph_prediction_authorizations USING btree (user_id, expires_at) WHERE (used_at IS NULL);


--
-- Name: waste_policy_lab_overrides_lab_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_policy_lab_overrides_lab_idx ON public.waste_policy_lab_overrides USING btree (lab_id, stream_code);


--
-- Name: waste_policy_streams_stream_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_policy_streams_stream_code_idx ON public.waste_policy_streams USING btree (stream_code, policy_version_id);


--
-- Name: waste_policy_versions_active_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX waste_policy_versions_active_center_idx ON public.waste_policy_versions USING btree (safety_center_id) WHERE ((scope_type = 'safety_center'::text) AND (status = 'active'::text));


--
-- Name: waste_policy_versions_active_lab_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX waste_policy_versions_active_lab_idx ON public.waste_policy_versions USING btree (lab_id) WHERE ((scope_type = 'lab'::text) AND (status = 'active'::text));


--
-- Name: waste_policy_versions_active_system_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX waste_policy_versions_active_system_idx ON public.waste_policy_versions USING btree (scope_type) WHERE ((scope_type = 'system'::text) AND (status = 'active'::text));


--
-- Name: waste_policy_versions_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waste_policy_versions_parent_idx ON public.waste_policy_versions USING btree (parent_policy_version_id);


--
-- Name: waste_log_items capture_ph_prediction_audit_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER capture_ph_prediction_audit_v1 BEFORE INSERT ON public.waste_log_items FOR EACH ROW EXECUTE FUNCTION private.capture_ph_prediction_audit_v1();


--
-- Name: chemical_enrichment_cache chemical_enrichment_cache_before_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER chemical_enrichment_cache_before_update BEFORE UPDATE ON public.chemical_enrichment_cache FOR EACH ROW EXECUTE FUNCTION public.chemical_enrichment_cache_set_updated_at();


--
-- Name: commerce_intent_events commerce_intent_events_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER commerce_intent_events_before_write BEFORE INSERT OR UPDATE ON public.commerce_intent_events FOR EACH ROW EXECUTE FUNCTION public.commerce_intent_events_set_normalized_fields();


--
-- Name: labs enforce_lab_creation_membership_limit_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_lab_creation_membership_limit_before_insert BEFORE INSERT ON public.labs FOR EACH ROW EXECUTE FUNCTION public.enforce_lab_creation_membership_limit();


--
-- Name: lab_members enforce_lab_membership_limit_before_insert_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_lab_membership_limit_before_insert_update BEFORE INSERT OR UPDATE OF user_id ON public.lab_members FOR EACH ROW EXECUTE FUNCTION public.enforce_lab_membership_limit();


--
-- Name: ghs_cas_cache ghs_cas_cache_before_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ghs_cas_cache_before_update BEFORE UPDATE ON public.ghs_cas_cache FOR EACH ROW EXECUTE FUNCTION public.ghs_cas_cache_set_updated_at();


--
-- Name: labs normalize_lab_join_password_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER normalize_lab_join_password_before_write BEFORE INSERT OR UPDATE ON public.labs FOR EACH ROW EXECUTE FUNCTION public.normalize_lab_join_password();


--
-- Name: safety_center_lab_links safety_center_lab_links_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER safety_center_lab_links_set_updated_at BEFORE UPDATE ON public.safety_center_lab_links FOR EACH ROW EXECUTE FUNCTION public.safety_center_set_updated_at();


--
-- Name: safety_center_requests safety_center_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER safety_center_requests_set_updated_at BEFORE UPDATE ON public.safety_center_requests FOR EACH ROW EXECUTE FUNCTION public.safety_center_set_updated_at();


--
-- Name: safety_centers safety_centers_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER safety_centers_set_updated_at BEFORE UPDATE ON public.safety_centers FOR EACH ROW EXECUTE FUNCTION public.safety_center_set_updated_at();


--
-- Name: safety_compliance_events safety_compliance_events_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER safety_compliance_events_before_write BEFORE INSERT OR UPDATE ON public.safety_compliance_events FOR EACH ROW EXECUTE FUNCTION public.safety_compliance_events_set_normalized_fields();


--
-- Name: lab_members tr_protect_lab_member_role; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tr_protect_lab_member_role BEFORE UPDATE ON public.lab_members FOR EACH ROW EXECUTE FUNCTION public.protect_lab_member_role();


--
-- Name: inventory trigger_inventory_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_inventory_updated_at BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.update_inventory_updated_at();


--
-- Name: user_search_history user_search_history_delete_analytics; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_search_history_delete_analytics BEFORE DELETE ON public.user_search_history FOR EACH ROW EXECUTE FUNCTION private.delete_search_analytics_for_history_row();


--
-- Name: waste_log_items waste_log_items_validate_search_event_link; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER waste_log_items_validate_search_event_link BEFORE INSERT ON public.waste_log_items FOR EACH ROW EXECUTE FUNCTION private.waste_log_item_validate_search_event_link();


--
-- Name: analytics_commercialization_settings analytics_commercialization_settings_activated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_commercialization_settings
    ADD CONSTRAINT analytics_commercialization_settings_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: analytics_export_audits analytics_export_audits_operator_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_export_audits
    ADD CONSTRAINT analytics_export_audits_operator_user_id_fkey FOREIGN KEY (operator_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: analytics_review_audit_logs analytics_review_audit_logs_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_review_audit_logs
    ADD CONSTRAINT analytics_review_audit_logs_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.analytics_review_candidates(id) ON DELETE CASCADE;


--
-- Name: analytics_review_audit_logs analytics_review_audit_logs_operator_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_review_audit_logs
    ADD CONSTRAINT analytics_review_audit_logs_operator_user_id_fkey FOREIGN KEY (operator_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: analytics_review_candidates analytics_review_candidates_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_review_candidates
    ADD CONSTRAINT analytics_review_candidates_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: cabinet_activity_logs cabinet_activity_logs_cabinet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_activity_logs
    ADD CONSTRAINT cabinet_activity_logs_cabinet_id_fkey FOREIGN KEY (cabinet_id) REFERENCES public.cabinets(id) ON DELETE CASCADE;


--
-- Name: cabinet_activity_logs cabinet_activity_logs_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_activity_logs
    ADD CONSTRAINT cabinet_activity_logs_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: cabinet_disposal_logs cabinet_disposal_logs_cabinet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_disposal_logs
    ADD CONSTRAINT cabinet_disposal_logs_cabinet_id_fkey FOREIGN KEY (cabinet_id) REFERENCES public.cabinets(id) ON DELETE CASCADE;


--
-- Name: cabinet_disposal_logs cabinet_disposal_logs_disposed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_disposal_logs
    ADD CONSTRAINT cabinet_disposal_logs_disposed_by_fkey FOREIGN KEY (disposed_by) REFERENCES auth.users(id);


--
-- Name: cabinet_items cabinet_items_cabinet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_items
    ADD CONSTRAINT cabinet_items_cabinet_id_fkey FOREIGN KEY (cabinet_id) REFERENCES public.cabinets(id) ON DELETE CASCADE;


--
-- Name: cabinet_items cabinet_items_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_items
    ADD CONSTRAINT cabinet_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory(id) ON DELETE SET NULL;


--
-- Name: cabinet_items cabinet_items_shelf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_items
    ADD CONSTRAINT cabinet_items_shelf_id_fkey FOREIGN KEY (shelf_id) REFERENCES public.cabinet_shelves(id) ON DELETE CASCADE;


--
-- Name: cabinet_shelves cabinet_shelves_cabinet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinet_shelves
    ADD CONSTRAINT cabinet_shelves_cabinet_id_fkey FOREIGN KEY (cabinet_id) REFERENCES public.cabinets(id) ON DELETE CASCADE;


--
-- Name: cabinets cabinets_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinets
    ADD CONSTRAINT cabinets_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE CASCADE;


--
-- Name: cabinets cabinets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cabinets
    ADD CONSTRAINT cabinets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: commerce_intent_events commerce_intent_events_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commerce_intent_events
    ADD CONSTRAINT commerce_intent_events_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE SET NULL;


--
-- Name: commerce_intent_events commerce_intent_events_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commerce_intent_events
    ADD CONSTRAINT commerce_intent_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: commerce_intent_events commerce_intent_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commerce_intent_events
    ADD CONSTRAINT commerce_intent_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: feedback feedback_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: feedback feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ghs_cas_cache ghs_cas_cache_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghs_cas_cache
    ADD CONSTRAINT ghs_cas_cache_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ghs_cas_cache ghs_cas_cache_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghs_cas_cache
    ADD CONSTRAINT ghs_cas_cache_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: global_reagent_aliases global_reagent_aliases_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_reagent_aliases
    ADD CONSTRAINT global_reagent_aliases_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: global_reagent_aliases global_reagent_aliases_source_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_reagent_aliases
    ADD CONSTRAINT global_reagent_aliases_source_review_id_fkey FOREIGN KEY (source_review_id) REFERENCES public.analytics_review_candidates(id) ON DELETE SET NULL;


--
-- Name: inventory inventory_cabinet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_cabinet_id_fkey FOREIGN KEY (cabinet_id) REFERENCES public.cabinets(id) ON DELETE SET NULL;


--
-- Name: inventory inventory_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE CASCADE;


--
-- Name: inventory inventory_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: inventory inventory_storage_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_storage_location_id_fkey FOREIGN KEY (storage_location_id) REFERENCES public.storage_locations(id) ON DELETE SET NULL;


--
-- Name: inventory inventory_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: lab_members lab_members_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_members
    ADD CONSTRAINT lab_members_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE CASCADE;


--
-- Name: lab_members lab_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_members
    ADD CONSTRAINT lab_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: labs labs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs
    ADD CONSTRAINT labs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: onboarding_events onboarding_events_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_events
    ADD CONSTRAINT onboarding_events_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE SET NULL;


--
-- Name: onboarding_events onboarding_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_events
    ADD CONSTRAINT onboarding_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reagent_aliases reagent_aliases_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reagent_aliases
    ADD CONSTRAINT reagent_aliases_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE SET NULL;


--
-- Name: reagent_aliases reagent_aliases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reagent_aliases
    ADD CONSTRAINT reagent_aliases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: safety_center_exports safety_center_exports_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_exports
    ADD CONSTRAINT safety_center_exports_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.safety_centers(id) ON DELETE CASCADE;


--
-- Name: safety_center_exports safety_center_exports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_exports
    ADD CONSTRAINT safety_center_exports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: safety_center_lab_links safety_center_lab_links_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_lab_links
    ADD CONSTRAINT safety_center_lab_links_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: safety_center_lab_links safety_center_lab_links_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_lab_links
    ADD CONSTRAINT safety_center_lab_links_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.safety_centers(id) ON DELETE CASCADE;


--
-- Name: safety_center_lab_links safety_center_lab_links_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_lab_links
    ADD CONSTRAINT safety_center_lab_links_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE CASCADE;


--
-- Name: safety_center_lab_links safety_center_lab_links_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_lab_links
    ADD CONSTRAINT safety_center_lab_links_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: safety_center_members safety_center_members_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_members
    ADD CONSTRAINT safety_center_members_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.safety_centers(id) ON DELETE CASCADE;


--
-- Name: safety_center_members safety_center_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_members
    ADD CONSTRAINT safety_center_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: safety_center_request_events safety_center_request_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_request_events
    ADD CONSTRAINT safety_center_request_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: safety_center_request_events safety_center_request_events_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_request_events
    ADD CONSTRAINT safety_center_request_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.safety_center_requests(id) ON DELETE CASCADE;


--
-- Name: safety_center_requests safety_center_requests_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_requests
    ADD CONSTRAINT safety_center_requests_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.safety_centers(id) ON DELETE CASCADE;


--
-- Name: safety_center_requests safety_center_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_requests
    ADD CONSTRAINT safety_center_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: safety_center_requests safety_center_requests_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_center_requests
    ADD CONSTRAINT safety_center_requests_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE CASCADE;


--
-- Name: safety_centers safety_centers_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_centers
    ADD CONSTRAINT safety_centers_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: safety_centers safety_centers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_centers
    ADD CONSTRAINT safety_centers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: safety_compliance_events safety_compliance_events_cabinet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_compliance_events
    ADD CONSTRAINT safety_compliance_events_cabinet_id_fkey FOREIGN KEY (cabinet_id) REFERENCES public.cabinets(id) ON DELETE SET NULL;


--
-- Name: safety_compliance_events safety_compliance_events_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_compliance_events
    ADD CONSTRAINT safety_compliance_events_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE SET NULL;


--
-- Name: safety_compliance_events safety_compliance_events_shelf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_compliance_events
    ADD CONSTRAINT safety_compliance_events_shelf_id_fkey FOREIGN KEY (shelf_id) REFERENCES public.cabinet_shelves(id) ON DELETE SET NULL;


--
-- Name: safety_compliance_events safety_compliance_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_compliance_events
    ADD CONSTRAINT safety_compliance_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: search_analytics_actions search_analytics_actions_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_analytics_actions
    ADD CONSTRAINT search_analytics_actions_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.search_analytics_events(id) ON DELETE CASCADE;


--
-- Name: search_analytics_actions search_analytics_actions_related_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_analytics_actions
    ADD CONSTRAINT search_analytics_actions_related_event_id_fkey FOREIGN KEY (related_event_id) REFERENCES public.search_analytics_events(id) ON DELETE SET NULL;


--
-- Name: search_analytics_events search_analytics_events_guest_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_analytics_events
    ADD CONSTRAINT search_analytics_events_guest_subject_id_fkey FOREIGN KEY (guest_subject_id) REFERENCES public.search_analytics_guest_subjects(id) ON DELETE CASCADE;


--
-- Name: search_analytics_events search_analytics_events_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_analytics_events
    ADD CONSTRAINT search_analytics_events_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE SET NULL;


--
-- Name: search_analytics_events search_analytics_events_previous_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_analytics_events
    ADD CONSTRAINT search_analytics_events_previous_event_id_fkey FOREIGN KEY (previous_event_id) REFERENCES public.search_analytics_events(id) ON DELETE SET NULL;


--
-- Name: search_analytics_events search_analytics_events_source_history_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_analytics_events
    ADD CONSTRAINT search_analytics_events_source_history_id_fkey FOREIGN KEY (source_history_id) REFERENCES public.user_search_history(id) ON DELETE CASCADE;


--
-- Name: search_analytics_events search_analytics_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_analytics_events
    ADD CONSTRAINT search_analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: storage_locations storage_locations_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE CASCADE;


--
-- Name: storage_locations storage_locations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: user_search_history user_search_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_search_history
    ADD CONSTRAINT user_search_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: voice_query_feedback voice_query_feedback_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_query_feedback
    ADD CONSTRAINT voice_query_feedback_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE SET NULL;


--
-- Name: voice_query_feedback voice_query_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_query_feedback
    ADD CONSTRAINT voice_query_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: waste_log_items waste_log_items_cabinet_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_log_items
    ADD CONSTRAINT waste_log_items_cabinet_item_id_fkey FOREIGN KEY (cabinet_item_id) REFERENCES public.cabinet_items(id) ON DELETE SET NULL;


--
-- Name: waste_log_items waste_log_items_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_log_items
    ADD CONSTRAINT waste_log_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory(id) ON DELETE SET NULL;


--
-- Name: waste_log_items waste_log_items_source_search_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_log_items
    ADD CONSTRAINT waste_log_items_source_search_event_id_fkey FOREIGN KEY (source_search_event_id) REFERENCES public.search_analytics_events(id) ON DELETE SET NULL;


--
-- Name: waste_log_items waste_log_items_waste_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_log_items
    ADD CONSTRAINT waste_log_items_waste_log_id_fkey FOREIGN KEY (waste_log_id) REFERENCES public.waste_logs(id) ON DELETE CASCADE;


--
-- Name: waste_logs waste_logs_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_logs
    ADD CONSTRAINT waste_logs_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE CASCADE;


--
-- Name: waste_logs waste_logs_policy_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_logs
    ADD CONSTRAINT waste_logs_policy_version_id_fkey FOREIGN KEY (policy_version_id) REFERENCES public.waste_policy_versions(id) ON DELETE RESTRICT;


--
-- Name: waste_logs waste_logs_stream_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_logs
    ADD CONSTRAINT waste_logs_stream_code_fkey FOREIGN KEY (stream_code) REFERENCES public.waste_stream_catalog(code) ON DELETE RESTRICT;


--
-- Name: waste_logs waste_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_logs
    ADD CONSTRAINT waste_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: waste_logs waste_logs_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_logs
    ADD CONSTRAINT waste_logs_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: waste_ph_prediction_authorizations waste_ph_prediction_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_ph_prediction_authorizations
    ADD CONSTRAINT waste_ph_prediction_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: waste_policy_lab_overrides waste_policy_lab_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_lab_overrides
    ADD CONSTRAINT waste_policy_lab_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: waste_policy_lab_overrides waste_policy_lab_overrides_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_lab_overrides
    ADD CONSTRAINT waste_policy_lab_overrides_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE CASCADE;


--
-- Name: waste_policy_lab_overrides waste_policy_lab_overrides_stream_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_lab_overrides
    ADD CONSTRAINT waste_policy_lab_overrides_stream_code_fkey FOREIGN KEY (stream_code) REFERENCES public.waste_stream_catalog(code) ON DELETE RESTRICT;


--
-- Name: waste_policy_lab_overrides waste_policy_lab_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_lab_overrides
    ADD CONSTRAINT waste_policy_lab_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: waste_policy_streams waste_policy_streams_policy_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_streams
    ADD CONSTRAINT waste_policy_streams_policy_version_id_fkey FOREIGN KEY (policy_version_id) REFERENCES public.waste_policy_versions(id) ON DELETE CASCADE;


--
-- Name: waste_policy_streams waste_policy_streams_stream_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_streams
    ADD CONSTRAINT waste_policy_streams_stream_code_fkey FOREIGN KEY (stream_code) REFERENCES public.waste_stream_catalog(code) ON DELETE RESTRICT;


--
-- Name: waste_policy_versions waste_policy_versions_activated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_versions
    ADD CONSTRAINT waste_policy_versions_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: waste_policy_versions waste_policy_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_versions
    ADD CONSTRAINT waste_policy_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: waste_policy_versions waste_policy_versions_lab_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_versions
    ADD CONSTRAINT waste_policy_versions_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id) ON DELETE CASCADE;


--
-- Name: waste_policy_versions waste_policy_versions_parent_policy_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_versions
    ADD CONSTRAINT waste_policy_versions_parent_policy_version_id_fkey FOREIGN KEY (parent_policy_version_id) REFERENCES public.waste_policy_versions(id) ON DELETE RESTRICT;


--
-- Name: waste_policy_versions waste_policy_versions_safety_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_policy_versions
    ADD CONSTRAINT waste_policy_versions_safety_center_id_fkey FOREIGN KEY (safety_center_id) REFERENCES public.safety_centers(id) ON DELETE CASCADE;


--
-- Name: labs Admins can delete their labs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete their labs" ON public.labs FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = labs.id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid)) AND (lab_members.role = 'admin'::text)))));


--
-- Name: labs Admins can update their labs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update their labs" ON public.labs FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = labs.id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid)) AND (lab_members.role = 'admin'::text)))));


--
-- Name: products Allow anonymous read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow anonymous read access" ON public.products FOR SELECT TO anon USING (true);


--
-- Name: products Allow authenticated read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow authenticated read access" ON public.products FOR SELECT TO authenticated USING (true);


--
-- Name: ai_api_cache Allow authenticated read access to ai_api_cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow authenticated read access to ai_api_cache" ON public.ai_api_cache FOR SELECT TO authenticated USING (true);


--
-- Name: feedback Anyone can insert feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can insert feedback" ON public.feedback FOR INSERT TO authenticated, anon WITH CHECK ((((( SELECT auth.uid() AS uid) IS NULL) AND (user_id IS NULL) AND (user_email IS NULL)) OR ((( SELECT auth.uid() AS uid) = user_id) AND ((user_email IS NULL) OR (user_email = (( SELECT auth.jwt() AS jwt) ->> 'email'::text))))));


--
-- Name: cabinet_activity_logs Lab members can insert cabinet activity logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Lab members can insert cabinet activity logs" ON public.cabinet_activity_logs FOR INSERT WITH CHECK ((cabinet_id IN ( SELECT c.id
   FROM public.cabinets c
  WHERE ((c.lab_id IN ( SELECT lm.lab_id
           FROM public.lab_members lm
          WHERE (lm.user_id = ( SELECT auth.uid() AS uid)))) OR (c.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: cabinet_activity_logs Lab members can view cabinet activity logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Lab members can view cabinet activity logs" ON public.cabinet_activity_logs FOR SELECT USING ((cabinet_id IN ( SELECT c.id
   FROM public.cabinets c
  WHERE ((c.lab_id IN ( SELECT lm.lab_id
           FROM public.lab_members lm
          WHERE (lm.user_id = ( SELECT auth.uid() AS uid)))) OR (c.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: labs Users can create labs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create labs" ON public.labs FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = created_by));


--
-- Name: lab_members Users can delete own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own membership" ON public.lab_members FOR DELETE USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_search_history Users can delete their own search history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own search history" ON public.user_search_history FOR DELETE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: audit_logs Users can insert audit_logs for their labs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert audit_logs for their labs" ON public.audit_logs FOR INSERT WITH CHECK ((lab_id IN ( SELECT lab_members.lab_id
   FROM public.lab_members
  WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: cabinet_disposal_logs Users can insert disposal logs for accessible cabinets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert disposal logs for accessible cabinets" ON public.cabinet_disposal_logs FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_disposal_logs.cabinet_id) AND ((c.user_id = ( SELECT auth.uid() AS uid)) OR (c.lab_id IN ( SELECT lab_members.lab_id
           FROM public.lab_members
          WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))))))));


--
-- Name: user_search_history Users can insert their own search history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own search history" ON public.user_search_history FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: audit_logs Users can view audit_logs for their labs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view audit_logs for their labs" ON public.audit_logs FOR SELECT USING ((lab_id IN ( SELECT lab_members.lab_id
   FROM public.lab_members
  WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: cabinet_disposal_logs Users can view disposal logs for accessible cabinets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view disposal logs for accessible cabinets" ON public.cabinet_disposal_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_disposal_logs.cabinet_id) AND ((c.user_id = ( SELECT auth.uid() AS uid)) OR (c.lab_id IN ( SELECT lab_members.lab_id
           FROM public.lab_members
          WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))))))));


--
-- Name: labs Users can view labs they are members of; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view labs they are members of" ON public.labs FOR SELECT USING (((( SELECT auth.uid() AS uid) = created_by) OR (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = labs.id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: feedback Users can view own feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own feedback" ON public.feedback FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: lab_members Users can view own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own membership" ON public.lab_members FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_search_history Users can view their own search history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own search history" ON public.user_search_history FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: ai_api_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_api_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_commercialization_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_commercialization_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_deletion_audits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_deletion_audits ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_export_audits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_export_audits ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_monthly_mixture_rollups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_monthly_mixture_rollups ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_monthly_search_rollups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_monthly_search_rollups ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_review_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_review_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_review_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_review_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: cabinet_activity_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cabinet_activity_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: cabinet_disposal_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cabinet_disposal_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: cabinet_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cabinet_items ENABLE ROW LEVEL SECURITY;

--
-- Name: cabinet_shelves; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cabinet_shelves ENABLE ROW LEVEL SECURITY;

--
-- Name: cabinets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cabinets ENABLE ROW LEVEL SECURITY;

--
-- Name: chemical_enrichment_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chemical_enrichment_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: chemical_enrichment_leases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chemical_enrichment_leases ENABLE ROW LEVEL SECURITY;

--
-- Name: chemical_source_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chemical_source_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: commerce_intent_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commerce_intent_events ENABLE ROW LEVEL SECURITY;

--
-- Name: commerce_intent_events commerce_intent_events_insert_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commerce_intent_events_insert_accessible ON public.commerce_intent_events FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = COALESCE(user_id, ( SELECT auth.uid() AS uid))) AND ((lab_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = commerce_intent_events.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid))))))));


--
-- Name: commerce_intent_events commerce_intent_events_select_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commerce_intent_events_select_accessible ON public.commerce_intent_events FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) OR ((lab_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = commerce_intent_events.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid))))))));


--
-- Name: cabinet_items consolidated_cabinet_items_delete_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinet_items_delete_access ON public.cabinet_items FOR DELETE USING (((EXISTS ( SELECT 1
   FROM (public.cabinets c
     JOIN public.lab_members lm ON ((c.lab_id = lm.lab_id)))
  WHERE ((c.id = cabinet_items.cabinet_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_items.cabinet_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: cabinet_items consolidated_cabinet_items_insert_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinet_items_insert_access ON public.cabinet_items FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM (public.cabinets c
     JOIN public.lab_members lm ON ((c.lab_id = lm.lab_id)))
  WHERE ((c.id = cabinet_items.cabinet_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_items.cabinet_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: cabinet_items consolidated_cabinet_items_select_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinet_items_select_access ON public.cabinet_items FOR SELECT USING (((EXISTS ( SELECT 1
   FROM (public.cabinets c
     JOIN public.lab_members lm ON ((c.lab_id = lm.lab_id)))
  WHERE ((c.id = cabinet_items.cabinet_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_items.cabinet_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: cabinet_items consolidated_cabinet_items_update_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinet_items_update_access ON public.cabinet_items FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM (public.cabinets c
     JOIN public.lab_members lm ON ((c.lab_id = lm.lab_id)))
  WHERE ((c.id = cabinet_items.cabinet_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_items.cabinet_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM (public.cabinets c
     JOIN public.lab_members lm ON ((c.lab_id = lm.lab_id)))
  WHERE ((c.id = cabinet_items.cabinet_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_items.cabinet_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: cabinet_shelves consolidated_cabinet_shelves_delete_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinet_shelves_delete_access ON public.cabinet_shelves FOR DELETE USING (((EXISTS ( SELECT 1
   FROM (public.cabinets c
     JOIN public.lab_members lm ON ((c.lab_id = lm.lab_id)))
  WHERE ((c.id = cabinet_shelves.cabinet_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_shelves.cabinet_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: cabinet_shelves consolidated_cabinet_shelves_insert_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinet_shelves_insert_access ON public.cabinet_shelves FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM (public.cabinets c
     JOIN public.lab_members lm ON ((c.lab_id = lm.lab_id)))
  WHERE ((c.id = cabinet_shelves.cabinet_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_shelves.cabinet_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: cabinet_shelves consolidated_cabinet_shelves_select_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinet_shelves_select_access ON public.cabinet_shelves FOR SELECT USING (((EXISTS ( SELECT 1
   FROM (public.cabinets c
     JOIN public.lab_members lm ON ((c.lab_id = lm.lab_id)))
  WHERE ((c.id = cabinet_shelves.cabinet_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_shelves.cabinet_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: cabinet_shelves consolidated_cabinet_shelves_update_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinet_shelves_update_access ON public.cabinet_shelves FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM (public.cabinets c
     JOIN public.lab_members lm ON ((c.lab_id = lm.lab_id)))
  WHERE ((c.id = cabinet_shelves.cabinet_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_shelves.cabinet_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM (public.cabinets c
     JOIN public.lab_members lm ON ((c.lab_id = lm.lab_id)))
  WHERE ((c.id = cabinet_shelves.cabinet_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.cabinets c
  WHERE ((c.id = cabinet_shelves.cabinet_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: cabinets consolidated_cabinets_delete_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinets_delete_access ON public.cabinets FOR DELETE USING ((((lab_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = cabinets.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid)))))) OR (( SELECT auth.uid() AS uid) = user_id)));


--
-- Name: cabinets consolidated_cabinets_insert_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinets_insert_access ON public.cabinets FOR INSERT WITH CHECK ((((lab_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = cabinets.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid)))))) OR (( SELECT auth.uid() AS uid) = user_id)));


--
-- Name: cabinets consolidated_cabinets_select_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinets_select_access ON public.cabinets FOR SELECT USING ((((lab_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = cabinets.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid)))))) OR (( SELECT auth.uid() AS uid) = user_id)));


--
-- Name: cabinets consolidated_cabinets_update_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_cabinets_update_access ON public.cabinets FOR UPDATE USING ((((lab_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = cabinets.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid)))))) OR (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK ((((lab_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = cabinets.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid)))))) OR (( SELECT auth.uid() AS uid) = user_id)));


--
-- Name: inventory consolidated_inventory_delete_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_inventory_delete_access ON public.inventory FOR DELETE USING (((lab_id IN ( SELECT lab_members.lab_id
   FROM public.lab_members
  WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))) OR ((lab_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: inventory consolidated_inventory_insert_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_inventory_insert_access ON public.inventory FOR INSERT WITH CHECK (((lab_id IN ( SELECT lab_members.lab_id
   FROM public.lab_members
  WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))) OR ((lab_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: inventory consolidated_inventory_select_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_inventory_select_access ON public.inventory FOR SELECT USING (((lab_id IN ( SELECT lab_members.lab_id
   FROM public.lab_members
  WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))) OR ((lab_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: inventory consolidated_inventory_update_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_inventory_update_access ON public.inventory FOR UPDATE USING (((lab_id IN ( SELECT lab_members.lab_id
   FROM public.lab_members
  WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))) OR ((lab_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))))) WITH CHECK (((lab_id IN ( SELECT lab_members.lab_id
   FROM public.lab_members
  WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))) OR ((lab_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: lab_members consolidated_lab_members_update_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_lab_members_update_access ON public.lab_members FOR UPDATE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.lab_members lm
  WHERE ((lm.lab_id = lab_members.lab_id) AND (lm.user_id = ( SELECT auth.uid() AS uid)) AND (lm.role = 'admin'::text)))) OR (user_id = ( SELECT auth.uid() AS uid)))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.lab_members lm
  WHERE ((lm.lab_id = lab_members.lab_id) AND (lm.user_id = ( SELECT auth.uid() AS uid)) AND (lm.role = 'admin'::text)))) OR (user_id = ( SELECT auth.uid() AS uid))));


--
-- Name: storage_locations consolidated_storage_locations_delete_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_storage_locations_delete_access ON public.storage_locations FOR DELETE USING (((lab_id IN ( SELECT lab_members.lab_id
   FROM public.lab_members
  WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))) OR ((lab_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: storage_locations consolidated_storage_locations_insert_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_storage_locations_insert_access ON public.storage_locations FOR INSERT WITH CHECK (((lab_id IN ( SELECT lab_members.lab_id
   FROM public.lab_members
  WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))) OR ((lab_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: storage_locations consolidated_storage_locations_select_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consolidated_storage_locations_select_access ON public.storage_locations FOR SELECT USING (((lab_id IN ( SELECT lab_members.lab_id
   FROM public.lab_members
  WHERE (lab_members.user_id = ( SELECT auth.uid() AS uid)))) OR ((lab_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: ghs_cas_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ghs_cas_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: ghs_cas_cache ghs_cas_cache_insert_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ghs_cas_cache_insert_accessible ON public.ghs_cas_cache FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (((scope_type = 'user'::text) AND (scope_id = ( SELECT auth.uid() AS uid))) OR ((scope_type = 'lab'::text) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = ghs_cas_cache.scope_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid)))))))));


--
-- Name: ghs_cas_cache ghs_cas_cache_select_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ghs_cas_cache_select_accessible ON public.ghs_cas_cache FOR SELECT TO authenticated USING ((((scope_type = 'user'::text) AND (scope_id = ( SELECT auth.uid() AS uid))) OR ((scope_type = 'lab'::text) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = ghs_cas_cache.scope_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid)))))) OR ((scope_type = 'lab'::text) AND (EXISTS ( SELECT 1
   FROM ((public.safety_center_lab_links scl
     JOIN public.safety_centers sc ON ((sc.id = scl.center_id)))
     JOIN public.safety_center_members scm ON ((scm.center_id = scl.center_id)))
  WHERE ((scl.lab_id = ghs_cas_cache.scope_id) AND (scl.status = 'approved'::text) AND (sc.status = 'approved'::text) AND ('risk_detail'::text = ANY (scl.scope)) AND (scm.user_id = ( SELECT auth.uid() AS uid))))))));


--
-- Name: ghs_cas_cache ghs_cas_cache_update_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ghs_cas_cache_update_accessible ON public.ghs_cas_cache FOR UPDATE TO authenticated USING ((((scope_type = 'user'::text) AND (scope_id = ( SELECT auth.uid() AS uid))) OR ((scope_type = 'lab'::text) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = ghs_cas_cache.scope_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid)))))))) WITH CHECK ((((scope_type = 'user'::text) AND (scope_id = ( SELECT auth.uid() AS uid))) OR ((scope_type = 'lab'::text) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = ghs_cas_cache.scope_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid))))))));


--
-- Name: global_reagent_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.global_reagent_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_move_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_move_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_usage_completion_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_usage_completion_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: lab_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lab_members ENABLE ROW LEVEL SECURITY;

--
-- Name: labs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.labs ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_events onboarding_events_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY onboarding_events_insert_own ON public.onboarding_events FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND ((lab_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = onboarding_events.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid))))))));


--
-- Name: onboarding_events onboarding_events_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY onboarding_events_select_own ON public.onboarding_events FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: reagent_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reagent_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: reagent_aliases reagent_aliases_insert_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reagent_aliases_insert_accessible ON public.reagent_aliases FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = COALESCE(user_id, ( SELECT auth.uid() AS uid))) AND ((lab_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = reagent_aliases.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid))))))));


--
-- Name: reagent_aliases reagent_aliases_select_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reagent_aliases_select_accessible ON public.reagent_aliases FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) OR ((lab_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = reagent_aliases.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid))))))));


--
-- Name: safety_center_exports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.safety_center_exports ENABLE ROW LEVEL SECURITY;

--
-- Name: safety_center_exports safety_center_exports_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY safety_center_exports_select_member ON public.safety_center_exports FOR SELECT TO authenticated USING (public.is_safety_center_member(center_id));


--
-- Name: safety_center_lab_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.safety_center_lab_links ENABLE ROW LEVEL SECURITY;

--
-- Name: safety_center_lab_links safety_center_lab_links_select_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY safety_center_lab_links_select_accessible ON public.safety_center_lab_links FOR SELECT TO authenticated USING ((public.is_safety_center_member(center_id) OR public.is_lab_admin(lab_id)));


--
-- Name: safety_center_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.safety_center_members ENABLE ROW LEVEL SECURITY;

--
-- Name: safety_center_members safety_center_members_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY safety_center_members_select_member ON public.safety_center_members FOR SELECT TO authenticated USING (public.is_safety_center_member(center_id));


--
-- Name: safety_center_request_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.safety_center_request_events ENABLE ROW LEVEL SECURITY;

--
-- Name: safety_center_request_events safety_center_request_events_select_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY safety_center_request_events_select_accessible ON public.safety_center_request_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.safety_center_requests r
  WHERE ((r.id = safety_center_request_events.request_id) AND (public.is_safety_center_member(r.center_id) OR (EXISTS ( SELECT 1
           FROM public.lab_members lm
          WHERE ((lm.lab_id = r.lab_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))))))));


--
-- Name: safety_center_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.safety_center_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: safety_center_requests safety_center_requests_select_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY safety_center_requests_select_accessible ON public.safety_center_requests FOR SELECT TO authenticated USING ((public.is_safety_center_member(center_id) OR (EXISTS ( SELECT 1
   FROM public.lab_members lm
  WHERE ((lm.lab_id = safety_center_requests.lab_id) AND (lm.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: safety_centers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.safety_centers ENABLE ROW LEVEL SECURITY;

--
-- Name: safety_centers safety_centers_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY safety_centers_select_member ON public.safety_centers FOR SELECT TO authenticated USING (public.is_safety_center_member(id));


--
-- Name: safety_compliance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.safety_compliance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: safety_compliance_events safety_compliance_events_insert_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY safety_compliance_events_insert_accessible ON public.safety_compliance_events FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = COALESCE(user_id, ( SELECT auth.uid() AS uid))) AND ((lab_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = safety_compliance_events.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid))))))));


--
-- Name: safety_compliance_events safety_compliance_events_select_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY safety_compliance_events_select_accessible ON public.safety_compliance_events FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) OR ((lab_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = safety_compliance_events.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid))))))));


--
-- Name: search_analytics_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.search_analytics_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: search_analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.search_analytics_events ENABLE ROW LEVEL SECURITY;

--
-- Name: search_analytics_guest_subjects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.search_analytics_guest_subjects ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_commercialization_settings server_only_deny_browser_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY server_only_deny_browser_roles ON public.analytics_commercialization_settings AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: analytics_deletion_audits server_only_deny_browser_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY server_only_deny_browser_roles ON public.analytics_deletion_audits AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: analytics_export_audits server_only_deny_browser_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY server_only_deny_browser_roles ON public.analytics_export_audits AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: analytics_monthly_mixture_rollups server_only_deny_browser_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY server_only_deny_browser_roles ON public.analytics_monthly_mixture_rollups AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: analytics_monthly_search_rollups server_only_deny_browser_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY server_only_deny_browser_roles ON public.analytics_monthly_search_rollups AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: analytics_review_audit_logs server_only_deny_browser_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY server_only_deny_browser_roles ON public.analytics_review_audit_logs AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: analytics_review_candidates server_only_deny_browser_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY server_only_deny_browser_roles ON public.analytics_review_candidates AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: global_reagent_aliases server_only_deny_browser_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY server_only_deny_browser_roles ON public.global_reagent_aliases AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: search_analytics_actions server_only_deny_browser_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY server_only_deny_browser_roles ON public.search_analytics_actions AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: search_analytics_events server_only_deny_browser_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY server_only_deny_browser_roles ON public.search_analytics_events AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: search_analytics_guest_subjects server_only_deny_browser_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY server_only_deny_browser_roles ON public.search_analytics_guest_subjects AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: storage_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.storage_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: user_search_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_search_history ENABLE ROW LEVEL SECURITY;

--
-- Name: voice_query_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.voice_query_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: voice_query_feedback voice_query_feedback_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY voice_query_feedback_insert_own ON public.voice_query_feedback FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = COALESCE(user_id, ( SELECT auth.uid() AS uid))) AND ((lab_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.lab_members
  WHERE ((lab_members.lab_id = voice_query_feedback.lab_id) AND (lab_members.user_id = ( SELECT auth.uid() AS uid))))))));


--
-- Name: voice_query_feedback voice_query_feedback_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY voice_query_feedback_select_own ON public.voice_query_feedback FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: waste_log_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waste_log_items ENABLE ROW LEVEL SECURITY;

--
-- Name: waste_log_items waste_log_items_select_scoped_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waste_log_items_select_scoped_v2 ON public.waste_log_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.waste_logs wl
  WHERE ((wl.id = waste_log_items.waste_log_id) AND (((wl.lab_id IS NULL) AND (wl.user_id = ( SELECT auth.uid() AS uid))) OR ((wl.lab_id IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM public.lab_members lm
          WHERE ((lm.lab_id = wl.lab_id) AND (lm.user_id = ( SELECT auth.uid() AS uid)))))))))));


--
-- Name: waste_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waste_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: waste_logs waste_logs_select_scoped_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waste_logs_select_scoped_v2 ON public.waste_logs FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (((lab_id IS NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((lab_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.lab_members lm
  WHERE ((lm.lab_id = waste_logs.lab_id) AND (lm.user_id = ( SELECT auth.uid() AS uid)))))))));


--
-- Name: waste_ph_prediction_authorizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waste_ph_prediction_authorizations ENABLE ROW LEVEL SECURITY;

--
-- Name: waste_policy_lab_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waste_policy_lab_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: waste_policy_lab_overrides waste_policy_lab_overrides_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waste_policy_lab_overrides_select_member ON public.waste_policy_lab_overrides FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.lab_members lm
  WHERE ((lm.lab_id = waste_policy_lab_overrides.lab_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: waste_policy_streams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waste_policy_streams ENABLE ROW LEVEL SECURITY;

--
-- Name: waste_policy_streams waste_policy_streams_select_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waste_policy_streams_select_accessible ON public.waste_policy_streams FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.waste_policy_versions pv
  WHERE ((pv.id = waste_policy_streams.policy_version_id) AND (((pv.scope_type = 'system'::text) AND (pv.status = 'active'::text)) OR ((pv.scope_type = 'safety_center'::text) AND public.is_safety_center_member(pv.safety_center_id) AND ((pv.status = 'active'::text) OR public.is_safety_center_member(pv.safety_center_id, ARRAY['owner'::text, 'manager'::text]))) OR ((pv.scope_type = 'lab'::text) AND (EXISTS ( SELECT 1
           FROM public.lab_members lm
          WHERE ((lm.lab_id = pv.lab_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) AND ((pv.status = 'active'::text) OR public.is_lab_admin(pv.lab_id))))))));


--
-- Name: waste_policy_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waste_policy_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: waste_policy_versions waste_policy_versions_select_accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waste_policy_versions_select_accessible ON public.waste_policy_versions FOR SELECT TO authenticated USING ((((scope_type = 'system'::text) AND (status = 'active'::text)) OR ((scope_type = 'safety_center'::text) AND public.is_safety_center_member(safety_center_id) AND ((status = 'active'::text) OR public.is_safety_center_member(safety_center_id, ARRAY['owner'::text, 'manager'::text]))) OR ((scope_type = 'lab'::text) AND (EXISTS ( SELECT 1
   FROM public.lab_members lm
  WHERE ((lm.lab_id = waste_policy_versions.lab_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) AND ((status = 'active'::text) OR public.is_lab_admin(lab_id)))));


--
-- Name: waste_stream_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waste_stream_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: waste_stream_catalog waste_stream_catalog_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waste_stream_catalog_select_authenticated ON public.waste_stream_catalog FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) IS NOT NULL));


--
-- Name: SCHEMA private; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA private TO service_role;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION actor_display_name_v2(p_user_id uuid, p_lab_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.actor_display_name_v2(p_user_id uuid, p_lab_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION analytics_normalize_query(input text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.analytics_normalize_query(input text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.analytics_normalize_query(input text) TO service_role;


--
-- Name: FUNCTION analytics_sanitize_legacy_query(input text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.analytics_sanitize_legacy_query(input text) FROM PUBLIC;


--
-- Name: FUNCTION analyze_waste_batch_v2(p_components jsonb, p_matrix text, p_confirmation jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.analyze_waste_batch_v2(p_components jsonb, p_matrix text, p_confirmation jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.analyze_waste_batch_v2(p_components jsonb, p_matrix text, p_confirmation jsonb) TO service_role;


--
-- Name: FUNCTION cabinet_depth_pct_v2(p_template text, p_width numeric, p_cabinet_depth numeric); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.cabinet_depth_pct_v2(p_template text, p_width numeric, p_cabinet_depth numeric) FROM PUBLIC;


--
-- Name: FUNCTION cabinet_visual_width_pct_v2(p_template text, p_width numeric, p_cabinet_width numeric); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.cabinet_visual_width_pct_v2(p_template text, p_width numeric, p_cabinet_width numeric) FROM PUBLIC;


--
-- Name: FUNCTION capture_ph_prediction_audit_v1(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.capture_ph_prediction_audit_v1() FROM PUBLIC;


--
-- Name: FUNCTION cleanup_expired_guest_search_analytics(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.cleanup_expired_guest_search_analytics() FROM PUBLIC;


--
-- Name: FUNCTION delete_search_analytics_for_history_row(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.delete_search_analytics_for_history_row() FROM PUBLIC;


--
-- Name: FUNCTION is_valid_cas_number(p_cas text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.is_valid_cas_number(p_cas text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_valid_cas_number(p_cas text) TO service_role;


--
-- Name: FUNCTION refresh_analytics_review_candidates(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.refresh_analytics_review_candidates() FROM PUBLIC;
GRANT ALL ON FUNCTION private.refresh_analytics_review_candidates() TO service_role;


--
-- Name: FUNCTION rollup_search_batch_analytics(p_month_start date); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.rollup_search_batch_analytics(p_month_start date) FROM PUBLIC;


--
-- Name: FUNCTION waste_log_item_validate_search_event_link(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.waste_log_item_validate_search_event_link() FROM PUBLIC;


--
-- Name: FUNCTION activate_waste_policy_v2(p_policy_version_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.activate_waste_policy_v2(p_policy_version_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.activate_waste_policy_v2(p_policy_version_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.activate_waste_policy_v2(p_policy_version_id uuid) TO service_role;


--
-- Name: FUNCTION add_safety_center_request_event(p_request_id uuid, p_body text, p_to_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_safety_center_request_event(p_request_id uuid, p_body text, p_to_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_safety_center_request_event(p_request_id uuid, p_body text, p_to_status text) TO authenticated;
GRANT ALL ON FUNCTION public.add_safety_center_request_event(p_request_id uuid, p_body text, p_to_status text) TO service_role;


--
-- Name: FUNCTION analytics_admin_governance(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_admin_governance() FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_admin_governance() TO service_role;


--
-- Name: FUNCTION analytics_admin_mixtures(p_days integer, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_admin_mixtures(p_days integer, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_admin_mixtures(p_days integer, p_limit integer) TO service_role;


--
-- Name: FUNCTION analytics_admin_refresh_reviews(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_admin_refresh_reviews() FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_admin_refresh_reviews() TO service_role;


--
-- Name: FUNCTION analytics_admin_search(p_days integer, p_limit integer, p_order text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_admin_search(p_days integer, p_limit integer, p_order text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_admin_search(p_days integer, p_limit integer, p_order text) TO service_role;


--
-- Name: FUNCTION analytics_admin_summary(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_admin_summary(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_admin_summary(p_days integer) TO service_role;


--
-- Name: FUNCTION analytics_delete_guest_subject(p_guest_subject_id uuid, p_delete_token_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_delete_guest_subject(p_guest_subject_id uuid, p_delete_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_delete_guest_subject(p_guest_subject_id uuid, p_delete_token_hash text) TO service_role;


--
-- Name: FUNCTION analytics_delete_user_search(p_user_id uuid, p_query_normalized text, p_delete_all boolean, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_delete_user_search(p_user_id uuid, p_query_normalized text, p_delete_all boolean, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_delete_user_search(p_user_id uuid, p_query_normalized text, p_delete_all boolean, p_reason text) TO service_role;


--
-- Name: FUNCTION analytics_normalize_cas(input text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_normalize_cas(input text) TO anon;
GRANT ALL ON FUNCTION public.analytics_normalize_cas(input text) TO authenticated;
GRANT ALL ON FUNCTION public.analytics_normalize_cas(input text) TO service_role;


--
-- Name: FUNCTION analytics_normalize_text(input text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_normalize_text(input text) TO anon;
GRANT ALL ON FUNCTION public.analytics_normalize_text(input text) TO authenticated;
GRANT ALL ON FUNCTION public.analytics_normalize_text(input text) TO service_role;


--
-- Name: FUNCTION analytics_review_candidate_decide(p_candidate_id uuid, p_status text, p_notes text, p_evidence jsonb, p_operator_user_id uuid, p_proposed_alias text, p_canonical_name text, p_canonical_cas text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_review_candidate_decide(p_candidate_id uuid, p_status text, p_notes text, p_evidence jsonb, p_operator_user_id uuid, p_proposed_alias text, p_canonical_name text, p_canonical_cas text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_review_candidate_decide(p_candidate_id uuid, p_status text, p_notes text, p_evidence jsonb, p_operator_user_id uuid, p_proposed_alias text, p_canonical_name text, p_canonical_cas text) TO service_role;


--
-- Name: FUNCTION attach_safety_center_verification_document(p_center_id uuid, p_path text, p_name text, p_mime_type text, p_size bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.attach_safety_center_verification_document(p_center_id uuid, p_path text, p_name text, p_mime_type text, p_size bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.attach_safety_center_verification_document(p_center_id uuid, p_path text, p_name text, p_mime_type text, p_size bigint) TO authenticated;
GRANT ALL ON FUNCTION public.attach_safety_center_verification_document(p_center_id uuid, p_path text, p_name text, p_mime_type text, p_size bigint) TO service_role;


--
-- Name: FUNCTION chemical_enrichment_cache_set_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chemical_enrichment_cache_set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.chemical_enrichment_cache_set_updated_at() TO service_role;


--
-- Name: FUNCTION commerce_intent_events_set_normalized_fields(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.commerce_intent_events_set_normalized_fields() TO anon;
GRANT ALL ON FUNCTION public.commerce_intent_events_set_normalized_fields() TO authenticated;
GRANT ALL ON FUNCTION public.commerce_intent_events_set_normalized_fields() TO service_role;


--
-- Name: FUNCTION create_inventory_item_atomic(p_name text, p_storage_type text, p_brand text, p_product_number text, p_cas_number text, p_quantity integer, p_capacity text, p_cabinet_id uuid, p_storage_location_id uuid, p_product_id uuid, p_expiry_date date, p_memo text, p_remaining_percent integer, p_lab_id uuid, p_actor_user_id uuid, p_actor_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_inventory_item_atomic(p_name text, p_storage_type text, p_brand text, p_product_number text, p_cas_number text, p_quantity integer, p_capacity text, p_cabinet_id uuid, p_storage_location_id uuid, p_product_id uuid, p_expiry_date date, p_memo text, p_remaining_percent integer, p_lab_id uuid, p_actor_user_id uuid, p_actor_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_inventory_item_atomic(p_name text, p_storage_type text, p_brand text, p_product_number text, p_cas_number text, p_quantity integer, p_capacity text, p_cabinet_id uuid, p_storage_location_id uuid, p_product_id uuid, p_expiry_date date, p_memo text, p_remaining_percent integer, p_lab_id uuid, p_actor_user_id uuid, p_actor_name text) TO authenticated;
GRANT ALL ON FUNCTION public.create_inventory_item_atomic(p_name text, p_storage_type text, p_brand text, p_product_number text, p_cas_number text, p_quantity integer, p_capacity text, p_cabinet_id uuid, p_storage_location_id uuid, p_product_id uuid, p_expiry_date date, p_memo text, p_remaining_percent integer, p_lab_id uuid, p_actor_user_id uuid, p_actor_name text) TO service_role;


--
-- Name: FUNCTION create_inventory_item_with_dates_atomic(p_name text, p_storage_type text, p_brand text, p_product_number text, p_cas_number text, p_quantity integer, p_capacity text, p_cabinet_id uuid, p_storage_location_id uuid, p_product_id uuid, p_expiry_date date, p_manufacturer_date_type text, p_received_date date, p_opened_date date, p_memo text, p_remaining_percent integer, p_lab_id uuid, p_actor_user_id uuid, p_actor_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_inventory_item_with_dates_atomic(p_name text, p_storage_type text, p_brand text, p_product_number text, p_cas_number text, p_quantity integer, p_capacity text, p_cabinet_id uuid, p_storage_location_id uuid, p_product_id uuid, p_expiry_date date, p_manufacturer_date_type text, p_received_date date, p_opened_date date, p_memo text, p_remaining_percent integer, p_lab_id uuid, p_actor_user_id uuid, p_actor_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_inventory_item_with_dates_atomic(p_name text, p_storage_type text, p_brand text, p_product_number text, p_cas_number text, p_quantity integer, p_capacity text, p_cabinet_id uuid, p_storage_location_id uuid, p_product_id uuid, p_expiry_date date, p_manufacturer_date_type text, p_received_date date, p_opened_date date, p_memo text, p_remaining_percent integer, p_lab_id uuid, p_actor_user_id uuid, p_actor_name text) TO authenticated;
GRANT ALL ON FUNCTION public.create_inventory_item_with_dates_atomic(p_name text, p_storage_type text, p_brand text, p_product_number text, p_cas_number text, p_quantity integer, p_capacity text, p_cabinet_id uuid, p_storage_location_id uuid, p_product_id uuid, p_expiry_date date, p_manufacturer_date_type text, p_received_date date, p_opened_date date, p_memo text, p_remaining_percent integer, p_lab_id uuid, p_actor_user_id uuid, p_actor_name text) TO service_role;


--
-- Name: FUNCTION create_lab_secure(p_name text, p_password text, p_nickname text, p_institution_type text, p_research_field text, p_institution_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_lab_secure(p_name text, p_password text, p_nickname text, p_institution_type text, p_research_field text, p_institution_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_lab_secure(p_name text, p_password text, p_nickname text, p_institution_type text, p_research_field text, p_institution_name text) TO authenticated;
GRANT ALL ON FUNCTION public.create_lab_secure(p_name text, p_password text, p_nickname text, p_institution_type text, p_research_field text, p_institution_name text) TO service_role;


--
-- Name: FUNCTION create_safety_center(p_institution_name text, p_institution_domain text, p_center_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_safety_center(p_institution_name text, p_institution_domain text, p_center_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_safety_center(p_institution_name text, p_institution_domain text, p_center_name text) TO authenticated;
GRANT ALL ON FUNCTION public.create_safety_center(p_institution_name text, p_institution_domain text, p_center_name text) TO service_role;


--
-- Name: FUNCTION create_safety_center_request(p_center_id uuid, p_lab_id uuid, p_title text, p_description text, p_priority text, p_due_date date, p_target_type text, p_target_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_safety_center_request(p_center_id uuid, p_lab_id uuid, p_title text, p_description text, p_priority text, p_due_date date, p_target_type text, p_target_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_safety_center_request(p_center_id uuid, p_lab_id uuid, p_title text, p_description text, p_priority text, p_due_date date, p_target_type text, p_target_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_safety_center_request(p_center_id uuid, p_lab_id uuid, p_title text, p_description text, p_priority text, p_due_date date, p_target_type text, p_target_id uuid) TO service_role;


--
-- Name: FUNCTION delete_inventory_item_atomic(p_item_id uuid, p_item_source text, p_item_name text, p_lab_id uuid, p_cabinet_id uuid, p_cabinet_name text, p_storage_location_name text, p_disposal_reason text, p_actor_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_inventory_item_atomic(p_item_id uuid, p_item_source text, p_item_name text, p_lab_id uuid, p_cabinet_id uuid, p_cabinet_name text, p_storage_location_name text, p_disposal_reason text, p_actor_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_inventory_item_atomic(p_item_id uuid, p_item_source text, p_item_name text, p_lab_id uuid, p_cabinet_id uuid, p_cabinet_name text, p_storage_location_name text, p_disposal_reason text, p_actor_name text) TO authenticated;
GRANT ALL ON FUNCTION public.delete_inventory_item_atomic(p_item_id uuid, p_item_source text, p_item_name text, p_lab_id uuid, p_cabinet_id uuid, p_cabinet_name text, p_storage_location_name text, p_disposal_reason text, p_actor_name text) TO service_role;


--
-- Name: FUNCTION delete_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_user() TO authenticated;
GRANT ALL ON FUNCTION public.delete_user() TO service_role;


--
-- Name: FUNCTION enforce_lab_creation_membership_limit(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_lab_creation_membership_limit() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_lab_creation_membership_limit() TO service_role;


--
-- Name: FUNCTION enforce_lab_membership_limit(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_lab_membership_limit() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_lab_membership_limit() TO service_role;


--
-- Name: FUNCTION get_active_waste_policy_v2(p_lab_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_active_waste_policy_v2(p_lab_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_active_waste_policy_v2(p_lab_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_active_waste_policy_v2(p_lab_id uuid) TO service_role;


--
-- Name: FUNCTION get_cabinet_activity_logs(target_cabinet_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_cabinet_activity_logs(target_cabinet_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_cabinet_activity_logs(target_cabinet_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_cabinet_activity_logs(target_cabinet_id uuid) TO service_role;


--
-- Name: FUNCTION get_cabinet_audit_logs(p_cabinet_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_cabinet_audit_logs(p_cabinet_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_cabinet_audit_logs(p_cabinet_id uuid, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_cabinet_audit_logs(p_cabinet_id uuid, p_limit integer) TO service_role;


--
-- Name: FUNCTION get_cabinet_disposal_logs(target_cabinet_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_cabinet_disposal_logs(target_cabinet_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_cabinet_disposal_logs(target_cabinet_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_cabinet_disposal_logs(target_cabinet_id uuid) TO service_role;


--
-- Name: FUNCTION get_lab_members(target_lab_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_lab_members(target_lab_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_lab_members(target_lab_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_lab_members(target_lab_id uuid) TO service_role;


--
-- Name: FUNCTION get_lab_safety_center_link_requests(p_lab_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_lab_safety_center_link_requests(p_lab_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_lab_safety_center_link_requests(p_lab_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_lab_safety_center_link_requests(p_lab_id uuid) TO service_role;


--
-- Name: FUNCTION get_lab_safety_center_requests(p_lab_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_lab_safety_center_requests(p_lab_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_lab_safety_center_requests(p_lab_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_lab_safety_center_requests(p_lab_id uuid) TO service_role;


--
-- Name: FUNCTION get_my_safety_centers(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_safety_centers() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_safety_centers() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_safety_centers() TO service_role;


--
-- Name: FUNCTION get_safety_center_audit_logs(p_center_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_safety_center_audit_logs(p_center_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_safety_center_audit_logs(p_center_id uuid, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_safety_center_audit_logs(p_center_id uuid, p_limit integer) TO service_role;


--
-- Name: FUNCTION get_safety_center_lab_candidates(p_center_id uuid, p_search text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_safety_center_lab_candidates(p_center_id uuid, p_search text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_safety_center_lab_candidates(p_center_id uuid, p_search text) TO authenticated;
GRANT ALL ON FUNCTION public.get_safety_center_lab_candidates(p_center_id uuid, p_search text) TO service_role;


--
-- Name: FUNCTION get_safety_center_requests(p_center_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_safety_center_requests(p_center_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_safety_center_requests(p_center_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_safety_center_requests(p_center_id uuid) TO service_role;


--
-- Name: FUNCTION get_safety_center_risk_items(p_center_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_safety_center_risk_items(p_center_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_safety_center_risk_items(p_center_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_safety_center_risk_items(p_center_id uuid) TO service_role;


--
-- Name: FUNCTION get_safety_center_waste_logs(p_center_id uuid, p_created_after timestamp with time zone, p_created_before timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_safety_center_waste_logs(p_center_id uuid, p_created_after timestamp with time zone, p_created_before timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_safety_center_waste_logs(p_center_id uuid, p_created_after timestamp with time zone, p_created_before timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.get_safety_center_waste_logs(p_center_id uuid, p_created_after timestamp with time zone, p_created_before timestamp with time zone) TO service_role;


--
-- Name: FUNCTION ghs_cas_cache_set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.ghs_cas_cache_set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.ghs_cas_cache_set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.ghs_cas_cache_set_updated_at() TO service_role;


--
-- Name: FUNCTION insert_audit_log_rpc(p_actor_user_id uuid, p_actor_name text, p_lab_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_location_context text, p_before_data jsonb, p_after_data jsonb, p_diff_data jsonb, p_source text, p_request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.insert_audit_log_rpc(p_actor_user_id uuid, p_actor_name text, p_lab_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_location_context text, p_before_data jsonb, p_after_data jsonb, p_diff_data jsonb, p_source text, p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.insert_audit_log_rpc(p_actor_user_id uuid, p_actor_name text, p_lab_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_location_context text, p_before_data jsonb, p_after_data jsonb, p_diff_data jsonb, p_source text, p_request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.insert_audit_log_rpc(p_actor_user_id uuid, p_actor_name text, p_lab_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_location_context text, p_before_data jsonb, p_after_data jsonb, p_diff_data jsonb, p_source text, p_request_id uuid) TO service_role;


--
-- Name: FUNCTION is_lab_admin(target_lab_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_lab_admin(target_lab_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_lab_admin(target_lab_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_lab_admin(target_lab_id uuid) TO service_role;


--
-- Name: FUNCTION is_safety_center_member(target_center_id uuid, allowed_roles text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_safety_center_member(target_center_id uuid, allowed_roles text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_safety_center_member(target_center_id uuid, allowed_roles text[]) TO authenticated;
GRANT ALL ON FUNCTION public.is_safety_center_member(target_center_id uuid, allowed_roles text[]) TO service_role;


--
-- Name: FUNCTION join_lab(p_lab_id uuid, p_password text, p_nickname text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.join_lab(p_lab_id uuid, p_password text, p_nickname text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.join_lab(p_lab_id uuid, p_password text, p_nickname text) TO authenticated;
GRANT ALL ON FUNCTION public.join_lab(p_lab_id uuid, p_password text, p_nickname text) TO service_role;


--
-- Name: FUNCTION join_lab_with_password(target_lab_id uuid, joining_user_id uuid, requested_role text, provided_password text, p_nickname text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.join_lab_with_password(target_lab_id uuid, joining_user_id uuid, requested_role text, provided_password text, p_nickname text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.join_lab_with_password(target_lab_id uuid, joining_user_id uuid, requested_role text, provided_password text, p_nickname text) TO service_role;


--
-- Name: FUNCTION leave_lab(target_lab_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.leave_lab(target_lab_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.leave_lab(target_lab_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.leave_lab(target_lab_id uuid) TO service_role;


--
-- Name: FUNCTION log_safety_center_export(p_center_id uuid, p_format text, p_datasets text[], p_lab_ids uuid[], p_filters jsonb, p_row_count integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_safety_center_export(p_center_id uuid, p_format text, p_datasets text[], p_lab_ids uuid[], p_filters jsonb, p_row_count integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_safety_center_export(p_center_id uuid, p_format text, p_datasets text[], p_lab_ids uuid[], p_filters jsonb, p_row_count integer) TO authenticated;
GRANT ALL ON FUNCTION public.log_safety_center_export(p_center_id uuid, p_format text, p_datasets text[], p_lab_ids uuid[], p_filters jsonb, p_row_count integer) TO service_role;


--
-- Name: FUNCTION move_inventory_records_v2(p_targets jsonb, p_destination jsonb, p_request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.move_inventory_records_v2(p_targets jsonb, p_destination jsonb, p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_inventory_records_v2(p_targets jsonb, p_destination jsonb, p_request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.move_inventory_records_v2(p_targets jsonb, p_destination jsonb, p_request_id uuid) TO service_role;


--
-- Name: FUNCTION normalize_lab_join_password(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.normalize_lab_join_password() FROM PUBLIC;
GRANT ALL ON FUNCTION public.normalize_lab_join_password() TO service_role;


--
-- Name: FUNCTION protect_lab_member_role(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.protect_lab_member_role() FROM PUBLIC;
GRANT ALL ON FUNCTION public.protect_lab_member_role() TO service_role;


--
-- Name: FUNCTION record_inventory_disposal_v2(p_request_id uuid, p_items jsonb, p_batch jsonb, p_lab_id uuid, p_actor_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_inventory_disposal_v2(p_request_id uuid, p_items jsonb, p_batch jsonb, p_lab_id uuid, p_actor_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_inventory_disposal_v2(p_request_id uuid, p_items jsonb, p_batch jsonb, p_lab_id uuid, p_actor_name text) TO authenticated;
GRANT ALL ON FUNCTION public.record_inventory_disposal_v2(p_request_id uuid, p_items jsonb, p_batch jsonb, p_lab_id uuid, p_actor_name text) TO service_role;


--
-- Name: FUNCTION record_inventory_usage_completion_v2(p_cabinet_item_id uuid, p_request_id uuid, p_completion_kind text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_inventory_usage_completion_v2(p_cabinet_item_id uuid, p_request_id uuid, p_completion_kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_inventory_usage_completion_v2(p_cabinet_item_id uuid, p_request_id uuid, p_completion_kind text) TO authenticated;
GRANT ALL ON FUNCTION public.record_inventory_usage_completion_v2(p_cabinet_item_id uuid, p_request_id uuid, p_completion_kind text) TO service_role;


--
-- Name: FUNCTION record_waste_handling_v2(p_request_id uuid, p_batch jsonb, p_lab_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_waste_handling_v2(p_request_id uuid, p_batch jsonb, p_lab_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_waste_handling_v2(p_request_id uuid, p_batch jsonb, p_lab_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.record_waste_handling_v2(p_request_id uuid, p_batch jsonb, p_lab_id uuid) TO service_role;


--
-- Name: FUNCTION release_chemical_enrichment_lease(p_lease_key text, p_result_version integer, p_owner_token uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.release_chemical_enrichment_lease(p_lease_key text, p_result_version integer, p_owner_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_chemical_enrichment_lease(p_lease_key text, p_result_version integer, p_owner_token uuid) TO service_role;


--
-- Name: FUNCTION remove_inventory_record_v2(p_items jsonb, p_lab_id uuid, p_actor_name text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remove_inventory_record_v2(p_items jsonb, p_lab_id uuid, p_actor_name text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_inventory_record_v2(p_items jsonb, p_lab_id uuid, p_actor_name text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.remove_inventory_record_v2(p_items jsonb, p_lab_id uuid, p_actor_name text, p_reason text) TO service_role;


--
-- Name: FUNCTION remove_lab_member(target_lab_id uuid, target_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remove_lab_member(target_lab_id uuid, target_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_lab_member(target_lab_id uuid, target_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.remove_lab_member(target_lab_id uuid, target_user_id uuid) TO service_role;


--
-- Name: FUNCTION request_safety_center_lab_link(p_center_id uuid, p_lab_id uuid, p_scope text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_safety_center_lab_link(p_center_id uuid, p_lab_id uuid, p_scope text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_safety_center_lab_link(p_center_id uuid, p_lab_id uuid, p_scope text[]) TO authenticated;
GRANT ALL ON FUNCTION public.request_safety_center_lab_link(p_center_id uuid, p_lab_id uuid, p_scope text[]) TO service_role;


--
-- Name: FUNCTION respond_safety_center_lab_link(p_link_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.respond_safety_center_lab_link(p_link_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.respond_safety_center_lab_link(p_link_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.respond_safety_center_lab_link(p_link_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION safety_center_set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.safety_center_set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.safety_center_set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.safety_center_set_updated_at() TO service_role;


--
-- Name: FUNCTION safety_compliance_events_set_normalized_fields(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.safety_compliance_events_set_normalized_fields() TO anon;
GRANT ALL ON FUNCTION public.safety_compliance_events_set_normalized_fields() TO authenticated;
GRANT ALL ON FUNCTION public.safety_compliance_events_set_normalized_fields() TO service_role;


--
-- Name: FUNCTION save_cabinet_state_atomic(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_cabinet_state_atomic(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_cabinet_state_atomic(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) TO authenticated;
GRANT ALL ON FUNCTION public.save_cabinet_state_atomic(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) TO service_role;


--
-- Name: FUNCTION save_cabinet_state_with_dates(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_cabinet_state_with_dates(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_cabinet_state_with_dates(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) TO authenticated;
GRANT ALL ON FUNCTION public.save_cabinet_state_with_dates(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) TO service_role;


--
-- Name: FUNCTION save_cabinet_state_with_ghs(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_cabinet_state_with_ghs(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_cabinet_state_with_ghs(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) TO authenticated;
GRANT ALL ON FUNCTION public.save_cabinet_state_with_ghs(p_cabinet_id uuid, p_shelves jsonb, p_width integer, p_height integer, p_depth integer) TO service_role;


--
-- Name: FUNCTION save_safety_center_waste_policy_draft_v2(p_center_id uuid, p_version_label text, p_name text, p_streams jsonb, p_source_refs jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_safety_center_waste_policy_draft_v2(p_center_id uuid, p_version_label text, p_name text, p_streams jsonb, p_source_refs jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_safety_center_waste_policy_draft_v2(p_center_id uuid, p_version_label text, p_name text, p_streams jsonb, p_source_refs jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.save_safety_center_waste_policy_draft_v2(p_center_id uuid, p_version_label text, p_name text, p_streams jsonb, p_source_refs jsonb) TO service_role;


--
-- Name: FUNCTION search_labs(search_query text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.search_labs(search_query text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.search_labs(search_query text) TO authenticated;
GRANT ALL ON FUNCTION public.search_labs(search_query text) TO service_role;


--
-- Name: FUNCTION set_lab_join_password(target_lab_id uuid, p_password text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_lab_join_password(target_lab_id uuid, p_password text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_lab_join_password(target_lab_id uuid, p_password text) TO authenticated;
GRANT ALL ON FUNCTION public.set_lab_join_password(target_lab_id uuid, p_password text) TO service_role;


--
-- Name: FUNCTION transfer_admin(target_lab_id uuid, new_admin_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.transfer_admin(target_lab_id uuid, new_admin_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.transfer_admin(target_lab_id uuid, new_admin_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.transfer_admin(target_lab_id uuid, new_admin_user_id uuid) TO service_role;


--
-- Name: FUNCTION try_acquire_chemical_enrichment_lease(p_lease_key text, p_result_version integer, p_owner_token uuid, p_lease_seconds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.try_acquire_chemical_enrichment_lease(p_lease_key text, p_result_version integer, p_owner_token uuid, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.try_acquire_chemical_enrichment_lease(p_lease_key text, p_result_version integer, p_owner_token uuid, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION update_inventory_item_atomic(p_item_id uuid, p_item_source text, p_updates jsonb, p_actor_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_inventory_item_atomic(p_item_id uuid, p_item_source text, p_updates jsonb, p_actor_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_inventory_item_atomic(p_item_id uuid, p_item_source text, p_updates jsonb, p_actor_name text) TO authenticated;
GRANT ALL ON FUNCTION public.update_inventory_item_atomic(p_item_id uuid, p_item_source text, p_updates jsonb, p_actor_name text) TO service_role;


--
-- Name: FUNCTION update_inventory_item_with_dates_atomic(p_item_id uuid, p_item_source text, p_updates jsonb, p_actor_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_inventory_item_with_dates_atomic(p_item_id uuid, p_item_source text, p_updates jsonb, p_actor_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_inventory_item_with_dates_atomic(p_item_id uuid, p_item_source text, p_updates jsonb, p_actor_name text) TO authenticated;
GRANT ALL ON FUNCTION public.update_inventory_item_with_dates_atomic(p_item_id uuid, p_item_source text, p_updates jsonb, p_actor_name text) TO service_role;


--
-- Name: FUNCTION update_inventory_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_inventory_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_inventory_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_inventory_updated_at() TO service_role;


--
-- Name: FUNCTION update_lab_member_role(target_lab_id uuid, target_user_id uuid, new_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_lab_member_role(target_lab_id uuid, target_user_id uuid, new_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_lab_member_role(target_lab_id uuid, target_user_id uuid, new_role text) TO authenticated;
GRANT ALL ON FUNCTION public.update_lab_member_role(target_lab_id uuid, target_user_id uuid, new_role text) TO service_role;


--
-- Name: FUNCTION upsert_lab_waste_stream_override_v2(p_lab_id uuid, p_stream_code text, p_container_label text, p_container_color text, p_location text, p_handler_contact text, p_replacement_location text, p_is_disabled boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.upsert_lab_waste_stream_override_v2(p_lab_id uuid, p_stream_code text, p_container_label text, p_container_color text, p_location text, p_handler_contact text, p_replacement_location text, p_is_disabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_lab_waste_stream_override_v2(p_lab_id uuid, p_stream_code text, p_container_label text, p_container_color text, p_location text, p_handler_contact text, p_replacement_location text, p_is_disabled boolean) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_lab_waste_stream_override_v2(p_lab_id uuid, p_stream_code text, p_container_label text, p_container_color text, p_location text, p_handler_contact text, p_replacement_location text, p_is_disabled boolean) TO service_role;


--
-- Name: FUNCTION void_waste_log_v2(p_waste_log_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.void_waste_log_v2(p_waste_log_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.void_waste_log_v2(p_waste_log_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.void_waste_log_v2(p_waste_log_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION waste_ph_prediction_fingerprint(p_components jsonb, p_matrix text, p_total_amount jsonb, p_confirmation jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.waste_ph_prediction_fingerprint(p_components jsonb, p_matrix text, p_total_amount jsonb, p_confirmation jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waste_ph_prediction_fingerprint(p_components jsonb, p_matrix text, p_total_amount jsonb, p_confirmation jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.waste_ph_prediction_fingerprint(p_components jsonb, p_matrix text, p_total_amount jsonb, p_confirmation jsonb) TO service_role;


--
-- Name: TABLE ai_api_cache; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_api_cache TO anon;
GRANT ALL ON TABLE public.ai_api_cache TO authenticated;
GRANT ALL ON TABLE public.ai_api_cache TO service_role;


--
-- Name: TABLE analytics_commercialization_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.analytics_commercialization_settings TO service_role;


--
-- Name: TABLE analytics_deletion_audits; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.analytics_deletion_audits TO service_role;


--
-- Name: TABLE analytics_export_audits; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.analytics_export_audits TO service_role;


--
-- Name: TABLE analytics_monthly_mixture_rollups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.analytics_monthly_mixture_rollups TO service_role;


--
-- Name: TABLE analytics_monthly_search_rollups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.analytics_monthly_search_rollups TO service_role;


--
-- Name: TABLE analytics_review_audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.analytics_review_audit_logs TO service_role;


--
-- Name: TABLE analytics_review_candidates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.analytics_review_candidates TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_logs TO anon;
GRANT ALL ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE cabinet_activity_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cabinet_activity_logs TO anon;
GRANT ALL ON TABLE public.cabinet_activity_logs TO authenticated;
GRANT ALL ON TABLE public.cabinet_activity_logs TO service_role;


--
-- Name: TABLE cabinet_disposal_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cabinet_disposal_logs TO anon;
GRANT ALL ON TABLE public.cabinet_disposal_logs TO authenticated;
GRANT ALL ON TABLE public.cabinet_disposal_logs TO service_role;


--
-- Name: TABLE cabinet_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cabinet_items TO anon;
GRANT ALL ON TABLE public.cabinet_items TO authenticated;
GRANT ALL ON TABLE public.cabinet_items TO service_role;


--
-- Name: TABLE cabinet_shelves; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cabinet_shelves TO anon;
GRANT ALL ON TABLE public.cabinet_shelves TO authenticated;
GRANT ALL ON TABLE public.cabinet_shelves TO service_role;


--
-- Name: TABLE cabinets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cabinets TO anon;
GRANT ALL ON TABLE public.cabinets TO authenticated;
GRANT ALL ON TABLE public.cabinets TO service_role;


--
-- Name: TABLE chemical_enrichment_cache; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chemical_enrichment_cache TO service_role;


--
-- Name: TABLE chemical_enrichment_leases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chemical_enrichment_leases TO service_role;


--
-- Name: TABLE chemical_source_cache; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chemical_source_cache TO service_role;


--
-- Name: TABLE commerce_intent_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.commerce_intent_events TO anon;
GRANT ALL ON TABLE public.commerce_intent_events TO authenticated;
GRANT ALL ON TABLE public.commerce_intent_events TO service_role;


--
-- Name: TABLE feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.feedback TO anon;
GRANT ALL ON TABLE public.feedback TO authenticated;
GRANT ALL ON TABLE public.feedback TO service_role;


--
-- Name: TABLE ghs_cas_cache; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.ghs_cas_cache TO anon;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.ghs_cas_cache TO authenticated;
GRANT ALL ON TABLE public.ghs_cas_cache TO service_role;


--
-- Name: TABLE global_reagent_aliases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.global_reagent_aliases TO service_role;


--
-- Name: TABLE inventory; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inventory TO anon;
GRANT ALL ON TABLE public.inventory TO authenticated;
GRANT ALL ON TABLE public.inventory TO service_role;


--
-- Name: TABLE inventory_move_receipts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inventory_move_receipts TO service_role;


--
-- Name: TABLE inventory_usage_completion_receipts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inventory_usage_completion_receipts TO service_role;


--
-- Name: TABLE lab_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lab_members TO anon;
GRANT ALL ON TABLE public.lab_members TO authenticated;
GRANT ALL ON TABLE public.lab_members TO service_role;


--
-- Name: TABLE labs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.labs TO anon;
GRANT ALL ON TABLE public.labs TO authenticated;
GRANT ALL ON TABLE public.labs TO service_role;


--
-- Name: TABLE onboarding_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.onboarding_events TO service_role;
GRANT SELECT,INSERT ON TABLE public.onboarding_events TO authenticated;


--
-- Name: TABLE products; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.products TO anon;
GRANT ALL ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.products TO service_role;


--
-- Name: TABLE reagent_aliases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reagent_aliases TO anon;
GRANT ALL ON TABLE public.reagent_aliases TO authenticated;
GRANT ALL ON TABLE public.reagent_aliases TO service_role;


--
-- Name: TABLE safety_center_exports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.safety_center_exports TO anon;
GRANT ALL ON TABLE public.safety_center_exports TO authenticated;
GRANT ALL ON TABLE public.safety_center_exports TO service_role;


--
-- Name: TABLE safety_center_lab_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.safety_center_lab_links TO anon;
GRANT ALL ON TABLE public.safety_center_lab_links TO authenticated;
GRANT ALL ON TABLE public.safety_center_lab_links TO service_role;


--
-- Name: TABLE safety_center_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.safety_center_members TO anon;
GRANT ALL ON TABLE public.safety_center_members TO authenticated;
GRANT ALL ON TABLE public.safety_center_members TO service_role;


--
-- Name: TABLE safety_center_request_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.safety_center_request_events TO anon;
GRANT ALL ON TABLE public.safety_center_request_events TO authenticated;
GRANT ALL ON TABLE public.safety_center_request_events TO service_role;


--
-- Name: TABLE safety_center_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.safety_center_requests TO anon;
GRANT ALL ON TABLE public.safety_center_requests TO authenticated;
GRANT ALL ON TABLE public.safety_center_requests TO service_role;


--
-- Name: TABLE safety_centers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.safety_centers TO anon;
GRANT ALL ON TABLE public.safety_centers TO authenticated;
GRANT ALL ON TABLE public.safety_centers TO service_role;


--
-- Name: TABLE safety_compliance_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.safety_compliance_events TO anon;
GRANT ALL ON TABLE public.safety_compliance_events TO authenticated;
GRANT ALL ON TABLE public.safety_compliance_events TO service_role;


--
-- Name: TABLE search_analytics_actions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.search_analytics_actions TO service_role;


--
-- Name: TABLE search_analytics_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE public.search_analytics_events TO service_role;


--
-- Name: TABLE search_analytics_guest_subjects; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.search_analytics_guest_subjects TO service_role;


--
-- Name: TABLE storage_locations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.storage_locations TO anon;
GRANT ALL ON TABLE public.storage_locations TO authenticated;
GRANT ALL ON TABLE public.storage_locations TO service_role;


--
-- Name: TABLE user_search_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_search_history TO anon;
GRANT ALL ON TABLE public.user_search_history TO authenticated;
GRANT ALL ON TABLE public.user_search_history TO service_role;


--
-- Name: TABLE voice_query_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.voice_query_feedback TO anon;
GRANT ALL ON TABLE public.voice_query_feedback TO authenticated;
GRANT ALL ON TABLE public.voice_query_feedback TO service_role;


--
-- Name: TABLE waste_log_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.waste_log_items TO service_role;
GRANT SELECT ON TABLE public.waste_log_items TO authenticated;


--
-- Name: TABLE waste_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.waste_logs TO service_role;
GRANT SELECT ON TABLE public.waste_logs TO authenticated;


--
-- Name: TABLE waste_ph_prediction_authorizations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.waste_ph_prediction_authorizations TO service_role;


--
-- Name: TABLE waste_policy_lab_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.waste_policy_lab_overrides TO service_role;
GRANT SELECT ON TABLE public.waste_policy_lab_overrides TO authenticated;


--
-- Name: TABLE waste_policy_streams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.waste_policy_streams TO service_role;
GRANT SELECT ON TABLE public.waste_policy_streams TO authenticated;


--
-- Name: TABLE waste_policy_versions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.waste_policy_versions TO service_role;
GRANT SELECT ON TABLE public.waste_policy_versions TO authenticated;


--
-- Name: TABLE waste_stream_catalog; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.waste_stream_catalog TO service_role;
GRANT SELECT ON TABLE public.waste_stream_catalog TO authenticated;


-- New public objects are intentionally not granted through default
-- privileges. Every later migration must grant Data API access explicitly.

-- Application-owned Storage configuration is data in Supabase's managed
-- schema, so pg_dump --schema-only does not include it. Keep it beside the
-- schema baseline so a blank project has the same buckets and policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('cabinets', 'cabinets', true, null, null),
    ('media-products', 'media-products', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif']::text[]),
    ('products', 'products', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif']::text[]),
    ('safety-center-verifications', 'safety-center-verifications', false, 10485760, array[
        'application/pdf',
        'application/x-hwp',
        'application/haansofthwp',
        'application/vnd.hancom.hwp',
        'application/vnd.hancom.hwpx',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg'
    ]::text[])
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Auth Users Delete" on storage.objects;
create policy "Auth Users Delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'cabinets');

drop policy if exists "Auth Users Insert" on storage.objects;
create policy "Auth Users Insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'cabinets');

drop policy if exists "Auth Users Update" on storage.objects;
create policy "Auth Users Update" on storage.objects
    for update to authenticated
    using (bucket_id = 'cabinets');

drop policy if exists safety_center_verifications_insert_member on storage.objects;
create policy safety_center_verifications_insert_member
    on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'safety-center-verifications'
        and auth.uid()::text = (storage.foldername(name))[1]
        and exists (
            select 1
            from public.safety_center_members scm
            join public.safety_centers sc on sc.id = scm.center_id
            where scm.center_id::text = (storage.foldername(name))[2]
              and scm.user_id = auth.uid()
              and scm.role in ('owner', 'manager')
              and sc.status in ('pending', 'rejected')
        )
    );

drop policy if exists safety_center_verifications_update_member on storage.objects;
create policy safety_center_verifications_update_member
    on storage.objects
    for update to authenticated
    using (
        bucket_id = 'safety-center-verifications'
        and auth.uid()::text = (storage.foldername(name))[1]
        and exists (
            select 1
            from public.safety_center_members scm
            join public.safety_centers sc on sc.id = scm.center_id
            where scm.center_id::text = (storage.foldername(name))[2]
              and scm.user_id = auth.uid()
              and scm.role in ('owner', 'manager')
              and sc.status in ('pending', 'rejected')
        )
    )
    with check (
        bucket_id = 'safety-center-verifications'
        and auth.uid()::text = (storage.foldername(name))[1]
        and exists (
            select 1
            from public.safety_center_members scm
            join public.safety_centers sc on sc.id = scm.center_id
            where scm.center_id::text = (storage.foldername(name))[2]
              and scm.user_id = auth.uid()
              and scm.role in ('owner', 'manager')
              and sc.status in ('pending', 'rejected')
        )
    );

drop policy if exists safety_center_verifications_delete_member on storage.objects;
create policy safety_center_verifications_delete_member
    on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'safety-center-verifications'
        and auth.uid()::text = (storage.foldername(name))[1]
        and exists (
            select 1
            from public.safety_center_members scm
            join public.safety_centers sc on sc.id = scm.center_id
            where scm.center_id::text = (storage.foldername(name))[2]
              and scm.user_id = auth.uid()
              and scm.role in ('owner', 'manager')
              and sc.status in ('pending', 'rejected')
        )
    );


--
-- PostgreSQL database dump complete
--
