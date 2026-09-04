# Ops8 연구실 비밀번호·함수 권한 강화 준비

상태: `productionReady: false`, `hostedSupabaseAcceptance: false`

이 문서는 운영 1~7의 관문이 닫힌 뒤에만 적용할 운영 8 후보를 설명합니다. 이번 준비에서는 실제 Supabase·Cloudflare 변경, 토큰 생성, Staging 배포, 운영 배포를 수행하지 않았습니다.

## 기존 비밀번호를 깨뜨리지 않는 전환

기존 bcrypt 해시만으로는 원래 비밀번호가 12자인지 알 수 없습니다. 따라서 마이그레이션은 기존 비밀번호 보호 연구실을 모두 `join_password_needs_change=true`로 표시하되 기존 해시를 그대로 보존합니다. 기존 사용자는 계속 가입할 수 있고 관리자 화면에만 교체 안내가 표시됩니다.

새 연구실을 만들거나 관리자가 비밀번호를 바꿀 때만 다음 규칙을 적용합니다.

- 비밀번호 없음은 계속 허용합니다.
- 비밀번호를 사용하면 12~128자여야 합니다.
- 연구실 이름이 들어가거나 고정된 흔한 비밀번호이면 거부합니다.
- 72바이트 이후를 무시하는 bcrypt 한계를 피하려고 전체 UTF-8 입력의 SHA-256을 먼저 계산한 뒤 bcrypt로 저장합니다. 저장값은 `sha256$` 표식으로 구분하며 서버 가입 함수는 이미 이 형식을 읽을 수 있습니다.
- 연구실 이름을 바꾸면 기존 비밀번호를 무효화하지 않고 교체 필요 표시만 다시 켭니다.
- 비밀번호를 유효한 값으로 교체하거나 제거하면 표시가 꺼집니다.

## 권한 경계

- `create_lab_secure`와 `set_lab_join_password`는 `anon`과 `PUBLIC` 실행 권한을 가지지 않습니다.
- 인증 사용자는 연구실 생성과 자신이 관리자인 연구실의 비밀번호 변경만 할 수 있습니다.
- 비밀번호 판정 도우미와 트리거 함수는 브라우저에서 직접 실행할 수 없습니다.
- 기존 브라우저 가입 RPC는 운영 7에서 회수된 상태를 유지하고, 가입은 요청 제한이 있는 `/api/labs/join` 서버 경로만 사용합니다.
- `labs`의 RLS는 유지하며 교체 필요 상태를 브라우저가 임의로 지우거나 해시를 직접 바꾸는 동작은 트리거가 거부합니다.

## Supabase 계정 비밀번호 설정은 별도

연구실 입장 비밀번호는 BurilLab의 공유 연구실 기능이고 Supabase Auth 계정 비밀번호와 다릅니다. Supabase의 유출 비밀번호 보호는 사용자 계정에 적용됩니다. 공식 Management API의 읽기 전용 `GET /v1/projects/{ref}/config/auth`에서 `password_hibp_enabled=true`인지 Staging과 운영 각각 확인합니다.

검증에는 해당 환경 프로젝트만 읽을 수 있는 짧은 수명의 Supabase 토큰(`auth_config_read` 또는 OAuth `auth:read`)을 사용합니다. 토큰은 기존 감독형 전달·폐기 절차를 따르며 응답의 SMTP 값 등 다른 설정은 출력하거나 증거에 남기지 않습니다. 이 기능은 Supabase Pro 이상에서 제공되므로 실제 활성화가 불가능한 요금제라면 운영 8은 통과시키지 않습니다.

```powershell
$env:SUPABASE_PROJECT_REF = '<environment project ref>'
$env:SUPABASE_ACCESS_TOKEN = '<short-lived read token>'
npm run ops8:auth-config:hosted -- --environment staging
```

운영 확인은 `--environment production`으로 별도 실행합니다. 이 준비 브랜치에서는 두 검사를 실행하지 않았으므로 `hostedSupabaseAcceptance: false`입니다.

## 적용 순서와 통과조건

1. 운영 7의 구 가입·감사 RPC 7일 무호출 증거와 Contract 적용을 확인합니다.
2. 같은 후보 SHA로 빈 PostgreSQL 2회 설치, pgTAP, 네이티브 동작시험을 통과합니다.
3. Staging에 마이그레이션과 앱을 적용합니다.
4. 기존 짧은 비밀번호 가입 유지, 관리자 교체 표시, 11/12/128/129자 경계, 연구실명·흔한 비밀번호 거부, 이름 변경 후 기존 가입 유지, 직접 해시·표시 변조 거부를 확인합니다.
5. Staging의 `password_hibp_enabled=true`와 Security Advisor exact 목록의 새 차이 0을 확인합니다.
6. 앞선 운영 묶음의 7일 관찰이 끝난 뒤에만 운영에 적용합니다.
7. 운영에서도 같은 Auth 설정과 Advisor를 확인하고 30분·24시간·7일 관찰을 시작합니다.

되돌림은 마이그레이션 하향 실행으로 하지 않습니다. 문제가 생기면 새 비밀번호 쓰기를 막고 서버 가입 경로는 기존 bcrypt와 새 `sha256$` 형식을 모두 읽는 상태로 유지한 뒤 전진 수정합니다. 기존 비밀번호 해시는 이 마이그레이션에서 바뀌지 않으므로 비상 가입 호환성은 보존됩니다.
