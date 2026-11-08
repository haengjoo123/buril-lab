# Decisions 구현 검증 기록

검증일: 2026-11-08 (Asia/Seoul)

- 웹 빌드 및 클라이언트 비밀정보 검사 통과.
- 전체 ESLint 통과. 마지막 변경 파일의 ESLint 및 서버 TypeScript 별도 검사 통과.
- `vitest run --exclude=e2e/** --exclude=tmp/** --maxWorkers=4`: 218개 파일, 2,454개 검사 통과, 7개 건너뜀. 이후 추가한 후보 상한·한국어 선택 검사와 평가 집계 검사를 포함한 대상 재실행: 21개 통과.
- 운영 캐시 식별/격리 검사 별도 실행: 41개 통과.
- 1,103개 물질 골든셋: unsafe automatic ready 0, ready stream mismatch 0. 기존 보수적 보류 3건 유지. 농도 시나리오 23건 통과.
- 최초 `npm test`는 임시 작업 파일 `tmp/golden-comparison-xlsx/export-comparison.test.ts`의 오래된 1,000행 단정과 병렬 부하 시간 초과 2건으로 실패했다. 시간 초과 두 파일의 별도 실행 134개 검사는 통과했고, 임시 작업 파일을 제외한 제한 병렬 전체 실행도 통과했다. 임시 파일은 변경하지 않았다.

## 아직 확보되지 않은 증거

Cloudflare 등록 상태를 `wrangler pages secret list`로 확인했다. `buril-lab-staging`과 `buril-lab` 두 프로젝트에 `OPENAI_API_KEY`, `OPENAI_SAFETY_HMAC_SECRET`이 모두 암호화된 서버 secret으로 등록되어 있다. 원문 조회나 실제 OpenAI 요청은 수행하지 않았으므로 키 유효성·Decisions 접근 권한까지 검증된 것은 아니다.

로컬 키 부재는 새 키 발급 사유가 아니다. 기존 키를 사용하는 평가는 Cloudflare 서버 실행 경로로 연결해야 한다. 현재 평가 CLI는 로컬 프로세스 환경만 지원하며, 서버 실행 경로 연결과 유료 API 비교 평가는 아직 수행하지 않았다. 내장 기능별 200건은 10개 계열의 합성 변형으로, 독립적인 실제 안전 정답셋이 아니다. 실제 API 정확도·지연·비용 결과, 독립 표본 검토, 스테이징 원격 검증, 운영 24시간/100건 shadow 및 순차 active 관찰은 미완료다.

운영에 배포하거나 KV를 변경하지 않았다. 설정 기본값은 legacy다. [전환 절차](decisions-rollout.md)에 따라 나머지 증거를 확보한 뒤 기능별로 전환해야 한다.
