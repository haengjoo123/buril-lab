# Ops9 계정·연구실 삭제 작업 기반 준비

상태: `productionReady: false`, `deletionIntakeEnabled: false`, `deletionWorkerReady: false`, `hostedSupabaseAcceptance: false`

이 문서는 운영 1~8의 관문이 실제로 닫힌 뒤에만 적용할 운영 9 후보를 설명합니다. 이번 준비에서는 실제 Supabase·Cloudflare 변경, 토큰 생성, Staging 배포, 운영 배포를 수행하지 않았습니다. 삭제 UI와 Scheduler는 계속 OFF입니다.

## 바뀌는 삭제 방식

기존 계정 삭제 API는 한 요청 안에서 여러 표, Storage 파일, Supabase Auth 사용자를 순서대로 지웠습니다. 중간 단계에서 실패하면 무엇이 지워졌고 무엇이 남았는지 안전하게 이어가기 어려웠습니다. 연구실 삭제도 브라우저가 `labs` 표를 직접 삭제했습니다.

Ops9 후보는 이 두 경로를 다음처럼 바꿉니다.

1. 브라우저는 매 요청마다 무작위 요청 ID를 하나 만들고 서버 API에 보냅니다.
2. 서버는 로그인 사용자를 Supabase Auth에서 다시 확인합니다.
3. 서비스 역할 전용 RPC가 같은 요청 또는 같은 대상의 진행 중 작업이 있는지 확인합니다.
4. 사진 경로와 소유 범위가 검증된 경우에만 작업표에 `pending`으로 접수합니다.
5. API는 HTTP 202와 작업 ID만 반환하며 그 자리에서 데이터·파일·인증을 지우지 않습니다.

현재 `DELETION_UI_ENABLED=false`이고 운영 KV의 `account_deletion_enabled=false`도 유지합니다. 따라서 준비 코드가 병합되더라도 사용자 화면에서 삭제 접수를 시작할 수 없습니다. 운영 11에서 Worker 예약 호출 3회와 장애 자동 OFF를 확인한 뒤 별도 변경으로만 UI를 켭니다.

## 작업표와 재시도

- `private.deletion_jobs_v1`은 `account`와 `lab` 작업만 받습니다.
- 상태는 `pending → running → retry_wait` 또는 `completed/failed`로 제한합니다.
- Worker는 한 번에 2분짜리 무작위 임대를 받으며 `FOR UPDATE SKIP LOCKED`로 동시 실행을 막습니다.
- 실패 이유는 `DB_RETRY` 같은 일반화된 코드만 저장합니다. 이메일, 연구실명, 시약명, 파일 경로, 토큰, 공급자 원문 오류는 저장하지 않습니다.
- 재시도는 15초부터 최대 1시간까지 늘어나며 12번째 실패에서 멈춥니다.
- 전체 완료는 `finalize` 단계에서만 기록할 수 있습니다. DB·Storage·Auth 중간 단계가 성공했다는 이유로 전체 작업을 완료 처리할 수 없습니다.
- 한 번 기록한 단계보다 앞 단계로 되돌릴 수 없습니다. 재시도 Worker는 이미 지난 파괴적 단계를 무심코 다시 실행할 수 없습니다.
- `private.deletion_job_events_v1`은 요청·임대·재시도·완료·실패 증거를 추가만 할 수 있습니다. 수정·삭제·비우기는 트리거가 거부합니다.

두 표 모두 `private` 스키마에 있고 RLS를 켠 뒤 `anon`, `authenticated`, `service_role`의 직접 표 권한을 모두 회수합니다. 서비스 역할도 검토된 `SECURITY DEFINER` RPC로만 접근합니다. 새 공개 표는 만들지 않습니다.

## 파일 소유권 확인

삭제 접수 전에 참조 중인 모든 시약장 사진이 Ops6의 검증된 메타데이터와 정확히 맞는지 확인합니다.

- 개인 시약장: `cabinet_id`, 개인 사용자, 경로, 미분리 상태가 모두 일치해야 합니다.
- 연구실 시약장: `cabinet_id`, 연구실, 경로, 미분리 상태가 모두 일치해야 합니다.
- 공개 `image_url`이 남아 있거나 메타데이터가 없거나 다른 소유 범위를 가리키면 `deletion_file_ownership_unverified`로 접수를 중단합니다.

이 확인은 “파일을 실제로 지웠다”는 뜻이 아닙니다. Ops11 Worker가 DB 관계형 작업, R2/Supabase Storage 본문, Auth 삭제를 단계별로 수행하기 전에 삭제 대상을 안전하게 묶을 수 있는지 확인하는 관문입니다.

## API 경계

- `POST /api/account/delete`: `{requestId}`만 받습니다.
- `POST /api/labs/delete`: `{requestId, labId}`만 받습니다.
- 본문은 2KB, Authorization 헤더는 8KB로 제한합니다.
- 외부 응답은 수동 redirect를 거부하고 Auth 256KB, RPC 16KB 상한과 전체 8초 종료시간을 적용합니다.
- 로그인 JWT는 Supabase Auth에서 다시 검증하고 익명 사용자와 미들웨어 사용자 불일치를 거부합니다.
- 응답은 `no-store`이며 DB 원문 오류나 비밀값을 외부로 보내지 않습니다.
- 런타임 설정이 누락·손상되거나 KV를 읽지 못하면 삭제 접수는 503으로 닫힙니다.

계정이 관리자인 연구실이 있으면 먼저 관리자 이전 또는 연구실 삭제가 필요합니다. 연구실 삭제는 해당 연구실 관리자만 접수할 수 있습니다. 동일 요청 ID와 동일 대상의 중복 접수는 기존 활성 작업을 반환합니다.

## 로컬 검증 결과

검토한 PostgreSQL 17.11 공식 Windows 바이너리로 서로 다른 빈 DB 두 곳을 구성해 기준선부터 Ops9까지 순서대로 적용했습니다. 합성 사용자와 연구실만 사용했으며 원격 호출은 0회였습니다.

- 빈 DB 설치 2회와 카탈로그 권한 검증 성공
- 일반 사용자 RPC 실행과 서비스 역할의 직접 표 접근 거부
- 계정·연구실 관리자 경계와 중복 접수 검증
- 동시 두 번째 임대 거부, 실패 후 재시도, 새 임대 토큰 확인
- 잘못된 임대와 중간 단계 전체 완료 거부
- 12회 상한에서 최종 실패 전환
- 이벤트 수정·삭제·TRUNCATE 거부
- 개인·연구실 사진 메타데이터 불일치 차단과 정확한 소유권 연결 후 접수 성공
- 임시 PostgreSQL 중지와 소유 임시 폴더 삭제 확인

이 결과는 `hostedSupabaseAcceptance: false`입니다. Staging의 실제 Security Advisor, 실제 파일 소유권, 실제 API 및 Worker 연동은 선행 관문을 건너뛰지 않고 별도로 확인해야 합니다.

## 적용 순서와 통과조건

1. 운영 8의 Staging·운영 적용과 7일 관찰이 끝났는지 확인합니다.
2. 같은 후보 SHA에서 빈 DB 두 번, pgTAP, 전체 앱 시험과 빌드를 다시 통과합니다.
3. Staging에 작업표와 API를 적용하되 KV 삭제 스위치와 UI는 OFF로 유지합니다.
4. 서비스 역할 전용 접수, 중복 요청, 권한 거부, 사진 소유권 차단, 재시도 상태 보존을 합성 데이터로 확인합니다.
5. Staging과 운영 Security Advisor가 승인된 exact 목록과 일치하고 새 경고가 0인지 확인합니다.
6. 직전 운영 묶음의 7일 관찰 뒤 운영에 적용하며 UI는 계속 OFF입니다.
7. 운영 10 역할·MFA와 운영 11 Worker가 각각 통과한 뒤에만 접수 UI를 켭니다.

되돌림은 작업표를 삭제하거나 하향 migration을 실행하지 않습니다. 문제가 생기면 KV에서 삭제 접수를 OFF로 유지하고 Worker와 UI를 켜지 않은 채 작업표를 보존합니다. 전진 수정 또는 백업 복구만 사용합니다.
