# Gate 0 운영 배포 증거 — 2026-08-29

이 문서는 운영 배포가 실제로 일어난 사실, 배포 직후 30분 확인 결과, 아직 닫지 않은 항목을 구분해 기록합니다. 사용자 정보, 비밀값, 원문 로그는 포함하지 않습니다.

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

## 아직 닫지 않은 항목

- 운영 사용자 세션으로 OpenAI 라벨·분류·폐기 안내·음성 질의·TTS·STT 실제 호출
- 위 실제 호출 성공 후 Cloudflare 운영의 과거 Google 런타임 비밀값 폐기와 재검증
- KOSHA를 `full`로 전환할지 결정하기 전 실제 인증 smoke 확인
- 배포 후 24시간 관찰
- 배포 후 7일 관찰

따라서 Gate 0 운영 1은 **배포 및 30분 확인 완료, 24시간·7일 관찰 진행 중**입니다. 운영 2는 운영 1의 7일 관찰 전에는 운영에 반영하지 않습니다.
