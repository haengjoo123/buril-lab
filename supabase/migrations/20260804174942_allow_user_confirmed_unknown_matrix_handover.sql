-- A user who explicitly answers that the final batch solvent/form is unknown
-- has completed the wizard question, but no ordinary container may be chosen.
-- Preserve the existing unknown matrix code and promote only that explicit
-- answer to SPECIAL_REVIEW with isolation/handover actions. An unanswered
-- (unresolved/automatic) unknown remains a missing field.

do $patch_user_confirmed_unknown_matrix$
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
    if p_matrix = 'unknown' then
        v_missing_fields := array_append(v_missing_fields, 'matrix');
    end if;
$fragment$;

    v_replacement_fragment := $replacement$
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
$replacement$;

    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception
            'private.analyze_waste_batch_v2 unknown-matrix block did not match the expected definition';
    end if;

    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    if position(v_required_fragment in v_function_definition) > 0
       or position('unknown_matrix_review' in v_function_definition) = 0 then
        raise exception
            'private.analyze_waste_batch_v2 unknown-matrix patch was incomplete';
    end if;

    execute v_function_definition;
end;
$patch_user_confirmed_unknown_matrix$;

revoke all on function private.analyze_waste_batch_v2(jsonb, text, jsonb)
from public, anon, authenticated;

grant execute on function private.analyze_waste_batch_v2(jsonb, text, jsonb)
to service_role;
