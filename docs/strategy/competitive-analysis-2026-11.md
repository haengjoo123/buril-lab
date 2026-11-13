# 버릴랩 경쟁 분석 및 고도화 방안 (2026-11)

작성일: 2026-11-13

## 0. 범위와 한계

- 해외 17개, 국내 12개 서비스를 공개 자료로 조사하고, 우리 코드베이스의 기능·UX 현황과 대조했다.
- UI/UX 전면 리뉴얼은 범위가 아니다. 모든 방안은 기존 화면 구조(하단 탭, 사이드바, 스캐너, 관리자 할 일 인박스, Safety Center) 안에 추가하는 방식이다.
- 한계
  - 이 분야는 공개 리뷰가 적다(Chemwatch G2 리뷰 0건, CISPro 2건). 사용자 평가는 G2·Capterra·대학 안내 페이지에 주로 의존했다.
  - 하이브레인넷·김박사넷·에브리타임 후기는 로그인 장벽으로 확인하지 못했다. 국내 불만 사항은 매뉴얼·앱스토어·기사에서 추정한 것이다.
  - 경쟁사 가격은 대부분 견적제라 미확인이다. 집계 사이트 수치는 서로 다르다.
  - LabCup, Sapio, Uncountable, ChemSafetyPro, ACTenviro는 조사하지 못해 제외했다.
  - 우리 현황은 코드를 읽어 파악했고 앱을 실행해 확인하지는 않았다.

## 1. 시장 구조

### 1.1 해외

해외 시장은 세 묶음으로 나뉘고 서로 거의 겹치지 않는다.

| 구분 | 서비스 | 구매자 | 특징 |
|---|---|---|---|
| 연구실 운영·구매 | Quartzy, Labguru, Benchling, eLabInventory, LabArchives, Scispot | 연구책임자, 랩매니저 | 사용성은 좋으나 화학 안전이 얕다 |
| 기관 안전관리(EHS) | SciSure(ChemTracker), BIOVIA CISPro, VelocityEHS, Chemwatch, Sphera, Benchmark Gensuite, ChemicalSafety EMS, UC Chemicals, Chematix | 안전관리 부서 | 보고는 깊으나 무겁고 낡았다. 연구자에게는 규제 숙제로 인식된다 |
| 단일 목적·무료 | CAMEO Chemicals(NOAA), SDS Manager, LabIris, ChemInventory | 개인, 소규모 연구실 | 싸거나 무료이고 범위가 좁다 |

2025년 1월 SciShield와 eLabNext가 합병해 SciSure가 되었고, 이후 Labfolder·Labregister를 인수했다. 전자연구노트·LIMS·재고·안전관리를 묶었고 4만 개 이상 연구실을 내세운다. "운영 + 안전" 포지션에서 우리와 가장 가까운 해외 사례다. 다만 합병으로 이어 붙인 제품이라 당분간 통합도가 낮을 가능성이 있다.

### 1.2 해외 서비스별 요약

| 서비스 | 강점 | 약점 |
|---|---|---|
| Quartzy | 구매·승인·재주문, 지출 보고, 위치별 재고. 학계 약 $50/월(집계 사이트 수치) | 바코드 없음. 검색이 내 재고 대신 쇼핑 상품을 보여 줌. 초기 가져오기가 어려움 |
| ChemInventory | 병 단위 바코드, 이름/CAS로 GHS 자동 채움, 무료 구간 | 기관 보고 기능 제한 |
| SciSure ChemTracker | 소방 MAQ·Tier II 보고, ChemSnap AI(2024.12, 라벨 사진으로 CAS·제조사·로트·용량 채움), SDS 자동 연결 | 견적제. AI 결과 검증 필요를 업체가 명시 |
| BIOVIA CISPro | 병 단위 추적, 규제 목록 대조 | 구형 UI(Ext JS 4), 느림, 소규모에 과함 |
| VelocityEHS(MSDSonline) | 대형 SDS 라이브러리, 스캔으로 SDS 조회 | 수기 입력 많음, 고가 |
| Chemwatch | 자체 작성 SDS, GHS/REACH, 라벨 생성 | 모바일 앱은 SDS 뷰어 수준 |
| Benchmark Gensuite Chem Agent(2026) | AI로 SDS 추출·버전 비교 | SDS 전용. 재고·폐기 없음 |
| ChemicalSafety EMS | 폐기물 수거 요청, 누적 구역 추적, 드럼 교체, 모바일 스캔, 라벨 인쇄 | 구형 UI |
| Chematix | 폐기물 카드, 수거 작업표 | 종이 인쇄·서명 단계. 일부 대학이 교체 중 |
| UC Chemicals | 바코드 재고, 연구실 간 시약 공유 | 폐기는 별도 시스템(WASTe). UC 전용 |
| Labguru / Benchling / LabArchives / Scispot | 전자연구노트와 통합된 재고 | 화학 안전이 얕음 |
| LabIris(2026, iOS, 무료) | AI 라벨 판독, 곡면 라벨 다중 촬영 병합, QR 병 태그, 만료 알림, 중복 감지 | GHS·폐기·기관 계층 없음 |
| CAMEO Chemicals / CRW | 반응성 그룹 기반 혼합 반응 예측, 무료 | 쌍 단위만 확인. 재고·폐액통과 연결 안 됨 |

### 1.3 국내

| 서비스 | 운영 | 강점 | 약점 |
|---|---|---|---|
| LAB MANAGER(랩매니저) | 스마트잭(앱스토어 표기). 케이피한석화학과의 관계는 미확인 | AI 라벨 촬영 등록, MSDS, 위험물 분류, 산/염기 동시보관 분석, 대시보드, 현장 전수조사 서비스 | 폐액 호환성·폐액통·3D 시약장·계산기는 확인되지 않음 |
| 서브원 LSP | 서브원 | 구매 시 자동 등록, 규제 물질 표시, 360만 품목 DB | 서브원 구매 고객 중심, 기업·제약 대상 |
| 싸이스트 R-CMS | 싸이스트 | 바코드·전자저울 연동, 화관법·화평법·산안법·위험물 분류, 제출 보고서 자동 생성 | 온프레미스, 키오스크·PC 중심 |
| 이지메디컴 AI L-SRMS | 이지메디컴 | RFID 입출고, AI 수요 예측, 구매 연동 | 고가 하드웨어, 대형 기관 대상 |
| 지티사이언 | 지티사이언 | IoT 시약장, RFID 실험대, 환경 감시 | 현재 판매 현황 미확인 |
| 대학 연구실안전관리시스템(아이엠지테크 계열) | 대학별 구축 | 학사·공간 정보 연동, 교육·이수증, MSDS 검색 | 게시판형 포털, 화학물질 재고가 얕음 |
| 서울대 SAFE + SCMS 앱 | 서울대 | QR/바코드·사진 등록, 폐기물까지 포괄 | 웹에서 먼저 등록해야 앱 사용 가능 |
| 고려대 안전관리시스템 앱 | 고려대 | 일상점검, 사고 보고, IoT 알림, 폐기 요청 | PC 웹 선등록 필요, 다중 기기 불가 |
| 전남대 시스템 | 전남대 | 제조사별 MSDS DB 약 25만 건 | 라벨 정보를 수기로 정확히 입력하라고 안내 |
| 국가연구안전정보시스템 | 과기정통부 | 의무 사용(실태조사) | 기관 보고용. 연구실 내부 재고 기능 없음 |
| KOSHA MSDS | 안전보건공단 | 무료 조회, 경고표지 양식 | 조회 전용 |

과기정통부 연구실 안전 모바일 앱(2024년 출시 예고)은 출시 여부를 확인하지 못했다.

## 2. 우리 현황과 대조

### 2.1 앞서는 지점 (국내외 모두 공백)

- 성분 기반 폐액 분류와 혼합 호환성: 5단계 폐액 배치 마법사, 규칙 엔진 + AI, 연구실별 폐기 정책. 조사한 폐기물 도구(Chematix, EMS Waste, UC WASTe)는 모두 수거 물류 도구이고 분류는 안전관리 직원이 수작업으로 한다.
- 3D 시약장과 선반 단위 보관 적합성 경고. 해외는 표로만 보여 주고, 국내는 랩매니저가 산/염기 분석을 하지만 공간 시각화는 없다.
- pH 예측, 실험 도구 23종. 재고·안전 제품에 계산 도구를 묶은 사례는 찾지 못했다.
- 연구실 앱과 기관 Safety Center를 한 제품으로 잇는 구조. 독립 가입이 가능해 대학 시스템과 달리 연구실 단독 도입이 된다.
- 감사 이력(변경 전후 비교), 원본 보존형 폐기 기록 정정.

### 2.2 뒤처진 지점 (해외에서는 기본기)

| 항목 | 우리 현황 |
|---|---|
| 병 단위 QR/바코드 스캔·라벨 인쇄 | 없음. 스캔은 AI 라벨 판독뿐. 폐액통 라벨 PDF에 코드 없음 |
| 스캔 기반 정기 실사(재고 대조) | 없음 |
| 유효기간 푸시·이메일 알림 | 없음. 앱 내 필터·배지·관리자 할 일 카드만 |
| SDS 파일 보관 | 부분. KOSHA 뷰어와 제조사 링크만 |
| 재주문·구매 요청 | 없음. 구매 의도 이벤트만 수집 |
| 법정 기록·보고 양식 | 없음. 화관법 분류 조회와 범용 내보내기만 |
| 공개 API·연동 | 없음 |
| 오프라인 기록 | 도구만 오프라인 초안 지원. 재고·폐기 기록은 연결 필요 |

### 2.3 국내외 공통 사용자 불만 (우리에게 기회)

1. 수기 입력 부담과 초기 데이터 이전의 어려움
2. 폐기한 병이 재고에 남아 재고가 부정확해짐
3. 낡고 느린 UI, PC 우선 구조
4. 재고·폐기·점검이 서로 다른 시스템에 흩어짐
5. 견적제 고가, 하드웨어 의존

### 2.4 외부 변수

- 2026.4.29 연구실 안전 강화 대책: 시약장·폐시약 설비 지원, 고위험 연구실 안전관리자 확충, 정부 모바일 통합 플랫폼 구축 예고(위협이자 연동 기회).
- 2025.8.7 화관법 유해성 분류 개편(인체급성·인체만성·생태유해성). 연구용 시약 예외 범위는 미확인.
- 연구실안전법 일상점검 기록 의무, 정기점검, 사전유해인자위험분석, 실태조사.
- AI 라벨 스캔은 2025~26년에 기본기로 바뀌는 중이다(ChemSnap, LabIris, 랩매니저). 라벨 스캔만으로는 차별점이 되지 않는다.

## 3. 고도화 방안

각 항목은 `src/config/featureFlags.ts`의 플래그 뒤에서 개발한다.

### 1단계: 도입 장벽과 기본기 격차 해소

1. **QR 병 라벨과 스캔 빠른 실행.** 재고 항목과 폐액통에 QR을 발급하고 라벨에 넣는다. 기존 스캐너에 QR 인식을 더해, 인식되면 해당 항목에서 사용량 기록·이동·폐기 시작을 바로 고르게 한다.
2. **시약장 실사 모드.** 시약장 단위로 QR을 연속 스캔해 확인됨·미확인·위치 불일치를 표시한다.
3. **유효기간·폐액통 알림.** 관리자 할 일 인박스가 이미 계산하는 신호를 푸시와 주간 이메일 요약으로 내보낸다.
4. **가져오기 V2 정식화와 온보딩 연결.** AI 가져오기(엑셀·PDF·사진·손글씨)를 안정화하고 온보딩의 재고 단계에서 제안한다.

### 2단계: 차별점 강화

5. **폐액통 "지금 부어도 되나" 확인과 수거 요청.** 폐액통 QR 스캔 → 누적 내용물과 넣으려는 폐액을 호환성 검사 → 기록. 가득 차면 관리자와 Safety Center로 수거 요청.
6. **일상점검 모바일 체크리스트.** 재고·시약장 경고를 점검 항목에 자동 반영하고 Safety Center에 이행률을 집계한다.
7. **데이터 기반 법정 기록 초안.** 사전유해인자위험분석 초안, 화관법 개편 분류 기준 보유 현황, 실태조사용 통계. 양식의 법적 정확성은 실제 서식 확인이 필요하다.
8. **SDS 파일 첨부.** 공급사 SDS를 재고 항목에 올리고 KOSHA 자료와 함께 본다.

### 3단계: 수익화와 확장

9. **부족 예상과 구매 요청.** 잔량·사용 이력 기반 부족 알림, 구매 요청과 관리자 승인.
10. **연동과 배포 선택지.** 대학 시스템·정부 플랫폼용 내보내기, 공개 API, 프라이빗 배포 검토.

### 하지 않는 것

- 내비게이션 구조와 디자인 시스템 변경
- RFID·키오스크 등 하드웨어 의존 기능
- 전자연구노트·LIMS 영역 진입

## 4. 출시 게이트와의 관계

`docs/operations/gate0-release-status.md`와 `operations-safety-rollout.md`의 "현재 금지 상태"에 "SDS·바코드·알림·보고서·파일럿·유료 출시 기능 반영 금지"가 있다. 두 문서에 이 금지의 해제 조건은 적혀 있지 않다.

- 금지 목록에 해당: 항목 1, 2(바코드), 3(알림), 7(보고서), 8(SDS)
- QR에 의존해 간접 해당: 항목 5의 스캔 부분
- 해당 없음: 항목 4(가져오기), 항목 5의 호환성 확인·수거 요청, 항목 6(일상점검), 항목 9, 10

금지 항목의 착수 여부와 순서는 별도 결정이 필요하다.

## 5. 주요 출처

- Quartzy: https://www.capterra.com/p/189585/Quartzy/reviews/ , https://www.g2.com/products/Quartzy/reviews
- ChemInventory: https://us.fitgap.com/products/cheminventory
- SciSure: https://www.scishield.com/chemtracker , https://www.bu.edu/oehs/2024/11/21/introducing-chemsnap-ai-new-scishield-feature-launching-dec-2024/
- BIOVIA CISPro: https://www.g2.com/products/biovia-cispro/reviews
- VelocityEHS: https://www.g2.com/products/velocityehs-accelerate-ehs-esg/reviews
- ChemicalSafety EMS: https://chemicalsafety.com/hazardous-waste-management-software/
- Chematix: https://safety.rochester.edu/labsafety/chematix/waste_module.html
- UC Chemicals: https://ehs.ucsc.edu/lab-safety-manual/chem-inventory.html
- LabIris: https://apps.apple.com/app/id6756403566
- CAMEO: https://response.restoration.noaa.gov/sites/default/files/cameo_chem.pdf
- 재고 부정확 사례: https://www.colorado.edu/ehs/lab-research/chemicals-hazardous-materials/chemical-inventory
- 랩매니저: https://edaily.co.kr/News/Read?mediaCodeNo=257&newsId=03876966645511896
- 서브원 LSP: https://magazine.hankyung.com/business/article/202309148484b
- 싸이스트 R-CMS: https://www.s21.co.kr/news_proc/news_contents.jsp?ncd=3870
- 이지메디컴: https://medigatenews.com/news/460989744
- 지티사이언: https://kidd.co.kr/news/226361
- 서울대 SCMS: https://www.snu.ac.kr/research/support/safety
- 2026 연구실 안전 강화 대책 요약: https://research.uos.ac.kr/node/8666
- 화관법 개편: https://www.heraldk.com/article/2025072820175292782
- 전문가 칼럼(수기 절차 부담): https://www.gasnews.com/news/articleView.html?idxno=115112
