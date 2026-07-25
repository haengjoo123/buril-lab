create table if not exists public.onboarding_events (
    id uuid primary key default gen_random_uuid(),
    event_type text not null check (
        event_type in (
            'shown',
            'step_completed',
            'skipped',
            'first_value_reached',
            'replayed'
        )
    ),
    step_key text check (
        step_key is null
        or step_key in (
            'search',
            'disposal',
            'cabinet',
            'inventory'
        )
    ),
    source_screen text,
    platform text not null check (platform in ('web', 'native')),
    metadata jsonb not null default '{}'::jsonb,
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    lab_id uuid references public.labs (id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists onboarding_events_user_created_at_idx
    on public.onboarding_events (user_id, created_at desc);

create index if not exists onboarding_events_lab_created_at_idx
    on public.onboarding_events (lab_id, created_at desc)
    where lab_id is not null;

create index if not exists onboarding_events_type_created_at_idx
    on public.onboarding_events (event_type, created_at desc);

create index if not exists onboarding_events_step_created_at_idx
    on public.onboarding_events (step_key, created_at desc)
    where step_key is not null;

alter table public.onboarding_events enable row level security;

grant select, insert on public.onboarding_events to authenticated;
grant select, insert, update, delete on public.onboarding_events to service_role;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'onboarding_events'
          and policyname = 'onboarding_events_select_accessible'
    ) then
        create policy onboarding_events_select_accessible
            on public.onboarding_events
            for select
            to authenticated
            using (
                (select auth.uid()) = user_id
                or (
                    lab_id is not null
                    and exists (
                        select 1
                        from public.lab_members
                        where lab_members.lab_id = onboarding_events.lab_id
                          and lab_members.user_id = (select auth.uid())
                    )
                )
            );
    end if;

    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'onboarding_events'
          and policyname = 'onboarding_events_insert_accessible'
    ) then
        create policy onboarding_events_insert_accessible
            on public.onboarding_events
            for insert
            to authenticated
            with check (
                (select auth.uid()) = coalesce(user_id, (select auth.uid()))
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
    end if;
end
$$;
