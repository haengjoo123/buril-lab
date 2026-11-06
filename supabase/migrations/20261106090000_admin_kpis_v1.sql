-- Admin KPIs v1: one read-only operator aggregate over existing tables, an
-- internal-lab exclusion list, two data-hygiene fixes (F1 onboarding query
-- text, F2 commerce event CHECKs). No public table, no SECURITY DEFINER.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Internal and test labs left out of every KPI. Managed with SQL by the
-- database owner (see docs/operations/admin-kpis-rollout.md). Not in the
-- Data API schema; only service_role may read it. RLS is deliberately not
-- enabled: no browser role has a grant or schema usage, and an RLS table
-- without policies would add an rls_enabled_no_policy Advisor finding.
create table private.analytics_internal_labs (
  lab_id uuid primary key references public.labs(id) on delete cascade,
  reason text not null default 'internal',
  added_at timestamptz not null default now(),
  constraint analytics_internal_labs_reason_check
    check (reason in ('internal', 'test', 'demo'))
);
comment on table private.analytics_internal_labs is
  'Labs excluded from operator KPIs (analytics_admin_kpis_v1). Members of these labs are also excluded from user-level KPIs. No names, emails, or free text.';
revoke all on table private.analytics_internal_labs from public, anon, authenticated, service_role;
grant select on table private.analytics_internal_labs to service_role;

-- p_days guard: same accepted range as analytics_admin_summary (1..365), but
-- rejected instead of silently clamped. The API already clamps.
create function private.analytics_kpi_days_v1(p_days integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'p_days must be an integer between 1 and 365' using errcode = '22023';
  end if;
  return p_days;
end;
$function$;
revoke all on function private.analytics_kpi_days_v1(integer) from public, anon, authenticated;
grant execute on function private.analytics_kpi_days_v1(integer) to service_role;

create function public.analytics_admin_kpis_v1(p_days integer)
returns jsonb
language sql
stable
set search_path = ''
set timezone = 'UTC'
as $function$
with
bounds as materialized (
  select
    d.days,
    pg_catalog.now() as now_at,
    pg_catalog.now() - pg_catalog.make_interval(days => d.days) as cur_start,
    pg_catalog.now() - pg_catalog.make_interval(days => 2 * d.days) as prev_start,
    (pg_catalog.now() at time zone 'Asia/Seoul')::date as seoul_today
  from (select private.analytics_kpi_days_v1(p_days) as days) d
),
internal_labs as materialized (
  select i.lab_id from private.analytics_internal_labs i
),
internal_users as materialized (
  select distinct m.user_id
  from public.lab_members m
  join internal_labs i on i.lab_id = m.lab_id
),
customer_labs as materialized (
  select l.id, l.created_at, l.institution_name
  from public.labs l
  where not exists (select 1 from internal_labs i where i.lab_id = l.id)
),
-- CR: core records of existing customer labs, last 60 days (ACT needs 60, the weekly series 56).
cr as materialized (
  select w.lab_id, w.user_id, w.created_at
  from public.waste_logs w
  cross join bounds b
  where w.schema_version = 2
    and w.voided_at is null
    and w.lab_id is not null
    and w.created_at >= b.now_at - interval '60 days'
    and w.created_at < b.now_at
    and exists (select 1 from customer_labs l where l.id = w.lab_id)
  union all
  select a.lab_id, a.actor_user_id, a.created_at
  from public.audit_logs a
  cross join bounds b
  where a.entity_type in ('inventory', 'cabinet', 'cabinet_item', 'cabinet_activity', 'waste_container')
    and a.actor_user_id is not null
    and a.lab_id is not null
    and a.created_at >= b.now_at - interval '60 days'
    and a.created_at < b.now_at
    and exists (select 1 from customer_labs l where l.id = a.lab_id)
),
-- ACT: CR plus signed-in event rows, last 60 days, internal users removed.
act as materialized (
  select x.user_id, x.created_at
  from (
    select c.user_id, c.created_at from cr c
    union all
    select e.user_id, e.created_at from public.search_analytics_events e
    where e.user_id is not null and (e.lab_id is null or not exists (select 1 from internal_labs i where i.lab_id = e.lab_id))
    union all
    select e.user_id, e.created_at from public.onboarding_events e
    where e.lab_id is null or not exists (select 1 from internal_labs i where i.lab_id = e.lab_id)
    union all
    select e.user_id, e.created_at from public.commerce_intent_events e
    where e.lab_id is null or not exists (select 1 from internal_labs i where i.lab_id = e.lab_id)
    union all
    select e.user_id, e.created_at from public.safety_compliance_events e
    where e.lab_id is null or not exists (select 1 from internal_labs i where i.lab_id = e.lab_id)
  ) x
  cross join bounds b
  where x.user_id is not null
    and x.created_at >= b.now_at - interval '60 days'
    and x.created_at < b.now_at
    and not exists (select 1 from internal_users u where u.user_id = x.user_id)
),
act_users as materialized (
  select a.user_id,
    bool_or(a.created_at >= b.now_at - interval '7 days') as wau_current,
    bool_or(a.created_at >= b.now_at - interval '14 days' and a.created_at < b.now_at - interval '7 days') as wau_previous,
    bool_or(a.created_at >= b.now_at - interval '30 days') as mau_current,
    bool_or(a.created_at >= b.now_at - interval '60 days' and a.created_at < b.now_at - interval '30 days') as mau_previous,
    bool_or(a.created_at >= b.now_at - interval '37 days' and a.created_at < b.now_at - interval '7 days') as mau_week_ago
  from act a
  cross join bounds b
  group by a.user_id
),
weeks as materialized (
  select g.k,
    b.now_at - pg_catalog.make_interval(days => 7 * (g.k + 1)) as w_start,
    b.now_at - pg_catalog.make_interval(days => 7 * g.k) as w_end
  from bounds b
  cross join pg_catalog.generate_series(0, 7) as g(k)
),
-- Week k (0 = newest) is [now - 7(k+1) days, now - 7k days), the same bounds as weeks.
lab_weeks as materialized (
  select distinct c.lab_id,
    (pg_catalog.ceil(extract(epoch from (b.now_at - c.created_at)) / 604800.0))::integer - 1 as k
  from cr c
  cross join bounds b
  where c.created_at >= b.now_at - interval '56 days'
),
wsal_weekly as (
  select w.k, w.w_start, w.w_end,
    (select count(distinct lw.lab_id) from lab_weeks lw where lw.k = w.k) as labs
  from weeks w
),
-- Waste records v2 in [prev_start, now), customer scope.
wl2 as materialized (
  select w.id, w.lab_id, w.created_at, w.voided_at, w.void_reason, w.decision_status, w.decision_snapshot,
    (w.created_at >= b.cur_start) as is_current
  from public.waste_logs w
  cross join bounds b
  where w.schema_version = 2
    and w.created_at >= b.prev_start
    and w.created_at < b.now_at
    and (w.lab_id is null or not exists (select 1 from internal_labs i where i.lab_id = w.lab_id))
    and (w.user_id is null or not exists (select 1 from internal_users u where u.user_id = w.user_id))
),
d4 as (
  select
    (l.created_at >= b.now_at - interval '42 days') as is_current,
    (select count(*) from public.lab_members m
      where m.lab_id = l.id and m.joined_at < l.created_at + interval '14 days') >= 2 as a_member,
    (
      exists (select 1 from public.inventory i
        where i.lab_id = l.id and i.created_at >= l.created_at and i.created_at < l.created_at + interval '14 days')
      or exists (select 1 from public.cabinet_items ci join public.cabinets c on c.id = ci.cabinet_id
        where c.lab_id = l.id and ci.created_at >= l.created_at and ci.created_at < l.created_at + interval '14 days')
      or exists (select 1 from public.audit_logs a
        where a.lab_id = l.id and a.entity_type in ('inventory', 'cabinet_item', 'cabinet_activity') and a.action = 'create'
          and a.created_at >= l.created_at and a.created_at < l.created_at + interval '14 days')
    ) as b_item,
    exists (select 1 from public.waste_logs w
      where w.lab_id = l.id and w.schema_version = 2 and w.voided_at is null
        and w.created_at >= l.created_at and w.created_at < l.created_at + interval '14 days') as c_waste
  from customer_labs l
  cross join bounds b
  where l.created_at >= b.now_at - interval '70 days'
    and l.created_at < b.now_at - interval '14 days'
),
d5 as (
  select
    (l.created_at >= b.now_at - interval '84 days') as is_current,
    (
      exists (select 1 from public.waste_logs w
        where w.lab_id = l.id and w.schema_version = 2 and w.voided_at is null
          and w.created_at >= l.created_at + interval '21 days' and w.created_at < l.created_at + interval '28 days')
      or exists (select 1 from public.audit_logs a
        where a.lab_id = l.id and a.actor_user_id is not null
          and a.entity_type in ('inventory', 'cabinet', 'cabinet_item', 'cabinet_activity', 'waste_container')
          and a.created_at >= l.created_at + interval '21 days' and a.created_at < l.created_at + interval '28 days')
    ) as retained
  from customer_labs l
  cross join bounds b
  where l.created_at >= b.now_at - interval '140 days'
    and l.created_at < b.now_at - interval '28 days'
),
onb as materialized (
  select e.user_id, e.platform, e.event_type, e.step_key, e.created_at
  from public.onboarding_events e
  cross join bounds b
  where e.created_at < b.now_at
    and (e.lab_id is null or not exists (select 1 from internal_labs i where i.lab_id = e.lab_id))
    and not exists (select 1 from internal_users u where u.user_id = e.user_id)
),
first_shown as (
  select distinct on (o.user_id) o.user_id, o.platform, o.created_at as shown_at
  from onb o
  where o.event_type = 'shown'
  order by o.user_id, o.created_at, o.platform
),
d6 as (
  select f.platform,
    (f.shown_at >= b.cur_start) as is_current,
    coalesce(bool_or(o.event_type = 'step_completed'), false) as step_completed,
    count(distinct o.step_key) filter (
      where o.event_type = 'step_completed' and o.step_key in ('search', 'disposal', 'cabinet', 'inventory')) = 4 as all_steps,
    coalesce(bool_or(o.event_type = 'first_value_reached'), false) as first_value,
    coalesce(bool_or(o.event_type = 'skipped'), false) as skipped
  from first_shown f
  cross join bounds b
  left join onb o on o.user_id = f.user_id and o.created_at >= f.shown_at
  where f.shown_at >= b.prev_start
  group by f.user_id, f.platform, f.shown_at, b.cur_start
),
s1_fields as (
  select f.field, count(distinct w.id) as records
  from wl2 w
  cross join lateral pg_catalog.jsonb_array_elements_text(
    case when pg_catalog.jsonb_typeof(coalesce(w.decision_snapshot -> 'missingFields', w.decision_snapshot -> 'missing_fields')) = 'array'
      then coalesce(w.decision_snapshot -> 'missingFields', w.decision_snapshot -> 'missing_fields')
      else '[]'::jsonb end
  ) as f(field)
  where w.is_current and w.voided_at is null and w.decision_status in ('needs_input', 'blocked')
    and f.field in ('components', 'matrix', 'total_amount', 'measured_ph', 'identity', 'hazard_data',
      'additional_components', 'mixing_state', 'fluoride_container', 'inventory_quantity',
      'policy_stream', 'policy_destination')
  group by f.field
),
s2 as (
  select w.is_current, w.voided_at is not null as is_voided,
    case pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(w.void_reason), '\s+', ' ', 'g'))
      when '양 오입력' then 'amount' when 'wrong amount' then 'amount'
      when '중복 기록' then 'duplicate' when 'duplicate entry' then 'duplicate'
      when '분류 오선택' then 'category' when 'wrong category' then 'category'
      else 'other'
    end as reason
  from wl2 w
),
s3 as materialized (
  select e.lab_id, e.rule_id, (e.created_at >= b.cur_start) as is_current
  from public.safety_compliance_events e
  cross join bounds b
  where e.event_type = 'storage_warning_ignored'
    and e.warning_severity = 'DANGER'
    and e.created_at >= b.prev_start and e.created_at < b.now_at
    and (e.lab_id is null or not exists (select 1 from internal_labs i where i.lab_id = e.lab_id))
    and not exists (select 1 from internal_users u where u.user_id = e.user_id)
),
open_requests as (
  select r.lab_id, r.due_date
  from public.safety_center_requests r
  where r.status in ('open', 'in_progress')
    and exists (select 1 from customer_labs l where l.id = r.lab_id)
),
s6_first as (
  select (r.created_at >= b.cur_start) as is_current,
    (select min(e.created_at) from public.safety_center_request_events e
      where e.request_id = r.id and e.actor_scope = 'lab') - r.created_at as first_lab_after
  from public.safety_center_requests r
  cross join bounds b
  where r.created_at >= b.prev_start and r.created_at < b.now_at
    and exists (select 1 from customer_labs l where l.id = r.lab_id)
),
s7 as (
  select w.is_current, i.ghs_data_status
  from public.waste_log_items i
  join wl2 w on w.id = i.waste_log_id
  where w.voided_at is null
),
centers as (
  select c.id, c.status, c.created_at, c.approved_at, c.institution_name
  from public.safety_centers c
),
-- A request to an internal or deleted lab does not make a center active.
center_activity as (
  select c.id,
    exists (select 1 from public.safety_center_requests r where r.center_id = c.id and r.created_at >= b.cur_start and r.created_at < b.now_at
        and exists (select 1 from customer_labs l where l.id = r.lab_id))
      or exists (select 1 from public.safety_center_exports x where x.center_id = c.id and x.created_at >= b.cur_start and x.created_at < b.now_at) as active_current,
    exists (select 1 from public.safety_center_requests r where r.center_id = c.id and r.created_at >= b.prev_start and r.created_at < b.cur_start
        and exists (select 1 from customer_labs l where l.id = r.lab_id))
      or exists (select 1 from public.safety_center_exports x where x.center_id = c.id and x.created_at >= b.prev_start and x.created_at < b.cur_start) as active_previous
  from centers c
  cross join bounds b
  where c.status = 'approved'
),
lab_keys as (
  select l.id, pg_catalog.left(pg_catalog.lower(pg_catalog.btrim(l.institution_name)), 100) as key
  from customer_labs l
  where nullif(pg_catalog.btrim(l.institution_name), '') is not null
),
approved_keys as (
  select distinct pg_catalog.left(pg_catalog.lower(pg_catalog.btrim(c.institution_name)), 100) as key
  from centers c where c.status = 'approved'
),
pending_keys as (
  select distinct pg_catalog.left(pg_catalog.lower(pg_catalog.btrim(c.institution_name)), 100) as key
  from centers c where c.status = 'pending'
),
sales_candidates as (
  select k.key, count(distinct k.id) as active_labs
  from lab_keys k
  join lab_weeks lw on lw.lab_id = k.id and lw.k = 0
  where not exists (select 1 from approved_keys a where a.key = k.key)
  group by k.key
  having count(distinct k.id) >= 2
),
b3 as (
  select lw.lab_id,
    count(distinct lw.k) filter (where lw.k between 0 and 3) as weeks_current,
    count(distinct lw.k) filter (where lw.k between 4 and 7) as weeks_previous
  from lab_weeks lw
  group by lw.lab_id
),
b3_labs as (
  select p.is_current,
    (select count(*) from public.lab_members m
      where m.lab_id = x.lab_id
        and m.joined_at < case when p.is_current then b.now_at else b.now_at - interval '28 days' end) as seats
  from b3 x
  cross join bounds b
  cross join (values (true), (false)) as p(is_current)
  where (p.is_current and x.weeks_current >= 3) or (not p.is_current and x.weeks_previous >= 3)
),
cie as materialized (
  select e.lab_id, e.user_id, e.brand_normalized, e.cas_number_normalized, (e.created_at >= b.cur_start) as is_current
  from public.commerce_intent_events e
  cross join bounds b
  where e.event_type in ('inventory_registered', 'inventory_updated', 'cabinet_item_placed', 'cabinet_item_scanned', 'cabinet_item_updated')
    and e.created_at >= b.prev_start and e.created_at < b.now_at
    and (e.lab_id is null or not exists (select 1 from internal_labs i where i.lab_id = e.lab_id))
    and not exists (select 1 from internal_users u where u.user_id = e.user_id)
),
brands as (
  select pg_catalog.left(c.brand_normalized, 100) as brand,
    count(*) as events, count(distinct c.lab_id) as labs, count(distinct c.user_id) as users
  from cie c
  where c.is_current and c.brand_normalized is not null
  group by pg_catalog.left(c.brand_normalized, 100)
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'generatedAt', b.now_at,
  'period', pg_catalog.jsonb_build_object(
    'days', b.days,
    'timeZone', 'Asia/Seoul',
    'currentStart', b.cur_start,
    'currentEnd', b.now_at,
    'previousStart', b.prev_start
  ),
  'exclusions', pg_catalog.jsonb_build_object(
    'internalLabs', (select count(*) from internal_labs),
    'internalUsers', (select count(*) from internal_users)
  ),
  'inbox', pg_catalog.jsonb_build_object(
    'centers', (select pg_catalog.jsonb_build_object(
        'count', count(*),
        'oldestCreatedAt', min(c.created_at))
      from public.safety_centers c where c.status = 'pending'),
    'feedback', (select pg_catalog.jsonb_build_object(
        'count', count(*),
        'byType', pg_catalog.jsonb_build_object(
          'bug', count(*) filter (where f.type = 'bug'),
          'improvement', count(*) filter (where f.type = 'improvement'),
          'general', count(*) filter (where f.type = 'general')),
        'oldestCreatedAt', min(f.created_at))
      from public.feedback f where f.status = 'new'),
    'reviews', (select pg_catalog.jsonb_build_object(
        'count', count(*),
        'oldestCreatedAt', min(r.created_at),
        'lastUpdatedAt', max(r.updated_at))
      from public.analytics_review_candidates r where r.status = 'pending')
  ),
  'product', pg_catalog.jsonb_build_object(
    'wsal', pg_catalog.jsonb_build_object(
      'current', (select w.labs from wsal_weekly w where w.k = 0),
      'previous', (select w.labs from wsal_weekly w where w.k = 1),
      'totalLabs', (select count(*) from customer_labs),
      'weekly', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('start', w.w_start, 'end', w.w_end, 'labs', w.labs) order by w.k desc) from wsal_weekly w)
    ),
    'activeUsers', (select pg_catalog.jsonb_build_object(
        'wau', pg_catalog.jsonb_build_object(
          'current', count(*) filter (where u.wau_current),
          'previous', count(*) filter (where u.wau_previous)),
        'mau', pg_catalog.jsonb_build_object(
          'current', count(*) filter (where u.mau_current),
          'previous', count(*) filter (where u.mau_previous)),
        'stickiness', pg_catalog.jsonb_build_object(
          'current', pg_catalog.jsonb_build_object(
            'numerator', count(*) filter (where u.wau_current),
            'denominator', count(*) filter (where u.mau_current)),
          'previous', pg_catalog.jsonb_build_object(
            'numerator', count(*) filter (where u.wau_previous),
            'denominator', count(*) filter (where u.mau_week_ago))))
      from act_users u),
    'activation14d', pg_catalog.jsonb_build_object(
      'current', (select pg_catalog.jsonb_build_object(
          'cohortLabs', count(*), 'secondMember', count(*) filter (where d.a_member),
          'firstItem', count(*) filter (where d.b_item), 'firstWasteRecord', count(*) filter (where d.c_waste),
          'fullyActivated', count(*) filter (where d.a_member and d.b_item and d.c_waste))
        from d4 d where d.is_current),
      'previous', (select pg_catalog.jsonb_build_object(
          'cohortLabs', count(*), 'secondMember', count(*) filter (where d.a_member),
          'firstItem', count(*) filter (where d.b_item), 'firstWasteRecord', count(*) filter (where d.c_waste),
          'fullyActivated', count(*) filter (where d.a_member and d.b_item and d.c_waste))
        from d4 d where not d.is_current)
    ),
    'retentionW4', pg_catalog.jsonb_build_object(
      'current', (select pg_catalog.jsonb_build_object('numerator', count(*) filter (where d.retained), 'denominator', count(*)) from d5 d where d.is_current),
      'previous', (select pg_catalog.jsonb_build_object('numerator', count(*) filter (where d.retained), 'denominator', count(*)) from d5 d where not d.is_current)
    ),
    'onboarding', (select pg_catalog.jsonb_object_agg(p.platform, pg_catalog.jsonb_build_object(
        'current', (select pg_catalog.jsonb_build_object(
            'shown', count(*), 'stepCompleted', count(*) filter (where d.step_completed),
            'allStepsCompleted', count(*) filter (where d.all_steps),
            'firstValueReached', count(*) filter (where d.first_value), 'skipped', count(*) filter (where d.skipped))
          from d6 d where d.platform = p.platform and d.is_current),
        'previous', (select pg_catalog.jsonb_build_object(
            'shown', count(*), 'stepCompleted', count(*) filter (where d.step_completed),
            'allStepsCompleted', count(*) filter (where d.all_steps),
            'firstValueReached', count(*) filter (where d.first_value), 'skipped', count(*) filter (where d.skipped))
          from d6 d where d.platform = p.platform and not d.is_current)))
      from (values ('web'), ('native')) as p(platform))
  ),
  'safety', pg_catalog.jsonb_build_object(
    'needsReview', pg_catalog.jsonb_build_object(
      'current', (select pg_catalog.jsonb_build_object(
          'numerator', count(*) filter (where w.decision_status in ('needs_input', 'blocked')),
          'denominator', count(*),
          'needsInput', count(*) filter (where w.decision_status = 'needs_input'),
          'blocked', count(*) filter (where w.decision_status = 'blocked'))
        from wl2 w where w.is_current and w.voided_at is null),
      'previous', (select pg_catalog.jsonb_build_object(
          'numerator', count(*) filter (where w.decision_status in ('needs_input', 'blocked')),
          'denominator', count(*),
          'needsInput', count(*) filter (where w.decision_status = 'needs_input'),
          'blocked', count(*) filter (where w.decision_status = 'blocked'))
        from wl2 w where not w.is_current and w.voided_at is null),
      'topMissingFields', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('field', t.field, 'records', t.records) order by t.records desc, t.field)
        from (select s.field, s.records from s1_fields s order by s.records desc, s.field limit 5) t), '[]'::jsonb)
    ),
    'corrections', pg_catalog.jsonb_build_object(
      'current', (select pg_catalog.jsonb_build_object('numerator', count(*) filter (where s.is_voided), 'denominator', count(*)) from s2 s where s.is_current),
      'previous', (select pg_catalog.jsonb_build_object('numerator', count(*) filter (where s.is_voided), 'denominator', count(*)) from s2 s where not s.is_current),
      'byReason', (select pg_catalog.jsonb_build_object(
          'amount', count(*) filter (where s.reason = 'amount'),
          'duplicate', count(*) filter (where s.reason = 'duplicate'),
          'category', count(*) filter (where s.reason = 'category'),
          'other', count(*) filter (where s.reason = 'other'))
        from s2 s where s.is_current and s.is_voided)
    ),
    'dangerIgnored', pg_catalog.jsonb_build_object(
      'current', (select pg_catalog.jsonb_build_object('events', count(*), 'labs', count(distinct s.lab_id)) from s3 s where s.is_current),
      'previous', (select pg_catalog.jsonb_build_object('events', count(*), 'labs', count(distinct s.lab_id)) from s3 s where not s.is_current),
      'topRules', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('ruleId', t.rule_id, 'events', t.events) order by t.events desc, t.rule_id)
        from (select s.rule_id, count(*) as events from s3 s
          -- Closed list: the rule ids of src/utils/storageCompatibilityChecker.ts (STORAGE_RULES).
          -- rule_id is client-written text, so anything else is counted in events but never returned.
          where s.is_current and s.rule_id in ('store_flam_oxid', 'store_flam_acid', 'store_oxid_organic',
            'store_acid_cyanide', 'store_acid_sulfide', 'store_inorgacid_azide', 'store_orgacid_azide',
            'store_pyro_flam', 'store_pyro_oxid', 'store_orgperox_flam', 'store_orgperox_acid',
            'store_waterreact_base', 'store_waterreact_acid', 'store_explosive_any', 'store_acid_base',
            'store_orgacid_base', 'store_flam_base', 'store_oxid_acid', 'store_orgacid_oxid')
          group by s.rule_id order by count(*) desc, s.rule_id limit 5) t), '[]'::jsonb)
    ),
    'centerRequests', (select pg_catalog.jsonb_build_object(
        'open', count(*),
        'overdue', count(*) filter (where r.due_date < b.seoul_today),
        'overdueLabs', count(distinct r.lab_id) filter (where r.due_date < b.seoul_today),
        'dueSoon', count(*) filter (where r.due_date >= b.seoul_today and r.due_date <= b.seoul_today + 3),
        'firstResponse', pg_catalog.jsonb_build_object(
          'current', (select pg_catalog.jsonb_build_object(
              'requests', count(*), 'responded', count(f.first_lab_after),
              'medianHours', round((percentile_cont(0.5) within group (order by extract(epoch from f.first_lab_after) / 3600.0))::numeric, 1))
            from s6_first f where f.is_current),
          'previous', (select pg_catalog.jsonb_build_object(
              'requests', count(*), 'responded', count(f.first_lab_after),
              'medianHours', round((percentile_cont(0.5) within group (order by extract(epoch from f.first_lab_after) / 3600.0))::numeric, 1))
            from s6_first f where not f.is_current)))
      from open_requests r),
    'ghsCheckGaps', pg_catalog.jsonb_build_object(
      'current', (select pg_catalog.jsonb_build_object(
          'numerator', count(*) filter (where s.ghs_data_status in ('lookup_failed', 'not_checked')),
          'denominator', count(*) filter (where s.ghs_data_status is not null),
          'lookupFailed', count(*) filter (where s.ghs_data_status = 'lookup_failed'),
          'notChecked', count(*) filter (where s.ghs_data_status = 'not_checked'))
        from s7 s where s.is_current),
      'previous', (select pg_catalog.jsonb_build_object(
          'numerator', count(*) filter (where s.ghs_data_status in ('lookup_failed', 'not_checked')),
          'denominator', count(*) filter (where s.ghs_data_status is not null),
          'lookupFailed', count(*) filter (where s.ghs_data_status = 'lookup_failed'),
          'notChecked', count(*) filter (where s.ghs_data_status = 'not_checked'))
        from s7 s where not s.is_current)
    )
  ),
  'b2b', pg_catalog.jsonb_build_object(
    'centerPipeline', pg_catalog.jsonb_build_object(
      'applications', pg_catalog.jsonb_build_object(
        'current', (select count(*) from centers c where c.created_at >= b.cur_start and c.created_at < b.now_at),
        'previous', (select count(*) from centers c where c.created_at >= b.prev_start and c.created_at < b.cur_start)),
      'pending', (select count(*) from centers c where c.status = 'pending'),
      'approved', (select count(*) from centers c where c.status = 'approved'),
      'rejected', (select count(*) from centers c where c.status = 'rejected'),
      'approvalDays', (select pg_catalog.jsonb_build_object(
          'centers', count(*),
          'median', round((percentile_cont(0.5) within group (order by extract(epoch from c.approved_at - c.created_at) / 86400.0))::numeric, 1))
        from centers c where c.status = 'approved' and c.approved_at is not null),
      'activeCenters', pg_catalog.jsonb_build_object(
        'current', (select count(*) from center_activity a where a.active_current),
        'previous', (select count(*) from center_activity a where a.active_previous)),
      'linkedLabs', (select count(distinct k.lab_id) from public.safety_center_lab_links k
        join centers c on c.id = k.center_id and c.status = 'approved'
        where k.status = 'approved' and exists (select 1 from customer_labs l where l.id = k.lab_id)),
      'linkRequestsPending', (select count(*) from public.safety_center_lab_links k
        where k.status = 'requested' and exists (select 1 from customer_labs l where l.id = k.lab_id)),
      'requests', pg_catalog.jsonb_build_object(
        'current', (select count(*) from public.safety_center_requests r
          where r.created_at >= b.cur_start and r.created_at < b.now_at and exists (select 1 from customer_labs l where l.id = r.lab_id)),
        'previous', (select count(*) from public.safety_center_requests r
          where r.created_at >= b.prev_start and r.created_at < b.cur_start and exists (select 1 from customer_labs l where l.id = r.lab_id))),
      'exports', pg_catalog.jsonb_build_object(
        'current', (select count(*) from public.safety_center_exports x where x.created_at >= b.cur_start and x.created_at < b.now_at),
        'previous', (select count(*) from public.safety_center_exports x where x.created_at >= b.prev_start and x.created_at < b.cur_start))
    ),
    'institutions', pg_catalog.jsonb_build_object(
      'labsTotal', (select count(*) from customer_labs),
      'labsWithInstitution', (select count(*) from lab_keys),
      'institutions', (select count(distinct k.key) from lab_keys k),
      'institutionsWithApprovedCenter', (select count(distinct k.key) from lab_keys k where exists (select 1 from approved_keys a where a.key = k.key)),
      'coveredLabs', (select count(*) from lab_keys k where exists (select 1 from approved_keys a where a.key = k.key)),
      'salesCandidates', pg_catalog.jsonb_build_object(
        'count', (select count(*) from sales_candidates),
        'top', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'institution', t.key, 'activeLabs', t.active_labs,
              'hasPendingCenter', exists (select 1 from pending_keys p where p.key = t.key))
            order by t.active_labs desc, t.key)
          from (select s.key, s.active_labs from sales_candidates s order by s.active_labs desc, s.key limit 10) t), '[]'::jsonb)
      )
    ),
    'labProReadiness', pg_catalog.jsonb_build_object(
      'current', (select pg_catalog.jsonb_build_object(
          'habitualLabs', count(*), 'readyLabs', count(*) filter (where x.seats >= 3),
          'seats', pg_catalog.jsonb_build_object(
            'upTo2', count(*) filter (where x.seats <= 2),
            'from3To5', count(*) filter (where x.seats between 3 and 5),
            'from6To10', count(*) filter (where x.seats between 6 and 10),
            'over10', count(*) filter (where x.seats > 10)))
        from b3_labs x where x.is_current),
      'previous', (select pg_catalog.jsonb_build_object(
          'habitualLabs', count(*), 'readyLabs', count(*) filter (where x.seats >= 3),
          'seats', pg_catalog.jsonb_build_object(
            'upTo2', count(*) filter (where x.seats <= 2),
            'from3To5', count(*) filter (where x.seats between 3 and 5),
            'from6To10', count(*) filter (where x.seats between 6 and 10),
            'over10', count(*) filter (where x.seats > 10)))
        from b3_labs x where not x.is_current)
    ),
    'purchaseIntent', pg_catalog.jsonb_build_object(
      'current', (select pg_catalog.jsonb_build_object(
          'events', count(*), 'labs', count(distinct c.lab_id), 'users', count(distinct c.user_id),
          'withCas', count(*) filter (where c.cas_number_normalized is not null))
        from cie c where c.is_current),
      'previous', (select pg_catalog.jsonb_build_object(
          'events', count(*), 'labs', count(distinct c.lab_id), 'users', count(distinct c.user_id),
          'withCas', count(*) filter (where c.cas_number_normalized is not null))
        from cie c where not c.is_current),
      'topBrands', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'brand', t.brand, 'events', t.events, 'labs', t.labs, 'users', t.users)
          order by t.events desc, t.brand)
        from (select x.brand, x.events, x.labs, x.users from brands x
          where x.labs >= 3 and x.users >= 5
          order by x.events desc, x.brand limit 5) t), '[]'::jsonb),
      'hiddenBrands', (select count(*) from brands x where x.labs < 3 or x.users < 5)
    )
  )
)
from bounds b;
$function$;

comment on function public.analytics_admin_kpis_v1(integer) is
  'Operator KPIs (docs/operations/admin-kpis-rollout.md). Counts only: no user ids, emails, names, or free text. service_role only.';
revoke all on function public.analytics_admin_kpis_v1(integer) from public, anon, authenticated;
grant execute on function public.analytics_admin_kpis_v1(integer) to service_role;

-- F2: accept the commerce events the client already sends (src/services/analyticsService.ts).
alter table public.commerce_intent_events
  drop constraint commerce_intent_events_event_type_check,
  add constraint commerce_intent_events_event_type_check check (event_type = any (array[
    'inventory_registered', 'inventory_updated', 'cabinet_item_placed', 'cabinet_item_scanned',
    'cabinet_item_updated', 'cas_suggestion_dismissed'
  ]::text[])),
  drop constraint commerce_intent_events_cas_input_method_check,
  add constraint commerce_intent_events_cas_input_method_check check (cas_input_method = any (array[
    'manual', 'catalog', 'scan', 'ocr', 'voice', 'unknown',
    'suggested_confirmed', 'bulk_confirmed', 'suggestion_dismissed'
  ]::text[]));

-- F1: onboarding rows keep only the length of the search text. Only object
-- metadata is rewritten: browsers can insert any jsonb here, `-` on a scalar
-- would abort the migration, and on an array it would rewrite its elements.
do $do$
declare
  v_rows integer;
begin
  update public.onboarding_events
  set metadata = (metadata - 'query')
    || case
         when pg_catalog.jsonb_typeof(metadata -> 'query') = 'string' and not (metadata ? 'query_length')
           then pg_catalog.jsonb_build_object('query_length', pg_catalog.char_length(pg_catalog.btrim(metadata ->> 'query')))
         else '{}'::jsonb
       end
  where pg_catalog.jsonb_typeof(metadata) = 'object'
    and metadata ? 'query';
  get diagnostics v_rows = row_count;
  raise notice 'admin_kpis_v1: removed metadata.query from % onboarding rows', v_rows;
end;
$do$;

commit;
