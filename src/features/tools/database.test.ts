import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, it, expect } from "vitest";
describe("personal tool database boundary", () => {
  it("enforces owner access, revision checks and private attachment ownership", async () => {
    const db = new PGlite();
    try {
      await db.exec(
        `create role authenticated;create role anon;create role service_role;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage to authenticated;grant execute on function auth.uid() to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;create table public.feedback(source_screen text);insert into auth.users values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');`
      );
      await db.exec(
        `alter default privileges in schema public grant all on tables to anon,authenticated;`
      );
      await db.exec(
        readFileSync(
          new URL(
            "../../../supabase/migrations/20261109011725_personal_lab_tools.sql",
            import.meta.url
          ),
          "utf8"
        )
      );
      const id = "00000000-0000-4000-8000-000000000010",
        user1 = "00000000-0000-4000-8000-000000000001",
        user2 = "00000000-0000-4000-8000-000000000002";
      const login = async (id: string) =>
        db.exec(
          `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`
        );
      await login(user1);
      await db.query(
        `select public.save_tool_document($1,'notes','First','{}','1',0)`,
        [id]
      );
      const first = await db.query<{ revision: number }>(
        `select revision from public.tool_documents`
      );
      expect(first.rows[0].revision).toBe(1);
      await db.query(
        `select public.save_tool_document($1,'notes','Second','{}','1',1)`,
        [id]
      );
      await expect(
        db.query(
          `select public.save_tool_document($1,'notes','Stale','{}','1',1)`,
          [id]
        )
      ).rejects.toThrow("conflict");
      await expect(
        db.query(
          `update public.tool_documents set title='Bypass' where id=$1`,
          [id]
        )
      ).rejects.toThrow("permission denied");
      await db.exec("reset role;set role anon;");
      await expect(db.query("select * from public.tool_documents")).rejects.toThrow("permission denied");
      await login(user2);
      expect(
        (await db.query("select * from public.tool_documents")).rows
      ).toHaveLength(0);
      await expect(
        db.query(
          `select public.save_tool_document($1,'notes','Steal','{}','1',2)`,
          [id]
        )
      ).rejects.toThrow("conflict");
      await expect(
        db.query(
          `insert into public.tool_attachments values('00000000-0000-4000-8000-000000000020',$1,$2,$3,'image/png',now())`,
          [user2, id, `${user2}/asset`]
        )
      ).rejects.toThrow("row-level security");
      await login(user1);
      await db.query(
        `insert into public.tool_attachments values('00000000-0000-4000-8000-000000000020',$1,$2,$3,'image/png',now())`,
        [user1, id, `${user1}/asset`]
      );
      await login(user2);
      expect(
        (await db.query("select * from public.tool_attachments")).rows
      ).toHaveLength(0);
      await expect(
        db.query(
          `insert into storage.objects values('00000000-0000-4000-8000-000000000030','tool-images',$1)`,
          [`${user1}/asset`]
        )
      ).rejects.toThrow("row-level security");
      await db.exec(`reset role;create schema private;
      create table private.deletion_jobs_v1(id uuid,kind text,stage text,subject_user_id uuid);
      create table private.deletion_file_targets_v1(job_id uuid,bucket_id text,object_path text,source_kind text,
        constraint deletion_file_targets_v1_bucket_id_check check(bucket_id in ('cabinets','safety-center-verifications','inventory-imports')),
        constraint deletion_file_targets_v1_source_kind_check check(source_kind in ('cabinet_image','safety_center_document','inventory_import')),unique(job_id,bucket_id,object_path));
      create function private.require_active_deletion_lease_v1(uuid,uuid) returns private.deletion_jobs_v1 language sql as $$select * from private.deletion_jobs_v1 where id=$1$$;
      create function public.prepare_deletion_job_database_v1(uuid,uuid) returns jsonb language sql as $$select '{"stage":"storage"}'::jsonb$$;
      insert into private.deletion_jobs_v1 values('00000000-0000-4000-8000-000000000099','account','queued','${user1}');
      insert into storage.objects values('00000000-0000-4000-8000-000000000040','tool-images','${user1}/owned-image'),('00000000-0000-4000-8000-000000000041','tool-images','${user2}/other-image');`);
      await db.exec(
        readFileSync(
          new URL(
            "../../../supabase/migrations/20261109011747_tool_images_account_deletion.sql",
            import.meta.url
          ),
          "utf8"
        )
      );
      await db.query(
        `select public.prepare_deletion_job_database_v1('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000098')`
      );
      expect(
        (
          await db.query<{ object_path: string }>(
            "select object_path from private.deletion_file_targets_v1"
          )
        ).rows.map((r) => r.object_path)
      ).toEqual([`${user1}/owned-image`]);
      expect(
        (await db.query("select * from public.tool_documents")).rows
      ).toHaveLength(0);
    } finally {
      await db.close();
    }
  }, 30000);
});
