-- Client-side pH predictions are audit context only. They never participate in
-- private.analyze_waste_batch_v2 or in the measured-pH routing decision.
alter table public.waste_logs
    add column if not exists ph_prediction_snapshot jsonb not null default '{}'::jsonb;

alter table public.waste_log_items
    add column if not exists solution_volume_value numeric,
    add column if not exists solution_volume_unit text,
    add column if not exists solution_volume_normalized_ml numeric,
    add column if not exists solution_volume_is_estimate boolean not null default false,
    add column if not exists concentration_basis text,
    add column if not exists density_value numeric,
    add column if not exists density_unit text,
    add column if not exists density_kind text,
    add column if not exists density_temperature_c numeric,
    add column if not exists density_source text,
    add column if not exists density_is_estimate boolean not null default false,
    add column if not exists ph_catalog_id text;

alter table public.waste_logs
    add constraint waste_logs_ph_prediction_snapshot_object_check
    check (
        jsonb_typeof(ph_prediction_snapshot) = 'object'
        and octet_length(ph_prediction_snapshot::text) <= 32768
    );

alter table public.waste_log_items
    add constraint waste_log_items_solution_volume_check
    check (
        (
            solution_volume_value is null
            and solution_volume_unit is null
            and solution_volume_normalized_ml is null
        )
        or (
            solution_volume_value > 0
            and solution_volume_value::text <> 'NaN'
            and solution_volume_unit in ('uL', 'mL', 'L')
            and solution_volume_normalized_ml > 0
            and solution_volume_normalized_ml::text <> 'NaN'
        )
    ),
    add constraint waste_log_items_concentration_basis_check
    check (concentration_basis is null or concentration_basis in ('w_w', 'w_v', 'v_v')),
    add constraint waste_log_items_density_check
    check (
        (
            density_value is null
            and density_unit is null
            and density_kind is null
            and density_temperature_c is null
            and density_source is null
        )
        or (
            density_value > 0
            and density_value::text <> 'NaN'
            and density_unit = 'g/mL'
            and density_kind in ('solution', 'solute')
            and (density_temperature_c is null or density_temperature_c between -100 and 300)
            and (density_source is null or density_source in ('catalog', 'user'))
        )
    );

comment on column public.waste_logs.ph_prediction_snapshot is
    'Non-authoritative client-generated pH prediction audit snapshot; measured pH remains the routing basis.';
comment on column public.waste_log_items.ph_catalog_id is
    'Pinned offline pH catalog identifier for the exact chemical form selected by the user.';

create or replace function private.capture_ph_prediction_audit_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
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
$$;

revoke all on function private.capture_ph_prediction_audit_v1()
    from public, anon, authenticated;

drop trigger if exists capture_ph_prediction_audit_v1 on public.waste_log_items;
create trigger capture_ph_prediction_audit_v1
before insert on public.waste_log_items
for each row execute function private.capture_ph_prediction_audit_v1();
