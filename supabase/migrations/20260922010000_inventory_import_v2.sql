-- Additive import workspace. No changes to the single-item creation contract.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create table public.inventory_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  lab_id uuid references public.labs(id) on delete cascade,
  name text not null check (length(name) between 1 and 500),
  revision integer not null default 0,
  last_save_request_id uuid,
  metadata jsonb not null default '{"sources":[],"tables":[]}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or lab_id is not null)
);
create table public.inventory_import_rows (
  job_id uuid not null references public.inventory_import_jobs(id) on delete cascade,
  row_id text not null check (length(row_id) between 1 and 300),
  draft jsonb not null,
  inventory_id uuid,
  committed_at timestamptz,
  primary key (job_id, row_id),
  check (jsonb_typeof(draft) = 'object')
);
-- inventory_id deliberately has no cascading FK: deleting a reagent must not
-- erase the receipt and allow a retried import to recreate it.
create table public.inventory_import_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  lab_id uuid references public.labs(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  signature text not null check (length(signature) < 10000),
  profile jsonb not null,
  check (user_id is not null or lab_id is not null)
);
alter table public.inventory add column source_attributes jsonb not null default '[]';
create index inventory_import_jobs_lab_updated on public.inventory_import_jobs(lab_id, updated_at desc);
create index inventory_import_jobs_user_updated on public.inventory_import_jobs(user_id, updated_at desc) where lab_id is null;

create function private.can_use_inventory_import(p_user uuid, p_lab uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and (case when p_lab is null then p_user = auth.uid()
      else exists(select 1 from public.lab_members m where m.lab_id=p_lab and m.user_id=auth.uid()) end)
    and not exists(select 1 from private.deletion_jobs_v1 d
      where d.status <> 'completed' and ((d.kind='account' and d.subject_user_id=auth.uid()) or (d.kind='lab' and d.lab_id=p_lab)));
$$;
revoke all on function private.can_use_inventory_import(uuid, uuid) from public;
grant execute on function private.can_use_inventory_import(uuid, uuid) to authenticated;

alter table public.inventory_import_jobs enable row level security;
alter table public.inventory_import_rows enable row level security;
alter table public.inventory_import_profiles enable row level security;
grant select, insert on public.inventory_import_jobs to authenticated;
grant select on public.inventory_import_rows to authenticated;
grant select, insert, update, delete on public.inventory_import_profiles to authenticated;
revoke all on public.inventory_import_jobs, public.inventory_import_rows, public.inventory_import_profiles from anon;
create policy import_jobs_read on public.inventory_import_jobs for select to authenticated
  using (private.can_use_inventory_import(user_id, lab_id));
create policy import_jobs_create on public.inventory_import_jobs for insert to authenticated
  with check (user_id=auth.uid() and revision=0 and last_save_request_id is null and metadata='{"sources":[],"tables":[]}'::jsonb and private.can_use_inventory_import(user_id, lab_id));
create policy import_rows_read on public.inventory_import_rows for select to authenticated using (
  exists(select 1 from public.inventory_import_jobs j where j.id=job_id and private.can_use_inventory_import(j.user_id,j.lab_id)));
create policy import_profiles_access on public.inventory_import_profiles for all to authenticated
  using (private.can_use_inventory_import(user_id, lab_id))
  with check (private.can_use_inventory_import(user_id, lab_id) and user_id=auth.uid());

insert into storage.buckets(id, name, public, file_size_limit)
  values ('inventory-imports','inventory-imports',false,20971520) on conflict(id) do nothing;
create function private.can_use_import_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.inventory_import_jobs j
    where j.id::text=split_part(p_name,'/',1) and private.can_use_inventory_import(j.user_id,j.lab_id))
    and p_name !~ '(^|/)\.\.?(/|$)' and length(p_name)<1024;
$$;
revoke all on function private.can_use_import_object(text) from public;
grant execute on function private.can_use_import_object(text) to authenticated;
create policy import_objects_read on storage.objects for select to authenticated
  using (bucket_id='inventory-imports' and private.can_use_import_object(name));
create policy import_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id='inventory-imports' and private.can_use_import_object(name));
create policy import_objects_delete on storage.objects for delete to authenticated
  using (bucket_id='inventory-imports' and private.can_use_import_object(name));

create function public.save_inventory_import_v1(p_job_id uuid, p_revision integer, p_metadata jsonb default null, p_rows jsonb default '[]', p_request_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare j public.inventory_import_jobs%rowtype; r jsonb; next_revision integer; old_table jsonb; new_table jsonb; old_grid jsonb; new_grid jsonb;
begin
  select * into j from public.inventory_import_jobs where id=p_job_id for update;
  if not found or not private.can_use_inventory_import(j.user_id,j.lab_id) then raise exception 'Import access denied' using errcode='42501'; end if;
  if p_request_id is not null and j.last_save_request_id=p_request_id then return j.revision; end if;
  if j.revision<>p_revision then raise exception 'Import changed in another tab. Reload before saving.' using errcode='40001'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 then raise exception 'At most 100 rows per save' using errcode='22023'; end if;
  if p_metadata is not null and (jsonb_typeof(p_metadata->'sources') is distinct from 'array' or jsonb_typeof(p_metadata->'tables') is distinct from 'array'
    or jsonb_typeof(p_metadata->'rowIds') is distinct from 'array' or jsonb_array_length(p_metadata->'rowIds')>10000
    or octet_length(p_metadata::text)>41943040) then raise exception 'Invalid import metadata' using errcode='22023'; end if;
  if p_metadata is not null then
    -- A tab may have committed after another tab loaded the same revision.
    -- Protect the exact source/table of every receipt, even in that race.
    for old_table in select t from jsonb_array_elements(j.metadata->'tables') t where exists(
      select 1 from public.inventory_import_rows d where d.job_id=p_job_id and d.committed_at is not null and d.draft->>'tableId'=t->>'id'
    ) loop
      select t into new_table from jsonb_array_elements(p_metadata->'tables') t where t->>'id'=old_table->>'id';
      select g into old_grid from jsonb_array_elements(j.metadata->'sources') s, jsonb_array_elements(s->'grids') g
        where s->>'id'=old_table->>'sourceId' and g->>'id'=old_table->>'gridId';
      select g into new_grid from jsonb_array_elements(p_metadata->'sources') s, jsonb_array_elements(s->'grids') g
        where s->>'id'=old_table->>'sourceId' and g->>'id'=old_table->>'gridId';
      if new_table is distinct from old_table or new_grid is distinct from old_grid then
        raise exception 'Import already registered in another tab. Reload before saving.' using errcode='40001';
      end if;
    end loop;
    if coalesce((select sum((s->>'size')::bigint) from jsonb_array_elements(p_metadata->'sources') s),0)>104857600
      or exists(select 1 from jsonb_array_elements(p_metadata->'sources') s where jsonb_typeof(s->'size') is distinct from 'number' or (s->>'size')::bigint not between 1 and 20971520 or jsonb_typeof(s->'grids') is distinct from 'array')
      or (select count(*) from jsonb_array_elements(p_metadata->'sources') s, jsonb_array_elements(s->'grids') g where g ? 'page')>50 then
      raise exception 'Import source limits exceeded' using errcode='22023';
    end if;
    delete from public.inventory_import_rows where job_id=p_job_id and committed_at is null and not ((p_metadata->'rowIds') ? row_id);
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) is distinct from 'object' or nullif(r->>'id','') is null or octet_length(r::text)>262144 then raise exception 'Invalid draft row' using errcode='22023'; end if;
    if exists(select 1 from public.inventory_import_rows d where d.job_id=p_job_id and d.row_id=r->>'id' and d.committed_at is not null
      and (d.draft-'error') is distinct from (r-'importedId'-'error')) then
      raise exception 'Import already registered in another tab. Reload before saving.' using errcode='40001';
    end if;
    insert into public.inventory_import_rows(job_id,row_id,draft) values(p_job_id,r->>'id',r-'importedId')
      on conflict(job_id,row_id) do update set draft=excluded.draft where inventory_import_rows.committed_at is null;
  end loop;
  if (select count(*) from public.inventory_import_rows where job_id=p_job_id)>10000 then raise exception 'Import exceeds 10000 rows' using errcode='22023'; end if;
  update public.inventory_import_jobs set revision=revision+1,last_save_request_id=p_request_id,metadata=coalesce(p_metadata,metadata),updated_at=now()
    where id=p_job_id returning revision into next_revision;
  return next_revision;
end;
$$;

-- Keep the import capacity contract aligned with capacityParser.ts. Raw spelling
-- remains in source_attributes; comma decimals and grouping are both supported.
create function private.valid_import_capacity(p_value text) returns boolean
language plpgsql immutable set search_path='' as $$
declare parts text[]; part text; normalized text; integer_part text; decimal_part text;
  separator text; decimal_at integer; total numeric := 1;
begin
  parts := regexp_match(p_value,'^([0-9][0-9.,]*[[:space:]]*[x×][[:space:]]*)?([0-9][0-9.,]*)[[:space:]]*(ul|μl|µl|ml|l|ug|μg|µg|mg|g|kg)$','i');
  if parts is null then return false; end if;
  foreach part in array array[coalesce(regexp_replace(parts[1],'[[:space:]x×]','','g'),'1'),parts[2]] loop
    normalized := part;
    if position(',' in part)>0 and position('.' in part)>0 then
      separator := case when strpos(reverse(part),',') < strpos(reverse(part),'.') then ',' else '.' end;
      decimal_at := length(part)-strpos(reverse(part),separator)+1;
      integer_part := left(part,decimal_at-1); decimal_part := substr(part,decimal_at+1);
      if integer_part !~ '^[0-9]{1,3}([.,][0-9]{3})*$' or decimal_part !~ '^[0-9]+$' then return false; end if;
      normalized := replace(integer_part,case when separator=',' then '.' else ',' end,'') || '.' || decimal_part;
    elsif position(',' in part)>0 then
      if part ~ '^[0-9]{1,3}(,[0-9]{3})+$' then normalized := replace(part,',','');
      elsif part ~ '^[0-9]+,[0-9]+$' then normalized := replace(part,',','.');
      else return false; end if;
    end if;
    if normalized !~ '^[0-9]+(\.[0-9]*)?$' or normalized::numeric<=0 then return false; end if;
    total := total * normalized::numeric;
  end loop;
  if lower(parts[3]) in ('kg') then total := total*1000000;
  elsif lower(parts[3]) in ('l','g') then total := total*1000; end if;
  return total>0 and total<1.7976931348623157e308;
exception when others then return false;
end;
$$;
revoke all on function private.valid_import_capacity(text) from public,anon,authenticated;

create function public.commit_inventory_import_batch_v1(p_job_id uuid, p_revision integer, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.inventory_import_jobs%rowtype; r jsonb; d public.inventory_import_rows%rowtype;
  v jsonb; item jsonb; receipt jsonb := '[]'; f text; q numeric; attrs jsonb;
begin
  select * into j from public.inventory_import_jobs where id=p_job_id for update;
  if not found or not private.can_use_inventory_import(j.user_id,j.lab_id) then raise exception 'Import access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Invalid commit size' using errcode='22023'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    begin
      select * into d from public.inventory_import_rows where job_id=p_job_id and row_id=r->>'rowId' for update;
      if not found then raise exception 'Save the draft first' using errcode='22023'; end if;
      if d.committed_at is not null then
        receipt := receipt || jsonb_build_array(jsonb_build_object('rowId',d.row_id,'inventoryId',d.inventory_id,'idempotent',true));
        continue;
      end if;
      if j.revision<>p_revision then raise exception 'Import revision changed. Reload before committing.' using errcode='40001'; end if;
      if coalesce((d.draft->>'excluded')::boolean,false) or d.draft->>'duplicateDecision'='skip'
        or (coalesce((d.draft->>'reviewRequired')::boolean,false) and not coalesce((d.draft->>'reviewed')::boolean,false)) then
        raise exception 'Draft requires review' using errcode='22023';
      end if;
      v := r->'input';
      if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'quantity') is distinct from 'number' then raise exception 'Quantity must be an integer' using errcode='22023'; end if;
      q := (v->>'quantity')::numeric;
      if q<>trunc(q) or q not between 1 and 1000000 then raise exception 'Quantity must be 1..1000000' using errcode='22023'; end if;
      if nullif(v->>'capacity','') is not null and not private.valid_import_capacity(v->>'capacity') then raise exception 'Invalid capacity measurement' using errcode='22023'; end if;
      foreach f in array array['expiry_date','received_date','opened_date'] loop
        if nullif(v->>f,'') is not null and ((v->>f) !~ '^\d{4}-\d{2}-\d{2}$' or to_char((v->>f)::date,'YYYY-MM-DD')<>v->>f) then raise exception 'Invalid calendar date' using errcode='22023'; end if;
      end loop;
      if nullif(v->>'expiry_date','') is not null and coalesce(v->>'manufacturer_date_type','unlabeled')='unlabeled' then raise exception 'Date type requires review' using errcode='22023'; end if;
      item := public.create_inventory_item_with_dates_atomic(
        p_name=>v->>'name',p_storage_type=>v->>'storage_type',p_brand=>nullif(v->>'brand',''),
        p_product_number=>nullif(v->>'product_number',''),p_cas_number=>nullif(v->>'cas_number',''),p_quantity=>q::integer,
        p_capacity=>nullif(v->>'capacity',''),p_cabinet_id=>nullif(v->>'cabinet_id','')::uuid,
        p_storage_location_id=>nullif(v->>'storage_location_id','')::uuid,p_expiry_date=>nullif(v->>'expiry_date','')::date,
        p_manufacturer_date_type=>coalesce(v->>'manufacturer_date_type','unlabeled'),p_received_date=>nullif(v->>'received_date','')::date,
        p_opened_date=>nullif(v->>'opened_date','')::date,p_memo=>nullif(v->>'memo',''),p_remaining_percent=>nullif(v->>'remaining_percent','')::integer,
        p_lab_id=>j.lab_id,p_actor_user_id=>auth.uid());
      attrs := coalesce(d.draft->'attributes','[]');
      if jsonb_typeof(attrs)<>'array' then raise exception 'Invalid source attributes' using errcode='22023'; end if;
      update public.inventory set source_attributes=attrs where id=(item->>'id')::uuid;
      update public.inventory_import_rows set inventory_id=(item->>'id')::uuid,committed_at=now(),draft=draft-'error' where job_id=p_job_id and row_id=d.row_id;
      receipt := receipt || jsonb_build_array(jsonb_build_object('rowId',d.row_id,'inventoryId',item->>'id','idempotent',false));
    exception when others then
      update public.inventory_import_rows set draft=jsonb_set(draft,'{error}',to_jsonb(sqlerrm)) where job_id=p_job_id and row_id=r->>'rowId' and committed_at is null;
      receipt := receipt || jsonb_build_array(jsonb_build_object('rowId',r->>'rowId','error',sqlerrm));
    end;
  end loop;
  update public.inventory_import_jobs set updated_at=now() where id=p_job_id;
  return receipt;
end;
$$;
revoke all on function public.save_inventory_import_v1(uuid,integer,jsonb,jsonb,uuid), public.commit_inventory_import_batch_v1(uuid,integer,jsonb) from public,anon;
grant execute on function public.save_inventory_import_v1(uuid,integer,jsonb,jsonb,uuid), public.commit_inventory_import_batch_v1(uuid,integer,jsonb) to authenticated;

-- Queue source objects while job ownership still exists, before the existing
-- deletion processor removes rows and the Auth user. Storage API removes bytes.
alter table private.deletion_file_targets_v1 drop constraint deletion_file_targets_v1_bucket_id_check;
alter table private.deletion_file_targets_v1 add constraint deletion_file_targets_v1_bucket_id_check check(bucket_id in ('cabinets','safety-center-verifications','inventory-imports'));
alter table private.deletion_file_targets_v1 drop constraint deletion_file_targets_v1_source_kind_check;
alter table private.deletion_file_targets_v1 add constraint deletion_file_targets_v1_source_kind_check check(source_kind in ('cabinet_image','safety_center_document','inventory_import'));
alter function public.prepare_deletion_job_database_v1(uuid,uuid) rename to prepare_deletion_job_database_before_import_v1;
revoke all on function public.prepare_deletion_job_database_before_import_v1(uuid,uuid) from public,anon,authenticated,service_role;
create function public.prepare_deletion_job_database_v1(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.deletion_jobs_v1%rowtype;
begin
  j := private.require_active_deletion_lease_v1(p_job_id,p_lease_token);
  if j.stage in ('queued','database') then
    insert into private.deletion_file_targets_v1(job_id,bucket_id,object_path,source_kind)
      select p_job_id,'inventory-imports',o.name,'inventory_import' from storage.objects o
      join public.inventory_import_jobs i on split_part(o.name,'/',1)=i.id::text
      where o.bucket_id='inventory-imports' and ((j.kind='account' and i.lab_id is null and i.user_id=j.subject_user_id) or (j.kind='lab' and i.lab_id=j.lab_id))
      on conflict do nothing;
    if j.kind='account' then
      delete from public.inventory_import_jobs where lab_id is null and user_id=j.subject_user_id;
      delete from public.inventory_import_profiles where lab_id is null and user_id=j.subject_user_id;
    end if;
  end if;
  return public.prepare_deletion_job_database_before_import_v1(p_job_id,p_lease_token);
end;
$$;
revoke all on function public.prepare_deletion_job_database_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_deletion_job_database_v1(uuid,uuid) to service_role;
commit;
