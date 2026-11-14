begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(7);

insert into auth.users(id,email) values
  ('c1000000-0000-4000-8000-000000000001','ai-draft-operator@example.invalid');

select ok(
  not has_table_privilege('anon', 'public.reagent_reference_drafts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.reagent_reference_drafts', 'SELECT')
  and not has_table_privilege('anon', 'public.reagent_alias_drafts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.reagent_alias_drafts', 'SELECT')
  and not has_table_privilege('anon', 'public.reagent_alias_promotions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.reagent_alias_promotions', 'SELECT')
  and has_table_privilege('service_role', 'public.reagent_reference_drafts', 'SELECT')
  and has_table_privilege('service_role', 'public.reagent_alias_drafts', 'SELECT'),
  'AI reagent drafts are server only'
);

select is(
  (select count(*) from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename in ('reagent_reference_drafts', 'reagent_alias_drafts', 'reagent_alias_promotions')
     and policyname = 'server_only_deny_browser_roles'
     and permissive = 'RESTRICTIVE'),
  3::bigint,
  'each AI draft table carries the restrictive browser-role deny policy'
);

select ok(
  not has_function_privilege('authenticated', 'private.promote_ai_aliases_v1(text[],uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.rollback_ai_alias_promotion_v1(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.reagent_alias_is_multi_form_v1(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.reagent_alias_is_multi_form_v1(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.analytics_review_candidate_decide(uuid,text,text,jsonb,uuid,text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.analytics_review_candidate_decide(uuid,text,text,jsonb,uuid,text,text,text)', 'EXECUTE'),
  'browser roles cannot promote, roll back or decide alias candidates'
);

-- 실제 데이터가 있는 DB에서도 겹치지 않게 시험 전용 별칭을 쓴다.
insert into public.reagent_reference_drafts(id, source_reagent_id, prompt_version, cas_number, name_ko, record) values
  ('c2000000-0000-4000-8000-000000000001', 900001, 'test', '121-44-8', '트라이에틸아민', '{}'::jsonb),
  ('c2000000-0000-4000-8000-000000000002', 900002, 'test', '97-93-8', '트리에틸알루미늄', '{}'::jsonb),
  ('c2000000-0000-4000-8000-000000000003', 900003, 'test', '75-09-2', '디클로로메탄', '{}'::jsonb);
insert into public.reagent_alias_drafts(draft_id, alias, normalized_alias, kind, status, reject_reason) values
  ('c2000000-0000-4000-8000-000000000001', ' TEA-PGTAP ', 'placeholder', 'abbreviations', 'rejected', '검수자 지적(다른 물질/부적절)'),
  ('c2000000-0000-4000-8000-000000000002', 'TEA-PGTAP', 'placeholder', 'abbreviations', 'candidate', null),
  ('c2000000-0000-4000-8000-000000000003', 'DCM-PGTAP', 'placeholder', 'abbreviations', 'candidate', null);

select ok(
  private.reagent_alias_is_multi_form_v1('tea-pgtap')
  and not private.reagent_alias_is_multi_form_v1('dcm-pgtap'),
  'a name on two reagent drafts is multi-form; trigger normalization makes TEA-PGTAP match tea-pgtap'
);

insert into public.analytics_review_candidates(id, candidate_type, source_key, title, summary, proposed_alias, canonical_name, evidence, status) values
  ('c3000000-0000-4000-8000-000000000001', 'search_alias', 'test:tea', 'TEA', 'TEA', 'TEA-PGTAP', '트라이에틸아민', '{}'::jsonb, 'pending'),
  ('c3000000-0000-4000-8000-000000000002', 'search_alias', 'test:dcm', 'DCM', 'DCM', 'DCM-PGTAP', '디클로로메탄', '{}'::jsonb, 'pending');

select throws_ok(
  $$select public.analytics_review_candidate_decide('c3000000-0000-4000-8000-000000000001', 'approved', 'test', '{}'::jsonb, 'c1000000-0000-4000-8000-000000000001')$$,
  '22023', 'This alias names several reagent forms and stays a form choice in search',
  'approving a multi-form name cannot link it to one reagent'
);

select lives_ok(
  $$select public.analytics_review_candidate_decide('c3000000-0000-4000-8000-000000000001', 'rejected', 'test', '{}'::jsonb, 'c1000000-0000-4000-8000-000000000001')$$,
  'a multi-form candidate can still be rejected'
);

select public.analytics_review_candidate_decide('c3000000-0000-4000-8000-000000000002', 'approved', 'test', '{}'::jsonb, 'c1000000-0000-4000-8000-000000000001');
select ok(
  exists (select 1 from public.global_reagent_aliases
          where normalized_alias = 'dcm-pgtap' and is_active
            and source_review_id = 'c3000000-0000-4000-8000-000000000002'),
  'a single-form name is still approved and recorded with its review id'
);

select * from finish();
rollback;
