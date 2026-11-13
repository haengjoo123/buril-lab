-- Pickup requests for physical waste containers. Any member of the lab that
-- owns a container can ask for it to be collected; the lab admin sees the
-- request, and a safety center sees it only through an approved link that
-- carries the waste_management scope. Additive: existing container RPCs are
-- unchanged, and a trigger clears a pending request when a container is
-- collected so set_waste_container_status_v1 keeps working as is.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.waste_containers
  add column pickup_requested_at timestamptz,
  add column pickup_requested_by uuid references auth.users(id) on delete set null,
  add column pickup_request_note text,
  add constraint waste_containers_pickup_note_check
    check (pickup_request_note is null or char_length(pickup_request_note) between 1 and 500),
  add constraint waste_containers_pickup_state_check
    check (
      (pickup_requested_at is not null or (pickup_requested_by is null and pickup_request_note is null))
      and (status <> 'collected' or pickup_requested_at is null)
    );

create index waste_containers_pickup_requested_idx
  on public.waste_containers (lab_id, pickup_requested_at)
  where pickup_requested_at is not null;

-- Collection ends a request. Runs before the row constraints are checked.
create function private.clear_waste_container_pickup_on_collect_v1() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'collected' then
    new.pickup_requested_at := null;
    new.pickup_requested_by := null;
    new.pickup_request_note := null;
  end if;
  return new;
end $$;
revoke all on function private.clear_waste_container_pickup_on_collect_v1() from public, anon, authenticated;

create trigger waste_containers_clear_pickup_on_collect_v1
  before update on public.waste_containers
  for each row execute function private.clear_waste_container_pickup_on_collect_v1();

create function private.waste_container_pickup_json_v1(p_container public.waste_containers) returns jsonb
language sql stable set search_path = '' as $$
  select private.waste_container_json_v1(p_container) || jsonb_build_object(
    'pickup_requested_at', p_container.pickup_requested_at,
    'pickup_requested_by', p_container.pickup_requested_by,
    'pickup_request_note', p_container.pickup_request_note
  );
$$;
revoke all on function private.waste_container_pickup_json_v1(public.waste_containers) from public, anon, authenticated;

-- The note is free text and stays out of the audit row; only the state change is recorded.
create function private.audit_waste_container_pickup_v1(p_container public.waste_containers, p_requested boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_from text := case when p_requested then 'none' else 'requested' end;
  v_to text := case when p_requested then 'requested' else 'none' end;
begin
  insert into public.audit_logs(actor_user_id, actor_name, lab_id, entity_type, entity_id, action, location_context, before_data, after_data, diff_data, source)
  values (
    auth.uid(),
    private.actor_display_name_v2(auth.uid(), p_container.lab_id),
    p_container.lab_id,
    'waste_container',
    p_container.id,
    'update',
    p_container.label,
    jsonb_build_object('name', p_container.label, 'pickup', v_from),
    jsonb_build_object('name', p_container.label, 'pickup', v_to),
    jsonb_build_object('pickup', jsonb_build_object('from', v_from, 'to', v_to)),
    'rpc'
  );
end $$;
revoke all on function private.audit_waste_container_pickup_v1(public.waste_containers, boolean) from public, anon, authenticated;

-- Any member of the container's scope may ask. Asking again keeps the first request.
create function public.request_waste_container_pickup_v1(
  p_container_id uuid,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.waste_containers;
  v_container public.waste_containers;
  v_note text := private.clean_waste_container_text_v1(p_note);
begin
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'WASTE_CONTAINER_INVALID_INPUT' using errcode = '22023';
  end if;
  v_before := private.lock_waste_container_v1(p_container_id, true);
  if v_before.status = 'collected' then
    raise exception 'WASTE_CONTAINER_COLLECTED' using errcode = '55000';
  end if;
  if v_before.pickup_requested_at is not null then
    return private.waste_container_pickup_json_v1(v_before);
  end if;
  update public.waste_containers
  set pickup_requested_at = now(),
      pickup_requested_by = auth.uid(),
      pickup_request_note = v_note,
      updated_at = now()
  where id = v_before.id
  returning * into v_container;
  perform private.audit_waste_container_pickup_v1(v_container, true);
  return private.waste_container_pickup_json_v1(v_container);
end $$;
revoke all on function public.request_waste_container_pickup_v1(uuid, text) from public, anon;
grant execute on function public.request_waste_container_pickup_v1(uuid, text) to authenticated, service_role;

-- The member who asked, a lab admin, or the owner of a personal container may withdraw it.
create function public.cancel_waste_container_pickup_v1(p_container_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.waste_containers;
  v_container public.waste_containers;
begin
  v_before := private.lock_waste_container_v1(p_container_id, true);
  if v_before.pickup_requested_at is null then
    return private.waste_container_pickup_json_v1(v_before);
  end if;
  if v_before.lab_id is not null
     and v_before.pickup_requested_by is distinct from auth.uid()
     and not public.is_lab_admin(v_before.lab_id) then
    raise exception 'WASTE_CONTAINER_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  update public.waste_containers
  set pickup_requested_at = null,
      pickup_requested_by = null,
      pickup_request_note = null,
      updated_at = now()
  where id = v_before.id
  returning * into v_container;
  perform private.audit_waste_container_pickup_v1(v_container, false);
  return private.waste_container_pickup_json_v1(v_container);
end $$;
revoke all on function public.cancel_waste_container_pickup_v1(uuid) from public, anon;
grant execute on function public.cancel_waste_container_pickup_v1(uuid) to authenticated, service_role;

-- Containers waiting for pickup in the labs a safety center manages waste for.
-- A caller who is not a member of an approved center, or a link without the
-- waste_management scope, yields no rows.
create function public.get_safety_center_waste_pickups_v1(p_center_id uuid)
returns table (
  container_id uuid,
  lab_id uuid,
  lab_name text,
  stream_code text,
  label text,
  location text,
  capacity_ml numeric,
  status text,
  sealed_at timestamptz,
  pickup_requested_at timestamptz,
  pickup_request_note text,
  deposit_count bigint,
  total_ml numeric,
  has_unknown_amounts boolean
)
language sql stable security definer set search_path = '' as $$
  select
    c.id,
    c.lab_id,
    l.name,
    c.stream_code,
    c.label,
    c.location,
    c.capacity_ml,
    c.status,
    c.sealed_at,
    c.pickup_requested_at,
    c.pickup_request_note,
    t.n_deposits,
    t.n_total_ml,
    t.n_unknown
  from public.safety_center_lab_links scl
  join public.safety_centers sc on sc.id = scl.center_id
  join public.labs l on l.id = scl.lab_id
  join public.waste_containers c on c.lab_id = scl.lab_id
  cross join lateral (
    select
      count(*) as n_deposits,
      coalesce(sum(w.normalized_amount_value) filter (where w.normalized_amount_unit = 'mL' and not w.amount_is_unknown), 0) as n_total_ml,
      coalesce(bool_or(w.amount_is_unknown or w.normalized_amount_value is null), false) as n_unknown
    from public.waste_logs w
    where w.container_id = c.id and w.voided_at is null
  ) t
  where auth.uid() is not null
    and public.is_safety_center_member(p_center_id)
    and scl.center_id = p_center_id
    and sc.status = 'approved'
    and scl.status = 'approved'
    and 'waste_management' = any(scl.scope)
    and c.pickup_requested_at is not null
    and c.status <> 'collected'
  order by c.pickup_requested_at asc, c.id
  limit 500;
$$;
revoke all on function public.get_safety_center_waste_pickups_v1(uuid) from public, anon;
grant execute on function public.get_safety_center_waste_pickups_v1(uuid) to authenticated, service_role;

commit;
