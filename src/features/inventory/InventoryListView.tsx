import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Search, Archive, Package, MapPin, Loader2, AlertTriangle, Clock, ArrowUpDown } from 'lucide-react';
import { inventoryService, storageLocationService, type InventoryItem, type StorageLocation } from '../../services/inventoryService';
import { cabinetService, type Cabinet } from '../../services/cabinetService';
import { InventoryFormModal } from './InventoryFormModal';
import { InventoryCsvImportModal } from './InventoryCsvImportModal';
import { CustomDialog } from '../../components/CustomDialog';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { getExpiryStatus, getExpiryBadgeClasses, getExpiryCardBorderClass } from '../../utils/expiryStatus';
import { useFridgeStore } from '../../store/fridgeStore';
import { supabase } from '../../services/supabaseClient';
import { OnboardingGuideCard } from '../../components/onboarding/OnboardingGuideCard';
import { AppSelect } from '../../components/AppSelect';

import { useLabStore } from '../../store/useLabStore';
import { useOnboardingStore } from '../../store/useOnboardingStore';
import { translateLocationName } from '../../utils/i18nUtils';

type BulkMoveTargetType = 'other' | 'cabinet';
type ReagentTemplateType = 'A' | 'B' | 'C' | 'D';
type InventorySortOption = 'expiry_asc' | 'location_asc' | 'name_asc' | 'created_at_desc' | 'created_at_asc';

const CONTAINER_BASE_WIDTHS: Record<ReagentTemplateType, number> = { A: 8, B: 6, C: 12, D: 14 };

const normalizeText = (value?: string | null) => (value || '').trim().toLowerCase();

function guessTemplate(capacity: string): ReagentTemplateType {
    if (!capacity) return 'A';
    const lower = capacity.toLowerCase();
    const numMatch = lower.match(/(\d+)/);
    const num = numMatch ? parseInt(numMatch[1], 10) : 0;

    if (lower.includes('kg') || num >= 2500) return 'D';
    if (lower.includes('l') && !lower.includes('ml')) return 'C';
    if (num >= 500) return 'C';
    if (num >= 100) return 'A';
    return 'B';
}

function compareInventoryItems(a: InventoryItem, b: InventoryItem, sortBy: InventorySortOption): number {
    if (sortBy === 'expiry_asc') {
        const expiryA = getExpiryStatus(a.expiry_date);
        const expiryB = getExpiryStatus(b.expiry_date);
        const daysLeftA = expiryA ? expiryA.daysLeft : Number.POSITIVE_INFINITY;
        const daysLeftB = expiryB ? expiryB.daysLeft : Number.POSITIVE_INFINITY;
        if (daysLeftA !== daysLeftB) return daysLeftA - daysLeftB;
        return a.name.localeCompare(b.name, 'ko');
    }

    if (sortBy === 'location_asc') {
        const typeRankA = a.storage_type === 'cabinet' ? 0 : 1;
        const typeRankB = b.storage_type === 'cabinet' ? 0 : 1;
        if (typeRankA !== typeRankB) return typeRankA - typeRankB;

        const locationNameA = a.storage_type === 'cabinet'
            ? (a.cabinet_name || '')
            : (a.storage_location_name || '');
        const locationNameB = b.storage_type === 'cabinet'
            ? (b.cabinet_name || '')
            : (b.storage_location_name || '');
        const locationCompare = locationNameA.localeCompare(locationNameB, 'ko');
        if (locationCompare !== 0) return locationCompare;

        const shelfLevelA = typeof a.shelf_level === 'number' ? a.shelf_level : Number.POSITIVE_INFINITY;
        const shelfLevelB = typeof b.shelf_level === 'number' ? b.shelf_level : Number.POSITIVE_INFINITY;
        if (shelfLevelA !== shelfLevelB) return shelfLevelA - shelfLevelB;

        return a.name.localeCompare(b.name, 'ko');
    }

    if (sortBy === 'name_asc') {
        return a.name.localeCompare(b.name, 'ko');
    }

    const createdAtDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (createdAtDiff !== 0) {
        return sortBy === 'created_at_asc' ? createdAtDiff : -createdAtDiff;
    }

    return a.name.localeCompare(b.name, 'ko');
}

async function persistLoadedCabinetStateStrict(expectedCabinetId: string): Promise<void> {
    const state = useFridgeStore.getState();
    if (!state.cabinetId || state.cabinetId !== expectedCabinetId) {
        throw new Error('cabinet_state_mismatch');
    }
    await cabinetService.saveCabinetState(expectedCabinetId, state.shelves);
    await cabinetService.updateCabinet(expectedCabinetId, {
        width: state.cabinetWidth,
        height: state.cabinetHeight,
        depth: state.cabinetDepth,
    });
}

export const InventoryListView: React.FC = () => {
    const { t } = useTranslation();
    const showOnboardingGuide = useOnboardingStore((state) => state.hasCompletedWelcome && !state.hasSkippedOnboarding && !state.seenGuides.inventory);
    const markGuideSeen = useOnboardingStore((state) => state.markGuideSeen);
    const { currentLabId } = useLabStore();
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [locations, setLocations] = useState<StorageLocation[]>([]);
    const [cabinets, setCabinets] = useState<Cabinet[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<InventorySortOption>('expiry_asc');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
    const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
    const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
    const [bulkMoveLocationId, setBulkMoveLocationId] = useState('');
    const [bulkMoveTargetType, setBulkMoveTargetType] = useState<BulkMoveTargetType>('other');
    const [bulkMoveCabinetId, setBulkMoveCabinetId] = useState('');
    const [isBulkMoveConfirmOpen, setIsBulkMoveConfirmOpen] = useState(false);
    const [isBulkMoving, setIsBulkMoving] = useState(false);
    const [bulkMoveError, setBulkMoveError] = useState<string | null>(null);
    const [bulkMoveInfo, setBulkMoveInfo] = useState<string | null>(null);
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTriggeredRef = useRef(false);
    const bulkMoveInfoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const bulkErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [fetchedItems, fetchedLocations, fetchedCabinets] = await Promise.all([
                inventoryService.getItems(),
                storageLocationService.getLocations(),
                cabinetService.getCabinets(),
            ]);
            setItems(fetchedItems);
            setLocations(fetchedLocations);
            setCabinets(fetchedCabinets);
        } catch (error) {
            console.error('Failed to load inventory data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [currentLabId]);

    useEffect(() => {
        setIsSelectMode(false);
        setSelectedItemIds([]);
        setIsBulkDeleteConfirmOpen(false);
        setBulkDeleteError(null);
        setBulkMoveError(null);
        setBulkMoveInfo(null);
        setBulkMoveTargetType('other');
        setBulkMoveCabinetId('');
    }, [currentLabId]);

    useEffect(() => {
        if (!bulkMoveInfo) return;
        if (bulkMoveInfoTimerRef.current) {
            clearTimeout(bulkMoveInfoTimerRef.current);
        }
        bulkMoveInfoTimerRef.current = setTimeout(() => {
            setBulkMoveInfo(null);
        }, 2500);
    }, [bulkMoveInfo]);

    useEffect(() => {
        if (!bulkDeleteError && !bulkMoveError) return;
        if (bulkErrorTimerRef.current) {
            clearTimeout(bulkErrorTimerRef.current);
        }
        bulkErrorTimerRef.current = setTimeout(() => {
            setBulkDeleteError(null);
            setBulkMoveError(null);
        }, 3000);
    }, [bulkDeleteError, bulkMoveError]);

    useEffect(() => {
        return () => {
            if (bulkMoveInfoTimerRef.current) {
                clearTimeout(bulkMoveInfoTimerRef.current);
            }
            if (bulkErrorTimerRef.current) {
                clearTimeout(bulkErrorTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (locations.length === 0) {
            setBulkMoveLocationId('');
            return;
        }
        if (!bulkMoveLocationId) {
            setBulkMoveLocationId(locations[0].id);
            return;
        }
        const exists = locations.some(loc => loc.id === bulkMoveLocationId);
        if (!exists) {
            setBulkMoveLocationId(locations[0].id);
        }
    }, [locations, bulkMoveLocationId]);

    useEffect(() => {
        if (cabinets.length === 0) {
            setBulkMoveCabinetId('');
            return;
        }
        if (!bulkMoveCabinetId) {
            setBulkMoveCabinetId(cabinets[0].id);
            return;
        }
        const exists = cabinets.some(cab => cab.id === bulkMoveCabinetId);
        if (!exists) {
            setBulkMoveCabinetId(cabinets[0].id);
        }
    }, [cabinets, bulkMoveCabinetId]);

    const filteredItems = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        if (!normalizedQuery) return items;

        return items.filter(item =>
            item.name.toLowerCase().includes(normalizedQuery) ||
            (item.brand && item.brand.toLowerCase().includes(normalizedQuery)) ||
            (item.product_number && item.product_number.toLowerCase().includes(normalizedQuery)) ||
            (item.cas_number && item.cas_number.toLowerCase().includes(normalizedQuery))
        );
    }, [items, searchQuery]);

    // 만료/위치 우선으로 빠르게 확인할 수 있게 화면 전용 정렬 목록을 만든다.
    const visibleItems = useMemo(() => {
        return [...filteredItems].sort((a, b) => compareInventoryItems(a, b, sortBy));
    }, [filteredItems, sortBy]);

    const sortOptions = useMemo(() => ([
        { value: 'expiry_asc', label: t('inventory_sort_expiry_asc') },
        { value: 'location_asc', label: t('inventory_sort_location_asc') },
        { value: 'name_asc', label: t('inventory_sort_name_asc') },
        { value: 'created_at_desc', label: t('inventory_sort_created_desc') },
        { value: 'created_at_asc', label: t('inventory_sort_created_asc') },
    ]), [t]);

    const bulkMoveLocationOptions = useMemo(() => (
        locations.map((loc) => ({
            value: loc.id,
            label: `${loc.icon} ${translateLocationName(loc.name, t)}`,
        }))
    ), [locations, t]);

    const bulkMoveCabinetOptions = useMemo(() => (
        cabinets.map((cab) => ({
            value: cab.id,
            label: `📦 ${cab.name}`,
        }))
    ), [cabinets]);

    // Compute expiry summary
    const expirySummary = useMemo(() => {
        let expiredCount = 0;
        let warningCount = 0;
        for (const item of items) {
            const status = getExpiryStatus(item.expiry_date);
            if (!status) continue;
            if (status.level === 'expired') expiredCount++;
            else if (status.level === 'critical' || status.level === 'warning') warningCount++;
        }
        return { expiredCount, warningCount };
    }, [items]);

    const handleEdit = (item: InventoryItem) => {
        setEditingItem(item);
        setIsFormOpen(true);
    };

    const handleDeleteClick = (item: InventoryItem) => {
        setItemToDelete(item);
    };

    const confirmDelete = async () => {
        if (!itemToDelete || isDeleting) return;
        setIsDeleting(true);
        try {
            await inventoryService.deleteItem(itemToDelete);
            setItems(items.filter(i => i.id !== itemToDelete.id));
        } catch (error) {
            console.error('Failed to delete item:', error);
        } finally {
            setIsDeleting(false);
            setItemToDelete(null);
        }
    };

    const selectedFilteredCount = useMemo(() => {
        const filteredIdSet = new Set(visibleItems.map(item => item.id));
        return selectedItemIds.filter(id => filteredIdSet.has(id)).length;
    }, [visibleItems, selectedItemIds]);

    const toggleSelectMode = () => {
        if (isSelectMode) {
            setIsSelectMode(false);
            setSelectedItemIds([]);
            setBulkDeleteError(null);
            setBulkMoveError(null);
            setBulkMoveInfo(null);
            return;
        }
        setIsSelectMode(true);
        setBulkDeleteError(null);
        setBulkMoveError(null);
        setBulkMoveInfo(null);
    };

    const clearLongPressTimer = () => {
        if (!longPressTimerRef.current) return;
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
    };

    const startLongPress = (itemId: string) => {
        if (isSelectMode) return;
        clearLongPressTimer();
        longPressTriggeredRef.current = false;
        longPressTimerRef.current = setTimeout(() => {
            setIsSelectMode(true);
            setSelectedItemIds(prev => (prev.includes(itemId) ? prev : [...prev, itemId]));
            setBulkDeleteError(null);
            longPressTriggeredRef.current = true;
        }, 450);
    };

    const toggleItemSelection = (itemId: string) => {
        setSelectedItemIds(prev =>
            prev.includes(itemId)
                ? prev.filter(id => id !== itemId)
                : [...prev, itemId]
        );
    };

    const handleSelectAllFiltered = () => {
        if (visibleItems.length === 0) return;
        const filteredIds = visibleItems.map(item => item.id);
        const isAllSelected = filteredIds.every(id => selectedItemIds.includes(id));
        if (isAllSelected) {
            setSelectedItemIds(prev => prev.filter(id => !filteredIds.includes(id)));
            return;
        }
        setSelectedItemIds(prev => Array.from(new Set([...prev, ...filteredIds])));
    };

    const handleOpenBulkDeleteConfirm = () => {
        if (selectedItemIds.length === 0 || isBulkDeleting) return;
        setBulkDeleteError(null);
        setIsBulkDeleteConfirmOpen(true);
    };

    const handleOpenBulkMoveConfirm = () => {
        if (selectedItemIds.length === 0 || isBulkMoving) return;
        setBulkMoveError(null);
        setBulkMoveInfo(null);
        if (bulkMoveTargetType === 'other' && !bulkMoveLocationId) {
            setBulkMoveError(t('inventory_bulk_move_missing_location'));
            return;
        }
        if (bulkMoveTargetType === 'cabinet' && !bulkMoveCabinetId) {
            setBulkMoveError(t('inventory_bulk_move_missing_cabinet'));
            return;
        }
        setIsBulkMoveConfirmOpen(true);
    };

    const confirmBulkDelete = async () => {
        if (selectedItemIds.length === 0 || isBulkDeleting) return;
        setIsBulkDeleting(true);
        setBulkDeleteError(null);
        try {
            const selectedItems = items.filter(item => selectedItemIds.includes(item.id));
            const deleteResults = await Promise.allSettled(
                selectedItems.map(item => inventoryService.deleteItem(item))
            );

            const successIds: string[] = [];
            let failedCount = 0;
            deleteResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    successIds.push(selectedItems[index].id);
                } else {
                    failedCount += 1;
                    console.error('Failed to bulk delete inventory item:', result.reason);
                }
            });

            if (successIds.length > 0) {
                setItems(prev => prev.filter(item => !successIds.includes(item.id)));
            }

            if (failedCount > 0) {
                setSelectedItemIds(prev => prev.filter(id => !successIds.includes(id)));
                setBulkDeleteError(t('inventory_bulk_delete_partial_failed', { count: failedCount }));
            } else {
                setSelectedItemIds([]);
                setIsSelectMode(false);
            }
        } finally {
            setIsBulkDeleting(false);
            setIsBulkDeleteConfirmOpen(false);
        }
    };

    const confirmBulkMove = async () => {
        if (selectedItemIds.length === 0 || isBulkMoving) return;
        if (bulkMoveTargetType === 'other' && !bulkMoveLocationId) {
            setBulkMoveError(t('inventory_bulk_move_missing_location'));
            return;
        }
        if (bulkMoveTargetType === 'cabinet' && !bulkMoveCabinetId) {
            setBulkMoveError(t('inventory_bulk_move_missing_cabinet'));
            return;
        }

        setIsBulkMoving(true);
        setBulkMoveError(null);
        setBulkMoveInfo(null);
        try {
            const selectedItems = items.filter(item => selectedItemIds.includes(item.id));
            const eligibleItems = selectedItems.filter((item) => {
                if (bulkMoveTargetType === 'other') return item._source === 'inventory';
                return item._source === 'inventory' || item._source === 'cabinet_item';
            });
            const ineligibleCount = selectedItems.length - eligibleItems.length;

            if (eligibleItems.length === 0) {
                setBulkMoveError(
                    bulkMoveTargetType === 'other'
                        ? t('inventory_bulk_move_no_eligible_other')
                        : t('inventory_bulk_move_no_eligible_cabinet')
                );
                return;
            }

            const successIds: string[] = [];
            let failedCount = 0;
            let unchangedCount = 0;
            let noSpaceCount = 0;
            let placementFailedCount = 0;
            let cabinetSyncFailedCount = 0;
            let sourceRemoveFailedCount = 0;
            let rollbackFailedCount = 0;
            const sourceRemoveFailedNames: string[] = [];

            if (bulkMoveTargetType === 'other') {
                const targetLocation = locations.find(loc => loc.id === bulkMoveLocationId);
                if (!targetLocation) {
                    setBulkMoveError(t('inventory_bulk_move_invalid_location'));
                    return;
                }

                const moveCandidates = eligibleItems.filter(
                    item => !(item.storage_type === 'other' && item.storage_location_id === bulkMoveLocationId)
                );
                unchangedCount = eligibleItems.length - moveCandidates.length;

                if (moveCandidates.length === 0) {
                    setBulkMoveInfo(t('inventory_bulk_move_all_already_target'));
                    return;
                }

                for (const item of moveCandidates) {
                    let isInventoryMoved = false;
                    try {
                        await inventoryService.updateItem(item.id, {
                            storage_type: 'other',
                            storage_location_id: bulkMoveLocationId,
                        }, 'inventory');
                        isInventoryMoved = true;

                        if (item.storage_type === 'cabinet' && item.cabinet_id) {
                            const syncSuccess = await removeFromCabinetByInventoryItem(item);
                            if (!syncSuccess) {
                                throw new Error('cabinet_sync_failed');
                            }
                        }

                        successIds.push(item.id);
                    } catch (error) {
                        failedCount += 1;
                        if (isInventoryMoved && item.storage_type === 'cabinet' && item.cabinet_id) {
                            try {
                                await inventoryService.updateItem(item.id, {
                                    storage_type: 'cabinet',
                                    cabinet_id: item.cabinet_id,
                                }, 'inventory');
                            } catch (rollbackError) {
                                rollbackFailedCount += 1;
                                console.error('Rollback after cabinet sync failure failed:', rollbackError);
                            }
                        }
                        if (error instanceof Error && error.message === 'cabinet_sync_failed') {
                            cabinetSyncFailedCount += 1;
                        } else {
                            console.error('Failed to bulk move inventory item to other storage:', error);
                        }
                    }
                }

                if (successIds.length > 0) {
                    setItems(prev => prev.map(item => {
                        if (!successIds.includes(item.id)) return item;
                        return {
                            ...item,
                            storage_type: 'other',
                            storage_location_id: targetLocation.id,
                            storage_location_name: targetLocation.name,
                            storage_location_icon: targetLocation.icon,
                            cabinet_id: null,
                            cabinet_name: null,
                            shelf_id: null,
                            shelf_level: null,
                        };
                    }));
                }
            } else {
                const targetCabinet = cabinets.find(cab => cab.id === bulkMoveCabinetId);
                if (!targetCabinet) {
                    setBulkMoveError(t('inventory_bulk_move_invalid_cabinet'));
                    return;
                }

                const moveCandidates = eligibleItems.filter(
                    item => !(item.storage_type === 'cabinet' && item.cabinet_id === bulkMoveCabinetId)
                );
                unchangedCount = eligibleItems.length - moveCandidates.length;

                if (moveCandidates.length === 0) {
                    setBulkMoveInfo(t('inventory_bulk_move_all_already_target'));
                    return;
                }

                const successShelfLevelById = new Map<string, number>();
                const cabinetItemNewIdByOldId = new Map<string, string>();

                for (const item of moveCandidates) {
                    const sourceGeometry = await getSourcePlacementGeometry(item);
                    const template = sourceGeometry?.template ?? guessTemplate(item.capacity || '');
                    const width = sourceGeometry?.width ?? CONTAINER_BASE_WIDTHS[template];
                    let placedItemId: string | null = null;
                    let isInventoryUpdated = false;
                    try {
                        const store = useFridgeStore.getState();
                        await store.loadCabinet(targetCabinet.id);

                        const placementResult = store.autoPlaceReagent({
                            id: '',
                            reagentId: item.id,
                            name: item.name,
                            width,
                            template,
                            isAcidic: false,
                            isBasic: false,
                            hCodes: [],
                            notes: item.memo || undefined,
                            casNo: item.cas_number || undefined,
                            expiryDate: item.expiry_date || undefined,
                            capacity: item.capacity || undefined,
                            productNumber: item.product_number || undefined,
                            brand: item.brand || undefined,
                        });

                        if (!placementResult) {
                            noSpaceCount += 1;
                            continue;
                        }

                        placedItemId = placementResult.itemId;
                        await persistLoadedCabinetStateStrict(targetCabinet.id);
                        cabinetService.logActivity(targetCabinet.id, 'add', item.name, undefined, item.memo || undefined)
                            .catch((error) => console.error('Failed to log cabinet activity for bulk move:', error));

                        if (item._source === 'inventory') {
                            await inventoryService.updateItem(item.id, {
                                storage_type: 'cabinet',
                                cabinet_id: targetCabinet.id,
                            }, 'inventory');
                            isInventoryUpdated = true;

                            if (item.storage_type === 'cabinet' && item.cabinet_id && item.cabinet_id !== targetCabinet.id) {
                                const removed = await removeFromCabinetByInventoryItem(item);
                                if (!removed) {
                                    throw new Error('cabinet_sync_failed');
                                }
                            }
                        } else {
                            if (!item.cabinet_id) {
                                throw new Error('source_remove_failed');
                            }
                            const removed = await removeCabinetItemById(item.cabinet_id, item, item.memo || undefined);
                            if (!removed) {
                                throw new Error('source_remove_failed');
                            }
                            cabinetItemNewIdByOldId.set(item.id, placementResult.itemId);
                        }

                        successIds.push(item.id);
                        successShelfLevelById.set(item.id, placementResult.shelfLevel - 1);
                    } catch (error) {
                        try {
                            if (placedItemId) {
                                const rollbackStore = useFridgeStore.getState();
                                await rollbackStore.loadCabinet(targetCabinet.id);
                                const rollbackTarget = rollbackStore.shelves
                                    .flatMap(shelf => shelf.items)
                                    .find(placed => placed.id === placedItemId);
                                if (rollbackTarget) {
                                    rollbackStore.removeReagent(rollbackTarget.id);
                                    await persistLoadedCabinetStateStrict(targetCabinet.id);
                                }
                            }
                        } catch (rollbackError) {
                            rollbackFailedCount += 1;
                            console.error('Rollback after cabinet bulk move failed:', rollbackError);
                        }

                        if (isInventoryUpdated && item._source === 'inventory') {
                            try {
                                await inventoryService.updateItem(item.id, {
                                    storage_type: item.storage_type,
                                    cabinet_id: item.storage_type === 'cabinet' ? (item.cabinet_id || undefined) : undefined,
                                    storage_location_id: item.storage_type === 'other' ? (item.storage_location_id || undefined) : undefined,
                                }, 'inventory');
                            } catch (rollbackError) {
                                rollbackFailedCount += 1;
                                console.error('Rollback inventory update after cabinet move failed:', rollbackError);
                            }
                        }

                        if (error instanceof Error && error.message === 'cabinet_sync_failed') {
                            cabinetSyncFailedCount += 1;
                        } else if (error instanceof Error && error.message === 'source_remove_failed') {
                            sourceRemoveFailedCount += 1;
                            sourceRemoveFailedNames.push(item.name);
                        } else {
                            placementFailedCount += 1;
                            console.error('Failed to bulk move item to cabinet:', error);
                        }
                        failedCount += 1;
                    }
                }

                if (successIds.length > 0) {
                    setItems(prev => prev.map(item => {
                        if (!successIds.includes(item.id)) return item;
                        const nextId = item._source === 'cabinet_item'
                            ? (cabinetItemNewIdByOldId.get(item.id) || item.id)
                            : item.id;
                        return {
                            ...item,
                            id: nextId,
                            storage_type: 'cabinet',
                            cabinet_id: targetCabinet.id,
                            cabinet_name: targetCabinet.name,
                            shelf_id: item.shelf_id || null,
                            shelf_level: successShelfLevelById.get(item.id) ?? null,
                            storage_location_id: null,
                            storage_location_name: null,
                            storage_location_icon: null,
                        };
                    }));
                }
            }

            const movedCount = successIds.length;
            if (movedCount > 0) {
                setBulkMoveInfo(t('inventory_bulk_move_success', { count: movedCount }));
            }

            if (
                failedCount > 0 ||
                ineligibleCount > 0 ||
                unchangedCount > 0 ||
                noSpaceCount > 0 ||
                placementFailedCount > 0 ||
                cabinetSyncFailedCount > 0 ||
                sourceRemoveFailedCount > 0 ||
                rollbackFailedCount > 0
            ) {
                const details: string[] = [];
                if (failedCount > 0) details.push(t('inventory_bulk_move_failed_part', { count: failedCount }));
                if (ineligibleCount > 0) details.push(t('inventory_bulk_move_ineligible_part', { count: ineligibleCount }));
                if (unchangedCount > 0) details.push(t('inventory_bulk_move_unchanged_part', { count: unchangedCount }));
                if (noSpaceCount > 0) details.push(t('inventory_bulk_move_no_space_part', { count: noSpaceCount }));
                if (placementFailedCount > 0) details.push(t('inventory_bulk_move_place_failed_part', { count: placementFailedCount }));
                if (cabinetSyncFailedCount > 0) details.push(t('inventory_bulk_move_cabinet_sync_failed_part', { count: cabinetSyncFailedCount }));
                if (sourceRemoveFailedCount > 0) details.push(t('inventory_bulk_move_source_remove_failed_part', { count: sourceRemoveFailedCount }));
                if (sourceRemoveFailedNames.length > 0) {
                    details.push(t('inventory_bulk_move_source_remove_failed_detail', {
                        items: sourceRemoveFailedNames.slice(0, 3).join(', '),
                    }));
                }
                if (rollbackFailedCount > 0) details.push(t('inventory_bulk_move_rollback_failed_part', { count: rollbackFailedCount }));
                setBulkMoveError(details.join(' '));
                setSelectedItemIds(prev => prev.filter(id => !successIds.includes(id)));
            } else {
                setSelectedItemIds([]);
                setIsSelectMode(false);
            }
        } finally {
            setIsBulkMoving(false);
            setIsBulkMoveConfirmOpen(false);
        }
    };

    const renderStorageBadge = (item: InventoryItem) => {
        if (item.storage_type === 'cabinet') {
            const shelfLabel = typeof item.shelf_level === 'number'
                ? t('inventory_shelf_level', { level: item.shelf_level + 1 })
                : '';
            return (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    <Archive className="w-3.5 h-3.5" />
                    {item.cabinet_name || t('inventory_cabinet_unassigned')}{shelfLabel}
                </span>
            );
        }

        return (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                <MapPin className="w-3.5 h-3.5" />
                {item.storage_location_icon || '📦'} {translateLocationName(item.storage_location_name, t) || t('inventory_other_storage')}
            </span>
        );
    };

    const renderExpiryBadge = (item: InventoryItem) => {
        const status = getExpiryStatus(item.expiry_date);
        if (!status || status.level === 'ok') return null;

        const badgeClasses = getExpiryBadgeClasses(status.level);
        const icon = status.level === 'expired'
            ? <AlertTriangle className="w-3 h-3" />
            : <Clock className="w-3 h-3" />;

        return (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${badgeClasses}`}>
                {icon}
                {t(status.labelKey, status.labelParams)}
            </span>
        );
    };

    const removeFromCabinetByInventoryItem = async (item: InventoryItem): Promise<boolean> => {
        if (!item.cabinet_id) return false;

        const store = useFridgeStore.getState();
        await store.loadCabinet(item.cabinet_id);

        const placement = store.shelves
            .flatMap(shelf => shelf.items)
            .find(placed =>
                placed.reagentId === item.id ||
                (
                    normalizeText(placed.name) === normalizeText(item.name) &&
                    normalizeText(placed.brand) === normalizeText(item.brand) &&
                    normalizeText(placed.productNumber) === normalizeText(item.product_number) &&
                    normalizeText(placed.capacity) === normalizeText(item.capacity) &&
                    normalizeText(placed.casNo) === normalizeText(item.cas_number)
                )
            );

        if (!placement) return false;

        const deleted = await deleteCabinetItemRow(item.cabinet_id, placement.id);
        if (!deleted) return false;
        cabinetService.logActivity(item.cabinet_id, 'remove', item.name, t('inventory_bulk_move_reason'), item.memo || undefined)
            .catch((error) => console.error('Failed to log cabinet remove activity for bulk move:', error));

        return true;
    };

    const removeCabinetItemById = async (
        cabinetId: string,
        sourceItem: InventoryItem,
        memo?: string
    ): Promise<boolean> => {
        if (sourceItem.id) {
            const deletedById = await deleteCabinetItemRow(cabinetId, sourceItem.id);
            if (deletedById) {
                cabinetService.logActivity(cabinetId, 'remove', sourceItem.name, t('inventory_bulk_move_reason'), memo)
                    .catch((error) => console.error('Failed to log cabinet remove activity for cabinet-item move:', error));
                return true;
            }
        }

        const store = useFridgeStore.getState();
        await store.loadCabinet(cabinetId);

        const shelfItems = store.shelves.flatMap(shelf => shelf.items);
        const placementById = shelfItems.find(placed => placed.id === sourceItem.id);
        const placementByFingerprint = shelfItems.find(placed =>
            normalizeText(placed.name) === normalizeText(sourceItem.name) &&
            normalizeText(placed.brand) === normalizeText(sourceItem.brand) &&
            normalizeText(placed.productNumber) === normalizeText(sourceItem.product_number) &&
            normalizeText(placed.capacity) === normalizeText(sourceItem.capacity) &&
            normalizeText(placed.casNo) === normalizeText(sourceItem.cas_number)
        );
        const placement = placementById || placementByFingerprint;

        if (!placement) return false;

        const deleted = await deleteCabinetItemRow(cabinetId, placement.id);
        if (!deleted) return false;
        cabinetService.logActivity(cabinetId, 'remove', sourceItem.name, t('inventory_bulk_move_reason'), memo)
            .catch((error) => console.error('Failed to log cabinet remove activity for cabinet-item move:', error));

        return true;
    };

    const deleteCabinetItemRow = async (cabinetId: string, cabinetItemId: string): Promise<boolean> => {
        const { data, error } = await supabase
            .from('cabinet_items')
            .delete()
            .eq('cabinet_id', cabinetId)
            .eq('id', cabinetItemId)
            .select('id');
        if (error) {
            console.error('Failed to delete cabinet item row directly:', error);
            return false;
        }
        return (data || []).length > 0;
    };

    const getSourcePlacementGeometry = async (
        item: InventoryItem
    ): Promise<{ template: ReagentTemplateType; width: number } | null> => {
        if (item.storage_type !== 'cabinet' || !item.cabinet_id) return null;

        // 1) DB 원본 우선 조회: id가 정확히 매칭되면 템플릿/너비를 가장 신뢰할 수 있다.
        const { data: exactRow, error: exactRowError } = await supabase
            .from('cabinet_items')
            .select('id, template, width')
            .eq('cabinet_id', item.cabinet_id)
            .eq('id', item.id)
            .maybeSingle();
        if (exactRowError) {
            console.error('Failed to fetch source cabinet geometry by id:', exactRowError);
        } else if (exactRow?.template && Number.isFinite(Number(exactRow.width)) && Number(exactRow.width) > 0) {
            return {
                template: exactRow.template as ReagentTemplateType,
                width: Number(exactRow.width),
            };
        }

        // 2) id 매칭이 안 될 때, fingerprint로 DB에서 한 번 더 시도
        const { data: fingerprintRows, error: fingerprintError } = await supabase
            .from('cabinet_items')
            .select('id, template, width, name, brand, product_number, capacity, cas_no')
            .eq('cabinet_id', item.cabinet_id)
            .eq('name', item.name);
        if (fingerprintError) {
            console.error('Failed to fetch source cabinet geometry by fingerprint:', fingerprintError);
        } else {
            const fingerprintRow = (fingerprintRows || []).find((row: any) =>
                normalizeText(row.brand) === normalizeText(item.brand) &&
                normalizeText(row.product_number) === normalizeText(item.product_number) &&
                normalizeText(row.capacity) === normalizeText(item.capacity) &&
                normalizeText(row.cas_no) === normalizeText(item.cas_number)
            );
            if (fingerprintRow?.template && Number.isFinite(Number(fingerprintRow.width)) && Number(fingerprintRow.width) > 0) {
                return {
                    template: fingerprintRow.template as ReagentTemplateType,
                    width: Number(fingerprintRow.width),
                };
            }
        }

        // 3) 마지막 fallback: 현재 로드된 store에서 탐색
        const store = useFridgeStore.getState();
        await store.loadCabinet(item.cabinet_id);
        const placement = store.shelves
            .flatMap(shelf => shelf.items)
            .find(placed =>
                placed.id === item.id ||
                placed.reagentId === item.id ||
                (
                    normalizeText(placed.name) === normalizeText(item.name) &&
                    normalizeText(placed.brand) === normalizeText(item.brand) &&
                    normalizeText(placed.productNumber) === normalizeText(item.product_number) &&
                    normalizeText(placed.capacity) === normalizeText(item.capacity) &&
                    normalizeText(placed.casNo) === normalizeText(item.cas_number)
                )
            );
        if (!placement) return null;
        const template = placement.template as ReagentTemplateType;
        const width = Number(placement.width);
        if (!template || !Number.isFinite(width) || width <= 0) return null;
        return { template, width };
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-4 py-4 flex-shrink-0">
                <div className="flex items-center justify-between gap-2">
                    <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Package className="w-6 h-6 text-emerald-500" />
                        {t('inventory_list_title')}
                    </h1>
                    <button
                        onClick={() => setIsCsvImportOpen(true)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 whitespace-nowrap"
                    >
                        {t('inventory_csv_manage_button')}
                    </button>
                </div>

                {showOnboardingGuide && (
                    <div className="mt-4">
                        <OnboardingGuideCard
                            icon={<Package className="h-5 w-5" />}
                            title={t('onboarding_inventory_title')}
                            description={t('onboarding_inventory_desc')}
                            points={[
                                t('onboarding_inventory_point_1'),
                                t('onboarding_inventory_point_2'),
                                t('onboarding_inventory_point_3'),
                            ]}
                            onDismiss={() => markGuideSeen('inventory')}
                        />
                    </div>
                )}

                {/* Search Bar */}
                <div className="mt-4 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('inventory_search_placeholder')}
                        className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-slate-50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-shadow"
                    />
                </div>
                <div className="mt-3 flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        <ArrowUpDown className="w-3.5 h-3.5" />
                        {t('sort_by')}
                    </label>
                    <AppSelect
                        value={sortBy}
                        onChange={(value) => setSortBy(value as InventorySortOption)}
                        options={sortOptions}
                        className="min-w-0 flex-1"
                        buttonClassName="min-w-0 flex-1 bg-white dark:bg-slate-700/50"
                    />
                </div>
                {isSelectMode ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            onClick={toggleSelectMode}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold border bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200"
                        >
                            {t('inventory_exit_select_mode')}
                        </button>
                        <button
                            onClick={handleSelectAllFiltered}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 text-slate-600 dark:text-slate-200"
                        >
                            {selectedFilteredCount === visibleItems.length && visibleItems.length > 0
                                ? t('inventory_unselect_all_filtered')
                                : t('inventory_select_all_filtered')}
                        </button>
                        <button
                            onClick={() => setSelectedItemIds([])}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 text-slate-600 dark:text-slate-200"
                        >
                            {t('inventory_clear_selection')}
                        </button>
                        <button
                            onClick={handleOpenBulkDeleteConfirm}
                            disabled={selectedItemIds.length === 0 || isBulkDeleting || isBulkMoving}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 dark:border-red-700 text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {isBulkDeleting
                                ? t('inventory_bulk_delete_running')
                                : t('inventory_bulk_delete_btn', { count: selectedItemIds.length })}
                        </button>
                        <div className="flex items-center gap-2">
                            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                                <button
                                    onClick={() => setBulkMoveTargetType('cabinet')}
                                    className={`px-2.5 py-1.5 text-xs font-semibold ${bulkMoveTargetType === 'cabinet'
                                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                                        : 'bg-white dark:bg-slate-700/50 text-slate-600 dark:text-slate-200'
                                        }`}
                                >
                                    {t('inventory_bulk_move_target_cabinet')}
                                </button>
                                <button
                                    onClick={() => setBulkMoveTargetType('other')}
                                    className={`px-2.5 py-1.5 text-xs font-semibold border-l border-slate-200 dark:border-slate-600 ${bulkMoveTargetType === 'other'
                                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                        : 'bg-white dark:bg-slate-700/50 text-slate-600 dark:text-slate-200'
                                        }`}
                                >
                                    {t('inventory_bulk_move_target_other')}
                                </button>
                            </div>
                            {bulkMoveTargetType === 'other' ? (
                                <AppSelect
                                    value={bulkMoveLocationId}
                                    onChange={setBulkMoveLocationId}
                                    options={bulkMoveLocationOptions}
                                    size="sm"
                                    className="min-w-[132px]"
                                    buttonClassName="min-w-[132px] bg-white dark:bg-slate-700/50 text-slate-600 dark:text-slate-200"
                                />
                            ) : (
                                <AppSelect
                                    value={bulkMoveCabinetId}
                                    onChange={setBulkMoveCabinetId}
                                    options={bulkMoveCabinetOptions}
                                    size="sm"
                                    className="min-w-[132px]"
                                    buttonClassName="min-w-[132px] bg-white dark:bg-slate-700/50 text-slate-600 dark:text-slate-200"
                                />
                            )}
                            <button
                                onClick={handleOpenBulkMoveConfirm}
                                disabled={
                                    selectedItemIds.length === 0 ||
                                    isBulkMoving ||
                                    (bulkMoveTargetType === 'other' ? !bulkMoveLocationId : !bulkMoveCabinetId)
                                }
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {isBulkMoving
                                    ? t('inventory_bulk_move_running')
                                    : t('inventory_bulk_move_btn', { count: selectedItemIds.length })}
                            </button>
                        </div>
                    </div>
                ) : (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {t('inventory_long_press_hint')}
                    </p>
                )}
                {isSelectMode && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {t('inventory_selected_count', { count: selectedItemIds.length })}
                    </p>
                )}
                {bulkDeleteError && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {bulkDeleteError}
                    </p>
                )}
                {bulkMoveError && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {bulkMoveError}
                    </p>
                )}
                {bulkMoveInfo && (
                    <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                        {bulkMoveInfo}
                    </p>
                )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-3">
                {/* Expiry Summary Banner */}
                {!isLoading && (expirySummary.expiredCount > 0 || expirySummary.warningCount > 0) && (
                    <div className="flex items-start gap-3 p-3.5 rounded-xl border bg-gradient-to-r from-red-50 to-amber-50 dark:from-red-950/30 dark:to-amber-950/30 border-red-200/60 dark:border-red-900/40 animate-in fade-in slide-in-from-top-2 duration-300">
                        <AlertTriangle className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
                        <div className="flex flex-col gap-1 text-sm">
                            <span className="font-semibold text-slate-800 dark:text-slate-100">{t('expiry_summary_title')}</span>
                            <div className="flex flex-wrap gap-2 text-xs">
                                {expirySummary.expiredCount > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-medium">
                                        🔴 {t('expiry_summary_expired', { count: expirySummary.expiredCount })}
                                    </span>
                                )}
                                {expirySummary.warningCount > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                                        🟡 {t('expiry_summary_warning', { count: expirySummary.warningCount })}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                    </div>
                ) : visibleItems.length > 0 ? (
                    visibleItems.map(item => {
                        const expiryStatus = getExpiryStatus(item.expiry_date);
                        const cardBorderClass = expiryStatus ? getExpiryCardBorderClass(expiryStatus.level) : '';

                        return (
                            <div
                                key={item.id}
                                onPointerDown={() => startLongPress(item.id)}
                                onPointerUp={clearLongPressTimer}
                                onPointerCancel={clearLongPressTimer}
                                onPointerLeave={clearLongPressTimer}
                                onClick={() => {
                                    if (longPressTriggeredRef.current) {
                                        longPressTriggeredRef.current = false;
                                        return;
                                    }
                                    if (isSelectMode) {
                                        toggleItemSelection(item.id);
                                        return;
                                    }
                                    handleEdit(item);
                                }}
                                className={`bg-white dark:bg-slate-800 p-4 rounded-xl border shadow-sm flex flex-col gap-3 cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-600 transition-colors ${cardBorderClass || 'border-slate-200 dark:border-slate-700'
                                    }`}
                            >
                                <div className="flex justify-between items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                        {isSelectMode && (
                                            <label
                                                className="inline-flex items-center gap-2 mb-2 text-xs text-slate-500 dark:text-slate-400"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedItemIds.includes(item.id)}
                                                    onChange={() => toggleItemSelection(item.id)}
                                                    className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                                />
                                                {t('inventory_select_item')}
                                            </label>
                                        )}
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base break-words">
                                                {item.name}
                                            </h3>
                                            {renderExpiryBadge(item)}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                                            {item.cas_number && <span>CAS: {item.cas_number}</span>}
                                            {item.brand && <span>{item.brand}</span>}
                                            {item.product_number && <span>PN: {item.product_number}</span>}
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end shrink-0">
                                        <span className="text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-md">
                                            {item.quantity}개
                                        </span>
                                        {item.capacity && (
                                            <span className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                                {item.capacity}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700">
                                    {renderStorageBadge(item)}

                                    {!isSelectMode && (
                                        <button
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={(e) => { e.stopPropagation(); handleDeleteClick(item); }}
                                            disabled={isDeleting || isBulkDeleting}
                                            className="text-xs text-red-500 hover:text-red-700 disabled:text-red-300 disabled:cursor-not-allowed font-medium px-2 py-1"
                                        >
                                            {t('inventory_btn_delete')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <EmptyState variant={searchQuery ? 'inventory_search' : 'inventory'} />
                )}
            </div>

            {/* FAB */}
            <button
                onClick={() => { setEditingItem(null); setIsFormOpen(true); }}
                className="absolute bottom-24 right-5 w-14 h-14 bg-emerald-500 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-emerald-600 active:scale-95 transition-all z-10"
            >
                <Plus className="w-6 h-6" />
            </button>

            {/* Modal */}
            <InventoryFormModal
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                locations={locations}
                initialData={editingItem}
                onSaved={loadData}
            />

            <InventoryCsvImportModal
                isOpen={isCsvImportOpen}
                items={items}
                locations={locations}
                cabinets={cabinets}
                onClose={() => setIsCsvImportOpen(false)}
                onImported={loadData}
            />

            <CustomDialog
                isOpen={!!itemToDelete}
                onClose={() => setItemToDelete(null)}
                title={t('inventory_delete_title')}
                description={itemToDelete ? t('inventory_delete_desc', { name: itemToDelete.name }) : ''}
                type="confirm"
                isDestructive={true}
                onConfirm={confirmDelete}
                confirmText={t('btn_confirm')}
                cancelText={t('btn_cancel')}
                isConfirmLoading={isDeleting}
                preventCloseWhileLoading={true}
            />

            <CustomDialog
                isOpen={isBulkDeleteConfirmOpen}
                onClose={() => setIsBulkDeleteConfirmOpen(false)}
                title={t('inventory_bulk_delete_title')}
                description={t('inventory_bulk_delete_desc', { count: selectedItemIds.length })}
                type="confirm"
                isDestructive={true}
                onConfirm={confirmBulkDelete}
                confirmText={t('inventory_bulk_delete_confirm')}
                cancelText={t('btn_cancel')}
                isConfirmLoading={isBulkDeleting}
                preventCloseWhileLoading={true}
            />

            <CustomDialog
                isOpen={isBulkMoveConfirmOpen}
                onClose={() => setIsBulkMoveConfirmOpen(false)}
                title={t('inventory_bulk_move_title')}
                description={t('inventory_bulk_move_desc', { count: selectedItemIds.length })}
                type="confirm"
                isDestructive={false}
                onConfirm={confirmBulkMove}
                confirmText={t('inventory_bulk_move_confirm')}
                cancelText={t('btn_cancel')}
                isConfirmLoading={isBulkMoving}
                preventCloseWhileLoading={true}
            />
        </div>
    );
};
