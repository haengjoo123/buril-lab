-- Preserve private image cleanup in the existing account-deletion lease workflow.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Enqueue private tool images before the account deletion workflow removes ownership.
alter table private.deletion_file_targets_v1 drop constraint deletion_file_targets_v1_bucket_id_check;
alter table private.deletion_file_targets_v1 add constraint deletion_file_targets_v1_bucket_id_check check(bucket_id in ('cabinets','safety-center-verifications','inventory-imports','tool-images'));
alter table private.deletion_file_targets_v1 drop constraint deletion_file_targets_v1_source_kind_check;
alter table private.deletion_file_targets_v1 add constraint deletion_file_targets_v1_source_kind_check check(source_kind in ('cabinet_image','safety_center_document','inventory_import','tool_image'));
alter function public.prepare_deletion_job_database_v1(uuid,uuid) rename to prepare_deletion_job_database_before_tools_v1;
revoke all on function public.prepare_deletion_job_database_before_tools_v1(uuid,uuid) from public,anon,authenticated,service_role;
create function public.prepare_deletion_job_database_v1(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.deletion_jobs_v1%rowtype;
begin
 j := private.require_active_deletion_lease_v1(p_job_id,p_lease_token);
 if j.kind='account' and j.stage in ('queued','database') then
   insert into private.deletion_file_targets_v1(job_id,bucket_id,object_path,source_kind)
   select p_job_id,'tool-images',o.name,'tool_image' from storage.objects o
   where o.bucket_id='tool-images' and split_part(o.name,'/',1)=j.subject_user_id::text
   on conflict do nothing;
   delete from public.tool_documents where owner_id=j.subject_user_id;
 end if;
 return public.prepare_deletion_job_database_before_tools_v1(p_job_id,p_lease_token);
end $$;
revoke all on function public.prepare_deletion_job_database_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_deletion_job_database_v1(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
