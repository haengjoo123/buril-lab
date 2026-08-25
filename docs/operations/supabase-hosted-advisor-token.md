# Supabase Hosted Advisor 임시 토큰 절차

## 목적과 현재 제한

Hosted Supabase Advisor 검사는 실제 Staging 또는 운영 프로젝트의 현재 상태를 읽습니다. 이 검사는 PR·`main` 자동 품질검사에서 분리하고, 배포 후보를 확인할 때만 수동으로 실행합니다. 자동 품질검사에는 비밀값이 필요 없는 고정 Advisor 기준선 검사만 남깁니다.

2026-08-25 현재 BurilLab 계정의 새 토큰 화면은 이름과 만료만 선택할 수 있고, 토큰이 계정 전체를 제어할 수 있다는 경고를 표시합니다. 따라서 여기서 말하는 임시 PAT는 **프로젝트 제한 토큰이 아닙니다**. GitHub의 `staging`·`production` 환경에 장기간 저장하지 않으며, 한 번의 검사 직후 반드시 삭제하고 Supabase에서도 폐기합니다.

Supabase가 제한형 PAT를 이 계정에 제공하더라도 곧바로 운영에 사용하지 않습니다. Staging에서 CLI와 필요한 읽기 권한이 실제로 동작하는지 먼저 확인한 뒤 별도 변경으로 전환합니다.

## 실행 전 조건

- 검사할 커밋은 현재 `main`의 정확한 40자리 소문자 SHA여야 합니다.
- 그 SHA의 `Quality and security` 실행이 성공해야 합니다.
- `staging`과 `production`에는 장기 `SUPABASE_ACCESS_TOKEN`을 두지 않습니다.
- `SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN`이 이미 남아 있으면 새 검사를 시작하지 않고, 소유자와 생성 사유부터 확인합니다.
- Staging과 운영은 서로 다른 PAT를 사용합니다. 두 검사가 며칠 떨어져 있으면 같은 토큰을 계속 보관하지 않습니다.

## 한 번의 검사 절차

1. 실제 토큰 생성 직전에 사용자 확인을 받습니다.
2. Supabase에서 검사 환경과 실행 시점을 알아볼 수 있는 이름으로 PAT를 만들고, 화면이 허용하는 가장 이른 만료를 선택합니다. `Never`는 선택하지 않습니다.
3. 토큰을 명령행 인수, 파일, 로그, 클립보드 기록에 남기지 않습니다. 표준입력으로만 선택한 GitHub 환경의 `SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN` secret에 전달합니다.
4. `Hosted Supabase advisor attestation` workflow를 `main`에서 실행합니다.
   - `environment`: `staging` 또는 `production`
   - `commit_sha`: 현재 `main`의 정확한 SHA
   - `confirmation`: `ATTEST SUPABASE ADVISOR <environment> <SHA> WITH EPHEMERAL TOKEN`
5. workflow는 정확한 `main` SHA와 성공한 품질검사를 다시 확인한 뒤, 토큰을 오직 Hosted Advisor 검증 단계에만 전달합니다.
6. 성공·실패·취소·시간초과와 관계없이 즉시 다음 두 작업을 모두 수행합니다.
   - 선택한 GitHub 환경에서 `SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN` 삭제
   - Supabase 계정에서 해당 PAT 폐기
7. 공개 증거에는 환경, 커밋 SHA, GitHub 실행 ID, 결과, secret 삭제 시각, PAT 폐기 시각만 남깁니다. 토큰 값이나 일부 문자열은 남기지 않습니다.

두 정리 작업 중 하나라도 확인되지 않으면 해당 환경의 다음 검사와 배포를 중단합니다.

## 배포 관문 연결

배포 workflow는 다음 값만 전달해 읽기 전용 검증기를 호출합니다.

```text
GITHUB_TOKEN=<workflow token>
GITHUB_REPOSITORY=haengjoo123/buril-lab
DEPLOY_COMMIT_SHA=<배포할 현재 main SHA>
DEPLOY_ENVIRONMENT=staging|production
node scripts/verify-github-supabase-advisor-run.mjs
```

검증기는 다음을 모두 만족하는 가장 최근 실행만 인정합니다.

- 수동 `workflow_dispatch`
- 공식 BurilLab 저장소와 `main`
- 배포할 SHA와 정확히 같은 커밋
- 배포할 환경과 정확히 같은 실행 제목
- 성공으로 끝난 실행
- 생성·시작·완료 시각이 모두 24시간 이내

같은 환경·SHA의 더 최근 실행이 대기 중이거나 실패·취소됐다면 과거 성공 기록으로 대신 통과할 수 없습니다.

## 공식 근거

- [Supabase Management API 인증](https://supabase.com/docs/reference/api/introduction): 일반 PAT는 사용자 계정과 같은 권한을 가지며 만료를 설정할 수 있습니다.
- [Supabase PAT 만료와 사용 기록](https://supabase.com/changelog/38248-personal-access-tokens-expiration-usage-tracking): 만료일과 사용 시각 추적을 지원합니다.
- [제한형 PAT 순차 제공 안내](https://github.com/orgs/supabase/discussions/48717): 제한형 PAT는 순차 제공 중이며 기존 계정 수준 토큰과 구분됩니다.
