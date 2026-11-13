-- Purchase requests for lab reagents, approved by the lab admin, and the
-- recent usage counts the low-stock forecast needs. Any lab member asks; a lab
-- admin approves or rejects and then records ordering and arrival. Clients
-- read and write only through the RPCs below. Additive: no existing object
-- changes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.inventory_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id) on delete cascade,
  item_name text not null,
  brand text,
  product_number text,
  cas_number text,
  quantity integer not null,
  package_size text,
  note text,
  source_inventory_id uuid references public.inventory(id) on delete set null,
  status text not null default 'requested',
  requested_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_purchase_requests_name_check check (char_length(item_name) between 1 and 200),
  constraint inventory_purchase_requests_brand_check check (brand is null or char_length(brand) between 1 and 120),
  constraint inventory_purchase_requests_product_check check (product_number is null or char_length(product_number) between 1 and 120),
  constraint inventory_purchase_requests_cas_check check (cas_number is null or cas_number ~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$'),
  constraint inventory_purchase_requests_quantity_check check (quantity between 1 and 999),
  constraint inventory_purchase_requests_package_check check (package_size is null or char_length(package_size) between 1 and 60),
  constraint inventory_purchase_requests_note_check check (note is null or char_length(note) between 1 and 500),
  constraint inventory_purchase_requests_decision_note_check check (decision_note is null or char_length(decision_note) between 1 and 500),
  constraint inventory_purchase_requests_status_check
    check (status in ('requested', 'approved', 'rejected', 'ordered', 'received', 'cancelled'))
);

comment on table public.inventory_purchase_requests is
  'Reagent purchase requests of a lab. Read and written only through the inventory purchase request RPCs.';

create index inventory_purchase_requests_lab_idx
  on public.inventory_purchase_requests (lab_id, created_at desc);
create index inventory_purchase_requests_open_idx
  on public.inventory_purchase_requests (lab_id, status)
  where status in ('requested', 'approved', 'ordered');
create index inventory_purchase_requests_source_idx
  on public.inventory_purchase_requests (source_inventory_id)
  where source_inventory_id is not null;
create index inventory_purchase_requests_requested_by_idx
  on public.inventory_purchase_requests (requested_by)
  where requested_by is not null;
create index inventory_purchase_requests_decided_by_idx
  on public.inventory_purchase_requests (decided_by)
  where decided_by is not null;

alter table public.inventory_purchase_requests enable row level security;
revoke all on public.inventory_purchase_requests from public, anon, authenticated, service_role;
grant all on public.inventory_purchase_requests to service_role;

create function private.purchase_request_json_v1(p_request public.inventory_purchase_requests) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_request.id,
    'lab_id', p_request.lab_id,
    'item_name', p_request.item_name,
    'brand', p_request.brand,
    'product_number', p_request.product_number,
    'cas_number', p_request.cas_number,
    'quantity', p_request.quantity,
    'package_size', p_request.package_size,
    'note', p_request.note,
    'source_inventory_id', p_request.source_inventory_id,
    'status', p_request.status,
    'requested_by', p_request.requested_by,
    'requester_name', case when p_request.requested_by is null then null
      else private.actor_display_name_v2(p_request.requested_by, p_request.lab_id) end,
    'decided_by', p_request.decided_by,
    'decider_name', case when p_request.decided_by is null then null
      else private.actor_display_name_v2(p_request.decided_by, p_request.lab_id) end,
    'decided_at', p_request.decided_at,
    'decision_note', p_request.decision_note,
    'created_at', p_request.created_at,
    'updated_at', p_request.updated_at
  );
$$;
revoke all on function private.purchase_request_json_v1(public.inventory_purchase_requests) from public, anon, authenticated;

-- Notes are free text and stay out of the audit row; only the item and the state change are recorded.
create function private.audit_purchase_request_v1(
  p_request public.inventory_purchase_requests,
  p_from text,
  p_action text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(actor_user_id, actor_name, lab_id, entity_type, entity_id, action, location_context, before_data, after_data, diff_data, source)
  values (
    auth.uid(),
    private.actor_display_name_v2(auth.uid(), p_request.lab_id),
    p_request.lab_id,
    'purchase_request',
    p_request.id,
    p_action,
    null,
    case when p_from is null then null
      else jsonb_build_object('name', p_request.item_name, 'status', p_from) end,
    jsonb_build_object('name', p_request.item_name, 'status', p_request.status, 'quantity', p_request.quantity),
    case when p_from is null then null
      else jsonb_build_object('status', jsonb_build_object('from', p_from, 'to', p_request.status)) end,
    'rpc'
  );
end $$;
revoke all on function private.audit_purchase_request_v1(public.inventory_purchase_requests, text, text) from public, anon, authenticated;

create function private.clean_purchase_text_v1(p_value text) returns text
language sql immutable set search_path = '' as $$
  select nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_value, '')), '\s+', ' ', 'g'), '');
$$;
revoke all on function private.clean_purchase_text_v1(text) from public, anon, authenticated;

-- Any lab member may ask. Asking again for the same inventory row while an
-- earlier request is still open returns that request instead of a duplicate.
create function public.create_inventory_purchase_request_v1(
  p_lab_id uuid,
  p_item_name text,
  p_quantity integer default 1,
  p_brand text default null,
  p_product_number text default null,
  p_cas_number text default null,
  p_package_size text default null,
  p_note text default null,
  p_source_inventory_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := private.clean_purchase_text_v1(p_item_name);
  v_brand text := private.clean_purchase_text_v1(p_brand);
  v_product text := private.clean_purchase_text_v1(p_product_number);
  v_cas text := private.clean_purchase_text_v1(p_cas_number);
  v_package text := private.clean_purchase_text_v1(p_package_size);
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_existing public.inventory_purchase_requests;
  v_row public.inventory_purchase_requests;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_lab_id is null or not exists (
    select 1 from public.lab_members lm where lm.lab_id = p_lab_id and lm.user_id = auth.uid()
  ) then
    raise exception 'PURCHASE_REQUEST_ACCESS_DENIED' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) > 200
     or p_quantity is null or p_quantity < 1 or p_quantity > 999
     or (v_brand is not null and char_length(v_brand) > 120)
     or (v_product is not null and char_length(v_product) > 120)
     or (v_cas is not null and v_cas !~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$')
     or (v_package is not null and char_length(v_package) > 60)
     or (v_note is not null and char_length(v_note) > 500) then
    raise exception 'PURCHASE_REQUEST_INVALID_INPUT' using errcode = '22023';
  end if;
  if p_source_inventory_id is not null and not exists (
    select 1 from public.inventory i where i.id = p_source_inventory_id and i.lab_id = p_lab_id
  ) then
    raise exception 'PURCHASE_REQUEST_INVALID_INPUT' using errcode = '22023';
  end if;

  if p_source_inventory_id is not null then
    select * into v_existing
    from public.inventory_purchase_requests r
    where r.lab_id = p_lab_id
      and r.source_inventory_id = p_source_inventory_id
      and r.status in ('requested', 'approved', 'ordered')
    order by r.created_at desc
    limit 1;
    if found then
      return private.purchase_request_json_v1(v_existing);
    end if;
  end if;

  insert into public.inventory_purchase_requests
    (lab_id, item_name, brand, product_number, cas_number, quantity, package_size, note, source_inventory_id, requested_by)
  values
    (p_lab_id, v_name, v_brand, v_product, v_cas, p_quantity, v_package, v_note, p_source_inventory_id, auth.uid())
  returning * into v_row;
  perform private.audit_purchase_request_v1(v_row, null, 'insert');
  return private.purchase_request_json_v1(v_row);
end $$;
revoke all on function public.create_inventory_purchase_request_v1(uuid, text, integer, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.create_inventory_purchase_request_v1(uuid, text, integer, text, text, text, text, text, uuid) to authenticated, service_role;

-- Moves a request along. The requester may withdraw a request nobody has
-- decided yet; every other step is the lab admin's.
--   requested -> approved | rejected | cancelled
--   approved  -> ordered | cancelled
--   ordered   -> received | cancelled
create function public.update_inventory_purchase_request_v1(
  p_id uuid,
  p_status text,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.inventory_purchase_requests;
  v_row public.inventory_purchase_requests;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_is_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_before from public.inventory_purchase_requests r where r.id = p_id for update;
  if not found or not exists (
    select 1 from public.lab_members lm where lm.lab_id = v_before.lab_id and lm.user_id = auth.uid()
  ) then
    raise exception 'PURCHASE_REQUEST_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('approved', 'rejected', 'ordered', 'received', 'cancelled')
     or (v_note is not null and char_length(v_note) > 500) then
    raise exception 'PURCHASE_REQUEST_INVALID_INPUT' using errcode = '22023';
  end if;
  if v_before.status = p_status then
    return private.purchase_request_json_v1(v_before);
  end if;
  if not (
    (v_before.status = 'requested' and p_status in ('approved', 'rejected', 'cancelled'))
    or (v_before.status = 'approved' and p_status in ('ordered', 'cancelled'))
    or (v_before.status = 'ordered' and p_status in ('received', 'cancelled'))
  ) then
    raise exception 'PURCHASE_REQUEST_INVALID_TRANSITION' using errcode = '55000';
  end if;

  v_is_admin := public.is_lab_admin(v_before.lab_id);
  if not v_is_admin and not (
    p_status = 'cancelled' and v_before.status = 'requested' and v_before.requested_by = auth.uid()
  ) then
    raise exception 'PURCHASE_REQUEST_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  update public.inventory_purchase_requests
  set status = p_status,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = case when v_note is not null then v_note else decision_note end,
      updated_at = now()
  where id = v_before.id
  returning * into v_row;
  perform private.audit_purchase_request_v1(v_row, v_before.status, 'update');
  return private.purchase_request_json_v1(v_row);
end $$;
revoke all on function public.update_inventory_purchase_request_v1(uuid, text, text) from public, anon;
grant execute on function public.update_inventory_purchase_request_v1(uuid, text, text) to authenticated, service_role;

-- A lab's requests, newest first: every open one, plus closed ones from the
-- last p_closed_days days (0 to 365).
create function public.list_inventory_purchase_requests_v1(p_lab_id uuid, p_closed_days integer default 60)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_closed_days, 60), 0), 365);
begin
  if auth.uid() is null or p_lab_id is null or not exists (
    select 1 from public.lab_members lm where lm.lab_id = p_lab_id and lm.user_id = auth.uid()
  ) then
    raise exception 'PURCHASE_REQUEST_ACCESS_DENIED' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(private.purchase_request_json_v1(r) order by r.created_at desc, r.id)
    from (
      select *
      from public.inventory_purchase_requests r
      where r.lab_id = p_lab_id
        and (r.status in ('requested', 'approved', 'ordered')
             or r.updated_at >= now() - make_interval(days => v_days))
      order by r.created_at desc, r.id
      limit 500
    ) r
  ), '[]'::jsonb);
end $$;
revoke all on function public.list_inventory_purchase_requests_v1(uuid, integer) from public, anon;
grant execute on function public.list_inventory_purchase_requests_v1(uuid, integer) to authenticated, service_role;

-- How many bottles of each inventory row were used up in the last p_days days
-- (1 to 365). A lab id needs membership; null means the caller's personal
-- inventory. Rows already removed at zero are not returned.
create function public.get_inventory_usage_counts_v1(p_lab_id uuid, p_days integer default 180)
returns table (inventory_item_id uuid, used_count bigint, last_used_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 180), 1), 365);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_lab_id is not null and not exists (
    select 1 from public.lab_members lm where lm.lab_id = p_lab_id and lm.user_id = auth.uid()
  ) then
    raise exception 'PURCHASE_REQUEST_ACCESS_DENIED' using errcode = '42501';
  end if;
  return query
    select r.inventory_item_id, count(*), max(r.created_at)
    from public.inventory_usage_completion_receipts r
    join public.inventory i on i.id = r.inventory_item_id
    where r.created_at >= now() - make_interval(days => v_days)
      and (
        (p_lab_id is not null and i.lab_id = p_lab_id)
        or (p_lab_id is null and i.lab_id is null and i.user_id = auth.uid())
      )
    group by r.inventory_item_id;
end $$;
revoke all on function public.get_inventory_usage_counts_v1(uuid, integer) from public, anon;
grant execute on function public.get_inventory_usage_counts_v1(uuid, integer) to authenticated, service_role;

commit;
