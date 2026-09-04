-- Ops7 Contract. Apply only after seven consecutive days prove that the
-- legacy join and generic audit RPCs receive zero calls in production.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $contract_guard$
begin
    if not has_function_privilege(
        'service_role',
        'public.join_lab_server_v1(uuid,uuid,text,text,text,text)',
        'EXECUTE'
    ) or has_function_privilege(
        'authenticated',
        'public.join_lab_server_v1(uuid,uuid,text,text,text,text)',
        'EXECUTE'
    ) then
        raise exception 'The bounded server join path is not in its reviewed Expand state';
    end if;
    if not has_function_privilege(
        'authenticated',
        'public.record_cabinet_activity_v2(uuid,text,text,text,text,uuid)',
        'EXECUTE'
    ) then
        raise exception 'The safe cabinet activity path is not available';
    end if;
    if not has_function_privilege(
        'authenticated',
        'public.join_lab(uuid,text,text)',
        'EXECUTE'
    ) or not has_function_privilege(
        'service_role',
        'public.join_lab(uuid,text,text)',
        'EXECUTE'
    ) or not has_function_privilege(
        'service_role',
        'public.join_lab_with_password(uuid,uuid,text,text,text)',
        'EXECUTE'
    ) or not has_function_privilege(
        'authenticated',
        'public.insert_audit_log_rpc(uuid,text,uuid,text,uuid,text,text,jsonb,jsonb,jsonb,text,uuid)',
        'EXECUTE'
    ) or not has_function_privilege(
        'service_role',
        'public.insert_audit_log_rpc(uuid,text,uuid,text,uuid,text,text,jsonb,jsonb,jsonb,text,uuid)',
        'EXECUTE'
    ) then
        raise exception 'A legacy path was already changed outside the reviewed Contract';
    end if;
    if not has_table_privilege('anon', 'public.audit_logs', 'INSERT')
       or not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')
       or not (select relrowsecurity from pg_catalog.pg_class
                 where oid='public.audit_logs'::regclass)
       or not exists (select 1 from pg_catalog.pg_policy
                 where polrelid='public.audit_logs'::regclass
                   and polname='Users can insert audit_logs for their labs') then
        raise exception 'The legacy audit table boundary was already changed outside the reviewed Contract';
    end if;
end;
$contract_guard$;

revoke all on function public.join_lab(uuid, text, text)
    from public, anon, authenticated, service_role;
revoke all on function public.join_lab_with_password(uuid, uuid, text, text, text)
    from public, anon, authenticated, service_role;
revoke all on function public.insert_audit_log_rpc(
    uuid, text, uuid, text, uuid, text, text, jsonb, jsonb, jsonb, text, uuid
) from public, anon, authenticated, service_role;

-- Audit rows remain readable through their existing tenant RLS policy, but
-- browsers cannot forge, rewrite, or delete them. Reviewed database functions
-- and server-only paths continue to append rows with derived identities.
drop policy if exists "Users can insert audit_logs for their labs" on public.audit_logs;
revoke all on table public.audit_logs from anon, authenticated;
grant select on table public.audit_logs to authenticated;

comment on function public.join_lab(uuid, text, text) is
    'Retired browser join RPC. Ops7 removes every Data API execution grant.';
comment on function public.join_lab_with_password(uuid, uuid, text, text, text) is
    'Retired legacy service helper. Use join_lab_server_v1 through /api/labs/join.';
comment on function public.insert_audit_log_rpc(
    uuid, text, uuid, text, uuid, text, text, jsonb, jsonb, jsonb, text, uuid
) is 'Retired generic audit writer. Use reviewed domain functions that derive audit identity and scope.';

commit;
