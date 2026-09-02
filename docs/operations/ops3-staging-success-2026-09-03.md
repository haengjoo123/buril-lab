# 운영 3 수정 코드의 Staging 배포·정리 증거

2026-09-03 KST. **수정 코드의 Staging 배포와 Gate0 브라우저 검사는 성공했습니다. 운영 3의 운영 반영·전체 안전 검증 완료 기록은 아닙니다.** 운영 웹·DB·백업 Worker는 이번 실행에서 변경하지 않았습니다.

## 검토된 코드와 정확한 배포

| 항목 | 확인된 값 |
|---|---|
| CSP 수정 | PR #67, merge `56b8c98fb072631daeb6872b53ffcbc182a17b0b` |
| PR #67 품질검사 | PR `33690480239`, main `33690798018`; 각각 필수 job 4/4 성공 |
| 서명 기록 보존 전환 도구 | PR #68, merge `a703570f2e4cc6ad773b051f583ec04c060caaf0` |
| PR #68 품질검사 | PR `33692984534`, main `33693478877`; 각각 필수 job 4/4 성공 |
| Staging runtime SHA | `a703570f2e4cc6ad773b051f583ec04c060caaf0` |
| Staging 배포 run | `33694980335`, success |
| 단일 lease | `ed4b0ad24618d159a468d65658ad5b13` |
| Pages deployment | `7237c27b-e24f-4e74-8889-f1aeb1da4f74` |
| 고정 주소 | `https://7237c27b.buril-lab-staging.pages.dev` |
| GitHub Pages 배포 | `6233785976`, 최신 status success |
| Worker 선택 | `storage-backup=false`; Worker job skipped |

Cloudflare의 이 deployment는 **`buril-lab-staging` 프로젝트 내부의 production deployment**입니다. 실제 운영 프로젝트 `buril-lab`에 배포했다는 뜻이 아닙니다. 배포 run은 2026-09-03 08:25 KST에 시작했고 최종 GitHub 배포 success는 08:28:53 KST에 기록됐습니다.

## 실제 통과한 검사와 경계

- 배포 자격값이 없는 빌드 단계와 별도 배포 단계, 정확한 산출물 해시·서명·SHA 검사
- 현재 main의 Quality, Supabase Hosted Advisor exact 허용 목록, Cloudflare 자동 배포 통제, 변경 직전 재검사
- `staging.burillab.com`, Staging `pages.dev`, 고정 deployment 주소의 Access 보호 및 동일 SHA
- Staging KOSHA `link_only`, 별도 KV 바인딩 및 환경 분리
- 일반 Staging 주소와 고정 주소 각각에서 실제 로그인→연구실→재고 검색→폐액 배치→화면 최종 기록→기록 직접 링크
- 두 브라우저 흐름 모두 배포된 CSP 위반 0, 승인되지 않은 주소로 Access 헤더 전달 0, 예상 밖 최상위 화면 이동 0

| 익명 브라우저 집계 | 일반 Staging 주소 | 고정 배포 주소 |
|---|---:|---:|
| 차단된 보강 요청 전체 | 3 | 3 |
| 재고 단계 | 2 | 2 |
| 배치 단계 | 1 | 1 |
| 기록 / 직접 링크 단계 | 0 / 0 | 0 / 0 |
| CSP 위반 | 0 | 0 |

보강 요청은 기존 Gate0 계약대로 브라우저에서 차단했습니다. 허용 횟수 `1~3`은 완화하지 않았습니다. **이 검사는 실제 OpenAI 호출 성공을 뜻하지 않습니다.** 음성 질의·합성·전사와 실제 시약장 사진 업로드의 새 API 경계 검증은 별도 항목으로 남습니다.

이전 실패 run `33688171606`, 재검증 `33688968586`, GitHub deployment `6232714247`의 failure는 그대로 보존합니다. [이전 실패와 CSP 재현 증거](ops3-staging-evidence-2026-09-03.md)를 덮어쓰거나 성공으로 바꾸지 않았습니다.

## 이전 32건을 보존한 서명 기록 전환

PR #68과 main 품질검사 통과 후 정확한 clean main에서 `plan`과 `apply`를 실행했습니다. 공급자 토큰 생성 전에 기존 서명과 GitHub 자격값 사용 배포 32건을 대조했습니다.

- 이전 v3/epoch 0 원문 해시: `2f34d77f5313398a4fdf6e06a9f926306063a7963943e2fc6e6b3b773aae3e77`
- 원문은 `config/ephemeral-cleanup-epochs/staging/`의 같은 해시 파일에 원래 서명 그대로 보존
- 전환 직후 v4/epoch 1/현재 묶음 0건의 해시: `0959c33841c116a00af9dfc0afe521ccf8ec166c80126368e611928e9e3cc77d`
- 이 배포 정리 후 해시: `e3d1a967a20b7beab1eb2e84c0378f7cb519f0bb3629b310f0eb157b9aa63c25`
- 독립 읽기 전용 재검증: **총 33개 실제 lease 사용 run**, epoch 1, 현재 묶음 1건. 이전 32건과 새 1건의 서명·연결·GitHub 이력 및 production의 Staging 영수증 사본이 모두 일치

묶음당 32건·서명 데이터 48 KiB 한도는 그대로입니다. bootstrap, 이전 이력 삭제, 미완성 영수증 덮어쓰기, 비감독 배포는 사용하지 않았습니다. Windows DPAPI 개인키와 저장소 공개키도 바꾸지 않았습니다. 절차와 중간 실패 복구는 [서명 기록 전환 문서](signed-cleanup-epoch-rollover.md)를 따릅니다.

## 이번 임시 자격값의 마감

이번 exact lease에는 **Supabase PAT 1개와 해당 Cloudflare 계정의 Pages Edit 토큰 1개만** 생성했습니다. PAT는 1시간, Pages 토큰은 날짜 단위 UI에서 가능한 짧은 유효기간을 선택하고 감독기의 만료·권한 검사를 통과했습니다. Worker·acceptance 토큰은 만들지 않았습니다.

두 값은 화면에서 출력 없이 수신해 loopback의 비밀번호 입력란과 감독기 표준 입력으로만 전달했습니다. GitHub 임시 secret 외에 토큰 원문을 파일·저장소·로그·작업 메시지로 남기지 않았습니다. 브라우저 내 임시 값과 일회성 표시도 정리했습니다.

run 종료 후 정확한 두 공급자 항목을 폐기했고 두 목록에서 해당 lease 항목 0개를 확인했습니다. 이어 감독기가 폐기된 값으로 공급자 API 비활성 검증을 수행한 뒤 위 정리 영수증을 서명하고 정상 종료했습니다.

- Staging·production 환경의 임시/acceptance secret 0, pending/lease grant 0
- 감독기 PID 종료, 로컬 lock와 acquire lock 없음
- 로컬 전달 서버 종료, 이번 전달 보조 파일과 작업용 탭 제거
- 기존 다른 서비스 토큰, 다른 lease의 만료 표시 항목, 사용자 소유 미추적 파일은 변경하지 않음

여기서 0은 **이번 운영 절차의 임시 secret·표식 및 해당 lease 토큰**을 뜻합니다. 공급자 계정의 모든 토큰이 0개라는 뜻이 아닙니다.

## 운영 및 남은 관문

운영 runtime은 `eaf9e7d201c89e47fd317af88a98a7612f012534`, Pages는 `bb0bc6ae-dbaa-487e-b30d-eec3098facb7`을 유지합니다. 운영 KV 정상값은 `redirect/full/false/false/true`, Staging은 `redirect/link_only/false/false/false`입니다. 운영에서 일일 사진 백업을 끄거나 Staging에서 켜지 않았습니다.

- 새 본문 처리 경로의 실제 OpenAI 음성·라벨·분류 요청과 로그인 후 합성 사진 업로드 검증
- 실제 운영 일일 백업 연속 2회: 현재 0/2, 다음 예정일 9월 4일·5일 02:45 KST
- 재활성화 기준 24시간: 9월 4일 04:41 KST 이후, 7일: 9월 10일 04:41 KST 이후 실제 증거 필요
- 운영 3~12, RPO 1시간, guided 음성, 파일럿·유료 출시는 미완료

수동·합성시험·재배포·OFF 빈 실행을 일일 백업 성공으로 세지 않습니다. 다음 운영 묶음은 계획의 관찰 조건을 충족하기 전에 배포하지 않습니다.
