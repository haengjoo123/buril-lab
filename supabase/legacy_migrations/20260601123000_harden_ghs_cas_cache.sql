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

drop policy if exists ghs_cas_cache_select_accessible on public.ghs_cas_cache;
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

drop policy if exists ghs_cas_cache_insert_accessible on public.ghs_cas_cache;
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

drop policy if exists ghs_cas_cache_update_accessible on public.ghs_cas_cache;
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
