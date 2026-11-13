# 연구실 일상점검 출시 절차

상태: 저장소 준비 완료, Staging·운영 DB 미적용 (2026-11-13)

## 무엇이 바뀌나

- 기록 탭의 보기 전환(최근/보관/폐액통)에 "일상점검"이 추가된다. 연구실 공간에서만 보이고 개인 공간에는 없다.
- 연구실 멤버 누구나 오늘의 점검을 기록한다. 7개 구역 28개 항목마다 양호·불량·해당 없음을 고르고, 지시사항·특이사항(선택, 1,000자)을 남긴다.
- 모든 항목에 답해야 저장된다. "이 구역 해당 없음"과 "남은 항목 모두 양호"로 입력을 줄일 수 있다.
- 하루(한국 날짜)에 연구실당 1건이 남는다. 같은 날 다시 저장하면 그날 기록을 고치고, 마지막으로 저장한 사람이 점검자로 남는다.
- 최근 14일의 기록 여부(점검함·불량 있음·기록 없음)를 함께 보여 준다.
- 안전센터 대시보드 위에 연구실별 최근 30일 이행 현황(기록한 날, 불량이 있던 날, 마지막 기록일)이 표시된다. 연결이 승인 상태이고 공개 범위에 `summary`가 있는 연구실만 보인다. 항목별 결과와 메모는 센터에 전달되지 않는다.

## 점검 항목의 출처와 한계

- 항목은 `src/features/dailyInspection/checklist.ts`에 있다. 「연구실 안전점검 및 정밀안전진단에 관한 지침」 일상점검표의 구역(일반·기계기구·전기·화공·소방·가스·생물)과 항목 구성을 따라 작성했다.
- **문구는 고시 원문과 대조하지 않았다.** 플래그를 켜기 전에 현행 고시의 일상점검표와 항목·문구를 대조해야 한다.
- 항목을 추가·삭제하거나 뜻을 바꾸면 `CHECKLIST_VERSION`을 올린다. 저장된 결과는 항목 id로 기록되고 버전이 함께 남는다.
- 화면의 안내 문구는 이 기록이 법정 서식이나 보존 의무를 대신한다고 말하지 않는다. 기록의 법적 효력과 보존 기간은 기관 지침에 따라 확인해야 한다.

## 서버가 강제하는 규칙

`20261113100000_lab_daily_inspections.sql` (추가형, 새 테이블 1개)

- `lab_daily_inspections`: `(lab_id, inspection_date)` 유일. RLS로 연구실 멤버만 읽는다. `authenticated`는 SELECT만 가지고 쓰기는 RPC로만 한다. `anon`은 접근할 수 없다.
- `save_lab_daily_inspection_v1(lab_id, checklist_version, results, note)`: 연구실 멤버만(`DAILY_INSPECTION_ACCESS_DENIED`). 점검일은 서버가 한국 날짜로 정하고 불량 건수도 서버가 센다. 결과는 `항목 id → ok | bad | na`의 평평한 객체(1~80개)만 받는다(`DAILY_INSPECTION_INVALID_INPUT`). 과거 날짜는 기록할 수 없다.
- `get_safety_center_inspection_summary_v1(center_id, days)`: 승인된 센터의 구성원이고 연결이 승인 상태이며 범위에 `summary`가 있을 때만 행을 반환한다. 기간은 1~92일로 제한한다. 조건에 맞지 않으면 오류 없이 빈 결과다.
- 점검자 계정이 삭제되면 `inspected_by`가 null이 되고, 트리거가 저장된 점검자 이름도 함께 비운다. 점검 기록 자체는 남는다.
- 연구실이 삭제되면 그 연구실의 점검 기록도 삭제된다.
- 공개 테이블이 1개 늘어 `baseline_permissions.sql`의 기대 개수를 57/40/57로 갱신했다.

## 클라이언트

- 플래그 `VITE_ENABLE_DAILY_INSPECTION`(기본 `false`). Web release는 값이 없으면 `false`로 빌드하고 Staging 증거의 기능 프로필에 포함한다.
- **migration이 적용되지 않은 DB에 플래그를 켜면 점검 화면이 "불러오지 못했습니다"로 표시된다.** 다른 화면에는 영향이 없다. DB 적용 뒤에 켠다.

## 검증 범위 (2026-11-13)

- `src/features/dailyInspection/inspectionDatabase.test.ts`가 이 migration을 내장 PostgreSQL(PGlite)에서 실제로 실행한다. 의존 테이블은 최소 대역이다. 하루 1건 유지, 서버의 불량 집계, 잘못된 결과·버전·메모 거부, 직접 쓰기 거부, 다른 연구실·anon 거부, 센터 집계(기간, 범위, 다른 센터), 계정 삭제 시 이름 제거를 확인했다.
- pgTAP 테스트 `lab_daily_inspection_behavior.sql`(7건)은 작성 환경에 Docker가 없어 실행하지 못했다. 전체 스키마에서의 최초 실행은 PR의 `Blank database interface` 검사다.
- 화면은 렌더링 테스트로 확인했다. 실제 DB에 연결한 브라우저 확인은 하지 않았다.
- Staging·운영 DB에서는 실행하지 않았다.

## 출시 순서

1. 점검 항목과 문구를 현행 고시의 일상점검표와 대조한다.
2. PR의 `Blank database interface` 검사 통과를 확인한다.
3. Staging DB에 migration을 적용하고 `supabase test db supabase/tests`를 실행한다.
4. Hosted Security Advisor를 실행한다. `authenticated_security_definer_function_executable` WARN이 2건(위 public RPC 2개) 늘어야 한다. 검토 뒤 `supabase/security-advisors/*.json`과 `EXPECTED_COUNTS`를 실제 관측값으로 갱신한다. 이번 변경은 이 기준을 미리 고치지 않았다.
5. Staging 앱을 플래그 `true`로 빌드해 확인한다: 점검 기록 → 같은 날 수정 → 다른 멤버가 조회 → 개인 공간에서 탭 미표시 → 센터 대시보드의 이행 현황.
6. 운영 DB에 적용한 뒤 운영 플래그를 켠다.

## 되돌리기

- 즉시: 플래그를 `false`로 재배포하면 탭과 센터 패널이 사라진다. 테이블과 함수는 남아도 다른 흐름에 영향이 없다.
- DB를 되돌리면 점검 기록이 사라진다. 함수 2개, 트리거와 보조 함수, 테이블 순서로 제거하고 `baseline_permissions.sql`의 개수를 56/39/56으로 되돌린다.

## 열린 항목

- 불량 항목의 조치 완료 추적, 연구실책임자 확인(서명) 단계는 없다.
- 재고·시약장 경고를 점검 항목에 자동으로 반영하지 않는다.
- 미점검 알림(푸시·이메일)과 인쇄용 서식 출력은 없다. 알림과 보고서는 운영 문서의 금지 항목이다.
- 관리자 할 일 인박스에 미점검·불량 항목을 표시하지 않는다.
