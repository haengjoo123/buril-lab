-- Lab tools: two more tool ids, daily usage counts, and permanent delete of trashed work.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The primer and nucleic-acid tools ship as device-only tools first; this lets
-- their work be saved to the account once the app is switched to do so.
alter table public.tool_documents drop constraint tool_documents_tool_id_check;
alter table public.tool_documents add constraint tool_documents_tool_id_check
 check (tool_id in ('dilution','molarity','master-mix','medium-buffer','plate-labelling','gel-blot','image-measurer','cell-culture','cell-counter','timer','stopwatch','alarm','counter','calculator','unit-converter','custom-equation','calibration-curve','notes','calendar','amino-acids','codons','ladders','periodic-table','primer','nucleic-acid'));

-- How often each tool is opened and saved, per account and day. Counts only:
-- nothing a user typed into a tool is recorded here.
create table public.tool_usage_daily (
 owner_id uuid not null references auth.users(id) on delete cascade,
 tool_id text not null check (tool_id ~ '^[a-z][a-z-]{1,39}$'),
 day date not null,
 opens integer not null default 0 check (opens >= 0),
 saves integer not null default 0 check (saves >= 0),
 primary key (owner_id, tool_id, day)
);
create index tool_usage_daily_day on public.tool_usage_daily(day, tool_id);
alter table public.tool_usage_daily enable row level security;
create policy tool_usage_daily_owner on public.tool_usage_daily for select to authenticated
 using (owner_id = (select auth.uid()));
-- Production projects may grant new tables to API roles by default.
revoke all on public.tool_usage_daily from public, anon, authenticated;
grant select on public.tool_usage_daily to authenticated;
grant select, insert, update, delete on public.tool_usage_daily to service_role;

create or replace function public.record_tool_usage(p_tool_id text, p_event text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
 if p_event is null or p_event not in ('open', 'save') then
   raise exception 'Unknown usage event' using errcode = '22023';
 end if;
 if p_tool_id is null or p_tool_id !~ '^[a-z][a-z-]{1,39}$' then
   raise exception 'Unknown tool' using errcode = '22023';
 end if;
 insert into public.tool_usage_daily (owner_id, tool_id, day, opens, saves)
 values (uid, p_tool_id, (now() at time zone 'utc')::date,
   case when p_event = 'open' then 1 else 0 end,
   case when p_event = 'save' then 1 else 0 end)
 on conflict (owner_id, tool_id, day) do update
   set opens = public.tool_usage_daily.opens + excluded.opens,
       saves = public.tool_usage_daily.saves + excluded.saves;
end $$;
revoke all on function public.record_tool_usage(text, text) from public, anon, service_role;
grant execute on function public.record_tool_usage(text, text) to authenticated;

-- Permanent delete. Only work already in the trash, and only the caller's own.
-- Attachment rows go with the document (foreign key cascade); the caller
-- removes the stored image objects it no longer needs before calling this.
create or replace function public.purge_tool_document(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
 delete from public.tool_documents
  where id = p_id and owner_id = uid and deleted_at is not null;
 if not found then
   raise exception 'Document is not in the trash' using errcode = 'P0002';
 end if;
end $$;
revoke all on function public.purge_tool_document(uuid) from public, anon, service_role;
grant execute on function public.purge_tool_document(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
