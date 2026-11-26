import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, it, expect } from "vitest";

const migration = (name: string) =>
  readFileSync(
    new URL(`../../../supabase/migrations/${name}`, import.meta.url),
    "utf8"
  );
const user1 = "00000000-0000-4000-8000-000000000001",
  user2 = "00000000-0000-4000-8000-000000000002";

async function database() {
  const db = new PGlite();
  // The parts of a Supabase project the tool migrations rely on.
  await db.exec(
    `create role authenticated;create role anon;create role service_role;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage to authenticated;grant execute on function auth.uid() to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;create table public.feedback(source_screen text);insert into auth.users values('${user1}'),('${user2}');`
  );
  await db.exec(
    `alter default privileges in schema public grant all on tables to anon,authenticated;`
  );
  await db.exec(migration("20261109011725_personal_lab_tools.sql"));
  await db.exec(migration("20261109013830_tool_table_service_grants.sql"));
  await db.exec(migration("20261127090000_lab_tools_usage_and_purge.sql"));
  const login = (id: string) =>
    db.exec(
      `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`
    );
  return { db, login };
}

describe("lab tools usage counts and permanent delete", () => {
  it("accepts the new tool ids and still rejects unknown ones", async () => {
    const { db, login } = await database();
    try {
      await login(user1);
      await db.query(
        `select public.save_tool_document('00000000-0000-4000-8000-000000000010','primer','Primer','{}','1',0)`
      );
      await db.query(
        `select public.save_tool_document('00000000-0000-4000-8000-000000000011','nucleic-acid','Yield','{}','1',0)`
      );
      await expect(
        db.query(
          `select public.save_tool_document('00000000-0000-4000-8000-000000000012','not-a-tool','X','{}','1',0)`
        )
      ).rejects.toThrow("tool_documents_tool_id_check");
      // Every tool id accepted before is still accepted.
      await db.query(
        `select public.save_tool_document('00000000-0000-4000-8000-000000000013','periodic-table','Kept','{}','1',0)`
      );
    } finally {
      await db.close();
    }
  });
  it("counts opens and saves per account, tool and day without exposing other accounts", async () => {
    const { db, login } = await database();
    try {
      await login(user1);
      await db.query(`select public.record_tool_usage('dilution','open')`);
      await db.query(`select public.record_tool_usage('dilution','open')`);
      await db.query(`select public.record_tool_usage('dilution','save')`);
      await db.query(`select public.record_tool_usage('timer','open')`);
      const own = await db.query<{
        tool_id: string;
        opens: number;
        saves: number;
      }>(
        `select tool_id,opens,saves from public.tool_usage_daily order by tool_id`
      );
      expect(own.rows).toEqual([
        { tool_id: "dilution", opens: 2, saves: 1 },
        { tool_id: "timer", opens: 1, saves: 0 },
      ]);
      await expect(
        db.query(`select public.record_tool_usage('dilution','delete')`)
      ).rejects.toThrow("Unknown usage event");
      await expect(
        db.query(`select public.record_tool_usage('Robert''); drop table x;--','open')`)
      ).rejects.toThrow("Unknown tool");
      // Counts are written by the function only.
      await expect(
        db.query(
          `update public.tool_usage_daily set opens=999 where tool_id='dilution'`
        )
      ).rejects.toThrow("permission denied");
      await login(user2);
      expect(
        (await db.query(`select * from public.tool_usage_daily`)).rows
      ).toHaveLength(0);
      await db.exec("reset role;set role anon;");
      await expect(
        db.query(`select public.record_tool_usage('dilution','open')`)
      ).rejects.toThrow("permission denied");
    } finally {
      await db.close();
    }
  });
  it("permanently deletes only the caller's trashed work, with its attachment rows", async () => {
    const { db, login } = await database();
    const active = "00000000-0000-4000-8000-000000000020",
      trashed = "00000000-0000-4000-8000-000000000021";
    try {
      await login(user1);
      await db.query(
        `select public.save_tool_document($1,'gel-blot','Active','{}','1',0)`,
        [active]
      );
      await db.query(
        `select public.save_tool_document($1,'gel-blot','Old','{}','1',0)`,
        [trashed]
      );
      await db.query(
        `select public.save_tool_document($1,'gel-blot','Old','{}','1',1,now())`,
        [trashed]
      );
      await db.query(
        `insert into public.tool_attachments(id,owner_id,document_id,path,mime_type) values('00000000-0000-4000-8000-000000000030',$1,$2,$3,'image/png')`,
        [user1, trashed, `${user1}/image`]
      );
      // Work that is not in the trash cannot be purged.
      await expect(
        db.query(`select public.purge_tool_document($1)`, [active])
      ).rejects.toThrow("not in the trash");
      // Nor can another account's trash.
      await login(user2);
      await expect(
        db.query(`select public.purge_tool_document($1)`, [trashed])
      ).rejects.toThrow("not in the trash");
      await login(user1);
      await db.query(`select public.purge_tool_document($1)`, [trashed]);
      expect(
        (
          await db.query<{ title: string }>(
            `select title from public.tool_documents`
          )
        ).rows
      ).toEqual([{ title: "Active" }]);
      expect(
        (await db.query(`select * from public.tool_attachments`)).rows
      ).toHaveLength(0);
      await db.exec("reset role;set role anon;");
      await expect(
        db.query(`select public.purge_tool_document($1)`, [active])
      ).rejects.toThrow("permission denied");
    } finally {
      await db.close();
    }
  });
});
