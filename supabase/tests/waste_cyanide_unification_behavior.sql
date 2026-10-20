begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(10);

-- One component as the client serializes it (src/services/wasteLogService.ts).
create temp table cyanide_case(
  name text primary key,
  chemical_name text,
  cas text,
  formula text,
  category text,
  hcodes jsonb,
  flags jsonb,
  matrix text,
  ph numeric
) on commit drop;
insert into cyanide_case values
  ('nacn_no_ph', 'Sodium cyanide', '143-33-9', 'CNNa', 'CYANIDE', '["H290","H300","H310","H330"]', '["CORROSIVE","ACUTE_TOXIC","CYANIDE"]', 'aqueous', null),
  ('nacn_ph11', 'Sodium cyanide', '143-33-9', 'CNNa', 'CYANIDE', '["H290","H300","H310","H330"]', '["CORROSIVE","ACUTE_TOXIC","CYANIDE"]', 'aqueous', 11),
  ('nacn_ph8', 'Sodium cyanide', '143-33-9', 'CNNa', 'CYANIDE', '["H290","H300","H310","H330"]', '["CORROSIVE","ACUTE_TOXIC","CYANIDE"]', 'aqueous', 8),
  ('nacn_solid', 'Sodium cyanide', '143-33-9', 'CNNa', 'CYANIDE', '["H290","H300","H310","H330"]', '["CORROSIVE","ACUTE_TOXIC","CYANIDE"]', 'solid_slurry', null),
  ('ferricyanide_ph8', 'Potassium ferricyanide', '13746-66-2', 'C6FeK3N6', 'CYANIDE', '[]', '["CYANIDE"]', 'aqueous', 8),
  ('ammonium_cyanide', '시안화 암모늄(AMMONIUM CYANIDE)', '12211-52-8', 'CH4N2', 'CYANIDE', '["H300","H310","H330"]', '["ACUTE_TOXIC","CYANIDE"]', 'aqueous', null),
  ('hcn', 'Hydrogen cyanide', '74-90-8', 'CHN', 'SPECIAL_HAZARD', '["H224","H300","H310","H330"]', '["FLAMMABLE","ACUTE_TOXIC","CYANIDE"]', 'aqueous', 11),
  ('ferrous_sulfide', 'Ferrous sulfide', '1317-37-9', 'FeS', 'CYANIDE', '[]', '["SULFIDE"]', 'aqueous', null),
  ('barium_sulfide', 'Barium sulfide', '21109-95-5', 'BaS', 'HEAVY_METAL', '[]', '["HEAVY_METAL","SULFIDE"]', 'aqueous', null),
  ('vinyl_cyanide_named_nitrile', 'Veratryl cyanide', '93-17-4', 'C10H11NO2', 'ORGANIC_NON_HALOGEN', '["H302"]', '["ACUTE_TOXIC"]', 'organic_non_halogenated', null);

create function pg_temp.cyanide_result(p_name text) returns jsonb
language sql as $$
  select private.analyze_waste_batch_v2(
    jsonb_build_array(jsonb_build_object(
      'cartLineId', c.name,
      'chemicalName', c.chemical_name,
      'casNumber', c.cas,
      'formula', c.formula,
      'identityConfidence', 1,
      'ghsDataStatus', 'verified',
      'hazardFlags', c.flags,
      'analysisSnapshot', jsonb_build_object(
        'category', c.category,
        'ghs', jsonb_build_object('signal', 'Danger', 'hazardStatements', c.hcodes)
      )
    )),
    c.matrix,
    jsonb_strip_nulls(jsonb_build_object(
      'incidentContext', 'none',
      'matrixSource', 'user',
      'mixingState', 'already_mixed',
      'additionalComponentsStatus', 'none',
      'measuredPhStatus', case when c.ph is null then 'unknown' else 'measured' end,
      'measuredBatchPh', c.ph
    ))
  )
  from cyanide_case c
  where c.name = p_name
$$;

create function pg_temp.cyanide_summary(p_name text) returns text
language sql as $$
  select (r->>'decisionStatus') || ':' || (r->>'streamCode')
    || ' blocked=' || (r->'blockingCodes')::text || ' missing=' || (r->'missingFields')::text
  from pg_temp.cyanide_result(p_name) r
$$;

select is(pg_temp.cyanide_summary('nacn_no_ph'), 'needs_input:CYANIDE_SULFIDE blocked=[] missing=["measured_ph"]',
  'aqueous sodium cyanide needs a measured pH before the cyanide container');
select is(pg_temp.cyanide_summary('nacn_ph11'), 'ready:CYANIDE_SULFIDE blocked=[] missing=[]',
  'sodium cyanide at pH 11 goes to the cyanide container');
select is(pg_temp.cyanide_summary('nacn_ph8'), 'blocked:CYANIDE_SULFIDE blocked=["cyanide_not_alkaline"] missing=[]',
  'sodium cyanide below pH 10 is blocked');
select is(pg_temp.cyanide_summary('nacn_solid'), 'ready:CYANIDE_SULFIDE blocked=[] missing=[]',
  'solid cyanide waste needs no pH');
select is(pg_temp.cyanide_summary('ferricyanide_ph8'), 'ready:CYANIDE_SULFIDE blocked=[] missing=[]',
  'iron hexacyanides are stable and need no alkaline pH');
select is(pg_temp.cyanide_summary('ammonium_cyanide'), 'needs_input:CYANIDE_SULFIDE blocked=[] missing=["measured_ph"]',
  'ammonium cyanide follows the inorganic cyanide rule');
select is(pg_temp.cyanide_summary('hcn'), 'blocked:SPECIAL_REVIEW blocked=["special_hazard"] missing=[]',
  'hydrogen cyanide stays held even at pH 11');
select is((select r->'hazardFlags' from pg_temp.cyanide_result('ferrous_sulfide') r), '["SULFIDE"]'::jsonb,
  'a sulfide filed under the CYANIDE category gets no CYANIDE flag');
select is(pg_temp.cyanide_summary('barium_sulfide'), 'ready:HEAVY_METAL blocked=[] missing=[]',
  'a metal sulfide keeps its heavy-metal route, as on the client');
select is(pg_temp.cyanide_summary('vinyl_cyanide_named_nitrile'), 'ready:ORGANIC_NON_HALOGENATED blocked=[] missing=[]',
  'an organic nitrile named "... cyanide" is not routed as cyanide');

select * from finish();

rollback;
