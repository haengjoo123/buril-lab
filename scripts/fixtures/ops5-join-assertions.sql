-- Run by the disposable native PostgreSQL harness, inside an all-synthetic DB.
-- No pgtap substitutes: failures are PostgreSQL exceptions; all rows roll back.
begin;
set local statement_timeout = '30s';
create function pg_temp.check_true(value boolean, label text) returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception 'OPS5 assertion failed: %', label; end if;
end;
$$;
create function pg_temp.actor(n integer) returns uuid language sql immutable as $$
  select ('50000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.lab(n integer) returns uuid language sql immutable as $$
  select ('60000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.subject(n integer) returns text language sql immutable as $$
  select encode(extensions.digest(n::text, 'sha256'), 'hex')
$$;
insert into auth.users(id, email)
  select pg_temp.actor(n), 'ops5-synthetic-' || n || '@example.invalid' from generate_series(1, 60) n;
insert into public.labs(id, name, join_password)
  select pg_temp.lab(n), 'OPS5 synthetic lab ' || n, 'Synthetic#JoinSafe' from generate_series(1, 12) n;

select pg_temp.check_true((select relrowsecurity from pg_class where oid = 'private.lab_join_attempts_v1'::regclass), 'private counters enable RLS');
do $$
declare r text; privilege text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      perform pg_temp.check_true(not has_table_privilege(r, 'private.lab_join_attempts_v1', privilege), 'counter direct grant denied: ' || r || '/' || privilege);
    end loop;
  end loop;
  perform pg_temp.check_true(not has_function_privilege('anon', 'public.join_lab_server_v1(uuid,uuid,text,text,text,text)', 'EXECUTE'), 'anon cannot call server join');
  perform pg_temp.check_true(not has_function_privilege('authenticated', 'public.join_lab_server_v1(uuid,uuid,text,text,text,text)', 'EXECUTE'), 'member cannot call server join');
  perform pg_temp.check_true(has_function_privilege('service_role', 'public.join_lab_server_v1(uuid,uuid,text,text,text,text)', 'EXECUTE'), 'service role can call server join');
  perform pg_temp.check_true(has_function_privilege('authenticated', 'public.join_lab(uuid,text,text)', 'EXECUTE'), 'old app join is retained');
end;
$$;

set local role authenticated;
do $$
begin
  begin
    perform public.join_lab_server_v1(pg_temp.actor(1), pg_temp.lab(1), 'Synthetic#JoinSafe', pg_temp.subject(1), pg_temp.subject(1001));
    raise exception 'OPS5 unexpected direct join permission';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- The body also rejects a missing/non-service JWT even when an SQL owner calls.
do $$
begin
  begin
    perform public.join_lab_server_v1(pg_temp.actor(1), pg_temp.lab(1), 'Synthetic#JoinSafe', pg_temp.subject(1), pg_temp.subject(1001));
    raise exception 'OPS5 missing service JWT was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare r jsonb; before_ip timestamptz[]; before_until timestamptz;
begin
  for i in 1..4 loop
    r := public.join_lab_server_v1(pg_temp.actor(1), pg_temp.lab(1), 'wrong', pg_temp.subject(1), pg_temp.subject(1001));
    perform pg_temp.check_true(r->>'code' = 'incorrect_password', 'user failures before fifth');
  end loop;
  r := public.join_lab_server_v1(pg_temp.actor(1), pg_temp.lab(1), 'wrong', pg_temp.subject(1), pg_temp.subject(1001));
  perform pg_temp.check_true(r->>'code' = 'join_locked' and (r->>'retry_after_seconds')::integer between 1799 and 1800, 'fifth failure locks thirty minutes');
  select locked_until into before_until from private.lab_join_attempts_v1 where lab_id=pg_temp.lab(1) and subject_type='user' and subject_hash=pg_temp.subject(1);
  r := public.join_lab_server_v1(pg_temp.actor(1), pg_temp.lab(1), 'Synthetic#JoinSafe', pg_temp.subject(1), pg_temp.subject(1002));
  perform pg_temp.check_true(r->>'code' = 'join_locked', 'user cannot bypass lock with a different IP');
  perform pg_temp.check_true((select locked_until=before_until and cardinality(failure_times)=5 from private.lab_join_attempts_v1 where lab_id=pg_temp.lab(1) and subject_type='user' and subject_hash=pg_temp.subject(1)), 'locked attempts do not extend the lock');
  perform pg_temp.check_true(not exists(select 1 from public.lab_members where lab_id=pg_temp.lab(1) and user_id=pg_temp.actor(1)), 'locked correct password cannot join');

  -- A lock in one lab must not affect another lab.
  r := public.join_lab_server_v1(pg_temp.actor(1), pg_temp.lab(2), 'Synthetic#JoinSafe', pg_temp.subject(1), pg_temp.subject(1001));
  perform pg_temp.check_true(r->>'success' = 'true', 'lab-scoped lock');

  -- Correct passwords from a second account do not reset shared IP failures.
  select failure_times into before_ip from private.lab_join_attempts_v1 where lab_id=pg_temp.lab(1) and subject_type='ip' and subject_hash=pg_temp.subject(1001);
  r := public.join_lab_server_v1(pg_temp.actor(2), pg_temp.lab(1), 'Synthetic#JoinSafe', pg_temp.subject(2), pg_temp.subject(1001), '  member  ');
  perform pg_temp.check_true(r->>'success' = 'true', 'second account can join before IP threshold');
  perform pg_temp.check_true((select failure_times=before_ip from private.lab_join_attempts_v1 where lab_id=pg_temp.lab(1) and subject_type='ip' and subject_hash=pg_temp.subject(1001)), 'success retains IP failures');
  perform pg_temp.check_true(not exists(select 1 from private.lab_join_attempts_v1 where lab_id=pg_temp.lab(1) and subject_type='user' and subject_hash=pg_temp.subject(2)), 'success clears only its own user counter');
  perform pg_temp.check_true((select role='student' and nickname='member' from public.lab_members where lab_id=pg_temp.lab(1) and user_id=pg_temp.actor(2)), 'role is server selected and nickname trimmed');
  r := public.join_lab_server_v1(pg_temp.actor(2), pg_temp.lab(1), 'anything', pg_temp.subject(2), pg_temp.subject(1001));
  perform pg_temp.check_true(r->>'code'='already_member', 'duplicate join distinguished');

  -- Expire the original lock and its old failures without waiting thirty minutes.
  update private.lab_join_attempts_v1 set locked_until=clock_timestamp()-interval '1 second',
    failure_times=array[clock_timestamp()-interval '31 minutes']
    where lab_id=pg_temp.lab(1) and subject_type='user' and subject_hash=pg_temp.subject(1);
  r := public.join_lab_server_v1(pg_temp.actor(1), pg_temp.lab(1), 'Synthetic#JoinSafe', pg_temp.subject(1), pg_temp.subject(1002));
  perform pg_temp.check_true(r->>'success'='true', 'join works after lock expires');

  -- Different users at one IP share the twenty-failure rolling threshold.
  for i in 10..28 loop
    r := public.join_lab_server_v1(pg_temp.actor(i), pg_temp.lab(3), 'wrong', pg_temp.subject(i), pg_temp.subject(2000));
    perform pg_temp.check_true(r->>'code'='incorrect_password', 'first nineteen shared IP failures');
  end loop;
  r := public.join_lab_server_v1(pg_temp.actor(29), pg_temp.lab(3), 'wrong', pg_temp.subject(29), pg_temp.subject(2000));
  perform pg_temp.check_true(r->>'code'='join_locked' and (r->>'retry_after_seconds')::integer between 3599 and 3600, 'twentieth IP failure locks one hour');
  r := public.join_lab_server_v1(pg_temp.actor(30), pg_temp.lab(3), 'Synthetic#JoinSafe', pg_temp.subject(30), pg_temp.subject(2000));
  perform pg_temp.check_true(r->>'code'='join_locked', 'another correct account cannot bypass IP lock');

  -- Prune individual timestamps, not a coarse fixed-window counter.
  insert into private.lab_join_attempts_v1(lab_id,subject_type,subject_hash,failure_times)
    values(pg_temp.lab(4),'user',pg_temp.subject(31),array[clock_timestamp()-interval '16 minutes',clock_timestamp()-interval '14 minutes',clock_timestamp()-interval '1 minute']);
  r := public.join_lab_server_v1(pg_temp.actor(31),pg_temp.lab(4),'wrong',pg_temp.subject(31),pg_temp.subject(3000));
  perform pg_temp.check_true(r->>'code'='incorrect_password', 'rolling window does not prematurely lock');
  perform pg_temp.check_true((select cardinality(failure_times)=3 from private.lab_join_attempts_v1 where lab_id=pg_temp.lab(4) and subject_type='user'), 'only expired attempts pruned');

  -- A trigger rejection must roll back both membership and newly created counters.
  insert into public.lab_members(lab_id,user_id,role)
    select pg_temp.lab(n),pg_temp.actor(40),'student' from generate_series(5,7) n;
  begin
    perform public.join_lab_server_v1(pg_temp.actor(40),pg_temp.lab(8),'Synthetic#JoinSafe',pg_temp.subject(40),pg_temp.subject(4000));
    raise exception 'OPS5 membership limit failed';
  exception when raise_exception then
    if sqlerrm not like 'max_lab_memberships_exceeded:%' then raise; end if;
  end;
  perform pg_temp.check_true((select count(*)=3 from public.lab_members where user_id=pg_temp.actor(40)), 'three-lab limit retained');
  perform pg_temp.check_true(not exists(select 1 from private.lab_join_attempts_v1 where lab_id=pg_temp.lab(8)), 'failed membership transaction leaves no counters');

  r := public.join_lab_server_v1(pg_temp.actor(41),pg_temp.lab(999),'wrong',pg_temp.subject(41),pg_temp.subject(4001));
  perform pg_temp.check_true(r->>'code'='lab_not_found', 'missing lab distinguished');
end;
$$;

-- Old app and unchanged password normalization remain functional after Expand.
set local request.jwt.claims = '{"role":"authenticated","sub":"50000000-0000-4000-8000-000000000050"}';
set local role authenticated;
select pg_temp.check_true(public.join_lab(pg_temp.lab(10),'Synthetic#JoinSafe')->>'success'='true', 'old client works after Expand');
reset role;
update public.labs set join_password='Changed#Synthetic' where id=pg_temp.lab(10);
set local request.jwt.claims = '{"role":"authenticated","sub":"50000000-0000-4000-8000-000000000051"}';
set local role authenticated;
select pg_temp.check_true(public.join_lab(pg_temp.lab(10),'Changed#Synthetic')->>'success'='true', 'old client accepts newly changed password');
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select pg_temp.check_true(public.join_lab_server_v1(pg_temp.actor(52),pg_temp.lab(10),'Changed#Synthetic',pg_temp.subject(52),pg_temp.subject(5000))->>'success'='true', 'new client accepts same changed password');
select pg_temp.check_true((select join_password is null and join_password_hash like '$2%' from public.labs where id=pg_temp.lab(10)), 'Expand did not change password encoding');
update public.labs set join_password='' where id=pg_temp.lab(11);
select pg_temp.check_true(public.join_lab_server_v1(pg_temp.actor(53),pg_temp.lab(11),'',pg_temp.subject(53),pg_temp.subject(5001))->>'success'='true', 'legacy open lab works');

-- Expand adds a path-only photo field while keeping image_url untouched.
select pg_temp.check_true(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='cabinets' and column_name='image_path'),
  'cabinet image_path added'
);
insert into public.cabinets(id,name,user_id,lab_id,image_url,image_path)
values(
  '70000000-0000-4000-8000-000000000001', 'OPS5 synthetic cabinet', pg_temp.actor(2), pg_temp.lab(1),
  'https://legacy.example.invalid/public.webp', 'labs/60000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001.webp'
);
do $$begin
  begin
    update public.cabinets set image_path='../escape.webp' where id='70000000-0000-4000-8000-000000000001';
    raise exception 'OPS5 invalid image path accepted';
  exception when check_violation then null;
  end;
end$$;
select pg_temp.check_true(
  (select image_url='https://legacy.example.invalid/public.webp' and image_path like 'labs/%'
     from public.cabinets where id='70000000-0000-4000-8000-000000000001'),
  'public URL and private path coexist during Expand'
);

set local request.jwt.claims = '{"role":"authenticated","sub":"50000000-0000-4000-8000-000000000002"}';
set local role authenticated;
do $$begin
  begin
    update public.cabinets
      set image_path='labs/60000000-0000-4000-8000-000000000099/other-lab.webp'
      where id='70000000-0000-4000-8000-000000000001';
    raise exception 'OPS5 browser changed a server-managed image path';
  exception when insufficient_privilege then null;
  end;
end$$;
reset role;
select pg_temp.check_true(
  (select image_path='labs/60000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001.webp'
     from public.cabinets where id='70000000-0000-4000-8000-000000000001'),
  'browser cannot plant another tenant image path during Expand'
);

set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
update public.cabinets
  set image_path='labs/60000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001-v2.webp'
  where id='70000000-0000-4000-8000-000000000001';
reset role;
select pg_temp.check_true(
  (select image_path like '%-v2.webp' from public.cabinets
     where id='70000000-0000-4000-8000-000000000001'),
  'service operation can populate the private path'
);

do $$begin
  perform pg_temp.check_true(not has_function_privilege('anon', 'public.record_cabinet_activity_v2(uuid,text,text,text,text,uuid)', 'EXECUTE'), 'anon cannot call safe activity path');
  perform pg_temp.check_true(has_function_privilege('authenticated', 'public.record_cabinet_activity_v2(uuid,text,text,text,text,uuid)', 'EXECUTE'), 'members can call safe activity path');
  perform pg_temp.check_true(has_function_privilege('service_role', 'public.record_cabinet_activity_v2(uuid,text,text,text,text,uuid)', 'EXECUTE'), 'server can call safe activity path');
  perform pg_temp.check_true((select p.prosecdef
      and exists(select 1 from unnest(p.proconfig) setting where setting like 'search_path=%')
      and 'lock_timeout=5s'=any(p.proconfig)
    from pg_proc p where p.oid='public.record_cabinet_activity_v2(uuid,text,text,text,text,uuid)'::regprocedure), 'safe activity function fixes security settings');
end$$;

set local request.jwt.claims = '{"role":"authenticated","sub":"50000000-0000-4000-8000-000000000002"}';
set local role authenticated;
select pg_temp.check_true(
  public.record_cabinet_activity_v2(
    '70000000-0000-4000-8000-000000000001','add','  Synthetic reagent  ','  received  ','  sealed  ',
    '71000000-0000-4000-8000-000000000001'
  )->>'success'='true',
  'safe activity call succeeds for a lab member'
);
reset role;
select pg_temp.check_true((select performed_by=pg_temp.actor(2) and item_name='Synthetic reagent' and reason='received' and memo='sealed'
  from public.cabinet_activity_logs where cabinet_id='70000000-0000-4000-8000-000000000001'), 'activity identity and text derived by database');
select pg_temp.check_true((select actor_user_id=pg_temp.actor(2) and actor_name='member' and lab_id=pg_temp.lab(1)
    and action='create' and source='database' and request_id='71000000-0000-4000-8000-000000000001'
    and after_data->>'item_name'='Synthetic reagent'
  from public.audit_logs where entity_type='cabinet_activity' and entity_id='70000000-0000-4000-8000-000000000001'), 'audit identity scope and values derived atomically');

set local request.jwt.claims = '{"role":"authenticated","sub":"50000000-0000-4000-8000-000000000003"}';
set local role authenticated;
do $$begin
  begin
    perform public.record_cabinet_activity_v2('70000000-0000-4000-8000-000000000001','remove','forbidden',null,null,null);
    raise exception 'OPS5 cross-lab activity accepted';
  exception when insufficient_privilege then null;
  end;
end$$;
reset role;
select pg_temp.check_true((select count(*)=1 from public.cabinet_activity_logs where cabinet_id='70000000-0000-4000-8000-000000000001'), 'denied activity leaves no partial row');
select pg_temp.check_true((select count(*)=1 from public.audit_logs where entity_type='cabinet_activity' and entity_id='70000000-0000-4000-8000-000000000001'), 'denied activity leaves no partial audit');
rollback;
select 'OPS5_SQL_ASSERTIONS_PASSED';
