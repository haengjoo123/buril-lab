# 검색·최종 배치 인텔리전스 운영 런북

최종 갱신: 2026-08-23

## 배포 순서

1. `VITE_ENABLE_SEARCH_ANALYTICS=false`로 개인정보처리방침과 앱스토어 수집 고지를 먼저 배포한다.
2. `supabase/migrations/20260823085224_search_batch_intelligence.sql`을 Supabase migration으로 적용한다.
3. `OPS_ADMIN_EMAILS`와 더 좁은 `OPS_ANALYTICS_EXPORT_EMAILS`를 Cloudflare 서버 환경에 설정한다.
4. 검색 이벤트·행동 API와 `/ops/analytics`를 배포한 뒤 아래 스모크 테스트를 수행한다.
5. 기능 플래그를 `true`로 명시해 실제 제출 검색의 필수 수집을 활성화한다.

기능 플래그가 누락된 빌드는 기본 활성 상태다. 사전 고지·마이그레이션이 아직 준비되지 않은 환경은 반드시 `false`를 명시한다.

## 마이그레이션 특성

- 기존 `user_search_history`는 `legacy_success_unknown`으로만 백필하며 결과·선택·수정 행동을 추정하지 않는다.
- 원시 분석 테이블은 RLS를 사용하고 `anon`·`authenticated` 권한이 없다.
- `service_role`도 먼저 모든 기본 권한을 회수한 뒤 API별 최소 권한만 부여한다. 행동·감사 테이블은 append-only다.
- `pg_cron`이 게스트 90일 만료, 검토 후보 생성, 전월 임계 집계를 수행한다.
- 외부 상품 활성 컬럼에는 항상 `false`만 허용하는 DB CHECK가 있다. 기관 약정·재식별 위험평가·법률 검토 상태는 표시만 하며 이 마이그레이션으로 외부 제공을 열 수 없다.

## 검증 명령

```bash
npx tsc -b
npx vitest run functions/api/analytics/_shared.test.ts functions/api/admin/analytics/_shared.test.ts functions/api/admin/analytics/export.test.ts src/services/searchAnalyticsService.test.ts supabase/migrations/search_batch_intelligence.test.ts functions/api/chemicals/enrich.test.ts functions/api/chemicals/suggest.test.ts src/services/wasteLogService.test.ts
npm run build
```

마이그레이션 적용 후 로컬 또는 격리된 검증 DB에서 다음 SQL을 실행한다. 파일 자체가 트랜잭션을 열고 마지막에 롤백한다.

```text
supabase/tests/search_batch_intelligence.sql
```

이 SQL은 다음을 검증한다.

- legacy 백필 무추정 원칙
- raw 테이블 RLS와 운영자 RPC 권한
- 행동 append-only 권한
- 외부 상품 DB 차단
- 요약·검색·혼합·거버넌스 RPC 실행
- 게스트 삭제와 감사 로그의 원자성
- 검색 이벤트→최종 배치 링크 성공 및 교차 연구실 링크 차단

적용 직후 Supabase Security Advisor와 Performance Advisor를 실행하고 신규 경고를 0건으로 만든다.

## 스모크 테스트

- 정상 이름/CAS/화학식 검색: `matched`와 결과 수가 기록되는지 확인
- 결과 없음·잘못된 CAS·기술 오류: 각각 별도 상태이며 기술 오류가 혼동 점수에서 제외되는지 확인
- 10분 내 다른 검색: 이전 이벤트에 `query_reformulated`가 생성되는지 확인
- 스캔 수동 선택, 화학 결과·제품·시약장 선택, 배치 추가 행동 확인
- 최종 V2 `already_mixed` 배치: 구성품 `source_search_event_id` 링크 확인
- `separate`, `unknown`, 무효 배치: 혼합 조합에서 제외되는지 확인
- 게스트 삭제 버튼, 최근 검색 1건 삭제, 전체 기록 삭제, 회원 탈퇴 연쇄 삭제 확인
- 일반 운영자 200, 비허용 계정 403, 비로그인 401, 반출 비허용 운영자 403 확인
- CSV에 사용자·연구실·이메일·메모·위치·제품번호가 없고 날짜 축소·임시 토큰·수식 방어·SHA-256 감사가 적용되는지 확인
- 별칭 승인 후 자동완성/검색에 반영되는지 확인. 혼합 후보 승인 후 안전규칙이 바뀌지 않는지 확인

## 운영 기준

- 제출 이벤트 추정 수집 실패율 1% 미만
- 검색 결과에서 최종 배치로 이어지는 경우 링크율 90% 이상
- 운영 대시보드 직접 식별자 노출 0건
- 원시 CSV 반출 감사 성공률 100%

수집 장애 시 `VITE_ENABLE_SEARCH_ANALYTICS=false`를 긴급 적용한다. 검색 기능은 분석 전송 실패와 무관하게 계속 동작한다. 외부 상품은 별도 후속 migration과 기관 계약 승인 없이는 활성화하지 않는다.
