-- Function to get audit logs specific to a cabinet
create or replace function public.get_cabinet_audit_logs(
    p_cabinet_id uuid,
    p_limit integer default 50
)
returns table (
    id uuid,
    created_at timestamp with time zone,
    actor_user_id uuid,
    actor_name text,
    lab_id uuid,
    entity_type text,
    entity_id uuid,
    action text,
    location_context text,
    before_data jsonb,
    after_data jsonb,
    diff_data jsonb,
    source text,
    request_id uuid
)
language plpgsql security definer
set search_path = public
as $$
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
