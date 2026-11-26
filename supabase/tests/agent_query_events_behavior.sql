begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(11);

insert into auth.users(id,email) values
  ('f1000000-0000-4000-8000-000000000001','agent-member@example.invalid'),
  ('f1000000-0000-4000-8000-000000000002','agent-outsider@example.invalid');
insert into public.labs(id,name) values
  ('f2000000-0000-4000-8000-000000000001','Agent lab');
insert into public.lab_members(lab_id,user_id,role) values
  ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','student');

select ok(
  not has_table_privilege('authenticated', 'public.agent_query_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.agent_query_events', 'INSERT')
  and not has_table_privilege('anon', 'public.agent_query_events', 'SELECT')
  and not has_function_privilege('anon', 'public.record_agent_query_event_v1(uuid,text,text,text,text,uuid,text,integer,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.record_agent_query_event_v1(uuid,text,text,text,text,uuid,text,integer,text)', 'EXECUTE'),
  'clients reach agent usage records only through the record RPC'
);

set request.jwt.claims='{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
select lives_ok(
  $$select public.record_agent_query_event_v1('f3000000-0000-4000-8000-000000000001', 'planner', 'expiry_list', 'answered', 'ko', 'f2000000-0000-4000-8000-000000000001', null, 840, 'show expired reagents')$$,
  'a lab member records a handled request'
);
select lives_ok(
  $$select public.record_agent_query_event_v1('f3000000-0000-4000-8000-000000000002', 'planner', 'unsupported', 'unsupported', 'ko', null, 'out_of_scope', 1200, '  what is for lunch  ')$$,
  'a request the agent could not handle is recorded in the personal space'
);
select lives_ok(
  $$select public.record_agent_query_event_v1('f3000000-0000-4000-8000-000000000001', 'planner', 'low_stock', 'empty', 'ko')$$,
  'writing the same request again is accepted'
);
select lives_ok(
  $$select public.record_agent_query_event_v1('f3000000-0000-4000-8000-000000000005', 'planner', 'log_usage', 'proposed', 'ko', null, 'needs_choice', 900, 'acetone has 30% left')$$,
  'a proposal to record something is recorded'
);
select throws_ok(
  $$select public.record_agent_query_event_v1('f3000000-0000-4000-8000-000000000003', 'planner', 'expiry_list', 'deleted_everything', 'ko')$$,
  '22023', 'AGENT_EVENT_INVALID_INPUT',
  'an outcome outside the contract is refused'
);
select throws_ok(
  $$select count(*) from public.agent_query_events$$,
  '42501', 'permission denied for table agent_query_events',
  'the table cannot be read directly'
);
reset role;

set request.jwt.claims='{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
select throws_ok(
  $$select public.record_agent_query_event_v1('f3000000-0000-4000-8000-000000000004', 'planner', 'expiry_list', 'answered', 'ko', 'f2000000-0000-4000-8000-000000000001')$$,
  '42501', 'AGENT_EVENT_ACCESS_DENIED',
  'a lab the caller does not belong to is refused'
);
reset role;

select is(
  (select count(*) from public.agent_query_events where user_id = 'f1000000-0000-4000-8000-000000000001'),
  3::bigint,
  'each request is stored once'
);
select is(
  (select count(*) from public.agent_query_events
   where request_id in ('f3000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000005')
     and failed_text is not null),
  0::bigint,
  'the sentence of a handled request or a proposal is not kept'
);
select is(
  (select failed_text from public.agent_query_events where request_id = 'f3000000-0000-4000-8000-000000000002'),
  'what is for lunch',
  'the sentence of an unhandled request is kept, trimmed'
);

select * from finish();
rollback;
