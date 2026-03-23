import type { ReagentTemplateType } from '../types/fridge';

/**
 * 용량/메모 문자열로 시약장 3D 템플릿 추론 (A–D).
 * 유리병(D)은 투명·유리·glass·clear 등 키워드로 판별.
 */
export function guessTemplateFromCapacity(capacity: string): ReagentTemplateType {
    const trimmed = (capacity || '').trim();
    if (!trimmed) return 'A';

    const lower = trimmed.toLowerCase();
    const numMatch = lower.match(/(\d+)/);
    const num = numMatch ? Number.parseInt(numMatch[1], 10) : 0;

    if (/갈색|앰버|\bamber\b|\bbrown\b/i.test(trimmed)) return 'A';
    if (/플라스틱|\bplastic\b/i.test(trimmed)) return 'B';
    if (/투명|유리\s*병|유리병|글라스|\bglass\b|\bclear\b|\bborosilicate\b/i.test(trimmed)) return 'D';

    if (lower.includes('kg') || num >= 2500) return 'C';
    if (lower.includes('l') && !lower.includes('ml')) return 'A';
    if (num >= 500) return 'A';
    if (num >= 100) return 'A';
    return 'B';
}

export function getWidthForTemplate(template: ReagentTemplateType): number {
    switch (template) {
        case 'A': return 8;
        case 'B': return 10;
        case 'C': return 15;
        case 'D': return 8;
        default: return 8;
    }
}
