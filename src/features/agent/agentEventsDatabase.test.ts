import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * Runs the real agent usage record migration in an embedded Postgres with
 * minimal stand-ins for the tables it depends on. The hosted pgTAP suite
 * (supabase/tests/agent_query_events_behavior.sql) covers the same rules
 * against the full schema.
 */
const migration = readFileSync(
    new URL('../../../supabase/migrations/20261127090000_agent_query_events.sql', import.meta.url),
    'utf8',
);

const STUBS = `
create role authenticated; create role anon; create role service_role;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create table public.labs(id uuid primary key, name text not null);
create table public.lab_members(lab_id uuid not null references public.labs(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, role text not null);
grant select on public.lab_members to authenticated;
`;

const MEMBER = 'f1000000-0000-4000-8000-000000000001';
const OUTSIDER = 'f1000000-0000-4000-8000-000000000002';
const LAB = 'f2000000-0000-4000-8000-000000000001';
const OTHER_LAB = 'f2000000-0000-4000-8000-000000000002';
const request = (n: number) => `f3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const SEED = `
insert into auth.users values ('${MEMBER}'),('${OUTSIDER}');
insert into public.labs values ('${LAB}','Agent lab'),('${OTHER_LAB}','Other lab');
insert into public.lab_members values ('${LAB}','${MEMBER}','student'),('${OTHER_LAB}','${OUTSIDER}','researcher');
`;

interface EventRow {
    user_id: string;
    lab_id: string | null;
    route: string;
    kind: string;
    outcome: string;
    reason: string | null;
    latency_ms: number | null;
    language: string;
    failed_text: string | null;
}

interface EventInput {
    requestId: string;
    route?: string;
    kind?: string;
    outcome?: string;
    language?: string;
    labId?: string | null;
    reason?: string | null;
    latencyMs?: number | null;
    failedText?: string | null;
}

describe('agent usage record database boundary', () => {
    it('stores what the caller did, keeps the sentence only for unhandled requests, and stays unreadable', async () => {
        const db = new PGlite();
        try {
            await db.exec(STUBS);
            await db.exec(migration);
            await db.exec(SEED);

            const asUser = (id: string) =>
                db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`);
            const asOwner = () => db.exec('reset role;');
            const record = (input: EventInput) => db.query(
                'select public.record_agent_query_event_v1($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [
                    input.requestId, input.route ?? 'planner', input.kind ?? 'expiry_list', input.outcome ?? 'answered',
                    input.language ?? 'ko', input.labId ?? null, input.reason ?? null, input.latencyMs ?? null, input.failedText ?? null,
                ],
            );
            const rowOf = async (requestId: string) => {
                await asOwner();
                const { rows } = await db.query<EventRow>('select * from public.agent_query_events where request_id = $1', [requestId]);
                return rows[0];
            };
            const countFor = async (userId: string) => {
                await asOwner();
                const { rows } = await db.query<{ n: number | string }>('select count(*) as n from public.agent_query_events where user_id = $1', [userId]);
                return Number(rows[0].n);
            };

            // A handled request: the sentence is dropped even when the caller sends it.
            await asUser(MEMBER);
            await record({ requestId: request(1), labId: LAB, latencyMs: 840, failedText: '유효기한 지난 시약 보여줘' });
            expect(await rowOf(request(1))).toMatchObject({
                user_id: MEMBER, lab_id: LAB, route: 'planner', kind: 'expiry_list', outcome: 'answered',
                reason: null, latency_ms: 840, language: 'ko', failed_text: null,
            });

            // An unhandled request keeps its sentence, trimmed and cut to 300 characters.
            await asUser(MEMBER);
            await record({ requestId: request(2), kind: 'unsupported', outcome: 'unsupported', reason: 'out_of_scope', failedText: '   오늘 점심 뭐 먹지   ' });
            await record({ requestId: request(3), kind: 'item_lookup', outcome: 'no_match', failedText: '가'.repeat(400) });
            await record({ requestId: request(4), route: 'rule', kind: 'redirect_disposal', outcome: 'disposal_card', failedText: '아세톤 어떻게 버려?' });
            expect(await rowOf(request(2))).toMatchObject({ lab_id: null, outcome: 'unsupported', reason: 'out_of_scope', failed_text: '오늘 점심 뭐 먹지' });
            expect((await rowOf(request(3))).failed_text).toHaveLength(300);
            expect((await rowOf(request(4))).failed_text).toBeNull();

            // Writing the same request again changes nothing.
            await asUser(MEMBER);
            await record({ requestId: request(1), kind: 'low_stock', outcome: 'empty' });
            expect(await rowOf(request(1))).toMatchObject({ kind: 'expiry_list', outcome: 'answered' });
            expect(await countFor(MEMBER)).toBe(4);

            // A proposal and its confirmation are two records; neither keeps the sentence.
            await asUser(MEMBER);
            await record({ requestId: request(5), kind: 'log_usage', outcome: 'proposed', reason: 'needs_choice', failedText: '아세톤 30% 남았어' });
            await record({ requestId: request(6), kind: 'log_usage', outcome: 'confirmed', failedText: '아세톤 30% 남았어' });
            expect(await rowOf(request(5))).toMatchObject({ outcome: 'proposed', reason: 'needs_choice', failed_text: null });
            expect(await rowOf(request(6))).toMatchObject({ outcome: 'confirmed', failed_text: null });

            // A lab needs membership; the personal space does not.
            await asUser(OUTSIDER);
            await expect(record({ requestId: request(10), labId: LAB })).rejects.toThrow('AGENT_EVENT_ACCESS_DENIED');
            await record({ requestId: request(11) });
            expect(await countFor(OUTSIDER)).toBe(1);

            // Values outside the contract are refused.
            await asUser(MEMBER);
            for (const bad of [
                { outcome: 'deleted_everything' },
                { route: 'server' },
                { kind: 'Item Lookup' },
                { kind: 'x'.repeat(41) },
                { language: 'ja' },
                { reason: 'see: https://example.invalid' },
                { latencyMs: -1 },
                { latencyMs: 600_001 },
            ]) {
                await expect(record({ requestId: request(20), ...bad })).rejects.toThrow('AGENT_EVENT_INVALID_INPUT');
            }

            // Clients cannot read or change the table, and a signed-out caller cannot write.
            await asUser(MEMBER);
            await expect(db.query('select * from public.agent_query_events')).rejects.toThrow('permission denied');
            await expect(db.query(`delete from public.agent_query_events`)).rejects.toThrow('permission denied');
            await expect(db.query(
                `insert into public.agent_query_events(user_id, request_id, route, kind, outcome, language) values ('${MEMBER}', '${request(30)}', 'rule', 'x', 'answered', 'ko')`,
            )).rejects.toThrow('permission denied');
            await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '', false);`);
            await expect(record({ requestId: request(31) })).rejects.toThrow('Authentication required');
            await db.exec('reset role; set role anon;');
            await expect(record({ requestId: request(32) })).rejects.toThrow('permission denied');

            // Beyond 500 records in a day, further writes are dropped without an error.
            await asOwner();
            await db.exec(`
                insert into public.agent_query_events(user_id, request_id, route, kind, outcome, language, created_at)
                select '${MEMBER}', gen_random_uuid(), 'rule', 'filler', 'answered', 'ko', now() - interval '2 days'
                from generate_series(1, 600);
            `);
            await asUser(MEMBER);
            await record({ requestId: request(40) });
            expect(await rowOf(request(40))).toBeDefined();
            await asOwner();
            await db.exec(`
                insert into public.agent_query_events(user_id, request_id, route, kind, outcome, language)
                select '${MEMBER}', gen_random_uuid(), 'rule', 'filler', 'answered', 'ko' from generate_series(1, 495);
            `);
            await asUser(MEMBER);
            await record({ requestId: request(41) });
            expect(await rowOf(request(41))).toBeUndefined();

            // A lab that is deleted leaves the record without its lab; an account that is deleted takes its records with it.
            await asOwner();
            await db.exec(`delete from public.labs where id = '${LAB}';`);
            expect((await rowOf(request(1))).lab_id).toBeNull();
            await db.exec(`delete from auth.users where id = '${MEMBER}';`);
            expect(await countFor(MEMBER)).toBe(0);
            expect(await countFor(OUTSIDER)).toBe(1);
        } finally {
            await db.close();
        }
    }, 120_000);
});
