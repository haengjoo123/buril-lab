# BurilLab Ops 3~11 가속 출시 정책

승인 시각: 2026-09-04 KST

```text
policyMode: accelerated-risk-based
releaseTarget: Ops3-Ops11
ops12Included: false
initialDeletionUi: false
followUpDeletionUi: true
deletionRuntimeActivation: post-same-sha-staging-and-production
legacyContractRevocation: post-new-path-smoke
hostedAcceptance: required
productionReady: false
```

## 무엇을 바꾸는가

기존 정책의 `각 운영 묶음마다 다음 묶음 전에 7일 대기`를 Ops 3~11에는 적용하지
않습니다. 7일 관찰은 출시를 막는 대기조건이 아니라 출시 뒤 이상을 찾고 되돌리기 위한
관찰조건으로 바꿉니다. 이미 같은 코드와 경계를 반복 검증한 항목은 증거를 재사용하되,
새 후보 SHA에 대한 Quality와 Staging 검증은 다시 수행합니다.

이 변경은 시험을 생략한다는 뜻이 아닙니다. 아래 중 하나라도 실패하면 운영 반영을
중단합니다.

- 정확히 같은 SHA의 GitHub Quality와 Cloudflare Staging 배포
- 빈 PostgreSQL 재구성 2회와 모든 활성 pgTAP 권한시험
- Hosted Supabase Security/Performance Advisor의 승인 목록 대조
- 로그인, 연구실 전환, 가입, 검색, 폐액 기록, 사진 업로드·열람, 관리자 MFA 경계,
  삭제 작업의 브라우저·API 흐름
- 운영 변경 직전 DB 백업과 사진 백업 최신 성공본, 핵심 행 수·합계 스냅샷
- 다른 연구실 접근 거부, 감사기록 위조 거부, 요청 제한 장치 장애 시 보수적 거부

## 이번 출시의 경계

Ops 3~11 코드는 하나의 후보 SHA로 출시할 수 있지만, 안전 스위치와 DB 변경은 아래
순서로만 켭니다.

1. Ops 3 웹/API 경계를 배포합니다. 음성은 `redirect`, 삭제와 유지보수는 OFF입니다.
2. Ops 4는 애플리케이션 배포와 분리하여 마이그레이션 적용 기록만 정리합니다. 기준선
   SQL 본문은 운영 DB에 실행하지 않습니다.
3. Ops 5와 Ops 6 Expand를 적용하고 새 가입·감사·`image_path` 경로를 검증합니다.
4. 사진을 비공개 경로로 복사하고 크기와 SHA-256, 소유 연구실을 전부 확인한 뒤에만
   Ops 6 Switch를 적용합니다. 공개 원본과 고아 파일은 삭제하지 않습니다.
5. 새 가입·감사 경로의 실제 성공과 구 경로 무호출을 확인한 뒤 Ops 7 Contract를
   적용합니다. 이 시점 뒤에는 구 웹 배포로 단순 롤백하지 않고 새 경로를 유지한
   전진 수정 또는 검증된 권한 복원 절차를 사용합니다.
6. Ops 8~10을 순서대로 적용하고 비밀번호 정책, 잠금, 삭제 작업표, 운영자 세 역할과
   AAL2를 Hosted 환경에서 확인합니다.
7. Ops 11 Scheduler는 삭제 접수 OFF 상태로 배포합니다. 예약 호출 3회가 연속 성공한
   뒤에만 별도 후보 SHA에서 삭제 UI와 접수를 켤 수 있습니다.

## 생략하지 않는 안전선

- `ops12Included: false`: 공개 사진 원본·고아 파일·보존 본문을 이번 출시에서 삭제하지
  않습니다. 최소 7일 보존과 별도 정확한 삭제목록 확인은 그대로 남깁니다.
- `initialDeletionUi: false`: 계정·연구실 삭제는 Worker의 실제 예약 호출 3회 전까지
  사용자에게 노출하지 않습니다.
- Ops 7 Contract 전에는 새 경로가 Hosted 환경에서 성공하고 구 호출이 0임을 짧은
  관찰창에서 확인합니다. 확인할 수 없으면 Contract만 보류해도 사용자용 출시를 진행할
  수 있습니다.
- 사진 Switch 전에는 백업 Worker를 OFF로 두고, Switch 뒤에는 `private_path`를 읽는
  Worker만 배포합니다.
- RPO 1시간, 음성 폐액 `guided`, SDS·바코드·알림·보고서·유료 출시 검증은 이번 완료
  판정에 포함하지 않습니다.

## 같은 날 실행 순서와 중단점

| 단계 | 실행 | 중단 조건 |
|---|---|---|
| A | 후보 SHA 로컬 전수검사와 새 Staging 배포 | Quality, 빌드, 빈 DB, pgTAP, Advisor, 브라우저 흐름 중 하나라도 실패 |
| B | 운영 백업과 Ops 3 웹/API 배포 | 백업 최신 성공본 없음, 런타임 안전값 불일치, 공개/고정 `release.json` SHA 불일치 |
| C | Ops 4 이력 전환 | 기존 89개 이력·해시 불일치 또는 전후 스키마·합계 변화 |
| D | Ops 5 + Ops 6 Expand | 구·신 경로 병행 실패 또는 새 RLS/GRANT 차이 |
| E | 사진 복사 + Ops 6 Switch | 파일 크기·SHA-256·소유권 불일치가 1건이라도 있음 |
| F | Ops 7~10 | 새 가입·감사 실패, 구 호출 존재, 잠금·AAL2·교차 연구실 시험 실패 |
| G | Ops 11 Worker OFF 배포 | 전용 secret, 단일 임대, 재시도, 자동 OFF 시험 실패 |
| H | 예약 호출 3회 뒤 삭제 UI 후속 배포 | 성공 3회 미만, 2회 연속 실패, 3분간 성공 기록 없음 |

각 단계 사이에는 최소한의 실제 smoke와 오류 집계를 확인합니다. 위험한 음성 응답,
인증 우회, 연구실 간 노출, 비밀값 노출은 한 건만 발생해도 즉시 안전 스위치를 닫고
진행을 중단합니다.

## 기존 PWA 화면 전환 검증

Staging run `33961532369`의 `777c820f9c24a2deda8bac57eb62052ec0d1cb89` 배포는
성공했지만, 이전 prompt 클라이언트가 새 autoUpdate 서비스워커의 활성화 뒤에도
기존 화면을 유지하는 현상을 별도 Chromium에서 재현했습니다. 설정 문자열 검사와
신규 브라우저 smoke만으로 기존 설치본의 자동 갱신을 통과 처리하지 않습니다.

`sw-legacy-refresh.js`는 이전 서비스워커가 있는 첫 업데이트에서만 기존 앱 창을
현재 주소로 다시 탐색시킵니다. 별도 migration 캐시의 표식을 먼저 기록하므로 신규
설치와 이후 업데이트에서는 반복 실행하지 않습니다. API, Access, release.json,
sw.js 창은 제외합니다. 탐색 요청을 시작한 뒤 활성화 이벤트를 끝내야 하며,
활성화 안에서 탐색 완료를 기다리면 해당 탐색도 활성화를 기다려 멈출 수 있습니다.

배포 전에는 이전 prompt 아티팩트를 등록한 브라우저에서 후보로 서버 파일을 바꾼
뒤 브라우저의 업데이트 확인을 유발합니다. 이미 열린 다른 창까지 후보 번들로
바뀌고 화면이 표시되는지, 서비스워커가 activated인지, 재탐색 시 갱신 반복이
없는지 확인합니다. 캐시 삭제·서비스워커 등록 해제로 이 시험을 대체하지 않습니다.
브라우저가 새 SW를 확인하기 전까지 즉시 배포 알림을 받는다는 보장은 하지 않습니다.
Hosted Staging PWA와 합성 MFA 검증을 마친 같은 후보 SHA만 운영에 배포합니다.

## Pages 관리자 인증 모드 배포 검증

Staging run `33963467047`의 `f711860cf262fda653610e0d5e6461273e14a055` 앱은
Chrome에서 최신 번들로 열렸지만, 합성 운영자의 개선 제안 화면은 일시적 서비스
오류를 표시했습니다. Pages의 실제 변수와 두 Wrangler 파일 모두 `OPS_AUTH_MODE`가
누락되어 관리자 API가 역할·MFA 판정 전에 503으로 닫히는 경로를 확인했습니다.

Staging과 운영의 Wrangler 최상위 변수에 비밀값이 아닌
`OPS_AUTH_MODE=server_roles`를 명시합니다. Pages는 Wrangler 파일을 배포 설정의
기준으로 사용하므로 대시보드에서만 값을 추가하지 않습니다. 배포 검증기는 두 환경
각각에서 누락, 빈 값, 이메일 허용 목록 모드, 오타를 거부합니다. API의 설정 오류 시
차단 동작과 운영 preview 비활성 경계는 유지합니다.

수정 후보는 새 main Quality 통과 뒤 Staging에 먼저 배포합니다. 실제 런타임 변수,
AAL1 민감 API 거부, MFA 등록 후 AAL2 성공과 감사 기록, 합성 계정 복구·정리를
확인하기 전에는 운영 배포나 MFA 검증 완료로 기록하지 않습니다.

## 삭제 화면 후속 후보와 별도 접수 활성화

2026-09-05 운영 SHA `5a489187af5e366abaeba763a47d314bc4bd7cfe`의 감독형
run `33966176714`에서 공개/고정 배포 SHA 일치, API 인증 경계와 기존 PWA 창의
새 번들 자동 전환을 확인했습니다. 같은 SHA의 Staging run `33965501342`에서
합성 운영자 AAL1 거부, AAL2 성공, factor 초기화 후 재등록과 정리를 검증했습니다.
실제 운영자도 직접 MFA 등록을 완료했고, `feedback.list`가 12:35:55Z AAL1에서
`MFA_REQUIRED`, 12:38:14Z AAL2에서 `authorized`로 감사 기록에 남았습니다.
두 배포의 공급자 토큰 폐기·API 비활성·서명 cleanup과 임시 자격 상태 0을 확인했습니다.
운영 Scheduler의 KV health는 후속 변경 전 연속 성공 289회, 연속 실패 0회,
`enablement_eligible=true`였으며 삭제 접수는 OFF였습니다.

이 후속 후보는 `DELETION_UI_ENABLED=true`로 인증된 사용자의 계정 삭제 요청과
연구실 관리자의 삭제 요청 화면을 노출합니다. 한국어·영어 접수 안내는 삭제 완료와
구별하며, 백업본은 별도 보관 정책에 따라 만료된다는 사실을 확인 화면에 안내합니다.
검증기는 초기 Ops9 준비 단계의 OFF 계약을 유지하면서 후속 단계의 UI ON, 서버
기본 OFF, 인증된 제어, 즉시 삭제 없는 작업 등록 계약을 함께 검사합니다.
`productionReady`와 Hosted 검증 결과를 정적 코드 검사만으로 true로 만들지 않습니다.

1. 새 후보 전체 Quality와 같은 SHA Staging 배포를 통과시킵니다. 접수 OFF에서
   화면·확인·서버 거부를 확인하고 임시 토큰을 폐기합니다.
2. 같은 SHA를 운영에 감독형 배포하고 public/immutable 버전, 인증 경계, PWA와
   화면을 확인한 뒤 임시 토큰 폐기·비활성 확인·서명 cleanup을 완료합니다.
3. 최신 Scheduler 성공이 3분 이내이고 연속 성공 3회 이상이며 실패 0임을 다시
   확인한 뒤에만 운영 KV의 `account_deletion_enabled`를 true로 바꿉니다.
   음성 redirect, KOSHA full, maintenance/backup true는 그대로 보존합니다.
4. 최소 2분 동안 실제 응답을 반복 확인합니다. 실제 사용자나 연구실 대신 정확히
   식별한 일회용 시험 계정·연구실로 HTTP 202 접수, 중복 요청의 동일 작업,
   예약 처리·정리 및 감사 집계를 확인합니다. DB 재시도·최대 12회와 Scheduler
   실패 2회/성공 3분 부재 시 양쪽 OFF 계약의 시험 증거를 함께 기록합니다.
5. 부정확한 응답이나 중단 기준이 발생하면 승인된 안전 OFF 절차를 적용합니다.
   30분·24시간·7일 관찰은 마지막 실제 배포/활성화 시각과 증거를 기준으로 남깁니다.

이 단계는 Ops12 공개 원본·고아 파일 삭제를 포함하지 않습니다.

## 출시 완료의 의미

사용자가 쓰는 앱의 출시 완료는 Ops 3 웹/API와 Ops 5~11의 안전한 서버 경로가 운영에
반영되고, 삭제 Worker가 3회 성공한 뒤 삭제 UI 후속 SHA가 배포된 상태를 뜻합니다.
사진 원본 정리(Ops 12)와 7일 관찰 완료는 별도 후속 작업입니다. 따라서 이 문서는
모든 Hosted 증거가 생기기 전까지 `productionReady: false`를 유지합니다.
