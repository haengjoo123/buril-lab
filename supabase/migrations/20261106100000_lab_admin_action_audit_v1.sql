-- Lab admin action audit v1 (phase 3: safety and regulatory records).
-- * audit_logs rows for lab member joins, role changes, removals and
--   departures (entity_type lab_member, readable only by that lab's admins),
--   safety-center link status/scope changes and waste-container site settings
--   (readable by every lab member, like every other audit row). Payloads keep
--   account ids, roles, statuses, scopes and changed field names only: never
--   emails, contact numbers, locations or free text.
-- * Center request flow: a lab cannot close a request while the center can
--   still see it and cannot reopen a closed one; widening an approved link's
--   scope needs lab re-approval; voided waste logs, member audit rows and other
--   centers' link rows never reach a center.
-- * Operator rejection reason (operator_safety_center_status_v2) shown to the
--   applicant by get_my_safety_centers, and feedback context columns.
-- Redefined functions keep their signatures and grants (create or replace);
-- get_my_safety_centers is recreated with two more output columns and the same
-- grants. New public functions are service_role only; new private helpers are
-- not executable by any API role.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Columns ----------------------------------------------------------------

alter table public.feedback
  add column lab_id uuid references public.labs(id) on delete set null,
  add column source_screen text;
alter table public.feedback add constraint feedback_source_screen_check
  check (source_screen is null or source_screen in ('search', 'logs', 'cabinet', 'inventory', 'admin'));
create index feedback_lab_id_idx on public.feedback (lab_id) where lab_id is not null;

alter table public.safety_centers
  add column review_reason text,
  add column review_note text;
alter table public.safety_centers add constraint safety_centers_review_reason_check
  check (review_reason is null or review_reason in ('document_unverifiable', 'institution_mismatch',
    'domain_mismatch', 'not_safety_office', 'duplicate_center', 'other'));
alter table public.safety_centers add constraint safety_centers_review_note_check
  check (review_note is null or (char_length(review_note) between 1 and 500 and review_note = pg_catalog.btrim(review_note)));

comment on column public.feedback.lab_id is 'Lab space the feedback was sent from (member-checked by RLS). Cleared on account deletion and lab deletion.';
comment on column public.feedback.source_screen is 'App tab the feedback was sent from (closed list).';
comment on column public.safety_centers.review_reason is 'Operator rejection reason preset. Shown to the applicant only while status = rejected.';
comment on column public.safety_centers.review_note is 'Optional operator note to the applicant (1-500 chars). Shown only while status = rejected.';

-- 2. Audit helpers and trigger ----------------------------------------------

-- Display name for an audit actor: lab nickname, then profile full_name/name.
-- Never the email; null when the result looks like an email address.
-- Called only from SECURITY DEFINER code.
create function private.lab_audit_actor_name_v1(p_user_id uuid, p_lab_id uuid)
returns text
language sql
stable
set search_path = ''
as $function$
  select case when v.name is null or pg_catalog.strpos(v.name, '@') > 0 then null else pg_catalog.left(v.name, 200) end
  from (select coalesce(
    (select nullif(pg_catalog.btrim(lm.nickname), '') from public.lab_members lm
      where lm.lab_id = p_lab_id and lm.user_id = p_user_id),
    (select coalesce(nullif(pg_catalog.btrim(u.raw_user_meta_data->>'full_name'), ''),
                     nullif(pg_catalog.btrim(u.raw_user_meta_data->>'name'), ''))
       from auth.users u where u.id = p_user_id)) as name) v
$function$;

revoke all on function private.lab_audit_actor_name_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

-- One AFTER trigger function for the three lab-administration tables. SECURITY
-- DEFINER because members may delete their own membership directly (RLS path)
-- and browser roles cannot insert audit rows.
create function private.audit_lab_admin_change_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_actor uuid := auth.uid();
    v_actor_name text;
    v_lab_id uuid;
    v_entity_type text;
    v_entity_id uuid;
    v_action text;
    v_before jsonb;
    v_after jsonb;
    v_diff jsonb;
    v_center_name text;
    v_fields text[];
begin
    if tg_table_schema <> 'public' then
        return null;
    end if;

    if tg_table_name = 'lab_members' then
        v_entity_type := 'lab_member';
        if tg_op = 'DELETE' then
            -- Deletion worker and Auth admin deletion: no caller to record.
            if v_actor is null then
                return null;
            end if;
            -- Account removed in the same statement (legacy public.delete_user()):
            -- a row would keep the deleted account id and no scrub would remove it.
            if not exists (select 1 from auth.users u where u.id = old.user_id) then
                return null;
            end if;
            -- Lab deletion cascade.
            if not exists (select 1 from public.labs l where l.id = old.lab_id) then
                return null;
            end if;
            v_lab_id := old.lab_id;
            v_entity_id := old.id;
            v_before := pg_catalog.jsonb_build_object('user_id', old.user_id, 'role', old.role);
            if v_actor = old.user_id then
                v_action := 'leave';
                v_actor_name := case
                    when pg_catalog.strpos(pg_catalog.btrim(old.nickname), '@') = 0
                    then pg_catalog.left(nullif(pg_catalog.btrim(old.nickname), ''), 200)
                end;
                v_actor_name := coalesce(v_actor_name, private.lab_audit_actor_name_v1(v_actor, old.lab_id));
            else
                v_action := 'remove';
                v_actor_name := private.lab_audit_actor_name_v1(v_actor, old.lab_id);
            end if;
        elsif tg_op = 'UPDATE' then
            if old.role is not distinct from new.role then
                return null;
            end if;
            v_lab_id := new.lab_id;
            v_entity_id := new.id;
            v_action := 'role_change';
            v_before := pg_catalog.jsonb_build_object('user_id', old.user_id, 'role', old.role);
            v_after := pg_catalog.jsonb_build_object('user_id', new.user_id, 'role', new.role);
            v_diff := pg_catalog.jsonb_build_object('role', pg_catalog.jsonb_build_object('from', old.role, 'to', new.role));
            v_actor_name := private.lab_audit_actor_name_v1(v_actor, new.lab_id);
        else
            return null;
        end if;

    elsif tg_table_name = 'safety_center_lab_links' then
        v_entity_type := 'safety_center_link';
        if tg_op = 'UPDATE' then
            if old.status = new.status and old.scope @> new.scope and old.scope <@ new.scope then
                return null;
            end if;
        elsif tg_op <> 'INSERT' then
            return null;
        end if;
        select sc.center_name into v_center_name
        from public.safety_centers sc
        where sc.id = new.center_id;
        v_lab_id := new.lab_id;
        v_entity_id := new.id;
        if tg_op = 'INSERT' or old.status is distinct from new.status then
            v_action := case new.status
                when 'requested' then 'link_request'
                when 'approved' then 'link_approve'
                when 'rejected' then 'link_reject'
                when 'revoked' then 'link_revoke'
            end;
        else
            v_action := 'scope_change';
        end if;
        v_after := pg_catalog.jsonb_build_object(
            'status', new.status, 'scope', pg_catalog.to_jsonb(new.scope), 'center_name', v_center_name);
        if tg_op = 'UPDATE' then
            v_before := pg_catalog.jsonb_build_object('status', old.status, 'scope', pg_catalog.to_jsonb(old.scope));
            v_diff := '{}'::jsonb;
            if old.status is distinct from new.status then
                v_diff := v_diff || pg_catalog.jsonb_build_object(
                    'status', pg_catalog.jsonb_build_object('from', old.status, 'to', new.status));
            end if;
            if not (old.scope @> new.scope and old.scope <@ new.scope) then
                v_diff := v_diff || pg_catalog.jsonb_build_object(
                    'scope', pg_catalog.jsonb_build_object(
                        'from', pg_catalog.to_jsonb(old.scope), 'to', pg_catalog.to_jsonb(new.scope)));
            end if;
        end if;
        if v_actor is not null then
            if exists (
                select 1 from public.lab_members lm
                where lm.lab_id = new.lab_id and lm.user_id = v_actor
            ) then
                v_actor_name := private.lab_audit_actor_name_v1(v_actor, new.lab_id);
            else
                -- Center staff are shown by the center (organisation) name only.
                v_actor_name := v_center_name;
            end if;
        end if;

    elsif tg_table_name = 'waste_policy_lab_overrides' then
        v_entity_type := 'waste_policy_override';
        if tg_op = 'DELETE' then
            if v_actor is null then
                return null;
            end if;
            if not exists (select 1 from public.labs l where l.id = old.lab_id) then
                return null;
            end if;
            v_lab_id := old.lab_id;
            v_entity_id := old.id;
            v_action := 'delete';
            v_before := pg_catalog.jsonb_build_object('stream_code', old.stream_code, 'is_disabled', old.is_disabled);
        elsif tg_op = 'INSERT' then
            v_fields := pg_catalog.array_remove(array[
                case when new.container_color is not null then 'container_color' end,
                case when new.container_label is not null then 'container_label' end,
                case when new.display_name_en is not null then 'display_name_en' end,
                case when new.display_name_ko is not null then 'display_name_ko' end,
                case when new.handler_contact is not null then 'handler_contact' end,
                case when new.is_disabled then 'is_disabled' end,
                case when new.location is not null then 'location' end,
                case when new.replacement_location is not null then 'replacement_location' end
            ]::text[], null);
            v_lab_id := new.lab_id;
            v_entity_id := new.id;
            v_action := 'create';
            v_after := pg_catalog.jsonb_build_object(
                'stream_code', new.stream_code, 'is_disabled', new.is_disabled,
                'changed_fields', pg_catalog.to_jsonb(v_fields));
        else
            v_fields := pg_catalog.array_remove(array[
                case when old.container_color is distinct from new.container_color then 'container_color' end,
                case when old.container_label is distinct from new.container_label then 'container_label' end,
                case when old.display_name_en is distinct from new.display_name_en then 'display_name_en' end,
                case when old.display_name_ko is distinct from new.display_name_ko then 'display_name_ko' end,
                case when old.handler_contact is distinct from new.handler_contact then 'handler_contact' end,
                case when old.is_disabled is distinct from new.is_disabled then 'is_disabled' end,
                case when old.location is distinct from new.location then 'location' end,
                case when old.replacement_location is distinct from new.replacement_location then 'replacement_location' end
            ]::text[], null);
            if pg_catalog.cardinality(v_fields) = 0 then
                return null;
            end if;
            v_lab_id := new.lab_id;
            v_entity_id := new.id;
            v_action := 'update';
            v_before := pg_catalog.jsonb_build_object('stream_code', old.stream_code, 'is_disabled', old.is_disabled);
            v_after := pg_catalog.jsonb_build_object(
                'stream_code', new.stream_code, 'is_disabled', new.is_disabled,
                'changed_fields', pg_catalog.to_jsonb(v_fields));
            if old.is_disabled is distinct from new.is_disabled then
                v_diff := pg_catalog.jsonb_build_object(
                    'is_disabled', pg_catalog.jsonb_build_object('from', old.is_disabled, 'to', new.is_disabled));
            end if;
        end if;
        v_actor_name := private.lab_audit_actor_name_v1(v_actor, v_lab_id);

    else
        return null;
    end if;

    insert into public.audit_logs (
        actor_user_id, actor_name, lab_id, entity_type, entity_id, action,
        location_context, before_data, after_data, diff_data, source
    ) values (
        v_actor, v_actor_name, v_lab_id, v_entity_type, v_entity_id, v_action,
        null, v_before, v_after, v_diff, 'database'
    );
    return null;
end;
$function$;

revoke all on function private.audit_lab_admin_change_v1()
  from public, anon, authenticated, service_role;

create trigger lab_members_audit_admin_change_v1
  after update of role or delete on public.lab_members
  for each row execute function private.audit_lab_admin_change_v1();
create trigger safety_center_lab_links_audit_admin_change_v1
  after insert or update of status, scope on public.safety_center_lab_links
  for each row execute function private.audit_lab_admin_change_v1();
create trigger waste_policy_lab_overrides_audit_admin_change_v1
  after insert or update or delete on public.waste_policy_lab_overrides
  for each row execute function private.audit_lab_admin_change_v1();

-- 3. Audit visibility ---------------------------------------------------------
-- Member-management rows: that lab's admins only. Every other row: all lab
-- members, as before. The legacy policy keeps its name (OPS7 pgTAP) and roles.

alter policy "Users can view audit_logs for their labs" on public.audit_logs
  using (entity_type <> 'lab_member' and lab_id in (
    select lab_members.lab_id from public.lab_members where lab_members.user_id = (select auth.uid())));

create policy audit_logs_select_lab_member_admin_v1 on public.audit_logs for select to authenticated
  using (entity_type = 'lab_member' and exists (
    select 1 from public.lab_members lm
    where lm.lab_id = audit_logs.lab_id and lm.user_id = (select auth.uid()) and lm.role = 'admin'));

-- 4. Feedback context ---------------------------------------------------------
-- Account deletion nulls feedback.user_id (OPS11 worker UPDATE, or the Auth
-- delete's ON DELETE SET NULL, which is also an UPDATE of user_id); the lab
-- link goes with it in the same statement. Lab deletion clears it by the FK.

create function private.feedback_clear_lab_on_user_detach_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if old.user_id is not null and new.user_id is null then
        new.lab_id := null;
    end if;
    return new;
end;
$function$;

revoke all on function private.feedback_clear_lab_on_user_detach_v1()
  from public, anon, authenticated, service_role;

create trigger feedback_clear_lab_on_user_detach_v1
  before update of user_id on public.feedback
  for each row execute function private.feedback_clear_lab_on_user_detach_v1();

alter policy "Anyone can insert feedback" on public.feedback with check (
  ((((select auth.uid()) is null) and (user_id is null) and (user_email is null))
    or (((select auth.uid()) = user_id) and ((user_email is null) or (user_email = ((select auth.jwt()) ->> 'email')))))
  and (lab_id is null or exists (select 1 from public.lab_members lm
        where lm.lab_id = feedback.lab_id and lm.user_id = (select auth.uid()))));

-- 5. Server join with a join audit row (F3a) ----------------------------------
-- /api/labs/join calls this as service_role, so auth.uid() is null and a
-- trigger could not name the member. Same result as join_lab_server_v1.

create function public.join_lab_server_v2(
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
    v_result jsonb;
    v_member_id uuid;
    v_role text;
begin
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
        raise exception 'Service role is required' using errcode = '42501';
    end if;

    v_result := public.join_lab_server_v1(p_user_id, p_lab_id, p_password, p_user_hash, p_ip_hash, p_nickname);

    if v_result ->> 'success' = 'true' then
        select lm.id, lm.role into v_member_id, v_role
        from public.lab_members lm
        where lm.lab_id = p_lab_id and lm.user_id = p_user_id;

        insert into public.audit_logs (
            actor_user_id, actor_name, lab_id, entity_type, entity_id, action,
            location_context, before_data, after_data, diff_data, source
        ) values (
            p_user_id, private.lab_audit_actor_name_v1(p_user_id, p_lab_id), p_lab_id, 'lab_member', v_member_id, 'join',
            null, null, pg_catalog.jsonb_build_object('user_id', p_user_id, 'role', v_role), null, 'database'
        );
    end if;

    return v_result;
end;
$function$;

revoke all on function public.join_lab_server_v2(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.join_lab_server_v2(uuid, uuid, text, text, text, text)
  to service_role;

-- 6. Center flow --------------------------------------------------------------

-- A lab may not close a request while the center can still see it (approved
-- link to an approved center); the center closes it after reviewing the
-- reply. A lab may never reopen a closed request. Comments stay allowed.
create or replace function public.add_safety_center_request_event(p_request_id uuid, p_body text DEFAULT NULL::text, p_to_status text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_center_id uuid;
    v_lab_id uuid;
    v_from_status text;
    v_actor_scope text;
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    select r.center_id, r.lab_id, r.status
    into v_center_id, v_lab_id, v_from_status
    from public.safety_center_requests r
    where r.id = p_request_id;

    if not found then
        raise exception 'Safety center request not found' using errcode = 'P0002';
    end if;

    if public.is_safety_center_member(v_center_id, array['owner', 'manager']) then
        v_actor_scope := 'center';
    elsif exists (
        select 1
        from public.lab_members lm
        where lm.lab_id = v_lab_id
          and lm.user_id = v_user_id
    ) then
        v_actor_scope := 'lab';
    else
        raise exception 'Access denied for request %', p_request_id using errcode = '42501';
    end if;

    if p_to_status is not null and p_to_status not in ('open', 'in_progress', 'submitted', 'resolved') then
        raise exception 'Unsupported request status: %', p_to_status using errcode = '22023';
    end if;

    if v_actor_scope = 'lab' and p_to_status = 'resolved' and v_from_status is distinct from 'resolved'
       and exists (
         select 1
         from public.safety_center_lab_links scl
         join public.safety_centers sc on sc.id = scl.center_id
         where scl.center_id = v_center_id
           and scl.lab_id = v_lab_id
           and scl.status = 'approved'
           and sc.status = 'approved'
       ) then
        raise exception 'LAB_CANNOT_RESOLVE_REQUEST' using errcode = '42501';
    end if;

    if v_actor_scope = 'lab' and v_from_status = 'resolved' and p_to_status is not null and p_to_status <> 'resolved' then
        raise exception 'LAB_CANNOT_REOPEN_REQUEST' using errcode = '42501';
    end if;

    if p_to_status is not null and p_to_status is distinct from v_from_status then
        update public.safety_center_requests
        set status = p_to_status
        where id = p_request_id;
    end if;

    insert into public.safety_center_request_events (
        request_id,
        actor_user_id,
        actor_scope,
        event_type,
        from_status,
        to_status,
        body
    ) values (
        p_request_id,
        v_user_id,
        v_actor_scope,
        case when p_to_status is not null and p_to_status is distinct from v_from_status then 'status_change' else 'comment' end,
        v_from_status,
        p_to_status,
        nullif(p_body, '')
    );
end;
$$;

-- Scope values come from a closed list. Widening an approved link (any value
-- not already granted) returns it to 'requested' until a lab admin approves
-- again; an equal or narrower scope keeps it approved.
create or replace function public.request_safety_center_lab_link(p_center_id uuid, p_lab_id uuid, p_scope text[] DEFAULT ARRAY['summary'::text, 'risk_detail'::text, 'exports'::text]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_center_status text;
    v_center_institution text;
    v_lab_institution text;
    v_link_id uuid;
    v_scope text[];
begin
    if v_user_id is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id, array['owner', 'manager']) then
        raise exception 'Only center owners and managers can request lab links' using errcode = '42501';
    end if;

    select sc.status, sc.institution_name
    into v_center_status, v_center_institution
    from public.safety_centers sc
    where sc.id = p_center_id;

    if v_center_status <> 'approved' then
        raise exception 'Safety center must be approved before requesting labs' using errcode = '42501';
    end if;

    select l.institution_name
    into v_lab_institution
    from public.labs l
    where l.id = p_lab_id;

    if lower(coalesce(v_lab_institution, '')) <> lower(v_center_institution) then
        raise exception 'Lab institution does not match this safety center' using errcode = '42501';
    end if;

    v_scope := coalesce(p_scope, array['summary', 'risk_detail', 'exports']::text[]);
    if cardinality(v_scope) = 0 or exists (
        select 1
        from unnest(v_scope) as requested(value)
        where requested.value is null
           or requested.value not in ('summary', 'risk_detail', 'exports', 'waste_management')
    ) then
        raise exception 'Unsupported link scope' using errcode = '22023';
    end if;

    insert into public.safety_center_lab_links (
        center_id,
        lab_id,
        status,
        scope,
        requested_by,
        approved_by,
        responded_at
    ) values (
        p_center_id,
        p_lab_id,
        'requested',
        v_scope,
        v_user_id,
        null,
        null
    )
    on conflict (center_id, lab_id) do update
    set
        status = case
            when public.safety_center_lab_links.status = 'approved'
                 and excluded.scope <@ public.safety_center_lab_links.scope then 'approved'
            else 'requested'
        end,
        scope = excluded.scope,
        requested_by = excluded.requested_by,
        requested_at = now(),
        approved_by = case
            when public.safety_center_lab_links.status = 'approved'
                 and excluded.scope <@ public.safety_center_lab_links.scope then public.safety_center_lab_links.approved_by
            else null
        end,
        responded_at = case
            when public.safety_center_lab_links.status = 'approved'
                 and excluded.scope <@ public.safety_center_lab_links.scope then public.safety_center_lab_links.responded_at
            else null
        end
    returning id into v_link_id;

    return v_link_id;
end;
$$;

-- Voided (corrected) waste logs are not disposal records for the center.
create or replace function public.get_safety_center_waste_logs(p_center_id uuid, p_created_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_created_before timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(id uuid, lab_id uuid, lab_name text, created_at timestamp with time zone, disposal_category text, total_volume_ml numeric, handler_name text, memo text, chemicals jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    return query
    select
        wl.id,
        wl.lab_id,
        l.name,
        wl.created_at,
        wl.disposal_category,
        wl.total_volume_ml,
        wl.handler_name,
        wl.memo,
        wl.chemicals
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.waste_logs wl on wl.lab_id = scl.lab_id
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'summary' = any(scl.scope)
      and wl.voided_at is null
      and (p_created_after is null or wl.created_at >= p_created_after)
      and (p_created_before is null or wl.created_at <= p_created_before)
    order by wl.created_at desc
    limit 5000;
end;
$$;

-- Member-management rows stay inside the lab; a center sees only its own
-- link's rows among the center-link rows.
create or replace function public.get_safety_center_audit_logs(p_center_id uuid, p_limit integer DEFAULT 100) RETURNS TABLE(id uuid, lab_id uuid, lab_name text, created_at timestamp with time zone, actor_name text, entity_type text, entity_id uuid, action text, location_context text, before_data jsonb, after_data jsonb, diff_data jsonb, source text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    if not public.is_safety_center_member(p_center_id) then
        raise exception 'Access denied for safety center %', p_center_id using errcode = '42501';
    end if;

    return query
    select
        a.id,
        a.lab_id,
        l.name,
        a.created_at,
        a.actor_name,
        a.entity_type,
        a.entity_id,
        a.action,
        a.location_context,
        a.before_data,
        a.after_data,
        a.diff_data,
        a.source
    from public.safety_center_lab_links scl
    join public.labs l on l.id = scl.lab_id
    join public.audit_logs a on a.lab_id = scl.lab_id
    where scl.center_id = p_center_id
      and scl.status = 'approved'
      and 'summary' = any(scl.scope)
      and a.entity_type <> 'lab_member'
      and (a.entity_type <> 'safety_center_link' or a.entity_id = scl.id)
    order by a.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end;
$$;

-- 7. Operator status with a rejection reason (F4) -----------------------------
-- v1 (OPS10) stays unchanged. Review input is checked before authorization.

create function public.operator_safety_center_status_v2(
    p_operator_user_id uuid,
    p_center_id uuid,
    p_status text,
    p_request_id uuid,
    p_assurance_level text,
    p_review_reason text,
    p_review_note text
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
    v_note text := nullif(pg_catalog.btrim(p_review_note), '');
begin
    perform private.require_operator_service_v1();
    if p_center_id is null or coalesce(p_status, '') not in ('pending','approved','rejected') or p_request_id is null then
        raise exception 'Invalid safety-center status request' using errcode = '22023';
    end if;
    if (p_review_reason is not null and p_review_reason not in (
            'document_unverifiable', 'institution_mismatch', 'domain_mismatch',
            'not_safety_office', 'duplicate_center', 'other'))
       or pg_catalog.char_length(v_note) > 500
       or (p_status <> 'rejected' and (p_review_reason is not null or v_note is not null))
       or (v_note is not null and p_review_reason is null)
       or (p_review_reason = 'other' and v_note is null) then
        raise exception 'Invalid safety-center review' using errcode = '22023';
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
    -- Rejecting with a reason replaces the stored pair; any other change keeps it.
    update public.safety_centers set
      status=p_status,
      approved_by=case when p_status='approved' then p_operator_user_id else null end,
      approved_at=case when p_status='approved' then v_now else null end,
      review_reason=case when p_status='rejected' and p_review_reason is not null then p_review_reason else review_reason end,
      review_note=case when p_status='rejected' and p_review_reason is not null then v_note else review_note end,
      updated_at=v_now
    where id=p_center_id returning * into v_item;

    perform private.insert_operator_audit_v1(
      p_request_id, p_operator_user_id, 'approver', 'safety_centers.status', 'safety_center', p_center_id,
      'succeeded', null, p_assurance_level
    );
    return jsonb_build_object('success', true, 'item', to_jsonb(v_item));
end;
$function$;

revoke all on function public.operator_safety_center_status_v2(uuid, uuid, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.operator_safety_center_status_v2(uuid, uuid, text, uuid, text, text, text)
  to service_role;

-- 8. Applicant view of the rejection reason -----------------------------------
-- RETURNS TABLE changes, so drop and recreate with the baseline grants
-- (authenticated and service_role; never anon).

drop function public.get_my_safety_centers();

create function public.get_my_safety_centers()
returns table(id uuid, institution_name text, institution_domain text, center_name text, status text,
  created_by uuid, approved_at timestamp with time zone, created_at timestamp with time zone, member_role text,
  review_reason text, review_note text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required' using errcode = '28000';
    end if;

    return query
    select
        sc.id,
        sc.institution_name,
        sc.institution_domain,
        sc.center_name,
        sc.status,
        sc.created_by,
        sc.approved_at,
        sc.created_at,
        scm.role as member_role,
        case when sc.status = 'rejected' then sc.review_reason end,
        case when sc.status = 'rejected' then sc.review_note end
    from public.safety_center_members scm
    join public.safety_centers sc on sc.id = scm.center_id
    where scm.user_id = auth.uid()
    order by sc.created_at desc;
end;
$$;

revoke all on function public.get_my_safety_centers()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_safety_centers() to authenticated, service_role;

commit;
