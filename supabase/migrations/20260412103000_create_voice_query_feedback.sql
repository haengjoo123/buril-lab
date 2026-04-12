create table if not exists public.voice_query_feedback (
    id uuid primary key default gen_random_uuid(),
    raw_input text not null,
    normalized_query text,
    intent text check (intent in ('location', 'expiration', 'remaining', 'disposal')),
    failure_reason text not null check (failure_reason in ('no_match', 'ambiguous', 'user_corrected')),
    correction_text text,
    selected_match_source text check (selected_match_source in ('cabinet_item', 'inventory')),
    selected_match_id uuid,
    metadata jsonb not null default '{}'::jsonb,
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    lab_id uuid references public.labs (id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists voice_query_feedback_user_created_at_idx
    on public.voice_query_feedback (user_id, created_at desc);

create index if not exists voice_query_feedback_lab_created_at_idx
    on public.voice_query_feedback (lab_id, created_at desc);

alter table public.voice_query_feedback enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'voice_query_feedback'
          and policyname = 'voice_query_feedback_select_own'
    ) then
        create policy voice_query_feedback_select_own
            on public.voice_query_feedback
            for select
            to authenticated
            using (auth.uid() = user_id);
    end if;

    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'voice_query_feedback'
          and policyname = 'voice_query_feedback_insert_own'
    ) then
        create policy voice_query_feedback_insert_own
            on public.voice_query_feedback
            for insert
            to authenticated
            with check (
                auth.uid() = coalesce(user_id, auth.uid())
                and (
                    lab_id is null
                    or exists (
                        select 1
                        from public.lab_members
                        where lab_members.lab_id = voice_query_feedback.lab_id
                          and lab_members.user_id = auth.uid()
                    )
                )
            );
    end if;
end
$$;
