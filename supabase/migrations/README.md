# 활성 Supabase 마이그레이션

이 폴더는 Supabase CLI가 새 로컬 DB와 빈 Staging DB에 적용하는 활성 경로입니다.
Ops7 준비 시점의 활성 SQL은 다음 다섯 파일로 고정합니다. 빈 환경에서는 아래 순서로
재구성하지만, 운영에는 각 관문의 통과조건을 만족한 증분 파일만 순서대로 적용합니다.

- `20260824000000_production_baseline.sql`
- `20260903162850_ops5_expand_server_join.sql`
- `20260904020000_ops6_private_cabinet_photos_expand.sql`
- `20260904021000_ops6_private_cabinet_photos_switch.sql`
- `20260904030000_ops7_contract_legacy_join_audit.sql`

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
사진 전환, Ops7 Contract용 pgTAP 네 파일입니다. 기준선 전환 전의 절차형 SQL 검증문은 삭제하지
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

Ops5부터 Ops7까지의 뒤쪽 스키마 변경도 새 시각의 증분 migration으로만 추가합니다. 계정
삭제, 운영자 역할/MFA, SDS, 알림 migration은 아직 활성 경로에 포함하지 않습니다.
Ops6 Switch는 외부 복사 manifest와 해시 검증, 보존 원본, 접근 차단 시험을 모두
통과한 뒤에만 적용하며 Expand와 같은 운영 배포에 섞지 않습니다.
Ops7 Contract는 새 가입·감사 경로 배포 후 7일 동안 구 경로 호출이 0건이라는
운영 증거가 있을 때만 적용합니다.
