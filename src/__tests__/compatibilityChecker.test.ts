import { describe, it, expect } from 'vitest';
import { checkCompatibility } from '../utils/compatibilityChecker';
import type { CartItem, Chemical } from '../types';

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

const makeCartItem = (overrides: Partial<CartItem> & { chemical: Chemical }): CartItem => ({
    category: 'UNKNOWN',
    binColor: 'bg-gray-400',
    label: 'unknown',
    reason: 'unknown',
    isSafe: false,
    ...overrides,
});

// ══════════════════════════════════════════════
// 기본 동작
// ══════════════════════════════════════════════
describe('checkCompatibility - 기본 동작', () => {
    it('카트에 1개 이하 아이템 → 빈 배열 반환', () => {
        const item = makeCartItem({
            chemical: makeChemical({ name: 'Water', molecularFormula: 'H2O' }),
        });
        expect(checkCompatibility([])).toEqual([]);
        expect(checkCompatibility([item])).toEqual([]);
    });

    it('호환 가능한 조합 → 빈 배열', () => {
        const ethanol = makeCartItem({
            chemical: makeChemical({
                name: 'Ethanol',
                molecularFormula: 'C2H6O',
                properties: { isOrganic: true, isHalogenated: false },
                ghs: { signal: 'Warning', hazardStatements: ['H225: Highly flammable liquid'] },
            }),
            category: 'ORGANIC_NON_HALOGEN',
        });
        const methanol = makeCartItem({
            chemical: makeChemical({
                name: 'Methanol',
                molecularFormula: 'CH4O',
                properties: { isOrganic: true, isHalogenated: false },
                ghs: { signal: 'Danger', hazardStatements: ['H225: Highly flammable liquid'] },
            }),
            category: 'ORGANIC_NON_HALOGEN',
        });
        expect(checkCompatibility([ethanol, methanol])).toEqual([]);
    });
});

// ══════════════════════════════════════════════
// Rule 1: 산화제 + 인화성 → DANGER
// ══════════════════════════════════════════════
describe('checkCompatibility - Rule 1: 산화제 + 인화성', () => {
    it('산화제(H271) + 인화성(H225) → DANGER', () => {
        const oxidizer = makeCartItem({
            chemical: makeChemical({
                name: 'Hydrogen Peroxide',
                ghs: { signal: 'Danger', hazardStatements: ['H271: May cause fire or explosion'] },
            }),
        });
        const flammable = makeCartItem({
            chemical: makeChemical({
                name: 'Acetone',
                properties: { isOrganic: true, isHalogenated: false },
                ghs: { signal: 'Warning', hazardStatements: ['H225: Highly flammable liquid'] },
            }),
        });

        const warnings = checkCompatibility([oxidizer, flammable]);
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        const rule1 = warnings.find(w => w.ruleId === 'oxidizer_flammable');
        expect(rule1).toBeDefined();
        expect(rule1!.severity).toBe('DANGER');
    });
});

// ══════════════════════════════════════════════
// Rule 3: 금수성 + 수용성 → DANGER
// ══════════════════════════════════════════════
describe('checkCompatibility - Rule 3: 금수성 + 수용성', () => {
    it('금수성(H260) + 수용성 → DANGER', () => {
        const waterReactive = makeCartItem({
            chemical: makeChemical({
                name: 'Sodium Metal',
                ghs: { signal: 'Danger', hazardStatements: ['H260: In contact with water releases flammable gases'] },
            }),
        });
        const aqueous = makeCartItem({
            chemical: makeChemical({
                name: 'Water Solution',
                physicalProperties: { solubility: 'miscible with water' },
                ghs: { signal: '', hazardStatements: [] },
            }),
        });

        const warnings = checkCompatibility([waterReactive, aqueous]);
        const rule3 = warnings.find(w => w.ruleId === 'water_reactive');
        expect(rule3).toBeDefined();
        expect(rule3!.severity).toBe('DANGER');
    });
});

// ══════════════════════════════════════════════
// Rule 4: 자연발화 → DANGER
// ══════════════════════════════════════════════
describe('checkCompatibility - Rule 4: 자연발화', () => {
    it('자연발화(H250) + 아무거나 → DANGER', () => {
        const pyrophoric = makeCartItem({
            chemical: makeChemical({
                name: 'tert-Butyllithium',
                ghs: { signal: 'Danger', hazardStatements: ['H250: Catches fire spontaneously'] },
            }),
        });
        const other = makeCartItem({
            chemical: makeChemical({
                name: 'Some Chemical',
                ghs: { signal: '', hazardStatements: [] },
            }),
        });

        const warnings = checkCompatibility([pyrophoric, other]);
        const rule4 = warnings.find(w => w.ruleId === 'pyrophoric');
        expect(rule4).toBeDefined();
        expect(rule4!.severity).toBe('DANGER');
    });
});

// ══════════════════════════════════════════════
// Rule 7: 산 + 시안화물 → DANGER (HCN 가스)
// ══════════════════════════════════════════════
describe('checkCompatibility - Rule 7: 산 + 시안화물', () => {
    it('산(pH<4) + 시안화칼륨 → DANGER (HCN 가스)', () => {
        const acid = makeCartItem({
            chemical: makeChemical({
                name: 'Hydrochloric Acid',
                molecularFormula: 'HCl',
                properties: { isOrganic: false, isHalogenated: false, ph: 1 },
                ghs: { signal: 'Danger', hazardStatements: ['H314: Causes severe skin burns'] },
            }),
        });
        const cyanide = makeCartItem({
            chemical: makeChemical({
                name: 'Potassium Cyanide',
                molecularFormula: 'KCN',
                ghs: { signal: 'Danger', hazardStatements: [] },
            }),
        });

        const warnings = checkCompatibility([acid, cyanide]);
        const rule7 = warnings.find(w => w.ruleId === 'acid_cyanide');
        expect(rule7).toBeDefined();
        expect(rule7!.severity).toBe('DANGER');
    });
});

// ══════════════════════════════════════════════
// Rule 8: 산 + 황화물 → DANGER (H2S 가스)
// ══════════════════════════════════════════════
describe('checkCompatibility - Rule 8: 산 + 황화물', () => {
    it('산(pH<4) + 황화나트륨 → DANGER (H2S 가스)', () => {
        const acid = makeCartItem({
            chemical: makeChemical({
                name: 'Sulfuric Acid',
                molecularFormula: 'H2SO4',
                properties: { isOrganic: false, isHalogenated: false, ph: 1 },
                ghs: { signal: 'Danger', hazardStatements: ['H314: Causes severe skin burns'] },
            }),
        });
        const sulfide = makeCartItem({
            chemical: makeChemical({
                name: 'Sodium Sulfide',
                molecularFormula: 'Na2S',
                ghs: { signal: 'Danger', hazardStatements: [] },
            }),
        });

        const warnings = checkCompatibility([acid, sulfide]);
        const rule8 = warnings.find(w => w.ruleId === 'acid_sulfide');
        expect(rule8).toBeDefined();
        expect(rule8!.severity).toBe('DANGER');
    });
});

// ══════════════════════════════════════════════
// Rule 10: 강산 + 강염기 → WARNING
// ══════════════════════════════════════════════
describe('checkCompatibility - Rule 10: 강산 + 강염기', () => {
    it('산(pH<4) + 염기(pH>10) → WARNING', () => {
        const acid = makeCartItem({
            chemical: makeChemical({
                name: 'Hydrochloric Acid',
                molecularFormula: 'HCl',
                properties: { isOrganic: false, isHalogenated: false, ph: 1 },
                ghs: { signal: 'Danger', hazardStatements: ['H314: Causes severe skin burns'] },
            }),
        });
        const base = makeCartItem({
            chemical: makeChemical({
                name: 'Sodium Hydroxide',
                molecularFormula: 'NaOH',
                properties: { isOrganic: false, isHalogenated: false, ph: 14 },
                ghs: { signal: 'Danger', hazardStatements: ['H314: Causes severe skin burns'] },
            }),
        });

        const warnings = checkCompatibility([acid, base]);
        const rule10 = warnings.find(w => w.ruleId === 'acid_base');
        expect(rule10).toBeDefined();
        expect(rule10!.severity).toBe('WARNING');
    });
});

// ══════════════════════════════════════════════
// 정렬: DANGER 우선
// ══════════════════════════════════════════════
describe('checkCompatibility - 정렬', () => {
    it('DANGER 경고가 WARNING보다 앞에 온다', () => {
        const acid = makeCartItem({
            chemical: makeChemical({
                name: 'Hydrochloric Acid',
                molecularFormula: 'HCl',
                properties: { isOrganic: false, isHalogenated: false, ph: 1 },
                ghs: { signal: 'Danger', hazardStatements: ['H314: Causes severe skin burns'] },
            }),
        });
        const cyanide = makeCartItem({
            chemical: makeChemical({
                name: 'Sodium Cyanide',
                molecularFormula: 'NaCN',
                properties: { isOrganic: false, isHalogenated: false, ph: 12 },
                ghs: { signal: 'Danger', hazardStatements: [] },
            }),
        });

        const warnings = checkCompatibility([acid, cyanide]);
        if (warnings.length >= 2) {
            const dangerIdx = warnings.findIndex(w => w.severity === 'DANGER');
            const warningIdx = warnings.findIndex(w => w.severity === 'WARNING');
            if (dangerIdx !== -1 && warningIdx !== -1) {
                expect(dangerIdx).toBeLessThan(warningIdx);
            }
        }
    });
});

// ══════════════════════════════════════════════
// 중복 제거
// ══════════════════════════════════════════════
describe('checkCompatibility - 중복 제거', () => {
    it('같은 규칙 + 같은 쌍은 중복 경고하지 않는다', () => {
        const oxidizer = makeCartItem({
            chemical: makeChemical({
                name: 'Oxidizer',
                ghs: { signal: 'Danger', hazardStatements: ['H271: May cause fire'] },
            }),
        });
        const flammable = makeCartItem({
            chemical: makeChemical({
                name: 'Flammable',
                properties: { isOrganic: true, isHalogenated: false },
                ghs: { signal: 'Warning', hazardStatements: ['H225: Highly flammable'] },
            }),
        });

        const warnings = checkCompatibility([oxidizer, flammable]);
        const oxFlam = warnings.filter(w => w.ruleId === 'oxidizer_flammable');
        expect(oxFlam.length).toBe(1);
    });
});
