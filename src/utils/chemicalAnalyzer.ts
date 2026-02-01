import type { AnalysisResult, Chemical, DisposalCategory } from '../types';

// Helper: Parse molecular formula into element counts
// e.g., "C6H12O6" -> { C: 6, H: 12, O: 6 }
export const parseFormula = (formula: string): Record<string, number> => {
    const elements: Record<string, number> = {};
    const regex = /([A-Z][a-z]?)(\d*)/g;
    let match;

    while ((match = regex.exec(formula)) !== null) {
        // Avoid infinite loops if regex matches empty string at end
        if (match.index === regex.lastIndex) {
            regex.lastIndex++;
        }

        // match[0] is full match (e.g. "Cl2")
        // match[1] is element (e.g. "Cl")
        // match[2] is count (e.g. "2" or "")
        if (match[1]) {
            const element = match[1];
            const count = match[2] ? parseInt(match[2], 10) : 1;
            elements[element] = (elements[element] || 0) + count;
        }
    }
    return elements;
};

// Helper: Determine disposal category details
const getCategoryDetails = (category: DisposalCategory): { binColor: string; label: string } => {
    switch (category) {
        case 'ACID':
            return { binColor: 'bg-red-500', label: 'label_acid' };
        case 'ALKALI':
            return { binColor: 'bg-blue-500', label: 'label_alkali' };
        case 'NEUTRAL':
            return { binColor: 'bg-green-500', label: 'label_neutral' };
        case 'ORGANIC_HALOGEN':
            return { binColor: 'bg-orange-600', label: 'label_organic' };
        case 'ORGANIC_NON_HALOGEN':
            return { binColor: 'bg-yellow-500', label: 'label_organic' };
        default:
            return { binColor: 'bg-gray-400', label: 'mix_label_unknown' };
    }
};

export const analyzeChemical = (chemical: Chemical): AnalysisResult => {
    const elements = parseFormula(chemical.molecularFormula || '');

    // 1. Organic detection: Presence of Carbon (C)
    const hasCarbon = !!elements['C'];

    // Ensure properties exist and sync isOrganic
    if (!chemical.properties) chemical.properties = { isOrganic: hasCarbon, isHalogenated: false };
    chemical.properties.isOrganic = hasCarbon;

    // 2. Halogen detection: F, Cl, Br, I
    const halogens = ['F', 'Cl', 'Br', 'I'];
    const hasHalogen = halogens.some(h => !!elements[h]);

    let category: DisposalCategory = 'UNKNOWN';
    let reason = '';
    let reasonParams: Record<string, string | number> | undefined;

    if (hasCarbon) {
        // Organic Logic
        if (hasHalogen) {
            category = 'ORGANIC_HALOGEN';
            reason = 'reason_organic_halogen';
        } else {
            category = 'ORGANIC_NON_HALOGEN';
            reason = 'reason_organic_non_halogen';
        }
    } else {
        // Inorganic Logic
        const nameUpper = chemical.name.toUpperCase();

        if (chemical.properties?.ph !== undefined) {
            if (chemical.properties.ph < 7) {
                category = 'ACID';
                reason = 'reason_acid_ph';
                reasonParams = { ph: chemical.properties.ph };
            } else if (chemical.properties.ph > 7) {
                category = 'ALKALI';
                reason = 'reason_alkali_ph';
                reasonParams = { ph: chemical.properties.ph };
            } else {
                // pH == 7 -> NEUTRAL
                category = 'NEUTRAL';
                reason = 'reason_neutral_ph';
                reasonParams = { ph: chemical.properties.ph };
            }
        }

        if (category === 'UNKNOWN') {
            if (nameUpper.includes('ACID') || nameUpper.includes('SULFURIC') || nameUpper.includes('HYDROCHLORIC') || nameUpper.includes('NITRIC')) {
                category = 'ACID';
                reason = 'reason_acid_keyword';
            } else if (nameUpper.includes('HYDROXIDE') || nameUpper.includes('AMMONIA')) {
                category = 'ALKALI';
                reason = 'reason_alkali_keyword';
            }
        }
    }

    const { binColor, label } = getCategoryDetails(category);

    return {
        chemical,
        category,
        binColor,
        label, // Now returns a translation key
        reason: reason || 'reason_unknown', // Now returns a translation key
        reasonParams,
        isSafe: category !== 'UNKNOWN'
    };
};
