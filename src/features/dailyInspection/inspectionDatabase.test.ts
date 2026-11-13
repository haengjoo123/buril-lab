import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { CHECKLIST_VERSION, INSPECTION_ITEM_IDS } from './checklist';

/**
 * Runs the real daily inspection migration in an embedded Postgres with
 * minimal stand-ins for the tables and helpers it depends on. The hosted
 * pgTAP suite (supabase/tests/lab_daily_inspection_behavior.sql) covers the
 * same rules against the full schema.
 */
const STUBS = `
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create table public.labs(id uuid primary key, name text not null);
create table public.lab_members(lab_id uuid not null references public.labs(id), user_id uuid not null references auth.users(id) on delete cascade, role text not null);
grant select on public.lab_members to authenticated;
create function private.actor_display_name_v2(p_user uuid, p_lab uuid) returns text language sql stable as $$select 'name-' || left(p_user::text, 8)$$;
create table public.safety_centers(id uuid primary key, status text not null);
create table public.safety_center_members(center_id uuid not null, user_id uuid not null, role text not null);
create table public.safety_center_lab_links(id uuid primary key, center_id uuid not null, lab_id uuid not null, status text not null, scope text[] not null);
create function public.is_safety_center_member(target_center_id uuid, allowed_roles text[] default null) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.safety_center_members m where m.center_id = target_center_id and m.user_id = auth.uid())$$;
`;

const MEMBER = 'e1000000-0000-4000-8000-000000000001';
const SECOND_MEMBER = 'e1000000-0000-4000-8000-000000000002';
const OUTSIDER = 'e1000000-0000-4000-8000-000000000003';
const CENTER_USER = 'e1000000-0000-4000-8000-000000000004';
const LAB_A = 'e2000000-0000-4000-8000-000000000001';
const LAB_B = 'e2000000-0000-4000-8000-000000000002';
const LAB_C = 'e2000000-0000-4000-8000-000000000003';
const CENTER = 'e3000000-0000-4000-8000-000000000001';
const OTHER_CENTER = 'e3000000-0000-4000-8000-000000000002';

const SEED = `
insert into auth.users values ('${MEMBER}'),('${SECOND_MEMBER}'),('${OUTSIDER}'),('${CENTER_USER}');
insert into public.labs values ('${LAB_A}','Lab A'),('${LAB_B}','Lab B'),('${LAB_C}','Lab C');
insert into public.lab_members values ('${LAB_A}','${MEMBER}','student'),('${LAB_A}','${SECOND_MEMBER}','admin'),('${LAB_B}','${OUTSIDER}','researcher');
insert into public.safety_centers values ('${CENTER}','approved'),('${OTHER_CENTER}','approved');
insert into public.safety_center_members values ('${CENTER}','${CENTER_USER}','owner');
insert into public.safety_center_lab_links values
  ('e4000000-0000-4000-8000-000000000001','${CENTER}','${LAB_A}','approved',array['summary']),
  ('e4000000-0000-4000-8000-000000000002','${CENTER}','${LAB_B}','approved',array['summary','risk_detail']),
  ('e4000000-0000-4000-8000-000000000003','${CENTER}','${LAB_C}','approved',array['waste_management']),
  ('e4000000-0000-4000-8000-000000000004','${OTHER_CENTER}','${LAB_A}','approved',array['summary']);
`;

interface SavedInspection {
    id: string;
    inspection_date: string;
    issue_count: number;
    note: string | null;
    inspected_by: string | null;
    inspector_name: string | null;
    results: Record<string, string>;
}

const allOk = Object.fromEntries(INSPECTION_ITEM_IDS.map((id) => [id, 'ok']));

describe('daily inspection database boundary', () => {
    it('keeps one record per lab per day, validates results and limits what a center reads', async () => {
        const db = new PGlite();
        try {
            await db.exec(STUBS);
            await db.exec(readFileSync(new URL('../../../supabase/migrations/20261113100000_lab_daily_inspections.sql', import.meta.url), 'utf8'));
            await db.exec(SEED);

            const asUser = (id: string) =>
                db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`);
            const asOwner = () => db.exec('reset role;');
            const save = async (labId: string, results: unknown, note: string | null = null, version = CHECKLIST_VERSION) =>
                (await db.query<{ r: SavedInspection }>(
                    'select public.save_lab_daily_inspection_v1($1, $2, $3::jsonb, $4) as r', [labId, version, JSON.stringify(results), note],
                )).rows[0].r;
            const summary = async (centerId: string, days?: number) =>
                (await db.query<{ lab_name: string; period_days: number; inspected_days: number | string; issue_days: number | string; last_inspection_date: string | Date | null }>(
                    days === undefined
                        ? 'select * from public.get_safety_center_inspection_summary_v1($1)'
                        : 'select * from public.get_safety_center_inspection_summary_v1($1, $2)',
                    days === undefined ? [centerId] : [centerId, days],
                )).rows.map((row) => [row.lab_name, row.period_days, Number(row.inspected_days), Number(row.issue_days)]);

            // A member records today's inspection; the server counts the issues itself.
            await asUser(MEMBER);
            const first = await save(LAB_A, { ...allOk, chemical_waste: 'bad', gas_storage: 'na' }, '  폐액통 덮개 열림  ');
            expect(first).toMatchObject({ issue_count: 1, note: '폐액통 덮개 열림', inspected_by: MEMBER, inspector_name: `name-${MEMBER.slice(0, 8)}` });
            expect(first.results.chemical_waste).toBe('bad');
            const today = (await db.query<{ d: string }>(`select ((now() at time zone 'Asia/Seoul')::date)::text as d`)).rows[0].d;
            expect(String(first.inspection_date).slice(0, 10)).toBe(today);

            // Saving again the same day replaces the record instead of adding one.
            await asUser(SECOND_MEMBER);
            const second = await save(LAB_A, allOk);
            expect(second).toMatchObject({ id: first.id, issue_count: 0, note: null, inspected_by: SECOND_MEMBER });
            expect(Number((await db.query<{ n: number | string }>('select count(*) as n from public.lab_daily_inspections')).rows[0].n)).toBe(1);

            // Malformed results are rejected.
            for (const bad of [{}, [], { general_tidy: 'fine' }, { 'Bad-Key': 'ok' }, { general_tidy: 1 }, Object.fromEntries(Array.from({ length: 81 }, (_, i) => [`k${i}`, 'ok']))]) {
                await expect(save(LAB_A, bad)).rejects.toThrow('DAILY_INSPECTION_INVALID_INPUT');
            }
            await expect(save(LAB_A, allOk, null, 'Not A Version')).rejects.toThrow('DAILY_INSPECTION_INVALID_INPUT');
            await expect(save(LAB_A, allOk, 'x'.repeat(1001))).rejects.toThrow('DAILY_INSPECTION_INVALID_INPUT');

            // Clients cannot write the table directly, and only members read or record.
            await expect(db.query(`update public.lab_daily_inspections set issue_count = 0`)).rejects.toThrow('permission denied');
            await expect(db.query(`delete from public.lab_daily_inspections`)).rejects.toThrow('permission denied');
            await asUser(OUTSIDER);
            await expect(save(LAB_A, allOk)).rejects.toThrow('DAILY_INSPECTION_ACCESS_DENIED');
            expect((await db.query('select * from public.lab_daily_inspections')).rows).toEqual([]);
            await save(LAB_B, { ...allOk, fire_exit: 'bad' });
            await db.exec('reset role; set role anon;');
            await expect(save(LAB_A, allOk)).rejects.toThrow('permission denied');
            await expect(db.query('select * from public.lab_daily_inspections')).rejects.toThrow('permission denied');
            await expect(summary(CENTER)).rejects.toThrow('permission denied');

            // Older days exist only through history; add some as the table owner.
            await asOwner();
            await db.query(
                `insert into public.lab_daily_inspections(lab_id, inspection_date, checklist_version, results, issue_count)
                 select $1, ((now() at time zone 'Asia/Seoul')::date - n), 'kr-daily-v1', '{"general_tidy":"ok"}'::jsonb, case when n = 2 then 3 else 0 end
                 from unnest(array[1, 2, 6, 40]) as n`,
                [LAB_A],
            );

            // The center sees counts per summary-scoped lab and nothing else.
            await asUser(CENTER_USER);
            expect(await summary(CENTER)).toEqual([['Lab A', 30, 4, 1], ['Lab B', 30, 1, 1]]);
            expect(await summary(CENTER, 7)).toEqual([['Lab A', 7, 4, 1], ['Lab B', 7, 1, 1]]);
            expect(await summary(CENTER, 2)).toEqual([['Lab A', 2, 2, 0], ['Lab B', 2, 1, 1]]);
            expect(await summary(CENTER, 1000)).toEqual([['Lab A', 92, 5, 1], ['Lab B', 92, 1, 1]]);
            expect(await summary(OTHER_CENTER)).toEqual([]);
            expect((await db.query('select * from public.lab_daily_inspections')).rows).toEqual([]);

            // Deleting the inspector's account removes the stored name with the reference.
            await asOwner();
            await db.query('delete from auth.users where id = $1', [SECOND_MEMBER]);
            const cleared = (await db.query<{ inspected_by: string | null; inspector_name: string | null; issue_count: number }>(
                'select inspected_by, inspector_name, issue_count from public.lab_daily_inspections where id = $1', [first.id],
            )).rows[0];
            expect(cleared).toEqual({ inspected_by: null, inspector_name: null, issue_count: 0 });
        } finally {
            await db.close();
        }
    }, 120_000);
});
