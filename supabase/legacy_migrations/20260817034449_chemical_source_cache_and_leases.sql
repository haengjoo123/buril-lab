create table if not exists public.chemical_source_cache (
    id uuid primary key default gen_random_uuid(),
    source text not null,
    record_type text not null,
    lookup_key text not null,
    result_version integer not null,
    cache_status text not null,
    result jsonb not null,
    fetched_at timestamptz not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint chemical_source_cache_lookup_unique
        unique (source, record_type, lookup_key, result_version),
    constraint chemical_source_cache_source_check
        check (source in ('kosha')),
    constraint chemical_source_cache_record_type_check
        check (record_type in ('identity', 'reference_ph')),
    constraint chemical_source_cache_status_check
        check (cache_status in ('complete', 'source_absent')),
    constraint chemical_source_cache_lookup_key_length
        check (char_length(lookup_key) between 1 and 500),
    constraint chemical_source_cache_expiry_check
        check (expires_at > fetched_at),
    constraint chemical_source_cache_result_object_check
        check (jsonb_typeof(result) = 'object')
);

create index if not exists chemical_source_cache_expiry_idx
    on public.chemical_source_cache (expires_at);

create table if not exists public.chemical_enrichment_leases (
    lease_key text not null,
    result_version integer not null,
    owner_token uuid not null,
    lease_until timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (lease_key, result_version),
    constraint chemical_enrichment_leases_key_length
        check (char_length(lease_key) between 1 and 500)
);

create index if not exists chemical_enrichment_leases_expiry_idx
    on public.chemical_enrichment_leases (lease_until);

create or replace function public.try_acquire_chemical_enrichment_lease(
    p_lease_key text,
    p_result_version integer,
    p_owner_token uuid,
    p_lease_seconds integer default 30
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
    acquired_owner uuid;
begin
    if char_length(p_lease_key) not between 1 and 500
        or p_result_version < 1
        or p_lease_seconds not between 1 and 120 then
        raise exception 'invalid chemical enrichment lease input';
    end if;

    insert into public.chemical_enrichment_leases (
        lease_key,
        result_version,
        owner_token,
        lease_until,
        updated_at
    ) values (
        p_lease_key,
        p_result_version,
        p_owner_token,
        now() + make_interval(secs => p_lease_seconds),
        now()
    )
    on conflict (lease_key, result_version) do update
    set owner_token = excluded.owner_token,
        lease_until = excluded.lease_until,
        updated_at = now()
    where public.chemical_enrichment_leases.lease_until <= now()
       or public.chemical_enrichment_leases.owner_token = excluded.owner_token
    returning owner_token into acquired_owner;

    return acquired_owner = p_owner_token;
end;
$$;

create or replace function public.release_chemical_enrichment_lease(
    p_lease_key text,
    p_result_version integer,
    p_owner_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
    with deleted as (
        delete from public.chemical_enrichment_leases
        where lease_key = p_lease_key
          and result_version = p_result_version
          and owner_token = p_owner_token
        returning 1
    )
    select exists(select 1 from deleted);
$$;

alter table public.chemical_source_cache enable row level security;
alter table public.chemical_enrichment_leases enable row level security;

revoke all on table public.chemical_source_cache from public, anon, authenticated;
revoke all on table public.chemical_enrichment_leases from public, anon, authenticated;
grant select, insert, update, delete on table public.chemical_source_cache to service_role;
grant select, insert, update, delete on table public.chemical_enrichment_leases to service_role;

revoke execute on function public.try_acquire_chemical_enrichment_lease(text, integer, uuid, integer)
    from public, anon, authenticated;
revoke execute on function public.release_chemical_enrichment_lease(text, integer, uuid)
    from public, anon, authenticated;
grant execute on function public.try_acquire_chemical_enrichment_lease(text, integer, uuid, integer)
    to service_role;
grant execute on function public.release_chemical_enrichment_lease(text, integer, uuid)
    to service_role;
