# 버릴랩

버릴랩은 실험실 시약과 재고, 보관 위치, 폐기 기록을 관리하는 React·TypeScript 앱입니다. Vite로 웹 앱을 만들고 Capacitor로 Android/iOS 앱을 패키징합니다. Cloudflare Pages Functions가 서버 API를 제공하고, Supabase가 인증과 저장소를 담당합니다.

## 개발 시작

```powershell
npm install
npm run dev
```

환경 변수는 [`.env.example`](.env.example)을 참고하세요. OpenAI, Supabase, Cloudflare용 비밀 키는 서버 환경에만 설정합니다.

## 웹 배포: 세 단계

최초 설정을 완료하고 `WEB_RELEASE_ENABLED=true`로 활성화하면 다음 경로를 사용합니다.

1. 작업 브랜치에 커밋·푸시하고 PR을 만듭니다.
2. 필수 Quality 검사 4개가 성공하면 main에 병합합니다. main Quality 성공 뒤 **Web release**가 staging 배포와 실제 브라우저 검증을 자동으로 수행합니다.
3. Web release의 staging 성공을 확인하고 아래 명령을 실행합니다. GitHub [Web release](https://github.com/haengjoo123/buril-lab/actions/workflows/web-release.yml) 화면에서 **Run workflow → main → Run workflow**를 눌러도 같습니다. SHA, 실행 번호, lease, 확인문구 입력은 없습니다.

```powershell
npm run deploy
npm run deploy:status
```

운영 후보는 버튼을 누른 시점에 완료돼 있던 가장 최근 staging 실행에 고정됩니다. 그 실행이 실패·진행 중이면 이전 성공으로 몰래 대체하지 않습니다. 이후 문서 변경 등이 main에 병합돼도 이미 검증한 후보를 배포할 수 있지만, 현재 운영보다 오래된 버전으로 되돌아가는 배포는 차단합니다. staging 검증은 8일 동안 유효하며, 만료됐으면 main의 **Quality and security**를 다시 실행하면 staging이 자동 검증됩니다.

실패한 배포는 실패한 단계를 고친 뒤 재실행할 수 있습니다. 새 실행 시도마다 별도 산출물과 검증 기록을 남깁니다. 다만 운영 후보 선택 이후 staging 자체를 재실행했으면 **새 운영 실행**을 시작해야 합니다. 검증하지 않은 시도나 다른 기능 플래그로 운영을 승격하지 않습니다.

### 최초 한 번만 필요한 연결

이 경로는 기존 임시 토큰을 재사용하거나 영구 보관하지 않습니다. 기존 감독형 배포의 정리를 완료한 후, `staging`과 `production` GitHub environment 각각에 아래 **새 비밀값**을 설정합니다. 저장소 전체 secret으로 만들지 않습니다.

| Secret | 필요한 권한 |
|---|---|
| `WEB_PAGES_TOKEN` | 해당 Cloudflare 계정의 **Pages Edit**만 부여한 환경별 별도 API 토큰. Workers·R2·KV 쓰기 권한은 불필요합니다. Pages 권한은 계정 범위이므로 동일 계정의 다른 Pages 프로젝트에도 접근할 수 있습니다. |
| `WEB_ADVISOR_TOKEN` | 해당 환경의 Supabase 프로젝트 하나에 제한한 **scoped PAT**. Advisor와 읽기 전용 권한 조회에 필요한 읽기 권한만 부여하고 DB 쓰기·API key secret 조회는 부여하지 않습니다. |

토큰은 공급자에서 만료일을 설정하고 정기적으로 교체합니다(권장 90일 이내). 실제 API가 필요한 읽기 권한을 거부하면 누락된 권한을 확인하며, 계정 전체 PAT로 대체하지 않습니다. 기존 URL, Access 서비스 토큰, staging 합성시험 계정 등은 그대로 사용합니다. Supabase의 프로젝트 범위 PAT는 [공식 안내](https://supabase.com/changelog/scoped-personal-access-tokens-ga), Cloudflare 권한은 [Pages API 문서](https://developers.cloudflare.com/pages/configuration/api/)를 참고하세요.

아래 검사는 비밀값의 **이름과 보호 설정만** 읽습니다. 비밀값 원문은 출력하지 않으며 원격 설정을 바꾸지 않습니다.

```powershell
npm run deploy:check
```

설정이 모두 준비된 후 저장소 변수 `WEB_RELEASE_ENABLED=true`를 설정하고, main의 **Quality and security**를 한 번 실행합니다. 실제 staging 성공으로 토큰 권한과 전체 경로를 확인한 뒤 운영 버튼을 사용합니다. 활성화 전에는 기존 감독형 경로가 계속 유효하며 자동 배포를 시작하지 않습니다. 중단하려면 이 변수를 `false`로 바꿉니다. 이미 시작한 실행의 종료와 배포 상태는 별도로 확인합니다.

### 유지되는 안전장치와 예외

- PR·main 필수 품질검사, 비밀정보 탐지, 런타임 취약점 차단, 원격 DB 보안 검사, 환경별 DB·KV 격리를 유지합니다.
- 과거 시약장 출시의 파일 목록·lockfile 해시를 매번 수정하는 제한은 일반 웹 경로에서 해제합니다. 삭제 기본 OFF, DB·Worker 권한 및 기존 운영 정책 검증은 유지하며 의존성은 lockfile 설치와 취약점 검사로 검증합니다.
- 공급자 토큰 없이 빌드하고 별도 runner에서 GitHub 산출물 해시와 모든 파일 해시를 검증한 뒤 배포합니다. staging과 운영은 환경 URL이 달라 같은 소스 SHA를 각 환경용으로 빌드하며, 동일 바이너리를 승격한다고 주장하지 않습니다.
- staging 사용자 흐름을 커스텀 도메인과 고정 배포 URL 양쪽에서 시험합니다. 운영은 같은 SHA의 성공 기록·기능 플래그·고정 staging URL을 확인하고, 배포 후 공개 버전과 미인증 API 차단을 확인합니다.
- DB migration을 자동 적용하지 않습니다. 새 migration이 포함된 운영 후보는 별도 DB 적용·검증 후 production 변수 `WEB_DATABASE_REVIEWED_SHA`를 해당 SHA로 설정해야 합니다. 일반 화면 수정에는 이 단계가 없습니다.
- 백업·예약 Worker 배포, 데이터 삭제, DB 복구는 기존 운영 절차로 처리합니다. Web release는 Pages만 변경합니다.
- 운영 배포 후 검증 실패 시 해당 실행을 성공으로 처리하지 않습니다. [기존 운영 복구 절차](docs/operations/operations-safety-rollout.md)에 따라 직전 검증된 Pages deployment로 되돌린 후 원인을 수정합니다. 자동 DB 하향 migration은 없습니다.

GitHub에 보관하는 배포용 자격증명은 매번 발급·폐기하는 기존 방식보다 수명이 깁니다. 최초 활성화는 이 권한 보관 방식까지 검토한 뒤 진행하며, 기존 서명 기록과 복구 도구는 전환 검증과 별도 Worker 작업을 위해 보존합니다.

## 주요 코드

- `src/`: React 화면, 상태 관리, 도메인 로직, 외부 서비스
- `functions/api/`: Cloudflare Pages API 라우트와 공통 요청 정책
- `supabase/migrations/`: 데이터베이스 변경 이력
- `workers/`: 예약 작업과 저장소 백업 Worker
- `scripts/`: 릴리스 준비 및 운영 점검 도구
- `docs/operations/`: 배포와 운영 절차

재고 화면은 `src/features/inventory/`, 시약장 화면과 배치 로직은 `src/features/fridge/`, 폐기물 흐름은 `src/components/CartView.tsx`와 `src/utils/wasteBatch.ts`에서 시작할 수 있습니다.

## 프로젝트 명령

- `npm run build`: 배포용 웹 빌드와 빌드 전후 안전 점검
- `npm run lint`: ESLint 정적 검사
- `npm test`: Vitest 회귀 검사
- `npm run build:android`: 웹 빌드와 Android Capacitor 동기화
- `npm run build:ios`: 웹 빌드와 iOS Capacitor 동기화

릴리스 준비 자료는 [Android 가이드](README.android.md), [iOS 가이드](README.ios.md), 운영 문서에서 확인할 수 있습니다. 기능 플래그가 꺼져 있거나 관련 서버·데이터베이스 변경이 적용되지 않은 환경에서는 해당 기능을 활성화하지 마세요.
