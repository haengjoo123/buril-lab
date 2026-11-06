# 운영 콘솔 핵심 지표(KPI)·데이터 위생 출시 절차

상태: 저장소 준비 완료, Staging·운영 DB 미적용 (2026-11-06)

## 무엇이 바뀌나

- 운영 콘솔 홈(`/ops`)이 정확한 대기 건수와 목표별 핵심 지표를 보여 준다.
  - 처리할 일: 센터 승인 대기·새 개선 제안·검토할 후보의 정확한 건수와 가장 오래 기다린 기간, 후보의 마지막 갱신 시각.
  - 북극성: 최근 7일 동안 핵심 기록이 있는 연구실 수(주간 기록 연구실)와 최근 8주 추이.
  - 제품·리텐션, 안전·데이터 품질, B2B 묶음: 현재 기간과 직전 같은 길이 기간을 비교한다. 기준 수가 10 미만이면 비율 대신 `n/N`과 "참고용" 표시를 쓴다.
- 지표 정의는 `src/features/ops/metricDefinitions.ts` 한곳에 두고, 각 묶음의 "정의" 버튼으로 화면에서 확인한다.
- 온보딩 기록에 남아 있던 검색어 원문(`metadata.query`)을 지우고 글자 수(`query_length`)만 남긴다.
- 앱이 이미 보내던 구매 의도 이벤트(`cas_suggestion_dismissed`)와 CAS 입력 방식 3종(`suggested_confirmed`, `bulk_confirmed`, `suggestion_dismissed`)이 더 이상 CHECK 제약에 막혀 버려지지 않는다.

## 서버가 강제하는 규칙

`20261106090000_admin_kpis_v1.sql`

- `public.analytics_admin_kpis_v1(p_days integer)`: `LANGUAGE sql STABLE`, SECURITY INVOKER, `search_path = ''`, `TimeZone = UTC`. `public`·`anon`·`authenticated` 실행 권한을 회수하고 `service_role`에만 실행을 허용한다. 운영자 API(`/api/admin/analytics/summary`, reader 역할)만 서버에서 호출한다.
- `p_days`는 1~365만 받는다. 범위를 벗어나거나 null이면 `22023`으로 거부한다(API는 이미 1~365로 맞춰 보낸다). 검사는 `private.analytics_kpi_days_v1(integer)`가 하며, 이 함수도 `service_role`만 실행한다.
- 결과에는 건수·비율의 분자와 분모·중앙값·시각만 담는다. 사용자 ID, 연구실 ID, 이메일, 이름, 정정 사유 원문, 제안 본문, 행위자는 담지 않는다. 기관명은 영업 후보 상위 10곳만 소문자·앞뒤 공백 제거 형태로, 브랜드는 연구실 3곳·사용자 5명 이상일 때 상위 5개만 담는다. 보관 경고 규칙 ID는 앱의 규칙 목록(`STORAGE_RULES`, 19개)에 있는 것만 이름을 보여 주고, 그 밖의 값은 건수에만 넣는다.
- `private.analytics_internal_labs`: 지표에서 뺄 내부·시험 연구실 목록(`lab_id`, `reason` = `internal`·`test`·`demo`, `added_at`). Data API 스키마 밖에 있고 `service_role`만 읽는다(쓰기 권한은 없음). 브라우저 역할은 권한이 없다. 연구실이 삭제되면 함께 지워진다. 정책 없는 RLS 테이블은 Advisor 항목(`rls_enabled_no_policy`)을 늘리므로 RLS는 켜지 않았다.
- 내부 연구실의 멤버는 사용자 단위 지표(WAU·MAU·온보딩·구매 의도 사용자 수)에서도 빠진다. 고객이 내부 연구실에 들어가 있으면 그 고객의 활동도 빠지므로, 내부 연구실에는 운영 직원만 둔다.
- 새 public 테이블과 authenticated가 실행할 수 있는 SECURITY DEFINER 함수는 없다. `baseline_permissions.sql`의 개수(public 테이블 54개, anon 24 · authenticated 37 · service_role 54)와 Security Advisor 기준(73건)은 바뀌지 않는다.

## 검증 결과 (로컬, 2026-11-06)

- 운영 스키마(기준선 + 증분 18개)를 일회용 PostgreSQL 17(127.0.0.1)에 재구성하고, Supabase 기본 권한(새 public 함수 EXECUTE와 테이블 권한 → anon·authenticated·service_role)을 재현한 뒤 migration을 적용했다. 기본 권한이 있어도 anon·authenticated는 두 함수를 실행할 수 없고 `service_role`만 실행한다. 함수 ACL은 `postgres`·`service_role`뿐이고, 내부 연구실 목록의 ACL은 `postgres`와 `service_role=r`뿐이다.
- `admin_kpis_behavior.sql`: 빈 DB에서 36건 모두 통과, 연구실 1개가 미리 있는 DB(Hosted 경로)에서 36건 통과·지표 값 18건 건너뜀. 로컬에는 pgTAP이 없어 같은 이름의 임시 대체 함수로 실행했다. 대체 함수는 실패가 하나라도 있거나 실행 수가 `plan`과 다르면 오류를 낸다. 기대값 하나를 일부러 틀리게 바꾼 사본은 실패하는 것을 확인했다. 실제 pgTAP 실행은 CI(`supabase test db`)가 처음이다.
- 테스트 데이터에는 "세면 안 되는 행"을 다른 기록이 없는 주·공간에 둔다(취소·v1 기록, 행위자 없는 감사 로그, 핵심이 아닌 감사 항목, 내부 직원의 개인 공간 기록, 내부 연구실로 표시된 고객 이벤트). 함수의 제외 조건을 하나씩 지운 변형 41개를 돌려 38개가 테스트에 걸리는 것을 확인했다. 걸리지 않는 3개는 서울 날짜 대신 UTC 날짜를 쓰는 변형(테스트 시각이 UTC 15~24시가 아니면 두 날짜가 같다), 마감일이 오늘인 요청의 경계, 4주 차 유지 기간을 앞당기는 변형이다.
- F1: migration 적용 전에 넣은 온보딩 행으로 확인했다. 문자열 검색어(`"  아세톤 "`)는 지워지고 `query_length: 3`이 남는다. 이미 `query_length`가 있는 행은 그 값을 유지한다. 문자열이 아닌 `query`(숫자, null)는 길이 없이 지워진다. `query`가 없는 행과 중첩된 `query`는 그대로다. `metadata`가 객체가 아닌 행(배열 `["query"]`, 문자열 `"query"`)은 건드리지 않는다. 브라우저가 어떤 jsonb든 넣을 수 있어서, 이 조건이 없으면 문자열 행 하나 때문에 migration 전체가 실패했다(`cannot delete from scalar`). 정리 블록을 다시 실행하면 0행이다.
- 같은 migration을 한 번 더 적용하면 첫 문장(`create table`)에서 실패하고 트랜잭션 전체가 롤백된다. 부분 적용은 생기지 않는다.
- 성능: 고정 데이터셋에서 함수 1회 실행이 약 10~15 ms였다. 합성 데이터(연구실 200, 사용자 600, 폐기 기록 6만, 감사 로그 15만, 검색 10만, 온보딩 2만, 구매 의도 2만 행)에서는 `p_days` 30이 약 2.8초, 7이 약 1.8초였다(같은 기계에서도 부하에 따라 0.5~3초로 달라진다). 현재 운영 데이터 규모(연구실 10곳 미만)는 고정 데이터셋과 비슷한 수준이다. 홈 요약이 2초를 넘거나 `audit_logs`가 100만 행을 넘으면 일별 집계표를 검토한다.

## 출시 순서

1. Staging DB에 migration을 적용하고 `supabase test db supabase/tests`를 실행한다. 기존 데이터가 있는 DB에서는 지표 값 확인 18건이 "건너뜀"으로 나오고, 권한·정리·제약 확인은 그대로 실행된다. 값 확인은 빈 DB를 쓰는 CI(Quality)에서 실행된다.
2. Hosted Security Advisor를 실행한다: `npm run security:supabase-advisors:hosted -- --environment staging`. 결과가 저장소 기준과 같은 73건(INFO 15 + WARN 58)이어야 한다. 늘었다면 적용을 멈추고 원인을 확인한다.
3. Staging 웹을 배포하고 운영 콘솔 홈을 연다. 처리할 일 건수를 센터 승인·개선 제안·후보 화면의 실제 건수와 대조한다. 내부 연구실을 등록한 뒤 지표에서 빠지는지 확인한다.
4. 운영 DB에 같은 migration을 적용하고 운영 Advisor(73건)를 확인한다.
5. 운영 승격 전 `WEB_DATABASE_REVIEWED_SHA`를 최종 main 후보 SHA로 설정하고, 같은 SHA의 Quality·staging 검증 성공을 확인한 뒤 운영 웹을 배포한다. 이 릴리스는 `supabase/migrations/`를 바꾸므로 이 값이 없으면 web release가 승격을 거부한다(`scripts/web-release.mjs`의 `assertPromotion`).

앱 동작만 보면 웹과 DB의 순서는 바꿔도 된다. 함수가 아직 없으면 API가 요약(summary·governance)은 그대로 돌려주고 `kpis: null`, `kpisError: "KPIS_UNAVAILABLE"`을 붙이며, 홈은 기존 요약 화면으로 돌아간다. 다만 운영 승격 절차는 DB 적용·검증을 먼저 요구한다(5번).

## 내부 연구실 관리

Supabase SQL Editor에서 데이터베이스 소유자 권한으로 실행한다. API나 앱에는 관리 화면이 없다.

```sql
-- 등록 (reason: internal | test | demo)
insert into private.analytics_internal_labs (lab_id, reason)
select id, 'internal' from public.labs where id = '<연구실 UUID>'
on conflict (lab_id) do update set reason = excluded.reason;

-- 확인
select i.lab_id, l.name, i.reason, i.added_at
from private.analytics_internal_labs i
join public.labs l on l.id = i.lab_id
order by i.added_at;

-- 해제
delete from private.analytics_internal_labs where lab_id = '<연구실 UUID>';
```

- 등록·해제는 다음 홈 새로고침부터 반영된다. 과거 값도 다시 계산되므로 추이가 함께 바뀐다.
- 목록 관리자는 운영 책임자 1명으로 정하고, 변경 사유를 운영 기록에 남긴다.
- 내부 사용자는 "지금 내부 연구실의 멤버인 사람"으로 계산한다. 직원이 내부 연구실에서 나가면 그 직원의 과거 활동이 다시 지표에 들어간다.
- 시험 연구실을 삭제하지 말고 목록에 남겨 둔다. 연구실을 삭제하면 목록 행과 멤버 행이 함께 지워지고, 그 연구실의 검색·온보딩·구매 의도·보관 경고 기록은 `lab_id`만 비워진 채 남는다(`on delete set null`). 그러면 그 기록이 개인 공간 기록처럼 다시 집계된다.

## 알려진 한계

- 조회만 한 사용은 활동으로 세지 않으므로 WAU·MAU는 실제보다 낮게 나온다.
- 탈퇴한 멤버의 행은 사라지므로 14일 활성화의 "두 번째 멤버"는 낮게 나올 수 있다.
- 기관명은 직접 입력이라 표기가 다르면 다른 기관으로 센다.
- 정정 사유는 화면의 선택 문구(`log_void_reason_*`)와 정확히 같을 때만 분류된다. 문구를 바꾸면 migration의 분류 목록도 함께 바꿔야 한다(`scripts/admin-kpis-allowlists.test.ts`와 앱의 `metricDefinitions.test.ts`가 이를 확인한다).
- 시험용 안전센터를 따로 뺄 목록은 없다. 시험 센터는 거절 상태로 두면 승인·활동 지표에서 빠진다. 내부 연구실에 보낸 요청만 있는 센터는 활동 센터로 세지 않는다.
- 계정을 삭제하면 삭제 Worker가 그 사용자의 감사 로그 행위자를 비운다(`ops11_deletion_worker`). 행위자가 없는 감사 행은 핵심 기록이 아니므로, 계정 삭제 뒤 과거 주간 기록 연구실 수가 줄어들 수 있다.
- 보관 경고 규칙을 앱에 새로 추가하면 migration의 규칙 ID 목록도 함께 바꿔야 상위 규칙에 이름이 나온다(`scripts/admin-kpis-allowlists.test.ts`가 이를 확인한다). 그전까지도 건수에는 들어간다.
- KPI 호출은 홈 요약 요청과 함께 기다린다. 함수가 느려지면 홈 요약도 함께 느려지고, 시간 초과는 `KPIS_FAILED`로 표시된다.

## 되돌리기

- 화면: 이전 웹으로 재배포하면 홈이 기존 요약만 쓴다. 새 웹을 유지한 채 함수만 없애도 홈은 기존 요약으로 돌아간다.
- DB: 함수와 내부 연구실 목록은 추가형이라 기존 경로에 영향이 없다. 필요하면 `drop function public.analytics_admin_kpis_v1(integer); drop function private.analytics_kpi_days_v1(integer); drop table private.analytics_internal_labs;`로 제거한다. 온보딩 검색어 정리는 되돌리지 않는다(원문을 다시 만들 수 없고, 다시 모아서도 안 된다). CHECK 확장은 되돌리면 앱 이벤트가 다시 버려지므로 유지한다.
