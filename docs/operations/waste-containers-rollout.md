# 폐액통 단위 기록·내용 기록표 출시 절차

상태: Staging·운영 DB 적용 및 검증 완료, 웹 배포 후보 준비 (2026-10-18)

## 2026-10-18 출시 검증

- 두 환경에 동일한 추가형 migration을 적용했다. 테스트는 트랜잭션을 롤백해 시험 데이터가 남지 않도록 실행했다.
- 두 환경 모두 폐액통 동작·권한 pgTAP 12건을 통과했다. 기존 활성 정책이 있는 환경도 검증하도록 테스트 payload가 실제 system policy ID를 참조하게 했다.
- 두 환경의 Security Advisor는 INFO 15 + WARN 58 = 73건이다. 직전 실제 카탈로그는 두 환경 모두 68건이었으며, 이번 변경으로 쓰기 RPC 5개만 늘었다. 저장소의 오래된 운영 관측값 60건도 실제 관측값으로 갱신했다.
- Advisor 전체 73건에 대해 카탈로그 메타데이터와 역할별 권한을 저장소 기준과 비교했다. 새 RPC는 anon 실행을 거부하고, 내부 scope 검사·잠금 순서·수거 관리자 제한·입고 트랜잭션을 검토했다. WARN은 다음 권한 감사까지 만료일이 있는 임시 검토 항목으로 유지한다.
- GitHub staging·production 환경 변수 `VITE_ENABLE_WASTE_CONTAINERS=true`를 설정했다. Web release의 빌드와 staging 증거에 이 플래그를 포함해 운영 승격 시 일치 여부를 검사한다.
- 운영 승격 전 `WEB_DATABASE_REVIEWED_SHA`는 최종 main 후보 SHA로 설정하고, 같은 SHA의 Quality 및 staging 검증 성공을 확인한다.

아래 2026-10-17 관측 및 출시 순서는 구현 당시의 기록이다.

## 무엇이 바뀌나

- 연구실이 실제 폐액통을 등록한다. 같은 분류의 통을 여러 개 둘 수 있다(`유기-1`, `유기-2`).
- 폐액통 입고(`container_deposit`, `ready`)를 저장할 때 어느 통에 넣었는지 함께 기록한다. 사용 중인 통이 하나면 자동 선택하고, 둘 이상이면 고를 때까지 저장 버튼이 잠긴다. 등록된 통이 없으면 지금과 똑같이 통 연결 없이 저장된다.
- 기록 → 폐액통 탭에서 통별 누적량·용량 대비 비율(80% 이상 경고)·담긴 성분·위험 특성·투입 기록을 본다.
- 통 상태: 사용 중 → 봉인 → 수거 완료. 봉인은 다시 사용으로 되돌릴 수 있다. 수거 완료는 되돌릴 수 없고, 연구실 관리자(개인 공간은 본인)만 기록할 수 있다.
- 내용 기록표 PDF(A5 한 장): 통 이름, 분류, 연구실, 위치, 시작·봉인일, 용량, 기록된 투입량, 성분(최대 12종), 위험 특성, 담당 연락처(정책의 handlerContact), 정책 금지사항과 기본 주의사항. "법정 지정폐기물 보관 표지를 대신하지 않는다"와 "기록하지 않은 투입은 포함되지 않는다"를 함께 인쇄한다.

## 서버가 강제하는 규칙

`20261017090000_waste_containers.sql`

- 쓰기는 RPC로만 한다: `create_waste_container_v1`, `update_waste_container_v1`, `set_waste_container_status_v1`, `record_waste_deposit_to_container_v1`, `record_inventory_disposal_to_container_v1`. 집계는 `get_waste_container_totals_v1`(SECURITY INVOKER, `waste_logs` RLS 적용)로 한다. `authenticated`는 테이블 SELECT만 가지고, `anon`은 테이블·함수 모두 접근할 수 없다.
- 기존 `record_waste_handling_v2`, `record_inventory_disposal_v2`는 변경하지 않았다. 래퍼가 기존 RPC를 호출한 뒤 같은 트랜잭션에서 통을 연결하므로, 통 검증이 실패하면 폐기 기록도 함께 롤백된다.
- 연결 조건: `ready` + `container_deposit`, 정정되지 않은 기록, 같은 연구실(개인 공간이면 같은 사용자), 같은 `stream_code`, 통이 `active`, 기록 시각이 통 시작 이후.
- 같은 `request_id` 재전송은 같은 통이면 멱등 처리하고, 다른 통이면 `WASTE_CONTAINER_ALREADY_RECORDED`(23505)로 거부한다. 클라이언트는 통을 바꿔도 같은 `request_id`를 유지하므로, 응답이 유실된 첫 시도가 있어도 폐기 기록이 두 번 생기지 않는다.
- 접근 확인 후에만 행 잠금을 건다. 외부 사용자는 잠금을 걸 수 없고, 없는 통과 권한 없는 통을 구분할 수 없다.
- 생성·수정·상태 변경은 `audit_logs`(`entity_type = 'waste_container'`)에 남고, 관리자 감사 로그 화면에 "폐액통"으로 표시된다.
- 이름: 앞뒤 공백을 제거하고 연속 공백을 하나로 합친다. 사용 중·봉인 상태에서는 같은 범위에 같은 이름(대소문자 무시)을 쓸 수 없다. 수거 완료 후에는 재사용할 수 있다.
- 삭제: 연구실 삭제 시 통도 삭제된다. 계정 삭제(`auth.admin.deleteUser`, hard delete) 시 개인 통은 Auth 삭제 단계에서 cascade로 삭제된다. 연구실 통의 `created_by`·`sealed_by`·`collected_by`는 null이 된다. 개인 통의 위치·수거 메모는 DB 정리 단계가 아니라 Auth 삭제 단계까지 남는다. 삭제 Worker의 DB 단계에 명시 삭제를 추가할지는 Ops 삭제 검토 때 결정한다.

## 검증 결과 (로컬, 2026-10-17)

- 운영 스키마(기준선 + 증분 13개)를 로컬 PostgreSQL에 재구성하고, Supabase 기본 권한(새 public 함수 EXECUTE → anon 포함)을 재현한 뒤 migration을 적용했다.
- `waste_containers_behavior.sql` 12건 통과. 실제 `record_waste_handling_v2`로 입고·멱등 재전송·다른 통 재전송 거부·분류 불일치 롤백·정정 기록 연결 거부·통 시작 전 기록 연결 거부·학생 수거 거부·봉인 후 입고 거부·감사 기록·타 연구실 거부를 확인했다.
- 기존 pgTAP 11개 파일의 결과는 변경 전과 같다. `baseline_permissions.sql`의 기대 개수만 54/37/54로 갱신했다.

## Supabase 실제 환경 확인 (커넥터, 읽기 전용)

- Staging·운영 모두 증분 migration 13개까지 적용되어 있고 `waste_containers`는 없다.
- public 테이블 53, authenticated 36, service_role 53. 이 migration 적용 후에는 54/37/54가 되어야 한다.
- Staging Security Advisor는 INFO 15 + WARN 53 = 68건으로 저장소 기준(`staging: 68`)과 일치한다.
- 운영에서 v2 폐액통 입고는 누적 1건(개인 공간), 최근 30일 0건이다. 연구실 폐액통 이름(override)을 설정한 연구실은 없다. 따라서 이관할 기존 데이터가 없다.

## 출시 순서

1. Staging DB에 migration을 적용하고 `supabase test db supabase/tests`를 실행한다.
2. Hosted Security Advisor를 실행한다. `authenticated_security_definer_function_executable` WARN이 정확히 5건(위 쓰기 RPC 5개) 늘어야 한다. 기대값은 Staging 68 → 73, 운영 60 → 65다. 각 함수가 내부에서 범위를 검사하는지 검토한 뒤 `supabase/security-advisors/*.json`과 `EXPECTED_COUNTS`에 사유와 함께 추가한다. 이번 변경은 이 기준을 미리 고치지 않았다.
3. Staging 앱을 `VITE_ENABLE_WASTE_CONTAINERS=true`로 빌드해 다음을 확인한다: 통 등록 → 장바구니에서 통 선택 후 입고 → 폐액통 탭의 누적량·성분 → 내용 기록표 PDF → 봉인 후 입고 거부 → 관리자 수거 완료.
4. 운영 DB에 적용한 뒤 운영 플래그를 켠다.

## 다른 출시와의 관계

캐비닛 출시는 완료됐으며, 현재는 일반 Web release 경로를 사용한다. DB의 migration 15개·pgTAP 12개를 검증하도록 현재 후보 기대값을 갱신했다. 개별 SQL 파일의 해시 검증과 전체 DB 테스트 실행은 유지한다.

## 되돌리기

- 즉시: `VITE_ENABLE_WASTE_CONTAINERS=false`로 재배포하면 화면에서 사라지고 기존 입고 흐름만 남는다.
- DB 변경은 추가형(새 테이블, nullable 컬럼, 새 함수)이라 기존 경로에 영향이 없다. 되돌릴 때는 플래그를 끈 상태에서 기록을 보존할지 먼저 정한다.
