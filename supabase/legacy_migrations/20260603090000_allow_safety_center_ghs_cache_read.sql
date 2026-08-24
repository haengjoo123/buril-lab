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
        or (
            scope_type = 'lab'
            and exists (
                select 1
                from public.safety_center_lab_links scl
                join public.safety_centers sc
                  on sc.id = scl.center_id
                join public.safety_center_members scm
                  on scm.center_id = scl.center_id
                where scl.lab_id = ghs_cas_cache.scope_id
                  and scl.status = 'approved'
                  and sc.status = 'approved'
                  and 'risk_detail' = any(scl.scope)
                  and scm.user_id = (select auth.uid())
            )
        )
    );
