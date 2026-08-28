import type {
    ReagentScanIdentityField,
    ReagentScanResult,
} from '../services/aiReagentScanService';
import { isValidCasNumber, normalizeCasNumber } from './casNumber';

const normalizeIdentityName = (value?: string | null): string => (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Re-check label identity against the actual search result. Selecting an OCR
 * candidate confirms the query, not whatever a fuzzy search later returns.
 */
export function scanIdentityMatchesChemical(
    scan: ReagentScanResult,
    selectedField: ReagentScanIdentityField,
    chemical: { name: string; casNumber?: string | null },
): boolean {
    const snapshots = scan.fieldSnapshots;
    if (!scan.success || !snapshots) return false;

    const casSnapshot = snapshots.casNumber;
    const hasValidatedCas = casSnapshot.validation === 'valid'
        && isValidCasNumber(casSnapshot.value);
    const casMatches = !hasValidatedCas || (
        normalizeCasNumber(casSnapshot.value) === normalizeCasNumber(chemical.casNumber)
    );

    if (selectedField === 'casNumber') {
        return hasValidatedCas && casMatches;
    }

    return snapshots.name.validation === 'valid'
        && normalizeIdentityName(snapshots.name.value) === normalizeIdentityName(chemical.name)
        && casMatches;
}
