-- Supplier SDS files (안전보건자료) kept with the inventory. A document belongs
-- to one space (a lab, or a user's personal space) and to a product, matched
-- by CAS number and/or product number, so one upload covers every bottle of
-- that product. Files live in the private `inventory-sds` bucket under the
-- space's folder; deleting a lab or an account queues them for the existing
-- deletion worker. Additive.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-sds', 'inventory-sds', false, 20971520, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create table public.inventory_sds_documents (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid references public.labs(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete cascade,
  cas_number text,
  brand text,
  product_number text,
  file_name text not null,
  object_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  revision_date date,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_sds_documents_scope_check check ((lab_id is null) = (owner_user_id is not null)),
  constraint inventory_sds_documents_key_check check (cas_number is not null or product_number is not null),
  constraint inventory_sds_documents_cas_check check (cas_number is null or cas_number ~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$'),
  constraint inventory_sds_documents_brand_check check (brand is null or char_length(brand) between 1 and 120),
  constraint inventory_sds_documents_product_check check (product_number is null or char_length(product_number) between 1 and 120),
  constraint inventory_sds_documents_file_name_check check (char_length(file_name) between 1 and 200),
  constraint inventory_sds_documents_path_check check (char_length(object_path) between 3 and 300),
  constraint inventory_sds_documents_mime_check check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  constraint inventory_sds_documents_size_check check (size_bytes between 1 and 20971520)
);

comment on table public.inventory_sds_documents is
  'Supplier SDS files for inventory products. Written only through the *_inventory_sds_document_v1 RPCs; files are in the private inventory-sds bucket.';

create index inventory_sds_documents_lab_cas_idx on public.inventory_sds_documents (lab_id, cas_number) where lab_id is not null;
create index inventory_sds_documents_owner_cas_idx on public.inventory_sds_documents (owner_user_id, cas_number) where owner_user_id is not null;

alter table public.inventory_sds_documents enable row level security;
create policy inventory_sds_documents_select_scoped_v1 on public.inventory_sds_documents for select to authenticated
using (
  (select auth.uid()) is not null and (
    (lab_id is null and owner_user_id = (select auth.uid()))
    or (lab_id is not null and exists (
      select 1 from public.lab_members lm
      where lm.lab_id = inventory_sds_documents.lab_id and lm.user_id = (select auth.uid())
    ))
  )
);
revoke all on public.inventory_sds_documents from public, anon, authenticated, service_role;
grant select on public.inventory_sds_documents to authenticated;
grant all on public.inventory_sds_documents to service_role;

-- A space's folder: the lab id, or `u-<user id>` for a personal space.
create function private.sds_folder_v1(p_lab_id uuid) returns text
language sql stable set search_path = '' as $$
  select case when p_lab_id is null then 'u-' || auth.uid()::text else p_lab_id::text end;
$$;
revoke all on function private.sds_folder_v1(uuid) from public, anon, authenticated;

-- Object names are `<folder>/<file>`; the caller must belong to the folder's space.
create function private.can_use_sds_object_v1(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_name ~ '^[0-9a-z-]+/[0-9a-z-]+\.(pdf|png|jpg)$'
    and length(p_name) < 300
    and (
      split_part(p_name, '/', 1) = 'u-' || auth.uid()::text
      or exists (
        select 1 from public.lab_members lm
        where lm.lab_id::text = split_part(p_name, '/', 1) and lm.user_id = auth.uid()
      )
    );
$$;
revoke all on function private.can_use_sds_object_v1(text) from public;
grant execute on function private.can_use_sds_object_v1(text) to authenticated;

create policy inventory_sds_objects_read_v1 on storage.objects for select to authenticated
  using (bucket_id = 'inventory-sds' and private.can_use_sds_object_v1(name));
create policy inventory_sds_objects_insert_v1 on storage.objects for insert to authenticated
  with check (bucket_id = 'inventory-sds' and private.can_use_sds_object_v1(name));
create policy inventory_sds_objects_delete_v1 on storage.objects for delete to authenticated
  using (bucket_id = 'inventory-sds' and private.can_use_sds_object_v1(name));

create function private.inventory_sds_json_v1(p_row public.inventory_sds_documents) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_row.id, 'lab_id', p_row.lab_id, 'cas_number', p_row.cas_number, 'brand', p_row.brand,
    'product_number', p_row.product_number, 'file_name', p_row.file_name, 'object_path', p_row.object_path,
    'mime_type', p_row.mime_type, 'size_bytes', p_row.size_bytes, 'revision_date', p_row.revision_date,
    'uploaded_by', p_row.uploaded_by, 'created_at', p_row.created_at
  );
$$;
revoke all on function private.inventory_sds_json_v1(public.inventory_sds_documents) from public, anon, authenticated;

-- Registers a file the caller already uploaded into its space's folder. The
-- stored object, not the client, decides the type and size.
create function public.create_inventory_sds_document_v1(
  p_lab_id uuid,
  p_object_path text,
  p_file_name text,
  p_cas_number text default null,
  p_brand text default null,
  p_product_number text default null,
  p_revision_date date default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_folder text;
  v_mime text;
  v_size bigint;
  v_cas text := nullif(pg_catalog.btrim(p_cas_number), '');
  v_brand text := nullif(pg_catalog.regexp_replace(pg_catalog.btrim(p_brand), '\s+', ' ', 'g'), '');
  v_product text := nullif(pg_catalog.regexp_replace(pg_catalog.btrim(p_product_number), '\s+', ' ', 'g'), '');
  v_file text := nullif(pg_catalog.btrim(p_file_name), '');
  v_row public.inventory_sds_documents;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_lab_id is not null and not exists (
    select 1 from public.lab_members lm where lm.lab_id = p_lab_id and lm.user_id = auth.uid()
  ) then
    raise exception 'INVENTORY_SDS_ACCESS_DENIED' using errcode = '42501';
  end if;
  v_folder := private.sds_folder_v1(p_lab_id);
  if p_object_path is null or split_part(p_object_path, '/', 1) <> v_folder
     or not private.can_use_sds_object_v1(p_object_path) then
    raise exception 'INVENTORY_SDS_ACCESS_DENIED' using errcode = '42501';
  end if;
  if v_file is null or char_length(v_file) > 200
     or (v_cas is null and v_product is null)
     or (v_cas is not null and v_cas !~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$')
     or char_length(coalesce(v_brand, '')) > 120 or char_length(coalesce(v_product, '')) > 120 then
    raise exception 'INVENTORY_SDS_INVALID_INPUT' using errcode = '22023';
  end if;
  select o.metadata->>'mimetype', (o.metadata->>'size')::bigint into v_mime, v_size
  from storage.objects o where o.bucket_id = 'inventory-sds' and o.name = p_object_path;
  if not found then
    raise exception 'INVENTORY_SDS_FILE_MISSING' using errcode = 'P0002';
  end if;
  if v_mime is null or v_mime not in ('application/pdf', 'image/png', 'image/jpeg')
     or v_size is null or v_size < 1 or v_size > 20971520 then
    raise exception 'INVENTORY_SDS_INVALID_INPUT' using errcode = '22023';
  end if;
  begin
    insert into public.inventory_sds_documents
      (lab_id, owner_user_id, cas_number, brand, product_number, file_name, object_path, mime_type, size_bytes, revision_date, uploaded_by)
    values
      (p_lab_id, case when p_lab_id is null then auth.uid() end, v_cas, v_brand, v_product, v_file, p_object_path, v_mime, v_size, p_revision_date, auth.uid())
    returning * into v_row;
  exception when unique_violation then
    raise exception 'INVENTORY_SDS_PATH_IN_USE' using errcode = '23505';
  end;
  return private.inventory_sds_json_v1(v_row);
end $$;
revoke all on function public.create_inventory_sds_document_v1(uuid, text, text, text, text, text, date) from public, anon;
grant execute on function public.create_inventory_sds_document_v1(uuid, text, text, text, text, text, date) to authenticated, service_role;

-- The uploader, a lab admin, or the personal owner removes the record and gets
-- the object path back so the client can remove the file.
create function public.delete_inventory_sds_document_v1(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.inventory_sds_documents;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_row from public.inventory_sds_documents d
  where d.id = p_id
    and (
      (d.lab_id is null and d.owner_user_id = auth.uid())
      or (d.lab_id is not null and exists (
        select 1 from public.lab_members lm where lm.lab_id = d.lab_id and lm.user_id = auth.uid()
      ))
    )
  for update;
  if not found then
    raise exception 'INVENTORY_SDS_ACCESS_DENIED' using errcode = '42501';
  end if;
  if v_row.lab_id is not null and v_row.uploaded_by is distinct from auth.uid() and not public.is_lab_admin(v_row.lab_id) then
    raise exception 'INVENTORY_SDS_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  delete from public.inventory_sds_documents where id = v_row.id;
  return v_row.object_path;
end $$;
revoke all on function public.delete_inventory_sds_document_v1(uuid) from public, anon;
grant execute on function public.delete_inventory_sds_document_v1(uuid) to authenticated, service_role;

-- Queue SDS files with the existing deletion workflow. The tool-image step
-- from 20261109011747 is kept here unchanged.
alter table private.deletion_file_targets_v1 drop constraint deletion_file_targets_v1_bucket_id_check;
alter table private.deletion_file_targets_v1 add constraint deletion_file_targets_v1_bucket_id_check
  check (bucket_id in ('cabinets', 'safety-center-verifications', 'inventory-imports', 'tool-images', 'inventory-sds'));
alter table private.deletion_file_targets_v1 drop constraint deletion_file_targets_v1_source_kind_check;
alter table private.deletion_file_targets_v1 add constraint deletion_file_targets_v1_source_kind_check
  check (source_kind in ('cabinet_image', 'safety_center_document', 'inventory_import', 'tool_image', 'inventory_sds'));

create or replace function public.prepare_deletion_job_database_v1(p_job_id uuid, p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j private.deletion_jobs_v1%rowtype;
begin
  j := private.require_active_deletion_lease_v1(p_job_id, p_lease_token);
  if j.kind = 'account' and j.stage in ('queued', 'database') then
    insert into private.deletion_file_targets_v1(job_id, bucket_id, object_path, source_kind)
    select p_job_id, 'tool-images', o.name, 'tool_image' from storage.objects o
    where o.bucket_id = 'tool-images' and split_part(o.name, '/', 1) = j.subject_user_id::text
    on conflict do nothing;
    delete from public.tool_documents where owner_id = j.subject_user_id;

    insert into private.deletion_file_targets_v1(job_id, bucket_id, object_path, source_kind)
    select p_job_id, 'inventory-sds', o.name, 'inventory_sds' from storage.objects o
    where o.bucket_id = 'inventory-sds' and split_part(o.name, '/', 1) = 'u-' || j.subject_user_id::text
    on conflict do nothing;
    delete from public.inventory_sds_documents where owner_user_id = j.subject_user_id;
  elsif j.kind = 'lab' and j.stage in ('queued', 'database') then
    insert into private.deletion_file_targets_v1(job_id, bucket_id, object_path, source_kind)
    select p_job_id, 'inventory-sds', o.name, 'inventory_sds' from storage.objects o
    where o.bucket_id = 'inventory-sds' and split_part(o.name, '/', 1) = j.lab_id::text
    on conflict do nothing;
  end if;
  return public.prepare_deletion_job_database_before_tools_v1(p_job_id, p_lease_token);
end $$;
revoke all on function public.prepare_deletion_job_database_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_deletion_job_database_v1(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
