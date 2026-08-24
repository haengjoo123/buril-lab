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

- [x] 2026-08-24 23:32 KST 기준 대상 Supabase 조직의 현재 구성원 1명, 역할 `Owner`, 권한 범위 `organization-scoped`를 읽기 전용으로 확인했고 사용자가 해당 구성원의 BurilLab 운영 데이터 열람 권한을 명시 확인함; 공개 문서에 이메일·조직 ID 미기록
- [ ] Supabase가 표시하는 프로젝트 비용 계약을 사용자가 명시적으로 확인하고 별도 확인 ID를 발급함
- [ ] 같은 지역, Micro, 24시간 안에 삭제라는 조건을 확인함
- [ ] 생성 전 예상 Compute 비용이 1달러 이하임을 다시 확인함
- [ ] 운영의 가장 최근 사용 가능한 백업 시각과 일일 백업 상태를 확인함
- [ ] 작업자가 Supabase·GitHub·Cloudflare 계정 MFA를 사용함
- [ ] PowerShell 7, Supabase CLI `2.115.0`, Docker Desktop 서버, 공식 portable PostgreSQL `17.11`의 `pg_dump`·`pg_restore`·`psql`이 실제로 실행됨
- [ ] 공식 portable PostgreSQL 원본 압축파일의 실제 SHA-256이 `6EABDF00D2893713B75DB4336A23C3FDF505F056E217EC6E2E95D901750CFEA3`과 일치함
- [ ] 복구 파일을 둘 BitLocker 보호 로컬 디렉터리 또는 EFS가 적용된 정확한 로컬 디렉터리의 절대경로와 작업 종료 시 안전하게 지울 방법을 준비함
- [ ] EFS를 사용하면 작업 디렉터리 바로 아래 새 확인 파일에도 `Encrypted` 속성이 상속됐음을 읽기 전용으로 다시 확인함
- [ ] 임시 디렉터리의 정규화된 절대경로가 저장소·OneDrive·다른 동기화 폴더 아래가 아님
- [ ] 운영과 다른 Supabase 키, URL, 저장소, Redis, KV만 사용하도록 확인함
- [ ] 외부 메일·예약 작업·삭제 worker·웹훅을 켜지 않는다는 확인문구를 기록함
- [ ] 논리 덤프와 R2 파일을 같은 복구 시점으로 맞추기 위한 짧은 운영 쓰기·사진 업로드·삭제 중단 창을 별도로 승인받음
- [ ] 최근 시약장 파일의 R2 `latest → complete → manifest → manifest.sha256` 연결과 실제 파일 본문이 존재함
- [ ] 아래 읽기 전용 자동 사전점검이 통과함

조직 접근자 확인은 시점 증거입니다. 임시 프로젝트 생성 직전에 구성원 수·역할·권한 범위가 그대로인지 읽기 전용으로 다시 확인하고, 달라졌으면 이 항목을 다시 미완료로 돌린 뒤 프로젝트 생성과 운영 DB 읽기를 중단합니다.

비용 확인 API가 월 단위 금액을 표시하면 시간당 예상액보다 큰 그 표시값을 사용자에게 먼저 알립니다. 승인 전에는 `confirm_cost`나 프로젝트 생성 호출을 하지 않습니다.

### 2026-08-25 읽기 전용 확인 현황

다음은 준비 상태를 파악하기 위한 시점 정보이며, 빈 체크박스를 닫거나 복구훈련 완료를 뜻하지 않습니다.

- 운영 프로젝트는 `ACTIVE_HEALTHY`, 지역 `us-east-2`, PostgreSQL `17.6`으로 확인됨
- 일일 백업이 켜져 있고 2026-08-24 08:40:29 UTC가 가장 최근이며 8개 복구 지점이 보임; Storage 파일 본문은 포함되지 않음
- 프로젝트 생성 비용 화면/API의 월 표시액은 10달러였지만 사용자 비용 확인 ID는 아직 없음
- 로컬 PowerShell `7.6.4`, Supabase CLI `2.115.0`, 공식 portable PostgreSQL `17.11`의 세 도구와 원본 압축파일 해시는 확인됨; Docker Desktop 서버는 아직 실행할 수 없음
- 비관리자 세션에서는 BitLocker 상태 조회가 불가능했지만, 사용자 경로를 공개 문서에 남기지 않은 별도 로컬 작업 디렉터리에 EFS와 새 파일 암호화 상속이 확인됨
- 최근 production R2 `complete` manifest 증거가 아직 없음

따라서 현재는 자동 사전점검이 의도대로 실패해야 합니다. 비용 확인 ID, Docker 서버, target 프로젝트 메타데이터, R2 완료 증거가 모두 생기기 전에는 프로젝트 생성 이후의 운영 DB 읽기나 덤프 단계로 넘어가지 않습니다.

## 0. 읽기 전용 자동 사전점검

`scripts/verify-supabase-recovery-preflight.mjs`는 Supabase Management API의 고정된 `GET` 3개와 로컬 자료만 확인합니다. DB 행, Storage 원격 본문, 비밀값 API는 읽지 않습니다.

- source와 기존 Staging ref를 `scripts/write-release-manifest.mjs`의 운영 환경 상수에서만 가져오고 target이 둘과 다른지
- Management API의 실시간 project 응답에서 source·target이 `ACTIVE_HEALTHY`, 고정 기대 지역 `us-east-2`, 같은 지역인지
- 실시간 billing addons 응답에서 target이 정확히 `ci_micro`이고 월 표시액이 정확히 10달러인지
- JSON이나 명령행이 아닌 별도 환경값으로 사용자 비용 확인 ID·시각·확인문구가 전달됐는지
- Micro 시간당 0.01344달러 × 월 환산 744시간이 10달러 표시와 반올림 기준으로 일치하고, 24시간 예상액 0.32256달러가 1달러 상한보다 작은지
- 일일 DB 백업이 켜져 있고 Storage 본문이 제외된다는 사실을 기록했는지
- 작업 디렉터리가 실행 시 지정한 승인 루트의 하위 폴더이고, 그 승인 루트가 Windows `TEMP`·`TMP` 또는 현재 `USERPROFILE` 아래 `.codex-tmp`와 정확히 같은지
- 작업 디렉터리가 저장소·OneDrive·Dropbox·Box·Google Drive·iCloud·Windows SyncRootManager의 알려진 동기화 루트 밖이며 상위 경로에 reparse point가 없는지
- BitLocker를 쓰면 실제 볼륨 상태가 `protected`인지, EFS를 쓰면 정확한 작업 디렉터리와 그 바로 아래 확인 파일이 모두 실제 `Encrypted` 상태인지
- PowerShell 7+, Supabase CLI `2.115.0`, 실행 중인 Docker Desktop 서버, 실행 시 지정한 같은 `bin` 폴더의 `pg_dump`·`pg_restore`·`psql`이 모두 정확히 `17.11`인지
- 실행 시 지정한 공식 portable PostgreSQL 원본 압축파일을 직접 해시해 고정 SHA-256과 일치하는지
- 메일·예약 작업·삭제 worker·웹훅·외부 API·Realtime publication·maintenance worker가 모두 명시적으로 `false`인지
- production R2의 `control/latest.json`, `complete.json`, `manifest.json`, `manifest.sha256`가 같은 snapshot·환경·해시·분류별 개수·바이트 합계로 이어지고 26시간 이내인지
- DB 참조 파일은 `snapshots/<snapshot-id>/objects/`, 미참조 파일은 `snapshots/<snapshot-id>/quarantine/unreferenced/` 아래에만 있고 manifest의 모든 body가 실제 파일로 존재하며 각 크기·SHA-256이 일치하는지
- `objectCount = referencedObjectCount + orphanCount`인지, 분류되지 않은 누락·중복·추가 파일이 0개인지, 기본 복구 대상 수가 `referencedObjectCount`로만 고정됐는지

이 도구는 프로젝트 생성·삭제, 원격 DB 행 조회, `db dump`, 복원, R2 원격 조회나 배포 명령을 가지고 있지 않습니다. Management API는 source project, target project, target billing addons만 `GET`합니다. 검사 입력과 body 파일은 모두 실제 암호화 상태를 확인한 작업 디렉터리 안의 일반 파일이어야 하며, 비밀번호·토큰·서비스 역할 키처럼 보이는 JSON 필드가 있으면 거부합니다.

필수 로컬 증거 JSON schema는 `3`이며 다음 항목만 정확히 가집니다. source·target·비용·확인 ID·도구 경로는 이 JSON에 넣을 수 없습니다.

| 묶음 | 필수 내용 |
|---|---|
| `databaseBackup` | `dailyEnabled=true`, 최근 확인·백업 시각, 보이는 복구 지점 수, `storageBodiesIncluded=false` |
| `workDirectory` | 승인 루트 아래 절대경로, `encryptionProvider=bitlocker|efs`, 최근 확인 시각 |
| `isolation` | 모든 `*Enabled=false`, target ref를 포함한 정확한 `confirmation` |
| `r2` | `environment=production`, `storageBucket=cabinets`, `maxSnapshotAgeHours=26` |

비용 확인 ID·시각·문구는 로컬 JSON과 명령행 옵션으로 받지 않습니다. Supabase `get_cost`와 사용자 승인 흐름이 별도로 전달한 세 환경값 `BURILLAB_RECOVERY_GET_COST_CONFIRMATION_ID`, `BURILLAB_RECOVERY_GET_COST_CONFIRMED_AT`, `BURILLAB_RECOVERY_GET_COST_CONFIRMATION`이 모두 있어야 합니다. 문구는 아래 값과 정확히 같아야 합니다.

```text
CONFIRM RECOVERY COST <confirmation-id> DISPLAY_USD_10 EXPECTED_24H_COMPUTE_USD_0.32256 COMPUTE_CAP_USD_1 DELETE_WITHIN_24H
```

격리 확인문구는 target ref가 정해진 뒤 아래 형식으로 기록합니다.

```text
CONFIRM RECOVERY ISOLATION <target-ref> ALL_EXTERNAL_CALLS_AND_SCHEDULERS_OFF
```

R2 Worker가 내려놓는 로컬 증거는 원격 키 구조를 그대로 유지합니다. `latest`는 `complete`를, `complete`는 `manifest`와 그 원문 SHA-256을 가리켜야 합니다. body root는 정확히 `snapshots/<snapshot-id>/`여야 합니다. 참조된 파일은 `classification=referenced`와 `ownerScope=lab|user`를 가지며 `objects/`에 있어야 합니다. DB에서 참조되지 않은 파일은 `classification=unreferenced`이고 `ownerScope`가 없어야 하며 `quarantine/unreferenced/`에만 보존합니다. 도구는 두 트리의 실제 파일을 전부 열어 크기와 SHA-256을 다시 계산하며 `complete` 없음, 참조 파일 수 0, 분류별 개수 불일치, 누락, 중복, manifest에 없는 추가 body, symlink·junction·reparse alias 중 하나라도 있으면 실패합니다.

격리 파일까지 해시를 확인하는 것은 그 파일의 복구를 승인한다는 뜻이 아닙니다. 이 사전점검은 어떤 파일도 복구하지 않으며 기본 복구 대상 수는 항상 `referencedObjectCount`입니다. `quarantine/unreferenced/` 파일을 실제로 복구하는 기능이나 옵션은 제공하지 않고, 필요하면 별도 검토와 승인을 거친 전용 절차를 사용합니다.

```powershell
npm run ops:recovery-preflight -- `
  --evidence "$env:BURILLAB_RECOVERY_WORK_DIR\preflight.json" `
  --target-ref $env:BURILLAB_RECOVERY_PROJECT_REF `
  --allowed-work-root $env:BURILLAB_RECOVERY_ALLOWED_WORK_ROOT `
  --pg-archive-path $env:BURILLAB_RECOVERY_PG_ARCHIVE `
  --pg-dump-path $env:BURILLAB_RECOVERY_PG_DUMP `
  --pg-restore-path $env:BURILLAB_RECOVERY_PG_RESTORE `
  --psql-path $env:BURILLAB_RECOVERY_PSQL `
  --efs-probe-file $env:BURILLAB_RECOVERY_EFS_PROBE_FILE `
  --r2-latest "$env:BURILLAB_RECOVERY_WORK_DIR\r2\control\latest.json" `
  --r2-complete "$env:BURILLAB_RECOVERY_WORK_DIR\r2\snapshots\$env:BURILLAB_R2_SNAPSHOT_ID\complete.json" `
  --r2-manifest "$env:BURILLAB_RECOVERY_WORK_DIR\r2\snapshots\$env:BURILLAB_R2_SNAPSHOT_ID\manifest.json" `
  --r2-manifest-sha256 "$env:BURILLAB_RECOVERY_WORK_DIR\r2\snapshots\$env:BURILLAB_R2_SNAPSHOT_ID\manifest.sha256" `
  --r2-body-root "$env:BURILLAB_RECOVERY_WORK_DIR\r2\snapshots\$env:BURILLAB_R2_SNAPSHOT_ID"
```

`--efs-probe-file`은 `encryptionProvider=efs`일 때만 사용하고, 정확한 작업 디렉터리 바로 아래에 외부 절차가 미리 만든 상속 확인 파일을 지정합니다. BitLocker를 쓰면 이 옵션을 넣지 않습니다. 승인 루트·도구·압축파일·EFS 확인 파일의 절대경로는 실행 환경에서만 전달하며 저장소나 공개 증거에 기록하지 않습니다.

Management API token과 비용 승인 환경값은 현재 PowerShell 프로세스에서만 설정하고 실행 직후 지웁니다. 성공 출력에는 경로·ref·확인 ID·원본 manifest·body 내용을 넣지 않습니다. 실패 메시지는 어떤 조건이 닫히지 않았는지만 알리고 비밀값, 파일 경로, 원본 자료를 출력하지 않습니다.

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
& $env:BURILLAB_RECOVERY_PSQL --single-transaction --variable ON_ERROR_STOP=1 --file "$env:BURILLAB_RECOVERY_WORK_DIR\roles.sql" --command "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated" --file "$env:BURILLAB_RECOVERY_WORK_DIR\schema.sql" --command "SET session_replication_role = replica" --file "$env:BURILLAB_RECOVERY_WORK_DIR\data.sql" --command "SET session_replication_role = origin" --file "$env:BURILLAB_RECOVERY_WORK_DIR\history_schema.sql" --file "$env:BURILLAB_RECOVERY_WORK_DIR\history_data.sql" --file "$env:BURILLAB_RECOVERY_WORK_DIR\auth-storage-changes.sql" --dbname $env:BURILLAB_RECOVERY_DB_URL_NO_PASSWORD
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
