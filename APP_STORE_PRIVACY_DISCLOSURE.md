# BurilLab 앱스토어 개인정보 수집 고지

최종 갱신: 2026-11-06

이 문서는 검색·최종 배치 분석 릴리스와 함께 App Store Connect 및 Google Play Console에 반영할 운영 체크리스트다. 실제 제출 검색만 수집하며 입력 중 키 입력은 수집하지 않는다.

2026-11-06 갱신: 이미 서버에 저장 중이던 앱 이용 기록 3종(`onboarding_events`, `safety_compliance_events`, `commerce_intent_events`)을 고지에 추가했다. 이전 처리방침은 이를 "로컬 저장"으로 잘못 고지했다.

2026-11-06 추가 갱신(연구실 관리 기록): 피드백에 보낸 화면과 연구실을 함께 저장하고, 연구실 관리 행위(멤버·센터 연결·폐액통 현장 설정)를 `audit_logs`에 남긴다. 아래 "피드백 맥락과 연구실 관리 기록" 절을 본다.

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

## 앱 이용 기록 (로그인 사용자만)

`src/services/analyticsService.ts`가 로그인 세션이 있을 때만 아래 3개 테이블에 직접 저장한다. 게스트는 저장하지 않는다. 세 테이블 모두 `user_id`(계정)와 `lab_id`(기록 당시 선택한 연구실, 없으면 null), `created_at`을 함께 저장한다.

| 기록 | 테이블 | 저장 항목 | 목적 |
| --- | --- | --- | --- |
| 온보딩 진행 | `onboarding_events` | 이벤트 종류(표시·단계 완료·첫 가치 도달·건너뜀·다시 보기), 단계(검색·폐기·시약장·재고), 화면, 플랫폼(web/native), metadata(`active_tab`, `cart_count`, `completed_count`, `language`, `query_length`) | 기기 간 온보딩 진행 상태 복원(App Functionality), 온보딩 개선 내부 집계(Analytics) |
| 보관 경고 무시 | `safety_compliance_events` (`storage_warning_ignored`) | 화면, 발생 경로, 경고 심각도, 규칙 ID, 메시지 키, 시약장·선반 ID, 두 시약의 이름·CAS 번호(원문·정규화), metadata(관련 품목 ID) | 보관 안전 안내 개선 내부 집계(Analytics) |
| AI 폐기 안내 열람 | `safety_compliance_events` (`ai_disposal_guide_viewed`) | 화면, 발생 경로, 시약 이름·CAS 번호(원문·정규화), 단일/혼합 구분, metadata(분자식, 분류, 함께 조회한 시약, 시약 수, 요청 해시 `cache_key_sha256`, 응답 출처·가용성·판정 상태, 폐액 분류 코드, 정책·규칙 버전). 요청 해시는 직렬화한 요청의 SHA-256이며 요청 내용 자체는 저장하지 않는다. 이전 버전 앱이 저장한 행에는 요청 전체를 직렬화한 `cache_key`(폐액 배치 구성, 판정 결과, 적용된 연구실 폐액 규정의 보관 위치·용기 라벨·담당 연락처·SOP URL)가 남아 있으며, 처리방침에도 그렇게 고지했다 | 폐기 안내 개선 내부 집계(Analytics) |
| 구매 의도 | `commerce_intent_events` | 이벤트 종류(재고 등록·수정, 시약장 배치·스캔·수정), 화면, 보관 유형, 제품 ID, 원본 품목 종류·ID, 브랜드(원문·정규화), 제품번호, 수량, 용량(원문·수치·단위·mL 환산), CAS 번호(원문·정규화), CAS 입력 방식, metadata(제품명, 입력 방식, 등록 경로 등) | 시약 수요 파악 등 서비스 개선 내부 집계(Analytics). 외부 제공 없음 |

- 온보딩 metadata에는 검색어 원문(`query`)을 저장하지 않고 글자 수(`query_length`)만 저장한다. 이전 버전 앱(업데이트하지 않은 네이티브 앱 포함)이 저장한 행에는 `metadata.query`가 남아 있으며, 처리방침에도 그렇게 고지했다. 기존 행 정리는 별도 작업(F1 2단계) 대상이다.
- 구매 의도 기록은 브랜드·용량·CAS 번호·제품 ID 중 하나라도 있을 때만 저장한다.
- 클라이언트가 보내는 `cas_suggestion_dismissed` 이벤트와 `suggested_confirmed`·`bulk_confirmed`·`suggestion_dismissed` 입력 방식은 현재 테이블 CHECK 제약에 없어 저장되지 않는다. CHECK를 넓히는 배포(F2) 때 이 표와 처리방침을 다시 확인한다.
- 조회 권한(RLS): `onboarding_events`는 본인만. `safety_compliance_events`, `commerce_intent_events`는 본인과 `lab_id` 연구실의 멤버. 사용자가 연구실을 나가도 `lab_id`는 바뀌지 않으므로 그 연구실 멤버가 계속 조회할 수 있다(처리방침 5절에 고지).
- 삭제: 세 테이블 모두 `user_id → auth.users ON DELETE CASCADE`. 회원 탈퇴 작업이 Auth 사용자를 영구 삭제(`deleteUser(userId, false)`)할 때 함께 삭제된다. 연구실 삭제 시 `lab_id`만 `ON DELETE SET NULL`. 별도 자동 보존 기간(TTL)은 없다.
- 선택 여부: 앱 안에 이 기록만 끄는 설정은 없다. 처리 중지 요청은 이메일로 받는다.
- 추적/광고/판매: 사용하지 않음. 외부 제공 없음.

## 피드백 맥락과 연구실 관리 기록

- 피드백(`feedback`): 기존 항목(내용, 선택 연락처, 사용자 에이전트, 계정)에 더해 보낸 화면 `source_screen`(`search`·`logs`·`cabinet`·`inventory`·`admin` 중 하나)과, 연구실 공간에서 보낸 경우 `lab_id`를 저장한다.
  - `lab_id`는 로그인 사용자가 자기 멤버십이 있는 연구실만 넣을 수 있다(RLS INSERT 정책의 멤버십 검사). 게스트와 개인 공간에서는 null.
  - 회원 탈퇴 때 `user_id`가 지워지는 같은 문장에서 `lab_id`도 null이 된다(BEFORE UPDATE 트리거). 연구실 삭제 때는 FK `ON DELETE SET NULL`로 지워진다.
  - 스토어 분류: Apple "Customer Support"·"Other User Content", Google Play "App activity › Other actions". 목적 App functionality(버그 제보·개선 요청 처리). 공유(Shared)하지 않음.
- 연구실 관리 기록(`audit_logs`, `source = 'database'`): `entity_type`이 `lab_member`(가입·역할 변경·제외·나가기), `safety_center_link`(연결 요청·승인·거절·철회·공개 범위 변경), `waste_policy_override`(폐액통 현장 설정 저장·변경·되돌리기)인 행.
  - 저장 항목: 대상 계정 식별자(`user_id`)와 역할, 연결 상태·공개 범위·센터 이름, 현장 설정의 폐액 분류·사용 중지 여부·바뀐 항목 이름. 이메일, 연락처, 위치 값, 자유 입력 문구는 저장하지 않는다. 행위자 이름은 연구실 닉네임 또는 프로필 이름(이메일 형태면 저장 안 함)이고, 센터 쪽 행위는 센터 이름으로만 남는다.
  - 조회 권한(RLS): `lab_member` 행은 그 연구실의 관리자(`admin`)만. 센터 연결·현장 설정 행은 기존 활동 기록처럼 그 연구실 멤버 모두. 안전센터 감사 조회에는 `lab_member` 행과 다른 센터의 연결 행이 빠진다.
  - 삭제: 회원 탈퇴 작업이 그 계정의 `user_id` 키와 행위자 식별자·이름을 지운다(기존 계정 삭제 스크럽). 연구실이 삭제돼도 감사 행은 FK가 없어 남지만 멤버가 없어 아무도 읽을 수 없다.
  - 스토어 분류: 기존 활동 기록(Other User Content / App activity)과 같은 범주의 앱 기능 기록. 광고·추적·외부 제공 없음.

## Apple App Store Connect

Privacy Details에서 다음 데이터 유형과 목적을 실제 빌드 동작에 맞게 선언한다.

| Apple 데이터 유형 | 계정 연결 | 목적 |
| --- | --- | --- |
| Search History | 로그인: 예 / 게스트: 무작위 주체 | App Functionality, Analytics |
| Product Interaction | 로그인: 예 / 게스트: 무작위 주체. 온보딩 진행, 보관 경고 무시, AI 폐기 안내 열람 기록은 로그인 계정·연구실과 연결(게스트 수집 없음) | Analytics, App Functionality |
| Other Usage Data | 로그인: 예. 구매 의도 기록(브랜드, 제품번호, 수량, 용량, CAS 번호, 입력 방식)이 계정·연구실과 연결(게스트 수집 없음) | Analytics |
| User ID | 로그인 계정 또는 무작위 게스트 ID | App Functionality, Analytics |
| Other User Content | 최종 폐액 배치·구성품이 계정/연구실과 연결 | App Functionality, Analytics |
| Diagnostics / Performance Data | 검색 지연시간·기술 오류 상태 | Analytics |

“Data Used to Track You”는 아니오, “Data Linked to You”는 로그인 검색과 배치 데이터, 그리고 온보딩·보관 경고·AI 폐기 안내·구매 의도 기록에 예로 표시한다. 이 기록은 광고나 타사 데이터와의 결합에 쓰지 않으므로 추적(Tracking)에 해당하지 않는다. 게스트 데이터도 서버 내부의 무작위 주체와 연결되므로 단순히 완전 익명으로 선언하지 않는다.

구매 의도 기록의 목적이 시약 구매 수요 파악이므로, Apple의 Purchases > Purchase History("구매 성향" 포함)에 해당하는지 제출 전 검토한다. 판단이 어려우면 보수적으로 함께 선언한다.

## Google Play Data safety

- 수집: App activity(검색 기록, 앱 상호작용), User IDs, App info and performance(진단·검색 지연), User-generated content(폐액 배치 구성)
- App activity > App interactions: 온보딩 진행, 보관 경고 무시, AI 폐기 안내 열람 기록. 목적 App functionality(온보딩 진행 복원), Analytics
- App activity > Other user-generated content 또는 Other actions: 구매 의도 기록(브랜드, 제품번호, 수량, 용량, CAS 번호, 입력 방식). 목적 Analytics
- 위 앱 이용 기록은 로그인 계정과 연결해 수집하며 공유(Shared)하지 않음
- 목적: App functionality, Analytics, Fraud prevention/security/compliance
- 공유: 서비스 처리자에게 운영 목적 처리 위탁은 개인정보처리방침에 고지하되, 판매 또는 광고 공유로 선언하지 않음
- 수집 선택 가능 여부: 검색 제출 분석은 필수로 표시. 온보딩·보관 경고·AI 폐기 안내·구매 의도 기록도 앱 안에서 끌 수 없으므로 필수로 표시
- 삭제 요청: 앱 내 회원 탈퇴, 최근 검색 삭제, `/privacy`의 게스트 데이터 삭제, 이메일 요청 경로 제공

## 릴리스 게이트

- [ ] 개인정보처리방침 배포가 앱 바이너리/웹 수집 기능보다 먼저 또는 동시에 완료됨
- [ ] Apple Privacy Details와 Google Play Data safety 응답 업데이트 완료
- [ ] 온보딩·보관 경고 무시·AI 폐기 안내 열람·구매 의도 기록을 두 스토어 응답에 반영(2026-11-06 갱신분)
- [ ] 새 온보딩 이벤트의 `metadata`에 검색어 원문(`query`)이 없고 `query_length`만 있는지 확인
- [ ] 회원 탈퇴 후 `onboarding_events`, `safety_compliance_events`, `commerce_intent_events`에 해당 `user_id` 행이 남지 않는지 확인
- [ ] 피드백 `source_screen`·`lab_id`와 연구실 관리 기록(`lab_member`·`safety_center_link`·`waste_policy_override`, 멤버 기록은 관리자만 조회)을 처리방침 배포와 두 스토어 응답에 반영하고, 회원 탈퇴 뒤 피드백 `lab_id`와 감사 행의 `user_id`가 남지 않는지 확인
- [x] AI 폐기 안내 열람 기록의 `metadata.cache_key`를 SHA-256 해시(`cache_key_sha256`)로 줄임. 처리방침 2절 문구도 함께 고침
- [ ] 이전 버전 앱이 저장한 `metadata.cache_key`·`metadata.query` 행을 정리할지 결정(F1 2단계)
- [ ] `OPS_ADMIN_EMAILS`와 별도 `OPS_ANALYTICS_EXPORT_EMAILS` 허용목록 설정
- [ ] 외부 상품 비활성 상태와 `internal_only` cohort 확인
- [ ] 게스트 삭제, 최근 검색 삭제, 회원 탈퇴 연쇄 삭제 검증
- [ ] 보안·성능 advisor와 RLS/401/403/CSV 식별자 제거 테스트 통과

스토어 제출 전에는 실제 배포 환경, SDK가 별도로 수집하는 진단 정보, 각 스토어의 최신 질문 문구를 기준으로 최종 재검토한다.
