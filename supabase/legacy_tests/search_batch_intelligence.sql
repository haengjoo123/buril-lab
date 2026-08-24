-- Transactional integration checks for search/final-batch intelligence.
-- Run after 20260823085224_search_batch_intelligence.sql. The final rollback
-- leaves analytics, waste, guest, and audit data unchanged.

begin;

do $$
declare
    v_guest_id uuid := gen_random_uuid();
    v_guest_event_id uuid := gen_random_uuid();
    v_guest_action_id uuid := gen_random_uuid();
    v_guest_session_id uuid := gen_random_uuid();
    v_audit_before integer;
    v_log_id uuid;
    v_user_id uuid;
    v_lab_id uuid;
    v_bad_lab_id uuid;
    v_line integer;
    v_link_event uuid := gen_random_uuid();
    v_bad_event uuid := gen_random_uuid();
    v_linked uuid;
begin
    if exists (
        select 1
        from public.user_search_history history
        left join public.search_analytics_events event
          on event.source_history_id = history.id
         and event.outcome = 'legacy_success_unknown'
        where event.id is null
    ) then
        raise exception 'one or more legacy search rows were not backfilled';
    end if;
    if exists (
        select 1
        from public.search_analytics_actions action
        join public.search_analytics_events event on event.id = action.event_id
        where event.source_history_id is not null
    ) then
        raise exception 'legacy backfill inferred actions';
    end if;

    if has_table_privilege('anon', 'public.search_analytics_events', 'SELECT')
       or has_table_privilege('authenticated', 'public.search_analytics_events', 'SELECT') then
        raise exception 'browser roles can read raw analytics';
    end if;
    if has_table_privilege('service_role', 'public.search_analytics_actions', 'UPDATE')
       or has_table_privilege('service_role', 'public.search_analytics_actions', 'DELETE') then
        raise exception 'actions are not append-only for the service role';
    end if;
    if has_function_privilege(
        'authenticated', 'public.analytics_admin_summary(integer)', 'EXECUTE'
    ) then
        raise exception 'authenticated can execute an admin analytics RPC';
    end if;
    if not has_function_privilege(
        'service_role', 'public.analytics_admin_summary(integer)', 'EXECUTE'
    ) then
        raise exception 'service role cannot execute an admin analytics RPC';
    end if;
    if not exists (
        select 1 from pg_class
        where oid = 'public.search_analytics_events'::regclass and relrowsecurity
    ) then
        raise exception 'raw search analytics RLS is not enabled';
    end if;
    if jsonb_typeof(public.analytics_admin_summary(30)) <> 'object'
       or jsonb_typeof(public.analytics_admin_search(90, 100, 'demand')) <> 'object'
       or jsonb_typeof(public.analytics_admin_search(90, 100, 'confusion')) <> 'object'
       or jsonb_typeof(public.analytics_admin_mixtures(90, 100)) <> 'object'
       or jsonb_typeof(public.analytics_admin_governance()) <> 'object' then
        raise exception 'an admin analytics RPC returned an invalid payload';
    end if;

    begin
        update public.analytics_commercialization_settings
        set external_product_enabled = true
        where singleton;
        raise exception 'external commercialization gate was mutable';
    exception when check_violation then
        null;
    end;

    select count(*) into v_audit_before
    from public.analytics_deletion_audits;
    insert into public.search_analytics_guest_subjects (id, delete_token_hash)
    values (v_guest_id, repeat('a', 64));
    insert into public.search_analytics_events (
        id, guest_subject_id, session_id, query_sanitized, query_normalized,
        query_type, search_channel, outcome
    ) values (
        v_guest_event_id, v_guest_id, v_guest_session_id,
        'Acetone', 'acetone', 'name', 'manual', 'matched'
    );
    insert into public.search_analytics_actions (
        id, event_id, action_type, target_type
    ) values (
        v_guest_action_id, v_guest_event_id, 'result_selected', 'chemical'
    );
    perform public.analytics_delete_guest_subject(v_guest_id, repeat('a', 64));
    if exists (
        select 1 from public.search_analytics_guest_subjects where id = v_guest_id
    ) then
        raise exception 'guest deletion did not remove the subject';
    end if;
    if (select count(*) from public.analytics_deletion_audits) <> v_audit_before + 1
       or not exists (
            select 1 from public.analytics_deletion_audits
            where subject_type = 'guest'
              and reason = 'guest_request'
              and deleted_event_count = 1
              and deleted_action_count = 1
              and created_at >= transaction_timestamp()
       ) then
        raise exception 'guest deletion was not audited atomically';
    end if;

    select id, user_id, lab_id
    into v_log_id, v_user_id, v_lab_id
    from public.waste_logs
    where user_id is not null
    order by (schema_version = 2) desc, created_at desc
    limit 1;
    if not found then
        raise exception 'no waste-log fixture is available';
    end if;
    select coalesce(max(line_number), 0) + 1 into v_line
    from public.waste_log_items where waste_log_id = v_log_id;

    insert into public.search_analytics_events (
        id, user_id, lab_id, session_id, query_sanitized, query_normalized,
        query_type, search_channel, outcome
    ) values (
        v_link_event, v_user_id, v_lab_id, gen_random_uuid(),
        'Acetone', 'acetone', 'name', 'manual', 'matched'
    );
    insert into public.waste_log_items (
        waste_log_id, line_number, cart_line_id, source_type,
        chemical_name, identity_confidence, ghs_data_status, analysis_snapshot
    ) values (
        v_log_id, v_line, 'analytics-scope-success', 'search',
        'Acetone', 1, 'verified',
        jsonb_build_object('sourceSearchEventId', v_link_event)
    ) returning source_search_event_id into v_linked;
    if v_linked <> v_link_event then
        raise exception 'the valid search provenance link was not materialized';
    end if;

    if v_lab_id is null then
        select id into v_bad_lab_id from public.labs order by id limit 1;
        if v_bad_lab_id is null then
            raise exception 'no alternate lab fixture is available';
        end if;
    else
        v_bad_lab_id := null;
    end if;
    insert into public.search_analytics_events (
        id, user_id, lab_id, session_id, query_sanitized, query_normalized,
        query_type, search_channel, outcome
    ) values (
        v_bad_event, v_user_id, v_bad_lab_id, gen_random_uuid(),
        'Methanol', 'methanol', 'name', 'manual', 'matched'
    );
    begin
        insert into public.waste_log_items (
            waste_log_id, line_number, cart_line_id, source_type,
            chemical_name, identity_confidence, ghs_data_status, analysis_snapshot
        ) values (
            v_log_id, v_line + 1, 'analytics-scope-failure', 'search',
            'Methanol', 1, 'verified',
            jsonb_build_object('sourceSearchEventId', v_bad_event)
        );
        raise exception 'cross-lab search provenance was accepted';
    exception when insufficient_privilege then
        null;
    end;
end;
$$;

rollback;
