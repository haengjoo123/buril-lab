begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(10);

-- One component as the client serializes it (src/services/wasteLogService.ts).
create temp table fatal_dilution_case(
  name text primary key,
  cas text,
  formula text,
  category text,
  hcodes jsonb,
  concentration jsonb,
  material_form text,
  basis text
) on commit drop;
insert into fatal_dilution_case values
  ('sulfuric_1m', '7664-93-9', 'H2O4S', 'SPECIAL_HAZARD', '["H290","H314","H330","H350"]', '{"value":1,"unit":"M"}', 'solution', null),
  ('sulfuric_unset_form', '7664-93-9', 'H2O4S', 'SPECIAL_HAZARD', '["H290","H314","H330","H350"]', '{"value":5,"unit":"%"}', null, 'w_w'),
  ('sulfuric_2m', '7664-93-9', 'H2O4S', 'SPECIAL_HAZARD', '["H290","H314","H330","H350"]', '{"value":2,"unit":"M"}', 'solution', null),
  ('sulfuric_10pct', '7664-93-9', 'H2O4S', 'SPECIAL_HAZARD', '["H290","H314","H330","H350"]', '{"value":10,"unit":"%"}', 'solution', 'w_w'),
  ('sulfuric_6pct_vv', '7664-93-9', 'H2O4S', 'SPECIAL_HAZARD', '["H290","H314","H330","H350"]', '{"value":6,"unit":"%"}', 'solution', 'v_v'),
  ('sulfuric_unknown', '7664-93-9', 'H2O4S', 'SPECIAL_HAZARD', '["H290","H314","H330","H350"]', 'null', 'solution', null),
  ('sulfuric_neat', '7664-93-9', 'H2O4S', 'SPECIAL_HAZARD', '["H290","H314","H330","H350"]', '{"value":1,"unit":"M"}', 'neat', null),
  ('nitric_0_1m', '7697-37-2', 'HNO3', 'REACTIVE', '["H271","H314","H330"]', '{"value":0.1,"unit":"M"}', 'solution', null),
  ('ethidium', '1239-45-8', 'C21H20BrN3', 'SPECIAL_HAZARD', '["H302","H315","H330","H341"]', '{"value":0.5,"unit":"mg/mL"}', 'solution', null),
  ('formaldehyde_0_05', '50-00-0', 'CH2O', 'SPECIAL_HAZARD', '["H220","H301","H311","H314","H330","H350"]', '{"value":0.05,"unit":"%"}', 'solution', 'w_w');

create function pg_temp.fatal_dilution_result(p_name text) returns jsonb
language sql as $$
  select private.analyze_waste_batch_v2(
    jsonb_build_array(jsonb_build_object(
      'cartLineId', c.name,
      'chemicalName', c.name,
      'casNumber', c.cas,
      'formula', c.formula,
      'identityConfidence', 1,
      'ghsDataStatus', 'verified',
      'concentration', c.concentration,
      'hazardFlags', '[]'::jsonb,
      'analysisSnapshot', jsonb_strip_nulls(jsonb_build_object(
        'category', c.category,
        'ghs', jsonb_build_object('signal', 'Danger', 'hazardStatements', c.hcodes),
        'materialForm', c.material_form,
        'phPredictionInput', case when c.basis is null then null
          else jsonb_build_object('concentrationBasis', c.basis) end
      ))
    )),
    'aqueous',
    '{"incidentContext":"none","matrixSource":"user","mixingState":"separate","additionalComponentsStatus":"none"}'::jsonb
  )
  from fatal_dilution_case c
  where c.name = p_name
$$;

select is(
  (select r->>'decisionStatus' || ':' || (r->>'streamCode') || ':' || (r->>'routingBasis') from pg_temp.fatal_dilution_result('sulfuric_1m') r),
  'ready:ACID_AQUEOUS:identity',
  '1 M sulfuric acid solution is routed to the aqueous acid stream'
);
select ok(
  not ((select r->'hazardFlags' from pg_temp.fatal_dilution_result('sulfuric_1m') r) ? 'REACTIVE'),
  'a lifted fatal-toxicity hold adds no REACTIVE flag the client would not derive'
);
select is(
  (select r->>'decisionStatus' || ':' || (r->>'streamCode') from pg_temp.fatal_dilution_result('sulfuric_unset_form') r),
  'ready:ACID_AQUEOUS',
  'a component without materialForm is a solution, and a w/w % is used as entered'
);
select is(
  (select r->>'decisionStatus' from pg_temp.fatal_dilution_result('sulfuric_2m') r),
  'blocked',
  '2 M sulfuric acid (about 19.6%) stays held'
);
select is(
  (select r->'blockingCodes' from pg_temp.fatal_dilution_result('sulfuric_10pct') r),
  '["reactive_waste", "special_hazard"]'::jsonb,
  'the published "10% 이상" threshold itself stays held'
);
select is(
  (select r->>'decisionStatus' from pg_temp.fatal_dilution_result('sulfuric_6pct_vv') r),
  'blocked',
  '6% v/v concentrated sulfuric acid is counted at its density and stays held'
);
select is(
  (select r->>'decisionStatus' || ':' || (r->>'streamCode') from pg_temp.fatal_dilution_result('sulfuric_unknown') r)
    || '/' || (select r->>'decisionStatus' || ':' || (r->>'streamCode') from pg_temp.fatal_dilution_result('sulfuric_neat') r),
  'blocked:SPECIAL_REVIEW/blocked:SPECIAL_REVIEW',
  'unknown concentration and neat product stay in special review'
);
select is(
  (select r->>'decisionStatus' || ':' || (r->>'streamCode') from pg_temp.fatal_dilution_result('nitric_0_1m') r),
  'blocked:REACTIVE_OXIDIZER',
  'dilute nitric acid keeps its oxidizer hold'
);
select is(
  (select r->>'decisionStatus' from pg_temp.fatal_dilution_result('ethidium') r),
  'blocked',
  'ethidium bromide has no legal limit and stays held'
);
select is(
  (select r->>'decisionStatus' || ':' || (r->>'streamCode') from pg_temp.fatal_dilution_result('formaldehyde_0_05') r),
  'ready:AQUEOUS_OTHER',
  'formaldehyde below its 0.1% chronic-toxicity threshold is routed as ordinary aqueous waste'
);

select * from finish();

rollback;
