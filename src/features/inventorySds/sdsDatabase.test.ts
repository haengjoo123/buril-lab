import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * Runs the real SDS migration in an embedded Postgres with minimal stand-ins
 * for Supabase Storage, labs and the deletion worker tables it extends.
 */
const STUBS = `
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private; create schema storage;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
grant usage on schema auth, storage, private to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, metadata jsonb);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
create table public.labs(id uuid primary key, name text not null);
create table public.lab_members(lab_id uuid not null references public.labs(id), user_id uuid not null references auth.users(id), role text not null);
grant select on public.lab_members to authenticated;
create function public.is_lab_admin(target_lab_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.lab_members lm where lm.lab_id = target_lab_id and lm.user_id = auth.uid() and lm.role = 'admin')$$;
create table public.tool_documents(owner_id uuid);
create table private.deletion_jobs_v1(id uuid primary key, kind text not null, stage text not null, subject_user_id uuid, lab_id uuid);
create table private.deletion_file_targets_v1(
  job_id uuid not null, bucket_id text not null, object_path text not null, source_kind text not null,
  constraint deletion_file_targets_v1_bucket_id_check check (bucket_id in ('cabinets','safety-center-verifications','inventory-imports','tool-images')),
  constraint deletion_file_targets_v1_source_kind_check check (source_kind in ('cabinet_image','safety_center_document','inventory_import','tool_image')),
  primary key (job_id, bucket_id, object_path));
create function private.require_active_deletion_lease_v1(p_job uuid, p_lease uuid) returns private.deletion_jobs_v1
  language sql as $$select * from private.deletion_jobs_v1 where id = p_job$$;
create function public.prepare_deletion_job_database_before_tools_v1(p_job uuid, p_lease uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
`;

const ADMIN = 'a1000000-0000-4000-8000-000000000001';
const MEMBER = 'a1000000-0000-4000-8000-000000000002';
const OUTSIDER = 'a1000000-0000-4000-8000-000000000003';
const LAB = 'a2000000-0000-4000-8000-000000000001';
const OTHER_LAB = 'a2000000-0000-4000-8000-000000000002';
const FILE_A = 'b3000000-0000-4000-8000-000000000001';
const FILE_B = 'b3000000-0000-4000-8000-000000000002';
const FILE_P = 'b3000000-0000-4000-8000-000000000003';

const SEED = `
insert into auth.users values ('${ADMIN}'),('${MEMBER}'),('${OUTSIDER}');
insert into public.labs values ('${LAB}','Lab'),('${OTHER_LAB}','Other');
insert into public.lab_members values ('${LAB}','${ADMIN}','admin'),('${LAB}','${MEMBER}','student'),('${OTHER_LAB}','${OUTSIDER}','researcher');
`;

describe('inventory SDS database boundary', () => {
    it('stores files per space, registers only uploaded objects and queues files for deletion', async () => {
        const db = new PGlite();
        try {
            await db.exec(STUBS);
            await db.exec(readFileSync(new URL('../../../supabase/migrations/20261114090000_inventory_sds_documents.sql', import.meta.url), 'utf8'));
            await db.exec(SEED);

            const asUser = (id: string) =>
                db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`);
            const asOwner = () => db.exec('reset role;');
            const upload = (path: string, mime = 'application/pdf', size = 1024) =>
                db.query(`insert into storage.objects(bucket_id, name, metadata) values ('inventory-sds', $1, jsonb_build_object('mimetype', $2::text, 'size', $3::bigint))`, [path, mime, size]);
            const register = async (labId: string | null, path: string, fields: { cas?: string | null; product?: string | null; file?: string } = {}) =>
                (await db.query<{ r: { id: string; mime_type: string; size_bytes: number; cas_number: string | null } }>(
                    'select public.create_inventory_sds_document_v1($1, $2, $3, $4, null, $5) as r',
                    [labId, path, fields.file ?? 'acetone-sds.pdf', fields.cas === undefined ? '67-64-1' : fields.cas, fields.product ?? null],
                )).rows[0].r;

            const bucket = (await db.query<{ public: boolean; file_size_limit: number }>(`select public, file_size_limit from storage.buckets where id = 'inventory-sds'`)).rows[0];
            expect(bucket).toEqual({ public: false, file_size_limit: 20971520 });

            // A lab member uploads into the lab folder; a member of another lab cannot.
            await asUser(MEMBER);
            await upload(`${LAB}/${FILE_A}.pdf`, 'application/pdf', 4096);
            await expect(upload(`${OTHER_LAB}/${FILE_B}.pdf`)).rejects.toThrow('row-level security');
            await expect(upload(`${LAB}/../escape.pdf`)).rejects.toThrow('row-level security');
            const doc = await register(LAB, `${LAB}/${FILE_A}.pdf`, { cas: ' 67-64-1 ' });
            expect(doc).toMatchObject({ mime_type: 'application/pdf', size_bytes: 4096, cas_number: '67-64-1' });

            // Registration checks the space, the object and the product key.
            await expect(register(LAB, `${LAB}/${FILE_B}.pdf`)).rejects.toThrow('INVENTORY_SDS_FILE_MISSING');
            await expect(register(OTHER_LAB, `${OTHER_LAB}/${FILE_B}.pdf`)).rejects.toThrow('INVENTORY_SDS_ACCESS_DENIED');
            await expect(register(null, `${LAB}/${FILE_A}.pdf`)).rejects.toThrow('INVENTORY_SDS_ACCESS_DENIED');
            await expect(register(LAB, `${LAB}/${FILE_A}.pdf`)).rejects.toThrow('INVENTORY_SDS_PATH_IN_USE');
            await upload(`${LAB}/${FILE_B}.pdf`);
            await expect(register(LAB, `${LAB}/${FILE_B}.pdf`, { cas: null })).rejects.toThrow('INVENTORY_SDS_INVALID_INPUT');
            await expect(register(LAB, `${LAB}/${FILE_B}.pdf`, { cas: '67641' })).rejects.toThrow('INVENTORY_SDS_INVALID_INPUT');
            const byProduct = await register(LAB, `${LAB}/${FILE_B}.pdf`, { cas: null, product: '  179124 ' });
            expect(byProduct.cas_number).toBeNull();
            await expect(db.query(`update public.inventory_sds_documents set file_name = 'x'`)).rejects.toThrow('permission denied');

            // Personal space: its own folder only.
            await upload(`u-${MEMBER}/${FILE_P}.pdf`, 'image/png', 10);
            const personal = await register(null, `u-${MEMBER}/${FILE_P}.pdf`);
            expect(personal.mime_type).toBe('image/png');

            // Another lab sees neither records nor files.
            await asUser(OUTSIDER);
            expect((await db.query('select * from public.inventory_sds_documents')).rows).toEqual([]);
            expect((await db.query(`select * from storage.objects where bucket_id = 'inventory-sds'`)).rows).toEqual([]);
            await expect(db.query('select public.delete_inventory_sds_document_v1($1)', [doc.id])).rejects.toThrow('INVENTORY_SDS_ACCESS_DENIED');

            // Only the uploader or a lab admin removes a lab document.
            await asOwner();
            await db.query(`update public.inventory_sds_documents set uploaded_by = $1 where id = $2`, [ADMIN, byProduct.id]);
            await asUser(MEMBER);
            await expect(db.query('select public.delete_inventory_sds_document_v1($1)', [byProduct.id])).rejects.toThrow('INVENTORY_SDS_ADMIN_REQUIRED');
            const removedPath = (await db.query<{ r: string }>('select public.delete_inventory_sds_document_v1($1) as r', [doc.id])).rows[0].r;
            expect(removedPath).toBe(`${LAB}/${FILE_A}.pdf`);
            await asUser(ADMIN);
            await db.query('select public.delete_inventory_sds_document_v1($1)', [byProduct.id]);
            expect(Number((await db.query<{ n: number }>('select count(*)::int as n from public.inventory_sds_documents where lab_id is not null')).rows[0].n)).toBe(0);

            // Deleting the lab or the account queues their files for the deletion worker.
            await asOwner();
            await db.query(`insert into storage.objects(bucket_id, name) values ('tool-images', $1)`, [`${MEMBER}/tool.png`]);
            await db.query(`insert into private.deletion_jobs_v1 values ('c4000000-0000-4000-8000-000000000001','lab','database',null,$1), ('c4000000-0000-4000-8000-000000000002','account','database',$2,null)`, [LAB, MEMBER]);
            await db.query(`select public.prepare_deletion_job_database_v1('c4000000-0000-4000-8000-000000000001', gen_random_uuid())`);
            await db.query(`select public.prepare_deletion_job_database_v1('c4000000-0000-4000-8000-000000000002', gen_random_uuid())`);
            const targets = (await db.query<{ job: string; bucket_id: string; object_path: string; source_kind: string }>(
                `select right(job_id::text, 1) as job, bucket_id, object_path, source_kind from private.deletion_file_targets_v1 order by 1, 2, 3`,
            )).rows;
            expect(targets).toEqual([
                { job: '1', bucket_id: 'inventory-sds', object_path: `${LAB}/${FILE_A}.pdf`, source_kind: 'inventory_sds' },
                { job: '1', bucket_id: 'inventory-sds', object_path: `${LAB}/${FILE_B}.pdf`, source_kind: 'inventory_sds' },
                { job: '2', bucket_id: 'inventory-sds', object_path: `u-${MEMBER}/${FILE_P}.pdf`, source_kind: 'inventory_sds' },
                { job: '2', bucket_id: 'tool-images', object_path: `${MEMBER}/tool.png`, source_kind: 'tool_image' },
            ]);
            expect(Number((await db.query<{ n: number }>('select count(*)::int as n from public.inventory_sds_documents')).rows[0].n)).toBe(0);
            const definition = (await db.query<{ d: string }>(`select pg_get_functiondef('public.prepare_deletion_job_database_v1(uuid,uuid)'::regprocedure) as d`)).rows[0].d;
            expect(definition).toContain('tool-images');
            expect(definition).toContain('inventory-sds');
        } finally {
            await db.close();
        }
    }, 120_000);
});
