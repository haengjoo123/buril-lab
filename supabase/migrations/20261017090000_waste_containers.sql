-- Physical waste containers (폐액통). A lab can keep several containers per
-- waste stream; each container_deposit log may point at exactly one of them.
-- The existing deposit RPCs stay unchanged: the *_to_container_v1 wrappers call
-- them and attach the resulting log in the same transaction, so a rejected
-- container rolls the whole deposit back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.waste_containers (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid references public.labs(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete cascade,
  stream_code text not null references public.waste_stream_catalog(code),
  label text not null,
  location text,
  capacity_ml numeric,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  sealed_at timestamptz,
  sealed_by uuid references auth.users(id) on delete set null,
  collected_at timestamptz,
  collected_by uuid references auth.users(id) on delete set null,
  collection_note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waste_containers_scope_check check ((lab_id is null) = (owner_user_id is not null)),
  constraint waste_containers_label_check check (char_length(btrim(label)) between 1 and 80 and label = btrim(label)),
  constraint waste_containers_location_check check (location is null or char_length(location) between 1 and 200),
  constraint waste_containers_capacity_check check (capacity_ml is null or (capacity_ml > 0 and capacity_ml <= 1000000)),
  constraint waste_containers_note_check check (collection_note is null or char_length(collection_note) between 1 and 500),
  constraint waste_containers_status_check check (
    (status = 'active' and sealed_at is null and collected_at is null)
    or (status = 'sealed' and sealed_at is not null and collected_at is null)
    or (status = 'collected' and collected_at is not null)
  )
);

comment on table public.waste_containers is
  'Physical waste containers. Writes go through the *_waste_container_v1 RPCs; deposits link through waste_logs.container_id; changes are written to audit_logs.';

create unique index waste_containers_lab_open_label_uidx
  on public.waste_containers (lab_id, lower(label))
  where lab_id is not null and status <> 'collected';
create unique index waste_containers_personal_open_label_uidx
  on public.waste_containers (owner_user_id, lower(label))
  where lab_id is null and status <> 'collected';
create index waste_containers_lab_status_idx on public.waste_containers (lab_id, status, stream_code);
create index waste_containers_owner_status_idx on public.waste_containers (owner_user_id, status) where owner_user_id is not null;

alter table public.waste_containers enable row level security;
create policy waste_containers_select_scoped_v1 on public.waste_containers for select to authenticated
using (
  (select auth.uid()) is not null and (
    (lab_id is null and owner_user_id = (select auth.uid()))
    or (lab_id is not null and exists (
      select 1 from public.lab_members lm
      where lm.lab_id = waste_containers.lab_id and lm.user_id = (select auth.uid())
    ))
  )
);
revoke all on public.waste_containers from public, anon, authenticated, service_role;
grant select on public.waste_containers to authenticated;
grant all on public.waste_containers to service_role;

alter table public.waste_logs
  add column container_id uuid references public.waste_containers(id) on delete set null;
create index waste_logs_container_id_idx on public.waste_logs (container_id, created_at) where container_id is not null;

-- Raises unless the caller may act in this scope (lab member, or personal scope).
create function private.require_waste_container_scope_v1(p_lab_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_lab_id is not null and not exists (
    select 1 from public.lab_members lm where lm.lab_id = p_lab_id and lm.user_id = auth.uid()
  ) then
    raise exception 'WASTE_CONTAINER_ACCESS_DENIED' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_waste_container_scope_v1(uuid) from public, anon, authenticated;

-- Checks access before taking any row lock, so outsiders can neither lock a
-- container nor tell an inaccessible id apart from a missing one.
create function private.lock_waste_container_v1(p_container_id uuid, p_exclusive boolean) returns public.waste_containers
language plpgsql security definer set search_path = '' as $$
declare
  v_container public.waste_containers;
begin
  if p_container_id is null then
    raise exception 'container_id is required' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.waste_containers c
    where c.id = p_container_id
      and (
        (c.lab_id is null and c.owner_user_id = auth.uid())
        or (c.lab_id is not null and exists (
          select 1 from public.lab_members lm where lm.lab_id = c.lab_id and lm.user_id = auth.uid()
        ))
      )
  ) then
    raise exception 'WASTE_CONTAINER_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_exclusive then
    select * into v_container from public.waste_containers where id = p_container_id for update;
  else
    select * into v_container from public.waste_containers where id = p_container_id for share;
  end if;
  return v_container;
end $$;
revoke all on function private.lock_waste_container_v1(uuid, boolean) from public, anon, authenticated;

create function private.waste_container_json_v1(p_container public.waste_containers) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_container.id,
    'lab_id', p_container.lab_id,
    'stream_code', p_container.stream_code,
    'label', p_container.label,
    'location', p_container.location,
    'capacity_ml', p_container.capacity_ml,
    'status', p_container.status,
    'started_at', p_container.started_at,
    'sealed_at', p_container.sealed_at,
    'collected_at', p_container.collected_at,
    'collection_note', p_container.collection_note,
    'created_at', p_container.created_at,
    'updated_at', p_container.updated_at
  );
$$;
revoke all on function private.waste_container_json_v1(public.waste_containers) from public, anon, authenticated;

-- Trims and collapses inner whitespace so "유기  1" and "유기 1" are one name.
create function private.clean_waste_container_text_v1(p_value text) returns text
language sql immutable set search_path = '' as $$
  select nullif(pg_catalog.regexp_replace(pg_catalog.btrim(p_value), '\s+', ' ', 'g'), '');
$$;
revoke all on function private.clean_waste_container_text_v1(text) from public, anon, authenticated;

-- Field names follow the existing audit formatter (name, location, capacity, status, memo).
create function private.audit_waste_container_v1(
  p_action text,
  p_before public.waste_containers,
  p_after public.waste_containers
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when p_before.id is null then null else jsonb_build_object(
    'name', p_before.label, 'location', p_before.location, 'capacity', p_before.capacity_ml,
    'status', p_before.status, 'stream_code', p_before.stream_code, 'memo', p_before.collection_note) end;
  v_after jsonb := jsonb_build_object(
    'name', p_after.label, 'location', p_after.location, 'capacity', p_after.capacity_ml,
    'status', p_after.status, 'stream_code', p_after.stream_code, 'memo', p_after.collection_note);
  v_diff jsonb;
begin
  select coalesce(jsonb_object_agg(a.key, jsonb_build_object('from', v_before->a.key, 'to', a.value)), '{}'::jsonb)
  into v_diff
  from jsonb_each(v_after) a
  where v_before is null or v_before->a.key is distinct from a.value;
  insert into public.audit_logs(actor_user_id, actor_name, lab_id, entity_type, entity_id, action, location_context, before_data, after_data, diff_data, source)
  values (
    auth.uid(),
    private.actor_display_name_v2(auth.uid(), p_after.lab_id),
    p_after.lab_id,
    'waste_container',
    p_after.id,
    p_action,
    p_after.label,
    v_before,
    v_after,
    v_diff,
    'rpc'
  );
end $$;
revoke all on function private.audit_waste_container_v1(text, public.waste_containers, public.waste_containers) from public, anon, authenticated;

create function public.create_waste_container_v1(
  p_lab_id uuid,
  p_stream_code text,
  p_label text,
  p_location text default null,
  p_capacity_ml numeric default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_container public.waste_containers;
  v_none public.waste_containers;
  v_label text := private.clean_waste_container_text_v1(p_label);
begin
  perform private.require_waste_container_scope_v1(p_lab_id);
  if v_label is null then
    raise exception 'WASTE_CONTAINER_LABEL_REQUIRED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.waste_stream_catalog s where s.code = p_stream_code) then
    raise exception 'WASTE_CONTAINER_INVALID_INPUT' using errcode = '22023';
  end if;
  begin
    insert into public.waste_containers (lab_id, owner_user_id, stream_code, label, location, capacity_ml, created_by)
    values (
      p_lab_id,
      case when p_lab_id is null then auth.uid() end,
      p_stream_code,
      v_label,
      private.clean_waste_container_text_v1(p_location),
      p_capacity_ml,
      auth.uid()
    )
    returning * into v_container;
  exception
    when unique_violation then
      raise exception 'WASTE_CONTAINER_LABEL_IN_USE' using errcode = '23505';
    when check_violation then
      raise exception 'WASTE_CONTAINER_INVALID_INPUT' using errcode = '22023';
  end;
  perform private.audit_waste_container_v1('create', v_none, v_container);
  return private.waste_container_json_v1(v_container);
end $$;
revoke all on function public.create_waste_container_v1(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.create_waste_container_v1(uuid, text, text, text, numeric) to authenticated, service_role;

create function public.update_waste_container_v1(
  p_container_id uuid,
  p_label text,
  p_location text default null,
  p_capacity_ml numeric default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.waste_containers;
  v_container public.waste_containers;
  v_label text := private.clean_waste_container_text_v1(p_label);
begin
  v_before := private.lock_waste_container_v1(p_container_id, true);
  if v_before.status = 'collected' then
    raise exception 'WASTE_CONTAINER_COLLECTED' using errcode = '55000';
  end if;
  if v_label is null then
    raise exception 'WASTE_CONTAINER_LABEL_REQUIRED' using errcode = '22023';
  end if;
  begin
    update public.waste_containers
    set label = v_label,
        location = private.clean_waste_container_text_v1(p_location),
        capacity_ml = p_capacity_ml,
        updated_at = now()
    where id = v_before.id
    returning * into v_container;
  exception
    when unique_violation then
      raise exception 'WASTE_CONTAINER_LABEL_IN_USE' using errcode = '23505';
    when check_violation then
      raise exception 'WASTE_CONTAINER_INVALID_INPUT' using errcode = '22023';
  end;
  perform private.audit_waste_container_v1('update', v_before, v_container);
  return private.waste_container_json_v1(v_container);
end $$;
revoke all on function public.update_waste_container_v1(uuid, text, text, numeric) from public, anon;
grant execute on function public.update_waste_container_v1(uuid, text, text, numeric) to authenticated, service_role;

-- active -> sealed -> collected, sealed -> active (reopen), active -> collected.
-- Collection is final, so in a lab only an admin may record it.
create function public.set_waste_container_status_v1(
  p_container_id uuid,
  p_status text,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.waste_containers;
  v_container public.waste_containers;
  v_note text := private.clean_waste_container_text_v1(p_note);
begin
  if p_status is null or p_status not in ('active', 'sealed', 'collected') then
    raise exception 'WASTE_CONTAINER_INVALID_TRANSITION' using errcode = '22023';
  end if;
  v_before := private.lock_waste_container_v1(p_container_id, true);
  if p_status = v_before.status then
    return private.waste_container_json_v1(v_before);
  end if;
  if not (
    (v_before.status = 'active' and p_status in ('sealed', 'collected'))
    or (v_before.status = 'sealed' and p_status in ('active', 'collected'))
  ) then
    raise exception 'WASTE_CONTAINER_INVALID_TRANSITION' using errcode = '55000';
  end if;
  if p_status = 'collected' and v_before.lab_id is not null and not public.is_lab_admin(v_before.lab_id) then
    raise exception 'WASTE_CONTAINER_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  begin
    update public.waste_containers
    set status = p_status,
        sealed_at = case when p_status = 'sealed' then now() when p_status = 'active' then null else sealed_at end,
        sealed_by = case when p_status = 'sealed' then auth.uid() when p_status = 'active' then null else sealed_by end,
        collected_at = case when p_status = 'collected' then now() else null end,
        collected_by = case when p_status = 'collected' then auth.uid() else null end,
        collection_note = case when p_status = 'collected' then left(v_note, 500) else null end,
        updated_at = now()
    where id = v_before.id
    returning * into v_container;
  exception when unique_violation then
    raise exception 'WASTE_CONTAINER_LABEL_IN_USE' using errcode = '23505';
  end;
  perform private.audit_waste_container_v1('update', v_before, v_container);
  return private.waste_container_json_v1(v_container);
end $$;
revoke all on function public.set_waste_container_status_v1(uuid, text, text) from public, anon;
grant execute on function public.set_waste_container_status_v1(uuid, text, text) to authenticated, service_role;

-- Attaches a freshly recorded (or idempotently replayed) deposit to a container.
create function private.attach_waste_log_container_v1(p_receipt jsonb, p_container_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_container public.waste_containers;
  v_log public.waste_logs;
begin
  -- A shared lock lets deposits run side by side but waits for a seal or collection.
  v_container := private.lock_waste_container_v1(p_container_id, false);
  select * into v_log from public.waste_logs where id = (p_receipt->>'id')::uuid for update;
  if not found then
    raise exception 'Waste log was not recorded' using errcode = 'P0002';
  end if;
  if v_log.container_id is not null then
    if v_log.container_id <> v_container.id then
      raise exception 'WASTE_CONTAINER_ALREADY_RECORDED' using errcode = '23505';
    end if;
  else
    if v_log.handling_action is distinct from 'container_deposit' or v_log.decision_status is distinct from 'ready' then
      raise exception 'WASTE_CONTAINER_REQUIRES_READY_DEPOSIT' using errcode = '22023';
    end if;
    if v_log.voided_at is not null then
      raise exception 'WASTE_CONTAINER_LOG_VOIDED' using errcode = '22023';
    end if;
    if v_log.lab_id is distinct from v_container.lab_id
       or (v_container.lab_id is null and v_log.user_id is distinct from v_container.owner_user_id) then
      raise exception 'WASTE_CONTAINER_SCOPE_MISMATCH' using errcode = '42501';
    end if;
    if v_log.stream_code is distinct from v_container.stream_code then
      raise exception 'WASTE_CONTAINER_STREAM_MISMATCH' using errcode = '22023';
    end if;
    if v_container.status <> 'active' then
      raise exception 'WASTE_CONTAINER_NOT_ACTIVE' using errcode = '55000';
    end if;
    -- An earlier deposit replayed by request id cannot be moved into a newer container.
    if v_log.created_at < v_container.started_at then
      raise exception 'WASTE_CONTAINER_LOG_PREDATES_CONTAINER' using errcode = '22023';
    end if;
    update public.waste_logs set container_id = v_container.id where id = v_log.id;
  end if;
  return p_receipt || jsonb_build_object(
    'container_id', v_container.id,
    'containerId', v_container.id,
    'container', private.waste_container_json_v1(v_container)
  );
end $$;
revoke all on function private.attach_waste_log_container_v1(jsonb, uuid) from public, anon, authenticated;

create function public.record_waste_deposit_to_container_v1(
  p_request_id uuid,
  p_batch jsonb,
  p_lab_id uuid,
  p_container_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_container_id is null then
    raise exception 'container_id is required' using errcode = '22023';
  end if;
  return private.attach_waste_log_container_v1(
    public.record_waste_handling_v2(p_request_id, p_batch, p_lab_id),
    p_container_id
  );
end $$;
revoke all on function public.record_waste_deposit_to_container_v1(uuid, jsonb, uuid, uuid) from public, anon;
grant execute on function public.record_waste_deposit_to_container_v1(uuid, jsonb, uuid, uuid) to authenticated, service_role;

create function public.record_inventory_disposal_to_container_v1(
  p_request_id uuid,
  p_items jsonb,
  p_batch jsonb,
  p_lab_id uuid,
  p_actor_name text,
  p_container_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_container_id is null then
    raise exception 'container_id is required' using errcode = '22023';
  end if;
  return private.attach_waste_log_container_v1(
    public.record_inventory_disposal_v2(p_request_id, p_items, p_batch, p_lab_id, p_actor_name),
    p_container_id
  );
end $$;
revoke all on function public.record_inventory_disposal_to_container_v1(uuid, jsonb, jsonb, uuid, text, uuid) from public, anon;
grant execute on function public.record_inventory_disposal_to_container_v1(uuid, jsonb, jsonb, uuid, text, uuid) to authenticated, service_role;

-- Deposit counts and recorded volume per container. SECURITY INVOKER: the
-- caller's waste_logs RLS decides which rows count.
create function public.get_waste_container_totals_v1(p_container_ids uuid[])
returns table (container_id uuid, deposit_count bigint, total_ml numeric, total_mg numeric, has_unknown_amounts boolean)
language sql stable security invoker set search_path = '' as $$
  select
    w.container_id,
    count(*) as deposit_count,
    coalesce(sum(w.normalized_amount_value) filter (where w.normalized_amount_unit = 'mL' and not w.amount_is_unknown), 0) as total_ml,
    coalesce(sum(w.normalized_amount_value) filter (where w.normalized_amount_unit = 'mg' and not w.amount_is_unknown), 0) as total_mg,
    bool_or(w.amount_is_unknown or w.normalized_amount_value is null) as has_unknown_amounts
  from public.waste_logs w
  where w.container_id = any(p_container_ids)
    and w.voided_at is null
    and pg_catalog.cardinality(p_container_ids) <= 500
  group by w.container_id;
$$;
revoke all on function public.get_waste_container_totals_v1(uuid[]) from public, anon;
grant execute on function public.get_waste_container_totals_v1(uuid[]) to authenticated, service_role;

commit;
