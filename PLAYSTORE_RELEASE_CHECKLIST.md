# Google Play 출시 체크리스트

## 콘솔 메타데이터

- 앱 이름: `Buril Lab`
- 기본 패키지명: `com.burillab.app`
- 기본 버전코드: `1`
- 기본 버전명: `1.0`
- 앱 설명 한글/영문 초안 준비
- 512x512 아이콘 준비
- 휴대전화 스크린샷 최소 2장 이상 준비
- 피처 그래픽 1024x500 준비
- 개인정보처리방침 URL 준비

## Data Safety 작성 기준

- 계정 정보: Supabase 인증 사용 여부 명시
- 사진/카메라: 라벨 스캔 기능 설명
- 앱 활동/검색 기록: 실제 수집 여부 점검 후 정확히 기입
- 제3자 전송: Supabase, Google Vision, Gemini, KOSHA API 호출 여부 기준으로 정리
- 데이터 삭제 요청 방식: 지원 이메일 또는 앱 내 절차 준비

## 앱 액세스 준비

- 리뷰어 테스트 계정 이메일
- 리뷰어 테스트 계정 비밀번호
- 로그인 후 첫 진입 흐름 설명
- 카메라 스캔 기능 진입 방법 설명

## 내부 테스트 업로드 전 확인

1. `npm run build:android`
2. `cd android`
3. `.\gradlew bundleRelease`
4. `android/app/build/outputs/bundle/release/app-release.aab` 생성 확인
5. 내부 테스트 트랙 업로드
6. 설치 후 로그인, 검색, 스캔, 재고 조회, 폐기 로그 흐름 재검증
