# Supabase 임시 복구 프로젝트 훈련 절차

상태: **절차만 준비됨 — 아직 실행하지 않음**

이 문서는 운영 DB를 바꾸지 않고 별도 임시 프로젝트에서 복구 가능성을 확인하기 위한 실행 체크리스트입니다. 체크박스가 비어 있으면 훈련 완료 증거가 아닙니다.

## 훈련 목표와 범위

- 같은 지역의 임시 Micro 프로젝트에 운영 DB의 논리 덤프를 복원합니다.
- 시작부터 로그인→연구실→재고→폐기 기록→사진 조회 확인까지 4시간 안에 끝나는지 측정합니다.
- 외부 메일, 예약 작업, 삭제 worker와 운영 API 연결은 처음부터 끝까지 끕니다.
- 임시 프로젝트는 생성 후 24시간 안에 삭제합니다.
- 저장소에는 시간, 익명 합계, 해시, 성공·실패 결과만 남깁니다. 백업 파일, 연결 문자열, 토큰, 사용자 정보는 남기지 않습니다.

Supabase의 자동 DB 백업은 Storage의 파일 본문을 포함하지 않고 파일 정보만 담습니다. 따라서 사진 본문은 DB 복구와 별도로 R2 백업에서 확인해야 합니다. 자세한 범위는 [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)를 기준으로 합니다.

이 Micro 훈련은 **덤프를 만든 현재 시점**의 복구 시험입니다. 과거 일일 백업 시점을 복구하는 시험은 아닙니다. 과거 백업을 새 프로젝트로 직접 복제하는 공식 기능은 원본 컴퓨팅 크기도 복제하므로, Micro와 1달러 상한을 만족하는지 별도 비용 확인이 필요합니다.

## 실행 전 중단 조건

다음 항목이 하나라도 충족되지 않으면 프로젝트를 만들거나 운영 DB를 읽지 않습니다.

- [ ] `eatple` 조직의 모든 현재 구성원이 BurilLab 운영 데이터를 볼 권한이 있다고 사용자가 확인함
- [ ] Supabase가 표시하는 프로젝트 비용 계약을 사용자가 명시적으로 확인함
- [ ] 같은 지역, Micro, 24시간 안에 삭제라는 조건을 확인함
- [ ] 생성 전 예상 Compute 비용이 1달러 이하임을 다시 확인함
- [ ] 운영의 가장 최근 사용 가능한 백업 시각과 일일 백업 상태를 확인함
- [ ] 작업자가 Supabase·GitHub·Cloudflare 계정 MFA를 사용함
- [ ] PowerShell 7, Supabase CLI `2.115.0`, Docker Desktop, 호환되는 `psql`이 실제로 실행됨
- [ ] 복구 파일을 둘 암호화된 로컬 임시 디렉터리의 절대경로와 작업 종료 시 안전하게 지울 방법을 준비함
- [ ] 임시 디렉터리의 정규화된 절대경로가 저장소·OneDrive·다른 동기화 폴더 아래가 아님
- [ ] 운영과 다른 Supabase 키, URL, 저장소, Redis, KV만 사용하도록 확인함
- [ ] 외부 메일·예약 작업·삭제 worker·웹훅을 켜지 않는다는 확인문구를 기록함
- [ ] 논리 덤프와 R2 파일을 같은 복구 시점으로 맞추기 위한 짧은 운영 쓰기·사진 업로드·삭제 중단 창을 별도로 승인받음
- [ ] 쓰기 중단 후 생성된 최근 시약장 파일의 완전한 R2 manifest와 실제 파일 본문이 존재함

비용 확인 API가 월 단위 금액을 표시하면 시간당 예상액보다 큰 그 표시값을 사용자에게 먼저 알립니다. 승인 전에는 `confirm_cost`나 프로젝트 생성 호출을 하지 않습니다.

## 1. 시작 증거

아래 값은 비밀이 아닌 형태로만 기록합니다.

| 항목 | 기록값 |
|---|---|
| 훈련 시작 시각(KST) | 미기록 |
| 일일 백업 상태·최근 시각(KST) | 미기록 |
| 논리 덤프 시작·종료 시각(KST) | 미기록 |
| 소스 지역 | 미기록 |
| 목표 지역·크기 | 미기록 / Micro |
| Supabase CLI | `2.115.0` |
| 실행자 승인 기록 | 미기록 |
| 예상 삭제 마감 시각(KST) | 미기록 |

## 2. 논리 백업 만들기

공식 절차는 역할, 구조, 데이터를 각각 덤프합니다. 명령 예시는 [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)를 따릅니다.

연결 문자열은 비밀번호가 없는 형태로 현재 PowerShell 프로세스의 `BURILLAB_SOURCE_DB_URL_NO_PASSWORD`에만 둡니다. 비밀번호는 마스킹 입력으로 받은 세션 한정 `PGPASSWORD`를 사용합니다. 비밀번호가 든 URL이나 `--password` 값이 프로세스 인자, 셸 기록, 파일, CI 로그에 들어가면 중단합니다. 실제 비밀값을 둔 상태에서는 `--debug`, `--dry-run`, verbose curl을 사용하지 않습니다. 훈련을 위해 운영 DB 비밀번호를 임의로 재설정하지 않으며, 현재 값을 안전하게 사용할 수 없으면 중단합니다.

`BURILLAB_RECOVERY_WORK_DIR`는 미리 검증한 암호화·비동기화 디렉터리의 절대경로여야 합니다. 아래 파일 경로를 상대경로로 바꾸거나 저장소에서 직접 만들지 않습니다.

```powershell
supabase db dump --db-url $env:BURILLAB_SOURCE_DB_URL_NO_PASSWORD -f "$env:BURILLAB_RECOVERY_WORK_DIR\roles.sql" --role-only
supabase db dump --db-url $env:BURILLAB_SOURCE_DB_URL_NO_PASSWORD -f "$env:BURILLAB_RECOVERY_WORK_DIR\schema.sql"
supabase db dump --db-url $env:BURILLAB_SOURCE_DB_URL_NO_PASSWORD -f "$env:BURILLAB_RECOVERY_WORK_DIR\data.sql" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes" -x "cron.job" -x "cron.job_run_details"
supabase db dump --db-url $env:BURILLAB_SOURCE_DB_URL_NO_PASSWORD -f "$env:BURILLAB_RECOVERY_WORK_DIR\history_schema.sql" --schema supabase_migrations
supabase db dump --db-url $env:BURILLAB_SOURCE_DB_URL_NO_PASSWORD -f "$env:BURILLAB_RECOVERY_WORK_DIR\history_data.sql" --use-copy --data-only --schema supabase_migrations
```

`data.sql`에 `auth.schema_migrations`, `storage.migrations`, `realtime.schema_migrations`, `cron.job`, `cron.job_run_details`를 쓰는 문장이 하나라도 있으면 복원에 사용하지 않고 원인을 확인합니다.

- [ ] 다섯 명령이 오류 없이 끝남
- [ ] 백업 파일 5개의 SHA-256과 바이트 수를 비공개 작업 기록에 남김
- [ ] 저장소나 클라우드 동기화 폴더에 백업 파일이 들어가지 않음
- [ ] 운영 핵심 표의 행 수와 재고·폐기 익명 합계를 별도로 기록함
- [ ] Vault 또는 별도 열 암호화를 사용하는지 확인함
- [ ] 활성 예약 작업 수와 비밀 없는 설정 해시를 별도 기록함
- [ ] 복원 직전에 5개 파일의 SHA-256을 다시 계산해 최초 값과 일치함

운영 DB 쓰기와 사진 업로드·삭제를 모두 중단하고 이미 시작된 요청까지 종료됐음을 확인합니다. 같은 중단 구간 안에서 R2 본문 복사와 완전한 manifest·해시 확정, 위 DB 덤프, 익명 합계 수집을 순서대로 끝냅니다. manifest 시각·DB 덤프 시각·해시·쓰기 중단 구간을 비공개 증거에 먼저 남긴 뒤에만 쓰기를 재개합니다. 이 구간 중 쓰기가 하나라도 발생했거나 R2 manifest가 완료 상태가 아니면 해당 스냅샷을 무효로 판정하고 복구훈련에 사용하지 않습니다.

Vault 또는 별도 열 암호화를 사용한다면 수동 논리 복구는 여기서 중단합니다. Supabase의 “새 프로젝트로 복원” 기능은 암호화 루트 키를 복사하지만, 수동 복구는 별도 키 절차가 필요합니다. 기능 범위는 [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)를 기준으로 다시 승인받습니다.

## 3. 임시 프로젝트 만들기와 봉쇄

- [ ] 사용자 비용 확인 ID를 받은 뒤에만 임시 프로젝트를 생성함
- [ ] 소스와 같은 지역이며 Micro인지 확인함
- [ ] 외부 메일 발송 설정을 연결하지 않음
- [ ] Edge Function, Cron, 웹훅, Realtime publication을 아직 켜지 않음
- [ ] 앱 URL·redirect URL에 운영 주소를 넣지 않음
- [ ] 운영 키·서비스 역할 키·JWT 비밀값을 복사하지 않음
- [ ] 임시 프로젝트 접근자를 다시 확인함
- [ ] 임시 프로젝트 ref를 운영·기존 Staging ref 금지 목록과 대조함

Supabase의 프로젝트 복제 기능은 DB와 Auth 사용자 자료를 복제할 수 있지만 Storage 파일, Edge Functions, Auth 설정·API 키, Realtime 설정, 확장 설정은 자동 복사하지 않습니다. 이번 Micro 훈련은 비용과 격리를 명확히 통제하기 위해 새 프로젝트에 논리 백업을 복원하는 방식으로 진행합니다.

2026-08-24에 Supabase 플러그인으로 이름과 명령문을 읽지 않고 확인한 운영 집계는 `pg_cron` 설치·활성 작업 3개, Vault secret 0개, `pg_net` 미설치, HTTP 호출 후보 trigger 0개입니다. 따라서 데이터 덤프에서 `cron.job`과 실행 이력 `cron.job_run_details`를 제외하고, 복구 프로젝트의 예약 작업은 0개인 상태로 검증합니다. 실제 운영 예약 작업의 재구성은 이 격리 훈련 범위가 아닙니다.

현재 `storage_backup_enabled=false`이므로 R2에 최근 완전 백업이 존재한다는 증거가 생기기 전에는 사진 조회를 포함한 복구훈련을 시작할 수 없습니다. 빈 R2 버킷이나 DB의 `storage.objects` 행은 파일 복구 증거가 아닙니다.

## 4. 복원

새 연결 문자열은 비밀번호 없는 형태로 현재 PowerShell 프로세스의 `BURILLAB_RECOVERY_DB_URL_NO_PASSWORD`에만 둡니다. URL 문자열이 다른지만 보지 않습니다. direct host의 `db.<project-ref>` 또는 pooler 사용자의 `postgres.<project-ref>`에서 source·target ref를 각각 추출해 다음을 모두 확인합니다.

- target ref가 프로젝트 생성 결과의 예상 임시 ref와 정확히 일치함
- target ref가 source 운영 ref와 다름
- target ref가 운영·기존 Staging ref 금지 목록 어디에도 없음
- Supabase Management API에서 target ref의 이름·지역·Micro 상태가 예상값과 일치함
- 실행자가 `RESTORE <target-ref>` 확인문구를 입력함

하나라도 확인할 수 없으면 `psql`을 실행하지 않습니다. target ref는 공개 문서에 기록하지 않고 비공개 작업 기록에만 둡니다.

먼저 운영에서 사용 중인 비기본 확장과 DB 웹훅을 목록으로만 대조합니다. 필요한 확장은 복원 전에 임시 프로젝트에 활성화하되, 외부 호출 웹훅은 켜지 않습니다.

CLI 기본 schema dump는 `auth`, `storage`와 확장 관리 스키마를 제외합니다. 공식 절차대로 source의 사용자 변경을 별도로 추출합니다. 저장소의 `supabase/config.toml`과 현재 기준선 migration만 `BURILLAB_RECOVERY_WORK_DIR` 안의 격리된 임시 Supabase 프로젝트로 복사하고, 원본 저장소에서 `link` 또는 `diff`를 실행하지 않습니다. `SUPABASE_ACCESS_TOKEN`과 source `PGPASSWORD`는 현재 프로세스에만 두고, `--password`는 사용하지 않습니다.

```powershell
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Push-Location "$env:BURILLAB_RECOVERY_WORK_DIR\source-diff-project"
try {
  supabase link --project-ref $env:BURILLAB_SOURCE_PROJECT_REF
  if ($LASTEXITCODE -ne 0) { throw "source project link failed" }
  supabase db diff --linked --schema auth,storage |
    Set-Content -LiteralPath "$env:BURILLAB_RECOVERY_WORK_DIR\auth-storage-changes.sql" -Encoding utf8NoBOM
  if ($LASTEXITCODE -ne 0) { throw "auth/storage diff failed" }
} finally {
  Pop-Location
}
```

Supabase의 [관리 스키마 SQL 제한](https://supabase.com/changelog/34270-restricting-access-on-auth-storage-and-realtime-schemas-on-april-21-2025)에 따라 `auth`·`storage`·`realtime`에 표·함수·인덱스를 만들거나 삭제하는 문장, 관리 migration 표를 쓰는 문장, API 역할의 권한을 회수하는 문장을 허용하지 않습니다. diff는 사용자가 추가한 trigger·RLS·정책과 Supabase가 허용한 관리 표로만 범위를 제한합니다.

`BURILLAB_SOURCE_PROJECT_REF`는 사전에 확인한 source ref와 정확히 일치해야 하며, `link`가 비밀번호를 물으면 마스킹된 상호작용 입력만 사용합니다. 결과 SQL은 외부 URL·비밀값·예약 실행·`DROP`·관리 객체의 `ALTER OWNER`·`PUBLIC` 권한을 사람이 검토합니다. 사용자가 추가한 trigger·RLS·정책으로 범위를 제한한 후 SHA-256을 고정하고, 검토하지 않은 diff나 파괴적 문장은 적용하지 않습니다. 추출 후 격리된 link 작업공간은 비공개 증거에 필요한 해시만 남기고 폐기합니다.

여기까지 source 읽기가 끝나면 `PGPASSWORD`, `SUPABASE_ACCESS_TOKEN`, source URL·ref 환경 변수를 현재 프로세스에서 지웁니다. 파일 6개의 해시를 다시 확인한 뒤에만 서로 다른 target 비밀번호를 `PGPASSWORD`에 새로 설정합니다. source 비밀번호로 target 연결을 재시도하지 않습니다.

```powershell
psql --single-transaction --variable ON_ERROR_STOP=1 --file "$env:BURILLAB_RECOVERY_WORK_DIR\roles.sql" --command "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated" --file "$env:BURILLAB_RECOVERY_WORK_DIR\schema.sql" --command "SET session_replication_role = replica" --file "$env:BURILLAB_RECOVERY_WORK_DIR\data.sql" --command "SET session_replication_role = origin" --file "$env:BURILLAB_RECOVERY_WORK_DIR\history_schema.sql" --file "$env:BURILLAB_RECOVERY_WORK_DIR\history_data.sql" --file "$env:BURILLAB_RECOVERY_WORK_DIR\auth-storage-changes.sql" --dbname $env:BURILLAB_RECOVERY_DB_URL_NO_PASSWORD
```

공식 문제 해결에 따라 `roles.sql`이나 `schema.sql`을 수정해야 하면 원본을 보존하고 수정 diff를 사람이 검토한 뒤 6개 파일의 해시를 새로 고정합니다. 부분 재실행은 금지합니다. 전체 트랜잭션의 rollback과 target이 최초 상태임을 증명하면 재승인 후 같은 target에서 전체 복원을 처음부터 다시 실행할 수 있습니다. 이를 증명할 수 없으면 새 target 생성·비용을 다시 승인받습니다. custom login role의 새 비밀번호도 SQL 문자열·명령행·로그에 넣지 않는 마스킹 절차로만 설정합니다.

- [ ] 한 트랜잭션으로 복원이 끝남
- [ ] 오류를 무시하거나 일부만 수동 재실행하지 않음
- [ ] custom login role이 있다면 새 비밀번호를 별도 설정함
- [ ] 새 표가 target의 넓은 기본 권한을 상속하지 않도록 공식 사전 REVOKE가 같은 트랜잭션에서 실행됨
- [ ] 검토·해시 고정한 `auth-storage-changes.sql`이 같은 트랜잭션에서 적용됨
- [ ] 일반 데이터 적재 직후 `session_replication_role`이 `origin`으로 돌아온 뒤 migration 이력과 `auth`·`storage` DDL이 적용됨
- [ ] `auth`·`storage`의 사용자 trigger/RLS·정책이 source와 일치함
- [ ] `supabase_migrations`의 이력 수와 해시가 source와 일치함
- [ ] 외부 publication·웹훅·스케줄은 계속 OFF임
- [ ] `cron.job`의 활성 작업이 0개임

복원이 실패하면 운영 DB에는 아무 조치도 하지 않습니다. 임시 프로젝트를 새로 만들기 전에 실패 원인, 경과 시간, 비용을 기록하고 재승인을 받습니다.

## 5. DB와 파일 검증

- [ ] 운영과 복구 프로젝트의 핵심 표 행 수가 일치함
- [ ] 재고 합계와 폐기 기록 합계가 일치함
- [ ] 공개 스키마의 표·함수·정책·인덱스 차이를 확인함
- [ ] RLS·GRANT 역할 시험이 통과함
- [ ] Supabase Security Advisor 결과가 승인된 정확한 목록과 일치함
- [ ] 운영 Storage 객체 본문은 DB 백업으로 복원되지 않았음을 확인함
- [ ] 비공개 R2 백업의 사진 manifest에서 표본 파일의 경로·크기·SHA-256을 확인함
- [ ] 표본 사진을 임시 비공개 경로에 복원하고 다른 연구실 접근이 거부됨

사진 전체를 임시 Supabase Storage로 복사해야 할 때는 별도 승인과 전용 이관 도구를 사용합니다. 서비스 역할 키를 코드나 로그에 넣지 않습니다. 최근 완전 R2 manifest가 없거나 표본 해시가 다르면 이 훈련은 실패입니다.

## 6. 격리된 앱 흐름 확인

합성 계정 또는 승인된 복구 확인 계정만 사용합니다.

- [ ] Staging 웹이 임시 Supabase만 가리킴
- [ ] 운영 Supabase·KV·Redis·R2 참조가 0건임
- [ ] 로그인 성공
- [ ] 기존 Auth 계정 로그인과 새 검증 계정 로그인을 각각 확인함
- [ ] 연구실 선택 성공
- [ ] 재고 조회 성공
- [ ] 폐액 기록 조회 성공
- [ ] 직접 링크 조회 성공
- [ ] 권한 있는 회원의 사진 조회 성공
- [ ] 다른 연구실의 사진 조회 거부
- [ ] 메일·예약 작업·삭제·외부 쓰기 0건
- [ ] 전체 경과 시간이 4시간 이내임

## 7. 종료와 삭제

- [ ] 익명 합계, 해시, 시작·종료 시각, 결과만 공개 가능한 증거 파일에 옮김
- [ ] 공개 증거와 로그에 사용자 정보·파일 경로·비밀값이 없는지 확인함(백업 원문은 사용자 정보가 든 민감 자료로 간주)
- [ ] 임시 프로젝트 삭제에 대한 별도 확인문구를 받음
- [ ] 정확한 임시 프로젝트 ID를 재확인함
- [ ] 임시 프로젝트를 생성 후 24시간 안에 삭제함
- [ ] 삭제 완료 시각과 과금 종료를 확인함
- [ ] 로컬 백업 파일과 연결 문자열을 지우고 임시 암호화 볼륨·키를 폐기함(단순 파일 삭제를 복구 불가능한 안전 삭제로 주장하지 않음)
- [ ] PowerShell 환경 변수와 셸 기록에서 비밀값을 제거함

## 통과 판정

다음을 모두 만족해야 “준비 2 복구훈련 완료”로 표시합니다.

- 복구 시간이 4시간 이내
- 핵심 행 수와 합계 불일치 0
- 로그인부터 사진 조회까지 성공
- 연구실 간 자료 노출 0
- 외부 메일·예약 작업·삭제 실행 0
- 임시 프로젝트 24시간 내 삭제
- 저장소에 백업·비밀값·사용자 정보 0

일일 백업을 유지하는 동안 최근 복구 지점은 최대 약 24시간 전일 수 있으므로, 이 훈련이 통과해도 RPO 1시간 관문은 닫지 않습니다.
