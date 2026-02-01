import type { AnalysisResult, DisposalCategory } from '../types';
import { determineDisposal } from './wasteDisposal';

export const analyzeMixture = (cart: AnalysisResult[]): {
    category: DisposalCategory;
    binColor: string;
    label: string;
    reason: string;
    isSafe: boolean;
    disposalDetails?: {
        solubility: 'SOLUBLE' | 'INSOLUBLE';
        neutralization: 'ALLOWED' | 'PROHIBITED';
    };
} => {
    if (cart.length === 0) {
        return {
            category: 'UNKNOWN',
            binColor: 'bg-gray-400',
            label: 'mix_label_unknown',
            reason: 'cart_empty',
            isSafe: true
        };
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

    // 1. Most Strict: Halogenated Organic
    if (hasHalogenOrganic) {
        return {
            category: 'ORGANIC_HALOGEN',
            binColor: 'bg-orange-600',
            label: 'mix_label_halogen',
            reason: 'mix_reason_halogen',
            isSafe: true
        };
    }

    // 2. Halogenated Organic (Already handled above)

    // Special Case: Alkali + Organic (Non-Halogenated)
    if (hasAlkali && hasNonHalogenOrganic) {
        const alkaliItems = cart.filter(item => item.category === 'ALKALI');
        const organicItems = cart.filter(item => item.category === 'ORGANIC_NON_HALOGEN');

        // Extract chemical objects
        const chemicals = [...alkaliItems, ...organicItems].map(r => r.chemical);
        const { solubilityStatus, neutralizationStatus, disposalMethod } = determineDisposal(chemicals);

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
                neutralization: neutralizationStatus
            }
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
                isSafe: false
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
            isSafe: true
        };
    }

    // 3. Inorganic (Acid/Alkali)
    if (hasAcid && hasAlkali) {
        return {
            category: 'UNKNOWN', // Or Special 'NEUTRALIZATION' status
            binColor: 'bg-purple-600', // Warning color
            label: 'mix_label_warn_aa',
            reason: 'mix_warn_acid_alkali',
            isSafe: false
        };
    }

    // Special Case: Alkali + Organic (Non-Halogenated)
    if (hasAlkali && hasNonHalogenOrganic) {
        const alkaliItems = cart.filter(item => item.category === 'ALKALI');
        const organicItems = cart.filter(item => item.category === 'ORGANIC_NON_HALOGEN');

        // Extract chemical objects
        const chemicals = [...alkaliItems, ...organicItems].map(r => r.chemical);
        const { solubilityStatus, neutralizationStatus, disposalMethod } = determineDisposal(chemicals);

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
                neutralization: neutralizationStatus
            }
        };
    }

    if (hasAcid) {
        return {
            category: 'ACID',
            binColor: 'bg-red-500',
            label: 'mix_label_acid',
            reason: 'mix_reason_acid',
            isSafe: true
        };
    }

    if (hasAlkali) {
        return {
            category: 'ALKALI',
            binColor: 'bg-blue-500',
            label: 'mix_label_alkali',
            reason: 'mix_reason_alkali',
            isSafe: true
        };
    }

    // Fallback
    return {
        category: 'UNKNOWN',
        binColor: 'bg-gray-400',
        label: 'mix_label_unknown',
        reason: 'mix_unknown',
        isSafe: false
    };
};
