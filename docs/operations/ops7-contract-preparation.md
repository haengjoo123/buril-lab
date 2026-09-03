# Ops7 구 가입·감사 경로 Contract 준비

이 문서는 운영 7의 **로컬 준비물**입니다. 이 커밋은 권한 회수 승인이나 운영 적용을
뜻하지 않습니다. 운영 5에서 새 가입·감사 경로를 배포한 뒤 7일 연속으로 구 경로
호출이 0건이라는 익명 집계가 있어야만 Contract를 적용할 수 있습니다.

## 닫는 경로

- `public.join_lab(uuid,text,text)`의 모든 Data API 실행 권한
- `public.join_lab_with_password(uuid,uuid,text,text,text)`의 모든 실행 권한
- `public.insert_audit_log_rpc(...)`의 모든 실행 권한
- `anon`의 `audit_logs` 직접 접근 전체
- `authenticated`의 `audit_logs` 직접 INSERT·UPDATE·DELETE 및 그 밖의 쓰기 권한
- 연구실 구성원이 임의 감사행을 쓰게 하던 기존 INSERT 정책

함수 본문은 즉시 삭제하지 않습니다. 복구 정의와 이력 비교를 위해 남기되 어떤
Data API 역할도 실행할 수 없게 합니다. 테이블·열·함수 삭제는 이 Contract와 섞지
않습니다.

## 유지하는 경로

- `/api/labs/join`이 서비스 역할로 호출하는 `join_lab_server_v1`
- 인증 사용자가 호출하는 `record_cabinet_activity_v2`
- DB가 사용자·연구실·변경값을 직접 계산해 추가하는 도메인별 감사 기록
- 연구실 구성원의 RLS 범위 안 `audit_logs` 조회
- 계정 삭제 시 개인정보를 익명화할 서버 전용 테이블 권한

## 운영 적용 전 필수 증거

1. 운영 5의 새 앱과 서버 가입 경로가 7일 동안 안정적이어야 합니다.
2. Supabase 원문 로그를 저장소에 복사하지 않고, 구 함수별 호출 건수와 조회 기간만
   익명 집계해 각각 0건임을 확인합니다.
3. 현재 운영 SHA의 정적 검사에서 브라우저 코드의 `join_lab` 및
   `insert_audit_log_rpc` 호출이 0건이어야 합니다.
4. Staging에서 일반 회원의 세 구 RPC 실행과 감사표 직접 쓰기가 모두 거부되고,
   새 가입·안전한 활동 기록·감사 조회는 성공해야 합니다.
5. 그 증거와 정확한 migration SHA를 확인한 뒤에만
   `20260904030000_ops7_contract_legacy_join_audit.sql`을 적용합니다.

## 실패와 복구

- 새 가입 경로 장애 시 Contract를 적용하지 않고 기존 권한을 유지합니다.
- Contract 뒤 예상하지 못한 구 클라이언트가 발견되면 임의 하향 migration을 쓰지
  않습니다. 새 경로를 먼저 고치고, 정말 필요한 경우에만 종료시각과 사유가 있는
  별도 전진 migration으로 최소 권한을 한시 복구합니다.
- 감사 기록 쓰기 실패 시 민감 변경은 성공으로 처리하지 않습니다. 범용 감사 RPC를
  다시 여는 것으로 우회하지 않습니다.
- 실제 감사행, 사용자 식별자, 비밀번호, 토큰, 원문 DB 로그는 증거 문서나 Git에
  넣지 않습니다.

## 로컬 시험

다음 명령은 공식 PostgreSQL 17.11 실행 파일로 빈 DB 두 개를 만들고 기준선부터
Ops7까지 적용한 뒤 자체 임시 디렉터리를 제거합니다.

```powershell
node scripts/test-ops7-local-postgres.mjs `
  C:\Users\gudwn\.codex-tmp\postgresql-17.11-portable\pgsql\bin `
  C:\Users\gudwn\.codex-tmp\postgresql-17.11-1-windows-x64-binaries.zip
```

검증 범위는 구 가입·범용 감사 RPC 거부, 감사표 직접 위조·수정·삭제 거부, 새 서버
가입 성공, 안전한 활동·감사 기록 성공, 연구실 범위 감사 조회 유지입니다. 이 시험은
Hosted Supabase의 실제 로그·Auth·Data API 동작을 증명하지 않으므로 Staging 실제
권한시험이 별도로 필요합니다.

## 현재 판정

- `productionReady: false`
- `contractReady: false`
- 실제 Supabase·Cloudflare 변경: 0
- 필요한 선행조건: 운영 5 배포와 구 경로 7일 연속 0건
- 다음 실환경 단계: Staging 권한시험 → 익명 7일 증거 확인 → 별도 운영 Contract
