-- The stable waste category is enough to record a normal deposit. Local
-- container names, colours, and locations are optional guidance for a lab;
-- they are never a condition for policy activation or waste handling.
--
-- Recreate only the two security-definer RPC definitions that contained the
-- old container-label gate. Their authorization and transaction logic is
-- preserved verbatim from the prior V2 migrations.

do $make_policy_container_name_optional$
declare
    v_function_definition text;
    v_required_fragment constant text := $fragment$
      and (
          nullif(trim(ps.container_label), '') is null
          or cardinality(ps.prohibitions) < 1
$fragment$;
    v_replacement_fragment constant text := $replacement$
      and (
          cardinality(ps.prohibitions) < 1
$replacement$;
begin
    select pg_get_functiondef('public.activate_waste_policy_v2(uuid)'::regprocedure)
    into v_function_definition;

    v_function_definition := replace(v_function_definition, E'\r\n', E'\n');
    if v_function_definition is null
       or position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected container-name validation was not found in activate_waste_policy_v2'
            using errcode = '55000';
    end if;

    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );
    v_function_definition := replace(
        v_function_definition,
        'Enabled category % requires container_label, prohibitions, and label_requirements',
        'Enabled category % requires prohibitions and label_requirements'
    );

    execute v_function_definition;
end;
$make_policy_container_name_optional$;

do $make_record_container_name_optional$
declare
    v_function_definition text;
    v_required_fragment constant text := $fragment$
    if v_handling_action = 'container_deposit'
       and nullif(trim(v_stream.container_label), '') is null then
        raise exception 'A configured container label is required for container_deposit'
            using errcode = '22023';
    end if;

$fragment$;
begin
    select pg_get_functiondef('public.record_waste_handling_v2(uuid, jsonb, uuid)'::regprocedure)
    into v_function_definition;

    v_function_definition := replace(v_function_definition, E'\r\n', E'\n');
    if v_function_definition is null
       or position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected container-name validation was not found in record_waste_handling_v2'
            using errcode = '55000';
    end if;

    v_function_definition := replace(v_function_definition, v_required_fragment, '');

    execute v_function_definition;
end;
$make_record_container_name_optional$;
