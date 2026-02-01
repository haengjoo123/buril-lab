import type { Chemical } from '../types';

// Define Chemical Objects first
const ACETONE: Chemical = {
    id: '180',
    name: 'Acetone',
    casNumber: '67-64-1',
    molecularFormula: 'C3H6O',
    molecularWeight: 58.08,
    properties: { ph: 7, isOrganic: true, isHalogenated: false },
    ghs: {
        signal: 'Danger',
        hazardStatements: [
            'H225: Highly flammable liquid and vapour',
            'H319: Causes serious eye irritation',
            'H336: May cause drowsiness or dizziness'
        ]
    },
    physicalProperties: {
        solubility: 'Miscible with water',
        flashPoint: -20,
        boilingPoint: 56,
        logKow: -0.24,
        stability: 'Stable under recommended storage conditions.'
    }
};

const ETHANOL: Chemical = {
    id: '702',
    name: 'Ethanol',
    casNumber: '64-17-5',
    molecularFormula: 'C2H6O',
    molecularWeight: 46.07,
    properties: { isOrganic: true, isHalogenated: false },
    ghs: {
        signal: 'Danger',
        hazardStatements: [
            'H225: Highly flammable liquid and vapour'
        ]
    },
    physicalProperties: {
        solubility: 'Miscible with water',
        flashPoint: 13,
        boilingPoint: 78,
        logKow: -0.31,
        stability: 'Stable.'
    }
};

const METHANOL: Chemical = {
    id: '887',
    name: 'Methanol',
    casNumber: '67-56-1',
    molecularFormula: 'CH4O',
    molecularWeight: 32.04,
    properties: { isOrganic: true, isHalogenated: false },
    ghs: {
        signal: 'Danger',
        hazardStatements: [
            'H225: Highly flammable liquid and vapour',
            'H301: Toxic if swallowed',
            'H311: Toxic in contact with skin',
            'H331: Toxic if inhaled',
            'H370: Causes damage to organs'
        ]
    }
};

const SULFURIC_ACID: Chemical = {
    id: '1118',
    name: 'Sulfuric Acid',
    casNumber: '7664-93-9',
    molecularFormula: 'H2SO4',
    molecularWeight: 98.08,
    properties: { ph: 1, isOrganic: false, isHalogenated: false },
    ghs: {
        signal: 'Danger',
        hazardStatements: [
            'H314: Causes severe skin burns and eye damage'
        ]
    }
};

const HYDROCHLORIC_ACID: Chemical = {
    id: '313',
    name: 'Hydrochloric Acid',
    casNumber: '7647-01-0',
    molecularFormula: 'HCl',
    molecularWeight: 36.46,
    properties: { ph: 1, isOrganic: false, isHalogenated: true },
    ghs: {
        signal: 'Danger',
        hazardStatements: [
            'H314: Causes severe skin burns and eye damage',
            'H335: May cause respiratory irritation'
        ]
    }
};

const SODIUM_HYDROXIDE: Chemical = {
    id: '14798',
    name: 'Sodium Hydroxide',
    casNumber: '1310-73-2',
    molecularFormula: 'NaOH',
    molecularWeight: 40.0,
    properties: { ph: 14, isOrganic: false, isHalogenated: false },
    ghs: {
        signal: 'Danger',
        hazardStatements: [
            'H314: Causes severe skin burns and eye damage'
        ]
    }
};

const CHLOROFORM: Chemical = {
    id: '6212',
    name: 'Chloroform',
    casNumber: '67-66-3',
    molecularFormula: 'CHCl3',
    molecularWeight: 119.38,
    properties: { isOrganic: true, isHalogenated: true },
    ghs: {
        signal: 'Danger',
        hazardStatements: [
            'H302: Harmful if swallowed',
            'H315: Causes skin irritation',
            'H351: Suspected of causing cancer',
            'H372: Causes damage to organs through prolonged or repeated exposure'
        ]
    },
    physicalProperties: {
        solubility: 'Slightly soluble in water',
        flashPoint: undefined, // Non-flammable usually
        boilingPoint: 61,
        logKow: 1.97,
        stability: 'Stable.'
    }
};

const DICHLOROMETHANE: Chemical = {
    id: '6344',
    name: 'Dichloromethane',
    casNumber: '75-09-2',
    molecularFormula: 'CH2Cl2',
    molecularWeight: 84.93,
    properties: { isOrganic: true, isHalogenated: true },
    ghs: {
        signal: 'Warning',
        hazardStatements: [
            'H315: Causes skin irritation',
            'H319: Causes serious eye irritation',
            'H336: May cause drowsiness or dizziness',
            'H351: Suspected of causing cancer'
        ]
    }
};

const ACETIC_ACID: Chemical = {
    id: '176',
    name: 'Acetic Acid',
    casNumber: '64-19-7',
    molecularFormula: 'C2H4O2',
    molecularWeight: 60.05,
    properties: { ph: 2.4, isOrganic: true, isHalogenated: false },
    ghs: {
        signal: 'Danger',
        hazardStatements: [
            'H226: Flammable liquid and vapour',
            'H314: Causes severe skin burns and eye damage'
        ]
    }
};

const NITRIC_ACID: Chemical = {
    id: '944',
    name: 'Nitric Acid',
    casNumber: '7697-37-2',
    molecularFormula: 'HNO3',
    molecularWeight: 63.01,
    properties: { ph: 1, isOrganic: false, isHalogenated: false },
    ghs: {
        signal: 'Danger',
        hazardStatements: [
            'H272: May intensify fire; oxidizer',
            'H314: Causes severe skin burns and eye damage'
        ]
    }
};

const AMMONIA: Chemical = {
    id: '222',
    name: 'Ammonia',
    casNumber: '7664-41-7',
    molecularFormula: 'NH3',
    molecularWeight: 17.03,
    properties: { ph: 11.6, isOrganic: false, isHalogenated: false },
    ghs: {
        signal: 'Danger',
        hazardStatements: [
            'H314: Causes severe skin burns and eye damage',
            'H400: Very toxic to aquatic life'
        ]
    }
};

const TRICHLOROFLUOROMETHANE: Chemical = {
    id: '6389',
    name: 'Trichlorofluoromethane',
    casNumber: '75-69-4',
    molecularFormula: 'CCl3F',
    molecularWeight: 137.36,
    properties: { isOrganic: true, isHalogenated: true },
    ghs: {
        signal: 'Warning',
        hazardStatements: [
            'H420: Harms public health and the environment by destroying ozone in the upper atmosphere',
            'H315: Causes skin irritation',
            'H319: Causes serious eye irritation',
            'H336: May cause drowsiness or dizziness'
        ]
    }
};

// Map keys (English, CAS, Korean) to Objects
export const COMMON_CHEMICALS: Record<string, Chemical> = {
    // Acetone
    'ACETONE': ACETONE,
    '67-64-1': ACETONE,
    '아세톤': ACETONE,

    // Ethanol
    'ETHANOL': ETHANOL,
    '64-17-5': ETHANOL,
    '에탄올': ETHANOL,
    '에틸알코올': ETHANOL,

    // Methanol
    'METHANOL': METHANOL,
    '67-56-1': METHANOL,
    '메탄올': METHANOL,
    '메틸알코올': METHANOL,

    // Sulfuric Acid
    'SULFURIC ACID': SULFURIC_ACID,
    '7664-93-9': SULFURIC_ACID,
    '황산': SULFURIC_ACID,

    // Hydrochloric Acid
    'HYDROCHLORIC ACID': HYDROCHLORIC_ACID,
    'HCL': HYDROCHLORIC_ACID,
    '7647-01-0': HYDROCHLORIC_ACID,
    '염산': HYDROCHLORIC_ACID,

    // Sodium Hydroxide
    'SODIUM HYDROXIDE': SODIUM_HYDROXIDE,
    'NAOH': SODIUM_HYDROXIDE,
    '1310-73-2': SODIUM_HYDROXIDE,
    '수산화나트륨': SODIUM_HYDROXIDE,
    '가성소다': SODIUM_HYDROXIDE,

    // Chloroform
    'CHLOROFORM': CHLOROFORM,
    '67-66-3': CHLOROFORM,
    '클로로포름': CHLOROFORM,
    '클로로폼': CHLOROFORM,

    // Dichloromethane
    'DICHLOROMETHANE': DICHLOROMETHANE,
    'DCM': DICHLOROMETHANE,
    '75-09-2': DICHLOROMETHANE,
    '디클로로메탄': DICHLOROMETHANE,
    '메틸렌클로라이드': DICHLOROMETHANE, // Synonym

    // Acetic Acid
    'ACETIC ACID': ACETIC_ACID,
    '64-19-7': ACETIC_ACID,
    '아세트산': ACETIC_ACID,
    '초산': ACETIC_ACID,

    // Nitric Acid
    'NITRIC ACID': NITRIC_ACID,
    '7697-37-2': NITRIC_ACID,
    '질산': NITRIC_ACID,

    // Ammonia
    'AMMONIA': AMMONIA,
    '7664-41-7': AMMONIA,
    '암모니아': AMMONIA,
    '암모니아수': AMMONIA,

    // Trichlorofluoromethane (CFC-11)
    'TRICHLOROFLUOROMETHANE': TRICHLOROFLUOROMETHANE,
    'TRICHLOROFLUOROMETHAN': TRICHLOROFLUOROMETHANE, // Common typo
    '75-69-4': TRICHLOROFLUOROMETHANE,
    'CFC-11': TRICHLOROFLUOROMETHANE,
    'R-11': TRICHLOROFLUOROMETHANE,
    '트리클로로플루오로메탄': TRICHLOROFLUOROMETHANE
};
