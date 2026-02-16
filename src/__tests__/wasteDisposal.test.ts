import { describe, it, expect } from 'vitest';
import { assessSolubility, assessNeutralization, determineDisposal } from '../utils/wasteDisposal';
import type { Chemical } from '../types';

// ──────────────────────────────────────────────
// Helper
// ──────────────────────────────────────────────
const makeChemical = (overrides: Partial<Chemical> = {}): Chemical => ({
    id: 'test-id',
    name: 'Test Chemical',
    casNumber: '0000-00-0',
    molecularFormula: '',
    ...overrides,
});

// ══════════════════════════════════════════════
// assessSolubility
// ══════════════════════════════════════════════
describe('assessSolubility', () => {
    it('"miscible" → SOLUBLE', () => {
        const chem = makeChemical({
            physicalProperties: { solubility: 'miscible with water' },
        });
        expect(assessSolubility(chem)).toBe('SOLUBLE');
    });

    it('"soluble" → SOLUBLE', () => {
        const chem = makeChemical({
            physicalProperties: { solubility: 'Soluble in water' },
        });
        expect(assessSolubility(chem)).toBe('SOLUBLE');
    });

    it('"insoluble" → INSOLUBLE', () => {
        const chem = makeChemical({
            physicalProperties: { solubility: 'Insoluble in water' },
        });
        expect(assessSolubility(chem)).toBe('INSOLUBLE');
    });

    it('"slightly soluble" → INSOLUBLE (보수적 판정)', () => {
        const chem = makeChemical({
            physicalProperties: { solubility: 'Slightly soluble in water' },
        });
        expect(assessSolubility(chem)).toBe('INSOLUBLE');
    });

    it('"practically insoluble" → INSOLUBLE', () => {
        const chem = makeChemical({
            physicalProperties: { solubility: 'Practically insoluble' },
        });
        expect(assessSolubility(chem)).toBe('INSOLUBLE');
    });

    // Chemical family heuristics
    it('이름에 "AMINE" → SOLUBLE (화학적 Classification)', () => {
        const chem = makeChemical({ name: 'Isopropylamine' });
        expect(assessSolubility(chem)).toBe('SOLUBLE');
    });

    it('이름에 "BENZENE" → INSOLUBLE', () => {
        const chem = makeChemical({ name: 'Benzene' });
        expect(assessSolubility(chem)).toBe('INSOLUBLE');
    });

    it('이름에 "TOLUENE" → INSOLUBLE', () => {
        const chem = makeChemical({ name: 'Toluene' });
        expect(assessSolubility(chem)).toBe('INSOLUBLE');
    });

    // Log Kow
    it('logKow < 1 → SOLUBLE', () => {
        const chem = makeChemical({
            name: 'Unknown-A',
            physicalProperties: { logKow: 0.5 },
        });
        expect(assessSolubility(chem)).toBe('SOLUBLE');
    });

    it('logKow >= 3 → INSOLUBLE', () => {
        const chem = makeChemical({
            name: 'Unknown-B',
            physicalProperties: { logKow: 3.5 },
        });
        expect(assessSolubility(chem)).toBe('INSOLUBLE');
    });

    it('logKow 1~3 → INSOLUBLE (보수적)', () => {
        const chem = makeChemical({
            name: 'Unknown-C',
            physicalProperties: { logKow: 2.0 },
        });
        expect(assessSolubility(chem)).toBe('INSOLUBLE');
    });

    it('정보 없음 → INSOLUBLE (보수적 기본값)', () => {
        const chem = makeChemical({ name: 'Unknown-D' });
        expect(assessSolubility(chem)).toBe('INSOLUBLE');
    });
});

// ══════════════════════════════════════════════
// assessNeutralization
// ══════════════════════════════════════════════
describe('assessNeutralization', () => {
    it('안전한 화합물 → true (중화 허용)', () => {
        const chem = makeChemical({
            name: 'Ethanol',
            properties: { isOrganic: true, isHalogenated: false },
            ghs: { signal: 'Warning', hazardStatements: ['H225: Highly flammable'] },
        });
        expect(assessNeutralization(chem)).toBe(true);
    });

    it('stability에 "unstable" → false (중화 금지)', () => {
        const chem = makeChemical({
            name: 'Unstable Compound',
            physicalProperties: { stability: 'Unstable, may decompose violently' },
            ghs: { signal: 'Danger', hazardStatements: [] },
        });
        expect(assessNeutralization(chem)).toBe(false);
    });

    it('stability에 "explosive" → false', () => {
        const chem = makeChemical({
            name: 'Explosive Compound',
            physicalProperties: { stability: 'Explosive when heated' },
            ghs: { signal: 'Danger', hazardStatements: [] },
        });
        expect(assessNeutralization(chem)).toBe(false);
    });

    it('끓는점 < 70°C → false (끓어넘침 위험)', () => {
        const chem = makeChemical({
            name: 'Low BP Chemical',
            physicalProperties: { boilingPoint: 56 },
            ghs: { signal: 'Warning', hazardStatements: [] },
        });
        expect(assessNeutralization(chem)).toBe(false);
    });

    it('끓는점 >= 70°C → true', () => {
        const chem = makeChemical({
            name: 'Normal BP Chemical',
            physicalProperties: { boilingPoint: 100 },
            ghs: { signal: 'Warning', hazardStatements: [] },
        });
        expect(assessNeutralization(chem)).toBe(true);
    });

    it('GHS 위험 요소 2개 이상 → false', () => {
        const chem = makeChemical({
            name: 'Multi-risk Chemical',
            properties: { isOrganic: true, isHalogenated: false },
            ghs: {
                signal: 'Danger',
                hazardStatements: [
                    'H271: May cause fire or explosion; strong oxidizer',  // intensify fire / oxidiz
                    'H314: Causes severe skin burns',                      // corrosive + organic
                ],
            },
        });
        expect(assessNeutralization(chem)).toBe(false);
    });
});

// ══════════════════════════════════════════════
// determineDisposal
// ══════════════════════════════════════════════
describe('determineDisposal', () => {
    it('Case 1: 수용성 + 중화 가능 → disposal_method_case1', () => {
        const organicSoluble = makeChemical({
            name: 'Ethanol',
            properties: { isOrganic: true, isHalogenated: false },
            physicalProperties: { solubility: 'miscible', boilingPoint: 78 },
            ghs: { signal: 'Warning', hazardStatements: ['H225: Highly flammable'] },
        });
        const alkali = makeChemical({
            name: 'NaOH',
            properties: { isOrganic: false, isHalogenated: false, ph: 14 },
        });

        const result = determineDisposal([alkali, organicSoluble]);
        expect(result.solubilityStatus).toBe('SOLUBLE');
        expect(result.neutralizationStatus).toBe('ALLOWED');
        expect(result.disposalMethod).toBe('disposal_method_case1');
    });

    it('Case 2: 수용성 + 중화 금지 → disposal_method_case2', () => {
        const organicUnsafe = makeChemical({
            name: 'Unstable Organic',
            properties: { isOrganic: true, isHalogenated: false },
            physicalProperties: { solubility: 'miscible', stability: 'Unstable compound' },
            ghs: { signal: 'Danger', hazardStatements: [] },
        });
        const alkali = makeChemical({
            name: 'NaOH',
            properties: { isOrganic: false, isHalogenated: false, ph: 14 },
        });

        const result = determineDisposal([alkali, organicUnsafe]);
        expect(result.solubilityStatus).toBe('SOLUBLE');
        expect(result.neutralizationStatus).toBe('PROHIBITED');
        expect(result.disposalMethod).toBe('disposal_method_case2');
    });

    it('Case 3: 비수용성 → disposal_method_case3 (중화 자동 금지)', () => {
        const organicInsoluble = makeChemical({
            name: 'Toluene',
            properties: { isOrganic: true, isHalogenated: false },
            physicalProperties: { solubility: 'Insoluble in water' },
            ghs: { signal: 'Warning', hazardStatements: [] },
        });
        const alkali = makeChemical({
            name: 'NaOH',
            properties: { isOrganic: false, isHalogenated: false, ph: 14 },
        });

        const result = determineDisposal([alkali, organicInsoluble]);
        expect(result.solubilityStatus).toBe('INSOLUBLE');
        expect(result.neutralizationStatus).toBe('PROHIBITED');
        expect(result.disposalMethod).toBe('disposal_method_case3');
    });

    it('유기물이 없으면 모두 SOLUBLE + ALLOWED (Case 1)', () => {
        const alkali = makeChemical({
            name: 'NaOH',
            properties: { isOrganic: false, isHalogenated: false, ph: 14 },
        });

        const result = determineDisposal([alkali]);
        expect(result.solubilityStatus).toBe('SOLUBLE');
        expect(result.neutralizationStatus).toBe('ALLOWED');
        expect(result.disposalMethod).toBe('disposal_method_case1');
    });
});
