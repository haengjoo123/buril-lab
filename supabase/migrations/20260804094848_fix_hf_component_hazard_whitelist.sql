-- The initial HF/fluoride migration updated the decision snapshot whitelist,
-- but the recorder has a second, independently validated hazard list for each
-- component. Patch that component list as well so the server accepts the same
-- HF/fluoride flags that it derives during analysis.

do $patch_record_hf_component_whitelist$
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
                      'HEAVY_METAL', 'REACTIVE', 'UNKNOWN_COMPONENT'
                  )
           ) then
            raise exception 'component hazardFlags contains an unsupported value' using errcode = '22023';
$fragment$;
    v_replacement_fragment := $replacement$
                      'HEAVY_METAL', 'HYDROFLUORIC_ACID', 'FLUORIDE',
                      'REACTIVE', 'UNKNOWN_COMPONENT'
                  )
           ) then
            raise exception 'component hazardFlags contains an unsupported value' using errcode = '22023';
$replacement$;

    if position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected component hazard whitelist was not found'
            using errcode = '55000';
    end if;

    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );
    execute v_function_definition;
end;
$patch_record_hf_component_whitelist$;
