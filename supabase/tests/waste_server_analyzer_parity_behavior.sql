begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(11);

-- Rule 2.9.0: analyze_waste_batch_v2 mirrors the client analyzer, so batches
-- the client decides can be recorded. Each payload is exactly what the client
-- builds for a golden-set row (analyzeChemical -> createWasteComponentFromAnalysis
-- -> analyzeWasteBatch -> buildWasteHandlingRpcPayload). Before this rule every
-- one of them was rejected by record_waste_handling_v2 (status, stream or
-- hazard-flag mismatch). supabase/tests/waste_golden_server_parity.sql checks
-- the analysis for the whole golden set.
insert into public.waste_stream_catalog (code, display_name_ko, display_name_en, sort_order) values
  ('SPECIAL_REVIEW', '분리 보관·특별 검토', 'Isolate and review', 100),
  ('REACTIVE_OXIDIZER', '반응성·산화성', 'Reactive and oxidizer', 90),
  ('SOLID_CONTAMINATED', '오염 고체', 'Contaminated solid', 80),
  ('ORGANIC_NON_HALOGENATED', '비할로겐 유기', 'Non-halogenated organic', 20),
  ('ACID_AQUEOUS', '산 수용액', 'Aqueous acid', 30),
  ('ALKALI_AQUEOUS', '알칼리 수용액', 'Aqueous alkali', 40),
  ('AQUEOUS_OTHER', '기타 수용액', 'Other aqueous', 50)
on conflict (code) do nothing;
insert into public.waste_policy_versions (policy_key, scope_type, version_label, name, jurisdiction, status, activated_at)
select 'waste_server_analyzer_parity_test', 'system', 'KR-2026.3', 'test policy', 'KR', 'active', now()
where not exists (select 1 from public.waste_policy_versions where scope_type = 'system' and status = 'active');
insert into public.waste_policy_streams (policy_version_id, stream_code, display_name_ko, display_name_en, sort_order)
select p.id, c.code, c.display_name_ko, c.display_name_en, c.sort_order
from public.waste_policy_versions p cross join public.waste_stream_catalog c
where p.scope_type = 'system' and p.status = 'active'
  and c.code in ('SPECIAL_REVIEW', 'REACTIVE_OXIDIZER', 'SOLID_CONTAMINATED', 'ORGANIC_NON_HALOGENATED',
                 'ACID_AQUEOUS', 'ALKALI_AQUEOUS', 'AQUEOUS_OTHER')
  and not exists (select 1 from public.waste_policy_streams s where s.policy_version_id = p.id and s.stream_code = c.code);

insert into auth.users(id,email) values
  ('d5000000-0000-4000-8000-000000000001','server-analyzer-parity@example.invalid');
insert into public.labs(id,name) values
  ('d6000000-0000-4000-8000-000000000001','Server analyzer parity lab');
insert into public.lab_members(lab_id,user_id,role) values
  ('d6000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','researcher');

create temp table server_analyzer_parity_payload(name text primary key, batch jsonb) on commit drop;
insert into server_analyzer_parity_payload values
  ('silica_gel', '{"components":[{"cartLineId":"v2-0901-63231-67-4","sourceType":"search","sourceRef":null,"inventoryItemId":null,"cabinetItemId":null,"chemicalName":"SILICA GEL","casNumber":"63231-67-4","formula":null,"molecularWeight":null,"pubchemCid":null,"koshaChemId":null,"identityConfidence":1,"ghsDataStatus":"verified","concentration":null,"hazardFlags":["UNKNOWN_COMPONENT"],"dataSources":[{"sourceType":"search","sourceRef":null,"capturedAt":"2026-10-21T00:00:00.000Z"}],"analysisSnapshot":{"category":"UNKNOWN","label":"mix_label_unknown","reason":"reason_unknown","reasonParams":null,"isAiEstimated":false,"identityConfirmedByUser":false,"ghs":{"signal":"Warning","hazardStatements":["H315","H319","H335"]},"hazardDataConfirmedByUser":false,"scanSnapshot":null,"physicalProperties":null,"referencePh":null,"referencePhSource":null,"inventorySnapshot":null,"inventoryDisposalQuantity":null,"sourceSearchEventId":null}}],"handlingAction":"container_deposit","decisionStatus":"ready","streamCode":"SOLID_CONTAMINATED","matrix":"solid_slurry","totalAmount":{"value":100,"unit":"g","approximate":false,"unknown":false},"decisionSnapshot":{"hazardFlags":["UNKNOWN_COMPONENT"],"allowedActions":["container_deposit"],"blockingReasons":[],"missingFields":[],"legalWastePhClass":"unknown","corrosivityPhScreen":"unknown","routingBasis":"matrix","policyVersion":"KR-2026.3","ruleVersion":"2.9.0"},"confirmationSnapshot":{"batchId":"v2-0901-63231-67-4","scopeKey":"anonymous:personal","matrixSource":"user","incidentContext":"none","measuredBatchPh":null,"measuredPh":null,"measuredPhStatus":"not_required","mixingState":"unknown"},"memo":null}'::jsonb),
  ('isoniazid', '{"components":[{"cartLineId":"v2-0267-54-85-3","sourceType":"search","sourceRef":null,"inventoryItemId":null,"cabinetItemId":null,"chemicalName":"ISONICOTINIC HYDRAZIDE (Isoniazid)","casNumber":"54-85-3","formula":"C6H7N3O","molecularWeight":null,"pubchemCid":null,"koshaChemId":null,"identityConfidence":1,"ghsDataStatus":"verified","concentration":null,"hazardFlags":[],"dataSources":[{"sourceType":"search","sourceRef":null,"capturedAt":"2026-10-21T00:00:00.000Z"}],"analysisSnapshot":{"category":"ORGANIC_NON_HALOGEN","label":"label_organic_non_halogen","reason":"reason_organic_non_halogen","reasonParams":null,"isAiEstimated":false,"identityConfirmedByUser":false,"ghs":{"signal":"Warning","hazardStatements":["H302","H315"]},"hazardDataConfirmedByUser":false,"scanSnapshot":null,"physicalProperties":null,"referencePh":null,"referencePhSource":null,"inventorySnapshot":null,"inventoryDisposalQuantity":null,"sourceSearchEventId":null}}],"handlingAction":"container_deposit","decisionStatus":"ready","streamCode":"ORGANIC_NON_HALOGENATED","matrix":"organic_non_halogenated","totalAmount":{"value":100,"unit":"mL","approximate":false,"unknown":false},"decisionSnapshot":{"hazardFlags":[],"allowedActions":["container_deposit"],"blockingReasons":[],"missingFields":[],"legalWastePhClass":"unknown","corrosivityPhScreen":"unknown","routingBasis":"matrix","policyVersion":"KR-2026.3","ruleVersion":"2.9.0"},"confirmationSnapshot":{"batchId":"v2-0267-54-85-3","scopeKey":"anonymous:personal","matrixSource":"user","incidentContext":"none","measuredBatchPh":null,"measuredPh":null,"measuredPhStatus":"not_required","mixingState":"unknown"},"memo":null}'::jsonb),
  ('magnesium_sulfate', '{"components":[{"cartLineId":"v2-0617-7487-88-9","sourceType":"search","sourceRef":null,"inventoryItemId":null,"cabinetItemId":null,"chemicalName":"MAGNESIUM SULFATE (Sulfuric acid magnesium salt (1:1))","casNumber":"7487-88-9","formula":"MgO4S","molecularWeight":null,"pubchemCid":null,"koshaChemId":null,"identityConfidence":1,"ghsDataStatus":"verified","concentration":null,"hazardFlags":["ENVIRONMENTAL_HAZARD"],"dataSources":[{"sourceType":"search","sourceRef":null,"capturedAt":"2026-10-21T00:00:00.000Z"}],"analysisSnapshot":{"category":"NEUTRAL","label":"label_neutral","reason":"reason_neutral_inorganic_salt","reasonParams":null,"isAiEstimated":false,"identityConfirmedByUser":false,"ghs":{"signal":"Danger","hazardStatements":["H334","H400"]},"hazardDataConfirmedByUser":false,"scanSnapshot":null,"physicalProperties":null,"referencePh":null,"referencePhSource":null,"inventorySnapshot":null,"inventoryDisposalQuantity":null,"sourceSearchEventId":null}}],"handlingAction":"container_deposit","decisionStatus":"ready","streamCode":"AQUEOUS_OTHER","matrix":"aqueous","totalAmount":{"value":100,"unit":"mL","approximate":false,"unknown":false},"decisionSnapshot":{"hazardFlags":["ENVIRONMENTAL_HAZARD"],"allowedActions":["container_deposit"],"blockingReasons":[],"missingFields":[],"legalWastePhClass":"unknown","corrosivityPhScreen":"unknown","routingBasis":"matrix","policyVersion":"KR-2026.3","ruleVersion":"2.9.0"},"confirmationSnapshot":{"batchId":"v2-0617-7487-88-9","scopeKey":"anonymous:personal","matrixSource":"user","incidentContext":"none","measuredBatchPh":null,"measuredPh":null,"measuredPhStatus":"not_required","mixingState":"unknown"},"memo":null}'::jsonb),
  ('guanidine_hcl', '{"components":[{"cartLineId":"v2-1059-50-01-1","sourceType":"search","sourceRef":null,"inventoryItemId":null,"cabinetItemId":null,"chemicalName":"염산 구아니딘 (Guanidine Hydrochloride)","casNumber":"50-01-1","formula":"CH6ClN3","molecularWeight":null,"pubchemCid":null,"koshaChemId":null,"identityConfidence":1,"ghsDataStatus":"verified","concentration":null,"hazardFlags":["ENVIRONMENTAL_HAZARD"],"dataSources":[{"sourceType":"search","sourceRef":null,"capturedAt":"2026-10-21T00:00:00.000Z"}],"analysisSnapshot":{"category":"NEUTRAL","label":"label_ionic_organic_salt","reason":"reason_ionic_organic_salt_matrix_required","reasonParams":null,"isAiEstimated":false,"identityConfirmedByUser":false,"ghs":{"signal":"Warning","hazardStatements":["H302","H315","H319","H335","H413"]},"hazardDataConfirmedByUser":false,"scanSnapshot":null,"physicalProperties":null,"referencePh":null,"referencePhSource":null,"inventorySnapshot":null,"inventoryDisposalQuantity":null,"sourceSearchEventId":null}}],"handlingAction":"container_deposit","decisionStatus":"ready","streamCode":"AQUEOUS_OTHER","matrix":"aqueous","totalAmount":{"value":100,"unit":"mL","approximate":false,"unknown":false},"decisionSnapshot":{"hazardFlags":["ENVIRONMENTAL_HAZARD"],"allowedActions":["container_deposit"],"blockingReasons":[],"missingFields":[],"legalWastePhClass":"unknown","corrosivityPhScreen":"unknown","routingBasis":"matrix","policyVersion":"KR-2026.3","ruleVersion":"2.9.0"},"confirmationSnapshot":{"batchId":"v2-1059-50-01-1","scopeKey":"anonymous:personal","matrixSource":"user","incidentContext":"none","measuredBatchPh":null,"measuredPh":null,"measuredPhStatus":"not_required","mixingState":"unknown"},"memo":null}'::jsonb),
  ('aluminum_hydroxide_sulfate', '{"components":[{"cartLineId":"v2-0583-39290-78-3","sourceType":"search","sourceRef":null,"inventoryItemId":null,"cabinetItemId":null,"chemicalName":"알루미늄 염화 하이드록시 황산염(ALUMINUM CHLORIDE HYDROXIDE SULFATE) (Aluminum chloride hydroxide sulfate)","casNumber":"39290-78-3","formula":"AlClHO5S-4","molecularWeight":null,"pubchemCid":null,"koshaChemId":null,"identityConfidence":1,"ghsDataStatus":"verified","concentration":null,"hazardFlags":["CMR","ENVIRONMENTAL_HAZARD"],"dataSources":[{"sourceType":"search","sourceRef":null,"capturedAt":"2026-10-21T00:00:00.000Z"}],"analysisSnapshot":{"category":"ALKALI","label":"label_alkali","reason":"reason_alkali_keyword","reasonParams":null,"isAiEstimated":false,"identityConfirmedByUser":false,"ghs":{"signal":"Danger","hazardStatements":["H332","H336","H360","H373","H400"]},"hazardDataConfirmedByUser":false,"scanSnapshot":null,"physicalProperties":null,"referencePh":null,"referencePhSource":null,"inventorySnapshot":null,"inventoryDisposalQuantity":null,"sourceSearchEventId":null}}],"handlingAction":"container_deposit","decisionStatus":"ready","streamCode":"ALKALI_AQUEOUS","matrix":"aqueous","totalAmount":{"value":100,"unit":"mL","approximate":false,"unknown":false},"decisionSnapshot":{"hazardFlags":["CMR","ENVIRONMENTAL_HAZARD"],"allowedActions":["container_deposit"],"blockingReasons":[],"missingFields":[],"legalWastePhClass":"unknown","corrosivityPhScreen":"unknown","routingBasis":"identity","policyVersion":"KR-2026.3","ruleVersion":"2.9.0"},"confirmationSnapshot":{"batchId":"v2-0583-39290-78-3","scopeKey":"anonymous:personal","matrixSource":"user","incidentContext":"none","measuredBatchPh":null,"measuredPh":null,"measuredPhStatus":"not_required","mixingState":"unknown"},"memo":null}'::jsonb),
  ('trichloroacetic_acid', '{"components":[{"cartLineId":"v2-1009-76-03-9","sourceType":"search","sourceRef":null,"inventoryItemId":null,"cabinetItemId":null,"chemicalName":"트리클로로아세트산 (Trichloroacetic Acid)","casNumber":"76-03-9","formula":"C2HCl3O2","molecularWeight":null,"pubchemCid":null,"koshaChemId":null,"identityConfidence":1,"ghsDataStatus":"verified","concentration":null,"hazardFlags":["CORROSIVE","CMR"],"dataSources":[{"sourceType":"search","sourceRef":null,"capturedAt":"2026-10-21T00:00:00.000Z"}],"analysisSnapshot":{"category":"ACID","label":"label_acid","reason":"reason_corrosive_acid_identity","reasonParams":null,"isAiEstimated":false,"identityConfirmedByUser":false,"ghs":{"signal":"Danger","hazardStatements":["H302","H314","H351"]},"hazardDataConfirmedByUser":false,"scanSnapshot":null,"physicalProperties":null,"referencePh":null,"referencePhSource":null,"inventorySnapshot":null,"inventoryDisposalQuantity":null,"sourceSearchEventId":null}}],"handlingAction":"container_deposit","decisionStatus":"ready","streamCode":"ACID_AQUEOUS","matrix":"aqueous","totalAmount":{"value":100,"unit":"mL","approximate":false,"unknown":false},"decisionSnapshot":{"hazardFlags":["CORROSIVE","CMR"],"allowedActions":["container_deposit"],"blockingReasons":[],"missingFields":[],"legalWastePhClass":"unknown","corrosivityPhScreen":"unknown","routingBasis":"identity","policyVersion":"KR-2026.3","ruleVersion":"2.9.0"},"confirmationSnapshot":{"batchId":"v2-1009-76-03-9","scopeKey":"anonymous:personal","matrixSource":"user","incidentContext":"none","measuredBatchPh":null,"measuredPh":null,"measuredPhStatus":"not_required","mixingState":"unknown"},"memo":null}'::jsonb),
  ('thiosemicarbazide', '{"components":[{"cartLineId":"v2-0258-79-19-6","sourceType":"search","sourceRef":null,"inventoryItemId":null,"cabinetItemId":null,"chemicalName":"Thiosemicarbazide","casNumber":"79-19-6","formula":"CH5N3S","molecularWeight":null,"pubchemCid":null,"koshaChemId":null,"identityConfidence":1,"ghsDataStatus":"verified","concentration":null,"hazardFlags":["ACUTE_TOXIC","ENVIRONMENTAL_HAZARD"],"dataSources":[{"sourceType":"search","sourceRef":null,"capturedAt":"2026-10-21T00:00:00.000Z"}],"analysisSnapshot":{"category":"SPECIAL_HAZARD","label":"label_special_hazard","reason":"reason_fatal_acute_toxicity","reasonParams":null,"isAiEstimated":false,"identityConfirmedByUser":false,"ghs":{"signal":"Danger","hazardStatements":["H300","H412"]},"hazardDataConfirmedByUser":false,"scanSnapshot":null,"physicalProperties":null,"referencePh":null,"referencePhSource":null,"inventorySnapshot":null,"inventoryDisposalQuantity":null,"sourceSearchEventId":null}}],"handlingAction":"isolated","decisionStatus":"blocked","streamCode":"SPECIAL_REVIEW","matrix":"organic_non_halogenated","totalAmount":{"value":100,"unit":"mL","approximate":false,"unknown":false},"decisionSnapshot":{"hazardFlags":["ACUTE_TOXIC","ENVIRONMENTAL_HAZARD"],"allowedActions":["isolated","handover"],"blockingReasons":[{"code":"special_hazard","messageKey":"waste_block_special_hazard"}],"missingFields":[],"legalWastePhClass":"unknown","corrosivityPhScreen":"unknown","routingBasis":"special_rule","policyVersion":"KR-2026.3","ruleVersion":"2.9.0"},"confirmationSnapshot":{"batchId":"v2-0258-79-19-6","scopeKey":"anonymous:personal","matrixSource":"user","incidentContext":"none","measuredBatchPh":null,"measuredPh":null,"measuredPhStatus":"not_required","mixingState":"unknown"},"memo":null}'::jsonb),
  ('organic_peroxide', '{"components":[{"cartLineId":"v2-0250-2781-00-2","sourceType":"search","sourceRef":null,"inventoryItemId":null,"cabinetItemId":null,"chemicalName":"1,4-비스(알파-(t-부틸디옥시)이소프로필)벤젠( 관용명 : di-tert-butyl α,α,α'',α''-tetramethyl-(p-phenylenedimethylene) diperoxide ) (1,4-Bis(alpha-(t-butyldioxy)isopropyl)benzene)","casNumber":"2781-00-2","formula":"C20H34O4","molecularWeight":null,"pubchemCid":null,"koshaChemId":null,"identityConfidence":1,"ghsDataStatus":"verified","concentration":null,"hazardFlags":["REACTIVE"],"dataSources":[{"sourceType":"search","sourceRef":null,"capturedAt":"2026-10-21T00:00:00.000Z"}],"analysisSnapshot":{"category":"REACTIVE","label":"label_reactive","reason":"reason_reactive","reasonParams":null,"isAiEstimated":false,"identityConfirmedByUser":false,"ghs":{"signal":"Warning","hazardStatements":[]},"hazardDataConfirmedByUser":false,"scanSnapshot":null,"physicalProperties":null,"referencePh":null,"referencePhSource":null,"inventorySnapshot":null,"inventoryDisposalQuantity":null,"sourceSearchEventId":null}}],"handlingAction":"isolated","decisionStatus":"blocked","streamCode":"REACTIVE_OXIDIZER","matrix":"organic_non_halogenated","totalAmount":{"value":100,"unit":"mL","approximate":false,"unknown":false},"decisionSnapshot":{"hazardFlags":["REACTIVE"],"allowedActions":["isolated","handover"],"blockingReasons":[{"code":"reactive_waste","messageKey":"waste_block_reactive"}],"missingFields":[],"legalWastePhClass":"unknown","corrosivityPhScreen":"unknown","routingBasis":"special_rule","policyVersion":"KR-2026.3","ruleVersion":"2.9.0"},"confirmationSnapshot":{"batchId":"v2-0250-2781-00-2","scopeKey":"anonymous:personal","matrixSource":"user","incidentContext":"none","measuredBatchPh":null,"measuredPh":null,"measuredPhStatus":"not_required","mixingState":"unknown"},"memo":null}'::jsonb);
-- Hosted environments can already have a different active system policy.
update server_analyzer_parity_payload
set batch = jsonb_set(batch, '{decisionSnapshot,policyVersion}',
  to_jsonb((select id::text from public.waste_policy_versions where scope_type = 'system' and status = 'active')));
grant select on server_analyzer_parity_payload to authenticated;

select is(
  private.analyze_waste_batch_v2(
    '[{"chemicalName":"Cadmium sulfoselenide orange","casNumber":"12656-57-4","formula":null,"identityConfidence":1,"ghsDataStatus":"verified","hazardFlags":["ENVIRONMENTAL_HAZARD","UNKNOWN_COMPONENT"],"analysisSnapshot":{"category":"UNKNOWN","ghs":{"signal":"Warning","hazardStatements":["H332","H400","H410"]}}}]'::jsonb,
    'solid_slurry',
    '{"incidentContext":"none","matrixSource":"user","mixingState":"unknown"}'::jsonb
  )->>'decisionStatus',
  'needs_input',
  'an unclassified solid named after a heavy metal keeps the classification hold'
);
select is(
  private.analyze_waste_batch_v2(
    '[{"chemicalName":"Sodium azide","casNumber":"26628-22-8","formula":"NaN3","identityConfidence":1,"ghsDataStatus":"verified","hazardFlags":[],"analysisSnapshot":{"category":"NEUTRAL","ghs":{"signal":"Danger","hazardStatements":["H300"]}}}]'::jsonb,
    'aqueous',
    '{"incidentContext":"none","matrixSource":"user","mixingState":"unknown"}'::jsonb
  )->'hazardFlags' ? 'REACTIVE',
  true,
  'a real azide is still derived as reactive even when the client omits the flag'
);

set request.jwt.claims='{"sub":"d5000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
select lives_ok(
  $$select public.record_waste_handling_v2('d7000000-0000-4000-8000-000000000001', (select batch from server_analyzer_parity_payload where name = 'silica_gel'), 'd6000000-0000-4000-8000-000000000001')$$,
  'a verified unclassified solid (silica gel) is deposited as contaminated solid'
);
select lives_ok(
  $$select public.record_waste_handling_v2('d7000000-0000-4000-8000-000000000002', (select batch from server_analyzer_parity_payload where name = 'isoniazid'), 'd6000000-0000-4000-8000-000000000001')$$,
  'a hydrazide (isoniazid) is no longer read as an azide'
);
select lives_ok(
  $$select public.record_waste_handling_v2('d7000000-0000-4000-8000-000000000003', (select batch from server_analyzer_parity_payload where name = 'magnesium_sulfate'), 'd6000000-0000-4000-8000-000000000001')$$,
  '"sulfuric acid magnesium salt" is a salt, not sulfuric acid'
);
select lives_ok(
  $$select public.record_waste_handling_v2('d7000000-0000-4000-8000-000000000004', (select batch from server_analyzer_parity_payload where name = 'guanidine_hcl'), 'd6000000-0000-4000-8000-000000000001')$$,
  'guanidine hydrochloride in water is not a halogenated organic waste'
);
select lives_ok(
  $$select public.record_waste_handling_v2('d7000000-0000-4000-8000-000000000005', (select batch from server_analyzer_parity_payload where name = 'aluminum_hydroxide_sulfate'), 'd6000000-0000-4000-8000-000000000001')$$,
  'a basic aluminium sulfate is not an acid/alkali pair'
);
select lives_ok(
  $$select public.record_waste_handling_v2('d7000000-0000-4000-8000-000000000006', (select batch from server_analyzer_parity_payload where name = 'trichloroacetic_acid'), 'd6000000-0000-4000-8000-000000000001')$$,
  'aqueous trichloroacetic acid goes to the acid stream'
);
select lives_ok(
  $$select public.record_waste_handling_v2('d7000000-0000-4000-8000-000000000007', (select batch from server_analyzer_parity_payload where name = 'thiosemicarbazide'), 'd6000000-0000-4000-8000-000000000001')$$,
  'a fatally toxic thiosemicarbazide is held without a REACTIVE flag'
);
select lives_ok(
  $$select public.record_waste_handling_v2('d7000000-0000-4000-8000-000000000008', (select batch from server_analyzer_parity_payload where name = 'organic_peroxide'), 'd6000000-0000-4000-8000-000000000001')$$,
  'an organic "diperoxide" without H242 is held as reactive'
);
reset role;

select is(
  (select string_agg(handling_action || ':' || decision_status || ':' || stream_code, ',' order by request_id)
   from public.waste_logs where lab_id = 'd6000000-0000-4000-8000-000000000001'),
  'container_deposit:ready:SOLID_CONTAMINATED,container_deposit:ready:ORGANIC_NON_HALOGENATED,container_deposit:ready:AQUEOUS_OTHER,container_deposit:ready:AQUEOUS_OTHER,container_deposit:ready:ALKALI_AQUEOUS,container_deposit:ready:ACID_AQUEOUS,isolated:blocked:SPECIAL_REVIEW,isolated:blocked:REACTIVE_OXIDIZER',
  'every batch is recorded with the client decision'
);

select * from finish();

rollback;
