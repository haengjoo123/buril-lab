# 연구실 관리 기록·센터 요청 흐름·반려 사유·피드백 맥락 출시 절차

상태: 저장소 준비 완료, Staging·운영 DB 미적용 (2026-11-06)

## 무엇이 바뀌나

- 연구실 관리 행위가 감사 로그(`public.audit_logs`)에 남는다.
  - 멤버: 가입, 역할 변경, 제외, 나가기(`entity_type = 'lab_member'`). **그 연구실의 관리자(`admin`)만** 읽는다.
  - 안전센터 연결: 요청·승인·거절·철회, 공개 범위 변경(`safety_center_link`). 연구실 멤버 모두가 읽는다.
  - 폐액통 현장 설정(연구실별 폐액 흐름 덮어쓰기): 저장·변경·기관 정책으로 되돌리기(`waste_policy_override`). 연구실 멤버 모두가 읽는다.
  - 기존 감사 행(재고, 시약장, 폐액통 등)은 지금처럼 연구실 멤버 모두가 읽는다.
- 서버 가입 경로(`/api/labs/join`)가 `join_lab_server_v2`를 부른다. 결과는 v1과 같고, 가입에 성공하면 가입 기록 1행을 함께 쓴다.
- 안전센터 요청 흐름
  - 연구실은 센터가 그 요청을 볼 수 있는 동안(승인된 연결 + 승인된 센터) 요청을 스스로 '완료'로 닫을 수 없다. 회신을 제출(`submitted`)하면 센터가 확인한 뒤 닫는다.
  - 연구실은 닫힌 요청을 다시 열 수 없다. 메모(댓글)는 계속 남길 수 있다.
  - 연결이 철회·거절되었거나, 재승인 대기 중이거나, 센터 승인이 취소되어 센터가 요청을 볼 수 없게 되면 연구실이 직접 닫을 수 있다.
  - 이미 승인된 연결의 공개 범위를 넓히면(지금 범위에 없는 값이 하나라도 있으면) 연결이 `requested`로 돌아가 연구실 관리자의 재승인을 기다린다. 같거나 좁은 범위는 승인 상태를 유지한다.
  - 공개 범위 값은 `summary`, `risk_detail`, `exports`, `waste_management`만 받는다.
  - 센터의 폐기 기록 조회(`get_safety_center_waste_logs`)에서 무효 처리된 기록이 빠진다.
  - 센터의 감사 기록 조회(`get_safety_center_audit_logs`)에서 멤버 기록과 다른 센터의 연결 기록이 빠진다.
- 운영자가 센터 신청을 반려할 때 사유(6종)와 메모(선택, 500자)를 함께 저장한다(`operator_safety_center_status_v2`). 신청자는 반려 상태인 동안 `get_my_safety_centers`로 사유와 메모를 본다.
- 피드백에 보낸 화면(`source_screen`)과, 연구실 공간에서 보낸 경우 그 연구실(`lab_id`)이 함께 저장된다.

## 서버가 강제하는 규칙

`20261106100000_lab_admin_action_audit_v1.sql`

### 감사 행

모든 새 행은 `source = 'database'`, `location_context = null`이다.

| entity_type | action | 쓰는 곳 | 저장하는 값 | 읽는 사람 |
|---|---|---|---|---|
| `lab_member` | `join` | `join_lab_server_v2` (성공 시) | after `{user_id, role}` | 그 연구실 관리자 |
| `lab_member` | `role_change` | 트리거, 역할이 실제로 바뀐 UPDATE | before/after `{user_id, role}`, diff `{role: {from, to}}` | 그 연구실 관리자 |
| `lab_member` | `remove` / `leave` | 트리거, DELETE (호출자 = 대상이면 `leave`) | before `{user_id, role}` | 그 연구실 관리자 |
| `safety_center_link` | `link_request` / `link_approve` / `link_reject` / `link_revoke` | 트리거, INSERT 또는 상태가 바뀐 UPDATE (새 상태로 결정) | after `{status, scope, center_name}`, UPDATE면 before `{status, scope}`와 바뀐 키만 diff | 연구실 멤버 모두 (센터는 자기 연결 행만) |
| `safety_center_link` | `scope_change` | 트리거, 상태는 같고 범위 집합이 바뀐 UPDATE | before/after, diff `{scope: {from, to}}` | 연구실 멤버 모두 |
| `waste_policy_override` | `create` / `update` / `delete` | 트리거 (`update`는 추적 열이 하나라도 바뀔 때만) | `{stream_code, is_disabled}`와 바뀐 항목 이름 목록 `changed_fields` | 연구실 멤버 모두 |

- 저장하지 않는 것: 이메일, 전화번호·연락처(`handler_contact`) 값, 위치 문구, 폐액통 이름, 자유 입력 문장. 현장 설정은 바뀐 **항목 이름**만 남긴다.
- 행위자 이름(`actor_name`): 연구실 별명 → 프로필 `full_name` → `name` 순서이고, 이메일은 쓰지 않는다. 결과에 `@`가 있으면 비운다. 센터 직원이 한 연결 행위는 사람 이름 대신 센터 이름으로 남긴다.
- 기록하지 않는 경우
  - 호출자가 없는 삭제(계정 삭제 Worker, Auth 관리자 삭제): `auth.uid()`가 null인 DELETE.
  - 같은 문장에서 계정이 지워진 경우(예전 `public.delete_user()`): 대상 계정이 이미 없으면 쓰지 않는다. 쓰면 아무도 지우지 않는 `user_id`가 남기 때문이다.
  - 연구실 삭제로 함께 지워지는 멤버·현장 설정.
  - 역할이 같은 UPDATE, 상태와 범위 집합이 같은 연결 UPDATE, 바뀐 항목이 없는 현장 설정 저장.
- `user_id`는 최상위 키라서 기존 계정 삭제 Worker(`ops11_deletion_worker`)가 계정 삭제 때 지운다(행위자도 함께 비운다).

### 감사 행 공개 범위 (RLS)

- 사용자 결정: 멤버 관리 기록은 그 연구실 관리자만 읽는다. 그 밖의 행은 지금처럼 멤버 모두가 읽는다.
- 기존 정책 `"Users can view audit_logs for their labs"`는 이름과 대상 역할을 그대로 두고 조건만 `entity_type <> 'lab_member'`로 좁혔다(OPS7 pgTAP이 이 이름을 확인한다).
- 새 정책 `audit_logs_select_lab_member_admin_v1`(SELECT, `authenticated`): `entity_type = 'lab_member'`이고 호출자가 그 연구실의 `admin`일 때만.
- 감사 행의 INSERT·UPDATE·DELETE 정책은 여전히 없다(브라우저에서 쓰거나 고칠 수 없다).

### 함수와 권한

- 새 public 함수 `join_lab_server_v2`, `operator_safety_center_status_v2`: SECURITY DEFINER, `search_path = ''`, `lock_timeout = 5s`. `public`·`anon`·`authenticated` 실행 권한을 회수하고 `service_role`만 실행한다.
- 새 private 함수 `audit_lab_admin_change_v1`(트리거, SECURITY DEFINER), `lab_audit_actor_name_v1`, `feedback_clear_lab_on_user_detach_v1`: `search_path = ''`, API 역할 누구도 실행할 수 없다.
- 재정의(`create or replace`, 서명·권한 유지): `add_safety_center_request_event`, `request_safety_center_lab_link`, `get_safety_center_waste_logs`, `get_safety_center_audit_logs`.
- `get_my_safety_centers()`: 반환 열이 늘어 DROP 후 다시 만들고, 기준선과 같은 권한(`authenticated`, `service_role`; `anon` 없음)을 다시 준다. 사유·메모는 `status = 'rejected'`일 때만 돌려준다. 다만 이것은 화면용 가림이다. 센터 멤버는 `safety_centers` 행을 직접 읽을 수 있으므로, 승인 뒤에도 그 센터 멤버에게는 저장된 사유가 보일 수 있다.
- 반려 사유 검사(모두 `22023 Invalid safety-center review`, 권한 확인 전): 6종 밖의 사유, 500자 초과 메모, 반려가 아닌데 사유·메모가 있음, 사유 없는 메모, `other`인데 메모 없음. 사유를 넣어 반려하면 사유와 메모를 함께 바꾸고, 사유 없이 반려(승인 취소)하거나 승인·대기로 바꾸면 저장된 값을 유지한다.
- 오류 코드: 연구실이 닫으면 안 되는 요청을 닫음 `42501 LAB_CANNOT_RESOLVE_REQUEST`, 닫힌 요청을 다시 엶 `42501 LAB_CANNOT_REOPEN_REQUEST`, 잘못된 공개 범위 `22023 Unsupported link scope`.
- 피드백 INSERT 정책 `"Anyone can insert feedback"`에 멤버십 검사를 더했다: `lab_id`는 null이거나 보낸 사람이 그 연구실 멤버여야 한다(익명은 null만). `source_screen`은 `search`, `logs`, `cabinet`, `inventory`, `admin`만 받는다. `lab_id`는 `labs`를 참조하고 연구실이 삭제되면 비워진다(`on delete set null`). 계정 삭제로 `user_id`가 비워지는 같은 UPDATE에서 BEFORE 트리거가 `lab_id`도 비운다(삭제 Worker의 UPDATE, Auth 삭제의 `on delete set null` 모두).
- 새 public 테이블과 테이블 권한 변경은 없다. `baseline_permissions.sql`의 개수(public 테이블 54개)는 그대로다.
- authenticated가 실행할 수 있는 새 SECURITY DEFINER 함수 이름은 없다. 다시 만든 `get_my_safety_centers`는 이름·인자(없음)·언어·권한 모양이 같아 기존 Advisor 항목 그대로다. Security Advisor 기준은 73건 그대로여야 한다.

## 검증 결과 (로컬, 2026-11-06)

- 일회용 PostgreSQL 17.11(127.0.0.1)에 기준선과 증분 19개를 적용하고, Supabase 기본 권한(새 public·private 함수 EXECUTE와 테이블 권한 → anon·authenticated·service_role)을 재현한 뒤 새 migration을 적용했다. 적용은 경고 없이 성공했다.
- 권한
  - authenticated가 실행할 수 있는 public SECURITY DEFINER 함수 수: 적용 전 58, 적용 후 58. anon이 실행할 수 있는 수: 0, 0.
  - `join_lab_server_v2`, `operator_safety_center_status_v2`의 ACL은 `postgres`·`service_role`뿐이다.
  - `get_my_safety_centers`의 ACL은 `postgres`·`authenticated`·`service_role`이다(anon 없음).
  - private 함수 3개의 ACL은 `postgres`뿐이다(기본 권한이 있어도 회수됨).
- pgTAP: 로컬에는 pgTAP이 없어 같은 이름의 임시 대체 함수로 실행했다. 대체 함수는 실패가 하나라도 있거나 실행 수가 `plan`과 다르면 오류를 낸다. 파일마다 새 DB에서 실행했다.
  - `lab_admin_action_audit_behavior.sql`: 빈 DB 65/65, 기존 연구실·센터·연결·감사 행·피드백이 있는 DB 65/65.
  - 기존 18개 파일(admin_kpis 36, baseline_permissions 11, cabinet_import 96, cabinet_trash 1, inventory_import 1, ops5 14, ops6 16, ops7 12, ops8 18, ops9 23, ops10 26, ops11 30, waste_containers 12, waste 계열 10·10·2·11·6)이 새 migration 적용 전과 후 모두 통과했다.
  - 실제 pgTAP 실행은 CI(`supabase test db`)가 처음이다.
- 같은 migration을 다시 적용하면 첫 문장에서 실패하고(`column "lab_id" of relation "feedback" already exists`) 전체가 롤백된다. 함수 본문·권한, 정책, 트리거, 제약, 열의 스냅숏이 적용 전과 같았다.
- 변형 검사: 방어 조건을 하나씩 지우거나 바꾼 migration 55개를 적용하고 새 테스트를 돌렸다(검토 단계에서 19개를 더했다).
  - 52개는 테스트를 실패시켰다. 50개는 해당 assertion이 실패했다. 2개는 테스트가 오류로 멈췄다: 메모 앞뒤 공백을 지우지 않는 변형은 `safety_centers_review_note_check` 제약이 반려를 막았고, 트리거 함수에서 SECURITY DEFINER를 뺀 변형은 1번 assertion 실패 뒤 `auth.users` 권한 오류가 났다.
  - 걸리지 않은 3개는 동작이 같거나 다른 장치가 막는 경우다: `join_lab_server_v2` 안의 service_role 확인 제거(실행 권한 회수와 v1의 같은 확인이 막는다), 관리자 정책에서 `entity_type = 'lab_member'` 조건 제거(관리자는 기존 정책으로 이미 모든 행을 읽는다), 이미 닫힌 요청을 다시 '완료'로 보내는 경우의 조건 제거(상태가 바뀌지 않는 메모 기록이다).
  - 확인한 조건
    - 삭제 기록 생략: 멤버 3종(호출자 없음, 계정 없음, 연구실 없음), 현장 설정 2종(호출자 없음, 연구실 없음)
    - 같은 역할·같은 범위·바뀐 항목 없음 생략
    - leave와 remove 구분, 이메일 대체 이름, 센터 직원의 사람 이름, 호출자 없는 연결 행의 행위자 이름
    - 연락처 값 저장, 현장 설정 `update`의 동작 이름·바뀐 항목·사용 중지 diff, 생성 때 `is_disabled` 목록
    - RLS의 멤버 기록 제외와 관리자 역할 확인
    - join v2의 가입 기록, 실패한 가입의 기록 없음
    - 완료 금지와 그 조건(연결 상태·센터 상태), 재개 금지
    - 범위 목록(모르는 값, 빈 배열, null 값), 범위 확대 재승인
    - 무효 기록 제외, 센터 감사 조회의 멤버 기록·다른 센터 연결 제외
    - 피드백 멤버십 검사와 계정 분리 트리거
    - 반려 사유 검사 5종, 사유 없는 재반려의 메모 유지, 사유 있는 재반려의 메모 교체, 메모 공백 정리
    - 신청자 화면의 사유 가림, anon·PUBLIC·authenticated 실행 권한, private 함수 권한, 트리거 함수의 SECURITY DEFINER
- `npm run security:supabase-advisors`(static): production 73, staging 73. 저장소 JSON만 검사하므로 Hosted 확인은 출시 때 한다.

## 출시 순서: DB 먼저

새 웹은 `join_lab_server_v2`, `operator_safety_center_status_v2`, 피드백 새 열을 바로 쓴다. DB가 적용되지 않은 환경에 새 웹을 올리면 연구실 가입, 센터 반려, 피드백 전송이 실패한다.

1. 아래 "파일럿 센터 사전 안내"를 먼저 보낸다.
2. Staging DB에 migration을 적용하고 `supabase test db supabase/tests`를 실행한다. 새 테스트는 `auth.users`에 고정 UUID 계정을 넣고 지운다(트랜잭션은 끝에 롤백된다). 2단계 테스트와 같은 권한이 필요하다.
3. Hosted Security Advisor를 실행한다: `npm run security:supabase-advisors:hosted -- --environment staging`. 저장소 기준과 같은 73건이어야 한다. 늘었다면 적용을 멈추고 원인을 확인한다.
4. Staging 웹을 배포하고 직접 확인한다.
   - 멤버 역할을 바꾸면 관리자 기록 탭에 행이 생기고, 일반 멤버 계정에서는 그 행이 보이지 않는다.
   - 초대 링크로 가입하면 가입 행이 생긴다.
   - 연구실이 요청에 회신하면 `submitted`가 되고, 센터 화면의 "확인 후 종료"로 닫힌다.
   - 승인된 연결의 범위를 넓히면 연결이 재승인 대기로 돌아간다(API 직접 호출로만 가능).
   - 반려한 신청자 화면에 사유와 메모가 보인다.
5. 운영 DB에 같은 migration을 적용하고 운영 Advisor(73건)를 확인한다.
6. 운영 승격 전 `WEB_DATABASE_REVIEWED_SHA`를 최종 main 후보 SHA로 설정하고, 같은 SHA의 Quality·staging 검증 성공을 확인한 뒤 운영 웹을 배포한다. DB 적용 직후 이어서 배포한다(아래 "이전 앱 사용자 안내").

## 파일럿 센터 사전 안내 (적용 전 필수)

운영 DB 적용 전에 파일럿 센터 담당자에게 다음을 알린다.

- 이제 연구실은 요청을 스스로 '완료'로 닫을 수 없고, 회신 제출 후 센터가 확인해 종료한다. 센터 화면의 요청 상세에 '확인 후 종료' 버튼이 새로 생긴다.
- 단, 연결이 해제·거절되었거나 재승인 대기 중이거나 센터 승인이 취소되어 센터가 요청을 볼 수 없게 되면, 연구실이 그 요청을 직접 닫을 수 있다. 연구실 관리자가 연결을 철회한 뒤 그 센터의 열린 요청을 닫을 수도 있다. 이때는 `link_revoke` 감사 행과 연구실 측 상태 변경 이벤트(`actor_scope = 'lab'`)가 남는다.
- 이미 승인된 연결의 공개 범위를 넓히면 연구실 관리자가 다시 승인할 때까지 그 연구실 데이터 접근과 요청 목록이 멈춘다(좁히기는 즉시 반영). 지금 센터 화면에는 범위를 넓히는 버튼이 없으므로 API 직접 호출에만 해당한다.
- 무효 처리된 폐기 기록은 센터 폐기 기록·내보내기에서 빠진다.

## 이전 앱 사용자 안내

- DB 적용 뒤 아직 새로고침하지 않은 웹 탭이나 설치형 앱의 연구실 요청 '완료 처리' 버튼은 권한 오류(`42501`)를 낸다.
- 웹 배포는 DB 적용 직후 이어서 한다. 설치형 앱은 다음 업데이트 전까지 이 동작이 실패한다는 것을 알고 출시 노트에 적는다.
- 가입은 브라우저가 아니라 서버 경로(`/api/labs/join`)가 처리한다. DB만 적용되고 새 웹이 아직 배포되지 않은 동안에는 그 서버가 `join_lab_server_v1`을 그대로 부르므로 가입은 동작하지만 가입 기록은 남지 않는다.
- 설치형 앱도 같은 서버 경로를 부르므로, 새 웹을 배포한 뒤에는 앱을 업데이트하지 않아도 가입 기록이 남는다.

## 공개 범위 변화

- 센터 연결 기록(`safety_center_link`)과 폐액통 현장 설정 기록(`waste_policy_override`)은 기록 탭에서 모든 연구실 멤버에게 보인다.
- 지금까지 센터 연결 목록은 관리자만 볼 수 있었다(`get_lab_safety_center_link_requests` BL:4078, 정책 `safety_center_lab_links_select_accessible` BL:13403). 목록 자체는 여전히 관리자 전용이지만, 연결 상태와 공개 범위의 변경 기록은 멤버 모두가 읽는다.
- 사용자 결정(멤버 관리 기록만 관리자 전용)에 따른 의도된 변화이며, 처리방침 표에 적는다.
- 승인된 센터(`summary` 범위)는 자기 연결 기록과 현장 설정 기록을 센터 감사 화면에서 본다. 현장 설정 기록에는 바뀐 항목 이름만 있다.

## 알려진 한계

- 감사 로그에는 `labs` FK가 없어서 연구실을 삭제해도 기존 감사 행이 남는다. 멤버 기록에는 아직 탈퇴하지 않은 사람의 `user_id`가 남지만, 연구실이 없으므로 아무도 읽을 수 없다. 그 사람이 탈퇴하면 계정 삭제 Worker가 `user_id`를 지운다. 연구실 삭제 때 함께 지울지는 아직 정하지 않았다(모든 감사 항목에 이미 있는 문제).
- 가입 기록은 서버 가입 경로(`join_lab_server_v2`)에서만 남는다. 연구실을 만든 관리자는 가입 기록이 없다.
- 센터 직원이 한 연결 행위는 센터 이름으로만 표시한다. 호출자 없이(서비스 역할·DB 소유자) 바뀐 연결은 행위자가 비어 있다.
- 멤버 기록은 `admin` 역할만 읽는다. PI 등 다른 역할은 읽지 못한다.
- 제외되거나 나간 멤버는 현재 멤버 이름 목록에 없으므로 화면에서 '이전 멤버'로 보인다. 별명과 프로필 이름이 모두 없는 행위자는 이름이 비어 '알 수 없는 사용자'로 보인다.
- 반려 사유는 신청자 화면에서는 반려 상태일 때만 보이지만, 승인 뒤에도 그 센터 멤버가 `safety_centers` 테이블을 직접 조회하면 보인다.
- 예전 계정 삭제 함수 `public.delete_user()`는 여전히 `authenticated`가 실행할 수 있다(Advisor 기준에 포함된 기존 항목, 이번 범위 밖). 새 트리거는 이 경로에서 남는 `leave` 행을 쓰지 않을 뿐이다.
- `audit_logs` SELECT에 허용 정책이 둘이 되어 Supabase Performance Advisor가 `multiple_permissive_policies` 경고를 낼 수 있다. Security Advisor 기준(73건)과는 별개다.

## 되돌리기

- 웹: 이전 웹으로 되돌리는 것은 DB를 그대로 둔 채 가능하다(이전 웹의 연구실 '완료 처리'는 `42501`이고, 이전 서버는 v1으로 가입시키므로 그동안 가입 기록이 남지 않는다). 새 웹은 DB가 적용된 상태에서만 동작하므로, DB를 되돌리려면 웹을 먼저 이전 버전으로 돌린다.
- 멤버 기록 공개 범위: RLS를 원래대로 되돌리면 이미 쌓인 `lab_member` 행이 멤버 모두에게 보인다. 사용자 결정에 어긋나므로, 정책을 되돌린다면 먼저 그 행을 지운다(`delete from public.audit_logs where entity_type = 'lab_member';`). 정책만 남겨 두어도 다른 기능에는 영향이 없다.
- DB 되돌리기 SQL (데이터베이스 소유자, 한 트랜잭션):

```sql
begin;
set local lock_timeout = '5s';
drop trigger lab_members_audit_admin_change_v1 on public.lab_members;
drop trigger safety_center_lab_links_audit_admin_change_v1 on public.safety_center_lab_links;
drop trigger waste_policy_lab_overrides_audit_admin_change_v1 on public.waste_policy_lab_overrides;
drop trigger feedback_clear_lab_on_user_detach_v1 on public.feedback;

-- 멤버 기록을 지운 뒤에만 원래 조건으로 되돌린다.
delete from public.audit_logs where entity_type = 'lab_member';
drop policy audit_logs_select_lab_member_admin_v1 on public.audit_logs;
alter policy "Users can view audit_logs for their labs" on public.audit_logs
  using (lab_id in (select lab_members.lab_id from public.lab_members
                    where lab_members.user_id = (select auth.uid())));

alter policy "Anyone can insert feedback" on public.feedback with check (
  (((select auth.uid()) is null) and (user_id is null) and (user_email is null))
  or (((select auth.uid()) = user_id)
      and ((user_email is null) or (user_email = ((select auth.jwt()) ->> 'email')))));

-- 웹이 v1을 다시 부르게 된 뒤에만 지운다.
drop function public.join_lab_server_v2(uuid, uuid, text, text, text, text);
drop function public.operator_safety_center_status_v2(uuid, uuid, text, uuid, text, text, text);

-- 재정의 4개: 기준선 본문으로 create or replace (서명·권한은 그대로 유지된다).
--   add_safety_center_request_event   BL:2053-2117
--   get_safety_center_audit_logs      BL:4183-4222
--   get_safety_center_waste_logs      BL:4425-4460
--   request_safety_center_lab_link    BL:7694-7768

-- get_my_safety_centers: 기준선 정의(BL:4151-4176)로 drop + create 한 뒤 권한을 다시 맞춘다.
-- drop function public.get_my_safety_centers();
-- create function public.get_my_safety_centers() ... (BL:4151-4176 그대로)
-- revoke all on function public.get_my_safety_centers() from public, anon, authenticated, service_role;
-- grant execute on function public.get_my_safety_centers() to authenticated, service_role;

drop function private.audit_lab_admin_change_v1();
drop function private.feedback_clear_lab_on_user_detach_v1();
drop function private.lab_audit_actor_name_v1(uuid, uuid);
commit;
```

- `get_my_safety_centers`를 다시 만들 때 `revoke … from … anon`을 빼면 Supabase 기본 권한이 anon 실행을 다시 붙여 Advisor 항목이 바뀐다.
- 추가한 열(`feedback.lab_id`, `feedback.source_screen`, `safety_centers.review_reason`, `safety_centers.review_note`)과 제약·색인은 남겨도 이전 코드에 영향이 없다. 지우려면 처리방침과 함께 정한다.
