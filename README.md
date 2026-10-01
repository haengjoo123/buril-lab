# 버릴랩

버릴랩은 실험실 시약과 재고, 보관 위치, 폐기 기록을 관리하는 React·TypeScript 앱입니다. Vite로 웹 앱을 만들고 Capacitor로 Android/iOS 앱을 패키징합니다. Cloudflare Pages Functions가 서버 API를 제공하고, Supabase가 인증과 저장소를 담당합니다.

## 개발 시작

```powershell
npm install
npm run dev
```

환경 변수는 [`.env.example`](.env.example)을 참고하세요. OpenAI, Supabase, Cloudflare용 비밀 키는 서버 환경에만 설정합니다.

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
