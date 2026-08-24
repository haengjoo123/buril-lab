drop policy if exists onboarding_events_select_accessible
    on public.onboarding_events;

create policy onboarding_events_select_own
    on public.onboarding_events
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists onboarding_events_insert_accessible
    on public.onboarding_events;

create policy onboarding_events_insert_own
    on public.onboarding_events
    for insert
    to authenticated
    with check (
        (select auth.uid()) = user_id
        and (
            lab_id is null
            or exists (
                select 1
                from public.lab_members
                where lab_members.lab_id = onboarding_events.lab_id
                  and lab_members.user_id = (select auth.uid())
            )
        )
    );
