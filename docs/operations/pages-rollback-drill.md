# Cloudflare Pages 되돌림 훈련 절차

상태: **Staging 훈련 완료 — 운영에서는 실행하지 않음**

이 문서는 Staging Pages 프로젝트에서 이전의 정상 배포본으로 되돌린 뒤, 원래의 검증된 배포본으로 복구하는 실제 훈련 기록입니다. `buril-lab` 운영 프로젝트, 운영 Supabase, 운영 KV에는 변경을 가하지 않았습니다.

Cloudflare Pages는 성공한 production 배포만 되돌림 대상으로 사용할 수 있습니다. 동작 기준은 [Cloudflare Pages Rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/)입니다.

## 최신 실행 증거

2026-08-26 KST에 Cloudflare Dashboard에서 정확히 `buril-lab-staging` 프로젝트만 선택해 아래 순서로 훈련했습니다.

1. 현재 Staging 배포 `e8ecd58d-4b06-4418-8a63-bc1f2c7fef8d`를 이전 정상 배포 `2f1af91b-4269-4964-b983-b6a4100dd8b2`로 전환했습니다.
2. [되돌림 검증 workflow #32896389408](https://github.com/haengjoo123/buril-lab/actions/runs/32896389408)이 성공했습니다.
3. 원래 Staging 배포 `e8ecd58d-4b06-4418-8a63-bc1f2c7fef8d`로 복구했습니다.
4. [복구 검증 workflow #32896640768](https://github.com/haengjoo123/buril-lab/actions/runs/32896640768)이 성공했습니다.

두 workflow는 custom domain과 고유 Pages 배포 주소를 각각 검사했습니다. Access 보호, `/release.json`의 전체 커밋 SHA, 로그인 → 연구실 → 검색 → 폐액 배치 → 화면의 최종 기록 → 직접 링크(Gate 0) 흐름을 모두 확인합니다. 시험용 합성 fixture만 Staging에 다시 만들며, 운영 데이터에는 접근하지 않습니다.

## 대상 식별값

| 단계 | Pages 프로젝트 | deployment ID | 앱 전체 SHA | 결과 |
|---|---|---|---|---|
| 훈련 시작 배포 | `buril-lab-staging` | `e8ecd58d-4b06-4418-8a63-bc1f2c7fef8d` | `5c7e385cceb62171ce9614410f14a716eeecbc85` | 성공 |
| 되돌림 대상 | `buril-lab-staging` | `2f1af91b-4269-4964-b983-b6a4100dd8b2` | `7b661b25771e6ea84ccc4c1c4547a9caf5323d52` | 성공 |
| 최종 복구 배포 | `buril-lab-staging` | `e8ecd58d-4b06-4418-8a63-bc1f2c7fef8d` | `5c7e385cceb62171ce9614410f14a716eeecbc85` | 성공 |

검증 workflow 자체는 보호된 `main`의 `a4584c9a8f4ba4b40c0d4b72d3da7e436351ada6`에서 실행됐습니다. 이 커밋은 검증 절차를 추가한 것이며, Pages 앱 배포본의 SHA와는 별개입니다.

## 실행 전 중단 조건

- 대상 프로젝트가 정확히 `buril-lab-staging`인지 확인한다. `buril-lab`은 어떤 경우에도 대상이 아니다.
- 두 대상이 모두 성공한 Pages production 배포인지, deployment UUID와 전체 앱 SHA가 정확히 일치하는지 확인한다.
- 대상의 고유 Pages URL과 `staging.burillab.com`이 모두 Cloudflare Access로 보호되는지 확인한다.
- 되돌림 전 원래 후보와 되돌림 대상의 고유 URL에서 각각 `release.json`을 검증한다.
- Staging 검증에 운영 Supabase, 운영 Redis, 운영 R2, 운영 KV가 쓰이지 않음을 확인한다.
- 다른 Staging 배포나 검증이 동시에 진행 중이면 중단한다.

하나라도 맞지 않으면 되돌림을 실행하지 않습니다. 대표 도메인이나 짧은 SHA만으로 대상을 고르지 않습니다.

## 실제 검증 범위

두 workflow는 아래 항목을 순서대로 통과했습니다.

- 보호된 `main`에서만 실행되는 확인문구·UUID·전체 SHA 검증
- 대상 앱 SHA가 신뢰할 수 있는 `main` 이력인지 확인
- custom domain과 고유 Pages URL의 Access 보호 확인
- 두 URL의 `/release.json`이 기대한 전체 앱 SHA와 같은지 확인
- custom domain의 Gate 0 합성 fixture 재설정 및 브라우저 흐름
- 고유 Pages URL의 Gate 0 합성 fixture 재설정 및 브라우저 흐름
- 비밀값, 사용자 정보, 원시 API 응답을 남기지 않는 실행 증거 기록

되돌림 상태 검증은 2026-08-26 05:37~05:39 KST에 성공했고, 복구 상태 검증은 05:40~05:41 KST에 성공했습니다.

## 최종 결과

| 항목 | 결과 |
|---|---|
| 이전 정상 배포로 전환 | 성공 |
| 되돌림 상태 custom domain Gate 0 | 성공 |
| 되돌림 상태 고유 Pages URL Gate 0 | 성공 |
| 원래 검증 배포로 복구 | 성공 |
| 복구 후 custom domain Gate 0 | 성공 |
| 복구 후 고유 Pages URL Gate 0 | 성공 |
| 최종 Pages deployment ID | `e8ecd58d-4b06-4418-8a63-bc1f2c7fef8d` |
| 최종 앱 전체 SHA | `5c7e385cceb62171ce9614410f14a716eeecbc85` |
| 운영 Pages·DB·KV 변경 | 0건 |

## 되돌림 원칙

- 웹 문제는 검증된 이전 Pages deployment로만 되돌린다.
- DB 구조·데이터, KV 값, R2 파일, Redis 상태와 외부 호출은 Pages 되돌림으로 되돌아가지 않는다. 이들이 원인일 때는 별도 복구 절차를 쓴다.
- 되돌림 뒤에는 대표 Staging 주소와 고유 Pages URL을 모두 확인한다.
- 원래 후보 배포도 독립적으로 검증한 뒤에만 복구한다. 복구에 실패하면 새 배포를 만들지 않고, 가장 최근 검증된 배포를 유지한다.
- 운영에서 같은 절차를 사용할 때는 운영용 확인문구와 별도 운영 승인·관찰 절차를 적용한다.

저장소에는 deployment ID, 전체 SHA, workflow 결과처럼 공개 가능한 증거만 남깁니다. Access token, API token, 환경 비밀값, 사용자 정보, 원시 로그와 API 응답은 기록하지 않습니다.
