import { useLabStore } from '../store/useLabStore';
import type { ShelfData } from '../types/fridge';
import { parseCapacityMeasurement } from '../utils/capacityParser';
import {
    checkShelfCompatibility,
    type StorageWarning,
} from '../utils/storageCompatibilityChecker';
import { supabase } from './supabaseClient';

export type CommerceIntentEventType =
    | 'inventory_registered'
    | 'inventory_updated'
    | 'cabinet_item_placed'
    | 'cabinet_item_scanned'
    | 'cabinet_item_updated';

export type CasInputMethod = 'manual' | 'catalog' | 'scan' | 'ocr' | 'voice' | 'unknown';

interface TrackCommerceIntentInput {
    eventType: CommerceIntentEventType;
    sourceScreen: string;
    storageType?: 'cabinet' | 'other';
    productId?: string | null;
    sourceItemType?: 'inventory' | 'cabinet_item' | 'product';
    sourceItemId?: string | null;
    brandName?: string | null;
    productNumber?: string | null;
    quantity?: number | null;
    capacityText?: string | null;
    casNumber?: string | null;
    casInputMethod?: CasInputMethod;
    metadata?: Record<string, unknown>;
}

interface TrackStorageWarningIgnoredInput {
    cabinetId: string;
    shelves: ShelfData[];
    relatedItemId: string;
    sourceScreen: string;
    triggerSource: string;
    metadata?: Record<string, unknown>;
}

interface TrackAIDisposalGuideViewInput {
    chemicals: Array<{
        name?: string | null;
        casNumber?: string | null;
        molecularFormula?: string | null;
        category?: string | null;
    }>;
    sourceScreen: string;
    triggerSource: string;
    metadata?: Record<string, unknown>;
}

function normalizeText(value?: string | null): string | null {
    const normalized = value?.trim().toLowerCase().replace(/\s+/g, ' ');
    return normalized ? normalized : null;
}

function normalizeCasNumber(value?: string | null): string | null {
    const normalized = value?.replace(/[^0-9-]/g, '')?.trim();
    return normalized ? normalized : null;
}

function buildWarningRows(input: TrackStorageWarningIgnoredInput, warnings: StorageWarning[], userId: string, labId: string | null) {
    const itemById = new Map(
        input.shelves.flatMap((shelf) =>
            shelf.items.map((item) => [item.id, { ...item, shelfId: shelf.id }] as const)
        )
    );

    return warnings.map((warning) => {
        const itemA = warning.itemAId ? itemById.get(warning.itemAId) : null;
        const itemB = warning.itemBId ? itemById.get(warning.itemBId) : null;

        return {
            event_type: 'storage_warning_ignored',
            source_screen: input.sourceScreen,
            trigger_source: input.triggerSource,
            warning_severity: warning.severity,
            rule_id: warning.ruleId,
            message_key: warning.messageKey,
            cabinet_id: input.cabinetId,
            shelf_id: itemA?.shelfId || itemB?.shelfId || null,
            primary_chemical_name: warning.itemA,
            primary_chemical_name_normalized: normalizeText(warning.itemA),
            primary_cas_number: itemA?.casNo || null,
            primary_cas_number_normalized: normalizeCasNumber(itemA?.casNo),
            secondary_chemical_name: warning.itemB,
            secondary_chemical_name_normalized: normalizeText(warning.itemB),
            secondary_cas_number: itemB?.casNo || null,
            secondary_cas_number_normalized: normalizeCasNumber(itemB?.casNo),
            metadata: {
                ...input.metadata,
                related_item_id: input.relatedItemId,
                item_a_id: warning.itemAId ?? null,
                item_b_id: warning.itemBId ?? null,
            },
            user_id: userId,
            lab_id: labId,
        };
    });
}

async function getTrackingContext(): Promise<{ userId: string | null; labId: string | null }> {
    const { currentLabId } = useLabStore.getState();
    const {
        data: { session },
    } = await supabase.auth.getSession();

    return {
        userId: session?.user?.id || null,
        labId: currentLabId || null,
    };
}

export const analyticsService = {
    async trackCommerceIntentEvent(input: TrackCommerceIntentInput): Promise<void> {
        const { userId, labId } = await getTrackingContext();
        if (!userId) return;

        const hasSignal =
            Boolean(input.brandName?.trim()) ||
            Boolean(input.capacityText?.trim()) ||
            Boolean(input.casNumber?.trim()) ||
            Boolean(input.productId);

        if (!hasSignal) return;

        const parsedCapacity = parseCapacityMeasurement(input.capacityText);

        const row = {
            event_type: input.eventType,
            source_screen: input.sourceScreen,
            storage_type: input.storageType || null,
            product_id: input.productId || null,
            source_item_type: input.sourceItemType || null,
            source_item_id: input.sourceItemId || null,
            brand_name: input.brandName?.trim() || null,
            brand_normalized: normalizeText(input.brandName),
            product_number: input.productNumber?.trim() || null,
            quantity: input.quantity ?? null,
            capacity_text: parsedCapacity.rawText,
            capacity_value: parsedCapacity.numericValue,
            capacity_unit: parsedCapacity.unit,
            capacity_ml: parsedCapacity.volumeMl,
            cas_number: input.casNumber?.trim() || null,
            cas_number_normalized: normalizeCasNumber(input.casNumber),
            cas_input_method: input.casInputMethod || 'unknown',
            metadata: input.metadata || {},
            user_id: userId,
            lab_id: labId,
        };

        const { error } = await supabase.from('commerce_intent_events').insert(row);
        if (error) {
            console.warn('[Analytics] Failed to track commerce intent event:', error);
        }
    },

    async trackStorageWarningIgnoredForItem(input: TrackStorageWarningIgnoredInput): Promise<void> {
        const { userId, labId } = await getTrackingContext();
        if (!userId) return;

        const targetShelf = input.shelves.find((shelf) =>
            shelf.items.some((item) => item.id === input.relatedItemId)
        );

        if (!targetShelf) return;

        const warnings = checkShelfCompatibility(targetShelf.items, targetShelf.dividers || []).filter(
            (warning) => warning.itemAId === input.relatedItemId || warning.itemBId === input.relatedItemId
        );

        if (warnings.length === 0) return;

        const rows = buildWarningRows(input, warnings, userId, labId);
        const { error } = await supabase.from('safety_compliance_events').insert(rows);
        if (error) {
            console.warn('[Analytics] Failed to track storage warning ignore event:', error);
        }
    },

    async trackAIDisposalGuideView(input: TrackAIDisposalGuideViewInput): Promise<void> {
        const { userId, labId } = await getTrackingContext();
        if (!userId) return;

        const cleanedChemicals = input.chemicals
            .map((chemical) => ({
                name: chemical.name?.trim() || null,
                casNumber: chemical.casNumber?.trim() || null,
                molecularFormula: chemical.molecularFormula?.trim() || null,
                category: chemical.category?.trim() || null,
            }))
            .filter((chemical) => chemical.name || chemical.casNumber);

        if (cleanedChemicals.length === 0) return;

        const seen = new Set<string>();
        const rows = cleanedChemicals.flatMap((chemical) => {
            const normalizedName = normalizeText(chemical.name);
            const normalizedCas = normalizeCasNumber(chemical.casNumber);
            const dedupeKey = `${normalizedName ?? ''}|${normalizedCas ?? ''}`;
            if (seen.has(dedupeKey)) return [];
            seen.add(dedupeKey);

            return [{
                event_type: 'ai_disposal_guide_viewed',
                source_screen: input.sourceScreen,
                trigger_source: input.triggerSource,
                primary_chemical_name: chemical.name || chemical.casNumber,
                primary_chemical_name_normalized: normalizedName,
                primary_cas_number: chemical.casNumber,
                primary_cas_number_normalized: normalizedCas,
                guide_scope: cleanedChemicals.length > 1 ? 'mixture' : 'single',
                metadata: {
                    ...input.metadata,
                    molecular_formula: chemical.molecularFormula,
                    category: chemical.category,
                    peer_chemicals: cleanedChemicals
                        .filter((peer) => peer !== chemical)
                        .map((peer) => peer.name || peer.casNumber)
                        .filter(Boolean),
                    chemical_count: cleanedChemicals.length,
                },
                user_id: userId,
                lab_id: labId,
            }];
        });

        if (rows.length === 0) return;

        const { error } = await supabase.from('safety_compliance_events').insert(rows);
        if (error) {
            console.warn('[Analytics] Failed to track AI disposal guide view:', error);
        }
    },
};
