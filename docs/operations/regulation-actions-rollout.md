# 화관법·연구실안전법 연계 기능 롤아웃

이 기능은 다섯 PR로 나눠 들어간다. 각 PR은 기본 꺼짐 플래그 뒤에 있다. 법령 근거는 `docs/operations/regulation-obligations-sources.md`에 있다.

## 1. 규제 카드 "할 일" 개편 (`VITE_ENABLE_REGULATION_ACTIONS`)

- DB 변경 없음.
- 재고 상세와 검색 결과의 화관법 카드가 할 일 1~4줄을 먼저 보여 준다. 분류명·농도 기준·예외·고시일·근거 법령은 "분류 근거 보기" 안에 접혀 있다.
- 같은 PR에서 일상점검 문구 6개를 고시 원문에 맞췄다(`kr-daily-v2`). 이 변경은 플래그와 관계없이 바로 적용된다.
- 켜기: Staging과 운영 변수를 함께 `true`로 바꾸고 배포한다.

## 2. 분류 저장·일괄 조회·목록 필터 (`VITE_ENABLE_REGULATION_BATCH`)

- **DB:** `20261116090000_regulation_source_cache`는 `chemical_source_cache`의 CHECK 제약만 넓힌다(source `keco`, record_type `regulation`). 이 테이블은 service role만 접근한다.
- **서버**
  - `GET /api/chemicals/regulations`(기존): 엣지 캐시 → DB 캐시 → KECO 순서로 찾고, 확정 답은 DB에 저장한다. 저장 기간은 찾음 30일, 없음 7일이다. DB 캐시가 없어도 예전처럼 동작한다.
  - `POST /api/chemicals/regulations-batch`(신규, 로그인 필수): 한 번에 CAS 100개까지 받는다. DB 캐시와 엣지 캐시에서 먼저 답하고, 나머지는 요청당 12개까지만 KECO에 묻는다. 그 이상은 `pending`으로 돌려준다.
  - 클라이언트는 2.5초 간격으로 최대 12번 다시 묻는다.
- **화면**
  - 재고의 기존 "위험 분류" 드롭다운에 "화관법 규제물질" 항목 1개가 추가된다. 허가·제한·금지·유해화학물질이 대상이다.
  - 위험분석용 목록 엑셀에 "화관법 분류" 열과 안내 문구가 추가된다. 카드에는 칩을 추가하지 않는다.
- **순서**
  1. Staging과 운영에 migration을 연달아 적용한다. Staging만 먼저 적용하면 main의 hosted 보안 검사가 실패한다.
  2. 운영 승격 전에 `WEB_DATABASE_REVIEWED_SHA`를 해당 커밋으로 갱신한다.
  3. 두 환경의 플래그를 함께 켠다.
  - migration 전에 플래그를 켜도 화면은 깨지지 않는다. 다만 DB 저장이 실패해 매번 KECO를 부르게 되고, 경고 로그가 남는다.
- **KECO 쿼터:** 처음에는 연구실의 모든 CAS를 KECO에서 한 번씩 조회한다. 답은 연구실·사용자와 관계없이 CAS 단위로 공유되므로, 이후 다른 연구실은 대부분 DB 캐시에서 답을 받는다.
