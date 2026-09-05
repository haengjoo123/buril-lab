# Ops 8~11 가속 적용 증거 — 2026-09-05

이 문서는 사용자가 승인한 위험도 기반 가속 정책에 따라 운영과 별도 Web Staging에
적용한 Ops 8~11 데이터베이스 경계와, 아직 활성화하지 않은 런타임 경계를 구분해
기록합니다. 원문 로그, 사용자 정보, 토큰, 비밀번호, 파일 본문은 포함하지 않습니다.

## 적용 결과

운영 Supabase에는 다음 이력이 순서대로 존재합니다.

- `20260905044938 ops8_lab_password_policy`
- `20260905045338 ops9_deletion_jobs`
- `20260905045557 ops10_operator_roles_mfa`
- `20260905045821 ops11_deletion_worker`

별도 Web Staging은 운영보다 뒤처져 있던 Ops 6 Switch부터 같은 순서로 보완했습니다.

- `20260905050725 ops6_private_cabinet_photos_switch`
- `20260905050730 ops7_contract_legacy_join_audit`
- `20260905050736 ops8_lab_password_policy`
- `20260905050742 ops9_deletion_jobs`
- `20260905050748 ops10_operator_roles_mfa`
- `20260905050754 ops11_deletion_worker`

Staging 적용 직전에는 시약장 사진 참조와 Storage 객체가 모두 0건이었으며, 적용 뒤에도
0건입니다. 따라서 Staging Switch가 사진을 삭제하거나 누락시키지 않았습니다.

## 권한과 동작 검증

- Staging의 Ops 6~11 여섯 pgTAP 파일이 모두 통과했습니다.
- 운영은 Ops 8 18/18, Ops 9 23/23, Ops 10 26/26, Ops 11 30/30을 통과했습니다.
- 운영 삭제 작업·이벤트·파일 대상은 각각 0건이고, Worker lease 고정행만 1건입니다.
- Staging 삭제 작업·이벤트·파일 대상은 각각 0건이고, Worker lease 고정행만 1건입니다.
- 운영 지정 계정에는 `reader`, `approver`, `raw_exporter` 세 역할과 역할 부여 감사
  3건이 있습니다. 합성 계정과 합성 삭제 작업은 0건입니다.
- 일반 브라우저 역할은 새 `private` 표의 스키마 사용권과 직접 읽기·쓰기·수정·삭제
  권한이 모두 없습니다. `service_role`도 직접 DML 없이 검토된
  `SECURITY DEFINER` 서버 경로만 사용합니다.
- 운영과 Staging 모두 Supabase의 유출 비밀번호 차단을 활성화했습니다.
- 현재 Security Advisor 경계는 운영 60건, Staging 60건으로 같습니다. 구성은
  기본 거부 표 INFO 15건과 검토가 계속 필요한 SECURITY DEFINER 함수 WARN 45건입니다.
  Ops 7에서 회수한 구 가입·감사 RPC 경고와 해결한 유출 비밀번호 경고는 목록에서
  사라졌습니다.

## 운영 Scheduler 활성화 증거

- Worker 수정은 PR #86으로 병합됐고 `main` SHA
  `61368c3e56c24c1bb35d5104306de24292a81906`의 전체 Quality 4개 작업이 통과했습니다.
- 운영 Worker `buril-lab-deletion-scheduler-production`의 Version ID는
  `54a8d278-a73b-4869-b29e-0c9ab46bb2d9`이며 1분 예약 실행을 유지합니다.
- 이전 구현은 Cloudflare Workers가 지원하지 않는 `redirect: error` 때문에 요청 전에
  중단됐습니다. 수정 구현은 수동 redirect 모드에서 200이 아닌 응답을 거부하므로
  인증값을 다른 주소로 자동 전달하지 않습니다.
- 수정 배포에 사용한 임시 Cloudflare 토큰 두 개는 공급자에서 모두 폐기했고, 최종
  사용 토큰은 401 비활성 응답과 동일 이름 잔여 0건을 확인했습니다.
- 운영 KV의 이전 실패 상태를 초기화한 뒤 유지보수 Worker만 켰습니다. 계정 삭제
  접수는 계속 꺼진 상태에서 1분 예약 호출이 3회 연속 성공했고, 실패는 0회,
  `enablement_eligible=true`가 됐습니다.
- 세 번째 성공 로그의 `claimed`, `completed`, `pending`, `failed`는 모두 0이므로
  검증 중 사용자 계정·연구실·파일을 변경하지 않았습니다.

## 아직 닫히지 않은 런타임 조건

- 지정 운영자의 실제 Supabase Auth MFA factor는 아직 0건입니다. 역할은 부여됐지만
  AAL2 세션 전에는 민감 관리자 API가 계속 거부됩니다.
- 운영 삭제 Scheduler Worker는 배포와 빈 대기열 3회 연속 성공을 완료했으며
  `maintenance_worker_enabled=true`를 유지합니다.
- `account_deletion_enabled=false`와 삭제 UI OFF는 실제 MFA 등록과 AAL2 검증이
  완료될 때까지 유지합니다.
- 시약장 원본과 격리된 고아 파일은 삭제하지 않았습니다. Ops 12는 이 가속 범위에서
  제외합니다.

## 자격값 위생

점검 중 기존 Supabase MCP PAT가 로컬 프로세스 실행 인자에 남아 있는 사실을 발견해
30일 만료 교체값으로 갱신했습니다. 기존 PAT는 공급자에서 폐기되어 401을 반환하며,
그 값을 보유하던 로컬 MCP 프로세스도 종료했습니다. 어떤 PAT 원문도 이 증거에
기록하지 않습니다.

후속 공급자 목록 확인 중 생성 완료 배너가 자동 판독 범위에 포함된 PAT도 즉시
노출로 취급했습니다. 새 교체값을 로컬 비표시 전달 경로로 두 MCP 연결에 적용하고
공급자 인증 성공을 확인한 뒤 노출값을 삭제했습니다. 임시 전달 파일도 제거했습니다.

## 다음 활성화 순서

1. 이 exact Advisor 경계와 문서를 보호된 `main`에 병합하고 Quality를 통과합니다.
2. 운영 Pages에 삭제 유지보수 secret을 결합하되 두 삭제 스위치는 OFF로 유지합니다.
3. ~~`buril-lab-deletion-scheduler-production`을 OFF 상태로 배포합니다.~~ 완료
4. ~~유지보수만 ON으로 바꾸고 빈 대기열 예약 호출 3회 연속 성공을 확인합니다.~~ 완료
5. 지정 운영자가 MFA를 등록하고 AAL2 민감 작업 성공을 확인합니다.
6. 마지막으로 삭제 접수와 UI를 활성화합니다.
