alter table public.labs
    add column if not exists institution_name text;

create index if not exists labs_institution_name_idx
    on public.labs (lower(institution_name))
    where institution_name is not null;

drop function if exists public.create_lab_secure(text, text, text, text, text);

create or replace function public.create_lab_secure(
    p_name text,
    p_password text default null,
    p_nickname text default null,
    p_institution_type text default null,
    p_research_field text default null,
    p_institution_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lab_id uuid;
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    insert into public.labs (
        name,
        join_password,
        created_by,
        institution_type,
        research_field,
        institution_name
    ) values (
        p_name,
        nullif(p_password, ''),
        v_user_id,
        nullif(p_institution_type, ''),
        nullif(p_research_field, ''),
        nullif(trim(p_institution_name), '')
    )
    returning id into v_lab_id;

    insert into public.lab_members (lab_id, user_id, role, nickname)
    values (v_lab_id, v_user_id, 'admin', nullif(p_nickname, ''));

    return jsonb_build_object(
        'success', true,
        'lab_id', v_lab_id,
        'message', 'Lab successfully created'
    );
exception
    when others then
        return jsonb_build_object(
            'success', false,
            'error', sqlerrm
        );
end;
$$;

drop function if exists public.search_labs(text);

create function public.search_labs(search_query text)
returns table(
    id uuid,
    name text,
    created_by uuid,
    created_at timestamp with time zone,
    institution_type text,
    research_field text,
    institution_name text,
    has_password boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Not authenticated';
    end if;

    return query
    select
        l.id,
        l.name,
        l.created_by,
        l.created_at,
        l.institution_type,
        l.research_field,
        l.institution_name,
        (l.join_password_hash is not null or nullif(l.join_password, '') is not null) as has_password
    from public.labs l
    where l.name ilike '%' || search_query || '%'
       or coalesce(l.institution_name, '') ilike '%' || search_query || '%'
    order by l.name asc
    limit 20;
end;
$$;

create table if not exists public.safety_centers (
    id uuid primary key default gen_random_uuid(),
    institution_name text not null,
    institution_domain text not null,
    center_name text not null,
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),
    created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
    approved_by uuid references auth.users (id) on delete set null,
    approved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.safety_center_members (
    id uuid primary key default gen_random_uuid(),
    center_id uuid not null references public.safety_centers (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    role text not null check (role in ('owner', 'manager', 'viewer')),
    joined_at timestamptz not null default now(),
    unique (center_id, user_id)
);

create table if not exists public.safety_center_lab_links (
    id uuid primary key default gen_random_uuid(),
    center_id uuid not null references public.safety_centers (id) on delete cascade,
    lab_id uuid not null references public.labs (id) on delete cascade,
    status text not null default 'requested'
        check (status in ('requested', 'approved', 'rejected', 'revoked')),
    scope text[] not null default array['summary', 'risk_detail', 'exports']::text[],
    requested_by uuid references auth.users (id) on delete set null,
    approved_by uuid references auth.users (id) on delete set null,
    requested_at timestamptz not null default now(),
    responded_at timestamptz,
    updated_at timestamptz not null default now(),
    unique (center_id, lab_id)
);

create table if not exists public.safety_center_requests (
    id uuid primary key default gen_random_uuid(),
    center_id uuid not null references public.safety_centers (id) on delete cascade,
    lab_id uuid not null references public.labs (id) on delete cascade,
    target_type text,
    target_id uuid,
    title text not null,
    description text,
    priority text not null default 'normal'
        check (priority in ('low', 'normal', 'high', 'urgent')),
    status text not null default 'open'
        check (status in ('open', 'in_progress', 'submitted', 'resolved')),
    due_date date,
    created_by uuid default auth.uid() references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.safety_center_request_events (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.safety_center_requests (id) on delete cascade,
    actor_user_id uuid references auth.users (id) on delete set null,
    actor_scope text not null check (actor_scope in ('center', 'lab', 'system')),
    event_type text not null check (event_type in ('created', 'comment', 'status_change')),
    from_status text,
    to_status text,
    body text,
    created_at timestamptz not null default now()
);

create table if not exists public.safety_center_exports (
    id uuid primary key default gen_random_uuid(),
    center_id uuid not null references public.safety_centers (id) on delete cascade,
    user_id uuid default auth.uid() references auth.users (id) on delete set null,
    format text not null check (format in ('xlsx', 'pdf')),
    datasets text[] not null,
    lab_ids uuid[] not null default array[]::uuid[],
    filters jsonb not null default '{}'::jsonb,
    row_count integer not null default 0 check (row_count >= 0),
    created_at timestamptz not null default now()
);

create index if not exists safety_center_members_user_idx
    on public.safety_center_members (user_id, center_id);
create index if not exists safety_center_lab_links_center_idx
    on public.safety_center_lab_links (center_id, status);
create index if not exists safety_center_lab_links_lab_idx
    on public.safety_center_lab_links (lab_id, status);
create index if not exists safety_center_requests_center_idx
    on public.safety_center_requests (center_id, status, created_at desc);
create index if not exists safety_center_requests_lab_idx
    on public.safety_center_requests (lab_id, status, created_at desc);
create index if not exists safety_center_exports_center_idx
    on public.safety_center_exports (center_id, created_at desc);

create or replace function public.safety_center_set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists safety_centers_set_updated_at on public.safety_centers;
create trigger safety_centers_set_updated_at
before update on public.safety_centers
for each row execute function public.safety_center_set_updated_at();

drop trigger if exists safety_center_lab_links_set_updated_at on public.safety_center_lab_links;
create trigger safety_center_lab_links_set_updated_at
before update on public.safety_center_lab_links
for each row execute function public.safety_center_set_updated_at();

drop trigger if exists safety_center_requests_set_updated_at on public.safety_center_requests;
create trigger safety_center_requests_set_updated_at
before update on public.safety_center_requests
for each row execute function public.safety_center_set_updated_at();

create or replace function public.is_safety_center_member(
    target_center_id uuid,
    allowed_roles text[] default null
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1
        from public.safety_center_members scm
        where scm.center_id = target_center_id
          and scm.user_id = auth.uid()
          and (allowed_roles is null or scm.role = any(allowed_roles))
    );
$$;

create or replace function public.is_lab_admin(target_lab_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = target_lab_id
          and lm.user_id = auth.uid()
          and lm.role = 'admin'
    );
$$;

alter table public.safety_centers enable row level security;
alter table public.safety_center_members enable row level security;
alter table public.safety_center_lab_links enable row level security;
alter table public.safety_center_requests enable row level security;
alter table public.safety_center_request_events enable row level security;
alter table public.safety_center_exports enable row level security;

drop policy if exists safety_centers_select_member on public.safety_centers;
create policy safety_centers_select_member
    on public.safety_centers
    for select to authenticated
    using (public.is_safety_center_member(id));

drop policy if exists safety_center_members_select_member on public.safety_center_members;
create policy safety_center_members_select_member
    on public.safety_center_members
    for select to authenticated
    using (public.is_safety_center_member(center_id));

drop policy if exists safety_center_lab_links_select_accessible on public.safety_center_lab_links;
create policy safety_center_lab_links_select_accessible
    on public.safety_center_lab_links
    for select to authenticated
    using (
        public.is_safety_center_member(center_id)
        or public.is_lab_admin(lab_id)
    );

drop policy if exists safety_center_requests_select_accessible on public.safety_center_requests;
create policy safety_center_requests_select_accessible
    on public.safety_center_requests
    for select to authenticated
    using (
        public.is_safety_center_member(center_id)
        or exists (
            select 1
            from public.lab_members lm
            where lm.lab_id = safety_center_requests.lab_id
              and lm.user_id = auth.uid()
        )
    );

drop policy if exists safety_center_request_events_select_accessible on public.safety_center_request_events;
create policy safety_center_request_events_select_accessible
    on public.safety_center_request_events
    for select to authenticated
    using (
        exists (
            select 1
            from public.safety_center_requests r
            where r.id = safety_center_request_events.request_id
              and (
                  public.is_safety_center_member(r.center_id)
                  or exists (
                      select 1
                      from public.lab_members lm
                      where lm.lab_id = r.lab_id
                        and lm.user_id = auth.uid()
                  )
              )
        )
    );

drop policy if exists safety_center_exports_select_member on public.safety_center_exports;
create policy safety_center_exports_select_member
    on public.safety_center_exports
    for select to authenticated
    using (public.is_safety_center_member(center_id));

create or replace function public.create_safety_center(
    p_institution_name text,
    p_institution_domain text,
    p_center_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_email text := coalesce(auth.jwt() ->> 'email', '');
    v_email_domain text := lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2));
    v_center_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if nullif(trim(p_institution_name), '') is null
       or nullif(trim(p_institution_domain), '') is null
       or nullif(trim(p_center_name), '') is null then
        raise exception 'Institution name, domain, and center name are required' using errcode = '22023';
    end if;

    if v_email = '' or v_email_domain <> lower(trim(p_institution_domain)) then
        raise exception 'Safety center registration requires an email from the institution domain' using errcode = '42501';
    end if;

    insert into public.safety_centers (
        institution_name,
        institution_domain,
        center_name,
        status,
        created_by
    ) values (
        trim(p_institution_name),
        lower(trim(p_institution_domain)),
        trim(p_center_name),
        'pending',
        v_user_id
    )
    returning id into v_center_id;

    insert into public.safety_center_members (center_id, user_id, role)
    values (v_center_id, v_user_id, 'owner');

    return v_center_id;
end;
$$;

create or replace function public.get_my_safety_centers()
returns table (
    id uuid,
    institution_name text,
    institution_domain text,
    center_name text,
    status text,
    created_by uuid,
    approved_at timestamptz,
    created_at timestamptz,
    member_role text
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    return query
    select
        sc.id,
        sc.institution_name,
        sc.institution_domain,
        sc.center_name,
        sc.status,
        sc.created_by,
        sc.approved_at,
        sc.created_at,
        scm.role as member_role
    from public.safety_center_members scm
    join public.safety_centers sc on sc.id = scm.center_id
    where scm.user_id = auth.uid()
    order by sc.created_at desc;
end;
$$;

create or replace function public.get_safety_center_lab_candidates(
    p_center_id uuid,
    p_search text default ''
)
returns table (
    lab_id uuid,
    lab_name text,
    institution_name text,
    institution_type text,
    research_field text,
    created_at timestamptz,
    link_id uuid,
    link_status text,
    link_scope text[],
    requested_at timestamptz,
    responded_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_institution_name text;
    v_status text;
    v_search text := '%' || coalesce(trim(p_search), '') || '%';
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    select sc.institution_name, sc.status
    into v_institution_name, v_status
    from public.safety_centers sc
    where sc.id = p_center_id;

    if v_status <> 'approved' then
        return;
    end if;

    return query
    select
        l.id,
        l.name,
        l.institution_name,
        l.institution_type,
        l.research_field,
        l.created_at,
        scl.id,
        scl.status,
        scl.scope,
        scl.requested_at,
        scl.responded_at
    from public.labs l
    left join public.safety_center_lab_links scl
      on scl.center_id = p_center_id
     and scl.lab_id = l.id
    where lower(coalesce(l.institution_name, '')) = lower(v_institution_name)
      and (
          coalesce(trim(p_search), '') = ''
          or l.name ilike v_search
          or coalesce(l.research_field, '') ilike v_search
      )
    order by
        case coalesce(scl.status, 'unlinked')
            when 'approved' then 0
            when 'requested' then 1
            when 'rejected' then 2
            when 'revoked' then 3
            else 4
        end,
        l.name asc
    limit 200;
end;
$$;

create or replace function public.request_safety_center_lab_link(
    p_center_id uuid,
    p_lab_id uuid,
    p_scope text[] default array['summary', 'risk_detail', 'exports']::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_center_status text;
    v_center_institution text;
    v_lab_institution text;
    v_link_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id, array['owner', 'manager']) then
        raise exception 'Only center owners and managers can request lab links' using errcode = '42501';
    end if;

    select sc.status, sc.institution_name
    into v_center_status, v_center_institution
    from public.safety_centers sc
    where sc.id = p_center_id;

    if v_center_status <> 'approved' then
        raise exception 'Safety center must be approved before requesting labs' using errcode = '42501';
    end if;

    select l.institution_name
    into v_lab_institution
    from public.labs l
    where l.id = p_lab_id;

    if lower(coalesce(v_lab_institution, '')) <> lower(v_center_institution) then
        raise exception 'Lab institution does not match this safety center' using errcode = '42501';
    end if;

    insert into public.safety_center_lab_links (
        center_id,
        lab_id,
        status,
        scope,
        requested_by,
        approved_by,
        responded_at
    ) values (
        p_center_id,
        p_lab_id,
        'requested',
        coalesce(p_scope, array['summary', 'risk_detail', 'exports']::text[]),
        v_user_id,
        null,
        null
    )
    on conflict (center_id, lab_id) do update
    set
        status = case
            when public.safety_center_lab_links.status = 'approved' then 'approved'
            else 'requested'
        end,
        scope = excluded.scope,
        requested_by = excluded.requested_by,
        requested_at = now(),
        approved_by = case
            when public.safety_center_lab_links.status = 'approved' then public.safety_center_lab_links.approved_by
            else null
        end,
        responded_at = case
            when public.safety_center_lab_links.status = 'approved' then public.safety_center_lab_links.responded_at
            else null
        end
    returning id into v_link_id;

    return v_link_id;
end;
$$;

create or replace function public.get_lab_safety_center_link_requests(
    p_lab_id uuid
)
returns table (
    link_id uuid,
    center_id uuid,
    center_name text,
    institution_name text,
    institution_domain text,
    center_status text,
    link_status text,
    link_scope text[],
    requested_at timestamptz,
    responded_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_lab_admin(p_lab_id) then
        raise exception 'Only lab admins can view center link requests' using errcode = '42501';
    end if;

    return query
    select
        scl.id,
        sc.id,
        sc.center_name,
        sc.institution_name,
        sc.institution_domain,
        sc.status,
        scl.status,
        scl.scope,
        scl.requested_at,
        scl.responded_at
    from public.safety_center_lab_links scl
    join public.safety_centers sc on sc.id = scl.center_id
    where scl.lab_id = p_lab_id
    order by scl.requested_at desc;
end;
$$;

create or replace function public.respond_safety_center_lab_link(
    p_link_id uuid,
    p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_lab_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if p_status not in ('approved', 'rejected', 'revoked') then
        raise exception 'Unsupported link response status: %', p_status using errcode = '22023';
    end if;

    select scl.lab_id
    into v_lab_id
    from public.safety_center_lab_links scl
    where scl.id = p_link_id;

    if not found then
        raise exception 'Center link not found' using errcode = 'P0002';
    end if;

    if not public.is_lab_admin(v_lab_id) then
        raise exception 'Only lab admins can respond to center links' using errcode = '42501';
    end if;

    update public.safety_center_lab_links
    set
        status = p_status,
        approved_by = case when p_status = 'approved' then v_user_id else approved_by end,
        responded_at = now()
    where id = p_link_id;
end;
$$;

create or replace function public.get_safety_center_risk_items(
    p_center_id uuid
)
returns table (
    source_type text,
    item_id uuid,
    lab_id uuid,
    lab_name text,
    inventory_name text,
    brand text,
    product_number text,
    cas_number text,
    quantity integer,
    capacity text,
    storage_type text,
    cabinet_name text,
    storage_location_name text,
    expiry_date date,
    remaining_percent integer,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    return query
    select
        'inventory'::text,
        i.id,
        i.lab_id,
        l.name,
        i.name,
        i.brand,
        i.product_number,
        i.cas_number,
        i.quantity,
        i.capacity,
        i.storage_type,
        c.name,
        sl.name,
        i.expiry_date,
        i.remaining_percent,
        i.created_at,
        i.updated_at
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.inventory i on i.lab_id = scl.lab_id
    left join public.cabinets c on c.id = i.cabinet_id
    left join public.storage_locations sl on sl.id = i.storage_location_id
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'risk_detail' = any(scl.scope)

    union all

    select
        'cabinet_item'::text,
        ci.id,
        c.lab_id,
        l.name,
        ci.name,
        ci.brand,
        ci.product_number,
        ci.cas_no,
        1,
        ci.capacity,
        'cabinet'::text,
        c.name,
        null::text,
        ci.expiry_date,
        ci.remaining_percent,
        ci.created_at,
        ci.created_at
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.cabinets c on c.lab_id = scl.lab_id
    join public.cabinet_items ci on ci.cabinet_id = c.id
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'risk_detail' = any(scl.scope)
      and ci.inventory_item_id is null
    order by updated_at desc;
end;
$$;

create or replace function public.get_safety_center_waste_logs(
    p_center_id uuid,
    p_created_after timestamptz default null,
    p_created_before timestamptz default null
)
returns table (
    id uuid,
    lab_id uuid,
    lab_name text,
    created_at timestamptz,
    disposal_category text,
    total_volume_ml numeric,
    handler_name text,
    memo text,
    chemicals jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    return query
    select
        wl.id,
        wl.lab_id,
        l.name,
        wl.created_at,
        wl.disposal_category,
        wl.total_volume_ml,
        wl.handler_name,
        wl.memo,
        wl.chemicals
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.waste_logs wl on wl.lab_id = scl.lab_id
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'summary' = any(scl.scope)
      and (p_created_after is null or wl.created_at >= p_created_after)
      and (p_created_before is null or wl.created_at <= p_created_before)
    order by wl.created_at desc
    limit 5000;
end;
$$;

create or replace function public.get_safety_center_audit_logs(
    p_center_id uuid,
    p_limit integer default 100
)
returns table (
    id uuid,
    lab_id uuid,
    lab_name text,
    created_at timestamptz,
    actor_name text,
    entity_type text,
    entity_id uuid,
    action text,
    location_context text,
    before_data jsonb,
    after_data jsonb,
    diff_data jsonb,
    source text
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    return query
    select
        a.id,
        a.lab_id,
        l.name,
        a.created_at,
        a.actor_name,
        a.entity_type,
        a.entity_id,
        a.action,
        a.location_context,
        a.before_data,
        a.after_data,
        a.diff_data,
        a.source
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.audit_logs a on a.lab_id = scl.lab_id
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'summary' = any(scl.scope)
    order by a.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end;
$$;

create or replace function public.get_safety_center_requests(
    p_center_id uuid
)
returns table (
    id uuid,
    center_id uuid,
    lab_id uuid,
    lab_name text,
    target_type text,
    target_id uuid,
    title text,
    description text,
    priority text,
    status text,
    due_date date,
    created_by uuid,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    return query
    select
        r.id,
        r.center_id,
        r.lab_id,
        l.name,
        r.target_type,
        r.target_id,
        r.title,
        r.description,
        r.priority,
        r.status,
        r.due_date,
        r.created_by,
        r.created_at,
        r.updated_at
    from public.safety_center_requests r
    join public.labs l on l.id = r.lab_id
    join public.safety_center_lab_links scl
      on scl.center_id = r.center_id
     and scl.lab_id = r.lab_id
     and scl.status = 'approved'
    where r.center_id = p_center_id
    order by
        case r.status
            when 'open' then 0
            when 'in_progress' then 1
            when 'submitted' then 2
            else 3
        end,
        r.created_at desc;
end;
$$;

create or replace function public.get_lab_safety_center_requests(
    p_lab_id uuid
)
returns table (
    id uuid,
    center_id uuid,
    center_name text,
    lab_id uuid,
    target_type text,
    target_id uuid,
    title text,
    description text,
    priority text,
    status text,
    due_date date,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = auth.uid()
    ) then
        raise exception 'Access denied for lab %', p_lab_id using errcode = '42501';
    end if;

    return query
    select
        r.id,
        r.center_id,
        sc.center_name,
        r.lab_id,
        r.target_type,
        r.target_id,
        r.title,
        r.description,
        r.priority,
        r.status,
        r.due_date,
        r.created_at,
        r.updated_at
    from public.safety_center_requests r
    join public.safety_centers sc on sc.id = r.center_id
    where r.lab_id = p_lab_id
    order by r.created_at desc;
end;
$$;

create or replace function public.create_safety_center_request(
    p_center_id uuid,
    p_lab_id uuid,
    p_title text,
    p_description text default null,
    p_priority text default 'normal',
    p_due_date date default null,
    p_target_type text default null,
    p_target_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_request_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id, array['owner', 'manager']) then
        raise exception 'Only center owners and managers can create requests' using errcode = '42501';
    end if;

    if not exists (
        select 1
        from public.safety_center_lab_links scl
        where scl.center_id = p_center_id
          and scl.lab_id = p_lab_id
          and scl.status = 'approved'
    ) then
        raise exception 'Request target lab is not approved for this center' using errcode = '42501';
    end if;

    insert into public.safety_center_requests (
        center_id,
        lab_id,
        target_type,
        target_id,
        title,
        description,
        priority,
        due_date,
        created_by
    ) values (
        p_center_id,
        p_lab_id,
        nullif(p_target_type, ''),
        p_target_id,
        p_title,
        nullif(p_description, ''),
        coalesce(nullif(p_priority, ''), 'normal'),
        p_due_date,
        v_user_id
    )
    returning id into v_request_id;

    insert into public.safety_center_request_events (
        request_id,
        actor_user_id,
        actor_scope,
        event_type,
        to_status,
        body
    ) values (
        v_request_id,
        v_user_id,
        'center',
        'created',
        'open',
        nullif(p_description, '')
    );

    return v_request_id;
end;
$$;

create or replace function public.add_safety_center_request_event(
    p_request_id uuid,
    p_body text default null,
    p_to_status text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_center_id uuid;
    v_lab_id uuid;
    v_from_status text;
    v_actor_scope text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    select r.center_id, r.lab_id, r.status
    into v_center_id, v_lab_id, v_from_status
    from public.safety_center_requests r
    where r.id = p_request_id;

    if not found then
        raise exception 'Safety center request not found' using errcode = 'P0002';
    end if;

    if public.is_safety_center_member(v_center_id, array['owner', 'manager']) then
        v_actor_scope := 'center';
    elsif exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = v_lab_id
          and lm.user_id = v_user_id
    ) then
        v_actor_scope := 'lab';
    else
        raise exception 'Access denied for request %', p_request_id using errcode = '42501';
    end if;

    if p_to_status is not null and p_to_status not in ('open', 'in_progress', 'submitted', 'resolved') then
        raise exception 'Unsupported request status: %', p_to_status using errcode = '22023';
    end if;

    if p_to_status is not null and p_to_status is distinct from v_from_status then
        update public.safety_center_requests
        set status = p_to_status
        where id = p_request_id;
    end if;

    insert into public.safety_center_request_events (
        request_id,
        actor_user_id,
        actor_scope,
        event_type,
        from_status,
        to_status,
        body
    ) values (
        p_request_id,
        v_user_id,
        v_actor_scope,
        case when p_to_status is not null and p_to_status is distinct from v_from_status then 'status_change' else 'comment' end,
        v_from_status,
        p_to_status,
        nullif(p_body, '')
    );
end;
$$;

create or replace function public.log_safety_center_export(
    p_center_id uuid,
    p_format text,
    p_datasets text[],
    p_lab_ids uuid[] default array[]::uuid[],
    p_filters jsonb default '{}'::jsonb,
    p_row_count integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_export_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id, array['owner', 'manager']) then
        raise exception 'Only center owners and managers can export data' using errcode = '42501';
    end if;

    if p_format not in ('xlsx', 'pdf') then
        raise exception 'Unsupported export format: %', p_format using errcode = '22023';
    end if;

    if exists (
        select 1
        from unnest(coalesce(p_datasets, array[]::text[])) as selected_dataset(dataset_name)
        where selected_dataset.dataset_name not in ('risks', 'waste', 'audit')
    ) then
        raise exception 'Unsupported export dataset' using errcode = '22023';
    end if;

    if coalesce(array_length(p_lab_ids, 1), 0) > 0 and exists (
        select 1
        from unnest(p_lab_ids) requested_lab_id
        where not exists (
            select 1
            from public.safety_center_lab_links scl
            where scl.center_id = p_center_id
              and scl.lab_id = requested_lab_id
              and scl.status = 'approved'
              and 'exports' = any(scl.scope)
        )
    ) then
        raise exception 'Export includes a lab that is not approved for this center' using errcode = '42501';
    end if;

    insert into public.safety_center_exports (
        center_id,
        user_id,
        format,
        datasets,
        lab_ids,
        filters,
        row_count
    ) values (
        p_center_id,
        v_user_id,
        p_format,
        coalesce(p_datasets, array[]::text[]),
        coalesce(p_lab_ids, array[]::uuid[]),
        coalesce(p_filters, '{}'::jsonb),
        greatest(coalesce(p_row_count, 0), 0)
    )
    returning id into v_export_id;

    return v_export_id;
end;
$$;

revoke all on function public.create_safety_center(text, text, text) from public, anon;
revoke all on function public.create_lab_secure(text, text, text, text, text, text) from public, anon;
revoke all on function public.search_labs(text) from public, anon;
revoke all on function public.get_my_safety_centers() from public, anon;
revoke all on function public.get_safety_center_lab_candidates(uuid, text) from public, anon;
revoke all on function public.request_safety_center_lab_link(uuid, uuid, text[]) from public, anon;
revoke all on function public.get_lab_safety_center_link_requests(uuid) from public, anon;
revoke all on function public.respond_safety_center_lab_link(uuid, text) from public, anon;
revoke all on function public.get_safety_center_risk_items(uuid) from public, anon;
revoke all on function public.get_safety_center_waste_logs(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.get_safety_center_audit_logs(uuid, integer) from public, anon;
revoke all on function public.get_safety_center_requests(uuid) from public, anon;
revoke all on function public.get_lab_safety_center_requests(uuid) from public, anon;
revoke all on function public.create_safety_center_request(uuid, uuid, text, text, text, date, text, uuid) from public, anon;
revoke all on function public.add_safety_center_request_event(uuid, text, text) from public, anon;
revoke all on function public.log_safety_center_export(uuid, text, text[], uuid[], jsonb, integer) from public, anon;

grant execute on function public.create_safety_center(text, text, text) to authenticated, service_role;
grant execute on function public.create_lab_secure(text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.search_labs(text) to authenticated, service_role;
grant execute on function public.get_my_safety_centers() to authenticated, service_role;
grant execute on function public.get_safety_center_lab_candidates(uuid, text) to authenticated, service_role;
grant execute on function public.request_safety_center_lab_link(uuid, uuid, text[]) to authenticated, service_role;
grant execute on function public.get_lab_safety_center_link_requests(uuid) to authenticated, service_role;
grant execute on function public.respond_safety_center_lab_link(uuid, text) to authenticated, service_role;
grant execute on function public.get_safety_center_risk_items(uuid) to authenticated, service_role;
grant execute on function public.get_safety_center_waste_logs(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.get_safety_center_audit_logs(uuid, integer) to authenticated, service_role;
grant execute on function public.get_safety_center_requests(uuid) to authenticated, service_role;
grant execute on function public.get_lab_safety_center_requests(uuid) to authenticated, service_role;
grant execute on function public.create_safety_center_request(uuid, uuid, text, text, text, date, text, uuid) to authenticated, service_role;
grant execute on function public.add_safety_center_request_event(uuid, text, text) to authenticated, service_role;
grant execute on function public.log_safety_center_export(uuid, text, text[], uuid[], jsonb, integer) to authenticated, service_role;
