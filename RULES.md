## Coding Rules & Guidelines

### 1. General Principles
* **Safety First:** 화학 안전과 관련된 앱이므로, 데이터가 불확실할 경우 추측하지 말고 사용자에게 "확인 필요" 상태를 반환한다.
* **Mobile First:** 모든 UI는 모바일 뷰포트(375px ~)를 기준으로 설계하며, 데스크탑에서는 중앙 정렬된 모바일 뷰로 보여준다.
* **Separation of Concerns:** 화학 정보를 처리하는 로직(Domain Logic)과 UI 렌더링을 철저히 분리한다.

### 2. File Structure
* `/src/components`: UI 컴포넌트 (`Scanner.tsx`, `ResultCard.tsx`, `WasteBinIcon.tsx`)
* `/src/services`: 외부 API 호출 및 데이터 가공 (`pubchemApi.ts`, `ocrService.ts`)
* `/src/utils`: 순수 화학 로직 (`chemicalAnalyzer.ts` - 분자식 파싱 및 폐기 등급 판별 함수)
* `/src/store`: 전역 상태 (`useWasteStore.ts`)

### 3. Naming Conventions
* **Chemical Data:** 화학 관련 변수는 과학적 명칭을 준수 (e.g., `molecularFormula`, `casNumber`, `isHalogenated`).
* **Handlers:** `handleScan`, `handleSearchSubmit` 등 명확한 동사 사용.
* **Components:** PascalCase (e.g., `ChemicalInfoCard`).

### 4. Logic & Error Handling
* **Regex Validation:** CAS No. 형식(`^\d{2,7}-\d{2}-\d$`) 검증 로직을 유틸리티로 분리하여 재사용한다.
* **API Fallback:** PubChem API 응답이 없거나 느릴 경우, UI가 멈추지 않고 로딩 상태(Skeleton UI)를 보여주어야 한다.
* **Try-Catch:** 외부 API 호출부는 반드시 `try-catch`로 감싸고, 에러 발생 시 사용자에게 친절한 메시지("데이터를 불러올 수 없습니다")를 띄운다.

### 5. Styling (Tailwind CSS)
* **Waste Colors:** 폐액통 색상을 Tailwind config나 상수로 관리하여 일관성 유지.
    * Acid: `bg-red-500`
    * Alkali: `bg-blue-500`
    * Organic(Non-Halogen): `bg-yellow-500`
    * Organic(Halogen): `bg-orange-600`
* **Dark Mode:** 실험실 환경(어두운 곳)을 고려해 다크 모드를 기본 지원한다.
