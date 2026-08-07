import type { ReagentTemplateType } from '../types/fridge';
import { parseCapacityMeasurement } from './capacityParser';

/**
 * 용량/메모 문자열로 시약장 3D 템플릿 추론 (A–D).
 * 유리병(C)은 투명·유리·glass·clear 등 키워드로 판별.
 */
export function guessTemplateFromCapacity(capacity: string): ReagentTemplateType {
    const trimmed = (capacity || '').trim();
    if (!trimmed) return 'A';

    const lower = trimmed.toLowerCase();
    const parsedCapacity = parseCapacityMeasurement(trimmed);
    const num = parsedCapacity.numericValue ?? 0;

    if (/갈색|앰버|\bamber\b|\bbrown\b/i.test(trimmed)) return 'A';
    if (/플라스틱|\bplastic\b/i.test(trimmed)) return 'B';
    if (/투명|유리\s*병|유리병|글라스|\bglass\b|\bclear\b|\bborosilicate\b/i.test(trimmed)) return 'C';
    if (/사각|스퀘어|\bsquare\b/i.test(trimmed)) return 'D';

    if (lower.includes('kg') || num >= 2500) return 'D';
    if (lower.includes('l') && !lower.includes('ml')) return 'A';
    if (num >= 500) return 'A';
    if (num >= 100) return 'A';
    return 'B';
}

export function getWidthForTemplate(template: ReagentTemplateType): number {
    switch (template) {
        case 'A': return 8;
        case 'B': return 10;
        case 'C': return 8;
        case 'D': return 10;
        default: return 8;
    }
}
