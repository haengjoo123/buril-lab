export type Language = 'ko' | 'en';

export const translations = {
    ko: {
        app_title: "Buril-rab",
        app_subtitle_1: "실험실 폐시약,",
        app_subtitle_2: "안전하게",
        app_subtitle_3: "처리하세요.",
        app_desc: "사진을 찍거나 시약명을 검색하여 올바른 폐기 방법을 확인하세요.",

        search_placeholder: "시약명 (예: Acetone) 또는 CAS No.",
        search_not_found: "에 대한 결과를 찾을 수 없습니다.",
        search_error: "데이터를 불러오는 중 오류가 발생했습니다.",

        btn_scan: "카메라로 스캔하기",
        btn_settings: "설정",
        btn_reset: "취소 / 재검색",
        btn_add_to_list: "리스트 담기",
        btn_clear_all: "전체 비우기",
        btn_close: "닫기",
        btn_confirm: "확인",
        btn_cancel: "취소",

        input_volume: "용액 부피 (mL)",
        input_molarity: "몰농도 (M) (선택)",
        msg_input_required: "부피를 입력해주세요.",

        guide_example: "최근 검색 기록,",
        recent_clear: "지우기",

        // Result Card
        label_acid: "산성",
        label_organic: "유기계",
        label_alkali: "알칼리",
        label_neutral: "중성",
        safety_ghs: "물질안전보건정보 (GHS)",
        safety_uncertain: "자동 분류가 불확실합니다. 반드시 MSDS를 확인하세요.",

        // Cart
        cart_title: "혼합 폐액 리스트",
        cart_empty: "담긴 시약이 없습니다.",
        cart_guide_title: "통합 폐기 가이드",
        cart_safety_check: "안전을 위해 혼합 전 반드시 MSDS를 재확인하세요.",
        cart_confirm_clear: "리스트를 초기화하시겠습니까?",

        // Settings
        settings_title: "설정",
        settings_reset_data: "앱 초기화",
        settings_reset_desc: "저장된 장바구니, 검색 기록, 동의 내역을 모두 삭제합니다.",
        settings_view_guide: "안전 가이드 다시보기",
        settings_language: "언어 설정 (Language)",

        // Scanner
        scanner_guide: "라벨의 제품명 또는 CAS 번호가 잘 보이도록 맞춰주세요.",
        scanner_analyzing: "분석 중...",
        scanner_error_cas: "식별 가능한 텍스트나 CAS 번호를 찾지 못했습니다. 다시 시도하거나 직접 검색해주세요.",
        scanner_error_cam: "이미지 처리 중 오류가 발생했습니다.",
        scanner_capture_guide: "촬영 버튼을 눌러 스캔",

        // Disclaimer
        disclaimer_title: "안전 면책 동의",
        disclaimer_confirm: "위 내용을 모두 확인하였으며, 안전 책임에 동의합니다.",

        // Logic Reasons
        reason_organic_halogen: "분자식에 탄소(C)와 할로겐족 원소(F, Cl, Br, I)가 포함되어 있습니다.",
        reason_organic_non_halogen: "분자식에 탄소(C)가 포함되어 있고, 할로겐족 원소가 없습니다.",
        reason_acid_ph: "pH가 {{ph}}로 산성입니다.",
        reason_alkali_ph: "pH가 {{ph}}로 알칼리성입니다.",
        reason_neutral_ph: "pH가 {{ph}}로 중성입니다. (배출 허용 기준 확인 필요)",
        reason_acid_keyword: "시약명에 산(Acid) 관련 키워드가 포함되어 있습니다.",
        reason_alkali_keyword: "시약명에 알칼리성 키워드(Hydroxide 등)가 포함되어 있습니다.",
        reason_unknown: "자동 분류할 수 없습니다. 안전관리자에게 문의하세요.",

        // Mixture Reasons
        mix_reason_halogen: "할로겐족 유기 용매가 포함되어 있어, 전체를 '할로겐족 유기 폐액'으로 분류해야 합니다.",
        mix_reason_organic: "모든 시약이 비할로겐족 유기 용매입니다.",
        mix_reason_acid: "무기산 계열의 혼합물입니다.",
        mix_reason_alkali: "알칼리성 계열의 혼합물입니다.",
        mix_unknown: "혼합물의 특성을 확정할 수 없습니다. 안전관리자에게 문의하세요.",

        // Mixture Warnings
        mix_warn_organic_inorganic: "유기용매와 무기산/알칼리를 혼합하면 폭발이나 발열 위험이 있습니다. 별도 폐기하거나 안전관리자에게 문의하세요.",
        mix_warn_acid_alkali: "산과 알칼리를 섞으면 중화열이 발생하여 끓어오를 수 있습니다. 희석 후 중화하거나 각각 별도로 폐기하세요.",

        mix_label_halogen: "할로겐족 유기 폐액 (혼합)",
        mix_label_organic: "비할로겐족 유기 폐액 (혼합)",
        mix_label_acid: "산성 폐액 (혼합)",
        mix_label_alkali: "알칼리 폐액 (혼합)",
        mix_label_warn_oi: "혼합 주의 (유기 + 무기)",
        mix_label_warn_aa: "발열 주의 (산 + 알칼리)",
        mix_label_unknown: "분류 불가 (혼합)",
        mix_label_alkali_organic: "알칼리 + 유기계 혼합 폐액",

        // Disposal Details
        detail_solubility: "유기상 용해도",
        detail_neutralization: "중화 가능 여부",

        // Disposal Methods (Cases)
        disposal_method_case1: "수용성 + 중화 가능: 희석 후 중화(pH 6-8)하여 산/알칼리 수계 폐액으로 배출하세요.",
        disposal_method_case2: "수용성 + 중화 불가: 중화하지 마세요. '반응성 유기 혼합 폐액'으로 별도 위탁 처리하세요.",
        disposal_method_case3: "불용성: 중화 금지. 층 분리된 상태 그대로 '유기 혼합 폐액'으로 밀폐하여 위탁 처리하세요.",

        // Media Products
        media_product_label: "배지/시약 제품",
        view_product: "제품 보기",
        search_results_chemical: "화학물질 검색 결과",
        search_results_product: "배지/시약 제품 검색 결과",

        // Filters
        filter_options: "필터 옵션",
        clear_filters: "초기화",
        brand: "브랜드",
        all_brands: "전체 브랜드",
        sort_by: "정렬",
        sort_relevance: "관련도순",
        sort_name_asc: "이름 (오름차순)",
        sort_name_desc: "이름 (내림차순)",
        sort_brand_asc: "브랜드 (오름차순)",
        sort_brand_desc: "브랜드 (내림차순)"
    },
    en: {
        app_title: "Buril-rab",
        app_subtitle_1: "Lab Waste,",
        app_subtitle_2: "Dispose Safely",
        app_subtitle_3: ".",
        app_desc: "Scan or search chemicals to find the correct disposal method.",

        search_placeholder: "Chemical Name (e.g. Acetone) or CAS No.",
        search_not_found: "No results found for",
        search_error: "Error fetching data.",

        btn_scan: "Scan with Camera",
        btn_settings: "Settings",
        btn_reset: "Reset",
        btn_add_to_list: "Add to List",
        btn_clear_all: "Clear All",
        btn_close: "Close",
        btn_confirm: "Confirm",
        btn_cancel: "Cancel",

        input_volume: "Volume (mL)",
        input_molarity: "Molarity (M) (Optional)",
        msg_input_required: "Please enter volume.",

        guide_example: "Recent History,",
        recent_clear: "Clear",

        // Result Card
        label_acid: "Acid",
        label_organic: "Organic",
        label_alkali: "Alkali",
        safety_ghs: "Safety Data (GHS)",
        safety_uncertain: "Classification uncertain. Check MSDS.",

        // Cart
        cart_title: "Mixture List",
        cart_empty: "No items in list.",
        cart_guide_title: "Disposal Guide",
        cart_safety_check: "Check MSDS before mixing for safety.",
        cart_confirm_clear: "Clear the entire list?",

        // Settings
        settings_title: "Settings",
        settings_reset_data: "Reset App Data",
        settings_reset_desc: "Clears cart, history, and consents.",
        settings_view_guide: "View Safety Guide",
        settings_language: "Language",

        // Scanner
        scanner_guide: "Align the Product Name or CAS No. within the frame.",
        scanner_analyzing: "Analyzing...",
        scanner_error_cas: "No identifiable text or CAS No. found. Please retry or search manually.",
        scanner_error_cam: "Error processing image.",
        scanner_capture_guide: "Tap button to scan",

        // Disclaimer
        disclaimer_title: "Safety Disclaimer",
        disclaimer_confirm: "I have read and agree to the safety responsibilities.",

        // Logic Reasons
        reason_organic_halogen: "Contains Carbon (C) and Halogens (F, Cl, Br, I).",
        reason_organic_non_halogen: "Contains Carbon (C) but no Halogens.",
        reason_acid_ph: "Acidic with pH {{ph}}.",
        reason_alkali_ph: "Alkaline with pH {{ph}}.",
        reason_neutral_ph: "Neutral with pH {{ph}}. (Check discharge limits)",
        reason_acid_keyword: "Chemical name contains Acid-related keywords.",
        reason_alkali_keyword: "Chemical name contains Alkali-related keywords.",
        reason_unknown: "Cannot classify automatically. Consult safety officer.",

        // Mixture Reasons
        mix_reason_halogen: "Contains Halogenated Organic Solvents. Must be treated as Halogenated Waste.",
        mix_reason_organic: "All items are Non-Halogenated Organic Solvents.",
        mix_reason_acid: "Mixture of Inorganic Acids.",
        mix_reason_alkali: "Mixture of Alkaline solutions.",
        mix_unknown: "Cannot determine mixture properties. Consult safety officer.",

        // Mixture Warnings
        mix_warn_organic_inorganic: "Mixing Organic and Inorganic chemicals may cause explosion or heat. Dispose separately.",
        mix_warn_acid_alkali: "Mixing Acid and Alkali generates heat. Neutralize or dispose separately.",

        mix_label_halogen: "Halogenated Organic (Mixed)",
        mix_label_organic: "Non-Halogenated Organic (Mixed)",
        mix_label_acid: "Acid Waste (Mixed)",
        mix_label_alkali: "Alkali Waste (Mixed)",
        mix_label_warn_oi: "Warning (Organic + Inorganic)",
        mix_label_warn_aa: "Warning (Acid + Alkali)",
        mix_label_unknown: "Unknown (Mixed)",
        mix_label_alkali_organic: "Alkali + Organic Mixture",

        // Disposal Details
        detail_solubility: "Organic Solubility",
        detail_neutralization: "Neutralization",

        // Disposal Methods (Cases)
        disposal_method_case1: "Soluble + Neutralizable: Dilute & Neutralize (pH 6-8), then dispose as Aqueous Waste.",
        disposal_method_case2: "Soluble + Prohibited: DO NOT Neutralize. Dispose as 'Reactive Organic Waste'.",
        disposal_method_case3: "Insoluble: DO NOT Neutralize. Seal and label as 'Mixed Organic Waste'.",

        // Media Products
        media_product_label: "Media/Reagent Product",
        view_product: "View Product",
        search_results_chemical: "Chemical Results",
        search_results_product: "Media/Reagent Products",

        // Filters
        filter_options: "Filter Options",
        clear_filters: "Clear",
        brand: "Brand",
        all_brands: "All Brands",
        sort_by: "Sort",
        sort_relevance: "Relevance",
        sort_name_asc: "Name (A-Z)",
        sort_name_desc: "Name (Z-A)",
        sort_brand_asc: "Brand (A-Z)",
        sort_brand_desc: "Brand (Z-A)"
    }
};
