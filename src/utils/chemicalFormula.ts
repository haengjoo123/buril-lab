export type ElementCounts = Record<string, number>;

const hydrateSeparators = /[.\u00b7\u2022]/g;

/** Parse a molecular formula into element counts, including groups and hydrates. */
export const parseFormula = (formula: string): ElementCounts => {
    const totals: ElementCounts = {};
    const normalized = formula.replace(/\s+/g, '').replace(hydrateSeparators, '.');

    const addElements = (target: ElementCounts, source: ElementCounts, multiplier = 1) => {
        for (const [element, count] of Object.entries(source)) {
            target[element] = (target[element] || 0) + count * multiplier;
        }
    };

    const readNumber = (segment: string, start: number): { value: number; next: number } => {
        let end = start;
        while (/\d/.test(segment[end] || '')) end++;
        return {
            value: end > start ? parseInt(segment.slice(start, end), 10) : 1,
            next: end,
        };
    };

    const parseSegment = (segment: string): ElementCounts => {
        const stack: ElementCounts[] = [{}];
        let index = 0;

        while (index < segment.length) {
            const char = segment[index];

            if (char === '(' || char === '[') {
                stack.push({});
                index++;
                continue;
            }

            if (char === ')' || char === ']') {
                if (stack.length === 1) {
                    index++;
                    continue;
                }
                const group = stack.pop() || {};
                const multiplier = readNumber(segment, index + 1);
                addElements(stack[stack.length - 1], group, multiplier.value);
                index = multiplier.next;
                continue;
            }

            if (/[A-Z]/.test(char)) {
                let end = index + 1;
                if (/[a-z]/.test(segment[end] || '')) end++;
                const element = segment.slice(index, end);
                const count = readNumber(segment, end);
                stack[stack.length - 1][element] = (stack[stack.length - 1][element] || 0) + count.value;
                index = count.next;
                continue;
            }

            index++;
        }

        return stack[0];
    };

    for (const rawPart of normalized.split('.')) {
        if (!rawPart) continue;
        const coefficient = rawPart.match(/^(\d+)(?=[A-Z([])/);
        const multiplier = coefficient ? parseInt(coefficient[1], 10) : 1;
        const part = coefficient ? rawPart.slice(coefficient[1].length) : rawPart;
        addElements(totals, parseSegment(part), multiplier);
    }

    return totals;
};

/** Canonical elemental-composition key; equivalent formula notations share a key. */
export const formulaCompositionKey = (value: string | undefined): string => {
    const normalized = value?.replace(/\s+/g, '').replace(/\((?:aq|s|l|g)\)$/i, '') ?? '';
    if (!normalized) return '';

    try {
        const entries = Object.entries(parseFormula(normalized))
            .filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && entry[1] > 0)
            .sort(([left], [right]) => left.localeCompare(right));
        return entries.length > 0
            ? entries.map(([element, count]) => `${element}:${count}`).join('|')
            : normalized.toUpperCase();
    } catch {
        return normalized.toUpperCase();
    }
};
