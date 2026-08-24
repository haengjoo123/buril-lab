# 이전 SQL 검증문 보관소

이 폴더의 SQL은 기준선 전환 전 증분 migration을 직접 확인하던 절차형 검증문입니다.
파일은 이력 보존을 위해 그대로 두지만 pgTAP 형식이 아니므로 `supabase test db`의
활성 검사 경로에 넣지 않습니다.

Prep 1의 활성 DB 검사는
`supabase/tests/baseline_permissions.sql` 하나이며, 빈 로컬 DB에 기준선을 적용한 뒤
RLS와 `anon`, `authenticated`, `service_role`의 명시적 권한을 pgTAP으로 검사합니다.
