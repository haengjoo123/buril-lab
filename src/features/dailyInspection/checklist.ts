/**
 * Daily lab safety inspection checklist (연구실 일상점검).
 *
 * The sections and items follow the daily inspection form of the Korean
 * "연구실 안전점검 및 정밀안전진단에 관한 지침". The wording here was written
 * from that form's structure and must be compared with the notice currently
 * in force before the feature is enabled; bump CHECKLIST_VERSION whenever an
 * item is added, removed or changes meaning, because saved results are keyed
 * by item id and read back against the version they were recorded with.
 */
export const CHECKLIST_VERSION = 'kr-daily-v1';

export type InspectionSectionId = 'general' | 'machine' | 'electric' | 'chemical' | 'fire' | 'gas' | 'bio';

export interface InspectionItem {
    id: string;
    ko: string;
    en: string;
}

export interface InspectionSection {
    id: InspectionSectionId;
    ko: string;
    en: string;
    items: InspectionItem[];
}

export const INSPECTION_SECTIONS: readonly InspectionSection[] = [
    {
        id: 'general', ko: '일반안전', en: 'General safety',
        items: [
            { id: 'general_tidy', ko: '연구실 정리정돈 및 청결 상태', en: 'The lab is tidy and clean' },
            { id: 'general_no_food', ko: '연구실 내 흡연 및 음식물 섭취 여부', en: 'No smoking, eating or drinking in the lab' },
            { id: 'general_equipment', ko: '안전수칙·안전표지·개인보호구·구급약품 및 실험장비(흄후드 등) 관리 상태', en: 'Safety rules, signs, PPE, first-aid supplies and equipment such as fume hoods are in order' },
            { id: 'general_hazard_analysis', ko: '사전유해인자위험분석 보고서 게시', en: 'The prior hazard analysis report is posted' },
        ],
    },
    {
        id: 'machine', ko: '기계기구', en: 'Machinery',
        items: [
            { id: 'machine_fastening', ko: '기계 및 공구의 조임부·연결부 이상 여부', en: 'Fasteners and joints of machines and tools are sound' },
            { id: 'machine_guards', ko: '위험설비 부위의 방호장치(보호 덮개) 설치 상태', en: 'Guards are fitted on hazardous parts' },
            { id: 'machine_zone', ko: '기계기구 회전·작동반경 위험지역 출입금지 방호설비 설치 상태', en: 'Rotation and operating zones are barred' },
        ],
    },
    {
        id: 'electric', ko: '전기안전', en: 'Electrical safety',
        items: [
            { id: 'electric_power', ko: '사용하지 않는 전기기구의 전원 차단 및 문어발식 콘센트 사용 여부', en: 'Unused devices are off and outlets are not overloaded' },
            { id: 'electric_wiring', ko: '접지형 콘센트 사용, 전기배선 절연피복 손상 및 배선 정리 상태', en: 'Grounded outlets are used; wiring insulation is intact and cables are tidy' },
            { id: 'electric_grounding', ko: '기기 외함접지 또는 정전기 장애 방지를 위한 접지 실시 상태', en: 'Equipment enclosures are grounded' },
            { id: 'electric_panel', ko: '전기 분전반 주변 이물질 적재 금지 상태', en: 'Nothing is stored around the distribution panel' },
        ],
    },
    {
        id: 'chemical', ko: '화공안전', en: 'Chemical safety',
        items: [
            { id: 'chemical_msds', ko: '유해인자 취급 및 관리대장, MSDS 비치', en: 'The hazardous agent register and SDSs are available' },
            { id: 'chemical_storage', ko: '화학물질의 성상별 분류 및 시약장 등 안전한 장소 보관 여부', en: 'Chemicals are segregated by property and kept in cabinets' },
            { id: 'chemical_labels', ko: '소분 용기 및 화학물질 보관함·보관용기의 경고표시 부착 여부', en: 'Secondary containers and storage carry hazard labels' },
            { id: 'chemical_waste', ko: '실험폐액 및 폐기물 관리 상태(폐액 분류표시, 적정 용기 사용, 폐액용기 덮개 체결 등)', en: 'Waste is labelled by stream, in suitable containers, with lids closed' },
            { id: 'chemical_toxic', ko: '발암물질·독성물질 등 유해화학물질의 격리 보관 및 잠금장치 사용 여부', en: 'Carcinogens and toxic chemicals are isolated and locked' },
        ],
    },
    {
        id: 'fire', ko: '소방안전', en: 'Fire safety',
        items: [
            { id: 'fire_extinguisher', ko: '소화기 표지, 적정 소화기 비치 및 정기 점검 상태', en: 'Suitable extinguishers are signed, in place and inspected' },
            { id: 'fire_exit', ko: '비상구·피난통로 확보 및 통로상 장애물 적재 여부', en: 'Exits and escape routes are clear' },
            { id: 'fire_hydrant', ko: '소화전·소화기 주변 이물질 적재 금지 상태', en: 'Nothing is stored around hydrants and extinguishers' },
        ],
    },
    {
        id: 'gas', ko: '가스안전', en: 'Gas safety',
        items: [
            { id: 'gas_storage', ko: '가스용기의 지정장소 보관, 전도방지 및 환기 상태', en: 'Cylinders are in the designated place, secured and ventilated' },
            { id: 'gas_cylinder', ko: '가스용기 외관의 부식·변형, 밸브 잠금 상태 및 충전기한 초과 여부', en: 'Cylinders are free of corrosion, valves closed and within their test date' },
            { id: 'gas_detector', ko: '가스누설검지경보장치, 역류·역화 방지장치, 중화제독장치 설치 및 작동 상태', en: 'Leak detectors, backflow and flashback arrestors and scrubbers work' },
            { id: 'gas_marking', ko: '배관 표시, 가스사용시설 경계·경고표시, 조정기 및 밸브 작동 상태', en: 'Piping is marked, warning signs are posted, regulators and valves work' },
            { id: 'gas_distance', ko: '주변 화기와의 이격거리 유지 등 취급 상태', en: 'Clearance from ignition sources is kept' },
        ],
    },
    {
        id: 'bio', ko: '생물안전', en: 'Biosafety',
        items: [
            { id: 'bio_storage', ko: '생물체(LMO 포함)·조직·세포·혈액 등의 보관 관리 상태(용기, 보관 기록, 생물재해 표시 등)', en: 'Organisms (incl. LMOs), tissue, cells and blood are stored, recorded and marked' },
            { id: 'bio_sterilize', ko: '손 소독기 등 세척시설 및 고압멸균기 등 살균장비 관리 상태', en: 'Hand-wash facilities and sterilizers such as autoclaves are maintained' },
            { id: 'bio_records', ko: '생물체(LMO 포함) 취급 연구시설의 관리·운영대장 기록 작성 여부', en: 'Facility management and operation records are kept' },
            { id: 'bio_waste', ko: '생물체 취급기구(주사기, 핀셋 등) 및 의료폐기물의 별도 폐기, 폐기용기 덮개 설치 상태', en: 'Sharps and medical waste are disposed of separately in lidded containers' },
        ],
    },
];

export const INSPECTION_ITEM_IDS: readonly string[] = INSPECTION_SECTIONS.flatMap((section) => section.items.map((item) => item.id));
