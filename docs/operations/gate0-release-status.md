# Gate 0 운영 배포 상태

기준 시각: 2026-08-24 18:06 KST

이 문서는 코드 준비와 실제 운영 배포를 구분합니다. 체크되지 않은 관문은 완료로 해석하지 않습니다.

## 릴리스 경계

- 기준 커밋: `bf8dcc726061f0e89bc8fbf39e63e1db8e90e2b2`
- 운영 후보 브랜치: `codex/ops-hardening`
- 전체 후속 구현 보존 커밋: `3b30751bc24ae955be6ab2abb73ff75d30178ec0`
- 전체 후속 구현 보존 커밋은 운영 배포 대상이 아닙니다.
- Gate 0 운영 후보에는 즉시 위험 차단, 최소 배포 통제, DB 기준선 재구성 경로만 포함합니다.

## 완료한 외부 통제

- [x] 운영 Cloudflare Pages의 production·preview 자동 배포 중단
- [x] preview에 설정됐던 클라이언트 API 키 변수 3개 제거
- [x] 해당 키가 포함됐을 가능성이 있는 preview deployment 9개 제거
- [x] 빈 direct-upload Pages 프로젝트 `buril-lab-staging` 생성
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

## 아직 닫지 않은 항목

- [ ] `codex/ops-hardening`의 전체 품질검사 성공
- [ ] 빈 DB에서 기준선 2회 연속 재구성
- [ ] 기준선 RLS·GRANT 권한시험 성공
- [ ] GitHub PR 품질검사 성공 및 `main` 필수 검사 보호
- [ ] Cloudflare Access로 `staging.burillab.com`, `buril-lab-staging.pages.dev`, `*.buril-lab-staging.pages.dev`를 각각 보호
- [ ] 운영과 다른 Staging Upstash 준비
- [ ] GitHub environment별 Pages·Supabase·KV·Access 비밀값 등록
- [ ] 제거한 외부 API 키 3개의 공급자 측 회전
- [ ] Staging의 현재 집계 증거 보존 후 합성 데이터로 초기화
- [ ] 같은 커밋 SHA의 Staging 배포 및 `release.json` 검증
- [ ] 로그인→연구실→검색→폐액 배치 검토→기록 조회 브라우저 흐름
- [ ] 직전 Pages deployment 되돌림 훈련
- [ ] Supabase 조직 접근자 확인
- [ ] Supabase 플러그인이 반환한 새 프로젝트 비용 `월 10달러`를 사용자에게 알리고 명시적 비용 확인
- [ ] 임시 복구 프로젝트에서 4시간 이내 복구훈련 후 24시간 안에 삭제
- [ ] Gate 0 운영 수동 배포
- [ ] 운영 배포 뒤 30분·24시간·7일 관찰

## 현재 금지 상태

- 운영 Pages 코드 배포 금지
- 운영 Supabase migration 또는 기준선 SQL 실행 금지
- custom domain, `pages.dev` apex, preview wildcard 세 경계의 Staging Access와 별도 Redis가 준비되기 전 Staging 배포 금지
- 음성 `guided` 운영 전환 금지
- 계정·연구실 삭제 UI와 Scheduler 활성화 금지
- 시약장 사진 이관·원본 삭제 금지
- Storage 백업 Worker 활성화 금지
- SDS·바코드·알림·보고서·파일럿·유료 출시 기능 반영 금지

## 남은 수용 위험

일일 백업을 유지하므로 평상시 최근 복구 가능 시점은 최대 약 24시간 전일 수 있습니다. 이번 작업으로 RPO 1시간 관문은 닫지 않습니다.

Supabase 공식 계산 기준에서 Micro는 시간당 0.01344달러이고, 일부 시간도 한 시간으로 청구되며 삭제하면 그 이후 과금이 멈춥니다. 24시간 안에 삭제하면 예상 Compute 사용료는 약 0.32256달러지만, 프로젝트 생성 확인 API는 비용 계약을 월 10달러로 반환합니다. 생성 전에는 더 큰 표시값인 월 10달러를 기준으로 명시적 확인을 받습니다.
