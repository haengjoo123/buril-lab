# 부족 예상·구매 요청 출시 절차

상태: Staging·운영 DB 적용 완료, 플래그 꺼짐 (2026-11-13 UTC)

## 적용 기록

- Staging(이력 `20261113154125`)과 운영(이력 `20261113154209`)에 같은 SQL을 연달아 적용했다. 적용 전 두 환경의 이력은 `inventory_sds_documents`까지 같았다.
- 두 환경 모두 새 함수 7개(public 4·private 3)의 본문 해시와 권한이 일치한다. public RPC 4개는 `anon` 실행 불가, `authenticated`·`service_role` 실행 가능이다. private 함수는 클라이언트가 실행하지 못한다. 표는 RLS가 켜져 있고 정책은 0건이며, `anon`·`authenticated`는 직접 읽거나 쓰지 못한다.
- Staging에서 `inventory_purchase_requests_behavior.sql` 10건을 실행해 모두 통과했다. 끝에서 일부러 예외를 일으켜 전체를 롤백했고, 시험용 사용자·연구실·요청·감사 기록과 pgTAP 확장이 남지 않았음을 다시 조회해 확인했다. 운영에는 시험 데이터를 넣지 않았다.
- Hosted Security Advisor는 두 환경 모두 81 → 86건이다. 늘어난 것은 예상대로 `authenticated_security_definer_function_executable` WARN 4건(위 public RPC 4개)과 `rls_enabled_no_policy` INFO 1건(`inventory_purchase_requests`)뿐이다. `supabase/security-advisors/*.json`과 `EXPECTED_COUNTS`를 86으로 갱신했다. RPC 4건은 `temporary_open`(2026-12-31 만료, 다음 RPC 권한 재검토)이고, 표 1건은 서버 전용 기본 거부라 `accepted_design`이다.
- 남은 일: 아래 "켜는 순서" 4단계(플래그·배포)와 "확인할 것"의 계정별 확인.

플래그: `VITE_ENABLE_PURCHASE_REQUESTS` (기본 꺼짐)
DB: `supabase/migrations/20261115090000_inventory_purchase_requests.sql`

## 기능

- 재고 도구의 "부족·구매"에서 부족해 보이는 시약을 보여 준다. 같은 제품(CAS 번호, 없으면 제조사와 제품 번호, 없으면 이름)의 줄을 합쳐 계산한다.
  - 보유량: 미개봉 병은 한 병, 개봉한 병은 기록된 남은 양(%)만큼 센다.
  - 최근 180일 동안 다 쓴 병이 있으면 그 속도로 남은 일수를 추정한다. 30일 이하는 "부족", 60일 이하는 "곧 부족".
  - 사용 기록이 없으면 한 병만 남은 시약의 남은 양으로만 판단한다. 20% 이하는 "부족", 40% 이하는 "곧 부족".
  - 다 써서 재고에서 지운 줄은 사용 기록에 들어가지 않는다. 화면에 추정이라고 안내한다.
- 연구실 공간에서는 누구나 구매 요청을 보낼 수 있다. 부족 예상 줄에서 요청하면 이름·CAS·제조사·제품 번호·용량과 90일분 수량이 미리 채워진다. 같은 재고 줄로 이미 열린 요청이 있으면 새로 만들지 않는다.
- 연구실 관리자(`admin`)만 승인·반려하고, 승인한 요청을 주문함·입고됨으로 바꾼다. 요청자는 아직 처리되지 않은 자기 요청만 취소한다.
- 관리자 할 일 목록에 "구매 요청 N건 승인 대기" 카드(주황)가 생기고, 누르면 재고 화면의 요청 목록이 열린다.
- 입고됨으로 바꿔도 재고에 자동 등록하지 않는다. 화면에서 따로 등록하도록 안내한다.
- 개인 공간은 부족 예상만 보여 주고 구매 요청은 쓰지 않는다.

## DB

- 새 테이블 `inventory_purchase_requests` 하나. 클라이언트는 테이블을 직접 읽거나 쓰지 못하고 RPC만 쓴다.
- RPC: `create_inventory_purchase_request_v1`, `update_inventory_purchase_request_v1`, `list_inventory_purchase_requests_v1`, `get_inventory_usage_counts_v1`.
- 요청·상태 변경은 `audit_logs`에 남는다. 요청 사유와 관리자 메모는 감사 기록에 넣지 않는다.
- 연구실이 지워지면 요청도 지워진다. 계정이 지워지면 요청자·처리자 칸만 비고 요청은 남는다(이름은 저장하지 않고 읽을 때 계산한다).

## 켜는 순서

1. Staging과 운영에 migration을 **연달아** 적용한다. 한쪽만 적용하면 Staging 배포의 보안 점검(advisor) 개수가 맞지 않는다.
2. 두 환경의 advisor 결과로 `supabase/security-advisors/{staging,production}.json`과 `EXPECTED_COUNTS`를 갱신한다. 새 SECURITY DEFINER RPC 4개와 정책 없는 RLS 테이블 1개가 늘어날 것으로 예상한다.
3. Staging에서 pgTAP `supabase/tests/inventory_purchase_requests_behavior.sql`을 실행한다.
4. Staging 플래그를 켜고 확인한 뒤, 운영 플래그를 같은 값으로 켜고 운영 배포를 한다(운영 승격은 Staging과 플래그가 같아야 통과한다).

## 확인할 것

- 연구실 관리자·일반 구성원 계정으로 요청 → 승인 → 주문함 → 입고됨, 반려, 요청자 취소를 한 번씩 해 본다.
- 다른 연구실 계정으로는 요청 목록이 보이지 않는지 확인한다.
- 부족 예상 기준(30일·60일, 20%·40%, 180일)은 경험치다. 파일럿 연구실의 반응을 보고 조정한다.
