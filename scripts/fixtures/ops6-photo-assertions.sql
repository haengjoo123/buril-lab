-- Native PostgreSQL semantics for the additive Ops6 photo migration. All data
-- is synthetic and this transaction rolls back. Hosted Storage behavior is a
-- separate Staging acceptance gate.
begin;
set local statement_timeout = '30s';

create function pg_temp.check_true(value boolean, label text) returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception 'OPS6 assertion failed: %', label; end if;
end;
$$;
create function pg_temp.actor(n integer) returns uuid language sql immutable as $$
  select ('50000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.lab(n integer) returns uuid language sql immutable as $$
  select ('60000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.cabinet(n integer) returns uuid language sql immutable as $$
  select ('70000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.photo_path(lab_number integer, cabinet_number integer, photo_number integer)
returns text language sql immutable as $$
  select 'labs/' || pg_temp.lab(lab_number)::text || '/cabinets/' ||
    pg_temp.cabinet(cabinet_number)::text || '/80000000-0000-4000-8000-' ||
    lpad(photo_number::text, 12, '0') || '.webp'
$$;

insert into auth.users(id, email)
  select pg_temp.actor(n), 'ops6-synthetic-' || n || '@example.invalid' from generate_series(1, 4) n;
insert into public.labs(id, name, created_by)
values
  (pg_temp.lab(1), 'OPS6 synthetic lab one', pg_temp.actor(1)),
  (pg_temp.lab(2), 'OPS6 synthetic lab two', pg_temp.actor(2));
insert into public.lab_members(lab_id, user_id, role, nickname)
values
  (pg_temp.lab(1), pg_temp.actor(1), 'admin', 'OPS6 member one'),
  (pg_temp.lab(2), pg_temp.actor(2), 'admin', 'OPS6 member two');

select pg_temp.check_true(
  (select public and file_size_limit is null and allowed_mime_types is null
     from storage.buckets where id='cabinets'),
  'Expand leaves the legacy cabinet bucket public and unchanged'
);
select pg_temp.check_true(
  (select count(*)=3 from pg_policy where polrelid='storage.objects'::regclass
     and polname in ('Auth Users Insert','Auth Users Update','Auth Users Delete')),
  'Expand retains all three compatibility Storage policies'
);
select pg_temp.check_true(
  private.cabinet_photo_prefix_v1(pg_temp.lab(1), null, pg_temp.cabinet(1)) =
    'labs/' || pg_temp.lab(1)::text || '/cabinets/' || pg_temp.cabinet(1)::text,
  'lab paths do not depend on a historical creator id'
);
select pg_temp.check_true(
  private.cabinet_photo_prefix_v1(null, pg_temp.actor(1), pg_temp.cabinet(2)) =
    'users/' || pg_temp.actor(1)::text || '/cabinets/' || pg_temp.cabinet(2)::text,
  'personal paths retain the owning user scope'
);

do $$
declare role_name text; privilege_name text; signature text;
begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      perform pg_temp.check_true(
        not has_table_privilege(role_name, 'private.cabinet_image_objects_v1', privilege_name),
        'object metadata direct grant denied: ' || role_name || '/' || privilege_name
      );
      perform pg_temp.check_true(
        not has_table_privilege(role_name, 'private.cabinet_image_retention_v1', privilege_name),
        'retention direct grant denied: ' || role_name || '/' || privilege_name
      );
    end loop;
  end loop;
  foreach signature in array array[
    'public.get_cabinet_image_paths_v1(uuid,uuid[])',
    'public.get_cabinet_image_state_v1(uuid,uuid)',
    'public.set_cabinet_image_path_v1(uuid,uuid,text,text,text,bigint)',
    'public.migrate_cabinet_image_path_v1(uuid,text,text,text,bigint)'
  ] loop
    perform pg_temp.check_true(not has_function_privilege('anon', signature, 'EXECUTE'), 'anon denied: ' || signature);
    perform pg_temp.check_true(not has_function_privilege('authenticated', signature, 'EXECUTE'), 'authenticated denied: ' || signature);
    perform pg_temp.check_true(has_function_privilege('service_role', signature, 'EXECUTE'), 'service granted: ' || signature);
  end loop;
end;
$$;

insert into public.cabinets(id, name, user_id, lab_id, image_url)
values
  (pg_temp.cabinet(1), 'OPS6 legacy lab cabinet', pg_temp.actor(1), pg_temp.lab(1),
    'https://project.invalid/storage/v1/object/public/cabinets/legacy/lab-one.webp'),
  (pg_temp.cabinet(2), 'OPS6 personal cabinet', pg_temp.actor(1), null, null),
  (pg_temp.cabinet(3), 'OPS6 legacy lab cabinet without creator', null, pg_temp.lab(1),
    'https://project.invalid/storage/v1/object/public/cabinets/legacy/lab-no-creator.webp');

do $$ begin
  begin
    perform public.get_cabinet_image_state_v1(pg_temp.actor(1), pg_temp.cabinet(1));
    raise exception 'OPS6 missing service JWT was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
set local request.jwt.claims = '{"role":"service_role"}';

do $$ begin
  begin
    perform public.set_cabinet_image_path_v1(
      pg_temp.actor(1), pg_temp.cabinet(3), pg_temp.photo_path(1,3,30), null, repeat('3',64), 333
    );
    raise exception 'OPS6 generic setter bypassed the legacy migration path';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

select pg_temp.check_true(
  (public.get_cabinet_image_state_v1(pg_temp.actor(1), pg_temp.cabinet(1))->>'referenced_count'='0'
   and public.get_cabinet_image_state_v1(pg_temp.actor(1), pg_temp.cabinet(1))->>'legacy_image_pending'='true'),
  'member can read its lab photo state and legacy migration block through the service function'
);
do $$ begin
  begin
    delete from public.cabinets where id=pg_temp.cabinet(3);
    raise exception 'OPS6 cabinet with a legacy public photo was deleted before migration';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;
do $$ begin
  begin
    perform public.get_cabinet_image_state_v1(pg_temp.actor(2), pg_temp.cabinet(1));
    raise exception 'OPS6 cross-lab state lookup was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.check_true(
  public.migrate_cabinet_image_path_v1(
    pg_temp.cabinet(1), 'legacy/lab-one.webp', pg_temp.photo_path(1,1,1), repeat('a',64), 1000
  )->>'migrated'='true',
  'legacy public reference binds to a verified private path'
);
select pg_temp.check_true(
  (select image_url like '%/legacy/lab-one.webp' and image_path=pg_temp.photo_path(1,1,1)
     from public.cabinets where id=pg_temp.cabinet(1)),
  'migration keeps the public URL during compatibility while adding private path'
);
select pg_temp.check_true(
  (select count(*)=2 and count(*) filter(where detached_at is null)=1
     from private.cabinet_image_objects_v1 where cabinet_id=pg_temp.cabinet(1)),
  'migration records both retained source and attached private metadata'
);
select pg_temp.check_true(
  (select reason='migration_source' and retain_until >= retired_at + interval '7 days'
     from private.cabinet_image_retention_v1 where path='legacy/lab-one.webp'),
  'migration source is retained for at least seven days'
);
select pg_temp.check_true(
  public.migrate_cabinet_image_path_v1(
    pg_temp.cabinet(1), 'legacy/lab-one.webp', pg_temp.photo_path(1,1,1), repeat('a',64), 1000
  )->>'migrated'='false',
  'migration is idempotent only for the exact same verified metadata'
);
do $$ begin
  begin
    perform public.migrate_cabinet_image_path_v1(
      pg_temp.cabinet(1), 'legacy/lab-one.webp', pg_temp.photo_path(1,1,1), repeat('b',64), 1000
    );
    raise exception 'OPS6 conflicting migration metadata was accepted';
  exception when unique_violation then null;
  end;
end $$;

select pg_temp.check_true(
  public.migrate_cabinet_image_path_v1(
    pg_temp.cabinet(3), 'legacy/lab-no-creator.webp', pg_temp.photo_path(1,3,3), repeat('c',64), 1001
  )->>'migrated'='true',
  'a historical lab cabinet without creator metadata can be migrated safely'
);
select pg_temp.check_true(
  (select lab_id=pg_temp.lab(1) and owner_user_id is null
     from private.cabinet_image_objects_v1 where path=pg_temp.photo_path(1,3,3)),
  'lab ownership evidence survives without inventing a creator'
);

do $$
declare first_path text; second_path text; result jsonb;
begin
  first_path := 'users/' || pg_temp.actor(1)::text || '/cabinets/' || pg_temp.cabinet(2)::text ||
    '/81000000-0000-4000-8000-000000000001.webp';
  second_path := 'users/' || pg_temp.actor(1)::text || '/cabinets/' || pg_temp.cabinet(2)::text ||
    '/81000000-0000-4000-8000-000000000002.webp';
  result := public.set_cabinet_image_path_v1(pg_temp.actor(1),pg_temp.cabinet(2),first_path,null,repeat('d',64),999);
  perform pg_temp.check_true(result->>'referenced_count'='1', 'personal first attachment increments count');
  result := public.set_cabinet_image_path_v1(pg_temp.actor(1),pg_temp.cabinet(2),second_path,first_path,repeat('e',64),998);
  perform pg_temp.check_true(result->>'referenced_count'='1', 'replacement does not consume another slot');
  perform pg_temp.check_true((select reason='replaced' and retain_until >= retired_at + interval '7 days'
    from private.cabinet_image_retention_v1 where path=first_path), 'replacement retains the former object');
  result := public.set_cabinet_image_path_v1(pg_temp.actor(1),pg_temp.cabinet(2),null,second_path,null,null);
  perform pg_temp.check_true(result->>'referenced_count'='0', 'removal decrements count');
  perform pg_temp.check_true((select reason='removed' from private.cabinet_image_retention_v1 where path=second_path),
    'removal retains the detached object');
end;
$$;

do $$ begin
  begin
    perform public.set_cabinet_image_path_v1(
      pg_temp.actor(1), pg_temp.cabinet(2), pg_temp.photo_path(2,2,9), null, repeat('f',64), 100
    );
    raise exception 'OPS6 cross-scope path was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Exercise the exact warning and hard cap sequentially; the native runner also
-- races 51 independent requests to prove the advisory scope lock.
insert into public.cabinets(id,name,user_id,lab_id)
select pg_temp.cabinet(100+n), 'OPS6 capped cabinet '||n, pg_temp.actor(2), pg_temp.lab(2)
from generate_series(1,51) n;
do $$
declare result jsonb;
begin
  for i in 1..50 loop
    result := public.set_cabinet_image_path_v1(
      pg_temp.actor(2), pg_temp.cabinet(100+i), pg_temp.photo_path(2,100+i,100+i),
      null, repeat('1',64), 100+i
    );
    if i=39 then perform pg_temp.check_true(result->>'warning'='false', 'warning is off at 39'); end if;
    if i=40 then perform pg_temp.check_true(result->>'warning'='true', 'warning starts at 40'); end if;
  end loop;
  begin
    perform public.set_cabinet_image_path_v1(
      pg_temp.actor(2), pg_temp.cabinet(151), pg_temp.photo_path(2,151,151),
      null, repeat('2',64), 151
    );
    raise exception 'OPS6 51st referenced photo was accepted';
  exception when raise_exception then
    if sqlerrm <> 'cabinet_image_limit_reached' then raise; end if;
  end;
  perform pg_temp.check_true((select count(*)=50 from public.cabinets where lab_id=pg_temp.lab(2) and image_path is not null),
    'failed 51st attachment leaves exactly fifty references');
end;
$$;

-- Browser table grants remain for compatibility, but the server-managed path
-- trigger must refuse direct planting even for an accessible cabinet.
set local request.jwt.claims = '{"role":"authenticated","sub":"50000000-0000-4000-8000-000000000001"}';
set local role authenticated;
do $$ begin
  begin
    update public.cabinets set image_path='users/50000000-0000-4000-8000-000000000001/cabinets/70000000-0000-4000-8000-000000000002/81000000-0000-4000-8000-000000000003.webp'
      where id=pg_temp.cabinet(2);
    raise exception 'OPS6 browser planted a private path';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

-- A cabinet with an attached private photo cannot be deleted until the pointer
-- is detached and a retention row is written.
do $$ begin
  begin
    delete from public.cabinets where id=pg_temp.cabinet(1);
    raise exception 'OPS6 cabinet with live private photo was deleted';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;
select public.set_cabinet_image_path_v1(
  pg_temp.actor(1), pg_temp.cabinet(1), null, pg_temp.photo_path(1,1,1), null, null
);
delete from public.cabinets where id=pg_temp.cabinet(1);
select pg_temp.check_true(
  not exists(select 1 from public.cabinets where id=pg_temp.cabinet(1)) and
  exists(select 1 from private.cabinet_image_objects_v1 where cabinet_id=pg_temp.cabinet(1)),
  'detached ownership and retention evidence survives cabinet deletion'
);

select pg_temp.check_true(
  (select count(*) >= 54 from public.audit_logs where entity_type='cabinet_photo'
    and source='database' and actor_user_id is not null and request_id is not null),
  'photo mutations generate database-derived audit rows atomically'
);

rollback;
select 'OPS6_EXPAND_SQL_ASSERTIONS_PASSED';
