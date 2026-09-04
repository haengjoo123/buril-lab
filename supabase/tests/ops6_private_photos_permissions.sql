begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select is(
  (select count(*) from pg_catalog.pg_class
    where oid in (
      'private.cabinet_image_objects_v1'::regclass,
      'private.cabinet_image_retention_v1'::regclass
    ) and relrowsecurity),
  2::bigint,
  'both private photo evidence tables enable RLS'
);

select is(
  (select count(*) from unnest(array['anon','authenticated','service_role']) role_name
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege_name
    cross join unnest(array[
      'private.cabinet_image_objects_v1',
      'private.cabinet_image_retention_v1'
    ]) table_name
    where has_table_privilege(role_name, table_name, privilege_name)),
  0::bigint,
  'browser and service API roles have no direct photo evidence table access'
);

select is(
  (select count(*) from unnest(array[
      'public.get_cabinet_image_paths_v1(uuid,uuid[])',
      'public.get_cabinet_image_state_v1(uuid,uuid)',
      'public.set_cabinet_image_path_v1(uuid,uuid,text,text,text,bigint)',
      'public.migrate_cabinet_image_path_v1(uuid,text,text,text,bigint)'
    ]) signature
    cross join unnest(array['anon','authenticated']) role_name
    where has_function_privilege(role_name, signature, 'EXECUTE')),
  0::bigint,
  'browser roles cannot execute private photo RPCs'
);

select is(
  (select count(*) from unnest(array[
      'public.get_cabinet_image_paths_v1(uuid,uuid[])',
      'public.get_cabinet_image_state_v1(uuid,uuid)',
      'public.set_cabinet_image_path_v1(uuid,uuid,text,text,text,bigint)',
      'public.migrate_cabinet_image_path_v1(uuid,text,text,text,bigint)'
    ]) signature
    where has_function_privilege('service_role', signature, 'EXECUTE')),
  4::bigint,
  'service role can execute all four bounded photo RPCs'
);

select is(
  (select count(*) from pg_catalog.pg_proc p where p.oid in (
      'public.get_cabinet_image_paths_v1(uuid,uuid[])'::regprocedure,
      'public.get_cabinet_image_state_v1(uuid,uuid)'::regprocedure,
      'public.set_cabinet_image_path_v1(uuid,uuid,text,text,text,bigint)'::regprocedure,
      'public.migrate_cabinet_image_path_v1(uuid,text,text,text,bigint)'::regprocedure
    ) and p.prosecdef),
  4::bigint,
  'all public photo RPCs are explicit SECURITY DEFINER functions'
);

select is(
  (select count(*) from pg_catalog.pg_proc p where p.oid in (
      'public.get_cabinet_image_paths_v1(uuid,uuid[])'::regprocedure,
      'public.get_cabinet_image_state_v1(uuid,uuid)'::regprocedure,
      'public.set_cabinet_image_path_v1(uuid,uuid,text,text,text,bigint)'::regprocedure,
      'public.migrate_cabinet_image_path_v1(uuid,text,text,text,bigint)'::regprocedure
    ) and exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) s where s like 'search_path=%')
      and exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) s where s='lock_timeout=5s')),
  4::bigint,
  'all public photo RPCs fix search_path and bound lock waits'
);

select ok(
  not has_function_privilege('anon', 'private.cabinet_photo_prefix_v1(uuid,uuid,uuid)', 'EXECUTE'),
  'the ownership-prefix helper is not executable through inherited PUBLIC privileges'
);

select ok(
  not has_function_privilege('anon', 'private.require_cabinet_photo_service_v1()', 'EXECUTE'),
  'the service-role guard is not executable through inherited PUBLIC privileges'
);

select is(
  (select count(*) from pg_catalog.pg_trigger
    where tgrelid='public.cabinets'::regclass
      and tgname='cabinets_guard_private_photo_delete_v1'
      and not tgisinternal and tgenabled='O'),
  1::bigint,
  'cabinet deletion is guarded until the photo pointer is detached'
);

select ok(
  (select not public and file_size_limit=2097152
      and allowed_mime_types=array['image/webp']::text[]
    from storage.buckets where id='cabinets'),
  'the final cabinet bucket is private, WebP-only, and limited to two MiB'
);

select is(
  (select count(*) from pg_catalog.pg_policy
    where polrelid='storage.objects'::regclass
      and polname in ('Auth Users Insert','Auth Users Update','Auth Users Delete')),
  0::bigint,
  'broad browser write policies are removed at Switch'
);

select is(
  (select count(*) from pg_catalog.pg_constraint
    where conrelid='public.cabinets'::regclass
      and conname='cabinets_image_url_private_v1_check'
      and convalidated),
  1::bigint,
  'the legacy public URL is constrained to null after Switch'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid='public.cabinets'::regclass),
  'cabinet rows retain RLS after Switch'
);

select is(
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='cabinets'
      and column_name='image_path' and data_type='text' and is_nullable='YES'),
  1::bigint,
  'the server-managed private path remains nullable'
);

select is(
  (select count(*) from pg_catalog.pg_indexes
    where schemaname='private' and indexname in (
      'cabinet_image_objects_v1_scope_idx',
      'cabinet_image_retention_v1_due_idx'
    )),
  2::bigint,
  'scope-limit and retention cleanup indexes exist'
);

select is(
  (select count(*) from pg_catalog.pg_constraint
    where conrelid in (
      'private.cabinet_image_objects_v1'::regclass,
      'private.cabinet_image_retention_v1'::regclass
    ) and contype='f' and confrelid='public.cabinets'::regclass),
  0::bigint,
  'photo evidence deliberately survives later cabinet deletion'
);

select * from finish();

rollback;
