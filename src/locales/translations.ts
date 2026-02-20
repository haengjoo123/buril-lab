export type Language = 'ko' | 'en';

export const translations = {
    ko: {
        app_title: "Buril-lab",
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

        guide_example: "최근 검색 기록",
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
        sort_brand_desc: "브랜드 (내림차순)",

        // PWA
        pwa_offline_ready: "오프라인에서 사용할 수 있습니다.",
        pwa_new_content: "새 버전이 있습니다. 새로고침하세요.",
        pwa_reload: "새로고침",
        pwa_close: "닫기",

        // Compatibility Warnings
        compat_title: "호환성 경고",
        compat_danger: "위험",
        compat_warning: "주의",
        compat_oxidizer_flammable: "산화제와 인화성 물질을 혼합하면 화재/폭발 위험이 있습니다.",
        compat_oxidizer_organic: "산화제와 유기물을 혼합하면 발화 위험이 있습니다.",
        compat_water_reactive: "물 반응성 물질이 수용액과 접촉하면 유독 가스가 발생할 수 있습니다.",
        compat_pyrophoric: "자연발화성 물질이 포함되어 있습니다. 특별 취급이 필요합니다.",
        compat_self_reactive: "자기반응성/폭발성 물질이 포함되어 있습니다. 혼합을 피하세요.",
        compat_acid_organic: "부식성 산과 유기물을 혼합하면 발열 반응 위험이 있습니다.",
        compat_explosive: "폭발성 물질이 포함되어 있습니다. 분리 보관이 필요합니다.",
        compat_acid_cyanide: "산과 시안화물을 혼합하면 치명적인 시안화수소(HCN) 가스가 발생합니다.",
        compat_acid_sulfide: "산과 황화물을 혼합하면 유독성 황화수소(H₂S) 가스가 발생합니다.",
        compat_acid_metal: "산과 반응성 금속을 혼합하면 인화성 수소(H₂) 가스가 발생합니다.",
        compat_acid_base: "강산과 강염기를 혼합하면 갑작스러운 발열 반응이 일어날 수 있습니다.",

        // Waste Log
        btn_dispose_complete: "폐기 완료",
        dispose_confirm: "폐기를 기록하시겠습니까?",
        dispose_success: "폐기 기록이 저장되었습니다.",
        dispose_error: "기록 저장에 실패했습니다.",
        input_handler: "처리자 이름 (선택)",
        input_memo: "메모 (선택)",
        tab_search: "검색",
        tab_logs: "기록",
        log_title: "폐기 기록",
        log_empty: "아직 폐기 기록이 없습니다.",
        log_chemicals_count: "{{count}}종 시약",
        log_delete_confirm: "이 기록을 삭제하시겠습니까?",
        log_delete: "삭제",

        // Navigation
        tab_cabinet: "시약장",
        app_cabinet: "시약장 (Reagent Cabinet)",
        cabinet_width: "가로",
        cabinet_height: "세로",
        cabinet_depth: "폭",
        cabinet_ratio_lock: "비율 고정",
        cabinet_add_shelf: "선반 추가",
        cabinet_remove_shelf: "선반 제거",
        cabinet_add_vertical_panel: "세로 구분 추가",
        cabinet_remove_vertical_panel: "세로 구분 제거",
        cabinet_vertical_panel_hint: "세로 구분선은 모든 선반에 적용됩니다 (50% 기준).",
        cabinet_edit_panel_show: "편집 패널 보기",
        cabinet_reagent_tray_show: "시약 선택창 보기",
        cabinet_reagent_tray_hide: "시약 선택창 숨기기",
        cabinet_sort_name: "이름순 정렬",
        cabinet_sort_type: "종류순 정렬",

        // Cabinet Edit
        cabinet_edit_title: "시약 정보 수정",
        cabinet_reagent_name: "시약명",
        cabinet_notes: "메모",
        cabinet_save: "저장",
        cabinet_delete: "삭제",
        cabinet_delete_confirm: "이 시약을 정말 삭제하시겠습니까?",
        cabinet_placeholder_name: "예: 황산",
        cabinet_placeholder_notes: "유효기간, 취급 주의사항 등...",
        cabinet_label_type: "종류:",
        cabinet_label_location: "위치:",
        cabinet_shelf_level: "선반 {{level}}층",

        // Auth
        auth_login: "로그인",
        auth_signup: "회원가입",
        auth_email: "이메일",
        auth_password: "비밀번호",
        auth_password_confirm: "비밀번호 확인",
        auth_logout: "로그아웃",
        auth_subtitle: "실험실 폐기물 관리 시스템",
        auth_error_empty: "이메일과 비밀번호를 입력해주세요.",
        auth_error_password_mismatch: "비밀번호가 일치하지 않습니다.",
        auth_error_password_short: "비밀번호는 6자 이상이어야 합니다.",
        auth_error_generic: "인증 중 오류가 발생했습니다."
    },
    en: {
        app_title: "Buril-lab",
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
        sort_brand_desc: "Brand (Z-A)",

        // PWA
        pwa_offline_ready: "App ready to work offline.",
        pwa_new_content: "New version available. Click reload.",
        pwa_reload: "Reload",
        pwa_close: "Close",

        // Compatibility Warnings
        compat_title: "Compatibility Warnings",
        compat_danger: "DANGER",
        compat_warning: "WARNING",
        compat_oxidizer_flammable: "Mixing oxidizer with flammable material may cause fire/explosion.",
        compat_oxidizer_organic: "Mixing oxidizer with organic material may cause ignition.",
        compat_water_reactive: "Water-reactive substance may generate toxic gas on contact with aqueous solution.",
        compat_pyrophoric: "Contains pyrophoric material. Requires special handling.",
        compat_self_reactive: "Contains self-reactive/explosive material. Avoid mixing.",
        compat_acid_organic: "Mixing corrosive acid with organic material may cause exothermic reaction.",
        compat_explosive: "Contains explosive material. Isolation required.",
        compat_acid_cyanide: "Mixing acid with cyanide generates lethal hydrogen cyanide (HCN) gas.",
        compat_acid_sulfide: "Mixing acid with sulfide generates toxic hydrogen sulfide (H\u2082S) gas.",
        compat_acid_metal: "Mixing acid with reactive metal generates flammable hydrogen (H\u2082) gas.",
        compat_acid_base: "Mixing strong acid with strong base may cause sudden exothermic reaction.",

        // Waste Log
        btn_dispose_complete: "Dispose Complete",
        dispose_confirm: "Record this disposal?",
        dispose_success: "Disposal record saved.",
        dispose_error: "Failed to save record.",
        input_handler: "Handler Name (Optional)",
        input_memo: "Memo (Optional)",
        tab_search: "Search",
        tab_logs: "Records",
        log_title: "Disposal Records",
        log_empty: "No disposal records yet.",
        log_chemicals_count: "{{count}} chemicals",
        log_delete_confirm: "Delete this record?",
        log_delete: "Delete",

        // Navigation
        tab_cabinet: "Cabinet",
        app_cabinet: "Reagent Cabinet",
        cabinet_width: "Width",
        cabinet_height: "Height",
        cabinet_depth: "Depth",
        cabinet_ratio_lock: "Lock ratio",
        cabinet_add_shelf: "Add Shelf",
        cabinet_remove_shelf: "Remove Shelf",
        cabinet_add_vertical_panel: "Add Vertical Panel",
        cabinet_remove_vertical_panel: "Remove Vertical Panel",
        cabinet_vertical_panel_hint: "Vertical dividers apply to all shelves (50% default).",
        cabinet_edit_panel_show: "Show edit panel",
        cabinet_reagent_tray_show: "Show reagent tray",
        cabinet_reagent_tray_hide: "Hide reagent tray",
        cabinet_sort_name: "Sort by Name",
        cabinet_sort_type: "Sort by Type",

        // Cabinet Edit
        cabinet_edit_title: "Edit Reagent",
        cabinet_reagent_name: "Reagent Name",
        cabinet_notes: "Notes",
        cabinet_save: "Save Changes",
        cabinet_delete: "Delete",
        cabinet_delete_confirm: "Are you sure you want to delete this reagent?",
        cabinet_placeholder_name: "Ex: Sulfuric Acid",
        cabinet_placeholder_notes: "Expiration date, handling precautions...",
        cabinet_label_type: "Type:",
        cabinet_label_location: "Location:",
        cabinet_shelf_level: "Shelf {{level}}",

        // Auth
        auth_login: "Log In",
        auth_signup: "Sign Up",
        auth_email: "Email",
        auth_password: "Password",
        auth_password_confirm: "Confirm Password",
        auth_logout: "Log Out",
        auth_subtitle: "Lab Waste Management System",
        auth_error_empty: "Please enter email and password.",
        auth_error_password_mismatch: "Passwords do not match.",
        auth_error_password_short: "Password must be at least 6 characters.",
        auth_error_generic: "An error occurred during authentication."
    }
};
