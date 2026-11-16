-- 화학물질관리법 분류(KECO chemSbstnList) 조회 결과를 KOSHA 원천 기록과 같은
-- chemical_source_cache에 저장해, 연구실 단위 화면(재고 필터, 내보내기,
-- 관리자 집계)이 여러 CAS를 한 번에 읽을 수 있게 한다. CHECK 제약 두 개를
-- 넓히고 하나를 더할 뿐이며, 기존 행·권한·RLS(service role 전용)는 그대로다.
--
-- 되돌리기: keco 행을 지운 뒤 두 CHECK를 기준 정의(source = 'kosha',
-- record_type in identity·reference_ph)로 되돌리고 새 CHECK를 지운다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.chemical_source_cache
  drop constraint chemical_source_cache_source_check,
  add constraint chemical_source_cache_source_check
    check (source = any (array['kosha'::text, 'keco'::text]));

alter table public.chemical_source_cache
  drop constraint chemical_source_cache_record_type_check,
  add constraint chemical_source_cache_record_type_check
    check (record_type = any (array['identity'::text, 'reference_ph'::text, 'regulation'::text]));

-- KECO 결과는 regulation 기록으로만, regulation 기록은 KECO 결과로만 저장한다.
alter table public.chemical_source_cache
  add constraint chemical_source_cache_source_record_type_check
    check ((source = 'keco') = (record_type = 'regulation'));

commit;
