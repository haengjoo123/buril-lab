-- Ops11: retryable account/lab deletion processor and Scheduler coordination.
-- The browser UI and runtime switches remain OFF until hosted acceptance passes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table private.deletion_file_targets_v1 (
    job_id uuid not null references private.deletion_jobs_v1 (id) on delete restrict,
    bucket_id text not null check (bucket_id in ('cabinets', 'safety-center-verifications')),
    object_path text not null check (octet_length(object_path) between 1 and 1024),
    source_kind text not null check (source_kind in ('cabinet_image', 'safety_center_document')),
    deleted_at timestamptz,
    created_at timestamptz not null default clock_timestamp(),
    primary key (job_id, bucket_id, object_path)
);

create table private.deletion_worker_lease_v1 (
    slot text primary key check (slot = 'deletion-worker-v1'),
    lease_token uuid,
    lease_expires_at timestamptz,
    updated_at timestamptz not null default clock_timestamp(),
    check ((lease_token is null) = (lease_expires_at is null))
);

insert into private.deletion_worker_lease_v1 (slot)
values ('deletion-worker-v1');

alter table private.deletion_file_targets_v1 enable row level security;
alter table private.deletion_worker_lease_v1 enable row level security;
revoke all on table private.deletion_file_targets_v1
    from public, anon, authenticated, service_role;
revoke all on table private.deletion_worker_lease_v1
    from public, anon, authenticated, service_role;

comment on table private.deletion_file_targets_v1 is
    'Temporary service-only object paths for an active deletion job. Paths are purged before the job is completed.';
comment on table private.deletion_worker_lease_v1 is
    'Single database-backed lease preventing overlapping deletion processor runs.';

create function private.require_active_deletion_lease_v1(
    p_job_id uuid,
    p_lease_token uuid
)
returns private.deletion_jobs_v1
language plpgsql
set search_path = ''
as $function$
declare
    v_job private.deletion_jobs_v1%rowtype;
begin
    perform private.require_deletion_service_v1();
    if p_job_id is null or p_lease_token is null then
        raise exception 'Invalid deletion job lease' using errcode = '22023';
    end if;
    select * into v_job
    from private.deletion_jobs_v1 j
    where j.id = p_job_id
    for update;
    if not found or v_job.status <> 'running'
       or v_job.lease_token <> p_lease_token
       or v_job.lease_expires_at <= clock_timestamp() then
        raise exception 'Deletion job lease is not active' using errcode = '55000';
    end if;
    return v_job;
end;
$function$;

revoke all on function private.require_active_deletion_lease_v1(uuid, uuid)
    from public, anon, authenticated, service_role;

create function public.acquire_deletion_worker_run_v1(
    p_lease_token uuid,
    p_lease_seconds integer default 55
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_lease private.deletion_worker_lease_v1%rowtype;
begin
    perform private.require_deletion_service_v1();
    if p_lease_token is null or p_lease_seconds is null
       or p_lease_seconds < 15 or p_lease_seconds > 90 then
        raise exception 'Invalid deletion worker lease' using errcode = '22023';
    end if;
    select * into v_lease
    from private.deletion_worker_lease_v1
    where slot = 'deletion-worker-v1'
    for update;
    if v_lease.lease_token is not null
       and v_lease.lease_token <> p_lease_token
       and v_lease.lease_expires_at > clock_timestamp() then
        return jsonb_build_object('success', true, 'acquired', false);
    end if;
    update private.deletion_worker_lease_v1
    set lease_token=p_lease_token,
        lease_expires_at=clock_timestamp()+make_interval(secs => p_lease_seconds),
        updated_at=clock_timestamp()
    where slot='deletion-worker-v1';
    return jsonb_build_object('success', true, 'acquired', true);
end;
$function$;

create function public.release_deletion_worker_run_v1(p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_released boolean;
begin
    perform private.require_deletion_service_v1();
    if p_lease_token is null then
        raise exception 'Invalid deletion worker lease' using errcode = '22023';
    end if;
    update private.deletion_worker_lease_v1
    set lease_token=null, lease_expires_at=null, updated_at=clock_timestamp()
    where slot='deletion-worker-v1' and lease_token=p_lease_token;
    v_released := found;
    return jsonb_build_object('success', true, 'released', v_released);
end;
$function$;

create function public.prepare_deletion_job_database_v1(
    p_job_id uuid,
    p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_job private.deletion_jobs_v1%rowtype;
    v_target_count integer;
begin
    v_job := private.require_active_deletion_lease_v1(p_job_id, p_lease_token);
    if v_job.stage not in ('queued', 'database') then
        select count(*) into v_target_count
        from private.deletion_file_targets_v1 t where t.job_id=p_job_id;
        return jsonb_build_object(
          'success', true, 'stage', v_job.stage, 'target_count', v_target_count
        );
    end if;

    perform private.require_deletion_file_ownership_v1(
      v_job.kind, v_job.subject_user_id, v_job.lab_id
    );

    if exists (
      select 1 from public.cabinets c
      where ((v_job.kind='account' and c.lab_id is null and c.user_id=v_job.subject_user_id)
          or (v_job.kind='lab' and c.lab_id=v_job.lab_id))
        and nullif(c.image_url, '') is not null
    ) then
      raise exception 'Legacy public cabinet photo remains' using errcode = '55000';
    end if;

    insert into private.deletion_file_targets_v1 (
      job_id, bucket_id, object_path, source_kind
    )
    select p_job_id, 'cabinets', o.path, 'cabinet_image'
    from private.cabinet_image_objects_v1 o
    where (v_job.kind='account' and o.lab_id is null and o.owner_user_id=v_job.subject_user_id)
       or (v_job.kind='lab' and o.lab_id=v_job.lab_id)
    on conflict do nothing;

    if v_job.kind='account' then
      insert into private.deletion_file_targets_v1 (
        job_id, bucket_id, object_path, source_kind
      )
      select p_job_id, 'safety-center-verifications', sc.verification_document_path,
             'safety_center_document'
      from public.safety_centers sc
      where sc.created_by=v_job.subject_user_id
        and nullif(sc.verification_document_path, '') is not null
      on conflict do nothing;
    end if;

    select count(*) into v_target_count
    from private.deletion_file_targets_v1 t where t.job_id=p_job_id;
    if v_target_count > 5000 then
      raise exception 'Too many deletion file targets' using errcode = '54000';
    end if;

    update private.cabinet_image_objects_v1 o
    set detached_at=coalesce(o.detached_at, clock_timestamp())
    where (v_job.kind='account' and o.lab_id is null and o.owner_user_id=v_job.subject_user_id)
       or (v_job.kind='lab' and o.lab_id=v_job.lab_id);

    update public.cabinets c
    set image_path=null, image_url=null
    where (v_job.kind='account' and c.lab_id is null and c.user_id=v_job.subject_user_id)
       or (v_job.kind='lab' and c.lab_id=v_job.lab_id);

    if v_job.kind='account' then
      -- Revoke access before Auth deletion so a retrying account is no longer
      -- able to read shared lab or operator data.
      delete from private.operator_role_assignments_v1 a
      where a.user_id=v_job.subject_user_id;
      delete from public.safety_center_members m
      where m.user_id=v_job.subject_user_id;
      delete from public.lab_members m
      where m.user_id=v_job.subject_user_id;

      update public.cabinet_disposal_logs d
      set disposed_by=null where d.disposed_by=v_job.subject_user_id;
      update public.cabinets c
      set user_id=null where c.lab_id is not null and c.user_id=v_job.subject_user_id;
      update public.inventory i
      set user_id=null where i.lab_id is not null and i.user_id=v_job.subject_user_id;
      update public.storage_locations s
      set user_id=null where s.lab_id is not null and s.user_id=v_job.subject_user_id;
      update public.waste_logs w
      set user_id=null where w.lab_id is not null and w.user_id=v_job.subject_user_id;

      delete from public.waste_logs w
      where w.lab_id is null and w.user_id=v_job.subject_user_id;
      delete from public.inventory i
      where i.lab_id is null and i.user_id=v_job.subject_user_id;
      delete from public.storage_locations s
      where s.lab_id is null and s.user_id=v_job.subject_user_id;
      delete from public.cabinets c
      where c.lab_id is null and c.user_id=v_job.subject_user_id;

      update public.feedback f
      set user_id=null, user_email=null, contact=null
      where f.user_id=v_job.subject_user_id;
      update public.analytics_export_audits a
      set operator_user_id=null, operator_email='[redacted]'
      where a.operator_user_id=v_job.subject_user_id;
      update public.audit_logs a
      set actor_user_id=null, actor_name=null,
          before_data=coalesce(a.before_data, '{}'::jsonb)
            - 'user_id' - 'userId' - 'actor_user_id' - 'actorUserId',
          after_data=coalesce(a.after_data, '{}'::jsonb)
            - 'user_id' - 'userId' - 'actor_user_id' - 'actorUserId',
          diff_data=coalesce(a.diff_data, '{}'::jsonb)
            - 'user_id' - 'userId' - 'actor_user_id' - 'actorUserId'
      where a.actor_user_id=v_job.subject_user_id
         or a.before_data->>'user_id'=v_job.subject_user_id::text
         or a.before_data->>'userId'=v_job.subject_user_id::text
         or a.after_data->>'user_id'=v_job.subject_user_id::text
         or a.after_data->>'userId'=v_job.subject_user_id::text;
    else
      delete from public.labs l where l.id=v_job.lab_id;
      if not found then
        raise exception 'Lab disappeared before deletion' using errcode = 'P0002';
      end if;
    end if;

    update private.deletion_jobs_v1
    set stage='storage', updated_at=clock_timestamp()
    where id=p_job_id;
    return jsonb_build_object(
      'success', true, 'stage', 'storage', 'target_count', v_target_count
    );
end;
$function$;

create function public.list_deletion_file_targets_v1(
    p_job_id uuid,
    p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_job private.deletion_jobs_v1%rowtype;
    v_targets jsonb;
begin
    v_job := private.require_active_deletion_lease_v1(p_job_id, p_lease_token);
    if v_job.stage <> 'storage' then
      raise exception 'Deletion job is not in storage stage' using errcode = '55000';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'bucket', t.bucket_id, 'path', t.object_path
    ) order by t.bucket_id, t.object_path), '[]'::jsonb)
    into v_targets
    from private.deletion_file_targets_v1 t
    where t.job_id=p_job_id and t.deleted_at is null;
    return jsonb_build_object('success', true, 'targets', v_targets);
end;
$function$;

create function public.mark_deletion_storage_complete_v1(
    p_job_id uuid,
    p_lease_token uuid
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
    v_job := private.require_active_deletion_lease_v1(p_job_id, p_lease_token);
    if v_job.stage='auth' or v_job.stage='finalize' then
      return jsonb_build_object('success', true, 'stage', v_job.stage);
    end if;
    if v_job.stage <> 'storage' then
      raise exception 'Deletion job is not in storage stage' using errcode = '55000';
    end if;
    update private.deletion_file_targets_v1
    set deleted_at=coalesce(deleted_at, clock_timestamp())
    where job_id=p_job_id;
    update private.deletion_jobs_v1
    set stage='auth', updated_at=clock_timestamp()
    where id=p_job_id;
    return jsonb_build_object('success', true, 'stage', 'auth');
end;
$function$;

create function public.mark_deletion_auth_complete_v1(
    p_job_id uuid,
    p_lease_token uuid
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
    v_job := private.require_active_deletion_lease_v1(p_job_id, p_lease_token);
    if v_job.stage='finalize' then
      return jsonb_build_object('success', true, 'stage', 'finalize');
    end if;
    if v_job.stage <> 'auth' then
      raise exception 'Deletion job is not in auth stage' using errcode = '55000';
    end if;
    update private.deletion_jobs_v1
    set stage='finalize', updated_at=clock_timestamp()
    where id=p_job_id;
    return jsonb_build_object('success', true, 'stage', 'finalize');
end;
$function$;

create function public.finalize_deletion_job_v1(
    p_job_id uuid,
    p_lease_token uuid
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
    v_job := private.require_active_deletion_lease_v1(p_job_id, p_lease_token);
    if v_job.stage <> 'finalize' then
      raise exception 'Deletion job is not ready to finalize' using errcode = '55000';
    end if;
    if exists (
      select 1 from private.deletion_file_targets_v1 t
      where t.job_id=p_job_id and t.deleted_at is null
    ) then
      raise exception 'Deletion file cleanup is incomplete' using errcode = '55000';
    end if;

    delete from private.cabinet_image_retention_v1 r
    using private.deletion_file_targets_v1 t
    where t.job_id=p_job_id and t.bucket_id='cabinets' and r.path=t.object_path;
    delete from private.cabinet_image_objects_v1 o
    using private.deletion_file_targets_v1 t
    where t.job_id=p_job_id and t.bucket_id='cabinets' and o.path=t.object_path;
    delete from private.deletion_file_targets_v1 t where t.job_id=p_job_id;

    update private.deletion_jobs_v1
    set status='completed', stage='finalize', lease_token=null, lease_expires_at=null,
        last_error_code=null, updated_at=clock_timestamp(), finished_at=clock_timestamp()
    where id=p_job_id;
    insert into private.deletion_job_events_v1 (
      job_id, event_type, actor_type, attempt_count, stage
    ) values (p_job_id, 'completed', 'worker', v_job.attempt_count, 'finalize')
    on conflict do nothing;
    return jsonb_build_object('success', true, 'status', 'completed');
end;
$function$;

create function public.schedule_deletion_job_retry_v1(
    p_job_id uuid,
    p_lease_token uuid,
    p_error_code text
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
       or p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,64}$' then
      raise exception 'Invalid deletion retry result' using errcode = '22023';
    end if;
    select * into v_job from private.deletion_jobs_v1 j
    where j.id=p_job_id for update;
    if not found then
      raise exception 'Deletion job was not found' using errcode = 'P0002';
    end if;
    if v_job.status='completed' then
      return jsonb_build_object('success', true, 'status', 'completed',
        'attempt_count', v_job.attempt_count);
    end if;
    if v_job.status <> 'running' or v_job.lease_token <> p_lease_token
       or v_job.lease_expires_at <= clock_timestamp() then
      raise exception 'Deletion job lease is not active' using errcode = '55000';
    end if;

    if v_job.attempt_count >= 12 then
      update private.deletion_jobs_v1
      set status='failed', lease_token=null, lease_expires_at=null,
          last_error_code=p_error_code, updated_at=clock_timestamp(), finished_at=clock_timestamp()
      where id=p_job_id returning * into v_job;
      insert into private.deletion_job_events_v1 (
        job_id, event_type, actor_type, attempt_count, stage, reason_code
      ) values (v_job.id, 'failed', 'worker', v_job.attempt_count, v_job.stage, p_error_code)
      on conflict do nothing;
    else
      v_delay_seconds := least(3600, 15 * (2 ^ greatest(0, v_job.attempt_count - 1))::integer);
      update private.deletion_jobs_v1
      set status='retry_wait', lease_token=null, lease_expires_at=null,
          last_error_code=p_error_code,
          next_attempt_at=clock_timestamp()+make_interval(secs => v_delay_seconds),
          updated_at=clock_timestamp()
      where id=p_job_id returning * into v_job;
      insert into private.deletion_job_events_v1 (
        job_id, event_type, actor_type, attempt_count, stage, reason_code
      ) values (v_job.id, 'retry_scheduled', 'worker', v_job.attempt_count, v_job.stage, p_error_code)
      on conflict do nothing;
    end if;
    return jsonb_build_object('success', true, 'status', v_job.status,
      'attempt_count', v_job.attempt_count);
end;
$function$;

revoke all on function public.acquire_deletion_worker_run_v1(uuid, integer)
    from public, anon, authenticated, service_role;
revoke all on function public.release_deletion_worker_run_v1(uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.prepare_deletion_job_database_v1(uuid, uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.list_deletion_file_targets_v1(uuid, uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.mark_deletion_storage_complete_v1(uuid, uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.mark_deletion_auth_complete_v1(uuid, uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.finalize_deletion_job_v1(uuid, uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.schedule_deletion_job_retry_v1(uuid, uuid, text)
    from public, anon, authenticated, service_role;

grant execute on function public.acquire_deletion_worker_run_v1(uuid, integer) to service_role;
grant execute on function public.release_deletion_worker_run_v1(uuid) to service_role;
grant execute on function public.prepare_deletion_job_database_v1(uuid, uuid) to service_role;
grant execute on function public.list_deletion_file_targets_v1(uuid, uuid) to service_role;
grant execute on function public.mark_deletion_storage_complete_v1(uuid, uuid) to service_role;
grant execute on function public.mark_deletion_auth_complete_v1(uuid, uuid) to service_role;
grant execute on function public.finalize_deletion_job_v1(uuid, uuid) to service_role;
grant execute on function public.schedule_deletion_job_retry_v1(uuid, uuid, text) to service_role;

commit;
