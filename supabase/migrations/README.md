# 활성 Supabase 마이그레이션

이 폴더는 Supabase CLI가 새 로컬 DB와 빈 Staging DB에 적용하는 활성 경로입니다.
Ops11 준비 시점의 활성 SQL은 다음 아홉 파일로 고정합니다. 빈 환경에서는 아래 순서로
재구성하지만, 운영에는 각 관문의 통과조건을 만족한 증분 파일만 순서대로 적용합니다.

- `20260824000000_production_baseline.sql`
- `20260903162850_ops5_expand_server_join.sql`
- `20260904020000_ops6_private_cabinet_photos_expand.sql`
- `20260904021000_ops6_private_cabinet_photos_switch.sql`
- `20260904030000_ops7_contract_legacy_join_audit.sql`
- `20260904040000_ops8_lab_password_policy.sql`
- `20260904050000_ops9_deletion_jobs.sql`
- `20260904060000_ops10_operator_roles_mfa.sql`
- `20260904070000_ops11_deletion_worker.sql`

## 절대 금지

이 기준선 SQL은 2026-08-24 운영 스키마를 빈 데이터베이스에 재현하기 위한
`pg_dump`입니다. 이미 같은 스키마와 데이터를 가진 기존 운영 DB에는 실행하지
않습니다. `supabase db reset --linked`, 기준선 `db push`, SQL Editor 붙여넣기 등
기준선 본문을 운영에 실행할 수 있는 명령은 모두 금지합니다.

운영에서는 복구 사본의 재구성과 핵심 흐름 검증을 끝낸 뒤, 스키마나 데이터를
변경하지 않고 `scripts/repair-production-migration-history.ps1`로 migration 적용
기록만 전환합니다. 항상 `plan`부터 실행하고, 검토된 89개 이력과 해시가 정확히
일치할 때만 별도 승인 후 `apply`를 실행합니다.

Repair 도구는 검토한 Supabase CLI `2.115.0`이 이미 설치되어 있을 때만
`npx --no-install`로 실행됩니다. 실행 중 최신 CLI를 자동 다운로드하지 않습니다.

`supabase test db`가 실행하는 활성 SQL 검사는 기준선, Ops5 Expand, Ops6 비공개
사진 전환, Ops7 Contract, Ops8 비밀번호 정책, Ops9 삭제 작업 기반, Ops10 운영자 역할·MFA,
Ops11 삭제 Worker용 pgTAP 여덟 파일입니다. 기준선 전환 전의 절차형 SQL 검증문은 삭제하지
않고 `supabase/legacy_tests`에 보관하며 활성 pgTAP 검사에 섞지 않습니다.

## 이력 전환과 복구

- `plan`: 원격 이력을 읽기만 하며 `legacy`, `transition`, `baseline` 중 정확한
  상태인지 확인합니다.
- `apply`: 정확한 확인문구가 있을 때 기준선 marker를 추가한 뒤 기존 89개 marker를
  `reverted` 상태로 바꿉니다. 기준선 SQL은 실행하지 않습니다.
- `restore-legacy`: 정확한 확인문구가 있을 때 89개 marker를 복구하고 기준선 marker를
  되돌립니다.

전환 전 증거는
`supabase/legacy_migrations/application-history-before-baseline.json`에 고정되어
있습니다. 전체 118행 snapshot과 그 안의 운영 remote version 89개는 각각 별도의
SHA-256으로 검증됩니다.

## 다음 변경

Ops5부터 Ops11까지의 뒤쪽 스키마 변경도 새 시각의 증분 migration으로만 추가합니다. SDS와
알림 migration은 아직 활성 경로에 포함하지 않습니다.
Ops6 Switch는 외부 복사 manifest와 해시 검증, 보존 원본, 접근 차단 시험을 모두
통과한 뒤에만 적용하며 Expand와 같은 운영 배포에 섞지 않습니다.
Ops7 Contract는 새 가입·감사 경로 배포 후 7일 동안 구 경로 호출이 0건이라는
운영 증거가 있을 때만 적용합니다.
Ops8은 Contract가 적용된 뒤 기존 비밀번호 해시를 보존한 채 교체 필요 표시만 추가하고,
새로 만들거나 바꾸는 연구실 비밀번호에만 12~128자 정책을 적용합니다.
Ops9은 삭제 UI와 Worker를 켜지 않고 서비스 전용 작업표·추가 전용 상태 기록·파일 소유권
확인 경로만 추가합니다. 실제 삭제 접수와 처리는 Ops11의 Scheduler 검증 전까지 OFF입니다.
Ops10은 서버 전용 `reader`, `approver`, `raw_exporter` 역할과 AAL2 확인, 월간 권한 검토,
추가 전용 운영자 감사를 추가합니다. 실제 운영자 역할 부여와 이메일 허용목록 제거는 선행
관문의 순차 적용과 Hosted Supabase 검증을 통과한 별도 운영 변경에서만 수행합니다.
Ops11은 삭제 파일 임시 목록, DB 기반 단일 실행 임대, 단계별 재개 RPC와 최대 12회 재시도를
추가합니다. 삭제 경로는 서비스 역할만 실행할 수 있고 파일 경로는 작업 완료 전에 제거됩니다.
Scheduler 배포, `maintenance_worker_enabled`, 삭제 접수와 UI는 선행 운영 관문과 Staging 합성시험,
예약 호출 3회 성공을 통과하기 전까지 계속 OFF입니다.

## 개인 실험 도구 (2026-11-09)

다음 두 증분 파일은 기존 기준선을 재실행하지 않고 Staging과 운영에 순서대로 적용합니다.

- `20261109011725_personal_lab_tools.sql`: 개인 문서, 수정 버전 비교 저장 RPC,
  소유자 RLS, 비공개 `tool-images` 저장소와 도구 피드백 출처.
- `20261109011747_tool_images_account_deletion.sql`: 기존 삭제 작업의 임대·재시도
  흐름을 유지하면서 개인 이미지 삭제 대상을 추가합니다.

새 테이블에 적용되는 운영 기본 권한도 명시적으로 회수합니다. 문서 쓰기는 인증된
소유자만 수정 버전을 비교하는 RPC를 통해 실행하고, 첨부파일은 소유권 RLS로 보호합니다.
`supabase/tests/personal_lab_tools_behavior.sql`의 30개 검사는 합성 계정과 데이터를
트랜잭션 안에서 생성한 뒤 롤백합니다. 두 환경 모두 2026-11-09에 30개 검사를 통과했습니다.
보안 Advisor에는 새 RPC의 인증 역할 실행 권한 한 건만 기존 검토 목록에 추가했습니다.

Hosted MCP가 생성한 두 신규 migration marker만 CLI 파일의 버전으로 맞췄습니다.
이전에 적용된 기준선과 legacy 이력은 변경하지 않았습니다.

웹 공개 시 두 GitHub 환경의 `VITE_ENABLE_LAB_TOOLS=true`를 맞추고 DB 확인을 마친
정확한 main 커밋을 `WEB_DATABASE_REVIEWED_SHA`에 기록합니다. 기존 Quality와 Staging
증거 검증을 통과한 동일 후보만 운영으로 승격합니다. 긴급 비공개 전환은 기능 플래그를
끄는 새 웹 배포로 처리하며 개인 문서·이미지 테이블을 삭제하지 않습니다.
