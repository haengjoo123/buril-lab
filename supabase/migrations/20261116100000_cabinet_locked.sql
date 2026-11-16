-- 시약장 잠금장치 여부. 연구실 일상점검표 화공안전 항목("발암물질, 독성물질 등
-- 유해화학물질의 격리보관 및 시건장치 사용 여부")을 재고 데이터로 확인하기 위한 값이다.
-- null은 아직 정하지 않음, true는 잠금장치 있음, false는 잠금장치 없음이다. 기존 시약장은
-- null로 남아 경고가 생기지 않는다. 앱은 false인 시약장에 독성 물질이 있을 때만 알린다.
--
-- 열 추가뿐이다. 기존 표 단위 권한과 수정 정책(연구실 구성원)이 새 열에도 그대로 적용되고,
-- get_cabinet_state_v2는 to_jsonb(c)로 모든 열을 돌려주므로 함수 변경이 없다.
-- 되돌리기: alter table public.cabinets drop column locked;
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.cabinets add column locked boolean;

comment on column public.cabinets.locked is
  '잠금장치 여부: null 미설정, true 있음, false 없음. 일상점검 화공안전(시건장치) 확인용.';

commit;
