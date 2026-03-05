-- Create audit_logs table
create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    created_at timestamp with time zone default now() not null,
    actor_user_id uuid,
    actor_name text,
    lab_id uuid,
    entity_type text not null, -- 'inventory', 'cabinet_item', 'cabinet', 'waste_log', etc.
    entity_id uuid not null,
    action text not null, -- 'create', 'update', 'delete', 'move', 'bulk_update'
    location_context text, -- e.g. 'cabinet_id/shelf_id/storage_location'
    before_data jsonb,
    after_data jsonb,
    diff_data jsonb,
    source text default 'system', -- 'ui', 'rpc', 'system'
    request_id uuid
);

create index if not exists idx_audit_logs_lab_id on public.audit_logs(lab_id);
create index if not exists idx_audit_logs_entity_type_id on public.audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);

-- Basic RPC for inserting audit log from the frontend or triggering
create or replace function public.insert_audit_log_rpc(
    p_actor_user_id uuid,
    p_actor_name text,
    p_lab_id uuid,
    p_entity_type text,
    p_entity_id uuid,
    p_action text,
    p_location_context text default null,
    p_before_data jsonb default null,
    p_after_data jsonb default null,
    p_diff_data jsonb default null,
    p_source text default 'ui',
    p_request_id uuid default null
) returns void
language plpgsql security definer
set search_path = public
as $$
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
