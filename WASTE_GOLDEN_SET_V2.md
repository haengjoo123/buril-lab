# CAS·SDS 실제 물질 골든셋 V2

V2는 V1의 합성 혼합 시나리오를 대체하지 않는다. V1은 산·알칼리, 혼합금지, pH 경계처럼 **조합 안전성**을 회귀시험하고, V2는 실제 단일 물질의 표준 폐기 시나리오를 회귀시험한다.

## 포함 범위

`data/waste-golden-set-v2/materials.json`은 CAS가 중복되지 않는 1,000개 물질이다. 다음 10개 대표군을 포함한다. 최초 후보는 군별 균형 표본으로 수집하지만, 최종 군 배정은 검색어가 아니라 분자식·H코드·물질명으로 다시 판정한다. 실제 군별 수는 `source-manifest.json`을 기준으로 한다.

- 비할로겐 유기물, 할로겐 유기물, 산·알칼리, 일반 무기염
- 중금속, 시안·황화물, 반응성·산화성, 독성·CMR
- 불소·유기불소, 고체·기타

각 행에는 표준 시나리오, KOSHA MSDS의 개정일·열람일·POST 조회 참조, Section 2/3/9/10/13의 짧은 지문과 SHA-256 지문, H코드, 규제 검색 참조, 정답과 사유, 작성/독립 검토 기록이 들어 있다. 원문 SDS/PDF/HTML은 저장하거나 재배포하지 않는다.

KOSHA가 1차 근거다. PubChem은 현재 분석기 입력 재현에 필요한 분자식만 보조하며, PubChem에 없는 CAS는 빈 분자식을 그대로 보존한다. 이 경우 앱이 보수적으로 보류하는지도 회귀 대상이다.

물리적 폐액통 위치·기관별 라벨은 정답에 포함하지 않는다. 정답은 공통 스트림 코드만 사용한다.

## 검토 상태의 의미

현재 1,000개 행의 `approved`는 **서로 다른 자동화 단계**의 승인이다.

- `kosha-source-curation-bot-v1`: KOSHA 원문에서 식별자·SDS 지문·H코드를 추출
- `policy-rule-review-bot-v1`: 저장된 근거와 단일물질 표준시나리오가 스키마와 공통 스트림 정책을 만족하는지 별도 검사

따라서 이는 “두 사람의 법적/기관 SOP 검토 완료”를 뜻하지 않는다. 배포용 규제 주장으로 격상하려면 각 행에 이름이 다른 사람의 검토 ID와 불일치 해결 기록을 추가해야 한다. 이 제한을 데이터와 매니페스트에 명시해, 자동화된 추출을 사람 검토로 오인하지 않도록 했다.

## 실행

```bash
# 외부 KOSHA/PubChem를 조회해 스냅샷을 새로 만들 때만 실행 (CI 금지)
npm run golden:generate

# KOSHA 15항/규제정보 지문을 저장된 1,000개 행에 갱신 (CI 금지)
npm run golden:refresh-evidence

# 저장된 근거만 사용해 물질군·정답을 다시 판정 (네트워크 없음)
npm run golden:reclassify

# 저장된 1,000행과 현재 분석기를 네트워크 없이 검증
npm run golden:verify

# 물질군별 strict match·보수적 보류·unsafe ready·불일치 사례를 파일로 생성
npm run golden:report

# 직전 오프라인 회귀 결과의 자동 adjudication을 행에 저장
npm run golden:store-adjudication
```

`golden:verify`는 앱 빌드 경로에 포함된다. 차단·보류·별도검토가 정답인 행에 앱이 `ready`를 내는 `unsafe automatic ready`가 한 건이라도 있으면 빌드/CI가 실패한다. 반대로 ready 정답을 보류한 경우는 차단하지 않고 `conservative hold`로 보고해 개선 후보로 남긴다.

## 갱신 규칙

`scripts/generate-waste-golden-v2.mjs`만 네트워크를 사용한다. 수집 시 KOSHA 개정일과 원문 SHA-256 지문을 업데이트하고, CI는 커밋된 `materials.json`과 `source-manifest.json`만 읽는다. `baseline-report.json`은 `golden:report`가 남기는 감사용 결과물이다. 정답 또는 규칙을 변경하기 전에는 V2 기준선의 불일치 근거를 검토해 별도 변경으로 분리한다.
