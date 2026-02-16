import { describe, it, expect } from 'vitest';
import { analyzeMixture } from '../utils/mixtureLogic';
import type { AnalysisResult, Chemical } from '../types';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
const makeChemical = (overrides: Partial<Chemical> = {}): Chemical => ({
    id: 'test-id',
    name: 'Test Chemical',
    casNumber: '0000-00-0',
    molecularFormula: '',
    ...overrides,
});

const makeResult = (overrides: Partial<AnalysisResult> = {}): AnalysisResult => ({
    chemical: makeChemical(),
    category: 'UNKNOWN',
    binColor: 'bg-gray-400',
    label: 'mix_label_unknown',
    reason: 'reason_unknown',
    isSafe: false,
    ...overrides,
});

const makeOrganic = (name = 'Acetone'): AnalysisResult => makeResult({
    chemical: makeChemical({
        name,
        molecularFormula: 'C3H6O',
        properties: { isOrganic: true, isHalogenated: false },
        physicalProperties: { solubility: 'miscible' },
    }),
    category: 'ORGANIC_NON_HALOGEN',
    binColor: 'bg-yellow-500',
    label: 'label_organic',
    reason: 'reason_organic_non_halogen',
    isSafe: true,
});

const makeHalogenOrganic = (name = 'Chloroform'): AnalysisResult => makeResult({
    chemical: makeChemical({
        name,
        molecularFormula: 'CHCl3',
        properties: { isOrganic: true, isHalogenated: true },
    }),
    category: 'ORGANIC_HALOGEN',
    binColor: 'bg-orange-600',
    label: 'label_organic',
    reason: 'reason_organic_halogen',
    isSafe: true,
});

const makeAcid = (name = 'Hydrochloric Acid'): AnalysisResult => makeResult({
    chemical: makeChemical({
        name,
        molecularFormula: 'HCl',
        properties: { isOrganic: false, isHalogenated: false, ph: 1 },
    }),
    category: 'ACID',
    binColor: 'bg-red-500',
    label: 'label_acid',
    reason: 'reason_acid_ph',
    isSafe: true,
});

const makeAlkali = (name = 'Sodium Hydroxide'): AnalysisResult => makeResult({
    chemical: makeChemical({
        name,
        molecularFormula: 'NaOH',
        properties: { isOrganic: false, isHalogenated: false, ph: 13 },
    }),
    category: 'ALKALI',
    binColor: 'bg-blue-500',
    label: 'label_alkali',
    reason: 'reason_alkali_ph',
    isSafe: true,
});

// ══════════════════════════════════════════════
// 빈 카트
// ══════════════════════════════════════════════
describe('analyzeMixture - 빈 카트', () => {
    it('빈 배열 → UNKNOWN + isSafe=true', () => {
        const result = analyzeMixture([]);
        expect(result.category).toBe('UNKNOWN');
        expect(result.isSafe).toBe(true);
        expect(result.reason).toBe('cart_empty');
    });
});

// ══════════════════════════════════════════════
// 단일 카테고리
// ══════════════════════════════════════════════
describe('analyzeMixture - 단일 카테고리', () => {
    it('할로겐 유기물만 → ORGANIC_HALOGEN', () => {
        const result = analyzeMixture([makeHalogenOrganic()]);
        expect(result.category).toBe('ORGANIC_HALOGEN');
        expect(result.isSafe).toBe(true);
    });

    it('비할로겐 유기물만 → ORGANIC_NON_HALOGEN', () => {
        const result = analyzeMixture([makeOrganic()]);
        expect(result.category).toBe('ORGANIC_NON_HALOGEN');
        expect(result.isSafe).toBe(true);
    });

    it('산성만 → ACID', () => {
        const result = analyzeMixture([makeAcid()]);
        expect(result.category).toBe('ACID');
        expect(result.isSafe).toBe(true);
    });

    it('알칼리만 → ALKALI', () => {
        const result = analyzeMixture([makeAlkali()]);
        expect(result.category).toBe('ALKALI');
        expect(result.isSafe).toBe(true);
    });
});

// ══════════════════════════════════════════════
// 할로겐 우선 분류
// ══════════════════════════════════════════════
describe('analyzeMixture - 할로겐 우선', () => {
    it('할로겐 + 비할로겐 유기물 → ORGANIC_HALOGEN (할로겐 우선)', () => {
        const result = analyzeMixture([makeHalogenOrganic(), makeOrganic()]);
        expect(result.category).toBe('ORGANIC_HALOGEN');
    });

    it('할로겐 + 산성 → ORGANIC_HALOGEN (할로겐 우선)', () => {
        const result = analyzeMixture([makeHalogenOrganic(), makeAcid()]);
        expect(result.category).toBe('ORGANIC_HALOGEN');
    });
});

// ══════════════════════════════════════════════
// 위험 조합
// ══════════════════════════════════════════════
describe('analyzeMixture - 위험 조합', () => {
    it('산 + 알칼리 → UNKNOWN + isSafe=false (중화 경고)', () => {
        const result = analyzeMixture([makeAcid(), makeAlkali()]);
        expect(result.category).toBe('UNKNOWN');
        expect(result.isSafe).toBe(false);
        expect(result.reason).toBe('mix_warn_acid_alkali');
    });

    it('유기물 + 산 → UNKNOWN + isSafe=false (유기+무기 혼합 경고)', () => {
        const result = analyzeMixture([makeOrganic(), makeAcid()]);
        expect(result.category).toBe('UNKNOWN');
        expect(result.isSafe).toBe(false);
        expect(result.reason).toBe('mix_warn_organic_inorganic');
    });
});

// ══════════════════════════════════════════════
// 알칼리 + 유기물 혼합 (특수 케이스)
// ══════════════════════════════════════════════
describe('analyzeMixture - 알칼리 + 유기물', () => {
    it('알칼리 + 수용성 유기물 → disposalDetails 반환', () => {
        const result = analyzeMixture([makeAlkali(), makeOrganic()]);
        expect(result.label).toBe('mix_label_alkali_organic');
        expect(result.disposalDetails).toBeDefined();
        expect(result.disposalDetails?.solubility).toBe('SOLUBLE');
    });

    it('알칼리 + 비수용성 유기물 → INSOLUBLE + PROHIBITED', () => {
        const insoluble = makeOrganic('Toluene');
        insoluble.chemical.name = 'Toluene';
        insoluble.chemical.physicalProperties = { solubility: 'insoluble' };

        const result = analyzeMixture([makeAlkali(), insoluble]);
        expect(result.disposalDetails).toBeDefined();
        expect(result.disposalDetails?.solubility).toBe('INSOLUBLE');
        expect(result.disposalDetails?.neutralization).toBe('PROHIBITED');
    });
});

// ══════════════════════════════════════════════
// 동일 카테고리 복수 아이템
// ══════════════════════════════════════════════
describe('analyzeMixture - 동일 카테고리 복수', () => {
    it('산성 2개 → ACID', () => {
        const result = analyzeMixture([
            makeAcid('HCl'),
            makeAcid('HNO3'),
        ]);
        expect(result.category).toBe('ACID');
        expect(result.isSafe).toBe(true);
    });

    it('유기물 2개 → ORGANIC_NON_HALOGEN', () => {
        const result = analyzeMixture([
            makeOrganic('Acetone'),
            makeOrganic('Ethanol'),
        ]);
        expect(result.category).toBe('ORGANIC_NON_HALOGEN');
        expect(result.isSafe).toBe(true);
    });
});
