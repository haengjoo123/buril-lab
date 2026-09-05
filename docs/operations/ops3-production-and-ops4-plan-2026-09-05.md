# Ops 3 운영 배포와 Ops 4 읽기 전용 계획 증거 — 2026-09-05

확인 시각: 2026-09-05 11:04 KST

이 문서는 Ops 3 통합 웹/API 코드의 운영 배포와 Ops 4 마이그레이션 이력 정리 전
읽기 전용 확인만 기록합니다. 사용자·연구실 정보, 원문 로그, DB 연결 비밀값과 공급자
토큰은 기록하지 않았습니다.

## Ops 3 운영 배포

- 운영 런타임 SHA: `3eb1e955635fcdb321831e5d647c7276b888edf3`
- GitHub Actions 운영 배포: `33937165920`
- GitHub production deployment: `6275848082`
- Cloudflare Pages 고정 주소: `https://9a2e0f05.buril-lab.pages.dev`
- 고정 주소와 `https://burillab.com/release.json` 모두 위 SHA로 검증 성공
- 신규·레거시 AI 라벨 API와 음성 query의 미인증 요청은 모두 HTTP 401
- 운영 배포에 사용한 Supabase PAT와 Cloudflare Pages 토큰은 공급자에서 폐기했고,
  GitHub 임시 secret·pending·감독기·로컬 잠금은 모두 0
- 서명 정리 영수증 SHA-256:
  `9137d4067d464a6950e01e4bdb1298ad0526c512ac17c0c4b048dc1583eb62ec`

이번 배포는 운영 KV와 백업 Worker를 변경하지 않았습니다. 기대 상태는 음성
`redirect`, KOSHA `full`, 삭제·유지보수 OFF, 사진백업 ON입니다.

## Ops 4 읽기 전용 계획

Supabase CLI `2.115.0`의 인증된 짧은 수명 로그인 역할로 `plan`만 실행했습니다.
운영 DB 비밀번호는 재설정하거나 파일·환경값으로 만들지 않았습니다.

- 원격 이력 상태: `legacy`
- 원격 이력 수: 89
- 검토된 이력 SHA-256:
  `ff169071822bd12de18c5485473e000aa50ad092ec6544fab25d045a471b113b`
- 고정 snapshot SHA-256:
  `c72f031e8d459e2db425352d9f97daadecada97e3f0c57060fe2b57217a964d6`
- 도구 권고: `apply`
- 변경된 DB 행·스키마·마이그레이션 이력: 0

운영 프로젝트의 가장 최근 확인된 물리 백업은 2026-09-04 17:10 KST에 완료됐고
PITR은 꺼져 있습니다. 따라서 Ops 4 실제 적용 전에는 새 논리 snapshot과 핵심 익명
합계를 별도 비동기화 위치에 만들고, 적용 직전 이력 89개와 해시를 다시 대조해야
합니다.

## 아직 완료가 아닌 항목

- Ops 4 `apply`와 `restore-legacy` 실환경 왕복 검증
- 적용 전후 스키마, 행 수, 재고·폐기 합계 불변 확인
- Ops 5 이후 운영 DB 변경
- Ops 1~3의 7일 관찰
