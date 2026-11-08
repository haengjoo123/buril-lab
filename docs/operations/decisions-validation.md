# Decisions 구현 검증 기록

검증일: 2026-11-08 (Asia/Seoul)

- 웹 빌드 및 클라이언트 비밀정보 검사 통과.
- 전체 ESLint 통과. 마지막 변경 파일의 ESLint 및 서버 TypeScript 별도 검사 통과.
- `vitest run --exclude=e2e/** --exclude=tmp/** --maxWorkers=4`: 218개 파일, 2,454개 검사 통과, 7개 건너뜀. 이후 추가한 후보 상한·한국어 선택 검사와 평가 집계 검사를 포함한 대상 재실행: 21개 통과.
- 운영 캐시 식별/격리 검사 별도 실행: 41개 통과.
- 1,103개 물질 골든셋: unsafe automatic ready 0, ready stream mismatch 0. 기존 보수적 보류 3건 유지. 농도 시나리오 23건 통과.
- 최초 `npm test`는 임시 작업 파일 `tmp/golden-comparison-xlsx/export-comparison.test.ts`의 오래된 1,000행 단정과 병렬 부하 시간 초과 2건으로 실패했다. 시간 초과 두 파일의 별도 실행 134개 검사는 통과했고, 임시 작업 파일을 제외한 제한 병렬 전체 실행도 통과했다. 임시 파일은 변경하지 않았다.

## Cloudflare 원격 실행 검증

Cloudflare 등록 상태를 `wrangler pages secret list`로 확인했다. `buril-lab-staging`과 `buril-lab` 두 프로젝트에 `OPENAI_API_KEY`, `OPENAI_SAFETY_HMAC_SECRET`이 모두 암호화된 서버 secret으로 등록되어 있다. 원문 조회나 실제 OpenAI 요청은 수행하지 않았으므로 키 유효성·Decisions 접근 권한까지 검증된 것은 아니다.

기존 키를 서버 안에서 사용하는 원격 실행 경로를 구현하고 staging에 배포했다. 새 OpenAI 키를 발급하거나 기존 키 원문을 추출하지 않았다.

- 코드: [PR #126](https://github.com/haengjoo123/buril-lab/pull/126), [실패 보고서 보존 #127](https://github.com/haengjoo123/buril-lab/pull/127), [Workers 요청 호환성 #128](https://github.com/haengjoo123/buril-lab/pull/128) 병합 완료.
- 최종 커밋: `c2b27532706aabbe6ccbac5b9819303bd45d25b9`.
- [main CI](https://github.com/haengjoo123/buril-lab/actions/runs/42490277694): 필수 검사 4개 모두 성공.
- [staging 배포·브라우저 검증](https://github.com/haengjoo123/buril-lab/actions/runs/42490655821): 성공. deployment `bc48ef62-d927-4413-9397-74bc2af51a62`.
- 실제 Miniflare/workerd에서 제품 요청 생성기를 실행하는 회귀 검사 통과. `redirect:error`가 요청 전 TypeError를 발생시키는 런타임 차이를 재현하고 `manual` 및 3xx 거부로 수정했다.
- [최종 원격 smoke 실행](https://github.com/haengjoo123/buril-lab/actions/runs/42491012255): 서명 인증·probe·서버 호출·완전한 결과 artifact 저장 확인. 공급자 오류를 성공으로 처리하지 않아 workflow 결론은 failure다.
- 음성·분류 각 1건을 두 API로 호출한 4회 결과: Responses 2회 `HTTP 403 / model_not_found`, Decisions 2회 `HTTP 403`(세부 코드 없음). Decisions의 요청 전 즉시 실패는 해소되어 실제 HTTP 응답이 기록됐다.
- 원본 보고서: `output/decisions-remote/42491012255/decisions.json`. 기록된 지연은 오류 응답 지연이며 모델 추론 성능으로 해석하지 않는다. 사용량 응답이 없어 토큰 정규화 값은 0이고 비용은 미완결이다.
- 실행 종료 후 staging의 임시 공개키 grant `ai_decisions_evaluation`를 삭제했고 원격 재조회 404로 제거를 확인했다. 기존 `runtime_config`, `ai_decisions_config`, 서버 secret은 수정하지 않았다. CI의 임시 개인키도 always cleanup 단계에서 제거됐다.
- 원격 평가 종료 시점의 운영 공개 release는 기존 `15bfdc5a9bab58ed15f1696c826d23dc0901b005`였고 운영의 `ai_decisions_config` 키는 404(미등록)였다.

## 남은 접근 조건과 평가

현재 staging 키/프로젝트에서 요청한 `gpt-6-luna`가 접근 거절된다. 모델 제공 여부와 해당 키·프로젝트의 모델/엔드포인트 권한을 확인해야 한다. 이 오류는 키가 등록되어 있다는 사실만으로 실제 모델 접근까지 보장되지 않음을 뜻한다. 키 재발급이나 모델 변경을 임의로 수행하지 않았다.

접근 조건이 해결되기 전에는 전체 400건 호출을 실행하지 않는다. 내장 기능별 200건은 10개 계열의 합성 변형으로, 독립적인 실제 안전 정답셋이 아니다. 정확도·모델 지연·비용 비교, 독립 표본 검토, 운영 24시간/100건 shadow 및 순차 active 관찰은 미완료다.

## 사용자 요청에 따른 운영 배포

이후 사용자가 운영 배포를 명시적으로 요청해 [Web production 실행](https://github.com/haengjoo123/buril-lab/actions/runs/42491792824)으로 검증된 staging 커밋을 승격했다. workflow의 후보 선택·빌드·배포·검증이 모두 성공했다.

- 운영 공개 `/release.json`: HTTP 200, `environment=production`, `commit_sha=c2b27532706aabbe6ccbac5b9819303bd45d25b9` 확인.
- 홈페이지 HTTP 200, 신·구형 분류 API 및 음성 API의 미인증 요청 HTTP 401 확인.
- 평가 전용 `/api/internal/decisions/evaluate`는 운영에서 HTTP 404 확인.
- 운영 secret과 `ai_decisions_config`는 수정하지 않았다. Decisions 기본 모드는 legacy이며 활성화하지 않았다.
- 공개 상태·인증 경계 검사로 운영 키의 실제 모델 접근 성공까지 확인한 것은 아니다. 기존 staging의 403 결과를 운영 키의 결과로 해석하지 않는다.

[전환 절차](decisions-rollout.md)에 따라 운영 모델 접근과 나머지 평가 증거를 확보한 뒤 기능별로 전환한다.

## 2026-11-09 운영 서버 직접 비교 준비

사용자가 운영 shadow 비교를 요청해 운영의 `ai_decisions_config`에 두 기능 shadow, 표본 비율 0.1, 종료 `2026-11-09T15:00:19Z`를 등록하고 재조회했다. 실제 사용자 비교 표본은 아직 확보하지 않았다.

이후 브라우저 없이 운영 키로 직접 비교하도록 요청해 평가 경로를 환경별 grant/audience로 분리했다. 운영은 canonical host와 production grant를 모두 요구하며, grant 누락·만료 시 404로 닫힌다. 기존 staging workflow와 Access 자격증명 범위는 변경하지 않는다. 이 절의 준비 기록은 실제 운영 API 평가 성공을 뜻하지 않는다.

## 운영 키 실제 호출 확인

- [PR #129](https://github.com/haengjoo123/buril-lab/pull/129) 필수 CI 4개 통과 후 병합. 서버 strict TypeScript 및 관련 79개 검사, 전체 2,479개 검사 통과(7개 건너뜀).
- [main CI](https://github.com/haengjoo123/buril-lab/actions/runs/42493512606), [staging 배포·검증](https://github.com/haengjoo123/buril-lab/actions/runs/42493917906), [운영 승격](https://github.com/haengjoo123/buril-lab/actions/runs/42494380572) 성공. 공개 release에서 운영 SHA `8b4cc6a39771b30f5c668c735ef87bc327b7ddf5` 확인.
- 기존 운영 서버 key/HMAC으로 동일 아세톤 사례를 음성·분류 각각 두 API에 전송한 네 호출 모두 성공, 모델 `gpt-6-luna`, 판정 일치. 음성 지연: Responses 3,367ms / Decisions 1,491ms. 분류 지연: Responses 1,421ms / Decisions 300ms. 각 1건의 smoke 지연이며 p95 성능 결론으로 사용하지 않는다.
- 원본 smoke 보고서와 공개 release 스냅샷: `output/decisions-production-smoke/report.json`, `release.json`. OpenAI key는 로컬·CI로 추출하지 않았다. smoke용 로컬 임시 서명 파일은 제거했다.
- 기능별 200건, 총 400건의 전체 합성 평가를 별도 production grant로 시작했다. 첫 42건 이후 평가 endpoint의 HTTP 403으로 중단됐다. 공급자 오류 결과와 구분해 원본 `report.attempt1.json`을 보존했다. 현재 grant를 재확인하고 무료 signed probe 3회 성공 후 명시적으로 재개했다. 권한 거부의 일시적 원인은 확정하지 않았다.
- API별 체크포인트·명시적 `--resume`을 추가하고 14개 관련 검사를 통과했다. 이 변경 전 마지막 미완료 사례 `voice-1-1`의 Responses 호출은 결과가 보존되지 않아, 재개 시 해당 baseline이 한 번 추가 호출됐을 가능성이 있다. 기록된 42개 완료 사례는 재호출하지 않았다.
- 전체 보고서 경로는 `output/decisions-production-full/report.json`. 이 기록 시점에는 실행 중이며 완료나 운영 전환 기준 통과를 의미하지 않는다. 기존 `shadow` 10%는 유지하고 active로 전환하지 않았다.
- 91건 완료 후 평가 인증 403이 다시 발생해 `report.attempt2.json`을 보존했다. 두 API의 공급자 오류·채택 오답은 이때까지 0건이다. 클라이언트의 발급시각과 상대 만료시각 계산이 초 경계를 넘으면 엄격한 15초 수명 검증을 위반할 수 있는 결함을 찾아 단일 숫자 시각으로 수정했다. 관련 15개 검사 통과. 원래 403의 직접 원인은 확정하지 않았으며, 다음 실패에는 비밀정보 없이 서버 오류 코드와 토큰 나이를 보존한다. 서버 인증 제한은 변경하지 않았다.

## 2026-11-09 전체 운영 비교 완료

2026-11-09 00:50:28 KST에 기능별 200건, 총 400건의 두 API 비교를 완료했다. 기록된 모델 호출은 800개이며 모델은 모두 `gpt-6-luna`, 공급자 오류 0건, 앱 캐시 적중 0건이다. 운영 서버 커밋과 정책은 평가 전체에서 동일했다.

| 기능 | Responses 채택/정확도 | Decisions 채택/정확도 | p95 Responses → Decisions | 기존 대비 채택 수 |
|---|---|---|---|---|
| 음성 후보 선택 | 103/200, 87.4% | 69/200, 100% | 2,028ms → 427ms | 67.0% (미달) |
| 보조 분류 | 180/200, 100% | 156/200, 100% | 2,121ms → 427ms | 86.7% (미달) |

정확도는 합성 정답의 채택 결과 기준이다. 두 기능 모두 채택 수 ≥기존 90% 기준에 미달해 active로 전환하지 않고 기존 shadow 10%를 유지한다. 독립 정답셋, 운영 24시간/100건 관찰은 별도 미완료다. 음성 합성 사례는 후보가 2개이므로 최대 120개 후보의 운영 지연 검증도 아니다. [상세 결과](decisions-production-2026-11-09.md)에 토큰·추정 비용·계열별 채택 분포와 한계를 기록했다.

333건 시점에 세 번째 평가 인증 403이 발생했다(`GRANT_DENIED`, 토큰 나이 0초, 수명 15초). 이 원본도 보존했다. 작은 시계 차이에 의한 미래 iat 거부를 피하도록 클라이언트가 발급시각을 2초 앞당기되 총 수명 15초는 유지하게 수정했고, 검증 서버가 1초 느린 조건을 포함한 관련 15개 검사가 통과했다. 이후 남은 67건은 중단 없이 완료됐다. 인증 중단 3회는 모델 호출 오류와 분리해 집계하며 직접 원인은 확정하지 않았다.

운영의 해당 grant ID를 대조하고 `ai_decisions_evaluation`을 삭제했다. 00:51:58 KST에 signed probe 거부와 미인증 endpoint 404를 확인했으며 로컬 임시 개인키도 제거했다. 서버 key/HMAC 및 업무 데이터는 수정하지 않았다. `output/decisions-production-full/`에 `report.json`, `analysis.json`, 원본 attempt 3개, `cleanup.json`을 보관했다.
