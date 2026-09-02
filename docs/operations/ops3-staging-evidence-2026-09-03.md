# 운영 3 Staging 배포·실패·정리 증거

2026-09-03 KST. **운영 3 통과 기록이 아닙니다.** Staging 웹 변경은 발생했지만 고정 배포 주소의 마지막 검사가 실패했습니다. 운영 웹·DB·Worker는 이 작업에서 변경하지 않았습니다.

이 문서는 이전 실패 run의 증거를 보존합니다. 이후 PR #67·#68을 반영한 별도 run `33694980335`는 두 Staging 주소의 Gate0 검사를 통과했고 정리까지 완료했습니다. 최신 결과는 [수정 코드 Staging 성공 증거](ops3-staging-success-2026-09-03.md)에 분리했습니다. 아래의 실패·당시 잔여 항목을 현재 상태로 오인하지 않습니다.

## 정확한 대상과 결과

| 항목 | 확인된 값 |
|---|---|
| 준비 코드 병합 | PR #66, `d268732760c93978b718c2df6bb77404f4eccb57` |
| main Quality | `33685967561`, 필수 job 4개 성공 |
| Staging 배포 run | `33688171606`, 최종 실패 |
| 단일 lease | `2755a02d1af0efbda4497dcec4115f4e` |
| Pages deployment | `5296df72-ceb4-468f-bbb5-9148400b2a7f` |
| 고정 주소 | `https://5296df72.buril-lab-staging.pages.dev` |
| GitHub 배포 | `6232714247`, failure 유지 |
| Worker 배포 선택 | `storage-backup=false`; Worker job 미실행 |
| 재배포 없는 재검증 | `33688968586`, 동일 고정 주소 검사에서 실패 |

통과한 부분은 배포 산출물 검증, Hosted Advisor exact 검사, 세 Staging 주소의 Access 보호와 동일 SHA, KOSHA link-only 계약, KV 환경 분리, 일반 Staging 주소의 로그인→연구실→재고 검색→화면 폐기 기록→직접 링크입니다.

고정 주소에서도 화면 기록과 직접 링크 확인까지 도달했으나 마지막 `verifyGate0EnrichmentIsolation`의 요청 횟수 검사가 실패했습니다. 원래 오류에는 실제 횟수가 없으므로 이 실행만으로 0회와 상한 초과를 구분하지 않습니다. 성공 status를 덧붙이거나 실패 기록을 지우지 않았습니다.

Supabase 플러그인으로도 별도 읽기 전용 확인을 수행했습니다. 기존 경고 53개와 카탈로그 권한 객체 52개의 조합이 고정된 목록과 정확히 일치했습니다. 정규화 결과 SHA-256은 `a9b9fdaf67a7852f3533f828a282956c5d46738518efcf1a5c2ca527c5c9bb26`입니다. 경고가 없다는 뜻이 아니라 **새 차이가 없다는 뜻**입니다. 앱 행·함수 본문·비밀값을 읽거나 DB 구조를 바꾸지 않았습니다.

## 재현한 CSP 문제와 후속 수정

Staging 빌드는 내부 API 주소를 `https://staging.burillab.com`으로 고정합니다. 새 정적 CSP의 `connect-src`에는 해당 주소가 빠져 있어, 같은 주소의 화면에서는 허용되는 호출이 별도 고정 배포 주소에서는 막힙니다.

실제 로컬 Pages 응답의 CSP를 사용하는 Chromium 시험에 다른 origin→정식 API 호출을 추가했고, 수정 전 실패를 재현했습니다. 외부 요청은 정확한 시험 주소에서 로컬 응답으로 처리했으며 실제 API·DB·AI·Access 자격값은 사용하지 않았습니다.

후속 변경은 다음과 같습니다.

- 공통 정적 CSP에 확인된 두 API 주소 `https://burillab.com`, `https://staging.burillab.com`만 명시합니다. 임의의 `*.pages.dev`, `*.burillab.com`, 모든 HTTPS 연결을 허용하지 않습니다.
- CSP의 송신 가능 주소와 서버의 접근 권한은 별개입니다. 운영·Staging의 기존 CORS·인증·요청 제한은 변경하지 않습니다. 운영 API가 Staging origin을 허용하도록 바꾼 것이 아닙니다.
- 두 정확한 주소는 통과하고 미승인 외부 주소는 여전히 실제 브라우저에서 차단되는 회귀시험을 추가합니다.
- Gate0는 고정된 화면 단계별 차단 횟수와 CSP 위반 지시문별 개수만 기록합니다. URL·요청 본문·사용자/연구실 식별자·헤더는 기록하지 않습니다.
- 기존 보강 요청의 `false=0회`, `true=1~3회` 기준은 그대로 유지합니다. 0회·4회·100회의 거부와 오류의 익명 횟수 표기를 시험합니다.

[Cloudflare 공식 헤더 문서](https://developers.cloudflare.com/pages/configuration/headers/)의 정적 응답 규칙과 Functions 응답 분리를 따릅니다. 이 수정이 원격 Staging의 나머지 문제까지 해결했다는 판정은 **수정 SHA를 실제 배포한 후**에만 가능합니다.

후속 수정의 로컬 결과: 전체 시험 **1,177개 통과·7개 기존 보류**, 실제 Pages HTTP 조건 **37개**, Chromium CSP 흐름 **4개** 통과. 전체 lint, TypeScript를 포함한 빌드, 클라이언트 비밀값 검사, Cloudflare 구성·변경 범위·공백 검사도 통과했습니다. 원격 수정 배포나 실제 OpenAI 호출까지 통과했다고 확대하지 않습니다.

## 임시 자격값 정리

- 단일 감독기에 1시간 Supabase PAT와 해당 Cloudflare 계정의 Pages Edit 토큰만 숨김 전달했습니다. Worker·acceptance 토큰은 생성하지 않았습니다.
- 처음 생성했지만 숨김 전달되지 않은 PAT 한 개는 공급자 화면에서 먼저 폐기했습니다. 당시 사용 이력은 없었으며, 같은 label이 0개인 것을 확인한 뒤 같은 범위로 재발급했습니다. 이 미전달본의 폐기는 화면 확인이며 API 401 검증으로 표현하지 않습니다.
- 실제 전달된 두 토큰은 run 종료 후 정확한 공급자 항목을 폐기했습니다. 감독기가 Cloudflare inactive/401과 Supabase 401을 확인한 뒤 정리 영수증을 서명했습니다.
- 영수증 SHA-256: `2f34d77f5313398a4fdf6e06a9f926306063a7963943e2fc6e6b3b773aae3e77`
- GitHub 임시 secret·pending/lease grant 0, 감독기 PID 종료, lock/acquire lock 없음. 로컬 전달 서버·임시 보조 소스·임시 브라우저 창도 정리했습니다. 사용자 소유 파일과 기존 다른 서비스의 토큰은 건드리지 않았습니다.
- Staging 영수증은 **sequence 32 / 32개 lease**입니다. 기존 서명 이력을 삭제하거나 새 bootstrap으로 우회하지 않습니다. 다음 발급 전에는 이전 전체 기록을 보존·검증하는 검토된 epoch 전환 경로가 필요합니다.

## 계속 열려 있는 관문

운영은 `eaf9e7d201c89e47fd317af88a98a7612f012534` / `bb0bc6ae-dbaa-487e-b30d-eec3098facb7`을 유지합니다. 공개·고정 `release.json`의 JSON 200과 동일 SHA를 재확인했습니다. 운영 KV는 `redirect/full/false/false/true`, Staging은 `redirect/link_only/false/false/false`입니다.

- 수정 코드의 CI, 실제 Staging 재배포, CSP를 포함한 인증된 전체 흐름과 실제 OpenAI 요청
- 이전 서명 정리 기록을 보존하는 epoch 전환 검증
- 운영 사진 백업의 실제 일일 연속 성공 2회와 재활성화 기준 24시간·7일 관찰
- 후속 운영 3~12, RPO 1시간, guided 음성, 파일럿·유료 출시

일일 백업은 2026-09-03 04:41 KST 재활성화 뒤 아직 0/2회입니다. 예정된 다음 두 실제 예약 실행은 9월 4일·5일 02:45 KST이며, 7일 관찰을 9월 10일 04:41 KST보다 먼저 닫지 않습니다. 수동 검증이나 재배포 횟수를 일일 성공으로 세지 않습니다.
