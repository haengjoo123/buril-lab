import { COMMON_CHEMICALS } from '../../data/commonChemicals';
import { PH_CATALOG_RECORDS } from '../phPrediction/catalog';
import { hasCasNumberFormat, normalizeCasNumber } from '../../utils/casNumber';
import type { InventoryItem } from '../../services/inventoryService';

interface ChemicalSynonymEntry {
    /** Every known spelling, used to recognise what the user typed. */
    lookupTerms: string[];
    /** Spellings specific enough to look for inside an item name. */
    itemTerms: string[];
    casNumbers: string[];
}

const HANGUL_PATTERN = /[ㄱ-ㆎ가-힣]/;

/** Lower-case, width-normalised and space-free, so "염산 37%" ≈ "염산37%" and "Hydrochloric acid" ≈ "hydrochloricacid". */
export function compactSearchText(value?: string | null): string {
    return (value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function cleanSynonym(value: string): string {
    return value
        .replace(/\([^)]*\)/g, ' ')
        .replace(/^무수\s+/, '')
        .replace(/\bfree acid\b/i, ' ')
        .trim();
}

function isSpecificItemTerm(term: string): boolean {
    // Short formula keys such as "HCl" or "NaOH" would also hit "Tris-HCl".
    return HANGUL_PATTERN.test(term) ? term.length >= 2 : term.length >= 5;
}

let synonymEntries: ChemicalSynonymEntry[] | null = null;

/** Korean/English names and CAS numbers from the local chemical dictionaries the search tab uses. */
function getSynonymEntries(): ChemicalSynonymEntry[] {
    if (synonymEntries) return synonymEntries;

    const groups = new Map<string, { terms: Set<string>; cas: Set<string> }>();
    const addGroup = (groupKey: string, terms: string[], cas: string | null) => {
        const group = groups.get(groupKey) ?? { terms: new Set<string>(), cas: new Set<string>() };
        for (const term of terms) {
            const compact = compactSearchText(cleanSynonym(term));
            if (compact) group.terms.add(compact);
        }
        if (cas) group.cas.add(cas);
        groups.set(groupKey, group);
    };

    for (const [key, chemical] of Object.entries(COMMON_CHEMICALS)) {
        const cas = normalizeCasNumber(chemical.casNumber);
        addGroup(cas || chemical.name.toLowerCase(), hasCasNumberFormat(key) ? [chemical.name] : [chemical.name, key], cas);
    }
    for (const record of PH_CATALOG_RECORDS) {
        const cas = normalizeCasNumber(record.casNumber);
        addGroup(cas || record.id, [...record.names], cas);
    }

    synonymEntries = Array.from(groups.values()).map((group) => {
        const lookupTerms = Array.from(group.terms);
        return {
            lookupTerms,
            itemTerms: lookupTerms.filter(isSpecificItemTerm),
            casNumbers: Array.from(group.cas),
        };
    });
    return synonymEntries;
}

function entryMatchesQuery(entry: ChemicalSynonymEntry, compactQuery: string): boolean {
    return entry.lookupTerms.some((term) => (
        term.startsWith(compactQuery)
        || (compactQuery.includes(term) && isSpecificItemTerm(term))
    ));
}

/**
 * Builds a matcher for the inventory search box. Besides plain substring
 * matching on name/brand/product number/CAS it understands Korean and English
 * chemical names ("염산" finds "Hydrochloric acid 37%") and CAS equivalence
 * ("염산" finds an item that only carries CAS 7647-01-0).
 */
export function createInventorySearchMatcher(query: string): ((item: InventoryItem) => boolean) | null {
    const lowerQuery = query.trim().toLowerCase();
    if (!lowerQuery) return null;
    const compactQuery = compactSearchText(lowerQuery);
    const minimumLength = HANGUL_PATTERN.test(compactQuery) ? 2 : 3;
    const entries = compactQuery.length >= minimumLength
        ? getSynonymEntries().filter((entry) => entryMatchesQuery(entry, compactQuery))
        : [];
    const itemTerms = Array.from(new Set(entries.flatMap((entry) => entry.itemTerms)));
    const casNumbers = new Set(entries.flatMap((entry) => entry.casNumbers));
    const queryCas = normalizeCasNumber(lowerQuery);
    if (queryCas) casNumbers.add(queryCas);

    return (item) => {
        if (
            item.name.toLowerCase().includes(lowerQuery)
            || Boolean(item.brand && item.brand.toLowerCase().includes(lowerQuery))
            || Boolean(item.product_number && item.product_number.toLowerCase().includes(lowerQuery))
            || Boolean(item.cas_number && item.cas_number.toLowerCase().includes(lowerQuery))
        ) {
            return true;
        }

        const compactName = compactSearchText(item.name);
        if (compactQuery && compactName.includes(compactQuery)) return true;

        const itemCas = normalizeCasNumber(item.cas_number);
        if (itemCas && casNumbers.has(itemCas)) return true;

        return itemTerms.some((term) => compactName.includes(term));
    };
}
