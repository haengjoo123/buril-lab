-- Ops9: queue account and lab deletion work without enabling either UI.
-- All browser-visible deletion requests remain guarded by the runtime switch.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table private.deletion_jobs_v1 (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null unique,
    kind text not null check (kind in ('account', 'lab')),
    subject_user_id uuid,
    lab_id uuid,
    requested_by uuid not null,
    status text not null default 'pending'
        check (status in ('pending', 'running', 'retry_wait', 'completed', 'failed')),
    stage text not null default 'queued'
        check (stage in ('queued', 'database', 'storage', 'auth', 'finalize')),
    attempt_count smallint not null default 0 check (attempt_count between 0 and 12),
    next_attempt_at timestamptz not null default clock_timestamp(),
    lease_token uuid,
    lease_expires_at timestamptz,
    last_error_code text check (
        last_error_code is null or last_error_code ~ '^[A-Z0-9_]{1,64}$'
    ),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    finished_at timestamptz,
    check (
        (kind = 'account' and subject_user_id is not null and lab_id is null and requested_by = subject_user_id)
        or (kind = 'lab' and subject_user_id is null and lab_id is not null)
    ),
    check (
        (status = 'running' and lease_token is not null and lease_expires_at is not null)
        or (status <> 'running' and lease_token is null and lease_expires_at is null)
    ),
    check (
        (status in ('completed', 'failed') and finished_at is not null)
        or (status not in ('completed', 'failed') and finished_at is null)
    ),
    check (updated_at >= created_at),
    check (finished_at is null or finished_at >= created_at)
);

create unique index deletion_jobs_v1_active_account_idx
    on private.deletion_jobs_v1 (subject_user_id)
    where kind = 'account' and status in ('pending', 'running', 'retry_wait');
create unique index deletion_jobs_v1_active_lab_idx
    on private.deletion_jobs_v1 (lab_id)
    where kind = 'lab' and status in ('pending', 'running', 'retry_wait');
create index deletion_jobs_v1_claim_idx
    on private.deletion_jobs_v1 (next_attempt_at, created_at, id)
    where status in ('pending', 'running', 'retry_wait');

create table private.deletion_job_events_v1 (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references private.deletion_jobs_v1 (id) on delete restrict,
    event_type text not null
        check (event_type in ('requested', 'claimed', 'retry_scheduled', 'completed', 'failed')),
    actor_type text not null check (actor_type in ('requester', 'worker')),
    attempt_count smallint not null check (attempt_count between 0 and 12),
    stage text not null check (stage in ('queued', 'database', 'storage', 'auth', 'finalize')),
    reason_code text check (reason_code is null or reason_code ~ '^[A-Z0-9_]{1,64}$'),
    created_at timestamptz not null default clock_timestamp(),
    unique (job_id, event_type, attempt_count)
);

alter table private.deletion_jobs_v1 enable row level security;
alter table private.deletion_job_events_v1 enable row level security;
revoke all on table private.deletion_jobs_v1
    from public, anon, authenticated, service_role;
revoke all on table private.deletion_job_events_v1
    from public, anon, authenticated, service_role;

comment on table private.deletion_jobs_v1 is
    'Service-only retryable account/lab erasure queue. Contains identifiers but no names, emails, object paths, tokens, or raw provider errors.';
comment on table private.deletion_job_events_v1 is
    'Append-only generalized deletion state evidence. Direct table access is denied even to service_role.';

create function private.guard_deletion_event_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    raise exception 'Deletion job events are append only' using errcode = '42501';
end;
$function$;

revoke all on function private.guard_deletion_event_append_only_v1()
    from public, anon, authenticated, service_role;

create trigger deletion_job_events_v1_no_rewrite
before update or delete on private.deletion_job_events_v1
for each row execute function private.guard_deletion_event_append_only_v1();
create trigger deletion_job_events_v1_no_truncate
before truncate on private.deletion_job_events_v1
for each statement execute function private.guard_deletion_event_append_only_v1();

create function private.require_deletion_service_v1()
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

revoke all on function private.require_deletion_service_v1()
    from public, anon, authenticated, service_role;

create function private.require_deletion_file_ownership_v1(
    p_kind text,
    p_subject_user_id uuid,
    p_lab_id uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $function$
begin
    if p_kind = 'account' then
        if p_subject_user_id is null or p_lab_id is not null then
            raise exception 'Invalid account deletion ownership scope' using errcode = '22023';
        end if;
        if exists (
            select 1
            from public.cabinets c
            where c.lab_id is null and c.user_id = p_subject_user_id
              and (
                nullif(c.image_url, '') is not null
                or (c.image_path is not null and not exists (
                    select 1 from private.cabinet_image_objects_v1 o
                    where o.path = c.image_path and o.cabinet_id = c.id
                      and o.lab_id is null and o.owner_user_id = p_subject_user_id
                      and o.detached_at is null
                ))
              )
        ) then
            raise exception 'deletion_file_ownership_unverified' using errcode = '55000';
        end if;
        return;
    end if;

    if p_kind = 'lab' then
        if p_subject_user_id is not null or p_lab_id is null then
            raise exception 'Invalid lab deletion ownership scope' using errcode = '22023';
        end if;
        if exists (
            select 1
            from public.cabinets c
            where c.lab_id = p_lab_id
              and (
                nullif(c.image_url, '') is not null
                or (c.image_path is not null and not exists (
                    select 1 from private.cabinet_image_objects_v1 o
                    where o.path = c.image_path and o.cabinet_id = c.id
                      and o.lab_id = p_lab_id and o.detached_at is null
                ))
              )
        ) then
            raise exception 'deletion_file_ownership_unverified' using errcode = '55000';
        end if;
        return;
    end if;

    raise exception 'Invalid deletion ownership kind' using errcode = '22023';
end;
$function$;

revoke all on function private.require_deletion_file_ownership_v1(text, uuid, uuid)
    from public, anon, authenticated, service_role;

create function public.enqueue_account_deletion_v1(
    p_user_id uuid,
    p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_job private.deletion_jobs_v1%rowtype;
begin
    perform private.require_deletion_service_v1();
    if p_user_id is null or p_request_id is null then
        raise exception 'Invalid account deletion request' using errcode = '22023';
    end if;
    if not exists (select 1 from auth.users u where u.id = p_user_id) then
        return jsonb_build_object('success', false, 'code', 'account_not_found');
    end if;
    if exists (
        select 1 from public.lab_members lm
        where lm.user_id = p_user_id and lm.role = 'admin'
    ) then
        return jsonb_build_object('success', false, 'code', 'account_transfer_required');
    end if;

    perform private.require_deletion_file_ownership_v1('account', p_user_id, null);

    select * into v_job from private.deletion_jobs_v1 j where j.request_id = p_request_id;
    if found then
        if v_job.kind <> 'account' or v_job.subject_user_id <> p_user_id then
            raise exception 'Deletion request id is already bound' using errcode = '23505';
        end if;
        return jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
    end if;

    select * into v_job
    from private.deletion_jobs_v1 j
    where j.kind = 'account' and j.subject_user_id = p_user_id
      and j.status in ('pending', 'running', 'retry_wait')
    order by j.created_at, j.id limit 1;
    if found then
        return jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
    end if;

    begin
        insert into private.deletion_jobs_v1 (
            request_id, kind, subject_user_id, requested_by
        ) values (p_request_id, 'account', p_user_id, p_user_id)
        returning * into v_job;
    exception when unique_violation then
        select * into v_job
        from private.deletion_jobs_v1 j
        where (j.request_id = p_request_id)
           or (j.kind = 'account' and j.subject_user_id = p_user_id
               and j.status in ('pending', 'running', 'retry_wait'))
        order by (j.request_id = p_request_id) desc, j.created_at, j.id limit 1;
        if not found or v_job.kind <> 'account' or v_job.subject_user_id <> p_user_id then
            raise;
        end if;
        return jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
    end;

    insert into private.deletion_job_events_v1 (
        job_id, event_type, actor_type, attempt_count, stage
    ) values (v_job.id, 'requested', 'requester', 0, 'queued');
    return jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
end;
$function$;

create function public.enqueue_lab_deletion_v1(
    p_user_id uuid,
    p_lab_id uuid,
    p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_job private.deletion_jobs_v1%rowtype;
begin
    perform private.require_deletion_service_v1();
    if p_user_id is null or p_lab_id is null or p_request_id is null then
        raise exception 'Invalid lab deletion request' using errcode = '22023';
    end if;
    if not exists (select 1 from public.labs l where l.id = p_lab_id) then
        return jsonb_build_object('success', false, 'code', 'lab_not_found');
    end if;
    if not exists (
        select 1 from public.lab_members lm
        where lm.lab_id = p_lab_id and lm.user_id = p_user_id and lm.role = 'admin'
    ) then
        return jsonb_build_object('success', false, 'code', 'lab_admin_required');
    end if;

    perform private.require_deletion_file_ownership_v1('lab', null, p_lab_id);

    select * into v_job from private.deletion_jobs_v1 j where j.request_id = p_request_id;
    if found then
        if v_job.kind <> 'lab' or v_job.lab_id <> p_lab_id or v_job.requested_by <> p_user_id then
            raise exception 'Deletion request id is already bound' using errcode = '23505';
        end if;
        return jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
    end if;

    select * into v_job
    from private.deletion_jobs_v1 j
    where j.kind = 'lab' and j.lab_id = p_lab_id
      and j.status in ('pending', 'running', 'retry_wait')
    order by j.created_at, j.id limit 1;
    if found then
        return jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
    end if;

    begin
        insert into private.deletion_jobs_v1 (
            request_id, kind, lab_id, requested_by
        ) values (p_request_id, 'lab', p_lab_id, p_user_id)
        returning * into v_job;
    exception when unique_violation then
        select * into v_job
        from private.deletion_jobs_v1 j
        where (j.request_id = p_request_id)
           or (j.kind = 'lab' and j.lab_id = p_lab_id
               and j.status in ('pending', 'running', 'retry_wait'))
        order by (j.request_id = p_request_id) desc, j.created_at, j.id limit 1;
        if not found or v_job.kind <> 'lab' or v_job.lab_id <> p_lab_id then
            raise;
        end if;
        return jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
    end;

    insert into private.deletion_job_events_v1 (
        job_id, event_type, actor_type, attempt_count, stage
    ) values (v_job.id, 'requested', 'requester', 0, 'queued');
    return jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
end;
$function$;

create function public.claim_deletion_jobs_v1(
    p_limit integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_job private.deletion_jobs_v1%rowtype;
    v_claimed jsonb := '[]'::jsonb;
begin
    perform private.require_deletion_service_v1();
    if p_limit is null or p_limit < 1 or p_limit > 10 then
        raise exception 'Invalid deletion claim limit' using errcode = '22023';
    end if;

    for v_job in
        select j.* from private.deletion_jobs_v1 j
        where j.status = 'running' and j.lease_expires_at <= clock_timestamp()
          and j.attempt_count >= 12
        order by j.lease_expires_at, j.id
        limit 100 for update skip locked
    loop
        update private.deletion_jobs_v1
        set status='failed', stage='finalize', lease_token=null, lease_expires_at=null,
            last_error_code='MAX_ATTEMPTS', updated_at=clock_timestamp(), finished_at=clock_timestamp()
        where id=v_job.id;
        insert into private.deletion_job_events_v1 (
            job_id, event_type, actor_type, attempt_count, stage, reason_code
        ) values (v_job.id, 'failed', 'worker', v_job.attempt_count, 'finalize', 'MAX_ATTEMPTS');
    end loop;

    for v_job in
        select j.* from private.deletion_jobs_v1 j
        where (
            (j.status in ('pending', 'retry_wait') and j.next_attempt_at <= clock_timestamp())
            or (j.status = 'running' and j.lease_expires_at <= clock_timestamp())
        ) and j.attempt_count < 12
        order by j.next_attempt_at, j.created_at, j.id
        limit p_limit for update skip locked
    loop
        update private.deletion_jobs_v1
        set status='running', attempt_count=v_job.attempt_count+1,
            lease_token=gen_random_uuid(), lease_expires_at=clock_timestamp()+interval '2 minutes',
            last_error_code=null, updated_at=clock_timestamp()
        where id=v_job.id returning * into v_job;
        insert into private.deletion_job_events_v1 (
            job_id, event_type, actor_type, attempt_count, stage
        ) values (v_job.id, 'claimed', 'worker', v_job.attempt_count, v_job.stage);
        v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
            'job_id', v_job.id,
            'kind', v_job.kind,
            'subject_user_id', v_job.subject_user_id,
            'lab_id', v_job.lab_id,
            'requested_by', v_job.requested_by,
            'stage', v_job.stage,
            'attempt_count', v_job.attempt_count,
            'lease_token', v_job.lease_token,
            'lease_expires_at', v_job.lease_expires_at
        ));
    end loop;

    return jsonb_build_object('success', true, 'jobs', v_claimed);
end;
$function$;

create function public.record_deletion_job_result_v1(
    p_job_id uuid,
    p_lease_token uuid,
    p_outcome text,
    p_stage text,
    p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_job private.deletion_jobs_v1%rowtype;
    v_delay_seconds integer;
begin
    perform private.require_deletion_service_v1();
    if p_job_id is null or p_lease_token is null
       or p_outcome is null or p_stage is null
       or p_outcome not in ('completed', 'retry')
       or p_stage not in ('database', 'storage', 'auth', 'finalize')
       or (p_outcome = 'retry' and (
           p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,64}$'
       ))
       or (p_outcome = 'completed' and (p_stage <> 'finalize' or p_error_code is not null)) then
        raise exception 'Invalid deletion job result' using errcode = '22023';
    end if;

    select * into v_job from private.deletion_jobs_v1 j
    where j.id = p_job_id for update;
    if not found or v_job.status <> 'running'
       or v_job.lease_token <> p_lease_token
       or v_job.lease_expires_at <= clock_timestamp() then
        raise exception 'Deletion job lease is not active' using errcode = '55000';
    end if;
    if array_position(array['queued','database','storage','auth','finalize'], p_stage)
       < array_position(array['queued','database','storage','auth','finalize'], v_job.stage) then
        raise exception 'Deletion job stage cannot move backward' using errcode = '22023';
    end if;

    if p_outcome = 'completed' then
        update private.deletion_jobs_v1
        set status='completed', stage=p_stage, lease_token=null, lease_expires_at=null,
            last_error_code=null, updated_at=clock_timestamp(), finished_at=clock_timestamp()
        where id=p_job_id returning * into v_job;
        insert into private.deletion_job_events_v1 (
            job_id, event_type, actor_type, attempt_count, stage
        ) values (v_job.id, 'completed', 'worker', v_job.attempt_count, p_stage);
    elsif v_job.attempt_count >= 12 then
        update private.deletion_jobs_v1
        set status='failed', stage=p_stage, lease_token=null, lease_expires_at=null,
            last_error_code=p_error_code, updated_at=clock_timestamp(), finished_at=clock_timestamp()
        where id=p_job_id returning * into v_job;
        insert into private.deletion_job_events_v1 (
            job_id, event_type, actor_type, attempt_count, stage, reason_code
        ) values (v_job.id, 'failed', 'worker', v_job.attempt_count, p_stage, p_error_code);
    else
        v_delay_seconds := least(3600, 15 * (2 ^ greatest(0, v_job.attempt_count - 1))::integer);
        update private.deletion_jobs_v1
        set status='retry_wait', stage=p_stage, lease_token=null, lease_expires_at=null,
            last_error_code=p_error_code,
            next_attempt_at=clock_timestamp()+make_interval(secs => v_delay_seconds),
            updated_at=clock_timestamp()
        where id=p_job_id returning * into v_job;
        insert into private.deletion_job_events_v1 (
            job_id, event_type, actor_type, attempt_count, stage, reason_code
        ) values (v_job.id, 'retry_scheduled', 'worker', v_job.attempt_count, p_stage, p_error_code);
    end if;

    return jsonb_build_object(
        'success', true,
        'job_id', v_job.id,
        'status', v_job.status,
        'attempt_count', v_job.attempt_count,
        'next_attempt_at', case when v_job.status='retry_wait' then v_job.next_attempt_at else null end
    );
end;
$function$;

create function public.get_deletion_job_status_v1(
    p_job_id uuid,
    p_requesting_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_job private.deletion_jobs_v1%rowtype;
begin
    perform private.require_deletion_service_v1();
    select * into v_job from private.deletion_jobs_v1 j
    where j.id=p_job_id and j.requested_by=p_requesting_user_id;
    if not found then
        return jsonb_build_object('success', false, 'code', 'job_not_found');
    end if;
    return jsonb_build_object(
        'success', true,
        'job_id', v_job.id,
        'kind', v_job.kind,
        'status', v_job.status,
        'stage', v_job.stage,
        'attempt_count', v_job.attempt_count,
        'created_at', v_job.created_at,
        'finished_at', v_job.finished_at
    );
end;
$function$;

revoke all on function public.enqueue_account_deletion_v1(uuid, uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.enqueue_lab_deletion_v1(uuid, uuid, uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.claim_deletion_jobs_v1(integer)
    from public, anon, authenticated, service_role;
revoke all on function public.record_deletion_job_result_v1(uuid, uuid, text, text, text)
    from public, anon, authenticated, service_role;
revoke all on function public.get_deletion_job_status_v1(uuid, uuid)
    from public, anon, authenticated, service_role;

grant execute on function public.enqueue_account_deletion_v1(uuid, uuid) to service_role;
grant execute on function public.enqueue_lab_deletion_v1(uuid, uuid, uuid) to service_role;
grant execute on function public.claim_deletion_jobs_v1(integer) to service_role;
grant execute on function public.record_deletion_job_result_v1(uuid, uuid, text, text, text) to service_role;
grant execute on function public.get_deletion_job_status_v1(uuid, uuid) to service_role;

commit;
