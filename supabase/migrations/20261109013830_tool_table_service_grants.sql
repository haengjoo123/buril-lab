-- Match the existing explicit server-role table access contract on fresh databases.
-- Browser access and the version-checked document save RPC remain unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
grant all on public.tool_documents, public.tool_attachments to service_role;
notify pgrst, 'reload schema';
commit;
