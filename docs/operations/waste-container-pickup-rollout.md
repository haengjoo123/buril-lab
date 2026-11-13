# 폐액통 수거 요청 출시 절차

상태: 저장소 준비 완료, Staging·운영 DB 미적용 (2026-11-13)

## 검증 범위 (2026-11-13)

- `src/features/wasteContainers/pickupDatabase.test.ts`가 기존 폐액통 migration과 이 migration을 내장 PostgreSQL(PGlite)에서 실제로 실행한다. 의존 테이블과 보조 함수는 최소 대역으로 대신했다. 요청·중복 요청·길이 초과·직접 UPDATE 거부, 취소 권한, 다른 연구실·anon 거부, 센터 조회(범위 있음/없음, 다른 센터, 연결 철회, 센터 미승인, 무효 기록 제외 합계), 봉인 유지, 수거 시 자동 해제, 감사 기록과 전달 사항 미저장을 확인했다.
- pgTAP 테스트 `waste_container_pickup_behavior.sql`은 작성 환경에 Docker가 없어 실행하지 못했다. 전체 스키마에서의 최초 실행은 PR의 `Blank database interface` 검사다.
- Staging·운영 DB에서는 실행하지 않았다.

## 무엇이 바뀌나

- 연구실 멤버 누구나 폐액통 상세에서 수거를 요청하고 전달 사항(선택, 500자)을 남긴다. 사용 중·봉인 상태 모두 요청할 수 있다.
- 요청은 요청한 사람이나 연구실 관리자(개인 공간은 본인)가 취소한다.
- 관리자 할 일 인박스에 요청된 통이 바로 표시된다. 요청된 통은 기존 "거의 가득 참"·"봉인 후 14일" 알림 대신 수거 요청 한 건으로 표시하고, 조치 버튼은 수거 완료다.
- 안전센터의 점검 요청 화면 위에 수거 대기 목록이 표시된다. 연결이 승인 상태이고 공개 범위에 `waste_management`(폐액 정책 관리)가 있는 연구실의 요청만 보인다. 센터는 읽기만 하고, 수거 완료는 연구실 관리자가 기록한다.
- 통을 수거 완료로 바꾸면 요청이 자동으로 지워진다.

## 서버가 강제하는 규칙

`20261113090000_waste_container_pickup_requests.sql` (추가형, 기존 함수는 바꾸지 않는다)

- `waste_containers`에 `pickup_requested_at`, `pickup_requested_by`, `pickup_request_note` 열을 추가한다. 수거 완료된 통은 요청을 가질 수 없다(CHECK).
- `waste_containers_clear_pickup_on_collect_v1` 트리거가 수거 완료 시 요청 열을 비운다. 그래서 기존 `set_waste_container_status_v1`은 그대로 동작한다.
- 쓰기는 RPC로만 한다. 모두 SECURITY DEFINER, `search_path = ''`이고 `anon`은 실행할 수 없다.
  - `request_waste_container_pickup_v1(container_id, note)`: 통의 범위에 속한 사용자만. 수거 완료된 통은 `WASTE_CONTAINER_COLLECTED`. 이미 요청된 통에 다시 요청하면 첫 요청을 유지한다.
  - `cancel_waste_container_pickup_v1(container_id)`: 요청자, 연구실 관리자, 개인 통의 소유자만. 그 외에는 `WASTE_CONTAINER_ADMIN_REQUIRED`.
  - `get_safety_center_waste_pickups_v1(center_id)`: 승인된 센터의 구성원이고, 연결이 승인 상태이며 범위에 `waste_management`가 있을 때만 행을 반환한다. 조건에 맞지 않으면 오류 없이 빈 결과다. 최대 500행.
- 감사 로그: 요청·취소를 `entity_type = 'waste_container'`, `action = 'update'`, `diff_data.pickup`으로 남긴다. 전달 사항(자유 입력)은 감사 행에 저장하지 않는다.
- 센터가 보는 값: 연구실 이름, 통 이름, 분류, 위치, 용량, 상태, 봉인 시각, 요청 시각, 전달 사항, 기록된 투입 건수·양. 요청자 정보는 반환하지 않는다.

## 클라이언트

- 플래그 `VITE_ENABLE_CONTAINER_PICKUP_REQUESTS`(기본 `false`, 폐액통 기능이 켜져 있어야 동작). Web release는 값이 없으면 `false`로 빌드하고 Staging 증거의 기능 프로필에 포함한다.
- **플래그가 켜진 빌드는 폐액통 조회에서 새 열을 읽는다.** migration이 적용되지 않은 DB에 켜면 폐액통 목록 조회가 실패한다. 반드시 DB 적용 뒤에 켠다.
- 플래그가 꺼져 있으면 조회 열, 관리자 인박스 입력, 화면이 이전과 같다.

## 출시 순서

1. PR의 `Blank database interface` 검사에서 migration과 `waste_container_pickup_behavior.sql`(12건) 통과를 확인한다.
2. Staging DB에 migration을 적용하고 `supabase test db supabase/tests`를 실행한다.
3. Hosted Security Advisor를 실행한다. `authenticated_security_definer_function_executable` WARN이 3건(위 public RPC 3개) 늘어야 한다. 각 함수의 범위 검사를 검토한 뒤 `supabase/security-advisors/*.json`과 `EXPECTED_COUNTS`를 실제 관측값으로 갱신한다. 이번 변경은 이 기준을 미리 고치지 않았다.
4. Staging 앱을 플래그 `true`로 빌드해 확인한다: 멤버 요청 → 관리자 인박스 표시 → 다른 멤버의 취소 거부 → 센터 화면 표시(`waste_management` 범위 있음/없음) → 수거 완료 후 요청 사라짐 → 감사 로그 표시.
5. 운영 DB에 적용한 뒤 운영 플래그를 켠다.

## 되돌리기

- 즉시: 플래그를 `false`로 재배포하면 화면과 새 열 조회가 사라진다. DB 열과 함수는 남아도 기존 흐름에 영향이 없다.
- DB를 되돌려야 하면 함수 3개와 트리거·트리거 함수, 인덱스, 제약, 열 순서로 제거한다. 진행 중인 요청 데이터는 사라진다.

## 열린 항목

- 센터가 수거 일정을 회신하거나 수거 완료를 직접 기록하는 흐름은 없다.
- 요청 알림(푸시·이메일)은 없다. 알림은 운영 문서의 금지 항목이다.
- 계정 삭제 시 `pickup_requested_by`는 null이 되고 요청 자체는 남는다.
