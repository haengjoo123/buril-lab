import type { DisposalGuideResult } from '../services/aiDisposalGuideService';

const STANDARD_LABEL_REQUIREMENTS = new Set([
    '성분명', '주요성분명', '성분과양', '주요위험', '폐액전체량', '대략적인양또는양모름',
    'componentname', 'componentnames', 'componentsandamount', 'mainhazard', 'mainhazards',
    'majorhazard', 'majorhazards', 'totalwasteamount', 'approximateamountorunknown',
]);

export const isStandardLabelRequirement = (value: string): boolean =>
    STANDARD_LABEL_REQUIREMENTS.has(value.toLocaleLowerCase().replace(/[\s·•:：,./()_-]/g, ''));

/** Remove only server templates whose full content is shown in the destination/label panel. */
export function getDisposalGuideChecks(result: DisposalGuideResult): string[] {
    const duplicatedSteps = new Set<string>();
    if (result.decisionStatus === 'ready' && result.destination.depositAllowed) {
        const { destination } = result;
        duplicatedSteps.add(destination.location
            ? `${destination.location}에 있는 ${destination.name}을 사용하세요.`
            : `${destination.name}을 사용하세요. 정확한 위치는 연구실 폐기 정책에서 확인하세요.`);
        for (const instruction of destination.labelInstructions) {
            duplicatedSteps.add(`라벨: ${instruction}`);
        }
        if (destination.labelInstructions.length > 0) {
            duplicatedSteps.add(`라벨에 기재: ${destination.labelInstructions.join(', ')}`);
        }
    }
    return Array.from(new Set(result.steps)).filter((step) => !duplicatedSteps.has(step));
}
