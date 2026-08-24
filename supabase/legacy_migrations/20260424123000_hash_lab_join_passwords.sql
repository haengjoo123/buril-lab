-- Store lab join passwords as bcrypt hashes and keep plaintext out of API results.

create extension if not exists pgcrypto with schema extensions;

alter table public.labs
    add column if not exists join_password_hash text;

comment on column public.labs.join_password is
    'Deprecated compatibility column. Values are normalized into join_password_hash by trigger.';

comment on column public.labs.join_password_hash is
    'Bcrypt hash for the optional lab join password.';

update public.labs
set
    join_password_hash = extensions.crypt(join_password, extensions.gen_salt('bf')),
    join_password = null
where nullif(join_password, '') is not null
  and join_password_hash is null;

update public.labs
set join_password = null
where join_password is not null;

create or replace function public.normalize_lab_join_password()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
    if tg_op = 'INSERT' then
        if nullif(new.join_password, '') is null then
            new.join_password_hash := null;
        else
            new.join_password_hash := extensions.crypt(new.join_password, extensions.gen_salt('bf'));
        end if;

        new.join_password := null;
        return new;
    end if;

    if new.join_password is distinct from old.join_password then
        if nullif(new.join_password, '') is null then
            new.join_password_hash := null;
        else
            new.join_password_hash := extensions.crypt(new.join_password, extensions.gen_salt('bf'));
        end if;

        new.join_password := null;
    elsif new.join_password_hash is distinct from old.join_password_hash then
        raise exception 'Use set_lab_join_password to change lab passwords'
            using errcode = '42501';
    end if;

    return new;
end;
$function$;

drop trigger if exists normalize_lab_join_password_before_write on public.labs;

create trigger normalize_lab_join_password_before_write
before insert or update on public.labs
for each row
execute function public.normalize_lab_join_password();

create or replace function public.create_lab_secure(
    p_name text,
    p_password text default null,
    p_nickname text default null,
    p_institution_type text default null,
    p_research_field text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_lab_id uuid;
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    insert into public.labs (
        name,
        join_password,
        created_by,
        institution_type,
        research_field
    ) values (
        p_name,
        nullif(p_password, ''),
        v_user_id,
        nullif(p_institution_type, ''),
        nullif(p_research_field, '')
    )
    returning id into v_lab_id;

    insert into public.lab_members (lab_id, user_id, role, nickname)
    values (v_lab_id, v_user_id, 'admin', nullif(p_nickname, ''));

    return jsonb_build_object(
        'success', true,
        'lab_id', v_lab_id,
        'message', 'Lab successfully created'
    );
exception
    when others then
        return jsonb_build_object(
            'success', false,
            'error', sqlerrm
        );
end;
$function$;

create or replace function public.join_lab(
    p_lab_id uuid,
    p_password text,
    p_nickname text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_lab_id uuid;
    v_password_hash text;
    v_legacy_password text;
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        return jsonb_build_object('success', false, 'error', 'Unauthenticated');
    end if;

    select id, join_password_hash, join_password
    into v_lab_id, v_password_hash, v_legacy_password
    from public.labs
    where id = p_lab_id;

    if v_lab_id is null then
        return jsonb_build_object('success', false, 'error', 'Lab not found');
    end if;

    if v_password_hash is not null then
        if v_password_hash <> extensions.crypt(coalesce(p_password, ''), v_password_hash) then
            return jsonb_build_object('success', false, 'error', 'Incorrect password');
        end if;
    elsif nullif(v_legacy_password, '') is not null then
        if v_legacy_password <> coalesce(p_password, '') then
            return jsonb_build_object('success', false, 'error', 'Incorrect password');
        end if;
    end if;

    if exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = p_lab_id
          and lm.user_id = v_user_id
    ) then
        return jsonb_build_object('success', false, 'error', 'Already a member');
    end if;

    insert into public.lab_members (lab_id, user_id, role, nickname)
    values (p_lab_id, v_user_id, 'student', nullif(p_nickname, ''));

    return jsonb_build_object('success', true, 'lab_id', p_lab_id);
end;
$function$;

create or replace function public.set_lab_join_password(
    target_lab_id uuid,
    p_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
begin
    if auth.uid() is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    if not exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = target_lab_id
          and lm.user_id = auth.uid()
          and lm.role = 'admin'
    ) then
        raise exception 'Only lab admins can change the join password'
            using errcode = '42501';
    end if;

    update public.labs
    set join_password = coalesce(p_password, '')
    where id = target_lab_id;

    if not found then
        raise exception 'Lab not found' using errcode = 'P0002';
    end if;

    return jsonb_build_object('success', true);
end;
$function$;

drop function if exists public.search_labs(text);

create function public.search_labs(search_query text)
returns table(
    id uuid,
    name text,
    created_by uuid,
    created_at timestamp with time zone,
    institution_type text,
    has_password boolean
)
language plpgsql
security definer
set search_path = public
as $function$
begin
    if auth.uid() is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    return query
    select
        l.id,
        l.name,
        l.created_by,
        l.created_at,
        l.institution_type,
        (l.join_password_hash is not null or nullif(l.join_password, '') is not null) as has_password
    from public.labs l
    where l.name ilike '%' || search_query || '%'
    order by l.name asc
    limit 20;
end;
$function$;

revoke all on function public.normalize_lab_join_password() from public, anon, authenticated;
revoke all on function public.create_lab_secure(text, text, text, text, text) from public, anon;
revoke all on function public.join_lab(uuid, text, text) from public, anon;
revoke all on function public.set_lab_join_password(uuid, text) from public, anon;
revoke all on function public.search_labs(text) from public, anon;

grant execute on function public.create_lab_secure(text, text, text, text, text) to authenticated, service_role;
grant execute on function public.join_lab(uuid, text, text) to authenticated, service_role;
grant execute on function public.set_lab_join_password(uuid, text) to authenticated, service_role;
grant execute on function public.search_labs(text) to authenticated, service_role;
