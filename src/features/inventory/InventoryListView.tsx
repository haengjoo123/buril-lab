import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    Package,
    Plus,
    Search,
    Archive,
    MapPin,
    ChevronDown,
    Loader2,
    AlertTriangle,
    Clock,
    Download,
    Upload,
    ShieldAlert,
    Camera,
    PackagePlus,
	CheckCircle2,
	X,
	Trash2,
	FlaskConical
} from 'lucide-react';
import {
    createInventoryOperationRequestId,
    inventoryService,
    storageLocationService,
    type CreateInventoryInput,
    type InventoryItem,
    type InventoryMoveDestination,
    type InventoryMoveTarget,
    type StorageLocation,
} from '../../services/inventoryService';
import { cabinetService, type Cabinet } from '../../services/cabinetService';
import { InventoryFormModal } from './InventoryFormModal';
import { InventoryCsvImportModal } from './InventoryCsvImportModal';
import { CameraCaptureModal, type CameraCaptureQueueItem } from '../fridge/components/CameraCaptureModal';
import { CustomDialog } from '../../components/CustomDialog';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { getExpiryStatus, getExpiryBadgeClasses, getExpiryCardBorderClass } from '../../utils/expiryStatus';
import { useFridgeStore } from '../../store/fridgeStore';
import { OnboardingGuideCard } from '../../components/onboarding/OnboardingGuideCard';
import { AppSelect } from '../../components/AppSelect';

import { useLabStore } from '../../store/useLabStore';
import { useOnboardingStore } from '../../store/useOnboardingStore';
import { translateLocationName } from '../../utils/i18nUtils';
import { guessTemplateFromCapacity, getWidthForTemplate } from '../../utils/guessReagentTemplate';
import {
    classifyInventoryHazard,
    type InventoryHazardFilterCategory,
} from '../../utils/inventoryHazardClassifier';
import { scanReagentLabel, type ReagentScanResult } from '../../services/geminiReagentScanService';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { lookupGHSByCAS, type PubChemGHSResult } from '../../services/pubchemService';
import { getPictogramCode, getPictogramUrl } from '../../data/ghsCodes';
import { planBulkInventoryCabinetMove } from '../../utils/bulkInventoryMovePlanner';

type BulkMoveTargetType = 'other' | 'cabinet';
type InventorySortOption = 'expiry_asc' | 'location_asc' | 'name_asc' | 'remaining_asc' | 'created_at_desc' | 'created_at_asc';
type InventoryHazardFilter = 'all' | InventoryHazardFilterCategory;
type InventoryGroup = {
    id: string;
    items: InventoryItem[];
    primaryItem: InventoryItem;
    totalQuantity: number;
    cardCount: number;
    uniqueNames: string[];
    uniqueCasNumbers: string[];
};
type InventoryScanResultItem = {
    id: string;
    imageSrc: string;
    result: ReagentScanResult;
    createdAt: number;
};
type InventoryGhsState =
    | { status: 'loading' }
    | { status: 'loaded'; result: PubChemGHSResult }
    | { status: 'error'; error?: string };
type InventoryGhsPictogram = {
    label: string;
    url: string;
    code?: string;
};

export interface InventoryListViewProps {
    onStartWasteBatch?: (item: InventoryItem) => Promise<void>;
}

const normalizeText = (value?: string | null) => (value || '').trim().toLowerCase();
const normalizeGroupCas = (value?: string | null) => (value || '').replace(/[^0-9a-z-]/gi, '').trim().toLowerCase();
const normalizeGhsCas = (value?: string | null) => (value || '').replace(/\s+/g, '').trim();
const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

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

function buildInventoryGroups(sourceItems: InventoryItem[], sortBy: InventorySortOption): InventoryGroup[] {
    if (sourceItems.length === 0) return [];

    const items = [...sourceItems];
    const parents = items.map((_, index) => index);
    const findParent = (index: number): number => {
        let cursor = index;
        while (parents[cursor] !== cursor) {
            parents[cursor] = parents[parents[cursor]];
            cursor = parents[cursor];
        }
        return cursor;
    };
    const union = (left: number, right: number) => {
        const leftRoot = findParent(left);
        const rightRoot = findParent(right);
        if (leftRoot !== rightRoot) {
            parents[rightRoot] = leftRoot;
        }
    };

    const firstIndexByName = new Map<string, number>();
    const firstIndexByCas = new Map<string, number>();

    items.forEach((item, index) => {
        const nameKey = normalizeText(item.name);
        const casKey = normalizeGroupCas(item.cas_number);

        if (nameKey) {
            const existingIndex = firstIndexByName.get(nameKey);
            if (existingIndex !== undefined) {
                union(existingIndex, index);
            } else {
                firstIndexByName.set(nameKey, index);
            }
        }

        if (casKey) {
            const existingIndex = firstIndexByCas.get(casKey);
            if (existingIndex !== undefined) {
                union(existingIndex, index);
            } else {
                firstIndexByCas.set(casKey, index);
            }
        }
    });

    const groupedItems = new Map<number, InventoryItem[]>();
    items.forEach((item, index) => {
        const root = findParent(index);
        const existingGroup = groupedItems.get(root);
        if (existingGroup) {
            existingGroup.push(item);
            return;
        }
        groupedItems.set(root, [item]);
    });

    return Array.from(groupedItems.values())
        .map((groupItems) => {
            const sortedItems = [...groupItems].sort((left, right) => compareInventoryItems(left, right, sortBy));
            const uniqueNames = Array.from(new Set(sortedItems.map((item) => item.name.trim()).filter(Boolean)));
            const uniqueCasNumbers = Array.from(new Set(sortedItems.map((item) => (item.cas_number || '').trim()).filter(Boolean)));
            return {
                id: sortedItems.map((item) => item.id).sort().join('::'),
                items: sortedItems,
                primaryItem: sortedItems[0],
                totalQuantity: sortedItems.reduce((sum, item) => sum + Math.max(1, item.quantity || 1), 0),
                cardCount: sortedItems.length,
                uniqueNames,
                uniqueCasNumbers,
            };
        })
        .sort((left, right) => compareInventoryItems(left.primaryItem, right.primaryItem, sortBy));
}

export const InventoryListView: React.FC<InventoryListViewProps> = ({ onStartWasteBatch }) => {
    const { t, i18n } = useTranslation();
    const showOnboardingGuide = useOnboardingStore((state) => state.hasCompletedWelcome && !state.hasSkippedOnboarding && !state.seenGuides.inventory);
    const markGuideSeen = useOnboardingStore((state) => state.markGuideSeen);
    const { currentLabId } = useLabStore();
    const isDesktop = useIsDesktop();
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [locations, setLocations] = useState<StorageLocation[]>([]);
    const [cabinets, setCabinets] = useState<Cabinet[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<InventorySortOption>('expiry_asc');
    const [hazardFilter, setHazardFilter] = useState<InventoryHazardFilter>('all');
    const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
    const [initialDraft, setInitialDraft] = useState<Partial<CreateInventoryInput> | null>(null);
    const [formEntryMode, setFormEntryMode] = useState<'manual_form' | 'scan_prefill'>('manual_form');
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [scanQueueItems, setScanQueueItems] = useState<CameraCaptureQueueItem[]>([]);
    const [scanResults, setScanResults] = useState<InventoryScanResultItem[]>([]);
    const [isScanResultsOpen, setIsScanResultsOpen] = useState(false);
    const [activeScanResultId, setActiveScanResultId] = useState<string | null>(null);
    const [scanToastMessage, setScanToastMessage] = useState<string | null>(null);
    const scanPendingTasksRef = useRef<{ id: string; imageSrc: string }[]>([]);
    const scanActiveCountRef = useRef(0);
    const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [wasteBatchPendingKeys, setWasteBatchPendingKeys] = useState<string[]>([]);
    const [wasteBatchErrors, setWasteBatchErrors] = useState<Record<string, string>>({});
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
    const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([]);
    const [selectedDesktopItemId, setSelectedDesktopItemId] = useState<string | null>(null);
    const [inventoryGhsByCas, setInventoryGhsByCas] = useState<Record<string, InventoryGhsState>>({});
    const wasteBatchPendingRef = useRef<Set<string>>(new Set());
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTriggeredRef = useRef(false);
    const bulkMoveInfoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inventoryGhsByCasRef = useRef<Record<string, InventoryGhsState>>({});
    const inventoryGhsInFlightRef = useRef<Set<string>>(new Set());
    const bulkErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const bulkMoveRequestRef = useRef<{ signature: string; requestId: string } | null>(null);

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
        setExpandedGroupIds([]);
        setBulkMoveTargetType('other');
        setBulkMoveCabinetId('');
        bulkMoveRequestRef.current = null;
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
        if (!scanToastMessage) return;
        const timer = setTimeout(() => setScanToastMessage(null), 3200);
        return () => clearTimeout(timer);
    }, [scanToastMessage]);

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

    const getInventoryGhsState = useCallback((item: InventoryItem): InventoryGhsState | null => {
        const cas = normalizeGhsCas(item.cas_number);
        return cas ? (inventoryGhsByCas[cas] || null) : null;
    }, [inventoryGhsByCas]);

    const getInventoryGhsHCodes = useCallback((item: InventoryItem): string[] => {
        const ghsState = getInventoryGhsState(item);
        return ghsState?.status === 'loaded' ? ghsState.result.hCodes : [];
    }, [getInventoryGhsState]);

    const classifyInventoryItemHazard = useCallback((item: InventoryItem) => (
        classifyInventoryHazard(item, { hCodes: getInventoryGhsHCodes(item) })
    ), [getInventoryGhsHCodes]);

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

        if (hazardFilter !== 'all') {
            result = result.filter(item => (
                classifyInventoryItemHazard(item).filterCategories.includes(hazardFilter)
            ));
        }

        return result;
    }, [items, searchQuery, hazardFilter, classifyInventoryItemHazard]);

    const hazardFilterCounts = useMemo(() => {
        const counts: Record<InventoryHazardFilterCategory, number> = {
            special_high: 0,
            flammable: 0,
            corrosive: 0,
            toxic: 0,
            other_managed: 0,
        };
        for (const item of items) {
            for (const category of classifyInventoryItemHazard(item).filterCategories) {
                counts[category] += 1;
            }
        }
        return counts;
    }, [items, classifyInventoryItemHazard]);
    const hazardSummary = hazardFilterCounts.special_high;
    const hazardFilterOptions = useMemo(() => ([
        { value: 'all', label: t('inventory_hazard_filter_all') },
        { value: 'special_high', label: `${t('inventory_hazard_special_high')} (${hazardFilterCounts.special_high})` },
        { value: 'flammable', label: `${t('inventory_hazard_flammable')} (${hazardFilterCounts.flammable})` },
        { value: 'corrosive', label: `${t('inventory_hazard_corrosive')} (${hazardFilterCounts.corrosive})` },
        { value: 'toxic', label: `${t('inventory_hazard_toxic')} (${hazardFilterCounts.toxic})` },
        { value: 'other_managed', label: `${t('inventory_hazard_other_managed')} (${hazardFilterCounts.other_managed})` },
    ]), [hazardFilterCounts, t]);

    // 만료/위치 우선으로 빠르게 확인할 수 있게 화면 전용 정렬 목록을 만든다.
    const visibleItems = useMemo(() => {
        return [...filteredItems].sort((a, b) => compareInventoryItems(a, b, sortBy));
    }, [filteredItems, sortBy]);
    const visibleGroups = useMemo(() => buildInventoryGroups(visibleItems, sortBy), [visibleItems, sortBy]);
    const selectedDesktopItem = useMemo(
        () => visibleItems.find((item) => item.id === selectedDesktopItemId) || visibleItems[0] || null,
        [selectedDesktopItemId, visibleItems]
    );
    const selectedDesktopWasteBatchKey = selectedDesktopItem
        ? `${selectedDesktopItem._source || 'inventory'}:${selectedDesktopItem.id}`
        : null;
    const isStartingDesktopWasteBatch = selectedDesktopWasteBatchKey
        ? wasteBatchPendingKeys.includes(selectedDesktopWasteBatchKey)
        : false;
    const selectedDesktopWasteBatchError = selectedDesktopWasteBatchKey
        ? wasteBatchErrors[selectedDesktopWasteBatchKey]
        : undefined;

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

    const totalInventoryQuantity = useMemo(() => (
        items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
    ), [items]);

    const inventoryDesktopStats = useMemo(() => ([
        {
            label: t('log_range_all'),
            value: items.length,
            Icon: Package,
            tone: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300',
        },
        {
            label: t('inventory_quantity'),
            value: totalInventoryQuantity,
            Icon: Archive,
            tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300',
        },
        {
            label: t('inventory_hazard_special_high'),
            value: hazardSummary,
            Icon: ShieldAlert,
            tone: 'text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-300',
        },
        {
            label: t('expiry_summary_title'),
            value: expirySummary.expiredCount + expirySummary.warningCount,
            Icon: AlertTriangle,
            tone: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300',
        },
    ]), [expirySummary.expiredCount, expirySummary.warningCount, hazardSummary, items.length, t, totalInventoryQuantity]);

    useEffect(() => {
        const visibleGroupIdSet = new Set(
            visibleGroups
                .filter((group) => group.cardCount > 1)
                .map((group) => group.id)
        );
        setExpandedGroupIds((prev) => prev.filter((groupId) => visibleGroupIdSet.has(groupId)));
    }, [visibleGroups]);

    useEffect(() => {
        if (visibleItems.length === 0) {
            setSelectedDesktopItemId(null);
            return;
        }
        if (!selectedDesktopItemId || !visibleItems.some((item) => item.id === selectedDesktopItemId)) {
            setSelectedDesktopItemId(visibleItems[0].id);
        }
    }, [selectedDesktopItemId, visibleItems]);

    useEffect(() => {
        inventoryGhsByCasRef.current = inventoryGhsByCas;
    }, [inventoryGhsByCas]);

    useEffect(() => {
        const casNumbersToLoad = Array.from(new Set(
            items
                .map((item) => normalizeGhsCas(item.cas_number))
                .filter((cas): cas is string => Boolean(cas && /^\d{1,7}-\d{2}-\d$/.test(cas)))
        )).filter((cas) => (
            (!inventoryGhsByCasRef.current[cas] || inventoryGhsByCasRef.current[cas].status === 'loading')
            && !inventoryGhsInFlightRef.current.has(cas)
        ));

        if (casNumbersToLoad.length === 0) return;

        let isCancelled = false;
        casNumbersToLoad.forEach((cas) => inventoryGhsInFlightRef.current.add(cas));
        setInventoryGhsByCas((prev) => {
            const next = { ...prev };
            casNumbersToLoad.forEach((cas) => {
                next[cas] = { status: 'loading' };
            });
            inventoryGhsByCasRef.current = next;
            return next;
        });

        const loadGhsPictograms = async () => {
            for (const cas of casNumbersToLoad) {
                try {
                    const result = await lookupGHSByCAS(cas, { labId: currentLabId });
                    if (!isCancelled) {
                        const nextState: InventoryGhsState = { status: 'loaded', result };
                        setInventoryGhsByCas((prev) => {
                            const next = { ...prev, [cas]: nextState };
                            inventoryGhsByCasRef.current = next;
                            return next;
                        });
                    }
                } catch (err) {
                    if (!isCancelled) {
                        const nextState: InventoryGhsState = {
                            status: 'error',
                            error: err instanceof Error ? err.message : String(err),
                        };
                        setInventoryGhsByCas((prev) => {
                            const next = { ...prev, [cas]: nextState };
                            inventoryGhsByCasRef.current = next;
                            return next;
                        });
                    }
                } finally {
                    inventoryGhsInFlightRef.current.delete(cas);
                }

                await wait(150);
            }
        };

        void loadGhsPictograms();

        return () => {
            isCancelled = true;
        };
    }, [currentLabId, items]);

    const handleEdit = (item: InventoryItem) => {
        setInitialDraft(null);
        setFormEntryMode('manual_form');
        setEditingItem(item);
        setIsFormOpen(true);
    };

    const handleCloseForm = () => {
        setIsFormOpen(false);
        setEditingItem(null);
        setInitialDraft(null);
        setFormEntryMode('manual_form');
        setActiveScanResultId(null);
    };

    const handleFormSaved = () => {
        loadData();
        if (activeScanResultId) {
            setScanResults((prev) => prev.filter((item) => item.id !== activeScanResultId));
            setScanQueueItems((prev) => prev.filter((item) => item.id !== activeScanResultId));
            setActiveScanResultId(null);
        }
    };

    const handleOpenManualRegistration = () => {
        setInitialDraft(null);
        setFormEntryMode('manual_form');
        setEditingItem(null);
        setIsAddMenuOpen(false);
        setIsFormOpen(true);
    };

    const handleOpenScanRegistration = () => {
        setIsAddMenuOpen(false);
        setIsCameraOpen(true);
    };

    const updateScanQueueItem = (id: string, updates: Partial<CameraCaptureQueueItem>) => {
        setScanQueueItems((prev) => prev.map((item) => (
            item.id === id ? { ...item, ...updates } : item
        )));
    };

    const processScanTask = async (task: { id: string; imageSrc: string }) => {
        try {
            const result = await scanReagentLabel(task.imageSrc);
            if (!result.success) {
                throw new Error(result.error || t('inventory_scan_error_default'));
            }

            updateScanQueueItem(task.id, { status: 'success', label: result.name || t('scan_unknown_reagent') });
            setScanResults((prev) => [
                ...prev,
                { id: task.id, imageSrc: task.imageSrc, result, createdAt: Date.now() },
            ]);
            setScanToastMessage(t('inventory_scan_result_ready', { name: result.name || t('scan_unknown_reagent') }));
        } catch (error) {
            console.error('Inventory scan registration failed:', error);
            const message = error instanceof Error ? error.message : t('inventory_scan_error_default');
            updateScanQueueItem(task.id, { status: 'error', label: t('scan_failed') });
            setScanToastMessage(message);
        }
    };

    const runNextScanTasks = () => {
        const MAX_PARALLEL_SCANS = 3;
        while (scanActiveCountRef.current < MAX_PARALLEL_SCANS && scanPendingTasksRef.current.length > 0) {
            const task = scanPendingTasksRef.current.shift();
            if (!task) return;
            scanActiveCountRef.current += 1;
            void processScanTask(task).finally(() => {
                scanActiveCountRef.current -= 1;
                runNextScanTasks();
            });
        }
    };

    const handleScanCapture = (imageSrc: string) => {
        const id = `inventory-scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setScanQueueItems((prev) => [...prev, { id, imageSrc, status: 'processing' }]);
        scanPendingTasksRef.current.push({ id, imageSrc });
        runNextScanTasks();
    };

    const handleOpenScanResultForm = (item: InventoryScanResultItem) => {
        const defaultStorageType = locations.length > 0 ? 'other' : 'cabinet';
        setInitialDraft({
            name: item.result.name || '',
            brand: item.result.brand || '',
            product_number: item.result.productNumber || '',
            cas_number: item.result.casNumber || '',
            quantity: 1,
            capacity: item.result.capacity || '',
            storage_type: defaultStorageType,
            storage_location_id: defaultStorageType === 'other' ? (locations[0]?.id || '') : '',
            expiry_date: item.result.expiryDate || '',
            remaining_percent: 100,
        });
        setFormEntryMode('scan_prefill');
        setEditingItem(null);
        setActiveScanResultId(item.id);
        setIsScanResultsOpen(false);
        setIsFormOpen(true);
    };

    const handleDeleteClick = (item: InventoryItem) => {
        setItemToDelete(item);
    };

    const getWasteBatchActionKey = (item: InventoryItem) =>
        `${item._source || 'inventory'}:${item.id}`;

    const handleStartWasteBatch = async (item: InventoryItem) => {
        if (!onStartWasteBatch) return;
        const actionKey = getWasteBatchActionKey(item);
        if (wasteBatchPendingRef.current.has(actionKey)) return;

        wasteBatchPendingRef.current.add(actionKey);
        setWasteBatchPendingKeys((current) => [...current, actionKey]);
        setWasteBatchErrors((current) => {
            const next = { ...current };
            delete next[actionKey];
            return next;
        });

        try {
            await onStartWasteBatch(item);
        } catch (error) {
            console.error('Failed to start inventory waste batch:', error);
            setWasteBatchErrors((current) => ({
                ...current,
                [actionKey]: t('inventory_start_waste_batch_failed'),
            }));
        } finally {
            wasteBatchPendingRef.current.delete(actionKey);
            setWasteBatchPendingKeys((current) => current.filter((key) => key !== actionKey));
        }
    };

    /* const handleOpenCasReview = async () => {
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

    */
    const handleExportExcel = async () => {
        const { downloadRowsAsXlsx } = await import('../../utils/excelFiles');
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

        const timestamp = new Date().toISOString().split('T')[0];
        const fileName = `inventory_export_${timestamp}.xlsx`;
        await downloadRowsAsXlsx(rowsForExport, 'Inventory', fileName);
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

    const clearSelectionFeedback = () => {
        setBulkDeleteError(null);
        setBulkMoveError(null);
        setBulkMoveInfo(null);
    };

    const exitSelectMode = () => {
        setIsSelectMode(false);
        setSelectedItemIds([]);
        clearSelectionFeedback();
    };

    const toggleSelectMode = () => {
        if (isSelectMode) {
            exitSelectMode();
            return;
        }
        setIsSelectMode(true);
        clearSelectionFeedback();
    };

    const clearLongPressTimer = () => {
        if (!longPressTimerRef.current) return;
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
    };

    const addSelectedIds = (itemIds: string[]) => {
        setSelectedItemIds((prev) => Array.from(new Set([...prev, ...itemIds])));
    };

    const toggleSelectionForIds = (itemIds: string[]) => {
        const isAllSelected = itemIds.every((itemId) => selectedItemIds.includes(itemId));
        const nextSelectedIds = isAllSelected
            ? selectedItemIds.filter((itemId) => !itemIds.includes(itemId))
            : Array.from(new Set([...selectedItemIds, ...itemIds]));

        if (nextSelectedIds.length === 0) {
            exitSelectMode();
            return;
        }

        setSelectedItemIds(nextSelectedIds);
    };

    const startLongPress = (itemIds: string | string[]) => {
        if (isSelectMode) return;
        clearLongPressTimer();
        longPressTriggeredRef.current = false;
        longPressTimerRef.current = setTimeout(() => {
            setIsSelectMode(true);
            addSelectedIds(Array.isArray(itemIds) ? itemIds : [itemIds]);
            setBulkDeleteError(null);
            longPressTriggeredRef.current = true;
        }, 450);
    };

    const toggleItemSelection = (itemId: string) => {
        const nextSelectedIds = selectedItemIds.includes(itemId)
            ? selectedItemIds.filter(id => id !== itemId)
            : [...selectedItemIds, itemId];

        if (nextSelectedIds.length === 0) {
            exitSelectMode();
            return;
        }

        setSelectedItemIds(nextSelectedIds);
    };

    const toggleGroupExpanded = (groupId: string) => {
        setExpandedGroupIds((prev) =>
            prev.includes(groupId)
                ? prev.filter((id) => id !== groupId)
                : [...prev, groupId]
        );
    };

    const handleSelectAllFiltered = () => {
        if (visibleItems.length === 0) return;
        const filteredIds = visibleItems.map(item => item.id);
        const isAllSelected = filteredIds.every(id => selectedItemIds.includes(id));
        if (isAllSelected) {
            const nextSelectedIds = selectedItemIds.filter(id => !filteredIds.includes(id));
            if (nextSelectedIds.length === 0) {
                exitSelectMode();
                return;
            }
            setSelectedItemIds(nextSelectedIds);
            return;
        }
        setSelectedItemIds(Array.from(new Set([...selectedItemIds, ...filteredIds])));
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
            await inventoryService.deleteItems(selectedItems);

            const deletedIds = new Set(selectedItems.map(item => item.id));
            setItems(prev => prev.filter(item => !deletedIds.has(item.id)));
            setSelectedItemIds([]);
            setIsSelectMode(false);
        } catch (error) {
            // The V2 RPC is one transaction: a failure means no selected row was
            // removed, so the current list and selection remain intact.
            console.error('Failed to atomically delete inventory records:', error);
            setBulkDeleteError(t('inventory_bulk_delete_failed'));
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
            const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
            if (selectedItems.length !== selectedItemIds.length) {
                throw new Error('selected_inventory_items_changed');
            }

            const eligibleItems = selectedItems.filter((item) => (
                bulkMoveTargetType === 'other'
                    ? item._source === 'inventory'
                    : item._source === 'inventory' || item._source === 'cabinet_item'
            ));
            if (eligibleItems.length !== selectedItems.length) {
                setBulkMoveError(t('inventory_bulk_move_ineligible_part', {
                    count: selectedItems.length - eligibleItems.length,
                }));
                return;
            }

            const unchangedItems = eligibleItems.filter((item) => (
                bulkMoveTargetType === 'other'
                    ? item.storage_type === 'other' && item.storage_location_id === bulkMoveLocationId
                    : item.storage_type === 'cabinet' && item.cabinet_id === bulkMoveCabinetId
            ));
            if (unchangedItems.length > 0) {
                if (unchangedItems.length === eligibleItems.length) {
                    setBulkMoveInfo(t('inventory_bulk_move_all_already_target'));
                } else {
                    setBulkMoveError(t('inventory_bulk_move_unchanged_part', {
                        count: unchangedItems.length,
                    }));
                }
                return;
            }

            let destination: InventoryMoveDestination;
            let targets: InventoryMoveTarget[];
            if (bulkMoveTargetType === 'other') {
                const targetLocation = locations.find((location) => (
                    location.id === bulkMoveLocationId
                ));
                if (!targetLocation) {
                    setBulkMoveError(t('inventory_bulk_move_invalid_location'));
                    return;
                }
                destination = {
                    storage_type: 'other',
                    storage_location_id: targetLocation.id,
                };
                targets = eligibleItems.map((item) => ({
                    item_id: item.id,
                    item_source: 'inventory',
                }));
            } else {
                const targetCabinet = cabinets.find((cabinet) => (
                    cabinet.id === bulkMoveCabinetId
                ));
                if (!targetCabinet) {
                    setBulkMoveError(t('inventory_bulk_move_invalid_cabinet'));
                    return;
                }

                const store = useFridgeStore.getState();
                await store.loadCabinet(targetCabinet.id);
                const targetState = useFridgeStore.getState();
                if (targetState.cabinetId !== targetCabinet.id) {
                    throw new Error('cabinet_state_mismatch');
                }

                const plan = planBulkInventoryCabinetMove({
                    shelves: targetState.shelves,
                    cabinetWidth: targetState.cabinetWidth,
                    cabinetDepth: targetState.cabinetDepth,
                    candidates: eligibleItems.map((item) => {
                        const fallbackTemplate = guessTemplateFromCapacity(item.capacity || '');
                        const template = item.placement_template || fallbackTemplate;
                        const savedWidth = item.placement_width;
                        const width = typeof savedWidth === 'number' &&
                            Number.isFinite(savedWidth) &&
                            savedWidth > 0
                            ? savedWidth
                            : getWidthForTemplate(template);
                        return {
                            itemId: item.id,
                            itemSource: item._source === 'cabinet_item'
                                ? 'cabinet_item'
                                : 'inventory',
                            name: item.name,
                            template,
                            width,
                        };
                    }),
                });
                if (!plan || plan.length !== eligibleItems.length) {
                    setBulkMoveError(t('inventory_bulk_move_no_space_part', {
                        count: eligibleItems.length,
                    }));
                    return;
                }

                destination = {
                    storage_type: 'cabinet',
                    cabinet_id: targetCabinet.id,
                };
                targets = plan.map((planned) => ({
                    item_id: planned.itemId,
                    item_source: planned.itemSource,
                    placement: planned.placement,
                }));
            }

            const signature = JSON.stringify({ targets, destination });
            const pendingRequest = bulkMoveRequestRef.current;
            const requestId = pendingRequest?.signature === signature
                ? pendingRequest.requestId
                : createInventoryOperationRequestId();
            bulkMoveRequestRef.current = { signature, requestId };

            const receipt = await inventoryService.moveRecords({
                targets,
                destination,
                requestId,
            });

            await loadData();
            if (destination.storage_type === 'cabinet') {
                await useFridgeStore.getState().loadCabinet(destination.cabinet_id);
            }

            bulkMoveRequestRef.current = null;
            setBulkMoveInfo(t('inventory_bulk_move_success', {
                count: receipt.movedCount,
            }));
            setSelectedItemIds([]);
            setIsSelectMode(false);
        } catch (error) {
            // The server RPC is one transaction. Keep both the current list and
            // selection untouched so the same idempotency key can be retried.
            console.error('Failed to atomically move inventory records:', error);
            setBulkMoveError(t('inventory_bulk_move_atomic_failed'));
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
            const storageLabel = `${item.cabinet_name || t('inventory_cabinet_unassigned')}${shelfLabel ? ` · ${shelfLabel}` : ''}`;
            return (
                <span className="inline-flex max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800">
                    <Archive className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{storageLabel}</span>
                </span>
            );
        }

        const storageLabel = `${item.storage_location_icon || '📦'} ${translateLocationName(item.storage_location_name, t) || t('inventory_other_storage')}`;
        return (
            <span className="inline-flex max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{storageLabel}</span>
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

    const getInventoryGhsPictograms = (item: InventoryItem): InventoryGhsPictogram[] => {
        const ghsState = getInventoryGhsState(item);
        if (ghsState?.status !== 'loaded') return [];

        const seenUrls = new Set<string>();
        return ghsState.result.pictograms
            .flatMap((label): InventoryGhsPictogram[] => {
                const url = getPictogramUrl(label);
                if (!url || seenUrls.has(url)) return [];
                seenUrls.add(url);
                const code = getPictogramCode(label);
                return [{ label, url, ...(code ? { code } : {}) }];
            });
    };

    const renderGhsPictograms = (
        item: InventoryItem,
        hazard: ReturnType<typeof classifyInventoryHazard>,
        options?: { variant?: 'table' | 'detail' },
    ) => {
        const ghsState = getInventoryGhsState(item);
        const pictograms = getInventoryGhsPictograms(item);
        const isDetail = options?.variant === 'detail';
        const visiblePictograms = isDetail ? pictograms : pictograms.slice(0, 4);

        if (visiblePictograms.length > 0) {
            const detailColumnCount = Math.min(visiblePictograms.length, 6);
            const gridCols = visiblePictograms.length === 1 ? 'grid-cols-1' : 'grid-cols-2';
            const gridGap = isDetail ? 'gap-2' : 'gap-0.5';
            const iconSize = isDetail ? 'h-9 w-9' : (visiblePictograms.length <= 2 ? 'h-6 w-6' : 'h-5 w-5');
            const iconRadius = isDetail ? 'rounded-md' : 'rounded-sm';
            const iconPadding = isDetail ? 'p-1' : 'p-0.5';
            const hiddenCount = isDetail ? 0 : Math.max(0, pictograms.length - visiblePictograms.length);
            const gridClassName = isDetail
                ? `inline-grid ${gridGap} align-middle`
                : `inline-grid ${gridCols} ${gridGap} align-middle`;
            const gridStyle = isDetail
                ? { gridTemplateColumns: `repeat(${detailColumnCount}, minmax(0, max-content))` }
                : undefined;
            const title = [
                ...visiblePictograms.map((image) => image.code ? t(`ghs_pictogram_${image.code}`) : image.label),
                hiddenCount > 0 ? `+${hiddenCount}` : null,
            ].filter(Boolean).join(', ');

            return (
                <div
                    className={gridClassName}
                    style={gridStyle}
                    aria-label={title}
                >
                    {visiblePictograms.map((image) => {
                        const tooltipLabel = image.code ? t(`ghs_pictogram_${image.code}`) : image.label;

                        return (
                            <span
                                key={image.url}
                                className={`group/ghs relative inline-flex ${iconSize} ${iconRadius}`}
                                tabIndex={0}
                                aria-label={tooltipLabel}
                            >
                                <img
                                    src={image.url}
                                    alt={tooltipLabel}
                                    className={`h-full w-full ${iconRadius} border border-red-100 bg-white object-contain ${iconPadding} shadow-sm`}
                                    loading="lazy"
                                />
                                <span
                                    role="tooltip"
                                    className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg ring-1 ring-white/10 group-hover/ghs:block group-focus-visible/ghs:block dark:bg-slate-50 dark:text-slate-950"
                                >
                                    {tooltipLabel}
                                </span>
                            </span>
                        );
                    })}
                </div>
            );
        }

        if (ghsState?.status === 'loading') {
            return <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label={t('msds_loading')} />;
        }

        if (hazard.filterCategories.length === 0) {
            return <span className="text-xs text-slate-400">-</span>;
        }

        return <ShieldAlert className={`h-4 w-4 ${hazard.filterCategories.includes('special_high') ? 'text-red-500' : 'text-orange-500'}`} />;
    };

    const getStorageSummaryText = (item: InventoryItem) => {
        if (item.storage_type === 'cabinet') {
            const shelfLabel = typeof item.shelf_level === 'number'
                ? t('inventory_shelf_level', { level: item.shelf_level + 1 })
                : '';
            return `${item.cabinet_name || t('inventory_cabinet_unassigned')}${shelfLabel ? ` · ${shelfLabel}` : ''}`;
        }

        return `${item.storage_location_icon || '📦'} ${translateLocationName(item.storage_location_name, t) || t('inventory_other_storage')}`;
    };

    const getGroupBorderClass = (group: InventoryGroup) => {
        let highestLevel: 'warning' | 'critical' | 'expired' | null = null;

        for (const item of group.items) {
            const status = getExpiryStatus(item.expiry_date);
            if (!status || status.level === 'ok') continue;
            if (status.level === 'expired') return getExpiryCardBorderClass('expired');
            if (status.level === 'critical') highestLevel = 'critical';
            if (!highestLevel && status.level === 'warning') highestLevel = 'warning';
        }

        return highestLevel ? getExpiryCardBorderClass(highestLevel) : '';
    };

    const renderInventoryCard = (item: InventoryItem, options?: { nested?: boolean }) => {
        const nested = options?.nested ?? false;
        const expiryStatus = getExpiryStatus(item.expiry_date);
        const cardBorderClass = expiryStatus ? getExpiryCardBorderClass(expiryStatus.level) : '';
        const wasteBatchActionKey = getWasteBatchActionKey(item);
        const isStartingWasteBatch = wasteBatchPendingKeys.includes(wasteBatchActionKey);
        const wasteBatchError = wasteBatchErrors[wasteBatchActionKey];

        return (
            <div
                key={item.id}
                onPointerDown={(event) => {
                    if (nested) event.stopPropagation();
                    startLongPress([item.id]);
                }}
                onPointerUp={clearLongPressTimer}
                onPointerCancel={clearLongPressTimer}
                onPointerLeave={clearLongPressTimer}
                onClick={(event) => {
                    if (nested) event.stopPropagation();
                    if (longPressTriggeredRef.current) {
                        longPressTriggeredRef.current = false;
                        return;
                    }
                    if (isSelectMode) {
                        toggleItemSelection(item.id);
                        return;
                    }
                    if (isDesktop) {
                        setSelectedDesktopItemId(item.id);
                        return;
                    }
                    handleEdit(item);
                }}
                className={`${nested
                    ? 'rounded-2xl border bg-slate-50/80 dark:bg-slate-900/30 p-4 shadow-sm cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-600'
                    : 'bg-white dark:bg-slate-800 p-4 rounded-xl border shadow-sm cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-600'
                    } flex flex-col gap-3 transition-colors ${selectedDesktopItemId === item.id ? 'lg:border-emerald-400 lg:ring-2 lg:ring-emerald-500/30' : cardBorderClass || 'border-slate-200 dark:border-slate-700'}`}
            >
                <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                        {isSelectMode && (
                            <label
                                className="inline-flex items-center gap-2 mb-2 text-xs text-slate-500 dark:text-slate-400"
                                onClick={(event) => event.stopPropagation()}
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
                            const hazard = classifyInventoryItemHazard(item);
                            if (hazard.filterCategories.length === 0) return null;
                            const isSpecialHigh = hazard.filterCategories.includes('special_high');
                            return (
                                <div className="mt-2 mb-1 flex flex-wrap gap-1">
                                    {hazard.groupLabelKeys.map(key => (
                                        <span key={key} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${isSpecialHigh
                                            ? 'bg-red-50 text-red-600 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800'
                                            : 'bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800'
                                        }`}>
                                            <ShieldAlert className="w-2.5 h-2.5" />
                                            {t(key)}
                                        </span>
                                    ))}
                                </div>
                            );
                        })()}
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                            {item.cas_number && <span>{t('inventory_meta_cas')}: {item.cas_number}</span>}
                            {item.brand && <span>{item.brand}</span>}
                            {item.product_number && <span>{t('inventory_meta_pn')}: {item.product_number}</span>}
                        </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-md">
                            {t('inventory_group_total_quantity', { count: item.quantity })}
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
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {onStartWasteBatch && (
                                <button
                                    type="button"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        void handleStartWasteBatch(item);
                                    }}
                                    disabled={isStartingWasteBatch || isDeleting || isBulkDeleting}
                                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
                                >
                                    {isStartingWasteBatch
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <FlaskConical className="h-3.5 w-3.5" />}
                                    {isStartingWasteBatch
                                        ? t('inventory_start_waste_batch_running')
                                        : t('inventory_start_waste_batch')}
                                </button>
                            )}
                            <button
                                type="button"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteClick(item);
                                }}
                                disabled={isDeleting || isBulkDeleting || isStartingWasteBatch}
                                className="min-h-11 rounded-lg px-2.5 py-2 text-xs font-bold text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/30"
                            >
                                {t('inventory_btn_delete')}
                            </button>
                        </div>
                    )}
                </div>
                {wasteBatchError && (
                    <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                        {wasteBatchError}
                    </p>
                )}
            </div>
        );
    };

    const renderGroupedInventoryCard = (group: InventoryGroup) => {
        const isExpanded = expandedGroupIds.includes(group.id);
        const groupItemIds = group.items.map((item) => item.id);
        const selectedCount = groupItemIds.filter((itemId) => selectedItemIds.includes(itemId)).length;
        const isAllSelected = selectedCount === groupItemIds.length;
        const groupBorderClass = getGroupBorderClass(group);
        const uniqueStorageLabels = Array.from(new Set(group.items.map(getStorageSummaryText)));
        const hasSingleStorage = uniqueStorageLabels.length === 1;
        const aliasCount = Math.max(0, group.uniqueNames.length - 1);
        const uniqueCapacities = Array.from(new Set(group.items.map((item) => (item.capacity || '').trim()).filter(Boolean)));
        const expiryAlertCount = group.items.filter((item) => {
            const status = getExpiryStatus(item.expiry_date);
            return Boolean(status && status.level !== 'ok');
        }).length;

        return (
            <div
                key={group.id}
                className={`bg-white dark:bg-slate-800 rounded-xl border shadow-sm ${groupBorderClass || 'border-slate-200 dark:border-slate-700'}`}
            >
                <div
                    onPointerDown={() => startLongPress(groupItemIds)}
                    onPointerUp={clearLongPressTimer}
                    onPointerCancel={clearLongPressTimer}
                    onPointerLeave={clearLongPressTimer}
                    onClick={() => {
                        if (longPressTriggeredRef.current) {
                            longPressTriggeredRef.current = false;
                            return;
                        }
                        if (isSelectMode) {
                            toggleSelectionForIds(groupItemIds);
                            return;
                        }
                        toggleGroupExpanded(group.id);
                    }}
                    className="p-4 flex flex-col gap-3 cursor-pointer"
                >
                    <div className="flex justify-between items-start gap-3">
                        <div className="flex-1 min-w-0">
                            {isSelectMode && (
                                <label
                                    className="inline-flex items-center gap-2 mb-2 text-xs text-slate-500 dark:text-slate-400"
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <input
                                        ref={(input) => {
                                            if (input) {
                                                input.indeterminate = selectedCount > 0 && !isAllSelected;
                                            }
                                        }}
                                        type="checkbox"
                                        checked={isAllSelected}
                                        onChange={() => toggleSelectionForIds(groupItemIds)}
                                        className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                    />
                                    {t('inventory_select_item')}
                                </label>
                            )}
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base break-words">
                                    {group.primaryItem.name}
                                </h3>
                                {expiryAlertCount > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                        <AlertTriangle className="h-3 w-3" />
                                        {t('inventory_group_expiry_issue_count', { count: expiryAlertCount })}
                                    </span>
                                )}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                                {group.uniqueCasNumbers.length === 1 && <span>{t('inventory_meta_cas')}: {group.uniqueCasNumbers[0]}</span>}
                                {aliasCount > 0 && (
                                    <span>{t('inventory_group_alias_count', { count: aliasCount })}</span>
                                )}
                                {isSelectMode && selectedCount > 0 && !isAllSelected && (
                                    <span>{t('inventory_selected_count', { count: selectedCount })}</span>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-col items-end shrink-0">
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-md">
                                {t('inventory_group_total_quantity', { count: group.totalQuantity })}
                            </span>
                            {uniqueCapacities.length === 1 && (
                                <span className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                    {uniqueCapacities[0]}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700">
                        {hasSingleStorage ? (
                            renderStorageBadge(group.primaryItem)
                        ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                <Package className="w-3.5 h-3.5" />
                                {t('inventory_group_multi_storage', {
                                    first: uniqueStorageLabels[0],
                                    count: uniqueStorageLabels.length - 1,
                                })}
                            </span>
                        )}
                        {!isSelectMode && (
                            <button
                                type="button"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    toggleGroupExpanded(group.id);
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                            >
                                {t('inventory_group_detail_view')}
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                        )}
                    </div>
                </div>

                {isExpanded && (
                    <div className="border-t border-slate-100 px-3 pb-3 pt-3 dark:border-slate-700">
                        <div className="space-y-3">
                            {group.items.map((item) => renderInventoryCard(item, { nested: true }))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-900 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_minmax(0,1fr)]">
            {/* Header */}
            <div className="flex-shrink-0 border-b border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-slate-700 dark:bg-slate-800 lg:col-start-1 lg:row-start-1 lg:border-b-0 lg:border-r lg:border-slate-200 lg:bg-slate-50 lg:px-6 lg:pb-3 lg:pt-6 dark:lg:border-slate-800 dark:lg:bg-slate-900">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                        <h1 className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xl font-bold text-slate-800 dark:text-slate-100 lg:text-2xl">
                            <Package className="w-6 h-6 text-emerald-500" />
                            {t('inventory_list_title')}
                        </h1>
                        <span className="hidden rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50 lg:inline-flex">
                            {t('log_records_count', { count: items.length })}
                        </span>
                    </div>
                    <div
                        data-onboarding-target="inventory-tools"
                        className="flex items-center gap-1.5 lg:gap-2"
                    >
                        {/*
                        <button
                            onClick={handleOpenCasReview}
                            disabled={blankCasItems.length === 0 || isCasReviewLoading}
                            title="빈 CAS 보완"
                            className="p-1.5 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 flex items-center gap-1.5 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Search className={`w-4 h-4 lg:w-3.5 lg:h-3.5 ${isCasReviewLoading ? 'animate-pulse' : ''}`} />
                            <span className="hidden lg:inline whitespace-nowrap">빈 CAS 보완</span>
                        </button>
                        */}
                        <button
                            onClick={handleOpenScanRegistration}
                            title={t('inventory_add_menu_scan')}
                            className="hidden h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-emerald-950/30 lg:inline-flex"
                        >
                            <Camera className="h-3.5 w-3.5" />
                            <span className="whitespace-nowrap">{t('inventory_add_menu_scan')}</span>
                        </button>
                        <button
                            onClick={handleOpenManualRegistration}
                            title={t('inventory_add_menu_manual')}
                            className="hidden h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 lg:inline-flex"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            <span className="whitespace-nowrap">{t('inventory_add_menu_manual')}</span>
                        </button>
                        <button
                            onClick={handleExportExcel}
                            title={t('inventory_excel_download_view')}
                            className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 p-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40 sm:px-3 sm:py-1.5 lg:h-9 lg:bg-white lg:px-3 lg:font-bold dark:lg:bg-slate-900"
                        >
                            <Download className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                            <span className="hidden lg:inline whitespace-nowrap">{t('inventory_excel_download_view')}</span>
                        </button>
                        <button
                            onClick={() => setIsCsvImportOpen(true)}
                            title={t('inventory_csv_manage_button')}
                            className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 p-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40 sm:px-3 sm:py-1.5 lg:h-9 lg:px-3 lg:font-bold"
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
                <div className="mt-4 relative lg:hidden">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('inventory_search_placeholder')}
                        className="w-full h-[42px] pl-9 pr-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                    />
                </div>
                <div className="mt-3 flex items-center justify-end gap-2 lg:hidden">
                    <div className="flex items-center gap-2 min-w-0">
                        <AppSelect
                            value={hazardFilter}
                            onChange={(value) => setHazardFilter(value as InventoryHazardFilter)}
                            options={hazardFilterOptions}
                            align="right"
                            ariaLabel={t('inventory_hazard_filter')}
                            className="min-w-0 shrink"
                            buttonClassName="min-w-0 max-w-[154px] bg-white dark:bg-slate-700 !h-[40px] !rounded-xl !shadow-sm !text-xs !py-0"
                            menuClassName="w-max min-w-[220px]"
                        />
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
                    <div className="mt-3 flex flex-wrap items-center gap-2 lg:hidden">
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
                            onClick={exitSelectMode}
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
                    <p className="mt-4 text-xs text-slate-500 dark:text-slate-400 lg:hidden">
                        {t('inventory_selected_count', { count: selectedItemIds.length })}
                    </p>
                )}
                {bulkDeleteError && (
                    <p className="mt-4 text-xs text-red-600 dark:text-red-400 lg:hidden">
                        {bulkDeleteError}
                    </p>
                )}
                {bulkMoveError && (
                    <p className="mt-4 text-xs text-red-600 dark:text-red-400 lg:hidden">
                        {bulkMoveError}
                    </p>
                )}
                {bulkMoveInfo && (
                    <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300 lg:hidden">
                        {bulkMoveInfo}
                    </p>
                )}
            </div>

            {/* List */}
            <div className="flex-1 space-y-3 overflow-y-auto p-4 pb-24 lg:col-start-1 lg:row-start-2 lg:border-r lg:border-slate-200 lg:px-6 lg:pb-6 lg:pt-0 dark:lg:border-slate-800">
                {/* Expiry Summary Banner */}
                {!isLoading && (expirySummary.expiredCount > 0 || expirySummary.warningCount > 0) && (
                    <div className="flex items-start gap-3 rounded-lg border border-red-200/60 bg-red-50 p-3.5 animate-in fade-in slide-in-from-top-2 duration-300 dark:border-red-900/40 dark:bg-red-950/30">
                        <AlertTriangle className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
                        <div className="flex flex-col gap-2 text-sm">
                            <span className="font-semibold text-slate-800 dark:text-slate-100">{t('expiry_summary_title')}</span>
                            <div className="flex flex-wrap gap-2 text-xs">
                                {expirySummary.expiredCount > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-medium">
                                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                        {t('expiry_summary_expired', { count: expirySummary.expiredCount })}
                                    </span>
                                )}
                                {expirySummary.warningCount > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                        {t('expiry_summary_warning', { count: expirySummary.warningCount })}
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
                ) : (
                    <>
                        <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:block">
                            <div className="border-b border-slate-200 p-3 dark:border-slate-800">
                                <div className="grid grid-cols-[minmax(280px,1fr)_auto_auto_auto] items-center gap-2">
                                    <div className="relative min-w-0">
                                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder={t('inventory_search_placeholder')}
                                            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 shadow-sm transition-all focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                        />
                                    </div>
                                    <AppSelect
                                        value={hazardFilter}
                                        onChange={(value) => setHazardFilter(value as InventoryHazardFilter)}
                                        options={hazardFilterOptions}
                                        align="right"
                                        ariaLabel={t('inventory_hazard_filter')}
                                        className="min-w-[190px]"
                                        buttonClassName="min-w-[190px] bg-white dark:bg-slate-950 !h-10 !rounded-lg !shadow-sm !text-xs !py-0"
                                        menuClassName="w-max min-w-[230px]"
                                    />
                                    <AppSelect
                                        value={sortBy}
                                        onChange={(value) => setSortBy(value as InventorySortOption)}
                                        options={sortOptions}
                                        align="right"
                                        className="min-w-[168px]"
                                        buttonClassName="min-w-[168px] bg-white dark:bg-slate-950 !h-10 !rounded-lg !shadow-sm !text-xs !py-0"
                                        menuClassName="w-max min-w-[180px]"
                                    />
                                    <button
                                        type="button"
                                        onClick={toggleSelectMode}
                                        className={`flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors ${isSelectMode
                                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                                            }`}
                                    >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        {isSelectMode ? t('inventory_exit_select_mode') : t('inventory_enter_select_mode')}
                                    </button>
                                </div>
                            </div>

                            {isSelectMode && (
                                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/50">
                                    <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                        {t('inventory_selected_count', { count: selectedItemIds.length })}
                                    </span>
                                    <button
                                        onClick={handleSelectAllFiltered}
                                        className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                    >
                                        {selectedFilteredCount === visibleItems.length && visibleItems.length > 0
                                            ? t('inventory_unselect_all_filtered')
                                            : t('inventory_select_all_filtered')}
                                    </button>
                                    <button
                                        onClick={exitSelectMode}
                                        className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                    >
                                        {t('inventory_clear_selection')}
                                    </button>
                                    <button
                                        onClick={handleOpenBulkDeleteConfirm}
                                        disabled={selectedItemIds.length === 0 || isBulkDeleting || isBulkMoving}
                                        className="h-8 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                                    >
                                        {isBulkDeleting
                                            ? t('inventory_bulk_delete_running')
                                            : t('inventory_bulk_delete_btn', { count: selectedItemIds.length })}
                                    </button>
                                    <div className="ml-auto flex min-w-0 items-center gap-2">
                                        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                                            <button
                                                onClick={() => setBulkMoveTargetType('cabinet')}
                                                className={`h-8 px-2.5 text-xs font-semibold ${bulkMoveTargetType === 'cabinet'
                                                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                                                    : 'bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-200'
                                                    }`}
                                            >
                                                {t('inventory_bulk_move_target_cabinet')}
                                            </button>
                                            <button
                                                onClick={() => setBulkMoveTargetType('other')}
                                                className={`h-8 border-l border-slate-200 px-2.5 text-xs font-semibold dark:border-slate-700 ${bulkMoveTargetType === 'other'
                                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                                                    : 'bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-200'
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
                                                buttonClassName="min-w-[132px] bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-200"
                                            />
                                        ) : (
                                            <AppSelect
                                                value={bulkMoveCabinetId}
                                                onChange={setBulkMoveCabinetId}
                                                options={bulkMoveCabinetOptions}
                                                size="sm"
                                                className="min-w-[132px]"
                                                buttonClassName="min-w-[132px] bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-200"
                                            />
                                        )}
                                        <button
                                            onClick={handleOpenBulkMoveConfirm}
                                            disabled={
                                                selectedItemIds.length === 0 ||
                                                isBulkMoving ||
                                                (bulkMoveTargetType === 'other' ? !bulkMoveLocationId : !bulkMoveCabinetId)
                                            }
                                            className="h-8 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                                        >
                                            {isBulkMoving
                                                ? t('inventory_bulk_move_running')
                                                : t('inventory_bulk_move_btn', { count: selectedItemIds.length })}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {(bulkDeleteError || bulkMoveError || bulkMoveInfo) && (
                                <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-800">
                                    {bulkDeleteError && <span className="text-red-600 dark:text-red-400">{bulkDeleteError}</span>}
                                    {bulkMoveError && <span className="text-red-600 dark:text-red-400">{bulkMoveError}</span>}
                                    {bulkMoveInfo && <span className="text-emerald-700 dark:text-emerald-300">{bulkMoveInfo}</span>}
                                </div>
                            )}

                            <div className="grid grid-cols-4 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/70 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950/40">
                                {inventoryDesktopStats.map(({ label, value, Icon, tone }) => (
                                    <div key={label} className="flex items-center gap-3 px-4 py-3">
                                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                                            <Icon className="h-4 w-4" />
                                        </span>
                                        <div className="min-w-0">
                                            <div className="truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</div>
                                            <div className="mt-0.5 text-lg font-bold leading-none text-slate-900 dark:text-slate-100">
                                                {value.toLocaleString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US')}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="overflow-x-auto">
                            {visibleItems.length > 0 ? (
                                <table className="w-full min-w-[760px] table-fixed text-left text-sm">
                                    <colgroup>
                                        <col className="w-10" />
                                        <col />
                                        <col className="w-36" />
                                        <col className="w-14" />
                                        <col className="w-24" />
                                        <col className="w-28" />
                                        <col className="w-20" />
                                    </colgroup>
                                    <thead className="border-b border-slate-200 bg-white text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                                        <tr>
                                            <th className="whitespace-nowrap px-3 py-2.5">
                                                <span className="sr-only">{t('inventory_select_item')}</span>
                                            </th>
                                            <th className="whitespace-nowrap px-3 py-2.5">{t('inventory_csv_table_name')}</th>
                                            <th className="whitespace-nowrap px-3 py-2.5">{t('inventory_csv_table_storage')}</th>
                                            <th className="whitespace-nowrap px-3 py-2.5">{t('inventory_quantity')}</th>
                                            <th className="whitespace-nowrap px-3 py-2.5">{t('inventory_error_expiry_label')}</th>
                                            <th className="whitespace-nowrap px-3 py-2.5">{t('inventory_capacity')}</th>
                                            <th className="whitespace-nowrap px-3 py-2.5">{t('inventory_hazard_management')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {visibleItems.map((item) => {
                                            const hazard = classifyInventoryItemHazard(item);
                                            const isSelected = selectedDesktopItem?.id === item.id;
                                            return (
                                                <tr
                                                    key={item.id}
                                                    onClick={() => {
                                                        if (isSelectMode) {
                                                            toggleItemSelection(item.id);
                                                            return;
                                                        }
                                                        setSelectedDesktopItemId(item.id);
                                                    }}
                                                    className={`cursor-pointer transition-colors ${
                                                        isSelected
                                                            ? 'bg-emerald-50/80 dark:bg-emerald-950/20'
                                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                                                    }`}
                                                >
                                                    <td className="px-3 py-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedItemIds.includes(item.id)}
                                                            onChange={(event) => {
                                                                event.stopPropagation();
                                                                if (!isSelectMode) setIsSelectMode(true);
                                                                toggleItemSelection(item.id);
                                                            }}
                                                            onClick={(event) => event.stopPropagation()}
                                                            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                                        />
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <div className="min-w-0">
                                                            <div className="truncate font-semibold text-slate-900 dark:text-slate-100">{item.name}</div>
                                                            <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                                                                {[item.cas_number, item.brand, item.product_number].filter(Boolean).join(' · ') || t('common_unknown')}
                                                            </div>
                                                            <div className="mt-1 flex items-center gap-1.5">
                                                                {renderExpiryBadge(item)}
                                                                {renderRemainingBadge(item)}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="min-w-0 px-3 py-3">{renderStorageBadge(item)}</td>
                                                    <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-700 dark:text-slate-200">{item.quantity}</td>
                                                    <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600 dark:text-slate-300">{item.expiry_date || '-'}</td>
                                                    <td
                                                        className="truncate whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-600 dark:text-slate-300"
                                                        title={item.capacity || undefined}
                                                    >
                                                        {item.capacity || '-'}
                                                    </td>
                                                    <td className="px-3 py-3 text-center align-middle">
                                                        {renderGhsPictograms(item, hazard)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="p-8">
                                    <EmptyState variant={searchQuery ? 'inventory_search' : 'inventory'} />
                                </div>
                            )}
                            </div>
                            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                                <span>{t('log_records_count', { count: visibleItems.length })}</span>
                                <span>{t('inventory_selected_count', { count: selectedItemIds.length })}</span>
                            </div>
                        </div>

                        <div className="space-y-3 lg:hidden">
                            {visibleGroups.length > 0 ? (
                                visibleGroups.map((group) => (
                                    group.cardCount > 1
                                        ? renderGroupedInventoryCard(group)
                                        : renderInventoryCard(group.primaryItem)
                                ))
                            ) : (
                                <EmptyState variant={searchQuery ? 'inventory_search' : 'inventory'} />
                            )}
                        </div>
                    </>
                )}

            </div>

            <aside className="hidden min-h-0 overflow-y-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{t('inventory_group_detail_view')}</h2>
                </div>

                {selectedDesktopItem ? (
                    <div className="space-y-4 py-4">
                        <div>
                            <div className="inline-flex rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                                {t('inventory_select_item')}
                            </div>
                            <h3 className="mt-3 break-words text-lg font-bold leading-tight text-slate-900 dark:text-slate-100">
                                {selectedDesktopItem.name}
                            </h3>
                            <p className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                                {selectedDesktopItem.cas_number ? `${t('inventory_meta_cas')}: ${selectedDesktopItem.cas_number}` : t('common_unknown')}
                            </p>
                        </div>

                        <div className="space-y-2.5 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                            {[
                                [t('inventory_brand'), selectedDesktopItem.brand || '-'],
                                [t('inventory_product_number'), selectedDesktopItem.product_number || '-'],
                                [t('inventory_capacity'), selectedDesktopItem.capacity || '-'],
                                [t('inventory_quantity'), selectedDesktopItem.quantity],
                                [t('inventory_error_expiry_label'), selectedDesktopItem.expiry_date || '-'],
                                [t('inventory_remaining_amount'), `${selectedDesktopItem.remaining_percent ?? 100}%`],
                            ].map(([label, value]) => (
                                <div key={String(label)} className="flex items-start justify-between gap-4">
                                    <span className="shrink-0 text-slate-500 dark:text-slate-400">{label}</span>
                                    <span className="text-right font-semibold text-slate-800 dark:text-slate-100">{value}</span>
                                </div>
                            ))}
                        </div>

                        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('inventory_csv_table_storage')}</h4>
                            <div className="mt-3">{renderStorageBadge(selectedDesktopItem)}</div>
                        </div>

                        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('inventory_hazard_management')}</h4>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {(() => {
                                    const hazard = classifyInventoryItemHazard(selectedDesktopItem);
                                    const ghsState = getInventoryGhsState(selectedDesktopItem);
                                    const pictograms = getInventoryGhsPictograms(selectedDesktopItem);

                                    if (pictograms.length > 0 || ghsState?.status === 'loading') {
                                        return renderGhsPictograms(selectedDesktopItem, hazard, { variant: 'detail' });
                                    }

                                    return hazard.filterCategories.length === 0 ? (
                                        <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                                            {t('status_allowed')}
                                        </span>
                                    ) : hazard.groupLabelKeys.map((key) => (
                                        <span key={key} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold ${hazard.filterCategories.includes('special_high')
                                            ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300'
                                            : 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300'
                                        }`}>
                                            <ShieldAlert className="h-3.5 w-3.5" />
                                            {t(key)}
                                        </span>
                                    ));
                                })()}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={() => handleEdit(selectedDesktopItem)}
                                className="rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
                            >
                                {t('cabinet_card_edit')}
                            </button>
                            {onStartWasteBatch && (
                                <button
                                    type="button"
                                    onClick={() => void handleStartWasteBatch(selectedDesktopItem)}
                                    disabled={isStartingDesktopWasteBatch || isDeleting || isBulkDeleting}
                                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
                                >
                                    {isStartingDesktopWasteBatch
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <FlaskConical className="h-4 w-4" />}
                                    {isStartingDesktopWasteBatch
                                        ? t('inventory_start_waste_batch_running')
                                        : t('inventory_start_waste_batch')}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => handleDeleteClick(selectedDesktopItem)}
                                disabled={isDeleting || isBulkDeleting || isStartingDesktopWasteBatch}
                                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 sm:col-span-2"
                            >
                                {t('inventory_btn_delete')}
                            </button>
                        </div>
                        {selectedDesktopWasteBatchError && (
                            <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
                                {selectedDesktopWasteBatchError}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="flex min-h-[20rem] items-center justify-center text-center text-sm text-slate-400">
                        {t('inventory_select_item')}
                    </div>
                )}
            </aside>

            {/* FAB */}
            {isAddMenuOpen && (
                <>
                    <button
                        type="button"
                        aria-label={t('inventory_add_menu_close')}
                        onClick={() => setIsAddMenuOpen(false)}
                        className="absolute inset-0 z-10 cursor-default bg-slate-900/5 dark:bg-black/10 lg:hidden"
                    />
                    <div className="absolute bottom-40 right-5 z-20 flex max-w-[calc(100vw-2.5rem)] flex-col items-end gap-3 lg:hidden">
                        <button
                            type="button"
                            onClick={handleOpenScanRegistration}
                            className="animate-slide-up flex items-center gap-3 rounded-2xl border border-blue-100 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xl shadow-slate-900/10 transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:text-blue-700 active:translate-y-0 dark:border-blue-900/50 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-blue-700 dark:hover:text-blue-300"
                        >
                            <span className="whitespace-nowrap">{t('inventory_add_menu_scan')}</span>
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg shadow-blue-500/25">
                                <Camera className="h-5 w-5" />
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={handleOpenManualRegistration}
                            className="animate-slide-up flex items-center gap-3 rounded-2xl border border-emerald-100 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xl shadow-slate-900/10 transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:text-emerald-700 active:translate-y-0 dark:border-emerald-900/50 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-emerald-700 dark:hover:text-emerald-300"
                            style={{ animationDelay: '60ms' }}
                        >
                            <span className="whitespace-nowrap">{t('inventory_add_menu_manual')}</span>
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/25">
                                <PackagePlus className="h-5 w-5" />
                            </span>
                        </button>
                    </div>
                </>
            )}
            <button
                type="button"
                aria-label={t('inventory_add_menu_open')}
                aria-expanded={isAddMenuOpen}
                onClick={() => setIsAddMenuOpen((open) => !open)}
                className={`absolute bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all active:scale-95 lg:hidden ${isAddMenuOpen
                    ? 'rotate-45 bg-slate-800 shadow-slate-900/20 hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white'
                    : 'bg-emerald-500 shadow-emerald-500/30 hover:bg-emerald-600'
                    }`}
            >
                <Plus className="w-6 h-6" />
            </button>

            <CameraCaptureModal
                isOpen={isCameraOpen}
                onClose={() => setIsCameraOpen(false)}
                mode="continuous"
                queueItems={scanQueueItems}
                onQueueCapture={handleScanCapture}
            />

            {scanResults.length > 0 && !isScanResultsOpen && !isFormOpen && (
                <button
                    type="button"
                    onClick={() => setIsScanResultsOpen(true)}
                    className="absolute bottom-24 left-5 z-30 flex h-14 items-center gap-2 rounded-full border border-emerald-100 bg-white px-4 text-sm font-bold text-emerald-700 shadow-xl shadow-slate-900/10 transition-all hover:-translate-y-0.5 hover:bg-emerald-50 dark:border-emerald-900/60 dark:bg-slate-800 dark:text-emerald-300 lg:hidden"
                >
                    <CheckCircle2 className="h-5 w-5" />
                    {t('inventory_scan_result_count', { count: scanResults.length })}
                </button>
            )}

            {isScanResultsOpen && (
                <div className="fixed inset-0 z-[95] flex items-end justify-center p-0 pointer-events-none">
                    <div className="absolute inset-0 bg-slate-900/30 pointer-events-auto" onClick={() => setIsScanResultsOpen(false)} />
                    <div className="relative w-full max-w-[430px] max-h-[62vh] overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl pointer-events-auto dark:border-slate-700 dark:bg-slate-900 animate-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                            <div>
                                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{t('inventory_scan_results_title')}</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{t('inventory_scan_results_desc')}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsScanResultsOpen(false)}
                                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="max-h-[48vh] overflow-y-auto p-4 space-y-3">
                            {scanResults.map((item) => (
                                <div key={item.id} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                                    <img src={item.imageSrc} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                                                    {item.result.name || t('scan_unknown_reagent')}
                                                </p>
                                                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                                                    {[item.result.casNumber && `CAS ${item.result.casNumber}`, item.result.capacity, item.result.brand].filter(Boolean).join(' / ') || t('inventory_scan_result_no_meta')}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setScanResults((prev) => prev.filter((result) => result.id !== item.id));
                                                    setScanQueueItems((prev) => prev.filter((result) => result.id !== item.id));
                                                }}
                                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                                                aria-label={t('inventory_scan_result_delete')}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleOpenScanResultForm(item)}
                                            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
                                        >
                                            <PackagePlus className="h-3.5 w-3.5" />
                                            {t('inventory_scan_result_open_form')}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {scanToastMessage && (
                <div className="fixed top-20 left-1/2 z-[130] w-max max-w-[90vw] -translate-x-1/2 animate-in slide-in-from-top-4 fade-in duration-300">
                    <div className="rounded-full bg-emerald-600 px-5 py-3 text-center text-sm font-medium text-white shadow-lg">
                        {scanToastMessage}
                    </div>
                </div>
            )}

            {/* Modal */}
            <InventoryFormModal
                isOpen={isFormOpen}
                onClose={handleCloseForm}
                locations={locations}
                initialData={editingItem}
                initialDraft={initialDraft}
                entryMode={formEntryMode}
                onSaved={handleFormSaved}
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
                confirmText={t('inventory_delete_confirm')}
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

            {/*
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
            */}
        </div>
    );
};
