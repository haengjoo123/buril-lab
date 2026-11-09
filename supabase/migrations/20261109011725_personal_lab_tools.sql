-- Personal experiment tools: owner-only data and version-checked saves.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create table public.tool_documents (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 tool_id text not null check (tool_id in ('dilution','molarity','master-mix','medium-buffer','plate-labelling','gel-blot','image-measurer','cell-culture','cell-counter','timer','stopwatch','alarm','counter','calculator','unit-converter','custom-equation','calibration-curve','notes','calendar','amino-acids','codons','ladders','periodic-table')),
 title text not null check(length(title) between 1 and 200), data jsonb not null default '{}'::jsonb,
 schema_version integer not null default 1 check(schema_version=1), engine_version text not null,
 revision integer not null default 1 check(revision>0), updated_at timestamptz not null default now(), deleted_at timestamptz,
 check(jsonb_typeof(data)='object' and octet_length(data::text)<=2000000)
);
create index tool_documents_owner_updated on public.tool_documents(owner_id,updated_at desc);
alter table public.tool_documents enable row level security;
create policy tool_documents_owner on public.tool_documents for all to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
-- Production projects may grant new tables to API roles by default.
-- Remove inherited table writes so every save must compare revisions in the RPC.
revoke all on public.tool_documents from public,anon,authenticated;
grant select on public.tool_documents to authenticated;
-- Only this RPC can write revisions; callers cannot bypass optimistic concurrency.
create or replace function public.save_tool_document(p_id uuid,p_tool_id text,p_title text,p_data jsonb,p_engine_version text,p_expected_revision integer,p_deleted_at timestamptz default null)
returns public.tool_documents language plpgsql security definer set search_path='' as $$
declare saved public.tool_documents; uid uuid := auth.uid();
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_expected_revision=0 then
   insert into public.tool_documents(id,owner_id,tool_id,title,data,engine_version,deleted_at)
   values(p_id,uid,p_tool_id,p_title,p_data,p_engine_version,p_deleted_at) on conflict(id) do nothing returning * into saved;
 else
   update public.tool_documents set title=p_title,data=p_data,engine_version=p_engine_version,
    revision=revision+1,updated_at=clock_timestamp(),deleted_at=p_deleted_at
    where id=p_id and owner_id=uid and tool_id=p_tool_id and revision=p_expected_revision returning * into saved;
 end if;
 if saved.id is null then raise exception 'Document conflict' using errcode='40001'; end if;
 return saved;
end $$;
revoke all on function public.save_tool_document(uuid,text,text,jsonb,text,integer,timestamptz) from public,anon,service_role;
grant execute on function public.save_tool_document(uuid,text,text,jsonb,text,integer,timestamptz) to authenticated;
create table public.tool_attachments (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 document_id uuid not null references public.tool_documents(id) on delete cascade,
 path text not null unique, mime_type text not null check(mime_type in ('image/png','image/jpeg')),
 created_at timestamptz not null default now()
);
create index tool_attachments_document on public.tool_attachments(document_id);
create index tool_attachments_owner on public.tool_attachments(owner_id);
alter table public.tool_attachments enable row level security;
create policy tool_attachments_owner on public.tool_attachments for all to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and exists(select 1 from public.tool_documents d where d.id=document_id and d.owner_id=(select auth.uid())) and path like owner_id::text||'/%');
revoke all on public.tool_attachments from public,anon,authenticated;
grant select,insert,update,delete on public.tool_attachments to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('tool-images','tool-images',false,20971520,array['image/png','image/jpeg']);
create policy tool_images_owner on storage.objects for all to authenticated
 using(bucket_id='tool-images' and (storage.foldername(name))[1]=(select auth.uid())::text)
 with check(bucket_id='tool-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
alter table public.feedback drop constraint if exists feedback_source_screen_check;
alter table public.feedback add constraint feedback_source_screen_check check(source_screen is null or source_screen in ('search','logs','cabinet','inventory','admin','tools'));
notify pgrst, 'reload schema';
commit;
