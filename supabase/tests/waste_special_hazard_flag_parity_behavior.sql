begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(6);

-- A batch held only by the fatal acute-toxicity rule must be recordable as
-- isolated or handed over. The payloads below are exactly what the client
-- builds (analyzeChemical -> createWasteComponentFromAnalysis ->
-- analyzeWasteBatch -> buildWasteHandlingRpcPayload). The client derives no
-- REACTIVE flag for such a component, so the server must not either:
-- record_waste_handling_v2 rejects any hazard-flag difference.
insert into public.waste_stream_catalog (code, display_name_ko, display_name_en, sort_order) values
  ('SPECIAL_REVIEW', '분리 보관·특별 검토', 'Isolate and review', 100)
on conflict (code) do nothing;
insert into public.waste_policy_versions (policy_key, scope_type, version_label, name, jurisdiction, status, activated_at)
select 'waste_special_hazard_parity_test', 'system', 'KR-2026.3', 'test policy', 'KR', 'active', now()
where not exists (select 1 from public.waste_policy_versions where scope_type = 'system' and status = 'active');
insert into public.waste_policy_streams (policy_version_id, stream_code, display_name_ko, display_name_en, sort_order)
select p.id, c.code, c.display_name_ko, c.display_name_en, c.sort_order
from public.waste_policy_versions p cross join public.waste_stream_catalog c
where p.scope_type = 'system' and p.status = 'active'
  and c.code = 'SPECIAL_REVIEW'
  and not exists (select 1 from public.waste_policy_streams s where s.policy_version_id = p.id and s.stream_code = c.code);

insert into auth.users(id,email) values
  ('c5000000-0000-4000-8000-000000000001','special-hazard-parity@example.invalid');
insert into public.labs(id,name) values
  ('c6000000-0000-4000-8000-000000000001','Special hazard parity lab');
insert into public.lab_members(lab_id,user_id,role) values
  ('c6000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','researcher');

create temp table special_hazard_parity_payload(name text primary key, batch jsonb) on commit drop;
insert into special_hazard_parity_payload values
  ('sulfuric_neat', '{"components":[{"cartLineId":"sulfuric_neat","sourceType":"search","sourceRef":null,"inventoryItemId":null,"cabinetItemId":null,"chemicalName":"Sulfuric acid","casNumber":"7664-93-9","formula":"H2O4S","molecularWeight":null,"pubchemCid":null,"koshaChemId":null,"identityConfidence":1,"ghsDataStatus":"verified","concentration":null,"hazardFlags":["CORROSIVE","ACUTE_TOXIC","CMR"],"dataSources":[{"sourceType":"search","sourceRef":null,"capturedAt":"2026-10-20T00:00:00.000Z"}],"analysisSnapshot":{"category":"SPECIAL_HAZARD","label":"label_special_hazard","reason":"reason_fatal_acute_toxicity","reasonParams":null,"isAiEstimated":false,"identityConfirmedByUser":false,"ghs":{"signal":"Danger","hazardStatements":["H290","H314","H330","H350"]},"hazardDataConfirmedByUser":false,"scanSnapshot":null,"physicalProperties":null,"referencePh":null,"referencePhSource":null,"inventorySnapshot":null,"inventoryDisposalQuantity":null,"sourceSearchEventId":null,"materialForm":"neat"}}],"handlingAction":"isolated","decisionStatus":"blocked","streamCode":"SPECIAL_REVIEW","matrix":"aqueous","totalAmount":{"value":100,"unit":"mL","approximate":false,"unknown":false},"decisionSnapshot":{"hazardFlags":["CORROSIVE","ACUTE_TOXIC","CMR"],"allowedActions":["isolated","handover"],"blockingReasons":[{"code":"special_hazard","messageKey":"waste_block_special_hazard"}],"missingFields":[],"legalWastePhClass":"unknown","corrosivityPhScreen":"unknown","routingBasis":"special_rule","policyVersion":"KR-2026.3","ruleVersion":"2.7.0"},"confirmationSnapshot":{"batchId":"batch","scopeKey":"anonymous:personal","matrixSource":"user","incidentContext":"none","measuredBatchPh":null,"measuredPh":null,"measuredPhStatus":"not_required","mixingState":"unknown"},"memo":null}'::jsonb),
  ('ethidium', '{"components":[{"cartLineId":"ethidium","sourceType":"search","sourceRef":null,"inventoryItemId":null,"cabinetItemId":null,"chemicalName":"Ethidium bromide","casNumber":"1239-45-8","formula":"C21H20BrN3","molecularWeight":null,"pubchemCid":null,"koshaChemId":null,"identityConfidence":1,"ghsDataStatus":"verified","concentration":{"value":0.5,"unit":"mg/mL"},"hazardFlags":["ACUTE_TOXIC","CMR"],"dataSources":[{"sourceType":"search","sourceRef":null,"capturedAt":"2026-10-20T00:00:00.000Z"}],"analysisSnapshot":{"category":"SPECIAL_HAZARD","label":"label_special_hazard","reason":"reason_fatal_acute_toxicity","reasonParams":null,"isAiEstimated":false,"identityConfirmedByUser":false,"ghs":{"signal":"Danger","hazardStatements":["H302","H315","H330","H341"]},"hazardDataConfirmedByUser":false,"scanSnapshot":null,"physicalProperties":null,"referencePh":null,"referencePhSource":null,"inventorySnapshot":null,"inventoryDisposalQuantity":null,"sourceSearchEventId":null,"materialForm":"solution"}}],"handlingAction":"handover","decisionStatus":"blocked","streamCode":"SPECIAL_REVIEW","matrix":"aqueous","totalAmount":{"value":100,"unit":"mL","approximate":false,"unknown":false},"decisionSnapshot":{"hazardFlags":["ACUTE_TOXIC","CMR"],"allowedActions":["isolated","handover"],"blockingReasons":[{"code":"special_hazard","messageKey":"waste_block_special_hazard"}],"missingFields":[],"legalWastePhClass":"unknown","corrosivityPhScreen":"unknown","routingBasis":"special_rule","policyVersion":"KR-2026.3","ruleVersion":"2.7.0"},"confirmationSnapshot":{"batchId":"batch","scopeKey":"anonymous:personal","matrixSource":"user","incidentContext":"none","measuredBatchPh":null,"measuredPh":null,"measuredPhStatus":"not_required","mixingState":"unknown"},"memo":null}'::jsonb);
-- Hosted environments can already have a different active system policy.
update special_hazard_parity_payload
set batch = jsonb_set(batch, '{decisionSnapshot,policyVersion}',
  to_jsonb((select id::text from public.waste_policy_versions where scope_type = 'system' and status = 'active')));
grant select on special_hazard_parity_payload to authenticated;

create function pg_temp.special_hazard_parity_analysis(p_name text) returns jsonb
language sql as $$
  select private.analyze_waste_batch_v2(b.batch->'components', b.batch->>'matrix', b.batch->'confirmationSnapshot')
  from special_hazard_parity_payload b
  where b.name = p_name
$$;

select is(
  (select r->'hazardFlags' from pg_temp.special_hazard_parity_analysis('sulfuric_neat') r),
  '["ACUTE_TOXIC", "CMR", "CORROSIVE"]'::jsonb,
  'neat sulfuric acid held for fatal toxicity derives the same hazard flags as the client'
);
select is(
  (select r->>'decisionStatus' || ':' || (r->>'streamCode') || ':' || (r->>'routingBasis') || ':' || (r->'blockingCodes')::text
   from pg_temp.special_hazard_parity_analysis('ethidium') r),
  'blocked:SPECIAL_REVIEW:special_rule:["special_hazard"]',
  'the fatal-toxicity hold still blocks in special review, without a reactive_waste code'
);
select ok(
  private.analyze_waste_batch_v2(
    '[{"chemicalName":"Nitric acid","casNumber":"7697-37-2","formula":"HNO3","identityConfidence":1,"ghsDataStatus":"verified","hazardFlags":[],"analysisSnapshot":{"category":"REACTIVE","ghs":{"signal":"Danger","hazardStatements":["H271","H314","H330"]},"materialForm":"neat"}}]'::jsonb,
    'aqueous',
    '{"incidentContext":"none","matrixSource":"user","mixingState":"unknown"}'::jsonb
  )->'hazardFlags' ? 'REACTIVE',
  'a fatally toxic oxidizer keeps its REACTIVE flag'
);

set request.jwt.claims='{"sub":"c5000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
select lives_ok(
  $$select public.record_waste_handling_v2('c7000000-0000-4000-8000-000000000001', (select batch from special_hazard_parity_payload where name = 'sulfuric_neat'), 'c6000000-0000-4000-8000-000000000001')$$,
  'a held neat sulfuric acid batch can be recorded as isolated'
);
select lives_ok(
  $$select public.record_waste_handling_v2('c7000000-0000-4000-8000-000000000002', (select batch from special_hazard_parity_payload where name = 'ethidium'), 'c6000000-0000-4000-8000-000000000001')$$,
  'a held ethidium bromide batch can be handed over'
);
reset role;

select is(
  (select string_agg(handling_action || ':' || decision_status || ':' || stream_code, ',' order by request_id)
   from public.waste_logs where lab_id = 'c6000000-0000-4000-8000-000000000001'),
  'isolated:blocked:SPECIAL_REVIEW,handover:blocked:SPECIAL_REVIEW',
  'both held batches are recorded in special review'
);

select * from finish();

rollback;
