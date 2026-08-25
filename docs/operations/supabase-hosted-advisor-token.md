# 배포용 임시 자격증명 절차

## 목적과 안전 경계

Hosted Supabase Advisor와 Cloudflare 배포는 실제 Staging 또는 운영 환경을 읽거나 바꿉니다. 현재 Supabase PAT와 Cloudflare Pages·Workers 토큰은 BurilLab 프로젝트 하나에만 완전히 제한되지 않으므로 GitHub에 장기 보관하지 않습니다.

한 번의 감독형 배포에만 쓰는 자격값을 만들고 다음 순서로 폐쇄합니다.

1. 로컬 Windows 계정의 DPAPI로 보호된 Ed25519 개인키가 짧은 임대와 중단 표식을 서명합니다.
2. 공개키만 저장소에 고정합니다. 개인키와 토큰 원문은 저장소·명령행·파일·로그에 넣지 않습니다.
3. 토큰은 숨김 입력으로 받아 해당 GitHub environment에만 잠시 등록합니다.
4. 실행이 성공·실패·취소되더라도 GitHub에서 제거하고 공급자에서 폐기합니다.
5. 공급자 비활성과 GitHub 부재가 모두 확인된 뒤에만 누적 정리 영수증을 서명합니다.

Staging 자동 배포 대신 감독형 수동 실행을 쓰는 것은 의도된 변경입니다. Cloudflare 쓰기 권한이 계정 범위이기 때문에 품질검사 성공만으로 자격값을 자동 발급하지 않습니다.

## 실행 전 조건

- 배포 커밋은 현재 보호된 `main`의 정확한 40자리 SHA여야 합니다.
- 같은 SHA의 `Quality and security` 실행이 성공해야 합니다.
- 저장소 범위에는 임시 secret이나 배포 상태 변수를 두지 않습니다. 같은 이름의 저장소 값이 environment 값의 대체값으로 쓰일 수 있으므로 감독기가 시작 전과 정리 후 모두 거부합니다.
- `staging`과 `production`은 서로 다른 Supabase PAT와 Cloudflare 토큰을 씁니다.
- `EPHEMERAL_PROVIDER_CREATION_PENDING`이 있으면 새 임대를 시작하지 않습니다.
- 누적 영수증은 실제로 두 자격 관문을 모두 통과한 첫 번째 실행만 셉니다. 서명 전 실패나 cleanup 관문 실패 실행은 자격값 사용 실행으로 기록하지 않습니다.
- 누적 32회에 도달하면 새 자격값을 만들기 전에 중단합니다. 다음 epoch 전환은 과거 영수증 해시와 실행 경계를 별도로 검토한 변경으로 진행합니다.
- workflow의 `Re-run`은 금지합니다. 새 임대 ID로 새 실행을 만듭니다.

## 로컬 서명키

최초 한 번만 다음 명령으로 키를 준비합니다.

```text
node scripts/provision-ephemeral-release-key.mjs
```

이 명령은 사용자 확인 후에만 실행합니다. 개인키는 현재 Windows 사용자만 복호화할 수 있도록 저장소 밖에 보관하고, 생성된 공개키와 검토된 SHA-256 지문만 저장소에 고정합니다. 공개키가 없거나 지문이 달라지면 CI와 감독형 배포가 실패해야 합니다.

현재 고정된 공개키의 SHA-256 지문은 `b5fc8397c8eeb2e2a16b1ffc0feb0b0563f76302ee7b78c08b754651ae455cb2`입니다. 개인키 경로와 원문은 문서·저장소·로그에 기록하지 않습니다.

## 초기 정리 기준선

처음 한 번은 Cloudflare와 Supabase 화면에서 과거 배포 자격값이 없음을 확인한 뒤 `bootstrap`을 실행합니다.

```text
node scripts/supervise-ephemeral-release.mjs bootstrap --environment staging
node scripts/supervise-ephemeral-release.mjs bootstrap --environment production
```

초기 기록은 공급자 API가 과거에 잃어버린 토큰 원문을 검증한 결과가 아니라 `operator_dashboard_attestation`입니다. 따라서 외부 자동 검증 완료라고 표현하지 않습니다. 입력한 공개 가능한 토큰 식별자 해시와 정확한 확인문구를 서명해 남깁니다.

## 감독형 Staging 배포

실제 토큰 생성 직전에 별도 확인을 받고 다음 형식으로 시작합니다.

```text
node scripts/supervise-ephemeral-release.mjs deploy \
  --environment staging \
  --commit <현재 main 전체 SHA> \
  --storage-backup false \
  --cloudflare-account-id <정확한 계정 ID>
```

감독기는 다음을 자동으로 처리합니다.

- 기존 서명 영수증, 저장소·environment 범위 부재, 32회 epoch 여유를 먼저 확인
- 새 임대 ID와 정해진 Supabase PAT 표시 이름 생성
- 토큰 생성 안내 전에 서명된 `EPHEMERAL_PROVIDER_CREATION_PENDING`을 저장하고 정확히 다시 읽어 확인
- Supabase PAT가 대상 프로젝트를 읽을 수 있는지 확인
- Cloudflare 토큰의 활성 상태와 남은 시간을 확인
- 실제 Supabase PAT 값의 SHA-256, PAT 표시 이름 해시, Cloudflare 토큰 ID 해시를 임대에 함께 서명
- 비밀값을 environment secret에 표준입력으로 등록
- GitHub가 반환한 정확한 실행 URL의 run ID를 고정하고, URL이 없을 때만 시작 시각 이후 단 하나의 일치 실행을 허용
- 공급자 생성 대기, 임대 생성, dispatch 의도, exact run 결합, 두 자격값 관문 통과, cleanup 영수증 저장을 서명된 단계 일지에 차례로 기록
- 실행 뒤 모든 GitHub 자격값 삭제를 끝까지 시도하고 최종 목록으로 부재 확인
- Cloudflare는 `disabled`·`expired` 또는 인증 불가 상태, Supabase는 Management API `401`을 확인
- lease 관문과 누적 cleanup 관문이 모두 성공한 실행만 v3 누적 영수증에 추가

`storage-backup=true`는 OFF-only Staging Worker를 명시적으로 배포할 때만 사용합니다. Workers Paid 활성화나 실제 백업 실행을 승인하지 않습니다.

## 감독형 운영 배포

운영은 같은 SHA의 검증·정리된 정확한 Staging 실행 ID가 필요합니다.

```text
node scripts/supervise-ephemeral-release.mjs deploy \
  --environment production \
  --commit <현재 main 전체 SHA> \
  --storage-backup false \
  --cloudflare-account-id <정확한 계정 ID> \
  --staging-run-id <승인한 Staging run ID>
```

운영 임대에는 `staging_run_id`와 해당 Staging 정리 영수증 해시가 함께 서명됩니다. workflow도 목록의 최신 실행을 임의 선택하지 않고 `/actions/runs/{run_id}`로 정확한 실행을 직접 조회합니다. 복구훈련과 별도 운영 승인 전에는 이 명령을 실행하지 않습니다.

## 입력·실행 중단 복구

토큰을 만들라는 안내 뒤 입력 실패·터미널 종료·네트워크 오류가 발생하면 pending 표식을 수동 삭제하지 않습니다. 다음 명령으로 같은 임대만 복구합니다.

```text
node scripts/supervise-ephemeral-release.mjs recover \
  --environment <staging|production> \
  --lease <pending 임대 ID> \
  --cloudflare-account-id <정확한 계정 ID>
```

- 폐기한 토큰 원문이 있으면 숨김 입력으로 넣습니다. stale pending에 서명된 grant가 남아 있으면 먼저 그 grant의 exact 자격값 해시로 `lease_materialized` 상태를 복원하고, 입력한 원문 해시가 그 값과 같을 때만 공급자 비활성을 API로 확인합니다.
- 실제로 만들지 않은 자격값은 아직 임대가 materialize되기 전 단계에서만 `NOT_CREATED:<lease>:<provider>` 문구로 확인할 수 있습니다. 임대에 토큰 해시가 기록된 뒤에는 이 문구로 대신할 수 없습니다. 이 항목은 자동 검증이 아니라 운영자 확인으로 기록됩니다.
- 자격값이 아직 materialize되지 않은 dispatch 전 중단만 모든 임시 GitHub secret 부재와 공급자 상태를 확인한 뒤 `EPHEMERAL_LAST_ABORTED_LEASE_RECEIPT`를 서명하고 정확히 다시 읽습니다. 서명된 grant나 materialize 증거가 있으면 run이 없어도 단순 중단 영수증으로 닫지 않습니다.
- `dispatch_intent` 뒤 exact run을 아직 찾지 못했거나 관문 결과가 불명확하면 pending 표식과 일지를 그대로 보존합니다. 실행이 없었다거나 실패했다고 추정해 닫지 않습니다.
- dispatch 뒤 중단이면 서명 일지와 GitHub의 exact run을 다시 조회합니다. 두 자격값 관문을 통과한 종료 run은 이전 영수증 해시를 부모로 갖는 누적 cleanup 후속 영수증에 반드시 포함하고, 실행이 권위 있게 실패한 것으로 확인된 경우만 중단 영수증으로 닫습니다.
- cleanup 영수증 저장 뒤 중단된 경우 현재 값이 서명된 이전 값이거나 그 exact run 하나를 추가한 검증된 후속 값일 때만 복구합니다. 다른 값이나 순서가 끊긴 값은 거부합니다.
- 공급자 비활성 확인, 임시 GitHub secret 제거, exact run 판정, 영수증 저장과 재검증이 모두 끝난 뒤에만 pending 표식을 삭제합니다. 어느 하나라도 실패하거나 불명확하면 표식은 남고 새 배포는 계속 차단됩니다.
- 동일 복구를 다시 실행해도 기존 서명 영수증과 일치할 때만 안전하게 마무리합니다.

### 로컬 감독기 획득 잠금 복구

감독기는 같은 Windows 계정에서 두 명령이 동시에 영수증을 갱신하지 못하도록 개인키 경로 옆에 `.supervisor.lock.acquire` 획득 잠금을 원자적으로 만듭니다. 획득 잠금을 만든 직후 프로세스가 강제 종료되면 이후 명령은 안전하게 중단되며, 이 파일을 자동으로 지우지 않습니다.

1. 작업 관리자와 터미널 기록으로 다른 `supervise-ephemeral-release.mjs` 프로세스가 실행 중이지 않음을 확인합니다.
2. `%LOCALAPPDATA%\BurilLab\credentials\ephemeral-release-ed25519.pkcs8.dpapi.supervisor.lock.acquire`를 열어 `pid`, `context`, `started_at`을 기록하고 해당 PID가 더 이상 존재하지 않는지 다시 확인합니다.
3. 조사 증거로 파일 사본과 SHA-256을 저장한 뒤 **`.acquire` 파일 하나만** 삭제합니다. 기본 개인키 파일, `.supervisor.lock`, pending 일지와 서명 영수증은 삭제하지 않습니다.
4. 새 배포를 시작하지 말고 같은 lease의 `recover`를 먼저 실행합니다. 남아 있는 `.supervisor.lock`은 기록된 PID가 종료됐고 내용이 바뀌지 않았을 때만 감독기가 자체적으로 교체합니다.

PID 상태나 파일 소유권을 확정할 수 없으면 잠금을 유지하고 복구를 중단합니다.

## 실패로 처리하는 경우

- Cloudflare 확인의 `400`, 임의 `403`, `5xx`, 빈 본문, HTML, 네트워크 오류는 폐기 증거가 아닙니다. `401`도 공식 `Invalid API Token` JSON 구조와 오류 코드가 정확할 때만 폐기로 인정합니다.
- Supabase PAT 인증이 `401`이 아니면 폐기 완료로 보지 않습니다.
- GitHub 목록을 읽지 못하거나 같은 이름의 저장소 범위 자격값이 있으면 실패합니다.
- 토큰 값과 서명된 해시가 다르거나 임대가 만료되면 실패합니다.
- 승인한 Staging run ID, SHA, 첫 실행 시도, 정리 영수증 중 하나라도 다르면 운영 배포를 막습니다.
- 정리 영수증 저장·재조회 또는 공급자 비활성 확인이 실패하면 다음 임대를 막습니다.

## 공개 증거

공개 저장소에는 커밋 SHA, 실행 ID, Cloudflare deployment ID, 공개키 지문, 익명 시험 결과, 토큰 식별자·표시 이름의 단방향 해시와 정리 시각만 남깁니다. 토큰 원문, 사용자 정보, 원본 공급자 응답, 개인키는 남기지 않습니다.

## 공식 근거

- [Supabase Management API 인증](https://supabase.com/docs/reference/api/introduction)
- [Supabase PAT 만료와 사용 기록](https://supabase.com/changelog/38248-personal-access-tokens-expiration-usage-tracking)
- [제한형 PAT 순차 제공 안내](https://github.com/orgs/supabase/discussions/48717)
- [Cloudflare API 토큰 확인](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/verify/)
