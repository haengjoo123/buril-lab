do $$
begin
    if to_regclass('public.feedback') is null then
        raise exception 'public.feedback table does not exist';
    end if;
end
$$;

alter table public.feedback
    add column if not exists status text,
    add column if not exists resolved_at timestamptz,
    add column if not exists resolved_by uuid,
    add column if not exists user_email text,
    add column if not exists updated_at timestamptz;

alter table public.feedback
    alter column status set default 'new';

update public.feedback
set
    status = case
        when status in ('new', 'in_progress', 'resolved') then status
        else 'new'
    end,
    updated_at = coalesce(updated_at, created_at, now())
where status is distinct from case
        when status in ('new', 'in_progress', 'resolved') then status
        else 'new'
    end
   or updated_at is null;

alter table public.feedback
    alter column status set not null;

alter table public.feedback
    alter column updated_at set default now();

alter table public.feedback
    alter column updated_at set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'feedback_status_check'
    ) then
        alter table public.feedback
            add constraint feedback_status_check
            check (status in ('new', 'in_progress', 'resolved'));
    end if;
end
$$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'feedback_resolved_by_fkey'
    ) then
        alter table public.feedback
            add constraint feedback_resolved_by_fkey
            foreign key (resolved_by)
            references auth.users (id)
            on delete set null;
    end if;
end
$$;

create index if not exists feedback_created_at_desc_idx
    on public.feedback (created_at desc);

create index if not exists feedback_status_created_at_desc_idx
    on public.feedback (status, created_at desc);
