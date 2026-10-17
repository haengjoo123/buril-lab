import { describe, expect, it } from 'vitest';
import { toWasteContainerError, WasteContainerError } from './wasteContainerService';

describe('toWasteContainerError', () => {
    it.each([
        ['WASTE_CONTAINER_LABEL_IN_USE', 'label_in_use'],
        ['WASTE_CONTAINER_ALREADY_RECORDED', 'already_recorded'],
        ['WASTE_CONTAINER_LOG_PREDATES_CONTAINER', 'deposit_not_attachable'],
        ['WASTE_CONTAINER_LOG_VOIDED', 'deposit_not_attachable'],
        ['WASTE_CONTAINER_ADMIN_REQUIRED', 'admin_required'],
        ['WASTE_CONTAINER_SCOPE_MISMATCH', 'access_denied'],
        ['WASTE_CONTAINER_NOT_ACTIVE', 'not_active'],
        ['WASTE_CONTAINER_INVALID_INPUT', 'invalid_input'],
    ])('maps %s to %s', (message, code) => {
        expect(toWasteContainerError({ message, code: 'P0001' }).code).toBe(code);
    });

    it('leaves unrelated errors as unknown so the caller keeps its own message', () => {
        expect(toWasteContainerError(new Error('network down')).code).toBe('unknown');
        const existing = new WasteContainerError('collected', 'x');
        expect(toWasteContainerError(existing)).toBe(existing);
    });
});
