import { describe, expect, it } from 'vitest';
import {
    hasCurrentSafetyAcknowledgement,
    LEGACY_SAFETY_ACKNOWLEDGEMENT_STORAGE_KEY,
    parseSafetyAcknowledgement,
    SAFETY_ACKNOWLEDGEMENT_STORAGE_KEY,
    SAFETY_DISCLAIMER_VERSION,
} from './SafetyDisclaimer';

function fakeStorage(entries: Record<string, string>): Pick<Storage, 'getItem'> {
    return { getItem: (key: string) => entries[key] ?? null };
}

describe('versioned safety acknowledgement', () => {
    const acknowledgedAt = '2026-08-24T00:00:00.000Z';

    it('accepts only the current version with a valid timestamp', () => {
        expect(parseSafetyAcknowledgement(JSON.stringify({
            version: SAFETY_DISCLAIMER_VERSION,
            acknowledgedAt,
        }))).toEqual({ version: SAFETY_DISCLAIMER_VERSION, acknowledgedAt });
        expect(parseSafetyAcknowledgement(JSON.stringify({
            version: 'old-version',
            acknowledgedAt,
        }))).toBeNull();
        expect(parseSafetyAcknowledgement(JSON.stringify({
            version: SAFETY_DISCLAIMER_VERSION,
            acknowledgedAt: 'invalid',
        }))).toBeNull();
    });

    it('requires a fresh acknowledgement instead of accepting the legacy boolean', () => {
        expect(hasCurrentSafetyAcknowledgement(fakeStorage({
            [LEGACY_SAFETY_ACKNOWLEDGEMENT_STORAGE_KEY]: 'true',
        }))).toBe(false);
        expect(hasCurrentSafetyAcknowledgement(fakeStorage({
            [SAFETY_ACKNOWLEDGEMENT_STORAGE_KEY]: JSON.stringify({
                version: SAFETY_DISCLAIMER_VERSION,
                acknowledgedAt,
            }),
        }))).toBe(true);
    });
});
