-- Ops8: strengthen new and changed lab join passwords without invalidating
-- any existing password. Existing protected labs are marked for an admin
-- replacement; their current bcrypt value remains accepted until replaced.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.labs
    add column join_password_needs_change boolean not null default false;

comment on column public.labs.join_password_needs_change is
    'True when an existing protected lab has not yet adopted the Ops8 password policy. Informational only; joining remains compatible until an admin replaces or removes the password.';

-- A bcrypt hash cannot reveal the original password length. Conservatively
-- flag every pre-Ops8 protected lab instead of guessing or breaking access.
update public.labs
set join_password_needs_change = true
where join_password_hash is not null
   or nullif(join_password, '') is not null;

create function private.assert_lab_join_password_v1(
    p_lab_name text,
    p_password text
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
    v_password text := coalesce(p_password, '');
    v_lab_name text := btrim(coalesce(p_lab_name, ''));
    v_password_compact text;
    v_lab_compact text;
begin
    -- Empty means an intentionally open lab. Only non-empty passwords are
    -- subject to this policy.
    if v_password = '' then
        return;
    end if;

    if char_length(v_password) < 12 or char_length(v_password) > 128 then
        raise exception 'lab_password_length' using errcode = '22023';
    end if;

    if char_length(v_lab_name) >= 2
       and position(lower(v_lab_name) in lower(v_password)) > 0 then
        raise exception 'lab_password_contains_lab_name' using errcode = '22023';
    end if;

    -- Remove separators while retaining non-Latin letters such as Korean lab
    -- names even when the database runs with a C locale.
    v_password_compact := lower(regexp_replace(v_password, '[[:space:][:punct:]]', '', 'g'));
    v_lab_compact := lower(regexp_replace(v_lab_name, '[[:space:][:punct:]]', '', 'g'));

    if char_length(v_lab_compact) >= 3
       and position(v_lab_compact in v_password_compact) > 0 then
        raise exception 'lab_password_contains_lab_name' using errcode = '22023';
    end if;

    if v_password_compact = '' or v_password_compact = any (array[
        '123456789012',
        '1234567890123',
        '12345678901234',
        '123456789012345',
        '1234567890123456',
        'password1234',
        'password12345',
        'password123456',
        'qwertyuiop12',
        'qwerty123456',
        'letmein123456',
        'welcome123456',
        'admin12345678',
        'administrator',
        'iloveyou12345',
        'changeme1234',
        'burillab1234',
        'researchlab123',
        'laboratory123'
    ]::text[]) then
        raise exception 'lab_password_common' using errcode = '22023';
    end if;
end;
$function$;

revoke all on function private.assert_lab_join_password_v1(text, text)
    from public, anon, authenticated, service_role;
grant execute on function private.assert_lab_join_password_v1(text, text)
    to service_role;

create or replace function public.normalize_lab_join_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_digest text;
begin
    if tg_op = 'INSERT' then
        if new.join_password_hash is not null
           and nullif(new.join_password, '') is null then
            raise exception 'Use a reviewed password writer for lab passwords'
                using errcode = '42501';
        end if;

        if nullif(new.join_password, '') is null then
            new.join_password_hash := null;
            new.join_password_needs_change := false;
        else
            perform private.assert_lab_join_password_v1(new.name, new.join_password);
            v_digest := encode(extensions.digest(convert_to(new.join_password, 'UTF8'), 'sha256'), 'hex');
            new.join_password_hash := 'sha256$' || extensions.crypt(v_digest, extensions.gen_salt('bf'));
            new.join_password_needs_change := false;
        end if;

        new.join_password := null;
        return new;
    end if;

    if new.join_password is distinct from old.join_password then
        if nullif(new.join_password, '') is null then
            new.join_password_hash := null;
            new.join_password_needs_change := false;
        else
            perform private.assert_lab_join_password_v1(new.name, new.join_password);
            v_digest := encode(extensions.digest(convert_to(new.join_password, 'UTF8'), 'sha256'), 'hex');
            new.join_password_hash := 'sha256$' || extensions.crypt(v_digest, extensions.gen_salt('bf'));
            new.join_password_needs_change := false;
        end if;
        new.join_password := null;
    elsif new.join_password_hash is distinct from old.join_password_hash then
        raise exception 'Use set_lab_join_password to change lab passwords'
            using errcode = '42501';
    elsif new.join_password_needs_change is distinct from old.join_password_needs_change then
        raise exception 'Lab password policy state is server managed'
            using errcode = '42501';
    elsif new.name is distinct from old.name and new.join_password_hash is not null then
        -- The hash cannot be compared with the new lab name. Require a fresh
        -- replacement, but continue accepting the existing password.
        new.join_password_needs_change := true;
    end if;

    return new;
end;
$function$;

revoke all on function public.normalize_lab_join_password()
    from public, anon, authenticated, service_role;
grant execute on function public.normalize_lab_join_password()
    to service_role;

create or replace function public.create_lab_secure(
    p_name text,
    p_password text default null,
    p_nickname text default null,
    p_institution_type text default null,
    p_research_field text default null,
    p_institution_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_lab_id uuid;
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    perform private.assert_lab_join_password_v1(p_name, coalesce(p_password, ''));

    insert into public.labs (
        name, join_password, created_by, institution_type, research_field, institution_name
    ) values (
        p_name,
        nullif(p_password, ''),
        v_user_id,
        nullif(p_institution_type, ''),
        nullif(p_research_field, ''),
        nullif(btrim(p_institution_name), '')
    ) returning id into v_lab_id;

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
            'error', sqlerrm,
            'code', case when sqlstate = '22023' then sqlerrm else null end
        );
end;
$function$;

revoke all on function public.create_lab_secure(text, text, text, text, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.create_lab_secure(text, text, text, text, text, text)
    to authenticated, service_role;

create or replace function public.set_lab_join_password(
    target_lab_id uuid,
    p_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_lab_name text;
begin
    if auth.uid() is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    select l.name into v_lab_name
    from public.labs l
    where l.id = target_lab_id
      and exists (
          select 1
          from public.lab_members lm
          where lm.lab_id = l.id
            and lm.user_id = auth.uid()
            and lm.role = 'admin'
      )
    for update;

    if not found then
        if exists (select 1 from public.labs l where l.id = target_lab_id) then
            raise exception 'Only lab admins can change the join password'
                using errcode = '42501';
        end if;
        raise exception 'Lab not found' using errcode = 'P0002';
    end if;

    perform private.assert_lab_join_password_v1(v_lab_name, coalesce(p_password, ''));

    update public.labs
    set join_password = coalesce(p_password, '')
    where id = target_lab_id;

    return jsonb_build_object('success', true, 'password_needs_change', false);
end;
$function$;

revoke all on function public.set_lab_join_password(uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.set_lab_join_password(uuid, text)
    to authenticated, service_role;

commit;
