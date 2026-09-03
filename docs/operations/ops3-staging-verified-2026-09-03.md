# 운영 3 — 수정 SHA의 Staging 배포·실제 검증 완료

기준 시각: 2026-09-03 13:01 KST (04:01 UTC). **API 경계와 음성 외부 자료 조회 제한을 포함한 같은 SHA의 Staging 배포·실제 AI/음성·사진 검증을 완료했다. 운영 3의 운영 배포나 7일 관찰 완료는 아니다.** 이번 작업은 운영 웹·DB·Worker·KV를 변경하지 않았다.

## 정확한 코드와 배포

| 항목 | 확인된 값 |
|---|---|
| 검증한 runtime / 소스 SHA | `2a3ea54b7ded020fdec93fb8cf0772b6b6d3d20b` |
| 포함한 코드 보완 | PR #72의 음성 외부 조회 상한·사진 검사 선택자 수정, PR #73의 승인 범위·과거 증거 문서 |
| PR #73 / main Quality | `33710827194` / `33711261437`, 각각 필수 job 4/4 성공 |
| 임시 자격값 전달 사전시험 | `33711706584`, 같은 SHA, 성공 |
| Staging 배포 | [33712590709](https://github.com/haengjoo123/buril-lab/actions/runs/33712590709), success |
| 단일 lease | `c17eca54fdad2e8140d169661666b937` |
| Pages deployment | `0f9f8be8-5409-4690-8044-59d4015644c2` |
| 고정 주소 | `https://0f9f8be8.buril-lab-staging.pages.dev` |
| Pages 생성 시각 | 2026-09-03 03:48:52 UTC |
| GitHub Pages 환경 이력 | `6236550161`, 배포 시 success; 후속 검증 환경 이력 활성화 뒤 inactive |
| Worker 배포 | `storage-backup=false`, 선택적 Worker job skipped |
| 실제 전체 검증 | [33713297440](https://github.com/haengjoo123/buril-lab/actions/runs/33713297440), 같은 SHA, `verificationScope=full`, success |
| GitHub 검증 전용 환경 이력 | `6236648843`, 최신 status success |

Cloudflare의 production deployment라는 표시는 **`buril-lab-staging` 안의 정식 배포**를 뜻한다. 실제 운영 프로젝트 `buril-lab`의 변경이 아니다. 같은 run의 빌드용 GitHub deployment `6236537360`은 inactive다. 검증 전용 workflow도 GitHub의 `staging` 환경을 사용하므로 검증 이력 `6236648843`이 03:59:40 UTC에 success가 된 뒤 이전 배포 이력 `6236550161`은 03:59:41 UTC에 inactive로 바뀌었다. 이는 GitHub 환경 이력의 표시이며 실제 Pages 서비스 중단이나 배포 실패가 아니다. 마지막 공급자 대조에서도 Cloudflare `canonical_deployment`는 위 `0f9f8be8`·2a3 SHA 그대로였다. 운영도 기존 `bb0bc6ae`·eaf SHA였다. GitHub의 최신 환경 이력과 실제 Cloudflare 서비스 배포를 구분한다.

배포 workflow는 자격값 없는 빌드와 별도 배포 runner, 정확한 산출물·SHA·서명, main Quality, 공급자 권한·만료·자동 배포 통제, 변경 직전 재검사, Supabase Hosted Advisor exact 목록을 모두 검증했다. 기존 Advisor 경고를 0건으로 없앴다는 뜻은 아니다.

## 배포에 포함된 Gate0 검증

- `staging.burillab.com`, 프로젝트 `pages.dev`, 고정 deployment 주소의 Access 보호 및 동일 SHA 확인.
- Staging 전용 KV·환경 분리와 KOSHA `link_only` 확인.
- 일반 주소와 고정 주소 각각에서 로그인 → 연구실 → 재고 검색 → 폐액 배치 → 화면 버튼 기록 → 기록 직접 링크 성공.
- 두 흐름에서 CSP 위반은 각각 0. 차단된 보강 요청은 각각 3개(재고 2, 배치 1, 기록·직접 링크 0).

기존 Gate0 보강 요청 차단과 허용 횟수는 완화하지 않았다. 차단된 요청은 실제 유료 AI 호출 성공으로 세지 않는다. 실제 호출은 아래 별도 검증에서 확인했다.

## 같은 SHA의 실제 AI·음성·WebP 검증

전체 검증 run `33713297440`의 실제 구간은 03:59:06~03:59:38 UTC다. 새 lease·공급자 토큰·배포 없이 기존 Staging 검사 계정과 환경만 사용했다.

| 검사 | 결과 |
|---|---|
| Access와 release | 일반·고정 주소 보호, 동일 SHA |
| 신규·레거시 AI 6개 및 음성 3개 미인증 요청 | 모두 JSON 401 |
| 잘못된 API 요청 | JSON 404/405, 금지 Origin 403, 잘못된 UUID/JSON 400, 초과 JSON 413, 보호 헤더 통과 |
| 신규·레거시 라벨·분류·폐기 참고 | 실제 요청 성공. 분류·폐기 참고는 `responseSource=ai`를 요구 |
| 정보가 부족한 폐기 입력 | `needs_input`, `depositAllowed=false` 유지 |
| 음성 폐기 | 고정 redirect와 검토 화면 열기만 수행, 이 smoke의 실제 폐기 기록 0 |
| 합성 재고 위치 | 응답 계약 성공. 계약에 공급자 정보가 없으므로 독립적인 공급자 호출 증거로 세지 않음 |
| TTS / STT | `audio/mpeg` 43,392 bytes, 같은 실제 음원의 `gpt-transcribe` 전사 성공 |
| 브라우저 | 로그인 200, 합성 연구실 선택, 화면 시약장 생성, 실제 파일 입력·업로드·이미지 표시 성공 |
| 브라우저 진단 | CSP 위반·페이지 오류·Access 자격 헤더 외부 전달·예상 밖 유료 요청 각각 0 |

앱 HTTP 검사는 25회, 유료 처리가 가능한 정상 앱 요청은 9회다. 내부 별칭 조회·재시도 등을 포함한 외부 공급자의 실제 총 호출 수로 주장하지 않는다. TTS 음원의 SHA-256은 `7b99529ca02dbbecb1278d8c71afb016cdd488cdfc0e88493bbac804755b8645`다.

합성 사진은 2,400×1,600 PNG에서 **1,920×1,280 WebP, 20,602 bytes**로 변환됐다. 업로드 본문·저장된 사진·재조회 사진의 크기와 SHA-256이 일치했다. 사진 SHA-256은 `b40ca47d9cf6b5dff76c8ad0c8771875cbb544bac89c472d05ab9bf5ff4fdb21`이다. 하나의 합성 이미지 성공을 모든 단말·이미지 형식의 성공 보장으로 확대하지 않는다.

새 음성 자료 조회 제한의 헤더 지연·느린 본문·잘못된 크기·끊기지 않는 취소 등의 장애 경우는 [별도 회귀시험](ops3-voice-reference-bounds.md)에서 검증했다. 실제 Staging 정상 호출 성공만으로 모든 공급자 장애 경우가 현장에서 재현됐다고 주장하지 않는다.

## 합성 데이터와 세션 정리

- `finally`에서 이번 run의 사진 1, 시약장 1, 별칭 4, 캐시 4개를 정확히 확인해 제거했다. 새 피드백은 0개였다.
- `remainingRunArtifacts=0`, 뒤의 `always` 단계도 `no-pending-run-journal`이었다.
- 04:01 UTC 별도 Supabase 집계에서 해당 run 시약장·캐시, 실행 이후 합성 계정의 사진·별칭·음성 피드백, refresh 세션이 모두 0이었다.
- 재사용 합성 계정·연구실·기준 재고·정책·기존 음성 행·감사 이력은 보존했다.
- refresh 세션 정리는 확인했지만 이미 발급된 access JWT의 즉시 무효화를 주장하지 않는다.

원본 로그, 사용자 정보, 토큰, 실제 사진 경로는 이 문서에 남기지 않는다.

## 두 임시 토큰의 전체 마감

사용자가 같은 계획 범위의 토큰 생성·숨김 전달·폐기·비활성 확인을 사전 승인했으므로 동일 승인을 반복 요청하지 않았다. **Pages-only 배포에 필요한 두 개만** 생성했다. 불필요한 세 번째 Worker 토큰이나 acceptance 토큰은 만들지 않았다.

- Supabase PAT 1개: exact lease 전용 이름, UI에서 가능한 최단 1시간.
- Cloudflare 토큰 1개: 해당 계정의 Pages Edit만 허용. 권한 자체가 개별 Pages 프로젝트 단위라는 주장은 하지 않는다.
- Cloudflare의 같은 날짜 선택은 확인 화면에서 9월 3일 시작·9월 4일 종료로 표시됐다. 감독기의 남은 수명 45분~48시간과 최대 45분 서명 임대 검사를 거쳤고, run 종료 직후 폐기했다. 이를 1시간짜리 Cloudflare 토큰이라고 기록하지 않는다.
- 토큰은 메모리의 loopback 비밀번호 입력 → 감독기 stdin → 해당 GitHub 임시 secret 경로로만 전달했다. 원문을 저장소·파일·출력·로그에 남기지 않았다.
- 두 공급자 대시보드에서 정확한 lease 항목만 폐기하고 부재를 확인한 뒤 감독기를 재개했다. 공급자 API의 inactive/401 확인과 서명 정리를 완료하고 정상 종료했다.

최신 signed cleanup receipt SHA-256:

`9bb182296011c1b01451ee8cc381205c80317b9f7b1eca443adeaf49ec033db9`

독립 전체 이력 검사는 **총 34개 lease 사용 run, epoch 1의 현재 묶음 2건, production에 복제된 Staging 영수증 일치**를 확인했다. 이전 32건 원문 해시 `2f34d77f5313398a4fdf6e06a9f926306063a7963943e2fc6e6b3b773aae3e77`과 직전 영수증 `e3d1a967a20b7beab1eb2e84c0378f7cb519f0bb3629b310f0eb157b9aa63c25`를 보존한다. 이력 삭제·bootstrap·한도 증가로 우회하지 않았다.

| 마감 대상 | 잔여 |
|---|---:|
| Staging 임시 secret / pending 변수 | 0 / 0 |
| production 임시 secret / pending 변수 | 0 / 0 |
| 저장소 범위 임시 secret / pending 변수 | 0 / 0 |
| 감독기·로컬 전달 서버·relay 프로세스 | 0 |
| supervisor lock / acquire lock | 없음 / 없음 |

작업용 Cloudflare·전달 탭과 브라우저 메모리의 토큰 값을 정리했다. 원래 사용자 Supabase 탭과 무관한 기존 토큰·파일은 유지했다. 위 0은 임시 절차의 잔여 값이며 모든 서비스 자격값이 없다는 뜻은 아니다.

## 이전 실패와 남은 운영 관문

[이전 세 번의 실제 검증](ops3-live-staging-attempt-2026-09-03.md)의 1·2차 실패는 그대로 남긴다. 기존 a703 SHA의 성공을 새 코드 성공으로 옮겨 적지 않고, 이번 2a3 SHA의 배포와 전체 검증을 별도로 실행했다. [이전 CSP 실패](ops3-staging-evidence-2026-09-03.md)와 [직전 Staging 배포 성공](ops3-staging-success-2026-09-03.md)도 보존한다.

- 운영은 SHA `eaf9e7d201c89e47fd317af88a98a7612f012534`, Pages `bb0bc6ae-dbaa-487e-b30d-eec3098facb7`을 유지한다. 03:56 UTC에 공개·고정 `release.json`을 같은 SHA로 재검증했다.
- 운영 KV는 `redirect/full/false/false/true`, Staging은 `redirect/link_only/false/false/false`다. 운영 백업은 ON이며 이번 Staging Pages 배포가 Worker나 백업 스위치를 바꾸지 않았다.
- 실제 운영 일일 백업은 현재 **0/2**. 다음 예약은 9월 4일·5일 02:45 KST다. 수동·합성·OFF 빈 실행을 세지 않는다.
- 재활성화 기준 24시간은 9월 4일 04:41 KST 이후, 7일은 9월 10일 04:41 KST 이후의 실제 증거가 필요하다. 운영 1의 별도 관찰도 추정해 닫지 않는다.
- 운영 3의 운영 반영은 선행 관찰 이후에만 가능하다. 그 시점의 보호된 main·동일 SHA Staging·필수 품질검사 계약을 다시 충족해야 한다.
- 문서 증거만 병합해 main SHA가 바뀐 것은 실행 중인 코드가 바뀌었다는 뜻이 아니다. 이 문서를 기록하려고 즉시 새 lease·토큰·재배포를 반복하지 않는다.
- 운영 4~12, RPO 1시간, guided 음성, 파일럿·유료 출시는 미완료다.
