-- Applied remotely through the Supabase plugin as migration 20260817010927.
create table if not exists public.chemical_enrichment_cache (
    id uuid primary key default gen_random_uuid(),
    lookup_key text not null,
    result_version integer not null,
    canonical_identity_key text not null,
    cache_status text not null,
    result jsonb not null,
    fetched_at timestamptz not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint chemical_enrichment_cache_lookup_version_unique unique (lookup_key, result_version),
    constraint chemical_enrichment_cache_lookup_key_length check (char_length(lookup_key) between 1 and 500),
    constraint chemical_enrichment_cache_identity_key_length check (char_length(canonical_identity_key) between 1 and 500),
    constraint chemical_enrichment_cache_status_check check (
        cache_status in (
            'complete',
            'classified',
            'not_classified',
            'source_absent',
            'identity_ambiguous',
            'not_found'
        )
    ),
    constraint chemical_enrichment_cache_expiry_check check (expires_at > fetched_at)
);

create index if not exists chemical_enrichment_cache_identity_idx
    on public.chemical_enrichment_cache (canonical_identity_key, result_version);

create index if not exists chemical_enrichment_cache_expiry_idx
    on public.chemical_enrichment_cache (expires_at);

create or replace function public.chemical_enrichment_cache_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists chemical_enrichment_cache_before_update on public.chemical_enrichment_cache;
create trigger chemical_enrichment_cache_before_update
before update on public.chemical_enrichment_cache
for each row execute function public.chemical_enrichment_cache_set_updated_at();

alter table public.chemical_enrichment_cache enable row level security;

revoke all on table public.chemical_enrichment_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.chemical_enrichment_cache to service_role;

revoke execute on function public.chemical_enrichment_cache_set_updated_at() from public, anon, authenticated;
grant execute on function public.chemical_enrichment_cache_set_updated_at() to service_role;
