-- A physical container name is the minimum operational destination identifier.
-- Location remains an optional lab-facing aid; it must not block an otherwise
-- safe deposit or require a lab to invent a location value.
--
-- These functions are security-definer RPCs defined by the V2 baseline
-- migration. Recreate their existing definitions after making this narrow
-- validation change so all authorization, snapshot, and transaction checks
-- remain exactly as originally deployed.

do $make_policy_location_optional$
declare
    v_function_definition text;
    v_required_fragment constant text := $fragment$
          nullif(trim(ps.container_label), '') is null
          or nullif(trim(ps.location), '') is null
          or cardinality(ps.prohibitions) < 1
$fragment$;
    v_replacement_fragment constant text := $replacement$
          nullif(trim(ps.container_label), '') is null
          or cardinality(ps.prohibitions) < 1
$replacement$;
begin
    select pg_get_functiondef('public.activate_waste_policy_v2(uuid)'::regprocedure)
    into v_function_definition;

    v_function_definition := replace(v_function_definition, E'\r\n', E'\n');
    if v_function_definition is null
       or position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected location validation was not found in activate_waste_policy_v2'
            using errcode = '55000';
    end if;

    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );
    v_function_definition := replace(
        v_function_definition,
        'Enabled stream % requires container_label, location, prohibitions, and label_requirements',
        'Enabled category % requires container_label, prohibitions, and label_requirements'
    );

    execute v_function_definition;
end;
$make_policy_location_optional$;

do $make_record_location_optional$
declare
    v_function_definition text;
    v_required_fragment constant text := $fragment$
    if v_handling_action = 'container_deposit'
       and (
           nullif(trim(v_stream.container_label), '') is null
           or nullif(trim(v_stream.location), '') is null
       ) then
        raise exception 'A configured container label and location are required for container_deposit'
$fragment$;
    v_replacement_fragment constant text := $replacement$
    if v_handling_action = 'container_deposit'
       and nullif(trim(v_stream.container_label), '') is null then
        raise exception 'A configured container label is required for container_deposit'
$replacement$;
begin
    select pg_get_functiondef('public.record_waste_handling_v2(uuid, jsonb, uuid)'::regprocedure)
    into v_function_definition;

    v_function_definition := replace(v_function_definition, E'\r\n', E'\n');
    if v_function_definition is null
       or position(v_required_fragment in v_function_definition) = 0 then
        raise exception 'Expected location validation was not found in record_waste_handling_v2'
            using errcode = '55000';
    end if;

    v_function_definition := replace(
        v_function_definition,
        v_required_fragment,
        v_replacement_fragment
    );

    execute v_function_definition;
end;
$make_record_location_optional$;
