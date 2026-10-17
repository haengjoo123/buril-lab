import type { WasteStreamCode } from '../types';

/** Display names shared by waste logs, containers and printed container labels. */
export const WASTE_STREAM_LABELS: Record<WasteStreamCode, { ko: string; en: string }> = {
    ACID_AQUEOUS: { ko: '산성 수계 폐액', en: 'Acidic aqueous waste' },
    ALKALI_AQUEOUS: { ko: '알칼리성 수계 폐액', en: 'Alkaline aqueous waste' },
    ORGANIC_HALOGENATED: { ko: '할로겐 유기 폐액', en: 'Halogenated organic waste' },
    ORGANIC_NON_HALOGENATED: { ko: '비할로겐 유기 폐액', en: 'Non-halogenated organic waste' },
    HEAVY_METAL: { ko: '중금속 함유 폐기물', en: 'Heavy-metal waste' },
    CYANIDE_SULFIDE: { ko: '시안·황화물 계열', en: 'Cyanide or sulfide waste' },
    REACTIVE_OXIDIZER: { ko: '반응성·산화성 폐기물', en: 'Reactive or oxidizing waste' },
    SOLID_CONTAMINATED: { ko: '오염 고체·슬러리', en: 'Contaminated solid or slurry' },
    AQUEOUS_OTHER: { ko: '기타 수계 폐액', en: 'Other aqueous waste' },
    SPECIAL_REVIEW: { ko: '분리 보관·특별 검토', en: 'Isolate and review' },
};

export const HAZARD_FLAG_LABELS: Record<string, { ko: string; en: string }> = {
    FLAMMABLE: { ko: '인화성', en: 'Flammable' },
    OXIDIZER: { ko: '산화성', en: 'Oxidizer' },
    EXPLOSIVE: { ko: '폭발성', en: 'Explosive' },
    SELF_REACTIVE: { ko: '자기반응성', en: 'Self-reactive' },
    WATER_REACTIVE: { ko: '수반응성', en: 'Water-reactive' },
    PYROPHORIC: { ko: '자연발화성', en: 'Pyrophoric' },
    CORROSIVE: { ko: '부식성', en: 'Corrosive' },
    ACUTE_TOXIC: { ko: '급성독성', en: 'Acute toxicity' },
    CMR: { ko: '발암성·생식독성', en: 'CMR hazard' },
    ENVIRONMENTAL_HAZARD: { ko: '환경유해성', en: 'Environmental hazard' },
    CYANIDE: { ko: '시안', en: 'Cyanide' },
    SULFIDE: { ko: '황화물', en: 'Sulfide' },
    HEAVY_METAL: { ko: '중금속', en: 'Heavy metal' },
    HYDROFLUORIC_ACID: { ko: '불산(HF)', en: 'Hydrofluoric acid (HF)' },
    FLUORIDE: { ko: '불화물', en: 'Fluoride' },
    REACTIVE: { ko: '반응성', en: 'Reactive' },
    UNKNOWN_COMPONENT: { ko: '미상 성분', en: 'Unknown component' },
};

export function wasteStreamLabel(code: string | null | undefined, language: string): string {
    if (!code) return '';
    const labels = WASTE_STREAM_LABELS[code as WasteStreamCode];
    return labels ? (language.startsWith('ko') ? labels.ko : labels.en) : code;
}

export function hazardFlagLabel(flag: string, language: string): string {
    const label = HAZARD_FLAG_LABELS[flag];
    return label ? (language.startsWith('ko') ? label.ko : label.en) : flag;
}

/** Dot color for a waste category or stream name, shared by waste logs and containers. */
export function getCategoryColor(category: string): string {
    const lower = category.toLowerCase();
    // "비할로겐"/"non-halogenated" also contain "할로겐"/"halogen", so check them first.
    if (lower.includes('비할로겐') || lower.includes('non-halogen') || lower.includes('non_halogen')) return 'bg-orange-500';
    if (lower.includes('할로겐') || lower.includes('halogen')) return 'bg-purple-500';
    if (lower.includes('유기') || lower.includes('organic')) return 'bg-orange-500';
    if (lower.includes('산') || lower.includes('acid')) return 'bg-red-500';
    if (lower.includes('알칼리') || lower.includes('alkali')) return 'bg-blue-500';
    if (lower.includes('주의') || lower.includes('warn')) return 'bg-yellow-500';
    return 'bg-gray-400';
}

export function wasteStreamDotClass(code: string): string {
    return getCategoryColor(wasteStreamLabel(code, 'ko'));
}
