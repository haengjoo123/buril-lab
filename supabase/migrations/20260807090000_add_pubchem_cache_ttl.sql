alter table public.ghs_cas_cache
    add column if not exists cache_status text,
    add column if not exists fetched_at timestamptz,
    add column if not exists expires_at timestamptz;

-- Existing rows were written without a freshness policy. Keep them for
-- inspection, but force the new client to revalidate every one of them.
update public.ghs_cas_cache
set cache_status = case
        when (result ->> 'success') = 'true' then 'success'
        else 'transient_error'
    end,
    fetched_at = coalesce(fetched_at, updated_at, created_at, now()),
    expires_at = now(),
    result_version = 1
where cache_status is null
   or fetched_at is null
   or expires_at is null
   or result_version <> 2;

alter table public.ghs_cas_cache
    alter column cache_status set not null,
    alter column fetched_at set not null,
    alter column expires_at set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ghs_cas_cache_status_check'
          and conrelid = 'public.ghs_cas_cache'::regclass
    ) then
        alter table public.ghs_cas_cache
            add constraint ghs_cas_cache_status_check
            check (cache_status in ('success', 'not_found', 'no_ghs', 'transient_error'));
    end if;
end
$$;

create index if not exists ghs_cas_cache_expires_at_idx
    on public.ghs_cas_cache (expires_at);
