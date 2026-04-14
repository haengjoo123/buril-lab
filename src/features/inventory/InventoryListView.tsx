import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Package,
    Plus,
    Search,
    Archive,
    MapPin,
    Loader2,
    AlertTriangle,
    Clock,
    Download,
    Upload,
    ShieldAlert
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { inventoryService, storageLocationService, type InventoryItem, type StorageLocation } from '../../services/inventoryService';
import { cabinetService, type Cabinet } from '../../services/cabinetService';
import { analyticsService } from '../../services/analyticsService';
import { InventoryFormModal } from './InventoryFormModal';
import { InventoryCsvImportModal } from './InventoryCsvImportModal';
import { CustomDialog } from '../../components/CustomDialog';
import { CasSuggestionCard } from '../../components/CasSuggestionCard';
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
import { guessTemplateFromCapacity, getWidthForTemplate } from '../../utils/guessReagentTemplate';
import type { ReagentTemplateType } from '../../types/fridge';
import { normalizeTemplateFromDb } from '../../utils/normalizeTemplateFromDb';
import { classifyInventoryHazard } from '../../utils/inventoryHazardClassifier';
import { resolveCasSuggestions, type CasResolveItemResult } from '../../services/casSuggestionService';

type BulkMoveTargetType = 'other' | 'cabinet';
type InventorySortOption = 'expiry_asc' | 'location_asc' | 'name_asc' | 'remaining_asc' | 'created_at_desc' | 'created_at_asc';
type CasReviewEntry = { item: InventoryItem; suggestion: CasResolveItemResult };

const normalizeText = (value?: string | null) => (value || '').trim().toLowerCase();
const isBlankCas = (value?: string | null) => !(value || '').trim();
const getCasReviewCardState = (suggestion: CasResolveItemResult): 'suggestion' | 'unavailable' => (
    suggestion.status === 'match' && (suggestion.confidence === 'high' || suggestion.confidence === 'medium')
        ? 'suggestion'
        : 'unavailable'
);

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

    if (sortBy === 'remaining_asc') {
        const remainingA = a.remaining_percent ?? 100;
        const remainingB = b.remaining_percent ?? 100;
        if (remainingA !== remainingB) return remainingA - remainingB;
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
    const [hazardFilter, setHazardFilter] = useState(false);
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
    const [isCasReviewOpen, setIsCasReviewOpen] = useState(false);
    const [isCasReviewLoading, setIsCasReviewLoading] = useState(false);
    const [isApplyingCasReview, setIsApplyingCasReview] = useState(false);
    const [casReviewEntries, setCasReviewEntries] = useState<CasReviewEntry[]>([]);
    const [selectedCasReviewIds, setSelectedCasReviewIds] = useState<string[]>([]);
    const [casReviewError, setCasReviewError] = useState<string | null>(null);
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
        setIsCasReviewOpen(false);
        setIsCasReviewLoading(false);
        setIsApplyingCasReview(false);
        setCasReviewEntries([]);
        setSelectedCasReviewIds([]);
        setCasReviewError(null);
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
        let result = items;

        if (normalizedQuery) {
            result = result.filter(item =>
                item.name.toLowerCase().includes(normalizedQuery) ||
                (item.brand && item.brand.toLowerCase().includes(normalizedQuery)) ||
                (item.product_number && item.product_number.toLowerCase().includes(normalizedQuery)) ||
                (item.cas_number && item.cas_number.toLowerCase().includes(normalizedQuery))
            );
        }

        if (hazardFilter) {
            result = result.filter(item => classifyInventoryHazard(item).level === 'high');
        }

        return result;
    }, [items, searchQuery, hazardFilter]);

    // Hazard summary for showing count
    const hazardSummary = useMemo(() => {
        let count = 0;
        for (const item of items) {
            if (classifyInventoryHazard(item).level === 'high') count++;
        }
        return count;
    }, [items]);

    // 만료/위치 우선으로 빠르게 확인할 수 있게 화면 전용 정렬 목록을 만든다.
    const visibleItems = useMemo(() => {
        return [...filteredItems].sort((a, b) => compareInventoryItems(a, b, sortBy));
    }, [filteredItems, sortBy]);

    const sortOptions = useMemo(() => ([
        { value: 'expiry_asc', label: t('inventory_sort_expiry_asc') },
        { value: 'location_asc', label: t('inventory_sort_location_asc') },
        { value: 'name_asc', label: t('inventory_sort_name_asc') },
        { value: 'remaining_asc', label: t('inventory_sort_remaining_asc') },
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
    const blankCasItems = useMemo(() => items.filter((item) => isBlankCas(item.cas_number)), [items]);
    const casReviewSuggestedEntries = useMemo(
        () => casReviewEntries.filter((entry) => getCasReviewCardState(entry.suggestion) === 'suggestion'),
        [casReviewEntries]
    );
    const casReviewBlockedEntries = useMemo(
        () => casReviewEntries.filter((entry) => entry.suggestion.status !== 'skipped' && getCasReviewCardState(entry.suggestion) === 'unavailable'),
        [casReviewEntries]
    );
    const selectedCasReviewCount = selectedCasReviewIds.length;

    const handleEdit = (item: InventoryItem) => {
        setEditingItem(item);
        setIsFormOpen(true);
    };

    const handleDeleteClick = (item: InventoryItem) => {
        setItemToDelete(item);
    };

    const handleOpenCasReview = async () => {
        if (blankCasItems.length === 0 || isCasReviewLoading) return;

        setIsCasReviewOpen(true);
        setIsCasReviewLoading(true);
        setIsApplyingCasReview(false);
        setCasReviewError(null);
        setCasReviewEntries([]);
        setSelectedCasReviewIds([]);

        try {
            const results = await resolveCasSuggestions(
                blankCasItems.map((item) => ({
                    id: item.id,
                    inputName: item.name,
                    sourceType: 'inventory_bulk_review',
                    brand: item.brand || undefined,
                    productNumber: item.product_number || undefined,
                    capacity: item.capacity || undefined,
                }))
            );

            const itemMap = new Map(blankCasItems.map((item) => [item.id, item] as const));
            const nextEntries = results
                .map((suggestion) => {
                    const item = itemMap.get(suggestion.id);
                    return item ? { item, suggestion } : null;
                })
                .filter((entry): entry is CasReviewEntry => Boolean(entry));

            setCasReviewEntries(nextEntries);
            setSelectedCasReviewIds(
                nextEntries
                    .filter((entry) => entry.suggestion.status === 'match' && entry.suggestion.confidence === 'high' && Boolean(entry.suggestion.casNumber))
                    .map((entry) => entry.item.id)
            );
        } catch (error) {
            console.error('Failed to resolve bulk CAS suggestions:', error);
            setCasReviewError('CAS 후보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
        } finally {
            setIsCasReviewLoading(false);
        }
    };

    const handleCloseCasReview = () => {
        if (isApplyingCasReview) return;
        setIsCasReviewOpen(false);
        setIsCasReviewLoading(false);
        setCasReviewError(null);
        setCasReviewEntries([]);
        setSelectedCasReviewIds([]);
    };

    const toggleCasReviewSelection = (itemId: string) => {
        setSelectedCasReviewIds((prev) =>
            prev.includes(itemId)
                ? prev.filter((id) => id !== itemId)
                : [...prev, itemId]
        );
    };

    const handleApplyCasReview = async () => {
        if (selectedCasReviewIds.length === 0 || isApplyingCasReview) return;

        const selectedEntries = casReviewSuggestedEntries.filter((entry) => selectedCasReviewIds.includes(entry.item.id) && entry.suggestion.casNumber);
        if (selectedEntries.length === 0) return;

        setIsApplyingCasReview(true);
        setCasReviewError(null);

        try {
            let successCount = 0;
            let failedCount = 0;
            const successfulIds = new Set<string>();

            for (const entry of selectedEntries) {
                try {
                    await inventoryService.updateItemCasWithLinkedSync(entry.item, entry.suggestion.casNumber);
                    successCount += 1;
                    successfulIds.add(entry.item.id);
                    await analyticsService.trackCommerceIntentEvent({
                        eventType: entry.item._source === 'cabinet_item' ? 'cabinet_item_updated' : 'inventory_updated',
                        sourceScreen: 'inventory_list_view',
                        storageType: entry.item.storage_type,
                        sourceItemType: entry.item._source || 'inventory',
                        sourceItemId: entry.item.id,
                        brandName: entry.item.brand,
                        productNumber: entry.item.product_number,
                        quantity: entry.item.quantity,
                        capacityText: entry.item.capacity,
                        casNumber: entry.suggestion.casNumber,
                        casInputMethod: 'bulk_confirmed',
                        metadata: {
                            action: 'bulk_cas_review',
                            canonical_name: entry.suggestion.canonicalName,
                            localized_name: entry.suggestion.localizedName,
                            confidence: entry.suggestion.confidence,
                            sources: entry.suggestion.sources,
                        },
                    });
                } catch (error) {
                    failedCount += 1;
                    console.error('Failed to apply bulk CAS suggestion:', error);
                }
            }

            await loadData();

            if (successCount > 0) {
                setBulkMoveInfo(`CAS ${successCount}건을 적용했어요.`);
            }

            if (failedCount > 0) {
                setCasReviewError(`${failedCount}개 항목은 적용하지 못했어요. 다시 시도해 주세요.`);
                setCasReviewEntries((prev) => prev.filter((entry) => !successfulIds.has(entry.item.id)));
                setSelectedCasReviewIds((prev) => prev.filter((id) => !successfulIds.has(id)));
                return;
            }

            setIsCasReviewOpen(false);
            setIsCasReviewLoading(false);
            setCasReviewError(null);
            setCasReviewEntries([]);
            setSelectedCasReviewIds([]);
        } finally {
            setIsApplyingCasReview(false);
        }
    };

    const handleExportExcel = () => {
        const rowsForExport = visibleItems.map((item) => {

            return {
                [t('inventory_csv_table_name')]: item.name,
                [t('inventory_brand')]: item.brand || '',
                [t('inventory_product_number')]: item.product_number || '',
                [t('inventory_cas_number')]: item.cas_number || '',
                [t('inventory_quantity')]: item.quantity,
                [t('inventory_capacity')]: item.capacity || '',
                [t('inventory_csv_table_storage')]: item.storage_type === 'cabinet'
                    ? `${item.cabinet_name || t('inventory_loc_cabinet')}${typeof item.shelf_level === 'number' ? ` (${t('inventory_shelf_level', { level: Number(item.shelf_level) + 1 })})` : ''}`
                    : (item.storage_location_name || t('inventory_loc_other')),
                [t('inventory_expiry_date')]: item.expiry_date || '',
                [t('inventory_memo')]: item.memo || ''
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(rowsForExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");

        const timestamp = new Date().toISOString().split('T')[0];
        const fileName = `inventory_export_${timestamp}.xlsx`;
        XLSX.writeFile(workbook, fileName);
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
                    const template = sourceGeometry?.template ?? guessTemplateFromCapacity(item.capacity || '');
                    const width = sourceGeometry?.width ?? getWidthForTemplate(template);
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
                    {item.cabinet_name || t('inventory_cabinet_unassigned')}{shelfLabel ? ` · ${shelfLabel}` : ''}
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

    const renderRemainingBadge = (item: InventoryItem) => {
        const val = item.remaining_percent ?? 100;

        let colorClass = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
        let barColor = 'bg-emerald-500';
        let stage = 4;

        if (val <= 10) {
            colorClass = 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400';
            barColor = 'bg-red-500';
            stage = 1;
        } else if (val <= 30) {
            colorClass = 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400';
            barColor = 'bg-orange-500';
            stage = 2;
        } else if (val <= 70) {
            colorClass = 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
            barColor = 'bg-blue-500';
            stage = 3;
        }

        return (
            <div className="flex flex-col gap-1 min-w-[64px] ml-auto sm:ml-0 overflow-hidden">
                <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold ${colorClass} leading-none truncate whitespace-nowrap`}>
                    {t(`inventory_remaining_stage_${stage}_label`)}
                </span>
                <div className="w-full h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                        className={`h-full ${barColor} transition-all duration-500`}
                        style={{ width: `${val}%` }}
                    />
                </div>
            </div>
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
                template: normalizeTemplateFromDb(exactRow.template),
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
            const fingerprintRow = (fingerprintRows || []).find((row: {
                brand?: string | null;
                product_number?: string | null;
                capacity?: string | null;
                cas_no?: string | null;
                template?: ReagentTemplateType | null;
                width?: number | string | null;
            }) =>
                normalizeText(row.brand) === normalizeText(item.brand) &&
                normalizeText(row.product_number) === normalizeText(item.product_number) &&
                normalizeText(row.capacity) === normalizeText(item.capacity) &&
                normalizeText(row.cas_no) === normalizeText(item.cas_number)
            );
            if (fingerprintRow?.template && Number.isFinite(Number(fingerprintRow.width)) && Number(fingerprintRow.width) > 0) {
                return {
                    template: normalizeTemplateFromDb(fingerprintRow.template),
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
        const template = normalizeTemplateFromDb(placement.template);
        const width = Number(placement.width);
        if (!template || !Number.isFinite(width) || width <= 0) return null;
        return { template, width };
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-4 pt-4 pb-3 flex-shrink-0">
                <div className="flex items-center justify-between gap-2">
                    <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 shrink-0 whitespace-nowrap">
                        <Package className="w-6 h-6 text-emerald-500" />
                        {t('inventory_list_title')}
                    </h1>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={handleOpenCasReview}
                            disabled={blankCasItems.length === 0 || isCasReviewLoading}
                            title="빈 CAS 보완"
                            className="p-1.5 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 flex items-center gap-1.5 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Search className={`w-4 h-4 lg:w-3.5 lg:h-3.5 ${isCasReviewLoading ? 'animate-pulse' : ''}`} />
                            <span className="hidden lg:inline whitespace-nowrap">빈 CAS 보완</span>
                        </button>
                        <button
                            onClick={handleExportExcel}
                            title={t('inventory_excel_download_view')}
                            className="p-1.5 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 flex items-center gap-1.5 transition-colors hover:bg-blue-100 dark:hover:bg-blue-900/40"
                        >
                            <Download className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                            <span className="hidden lg:inline whitespace-nowrap">{t('inventory_excel_download_view')}</span>
                        </button>
                        <button
                            onClick={() => setIsCsvImportOpen(true)}
                            title={t('inventory_csv_manage_button')}
                            className="p-1.5 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 flex items-center gap-1.5 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                        >
                            <Upload className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                            <span className="hidden lg:inline whitespace-nowrap">{t('inventory_csv_manage_button')}</span>
                        </button>
                    </div>
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
                        className="w-full h-[42px] pl-9 pr-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                    />
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        {/* Hazard Filter */}
                        {hazardSummary > 0 && (
                            <button
                                onClick={() => setHazardFilter(!hazardFilter)}
                                className={`flex items-center gap-1.5 px-2.5 rounded-xl text-xs font-semibold border transition-all h-[42px] shrink-0 shadow-sm ${hazardFilter
                                        ? 'border-red-400 dark:border-red-600 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-700'
                                        : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:border-red-300 dark:hover:border-red-600 hover:text-red-600 dark:hover:text-red-400'
                                    }`}
                            >
                                <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                                <span>{t('inventory_hazard_filter')}</span>
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${hazardFilter
                                        ? 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200'
                                        : 'bg-slate-100 dark:bg-slate-600 text-slate-500 dark:text-slate-300'
                                    }`}>
                                    {hazardSummary}
                                </span>
                            </button>
                        )}
                        <AppSelect
                            value={sortBy}
                            onChange={(value) => setSortBy(value as InventorySortOption)}
                            options={sortOptions}
                            align="right"
                            className="min-w-0 shrink"
                            buttonClassName="min-w-0 w-full bg-white dark:bg-slate-700 !h-[40px] !rounded-xl !shadow-sm !text-xs !py-0"
                            menuClassName="w-max min-w-[180px]"
                        />
                    </div>
                </div>
                {isSelectMode && (
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
                )}
                {isSelectMode && (
                    <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                        {t('inventory_selected_count', { count: selectedItemIds.length })}
                    </p>
                )}
                {bulkDeleteError && (
                    <p className="mt-4 text-xs text-red-600 dark:text-red-400">
                        {bulkDeleteError}
                    </p>
                )}
                {bulkMoveError && (
                    <p className="mt-4 text-xs text-red-600 dark:text-red-400">
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
                        <div className="flex flex-col gap-2 text-sm">
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
                                            <div className="flex items-center gap-1.5">
                                                {renderExpiryBadge(item)}
                                                {renderRemainingBadge(item)}
                                            </div>
                                        </div>
                                        {(() => {
                                            const hazard = classifyInventoryHazard(item);
                                            if (hazard.level === 'none') return null;
                                            return (
                                                <div className="mt-2 mb-1 flex flex-wrap gap-1">
                                                    {hazard.groupLabelKeys.map(key => (
                                                        <span key={key} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                                                            <ShieldAlert className="w-2.5 h-2.5" />
                                                            {t(key)}
                                                        </span>
                                                    ))}
                                                </div>
                                            );
                                        })()}
                                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
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
                items={visibleItems}
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

            {isCasReviewOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div
                        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
                        onClick={handleCloseCasReview}
                    />
                    <div className="relative z-10 w-full max-w-3xl rounded-3xl border border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">빈 CAS 보완</h2>
                                <p className="mt-1 text-sm text-slate-600">
                                    빈 CAS {blankCasItems.length}개 중 {casReviewSuggestedEntries.length}개 제안 가능
                                </p>
                            </div>
                            <button
                                onClick={handleCloseCasReview}
                                disabled={isApplyingCasReview}
                                className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                            >
                                {t('btn_close', '닫기')}
                            </button>
                        </div>

                        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
                            {isCasReviewLoading ? (
                                <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-slate-500">
                                    <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
                                    <p>정확히 확인된 CAS 후보를 찾고 있어요.</p>
                                </div>
                            ) : (
                                <>
                                    {casReviewError && (
                                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                            {casReviewError}
                                        </div>
                                    )}

                                    {casReviewSuggestedEntries.length > 0 ? (
                                        <div className="space-y-3">
                                            {casReviewSuggestedEntries.map((entry) => (
                                                <CasSuggestionCard
                                                    key={entry.item.id}
                                                    state="suggestion"
                                                    suggestion={entry.suggestion}
                                                    inputName={entry.item.name}
                                                    actionSlot={(
                                                        <label className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedCasReviewIds.includes(entry.item.id)}
                                                                onChange={() => toggleCasReviewSelection(entry.item.id)}
                                                                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                                            />
                                                            적용
                                                        </label>
                                                    )}
                                                />
                                            ))}
                                        </div>
                                    ) : !casReviewError ? (
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
                                            정확히 확인된 CAS 후보를 찾지 못했어요.
                                        </div>
                                    ) : null}

                                    {casReviewBlockedEntries.length > 0 && (
                                        <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                                                자동 적용에서 제외된 항목 {casReviewBlockedEntries.length}개
                                            </summary>
                                            <div className="mt-3 space-y-3">
                                                {casReviewBlockedEntries.map((entry) => (
                                                    <CasSuggestionCard
                                                        key={`${entry.item.id}:blocked`}
                                                        state={getCasReviewCardState(entry.suggestion)}
                                                        suggestion={entry.suggestion}
                                                        inputName={entry.item.name}
                                                    />
                                                ))}
                                            </div>
                                        </details>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
                            <p className="text-sm text-slate-500">
                                선택한 항목만 CAS를 채우고, 시약명은 바꾸지 않아요.
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleCloseCasReview}
                                    disabled={isApplyingCasReview}
                                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                                >
                                    {t('btn_cancel')}
                                </button>
                                <button
                                    onClick={handleApplyCasReview}
                                    disabled={selectedCasReviewCount === 0 || isCasReviewLoading || isApplyingCasReview}
                                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isApplyingCasReview && <Loader2 className="h-4 w-4 animate-spin" />}
                                    선택한 {selectedCasReviewCount}개 적용
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
