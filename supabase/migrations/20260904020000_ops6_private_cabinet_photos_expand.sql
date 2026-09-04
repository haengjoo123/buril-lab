-- Ops6 photo Switch, additive half. The public bucket and legacy image_url
-- remain available until every referenced object is copied and verified.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table private.cabinet_image_objects_v1 (
    path text primary key,
    -- Keep immutable ownership evidence after a later account/lab/cabinet
    -- deletion. The deletion worker must detach the live pointer first.
    cabinet_id uuid not null,
    lab_id uuid,
    -- A lab cabinet can predate creator tracking, so its historical user_id
    -- may be null. Personal cabinets must still retain an owning user.
    owner_user_id uuid,
    sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes bigint not null check (size_bytes between 1 and 2097152),
    attached_at timestamptz not null default clock_timestamp(),
    detached_at timestamptz,
    check (lab_id is not null or owner_user_id is not null),
    check (octet_length(path) between 1 and 1024),
    check (detached_at is null or detached_at >= attached_at)
);

create table private.cabinet_image_retention_v1 (
    path text primary key references private.cabinet_image_objects_v1 (path) on delete restrict,
    cabinet_id uuid not null,
    lab_id uuid,
    owner_user_id uuid,
    sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes bigint not null check (size_bytes between 1 and 2097152),
    reason text not null check (reason in ('migration_source', 'replaced', 'removed')),
    retired_at timestamptz not null default clock_timestamp(),
    retain_until timestamptz not null,
    deleted_at timestamptz,
    check (lab_id is not null or owner_user_id is not null),
    check (retain_until >= retired_at + interval '7 days'),
    check (deleted_at is null or deleted_at >= retain_until)
);

alter table private.cabinet_image_objects_v1 enable row level security;
alter table private.cabinet_image_retention_v1 enable row level security;
revoke all on table private.cabinet_image_objects_v1 from public, anon, authenticated, service_role;
revoke all on table private.cabinet_image_retention_v1 from public, anon, authenticated, service_role;

create index cabinet_image_objects_v1_scope_idx
    on private.cabinet_image_objects_v1 (lab_id, owner_user_id, cabinet_id)
    where detached_at is null;
create index cabinet_image_retention_v1_due_idx
    on private.cabinet_image_retention_v1 (retain_until, path)
    where deleted_at is null;

comment on table private.cabinet_image_objects_v1 is
    'Verified WebP metadata for private cabinet paths. Browser roles have no direct access.';
comment on table private.cabinet_image_retention_v1 is
    'Detached and migrated source objects retained for at least seven days before separately approved cleanup.';

create function private.cabinet_photo_prefix_v1(
    p_lab_id uuid,
    p_owner_user_id uuid,
    p_cabinet_id uuid
)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
begin
    if p_cabinet_id is null or (p_lab_id is null and p_owner_user_id is null) then
        raise exception 'Cabinet photo ownership is incomplete' using errcode = '22023';
    end if;
    return case when p_lab_id is null
      then 'users/' || p_owner_user_id::text || '/cabinets/' || p_cabinet_id::text
      else 'labs/' || p_lab_id::text || '/cabinets/' || p_cabinet_id::text
    end;
end;
$function$;

revoke all on function private.cabinet_photo_prefix_v1(uuid, uuid, uuid)
    from public, anon, authenticated, service_role;

create function private.require_cabinet_photo_service_v1()
returns void
language plpgsql
stable
set search_path = ''
as $function$
begin
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
        raise exception 'Service role is required' using errcode = '42501';
    end if;
end;
$function$;

revoke all on function private.require_cabinet_photo_service_v1()
    from public, anon, authenticated, service_role;

create function private.guard_cabinet_photo_delete_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if old.image_path is not null or nullif(old.image_url, '') is not null then
        raise exception 'Detach or migrate the cabinet photo before deleting its cabinet'
          using errcode = '55000';
    end if;
    return old;
end;
$function$;

revoke all on function private.guard_cabinet_photo_delete_v1()
    from public, anon, authenticated, service_role;
create trigger cabinets_guard_private_photo_delete_v1
before delete on public.cabinets
for each row execute function private.guard_cabinet_photo_delete_v1();

create function public.get_cabinet_image_paths_v1(
    p_user_id uuid,
    p_cabinet_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_requested integer;
    v_distinct integer;
    v_accessible integer;
    v_images jsonb;
begin
    perform private.require_cabinet_photo_service_v1();
    v_requested := cardinality(p_cabinet_ids);
    if p_user_id is null or v_requested is null or v_requested < 1 or v_requested > 50
       or array_position(p_cabinet_ids, null) is not null then
        raise exception 'Invalid cabinet image lookup' using errcode = '22023';
    end if;
    select count(distinct cabinet_id) into v_distinct from unnest(p_cabinet_ids) cabinet_id;
    if v_distinct <> v_requested then
        raise exception 'Duplicate cabinet image lookup' using errcode = '22023';
    end if;

    select count(*), jsonb_agg(jsonb_build_object(
        'cabinet_id', c.id,
        'image_path', c.image_path
    ) order by c.id)
      into v_accessible, v_images
      from public.cabinets c
      where c.id = any(p_cabinet_ids)
        and (
          (c.lab_id is not null and exists (
              select 1 from public.lab_members lm
              where lm.lab_id = c.lab_id and lm.user_id = p_user_id
          ))
          or (c.lab_id is null and c.user_id = p_user_id)
        );
    if v_accessible <> v_requested then
        raise exception 'Cabinet image access denied' using errcode = '42501';
    end if;
    return jsonb_build_object('success', true, 'images', coalesce(v_images, '[]'::jsonb));
end;
$function$;

revoke all on function public.get_cabinet_image_paths_v1(uuid, uuid[])
    from public, anon, authenticated;
grant execute on function public.get_cabinet_image_paths_v1(uuid, uuid[])
    to service_role;

create function public.get_cabinet_image_state_v1(
    p_user_id uuid,
    p_cabinet_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_lab_id uuid;
    v_owner_user_id uuid;
    v_image_path text;
    v_legacy_image_pending boolean;
    v_prefix text;
    v_count integer;
begin
    perform private.require_cabinet_photo_service_v1();
    if p_user_id is null or p_cabinet_id is null then
        raise exception 'Invalid cabinet image lookup' using errcode = '22023';
    end if;
    select c.lab_id, c.user_id, c.image_path,
           c.image_path is null and nullif(c.image_url, '') is not null
      into v_lab_id, v_owner_user_id, v_image_path, v_legacy_image_pending
      from public.cabinets c where c.id = p_cabinet_id;
    if not found then
        raise exception 'Cabinet not found' using errcode = 'P0002';
    end if;
    if not (
      (v_lab_id is not null and exists (
          select 1 from public.lab_members lm
          where lm.lab_id = v_lab_id and lm.user_id = p_user_id
      ))
      or (v_lab_id is null and v_owner_user_id = p_user_id)
    ) then
        raise exception 'Cabinet image access denied' using errcode = '42501';
    end if;
    v_prefix := private.cabinet_photo_prefix_v1(v_lab_id, v_owner_user_id, p_cabinet_id);
    select count(*) into v_count from public.cabinets c
      where c.image_path is not null
        and ((v_lab_id is not null and c.lab_id = v_lab_id)
          or (v_lab_id is null and c.lab_id is null and c.user_id = v_owner_user_id));
    return jsonb_build_object(
      'success', true,
      'image_path', v_image_path,
      'legacy_image_pending', v_legacy_image_pending,
      'scope_prefix', v_prefix,
      'referenced_count', v_count,
      'warning', v_count >= 40
    );
end;
$function$;

revoke all on function public.get_cabinet_image_state_v1(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.get_cabinet_image_state_v1(uuid, uuid)
    to service_role;

create function public.set_cabinet_image_path_v1(
    p_user_id uuid,
    p_cabinet_id uuid,
    p_image_path text,
    p_expected_previous_path text,
    p_sha256 text,
    p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_lab_id uuid;
    v_owner_user_id uuid;
    v_previous_path text;
    v_image_url text;
    v_prefix text;
    v_count integer;
    v_reason text;
begin
    perform private.require_cabinet_photo_service_v1();
    if p_user_id is null or p_cabinet_id is null then
        raise exception 'Invalid cabinet image change' using errcode = '22023';
    end if;
    if (p_image_path is null) <> (p_sha256 is null)
       or (p_image_path is null) <> (p_size_bytes is null)
       or (p_image_path is not null and (
          p_sha256 !~ '^[0-9a-f]{64}$' or p_size_bytes not between 1 and 2097152
       )) then
        raise exception 'Invalid cabinet image metadata' using errcode = '22023';
    end if;

    select c.lab_id, c.user_id, c.image_path, c.image_url
      into v_lab_id, v_owner_user_id, v_previous_path, v_image_url
      from public.cabinets c where c.id = p_cabinet_id for update;
    if not found then
        raise exception 'Cabinet not found' using errcode = 'P0002';
    end if;
    if not (
      (v_lab_id is not null and exists (
          select 1 from public.lab_members lm
          where lm.lab_id = v_lab_id and lm.user_id = p_user_id
      ))
      or (v_lab_id is null and v_owner_user_id = p_user_id)
    ) then
        raise exception 'Cabinet image access denied' using errcode = '42501';
    end if;
    if v_previous_path is null and nullif(v_image_url, '') is not null then
        raise exception 'Migrate the legacy cabinet image before changing it'
          using errcode = '55000';
    end if;
    v_prefix := private.cabinet_photo_prefix_v1(v_lab_id, v_owner_user_id, p_cabinet_id);
    perform pg_advisory_xact_lock(hashtextextended('cabinet-photo:' || case
      when v_lab_id is null then 'user:' || v_owner_user_id::text
      else 'lab:' || v_lab_id::text end, 0));

    if v_previous_path is distinct from p_expected_previous_path then
        raise exception 'Cabinet image changed concurrently' using errcode = '40001';
    end if;
    if p_image_path is not null and (
       p_image_path !~ ('^' || v_prefix || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$')
       or octet_length(p_image_path) > 1024
    ) then
        raise exception 'Cabinet image path is outside its ownership scope' using errcode = '22023';
    end if;
    if p_image_path is not null and p_image_path is not distinct from v_previous_path then
        raise exception 'Cabinet image path must be new' using errcode = '22023';
    end if;

    select count(*) into v_count from public.cabinets c
      where c.image_path is not null
        and ((v_lab_id is not null and c.lab_id = v_lab_id)
          or (v_lab_id is null and c.lab_id is null and c.user_id = v_owner_user_id));
    if p_image_path is not null and v_previous_path is null and v_count >= 50 then
        raise exception 'cabinet_image_limit_reached' using errcode = 'P0001';
    end if;

    if p_image_path is not null then
        insert into private.cabinet_image_objects_v1 (
          path, cabinet_id, lab_id, owner_user_id, sha256, size_bytes
        ) values (
          p_image_path, p_cabinet_id, v_lab_id, v_owner_user_id, p_sha256, p_size_bytes
        );
    end if;

    if v_previous_path is not null then
        if not exists (select 1 from private.cabinet_image_objects_v1 o
            where o.path = v_previous_path and o.cabinet_id = p_cabinet_id and o.detached_at is null) then
            raise exception 'Existing cabinet image metadata is unavailable' using errcode = '55000';
        end if;
        v_reason := case when p_image_path is null then 'removed' else 'replaced' end;
        update private.cabinet_image_objects_v1
          set detached_at = clock_timestamp() where path = v_previous_path;
        insert into private.cabinet_image_retention_v1 (
          path, cabinet_id, lab_id, owner_user_id, sha256, size_bytes,
          reason, retired_at, retain_until
        ) select o.path, o.cabinet_id, o.lab_id, o.owner_user_id, o.sha256, o.size_bytes,
          v_reason, clock_timestamp(), clock_timestamp() + interval '7 days'
          from private.cabinet_image_objects_v1 o where o.path = v_previous_path;
    end if;

    update public.cabinets
      set image_path = p_image_path, image_url = null
      where id = p_cabinet_id;
    insert into public.audit_logs (
      actor_user_id, actor_name, lab_id, entity_type, entity_id, action,
      location_context, before_data, after_data, source, request_id
    ) values (
      p_user_id, left(private.actor_display_name_v2(p_user_id, v_lab_id), 200),
      v_lab_id, 'cabinet_photo', p_cabinet_id, 'update', p_cabinet_id::text,
      jsonb_build_object('has_image', v_previous_path is not null),
      jsonb_build_object('has_image', p_image_path is not null),
      'database', gen_random_uuid()
    );
    if p_image_path is not null and v_previous_path is null then v_count := v_count + 1;
    elsif p_image_path is null and v_previous_path is not null then v_count := v_count - 1;
    end if;
    return jsonb_build_object(
      'success', true,
      'previous_path', v_previous_path,
      'image_path', p_image_path,
      'referenced_count', v_count,
      'warning', v_count >= 40
    );
end;
$function$;

revoke all on function public.set_cabinet_image_path_v1(uuid, uuid, text, text, text, bigint)
    from public, anon, authenticated;
grant execute on function public.set_cabinet_image_path_v1(uuid, uuid, text, text, text, bigint)
    to service_role;

create function public.migrate_cabinet_image_path_v1(
    p_cabinet_id uuid,
    p_legacy_path text,
    p_private_path text,
    p_sha256 text,
    p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_lab_id uuid;
    v_owner_user_id uuid;
    v_image_url text;
    v_image_path text;
    v_prefix text;
    v_now timestamptz;
begin
    perform private.require_cabinet_photo_service_v1();
    if p_cabinet_id is null or p_legacy_path is null or p_private_path is null
       or p_sha256 !~ '^[0-9a-f]{64}$' or p_size_bytes not between 1 and 2097152
       or octet_length(p_legacy_path) not between 1 and 1024
       or left(p_legacy_path, 1) = '/'
       or position(chr(92) in p_legacy_path) > 0
       or p_legacy_path ~ '[[:cntrl:]]'
       or p_legacy_path ~ '(^|/)\.\.(/|$)' then
        raise exception 'Invalid cabinet image migration' using errcode = '22023';
    end if;
    select c.lab_id, c.user_id, c.image_url, c.image_path
      into v_lab_id, v_owner_user_id, v_image_url, v_image_path
      from public.cabinets c where c.id = p_cabinet_id for update;
    if not found then raise exception 'Cabinet not found' using errcode = 'P0002'; end if;
    v_prefix := private.cabinet_photo_prefix_v1(v_lab_id, v_owner_user_id, p_cabinet_id);
    if p_private_path !~ ('^' || v_prefix || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$')
       or not coalesce(v_image_url like '%/storage/v1/object/public/cabinets/' || p_legacy_path, false) then
        raise exception 'Cabinet image migration binding is invalid' using errcode = '22023';
    end if;
    if v_image_path is not null and v_image_path <> p_private_path then
        raise exception 'Cabinet image was already migrated differently' using errcode = '40001';
    end if;
    v_now := clock_timestamp();
    insert into private.cabinet_image_objects_v1 (
      path, cabinet_id, lab_id, owner_user_id, sha256, size_bytes, attached_at, detached_at
    ) values
      (p_legacy_path, p_cabinet_id, v_lab_id, v_owner_user_id, p_sha256, p_size_bytes, v_now, v_now),
      (p_private_path, p_cabinet_id, v_lab_id, v_owner_user_id, p_sha256, p_size_bytes, v_now, null)
    on conflict (path) do nothing;
    if not exists (select 1 from private.cabinet_image_objects_v1 o
        where o.path = p_private_path and o.cabinet_id = p_cabinet_id
          and o.sha256 = p_sha256 and o.size_bytes = p_size_bytes and o.detached_at is null)
       or not exists (select 1 from private.cabinet_image_objects_v1 o
        where o.path = p_legacy_path and o.cabinet_id = p_cabinet_id
          and o.sha256 = p_sha256 and o.size_bytes = p_size_bytes and o.detached_at is not null) then
        raise exception 'Cabinet image metadata conflict' using errcode = '23505';
    end if;
    insert into private.cabinet_image_retention_v1 (
      path, cabinet_id, lab_id, owner_user_id, sha256, size_bytes,
      reason, retired_at, retain_until
    ) values (
      p_legacy_path, p_cabinet_id, v_lab_id, v_owner_user_id, p_sha256, p_size_bytes,
      'migration_source', v_now, v_now + interval '7 days'
    ) on conflict (path) do nothing;
    if not exists (select 1 from private.cabinet_image_retention_v1 r
        where r.path = p_legacy_path and r.cabinet_id = p_cabinet_id
          and r.sha256 = p_sha256 and r.size_bytes = p_size_bytes
          and r.reason = 'migration_source' and r.deleted_at is null) then
        raise exception 'Cabinet image retention conflict' using errcode = '23505';
    end if;
    update public.cabinets set image_path = p_private_path where id = p_cabinet_id;
    return jsonb_build_object('success', true, 'migrated', v_image_path is null,
      'image_path', p_private_path, 'legacy_path', p_legacy_path);
end;
$function$;

revoke all on function public.migrate_cabinet_image_path_v1(uuid, text, text, text, bigint)
    from public, anon, authenticated;
grant execute on function public.migrate_cabinet_image_path_v1(uuid, text, text, text, bigint)
    to service_role;

commit;
