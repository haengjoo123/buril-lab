# 실험 도구: 사용 집계·영구 삭제·새 도구 id 적용 절차

`supabase/migrations/20261127090000_lab_tools_usage_and_purge.sql`을 Staging과 운영에 적용하는 절차다. 앱은 이 migration 없이도 동작하도록 만들어져 있으므로 웹 배포와 순서를 맞출 필요는 없다.

## migration이 하는 일

- `tool_documents.tool_id` CHECK에 `primer`, `nucleic-acid`를 추가한다.
- `tool_usage_daily`(계정·도구·날짜별 열기/저장 횟수)와 `record_tool_usage(p_tool_id, p_event)`를 추가한다. 입력 내용은 저장하지 않는다. 테이블은 소유자 조회만 가능하고 쓰기는 함수로만 한다.
- `purge_tool_document(p_id)`: 호출자 본인의, 휴지통에 있는 작업만 영구 삭제한다. 첨부 행은 외래 키로 함께 지워진다.

## 적용 전 앱 동작

- **새 도구 2개**(프라이머 · 올리고, 핵산 정량)는 `registry.ts`에서 `kind: "quick"`이라 기기에만 저장되고 서버로 아무것도 보내지 않는다.
- **사용 집계**: `record_tool_usage` 호출이 "함수 없음"으로 실패하면 그 세션에서는 더 호출하지 않는다(`usage.ts`).
- **영구 삭제**: 버튼을 누르면 "영구 삭제를 아직 사용할 수 없습니다"라고 안내하고 작업은 휴지통에 남는다.

## 적용

1. 운영 `apply_migration` 권한을 먼저 확인한다. Staging만 적용된 상태로 두면 main의 Staging 배포 hosted 보안 검사가 실패하므로 두 환경을 연달아 적용한다.
2. Staging → 운영 순서로 적용한다.
3. 각 환경에서 확인한다.
   - `select conname from pg_constraint where conname = 'tool_documents_tool_id_check';`
   - 테스트 계정으로 `select public.record_tool_usage('dilution','open');` 후 `tool_usage_daily`에 한 행.
   - 휴지통에 넣은 작업에 `select public.purge_tool_document('<id>');` → 행이 사라지고, 휴지통에 없는 작업은 `Document is not in the trash`.
4. 보안 Advisor에 새 함수 두 개(`record_tool_usage`, `purge_tool_document`)의 인증 역할 실행 권한이 추가로 보고되면 검토 목록 기준을 갱신한다.
5. migration이 든 커밋을 운영에 승격할 때는 `WEB_DATABASE_REVIEWED_SHA`를 그 커밋으로 바꾼다.

이 migration의 pgTAP 파일은 아직 없다. 동작은 `src/features/tools/databaseUsage.test.ts`가 PGlite에서 migration을 실제로 실행해 검사한다(새 id 허용, 집계 증가와 계정 분리, 휴지통 작업만 삭제, 익명 실행 거부).

## 적용 후 선택 작업

- 새 도구의 작업을 계정에 저장하게 하려면 `registry.ts`에서 두 도구의 `kind`를 `"project"`로 바꾼다. `engines.test.ts`의 "syncs only tool ids the server accepts"가 처음 목록에 없는 도구는 `quick`이어야 한다고 검사하므로 그 조건도 함께 고친다.
- 집계 조회 예: `select tool_id, sum(opens) opens, sum(saves) saves, count(distinct owner_id) users from public.tool_usage_daily where day >= current_date - 30 group by 1 order by 2 desc;` (서비스 역할)

## 적용 기록

- Staging(2026-11-27): Supabase MCP `apply_migration`으로 저장소 파일 내용을 그대로 적용했고 이력은 `20261127144847 lab_tools_usage_and_purge`다. 적용 전 public 테이블 63개, 적용 뒤 64개. `tool_usage_daily`는 RLS와 소유자 조회 정책 1개, 권한은 authenticated SELECT·service_role CRUD. 두 함수는 authenticated만 실행(anon·service_role 불가), 본문 md5가 저장소와 같다(`record_tool_usage` `f3d634efbbcbb03026d8375969d0c6b2`, `purge_tool_document` `a6d5d33dcbaf515dcdd47dbaac4c4562`). 새 id 저장, 집계 누적과 계정 분리, 잘못된 이벤트 거부, 휴지통 밖 작업·남의 작업 삭제 거부, 본인 휴지통 작업 삭제, 익명 실행 거부 등 10개 검사를 한 트랜잭션에서 실행해 모두 통과했고 되돌린 뒤 시험 데이터 0건을 확인했다. Advisor 대상은 SECURITY DEFINER 함수 71 → 73, 정책 없는 RLS 테이블 17 그대로라 88 → 90건으로 예상한다(Advisor API로 다시 조회하지는 않았다).
- 운영(2026-11-27): auto mode 권한 검사가 MCP 적용을 거부해, 사용자가 Supabase SQL 편집기에서 저장소 파일 내용에 이력 기록 한 줄(`insert into supabase_migrations.schema_migrations (version, name) values ('20261127150000', 'lab_tools_usage_and_purge')`)을 더해 한 트랜잭션으로 실행했다. 이력은 `20261127150000`. public 테이블 64개, CHECK에 새 id 2개, RLS·정책·함수 실행 권한은 Staging과 같다. `tool_usage_daily`의 service_role 권한에 운영 기본 권한으로 REFERENCES·TRIGGER·TRUNCATE가 더 붙어 있다(Staging은 4개). 함수 본문은 붙여 넣을 때 줄바꿈이 CRLF가 되어 md5가 다르지만, CRLF를 LF로 바꾸면 저장소와 같다. 운영에서는 시험 데이터를 쓰는 동작 검사를 하지 않았다.
- Advisor: 운영 Advisor API 조회 결과 88 → 90건(INFO 17, WARN 73), 늘어난 것은 `record_tool_usage`, `purge_tool_document` 2건뿐이다. Staging은 카탈로그 집계가 같다(SECURITY DEFINER 73, 정책 없는 RLS 테이블 17). 두 기준 파일에 2건씩 `temporary_open`(2026-12-31 만료, 다음 RPC 권한 재검토)으로 넣고 `EXPECTED_COUNTS`를 90/90으로 올렸다(PR #174). 이 기준이 main에 병합되기 전에는 main에서 하는 배포의 Hosted Advisor 검사가 실패한다.
- 2026-11-28: 새 도구 2개의 `kind`를 `"project"`로 바꿨고, `engines.test.ts`는 이제 적용된 최신 목록(`20261127090000`)에 없는 도구만 `quick`이어야 한다고 검사한다.
