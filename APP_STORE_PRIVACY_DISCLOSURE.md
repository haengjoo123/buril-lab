# BurilLab 앱스토어 개인정보 수집 고지

최종 갱신: 2026-08-23

이 문서는 검색·최종 배치 분석 릴리스와 함께 App Store Connect 및 Google Play Console에 반영할 운영 체크리스트다. 실제 제출 검색만 수집하며 입력 중 키 입력은 수집하지 않는다.

## 공통 고지

- 수집 항목: 정제된 제출 검색어, 검색 유형·채널, 결과 수·결과 상태·지연시간, 최종 매칭 CAS/PubChem/KOSHA 식별자와 표준명, 결과 열람·선택·재검색·스캔 수정·배치 추가 행동, 검색 이벤트와 연결된 최종 폐액 배치 구성품
- 연결 식별자: 로그인 계정 또는 무작위 게스트 주체 ID, 연구실 ID, 30분 세션 ID
- 목적: 앱 기능 제공, 검색 품질·자동완성·별칭·스캔 교정 개선, 오류 분석, 검색→최종 배치 전환과 안전 교육 우선순위 분석
- 필수 여부: 실제 검색 제출 시 필수 분석. 분석 전송 실패는 검색 기능을 차단하지 않음
- 추적/광고: 타사 광고나 교차 앱 추적에 사용하지 않음
- 판매: 개인정보를 판매하지 않음. 현재·과거 데이터의 외부 상품 편입은 비활성화
- 보안: 전송 중 TLS, 서버 전용 분석 테이블, RLS 및 클라이언트 권한 제거
- 삭제: 게스트 원시 이벤트 90일 자동 삭제 및 브라우저 삭제 토큰 제공. 로그인 사용자는 최근 검색 삭제·회원 탈퇴 시 연결된 분석 원시 이벤트와 행동 삭제
- 보존 예외: 최소 공개 임계치를 이미 충족한 비가역 월간 집계만 개인 삭제 이후 유지 가능
- 개인정보처리방침: 앱의 `/privacy` 경로 및 공개 배포 URL의 동일 경로

## Apple App Store Connect

Privacy Details에서 다음 데이터 유형과 목적을 실제 빌드 동작에 맞게 선언한다.

| Apple 데이터 유형 | 계정 연결 | 목적 |
| --- | --- | --- |
| Search History | 로그인: 예 / 게스트: 무작위 주체 | App Functionality, Analytics |
| Product Interaction | 로그인: 예 / 게스트: 무작위 주체 | Analytics, App Functionality |
| User ID | 로그인 계정 또는 무작위 게스트 ID | App Functionality, Analytics |
| Other User Content | 최종 폐액 배치·구성품이 계정/연구실과 연결 | App Functionality, Analytics |
| Diagnostics / Performance Data | 검색 지연시간·기술 오류 상태 | Analytics |

“Data Used to Track You”는 아니오, “Data Linked to You”는 로그인 검색과 배치 데이터에 예로 표시한다. 게스트 데이터도 서버 내부의 무작위 주체와 연결되므로 단순히 완전 익명으로 선언하지 않는다.

## Google Play Data safety

- 수집: App activity(검색 기록, 앱 상호작용), User IDs, App info and performance(진단·검색 지연), User-generated content(폐액 배치 구성)
- 목적: App functionality, Analytics, Fraud prevention/security/compliance
- 공유: 서비스 처리자에게 운영 목적 처리 위탁은 개인정보처리방침에 고지하되, 판매 또는 광고 공유로 선언하지 않음
- 수집 선택 가능 여부: 검색 제출 분석은 필수로 표시
- 삭제 요청: 앱 내 회원 탈퇴, 최근 검색 삭제, `/privacy`의 게스트 데이터 삭제, 이메일 요청 경로 제공

## 릴리스 게이트

- [ ] 개인정보처리방침 배포가 앱 바이너리/웹 수집 기능보다 먼저 또는 동시에 완료됨
- [ ] Apple Privacy Details와 Google Play Data safety 응답 업데이트 완료
- [ ] `OPS_ADMIN_EMAILS`와 별도 `OPS_ANALYTICS_EXPORT_EMAILS` 허용목록 설정
- [ ] 외부 상품 비활성 상태와 `internal_only` cohort 확인
- [ ] 게스트 삭제, 최근 검색 삭제, 회원 탈퇴 연쇄 삭제 검증
- [ ] 보안·성능 advisor와 RLS/401/403/CSV 식별자 제거 테스트 통과

스토어 제출 전에는 실제 배포 환경, SDK가 별도로 수집하는 진단 정보, 각 스토어의 최신 질문 문구를 기준으로 최종 재검토한다.
