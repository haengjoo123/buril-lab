-- Ops6 photo Switch, contract half. Apply only after the external copy
-- manifest proves every referenced image_path body exists with matching bytes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $block$
begin
    if not exists (select 1 from storage.buckets where id = 'cabinets') then
        raise exception 'Cabinet Storage bucket is missing';
    end if;
    if exists (
      select 1 from public.cabinets c
      where nullif(c.image_url, '') is not null and c.image_path is null
    ) then
        raise exception 'Referenced public cabinet photos have not all been migrated';
    end if;
    if exists (
      select 1 from public.cabinets c
      left join private.cabinet_image_objects_v1 o
        on o.path = c.image_path and o.cabinet_id = c.id and o.detached_at is null
      where c.image_path is not null and o.path is null
    ) then
        raise exception 'Private cabinet photo metadata is incomplete';
    end if;
end;
$block$;

update storage.buckets
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/webp']::text[]
  where id = 'cabinets';

drop policy if exists "Auth Users Delete" on storage.objects;
drop policy if exists "Auth Users Insert" on storage.objects;
drop policy if exists "Auth Users Update" on storage.objects;

-- The old URL is not a fallback after the bucket becomes private. Original
-- object paths and hashes remain in the private retention table and R2 backup.
update public.cabinets set image_url = null where image_url is not null;
alter table public.cabinets add constraint cabinets_image_url_private_v1_check
  check (image_url is null);
comment on column public.cabinets.image_url is
  'Legacy public URL. Must remain null after the Ops6 private photo Switch.';

commit;
