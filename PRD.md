# Project Name
**Buril-rab (랩실 폐시약 안전 관리 솔루션)**

## 1. Target User
* **화학 실험을 진행하는 대학생 및 대학원생** (특히 식품영양, 화학 관련 학과).
* **복잡한 폐기 절차를 매번 검색하기 번거로운 연구원.**
* **실험실 안전 관리자.**

## 2. Key Value
* **Instant Guide:** 사진 한 장으로 복잡한 시약의 폐기 분류(유기/무기, 할로겐 여부 등)를 즉시 확인.
* **Safety Logic:** MSDS를 외우지 않아도, 성분 분석을 통해 가장 안전한 폐기 방법을 자동 제안.
* **Mixture Support:** 여러 시약이 섞인 혼합 폐액에 대한 통합 폐기 가이드 제공.

## 3. Tech Stack
* **Framework:** React (Vite) + TypeScript
* **Styling:** Tailwind CSS (Mobile-first design)
* **Icons:** Lucide React
* **OCR Engine:** Tesseract.js (Client-side) 또는 Google Cloud Vision API (Serverless)
    * *MVP 단계에서는 Tesseract.js 권장*
* **Data Source:** PubChem PUG REST API (분자식/CAS 조회), 자체 매핑 로직
* **State Management:** Zustand (가볍고 직관적인 전역 상태 관리)
* **Persistence:** LocalStorage (최근 검색 기록 저장)

## 4. Core Features (MVP)

### 4.1 Home & Camera Scan
* 메인 화면에 큰 "카메라/스캔" 버튼과 "검색창" 배치.
* 카메라 실행 시 이미지 캡처 -> OCR 처리 -> 텍스트 추출.
* 추출된 텍스트에서 정규표현식(Regex)으로 `CAS No.`(예: 67-64-1) 또는 `Chemical Name` 자동 식별.

### 4.2 Manual Search & Auto-complete
* OCR 실패 시 직접 입력 가능한 검색창.
* CAS No. 또는 국문/영문 시약명 입력 시 PubChem API를 통해 실시간 데이터 조회.

### 4.3 Classification Logic (Core Engine)
* **API 연동:** 식별된 시약의 분자식(Molecular Formula)을 PubChem에서 가져옴.
* **Rule Engine:**
    * 분자식 내 `C` 존재 여부 -> 유기/무기 판별.
    * `F, Cl, Br, I` 존재 여부 -> 할로겐족 판별.
    * `Acid`, `Hydroxide` 키워드 및 pH -> 산/알칼리 판별.
* **Result Display:** 최종적으로 버려야 할 폐액통의 색상과 라벨(예: "주황색 통 - 할로겐족 유기폐액")을 시각적으로 표시.

### 4.4 Mixture Management
* **"혼합물 모드" 토글 제공.**
* 여러 시약을 검색/스캔하여 리스트에 추가(`Cart` 개념).
* 추가된 시약들의 특성을 종합하여 **가장 엄격한 기준(Most Strict Rule)** 적용 (예: 하나라도 할로겐이면 -> 전체 할로겐 폐기).

## 5. Constraints (Non-functional)
* **Accuracy:** CAS No. 인식률을 높이기 위한 후처리 로직 필수.
* **Disclaimer:** 모든 결과 화면 하단에 "최종 폐기 전 랩실 안전관리자의 지침을 우선 확인하세요" 문구 필수 표기.
* **Mobile UX:** 한 손으로 조작 가능한 버튼 크기 및 배치 (Bottom Sheet 활용).
