create table if not exists public.ghs_cas_cache (
    id uuid primary key default gen_random_uuid(),
    scope_type text not null check (scope_type in ('lab', 'user')),
    scope_id uuid not null,
    cas_number text not null check (cas_number ~ '^\d{1,7}-\d{2}-\d$'),
    result jsonb not null,
    result_version integer not null default 1,
    source text not null default 'pubchem',
    created_by uuid default auth.uid() references auth.users (id) on delete set null,
    updated_by uuid default auth.uid() references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint ghs_cas_cache_scope_unique unique (scope_type, scope_id, cas_number)
);

create index if not exists ghs_cas_cache_lookup_idx
    on public.ghs_cas_cache (scope_type, scope_id, cas_number);

create index if not exists ghs_cas_cache_updated_at_idx
    on public.ghs_cas_cache (updated_at desc);

create index if not exists ghs_cas_cache_created_by_idx
    on public.ghs_cas_cache (created_by);

create index if not exists ghs_cas_cache_updated_by_idx
    on public.ghs_cas_cache (updated_by);

create or replace function public.ghs_cas_cache_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    new.updated_at = now();
    new.updated_by = auth.uid();
    return new;
end;
$$;

drop trigger if exists ghs_cas_cache_before_update on public.ghs_cas_cache;
create trigger ghs_cas_cache_before_update
before update on public.ghs_cas_cache
for each row
execute function public.ghs_cas_cache_set_updated_at();

alter table public.ghs_cas_cache enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'ghs_cas_cache'
          and policyname = 'ghs_cas_cache_select_accessible'
    ) then
        create policy ghs_cas_cache_select_accessible
            on public.ghs_cas_cache
            for select
            to authenticated
            using (
                (
                    scope_type = 'user'
                    and scope_id = (select auth.uid())
                )
                or (
                    scope_type = 'lab'
                    and exists (
                        select 1
                        from public.lab_members
                        where lab_members.lab_id = ghs_cas_cache.scope_id
                          and lab_members.user_id = (select auth.uid())
                    )
                )
            );
    end if;

    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'ghs_cas_cache'
          and policyname = 'ghs_cas_cache_insert_accessible'
    ) then
        create policy ghs_cas_cache_insert_accessible
            on public.ghs_cas_cache
            for insert
            to authenticated
            with check (
                (select auth.uid()) is not null
                and (
                    (
                        scope_type = 'user'
                        and scope_id = (select auth.uid())
                    )
                    or (
                        scope_type = 'lab'
                        and exists (
                            select 1
                            from public.lab_members
                            where lab_members.lab_id = ghs_cas_cache.scope_id
                              and lab_members.user_id = (select auth.uid())
                        )
                    )
                )
            );
    end if;

    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'ghs_cas_cache'
          and policyname = 'ghs_cas_cache_update_accessible'
    ) then
        create policy ghs_cas_cache_update_accessible
            on public.ghs_cas_cache
            for update
            to authenticated
            using (
                (
                    scope_type = 'user'
                    and scope_id = (select auth.uid())
                )
                or (
                    scope_type = 'lab'
                    and exists (
                        select 1
                        from public.lab_members
                        where lab_members.lab_id = ghs_cas_cache.scope_id
                          and lab_members.user_id = (select auth.uid())
                    )
                )
            )
            with check (
                (
                    scope_type = 'user'
                    and scope_id = (select auth.uid())
                )
                or (
                    scope_type = 'lab'
                    and exists (
                        select 1
                        from public.lab_members
                        where lab_members.lab_id = ghs_cas_cache.scope_id
                          and lab_members.user_id = (select auth.uid())
                    )
                )
            );
    end if;
end
$$;

grant select, insert, update on public.ghs_cas_cache to authenticated;
revoke delete on public.ghs_cas_cache from anon, authenticated;
