import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem, DisposalCategory } from '../types';
import { createEmptyWasteBatch, createWasteComponentFromAnalysis } from '../utils/wasteBatch';
import { useWasteStore } from './useWasteStore';

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();

    get length(): number {
        return this.values.size;
    }

    clear(): void {
        this.values.clear();
    }

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    key(index: number): string | null {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}

const V2_PREFIX = 'buril-waste-batch-v2:';
const LEGACY_KEY = 'buril-waste-store';

function cartItem(
    id: string,
    name: string,
    category: DisposalCategory = 'ORGANIC_NON_HALOGEN',
): CartItem {
    return {
        chemical: {
            id,
            name,
            casNumber: '67-64-1',
            molecularFormula: 'C3H6O',
            properties: {
                isOrganic: true,
                isHalogenated: false,
            },
        },
        category,
        binColor: 'bg-yellow-500',
        label: `label_${category.toLowerCase()}`,
        reason: `reason_${category.toLowerCase()}`,
        isSafe: true,
    };
}

function resetStore(): void {
    const batch = createEmptyWasteBatch({
        id: 'anonymous-batch',
        scopeKey: 'anonymous:personal',
        now: '2026-08-02T00:00:00.000Z',
    });

    useWasteStore.setState({
        scopeKey: 'anonymous:personal',
        batch,
        parkedBatches: [],
        cart: batch.components,
        previousMatrix: null,
        aiGuide: null,
        aiLoading: false,
        aiError: false,
        recentSearches: [],
    });
}

describe('useWasteStore V2 batch isolation', () => {
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
        vi.stubGlobal('localStorage', storage);
        resetStore();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps drafts isolated by user and lab and hides them after logout', () => {
        const store = useWasteStore.getState();

        store.setScope('user-a', 'lab-a');
        useWasteStore.getState().addToCart(cartItem('acetone', 'Acetone'));

        expect(storage.getItem(`${V2_PREFIX}user-a:lab-a`)).not.toBeNull();
        expect(useWasteStore.getState().cart.map(({ chemical }) => chemical.name)).toEqual([
            'Acetone',
        ]);

        useWasteStore.getState().setScope('user-a', 'lab-b');
        expect(useWasteStore.getState().cart).toEqual([]);
        useWasteStore.getState().addToCart(cartItem('dcm', 'Dichloromethane', 'ORGANIC_HALOGEN'));

        useWasteStore.getState().setScope('user-b', 'lab-a');
        expect(useWasteStore.getState().cart).toEqual([]);

        useWasteStore.getState().setScope('user-a', 'lab-a');
        expect(useWasteStore.getState().cart.map(({ chemical }) => chemical.name)).toEqual([
            'Acetone',
        ]);

        useWasteStore.getState().setScope(null, null);
        expect(useWasteStore.getState().scopeKey).toBe('anonymous:personal');
        expect(useWasteStore.getState().cart).toEqual([]);

        useWasteStore.getState().setScope('user-a', 'lab-b');
        expect(useWasteStore.getState().cart.map(({ chemical }) => chemical.name)).toEqual([
            'Dichloromethane',
        ]);
    });

    it('stores a versioned owner-scoped envelope and restores only that draft', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().addToCart(cartItem('acetone', 'Acetone'));

        const storageKey = `${V2_PREFIX}user-a:lab-a`;
        const stored = JSON.parse(storage.getItem(storageKey) ?? '{}') as {
            schemaVersion?: number;
            ownerUserId?: string;
            scopeKey?: string;
            draft?: { components?: Array<{ chemical?: { name?: string } }> };
            parkedDrafts?: unknown[];
        };
        expect(stored.schemaVersion).toBe(3);
        expect(stored.ownerUserId).toBe('user-a');
        expect(stored.scopeKey).toBe('user-a:lab-a');
        expect(stored.draft?.components?.[0]?.chemical?.name).toBe('Acetone');
        expect(stored.parkedDrafts).toEqual([]);

        resetStore();
        useWasteStore.getState().setScope('user-a', 'lab-a');
        expect(useWasteStore.getState().cart.map(({ chemical }) => chemical.name)).toEqual([
            'Acetone',
        ]);
    });

    it('upgrades an owner-matched raw V2 draft to the versioned envelope', () => {
        const rawDraft = createEmptyWasteBatch({
            id: 'raw-v2-batch',
            scopeKey: 'user-a:lab-a',
            userId: 'user-a',
            labId: 'lab-a',
            now: '2026-08-02T00:00:00.000Z',
        });
        rawDraft.components = [
            createWasteComponentFromAnalysis(cartItem('acetone', 'Acetone')),
        ];
        const storageKey = `${V2_PREFIX}user-a:lab-a`;
        storage.setItem(storageKey, JSON.stringify(rawDraft));

        useWasteStore.getState().setScope('user-a', 'lab-a');

        expect(useWasteStore.getState().batch.id).toBe('raw-v2-batch');
        expect(useWasteStore.getState().cart[0].chemical.name).toBe('Acetone');
        const upgraded = JSON.parse(storage.getItem(storageKey) ?? '{}') as {
            schemaVersion?: number;
            ownerUserId?: string;
            draft?: { id?: string };
        };
        expect(upgraded).toMatchObject({
            schemaVersion: 3,
            ownerUserId: 'user-a',
            draft: { id: 'raw-v2-batch' },
        });
    });

    it('restores a schema-2 envelope and normalizes its missing incident context', () => {
        const legacyDraft = createEmptyWasteBatch({
            id: 'schema-2-batch',
            scopeKey: 'user-a:lab-a',
            userId: 'user-a',
            labId: 'lab-a',
            now: '2026-08-02T00:00:00.000Z',
        });
        legacyDraft.components = [
            createWasteComponentFromAnalysis(cartItem('acetone', 'Acetone')),
        ];
        const draftWithoutIncidentContext: Partial<typeof legacyDraft> = { ...legacyDraft };
        delete draftWithoutIncidentContext.incidentContext;
        const storageKey = `${V2_PREFIX}user-a:lab-a`;
        storage.setItem(storageKey, JSON.stringify({
            schemaVersion: 2,
            ownerUserId: 'user-a',
            scopeKey: 'user-a:lab-a',
            draft: draftWithoutIncidentContext,
        }));

        useWasteStore.getState().setScope('user-a', 'lab-a');

        expect(useWasteStore.getState().batch).toMatchObject({
            id: 'schema-2-batch',
            incidentContext: 'none',
        });
        const upgraded = JSON.parse(storage.getItem(storageKey) ?? '{}') as {
            schemaVersion?: number;
            draft?: { incidentContext?: string };
            parkedDrafts?: unknown[];
        };
        expect(upgraded).toMatchObject({
            schemaVersion: 3,
            draft: { incidentContext: 'none' },
            parkedDrafts: [],
        });
    });

    it('ignores a raw V2 draft whose embedded owner does not match the scope', () => {
        const mismatchedDraft = createEmptyWasteBatch({
            scopeKey: 'user-a:lab-a',
            userId: 'user-b',
            labId: 'lab-a',
        });
        mismatchedDraft.components = [
            createWasteComponentFromAnalysis(cartItem('acetone', 'Acetone')),
        ];
        storage.setItem(`${V2_PREFIX}user-a:lab-a`, JSON.stringify(mismatchedDraft));

        useWasteStore.getState().setScope('user-a', 'lab-a');

        expect(useWasteStore.getState().cart).toEqual([]);
    });

    it('drops cross-owner parked entries from an otherwise valid scoped envelope', () => {
        const activeDraft = createEmptyWasteBatch({
            id: 'active-a',
            scopeKey: 'user-a:lab-a',
            userId: 'user-a',
            labId: 'lab-a',
        });
        const foreignParkedDraft = createEmptyWasteBatch({
            id: 'parked-b',
            scopeKey: 'user-b:lab-a',
            userId: 'user-b',
            labId: 'lab-a',
        });
        foreignParkedDraft.components = [
            createWasteComponentFromAnalysis(cartItem('acetone', 'Acetone')),
        ];
        storage.setItem(`${V2_PREFIX}user-a:lab-a`, JSON.stringify({
            schemaVersion: 3,
            ownerUserId: 'user-a',
            scopeKey: 'user-a:lab-a',
            draft: activeDraft,
            parkedDrafts: [foreignParkedDraft],
        }));

        useWasteStore.getState().setScope('user-a', 'lab-a');

        expect(useWasteStore.getState().batch.id).toBe('active-a');
        expect(useWasteStore.getState().parkedBatches).toEqual([]);
    });

    it('allows duplicate chemicals with different cartLineIds and removes one line only', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        const acetone = cartItem('acetone', 'Acetone');

        useWasteStore.getState().addToCart(acetone);
        useWasteStore.getState().addToCart(acetone);

        const before = useWasteStore.getState().cart;
        expect(before).toHaveLength(2);
        expect(new Set(before.map(({ cartLineId }) => cartLineId)).size).toBe(2);

        useWasteStore.getState().removeFromCart(before[1].cartLineId);

        const after = useWasteStore.getState().cart;
        expect(after).toHaveLength(1);
        expect(after[0].cartLineId).toBe(before[0].cartLineId);
        expect(after[0].chemical.id).toBe('acetone');
    });

    it('auto-estimates a known solvent matrix but keeps it editable', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().addToCart(cartItem('702', 'Acetone'));

        expect(useWasteStore.getState().batch).toMatchObject({
            matrix: 'organic_non_halogenated',
            matrixSource: 'automatic',
        });

        useWasteStore.getState().setMatrix('aqueous');
        expect(useWasteStore.getState().batch).toMatchObject({
            matrix: 'aqueous',
            matrixSource: 'user',
        });
    });

    it('updates an automatic matrix when later strong evidence changes the batch', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        const acetone = cartItem('acetone', 'Acetone');
        const dcm = cartItem('dcm', 'Dichloromethane', 'ORGANIC_HALOGEN');
        dcm.chemical.casNumber = '75-09-2';
        dcm.chemical.molecularFormula = 'CH2Cl2';
        dcm.chemical.properties = { isOrganic: true, isHalogenated: true };

        useWasteStore.getState().addToCart(acetone);
        expect(useWasteStore.getState().batch.matrix).toBe('organic_non_halogenated');

        useWasteStore.getState().addToCart(dcm);
        expect(useWasteStore.getState().batch).toMatchObject({
            matrix: 'organic_halogenated',
            matrixSource: 'automatic',
        });

        const dcmLineId = useWasteStore.getState().cart.find(
            ({ chemical }) => chemical.name === 'Dichloromethane',
        )?.cartLineId;
        expect(dcmLineId).toBeTruthy();
        useWasteStore.getState().removeFromCart(dcmLineId as string);
        expect(useWasteStore.getState().batch).toMatchObject({
            matrix: 'organic_non_halogenated',
            matrixSource: 'automatic',
        });
    });

    it('asks for matrix confirmation when strong automatic evidence conflicts across dimensions', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().addToCart(cartItem('acetone', 'Acetone'));
        useWasteStore.getState().setTotalAmount({ value: 250, unit: 'mL' });
        useWasteStore.getState().addToCart(
            cartItem('absorbent', 'Contaminated absorbent', 'SOLID_WASTE'),
        );

        expect(useWasteStore.getState().batch).toMatchObject({
            matrix: 'unknown',
            matrixSource: 'unresolved',
        });
        // The original value remains available until the user resolves the
        // matrix, but changing to mass clears it instead of converting it.
        useWasteStore.getState().setMatrix('solid_slurry');
        expect(useWasteStore.getState().batch.totalAmount.value).toBeNull();
    });

    it('stores and reuses the previous confirmed matrix only within the same scope', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().setMatrix('organic_halogenated');
        useWasteStore.getState().rememberCurrentMatrix();
        useWasteStore.getState().clearCart();

        expect(useWasteStore.getState().previousMatrix).toBe('organic_halogenated');
        useWasteStore.getState().applyPreviousMatrix();
        expect(useWasteStore.getState().batch.matrix).toBe('organic_halogenated');

        useWasteStore.getState().setScope('user-b', 'lab-a');
        expect(useWasteStore.getState().previousMatrix).toBeNull();
    });

    it('parks a populated batch with a readable name and restores it only into an empty draft', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().addToCart(cartItem('acetone', 'Acetone'));
        useWasteStore.getState().setIncidentContext('leak');
        const originalBatchId = useWasteStore.getState().batch.id;

        expect(useWasteStore.getState().parkCurrentBatch()).toBe(true);

        const parked = useWasteStore.getState().parkedBatches[0];
        expect(parked).toMatchObject({
            id: originalBatchId,
            displayName: 'Acetone 폐액',
            incidentContext: 'leak',
        });
        expect(Number.isNaN(Date.parse(parked.parkedAt ?? ''))).toBe(false);
        expect(useWasteStore.getState().batch.id).not.toBe(originalBatchId);
        expect(useWasteStore.getState().cart).toEqual([]);
        expect(useWasteStore.getState().batch.incidentContext).toBe('none');

        useWasteStore.getState().addToCart(
            cartItem('dcm', 'Dichloromethane', 'ORGANIC_HALOGEN'),
        );
        expect(useWasteStore.getState().restoreParkedBatch(originalBatchId)).toBe(false);
        expect(useWasteStore.getState().cart[0].chemical.name).toBe('Dichloromethane');

        useWasteStore.getState().clearCart();
        expect(useWasteStore.getState().restoreParkedBatch(originalBatchId)).toBe(true);
        expect(useWasteStore.getState().batch).toMatchObject({
            id: originalBatchId,
            displayName: 'Acetone 폐액',
            parkedAt: undefined,
            incidentContext: 'leak',
        });
        expect(useWasteStore.getState().cart[0].chemical.name).toBe('Acetone');
        expect(useWasteStore.getState().parkedBatches).toEqual([]);
    });

    it('does not park an untouched batch or overwrite a populated active batch', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        const untouchedId = useWasteStore.getState().batch.id;

        expect(useWasteStore.getState().parkCurrentBatch()).toBe(false);
        expect(useWasteStore.getState().batch.id).toBe(untouchedId);
        expect(useWasteStore.getState().parkedBatches).toEqual([]);

        useWasteStore.getState().setMatrix('aqueous');
        expect(useWasteStore.getState().parkCurrentBatch()).toBe(true);
        expect(useWasteStore.getState().parkedBatches[0].displayName).toBe('수용액 폐액');
    });

    it('blocks an eleventh parked draft without silently deleting the oldest', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');

        for (let index = 1; index <= 10; index += 1) {
            useWasteStore.getState().addToCart(
                cartItem(`reagent-${index}`, `Reagent ${index}`),
            );
            expect(useWasteStore.getState().parkCurrentBatch()).toBe(true);
        }
        useWasteStore.getState().addToCart(cartItem('reagent-11', 'Reagent 11'));
        expect(useWasteStore.getState().parkCurrentBatch()).toBe(false);

        const parked = useWasteStore.getState().parkedBatches;
        expect(parked).toHaveLength(10);
        expect(parked[0].displayName).toBe('Reagent 10 폐액');
        expect(parked[9].displayName).toBe('Reagent 1 폐액');
        expect(useWasteStore.getState().batch.components[0].chemical.name).toBe('Reagent 11');

        const deletedId = parked[4].id;
        expect(useWasteStore.getState().deleteParkedBatch(deletedId)).toBe(true);
        expect(useWasteStore.getState().deleteParkedBatch(deletedId)).toBe(false);

        resetStore();
        useWasteStore.getState().setScope('user-a', 'lab-a');
        expect(useWasteStore.getState().parkedBatches).toHaveLength(9);
        expect(useWasteStore.getState().parkedBatches.some(({ id }) => id === deletedId)).toBe(false);
    });

    it('isolates parked drafts by owner and lab and hides them after logout', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().addToCart(cartItem('acetone', 'Acetone'));
        expect(useWasteStore.getState().parkCurrentBatch()).toBe(true);

        useWasteStore.getState().setScope('user-a', 'lab-b');
        expect(useWasteStore.getState().parkedBatches).toEqual([]);
        useWasteStore.getState().setScope('user-b', 'lab-a');
        expect(useWasteStore.getState().parkedBatches).toEqual([]);
        useWasteStore.getState().setScope(null, null);
        expect(useWasteStore.getState().parkedBatches).toEqual([]);

        useWasteStore.getState().setScope('user-a', 'lab-a');
        expect(useWasteStore.getState().parkedBatches).toHaveLength(1);
        expect(useWasteStore.getState().parkedBatches[0].displayName).toBe('Acetone 폐액');
    });

    it('preserves the active batch when parking cannot be persisted', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().addToCart(cartItem('acetone', 'Acetone'));
        const batchBefore = useWasteStore.getState().batch;
        vi.spyOn(storage, 'setItem').mockImplementation(() => {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        });

        expect(useWasteStore.getState().parkCurrentBatch()).toBe(false);
        expect(useWasteStore.getState().batch).toBe(batchBefore);
        expect(useWasteStore.getState().cart[0].chemical.name).toBe('Acetone');
        expect(useWasteStore.getState().parkedBatches).toEqual([]);
    });

    it('normalizes liquid and solid amounts and resets them across dimensions', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().setMatrix('aqueous');
        useWasteStore.getState().setTotalAmount({
            value: 1.5,
            unit: 'L',
            isApproximate: true,
        });

        expect(useWasteStore.getState().batch.totalAmount).toEqual({
            value: 1.5,
            unit: 'L',
            normalizedValue: 1_500,
            normalizedUnit: 'mL',
            isApproximate: true,
            isUnknown: false,
        });

        useWasteStore.getState().setMatrix('organic_non_halogenated');
        expect(useWasteStore.getState().batch.totalAmount.normalizedValue).toBe(1_500);

        useWasteStore.getState().setMatrix('solid_slurry');
        expect(useWasteStore.getState().batch.totalAmount).toEqual({
            value: null,
            unit: null,
            normalizedValue: null,
            normalizedUnit: null,
            isApproximate: false,
            isUnknown: false,
        });

        useWasteStore.getState().setTotalAmount({ value: 2.5, unit: 'g' });
        expect(useWasteStore.getState().batch.totalAmount).toEqual({
            value: 2.5,
            unit: 'g',
            normalizedValue: 2_500,
            normalizedUnit: 'mg',
            isApproximate: false,
            isUnknown: false,
        });

        useWasteStore.getState().setMatrix('aqueous');
        expect(useWasteStore.getState().batch.totalAmount.value).toBeNull();
        expect(useWasteStore.getState().batch.totalAmount.normalizedUnit).toBeNull();
    });

    it('completes the pending additional-component question only after a component is added', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().addToCart(cartItem('acetone', 'Acetone'));
        useWasteStore.getState().setAdditionalComponentsStatus('present');

        expect(useWasteStore.getState().batch.additionalComponentsStatus).toBe('present');
        useWasteStore.getState().addToCart(cartItem('water', 'Water'));
        expect(useWasteStore.getState().batch.additionalComponentsStatus).toBe('none');
    });

    it('clears a pre-existing volume if an unresolved draft is later confirmed as solid', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().setTotalAmount({ value: 250, unit: 'mL' });

        expect(useWasteStore.getState().batch.matrix).toBe('unknown');
        expect(useWasteStore.getState().batch.totalAmount.normalizedUnit).toBe('mL');

        useWasteStore.getState().setMatrix('solid_slurry');

        expect(useWasteStore.getState().batch.totalAmount).toEqual({
            value: null,
            unit: null,
            normalizedValue: null,
            normalizedUnit: null,
            isApproximate: false,
            isUnknown: false,
        });
    });

    it('stores an explicit unknown amount without retaining an earlier hidden value', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().setMatrix('aqueous');
        useWasteStore.getState().setTotalAmount({ value: 500, unit: 'mL' });
        useWasteStore.getState().setTotalAmount({
            value: 500,
            unit: 'mL',
            isUnknown: true,
        });

        expect(useWasteStore.getState().batch.totalAmount).toEqual({
            value: null,
            unit: null,
            normalizedValue: null,
            normalizedUnit: null,
            isApproximate: false,
            isUnknown: true,
        });
    });

    it('stores measured batch pH only for an explicitly already-mixed aqueous batch', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().setMatrix('aqueous');
        useWasteStore.getState().setMixingState('already_mixed');
        useWasteStore.getState().setMeasuredPh(11.5, false);

        expect(useWasteStore.getState().batch).toMatchObject({
            mixingState: 'already_mixed',
            measuredBatchPh: 11.5,
            measuredPhStatus: 'measured',
        });
        expect(useWasteStore.getState().batch.measuredPh).toBeUndefined();

        useWasteStore.getState().setMixingState('separate');
        expect(useWasteStore.getState().batch).toMatchObject({
            mixingState: 'separate',
            measuredPhStatus: 'not_required',
        });
        expect(useWasteStore.getState().batch.measuredBatchPh).toBeUndefined();

        useWasteStore.getState().setMatrix('mixed_biphasic');
        useWasteStore.getState().setMixingState('already_mixed');
        useWasteStore.getState().setMeasuredPh(7, false);
        expect(useWasteStore.getState().batch).toMatchObject({
            matrix: 'mixed_biphasic',
            mixingState: 'already_mixed',
            measuredPhStatus: 'not_required',
        });
        expect(useWasteStore.getState().batch.measuredBatchPh).toBeUndefined();
    });

    it('migrates an explicitly owner-tagged legacy cart exactly once', () => {
        const legacyAcetone = {
            ...cartItem('acetone', 'Acetone'),
            volume: '500 mL',
        };
        storage.setItem(LEGACY_KEY, JSON.stringify({
            ownerUserId: 'user-a',
            state: { cart: [legacyAcetone, legacyAcetone] },
        }));

        expect(() => useWasteStore.getState().setScope('user-a', 'lab-a')).not.toThrow();

        const migrated = useWasteStore.getState().cart;
        expect(migrated).toHaveLength(2);
        expect(new Set(migrated.map(({ cartLineId }) => cartLineId)).size).toBe(2);
        expect(migrated.every(({ volume }) => volume === '500 mL')).toBe(true);
        expect(storage.getItem(LEGACY_KEY)).toBeNull();
        expect(storage.getItem(`${V2_PREFIX}user-a:lab-a`)).not.toBeNull();

        useWasteStore.getState().setScope('user-b', 'lab-b');
        expect(useWasteStore.getState().cart).toEqual([]);

        useWasteStore.getState().setScope('user-a', 'lab-a');
        expect(useWasteStore.getState().cart).toHaveLength(2);
    });

    it('deletes an ownerless legacy cart instead of assigning it to the next login', () => {
        storage.setItem(LEGACY_KEY, JSON.stringify({
            state: { cart: [cartItem('acetone', 'Acetone')] },
        }));

        useWasteStore.getState().setScope('user-a', 'lab-a');

        expect(useWasteStore.getState().cart).toEqual([]);
        expect(storage.getItem(LEGACY_KEY)).toBeNull();
        expect(storage.getItem(`${V2_PREFIX}user-a:lab-a`)).toBeNull();

        useWasteStore.getState().setScope('user-b', 'lab-a');
        expect(useWasteStore.getState().cart).toEqual([]);
    });

    it('removes a malformed ownerless legacy value without crashing', () => {
        storage.setItem(LEGACY_KEY, '{not valid json');

        expect(() => useWasteStore.getState().setScope('user-a', 'lab-a')).not.toThrow();
        expect(useWasteStore.getState().cart).toEqual([]);
        expect(storage.getItem(LEGACY_KEY)).toBeNull();
    });

    it('keeps the migrated draft usable and preserves the legacy source if storage write fails', () => {
        storage.setItem(LEGACY_KEY, JSON.stringify({
            ownerUserId: 'user-a',
            state: { cart: [cartItem('acetone', 'Acetone')] },
        }));
        vi.spyOn(storage, 'setItem').mockImplementation(() => {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        });

        expect(() => useWasteStore.getState().setScope('user-a', 'lab-a')).not.toThrow();
        expect(useWasteStore.getState().cart).toHaveLength(1);
        expect(useWasteStore.getState().cart[0].chemical.name).toBe('Acetone');
        expect(storage.getItem(LEGACY_KEY)).not.toBeNull();
    });
});
