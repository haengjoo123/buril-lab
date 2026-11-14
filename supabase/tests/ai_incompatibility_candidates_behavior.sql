begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(8);

insert into auth.users(id,email) values
  ('d1000000-0000-4000-8000-000000000001','ai-incompat-operator@example.invalid');

select ok(
  not has_function_privilege('anon', 'private.enqueue_ai_incompatibility_candidates_v1(text[],boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.enqueue_ai_incompatibility_candidates_v1(text[],boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.ai_incompatibility_pairs_v1(text[])', 'EXECUTE')
  and has_function_privilege('service_role', 'private.enqueue_ai_incompatibility_candidates_v1(text[],boolean)', 'EXECUTE'),
  'only the server can queue AI incompatibility candidates'
);

-- 나트륨 아자이드 초안(검증 문제 없음)이 디클로로메탄을 치명으로, 에탄올을 높음으로 적는다.
-- 반대쪽 디클로로메탄 초안도 같은 쌍을 적는다. critical 판정 초안의 항목은 무시되어야 한다.
insert into public.reagent_reference_drafts(id, source_reagent_id, prompt_version, cas_number, name_ko, record, verify_overall, major_issue_count) values
  ('d2000000-0000-4000-8000-000000000001', 910001, 'v3', '26628-22-8', '아자이드화나트륨',
   '{"incompatibilities":[{"with":"디클로로메탄","with_cas":"75-09-2","reason":"폭발성 다이아자이도메탄","severity":"치명"},{"with":"에탄올","with_cas":"64-17-5","reason":"테스트","severity":"높음"},{"with":"산 일반","with_cas":null,"reason":"HN3","severity":"치명"}]}'::jsonb,
   'minor', 0),
  ('d2000000-0000-4000-8000-000000000002', 910002, 'v3', '75-09-2', '디클로로메탄',
   '{"incompatibilities":[{"with":"아자이드화나트륨","with_cas":"26628-22-8","reason":"아자이드 금지","severity":"높음"}]}'::jsonb,
   'major', 0),
  ('d2000000-0000-4000-8000-000000000003', 910003, 'v3', '7664-93-9', '황산',
   '{"incompatibilities":[{"with":"물","with_cas":"7732-18-5","reason":"발열","severity":"치명"}]}'::jsonb,
   'critical', 0);

select is(
  (private.enqueue_ai_incompatibility_candidates_v1()) ->> 'newCandidates',
  '1',
  'dry run counts one fatal pair: both mentions merge, critical drafts and CAS-less items are left out'
);
select is(
  (select count(*) from public.analytics_review_candidates where evidence ->> 'source' = 'ai_reagentdb_v3'),
  0::bigint,
  'dry run is the default and writes nothing'
);

select is(
  (private.enqueue_ai_incompatibility_candidates_v1(array['치명'], false)) ->> 'inserted',
  '1',
  'a real run inserts the fatal pair'
);
select ok(
  exists (select 1 from public.analytics_review_candidates
          where candidate_type = 'safety_rule' and status = 'pending'
            and source_key = 'cas:26628-22-8|cas:75-09-2'
            and title = '혼재금지 후보: 아자이드화나트륨 + 디클로로메탄'
            and evidence ->> 'severity' = '치명'
            and (evidence ->> 'automaticRuleChange')::boolean = false
            and sample_count = 2),
  'the candidate uses the cas:A|cas:B key, the draft name and automaticRuleChange false'
);

select is(
  (private.enqueue_ai_incompatibility_candidates_v1(array['치명'], false)) ->> 'enriched',
  '1',
  'running again only refreshes the pending candidate'
);

-- 다른 경로가 만든 대기 후보는 evidence를 보존하고 AI 근거만 덧붙인다.
insert into public.analytics_review_candidates(candidate_type, source_key, title, summary, evidence, status) values
  ('safety_rule', 'cas:26628-22-8|cas:64-17-5', '혼합 검토 후보', '실제 혼합', '{"windowDays":90}'::jsonb, 'pending');
select private.enqueue_ai_incompatibility_candidates_v1(array['높음'], false);
select ok(
  exists (select 1 from public.analytics_review_candidates
          where source_key = 'cas:26628-22-8|cas:64-17-5' and status = 'pending'
            and evidence ->> 'windowDays' = '90'
            and evidence -> 'aiDraftEvidence' ->> 'severity' = '높음'),
  'an existing non-AI candidate keeps its evidence and gains aiDraftEvidence'
);

update public.analytics_review_candidates set status = 'rejected', reviewed_at = now()
  where source_key = 'cas:26628-22-8|cas:75-09-2';
select is(
  (private.enqueue_ai_incompatibility_candidates_v1(array['치명'], false)) ->> 'skippedDecided',
  '1',
  'a decided key is skipped and never re-opened'
);

select * from finish();
rollback;
