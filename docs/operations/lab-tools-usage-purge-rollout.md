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
