# Buril Lab Android 배포 가이드

## 1. 로컬 필수 도구

- JDK 21 이상
- Android SDK Platform 36
- Android Build-Tools 36.x
- `JAVA_HOME` 환경변수
- `ANDROID_SDK_ROOT` 환경변수 또는 `android/local.properties`

`.\gradlew bundleRelease`는 위 도구가 없으면 실행되지 않습니다.

## 2. 필수 환경변수

웹 빌드와 Capacitor 앱이 동일한 내부 API를 보도록 아래 값을 설정합니다.

- `VITE_PUBLIC_APP_URL`: Cloudflare Pages 배포 URL
- `VITE_INTERNAL_API_BASE_URL`: Capacitor 앱이 호출할 절대 API 베이스 URL
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

예시는 [`.env.example`](.env.example)에 정리되어 있습니다.

Cloudflare Pages Functions에는 아래 서버 비밀값이 필요합니다.

- `KOSHA_API_KEY`
- `GEMINI_API_KEY`
- `GOOGLE_VISION_API_KEY`

## 3. Android 프로젝트 준비

1. `npm install`
2. `npm run assets:generate`
3. `npm run build:android`
4. `npm run android:open`

`build:android`는 웹 빌드 후 `dist`를 `android/` 프로젝트에 동기화합니다.

## 4. 릴리스 서명 준비

`android/keystore.properties.example`를 복사해 `keystore.properties`를 만든 뒤 실제 값으로 채웁니다.

예시 키 생성 명령:

```powershell
keytool -genkeypair -v `
  -keystore "keystores/buril-lab-upload.jks" `
  -alias "buril-lab-upload" `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

생성한 키스토어와 `keystore.properties`는 저장소에 커밋하지 않습니다.

## 5. AAB 생성

JDK와 Android SDK가 설치된 환경에서 아래 명령으로 릴리스 AAB를 생성합니다.

```powershell
cd android
.\gradlew bundleRelease
```

산출물 경로:

- `android/app/build/outputs/bundle/release/app-release.aab`

## 6. 점검 항목

- Capacitor 앱에서 로그인과 세션 유지가 되는지 확인
- `/api/gemini/*`, `/api/vision/*`, `/api/kosha/*` 호출이 절대 URL 기준으로 정상 동작하는지 확인
- 카메라 스캔 기능이 Android 권한 요청 후 정상 동작하는지 확인
- PWA 아이콘과 Android 런처 아이콘이 동일 브랜드로 보이는지 확인
- 개인정보처리방침 URL, 앱 설명, 스크린샷, 테스트 계정 준비
