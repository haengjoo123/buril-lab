# AI 시약 초안 연결 출시 기록

상태: Staging·운영 DB 적용, 데이터 적재, 플래그 켬, 운영 배포 완료 (2026-11-15). 코드는 PR #156(병합 커밋 `98f7677a`). 운영 승격 전 `WEB_DATABASE_REVIEWED_SHA`를 `98f7677abf7398b8a53b8c4b42dc22a82e3cf255`로 바꿨고, 운영 배포(run `43698857874`)가 성공했다.

AI 초안은 검토 전 자료다. 폐기 라우팅, 승인, 보관 경고, GHS의 근거로 쓰지 않는다. 검증 출처는 PubChem과 KOSHA뿐이다.

플래그: `VITE_ENABLE_AI_HANDLING_DRAFTS` (기본 꺼짐, 두 환경 모두 `true`)

## DB

| migration | Staging | 운영 |
|---|---|---|
| `20261115100000_reagent_reference_drafts` | 적용 | 적용(이력 `20261114163259`) |
| `20261115100100_ai_alias_bulk_promotion` | 적용 | SQL 편집기에서 직접 적용. MCP 도구가 `delete`가 든 되돌리기 함수 때문에 거부했다. `schema_migrations` 이력에는 없다. |
| `20261115110000_ai_alias_form_choice_guard` | 적용 | 적용(이력 `20261114163412`) |
| `20261115120000_ai_incompatibility_review_candidates` | 적용 | 적용(이력 `20261114163443`) |
| `20261115130000_review_candidate_refresh_keeps_ai_evidence` | 적용 | 적용(이력 `20261114163511`) |

- 두 환경의 새 함수 본문 해시가 같다. `analytics_review_candidate_decide`만 Staging 쪽에 주석 한 줄이 없다.
- 새 표 3개는 서버 전용이다(RLS + `anon`/`authenticated` 제한 거부 정책, `service_role` 권한). 새 함수는 브라우저 role이 실행하지 못한다.
- Security Advisor는 두 환경 모두 86건 그대로다(INFO 16, WARN 70).
- pgTAP `ai_reagent_reference_drafts_behavior.sql`(7)과 `ai_incompatibility_candidates_behavior.sql`(8)을 Staging에서 롤백 트랜잭션으로 실행해 모두 통과했다. 시험 데이터가 남지 않았음을 다시 조회해 확인했다.

## 데이터 (운영)

- `scripts/copy-ai-drafts-to-production.mjs`로 Staging에서 복사했다. 초안 1,045건, 별칭 초안 40,172건이고 id를 유지했다. `reviewed_by`는 비웠다.
- `private.promote_ai_aliases_v1`로 별칭 22,819건을 승격했다(batch `26646ce8-a82a-4a19-b360-88f06790e8e6`). 되돌릴 때는 `private.rollback_ai_alias_promotion_v1(batch_id)`를 쓴다.
- Staging에서 끈 여러 형태 별칭 215개를 이름 그대로 운영에서도 껐다. 꺼진 목록의 해시가 Staging과 같다. 켜져 있는 여러 형태 별칭은 0개다.
- 혼재금지 검토 후보를 96건(치명 34, 높음 62) 넣었다. 중간 42건은 넣지 않았다. 승인해도 규칙은 자동으로 바뀌지 않는다.

## 확인한 것 (Staging)

- 검색에서 "TEA"를 입력하면 "어떤 형태인가요?" 아래에 트라이에탄올아민, 트라이에틸아민, 트리에틸알루미늄이 나온다.
- `/api/reagents/handling-draft?cas=75-09-2`는 검토 전 초안을 돌려준다. 취급 항목은 보호구, 주의사항, 응급조치, 유출 대응이고, 보관 항목은 온도, 용기, 조건, 빛 차단이다. 폐기, 보관 그룹, 분리 보관 정보는 없다.
- 이름 조회("염화메틸렌")도 같은 초안을 돌려준다. 초안이 없는 CAS는 `not_found`를 돌려준다. 앱 로그인 없이 요청하면 401이다. 응답은 `private, no-store`다.
- 상세 화면 패널은 시험 계정에 재고가 없어 화면으로 보지 못했다. 단위 테스트로만 확인했다.

## 남은 일

- 재고가 있는 계정으로 시약 상세의 "취급 요약 · AI 초안 · 검토 전" 칸을 확인한다.
- 검토 대기열의 혼재금지 후보 96건을 사람이 판정한다.
- 폐기 엔진 점검 후보(엔진은 바꾸지 않았다)가 있다. 염화철(III)·(II) 수화물(H314, 산성 가수분해)과 에탄올아민(H314 유기 염기)은 엔진이 기타 수계 폐액으로 분류했다. 캐시의 KOSHA pH가 699건 대기 상태라 pH 규칙도 작동하지 않았다.
- 초안을 "검토됨"으로 바꾸는 화면은 없다. 검토를 시작할 때 만든다.

## 되돌리기

- 화면: 두 환경의 `VITE_ENABLE_AI_HANDLING_DRAFTS`를 `false`로 바꾸고 다시 배포한다.
- 별칭: `select private.rollback_ai_alias_promotion_v1('26646ce8-a82a-4a19-b360-88f06790e8e6');`
- 후보: 각 migration 머리말의 되돌리기 SQL을 쓴다. 갱신 함수는 `20260824000000_production_baseline.sql`의 정의를 다시 적용한다.
