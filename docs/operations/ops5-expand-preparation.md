# 운영 5 Expand 로컬 준비 증거

기준 시각: 2026-09-04 KST

이 문서는 운영 1·2 관찰 중 병행한 **로컬 준비**만 기록한다. Staging 또는 운영 배포, Hosted Supabase 검증, 운영 5 통과를 뜻하지 않는다.

## 준비 기준과 범위

- 준비 기준 `main`: `7a210b10034a9c0deecb60a7a4022317f082db58`
- 전용 작업트리: `codex/ops5-expand-preparation`
- 운영·Staging DB, Storage, KV, Pages, Worker에는 쓰기 작업을 하지 않았다.
- 공급자 자격값을 만들거나 GitHub 비밀값을 추가하지 않았다.
- 사용자 소유 원본 작업트리와 미추적 문서·이미지는 수정하지 않았다.

Expand에는 다음 호환 구조만 포함한다.

1. `POST /api/labs/join`과 서비스 역할 전용 `join_lab_server_v1`
2. 연구실·사용자별 실패 횟수와 잠금을 위한 HMAC 식별자 기반 비공개 표
3. 기존 `image_url`을 그대로 둔 nullable `cabinets.image_path`
4. 시약장 활동과 감사 행을 한 DB 작업으로 기록하는 `record_cabinet_activity_v2`
5. 새 클라이언트의 서버 가입 경로와 DB 계산 감사 경로 전환

기존 `join_lab`, `insert_audit_log_rpc`, 브라우저의 감사 표 INSERT 권한, 공개 사진 버킷과 `image_url`은 이 단계에서 제거하지 않는다. 이들은 구 앱 복귀를 위해 유지하며 운영 6 Switch와 운영 7 Contract의 검증 뒤에만 닫는다.

## 보안 경계

- 가입 API는 8 KiB 요청, 8초 전체 마감, Auth 256 KiB·RPC 8 KiB 응답 상한을 적용한다.
- Supabase Auth와 RPC는 각각 한 번만 호출한다. 자동 재시도와 구 RPC fallback은 없다.
- Workers가 지원하지 않는 `redirect=error` 대신 `manual`을 사용하고 모든 3xx를 직접 거부한다.
- 서버 가입 함수는 `service_role`만 실행할 수 있고, 실패 횟수 표는 `anon`, `authenticated`, `service_role` 모두 직접 읽고 쓸 수 없다.
- 원 IP는 저장하지 않는다. 환경별 비밀값으로 연구실·사용자 또는 연구실·IP HMAC만 만든다.
- 안전한 시약장 활동 함수는 DB에서 로그인 사용자, 연구실 범위, 행동, 변경 뒤 값을 직접 계산한다. 활동 행과 감사 행 중 하나만 기록되는 상태는 커밋되지 않는다.
- `image_path`는 URL이 아닌 Storage 상대 경로만 허용하며 절대경로, 역슬래시, 제어문자, `..` 경로를 거부한다. 기존 표 단위 권한으로 새 열 쓰기가 열리지 않도록 브라우저 변경을 트리거에서 거부하고 서버·마이그레이션만 값을 넣을 수 있다.
- 새 서버 비밀값 이름과 실제 값이 클라이언트 번들에 나타나면 빌드를 실패시키는 검사를 추가했다.

## 로컬 검증

- ESLint와 TypeScript 프로젝트 빌드 통과
- Ops3·기준선 전용 구 관문 검사 2개를 제외한 전체 Vitest: 118개 파일 통과·1개 보류, 1,351개 시험 통과·7개 보류
- 운영용 Vite 빌드와 생성된 클라이언트 산출물 41개의 서버 비밀값 이름·값 검사 통과
- 실행 패키지 감사에서 높음·치명적 취약점 0건(중간 3건은 이후 의존성 갱신 대상으로 별도 유지)
- 실제 Cloudflare 실행환경과 실제 Supabase JavaScript SDK를 묶은 합성 시험 10가지 통과
  - 정상, 잠금, 잘못된 비밀번호, 인증 거부·장애·리디렉션·과대 응답, RPC 과대·비정상·오류
  - 외부 공급자 호출 0, 예상 밖 목적지 0, 요청 재전송 0
- 공식 PostgreSQL 17.11의 새 임시 클러스터에서 빈 DB 2개에 전체 기준선과 Expand를 각각 적용
- SQL 의미·권한·잠금·호환 시험 2묶음과 동시성 시험 4종 통과
  - 사용자 5회 및 IP 20회 rolling lock
  - 같은 사용자의 동시 가입, 세 번째 연구실 경계, 잠금 대기 뒤 시각 재계산
  - 구 가입 함수와 새 가입 함수의 비밀번호 호환
  - `image_url`·`image_path` 공존, 경로 제약, 브라우저의 타 연구실 경로 심기 거부
  - 안전한 시약장 활동·감사 원자성, 타 연구실 거부와 부분 기록 0
- 임시 PostgreSQL 서버 종료와 임시 디렉터리 제거 확인
- Ops5 전용 변경 경계와 SQL 정규화 해시 검사 통과
  - migration: `09c9aeb92e2b5745ce69b8acc0b0c754cae4ca30bf735f6c5ba1f57aa584bc1b`
  - pgTAP: `183a3a73c23a66b274ac9fd4d4a00cca38a65ba4d1af4d34c901370e919812b3`

Docker가 없는 현재 Windows 환경에서는 새 pgTAP 파일 자체를 Supabase 로컬 스택에서 실행하지 못했다. 같은 권한·기능은 실제 PostgreSQL에서 SQL 예외 기반으로 실행했지만, 이는 `supabase db reset`이나 Hosted Advisor 증거를 대신하지 않는다.

## 의도적으로 열린 관문

- 기존 Ops3 범위 검사는 Ops3 외 파일을, Prep 1 DB 검사는 기준선 외 마이그레이션을 거부한다. 현재 전체 시험의 이 두 실패는 보호장치를 약화시키지 않았다는 증거이며 Ops4가 운영에 반영된 뒤 새 기준 `main`에서 관문 전환을 명시적으로 검토해야 한다.
- 운영 1·2의 실제 24시간·7일 관찰과 서로 다른 날짜의 일일 백업 2회 성공은 아직 별도 증거가 필요하다.
- Ops4 운영 마이그레이션 이력 정리가 먼저 완료돼야 한다.
- Staging 배포 전 환경별 `LAB_JOIN_RATE_LIMIT_SECRET`을 별도 암호값으로 등록하고, 존재·분리·클라이언트 비노출을 배포 검증기에 연결해야 한다.
- Staging의 Hosted Advisor exact 목록, Auth·REST 실제 호출, 브라우저 가입·감사 흐름을 새 SHA로 검증해야 한다.
- 공개 사진을 비공개 경로로 옮기거나 구 가입·감사 권한을 회수하지 않았다.

따라서 `ops5:verify`의 성공 결과는 `productionReady=false`, `requiresOps4AndFreshMain=true`로 고정한다.
