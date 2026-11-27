-- Usage records for the search-bar agent mode: how each request was handled
-- and how it ended, so the feature can be judged by what people actually ask.
-- The typed sentence is kept only when the agent could not handle the request.
-- Signed-in clients write through the RPC below and cannot read the table.
-- Additive: no existing object changes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.agent_query_events (
  -- Append-only and never referenced by a client, so a sequential key keeps inserts local.
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lab_id uuid references public.labs(id) on delete set null,
  -- Chosen by the app for one request, so a retried write is not counted twice.
  request_id uuid not null,
  route text not null,
  kind text not null,
  outcome text not null,
  reason text,
  latency_ms integer,
  language text not null,
  failed_text text,
  created_at timestamptz not null default now(),
  constraint agent_query_events_request_key unique (user_id, request_id),
  constraint agent_query_events_route_check check (route in ('planner', 'rule')),
  constraint agent_query_events_kind_check check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- 'proposed' is a proposal to record something; 'confirmed' is written as its
  -- own row, under a new request id, when the person confirms one and it is saved.
  constraint agent_query_events_outcome_check check (outcome in (
    'answered', 'empty', 'no_match', 'navigated', 'handoff_search',
    'disposal_card', 'proposed', 'confirmed', 'unavailable', 'unsupported', 'error'
  )),
  constraint agent_query_events_reason_check check (reason is null or reason ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint agent_query_events_latency_check check (latency_ms is null or latency_ms between 0 and 600000),
  constraint agent_query_events_language_check check (language in ('ko', 'en')),
  -- The sentence may exist only on a request the agent could not handle.
  constraint agent_query_events_failed_text_check check (
    failed_text is null
    or (outcome in ('unsupported', 'no_match') and char_length(failed_text) between 1 and 300)
  )
);

comment on table public.agent_query_events is
  'Agent mode usage records. Written only through record_agent_query_event_v1; not readable by clients.';
comment on column public.agent_query_events.failed_text is
  'The typed sentence, kept only for requests the agent could not handle (outcome unsupported or no_match).';

-- The daily cap in the RPC counts one person's recent rows.
create index agent_query_events_user_created_idx
  on public.agent_query_events (user_id, created_at desc);
-- Covers the lab foreign key and per-lab reporting.
create index agent_query_events_lab_created_idx
  on public.agent_query_events (lab_id, created_at desc)
  where lab_id is not null;

alter table public.agent_query_events enable row level security;
revoke all on public.agent_query_events from public, anon, authenticated, service_role;
grant all on public.agent_query_events to service_role;

-- Records one finished request for the signed-in caller. A lab id needs
-- membership; null means the personal space. Writing the same request again
-- changes nothing, and writes beyond the daily cap are dropped silently so a
-- misbehaving client cannot fill the table.
create function public.record_agent_query_event_v1(
  p_request_id uuid,
  p_route text,
  p_kind text,
  p_outcome text,
  p_language text,
  p_lab_id uuid default null,
  p_reason text default null,
  p_latency_ms integer default null,
  p_failed_text text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_text text := nullif(pg_catalog.btrim(coalesce(p_failed_text, '')), '');
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_lab_id is not null and not exists (
    select 1 from public.lab_members lm where lm.lab_id = p_lab_id and lm.user_id = v_user
  ) then
    raise exception 'AGENT_EVENT_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_route is null or p_route not in ('planner', 'rule')
     or p_kind is null or p_kind !~ '^[a-z][a-z0-9_]{0,39}$'
     or p_outcome is null or p_outcome not in (
       'answered', 'empty', 'no_match', 'navigated', 'handoff_search',
       'disposal_card', 'proposed', 'confirmed', 'unavailable', 'unsupported', 'error'
     )
     or p_language is null or p_language not in ('ko', 'en')
     or (p_reason is not null and p_reason !~ '^[a-z][a-z0-9_]{0,39}$')
     or (p_latency_ms is not null and (p_latency_ms < 0 or p_latency_ms > 600000)) then
    raise exception 'AGENT_EVENT_INVALID_INPUT' using errcode = '22023';
  end if;

  -- Whatever the caller sends, the sentence is kept only for a request the agent could not handle.
  if p_outcome not in ('unsupported', 'no_match') then
    v_text := null;
  end if;

  if (
    select count(*) from public.agent_query_events e
    where e.user_id = v_user and e.created_at >= now() - interval '1 day'
  ) >= 500 then
    return;
  end if;

  insert into public.agent_query_events
    (user_id, lab_id, request_id, route, kind, outcome, reason, latency_ms, language, failed_text)
  values
    (v_user, p_lab_id, p_request_id, p_route, p_kind, p_outcome, p_reason, p_latency_ms, p_language, left(v_text, 300))
  on conflict (user_id, request_id) do nothing;
end $$;
revoke all on function public.record_agent_query_event_v1(uuid, text, text, text, text, uuid, text, integer, text) from public, anon;
grant execute on function public.record_agent_query_event_v1(uuid, text, text, text, text, uuid, text, integer, text) to authenticated, service_role;

commit;
