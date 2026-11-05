# Buril Lab Android 배포 가이드

## 운영 웹과 같은 버전으로 릴리스 빌드

웹은 별도로 배포되고 Android에는 빌드 시점의 웹 파일이 내장됩니다. 웹 배포만으로
설치된 앱이 갱신되지는 않습니다. `package.json`의 버전은 앱의 배포 버전이 아닙니다.
Android 버전은 `android/app/build.gradle`의 `versionName`과 `versionCode`로 관리합니다.

1. `https://burillab.com/release.json`의 커밋과 해당 커밋의 성공한 Web production 실행을 확인합니다.
2. 해당 커밋을 fetch하고 작업 브랜치를 만듭니다. Android 버전을 올리되 패키지 ID와 서명 키는 유지합니다.
3. Node 22 및 lockfile 의존성으로 다음 명령을 실행합니다.

```powershell
npm ci --ignore-scripts
npx vitest run scripts/build-android-release.test.ts
node scripts/build-android-release.mjs
```

이 스크립트는 운영 `release.json`, `web-build-profile.json`, 공개 진입 JS를 읽어
소스 커밋, 운영 프로젝트, 기능 플래그와 공개 publishable key를 대조합니다.
운영 웹 입력 소스와 작업 파일이 다르거나 빌드 도중 운영 릴리스가 바뀌면 실패합니다.
서버 비밀값을 조회하지 않으며 키를 로그에 출력하지 않습니다. 키·번들 형식이 바뀌면
스크립트를 검토하고 수정해야 하며 로컬 `.env` 값으로 대체하지 않습니다.

운영 빌드가 설정하지 않는 `VITE_ENABLE_INVENTORY_IMPORT_V2`도 명시적으로 비활성화하여
로컬 설정의 혼입을 막습니다. `npm run build`의 필수 검사 후 `android-release.json`을
내장하고 Capacitor를 동기화합니다. 이 파일에는 웹 기준 커밋, 작업 HEAD, 수정 여부,
tracked diff 및 빌드 스크립트 해시, 빌드 시각, 운영 설정이 기록됩니다.
작업 트리가 수정된 빌드는 HEAD만으로 재현할 수 없으므로 변경 파일도 함께 보존합니다.

에뮬레이터 점검 중 발견한 UI 결함 등 웹 소스 수정본을 패키징할 때는 diff를 검토한 뒤
`node scripts/build-android-release.mjs --allow-web-changes`를 명시적으로 사용합니다.
이 경우 운영 설정은 유지하지만 운영 웹과 동일한 번들이라고 간주하지 않습니다.
내장 manifest의 `web_inputs_match_production=false`, `web_changed_files`, `web_diff_sha256`으로
운영 기준 커밋과 수정본을 구별합니다. 추적되지 않은 새 웹 입력 파일은 허용하지 않습니다.

4. 기존 `android/keystore.properties`와 키스토어가 존재하는지 확인한 뒤 JDK 21로 빌드합니다.
   서명 설정이 없으면 Gradle이 unsigned 산출물을 만들 수 있으므로 다음 검증을 생략하지 않습니다.

```powershell
# JAVA_HOME은 설치한 JDK 21 경로로 설정합니다.
$env:JAVA_HOME = (Resolve-Path '.tooling/jdk/extracted/jdk-21.0.10+7').Path
$env:Path = "$env:JAVA_HOME/bin;$env:Path"
Push-Location android
./gradlew.bat bundleRelease assembleRelease lintRelease --console=plain
Pop-Location
```

5. 아래 도구로 서명·구조·버전을 검증합니다(도구 경로는 설치 환경에 맞게 지정).

```powershell
jarsigner -verify android/app/build/outputs/bundle/release/app-release.aab
java -jar .tooling/bundletool/bundletool-all-1.18.3.jar validate --bundle=android/app/build/outputs/bundle/release/app-release.aab
./.tooling/android-sdk/build-tools/36.0.0/apksigner.bat verify --verbose --print-certs android/app/build/outputs/apk/release/app-release.apk
./.tooling/android-sdk/build-tools/36.0.0/aapt.exe dump badging android/app/build/outputs/apk/release/app-release.apk
```

추가로 AAB의 `base/assets/public/`과 APK의 `assets/public/` 아래 모든 파일의
상대경로·SHA-256을 비교합니다. 기존 AAB의 서명 인증서와 새 산출물의 인증서도 비교합니다.
기존 AAB에서 같은 키로 생성한 APK를 에뮬레이터에 설치한 후 새 APK를 `adb install -r`로
업데이트하여 앱 데이터를 지우지 않고 설치되는지 확인합니다. 디버그 서명 앱 삭제 후
신규 설치는 업데이트 검증으로 간주하지 않습니다.

배포용 파일과 SHA-256, 내장 `android-release.json`, 테스트 결과를 버전별 폴더에 보관합니다.
Play 제출 전에는 모든 트랙의 최대 versionCode와 Play App Signing 인증서를 별도 확인합니다.
업로드 키로 서명한 로컬 APK가 Play에서 설치한 앱을 직접 업데이트할 수 있다고 가정하지 않습니다.

## 1. 로컬 필수 도구

- JDK 21 (현재 Gradle wrapper로 검증한 버전)
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
- `OPENAI_API_KEY`
- `OPENAI_SAFETY_HMAC_SECRET`

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
- `/api/ai/*`, `/api/voice/*`, `/api/kosha/*` 호출이 절대 URL 기준으로 정상 동작하는지 확인
- Android 1.0.4 호환용 `/api/gemini/*` 별칭이 신규 `/api/ai/*`와 같은 응답 계약을 유지하는지 확인
- 카메라 스캔 기능이 Android 권한 요청 후 정상 동작하는지 확인
- PWA 아이콘과 Android 런처 아이콘이 동일 브랜드로 보이는지 확인
- 개인정보처리방침 URL, 앱 설명, 스크린샷, 테스트 계정 준비
