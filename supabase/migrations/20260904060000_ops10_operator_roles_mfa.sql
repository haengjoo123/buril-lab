-- Ops10: server-managed operator roles, AAL2 authorization and append-only evidence.
-- The legacy email allowlist remains only as a short, explicitly expiring rollback mode.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table private.operator_role_assignments_v1 (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete restrict,
    role text not null check (role in ('reader', 'approver', 'raw_exporter')),
    enabled boolean not null default true,
    last_changed_by_user_id uuid,
    reason_code text not null check (reason_code ~ '^[A-Z0-9_]{1,64}$'),
    reviewed_at timestamptz not null default clock_timestamp(),
    review_due_at timestamptz not null default (clock_timestamp() + interval '31 days'),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    unique (user_id, role),
    check (review_due_at >= reviewed_at),
    check (updated_at >= created_at)
);

create index operator_role_assignments_v1_active_idx
    on private.operator_role_assignments_v1 (user_id, role, review_due_at)
    where enabled;

create table private.operator_action_audit_v1 (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null,
    actor_user_id uuid not null,
    role text not null check (role in ('reader', 'approver', 'raw_exporter')),
    action text not null check (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
    resource_type text not null check (resource_type ~ '^[a-z][a-z0-9_]{2,63}$'),
    resource_id uuid,
    outcome text not null check (outcome in ('authorized', 'denied', 'succeeded')),
    reason_code text check (reason_code is null or reason_code ~ '^[A-Z0-9_]{1,64}$'),
    assurance_level text not null check (assurance_level in ('aal1', 'aal2', 'service')),
    created_at timestamptz not null default clock_timestamp(),
    unique (request_id, action, outcome)
);

create index operator_action_audit_v1_actor_time_idx
    on private.operator_action_audit_v1 (actor_user_id, created_at desc, id);

alter table private.operator_role_assignments_v1 enable row level security;
alter table private.operator_action_audit_v1 enable row level security;
revoke all on table private.operator_role_assignments_v1
    from public, anon, authenticated, service_role;
revoke all on table private.operator_action_audit_v1
    from public, anon, authenticated, service_role;

comment on table private.operator_role_assignments_v1 is
    'Server-only operator roles with a monthly review deadline. No email addresses are stored.';
comment on table private.operator_action_audit_v1 is
    'Append-only generalized operator authorization and outcome evidence. No names, emails, row bodies, paths, tokens, or raw errors.';

create function private.guard_operator_audit_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    raise exception 'Operator action audit is append only' using errcode = '42501';
end;
$function$;

revoke all on function private.guard_operator_audit_append_only_v1()
    from public, anon, authenticated, service_role;
create trigger operator_action_audit_v1_no_rewrite
before update or delete on private.operator_action_audit_v1
for each row execute function private.guard_operator_audit_append_only_v1();
create trigger operator_action_audit_v1_no_truncate
before truncate on private.operator_action_audit_v1
for each statement execute function private.guard_operator_audit_append_only_v1();

create function private.require_operator_service_v1()
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

revoke all on function private.require_operator_service_v1()
    from public, anon, authenticated, service_role;

create function private.operator_access_decision_v1(
    p_user_id uuid,
    p_required_role text,
    p_action text,
    p_resource_type text,
    p_assurance_level text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
    v_expected_role text;
    v_expected_resource text;
    v_assignment private.operator_role_assignments_v1%rowtype;
begin
    if p_user_id is null or p_required_role is null or p_action is null
       or p_resource_type is null or p_assurance_level is null then
        raise exception 'Invalid operator authorization request' using errcode = '22023';
    end if;

    select expected_role, expected_resource into v_expected_role, v_expected_resource
    from (values
      ('feedback.list', 'reader', 'feedback_collection'),
      ('feedback.status', 'approver', 'feedback'),
      ('analytics.export', 'raw_exporter', 'analytics_export'),
      ('analytics.mixtures', 'reader', 'analytics_mixtures'),
      ('analytics.reviews', 'approver', 'analytics_reviews'),
      ('analytics.search', 'reader', 'analytics_search'),
      ('analytics.summary', 'reader', 'analytics_summary'),
      ('safety_centers.document_url', 'raw_exporter', 'safety_center_document'),
      ('safety_centers.list', 'reader', 'safety_center_collection'),
      ('safety_centers.status', 'approver', 'safety_center')
    ) mapping(action, expected_role, expected_resource)
    where mapping.action = p_action;

    if v_expected_role is null or p_required_role <> v_expected_role
       or p_resource_type <> v_expected_resource then
        raise exception 'Unreviewed operator action mapping' using errcode = '22023';
    end if;
    if p_assurance_level not in ('aal1', 'aal2') then
        raise exception 'Invalid operator assurance level' using errcode = '22023';
    end if;

    select * into v_assignment
    from private.operator_role_assignments_v1 a
    where a.user_id=p_user_id and a.role=p_required_role and a.enabled;
    if not found then
        return jsonb_build_object('success', false, 'code', 'operator_role_required');
    end if;
    if v_assignment.review_due_at <= clock_timestamp() then
        return jsonb_build_object('success', false, 'code', 'operator_review_required');
    end if;
    if p_assurance_level <> 'aal2' then
        return jsonb_build_object('success', false, 'code', 'mfa_required');
    end if;
    return jsonb_build_object('success', true);
end;
$function$;

revoke all on function private.operator_access_decision_v1(uuid, text, text, text, text)
    from public, anon, authenticated, service_role;

create function private.insert_operator_audit_v1(
    p_request_id uuid,
    p_actor_user_id uuid,
    p_role text,
    p_action text,
    p_resource_type text,
    p_resource_id uuid,
    p_outcome text,
    p_reason_code text,
    p_assurance_level text
)
returns void
language plpgsql
set search_path = ''
as $function$
declare
    v_existing private.operator_action_audit_v1%rowtype;
begin
    if p_request_id is null or p_actor_user_id is null
       or p_role not in ('reader','approver','raw_exporter')
       or p_action !~ '^[a-z][a-z0-9_.]{2,63}$'
       or p_resource_type !~ '^[a-z][a-z0-9_]{2,63}$'
       or p_outcome not in ('authorized','denied','succeeded')
       or p_assurance_level not in ('aal1','aal2','service')
       or (p_reason_code is not null and p_reason_code !~ '^[A-Z0-9_]{1,64}$') then
        raise exception 'Invalid operator audit event' using errcode = '22023';
    end if;

    insert into private.operator_action_audit_v1 (
      request_id, actor_user_id, role, action, resource_type, resource_id,
      outcome, reason_code, assurance_level
    ) values (
      p_request_id, p_actor_user_id, p_role, p_action, p_resource_type, p_resource_id,
      p_outcome, p_reason_code, p_assurance_level
    ) on conflict (request_id, action, outcome) do nothing;

    select * into v_existing from private.operator_action_audit_v1 a
    where a.request_id=p_request_id and a.action=p_action and a.outcome=p_outcome;
    if not found or v_existing.actor_user_id <> p_actor_user_id
       or v_existing.role <> p_role
       or v_existing.resource_type <> p_resource_type
       or v_existing.resource_id is distinct from p_resource_id
       or v_existing.reason_code is distinct from p_reason_code
       or v_existing.assurance_level <> p_assurance_level then
        raise exception 'Operator audit request id is already bound' using errcode = '23505';
    end if;
end;
$function$;

revoke all on function private.insert_operator_audit_v1(uuid, uuid, text, text, text, uuid, text, text, text)
    from public, anon, authenticated, service_role;

create function public.set_operator_role_v1(
    p_target_user_id uuid,
    p_role text,
    p_enabled boolean,
    p_changed_by_user_id uuid,
    p_request_id uuid,
    p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_assignment private.operator_role_assignments_v1%rowtype;
begin
    perform private.require_operator_service_v1();
    if p_target_user_id is null or p_role not in ('reader','approver','raw_exporter')
       or p_enabled is null or p_request_id is null
       or p_reason_code is null or p_reason_code !~ '^[A-Z0-9_]{1,64}$'
       or not exists (select 1 from auth.users u where u.id=p_target_user_id)
       or (p_changed_by_user_id is not null
           and not exists (select 1 from auth.users u where u.id=p_changed_by_user_id)) then
        raise exception 'Invalid operator role change' using errcode = '22023';
    end if;

    insert into private.operator_role_assignments_v1 (
      user_id, role, enabled, last_changed_by_user_id, reason_code, reviewed_at, review_due_at
    ) values (
      p_target_user_id, p_role, p_enabled, p_changed_by_user_id, p_reason_code,
      clock_timestamp(), clock_timestamp()+interval '31 days'
    ) on conflict (user_id, role) do update set
      enabled=excluded.enabled,
      last_changed_by_user_id=excluded.last_changed_by_user_id,
      reason_code=excluded.reason_code,
      reviewed_at=excluded.reviewed_at,
      review_due_at=excluded.review_due_at,
      updated_at=clock_timestamp()
    returning * into v_assignment;

    perform private.insert_operator_audit_v1(
      p_request_id, coalesce(p_changed_by_user_id, p_target_user_id), p_role,
      'roles.set', 'operator_role', p_target_user_id,
      'succeeded', p_reason_code, 'service'
    );
    return jsonb_build_object(
      'success', true, 'user_id', v_assignment.user_id, 'role', v_assignment.role,
      'enabled', v_assignment.enabled, 'review_due_at', v_assignment.review_due_at
    );
end;
$function$;

create function public.authorize_operator_action_v1(
    p_user_id uuid,
    p_required_role text,
    p_action text,
    p_resource_type text,
    p_resource_id uuid,
    p_request_id uuid,
    p_assurance_level text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_decision jsonb;
    v_code text;
begin
    perform private.require_operator_service_v1();
    if p_request_id is null then
        raise exception 'Invalid operator authorization request id' using errcode = '22023';
    end if;
    v_decision := private.operator_access_decision_v1(
      p_user_id, p_required_role, p_action, p_resource_type, p_assurance_level
    );
    v_code := case when v_decision->>'success'='true' then null else upper(v_decision->>'code') end;
    perform private.insert_operator_audit_v1(
      p_request_id, p_user_id, p_required_role, p_action, p_resource_type, p_resource_id,
      case when v_code is null then 'authorized' else 'denied' end,
      v_code, p_assurance_level
    );
    return v_decision || jsonb_build_object(
      'role', p_required_role, 'action', p_action, 'assurance_level', p_assurance_level
    );
end;
$function$;

create function public.operator_feedback_status_v1(
    p_operator_user_id uuid,
    p_feedback_id uuid,
    p_status text,
    p_request_id uuid,
    p_assurance_level text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_decision jsonb;
    v_item public.feedback%rowtype;
    v_now timestamptz := clock_timestamp();
begin
    perform private.require_operator_service_v1();
    if p_feedback_id is null or p_status not in ('new','in_progress','resolved') or p_request_id is null then
        raise exception 'Invalid feedback status request' using errcode = '22023';
    end if;
    v_decision := private.operator_access_decision_v1(
      p_operator_user_id, 'approver', 'feedback.status', 'feedback', p_assurance_level
    );
    if v_decision->>'success' <> 'true' then
      perform private.insert_operator_audit_v1(
        p_request_id, p_operator_user_id, 'approver', 'feedback.status', 'feedback', p_feedback_id,
        'denied', upper(v_decision->>'code'), p_assurance_level
      );
      return v_decision;
    end if;

    update public.feedback set
      status=p_status, updated_at=v_now,
      resolved_at=case when p_status='resolved' then v_now else null end,
      resolved_by=case when p_status='resolved' then p_operator_user_id else null end
    where id=p_feedback_id returning * into v_item;
    if not found then return jsonb_build_object('success', false, 'code', 'feedback_not_found'); end if;

    perform private.insert_operator_audit_v1(
      p_request_id, p_operator_user_id, 'approver', 'feedback.status', 'feedback', p_feedback_id,
      'succeeded', null, p_assurance_level
    );
    return jsonb_build_object('success', true, 'item', to_jsonb(v_item));
end;
$function$;

create function public.authorize_operator_fallback_v1(
    p_user_id uuid,
    p_required_role text,
    p_action text,
    p_resource_type text,
    p_request_id uuid,
    p_assurance_level text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_mapping_ok boolean;
    v_success boolean;
begin
    perform private.require_operator_service_v1();
    select exists (
      select 1 from (values
        ('feedback.list', 'reader', 'feedback_collection'),
        ('feedback.status', 'approver', 'feedback'),
        ('analytics.export', 'raw_exporter', 'analytics_export'),
        ('analytics.mixtures', 'reader', 'analytics_mixtures'),
        ('analytics.reviews', 'approver', 'analytics_reviews'),
        ('analytics.search', 'reader', 'analytics_search'),
        ('analytics.summary', 'reader', 'analytics_summary'),
        ('safety_centers.document_url', 'raw_exporter', 'safety_center_document'),
        ('safety_centers.list', 'reader', 'safety_center_collection'),
        ('safety_centers.status', 'approver', 'safety_center')
      ) mapping(action, expected_role, expected_resource)
      where mapping.action=p_action and mapping.expected_role=p_required_role
        and mapping.expected_resource=p_resource_type
    ) into v_mapping_ok;
    if p_user_id is null or p_request_id is null or not v_mapping_ok
       or p_assurance_level not in ('aal1','aal2') then
        raise exception 'Invalid operator fallback authorization' using errcode = '22023';
    end if;
    v_success := p_assurance_level='aal2';
    perform private.insert_operator_audit_v1(
      p_request_id, p_user_id, p_required_role, p_action, p_resource_type, null,
      case when v_success then 'authorized' else 'denied' end,
      case when v_success then 'ALLOWLIST_FALLBACK' else 'MFA_REQUIRED' end,
      p_assurance_level
    );
    return jsonb_build_object(
      'success', v_success,
      'code', case when v_success then null else 'mfa_required' end,
      'role', p_required_role, 'action', p_action,
      'assurance_level', p_assurance_level
    );
end;
$function$;

create function public.operator_safety_center_status_v1(
    p_operator_user_id uuid,
    p_center_id uuid,
    p_status text,
    p_request_id uuid,
    p_assurance_level text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_decision jsonb;
    v_item public.safety_centers%rowtype;
    v_now timestamptz := clock_timestamp();
begin
    perform private.require_operator_service_v1();
    if p_center_id is null or p_status not in ('pending','approved','rejected') or p_request_id is null then
        raise exception 'Invalid safety-center status request' using errcode = '22023';
    end if;
    v_decision := private.operator_access_decision_v1(
      p_operator_user_id, 'approver', 'safety_centers.status', 'safety_center', p_assurance_level
    );
    if v_decision->>'success' <> 'true' then
      perform private.insert_operator_audit_v1(
        p_request_id, p_operator_user_id, 'approver', 'safety_centers.status', 'safety_center', p_center_id,
        'denied', upper(v_decision->>'code'), p_assurance_level
      );
      return v_decision;
    end if;

    select * into v_item from public.safety_centers where id=p_center_id for update;
    if not found then return jsonb_build_object('success', false, 'code', 'safety_center_not_found'); end if;
    if p_status='approved' and nullif(v_item.verification_document_path,'') is null then
        return jsonb_build_object('success', false, 'code', 'verification_document_required');
    end if;
    update public.safety_centers set
      status=p_status,
      approved_by=case when p_status='approved' then p_operator_user_id else null end,
      approved_at=case when p_status='approved' then v_now else null end,
      updated_at=v_now
    where id=p_center_id returning * into v_item;

    perform private.insert_operator_audit_v1(
      p_request_id, p_operator_user_id, 'approver', 'safety_centers.status', 'safety_center', p_center_id,
      'succeeded', null, p_assurance_level
    );
    return jsonb_build_object('success', true, 'item', to_jsonb(v_item));
end;
$function$;

create function public.operator_analytics_review_decide_v1(
    p_operator_user_id uuid,
    p_candidate_id uuid,
    p_status text,
    p_notes text,
    p_evidence jsonb,
    p_proposed_alias text,
    p_canonical_name text,
    p_canonical_cas text,
    p_request_id uuid,
    p_assurance_level text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
    v_decision jsonb;
    v_item jsonb;
begin
    perform private.require_operator_service_v1();
    if p_candidate_id is null or p_status not in ('approved','rejected') or p_request_id is null then
        raise exception 'Invalid analytics review request' using errcode = '22023';
    end if;
    v_decision := private.operator_access_decision_v1(
      p_operator_user_id, 'approver', 'analytics.reviews', 'analytics_reviews', p_assurance_level
    );
    if v_decision->>'success' <> 'true' then
      perform private.insert_operator_audit_v1(
        p_request_id, p_operator_user_id, 'approver', 'analytics.reviews', 'analytics_reviews', p_candidate_id,
        'denied', upper(v_decision->>'code'), p_assurance_level
      );
      return v_decision;
    end if;

    v_item := public.analytics_review_candidate_decide(
      p_candidate_id, p_status, coalesce(p_notes,''), coalesce(p_evidence,'{}'::jsonb),
      p_operator_user_id, p_proposed_alias, p_canonical_name, p_canonical_cas
    );
    perform private.insert_operator_audit_v1(
      p_request_id, p_operator_user_id, 'approver', 'analytics.reviews', 'analytics_reviews', p_candidate_id,
      'succeeded', null, p_assurance_level
    );
    return jsonb_build_object('success', true, 'item', v_item);
end;
$function$;

revoke all on function public.set_operator_role_v1(uuid, text, boolean, uuid, uuid, text)
    from public, anon, authenticated, service_role;
revoke all on function public.authorize_operator_action_v1(uuid, text, text, text, uuid, uuid, text)
    from public, anon, authenticated, service_role;
revoke all on function public.authorize_operator_fallback_v1(uuid, text, text, text, uuid, text)
    from public, anon, authenticated, service_role;
revoke all on function public.operator_feedback_status_v1(uuid, uuid, text, uuid, text)
    from public, anon, authenticated, service_role;
revoke all on function public.operator_safety_center_status_v1(uuid, uuid, text, uuid, text)
    from public, anon, authenticated, service_role;
revoke all on function public.operator_analytics_review_decide_v1(uuid, uuid, text, text, jsonb, text, text, text, uuid, text)
    from public, anon, authenticated, service_role;

grant execute on function public.set_operator_role_v1(uuid, text, boolean, uuid, uuid, text) to service_role;
grant execute on function public.authorize_operator_action_v1(uuid, text, text, text, uuid, uuid, text) to service_role;
grant execute on function public.authorize_operator_fallback_v1(uuid, text, text, text, uuid, text) to service_role;
grant execute on function public.operator_feedback_status_v1(uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.operator_safety_center_status_v1(uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.operator_analytics_review_decide_v1(uuid, uuid, text, text, jsonb, text, text, text, uuid, text) to service_role;

commit;
