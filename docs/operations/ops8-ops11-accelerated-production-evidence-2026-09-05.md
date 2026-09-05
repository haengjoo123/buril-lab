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

## 아직 닫히지 않은 런타임 조건

- 지정 운영자의 실제 Supabase Auth MFA factor는 아직 0건입니다. 역할은 부여됐지만
  AAL2 세션 전에는 민감 관리자 API가 계속 거부됩니다.
- 운영 삭제 Scheduler Worker는 아직 배포하지 않았습니다.
- `maintenance_worker_enabled=false`, `account_deletion_enabled=false`와 삭제 UI OFF를
  유지합니다.
- Scheduler에 같은 전용 secret을 결합하고 빈 대기열 예약 호출이 3회 연속 성공하기
  전에는 삭제 접수와 UI를 활성화하지 않습니다.
- 시약장 원본과 격리된 고아 파일은 삭제하지 않았습니다. Ops 12는 이 가속 범위에서
  제외합니다.

## 자격값 위생

점검 중 기존 Supabase MCP PAT가 로컬 프로세스 실행 인자에 남아 있는 사실을 발견해
30일 만료 교체값으로 갱신했습니다. 기존 PAT는 공급자에서 폐기되어 401을 반환하며,
그 값을 보유하던 로컬 MCP 프로세스도 종료했습니다. 어떤 PAT 원문도 이 증거에
기록하지 않습니다.

## 다음 활성화 순서

1. 이 exact Advisor 경계와 문서를 보호된 `main`에 병합하고 Quality를 통과합니다.
2. 운영 Pages에 삭제 유지보수 secret을 결합하되 두 삭제 스위치는 OFF로 유지합니다.
3. `buril-lab-deletion-scheduler-production`을 OFF 상태로 배포합니다.
4. 유지보수만 ON으로 바꾸고 빈 대기열 예약 호출 3회 연속 성공을 확인합니다.
5. 지정 운영자가 MFA를 등록하고 AAL2 민감 작업 성공을 확인합니다.
6. 마지막으로 삭제 접수와 UI를 활성화합니다.

