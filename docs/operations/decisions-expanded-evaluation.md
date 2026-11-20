# Expanded Decisions comparison

The operator requested 1,000 voice cases and 1,000 classification cases, using
the existing production server key. Token growth is not an optimization target.
The target is zero wrong acceptances and strictly more acceptances than Responses,
reported independently for each feature. Equal adoption is not a win.

## Frozen corpus and labels

`scripts/decisions-expanded-fixtures.mjs` defines 50 material identities and 20
scenarios per feature. Each feature has 1,000 distinct input objects. Ten target
material identities (200 cases per feature) are for tuning; the other forty
(800 per feature) are held out until policy freeze. Distractor and conflict
identities also stay within the same partition. The original 480 cases remain
the separate regression corpus. They are not added to the new denominator.

Labels are synthetic examples of the existing assistance contract, not human
chemical-safety adjudications. PubChem identity references do not determine
disposal labels. No outputs from the compared models are used as labels. The
1,103-material disposal golden set is not converted into ten-category labels.
Each partition contains both answerable cases and intentional abstentions.
CAS-based families, scenario counts, unique input counts and label provenance
are checked locally without a provider call. `--manifest` emits the frozen hash.

## Policies

v1 and v2 questions remain frozen for historical comparisons. Candidate v3
passes cabinet and other location names separately and supplies one-based shelf
numbers. It spells out chemical-priority and identity-consistency checks while
preserving the ten categories and existing rules. It distinguishes nitrate
from nitrile and sulfate from sulfide and explains the existing ordinary-solid
assistance rule. It does not supply the corpus or its answers to the model.

Acceptance remains probability >=0.90 and margin >=0.20. Models, technical
fallback, refusal routing, downstream review and API contracts stay in place.
Policy changes require another version and evaluation. v3 cache metadata is
isolated from earlier policy versions. The operating mode is controlled by
the existing independent KV setting, never by this experiment.

The first v3 tuning run found four wrong classification acceptances, all in
name/formula versus CAS conflicts, before the validation partition was opened.
Candidate v4 adds an independent identity-consistency choice in the SAME
Decisions request. Both the category and identity evidence must pass the
unchanged probability/margin gates. Identity refusal or uncertainty means
UNKNOWN, without a Responses rejudgment. Cache hits must retain and revalidate
both pieces of evidence. v3 remains frozen as `decisionsV3`. The voice v4 prompt
also clarifies count questions and elimination of incompatible distractors.
The original v3 errors and one provider 503 are retained in their own report.

### Evaluation corpus v2: remove candidate-ID hints

Before any held-out validation, an input audit found that corpus v1 used role
names such as `target` and `noise-0` as inventory IDs. These can reveal the answer
to either model. Its voice numbers are trial diagnostics, not final performance
evidence. Preserve v1 byte-for-byte and retain all recorded calls.

Corpus v2 uses deterministic opaque UUIDs assigned independently of answer role,
and a new `expanded-v2-` case namespace. It remaps only IDs and embedded forced-ID
injection references. Chemical names, candidate ordering/counts, selectors,
answer meaning, abstentions and target-family splits are unchanged. Tests check
equivalent selected identities and retain the v1 SHA-256. The 2,000-case v2 hash
is frozen before its first model call; re-run Responses, frozen v2 policy and
the selected policy on v2 rather than mixing in v1 voice results. Classification
input objects are identical, but are also rerun for a consistent comparison.
The signed registry retains old IDs for audit/replay and is constructed lazily
only after authorization. Closed evaluation and ordinary app calls do no large
fixture construction work.

The tuning Responses classification result accepted 175/200, including 25
intentional-abstention cases; all 150 answerable cases were already correct.
Higher raw acceptance at zero wrong is mathematically impossible on that
partition. This does not change the fixed corpus or the strict target.

The v4 tuning-only run also failed: classification accepted 92/200 with three
wrong CAS-conflict acceptances, and only 89/150 answerable cases were correct.
The extra model question is not used by the selected v5 classification policy.
Voice remains at v4. No validation outcomes were opened during these changes.

Classification v5 fetches public PubChem title/formula evidence for a supplied,
checksum-valid CAS. It keeps the original fields intact and supplies the readable
reference separately to the existing category question. Equivalent formula
notations are normalized; a CAS/formula mismatch blocks every non-UNKNOWN choice
at the server even if the model reports probability one. An unavailable,
ambiguous or unsupported reference requires review, without guessing or silently
correcting the input. Name-only inputs do not require a CAS. This is assistance
input consistency, not verification of the actual container or disposal approval.

Each reference lookup is a credential-free GET with a two-second total deadline,
no redirects/retries, schema and 16 KiB body bounds. A bounded process-local cache
holds only successful public identity facts for 15 minutes, never model results.
Reference status/cache metadata accompanies accepted results and is revalidated
on classification cache hits. No reference lookup occurs on legacy, an existing
legacy classification-cache hit, or an unsampled shadow request. Sampled shadow
reference preparation runs inside waitUntil after the legacy response, so it
does not add source latency to the user's response. Report reference cold/warm
latency and unavailable counts separately from app cache and model errors.

Four additional, separately reported identity-boundary guards pair a declared
name with the CAS of a different isomer having the SAME molecular formula.
The arithmetic formula gate alone cannot reject them. They test whether the
model uses the readable reference identity, and are authored before v5 live
evaluation. They do not change the frozen 2,000 inputs or their denominators.

On cohort-v2 tuning, voice v4 accepted 149/200 with zero wrong (Responses
132 accepted, 13 wrong). Classification v5 accepted 146/200 with zero wrong
(Responses 175 accepted, 25 wrong); four answerable cases proposed the right
category but fell below the unchanged probability gate. Candidate v6 supplies
the normalized elemental composition and formula-equivalence status as factual
input, and clarifies bilingual labels and canonical titles that omit ordinary
physical-form words. It supplies no category hint and preserves identity-conflict
review even for isomers with equal formulas. No validation outcomes were used.
v5 remains available as a frozen archive, with its original reference lookup.

## Explicit paid execution

Use the protected main CI -> staging -> production release pipeline. Verify
the public production commit before installing an environment-bound one-hour
evaluation grant. Production OpenAI/HMAC secrets remain inside Cloudflare.

```powershell
node scripts/decisions-expanded.mjs --manifest
node scripts/decisions-expanded.mjs --prepare <private-temp-directory>
# Install only grant.json in production ai_decisions_evaluation, TTL 3600.
node scripts/decisions-expanded.mjs --state <private-temp-directory>/private.json --output <output>/tuning.json --split tuning
# Inspect tuning errors, freeze the policy, then run the untouched partition.
node scripts/decisions-expanded.mjs --state <private-temp-directory>/private.json --output <output>/validation.json --split validation
```

The signed endpoint admits only fixed, granted fixture IDs and known backends.
It accepts no caller prompts, inventory, model or credentials. The evaluator
counterbalances backend order, limits concurrent calls to four, and journals
every completed provider result, including failures. No automatic retry is
performed. An explicit `--resume` validates the grant/corpus/backend manifest
and skips all recorded calls. A request with a lost response may already have
run; retain transport diagnostics separately from provider-error counts.

Report Responses, frozen v2 and candidate v3 on exactly the same inputs. Report
raw acceptance, correct acceptance, wrong acceptance, answerable coverage,
abstention, provider errors, p50/p95 and token usage for both partitions and both
features. Errors are not successful abstentions. The maximum number of correct
acceptances is the answerable count: if Responses' raw acceptance exceeds it,
strictly higher raw adoption with zero wrong is infeasible on that partition.
Record this rather than altering labels or removing failures.

After evaluation, match the installed grant ID, remove the grant, confirm that
the signed probe is rejected and unauthenticated production requests return
404, and remove local signing keys. Keep only reports and public metadata.
An offline pass does not replace independent human labels or the required real
24-hour/100-case shadow and sequential activation observations.

## Prospective matched-input comparison (November 21, 2026)

Run `node scripts/evaluate-paired-decisions.mjs --manifest` for the frozen
cohort of 1,000 voice cases and 1,000 classification cases. The 50 target CAS
numbers are disjoint from the November 9 cohort. The contract labels are
synthetic. Public PubChem records verify chemical identity independently of the
model and are pinned so both providers receive identical facts. The measured
classification stage excludes reference lookup time.

The signed evaluation handler accepts four arms. `legacy` is the existing
Responses request, `decisions` the existing v4/v6 decisions,
`responsesMatched` the Responses contract with the trial's full evidence,
and `decisionsTrial` the grouped bottle or ranked classification question.
The latter two share their evidence, instructions, choices and deterministic
blocks. Successful pairs must have matching input digests. Thresholds apply to
the API's own output: 0.90 choice probability and 0.20 margin for Decisions,
and the original Responses acceptance contract for that control. The 0.85
voice sensitivity analysis re-scores the same distribution once offline.

Use the production grant procedure in [the rollout guide](decisions-rollout.md).
For each feature (`voiceCandidate`, then `classification`), prepare a fresh
grant with `node scripts/evaluate-paired-decisions.mjs --prepare <private-dir> --feature <feature>`.
Install only its public grant. Run
`node scripts/evaluate-paired-decisions.mjs --state <private-dir>/private.json --feature <feature> --output <phase.json>`.
The journal records each completed call, including provider errors. Use
`--resume` explicitly for an interrupted run. Revoke each grant and verify a
signed probe is rejected before removing its temporary signing files.

Combine the phases using `node scripts/evaluate-paired-decisions.mjs --summarize --voice <voice.json> --classification <class.json> --output <report.json>`.
The primary classification group consists of the 523 cases admitted by the
shared application rule, including 393 answerable cases. The report includes
all 1,000 for diagnosis. For each primary group, success requires zero wrong
acceptances, more correct acceptances than both Responses controls, at least as
many as current Decisions, and complete comparisons without provider errors.
Report raw adoption and latency alongside correct adoption. Production rollout
and independent review remain separate decisions.

The classification v8 comparison appends a short clarification about solid
inorganic acids and hydroxides only for labels with those cues. It preserves
the v6 question for other inputs. The original v7 comparison is reproducible.
Pass `--class-v8` to both the classification run and the final summary to
select `responsesMatchedV8` and `decisionsTrialV8`. The existing grouped
voice run can be combined with this classification phase. Reports validate
the feature-specific policy, comparison arms, frozen inputs and reference
hashes before combining their rows. The application defaults remain v4/v6.

## 음성 재고 검증과 보조 분류 분기

운영 KV의 `ai_decisions_config`에서 기존 모드와 표본 비율을 사용한다. 선택적인 `policies`에
`{"voiceCandidate":"verified-responses-v1","classification":"identity-routed-v1"}`를 지정하면 각 기능의
`shadow` 또는 `active` 요청에 새 정책이 적용된다. 정책 선택을 생략한 기존 설정은 음성 v4·분류 v6을
사용한다. 설정 누락·오류·만료 시 두 기능 모두 `legacy`로 동작한다. 해당 기능의 모드를 `legacy`로
되돌리고 KV 전파 후 처리 로그의 모드와 공개 배포 버전을 확인하면 복구할 수 있다.

- 음성 검색은 기존 연구실 후보 최대 120개를 같은 라벨·CAS의 병으로 묶어 Responses에 한 번 전달한다.
  반환된 ID가 후보에 속하고 기존 신뢰도 기준 0.72를 통과해야 한다. 명시된 선반, 이름과 CAS, 무수·수화 상태가
  충돌하거나 병을 구분할 단서가 부족하면 사용자 확인을 반환한다. 같은 입력의 Decisions 비교 기준은
  선택 확률 0.85와 차순위 차이 0.20이다. 이 비교 경로는 서명된 평가에서만 호출한다.
- 보조 분류는 기존 규칙과 예외를 먼저 적용한다. 규칙에서 AI가 필요한 경우 기존 산·수산화물 단서가 있으면
  Decisions v6(선택 확률 0.90, 차이 0.20), 그 외에는 같은 식별 근거를 담은 Responses를 한 번 호출한다.
  CAS가 주어지면 그 CAS의 참조와 제공된 분자식의 일치를 검사한다. 보류·거부·기술적 실패는 음성 후보 확인 또는
  `UNKNOWN`으로 끝난다. 채택한 분류만 `classify:routed:v1`에 저장한다. 최종 폐기·보관 검토는 기존 흐름을 따른다.
- `shadow`는 기존 결과를 반환하고 표본에서만 후보 정책을 백그라운드로 비교한다. 후보 계산은 별칭과 분류 캐시에
  쓰지 않는다. 운영 비교·전환 기준은 [배포 절차](decisions-rollout.md)를 따른다. 평가용 KV 키는 `ai_decisions_evaluation`이다.

### 독립 정답과 운영 키 비교

저장소 루트에서 아래 명령을 실행한다. `--pack`은 외부 모델 호출 없이 새 물질 50종에 대해 기능별
1,000건의 입력과 독립 검토용 HTML을 생성한다. 검토자가 정답·사용자 확인을 직접 선택하고 이름과
확인란을 입력한 뒤 JSON을 내보낸다. 미검토 항목이 남은 기능은 봉인할 수 없다. 생성된 자료의
해시는 입력, 공개 식별 정보, 정답에 각각 연결된다. 모델 응답이나 기존 폐기 골든셋은 정답으로 쓰지 않는다.

```sh
node scripts/evaluate-verified-routing.mjs --pack review-pack
node scripts/evaluate-verified-routing.mjs --seal human-review.json --feature voiceCandidate --output voice.labels.json
node scripts/evaluate-verified-routing.mjs --corpus reviewed --feature voiceCandidate --labels voice.labels.json --prepare PRIVATE_DIRECTORY
node scripts/evaluate-verified-routing.mjs --corpus reviewed --feature voiceCandidate --labels voice.labels.json --state PRIVATE_DIRECTORY/private.json --output voice.json
```

보조 분류는 같은 명령의 기능을 `classification`으로 지정하고 별도의 봉인 파일·권한·출력을 사용한다.
운영자는 기존 원격 평가 절차대로 공개 `grant.json`만 운영 KV에 최대 1시간 등록하고 무료 `probe` 후
KV 전파를 확인한다. 서버는 만료 시각·서명·사례 ID·기능·백엔드를 확인한다. 독립 자료에는 정답 해시가
등록된 권한이 필요하고 정답은 서버로 전송되지 않는다. 완료 후 권한을 제거하고 서명·미서명 요청의 404를
확인한 다음 전용 임시 서명 파일을 삭제한다. `private.json`은 원본 운영 API 키를 포함하지 않는다.

기존 합성 회귀 비교는 `--corpus regression`으로 같은 명령을 실행하고 `--labels`를 생략한다.
명시 실행 시 기능마다 3,000건을 서명된 서버에서 호출한다. 연결 단절 후 같은 권한과 입력으로
`--resume`을 사용하면 기록된 요청을 건너뛴다. 모델 오류도 측정 결과에 포함한다.
출력 옆 `.metrics.json`은 세 경로별 정답 채택·오선택·보류·오류·p50·p95·토큰 사용량을 기록한다.
분류의 주 지표는 실제 규칙이 AI 호출을 허용한 사례이며 전체 1,000건과 세 경로의 공통 성공 집합도 제공한다.
점수를 다시 계산하려면 `--state` 대신 `--score 기존결과.json`과 새 출력 경로를 지정한다.

분류 정책 `identity-routed-v2`는 명시된 한글·영문 금속염과 원소 조성이 지지하는
선택지를 검사한다. 모델이 근거와 충돌하는 값을 돌려주면 `UNKNOWN`으로 종료한다.
지정 금속·황화물의 순서에는 기존 보조 분류 기준을 적용한다. 무기산·고체 수산화물
단서에 탄소가 없는 H/O 조성이 뒷받침되면 기존 v8 지침의 Responses를 한 번 호출한다.
조성이 없는 산·수산화물 단서는 이전처럼 Decisions에 보낸다. 이 버전은
`classify:routed:v2` 캐시를 사용한다. 분류 `--prepare`, 실행과 `--score`에
`--class-v2`를 지정하면 서명된 세 번째 경로가 `classificationRoutedV2`가 된다.
기존 결과 재현에는 이전 정책 옵션을 사용한다.
