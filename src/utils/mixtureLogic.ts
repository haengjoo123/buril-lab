import type {
    AnalysisResult,
    CartItem,
    MixtureAnalysisBasis,
    MixtureAnalysisResult,
    SolutionContext,
} from '../types';
import { determineDisposal } from './wasteDisposal';
import { checkCompatibility } from './compatibilityChecker';

type BaseMixtureResult = Omit<
    MixtureAnalysisResult,
    'basis' | 'baseLabel' | 'baseReason' | 'contextWarnings'
>;

const HIGH_PRIORITY_CATEGORIES = [
    'SPECIAL_HAZARD',
    'REACTIVE',
    'CYANIDE',
    'HEAVY_METAL',
] as const;

type HighPriorityCategory = (typeof HIGH_PRIORITY_CATEGORIES)[number];

const HIGH_PRIORITY_RESULT_MAP: Record<HighPriorityCategory, BaseMixtureResult> = {
    SPECIAL_HAZARD: {
        category: 'SPECIAL_HAZARD',
        binColor: 'bg-red-800',
        label: 'label_special_hazard',
        reason: 'disposal_guide_SPECIAL_HAZARD',
        isSafe: false,
    },
    REACTIVE: {
        category: 'REACTIVE',
        binColor: 'bg-rose-600',
        label: 'label_reactive',
        reason: 'disposal_guide_REACTIVE',
        isSafe: false,
    },
    CYANIDE: {
        category: 'CYANIDE',
        binColor: 'bg-teal-600',
        label: 'label_cyanide',
        reason: 'disposal_guide_CYANIDE',
        isSafe: false,
    },
    HEAVY_METAL: {
        category: 'HEAVY_METAL',
        binColor: 'bg-purple-600',
        label: 'label_heavy_metal',
        reason: 'disposal_guide_HEAVY_METAL',
        isSafe: false,
    },
};

const withBasis = (
    result: BaseMixtureResult,
    basis: MixtureAnalysisBasis,
): MixtureAnalysisResult => ({
    ...result,
    basis,
});

const withContext = (
    result: BaseMixtureResult,
    basis: Exclude<MixtureAnalysisBasis, 'pure'>,
    baseResult: BaseMixtureResult,
    contextWarnings: string[] = [],
): MixtureAnalysisResult => ({
    ...result,
    basis,
    baseLabel: baseResult.label,
    baseReason: baseResult.reason,
    contextWarnings: contextWarnings.length > 0 ? contextWarnings : undefined,
});

const getSolutionContext = (item: AnalysisResult): SolutionContext | undefined => {
    if ('solutionContext' in item) {
        return (item as Partial<CartItem>).solutionContext;
    }

    return undefined;
};

const findHighPriorityCategory = (cart: AnalysisResult[]): HighPriorityCategory | undefined =>
    HIGH_PRIORITY_CATEGORIES.find((category) => cart.some((item) => item.category === category));

const hasAnySolutionContext = (contexts: Array<SolutionContext | undefined>): boolean =>
    contexts.some((context) =>
        Boolean(context) &&
        context?.physicalForm !== 'neat_or_solid' &&
        context?.solventClass !== 'none'
    );

const analyzePureCategoryMixture = (cart: AnalysisResult[]): BaseMixtureResult => {
    if (cart.length === 0) {
        return {
            category: 'UNKNOWN',
            binColor: 'bg-gray-400',
            label: 'mix_label_unknown',
            reason: 'cart_empty',
            isSafe: true,
        };
    }

    const highPriorityCategory = findHighPriorityCategory(cart);
    if (highPriorityCategory) {
        return HIGH_PRIORITY_RESULT_MAP[highPriorityCategory];
    }

    // Priority Level: Higher index = More Strict/Dangerous
    // 0: Unknown / Safe?
    // 1: Organic Non-Halogen (Yellow)
    // 2: Acid / Alkali (Inorganic) - Red/Blue
    // 3: Organic Halogen (Orange) - Most Strict usually due to incineration cost/method

    // Actually, standard lab rules often prioritize:
    // 1. Halogenated Organic -> Separate container (strictly)
    // 2. Non-halogenated Organic -> Separate container
    // 3. Acids -> Neutralize or Acid bin
    // 4. Alkalis -> Neutralize or Alkali bin
    // ** DO NOT MIX ACID & ALKALI without neutralization **
    // ** DO NOT MIX ORGANIC & INORGANIC usually **

    // Let's sweep through the cart
    const hasHalogenOrganic = cart.some(item => item.category === 'ORGANIC_HALOGEN');
    const hasNonHalogenOrganic = cart.some(item => item.category === 'ORGANIC_NON_HALOGEN');
    const hasAcid = cart.some(item => item.category === 'ACID');
    const hasAlkali = cart.some(item => item.category === 'ALKALI');
    const hasNeutral = cart.some(item => item.category === 'NEUTRAL');
    const hasSolidWaste = cart.some(item => item.category === 'SOLID_WASTE');

    // Helper arrays for specific acids
    const OXIDIZING_ACIDS = ['NITRIC', 'HNO3', 'PERCHLORIC', 'HCLO4'];
    const REDUCING_HALIDE_ACIDS = ['HYDROCHLORIC', 'HCL', 'HYDROBROMIC', 'HBR'];
    const HYDROFLUORIC_ACIDS = ['HYDROFLUORIC', 'HF'];

    const hasOxidizingAcid = cart.some(item =>
        OXIDIZING_ACIDS.some(keyword =>
            item.chemical.name?.toUpperCase().includes(keyword) ||
            item.chemical.molecularFormula?.toUpperCase().includes(keyword)
        )
    );

    const hasReducingAcid = cart.some(item =>
        REDUCING_HALIDE_ACIDS.some(keyword =>
            item.chemical.name?.toUpperCase().includes(keyword) ||
            item.chemical.molecularFormula?.toUpperCase().includes(keyword)
        )
    );

    const hasHydrofluoricAcid = cart.some(item =>
        HYDROFLUORIC_ACIDS.some(keyword =>
            item.chemical.name?.toUpperCase().includes(keyword) ||
            item.chemical.molecularFormula?.toUpperCase().includes(keyword)
        )
    );

    // 1. Most Strict: Halogenated Organic
    if (hasHalogenOrganic) {
        return {
            category: 'ORGANIC_HALOGEN',
            binColor: 'bg-orange-600',
            label: 'mix_label_halogen',
            reason: 'mix_reason_halogen',
            isSafe: true,
        };
    }

    // 2. Halogenated Organic (Already handled above)

    // Special Case: Alkali + Organic (Non-Halogenated)
    if (hasAlkali && hasNonHalogenOrganic) {
        const alkaliItems = cart.filter(item => item.category === 'ALKALI');
        const organicItems = cart.filter(item => item.category === 'ORGANIC_NON_HALOGEN');
        const hasCriticalReactivePair = checkCompatibility(cart as CartItem[]).some((warning) =>
            warning.ruleId === 'oxidizer_flammable' ||
            warning.ruleId === 'water_reactive' ||
            warning.ruleId === 'self_reactive' ||
            warning.ruleId === 'pyrophoric' ||
            warning.ruleId === 'explosive'
        );

        // Extract chemical objects
        const chemicals = [...alkaliItems, ...organicItems].map(r => r.chemical);
        const { solubilityStatus, neutralizationStatus, disposalMethod } = determineDisposal(chemicals);
        if (hasCriticalReactivePair) {
            return {
                category: 'UNKNOWN',
                binColor: 'bg-orange-600',
                label: 'mix_label_reactive_organic',
                reason: 'disposal_method_case2',
                isSafe: false,
                disposalDetails: {
                    solubility: solubilityStatus,
                    neutralization: 'PROHIBITED',
                },
            };
        }

        // Determine color based on Case
        let color = 'bg-red-700'; // Default Dangerous (Case 3: Insoluble)

        if (neutralizationStatus === 'ALLOWED') {
            color = 'bg-blue-600'; // Case 1: Safe
        } else if (solubilityStatus === 'SOLUBLE') {
            color = 'bg-orange-600'; // Case 2: Soluble but Prohibited (Reactive)
        }

        return {
            category: 'UNKNOWN', // Or 'MIXED_WASTE' logic
            binColor: color,
            label: 'mix_label_alkali_organic',
            reason: disposalMethod, // Use the disposal method key as the main reason/instruction
            isSafe: neutralizationStatus === 'ALLOWED',
            disposalDetails: {
                solubility: solubilityStatus,
                neutralization: neutralizationStatus,
            },
        };
    }

    // 3. Non-Halogenated Organic (Generic)
    if (hasNonHalogenOrganic) {
        // Check if mixed with Acid (since Alkali is handled above)
        if (hasAcid) {
            return {
                category: 'UNKNOWN',
                binColor: 'bg-red-600',
                label: 'mix_label_warn_oi',
                reason: 'mix_warn_organic_inorganic',
                isSafe: false,
            };
        }
        // If Logic falls through here, it means it's just Organic, or Organic + something else not caught?
        // Wait, if hasAlkali was true, we returned above.
        // So here hasAlkali is false.

        return {
            category: 'ORGANIC_NON_HALOGEN',
            binColor: 'bg-yellow-500',
            label: 'mix_label_organic',
            reason: 'mix_reason_organic',
            isSafe: true,
        };
    }

    // 3. Inorganic (Acid/Alkali)
    if (hasAcid && hasAlkali) {
        return {
            category: 'UNKNOWN', // Or Special 'NEUTRALIZATION' status
            binColor: 'bg-purple-600', // Warning color
            label: 'mix_label_warn_aa',
            reason: 'mix_warn_acid_alkali',
            isSafe: false,
        };
    }

    if (hasAcid) {
        // Specific strict rules for acids
        if (hasHydrofluoricAcid && cart.length > 1) {
            return {
                category: 'UNKNOWN',
                binColor: 'bg-red-700',
                label: 'mix_label_warn_hf',
                reason: 'mix_warn_hf',
                isSafe: false,
            };
        }

        if (hasOxidizingAcid && (hasReducingAcid || hasNonHalogenOrganic || hasHalogenOrganic)) {
            return {
                category: 'UNKNOWN',
                binColor: 'bg-red-700',
                label: 'mix_label_warn_incompatible_acids',
                reason: 'mix_warn_incompatible_acids',
                isSafe: false,
            };
        }

        return {
            category: 'ACID',
            binColor: 'bg-red-500',
            label: 'mix_label_acid',
            reason: 'mix_reason_acid',
            isSafe: true,
        };
    }

    if (hasAlkali) {
        return {
            category: 'ALKALI',
            binColor: 'bg-blue-500',
            label: 'mix_label_alkali',
            reason: 'mix_reason_alkali',
            isSafe: true,
        };
    }

    if (hasNeutral && cart.every((item) => item.category === 'NEUTRAL')) {
        return {
            category: 'NEUTRAL',
            binColor: 'bg-green-500',
            label: 'label_neutral',
            reason: 'disposal_guide_NEUTRAL',
            isSafe: true,
        };
    }

    if (hasSolidWaste && cart.every((item) => item.category === 'SOLID_WASTE')) {
        return {
            category: 'SOLID_WASTE',
            binColor: 'bg-stone-500',
            label: 'label_solid_waste',
            reason: 'disposal_guide_SOLID_WASTE',
            isSafe: true,
        };
    }

    // Fallback
    return {
        category: 'UNKNOWN',
        binColor: 'bg-gray-400',
        label: 'mix_label_unknown',
        reason: 'mix_unknown',
        isSafe: false,
    };
};

export const analyzeMixture = (cart: AnalysisResult[]): MixtureAnalysisResult => {
    const baseResult = analyzePureCategoryMixture(cart);

    if (cart.length === 0) {
        return withBasis(baseResult, 'pure');
    }

    const contexts = cart.map(getSolutionContext);
    const hasUnknownMatrix = contexts.some((context) =>
        context?.physicalForm === 'mixed_or_unknown' ||
        context?.solventClass === 'mixed_or_unknown'
    );
    const hasUnknownOrganicSolvent = contexts.some((context) =>
        context?.physicalForm === 'organic_solvent' &&
        context?.solventClass === 'organic_unknown'
    );
    const highPriorityCategory = findHighPriorityCategory(cart);
    const hasSolutionContext = hasAnySolutionContext(contexts);
    const hasHalogenOrganicSolvent = contexts.some((context) =>
        context?.physicalForm === 'organic_solvent' &&
        context?.solventClass === 'organic_halogen'
    );
    const hasNonHalogenOrganicSolvent = contexts.some((context) =>
        context?.physicalForm === 'organic_solvent' &&
        context?.solventClass === 'organic_non_halogen'
    );
    const hasAqueous = contexts.some((context) =>
        context?.physicalForm === 'aqueous' ||
        context?.solventClass === 'aqueous'
    );
    const hasAcidOrAlkaliSolute = cart.some((item) =>
        item.category === 'ACID' ||
        item.category === 'ALKALI'
    );
    const hasOrganicSolute = cart.some((item) =>
        item.category === 'ORGANIC_HALOGEN' ||
        item.category === 'ORGANIC_NON_HALOGEN'
    );
    const hasHalogenOrganicSolute = cart.some((item) =>
        item.category === 'ORGANIC_HALOGEN'
    );

    if (hasUnknownMatrix) {
        return withContext(
            {
                category: 'UNKNOWN',
                binColor: 'bg-amber-600',
                label: 'mix_label_unknown_matrix',
                reason: 'mix_reason_unknown_matrix',
                isSafe: false,
            },
            'unknown_matrix',
            baseResult,
            ['mix_context_warning_unknown_matrix'],
        );
    }

    if (hasUnknownOrganicSolvent) {
        return withContext(
            {
                category: 'UNKNOWN',
                binColor: 'bg-amber-600',
                label: 'mix_label_organic_solvent_unknown',
                reason: 'mix_reason_organic_solvent_unknown',
                isSafe: false,
            },
            'unknown_matrix',
            baseResult,
            ['mix_context_warning_solvent_unverified'],
        );
    }

    if (highPriorityCategory) {
        const highPriorityResult = HIGH_PRIORITY_RESULT_MAP[highPriorityCategory];

        if (!hasSolutionContext) {
            return withBasis(highPriorityResult, 'pure');
        }

        return withContext(
            highPriorityResult,
            'solution',
            baseResult,
            ['mix_context_warning_hazard_with_solvent'],
        );
    }

    if (hasHalogenOrganicSolvent) {
        return withContext(
            {
                category: 'ORGANIC_HALOGEN',
                binColor: 'bg-orange-600',
                label: 'mix_label_halogen',
                reason: 'mix_reason_halogen_solvent_context',
                isSafe: !hasAcidOrAlkaliSolute,
            },
            'solution',
            baseResult,
            hasAcidOrAlkaliSolute
                ? ['mix_context_warning_solvent_override', 'mix_context_warning_organic_inorganic_context']
                : ['mix_context_warning_solvent_override'],
        );
    }

    if (hasNonHalogenOrganicSolvent) {
        if (hasAcidOrAlkaliSolute) {
            return withContext(
                {
                    category: 'UNKNOWN',
                    binColor: 'bg-red-600',
                    label: 'mix_label_warn_oi',
                    reason: 'mix_warn_organic_inorganic',
                    isSafe: false,
                },
                'solution',
                baseResult,
                ['mix_context_warning_solvent_override'],
            );
        }

        if (hasHalogenOrganicSolute) {
            return withContext(
                {
                    category: 'ORGANIC_HALOGEN',
                    binColor: 'bg-orange-600',
                    label: 'mix_label_halogen',
                    reason: 'mix_reason_halogen_solute_context',
                    isSafe: true,
                },
                'solution',
                baseResult,
                ['mix_context_warning_halogen_solute'],
            );
        }

        return withContext(
            {
                category: 'ORGANIC_NON_HALOGEN',
                binColor: 'bg-yellow-500',
                label: 'mix_label_organic',
                reason: 'mix_reason_organic_solvent_context',
                isSafe: true,
            },
            'solution',
            baseResult,
            ['mix_context_warning_solvent_override'],
        );
    }

    if (hasAqueous) {
        if (hasOrganicSolute) {
            return withContext(
                {
                    category: 'UNKNOWN',
                    binColor: 'bg-cyan-700',
                    label: 'mix_label_aqueous_organic_check',
                    reason: 'mix_reason_aqueous_organic_check',
                    isSafe: false,
                },
                'solution',
                baseResult,
                ['mix_context_warning_aqueous_no_downgrade'],
            );
        }

        return withBasis(baseResult, 'solution');
    }

    return withBasis(baseResult, 'pure');
};
