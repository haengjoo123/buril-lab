import type { AnalysisResult, Chemical, DisposalCategory } from '../types';
import pListCas from '../data/p_list_cas.json';
import uListCas from '../data/u_list_cas.json';

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
export const getCategoryDetails = (category: DisposalCategory): { binColor: string; label: string } => {
    switch (category) {
        case 'ACID':
            return { binColor: 'bg-red-500', label: 'label_acid' };
        case 'ALKALI':
            return { binColor: 'bg-blue-500', label: 'label_alkali' };
        case 'NEUTRAL':
            return { binColor: 'bg-green-500', label: 'label_neutral' };
        case 'ORGANIC_HALOGEN':
            return { binColor: 'bg-orange-600', label: 'label_organic_halogen' };
        case 'ORGANIC_NON_HALOGEN':
            return { binColor: 'bg-yellow-500', label: 'label_organic_non_halogen' };
        case 'HEAVY_METAL':
            return { binColor: 'bg-purple-600', label: 'label_heavy_metal' };
        case 'CYANIDE':
            return { binColor: 'bg-teal-600', label: 'label_cyanide' };
        case 'REACTIVE':
            return { binColor: 'bg-rose-600', label: 'label_reactive' };
        case 'SOLID_WASTE':
            return { binColor: 'bg-stone-500', label: 'label_solid_waste' };
        case 'SPECIAL_HAZARD':
            return { binColor: 'bg-red-800', label: 'label_special_hazard' };
        default:
            return { binColor: 'bg-gray-400', label: 'mix_label_unknown' };
    }
};

export const analyzeChemical = (chemical: Chemical): AnalysisResult => {
    // 0. P-List / U-List Check (Highest Priority)
    if (chemical.casNumber && (pListCas.includes(chemical.casNumber) || uListCas.includes(chemical.casNumber))) {
        const { binColor, label } = getCategoryDetails('SPECIAL_HAZARD');
        return {
            chemical,
            category: 'SPECIAL_HAZARD',
            binColor,
            label,
            reason: 'reason_special_hazard',
            isSafe: true // Safety verified as "definitely dangerous and clearly classified"
        };
    }

    const elements = parseFormula(chemical.molecularFormula || '');
    const formulaStr = chemical.molecularFormula || '';
    const nameUpper = chemical.name.toUpperCase();

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

    // --- Strict Evaluation Priority ---

    // 1. Reactive / Oxidizer
    const reactiveKeywords = ['PEROXIDE', 'NITRATE', 'CHLORATE', 'PERMANGANATE', 'AZIDE', 'PERCHLORATE', 'HYDRAZINE', 'PICRIC', 'NITRIC ACID', 'PERCHLORIC ACID'];
    const isReactive = reactiveKeywords.some(kw => nameUpper.includes(kw)) || formulaStr.includes('HNO3') || formulaStr.includes('HClO4');

    // 2. Cyanide / Sulfide
    const isCyanide = nameUpper.includes('CYANIDE') || formulaStr.includes('CN') || formulaStr.includes('(CN)') || nameUpper.includes('SULFIDE') || formulaStr.includes('S2-');

    // 3. Heavy Metals (using regex with word boundaries to avoid partial matches like "CO")
    const heavyMetalRegex = /\b(Ag|Cd|Pb|Hg|Cr|As|Ni|Cu|Zn|Ba)\b/;
    const isHeavyMetal = heavyMetalRegex.test(formulaStr);

    // 6. Solid Waste (evaluated later but defined here)
    const solidKeywords = ['POWDER', 'RESIN', 'SAND', 'PELLET', 'BEAD', 'LUMP', 'CRYSTAL'];
    const isSolid = solidKeywords.some(kw => nameUpper.includes(kw));

    if (isReactive) {
        category = 'REACTIVE';
        reason = 'reason_reactive';
    } else if (isCyanide) {
        category = 'CYANIDE';
        reason = 'reason_cyanide';
    } else if (isHeavyMetal) {
        category = 'HEAVY_METAL';
        reason = 'reason_heavy_metal';
    } else if (hasCarbon) {
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
                category = 'NEUTRAL';
                reason = 'reason_neutral_ph';
                reasonParams = { ph: chemical.properties.ph };
            }
        }

        if (category === 'UNKNOWN') {
            if (nameUpper.includes('ACID') || nameUpper.includes('SULFURIC') || nameUpper.includes('HYDROCHLORIC') || nameUpper.includes('NITRIC')) {
                category = 'ACID';
                reason = 'reason_acid_keyword';
            } else if (nameUpper.includes('HYDROXIDE') || nameUpper.includes('AMMONIA') || nameUpper.includes('BASE')) {
                category = 'ALKALI';
                reason = 'reason_alkali_keyword';
            }
        }
    }

    // Apply Solid fallback if category is unknown or if it specifically matches solid without being overridden by dangerous categories
    if (category === 'UNKNOWN' && isSolid) {
        category = 'SOLID_WASTE';
        reason = 'reason_solid_waste';
    }

    const { binColor, label } = getCategoryDetails(category);

    return {
        chemical,
        category,
        binColor,
        label,
        reason: reason || 'reason_unknown',
        reasonParams,
        isSafe: category !== 'UNKNOWN'
    };
};
