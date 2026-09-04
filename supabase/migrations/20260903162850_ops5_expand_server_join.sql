-- Ops5 Expand: add the server join path without changing the old clients.
-- Do not replace join_lab, password normalization, existing grants, or storage
-- policies here. Password changes belong to Ops8, legacy revocation to Ops7.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Keep image_url during Expand. The private-storage Switch will backfill this
-- path and only then stop serving the public URL.
alter table public.cabinets add column image_path text;
alter table public.cabinets add constraint cabinets_image_path_v1_check check (
    image_path is null or (
        octet_length(image_path) between 1 and 1024
        and left(image_path, 1) <> '/'
        and position(chr(92) in image_path) = 0
        and image_path !~ '[[:cntrl:]]'
        and image_path !~ '(^|/)\.\.(/|$)'
    )
);
comment on column public.cabinets.image_path is
    'Storage object path. Nullable during public-photo compatibility; never contains a public or signed URL.';

-- Existing table-level grants include new columns automatically. Prevent a
-- browser from planting a different tenant's future private object path during
-- Expand; only a service operation or migration may populate this column.
create function private.guard_cabinet_image_path_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if new.image_path is distinct from old.image_path
       and current_user not in ('postgres', 'service_role', 'supabase_admin')
       and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
        raise exception 'Cabinet image path is server managed' using errcode = '42501';
    end if;
    return new;
end;
$function$;

revoke all on function private.guard_cabinet_image_path_v1()
    from public, anon, authenticated, service_role;
grant execute on function private.guard_cabinet_image_path_v1()
    to service_role;

create trigger cabinets_guard_image_path_v1
before insert or update of image_path on public.cabinets
for each row execute function private.guard_cabinet_image_path_v1();

create table private.lab_join_attempts_v1 (
    lab_id uuid not null references public.labs (id) on delete cascade,
    subject_type text not null check (subject_type in ('user', 'ip')),
    subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
    failure_times timestamptz[] not null default '{}'::timestamptz[],
    locked_until timestamptz,
    updated_at timestamptz not null default clock_timestamp(),
    primary key (lab_id, subject_type, subject_hash),
    check (cardinality(failure_times) <= 20),
    check (array_position(failure_times, null) is null)
);

alter table private.lab_join_attempts_v1 enable row level security;
revoke all on table private.lab_join_attempts_v1 from public, anon, authenticated, service_role;

comment on table private.lab_join_attempts_v1 is
    'Rolling failed-join windows; stores per-lab HMAC subjects, never raw IP addresses or passwords. Service-only RPC owns all access.';

create index lab_join_attempts_v1_retention_idx
    on private.lab_join_attempts_v1 (updated_at, lab_id, subject_type, subject_hash);

create function public.join_lab_server_v1(
    p_user_id uuid,
    p_lab_id uuid,
    p_password text,
    p_user_hash text,
    p_ip_hash text,
    p_nickname text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_password_hash text;
    v_legacy_password text;
    v_bcrypt text;
    v_candidate text;
    v_password_matches boolean := false;
    v_locked_until timestamptz;
    v_now timestamptz;
begin
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
        raise exception 'Service role is required' using errcode = '42501';
    end if;
    if p_user_id is null or p_lab_id is null
       or not coalesce(p_user_hash ~ '^[0-9a-f]{64}$', false)
       or not coalesce(p_ip_hash ~ '^[0-9a-f]{64}$', false)
       or p_password is null or char_length(p_password) > 128
       or char_length(coalesce(p_nickname, '')) > 100 then
        raise exception 'Invalid join input' using errcode = '22023';
    end if;

    if exists (
        select 1 from public.lab_members lm
        where lm.lab_id = p_lab_id and lm.user_id = p_user_id
    ) then
        return jsonb_build_object('success', false, 'code', 'already_member');
    end if;

    -- Retain the selected password until the membership decision commits.
    -- This does not change the old password representation or old join RPC.
    select l.join_password_hash, l.join_password
      into v_password_hash, v_legacy_password
      from public.labs l where l.id = p_lab_id
      for share;
    if not found then
        return jsonb_build_object('success', false, 'code', 'lab_not_found');
    end if;

    -- Bounded retention; skip counters currently used by another join request.
    with expired as (
        select a.lab_id, a.subject_type, a.subject_hash
          from private.lab_join_attempts_v1 a
          where a.updated_at < clock_timestamp() - interval '24 hours'
          order by a.updated_at, a.lab_id, a.subject_type, a.subject_hash
          limit 500 for update skip locked
    )
    delete from private.lab_join_attempts_v1 a using expired e
      where a.lab_id = e.lab_id and a.subject_type = e.subject_type
        and a.subject_hash = e.subject_hash;

    -- Insert and lock IP then user, consistently across concurrent callers.
    insert into private.lab_join_attempts_v1 (lab_id, subject_type, subject_hash)
    values (p_lab_id, 'ip', p_ip_hash), (p_lab_id, 'user', p_user_hash)
    on conflict (lab_id, subject_type, subject_hash) do nothing;

    perform 1 from private.lab_join_attempts_v1 a
      where a.lab_id = p_lab_id and (
        (a.subject_type = 'ip' and a.subject_hash = p_ip_hash)
        or (a.subject_type = 'user' and a.subject_hash = p_user_hash)
      )
      order by a.subject_type, a.subject_hash for update;

    -- A concurrent request may have joined while this one waited. Recheck
    -- before the existing three-lab trigger can misreport a duplicate as full.
    if exists (select 1 from public.lab_members lm
        where lm.lab_id = p_lab_id and lm.user_id = p_user_id) then
        return jsonb_build_object('success', false, 'code', 'already_member');
    end if;

    -- Compute time after lock acquisition, not before a potentially slow wait.
    v_now := clock_timestamp();
    select max(a.locked_until) into v_locked_until
      from private.lab_join_attempts_v1 a
      where a.lab_id = p_lab_id and (
        (a.subject_type = 'ip' and a.subject_hash = p_ip_hash)
        or (a.subject_type = 'user' and a.subject_hash = p_user_hash)
      );
    if v_locked_until > v_now then
        return jsonb_build_object('success', false, 'code', 'join_locked',
            'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_locked_until - v_now)))::integer));
    end if;

    -- A rolling window prevents attempts on either side of a fixed-window
    -- boundary from escaping the 5/user and 20/IP thresholds.
    update private.lab_join_attempts_v1 a
      set failure_times = array(
          select failed_at from unnest(a.failure_times) failed_at
          where failed_at > v_now - interval '15 minutes' order by failed_at
      ), locked_until = null, updated_at = v_now
      where a.lab_id = p_lab_id and (
        (a.subject_type = 'ip' and a.subject_hash = p_ip_hash)
        or (a.subject_type = 'user' and a.subject_hash = p_user_hash)
      );

    if v_password_hash is not null then
        -- Read compatibility only. Ops5 does not start writing sha256$ hashes:
        -- the legacy join_lab RPC must remain usable until its later Contract.
        if left(v_password_hash, 7) = 'sha256$' then
            v_bcrypt := substring(v_password_hash from 8);
            v_candidate := encode(extensions.digest(convert_to(p_password, 'UTF8'), 'sha256'), 'hex');
        else
            v_bcrypt := v_password_hash;
            v_candidate := p_password;
        end if;
        v_password_matches := v_bcrypt = extensions.crypt(v_candidate, v_bcrypt);
    else
        v_password_matches := nullif(v_legacy_password, '') is null or v_legacy_password = p_password;
    end if;

    if not coalesce(v_password_matches, false) then
        update private.lab_join_attempts_v1 a
          set failure_times = array_append(a.failure_times, v_now),
              locked_until = case
                when cardinality(a.failure_times) + 1 >= case when a.subject_type = 'user' then 5 else 20 end
                then v_now + case when a.subject_type = 'user' then interval '30 minutes' else interval '1 hour' end
                else null
              end,
              updated_at = v_now
          where a.lab_id = p_lab_id and (
            (a.subject_type = 'ip' and a.subject_hash = p_ip_hash)
            or (a.subject_type = 'user' and a.subject_hash = p_user_hash)
          );
        select max(a.locked_until) into v_locked_until
          from private.lab_join_attempts_v1 a
          where a.lab_id = p_lab_id and (
            (a.subject_type = 'ip' and a.subject_hash = p_ip_hash)
            or (a.subject_type = 'user' and a.subject_hash = p_user_hash)
          );
        if v_locked_until > v_now then
            return jsonb_build_object('success', false, 'code', 'join_locked',
                'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_locked_until - v_now)))::integer));
        end if;
        return jsonb_build_object('success', false, 'code', 'incorrect_password');
    end if;

    begin
        insert into public.lab_members (lab_id, user_id, role, nickname)
        values (p_lab_id, p_user_id, 'student', nullif(trim(p_nickname), ''));
    exception when unique_violation then
        if exists (select 1 from public.lab_members lm
            where lm.lab_id = p_lab_id and lm.user_id = p_user_id) then
            return jsonb_build_object('success', false, 'code', 'already_member');
        end if;
        raise;
    end;

    -- A successful account must not erase failures from other users sharing
    -- the IP. Only this user's counter is reset after a successful membership.
    delete from private.lab_join_attempts_v1 a
      where a.lab_id = p_lab_id and a.subject_type = 'user' and a.subject_hash = p_user_hash;

    return jsonb_build_object('success', true, 'lab_id', p_lab_id);
end;
$function$;

revoke all on function public.join_lab_server_v1(uuid, uuid, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.join_lab_server_v1(uuid, uuid, text, text, text, text)
    to service_role;

-- New clients record the activity and its audit row in one transaction. Every
-- identity, scope and audit field is derived here instead of trusted from the
-- browser. The generic legacy audit RPC remains available until Ops7 Contract.
create function public.record_cabinet_activity_v2(
    p_cabinet_id uuid,
    p_action_type text,
    p_item_name text,
    p_reason text default null,
    p_memo text default null,
    p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_user_id uuid := auth.uid();
    v_lab_id uuid;
    v_owner_id uuid;
    v_cabinet_name text;
    v_activity_id uuid;
    v_request_id uuid := coalesce(p_request_id, gen_random_uuid());
    v_action text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;
    if p_cabinet_id is null
       or p_action_type is null
       or p_action_type not in ('add', 'update', 'remove', 'clear_all')
       or nullif(trim(p_item_name), '') is null
       or char_length(p_item_name) > 500
       or char_length(coalesce(p_reason, '')) > 2000
       or char_length(coalesce(p_memo, '')) > 2000
       or p_item_name ~ '[[:cntrl:]]' then
        raise exception 'Invalid cabinet activity input' using errcode = '22023';
    end if;

    select c.lab_id, c.user_id, c.name
      into v_lab_id, v_owner_id, v_cabinet_name
      from public.cabinets c
      where c.id = p_cabinet_id
      for share;
    if not found then
        raise exception 'Cabinet not found' using errcode = 'P0002';
    end if;
    if not (
        (v_lab_id is not null and exists (
            select 1 from public.lab_members lm
            where lm.lab_id = v_lab_id and lm.user_id = v_user_id
        ))
        or (v_lab_id is null and v_owner_id = v_user_id)
    ) then
        raise exception 'Cabinet access denied' using errcode = '42501';
    end if;

    insert into public.cabinet_activity_logs (
        cabinet_id, action_type, item_name, reason, memo, performed_by
    ) values (
        p_cabinet_id, p_action_type, trim(p_item_name), nullif(trim(p_reason), ''),
        nullif(trim(p_memo), ''), v_user_id
    ) returning id into v_activity_id;

    v_action := case
        when p_action_type = 'add' then 'create'
        when p_action_type = 'remove' then 'delete'
        else 'update'
    end;
    insert into public.audit_logs (
        actor_user_id, actor_name, lab_id, entity_type, entity_id, action,
        location_context, before_data, after_data, diff_data, source, request_id
    ) values (
        v_user_id,
        left(private.actor_display_name_v2(v_user_id, v_lab_id), 200),
        v_lab_id,
        'cabinet_activity',
        p_cabinet_id,
        v_action,
        p_cabinet_id::text,
        null,
        jsonb_strip_nulls(jsonb_build_object(
            'activity_id', v_activity_id,
            'action_type', p_action_type,
            'item_name', trim(p_item_name),
            'reason', nullif(trim(p_reason), ''),
            'memo', nullif(trim(p_memo), ''),
            'cabinet_name', v_cabinet_name
        )),
        null,
        'database',
        v_request_id
    );

    return jsonb_build_object(
        'success', true,
        'activity_id', v_activity_id,
        'request_id', v_request_id
    );
end;
$function$;

revoke all on function public.record_cabinet_activity_v2(uuid, text, text, text, text, uuid)
    from public, anon;
grant execute on function public.record_cabinet_activity_v2(uuid, text, text, text, text, uuid)
    to authenticated, service_role;

commit;
