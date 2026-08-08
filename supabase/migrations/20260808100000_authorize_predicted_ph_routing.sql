-- A client-side pH display is never sufficient evidence for an irreversible
-- waste-handling record. This short-lived authorization is issued only by the
-- protected server endpoint after it recomputes the pH model, then is bound to
-- the exact normalized RPC component payload.

create table public.waste_ph_prediction_authorizations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    input_fingerprint text not null check (input_fingerprint ~ '^[a-f0-9]{64}$'),
    prediction_snapshot jsonb not null,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null default now(),
    constraint waste_ph_prediction_authorizations_expiry_check
        check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
    constraint waste_ph_prediction_authorizations_prediction_check
        check (
            jsonb_typeof(prediction_snapshot) = 'object'
            and prediction_snapshot->>'status' = 'available'
            and prediction_snapshot->>'confidence' = 'good'
            and jsonb_typeof(prediction_snapshot->'value') = 'number'
            and (prediction_snapshot->>'value')::numeric > 2.2
            and (prediction_snapshot->>'value')::numeric < 12.3
            and jsonb_typeof(prediction_snapshot->'displayValue') = 'number'
            and jsonb_typeof(prediction_snapshot->'ionicStrength') = 'number'
            and jsonb_typeof(coalesce(prediction_snapshot->'issueCodes', '[]'::jsonb)) = 'array'
            and jsonb_array_length(coalesce(prediction_snapshot->'issueCodes', '[]'::jsonb)) = 0
            and nullif(prediction_snapshot->>'modelVersion', '') is not null
            and nullif(prediction_snapshot->>'catalogVersion', '') is not null
            and coalesce(prediction_snapshot->>'inputHash', '') ~ '^[A-Za-z0-9:_-]{8,128}$'
        )
);

alter table public.waste_ph_prediction_authorizations enable row level security;
revoke all on table public.waste_ph_prediction_authorizations from public, anon, authenticated;
grant select, insert, update, delete on table public.waste_ph_prediction_authorizations to service_role;

create index waste_ph_prediction_authorizations_active_idx
    on public.waste_ph_prediction_authorizations (user_id, expires_at)
    where used_at is null;

comment on table public.waste_ph_prediction_authorizations is
    'Server-issued, single-use predicted-pH routing approvals bound to an exact waste RPC payload.';

comment on column public.waste_logs.ph_prediction_snapshot is
    'Audited pH model output. It is never routing evidence by itself; routing requires a separate server-issued authorization.';

-- This helper is intentionally callable by authenticated users: a fingerprint
-- cannot authorize anything by itself. Authorization insertion remains limited
-- to the protected server endpoint using the service role.
create or replace function public.waste_ph_prediction_fingerprint(
    p_components jsonb,
    p_matrix text,
    p_total_amount jsonb,
    p_confirmation jsonb
)
returns text
language sql
immutable
set search_path = pg_catalog, extensions
as $$
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

revoke all on function public.waste_ph_prediction_fingerprint(jsonb, text, jsonb, jsonb)
    from public, anon;
grant execute on function public.waste_ph_prediction_fingerprint(jsonb, text, jsonb, jsonb)
    to authenticated, service_role;

do $patch_predicted_ph_analyzer$
declare
    v_function_definition text;
    v_required_fragment text;
    v_replacement_fragment text;
begin
    select replace(
        pg_get_functiondef('private.analyze_waste_batch_v2(jsonb,text,jsonb)'::regprocedure),
        E'\r\n',
        E'\n'
    ) into v_function_definition;

    v_required_fragment := $fragment$
    v_routing_basis text := 'unresolved';
    v_component_is_hydrofluoric boolean;
$fragment$;
    v_replacement_fragment := $replacement$
    v_routing_basis text := 'unresolved';
    v_approved_predicted_ph jsonb;
    v_predicted_batch_ph numeric;
    v_has_approved_predicted_ph boolean := false;
    v_route_ph numeric;
    v_component_is_hydrofluoric boolean;
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected predicted-pH analyzer declarations were not found' using errcode = '55000';
    end if;
    v_function_definition := replace(v_function_definition, v_required_fragment, v_replacement_fragment);

    v_required_fragment := $fragment$
    end if;

    if p_matrix = 'aqueous' and v_measured_ph_status = 'measured' then
$fragment$;
    v_replacement_fragment := $replacement$
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
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected predicted-pH insertion point was not found' using errcode = '55000';
    end if;
    v_function_definition := replace(v_function_definition, v_required_fragment, v_replacement_fragment);

    v_required_fragment := $fragment$
        elsif p_matrix = 'aqueous' and v_measured_ph_status <> 'measured' then
            v_missing_fields := array_append(v_missing_fields, 'measured_ph');
$fragment$;
    v_replacement_fragment := $replacement$
        elsif p_matrix = 'aqueous'
           and v_measured_ph_status <> 'measured'
           and not v_has_approved_predicted_ph then
            v_missing_fields := array_append(v_missing_fields, 'measured_ph');
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected predicted-pH missing-field gate was not found' using errcode = '55000';
    end if;
    v_function_definition := replace(v_function_definition, v_required_fragment, v_replacement_fragment);

    v_required_fragment := $fragment$
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
$fragment$;
    v_replacement_fragment := $replacement$
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
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected predicted-pH aqueous routing block was not found' using errcode = '55000';
    end if;
    v_function_definition := replace(v_function_definition, v_required_fragment, v_replacement_fragment);

    v_required_fragment := $fragment$
                when p_matrix = 'aqueous'
                     and v_mixing_state = 'already_mixed'
                     and v_measured_ph_status = 'measured'
                    then 'measured_batch_ph'
                when p_matrix not in ('aqueous', 'unknown')
$fragment$;
    v_replacement_fragment := $replacement$
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
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected predicted-pH routing-basis block was not found' using errcode = '55000';
    end if;
    v_function_definition := replace(v_function_definition, v_required_fragment, v_replacement_fragment);

    execute v_function_definition;
end;
$patch_predicted_ph_analyzer$;

do $patch_predicted_ph_record$
declare
    v_function_definition text;
    v_required_fragment text;
    v_replacement_fragment text;
begin
    select replace(
        pg_get_functiondef('public.record_waste_handling_v2(uuid,jsonb,uuid)'::regprocedure),
        E'\r\n',
        E'\n'
    ) into v_function_definition;

    v_required_fragment := $fragment$
    v_institution_policy_count integer;
begin
$fragment$;
    v_replacement_fragment := $replacement$
    v_institution_policy_count integer;
    v_predicted_ph_authorization_id uuid;
    v_predicted_ph_authorization record;
    v_prediction_input_fingerprint text;
    v_analysis_confirmation_snapshot jsonb;
begin
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected predicted-pH record declarations were not found' using errcode = '55000';
    end if;
    v_function_definition := replace(v_function_definition, v_required_fragment, v_replacement_fragment);

    v_required_fragment := $fragment$
        'incidentContext', 'incident_context',
        'alreadyMixed', 'already_mixed'
$fragment$;
    v_replacement_fragment := $replacement$
        'incidentContext', 'incident_context',
        'alreadyMixed', 'already_mixed',
        'predictedPhAuthorizationId', 'predicted_ph_authorization_id'
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected predicted-pH confirmation whitelist was not found' using errcode = '55000';
    end if;
    v_function_definition := replace(v_function_definition, v_required_fragment, v_replacement_fragment);

    v_required_fragment := $fragment$
    v_payload_hash := md5(p_batch::text);
$fragment$;
    v_replacement_fragment := $replacement$
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
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected record payload-hash calculation was not found' using errcode = '55000';
    end if;
    v_function_definition := replace(v_function_definition, v_required_fragment, v_replacement_fragment);

    v_required_fragment := $fragment$
    v_rule_version := coalesce(
$fragment$;
    v_replacement_fragment := $replacement$
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
        select authorization.*
        into v_predicted_ph_authorization
        from public.waste_ph_prediction_authorizations authorization
        where authorization.id = v_predicted_ph_authorization_id
          and authorization.user_id = v_user_id
          and authorization.used_at is null
          and authorization.expires_at > now()
          and authorization.input_fingerprint = v_prediction_input_fingerprint
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
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected predicted-pH authorization insertion point was not found' using errcode = '55000';
    end if;
    v_function_definition := replace(v_function_definition, v_required_fragment, v_replacement_fragment);

    v_required_fragment := $fragment$
    v_server_analysis := private.analyze_waste_batch_v2(
        v_components,
        v_matrix_code,
        v_confirmation_snapshot
    );
$fragment$;
    v_replacement_fragment := $replacement$
    v_server_analysis := private.analyze_waste_batch_v2(
        v_components,
        v_matrix_code,
        v_analysis_confirmation_snapshot
    );
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected predicted-pH analyzer call was not found' using errcode = '55000';
    end if;
    v_function_definition := replace(v_function_definition, v_required_fragment, v_replacement_fragment);

    v_required_fragment := $fragment$
    v_decision_snapshot := v_decision_snapshot || jsonb_build_object(
$fragment$;
    v_replacement_fragment := $replacement$
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
$replacement$;
    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected predicted-pH authorization consumption point was not found' using errcode = '55000';
    end if;
    v_function_definition := replace(v_function_definition, v_required_fragment, v_replacement_fragment);

    execute v_function_definition;
end;
$patch_predicted_ph_record$;

revoke all on function private.analyze_waste_batch_v2(jsonb, text, jsonb)
    from public, anon, authenticated;
