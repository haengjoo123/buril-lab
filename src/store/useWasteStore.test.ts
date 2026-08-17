import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem, ChemicalEnrichmentResult, DisposalCategory } from '../types';
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

    it('recomputes the automatic matrix and total when all concentrated components are confirmed as aqueous', () => {
        const acetate = cartItem('acetate', 'Sodium Acetate', 'NEUTRAL');
        acetate.chemical.casNumber = '127-09-3';
        acetate.chemical.molecularFormula = 'C2H3NaO2';
        const aceticAcid = cartItem('acid', 'Acetic Acid', 'ACID');
        aceticAcid.chemical.casNumber = '64-19-7';
        aceticAcid.chemical.molecularFormula = 'C2H4O2';
        useWasteStore.getState().addToCart(acetate);
        useWasteStore.getState().addToCart(aceticAcid);

        for (const component of useWasteStore.getState().batch.components) {
            useWasteStore.getState().updateComponent(component.cartLineId, {
                concentration: { value: component.chemical.name === 'Sodium Acetate' ? 0.05 : 0.01, unit: 'M' },
                solutionVolume: { value: 100, unit: 'mL', normalizedMl: 100 },
            });
            useWasteStore.getState().updateComponent(component.cartLineId, {
                solutionContext: {
                    physicalForm: 'aqueous',
                    solventClass: 'aqueous',
                    solventName: 'Water',
                    isSolventVerified: true,
                    solventResolution: 'user',
                    solventCasNumber: '7732-18-5',
                    solventMolecularFormula: 'H2O',
                },
            });
        }

        expect(useWasteStore.getState().batch).toMatchObject({
            matrix: 'aqueous',
            matrixSource: 'automatic',
            totalAmount: {
                value: 200,
                unit: 'mL',
                normalizedValue: 200,
                normalizedUnit: 'mL',
                source: 'component_sum',
            },
        });
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
        expect(stored.schemaVersion).toBe(5);
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

    it('removes a stale organic-solvent category from a stored carbon-and-metal material', () => {
        const legacyAnalysis = cartItem('sodium-acetate', 'Sodium Acetate');
        legacyAnalysis.chemical.casNumber = '127-09-3';
        legacyAnalysis.chemical.molecularFormula = 'C2H3NaO2';
        const draft = createEmptyWasteBatch({
            id: 'stored-acetate',
            scopeKey: 'user-a:lab-a',
            userId: 'user-a',
            labId: 'lab-a',
            now: '2026-08-02T00:00:00.000Z',
        });
        draft.components = [createWasteComponentFromAnalysis(legacyAnalysis)];

        storage.setItem(`${V2_PREFIX}user-a:lab-a`, JSON.stringify({
            schemaVersion: 5,
            ownerUserId: 'user-a',
            scopeKey: 'user-a:lab-a',
            draft,
            parkedDrafts: [],
        }));

        useWasteStore.getState().setScope('user-a', 'lab-a');

        expect(useWasteStore.getState().batch.components[0]).toMatchObject({
            category: 'UNKNOWN',
            label: 'label_possible_ionic_material',
            reason: 'reason_possible_ionic_material_review',
            identityConfidence: 'review_required',
            materialProfile: {
                kind: 'possible_ionic_organic_material',
                evidence: 'formula',
            },
        });
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
        expect(useWasteStore.getState().batch.mixingState).toBe('already_mixed');
        const upgraded = JSON.parse(storage.getItem(storageKey) ?? '{}') as {
            schemaVersion?: number;
            ownerUserId?: string;
            draft?: { id?: string };
        };
        expect(upgraded).toMatchObject({
            schemaVersion: 5,
            ownerUserId: 'user-a',
            draft: { id: 'raw-v2-batch' },
        });
    });

    it('preserves an explicit legacy separate state until the user confirms one container', () => {
        const legacyDraft = createEmptyWasteBatch({
            id: 'legacy-separate-batch',
            scopeKey: 'user-a:lab-a',
            userId: 'user-a',
            labId: 'lab-a',
            now: '2026-08-02T00:00:00.000Z',
        });
        legacyDraft.components = [
            createWasteComponentFromAnalysis(cartItem('water', 'Water')),
        ];
        legacyDraft.matrix = 'aqueous';
        legacyDraft.matrixSource = 'user';
        legacyDraft.mixingState = 'separate';
        storage.setItem(`${V2_PREFIX}user-a:lab-a`, JSON.stringify({
            schemaVersion: 4,
            ownerUserId: 'user-a',
            scopeKey: 'user-a:lab-a',
            draft: legacyDraft,
            parkedDrafts: [],
        }));

        useWasteStore.getState().setScope('user-a', 'lab-a');
        expect(useWasteStore.getState().batch.mixingState).toBe('separate');

        useWasteStore.getState().confirmSingleContainer();
        expect(useWasteStore.getState().batch).toMatchObject({
            mixingState: 'already_mixed',
            measuredPhStatus: 'unknown',
        });
    });

    it('migrates a legacy two-phase selection to the solvent stream found in its components', () => {
        const legacyDraft = createEmptyWasteBatch({
            id: 'legacy-two-phase-batch',
            scopeKey: 'user-a:lab-a',
            userId: 'user-a',
            labId: 'lab-a',
            now: '2026-08-02T00:00:00.000Z',
        });
        const water = cartItem('water', 'Water', 'NEUTRAL');
        water.chemical.casNumber = '7732-18-5';
        water.chemical.molecularFormula = 'H2O';
        water.chemical.properties = { isOrganic: false, isHalogenated: false };
        legacyDraft.components = [
            createWasteComponentFromAnalysis(water),
            createWasteComponentFromAnalysis(cartItem('acetone', 'Acetone')),
        ];
        legacyDraft.matrix = 'mixed_biphasic';
        legacyDraft.matrixSource = 'user';
        storage.setItem(`${V2_PREFIX}user-a:lab-a`, JSON.stringify({
            schemaVersion: 4,
            ownerUserId: 'user-a',
            scopeKey: 'user-a:lab-a',
            draft: legacyDraft,
            parkedDrafts: [],
        }));

        useWasteStore.getState().setScope('user-a', 'lab-a');

        expect(useWasteStore.getState().batch).toMatchObject({
            matrix: 'organic_non_halogenated',
            matrixSource: 'automatic',
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
            schemaVersion: 5,
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

    it('upgrades schema 3 active and parked components to structured pH inputs', () => {
        const activeDraft = createEmptyWasteBatch({
            id: 'active-v3',
            scopeKey: 'user-a:lab-a',
            userId: 'user-a',
            labId: 'lab-a',
        });
        activeDraft.components = [
            createWasteComponentFromAnalysis({
                ...cartItem('acid', 'Acid'),
                volume: '250 µL',
                molarity: '0.10 M',
            } as CartItem),
        ];
        const parkedDraft = createEmptyWasteBatch({
            id: 'parked-v3',
            scopeKey: 'user-a:lab-a',
            userId: 'user-a',
            labId: 'lab-a',
        });
        parkedDraft.components = [
            createWasteComponentFromAnalysis({
                ...cartItem('base', 'Base'),
                volume: '1,5 L',
                molarity: '25 mg / mL',
            } as CartItem),
        ];
        const storageKey = `${V2_PREFIX}user-a:lab-a`;
        storage.setItem(storageKey, JSON.stringify({
            schemaVersion: 3,
            ownerUserId: 'user-a',
            scopeKey: 'user-a:lab-a',
            draft: activeDraft,
            parkedDrafts: [parkedDraft],
        }));

        useWasteStore.getState().setScope('user-a', 'lab-a');

        expect(useWasteStore.getState().batch.components[0]).toMatchObject({
            volume: '250 µL',
            molarity: '0.10 M',
            solutionVolume: { value: 250, unit: 'uL', normalizedMl: 0.25 },
            concentration: { value: 0.1, unit: 'M' },
        });
        expect(useWasteStore.getState().parkedBatches[0].components[0]).toMatchObject({
            volume: '1,5 L',
            molarity: '25 mg / mL',
            solutionVolume: { value: 1.5, unit: 'L', normalizedMl: 1_500 },
            concentration: { value: 25, unit: 'mg/mL' },
        });
        const upgraded = JSON.parse(storage.getItem(storageKey) ?? '{}') as {
            schemaVersion?: number;
            draft?: typeof activeDraft;
            parkedDrafts?: typeof parkedDraft[];
        };
        expect(upgraded.schemaVersion).toBe(5);
        expect(upgraded.draft?.components[0].solutionVolume?.normalizedMl).toBe(0.25);
        expect(upgraded.parkedDrafts?.[0].components[0].concentration).toEqual({
            value: 25,
            unit: 'mg/mL',
        });
    });

    it('deduplicates and repairs schema-4 active and parked sodium acetate components atomically', async () => {
        const makeAcetate = (id: string) => {
            const input = cartItem(id, 'Sodium acetate', 'UNKNOWN');
            input.chemical.casNumber = '';
            input.chemical.molecularFormula = 'C2H3NaO2';
            const component = createWasteComponentFromAnalysis(input);
            component.hazardFlags = ['CORROSIVE'];
            component.hazardDataConfirmedByUser = true;
            component.manualHazardFlags = undefined;
            component.automaticHazardFlags = undefined;
            return component;
        };
        const active = createEmptyWasteBatch({
            id: 'active-acetate', scopeKey: 'user-a:lab-a', userId: 'user-a', labId: 'lab-a',
        });
        const parked = createEmptyWasteBatch({
            id: 'parked-acetate', scopeKey: 'user-a:lab-a', userId: 'user-a', labId: 'lab-a',
        });
        active.components = [makeAcetate('active')];
        parked.components = [makeAcetate('parked')];
        parked.parkedAt = '2026-08-17T00:00:00.000Z';
        storage.setItem(`${V2_PREFIX}user-a:lab-a`, JSON.stringify({
            schemaVersion: 4,
            ownerUserId: 'user-a',
            scopeKey: 'user-a:lab-a',
            draft: active,
            parkedDrafts: [parked],
        }));

        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const request = JSON.parse(String(init?.body)) as { items: Array<{ requestId: string }> };
            const result: ChemicalEnrichmentResult = {
                requestId: request.items[0].requestId,
                overallStatus: 'complete',
                identity: {
                    status: 'verified',
                    canonicalName: 'Sodium acetate',
                    casNumber: '127-09-3',
                    pubchemCid: 31372,
                    equivalentPubchemCids: [31372, 517045],
                    standardInchiKey: 'VMHLLURERBWHNL-UHFFFAOYSA-M',
                    molecularFormula: 'C2H3NaO2',
                    molecularWeight: 82.03,
                    connectivitySmiles: '[Na+].CC(=O)[O-]',
                    evidence: [],
                },
                hazard: {
                    status: 'classified',
                    hCodes: ['H225'],
                    hazardStatements: ['H225 Highly flammable liquid and vapour'],
                    pictograms: [],
                    signalWord: 'Danger',
                    hazardFlags: ['FLAMMABLE'],
                    sources: [{ source: 'pubchem', sourceId: '517045' }],
                    fetchedAt: '2026-08-17T00:00:00.000Z',
                },
                phCatalog: {
                    status: 'matched', id: 'sodium-acetate', candidateIds: ['sodium-acetate'],
                    matchedBy: 'inchi_key', catalogVersion: 'test',
                },
                enrichmentVersion: 1,
            };
            return Response.json({ results: [result] });
        });
        vi.stubGlobal('fetch', fetchMock);

        useWasteStore.getState().setScope('user-a', 'lab-a');
        await useWasteStore.getState().refreshChemicalEnrichment();

        expect(fetchMock).toHaveBeenCalledOnce();
        for (const component of [
            useWasteStore.getState().batch.components[0],
            useWasteStore.getState().parkedBatches[0].components[0],
        ]) {
            expect(component).toMatchObject({
                ghsDataStatus: 'verified',
                phCatalogId: 'sodium-acetate',
                enrichmentVersion: 1,
                manualHazardFlags: ['CORROSIVE'],
            });
            expect(component.chemical.casNumber).toBe('127-09-3');
            expect(component.hazardFlags).toEqual(expect.arrayContaining(['FLAMMABLE', 'CORROSIVE']));
        }
        const persisted = JSON.parse(storage.getItem(`${V2_PREFIX}user-a:lab-a`) || '{}') as { schemaVersion?: number };
        expect(persisted.schemaVersion).toBe(5);
    });

    it('repairs a schema-5 component that has CAS and pH metadata but no hazard lookup result', async () => {
        const draft = createEmptyWasteBatch({
            id: 'partial-acetate', scopeKey: 'user-a:lab-a', userId: 'user-a', labId: 'lab-a',
        });
        const input = cartItem('acetate', 'Sodium acetate', 'UNKNOWN');
        input.chemical.casNumber = '127-09-3';
        input.chemical.molecularFormula = 'C2H3NaO2';
        const component = createWasteComponentFromAnalysis(input, {
            phCatalogId: 'sodium-acetate',
            phCatalogMatch: {
                status: 'matched',
                id: 'sodium-acetate',
                candidateIds: ['sodium-acetate'],
                matchedBy: 'cas',
                catalogVersion: 'legacy',
                selection: 'automatic',
            },
        });
        component.enrichmentVersion = 1;
        component.ghsDataStatus = 'lookup_failed';
        component.chemical.hazardLookup = undefined;
        draft.components = [component];
        storage.setItem(`${V2_PREFIX}user-a:lab-a`, JSON.stringify({
            schemaVersion: 5,
            ownerUserId: 'user-a',
            scopeKey: 'user-a:lab-a',
            draft,
            parkedDrafts: [],
        }));

        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const request = JSON.parse(String(init?.body)) as { items: Array<{ requestId: string }> };
            const result: ChemicalEnrichmentResult = {
                requestId: request.items[0].requestId,
                overallStatus: 'complete',
                identity: {
                    status: 'verified',
                    canonicalName: 'Sodium acetate',
                    casNumber: '127-09-3',
                    pubchemCid: 31372,
                    equivalentPubchemCids: [31372, 517045],
                    standardInchiKey: 'VMHLLURERBWHNL-UHFFFAOYSA-M',
                    molecularFormula: 'C2H3NaO2',
                    evidence: [],
                },
                hazard: {
                    status: 'not_classified',
                    hCodes: [],
                    hazardStatements: [],
                    pictograms: [],
                    hazardFlags: [],
                    sources: [{ source: 'pubchem', sourceId: '517045' }],
                    fetchedAt: '2026-08-17T00:00:00.000Z',
                },
                phCatalog: {
                    status: 'matched', id: 'sodium-acetate', candidateIds: ['sodium-acetate'],
                    matchedBy: 'inchi_key', catalogVersion: 'test',
                },
                enrichmentVersion: 1,
            };
            return Response.json({ results: [result] });
        });
        vi.stubGlobal('fetch', fetchMock);

        useWasteStore.getState().setScope('user-a', 'lab-a');
        await useWasteStore.getState().refreshChemicalEnrichment();

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(useWasteStore.getState().batch.components[0]).toMatchObject({
            ghsDataStatus: 'verified',
            enrichmentVersion: 1,
            phCatalogId: 'sodium-acetate',
            chemical: {
                casNumber: '127-09-3',
                hazardLookup: { status: 'not_classified' },
            },
        });
    });

    it('preserves unparseable legacy strings without inventing structured values', () => {
        const draft = createEmptyWasteBatch({
            id: 'ambiguous-v3',
            scopeKey: 'user-a:lab-a',
            userId: 'user-a',
            labId: 'lab-a',
        });
        draft.components = [
            createWasteComponentFromAnalysis({
                ...cartItem('unknown-stock', 'Unknown stock'),
                volume: 'about half a bottle',
                molarity: '37%',
            } as CartItem),
        ];
        storage.setItem(`${V2_PREFIX}user-a:lab-a`, JSON.stringify({
            schemaVersion: 3,
            ownerUserId: 'user-a',
            scopeKey: 'user-a:lab-a',
            draft,
            parkedDrafts: [],
        }));

        useWasteStore.getState().setScope('user-a', 'lab-a');

        expect(useWasteStore.getState().batch.components[0]).toMatchObject({
            volume: 'about half a bottle',
            molarity: '37%',
        });
        expect(useWasteStore.getState().batch.components[0].solutionVolume).toBeUndefined();
        expect(useWasteStore.getState().batch.components[0].concentration).toBeUndefined();
    });

    it('adds and updates structured solution inputs and exact catalog identity', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().addToCart(cartItem('acetic-acid', 'Acetic acid'), {
            phCatalogId: 'cas:64-19-7:acetic-acid',
            solutionVolume: {
                value: 100,
                unit: 'mL',
                normalizedMl: 100,
            },
            concentration: {
                value: 5,
                unit: '%',
                basis: 'w_w',
                density: {
                    value: 1.006,
                    unit: 'g/mL',
                    kind: 'solution',
                    source: 'catalog',
                    temperatureC: 25,
                },
            },
        });

        const component = useWasteStore.getState().cart[0];
        expect(component).toMatchObject({
            phCatalogId: 'cas:64-19-7:acetic-acid',
            solutionVolume: { value: 100, unit: 'mL', normalizedMl: 100 },
            concentration: {
                value: 5,
                unit: '%',
                basis: 'w_w',
                density: { value: 1.006, kind: 'solution', source: 'catalog' },
            },
        });

        useWasteStore.getState().updateComponent(component.cartLineId, {
            solutionVolume: {
                value: 0.2,
                unit: 'L',
                normalizedMl: 200,
                isEstimate: true,
            },
            phCatalogId: 'cas:64-19-7:acetic-acid-aqueous',
        });

        expect(useWasteStore.getState().cart[0]).toMatchObject({
            phCatalogId: 'cas:64-19-7:acetic-acid-aqueous',
            solutionVolume: {
                value: 0.2,
                unit: 'L',
                normalizedMl: 200,
                isEstimate: true,
            },
        });
    });

    it('persists a unique approved catalog id from an exact CAS match', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        const aceticAcid = cartItem('acetic-acid', 'Acetic acid', 'ACID');
        aceticAcid.chemical.casNumber = '64-19-7';
        aceticAcid.chemical.molecularFormula = 'C2H4O2';

        useWasteStore.getState().addToCart(aceticAcid);

        expect(useWasteStore.getState().cart[0].phCatalogId).toBe('acetic-acid');
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
            source: 'manual',
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
            source: 'manual',
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
            source: 'manual',
        });
    });

    it('automatically sums complete component volumes and resets stale manual overrides', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().setMatrix('aqueous');
        useWasteStore.getState().addToCart(cartItem('first', 'First solution'), {
            solutionVolume: { value: 100, unit: 'mL', normalizedMl: 100 },
        });
        useWasteStore.getState().addToCart(cartItem('second', 'Second solution'), {
            solutionVolume: { value: 0.05, unit: 'L', normalizedMl: 50 },
        });

        expect(useWasteStore.getState().batch.totalAmount).toEqual({
            value: 150,
            unit: 'mL',
            normalizedValue: 150,
            normalizedUnit: 'mL',
            isApproximate: true,
            isUnknown: false,
            source: 'component_sum',
        });

        useWasteStore.getState().setTotalAmount({
            value: 140,
            unit: 'mL',
            source: 'manual',
        });
        expect(useWasteStore.getState().batch.totalAmount.source).toBe('manual');

        useWasteStore.getState().setTotalAmount({
            value: 145,
            unit: 'mL',
            isApproximate: true,
            source: 'manual',
        });
        expect(useWasteStore.getState().batch.totalAmount).toMatchObject({
            value: 150,
            isApproximate: true,
            source: 'component_sum',
        });

        useWasteStore.getState().setTotalAmount({
            value: 140,
            unit: 'mL',
            source: 'manual',
        });

        const firstLineId = useWasteStore.getState().batch.components[0].cartLineId;
        useWasteStore.getState().updateComponent(firstLineId, {
            solutionVolume: { value: 120, unit: 'mL', normalizedMl: 120 },
        });
        expect(useWasteStore.getState().batch.totalAmount).toMatchObject({
            value: 170,
            normalizedValue: 170,
            isApproximate: true,
            source: 'component_sum',
        });

        useWasteStore.getState().addToCart(cartItem('third', 'Unknown-volume solution'));
        expect(useWasteStore.getState().batch.totalAmount).toMatchObject({
            value: null,
            isUnknown: false,
        });
    });

    it('derives one-container mixing state and stores measured pH only for aqueous batches', () => {
        useWasteStore.getState().setScope('user-a', 'lab-a');
        useWasteStore.getState().setMatrix('aqueous');
        expect(useWasteStore.getState().batch.mixingState).toBe('unknown');

        useWasteStore.getState().addToCart(cartItem('water', 'Water'));
        useWasteStore.getState().setMeasuredPh(11.5, false);

        expect(useWasteStore.getState().batch).toMatchObject({
            mixingState: 'already_mixed',
            measuredBatchPh: 11.5,
            measuredPhStatus: 'measured',
        });
        expect(useWasteStore.getState().batch.measuredPh).toBeUndefined();

        useWasteStore.getState().setMatrix('mixed_biphasic');
        useWasteStore.getState().setMeasuredPh(7, false);
        expect(useWasteStore.getState().batch).toMatchObject({
            matrix: 'mixed_biphasic',
            mixingState: 'already_mixed',
            measuredPhStatus: 'not_required',
        });
        expect(useWasteStore.getState().batch.measuredBatchPh).toBeUndefined();

        useWasteStore.getState().removeFromCart('water');
        expect(useWasteStore.getState().batch.mixingState).toBe('unknown');
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
        expect(migrated.every(({ solutionVolume }) =>
            solutionVolume?.value === 500 && solutionVolume.normalizedMl === 500
        )).toBe(true);
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
