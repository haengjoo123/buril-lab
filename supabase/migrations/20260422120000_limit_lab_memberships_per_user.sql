create index if not exists lab_members_user_id_idx
    on public.lab_members (user_id);

create or replace function public.enforce_lab_creation_membership_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
    membership_count integer;
    max_memberships constant integer := 3;
    owner_user_id uuid;
begin
    owner_user_id := coalesce(new.created_by, auth.uid());

    if owner_user_id is null then
        return new;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(owner_user_id::text, 0));

    select count(*)
    into membership_count
    from public.lab_members lm
    where lm.user_id = owner_user_id;

    if membership_count >= max_memberships then
        raise exception 'max_lab_memberships_exceeded: each account may join up to % labs, including admin-owned labs.', max_memberships
            using errcode = 'P0001',
                  hint = 'Leave or delete another lab before joining or creating a new one.';
    end if;

    return new;
end;
$function$;

create or replace function public.enforce_lab_membership_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
    membership_count integer;
    max_memberships constant integer := 3;
begin
    if new.user_id is null then
        return new;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

    if tg_op = 'UPDATE' then
        select count(*)
        into membership_count
        from public.lab_members lm
        where lm.user_id = new.user_id
          and lm.id <> old.id;
    else
        select count(*)
        into membership_count
        from public.lab_members lm
        where lm.user_id = new.user_id;
    end if;

    if membership_count >= max_memberships then
        raise exception 'max_lab_memberships_exceeded: each account may join up to % labs, including admin-owned labs.', max_memberships
            using errcode = 'P0001',
                  hint = 'Leave or delete another lab before joining or creating a new one.';
    end if;

    return new;
end;
$function$;

drop trigger if exists enforce_lab_creation_membership_limit_before_insert on public.labs;
drop trigger if exists enforce_lab_membership_limit_before_insert_update on public.lab_members;

create trigger enforce_lab_creation_membership_limit_before_insert
before insert on public.labs
for each row
execute function public.enforce_lab_creation_membership_limit();

create trigger enforce_lab_membership_limit_before_insert_update
before insert or update of user_id on public.lab_members
for each row
execute function public.enforce_lab_membership_limit();
