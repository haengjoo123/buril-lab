# Cloudflare Pages 되돌림 훈련 절차

상태: **절차만 준비됨 — 아직 실행하지 않음**

이 문서는 Staging Pages 프로젝트에서 직전 성공 배포로 되돌리고 다시 원래 후보 배포로 복귀하는 훈련 체크리스트입니다. 운영 배포를 실행하거나 운영 프로젝트를 되돌렸다는 증거가 아닙니다.

Cloudflare Pages는 성공한 production 배포만 되돌림 대상으로 사용할 수 있습니다. 공식 동작은 [Cloudflare Pages Rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/)와 [Pages Deployments API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/)를 기준으로 합니다.

현재 구성 증거(2026-08-24): `BurilLab Staging` Access 앱의 세 destination과 단일 `Emails` 허용 규칙을 확인했고, 비인증 요청은 custom domain·project `pages.dev`·대표 preview hostname에서 모두 Access 로그인 경로로 302 응답했습니다. 1년 유효기간의 Staging 전용 service token과 그 토큰 하나만 포함하는 `Service Auth` 정책도 적용했습니다. 서비스 토큰 요청은 세 경계 모두 Access를 통과했으며, 아직 Pages 배포물이 없어 원본 단계에서 522 응답했습니다. 이는 Access 정책 통과 증거일 뿐 실제 배포물이나 `release.json` 자동 검증 성공 증거가 아닙니다. 두 인증값은 GitHub `staging` environment의 `STAGING_ACCESS_CLIENT_ID`, `STAGING_ACCESS_CLIENT_SECRET`에 저장했고 공개 증거에는 이름만 기록합니다. GitHub `production` environment 등록은 아직 하지 않았고 허용 이메일 값도 기록하지 않습니다. 이는 현재 경계 보호 증거이며 되돌림 훈련 완료 증거가 아니므로 실행 시 아래 항목을 다시 확인합니다.

## 실행 전 중단 조건

- [ ] 대상은 정확히 `buril-lab-staging`이며 `buril-lab`이 아님
- [ ] Cloudflare Access가 custom domain, project `pages.dev`, preview wildcard를 모두 보호함
- [ ] 서로 다른 성공한 Pages production 배포가 최소 2개 있음
- [ ] 두 배포의 전체 Git SHA가 서로 다름
- [ ] 현재 후보와 직전 성공 배포의 전체 Git SHA를 Cloudflare API로 확인함
- [ ] 두 배포의 UUID와 고유 배포 URL을 확인함
- [ ] 두 고유 URL의 `release.json`이 각각 기대한 전체 SHA와 일치함
- [ ] 현재 Pages 프로젝트 제어면을 `ops:verify`로 검사해 Staging 전용 환경 변수·KV binding만 사용함
- [ ] 두 배포의 API metadata에 존재하는 불변 식별자·전체 SHA·분기·환경·성공 상태를 검증함; 과거 deployment 응답에 binding 스냅샷이 없으면 있다고 추정하지 않음
- [ ] 두 고유 URL의 HTML·참조된 JS를 메모리에서 검사해 운영 Supabase ref·운영 API origin·금지된 클라이언트 키 패턴이 0건임
- [ ] 두 배포의 실제 요청이 Staging Supabase·Redis·R2만 향함을 격리된 smoke test로 확인함
- [ ] 되돌림 권한이 있는 Cloudflare 토큰과 Access service token을 현재 프로세스의 비공개 환경에만 준비함
- [ ] 훈련 시간 동안 Staging 검증을 멈춘다는 확인문구를 기록함

하나라도 맞지 않으면 되돌림 API를 호출하지 않습니다. 대표 도메인이나 짧은 SHA만으로 대상을 고르지 않습니다.

## 1. 시작 증거

| 항목 | 기록값 |
|---|---|
| 시작 시각(KST) | 미기록 |
| Pages 프로젝트 | `buril-lab-staging` |
| 현재 후보 전체 SHA | 미기록 |
| 현재 후보 deployment ID | 미기록 |
| 되돌릴 전체 SHA | 미기록 |
| 되돌릴 deployment ID | 미기록 |
| 실행자 확인문구 | 미기록 |

저장소에는 위 값과 시험 결과만 남깁니다. API 토큰, Access service token, 계정 ID, 환경 비밀값, 응답 본문, 원본 로그는 남기지 않습니다. Pages project·deployment·rollback API 응답은 환경 설정을 포함할 수 있으므로 원문 JSON을 터미널·파일·GitHub artifact에 출력하거나 저장하지 않습니다. 승인된 검증기가 메모리에서 필요한 필드만 골라 `success`, project name, environment, deployment ID, 전체 SHA, stage status만 기록합니다. 토큰을 URL, 명령행 인자, query string에 넣지 않고 verbose curl을 사용하지 않습니다.

## 2. 되돌림 직전 확인

- [ ] 현재 후보 고유 URL의 `/release.json`이 후보 SHA와 일치함
- [ ] 대표 Staging 주소의 `/release.json`이 후보 SHA와 일치함
- [ ] 현재 후보 deployment metadata와 배포된 JS의 환경 격리 검사가 통과함
- [ ] Gate 0 브라우저 흐름이 현재 후보에서 통과함
- [ ] 되돌릴 직전 배포의 고유 URL에서 동일한 Gate 0 브라우저 흐름과 환경 격리 검사가 먼저 통과함
- [ ] 되돌릴 배포에서도 음성 폐기는 `redirect`이고 위험한 행동 지침이 0건임
- [ ] 음성 폐기는 `redirect`임
- [ ] KOSHA 설정 장애 시 `link_only`로 닫힘
- [ ] 계정 삭제·maintenance worker·storage backup이 OFF임
- [ ] 현재 시각과 검증 결과를 기록함

## 3. 직전 성공 배포로 되돌리기

Cloudflare Dashboard 또는 공식 Pages rollback API에서 **확인한 deployment UUID**를 대상으로 사용합니다. API 호출 시 계정과 프로젝트 이름을 문자열 조합으로 추측하지 않고, 사전 조회한 정확한 값을 사용합니다. API를 쓰면 토큰을 환경에서 읽는 승인된 도구만 사용하고, 원문 응답은 터미널·파일·GitHub artifact에 남기지 않으며 허용 필드만 검증합니다.

- [ ] 대상 deployment가 성공한 Pages production 배포인지 마지막으로 확인함
- [ ] 대상 전체 SHA가 기대한 직전 SHA와 일치함
- [ ] `buril-lab-staging` 확인문구를 입력함
- [ ] 되돌림 요청이 성공함
- [ ] 대표 Staging 주소가 대상 deployment를 가리킬 때까지 제한된 횟수로 확인함
- [ ] 대표 주소의 `/release.json`이 직전 전체 SHA와 일치함
- [ ] 되돌린 deployment metadata와 배포된 JS의 환경 격리 검사가 다시 통과함
- [ ] 되돌림 소요 시간을 기록함

## 4. 되돌림 상태 검사

- [ ] 로그인→연구실→검색→폐액 배치 검토→기록→직접 링크가 통과함
- [ ] 음성 폐기 행동 지침 0건
- [ ] 연구실 전환 실패 후 이전 연구실 자료 0건
- [ ] 브라우저 콘솔 오류와 Pages 5xx를 확인함
- [ ] 대표 주소와 고유 배포 URL의 SHA 관계를 기록함

핵심 확인이 두 번 연속 실패하거나 위험한 음성 응답, 인증 우회, 연구실 간 노출, 비밀값 노출이 한 건이라도 있으면 Cloudflare Access로 Staging 사용을 즉시 차단하고 원인을 기록합니다. 원래 후보가 독립적으로 안전하게 재검증된 경우에만 그 후보로 복귀하며, 아니면 가장 최근의 검증된 배포를 선택하고 차단을 유지합니다.

## 5. 원래 후보 배포로 복귀

원래 후보도 성공한 Pages production 배포이며 전체 SHA·deployment UUID·고유 URL 검증이 유지되는지 다시 확인합니다.

- [ ] 후보 deployment가 여전히 성공 상태임
- [ ] 후보 고유 URL의 `/release.json`이 후보 전체 SHA와 일치함
- [ ] 후보 deployment metadata와 배포된 JS의 환경 격리 검사가 다시 통과함
- [ ] 공식 rollback 동작으로 후보 deployment를 다시 선택함
- [ ] 대표 Staging 주소의 `/release.json`이 후보 전체 SHA와 일치함
- [ ] Gate 0 브라우저 흐름을 다시 실행해 통과함
- [ ] 최종 runtime 안전 스위치를 확인함
- [ ] 최종 Pages deployment ID와 종료 시각을 기록함

후보로 복귀할 수 없으면 새 운영 배포를 만들지 않습니다. Staging을 가장 최근의 검증된 배포에 두고 Access 차단을 유지한 채 원인과 후속 조치를 기록합니다.

## 통과 판정

다음을 모두 만족해야 “Pages 되돌림 훈련 완료”로 표시합니다.

- 직전 성공 배포로 되돌림 성공
- 전환 전 직전 배포의 고유 URL에서 Gate 0·환경 격리 검사 성공
- 대표 주소의 전체 SHA 검증 성공
- 되돌림 상태의 Gate 0 브라우저 흐름 성공
- 원래 후보 배포로 복귀 성공
- 복귀 후 전체 SHA와 Gate 0 브라우저 흐름 재검증 성공
- 운영 Pages·운영 DB·운영 KV 변경 0건
- 저장소에 토큰·원본 로그·사용자 정보 0건

실제 운영에서 웹 문제가 발생하면 검증된 직전 운영 deployment로 같은 절차를 적용하되, 한 주 한 묶음 원칙과 운영 확인문구를 별도로 요구합니다.

Pages 되돌림은 웹 배포만 바꿉니다. Supabase 데이터·마이그레이션, KV 값, R2 파일, Redis 상태와 이미 발생한 외부 호출은 되돌리지 않습니다. 이 상태 중 하나가 원인일 수 있으면 Pages 되돌림만으로 복구됐다고 판정하지 않고 해당 시스템의 별도 절차를 사용합니다.

JSON 404/405, API 보안 헤더, canonical 308, HSTS 검사는 운영 2 묶음에서 추가합니다. 현재 Gate 0 되돌림 훈련의 통과조건으로 사용하지 않습니다.
