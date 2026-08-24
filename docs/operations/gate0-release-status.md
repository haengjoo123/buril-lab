# Gate 0 운영 배포 상태

기준 시각: 2026-08-24 23:08 KST

이 문서는 코드 준비, 외부 통제, 실제 훈련, 운영 배포를 구분합니다. 체크되지 않은 관문은 완료로 해석하지 않습니다.

## 현재 결론

- Gate 0 코드 후보와 로컬 DB·브라우저 검사는 준비됐습니다.
- Staging의 세 공개 경계에 대한 Cloudflare Access 보호는 완료됐지만, 환경 비밀값·별도 Redis·키 회전·합성 데이터 초기화가 남아 있어 Staging 배포는 아직 금지입니다.
- Supabase 복구 프로젝트에 대한 조직 접근자·비용 승인이 없어 복구훈련은 아직 실행하지 않았습니다.
- Gate 0 운영 배포와 30분·24시간·7일 관찰은 아직 시작하지 않았습니다.
- 관문 0, 준비 1, 준비 2를 완료로 표시하지 않습니다.

## 릴리스 경계

- 기준 커밋: `bf8dcc726061f0e89bc8fbf39e63e1db8e90e2b2`
- 운영 후보 브랜치: `codex/ops-hardening`
- 현재 검증 기준: PR #4 최신 SHA의 성공한 `Quality and security` 실행
- Pull Request: [#4](https://github.com/haengjoo123/buril-lab/pull/4)
- 전체 후속 구현 보존 커밋: `3b30751bc24ae955be6ab2abb73ff75d30178ec0`
- 전체 후속 구현 보존 커밋은 운영 배포 대상이 아닙니다.
- Gate 0 운영 후보에는 즉시 위험 차단, 최소 배포 통제, DB 기준선 재구성 경로만 포함합니다.
- API 헤더·CORS·JSON 404/405·관리자 API·HSTS 등 운영 2 변경은 이번 PR에 섞지 않습니다.

## 완료한 저장소·CI 통제

- [x] 사용자 미추적 문서·이미지를 건드리지 않고 로컬 snapshot 브랜치에 구현 파일만 보존
- [x] `codex/ops-hardening`에서 Gate 0 변경을 작은 커밋으로 분리
- [x] `main` force push·삭제 금지, 관리자에게도 보호 적용
- [x] PR 필수, 타인 승인 수는 0, 대화 해결 필수
- [x] 필수 검사 4개 고정: Application, Cloudflare release contract, Blank database, Gate 0 browser
- [x] `gate-*` tag 수정·삭제를 막는 활성 ruleset 생성
- [x] 최종 Gate 0 tag는 실제 배포·관찰 전까지 만들지 않음
- [x] Staging 자동·운영 수동 workflow와 `release.json` 전체 SHA 검증 구현
- [x] Cloudflare API의 전체 SHA, deployment UUID, 고유 URL을 함께 검증하도록 구현
- [x] `release:verify`는 유료 출시 차단 상태 유지, `ops:verify`를 별도 제공

PR #4 최신 SHA의 GitHub Actions에서 네 필수 검사가 모두 통과해야 이 문서의 검증 기준을 만족합니다. 현재 Gate 0 후보의 Vitest는 583개 통과, 7개 제외입니다. 계획 작성 당시의 781개 수치는 현재 Gate 0 릴리스 조각과 시험 구성이 달라 동일한 분모로 주장하지 않습니다. 후속 전체 snapshot에서는 861개 통과, 7개 제외였지만 운영 후보 증거로 사용하지 않습니다.

보안 권고 exact baseline 변경이 추가되면 PR 최신 SHA에서 네 필수 검사를 다시 통과해야 합니다. 이전 run의 성공만으로 새 SHA를 배포하지 않습니다.

## 완료한 DB·브라우저 준비 증거

- [x] 활성 마이그레이션을 운영 기준선 1개로 분리하고 이전 50개 SQL을 `legacy_migrations`에 보존
- [x] Supabase CLI `2.115.0`으로 빈 DB를 두 번 연속 재구성
- [x] 기준선 pgTAP RLS·GRANT 권한시험 11개 통과
- [x] 기준선 이력 도구를 `plan`, `apply`, `restore-legacy`로 분리
- [x] 운영 89개 이력과 정확히 일치하지 않으면 이력 정리를 중단하도록 구현
- [x] 기준선 SQL은 운영에 실행하지 않고 이력만 정리하도록 제한
- [x] 실제 Chromium Gate 0 흐름 통과: 로그인→연구실→재고 검색→폐액 배치 검토→화면 버튼 기록→기록 목록→직접 링크
- [x] 브라우저 시험 중 외부 화학정보 보강 요청 0건 확인
- [x] seed는 loopback DB만 허용하고 원격 URL을 client 생성 전에 거부
- [x] 운영 53건·Staging 50건의 Security Advisor 종류·대상·역할 권한을 정확한 기준선으로 고정하고 정적 검사 및 Supabase 플러그인 읽기 전용 대조 완료
- [ ] GitHub environment별 Supabase 비밀값을 등록하고 `main`의 hosted Advisor 검사 통과

## 완료한 외부 통제

- [x] 운영 Cloudflare Pages의 production·preview 자동 배포 중단
- [x] preview에 설정됐던 클라이언트 API 키 변수 3개 제거
- [x] 해당 키가 포함됐을 가능성이 있는 preview deployment 9개 제거
- [x] 운영 rollback용 production deployment는 보존
- [x] 빈 direct-upload Pages 프로젝트 `buril-lab-staging` 생성
- [x] `staging.burillab.com`을 `buril-lab-staging` Pages custom domain으로 연결
- [x] `BurilLab Staging` Access 앱에 custom domain, project `pages.dev`, preview wildcard를 등록하고 단일 `Emails` 허용 규칙 적용; 비인증 요청은 custom domain·project `pages.dev`·대표 preview hostname 모두 Access 로그인 경로로 302 응답
- [x] 운영·Staging 전용 runtime KV namespace 분리
- [x] 운영·Staging 전용 비공개 R2 백업 버킷 분리 및 30일 보존 규칙 설정
- [x] runtime KV 안전 스위치를 `redirect`, `full`, `false`, `false`, `false`로 기록
- [x] GitHub `staging`, `production` environment 생성 및 `main` 배포 브랜치 제한
- [x] 운영·Staging Supabase 프로젝트가 다른 프로젝트인지 확인

2026-08-24 확인 시 저장소와 두 GitHub environment의 secret·variable 목록은 모두 비어 있습니다. 값이 준비되기 전 배포 workflow는 실행하지 않습니다.

## Staging 초기화 전 익명 증거

Supabase 플러그인으로 2026-08-24에 행 수만 조회했습니다. 사용자 정보, 연구실명, 시약명, 파일 경로는 읽거나 저장하지 않았습니다.

| 대상 | 행 수 |
|---|---:|
| `labs` | 3 |
| `lab_members` | 5 |
| `inventory` | 57 |
| `cabinets` | 9 |
| `cabinet_items` | 116 |
| `waste_logs` | 42 |
| `waste_log_items` | 3 |
| `audit_logs` | 597 |

현재 Staging migration 이력은 기준선 1개와 보안·삭제·파일럿 후보 22개를 합친 23개입니다. 승인된 Gate 0 활성 경로와 다르므로 초기화 전에는 배포 검증 환경으로 사용하지 않습니다.

Security Advisor는 운영 53건, Staging 50건을 읽기 전용으로 확인했습니다. 숫자만 허용하지 않고 각 권고의 종류·대상·함수 언어·실제 역할 권한·임시 허용 사유를 정확히 고정해야 합니다. 새 차이는 실패로 처리합니다.

## 아직 닫지 않은 항목

- [x] PR 최신 SHA의 네 필수 품질검사 성공
- [x] Cloudflare Access로 `staging.burillab.com`, `buril-lab-staging.pages.dev`, `*.buril-lab-staging.pages.dev`를 보호하고 세 경계의 비인증 요청 302 확인
- [ ] 운영과 다른 Staging Upstash 준비
- [ ] GitHub environment별 Pages·Supabase·KV·Access 비밀값 등록
- [ ] 제거한 외부 API 키 3개의 공급자 측 회전
- [ ] Staging의 현재 집계 증거 보존 후 합성 데이터로 초기화
- [ ] 같은 커밋 SHA의 Staging 배포 및 고유 URL `release.json` 검증
- [ ] Staging에서 실제 외부 화학정보 연동시험
- [ ] 직전 Pages deployment 되돌림 훈련
- [ ] 운영 쓰기와 일관된 복구 시점을 만들 수 있는 비공개 R2 사진 본문·완전한 manifest·해시 준비
- [ ] Supabase 조직 접근자 확인
- [ ] Supabase 플러그인이 반환한 새 프로젝트 비용 `월 10달러`를 사용자에게 알리고 명시적 비용 확인
- [ ] 임시 Micro 프로젝트에서 4시간 이내 논리 복구훈련 후 24시간 안에 삭제
- [ ] Gate 0 운영 수동 배포
- [ ] 운영 배포 뒤 30분·24시간·7일 관찰

되돌림과 복구 절차서는 각각 [Pages 되돌림 훈련](./pages-rollback-drill.md), [Supabase 복구훈련](./supabase-recovery-drill.md)에 준비했습니다. 두 문서는 실행 체크리스트이며 완료 증거가 아닙니다.

## 현재 금지 상태

- 운영 Pages 코드 배포 금지
- 운영 Supabase migration 또는 기준선 SQL 실행 금지
- 별도 Staging Redis, GitHub environment 비밀값, 공급자 키 회전과 합성 데이터 초기화가 준비되기 전 Staging 배포 금지
- 음성 `guided` 운영 전환 금지
- 계정·연구실 삭제 UI와 Scheduler 활성화 금지
- 시약장 사진 이관·원본 삭제 금지
- Storage 백업 Worker 활성화 금지
- SDS·바코드·알림·보고서·파일럿·유료 출시 기능 반영 금지

## 남은 수용 위험

일일 백업을 유지하므로 평상시 최근 복구 가능 시점은 최대 약 24시간 전일 수 있습니다. 이번 작업으로 RPO 1시간 관문은 닫지 않습니다.

Micro 복구훈련은 운영 DB를 논리 덤프한 시점의 복구 가능성을 시험합니다. 과거 일일 백업 시점 자체를 시험하려면 Supabase의 새 프로젝트 복제 기능을 사용해야 하지만, 이 기능은 원본 컴퓨팅 크기를 복제하므로 Micro·1달러 상한을 별도로 확인해야 합니다.

Supabase 공식 계산 기준에서 Micro는 시간당 0.01344달러이고, 일부 시간도 한 시간으로 청구되며 삭제하면 그 이후 과금이 멈춥니다. 24시간 안에 삭제하면 예상 Compute 사용료는 약 0.32256달러지만, 프로젝트 생성 확인 API는 비용 계약을 월 10달러로 반환합니다. 생성 전에는 더 큰 표시값인 월 10달러를 기준으로 명시적 확인을 받습니다.

운영 KV의 전 세계 60초 이내 반영은 Cloudflare KV의 강한 보장이 아닙니다. 이번 단계에서는 Staging에서 관찰하는 목표로만 두며, 엄격한 보장이 필요하면 강한 일관성을 제공하는 저장소를 별도 검토합니다.
