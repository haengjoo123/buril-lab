begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(12);

-- Minimal system policy so the real deposit RPC can route an acetone batch.
insert into public.waste_stream_catalog (code, display_name_ko, display_name_en, sort_order) values
  ('ACID_AQUEOUS', '산성 수계 폐액', 'Acidic aqueous waste', 10),
  ('ORGANIC_NON_HALOGENATED', '비할로겐 유기 폐액', 'Non-halogenated organic waste', 40),
  ('SPECIAL_REVIEW', '분리 보관·특별 검토', 'Isolate and review', 100)
on conflict (code) do nothing;
insert into public.waste_policy_versions (policy_key, scope_type, version_label, name, jurisdiction, status, activated_at)
select 'waste_container_test', 'system', 'KR-2026.3', 'test policy', 'KR', 'active', now()
where not exists (select 1 from public.waste_policy_versions where scope_type = 'system' and status = 'active');
insert into public.waste_policy_streams (policy_version_id, stream_code, display_name_ko, display_name_en, sort_order)
select p.id, c.code, c.display_name_ko, c.display_name_en, c.sort_order
from public.waste_policy_versions p cross join public.waste_stream_catalog c
where p.scope_type = 'system' and p.status = 'active'
  and c.code in ('ACID_AQUEOUS', 'ORGANIC_NON_HALOGENATED', 'SPECIAL_REVIEW')
  and not exists (select 1 from public.waste_policy_streams s where s.policy_version_id = p.id and s.stream_code = c.code);

insert into auth.users(id,email) values
  ('c1000000-0000-4000-8000-000000000001','container-admin@example.invalid'),
  ('c1000000-0000-4000-8000-000000000002','container-outsider@example.invalid'),
  ('c1000000-0000-4000-8000-000000000003','container-student@example.invalid');
insert into public.labs(id,name) values
  ('c2000000-0000-4000-8000-000000000001','Container lab A'),
  ('c2000000-0000-4000-8000-000000000002','Container lab B');
insert into public.lab_members(lab_id,user_id,role) values
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','admin'),
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003','student'),
  ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000002','researcher');

create temp table waste_container_test_payload(batch jsonb) on commit drop;
insert into waste_container_test_payload values ('{"components":[{"cartLineId":"line-1","sourceType":"search","sourceRef":null,"inventoryItemId":null,"cabinetItemId":null,"chemicalName":"Acetone","casNumber":"67-64-1","formula":"C3H6O","molecularWeight":58.08,"pubchemCid":null,"koshaChemId":null,"identityConfidence":1,"ghsDataStatus":"verified","concentration":null,"hazardFlags":["FLAMMABLE"],"dataSources":[{"sourceType":"search","sourceRef":null,"capturedAt":"2026-08-02T00:00:00.000Z"}],"analysisSnapshot":{"category":"ORGANIC_NON_HALOGEN","label":"waste_organic_non_halogen","reason":"organic_non_halogen","reasonParams":null,"isAiEstimated":false,"identityConfirmedByUser":false,"ghs":{"signal":"Danger","hazardStatements":["H225: Highly flammable liquid and vapour"]},"hazardDataConfirmedByUser":false,"scanSnapshot":null,"physicalProperties":null,"referencePh":null,"referencePhSource":null,"inventorySnapshot":null,"inventoryDisposalQuantity":null,"sourceSearchEventId":null,"solutionContext":{"physicalForm":"organic_solvent","solventClass":"organic_non_halogen","isSolventVerified":true,"solventResolution":"local_dictionary","solventCasNumber":"67-64-1"}}}],"handlingAction":"container_deposit","decisionStatus":"ready","streamCode":"ORGANIC_NON_HALOGENATED","matrix":"organic_non_halogenated","totalAmount":{"value":500,"unit":"mL","approximate":false,"unknown":false},"decisionSnapshot":{"hazardFlags":["FLAMMABLE"],"allowedActions":["container_deposit"],"blockingReasons":[],"missingFields":[],"legalWastePhClass":"unknown","corrosivityPhScreen":"unknown","routingBasis":"matrix","policyVersion":"KR-2026.3","ruleVersion":"2.0.0"},"confirmationSnapshot":{"batchId":"b1","scopeKey":"x","matrixSource":"user","incidentContext":"none","measuredBatchPh":null,"measuredPh":null,"measuredPhStatus":"not_required","mixingState":"separate","alreadyMixed":false,"additionalComponentsStatus":"none"},"memo":null}'::jsonb);
-- Hosted environments can already have a different active system policy.
update waste_container_test_payload
set batch = jsonb_set(batch, '{decisionSnapshot,policyVersion}',
  to_jsonb((select id::text from public.waste_policy_versions where scope_type = 'system' and status = 'active')));
grant select on waste_container_test_payload to authenticated;

select ok(
  not has_table_privilege('anon', 'public.waste_containers', 'SELECT')
  and not has_table_privilege('authenticated', 'public.waste_containers', 'INSERT')
  and not has_table_privilege('authenticated', 'public.waste_containers', 'UPDATE')
  and has_table_privilege('authenticated', 'public.waste_containers', 'SELECT'),
  'clients read waste containers but write only through RPCs'
);
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (p.proname like '%waste_container%' or p.proname like '%_to_container_v1')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  )
  and has_function_privilege('authenticated', 'public.record_waste_deposit_to_container_v1(uuid,jsonb,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.record_inventory_disposal_to_container_v1(uuid,jsonb,jsonb,uuid,text,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.attach_waste_log_container_v1(jsonb,uuid)', 'EXECUTE'),
  'anon cannot execute container functions; clients only reach the public RPCs'
);

set request.jwt.claims='{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set role authenticated;
do $$
declare
  v_lab uuid := 'c2000000-0000-4000-8000-000000000001';
  v_batch jsonb := (select batch from waste_container_test_payload);
  v_org uuid; v_acid uuid; r jsonb;
begin
  v_org := (public.create_waste_container_v1(v_lab,'ORGANIC_NON_HALOGENATED','유기  1','B동 202호',20000))->>'id';
  if (select label from public.waste_containers where id = v_org) <> '유기 1' then raise exception 'label whitespace was not normalized'; end if;
  v_acid := (public.create_waste_container_v1(v_lab,'ACID_AQUEOUS','산-1',null,null))->>'id';
  begin
    perform public.create_waste_container_v1(v_lab,'ACID_AQUEOUS',' 유기 1 ',null,null);
    raise exception 'duplicate open label accepted';
  exception when unique_violation then null; end;

  r := public.record_waste_deposit_to_container_v1('c3000000-0000-4000-8000-000000000001', v_batch, v_lab, v_org);
  if r->>'container_id' is distinct from v_org::text then raise exception 'deposit was not attached: %', r; end if;
  r := public.record_waste_deposit_to_container_v1('c3000000-0000-4000-8000-000000000001', v_batch, v_lab, v_org);
  if (r->>'idempotent')::boolean is not true then raise exception 'replay was not idempotent'; end if;
  begin
    perform public.record_waste_deposit_to_container_v1('c3000000-0000-4000-8000-000000000001', v_batch, v_lab, v_acid);
    raise exception 'replay moved to another container';
  exception when unique_violation then if sqlerrm <> 'WASTE_CONTAINER_ALREADY_RECORDED' then raise; end if; end;
  begin
    perform public.record_waste_deposit_to_container_v1('c3000000-0000-4000-8000-000000000002', v_batch, v_lab, v_acid);
    raise exception 'stream mismatch accepted';
  exception when sqlstate '22023' then if sqlerrm <> 'WASTE_CONTAINER_STREAM_MISMATCH' then raise; end if; end;

  -- A plain deposit that was later corrected must not be attached by a replay.
  r := public.record_waste_handling_v2('c3000000-0000-4000-8000-000000000004', v_batch, v_lab);
  perform public.void_waste_log_v2((r->>'id')::uuid, 'recorded by mistake');
  begin
    perform public.record_waste_deposit_to_container_v1('c3000000-0000-4000-8000-000000000004', v_batch, v_lab, v_org);
    raise exception 'voided log attached';
  exception when sqlstate '22023' then if sqlerrm <> 'WASTE_CONTAINER_LOG_VOIDED' then raise; end if; end;
end $$;

reset role;
-- Backdate one plain deposit so it predates the container.
update public.waste_logs set created_at = now() - interval '1 day'
where request_id = 'c3000000-0000-4000-8000-000000000004';
update public.waste_logs set voided_at = null, voided_by = null, void_reason = null
where request_id = 'c3000000-0000-4000-8000-000000000004';
set role authenticated;
select throws_ok(
  $$select public.record_waste_deposit_to_container_v1('c3000000-0000-4000-8000-000000000004', (select batch from waste_container_test_payload), 'c2000000-0000-4000-8000-000000000001', (select id from public.waste_containers where label = '유기 1'))$$,
  '22023', 'WASTE_CONTAINER_LOG_PREDATES_CONTAINER',
  'a deposit recorded before the container started cannot be attached to it'
);

select is(
  (select deposit_count || ':' || total_ml from public.get_waste_container_totals_v1(array[(select id from public.waste_containers where label = '유기 1')])),
  '1:500',
  'totals count each live deposit once'
);

-- Only a lab admin may record collection.
set request.jwt.claims='{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$select public.set_waste_container_status_v1((select id from public.waste_containers where label = '유기 1'), 'collected', null)$$,
  '42501', 'WASTE_CONTAINER_ADMIN_REQUIRED',
  'a student cannot mark a container collected'
);
select lives_ok(
  $$select public.set_waste_container_status_v1((select id from public.waste_containers where label = '유기 1'), 'sealed', null)$$,
  'any member can seal a full container'
);

set request.jwt.claims='{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_lab uuid := 'c2000000-0000-4000-8000-000000000001';
  v_org uuid := (select id from public.waste_containers where label = '유기 1');
begin
  begin
    perform public.record_waste_deposit_to_container_v1('c3000000-0000-4000-8000-000000000003', (select batch from waste_container_test_payload), v_lab, v_org);
    raise exception 'sealed container accepted a deposit';
  exception when sqlstate '55000' then null; end;
  begin
    perform public.create_waste_container_v1(v_lab,'ORGANIC_NON_HALOGENATED','유기 1',null,null);
    raise exception 'sealed label was reused';
  exception when unique_violation then null; end;
  perform public.set_waste_container_status_v1(v_org,'collected','위탁업체 수거');
  begin
    perform public.set_waste_container_status_v1(v_org,'active');
    raise exception 'collected container reopened';
  exception when sqlstate '55000' then null; end;
  perform public.create_waste_container_v1(v_lab,'ORGANIC_NON_HALOGENATED','유기 1',null,null);
end $$;

reset role;
select is(
  (select count(*) from public.waste_logs where lab_id = 'c2000000-0000-4000-8000-000000000001' and container_id is not null),
  1::bigint,
  'only the accepted deposit is linked to a container'
);
select is(
  (select c.label || ':' || c.status from public.waste_logs l join public.waste_containers c on c.id = l.container_id
   where l.lab_id = 'c2000000-0000-4000-8000-000000000001'),
  '유기 1:collected',
  'the deposit stays linked to its container after collection'
);
select ok(
  (select count(*) from public.audit_logs where entity_type = 'waste_container' and action = 'create') = 3
  and exists (select 1 from public.audit_logs where entity_type = 'waste_container' and diff_data->'status'->>'to' = 'collected'),
  'container creation and status changes are written to audit_logs'
);

set request.jwt.claims='{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}';
set role authenticated;
select is((select count(*) from public.waste_containers), 0::bigint, 'another lab cannot read lab A containers');
select throws_ok(
  $$select public.set_waste_container_status_v1((select id from public.waste_logs limit 0), 'sealed', null)$$,
  '22023', 'container_id is required',
  'a missing container id is rejected before any lookup'
);
do $$
declare v_acid uuid;
begin
  reset role;
  select id into v_acid from public.waste_containers where label = '산-1';
  set role authenticated;
  begin
    perform public.set_waste_container_status_v1(v_acid,'sealed');
    raise exception 'outsider changed a container';
  exception when insufficient_privilege then null; end;
  begin
    perform public.record_waste_deposit_to_container_v1('c3000000-0000-4000-8000-000000000009', (select batch from waste_container_test_payload), 'c2000000-0000-4000-8000-000000000002', v_acid);
    raise exception 'cross-lab container accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select is(
  (select count(*) from public.waste_logs where lab_id = 'c2000000-0000-4000-8000-000000000002'),
  0::bigint,
  'a cross-lab container deposit is rolled back'
);

select * from finish();
rollback;
