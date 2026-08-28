# Gate 0 운영 배포 증거 — 2026-08-29

이 문서는 운영 배포가 실제로 일어난 사실, 배포 직후 30분 확인, 인증된 OpenAI 운영 시험, 과거 Google 키 폐기, 아직 닫지 않은 항목을 구분해 기록합니다. 사용자 정보, 비밀값, 원문 로그는 포함하지 않습니다.

## 배포 식별자

| 항목 | 값 |
|---|---|
| 운영 런타임 SHA | `94076357fa5f073a7e641730e20c2c24d2a8a43b` |
| 운영 workflow | [33197347433](https://github.com/haengjoo123/buril-lab/actions/runs/33197347433) |
| GitHub deployment | `6146115369` |
| Cloudflare deployment | `61dab7a6-4af1-43cb-8415-59d6a337eafd` |
| 고정 배포 주소 | `https://61dab7a6.buril-lab.pages.dev` |
| 운영 주소 | `https://burillab.com` |
| 배포 시각 | 2026-08-29 03:02 KST |
| 배포 정리 영수증 SHA-256 | `8728dfce2f0c37047062b539c6ab672be0f5a945f2c8826d2367d9d9c612574f` |

같은 런타임 SHA의 Staging 배포 workflow는 [33196131576](https://github.com/haengjoo123/buril-lab/actions/runs/33196131576)이며, 임시 공급자 자격값 폐기와 GitHub 임시 secret 제거를 마친 정리 영수증 SHA-256은 `2ad440c8b3cf9ce9cfc4ab6191555d8e3dac3fe1bc13202a9bd66bff1bbf7056`입니다.

## 배포 판정 교정

운영 파일 업로드와 고정 배포 주소 생성은 성공했지만 최초 workflow는 유효한 고정 Pages 주소를 검증기가 허용하지 않아 실패로 끝났습니다. 런타임 문제가 아니라 검증기 오탐이었습니다.

- 검증기 수정 병합 기준 SHA: `bbe9faa9c5f67834b0cd47b57d106a6b97762bf3`
- 수정 품질검사: [33198771645](https://github.com/haengjoo123/buril-lab/actions/runs/33198771645), 네 필수 job 모두 성공
- 기존 고정 주소와 운영 주소의 `release.json`을 수정된 검증기로 다시 확인해 모두 운영 런타임 SHA와 일치
- GitHub deployment `6146115369`에 사후 재검증 성공 상태 기록

`94076357...`과 `bbe9faa...`의 차이는 릴리스 manifest 주소 검증기와 그 회귀시험뿐입니다. 배포된 애플리케이션 런타임을 바꾸지 않으므로 이 교정을 위한 재배포는 하지 않았습니다.

## 30분 확인

2026-08-29 03:32 KST에 다음을 확인했습니다.

- 고정 주소와 운영 주소의 `release.json`이 모두 운영 런타임 SHA를 반환
- Cloudflare Pages production의 최근 24시간 집계: 성공 32건, 오류 0건
- 내부 오류, 스크립트 예외, CPU 시간 초과, 메모리 초과, 클라이언트 연결 종료 오류가 모두 0건
- 신규 `/api/ai/classify`, 레거시 `/api/gemini/classify`, `/api/voice/query`가 미인증 요청을 모두 HTTP 401로 거부
- 운영 KV `runtime_config`가 다음 제한 상태를 유지

```json
{
  "voice_disposal_mode": "redirect",
  "kosha_content_mode": "link_only",
  "account_deletion_enabled": false,
  "maintenance_worker_enabled": false,
  "storage_backup_enabled": false
}
```

이 확인으로 30분 관찰만 통과했습니다. 최근 24시간 지표는 프로젝트 집계이므로 32건 모두가 새 배포 이후 요청이었다고 해석하지 않습니다.

## 인증된 OpenAI 운영 시험과 Google 정리

30분 확인 뒤 임시 운영 시험 계정으로 다음 실제 호출을 확인했습니다. 시험 계정·연구실·부속 행은 바로 삭제했고, 삭제 후 관련 행 수가 모두 0이며 기존 JWT가 HTTP 403으로 거부되는 것도 확인했습니다.

- 신규 `/api/ai/scan-label`, `/api/ai/classify`, `/api/ai/disposal-guide`가 모두 HTTP 200
- 레거시 `/api/gemini/*` 세 별칭도 HTTP 200이고 신규 경로와 같은 응답 계약·분류·판정·목적지를 반환
- 폐기 음성 질의는 기존 배치 검토 화면만 열고 용기 투입·희석·중화·혼합 같은 행동 지침을 반환하지 않음
- 위치 음성 질의는 위치 의도로 처리되고, 결과가 모호할 때 명확히 다시 묻는 응답을 반환
- TTS가 `audio/mpeg`을 반환하고, 해당 음성을 STT가 `gpt-transcribe` 모델로 다시 변환
- Cloudflare 운영·Staging Pages에서 `GEMINI_API_KEY`, `GOOGLE_VISION_API_KEY`를 제거하고 `OPENAI_API_KEY`는 유지
- Google 런타임 비밀값 제거 뒤 신규·레거시 라벨, 신규 분류, TTS를 다시 실제 호출해 모두 HTTP 200

과거 저장소에 노출됐던 Google Vision 키는 별도 이전 프로젝트의 리소스였습니다. 공급자에서 해당 리소스를 삭제한 뒤 Vision 요청이 기존 HTTP 200에서 HTTP 400 `INVALID_ARGUMENT`와 `API Key not found`로 바뀌었습니다. Google Cloud의 삭제 포함 목록에서도 `deleteTime`이 있는 동일 리소스를 확인했습니다. GitHub secret-scanning 경고 #1은 `revoked`로 해결했고 공개 상태 경고는 0건입니다. 새 제한형 Google 프로젝트 키는 이 과거 노출 키와 다른 리소스이며 이번 폐기 대상이 아닙니다.

## KOSHA 정상 모드 전환

30분 확인과 인증된 운영 시험을 모두 통과한 뒤 `kosha_content_mode`만 `link_only`에서 `full`로 바꿨습니다. 변경 직전 Pages 최근 24시간 집계는 성공 46건·오류 0건이었고 내부 오류 종류도 모두 0건이었습니다. 다른 네 안전 스위치는 그대로 닫힌 상태를 유지했습니다.

```json
{
  "voice_disposal_mode": "redirect",
  "kosha_content_mode": "full",
  "account_deletion_enabled": false,
  "maintenance_worker_enabled": false,
  "storage_backup_enabled": false
}
```

전환 직후 운영 `chemlist` 호출은 HTTP 200, 공식 XML, `Cache-Control: no-store`로 확인했습니다. KV 전파 지연을 고려해 2분 이상 지난 뒤 두 번 더 호출해 같은 계약을 확인했고, 대시보드에서 다섯 KV 값도 다시 읽었습니다. 따라서 KOSHA `full` 전환은 완료했으며 나머지 네 안전 스위치는 계속 닫혀 있습니다.

## 아직 닫지 않은 항목

- 배포 후 24시간 관찰
- 배포 후 7일 관찰

따라서 Gate 0 운영 1은 **배포·30분 확인·인증된 OpenAI 운영 시험·Google 정리 완료, 24시간·7일 관찰 진행 중**입니다. 운영 2는 운영 1의 7일 관찰 전에는 운영에 반영하지 않습니다.
