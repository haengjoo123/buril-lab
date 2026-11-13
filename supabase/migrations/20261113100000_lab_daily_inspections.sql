-- Daily lab safety inspections (연구실 일상점검). One record per lab per
-- calendar day in Korea; any lab member records it and saving again on the
-- same day replaces that day's record. A safety center reads only per-lab
-- counts, through an approved link carrying the summary scope. Additive.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.lab_daily_inspections (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id) on delete cascade,
  inspection_date date not null,
  checklist_version text not null,
  results jsonb not null,
  issue_count integer not null,
  note text,
  inspected_by uuid references auth.users(id) on delete set null,
  inspector_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lab_daily_inspections_lab_date_key unique (lab_id, inspection_date),
  constraint lab_daily_inspections_version_check check (checklist_version ~ '^[a-z0-9-]{1,40}$'),
  constraint lab_daily_inspections_results_check check (jsonb_typeof(results) = 'object' and octet_length(results::text) <= 8192),
  constraint lab_daily_inspections_issue_check check (issue_count >= 0),
  constraint lab_daily_inspections_note_check check (note is null or char_length(note) between 1 and 1000),
  constraint lab_daily_inspections_inspector_check check (inspector_name is null or char_length(inspector_name) <= 120)
);

comment on table public.lab_daily_inspections is
  'Daily lab safety inspection records. Written only through save_lab_daily_inspection_v1; one row per lab per Korean calendar day.';

alter table public.lab_daily_inspections enable row level security;
create policy lab_daily_inspections_select_members_v1 on public.lab_daily_inspections for select to authenticated
using (
  (select auth.uid()) is not null and exists (
    select 1 from public.lab_members lm
    where lm.lab_id = lab_daily_inspections.lab_id and lm.user_id = (select auth.uid())
  )
);
revoke all on public.lab_daily_inspections from public, anon, authenticated, service_role;
grant select on public.lab_daily_inspections to authenticated;
grant all on public.lab_daily_inspections to service_role;

-- When the inspector's account is deleted the reference becomes null; the
-- stored display name goes with it so no personal name outlives the account.
create function private.clear_daily_inspection_inspector_v1() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.inspected_by is null and old.inspected_by is not null then
    new.inspector_name := null;
  end if;
  return new;
end $$;
revoke all on function private.clear_daily_inspection_inspector_v1() from public, anon, authenticated;

create trigger lab_daily_inspections_clear_inspector_v1
  before update on public.lab_daily_inspections
  for each row execute function private.clear_daily_inspection_inspector_v1();

-- Results are a flat object of item id -> 'ok' | 'bad' | 'na'.
create function private.daily_inspection_results_valid_v1(p_results jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_count integer;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'object' then
    return false;
  end if;
  select count(*) into v_count from jsonb_each(p_results);
  if v_count < 1 or v_count > 80 then
    return false;
  end if;
  return not exists (
    select 1 from jsonb_each(p_results) e
    where e.key !~ '^[a-z0-9_]{1,40}$'
       or jsonb_typeof(e.value) <> 'string'
       or (e.value #>> '{}') not in ('ok', 'bad', 'na')
  );
end $$;
revoke all on function private.daily_inspection_results_valid_v1(jsonb) from public, anon, authenticated;

create function public.save_lab_daily_inspection_v1(
  p_lab_id uuid,
  p_checklist_version text,
  p_results jsonb,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_row public.lab_daily_inspections;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_lab_id is null or not exists (
    select 1 from public.lab_members lm where lm.lab_id = p_lab_id and lm.user_id = auth.uid()
  ) then
    raise exception 'DAILY_INSPECTION_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_checklist_version is null or p_checklist_version !~ '^[a-z0-9-]{1,40}$'
     or not private.daily_inspection_results_valid_v1(p_results)
     or (v_note is not null and char_length(v_note) > 1000) then
    raise exception 'DAILY_INSPECTION_INVALID_INPUT' using errcode = '22023';
  end if;

  insert into public.lab_daily_inspections as i
    (lab_id, inspection_date, checklist_version, results, issue_count, note, inspected_by, inspector_name)
  values (
    p_lab_id,
    v_today,
    p_checklist_version,
    p_results,
    (select count(*) from jsonb_each_text(p_results) e where e.value = 'bad'),
    v_note,
    auth.uid(),
    left(private.actor_display_name_v2(auth.uid(), p_lab_id), 120)
  )
  on conflict (lab_id, inspection_date) do update
  set checklist_version = excluded.checklist_version,
      results = excluded.results,
      issue_count = excluded.issue_count,
      note = excluded.note,
      inspected_by = excluded.inspected_by,
      inspector_name = excluded.inspector_name,
      updated_at = now()
  returning i.* into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'lab_id', v_row.lab_id,
    'inspection_date', v_row.inspection_date,
    'checklist_version', v_row.checklist_version,
    'results', v_row.results,
    'issue_count', v_row.issue_count,
    'note', v_row.note,
    'inspected_by', v_row.inspected_by,
    'inspector_name', v_row.inspector_name,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
end $$;
revoke all on function public.save_lab_daily_inspection_v1(uuid, text, jsonb, text) from public, anon;
grant execute on function public.save_lab_daily_inspection_v1(uuid, text, jsonb, text) to authenticated, service_role;

-- Per-lab inspection counts over the last p_days Korean calendar days (1 to 92).
-- A caller who is not a member of an approved center, or a link without the
-- summary scope, yields no rows. Item-level results and notes are not returned.
create function public.get_safety_center_inspection_summary_v1(p_center_id uuid, p_days integer default 30)
returns table (
  lab_id uuid,
  lab_name text,
  period_days integer,
  inspected_days bigint,
  issue_days bigint,
  last_inspection_date date
)
language sql stable security definer set search_path = '' as $$
  select
    l.id,
    l.name,
    d.n,
    count(i.id),
    count(i.id) filter (where i.issue_count > 0),
    max(i.inspection_date)
  from (select least(greatest(coalesce(p_days, 30), 1), 92) as n, (now() at time zone 'Asia/Seoul')::date as today) d
  cross join public.safety_center_lab_links scl
  join public.safety_centers sc on sc.id = scl.center_id
  join public.labs l on l.id = scl.lab_id
  left join public.lab_daily_inspections i
    on i.lab_id = scl.lab_id
   and i.inspection_date > d.today - d.n
   and i.inspection_date <= d.today
  where auth.uid() is not null
    and public.is_safety_center_member(p_center_id)
    and scl.center_id = p_center_id
    and sc.status = 'approved'
    and scl.status = 'approved'
    and 'summary' = any(scl.scope)
  group by l.id, l.name, d.n
  order by l.name, l.id
  limit 500;
$$;
revoke all on function public.get_safety_center_inspection_summary_v1(uuid, integer) from public, anon;
grant execute on function public.get_safety_center_inspection_summary_v1(uuid, integer) to authenticated, service_role;

commit;
