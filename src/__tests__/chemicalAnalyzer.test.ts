import { describe, it, expect } from 'vitest';
import { parseFormula, analyzeChemical } from '../utils/chemicalAnalyzer';
import type { Chemical } from '../types';

// ──────────────────────────────────────────────
// Helper: Create a minimal Chemical object
// ──────────────────────────────────────────────
const makeChemical = (overrides: Partial<Chemical> = {}): Chemical => ({
    id: 'test-id',
    name: 'Test Chemical',
    casNumber: '0000-00-0',
    molecularFormula: '',
    ...overrides,
});

// ══════════════════════════════════════════════
// parseFormula
// ══════════════════════════════════════════════
describe('parseFormula', () => {
    it('기본 분자식을 올바르게 파싱한다 (H2O)', () => {
        expect(parseFormula('H2O')).toEqual({ H: 2, O: 1 });
    });

    it('복잡한 분자식을 파싱한다 (C6H12O6 - 포도당)', () => {
        expect(parseFormula('C6H12O6')).toEqual({ C: 6, H: 12, O: 6 });
    });

    it('할로겐 원소를 인식한다 (CHCl3 - 클로로포름)', () => {
        const result = parseFormula('CHCl3');
        expect(result).toEqual({ C: 1, H: 1, Cl: 3 });
    });

    it('2글자 원소 기호를 올바르게 파싱한다 (NaCl)', () => {
        expect(parseFormula('NaCl')).toEqual({ Na: 1, Cl: 1 });
    });

    it('빈 문자열은 빈 객체를 반환한다', () => {
        expect(parseFormula('')).toEqual({});
    });

    it('하나의 원소를 파싱한다 (Fe)', () => {
        expect(parseFormula('Fe')).toEqual({ Fe: 1 });
    });

    it('동일 원소가 여러 번 나타나면 합산한다', () => {
        // C2H5OH -> C:2+0 doesn't apply, but CH3COOH does
        // Actually parseFormula is simple regex, C2H5OH -> C:2, H:5, O:1, H:1
        // Wait - it should combine: H:5 + H:1 = H: ...
        // Actually the regex will parse: C2 H5 O H -> C:2, H:5, O:1, H:1
        // With the accumulator: H = 5 + 1 = 6
        expect(parseFormula('C2H5OH')).toEqual({ C: 2, H: 6, O: 1 });
    });
});

// ══════════════════════════════════════════════
// analyzeChemical - 유기물 분류
// ══════════════════════════════════════════════
describe('analyzeChemical - 유기물 분류', () => {
    it('탄소(C) 포함 → 유기물로 분류', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Ethanol',
            molecularFormula: 'C2H6O',
        }));
        expect(result.chemical.properties?.isOrganic).toBe(true);
    });

    it('탄소(C) 미포함 → 무기물로 분류', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Water',
            molecularFormula: 'H2O',
        }));
        expect(result.chemical.properties?.isOrganic).toBe(false);
    });
});

// ══════════════════════════════════════════════
// analyzeChemical - 할로겐 유기폐액
// ══════════════════════════════════════════════
describe('analyzeChemical - 할로겐 분류', () => {
    it('할로겐(Cl) 포함 유기물 → ORGANIC_HALOGEN', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Chloroform',
            molecularFormula: 'CHCl3',
        }));
        expect(result.category).toBe('ORGANIC_HALOGEN');
        expect(result.reason).toBe('reason_organic_halogen');
    });

    it('할로겐(Br) 포함 유기물 → ORGANIC_HALOGEN', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Bromoethane',
            molecularFormula: 'C2H5Br',
        }));
        expect(result.category).toBe('ORGANIC_HALOGEN');
    });

    it('할로겐 미포함 유기물 → ORGANIC_NON_HALOGEN', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Acetone',
            molecularFormula: 'C3H6O',
        }));
        expect(result.category).toBe('ORGANIC_NON_HALOGEN');
        expect(result.reason).toBe('reason_organic_non_halogen');
    });
});

// ══════════════════════════════════════════════
// analyzeChemical - pH 기반 산/알칼리 분류
// ══════════════════════════════════════════════
describe('analyzeChemical - pH 기반 분류', () => {
    it('pH < 7 → ACID', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Test Acid',
            molecularFormula: 'H2SO4', // 탄소 없음 → 무기물
            properties: { isOrganic: false, isHalogenated: false, ph: 2 },
        }));
        // H2SO4에 C는 없지만 S가 있음. 파싱상 C 없으므로 무기물 판정
        // Actually H2SO4 -> H:2, S:1, O:4 -> no Carbon -> inorganic
        expect(result.category).toBe('ACID');
        expect(result.reason).toBe('reason_acid_ph');
        expect(result.reasonParams?.ph).toBe(2);
    });

    it('pH > 7 → ALKALI', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Sodium Hydroxide',
            molecularFormula: 'NaOH',
            properties: { isOrganic: false, isHalogenated: false, ph: 13 },
        }));
        expect(result.category).toBe('ALKALI');
        expect(result.reason).toBe('reason_alkali_ph');
    });

    it('pH === 7 → NEUTRAL', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Pure Water',
            molecularFormula: 'H2O',
            properties: { isOrganic: false, isHalogenated: false, ph: 7 },
        }));
        expect(result.category).toBe('NEUTRAL');
        expect(result.reason).toBe('reason_neutral_ph');
    });
});

// ══════════════════════════════════════════════
// analyzeChemical - 이름 기반 키워드 분류
// ══════════════════════════════════════════════
describe('analyzeChemical - 키워드 기반 분류', () => {
    it('이름에 "ACID" 포함 → ACID', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Hydrochloric Acid',
            molecularFormula: 'HCl',
        }));
        expect(result.category).toBe('ACID');
        expect(result.reason).toBe('reason_acid_keyword');
    });

    it('이름에 "HYDROXIDE" 포함 → ALKALI', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Sodium Hydroxide',
            molecularFormula: 'NaOH',
        }));
        expect(result.category).toBe('ALKALI');
        expect(result.reason).toBe('reason_alkali_keyword');
    });

    it('이름에 "SULFURIC" 포함 → ACID', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Sulfuric acid solution',
            molecularFormula: 'H2SO4',
        }));
        expect(result.category).toBe('ACID');
    });

    it('이름에 "AMMONIA" 포함 → ALKALI', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Ammonia solution',
            molecularFormula: 'NH3',
        }));
        expect(result.category).toBe('ALKALI');
    });
});

// ══════════════════════════════════════════════
// analyzeChemical - 결과 구조 검증
// ══════════════════════════════════════════════
describe('analyzeChemical - 결과 구조', () => {
    it('분류 가능한 경우 isSafe=true', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Ethanol',
            molecularFormula: 'C2H6O',
        }));
        expect(result.isSafe).toBe(true);
    });

    it('분류 불가한 경우 isSafe=false, category=UNKNOWN', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Unknown Substance',
            molecularFormula: 'H2O', // 무기물이지만 키워드 없고 pH 없음
        }));
        expect(result.isSafe).toBe(false);
        expect(result.category).toBe('UNKNOWN');
        expect(result.reason).toBe('reason_unknown');
    });

    it('binColor 값이 존재한다', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Acetone',
            molecularFormula: 'C3H6O',
        }));
        expect(result.binColor).toBeTruthy();
        expect(result.binColor.startsWith('bg-')).toBe(true);
    });

    it('label 값이 존재한다', () => {
        const result = analyzeChemical(makeChemical({
            name: 'Acetone',
            molecularFormula: 'C3H6O',
        }));
        expect(result.label).toBeTruthy();
    });
});
