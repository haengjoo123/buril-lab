# Ops 5 운영 Expand 적용 증거 — 2026-09-05

확인 시각: 2026-09-05 12:32 KST

이 문서는 기존 앱을 깨뜨리지 않은 채 새 연구실 가입 서버 경로, 안전한 시약장
감사 경로와 `cabinets.image_path`를 운영 DB에 추가한 결과를 기록합니다. 사용자·연구실
식별정보, 원문 로그, 비밀번호, 공급자 자격값은 저장소에 기록하지 않았습니다.

## DB Expand

- 적용 migration: `20260903162850_ops5_expand_server_join.sql`
- 적용 전 원격 이력: 기준선 `20260824000000` 1개
- 적용 후 원격 이력: 기준선과 Ops 5, 총 2개
- 기준선 SQL 재실행: 0회
- Ops 6~11 migration 적용: 0회
- Hosted pgTAP: 14/14 통과 후 합성 변경 전부 rollback
- 기존 `join_lab`, `image_url`, 공개 사진 정책은 이 Expand에서 유지

새 가입 RPC는 브라우저가 직접 실행할 수 없고 `service_role`만 실행합니다. 가입 제한
표는 `private` schema에 있고 `anon`·`authenticated`는 schema 사용권과 직접 DML 권한이
모두 없습니다. 새 시약장 활동 함수는 `auth.uid()`와 시약장 소유 연구실 회원 여부를
함수 안에서 다시 확인하고 활동행과 감사행을 한 트랜잭션에 기록합니다.

## 운영 앱 비밀값 결합과 Pages 재배포

첫 운영 호환성 smoke에서 새 `/api/labs/join`이 503으로 닫혔고, 원인은 운영 Pages에
`LAB_JOIN_RATE_LIMIT_SECRET`이 없었던 것입니다. 값을 새로 만들고 Cloudflare의 암호화된
운영 secret으로 등록했습니다. 기존 배포에는 새 secret이 자동 결합되지 않아, 검증된
운영 artifact를 같은 런타임 SHA로 다시 배포했습니다.

- 런타임 SHA: `3eb1e955635fcdb321831e5d647c7276b888edf3`
- artifact manifest SHA-256:
  `022a28127c69117be3b5ee57fffc60eadaead3865dcaa0d4451276dcb0d695a3`
- 검증 파일 수: 70
- 새 Cloudflare Pages deployment:
  `53e2e856-8a21-42ef-ba30-e63a2dcb0d75`
- 고정 주소: `https://53e2e856.buril-lab.pages.dev`
- 공개 주소와 고정 주소의 `release.json`: HTTP 200, 위 SHA와 일치

Git 연동의 재시도 2건은 Cloudflare 내부 오류로 artifact를 만들지 못했고 운영 상태를
바꾸지 않았습니다. 이후 1회성 직접 배포는 실제로 성공했지만, 배포 직후 목록 확인이
새 항목을 즉시 찾지 못해 로컬 검증기가 실패로 판정했습니다. 따라서 그 판정만 성공으로
바꾸지 않고 Cloudflare 대시보드의 최신 production deployment, 두 `release.json`, 실제
가입 smoke를 서로 독립적으로 확인했습니다.

배포용 Pages 토큰은 생성 화면의 접근성 출력에 값이 나타나 즉시 노출된 자격값으로
취급했습니다. 정확히 이 한 배포에만 사용했고 시스템 clipboard를 비운 뒤 공급자에서
삭제했습니다. 토큰명 재검색 결과는 0건입니다. 이 토큰은 GitHub secret이나 저장소
파일로 전달하지 않았으며 원문을 증거에 남기지 않았습니다. 지속 secret인
`LAB_JOIN_RATE_LIMIT_SECRET`은 삭제 대상이 아니며 운영 Pages에 암호화된 상태로
유지합니다.

## 운영 호환성 smoke

합성 사용자 3명과 합성 연구실 1개를 시험 중에만 만들었습니다.

| 항목 | 결과 |
|---|---|
| 새 `POST /api/labs/join` | HTTP 200 |
| 기존 `join_lab` RPC | HTTP 200 |
| 정리 전 멤버십 | 기대값 3건 |
| 시험 뒤 합성 연구실 | 0건 |
| 시험 뒤 합성 멤버십 | 0건 |
| 시험 뒤 합성 사용자 | 0건 |

공개 인증 경계는 새 가입, 신규·레거시 AI 6개, 음성 query까지 8개 POST 모두 미인증
HTTP 401을 반환했습니다.

운영 KV는 다음 값과 일치했습니다.

```json
{
  "voice_disposal_mode": "redirect",
  "kosha_content_mode": "full",
  "account_deletion_enabled": false,
  "maintenance_worker_enabled": false,
  "storage_backup_enabled": true
}
```

## Security Advisor

운영 Security Advisor는 기존 53건에서 Ops 5가 만든 2건이 추가된 55건입니다. 새 항목은
Staging에서 이미 검토한 다음 두 exact 경계와 동일합니다.

- `record_cabinet_activity_v2`: `anon` 실행 불가, `authenticated`·`service_role` 실행 가능;
  운영 7 Contract에서 다시 검토할 임시 공개 경계
- `private.lab_join_attempts_v1`: RLS ON, 정책 0개, `anon`·`authenticated` schema 사용 및
  CRUD 전부 불가, `service_role`도 직접 CRUD 불가; 서버 가입 RPC만 접근하는 기본 거부 표

운영 기준선을 55건으로 갱신했고 Staging 57건과 공통인 기술 속성이 동일함을 고정했습니다.
새로 설명되지 않은 Advisor 항목은 0건입니다.

## 판정과 남은 경계

Ops 5 Expand는 운영에서 신·구 가입 경로 병행, 합성 데이터 완전 정리, 안전 스위치,
Advisor exact 경계를 통과했습니다. 따라서 Ops 5는 완료로 기록합니다.

아직 사진을 비공개로 전환하지 않았고 공개 원본·고아 파일을 이동하거나 삭제하지
않았습니다. 다음 단계는 Ops 6 Expand 권한시험과 사진별 경로·크기·SHA-256·소유권
manifest를 만든 뒤, 복사 검증이 모두 맞을 때만 private Switch를 실행하는 것입니다.
