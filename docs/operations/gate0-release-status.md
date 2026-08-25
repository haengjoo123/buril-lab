# Gate 0 운영 배포 상태

기준 시각: 2026-08-25 KST

이 문서는 코드 준비, 외부 통제, 실제 훈련, 운영 배포를 구분합니다. 체크되지 않은 관문은 완료로 해석하지 않습니다.

## 현재 결론

- PR #8의 병합 SHA `7b661b25771e6ea84ccc4c1c4547a9caf5323d52`는 과거 Gate 0 기준선입니다. 당시 품질검사, Hosted Advisor, Staging 브라우저 흐름과 Pages 되돌림 훈련을 통과한 기록은 보존하지만 현재 보안 강화 분기의 배포 증거로 재사용하지 않습니다.
- 현재 `codex/storage-recovery-hardening` 변경은 아직 PR 병합·새 SHA의 Staging 감독형 배포를 하지 않았습니다. 서명 공개키는 저장소에 고정했지만, 현재 후보의 Staging·운영 배포와 되돌림 훈련은 여전히 미완료입니다.
- GitHub `staging`·`production` environment의 배포 입력, 별도 Staging Redis, 합성 데이터 초기화와 Gate 0 소유 표시는 준비됐습니다.
- 과거 기준선 SHA는 Staging Pages 배포와 되돌림 훈련을 완료했습니다. 새 서명 임대·누적 정리 영수증·숨김 토큰 입력 계약으로는 아직 실행하지 않았습니다.
- Supabase 조직 접근자 확인은 완료됐지만 임시 복구 프로젝트 생성과 복구훈련은 아직 실행하지 않았습니다.
- Gate 0 운영 배포와 30분·24시간·7일 관찰은 아직 시작하지 않았습니다.
- 과거 준비 1 증거는 완료 상태로 보존합니다. 현재 보안 강화 후보의 Staging 재검증, 관문 0 운영 배포·관찰과 준비 2 Supabase 복구훈련은 완료로 표시하지 않습니다.

## 현재 보안 강화 후보의 로컬 상태

- Staging·운영·Quality·보류된 TestFlight workflow 전체와 Cloudflare 읽기 helper 소스를 SHA-256으로 고정했습니다. 허용 workflow 파일은 이 4개뿐이며 외부 Action도 검토된 40자리 커밋 SHA만 사용합니다.
- TestFlight workflow는 이번 범위에서 실행할 수 없습니다. 비밀값·소스·외부 Action을 전혀 읽지 않고 보류 사유를 출력한 뒤 실패합니다.
- CI와 배포의 `npm ci`는 lifecycle script를 실행하지 않습니다. Cloudflare helper를 쓰는 각 단계는 토큰 사용 직전에 tracked worktree와 helper의 고정 SHA-256을 다시 확인합니다.
- Staging과 운영은 자격값이 없는 build runner와 임시 자격값을 쓰는 새 deploy runner를 분리합니다. build 결과는 이름이 아니라 GitHub artifact ID로 가져오며 서비스 digest, 자체 manifest, 파일별 SHA-256, 파일 수와 `release.json`을 deploy runner에서 다시 확인합니다. 선택적 Staging 백업 Worker도 Pages와 다른 새 runner에서만 실행합니다.
- Cloudflare API 토큰은 프로세스 인수로 넘기지 않고 환경변수에서만 읽습니다. helper는 승인된 Pages·Staging Worker 읽기 URL만 허용하고, JSON·1 MiB·30초·redirect 경계를 강제합니다.
- Ed25519 서명 임대에는 실제 Supabase PAT 값의 해시, Cloudflare 토큰 ID 해시, cleanup 영수증 해시와 운영용 exact Staging run ID를 포함합니다.
- 토큰 생성 안내 전에 서명된 pending 표식을 저장합니다. 입력 중단은 공급자 비활성 또는 화면상 미생성 확인을 담은 서명 abort 영수증 없이는 해제할 수 없습니다.
- 저장소 범위의 같은 이름 secret·variable은 environment 격리를 우회하므로 감독기가 거부합니다.
- 누적 영수증 32회 한계는 자격값 생성 전에 중단합니다. 자동 epoch rollover는 아직 구현하지 않았고 별도 검토 관문으로 남깁니다.
- 로컬 Cloudflare·임대 수명주기 회귀시험은 현재 143개를 통과했습니다. 깨끗한 잠금파일 설치 뒤 전체 Vitest는 856개 통과·7개 보류였고 위험한 자동 폐액 경로는 0건이었습니다. 이 수치는 실제 Staging 성공을 뜻하지 않습니다.
- 사용자의 별도 직전 확인 후 로컬 Windows 계정에만 복호화 가능한 DPAPI Ed25519 개인키를 만들고, 공개키와 SHA-256 지문 `b5fc8397c8eeb2e2a16b1ffc0feb0b0563f76302ee7b78c08b754651ae455cb2`만 저장소에 고정했습니다. DPAPI 실제 왕복·공개키 지문 검사를 통과했습니다. 이것은 토큰 생성이나 실제 배포 승인이 아닙니다.

## 2026-08-25 Cloudflare 배포 자격값 교정

아래에 남아 있는 Staging 자동 배포 구현과 GitHub environment 배포 입력 등록 기록은 당시 완료한 사실을 보존한 과거 증거입니다. 이후 권한 범위를 다시 확인한 결과 Cloudflare Pages Edit와 Workers Scripts Edit는 특정 Pages 프로젝트나 Worker로 제한되지 않고 계정 범위에 영향을 줄 수 있으므로, 그 자동·지속 자격값 운영 방식은 앞으로 사용하지 않습니다.

- 이후 Staging 배포는 `workflow_dispatch`에서 현재 `main`의 전체 SHA와 정확한 확인문구를 입력하는 감독형 실행만 허용합니다. 같은 SHA의 이름이 `Quality and security`인 workflow가 성공했는지 배포 초반과 Pages 반영 직전에 다시 확인합니다.
- Pages 배포 직전에 짧은 유효기간의 `STAGING_PAGES_EPHEMERAL_TOKEN`과 최대 45분짜리 서명 임대를 GitHub `staging` environment에 넣고, 실행 종료 즉시 GitHub에서 제거한 뒤 Cloudflare에서 폐기합니다. Cloudflare 토큰은 실행 시점에 남은 시간이 45분 이상 26시간 이하인지 API로 확인합니다.
- Storage 백업 Worker는 `deploy_storage_backup=true`를 명시한 실행에서만 별도의 `STAGING_WORKER_EPHEMERAL_TOKEN`을 읽습니다. 기본값은 `false`이며 Pages 토큰과 Worker 토큰은 서로 다른 값이어야 합니다.
- Hosted Advisor의 24시간짜리 별도 실행 증거는 재사용하지 않습니다. 감독형 배포 안에서 환경별 임시 Supabase PAT로 현재 상태를 초반과 변경 직전에 직접 확인합니다.
- 운영 수동 배포도 같은 방식으로 `PRODUCTION_PAGES_EPHEMERAL_TOKEN`과 운영 전용 임시 Supabase PAT만 잠시 사용하고 실행 종료 즉시 제거·폐기합니다. 기존 `CLOUDFLARE_API_TOKEN`, `STAGING_CLOUDFLARE_API_TOKEN`, 일반 `SUPABASE_ACCESS_TOKEN` 이름은 workflow에서 거부합니다.
- 각 실행은 새 32자리 임대 ID를 사용합니다. GitHub secret 삭제와 공급자 폐기를 확인한 정리 영수증이 가장 최근 실행과 맞지 않으면 다음 배포는 시작되지 않습니다. workflow 재시도 대신 새 임대를 만듭니다.
- `STAGING_ACCESS_CLIENT_ID`와 `STAGING_ACCESS_CLIENT_SECRET`은 보호된 Staging을 읽기 위한 별도 Access service token이며 Cloudflare 배포 쓰기 토큰과 섞지 않습니다.
- 짧은 유효기간은 노출 시간을 줄일 뿐 프로젝트 단위 권한 경계를 만들지 않습니다. 진짜 Staging 격리를 위한 별도 Cloudflare 계정 전환은 아직 열린 항목입니다.

## 릴리스 경계

- Gate 0 실행 코드 기준 커밋: `7b661b25771e6ea84ccc4c1c4547a9caf5323d52`
- 운영 후보 기준: 보호된 `main`의 위 실행 코드와 후속 문서·운영 증거 변경
- 검증 기준: PR #8 병합 뒤 성공한 `Quality and security`와 `Deploy Staging` 실행
- Pull Request: [#8](https://github.com/haengjoo123/buril-lab/pull/8)
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
- [x] 과거 Staging 자동 workflow를 계정 범위 장기 토큰 위험 때문에 폐기하고, Staging·운영 모두 감독형 수동 임대 workflow와 `release.json` 전체 SHA 검증으로 전환
- [x] Cloudflare API의 전체 SHA, deployment UUID, 고유 URL을 함께 검증하도록 구현
- [x] `release:verify`는 유료 출시 차단 상태 유지, `ops:verify`를 별도 제공

PR #8 병합 SHA의 GitHub Actions에서 Application, Cloudflare release contract, Gate 0 browser, Blank database와 운영·Staging Hosted Advisor가 모두 통과했습니다. 전체 Vitest는 607개, Cloudflare 계약시험은 42개가 통과했습니다. 계획 작성 당시의 781개 수치는 현재 Gate 0 릴리스 조각과 시험 구성이 달라 같은 분모로 주장하지 않습니다. 후속 전체 snapshot의 수치도 운영 후보 증거로 사용하지 않습니다.

보안 권고 exact baseline 변경이 추가되면 PR 최신 SHA에서 네 필수 검사를 다시 통과해야 합니다. 이전 run의 성공만으로 새 SHA를 배포하지 않습니다.

## 완료한 DB·브라우저 준비 증거

- [x] 활성 마이그레이션을 운영 기준선 1개로 분리하고 이전 50개 SQL을 `legacy_migrations`에 보존
- [x] Supabase CLI `2.115.0`으로 빈 DB를 두 번 연속 재구성
- [x] 기준선 pgTAP RLS·GRANT 권한시험 11개 통과
- [x] 기준선 이력 도구를 `plan`, `apply`, `restore-legacy`로 분리
- [x] 운영 89개 이력과 정확히 일치하지 않으면 이력 정리를 중단하도록 구현
- [x] 기준선 SQL은 운영에 실행하지 않고 이력만 정리하도록 제한
- [x] 실제 Chromium Gate 0 흐름 통과: 로그인→연구실→재고 검색→폐액 배치 검토→화면 버튼 기록→기록 목록→직접 링크
- [x] 로컬 Gate 0에서는 보강 기능 OFF와 요청 0건 확인; 활성 Staging에서는 보강 시도 3건을 브라우저에서 모두 중단해 Pages API·유료 외부 공급자 도달 0건 확인
- [x] seed는 loopback DB만 허용하고 원격 URL을 client 생성 전에 거부
- [x] 운영·Staging 각각 53건의 Security Advisor 종류·대상·역할 권한을 정확한 기준선으로 고정하고 정적 검사 및 Supabase 플러그인 읽기 전용 대조 완료
- [x] GitHub environment별 Supabase 배포 입력 이름 등록; 실제 값은 공개 증거에 남기지 않음
- [x] Gate 0 실행 코드가 포함된 `main` SHA의 운영·Staging Hosted Advisor 검사 통과

## 완료한 외부 통제

- [x] 운영 Cloudflare Pages의 production·preview 자동 배포 중단
- [x] preview에 설정됐던 클라이언트 API 키 변수 3개 제거
- [x] 해당 키가 포함됐을 가능성이 있는 preview deployment 9개 제거
- [x] 운영 rollback용 production deployment는 보존
- [x] 빈 direct-upload Pages 프로젝트 `buril-lab-staging` 생성
- [x] `staging.burillab.com`을 `buril-lab-staging` Pages custom domain으로 연결
- [x] `BurilLab Staging` Access 앱에 custom domain, project `pages.dev`, preview wildcard를 등록하고 단일 `Emails` 허용 규칙 적용; 비인증 요청은 custom domain·project `pages.dev`·대표 preview hostname 모두 Access 로그인 경로로 302 응답
- [x] Staging 전용 Access service token과 해당 토큰 하나만 포함하는 `Service Auth` 정책 생성
- [x] Access service token 회전 후 GitHub `staging`·`production` environment에 같은 회전본의 비밀값 이름 등록; 활성 값은 공개 문서·저장소·GitHub 로그에 기록하지 않음
- [x] 회전본으로 custom domain·project `pages.dev` 인증 경계를 통과해 Pages 원점까지 도달함을 확인; 아직 배포가 없어 원점은 522를 반환
- [x] 실제 immutable deployment URL에서 회전한 Access service token 인증과 전체 SHA 확인
- [x] 운영·Staging 전용 runtime KV namespace 분리
- [x] 운영·Staging 전용 비공개 R2 백업 버킷 분리 및 30일 삭제 수명주기 설정; Bucket Lock과 실제 백업은 아직 미적용
- [x] 운영 runtime KV의 Gate 0 안전 스위치 기록
- [x] Staging runtime KV를 `redirect`, `link_only`, `false`, `false` 안전값으로 다시 확인
- [x] 실제 배포 뒤 KOSHA API가 `link_only` 계약과 공식 링크만 반환함을 검증
- [x] GitHub `staging`, `production` environment 생성 및 `main` 배포 브랜치 제한
- [x] GitHub 양쪽 environment에 Cloudflare 계정·Pages 배포·KV·Access·Supabase 입력 이름과 Gate 0 Staging 입력 이름 등록
- [x] 운영과 다른 Staging Upstash 생성, 분리된 자격값의 연결 시험 성공; 활성 값은 기록하지 않음
- [x] `buril-lab` Google Cloud 프로젝트에 Vision 전용 키와 서비스 계정에 바인드된 Gemini 전용 키를 발급하고 실제 API 인증 성공; Cloudflare 운영 설정에는 다음 배포용 암호값으로 등록
- [x] 과거 공개 Gemini 키가 Google에서 `API_KEY_INVALID`임을 확인하고 GitHub secret-scanning 경고를 `revoked`로 해결
- [ ] 아직 유효한 과거 공개 Vision 키는 새 운영 비밀값이 실제 배포에 반영된 직후 폐기하고 남은 GitHub 경고를 해결
- [x] 운영·Staging Supabase 프로젝트가 다른 프로젝트인지 확인

GitHub environment 등록은 값이 존재한다는 증거일 뿐 Cloudflare Pages Functions의 암호값이나 외부 공급자 프로젝트가 올바른 Staging 대상을 가리킨다는 증거는 아닙니다. `ops:verify`, Access 인증 요청, 실제 Staging API smoke test가 모두 통과하기 전 배포 workflow를 실행하지 않습니다.

## Staging 최초 합성 초기화 당시 익명 증거

Supabase 플러그인으로 2026-08-25 최초 초기화 직후 행 수와 합성 소유 표시 여부만 조회했습니다. 아래 수치는 현재 행 수가 아니며, 이후 Gate 0 반복검사에서 합성 폐기 기록이 추가됐습니다. 사용자 정보, 연구실명, 시약명, 파일 경로는 읽거나 저장하지 않았습니다.

| 대상 | 행 수 |
|---|---:|
| `labs` | 1 |
| `lab_members` | 1 |
| `inventory` | 1 |
| `cabinets` | 0 |
| `cabinet_items` | 0 |
| `waste_logs` | 0 |
| `waste_log_items` | 0 |
| `audit_logs` | 0 |
| Storage objects | 0 |

Staging에는 예약 UUID를 사용하는 Gate 0 합성 연구실·회원·재고만 남아 있고, 합성 사용자의 신뢰된 소유 표시도 확인했습니다. 이메일, 사용자 UUID, 연구실명, 시약명, 파일 경로는 공개 증거에 기록하지 않습니다. 데이터 초기화는 완료됐지만 실제 배포 검증 환경 통과를 뜻하지 않습니다.

Security Advisor는 2026-08-25에 운영과 Staging 각각 53건(정보 6, 경고 47)을 다시 읽기 전용으로 확인했습니다. 두 환경 모두 저장소에 고정한 53개 식별자와 정확히 일치했습니다. 숫자만 허용하지 않고 각 권고의 종류·대상·함수 언어·실제 역할 권한·임시 허용 사유를 고정했으며, 새 차이는 실패로 처리합니다.

## 아직 닫지 않은 항목

- [x] Gate 0 실행 코드 SHA의 모든 필수 품질검사 성공
- [x] Cloudflare Access로 `staging.burillab.com`, `buril-lab-staging.pages.dev`, `*.buril-lab-staging.pages.dev`를 보호하고 세 경계의 비인증 요청 302 확인
- [x] Staging 전용 Access service token과 토큰별 `Service Auth` 정책을 만들고 GitHub `staging` environment에 두 Access 비밀값 등록
- [x] 운영과 다른 Staging Upstash 준비와 연결 시험
- [x] GitHub `staging`·`production` environment의 배포 입력 이름·필수 변수 등록
- [x] Cloudflare Pages Staging의 필수 Functions 암호값 12개를 모두 암호 형식으로 등록하고 `ops:verify` 통과; KOSHA 키는 `link_only` 계약에 따라 의도적으로 미등록
- [x] 회전한 Access service token으로 보호된 custom domain과 project `pages.dev` 경계 통과
- [x] Staging용 OpenAI·Google AI 키를 별도 프로젝트와 사용량 제한으로 분리하고 실제 인증 요청 성공
- [ ] 새 운영 Google 키가 적용되는 다음 운영 배포 직후 과거 공개 유출 키를 폐기하고 GitHub 경고 해결
- [x] Staging의 익명 집계 증거 보존 후 Gate 0 합성 데이터로 초기화하고 신뢰된 합성 소유 표시 확인
- [x] Staging KV의 KOSHA 모드를 실제 `link_only`로 확인
- [x] 배포 뒤 API가 공식 링크만 반환하는지 검증
- [x] 같은 커밋 SHA의 Staging 배포 및 고유 URL `release.json` 검증
- [ ] Staging에서 실제 외부 화학정보 연동시험
- [ ] 현재 보안 강화 SHA의 공개키 고정, PR 품질검사, 감독형 Staging 배포와 되돌림 재훈련
- [ ] 누적 32회 이전에 과거 영수증 해시와 run 경계를 보존하는 epoch rollover 설계
- [x] 직전 Pages deployment 실제 되돌림과 원래 후보 복귀 훈련
- [ ] 운영 쓰기와 일관된 복구 시점을 만들 수 있는 비공개 R2 사진 본문·완전한 manifest·해시 준비
- [x] Supabase 조직 접근자 확인 — 2026-08-24 23:32 KST: 현재 구성원 1명, 역할 `Owner`, 권한 범위 `organization-scoped`를 읽기 전용으로 확인했고 사용자가 해당 구성원의 BurilLab 운영 데이터 열람 권한을 명시 확인함; 공개 증거에는 이메일·조직 ID를 기록하지 않음
- [ ] Supabase 플러그인이 반환한 새 프로젝트 비용 `월 10달러`를 사용자에게 알리고 명시적 비용 확인
- [ ] 임시 Micro 프로젝트에서 4시간 이내 논리 복구훈련 후 24시간 안에 삭제
- [ ] Gate 0 운영 수동 배포
- [ ] 운영 배포 뒤 30분·24시간·7일 관찰

[Pages 되돌림 훈련](./pages-rollback-drill.md)은 Staging 실제 실행 증거를 포함합니다. [Supabase 복구훈련](./supabase-recovery-drill.md)은 아직 실행하지 않은 절차서이며 완료 증거가 아닙니다.

조직 접근자 확인은 위 시점의 증거입니다. 임시 복구 프로젝트 생성 직전에 구성원 수·역할·권한 범위를 다시 확인하고 달라졌으면 운영 DB 읽기와 프로젝트 생성을 중단합니다.

## 현재 금지 상태

- 운영 Pages 코드 배포 금지
- 운영 Supabase migration 또는 기준선 SQL 실행 금지
- 새 실행 코드 SHA의 필수 검사가 모두 성공하기 전 Staging 배포 금지
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
