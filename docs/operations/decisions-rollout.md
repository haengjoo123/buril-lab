# Decisions API 전환과 복구

## 현재 상태

코드는 기본 legacy다. KV 설정이 없거나 만료·파싱·조회 실패하면 두 기능 모두 기존 Responses를 사용한다. SDK/DB/모바일 배포 변경은 없다. 기존 API 키와 HMAC secret은 서버 환경만 사용한다.

기능: `voiceCandidate`(모호한 음성 후보), `classification`(기존 UNKNOWN 보조 분류). 라벨 추출·문서 추출·음성 의도·별칭 생성·폐기 설명은 기존 경로다. AI 추정 결과의 확인 필요 상태는 유지된다.

## 설정

환경별 기존 `BURILLAB_RUNTIME_CONFIG` KV의 **별도 키** `ai_decisions_config`에 아래 형식을 저장한다. 기존 `runtime_config` 안전 스위치는 수정하지 않는다.

```json
{
  "voiceCandidate": "legacy",
  "classification": "legacy",
  "shadowSampleRate": 0.1,
  "expiresAt": "2026-12-01T00:00:00Z"
}
```

모드는 `legacy`, `shadow`, `active`. 종료시각은 예시이며 실제 실험 종료시각으로 지정한다. 만료는 active에도 적용되므로 연장 전 상태를 재검토한다. 스테이징은 표본 비율 1로 모든 대상 요청을 비교할 수 있다. shadow는 `waitUntil`이 있는 Pages 런타임에서만 실행된다. legacy 캐시 적중이나 명확한 재고 검색은 비교하지 않는다.

선택 확률 0.90 이상, 차순위와 차이 0.20 이상을 요구한다. 모델의 confidence와 선택 확률은 다른 값이다. 낮은 확률·UNKNOWN·답변 거부는 보류하고, 기술적 장애만 5초 제한 Responses 1회로 대체한다. Decisions도 5초 제한·재시도 없음이다.

## 평가

`node scripts/evaluate-decisions.mjs`는 외부 호출 없이 표본 수만 점검한다. 내장 표본은 기능별 200건, 각 10개 계열의 문구/입력 형식 변형이다. 사람이 검토한 안전 정답이나 독립적인 400개 실제 사례로 해석하지 않는다. 골든셋의 최종 폐기 스트림도 이 평가의 10종 보조 분류 정답으로 변환하지 않는다.

실제 평가는 서버 환경의 `OPENAI_API_KEY`, `OPENAI_SAFETY_HMAC_SECRET`을 사용한다. 출력 디렉터리를 먼저 준비하고 아래 명령에 현재 확인한 Responses 요율을 제공한다.

Cloudflare의 스테이징·운영 Pages 프로젝트에 두 secret이 등록되어 있음을 확인했다. Pages secret은 등록 후 원문을 다시 읽는 방식으로 로컬 CLI에 전달할 수 없다. 기존 키 재사용은 아래 원격 평가 경로를 이용한다. 등록 확인은 키 유효성이나 Decisions API 접근 성공을 뜻하지 않는다.

### Cloudflare 서버에서 원격 평가

`POST /api/internal/decisions/evaluate`는 staging 및 운영의 명시적인 임시 평가에 사용한다. 1시간 이하의 환경별 공개키 grant 및 15초짜리 Ed25519 서명 JWT를 검증한다. staging에는 기존 Cloudflare Access도 필요하다. 운영은 `https://burillab.com`에서만 허용하며, 유효한 production grant가 없으면 404다. grant 환경, JWT audience, 사례·backend 범위를 검증하고 preview 환경은 거부한다. 요청에는 고정 합성 사례 ID와 backend만 들어간다. 사용자 프롬프트·재고·키를 전송하는 실행 경로가 아니다.

서버는 실제 제품 경로와 같은 질문 생성기·스키마를 사용하며, DB/분류 캐시/별칭 저장 없이 해당 API를 한 번만 호출한다. 공급자 오류는 HTTP 200의 평가 결과 안에 `error:true`, `providerStatus`, 형식 제한한 `providerCode`로 기록하고 다른 API로 대체하지 않는다. 이는 Cloudflare edge의 비 JSON 5xx 처리가 진단 결과를 지우지 않게 하기 위한 전송 계약이다. 실패 결과가 있으면 workflow는 실패한다. 전송 자체의 실패는 부분 보고서의 `incompleteCase`에 남긴다. 결과에는 ID, 모델, 판정, 서버 측 지연과 토큰 사용량을 반환하고 공급자 오류 원문은 포함하지 않는다. 원격 보고서는 별도 가격 적용 전까지 비용 미완결로 표시한다.

1. 기존 Web release 절차로 새 코드를 staging에 배포한다. production 승격은 평가에 필요하지 않다.
2. main의 **Decisions remote evaluation** workflow를 실행한다. 최초에는 `smoke=true`로 음성·분류 각 1건(총 4 API 호출)을 선택한다.
3. 실행의 `decisions-public-grant-<run-id>` artifact를 내려받는다. 공개 `grant.json`만 포함하며 개인키는 runner 밖으로 내보내지 않는다.
4. 인증된 운영자의 Wrangler로 **staging 전용 namespace**에 공개 grant를 등록한다. namespace는 staging 프로젝트의 `BURILLAB_RUNTIME_CONFIG` 바인딩과 대조한다.

```powershell
npx wrangler kv key put ai_decisions_evaluation --namespace-id <staging-namespace-id> --path <grant.json> --remote
```

workflow는 5분 동안 유료 호출이 없는 signed probe로 grant 설치를 기다린다. 이후 순차 실행하고 `decisions-report-<run-id>` artifact에 보고서를 보관한다. full 실행은 `smoke=false`이며 고정 사례 400건을 두 API로 비교한다. 이 값은 합성 형식·문구 변형 수이며 독립 안전 정답 수가 아니다.

5. 종료 후 등록한 grant ID가 현재 키와 같은지 확인하고 해당 키를 삭제한다. 등록·삭제는 기존 `runtime_config`, `ai_decisions_config`를 변경하지 않는다. grant는 만료되며 각 요청은 15초 후 재사용할 수 없다. 15초 이내 동일 서명 재전송을 강하게 중복 제거하는 저장소는 없으므로 클라이언트는 재시도·병렬 실행하지 않는다. 네트워크 응답을 잃은 경우 유료 호출이 이미 실행됐을 수 있다.

로컬에서 Access 자격증명을 사용할 수 있다면 동일 CLI의 `--prepare <ignored-directory> --smoke`, 이후 `--state <directory>/private.json --output tmp/decisions-remote.json`을 사용한다. 개인키 파일을 Git이나 artifact에 포함하지 않는다. OpenAI 키는 로컬에 필요하지 않다.

사용자가 운영 키 비교를 요청한 경우 아래처럼 로컬에서 production 전용 서명 상태를 준비한다. 기존 GitHub 평가 workflow는 staging 전용으로 유지한다. 운영 서버는 기존 secret을 사용하며 로컬에는 OpenAI 키가 필요 없다.

```powershell
node scripts/decisions-remote.mjs --prepare output/decisions-production-smoke --environment production --smoke
npx wrangler kv key put ai_decisions_evaluation --namespace-id <검증한-production-namespace-id> --path output/decisions-production-smoke/grant.json --ttl 3600 --remote
node scripts/decisions-remote.mjs --state output/decisions-production-smoke/private.json --output output/decisions-production-smoke/report.json --wait-grant
```

네 호출이 성공한 뒤에만 전체 평가로 확대한다. 종료 후 현재 grant ID가 해당 실행과 같은지 확인하고 운영의 `ai_decisions_evaluation`를 삭제한 뒤 로컬 `private.json`도 제거한다. KV 전파 후 서명 probe 거부와 미인증 404를 확인한다. `ai_decisions_config` 및 `runtime_config`와 서버 secret은 이 평가로 변경하지 않는다. 비교는 DB·재고·별칭·분류 캐시를 쓰지 않는 고정 합성 사례이며, 실제 사용자 shadow 관찰이나 독립 정답 평가를 대체하지 않는다.

```powershell
node scripts/evaluate-decisions.mjs --live --fixtures <검토된-평가셋.json> --output tmp/decisions-evaluation.json --responses-input-per-million <입력요율> --responses-output-per-million <출력요율> --responses-cached-input-per-million <캐시입력요율>
```

외부 평가셋은 내장 `decisionFixtures()`와 같은 배열 형식으로 제공한다. `id`, `feature`, `expected`(보류는 null), `input`, `family`, `provenance`, `humanReviewed`를 보존한다. feature별 최소 200건과 독립 근거를 확인한다. 결과는 원문 입력 없이 사례 ID·정답·판정·지연·토큰·비용을 저장한다. 캐시 읽기/쓰기 Decisions 요율을 확인하지 않은 실행은 비용 미완결로 표시한다. 지역·장문 할증은 별도 검토한다. API 장애의 Responses 대체 결과는 Decisions 평가 성공으로 집계하지 않는다.

`--report <기존결과.json> --output <요약파일.json>`으로 재요약할 수 있다. 비교 통과는 채택 정확도 ≥99% 및 기존 이상, 채택률 ≥기존 90%, p95 ≤기존 80%, 기술적 오류 0건이다. 표본이 없는 보고서는 통과하지 않는다. 도구의 `productionReady`는 항상 false이며 안전 회귀 및 운영 관찰을 대신 인증하지 않는다.

## 운영 전환

1. legacy로 배포하고 스테이징에서 legacy/shadow/active와 신·구형 API 응답을 확인한다.
2. 독립 근거 평가셋·회귀 검사가 통과한 기능만 운영 shadow 10%로 설정한다.
3. Cloudflare JSON 로그의 `ai_decision`을 수집한다. 요청 ID로 비교 로그를 연결하고 cacheHit=true는 미적중 지연과 분리한다. 모델·정책 버전, elapsedMs, usage, fallbackReason, primaryElapsedMs, agrees를 확인한다. 일치율은 정확도가 아니므로 불일치 사례는 검토된 평가 입력으로 재현한다.
4. 기능별 ≥24시간·≥100건, 기술 실패율 ≤1%, 기존 사용자 응답 p95 악화 ≤10%, 확인 우회 0건을 확인한다. 사용자 전체 응답 지연은 HTTP 관측과 함께 확인한다. 요청이 부족하면 관찰을 연장한다.
5. 음성만 active로 전환하고 ≥24시간 관찰한 후 분류도 같은 절차를 따른다. 전환시각·배포 SHA·정책 버전·평가 보고서·관찰 집계를 기록한다.

오선택·안전 확인 우회·지속 장애 시 해당 기능을 legacy로 되돌리고 KV 전파 후 실제 처리 경로를 확인한다. 급한 복구는 기존 Pages 복구 절차를 사용한다. Decisions 캐시는 `classify:decisions:v1`이며 모델·정책·입력을 포함한다. 기존 `classify:v3`와 분리되어 legacy 복구에 영향을 주지 않는다. 임계값·질문·선택지 변경 시 정책/캐시 버전을 올리고 평가를 반복한다.

## 완료 증거

자동 검사 결과, 실제 API 비교 결과, 독립 표본 근거, 기능별 shadow 관찰, 순차 active 관찰이 모두 있어야 운영 적용 완료다. 로컬 테스트/합성 표본만으로 완료 처리하지 않는다.
