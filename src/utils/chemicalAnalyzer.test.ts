import { describe, expect, it } from 'vitest';
import type { Chemical } from '../types';
import { analyzeChemical } from './chemicalAnalyzer';

const chemicalWithReferencePh = (referencePh: number): Chemical => ({
    id: `reference-${referencePh}`,
    name: 'Reference-only inorganic material',
    casNumber: '7732-18-5',
    molecularFormula: 'NaCl',
    properties: {
        isOrganic: false,
        isHalogenated: false,
        referencePh,
        phSource: 'kosha_reference',
    },
});

describe('analyzeChemical reference pH handling', () => {
    it.each([3, 7, 11])(
        'classifies a confirmed inorganic salt independently of reference pH %s',
        (referencePh) => {
            expect(analyzeChemical(chemicalWithReferencePh(referencePh))).toMatchObject({
                category: 'NEUTRAL',
                reason: 'reason_neutral_inorganic_salt',
            });
        },
    );
});

describe('analyzeChemical confirmed inorganic salt routing', () => {
    it('does not promote fluoride, alkali, or heavy-metal salts to the neutral category', () => {
        expect(analyzeChemical({
            id: 'sodium-fluoride', name: 'Sodium fluoride', casNumber: '7681-49-4', molecularFormula: 'NaF',
        }).category).not.toBe('NEUTRAL');
        expect(analyzeChemical({
            id: 'sodium-hydroxide', name: 'Sodium hydroxide', casNumber: '1310-73-2', molecularFormula: 'NaOH',
        }).category).toBe('ALKALI');
        expect(analyzeChemical({
            id: 'cadmium-chloride', name: 'Cadmium chloride', casNumber: '10108-64-2', molecularFormula: 'CdCl2',
        }).category).toBe('HEAVY_METAL');
    });
});

describe('analyzeChemical ionic organic material routing', () => {
    it.each([
        ['Sodium acetate', 'C2H3NaO2', 'CC(=O)[O-].[Na+]'],
        ['Potassium acetate', 'C2H3KO2', 'CC(=O)[O-].[K+]'],
        ['Trisodium citrate', 'C6H5Na3O7', 'C(C(=O)[O-])(CC(=O)[O-])CC(=O)[O-].[Na+].[Na+].[Na+]'],
    ])('keeps verified ionic organic salt %s out of organic-solvent categories', (
        name,
        molecularFormula,
        connectivitySmiles,
    ) => {
        expect(analyzeChemical({
            id: name,
            name,
            casNumber: '127-09-3',
            molecularFormula,
            connectivitySmiles,
        })).toMatchObject({
            category: 'NEUTRAL',
            label: 'label_ionic_organic_salt',
            reason: 'reason_ionic_organic_salt_matrix_required',
            materialProfile: {
                kind: 'ionic_organic_salt',
                evidence: 'connectivity_smiles',
                requiresMatrixConfirmation: true,
            },
        });
    });

    it('does not mistake an ester solvent or covalent organometallic for an ionic salt', () => {
        const ethylAcetate = analyzeChemical({
            id: 'ethyl-acetate',
            name: 'Ethyl acetate',
            casNumber: '141-78-6',
            molecularFormula: 'C4H8O2',
            connectivitySmiles: 'CCOC(=O)C',
        });
        const methylLithium = analyzeChemical({
            id: 'methyllithium',
            name: 'Methyllithium',
            casNumber: '917-54-4',
            molecularFormula: 'CH3Li',
            connectivitySmiles: 'C[Li]',
        });

        expect(ethylAcetate).toMatchObject({
            category: 'ORGANIC_NON_HALOGEN',
            materialProfile: { kind: 'organic_compound' },
        });
        expect(methylLithium).toMatchObject({
            category: 'REACTIVE',
            materialProfile: { kind: 'organic_compound' },
        });
    });

    it('holds a carbon-and-metal formula for review when structural ions are unavailable', () => {
        expect(analyzeChemical({
            id: 'sodium-acetate-without-structure',
            name: 'Sodium acetate',
            casNumber: '127-09-3',
            molecularFormula: 'C2H3NaO2',
        })).toMatchObject({
            category: 'UNKNOWN',
            label: 'label_possible_ionic_material',
            reason: 'reason_possible_ionic_material_review',
            materialProfile: {
                kind: 'possible_ionic_organic_material',
                evidence: 'formula',
            },
        });
    });

    it('keeps confirmed hazards above the ionic-salt material identity', () => {
        expect(analyzeChemical({
            id: 'toxic-sodium-benzoate-test',
            name: 'Toxic sodium benzoate test',
            casNumber: '532-32-1',
            molecularFormula: 'C7H5NaO2',
            connectivitySmiles: 'C1=CC=C(C=C1)C(=O)[O-].[Na+]',
            ghs: { signal: 'Danger', hazardStatements: ['H300'] },
        })).toMatchObject({
            category: 'SPECIAL_HAZARD',
            label: 'label_special_hazard',
            materialProfile: { kind: 'ionic_organic_salt' },
        });
    });
});

describe('analyzeChemical independent hazard detection', () => {
    it('preserves heavy-metal and reactive/oxidizer evidence despite legacy precedence', () => {
        const result = analyzeChemical({
            id: 'silver-nitrate',
            name: 'Silver nitrate',
            casNumber: '7761-88-8',
            molecularFormula: 'AgNO3',
            ghs: {
                signal: 'Danger',
                hazardStatements: ['H272: May intensify fire; oxidizer'],
            },
        });

        expect(result.category).toBe('REACTIVE');
        expect(result.hazardProfile?.flags).toEqual(expect.arrayContaining([
            'HEAVY_METAL',
            'OXIDIZER',
            'REACTIVE',
        ]));
        expect(result.hazardProfile?.evidence).toEqual(expect.arrayContaining([
            expect.objectContaining({
                flag: 'HEAVY_METAL',
                source: 'formula_element',
                value: 'Ag',
                confidence: 'confirmed',
            }),
            expect.objectContaining({
                flag: 'OXIDIZER',
                source: 'h_code',
                value: 'H272',
                confidence: 'confirmed',
            }),
        ]));
    });

    it('keeps a name-only reactive signal inferred while formula evidence stays confirmed', () => {
        const result = analyzeChemical({
            id: 'silver-nitrate-name-fallback',
            name: 'Silver nitrate',
            casNumber: '7761-88-8',
            molecularFormula: 'AgNO3',
        });

        expect(result.hazardProfile?.evidence).toEqual(expect.arrayContaining([
            expect.objectContaining({
                flag: 'REACTIVE',
                source: 'name_pattern',
                confidence: 'inferred',
            }),
            expect.objectContaining({
                flag: 'HEAVY_METAL',
                source: 'formula_element',
                confidence: 'confirmed',
            }),
        ]));
    });
});

describe('analyzeChemical stream-identity boundaries', () => {
    it('does not mistake an organic nitrile or thioether for inorganic cyanide/sulfide waste', () => {
        const nitrile = analyzeChemical({
            id: 'veratryl-cyanide',
            name: 'Veratryl cyanide; 3,4-Dimethoxyphenylacetonitrile',
            casNumber: '93-17-4',
            molecularFormula: 'C10H11NO2',
            ghs: { signal: 'Warning', hazardStatements: ['H301'] },
        });
        const thioether = analyzeChemical({
            id: 'dimethyl-sulfide',
            name: 'Dimethyl sulfide',
            casNumber: '75-18-3',
            molecularFormula: 'C2H6S',
            ghs: { signal: 'Danger', hazardStatements: ['H225'] },
        });

        for (const result of [nitrile, thioether]) {
            expect(result.category).toBe('ORGANIC_NON_HALOGEN');
            expect(result.hazardProfile?.flags).not.toEqual(expect.arrayContaining([
                'CYANIDE',
                'SULFIDE',
            ]));
        }
    });

    it('keeps inorganic cyanide and sulfide identities distinct from organic name aliases', () => {
        const sodiumCyanide = analyzeChemical({
            id: 'sodium-cyanide',
            name: 'Sodium cyanide',
            casNumber: '143-33-9',
            molecularFormula: 'NaCN',
        });
        const calciumPolysulfide = analyzeChemical({
            id: 'calcium-polysulfide',
            name: 'Calcium polysulfide',
            casNumber: '1344-81-6',
            molecularFormula: 'CaS5',
        });

        expect(sodiumCyanide.category).toBe('CYANIDE');
        expect(sodiumCyanide.hazardProfile?.flags).toContain('CYANIDE');
        expect(calciumPolysulfide.category).toBe('CYANIDE');
        expect(calciumPolysulfide.hazardProfile?.flags).toContain('SULFIDE');
    });

    it('keeps P-list as an advisory without overriding a Korean stream identity', () => {
        const sodiumCyanide = analyzeChemical({
            id: 'sodium-cyanide-p-list',
            name: 'Sodium cyanide',
            casNumber: '143-33-9',
            molecularFormula: 'NaCN',
        });
        const acrolein = analyzeChemical({
            id: 'acrolein-p-list',
            name: 'Acrolein',
            casNumber: '107-02-8',
            molecularFormula: 'C3H4O',
        });

        expect(sodiumCyanide).toMatchObject({
            category: 'CYANIDE',
            reason: 'reason_cyanide',
        });
        expect(acrolein).toMatchObject({
            category: 'ORGANIC_NON_HALOGEN',
        });
        expect(acrolein.hazardWarnings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'p_list_advisory',
                evidenceLabel: 'CAS 107-02-8',
            }),
        ]));
    });

    it('keeps a metal sulfide in the heavy-metal category while retaining sulfide evidence', () => {
        const result = analyzeChemical({
            id: 'tin-disulfide',
            name: 'Tin disulfide (Tin sulfide)',
            casNumber: '1315-01-1',
            molecularFormula: 'SnS2',
        });

        expect(result.category).toBe('HEAVY_METAL');
        expect(result.hazardProfile?.flags).toEqual(expect.arrayContaining([
            'HEAVY_METAL',
            'SULFIDE',
        ]));
    });

    it('does not classify sulfate salt aliases as free acids, while preserving explicit acid salts', () => {
        expect(analyzeChemical({
            id: 'cesium-sulfate',
            name: 'Sulfuric acid, cesium salt',
            casNumber: '10294-54-9',
            molecularFormula: 'Cs2O4S',
        }).category).toBe('NEUTRAL');
        expect(analyzeChemical({
            id: 'sodium-bisulfate',
            name: 'Sodium bisulfate',
            casNumber: '7681-38-1',
            molecularFormula: 'HNaO4S',
        }).category).toBe('ACID');
    });

    it('recognizes explicit organic hydroxide bases but not hydroxide inner-salt nomenclature', () => {
        expect(analyzeChemical({
            id: 'tetrabutylammonium-hydroxide',
            name: 'Tetrabutylammonium hydroxide',
            casNumber: '2052-49-5',
            molecularFormula: 'C16H37NO',
        }).category).toBe('ALKALI');
        expect(analyzeChemical({
            id: 'lauramidopropylbetaine',
            name: 'Lauramidopropylbetaine hydroxide inner salt',
            casNumber: '4292-10-8',
            molecularFormula: 'C19H38N2O3',
        }).category).not.toBe('ALKALI');
    });

    it('does not confuse hafnium hydroxide with hydrofluoric acid and holds reaction-product UVCBs', () => {
        expect(analyzeChemical({
            id: 'hafnium-hydroxide',
            name: 'Hafnium hydroxide',
            casNumber: '12027-05-3',
            molecularFormula: 'H8HfO4',
        }).category).toBe('ALKALI');
        expect(analyzeChemical({
            id: 'reaction-product',
            name: 'Phosphoric acid reaction products with aluminum hydroxide',
            casNumber: '92203-02-6',
            molecularFormula: '',
        }).category).toBe('UNKNOWN');
    });
});

describe('analyzeChemical high-risk review classification', () => {
    it('treats a P-list CAS match as a non-blocking advisory in the Korean policy', () => {
        const result = analyzeChemical({
            id: 'acrolein',
            name: 'Acrolein',
            casNumber: '107-02-8',
            molecularFormula: 'C3H4O',
        });

        expect(result.category).toBe('ORGANIC_NON_HALOGEN');
        expect(result.isSafe).toBe(true);
        expect(result.hazardWarnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'p_list_advisory' }),
        ]));
    });

    it('keeps fatal acute-toxicity evidence distinct from a P-list CAS match', () => {
        const result = analyzeChemical({
            id: 'acute-toxin-test',
            name: 'Acute toxin test material',
            casNumber: '123-45-6',
            molecularFormula: 'C2H6O',
            ghs: {
                signal: 'Danger',
                hazardStatements: ['H300: Fatal if swallowed'],
            },
        });

        expect(result.category).toBe('SPECIAL_HAZARD');
        expect(result.reason).toBe('reason_fatal_acute_toxicity');
        expect(result.isSafe).toBe(false);
    });
});

describe('analyzeChemical corrosive-acid and reactive-identity coverage', () => {
    it.each([
        ['Methanesulfonic acid', 'CH4O3S'],
        ['p-Toluenesulfonic acid', 'C7H8O3S'],
        ['Trifluoroacetic acid', 'C2HF3O2'],
    ])('treats corrosive named acid %s as an acid regardless of organic formula', (name, molecularFormula) => {
        expect(analyzeChemical({
            id: name,
            name,
            casNumber: '64-19-7',
            molecularFormula,
            ghs: { signal: 'Danger', hazardStatements: ['H314'] },
        }).category).toBe('ACID');
    });

    it.each([
        ['Methyllithium', 'CH3Li'],
        ['Phenyllithium', 'C6H5Li'],
        ['Triethylaluminium', 'C6H15Al'],
        ['Oxalyl chloride', 'C2Cl2O2'],
    ])('routes known high-reactivity identity %s to review even when the GHS record is incomplete', (name, molecularFormula) => {
        const result = analyzeChemical({
            id: name,
            name,
            casNumber: '67-64-1',
            molecularFormula,
        });
        expect(result.category).toBe('REACTIVE');
        expect(result.hazardProfile?.flags).toContain('REACTIVE');
    });

    it.each([
        ['TERBIUM PEROXIDE (Terbium oxide (Tb4O7))', 'H14O7Tb4'],
        ['Terbium oxide (alias: terbium peroxide)', 'OTb2'],
        ['Superoxide dismutase from human erythrocytes', ''],
    ])('does not infer reactivity from an oxide alias or enzyme name: %s', (name, molecularFormula) => {
        const result = analyzeChemical({
            id: name,
            name,
            casNumber: '67-64-1',
            molecularFormula,
        });

        expect(result.hazardProfile?.flags).not.toContain('REACTIVE');
    });

    it.each([
        ['Ammonium sulfate', 'H8N2O4S'],
        ['Ammonium thiosulfate', 'H8N2O3S2'],
        ['Diammonium phosphate sulfate', 'H11N2O8PS'],
    ])('recognizes confirmed non-reactive ammonium salt %s as an inorganic salt', (name, molecularFormula) => {
        expect(analyzeChemical({
            id: name,
            name,
            casNumber: '67-64-1',
            molecularFormula,
        })).toMatchObject({
            category: 'NEUTRAL',
            reason: 'reason_neutral_inorganic_salt',
        });
    });

    it('keeps ammonium fluoride, hydroxide, acidic, and reactive ammonium salts out of the neutral-salt fallback', () => {
        expect(analyzeChemical({
            id: 'ammonium-fluoride', name: 'Ammonium fluoride', casNumber: '12125-01-8', molecularFormula: 'NH4F',
        }).category).not.toBe('NEUTRAL');
        expect(analyzeChemical({
            id: 'ammonium-hydroxide', name: 'Ammonium hydroxide', casNumber: '1336-21-6', molecularFormula: 'NH4OH',
        }).category).toBe('ALKALI');
        expect(analyzeChemical({
            id: 'ammonium-hydrogen-sulfate', name: 'Ammonium hydrogen sulfate', casNumber: '7803-63-6', molecularFormula: 'H5NO4S',
        }).category).not.toBe('NEUTRAL');
        expect(analyzeChemical({
            id: 'ammonium-persulfate', name: 'Ammonium persulfate', casNumber: '7727-54-0', molecularFormula: '(NH4)2S2O8',
        }).category).toBe('REACTIVE');
    });
});
