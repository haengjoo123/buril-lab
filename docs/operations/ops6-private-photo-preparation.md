# Ops6 비공개 시약장 사진 전환 준비

이 문서는 운영 6의 **로컬 준비물**을 설명합니다. 이 브랜치나 커밋은 운영 준비 완료를 뜻하지 않으며, 운영 1·2 관찰, 운영 3, 운영 4, 운영 5를 순서대로 통과하기 전에는 Staging 또는 운영에 적용하지 않습니다.

## 고정된 안전 경계

- 브라우저는 Supabase Storage에 사진을 직접 쓰거나 지우지 않습니다.
- 업로드는 WebP 본문 최대 2 MiB만 서버 API가 받습니다.
- DB가 연구실 구성원 또는 개인 소유자를 확인한 후에만 `labs/<lab>/cabinets/<cabinet>/<uuid>.webp` 또는 `users/<user>/cabinets/<cabinet>/<uuid>.webp` 경로를 발급합니다.
- 연구실 또는 개인 범위에 참조 중인 사진은 최대 50장이고 40장부터 경고합니다. DB의 범위 잠금이 동시 요청에도 51번째 참조를 거부합니다.
- 조회 주소는 1시간짜리 서명 URL이며, 요청한 정확한 Storage 경로와 일치할 때만 브라우저에 반환합니다.
- 교체·제거된 본문과 공개 원본은 즉시 삭제하지 않고 최소 7일 보존 목록에 둡니다.
- 공개 사진이 아직 이관되지 않은 시약장은 교체·사진 제거·시약장 삭제를 거부합니다.
- `migrate-ops6-private-photos.mjs apply`는 기존 JPEG·PNG·WebP 원본을 엄격히 해석한 뒤 최대 긴 변 1920px·2 MiB의 단일 프레임 WebP로 다시 만들고, 복사와 검증 및 DB 경로 연결만 수행합니다. 공개 원본 삭제, 버킷 비공개 전환, 운영 배포는 하지 않습니다.
- 계정·연구실 삭제 기능은 이 묶음에서 켜지지 않습니다. 현재 삭제 경로는 `image_url` 중심이므로 운영 9 작업표 기반 삭제로 전환하기 전까지 계속 OFF입니다.

## DB 적용 순서

1. 운영 5의 Expand가 적용된 상태에서 `20260904020000_ops6_private_cabinet_photos_expand.sql`만 적용합니다.
2. 새 API를 아직 공개하지 않은 채 이관 도구를 먼저 `plan`으로 실행합니다.
3. 참조 누락이 0인지 확인한 뒤 `apply`를 실행합니다.
4. 도구가 원본 다운로드, 형식·크기·픽셀 수·단일 프레임 확인, WebP 변환, 비공개 경로 업로드, 재다운로드, 크기·SHA-256 일치, DB 연결을 순서대로 확인합니다. journal에는 원본과 변환본의 SHA-256·크기·원본 MIME을 함께 기록합니다.
5. 저장소 밖의 증거 폴더에 해시 연결 journal과 DPAPI Ed25519 서명 영수증을 남깁니다. 원문 파일·사용자 정보·비밀값은 Git 저장소에 넣지 않습니다.
6. 모든 참조가 연결되고 본문 검증이 끝난 뒤에만 `20260904021000_ops6_private_cabinet_photos_switch.sql`을 적용합니다.
7. 같은 후보 SHA의 Pages API와 `SOURCE_POINTER_MODE=private_path` 백업 Worker를 배포합니다.
8. 공개 URL 실패, 구성원 서명 URL 성공, 다른 연구실 거부, 백업 성공을 확인합니다.

Switch SQL은 다음 중 하나라도 발견하면 트랜잭션 전체를 실패시킵니다.

- `image_url`이 있는데 `image_path`가 없는 참조
- `image_path`에 대응하는 붙어 있는 SHA-256·크기 메타데이터가 없는 참조
- `cabinets` Storage 버킷이 없는 환경

## 로컬 PostgreSQL 의미 시험

공식 PostgreSQL 17.11 ZIP과 그 ZIP에서 검토한 실행 파일만 사용합니다. 이 명령은 자체 임시 loopback DB 두 개를 만들고 시험 후 정확히 그 임시 디렉터리만 제거합니다.

```powershell
node scripts/test-ops6-local-postgres.mjs `
  C:\Users\gudwn\.codex-tmp\postgresql-17.11-portable\pgsql\bin `
  C:\Users\gudwn\.codex-tmp\postgresql-17.11-1-windows-x64-binaries.zip
```

검증 범위:

- 빈 DB 두 번 설치
- 브라우저 역할의 RPC·private 표 직접 접근 거부
- 연구실·개인 경로 구분과 오래된 `user_id=null` 연구실 시약장 이관
- 40장 경고와 50장 상한
- 51개 동시 요청에서 성공 50·거부 1
- 잘못된 연구실 경로, 오래된 예상 경로, 다른 연구실 접근 거부
- 공개 원본과 교체·제거 본문의 7일 보존
- 이관 미완료 Switch의 원자적 실패
- 이관 완료 후 비공개·WebP 전용·2 MiB 제한과 공개 쓰기 정책 제거

이 시험은 실제 Hosted Supabase Auth·Storage 동작을 증명하지 않습니다. Staging에서 별도 실제 API·Storage 이관훈련이 필요합니다.

## 실환경 이관 도구

`plan`은 DB와 Storage를 읽기만 하고 경로 대신 익명 집계만 출력합니다.

```powershell
node scripts/migrate-ops6-private-photos.mjs plan
```

필수 환경값은 정확한 환경명, 프로젝트 ref, HTTPS Supabase URL, 서비스 역할 키입니다. `apply`에는 추가로 검토된 Git SHA, 저장소 밖의 증거 디렉터리, 다음 형식의 정확한 확인문구가 필요합니다.

```text
APPLY OPS6 PRIVATE PHOTO COPY <staging|production> <project-ref> <40자리 SHA>
```

도구는 다음 경우 보수적으로 중단합니다.

- Supabase URL·서비스 자격값·프로젝트 ref 불일치
- Git 작업트리 변경 또는 후보 SHA 불일치
- 외부 주소 이동, 20초 초과, 과대 응답
- 한 Storage 본문을 여러 시약장이 참조
- 참조 본문 누락, JPEG·PNG·WebP 이외 형식, 선언 형식과 실제 바이트 불일치, 손상·다중 프레임, 20 MiB 또는 6,400만 픽셀 초과
- 변환한 WebP가 긴 변 1920px 또는 2 MiB를 초과
- 복사 후 재다운로드 SHA-256 또는 크기 불일치
- DB 연결 응답을 잃고 재조회로도 정확한 연결을 증명할 수 없음
- 기존 journal·서명 영수증이 현재 공급자 상태와 불일치

실패 시 새로 복사한 본문을 자동 삭제하지 않습니다. DB 반영 여부를 알 수 없는 상태에서 참조 중인 사진을 지우지 않기 위해 quarantine으로 남기며, 운영 12의 별도 승인 목록에서만 정리합니다.

## Staging 통과조건

- 합성 공개 사진, 개인 사진, 연구실 사진, 생성자 정보가 없는 오래된 연구실 사진을 모두 이관
- 크기와 SHA-256 일치, 참조 누락 0
- 공개 URL 접근 실패, 구성원 1시간 서명 URL 성공, 다른 연구실 403
- 교체·제거 후 원본이 최소 7일 보존 목록에 남음
- 5개 연구실 × 50장과 변경·삭제 혼합 시험
- 백업 Worker가 `image_path`만 조회하고 완전한 새 snapshot을 생성
- Switch 전 복사 실패와 Switch 중 SQL 실패의 복구훈련
- 공개 원본은 7일 동안 그대로 유지하며 삭제 0

## 되돌림

- Pages/API 문제: 직전 성공한 Pages deployment로 되돌립니다.
- 서명 URL 문제: 새 업로드를 중단하고 DB·Storage는 유지합니다.
- Switch 문제: 보존 manifest의 공개 원본과 `image_url` 연결을 새 전진 migration으로 복원합니다. 임의 하향 migration은 만들지 않습니다.
- 백업 문제: Worker를 OFF로 닫고 마지막 성공 snapshot을 유지합니다.
- 원본 정리는 비공개 전환 후 7일, 해시·소유권 재확인, 정확한 삭제 목록과 별도 확인문구가 모두 있을 때 운영 12에서만 수행합니다.

## 현재 판정

- `productionReady: false`
- 실제 Supabase 변경: 운영 5 및 운영 6 Expand 적용, 사진 본문·DB 사진 경로는 아직 미변경
- 실제 Cloudflare 변경: 이 준비 수정에서는 0
- 실제 파일 삭제: 0
- 완료된 선행 관문: 운영 1·2, 운영 3, 운영 4, 운영 5
- 다음 실환경 단계: 운영 원본 변환·비공개 복사 → Switch → Pages/Worker 검증 → 접근·백업 검증
