/**
 * Inventory Hazard Classifier
 * ════════════════════════════
 * Classifies inventory items by hazard level using chemical name/CAS patterns
 * and optional GHS H-codes when the caller has them available.
 * Adapts the StorageCompatibilityChecker's classification logic
 * to work with InventoryItem.
 *
 * This enables filtering high-risk reagents directly from the
 * inventory list without requiring cabinet placement data.
 */

import type { InventoryItem } from '../services/inventoryService';
import { classifyStorageGroups, type StorageGroup } from './storageCompatibilityChecker';
import type { ReagentPlacement } from '../types/fridge';

/**
 * High-risk storage groups that indicate significant hazard.
 * These are groups that pose serious danger if mishandled.
 */
const HIGH_RISK_GROUPS: StorageGroup[] = [
    'EXPLOSIVE',
    'PYROPHORIC',
    'WATER_REACTIVE',
    'TOXIC_CYANIDE',
    'TOXIC_SULFIDE',
    'TOXIC_AZIDE',
    'ACUTE_TOXIC',
    'ORGANIC_PEROXIDE',
    'OXIDIZER',
    'COMPRESSED_GAS',
];

export type HazardLevel = 'high' | 'none';

export interface HazardClassification {
    level: HazardLevel;
    groups: StorageGroup[];
    /** Translation keys for group labels */
    groupLabelKeys: string[];
}

export interface InventoryHazardClassificationOptions {
    hCodes?: string[];
}

/**
 * Classify an inventory item's hazard level by adapting it
 * to a minimal ReagentPlacement for pattern-based and H-code classification.
 */
export function classifyInventoryHazard(
    item: InventoryItem,
    options: InventoryHazardClassificationOptions = {},
): HazardClassification {
    // Create a minimal adapter compatible with classifyStorageGroups
    const pseudoPlacement: ReagentPlacement = {
        id: item.id,
        reagentId: item.id,
        name: item.name,
        position: 0,
        width: 0,
        template: 'A',
        shelfId: '',
        isAcidic: false,
        isBasic: false,
        hCodes: options.hCodes || [],
        notes: item.memo || '',
        casNo: item.cas_number || '',
        capacity: item.capacity || '',
        brand: item.brand || '',
        productNumber: item.product_number || '',
    };

    const groups = classifyStorageGroups(pseudoPlacement);
    const hazardousGroups = groups.filter(g => HIGH_RISK_GROUPS.includes(g));

    const LABEL_KEYS: Partial<Record<StorageGroup, string>> = {
        FLAMMABLE: 'storage_group_flammable',
        OXIDIZER: 'storage_group_oxidizer',
        INORGANIC_ACID: 'storage_group_inorganic_acid',
        ORGANIC_ACID: 'storage_group_organic_acid',
        BASE: 'storage_group_base',
        TOXIC_CYANIDE: 'storage_group_cyanide',
        TOXIC_SULFIDE: 'storage_group_sulfide',
        TOXIC_AZIDE: 'storage_group_azide',
        ACUTE_TOXIC: 'storage_group_acute_toxic',
        WATER_REACTIVE: 'storage_group_water_reactive',
        PYROPHORIC: 'storage_group_pyrophoric',
        EXPLOSIVE: 'storage_group_explosive',
        ORGANIC_PEROXIDE: 'storage_group_organic_peroxide',
        COMPRESSED_GAS: 'storage_group_compressed_gas',
    };

    return {
        level: hazardousGroups.length > 0 ? 'high' : 'none',
        groups: hazardousGroups,
        groupLabelKeys: hazardousGroups.map(g => LABEL_KEYS[g] || '').filter(Boolean),
    };
}

/**
 * Quick check whether an inventory item is classified as hazardous.
 */
export function isHazardousItem(
    item: InventoryItem,
    options: InventoryHazardClassificationOptions = {},
): boolean {
    return classifyInventoryHazard(item, options).level === 'high';
}
