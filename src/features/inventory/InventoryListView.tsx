import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Package,
    Plus,
    Search,
    Archive,
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
	FlaskConical,
	MoreHorizontal,
	QrCode,
	ScanLine,
	ShoppingCart,
	FileSpreadsheet
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
import { canCommitLabRequest, type LabRequestToken } from '../../utils/labRequestScope';
import { InventoryFormModal, type InventoryFormSaveResult } from './InventoryFormModal';
import { QuantityStepper } from './QuantityStepper';
import { INVENTORY_REMAINING_LEVELS, getInventoryRemainingStage, isInventoryRemainingLow } from './remainingLevels';
import { createInventorySearchMatcher } from './inventorySearch';
import {
    INVENTORY_EXPIRY_FILTER_LABEL_KEYS,
    INVENTORY_FILTER_PARAM,
    matchesInventoryExpiryFilter,
    parseInventoryExpiryFilter,
} from './inventoryExpiryFilter';
import { InventoryCsvImportModal } from './InventoryCsvImportModal';
import { isAiHandlingDraftsEnabled, isHazardRegisterExportEnabled, isInventoryImportV2Enabled, isPurchaseRequestsEnabled, isQrLabelsEnabled, isSdsAttachmentsEnabled } from '../../config/featureFlags';
import { PurchaseRequestsDialog } from '../purchaseRequests/PurchaseRequestsDialog';
import { purchaseCopy } from '../purchaseRequests/copy';
import { PURCHASES_PARAM } from '../purchaseRequests/purchaseLink';
import { buildRegisterRows, downloadHazardRegister } from '../hazardRegister/hazardRegister';
import { hazardRegisterCopy } from '../hazardRegister/copy';
import { InventorySdsSection } from '../inventorySds/InventorySdsSection';
import { LabelPrintDialog } from '../qrLabels/LabelPrintDialog';
import { StocktakeDialog, type StocktakeLocationOption } from '../qrLabels/StocktakeDialog';
import { locationKeyOf, type StocktakeItem } from '../qrLabels/stocktake';
import type { LabelSheetItem } from '../qrLabels/labelSheet';
import { ITEM_PARAM, SPACE_PARAM } from '../qrLabels/qrPayload';
import { qrCopy } from '../qrLabels/copy';
import { InventoryMobileTools } from './InventoryMobileTools';
import { exportImportAttributes, readableImportAttributes } from './import/sourceAttributes';
import { CameraCaptureModal, type CameraCaptureQueueItem } from '../fridge/components/CameraCaptureModal';
import { CustomDialog } from '../../components/CustomDialog';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { SdsLinkList } from '../../components/SdsLinkList';
import { ChemicalRegulationPanel } from '../../components/ChemicalRegulationPanel';
import { ReagentHandlingDraftPanel } from '../../components/ReagentHandlingDraftPanel';
import { getExpiryStatus, getExpiryBadgeClasses, getExpiryCardBorderClass } from '../../utils/expiryStatus';
import { getManufacturerDateLabelKey, hasManufacturerDate } from '../../utils/manufacturerDate';
import { useFridgeStore } from '../../store/fridgeStore';
import { OnboardingGuideCard } from '../../components/onboarding/OnboardingGuideCard';
import { AppSelect } from '../../components/AppSelect';
import { StorageLocationIcon } from '../../components/StorageLocationIcon';

import { useLabStore } from '../../store/useLabStore';
import { useOnboardingStore } from '../../store/useOnboardingStore';
import { translateLocationName } from '../../utils/i18nUtils';
import { guessTemplateFromCapacity, getWidthForTemplate } from '../../utils/guessReagentTemplate';
import {
    classifyInventoryHazard,
    type InventoryHazardFilterCategory,
} from '../../utils/inventoryHazardClassifier';
import { scanReagentLabel, type ReagentScanResult } from '../../services/aiReagentScanService';
import { useAdaptiveLayout } from '../../hooks/useAdaptiveLayout';
import { useAdaptiveDialog } from '../../hooks/useAdaptiveDialog';
import { AdaptivePaneLayout } from '../../components/AdaptivePaneLayout';
import { enrichChemicals } from '../../services/chemicalEnrichmentService';
import {
    enrichInventoryHazardBatches,
    type InventoryHazardRequestEntry,
} from '../../services/inventoryHazardService';
import { getPictogramCode, getPictogramUrl } from '../../data/ghsCodes';
import {
    buildInventoryHazardEntryKey,
    createInventoryHazardSnapshot,
    formatInventoryHazardCount,
    getInventoryHazardResolution,
    isInventoryHazardSnapshotFresh,
    useInventoryHazardStore,
    type InventoryHazardSnapshot,
} from '../../store/useInventoryHazardStore';
import { planBulkInventoryCabinetMove } from '../../utils/bulkInventoryMovePlanner';
import {
    findInventoryIdentityConflictItemIds,
    partitionInventoryItemsByIdentity,
} from '../../utils/inventoryGrouping';

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
    | {
        status: 'loaded';
        snapshot: InventoryHazardSnapshot;
        freshness: 'fresh' | 'stale';
        isRefreshing: boolean;
        updateError?: string;
    }
    | { status: 'error'; error?: string };
type InventoryGhsPictogram = {
    label: string;
    url: string;
    code?: string;
};

export interface InventoryListViewProps {
    userId?: string | null;
    onStartWasteBatch?: (item: InventoryItem) => Promise<void>;
}

const normalizeGhsCas = (value?: string | null) => (value || '').replace(/\s+/g, '').trim();
const INVENTORY_GHS_RETRY_DELAY_MS = 10_000;
const INVENTORY_GHS_FAILURE_COOLDOWN_MS = 5 * 60 * 1_000;
const INVENTORY_HIGHLIGHT_MS = 1_600;
const QUICK_QUANTITY_SAVE_DELAY_MS = 600;
const getTrackedManufacturerDate = (item: InventoryItem) => (
    hasManufacturerDate(item.manufacturer_date_type) ? item.expiry_date : null
);

type InventoryToast = { message: string; tone: 'success' | 'error' };
type QuickUsagePatch = { quantity?: number; remaining_percent?: number };
type QuickUsageOverride = { patch: QuickUsagePatch; confirmedAt: number | null };

/** "2027-03-31" -> "~27.03": short enough for every card's meta line. */
function formatShortExpiry(date?: string | null): string | null {
    const match = /^(\d{4})-(\d{2})/.exec(date || '');
    return match ? `~${match[1].slice(2)}.${match[2]}` : null;
}

/**
 * Re-apply quick usage edits that a refetch may not reflect yet: unsaved ones,
 * and saved ones confirmed after this fetch started.
 */
function applyQuickUsageOverrides(
    fetched: InventoryItem[],
    overrides: Map<string, QuickUsageOverride>,
    requestStartedAt: number,
): InventoryItem[] {
    for (const [itemId, override] of overrides) {
        if (override.confirmedAt !== null && override.confirmedAt <= requestStartedAt) overrides.delete(itemId);
    }
    if (overrides.size === 0) return fetched;
    return fetched.map((item) => {
        const override = overrides.get(item.id);
        return override ? { ...item, ...override.patch } : item;
    });
}

function compareInventoryItems(a: InventoryItem, b: InventoryItem, sortBy: InventorySortOption): number {
    if (sortBy === 'expiry_asc') {
        const expiryA = getExpiryStatus(getTrackedManufacturerDate(a));
        const expiryB = getExpiryStatus(getTrackedManufacturerDate(b));
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

    return partitionInventoryItemsByIdentity(sourceItems)
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

export const InventoryListView: React.FC<InventoryListViewProps> = ({ userId, onStartWasteBatch }) => {
    const { t, i18n } = useTranslation();
    const showOnboardingGuide = useOnboardingStore((state) => state.hasCompletedWelcome && !state.hasSkippedOnboarding && !state.seenGuides.inventory);
    const markGuideSeen = useOnboardingStore((state) => state.markGuideSeen);
    const { currentLabId, myLabs } = useLabStore();
    const currentMembership = currentLabId ? myLabs.find((membership) => membership.lab_id === currentLabId) ?? null : null;
    const layout = useAdaptiveLayout();
    const isMobileInventory = layout.activeRegion.width < 600 && !layout.twoPane;
    const listLayout = useAdaptiveLayout();
    const [activePane, setActivePane] = useState<'primary' | 'detail'>('primary');
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [locations, setLocations] = useState<StorageLocation[]>([]);
    const [cabinets, setCabinets] = useState<Cabinet[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadedLabId, setLoadedLabId] = useState<string | null | undefined>(undefined);
    const [searchQuery, setSearchQuery] = useState('');
    const inventorySearchRef = useRef<HTMLInputElement>(null);
    const [sortBy, setSortBy] = useState<InventorySortOption>('expiry_asc');
    const [hazardFilter, setHazardFilter] = useState<InventoryHazardFilter>('all');
    // ?filter=expired|expiring|attention (from the lab admin overview) narrows the list until the chip is removed.
    const [searchParams, setSearchParams] = useSearchParams();
    const expiryFilter = parseInventoryExpiryFilter(searchParams.get(INVENTORY_FILTER_PARAM));
    const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
    // Wide layouts expose registration in the header instead of the phone popup.
    if (layout.twoPane && isAddMenuOpen) setIsAddMenuOpen(false);
    const addMenuRef = useRef<HTMLDivElement>(null);
    useAdaptiveDialog(addMenuRef, () => setIsAddMenuOpen(false), isAddMenuOpen);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
    const [initialDraft, setInitialDraft] = useState<Partial<CreateInventoryInput> | null>(null);
    const [formEntryMode, setFormEntryMode] = useState<'manual_form' | 'scan_prefill'>('manual_form');
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [scanQueueItems, setScanQueueItems] = useState<CameraCaptureQueueItem[]>([]);
    const [scanResults, setScanResults] = useState<InventoryScanResultItem[]>([]);
    const [isScanResultsOpen, setIsScanResultsOpen] = useState(false);
    const [activeScanResultId, setActiveScanResultId] = useState<string | null>(null);
    const [toast, setToast] = useState<InventoryToast | null>(null);
    const [highlightItemId, setHighlightItemId] = useState<string | null>(null);
    const [isDetailMenuOpen, setIsDetailMenuOpen] = useState(false);
    const [quickSaveStatus, setQuickSaveStatus] = useState<Record<string, 'saving' | 'saved'>>({});
    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingScrollItemIdRef = useRef<string | null>(null);
    const quickOverridesRef = useRef(new Map<string, QuickUsageOverride>());
    const quickPendingRef = useRef(new Map<string, { item: InventoryItem; patch: QuickUsagePatch }>());
    const quickTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const quickInFlightRef = useRef(new Map<string, Promise<void>>());
    const loadedLabRef = useRef<string | null | undefined>(undefined);
    const scanPendingTasksRef = useRef<{ id: string; imageSrc: string }[]>([]);
    const scanActiveCountRef = useRef(0);
    const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
    const [labelPrintItems, setLabelPrintItems] = useState<LabelSheetItem[] | null>(null);
    const [isStocktakeOpen, setIsStocktakeOpen] = useState(false);
    const [isPurchasesDialogOpen, setIsPurchasesDialogOpen] = useState(false);
    const [qrNotice, setQrNotice] = useState<string | null>(null);
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
    const inventoryHazardSnapshots = useInventoryHazardStore((state) => state.snapshots);
    const inventoryHazardRuntime = useInventoryHazardStore((state) => state.runtimeByKey);
    const upsertInventoryHazardSnapshots = useInventoryHazardStore((state) => state.upsertSnapshots);
    const touchInventoryHazardSnapshots = useInventoryHazardStore((state) => state.touchSnapshots);
    const markInventoryHazardRuntime = useInventoryHazardStore((state) => state.markRuntime);
    const clearInventoryHazardRuntime = useInventoryHazardStore((state) => state.clearRuntime);
    const retryInventoryHazardNow = useInventoryHazardStore((state) => state.retryNow);
    const [hazardRetryGeneration, setHazardRetryGeneration] = useState(0);
    const wasteBatchPendingRef = useRef<Set<string>>(new Set());
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTriggeredRef = useRef(false);
    const bulkMoveInfoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inventoryIdentityInFlightRef = useRef<Set<string>>(new Set());
    // Names already looked up in this lab; quick edits re-render the list often and must not re-query them.
    const inventoryIdentityAttemptedRef = useRef<Set<string>>(new Set());
    const bulkErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const bulkMoveRequestRef = useRef<{ signature: string; requestId: string } | null>(null);
    const loadRequestRef = useRef(0);

    const loadData = useCallback(async (options?: { background?: boolean }) => {
        const token: LabRequestToken = {
            generation: ++loadRequestRef.current,
            labId: currentLabId,
        };
        const isCurrentRequest = () => canCommitLabRequest(
            token,
            loadRequestRef.current,
            useLabStore.getState().currentLabId,
        );
        // A refresh after a save keeps the list on screen; only the first load blocks it.
        const isBackground = Boolean(options?.background) && loadedLabRef.current === token.labId;
        const requestStartedAt = Date.now();
        if (!isBackground) {
            setIsLoading(true);
            setLoadError(null);
        }
        try {
            const [fetchedItems, fetchedLocations, fetchedCabinets] = await Promise.all([
                inventoryService.getItems(),
                storageLocationService.getLocations(),
                cabinetService.getCabinets(),
            ]);
            if (!isCurrentRequest()) return;
            setItems(applyQuickUsageOverrides(fetchedItems, quickOverridesRef.current, requestStartedAt));
            setLocations(fetchedLocations);
            setCabinets(fetchedCabinets);
            setLoadedLabId(token.labId);
            setLoadError(null);
            loadedLabRef.current = token.labId;
        } catch (error) {
            if (!isCurrentRequest()) return;
            console.error('Failed to load inventory data:', error);
            if (isBackground) {
                setToast({ message: t('search_error'), tone: 'error' });
                return;
            }
            setItems([]);
            setLocations([]);
            setCabinets([]);
            setLoadedLabId(token.labId);
            setLoadError(t('search_error'));
        } finally {
            if (isCurrentRequest()) setIsLoading(false);
        }
    }, [currentLabId, t]);

    useLayoutEffect(() => {
        loadRequestRef.current += 1;
        loadedLabRef.current = undefined;
        inventoryIdentityAttemptedRef.current.clear();
        quickOverridesRef.current.clear();
        quickPendingRef.current.clear();
        quickTimersRef.current.forEach((timer) => clearTimeout(timer));
        quickTimersRef.current.clear();
        pendingScrollItemIdRef.current = null;
        setItems([]);
        setLocations([]);
        setCabinets([]);
        setLoadedLabId(undefined);
        setLoadError(null);
        setIsLoading(true);
        setSelectedDesktopItemId(null);
        setActivePane('primary');
        setHighlightItemId(null);
        setIsDetailMenuOpen(false);
        setQuickSaveStatus({});
        setItemToDelete(null);
        setIsFormOpen(false);
        setIsCameraOpen(false);
        setIsCsvImportOpen(false);
        setIsAddMenuOpen(false);
    }, [currentLabId]);

    useEffect(() => {
        void loadData();
        return () => {
            loadRequestRef.current += 1;
        };
    }, [loadData]);

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
        if (!toast) return;
        const timer = setTimeout(() => setToast(null), toast.tone === 'error' ? 3600 : 2400);
        return () => clearTimeout(timer);
    }, [toast]);

    useEffect(() => {
        const quickTimers = quickTimersRef.current;
        return () => {
            if (bulkMoveInfoTimerRef.current) {
                clearTimeout(bulkMoveInfoTimerRef.current);
            }
            if (bulkErrorTimerRef.current) {
                clearTimeout(bulkErrorTimerRef.current);
            }
            if (highlightTimerRef.current) {
                clearTimeout(highlightTimerRef.current);
            }
            quickTimers.forEach((timer) => clearTimeout(timer));
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
        const entryKey = buildInventoryHazardEntryKey(userId, currentLabId, cas);
        if (!entryKey) return null;
        const snapshot = inventoryHazardSnapshots[entryKey];
        const runtime = inventoryHazardRuntime[entryKey];
        if (snapshot) {
            return {
                status: 'loaded',
                snapshot,
                freshness: isInventoryHazardSnapshotFresh(snapshot) ? 'fresh' : 'stale',
                isRefreshing: runtime?.status === 'loading' || runtime?.status === 'refreshing',
                ...(runtime?.status === 'error' && runtime.error ? { updateError: runtime.error } : {}),
            };
        }
        if (runtime?.status === 'loading' || runtime?.status === 'refreshing') return { status: 'loading' };
        if (runtime?.status === 'error') return { status: 'error', error: runtime.error };
        return null;
    }, [currentLabId, inventoryHazardRuntime, inventoryHazardSnapshots, userId]);

    const getInventoryGhsHCodes = useCallback((item: InventoryItem): string[] => {
        const ghsState = getInventoryGhsState(item);
        return ghsState?.status === 'loaded' ? ghsState.snapshot.hCodes : [];
    }, [getInventoryGhsState]);

    const getInventoryGhsStatus = useCallback((item: InventoryItem) => {
        const ghsState = getInventoryGhsState(item);
        if (!ghsState) return 'not_checked' as const;
        if (ghsState.status === 'loading') return 'pending' as const;
        if (ghsState.status === 'error') return 'transient_error' as const;
        return ghsState.snapshot.status === 'classified' || ghsState.snapshot.status === 'not_classified'
            ? 'success' as const
            : 'no_ghs' as const;
    }, [getInventoryGhsState]);

    const classifyInventoryItemHazard = useCallback((item: InventoryItem) => (
        classifyInventoryHazard(item, {
            hCodes: getInventoryGhsHCodes(item),
            ghsStatus: getInventoryGhsStatus(item),
        })
    ), [getInventoryGhsHCodes, getInventoryGhsStatus]);

    const searchMatcher = useMemo(() => createInventorySearchMatcher(searchQuery), [searchQuery]);

    const filteredItems = useMemo(() => {
        let result = items;

        if (searchMatcher) {
            result = result.filter(searchMatcher);
        }

        if (hazardFilter !== 'all') {
            result = result.filter(item => (
                classifyInventoryItemHazard(item).filterCategories.includes(hazardFilter)
            ));
        }

        if (expiryFilter) {
            result = result.filter(item => matchesInventoryExpiryFilter(
                getExpiryStatus(getTrackedManufacturerDate(item))?.level,
                expiryFilter,
            ));
        }

        return result;
    }, [items, searchMatcher, hazardFilter, classifyInventoryItemHazard, expiryFilter]);

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
    // Items whose GHS lookup has not succeeded: a zero count over them is unknown, not "none".
    const unresolvedHazardCount = useMemo(() => items.filter((item) => {
        const entryKey = buildInventoryHazardEntryKey(userId, currentLabId, item.cas_number);
        if (!entryKey) return false;
        return getInventoryHazardResolution(
            inventoryHazardSnapshots[entryKey],
            inventoryHazardRuntime[entryKey],
        ) !== 'resolved';
    }).length, [currentLabId, inventoryHazardRuntime, inventoryHazardSnapshots, items, userId]);
    const hazardSummary = hazardFilterCounts.special_high;
    const hazardFilterOptions = useMemo(() => {
        const label = (key: string, count: number) => `${t(key)} (${formatInventoryHazardCount(count, unresolvedHazardCount)})`;
        return [
            { value: 'all', label: t('inventory_hazard_filter_all') },
            { value: 'special_high', label: label('inventory_hazard_special_high', hazardFilterCounts.special_high) },
            { value: 'flammable', label: label('inventory_hazard_flammable', hazardFilterCounts.flammable) },
            { value: 'corrosive', label: label('inventory_hazard_corrosive', hazardFilterCounts.corrosive) },
            { value: 'toxic', label: label('inventory_hazard_toxic', hazardFilterCounts.toxic) },
            { value: 'other_managed', label: label('inventory_hazard_other_managed', hazardFilterCounts.other_managed) },
        ];
    }, [hazardFilterCounts, t, unresolvedHazardCount]);

    // 만료/위치 우선으로 빠르게 확인할 수 있게 화면 전용 정렬 목록을 만든다.
    const visibleItems = useMemo(() => {
        return [...filteredItems].sort((a, b) => compareInventoryItems(a, b, sortBy));
    }, [filteredItems, sortBy]);
    const visibleGroups = useMemo(() => buildInventoryGroups(visibleItems, sortBy), [visibleItems, sortBy]);
    const identityReviewItemIds = useMemo(() => findInventoryIdentityConflictItemIds(items), [items]);
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
            label: (
                <span className="flex min-w-0 items-center gap-1.5">
                    <StorageLocationIcon icon={loc.icon} />
                    <span className="truncate">{translateLocationName(loc.name, t)}</span>
                </span>
            ),
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
            const status = getExpiryStatus(getTrackedManufacturerDate(item));
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
            tone: 'text-slate-500 dark:text-slate-400',
        },
        {
            label: t('inventory_quantity'),
            value: totalInventoryQuantity,
            Icon: Archive,
            tone: 'text-slate-500 dark:text-slate-400',
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

    const selectedDesktopItemKey = selectedDesktopItem?.id ?? null;
    useEffect(() => {
        setIsDetailMenuOpen(false);
    }, [selectedDesktopItemKey, activePane]);

    useEffect(() => {
        const grouped = new Map<string, InventoryItem[]>();
        for (const item of items) {
            if (item.cas_number?.trim() || !item.name.trim()) continue;
            const key = `${item.name.normalize('NFKC').trim().toLowerCase()}|${item.product_number || ''}`;
            if (inventoryIdentityInFlightRef.current.has(key) || inventoryIdentityAttemptedRef.current.has(key)) continue;
            const matches = grouped.get(key) ?? [];
            matches.push(item);
            grouped.set(key, matches);
        }
        if (grouped.size === 0) return;

        const entries = Array.from(grouped.entries());
        entries.forEach(([key]) => {
            inventoryIdentityInFlightRef.current.add(key);
            inventoryIdentityAttemptedRef.current.add(key);
        });

        const recoverMissingCasNumbers = async () => {
            try {
                for (let start = 0; start < entries.length; start += 25) {
                    const chunk = entries.slice(start, start + 25);
                    const results = await enrichChemicals(
                        chunk.map(([key, matches]) => ({
                            requestId: `inventory:${key}`,
                            name: matches[0].name,
                        })),
                        { labId: currentLabId },
                    );

                    for (let index = 0; index < results.length; index += 1) {
                        const result = results[index];
                        const entry = chunk[index];
                        if (!entry || result.identity.status !== 'verified' || !result.identity.casNumber) continue;
                        for (const item of entry[1]) {
                            if (useLabStore.getState().currentLabId !== currentLabId) return;
                            await inventoryService.updateItemCasWithLinkedSync(item, result.identity.casNumber);
                            setItems((current) => current.map((candidate) => (
                                candidate.id === item.id && !candidate.cas_number
                                    ? { ...candidate, cas_number: result.identity.casNumber || null }
                                    : candidate
                            )));
                        }
                    }
                }
            } catch (error) {
                console.warn('[Inventory] Automatic CAS recovery failed:', error);
                // A failed request may be retried on a later refresh.
                entries.forEach(([key]) => inventoryIdentityAttemptedRef.current.delete(key));
            } finally {
                entries.forEach(([key]) => inventoryIdentityInFlightRef.current.delete(key));
            }
        };

        void recoverMissingCasNumbers();
    }, [currentLabId, items]);

    useEffect(() => {
        if (!userId) return;
        const allCandidates = Array.from(new Map(
            items
                .map((item) => {
                    const cas = normalizeGhsCas(item.cas_number);
                    const key = buildInventoryHazardEntryKey(userId, currentLabId, cas);
                    return cas && key ? [key, { cas, key } satisfies InventoryHazardRequestEntry] as const : null;
                })
                .filter((entry): entry is readonly [string, InventoryHazardRequestEntry] => Boolean(entry)),
        ).values());
        if (allCandidates.length === 0) return;

        touchInventoryHazardSnapshots(allCandidates.map((candidate) => candidate.key));
        const now = Date.now();
        const initialStore = useInventoryHazardStore.getState();
        const candidates = allCandidates.filter((candidate) => {
            const snapshot = initialStore.snapshots[candidate.key];
            if (snapshot && isInventoryHazardSnapshotFresh(snapshot, now)) return false;
            const runtime = initialStore.runtimeByKey[candidate.key];
            if (runtime?.status === 'loading' || runtime?.status === 'refreshing') return false;
            return !(runtime?.status === 'error' && (runtime.retryAfter || 0) > now);
        });
        if (candidates.length === 0) return;

        const controller = new AbortController();
        const requestToken = globalThis.crypto?.randomUUID?.()
            || `inventory-ghs-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let isCancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        const isCurrentScope = () => (
            !isCancelled && useLabStore.getState().currentLabId === currentLabId
        );

        const markActive = (entries: InventoryHazardRequestEntry[]) => {
            const snapshotState = useInventoryHazardStore.getState().snapshots;
            const loadingKeys = entries.filter((entry) => !snapshotState[entry.key]).map((entry) => entry.key);
            const refreshingKeys = entries.filter((entry) => Boolean(snapshotState[entry.key])).map((entry) => entry.key);
            if (loadingKeys.length > 0) {
                markInventoryHazardRuntime(loadingKeys, { status: 'loading', requestToken });
            }
            if (refreshingKeys.length > 0) {
                markInventoryHazardRuntime(refreshingKeys, { status: 'refreshing', requestToken });
            }
        };

        const requestHazards = async (entries: InventoryHazardRequestEntry[]): Promise<InventoryHazardRequestEntry[]> => {
            const outcomes = await enrichInventoryHazardBatches(entries, {
                labId: currentLabId,
                signal: controller.signal,
            });

            if (!isCurrentScope()) return [];
            const snapshotUpdates: Array<{ key: string; snapshot: InventoryHazardSnapshot }> = [];
            const completedKeys: string[] = [];
            const retryEntries: InventoryHazardRequestEntry[] = [];

            for (const outcome of outcomes) {
                if ('error' in outcome) {
                    retryEntries.push(...outcome.chunk);
                    continue;
                }
                outcome.results.forEach((result, index) => {
                    const entry = outcome.chunk[index];
                    if (!entry) return;
                    const snapshot = createInventoryHazardSnapshot(entry.cas, result);
                    if (snapshot) snapshotUpdates.push({ key: entry.key, snapshot });
                    if (result.delivery?.freshness === 'stale' || result.hazard.status === 'transient_error') {
                        retryEntries.push(entry);
                    } else {
                        completedKeys.push(entry.key);
                    }
                });
            }

            if (snapshotUpdates.length > 0) upsertInventoryHazardSnapshots(snapshotUpdates);
            if (completedKeys.length > 0) clearInventoryHazardRuntime(completedKeys, requestToken);
            return Array.from(new Map(retryEntries.map((entry) => [entry.key, entry])).values());
        };

        markActive(candidates);
        void (async () => {
            try {
                let retryEntries = await requestHazards(candidates);
                if (!isCurrentScope() || retryEntries.length === 0) return;
                markActive(retryEntries);
                await new Promise<void>((resolve) => {
                    retryTimer = setTimeout(resolve, INVENTORY_GHS_RETRY_DELAY_MS);
                });
                if (!isCurrentScope()) return;
                retryEntries = await requestHazards(retryEntries);
                if (!isCurrentScope() || retryEntries.length === 0) return;
                markInventoryHazardRuntime(retryEntries.map((entry) => entry.key), {
                    status: 'error',
                    requestToken,
                    retryAfter: Date.now() + INVENTORY_GHS_FAILURE_COOLDOWN_MS,
                    error: t('inventory_ghs_update_needed'),
                });
            } catch (error) {
                if (!isCurrentScope() || (error instanceof DOMException && error.name === 'AbortError')) return;
                markInventoryHazardRuntime(candidates.map((entry) => entry.key), {
                    status: 'error',
                    requestToken,
                    retryAfter: Date.now() + INVENTORY_GHS_FAILURE_COOLDOWN_MS,
                    error: error instanceof Error ? error.message : t('inventory_ghs_update_needed'),
                });
            }
        })();

        return () => {
            isCancelled = true;
            controller.abort();
            if (retryTimer) clearTimeout(retryTimer);
            const runtimeState = useInventoryHazardStore.getState().runtimeByKey;
            const activeKeys = candidates
                .map((entry) => entry.key)
                .filter((key) => runtimeState[key]?.requestToken === requestToken && runtimeState[key]?.status !== 'error');
            clearInventoryHazardRuntime(activeKeys, requestToken);
        };
    }, [
        clearInventoryHazardRuntime,
        currentLabId,
        hazardRetryGeneration,
        items,
        markInventoryHazardRuntime,
        t,
        touchInventoryHazardSnapshots,
        upsertInventoryHazardSnapshots,
        userId,
    ]);

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

    const highlightItem = useCallback((itemId: string) => {
        pendingScrollItemIdRef.current = itemId;
        setHighlightItemId(itemId);
        setSelectedDesktopItemId(itemId);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
            setHighlightItemId(null);
            pendingScrollItemIdRef.current = null;
        }, INVENTORY_HIGHLIGHT_MS);
    }, []);

    const qrText = qrCopy(i18n.language);
    const purchaseText = purchaseCopy(i18n.language);
    // The admin inbox links here with ?purchases=1; the dialog stays open until closed.
    const isPurchasesOpen = isPurchaseRequestsEnabled && (isPurchasesDialogOpen || searchParams.get(PURCHASES_PARAM) === '1');
    const closePurchases = useCallback(() => {
        setIsPurchasesDialogOpen(false);
        if (!searchParams.has(PURCHASES_PARAM)) return;
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete(PURCHASES_PARAM);
            return next;
        }, { replace: true });
    }, [searchParams, setSearchParams]);
    const qrItemId = isQrLabelsEnabled ? searchParams.get(ITEM_PARAM) : null;
    const qrSpacePending = isQrLabelsEnabled && searchParams.has(SPACE_PARAM);
    useEffect(() => {
        if (!qrItemId || qrSpacePending || isLoading || loadedLabId !== currentLabId) return;
        const found = items.find((candidate) => candidate.id.toLowerCase() === qrItemId.toLowerCase());
        if (found) {
            setQrNotice(null);
            highlightItem(found.id);
            setActivePane('detail');
        } else {
            setQrNotice(qrText.itemNotFound);
        }
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete(ITEM_PARAM);
            return next;
        }, { replace: true });
    }, [currentLabId, highlightItem, isLoading, items, loadedLabId, qrItemId, qrSpacePending, qrText.itemNotFound, setSearchParams]);

    const storageLabelOf = useCallback((item: InventoryItem): string => (item.storage_type === 'cabinet'
        ? `${item.cabinet_name || t('inventory_loc_cabinet')}${typeof item.shelf_level === 'number' ? ` (${t('inventory_shelf_level', { level: Number(item.shelf_level) + 1 })})` : ''}`
        : (translateLocationName(item.storage_location_name || '', t) || t('inventory_loc_other'))), [t]);
    const toLabelItem = (item: InventoryItem): LabelSheetItem => ({
        id: item.id,
        name: item.name,
        casNumber: item.cas_number,
        location: storageLabelOf(item),
    });
    const selectedItemsForLabels = items.filter((item) => selectedItemIds.includes(item.id)).map(toLabelItem);
    const stocktakeItems = useMemo<StocktakeItem[]>(() => items.map((item) => ({
        id: item.id,
        name: item.name,
        casNumber: item.cas_number,
        locationKey: locationKeyOf(item),
        locationLabel: storageLabelOf(item),
    })), [items, storageLabelOf]);
    const stocktakeLocations = useMemo<StocktakeLocationOption[]>(() => {
        const options: StocktakeLocationOption[] = [
            ...cabinets.map((cabinet) => ({ key: `cabinet:${cabinet.id}`, label: cabinet.name })),
            ...locations.map((location) => ({ key: `location:${location.id}`, label: translateLocationName(location.name, t) || location.name })),
        ];
        if (stocktakeItems.some((item) => item.locationKey === 'other')) options.push({ key: 'other', label: t('inventory_loc_other') });
        return options;
    }, [cabinets, locations, stocktakeItems, t]);

    // Bring a freshly saved item into view (expanding its group first) once it is rendered.
    useEffect(() => {
        const targetId = pendingScrollItemIdRef.current;
        if (!targetId || !highlightItemId) return;
        const collapsedGroup = visibleGroups.find((group) => (
            group.cardCount > 1
            && !expandedGroupIds.includes(group.id)
            && group.items.some((groupItem) => groupItem.id === targetId)
        ));
        if (collapsedGroup) {
            setExpandedGroupIds((prev) => [...prev, collapsedGroup.id]);
            return;
        }
        const target = Array.from(document.querySelectorAll<HTMLElement>('[data-inventory-item-id]'))
            .find((element) => element.dataset.inventoryItemId === targetId && element.getClientRects().length > 0);
        if (!target) return;
        pendingScrollItemIdRef.current = null;
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [expandedGroupIds, highlightItemId, visibleGroups]);

    const handleFormSaved = (result: InventoryFormSaveResult) => {
        const { kind, itemId, values } = result;
        const savedLabId = currentLabId;
        const location = values.storage_type === 'other'
            ? locations.find((candidate) => candidate.id === values.storage_location_id)
            : undefined;
        const cabinet = values.storage_type === 'cabinet'
            ? cabinets.find((candidate) => candidate.id === values.cabinet_id)
            : undefined;
        const storageFields: Partial<InventoryItem> = {
            storage_type: values.storage_type,
            cabinet_id: values.storage_type === 'cabinet' ? (values.cabinet_id || null) : null,
            storage_location_id: values.storage_type === 'other' ? (values.storage_location_id || null) : null,
            cabinet_name: cabinet?.name ?? null,
            storage_location_name: location?.name ?? null,
            storage_location_icon: location?.icon ?? null,
        };

        if (kind === 'created' && result.item) {
            const created: InventoryItem = {
                ...result.item,
                ...storageFields,
                shelf_id: null,
                shelf_level: null,
                _source: 'inventory',
            };
            setItems((prev) => (prev.some((candidate) => candidate.id === created.id) ? prev : [created, ...prev]));
            // A filter that hides the new item would make the save look like it did nothing.
            const hiddenBySearch = Boolean(searchMatcher && !searchMatcher(created));
            const hiddenByHazard = hazardFilter !== 'all'
                && !classifyInventoryItemHazard(created).filterCategories.includes(hazardFilter);
            const hiddenByExpiry = expiryFilter !== null && !matchesInventoryExpiryFilter(
                getExpiryStatus(getTrackedManufacturerDate(created))?.level,
                expiryFilter,
            );
            if (hiddenBySearch || hiddenByHazard || hiddenByExpiry) {
                setSearchQuery('');
                setHazardFilter('all');
                if (expiryFilter) {
                    setSearchParams((current) => {
                        const next = new URLSearchParams(current);
                        next.delete(INVENTORY_FILTER_PARAM);
                        return next;
                    }, { replace: true });
                }
            }
        } else if (kind === 'updated') {
            setItems((prev) => prev.map((candidate) => {
                if (candidate.id !== itemId) return candidate;
                const isInventoryRow = candidate._source !== 'cabinet_item';
                const hasDate = hasManufacturerDate(values.manufacturer_date_type);
                return {
                    ...candidate,
                    name: values.name,
                    brand: values.brand || null,
                    product_number: values.product_number || null,
                    cas_number: values.cas_number || null,
                    capacity: values.capacity || null,
                    quantity: isInventoryRow ? (values.quantity ?? candidate.quantity) : candidate.quantity,
                    expiry_date: hasDate ? (values.expiry_date || null) : null,
                    manufacturer_date_type: values.manufacturer_date_type ?? candidate.manufacturer_date_type,
                    received_date: values.received_date || null,
                    opened_date: values.opened_date || null,
                    memo: values.memo || null,
                    remaining_percent: values.remaining_percent ?? candidate.remaining_percent,
                    ...(isInventoryRow && values.storage_type === 'other' ? storageFields : {}),
                };
            }));
        }

        setToast({
            message: t(kind === 'created' ? 'inventory_saved_created' : 'inventory_saved_updated', { name: values.name }),
            tone: 'success',
        });
        highlightItem(itemId);
        void loadData({ background: true });

        if (result.placement) {
            void result.placement.then((placed) => {
                if (useLabStore.getState().currentLabId !== savedLabId) return;
                // The item already exists either way; placement is reported on its own.
                setToast({
                    message: t(placed ? 'inventory_auto_placed' : 'inventory_auto_placed_fail'),
                    tone: placed ? 'success' : 'error',
                });
                if (placed) void loadData({ background: true });
            });
        }

        if (activeScanResultId) {
            setScanResults((prev) => prev.filter((item) => item.id !== activeScanResultId));
            setScanQueueItems((prev) => prev.filter((item) => item.id !== activeScanResultId));
            setActiveScanResultId(null);
        }
    };

    const flushQuickUsageUpdate = async (itemId: string) => {
        quickTimersRef.current.delete(itemId);
        const pending = quickPendingRef.current.get(itemId);
        if (!pending) return;
        quickPendingRef.current.delete(itemId);
        const savedLabId = currentLabId;
        // Writes to one row stay in order even when taps outpace the network.
        const previous = quickInFlightRef.current.get(itemId) ?? Promise.resolve();
        const run = previous
            .catch(() => undefined)
            .then(() => inventoryService.updateItemUsage(pending.item, pending.patch));
        quickInFlightRef.current.set(itemId, run);
        try {
            await run;
            if (useLabStore.getState().currentLabId !== savedLabId) return;
            if (quickPendingRef.current.has(itemId)) return;
            const override = quickOverridesRef.current.get(itemId);
            if (override) override.confirmedAt = Date.now();
            setQuickSaveStatus((prev) => ({ ...prev, [itemId]: 'saved' }));
            setTimeout(() => {
                setQuickSaveStatus((prev) => {
                    if (prev[itemId] !== 'saved') return prev;
                    const next = { ...prev };
                    delete next[itemId];
                    return next;
                });
            }, 1_400);
        } catch (error) {
            console.error('Failed to save quick inventory update:', error);
            if (useLabStore.getState().currentLabId !== savedLabId) return;
            quickOverridesRef.current.delete(itemId);
            setQuickSaveStatus((prev) => {
                const next = { ...prev };
                delete next[itemId];
                return next;
            });
            setToast({ message: t('error_save_generic'), tone: 'error' });
            void loadData({ background: true });
        } finally {
            if (quickInFlightRef.current.get(itemId) === run) quickInFlightRef.current.delete(itemId);
        }
    };

    /** Quantity / remaining level straight from the detail bar: shown at once, saved right after. */
    const applyQuickUsageUpdate = (item: InventoryItem, patch: QuickUsagePatch, delayMs = 0) => {
        const itemId = item.id;
        setItems((prev) => prev.map((candidate) => (
            candidate.id === itemId ? { ...candidate, ...patch } : candidate
        )));
        const override = quickOverridesRef.current.get(itemId);
        quickOverridesRef.current.set(itemId, {
            patch: { ...(override?.patch ?? {}), ...patch },
            confirmedAt: null,
        });
        const pending = quickPendingRef.current.get(itemId);
        quickPendingRef.current.set(itemId, {
            item: pending?.item ?? item,
            patch: { ...(pending?.patch ?? {}), ...patch },
        });
        setQuickSaveStatus((prev) => ({ ...prev, [itemId]: 'saving' }));
        const existingTimer = quickTimersRef.current.get(itemId);
        if (existingTimer) clearTimeout(existingTimer);
        quickTimersRef.current.set(itemId, setTimeout(() => {
            void flushQuickUsageUpdate(itemId);
        }, delayMs));
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
            setToast({ message: t('inventory_scan_result_ready', { name: result.name || t('scan_unknown_reagent') }), tone: 'success' });
        } catch (error) {
            console.error('Inventory scan registration failed:', error);
            const message = error instanceof Error ? error.message : t('inventory_scan_error_default');
            updateScanQueueItem(task.id, { status: 'error', label: t('scan_failed') });
            setToast({ message, tone: 'error' });
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
        // Storage is left to the form, which starts at the last used location.
        setInitialDraft({
            name: item.result.name || '',
            brand: item.result.brand || '',
            product_number: item.result.productNumber || '',
            cas_number: item.result.casNumber || '',
            quantity: 1,
            capacity: item.result.capacity || '',
            expiry_date: item.result.expiryDate || '',
            manufacturer_date_type: item.result.manufacturerDateType || 'unlabeled',
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
            setCasReviewError(t('inv_cas_err_load'));
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
                setBulkMoveInfo(t('inv_cas_applied_count', { count: successCount }));
            }

            if (failedCount > 0) {
                setCasReviewError(t('inv_cas_failed_count', { count: failedCount }));
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
    const [isExportingRegister, setIsExportingRegister] = useState(false);
    const handleExportHazardRegister = async () => {
        if (items.length === 0 || isExportingRegister) return;
        const registerText = hazardRegisterCopy(i18n.language);
        setIsExportingRegister(true);
        try {
            let sdsDocuments: Awaited<ReturnType<typeof import('../../services/inventorySdsService').fetchSdsDocuments>> = [];
            const sdsService = isSdsAttachmentsEnabled ? await import('../../services/inventorySdsService') : null;
            if (sdsService) sdsDocuments = await sdsService.fetchSdsDocuments(currentLabId).catch(() => []);
            const rows = buildRegisterRows(items.map((item) => {
                const ghsState = getInventoryGhsState(item);
                return {
                    name: item.name,
                    casNumber: item.cas_number,
                    brand: item.brand,
                    quantity: typeof item.quantity === 'number' ? item.quantity : null,
                    capacity: item.capacity,
                    location: storageLabelOf(item),
                    expiryDate: item.expiry_date,
                    ghs: ghsState?.status === 'loaded'
                        ? {
                            hCodes: ghsState.snapshot.hCodes,
                            signalWord: ghsState.snapshot.signalWord,
                            pictograms: ghsState.snapshot.pictogramCodes,
                            classified: ghsState.snapshot.status === 'classified',
                        }
                        : null,
                    hazardGroups: classifyInventoryItemHazard(item).groupLabelKeys.map((key) => t(key)),
                    hasSds: sdsService ? sdsService.matchSdsDocuments(sdsDocuments, { casNumber: item.cas_number, brand: item.brand, productNumber: item.product_number }).length > 0 : false,
                };
            }), registerText.row);
            const spaceName = currentLabId ? (useLabStore.getState().myLabs.find((membership) => membership.lab_id === currentLabId)?.lab?.name ?? '') : t('lab_personal_space');
            await downloadHazardRegister(rows, registerText.sheet, { space: spaceName, date: new Date() });
        } catch (error) {
            console.error('Failed to export the hazard analysis list:', error);
            setQrNotice(registerText.failed);
        } finally {
            setIsExportingRegister(false);
        }
    };

    const handleExportExcel = async () => {
        if (visibleItems.length === 0) return;
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
                [t('manufacturer_date_type_label')]: t(getManufacturerDateLabelKey(item.manufacturer_date_type)),
                [t('manufacturer_date_label')]: getTrackedManufacturerDate(item) || '',
                [t('inventory_received_date')]: item.received_date || '',
                [t('inventory_opened_date')]: item.opened_date || '',
                [t('inventory_memo')]: item.memo || '',
                ...exportImportAttributes(item.source_attributes),
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
            const deletedId = itemToDelete.id;
            quickOverridesRef.current.delete(deletedId);
            setItems((prev) => prev.filter((item) => item.id !== deletedId));
            if (selectedDesktopItemId === deletedId) setActivePane('primary');
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

            await loadData({ background: true });
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
                <span className="inline-flex max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap py-1 text-xs font-medium text-slate-500 dark:text-slate-400" title={storageLabel}>
                    <Archive className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{storageLabel}</span>
                </span>
            );
        }

        const storageLabel = translateLocationName(item.storage_location_name, t) || t('inventory_other_storage');
        return (
            <span className="inline-flex max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap py-1 text-xs font-medium text-slate-500 dark:text-slate-400" title={storageLabel}>
                <StorageLocationIcon icon={item.storage_location_icon} className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{storageLabel}</span>
            </span>
        );
    };

    const renderExpiryBadge = (item: InventoryItem) => {
        const status = getExpiryStatus(getTrackedManufacturerDate(item));
        if (!status || status.level === 'ok') return null;

        const badgeClasses = getExpiryBadgeClasses(status.level);
        const icon = status.level === 'expired'
            ? <AlertTriangle className="w-3 h-3" />
            : <Clock className="w-3 h-3" />;

        return (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold ${badgeClasses}`}>
                {icon}
                {t(status.labelKey, status.labelParams)}
            </span>
        );
    };

    const renderShortExpiry = (item: InventoryItem) => {
        const trackedDate = getTrackedManufacturerDate(item);
        const label = formatShortExpiry(trackedDate);
        if (!label) return null;
        const level = getExpiryStatus(trackedDate)?.level;
        const toneClass = level === 'expired' || level === 'critical'
            ? 'font-bold text-red-600 dark:text-red-400'
            : level === 'warning'
                ? 'font-semibold text-amber-600 dark:text-amber-400'
                : '';
        return (
            <span
                className={`inline-flex items-center gap-0.5 tabular-nums ${toneClass}`}
                title={`${t(getManufacturerDateLabelKey(item.manufacturer_date_type))}: ${trackedDate}`}
            >
                <Clock className="h-3 w-3" aria-hidden="true" />
                {label}
            </span>
        );
    };

    const renderRemainingBadge = (item: InventoryItem) => {
        const val = item.remaining_percent ?? 100;
        // A full bottle is the default state; only a low level is worth a badge.
        if (!isInventoryRemainingLow(val)) return null;

        const stage = getInventoryRemainingStage(val);
        const barColor = stage === 1 ? 'bg-red-500' : 'bg-orange-500';

        return (
            <span className="inline-flex min-w-[64px] flex-col gap-1 overflow-hidden align-middle">
                <span className="truncate whitespace-nowrap px-1.5 py-0.5 text-center text-3xs font-semibold leading-none text-slate-500 dark:text-slate-400">
                    {t(`inventory_remaining_stage_${stage}_label`)}
                </span>
                <span className="h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <span
                        className={`h-full ${barColor} transition-all duration-500`}
                        style={{ display: 'block', width: `${val}%` }}
                    />
                </span>
            </span>
        );
    };

    const getInventoryGhsPictograms = (item: InventoryItem): InventoryGhsPictogram[] => {
        const ghsState = getInventoryGhsState(item);
        if (ghsState?.status !== 'loaded') return [];

        const seenUrls = new Set<string>();
        return ghsState.snapshot.pictogramCodes
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
                <div className="inline-flex items-center gap-1" title={title}>
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
                                        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-2xs font-bold text-white shadow-lg ring-1 ring-white/10 group-hover/ghs:block group-focus-visible/ghs:block dark:bg-slate-50 dark:text-slate-950"
                                    >
                                        {tooltipLabel}
                                    </span>
                                </span>
                            );
                        })}
                    </div>
                </div>
            );
        }

        if (ghsState?.status === 'loading') {
            return <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label={t('msds_loading')} />;
        }

        if (!normalizeGhsCas(item.cas_number) && isDetail) {
            return (
                <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                    {t('inventory_ghs_cas_required')}
                </span>
            );
        }

        if (ghsState?.status === 'error' && isDetail) {
            const entryKey = buildInventoryHazardEntryKey(userId, currentLabId, item.cas_number);
            return (
                <button
                    type="button"
                    onClick={() => {
                        if (entryKey) retryInventoryHazardNow(entryKey);
                        setHazardRetryGeneration((generation) => generation + 1);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600 hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:text-slate-300"
                    title={ghsState.error}
                >
                    <Loader2 className="h-3.5 w-3.5" />
                    {t('inventory_ghs_retry')}
                </button>
            );
        }

        if (
            ghsState?.status === 'loaded'
            && (ghsState.snapshot.status === 'not_classified' || ghsState.snapshot.status === 'source_absent')
        ) {
            return <span className="text-xs text-slate-400" title={t('inventory_ghs_no_pictogram')}>-</span>;
        }

        if (hazard.filterCategories.length === 0) {
            return <span className="text-xs text-slate-400" title={t('inventory_ghs_no_pictogram')}>-</span>;
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

        return translateLocationName(item.storage_location_name, t) || t('inventory_other_storage');
    };

    const getGroupBorderClass = (group: InventoryGroup) => {
        let highestLevel: 'warning' | 'critical' | 'expired' | null = null;

        for (const item of group.items) {
            const status = getExpiryStatus(getTrackedManufacturerDate(item));
            if (!status || status.level === 'ok') continue;
            if (status.level === 'expired') return getExpiryCardBorderClass('expired');
            if (status.level === 'critical') highestLevel = 'critical';
            if (!highestLevel && status.level === 'warning') highestLevel = 'warning';
        }

        return highestLevel ? getExpiryCardBorderClass(highestLevel) : '';
    };

    const renderInventoryCard = (item: InventoryItem, options?: { nested?: boolean }) => {
        const nested = options?.nested ?? false;
        const needsIdentityReview = identityReviewItemIds.has(item.id);
        const expiryStatus = getExpiryStatus(getTrackedManufacturerDate(item));
        const cardBorderClass = expiryStatus ? getExpiryCardBorderClass(expiryStatus.level) : '';
        const wasteBatchActionKey = getWasteBatchActionKey(item);
        const isStartingWasteBatch = wasteBatchPendingKeys.includes(wasteBatchActionKey);
        const wasteBatchError = wasteBatchErrors[wasteBatchActionKey];
        const isHighlighted = highlightItemId === item.id;
        const surfaceClass = isHighlighted
            ? 'bg-blue-50 dark:bg-blue-950/40'
            : nested
                ? 'bg-slate-50/80 dark:bg-slate-900/30'
                : 'bg-white dark:bg-slate-800';
        // The border colour must always be set outside table mode; otherwise it falls back to currentColor.
        const borderClass = isHighlighted
            ? 'border-blue-400 ring-2 ring-blue-500/50 dark:border-blue-500'
            : `${cardBorderClass || 'border-slate-200 dark:border-slate-700'} ${selectedDesktopItemId === item.id ? 'table:border-blue-400 table:ring-2 table:ring-blue-500/30' : ''}`;

        return (
            <div
                key={item.id}
                data-inventory-item-id={item.id}
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
                    setSelectedDesktopItemId(item.id);
                    setActivePane('detail');
                }}
                className={`${nested ? 'rounded-2xl' : 'rounded-xl'} flex cursor-pointer flex-col gap-2 border px-3 pb-1 pt-3 shadow-sm transition-[background-color,border-color,box-shadow] duration-500 hover:border-blue-300 dark:hover:border-blue-600 ${surfaceClass} ${borderClass}`}
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
                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                {t('inventory_select_item')}
                            </label>
                        )}
                        <div className="text-base leading-6">
                            <h3 className="inline break-words font-semibold text-slate-800 dark:text-slate-100">
                                {item.name}
                            </h3>
                            {needsIdentityReview && (
                                <span
                                    className="ml-2 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 align-middle text-xs font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                    title={t('inventory_identity_review_help')}
                                >
                                    <AlertTriangle className="h-3 w-3" />
                                    {t('inventory_identity_review')}
                                </span>
                            )}
                            <span className="ml-2 inline-flex items-center gap-1.5 align-middle">
                                {renderExpiryBadge(item)}
                                {renderRemainingBadge(item)}
                            </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                            {renderShortExpiry(item)}
                            {item.cas_number && <span>{t('inventory_meta_cas')}: {item.cas_number}</span>}
                            {item.brand && <span>{item.brand}</span>}
                            {item.product_number && <span>{t('inventory_meta_pn')}: {item.product_number}</span>}
                            <SdsLinkList
                                variant="compact"
                                brand={item.brand}
                                productNumber={item.product_number}
                                casNumber={item.cas_number}
                            />
                        </div>
                        {(() => {
                            const hazard = classifyInventoryItemHazard(item);
                            if (hazard.filterCategories.length === 0) return null;
                            const isSpecialHigh = hazard.filterCategories.includes('special_high');
                            return (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    {hazard.groupLabelKeys.map(key => (
                                        <span key={key} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-3xs font-semibold ${isSpecialHigh
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
                    </div>
                    <div className="flex self-stretch shrink-0 flex-col items-end">
                        <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                            {t('inventory_quantity_count', { count: item.quantity })}
                        </span>
                        {item.capacity && (
                            <span className="mt-auto pb-0.5 text-xs text-slate-400 dark:text-slate-500">
                                {item.capacity}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex min-h-9 items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center">
                        {renderStorageBadge(item)}
                    </div>

                    {!isSelectMode && onStartWasteBatch && (
                        <button
                            type="button"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                void handleStartWasteBatch(item);
                            }}
                            disabled={isDeleting || isBulkDeleting || isStartingWasteBatch}
                            aria-label={`${t('inventory_dispose_short')}: ${item.name}`}
                            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                        >
                            {isStartingWasteBatch
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <FlaskConical className="h-3.5 w-3.5" />}
                            {t('inventory_dispose_short')}
                        </button>
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
        const identityReviewCount = group.items.filter((item) => identityReviewItemIds.has(item.id)).length;
        const uniqueCapacities = Array.from(new Set(group.items.map((item) => (item.capacity || '').trim()).filter(Boolean)));
        const expiryAlertCount = group.items.filter((item) => {
            const status = getExpiryStatus(getTrackedManufacturerDate(item));
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
                    className="flex cursor-pointer flex-col gap-2 px-3 pb-1 pt-3"
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
                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
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
                                 {identityReviewCount > 0 && (
                                     <span
                                         className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                         title={t('inventory_identity_review_help')}
                                     >
                                         <AlertTriangle className="h-3 w-3" />
                                         {t('inventory_group_identity_review_count', { count: identityReviewCount })}
                                     </span>
                                 )}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
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
                            <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                                {t('inventory_quantity_count', { count: group.totalQuantity })}
                            </span>
                            {uniqueCapacities.length === 1 && (
                                <span className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                    {uniqueCapacities[0]}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex min-h-9 items-center justify-between gap-3">
                        {hasSingleStorage ? (
                            renderStorageBadge(group.primaryItem)
                        ) : (
                            <span className="inline-flex items-center gap-1.5 py-1 text-xs font-medium text-slate-500 dark:text-slate-400">
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
                                className="inline-flex h-9 shrink-0 items-center gap-1 px-2 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
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

    const clearExpiryFilter = () => {
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete(INVENTORY_FILTER_PARAM);
            return next;
        }, { replace: true });
    };
    const hasActiveFilters = Boolean(searchQuery.trim()) || hazardFilter !== 'all' || expiryFilter !== null;
    const clearFilters = () => {
        setSearchQuery('');
        setHazardFilter('all');
        if (expiryFilter) clearExpiryFilter();
    };
    const expiryFilterLabel = expiryFilter ? t(INVENTORY_EXPIRY_FILTER_LABEL_KEYS[expiryFilter]) : '';
    const renderEmptyState = () => {
        if (items.length === 0) {
            return (
                <EmptyState
                    variant="inventory"
                    subtitle={t(isInventoryImportV2Enabled ? 'empty_inventory_import_hint_v2' : 'empty_inventory_import_hint')}
                    actions={(
                        <>
                            <button
                                type="button"
                                onClick={handleOpenManualRegistration}
                                className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700"
                            >
                                <PackagePlus className="h-4 w-4" />
                                {t('inventory_add_menu_manual')}
                            </button>
                            <button
                                type="button"
                                onClick={handleOpenScanRegistration}
                                className="inline-flex h-11 items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-50 dark:border-blue-800 dark:bg-slate-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
                            >
                                <Camera className="h-4 w-4" />
                                {t('inventory_add_menu_scan')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsCsvImportOpen(true)}
                                className="inline-flex h-11 items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-50 dark:border-blue-800 dark:bg-slate-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
                            >
                                <Upload className="h-4 w-4" />
                                {t('empty_inventory_import_action')}
                            </button>
                        </>
                    )}
                />
            );
        }
        return (
            <EmptyState
                variant="inventory_search"
                hideDescription={hasActiveFilters}
                actions={hasActiveFilters ? (
                    <button
                        type="button"
                        onClick={clearFilters}
                        className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                        <X className="h-4 w-4" />
                        {t('inventory_clear_filters')}
                    </button>
                ) : undefined}
            />
        );
    };

    if (loadedLabId !== currentLabId) {
        return (
            <div className="flex h-full items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <div role="alert" className="max-w-md rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                    <p>{loadError}</p>
                    <button type="button" onClick={() => void loadData()} className="mt-3 font-bold underline">
                        {t('msds_retry')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <AdaptivePaneLayout onActivePaneChange={setActivePane} layout={layout} activePane={activePane} onBack={() => setActivePane('primary')} data-mobile-inventory={isMobileInventory} data-inventory-table={listLayout.bounds.width >= 640} className="inventory-panes flex h-full flex-col bg-slate-50 dark:bg-slate-900">
            {/* Header */}
            <div data-pane="primary" className="inventory-header flex-shrink-0 border-b border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-slate-700 dark:bg-slate-900 table:col-start-1 table:row-start-1 table:overflow-y-auto table:[scrollbar-gutter:stable] table:border-b-0 table:border-r table:border-slate-200 table:bg-slate-50 table:px-6 table:pb-3 table:pt-6 dark:table:border-slate-800 dark:table:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                        <h1 className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xl font-bold text-slate-800 dark:text-slate-100 table:text-2xl">
                            <Package className="h-6 w-6 text-slate-500 dark:text-slate-400" />
                            {t('inventory_list_title')}
                        </h1>
                        <span
                            key={items.length}
                            aria-live="polite"
                            className="inline-flex shrink-0 text-sm font-medium tabular-nums text-slate-500 dark:text-slate-400"
                        >
                            {isMobileInventory && hasActiveFilters
                                ? t('inventory_filtered_count', { count: visibleItems.length, total: items.length })
                                : t('log_records_count', { count: items.length })}
                        </span>
                    </div>
                    <div
                        data-onboarding-target="inventory-tools"
                        className="inventory-header-tools flex flex-wrap items-center gap-1.5 table:gap-2"
                    >
                        {/*
                        <button
                            onClick={handleOpenCasReview}
                            disabled={blankCasItems.length === 0 || isCasReviewLoading}
                            title={t('inv_cas_fill_blank')}
                            className="p-1.5 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 flex items-center gap-1.5 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Search className={`w-4 h-4 table:w-3.5 table:h-3.5 ${isCasReviewLoading ? 'animate-pulse' : ''}`} />
                            <span className="hidden table:inline whitespace-nowrap">{t('inv_cas_fill_blank')}</span>
                        </button>
                        */}
                        <button
                            onClick={handleOpenScanRegistration}
                            title={t('inventory_add_menu_scan')}
                            className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 wide:inline-flex"
                        >
                            <Camera className="h-3.5 w-3.5" />
                            <span className="hidden whitespace-nowrap table:inline">{t('inventory_add_menu_scan')}</span>
                        </button>
                        <button
                            onClick={handleOpenManualRegistration}
                            title={t('inventory_add_menu_manual')}
                            className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 wide:inline-flex"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            <span className="hidden whitespace-nowrap table:inline">{t('inventory_add_menu_manual')}</span>
                        </button>
                        {isHazardRegisterExportEnabled && (
                            <button
                                onClick={() => void handleExportHazardRegister()}
                                disabled={items.length === 0 || isExportingRegister}
                                title={hazardRegisterCopy(i18n.language).buttonTitle}
                                aria-label={hazardRegisterCopy(i18n.language).buttonTitle}
                                className="hidden h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 sm:px-3 table:inline-flex"
                            >
                                {isExportingRegister ? <Loader2 className="w-4 h-4 table:w-3.5 table:h-3.5 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 table:w-3.5 table:h-3.5" />}
                                <span className="hidden table:inline whitespace-nowrap">{hazardRegisterCopy(i18n.language).button}</span>
                            </button>
                        )}
                        {isPurchaseRequestsEnabled && (
                            <button
                                onClick={() => setIsPurchasesDialogOpen(true)}
                                title={purchaseText.buttonTitle}
                                aria-label={purchaseText.buttonTitle}
                                className="hidden h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 sm:px-3 table:inline-flex"
                            >
                                <ShoppingCart className="w-4 h-4 table:w-3.5 table:h-3.5" />
                                <span className="hidden table:inline whitespace-nowrap">{purchaseText.button}</span>
                            </button>
                        )}
                        {isQrLabelsEnabled && (
                            <button
                                onClick={() => setIsStocktakeOpen(true)}
                                disabled={items.length === 0}
                                title={qrText.stocktake}
                                aria-label={qrText.stocktake}
                                className="hidden h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 sm:px-3 table:inline-flex"
                            >
                                <ScanLine className="w-4 h-4 table:w-3.5 table:h-3.5" />
                                <span className="hidden table:inline whitespace-nowrap">{qrText.stocktake}</span>
                            </button>
                        )}
                        <button
                            onClick={handleExportExcel}
                            disabled={visibleItems.length === 0}
                            title={t('inventory_excel_download_view')}
                            aria-label={t('inventory_excel_download_view')}
                            className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 sm:px-3"
                        >
                            <Download className="w-4 h-4 table:w-3.5 table:h-3.5" />
                            <span className="hidden table:inline whitespace-nowrap">{t('inventory_excel_download_view')}</span>
                        </button>
                        <button
                            onClick={() => setIsCsvImportOpen(true)}
                            title={t('inventory_csv_manage_button')}
                            aria-label={t('inventory_csv_manage_button')}
                            className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 sm:px-3"
                        >
                            <Upload className="w-4 h-4 table:w-3.5 table:h-3.5" />
                            <span className="hidden table:inline whitespace-nowrap">{t('inventory_csv_manage_button')}</span>
                        </button>
                    </div>
                    {isMobileInventory && <InventoryMobileTools canExport={visibleItems.length > 0} canSelect={items.length > 0}
                        isSelectMode={isSelectMode} onExport={handleExportExcel} onImport={() => setIsCsvImportOpen(true)} onSelect={toggleSelectMode}
                        stocktake={isQrLabelsEnabled && items.length > 0 ? { label: qrText.stocktake, run: () => setIsStocktakeOpen(true) } : undefined}
                        hazardRegister={isHazardRegisterExportEnabled && items.length > 0 ? { label: hazardRegisterCopy(i18n.language).button, run: () => void handleExportHazardRegister() } : undefined}
                        purchases={isPurchaseRequestsEnabled ? { label: purchaseText.button, run: () => setIsPurchasesDialogOpen(true) } : undefined} />}
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
                            action={{
                                label: t('onboarding_inventory_import_action'),
                                onClick: () => {
                                    markGuideSeen('inventory');
                                    setIsCsvImportOpen(true);
                                },
                            }}
                        />
                    </div>
                )}

                {qrNotice && (
                    <div role="status" className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                        <span className="break-keep">{qrNotice}</span>
                        <button type="button" onClick={() => setQrNotice(null)} aria-label={qrText.close} className="shrink-0 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}

                {/* Search Bar */}
                <div role="search" aria-label={t('inventory_list_title')} className="inventory-search-dock mt-4 relative table:hidden">
                    <div className="inventory-search-field relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        ref={inventorySearchRef}
                        type="search"
                        enterKeyHint="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={() => setIsAddMenuOpen(false)}
                        onKeyDown={(event) => {
                            // Enter only dismisses the keyboard; results are already live.
                            if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                        placeholder={t(isMobileInventory ? 'inventory_search_mobile_placeholder' : 'inventory_search_placeholder')}
                        aria-label={t('inventory_search_placeholder')}
                        className="w-full h-[42px] pl-9 pr-11 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-[border-color,box-shadow] [&::-webkit-search-cancel-button]:appearance-none"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => { setSearchQuery(''); inventorySearchRef.current?.focus(); }}
                            aria-label={t('inventory_search_clear')}
                            className="absolute right-0.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                    </div>
                    {isMobileInventory && <button type="button" aria-label={t('inventory_add_menu_open')} aria-expanded={isAddMenuOpen}
                        onClick={() => setIsAddMenuOpen(open => !open)}
                        className={`inventory-register-button flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-colors ${isAddMenuOpen ? 'bg-slate-800 dark:bg-slate-200 dark:text-slate-900' : 'bg-blue-600 hover:bg-blue-700'}`}>
                        {isAddMenuOpen ? <X size={22} /> : <Plus size={24} />}
                    </button>}
                </div>
                <div className="inventory-filter-row mt-3 flex items-center justify-end gap-2 table:hidden">
                    <div className="flex items-center gap-2 min-w-0">
                        <AppSelect
                            value={hazardFilter}
                            onChange={(value) => setHazardFilter(value as InventoryHazardFilter)}
                            options={hazardFilterOptions}
                            align={isMobileInventory ? 'left' : 'right'}
                            ariaLabel={t('inventory_hazard_filter')}
                            className="min-w-0 shrink"
                            buttonClassName={isMobileInventory
                                ? 'min-w-0 bg-slate-50 dark:bg-slate-800 !h-[40px] !rounded-full !shadow-none !text-xs !py-0'
                                : 'min-w-0 max-w-[154px] bg-white dark:bg-slate-800 !h-[40px] !rounded-xl !shadow-sm !text-xs !py-0'}
                            menuClassName="w-max min-w-[220px]"
                        />
                        <AppSelect
                            value={sortBy}
                            onChange={(value) => setSortBy(value as InventorySortOption)}
                            options={sortOptions}
                            ariaLabel={t('inventory_sort_label')}
                            align="right"
                            className="min-w-0 shrink"
                            buttonClassName={isMobileInventory
                                ? 'min-w-0 w-full bg-slate-50 dark:bg-slate-800 !h-[40px] !rounded-full !shadow-none !text-xs !py-0'
                                : 'min-w-0 w-full bg-white dark:bg-slate-800 !h-[40px] !rounded-xl !shadow-sm !text-xs !py-0'}
                            menuClassName="w-max min-w-[180px]"
                        />
                    </div>
                </div>
                {isSelectMode && (
                    <div className="inventory-bulk-controls mt-3 flex flex-wrap items-center gap-2 table:hidden">
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
                        {isQrLabelsEnabled && (
                            <button
                                type="button"
                                onClick={() => setLabelPrintItems(selectedItemsForLabels)}
                                disabled={selectedItemIds.length === 0}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 text-slate-600 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {qrText.printLabelsCount(selectedItemIds.length)}
                            </button>
                        )}
                        <div className="inventory-bulk-move flex items-center gap-2">
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
                                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
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
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {isBulkMoving
                                    ? t('inventory_bulk_move_running')
                                    : t('inventory_bulk_move_btn', { count: selectedItemIds.length })}
                            </button>
                        </div>
                    </div>
                )}
                {isSelectMode && (
                    <p className="mt-4 text-xs text-slate-500 dark:text-slate-400 table:hidden">
                        {t('inventory_selected_count', { count: selectedItemIds.length })}
                    </p>
                )}
                {bulkDeleteError && (
                    <p className="mt-4 text-xs text-red-600 dark:text-red-400 table:hidden">
                        {bulkDeleteError}
                    </p>
                )}
                {bulkMoveError && (
                    <p className="mt-4 text-xs text-red-600 dark:text-red-400 table:hidden">
                        {bulkMoveError}
                    </p>
                )}
                {bulkMoveInfo && (
                    <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300 table:hidden">
                        {bulkMoveInfo}
                    </p>
                )}
            </div>

            {/* List */}
            <div ref={listLayout.attachContainer} data-pane="primary" className="inventory-list min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-4 pb-24 table:col-start-1 table:row-start-2 table:[scrollbar-gutter:stable] table:border-r table:border-slate-200 table:px-6 table:pb-6 table:pt-0 dark:table:border-slate-800">
                {expiryFilter && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={clearExpiryFilter}
                            aria-label={t('inventory_filter_remove', { label: expiryFilterLabel })}
                            className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-red-200 bg-red-50 pl-3 pr-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
                        >
                            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{expiryFilterLabel}</span>
                            <X className="h-4 w-4 shrink-0" aria-hidden="true" />
                        </button>
                        {!isLoading && (
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                {t('inventory_filter_count', { count: visibleItems.length })}
                            </span>
                        )}
                    </div>
                )}

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
                        <div className="hidden min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 table:block">
                            <div className="border-b border-slate-200 p-3 dark:border-slate-800">
                                <div className="grid grid-cols-[minmax(280px,1fr)_auto_auto_auto] items-center gap-2">
                                    <div className="relative min-w-0">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="search"
                                            enterKeyHint="search"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder={t('inventory_search_placeholder')}
                                            aria-label={t('inventory_search_placeholder')}
                                            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-10 text-sm text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 [&::-webkit-search-cancel-button]:appearance-none"
                                        />
                                        {searchQuery && (
                                            <button
                                                type="button"
                                                onClick={() => setSearchQuery('')}
                                                aria-label={t('inventory_search_clear')}
                                                className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        )}
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
                                            ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300'
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
                                        <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />
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
                        {isQrLabelsEnabled && (
                            <button
                                type="button"
                                onClick={() => setLabelPrintItems(selectedItemsForLabels)}
                                disabled={selectedItemIds.length === 0}
                                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            >
                                {qrText.printLabelsCount(selectedItemIds.length)}
                            </button>
                        )}
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
                                                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
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
                                            className="h-8 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
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
                                            <div className="truncate text-2xs font-semibold text-slate-500 dark:text-slate-400">{label}</div>
                                            <div className="mt-0.5 text-lg font-bold leading-none text-slate-900 dark:text-slate-100">
                                                {value.toLocaleString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US')}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="min-w-0 overflow-x-hidden">
                            {visibleItems.length > 0 ? (
                                <table className="w-full min-w-0 table-fixed text-left text-sm">
                                    <colgroup>
                                        <col className="w-[5%]" />
                                        <col className="w-[24%]" />
                                        <col className="w-[18%]" />
                                        <col className="w-[8%]" />
                                        <col className="w-[17%]" />
                                        <col className="w-[12%]" />
                                        <col className="w-[16%]" />
                                    </colgroup>
                                    <thead className="border-b border-slate-200 bg-white text-2xs font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                                        <tr>
                                            <th className="px-2 py-2.5">
                                                <span className="sr-only">{t('inventory_select_item')}</span>
                                            </th>
                                            <th className="break-words px-2 py-2.5 leading-4">{t('inventory_csv_table_name')}</th>
                                            <th className="break-words px-2 py-2.5 leading-4">{t('inventory_csv_table_storage')}</th>
                                            <th className="break-words px-2 py-2.5 leading-4">{t('inventory_quantity')}</th>
                                            <th className="break-words px-2 py-2.5 leading-4">{t('inventory_error_expiry_label')}</th>
                                            <th className="break-words px-2 py-2.5 leading-4">{t('inventory_capacity')}</th>
                                            <th className="break-words px-2 py-2.5 leading-4">{t('inventory_hazard_management')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {visibleItems.map((item) => {
                                            const hazard = classifyInventoryItemHazard(item);
                                            const isSelected = selectedDesktopItem?.id === item.id;
                                            const isHighlighted = highlightItemId === item.id;
                                            const trackedManufacturerDate = getTrackedManufacturerDate(item);
                                            return (
                                                <tr
                                                    key={item.id}
                                                    data-inventory-item-id={item.id}
                                                    onClick={() => {
                                                        if (isSelectMode) {
                                                            toggleItemSelection(item.id);
                                                            return;
                                                        }
                                                        setSelectedDesktopItemId(item.id);
                                                        setActivePane('detail');
                                                    }}
                                                    className={`cursor-pointer transition-colors duration-500 ${
                                                        isHighlighted
                                                            ? 'bg-blue-100 dark:bg-blue-900/40'
                                                            : isSelected
                                                                ? 'bg-blue-50/80 dark:bg-blue-950/20'
                                                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                                                    }`}
                                                >
                                                    <td className="px-2 py-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedItemIds.includes(item.id)}
                                                            onChange={(event) => {
                                                                event.stopPropagation();
                                                                if (!isSelectMode) setIsSelectMode(true);
                                                                toggleItemSelection(item.id);
                                                            }}
                                                            onClick={(event) => event.stopPropagation()}
                                                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                        />
                                                    </td>
                                                    <td className="min-w-0 px-2 py-3">
                                                        <div className="min-w-0">
                                                            <div className="truncate font-semibold text-slate-900 dark:text-slate-100" title={item.name}>{item.name}</div>
                                                            <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                                                                {[item.cas_number, item.brand, item.product_number].filter(Boolean).join(' · ') || '—'}
                                                            </div>
                                                            <div className="mt-1 flex items-center gap-1.5">
                                                                {renderExpiryBadge(item)}
                                                                {renderRemainingBadge(item)}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="min-w-0 px-2 py-3">{renderStorageBadge(item)}</td>
                                                    <td className="truncate whitespace-nowrap px-2 py-3 font-semibold text-slate-700 dark:text-slate-200">{item.quantity}</td>
                                                    <td className="min-w-0 px-2 py-3 text-xs leading-5 text-slate-600 dark:text-slate-300">
                                                        {trackedManufacturerDate ? (
                                                            <span
                                                                className="block min-w-0 break-words"
                                                                title={`${t(getManufacturerDateLabelKey(item.manufacturer_date_type))}: ${trackedManufacturerDate}`}
                                                            >
                                                                {t(getManufacturerDateLabelKey(item.manufacturer_date_type))}: <span className="whitespace-nowrap">{trackedManufacturerDate}</span>
                                                            </span>
                                                        ) : '—'}
                                                    </td>
                                                    <td
                                                        className="truncate whitespace-nowrap px-2 py-3 text-xs font-semibold text-slate-600 dark:text-slate-300"
                                                        title={item.capacity || undefined}
                                                    >
                                                        {item.capacity || '-'}
                                                    </td>
                                                    <td className="min-w-0 px-2 py-3 text-center align-middle">
                                                        {renderGhsPictograms(item, hazard)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="p-8">
                                    {renderEmptyState()}
                                </div>
                            )}
                            </div>
                            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                                <span>{t('log_records_count', { count: visibleItems.length })}</span>
                                <span>{t('inventory_selected_count', { count: selectedItemIds.length })}</span>
                            </div>
                        </div>

                        <div className="space-y-2 table:hidden">
                            {visibleGroups.length > 0 ? (
                                visibleGroups.map((group) => (
                                    group.cardCount > 1
                                        ? renderGroupedInventoryCard(group)
                                        : renderInventoryCard(group.primaryItem)
                                ))
                            ) : (
                                renderEmptyState()
                            )}
                        </div>
                    </>
                )}

            </div>

            <aside data-pane="detail" className="min-h-0 overflow-y-auto border-l border-slate-200 bg-white px-4 pt-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex min-h-full flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{t('inventory_group_detail_view')}</h2>
                </div>

                {selectedDesktopItem ? (
                    <>
                    <div className="flex-1 space-y-4 py-4">
                        <div>
                            <h3 className="break-words text-lg font-bold leading-tight text-slate-900 dark:text-slate-100">
                                {selectedDesktopItem.name}
                            </h3>
                            {selectedDesktopItem.cas_number ? (
                                <p className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                                    {`${t('inventory_meta_cas')}: ${selectedDesktopItem.cas_number}`}
                                </p>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => handleEdit(selectedDesktopItem)}
                                    className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2.5 text-xs font-bold text-slate-600 transition-colors hover:border-emerald-400 hover:text-emerald-700 dark:border-slate-600 dark:text-slate-300 dark:hover:text-emerald-300"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    {t('inventory_add_cas')}
                                </button>
                            )}
                        </div>

                        <div className="space-y-2.5 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                            {[
                                [t('inventory_brand'), selectedDesktopItem.brand || '—'],
                                [t('inventory_product_number'), selectedDesktopItem.product_number || '—'],
                                [t('inventory_capacity'), selectedDesktopItem.capacity || '—'],
                                [
                                    t(hasManufacturerDate(selectedDesktopItem.manufacturer_date_type)
                                        ? getManufacturerDateLabelKey(selectedDesktopItem.manufacturer_date_type)
                                        : 'manufacturer_date_type_expiry'),
                                    getTrackedManufacturerDate(selectedDesktopItem) || '—',
                                ],
                                [t('inventory_received_date'), selectedDesktopItem.received_date || '—'],
                                [t('inventory_opened_date'), selectedDesktopItem.opened_date || '—'],
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

                                    if (
                                        pictograms.length > 0
                                        || Boolean(ghsState)
                                        || !normalizeGhsCas(selectedDesktopItem.cas_number)
                                    ) {
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

                        <SdsLinkList
                            brand={selectedDesktopItem.brand}
                            productNumber={selectedDesktopItem.product_number}
                            casNumber={selectedDesktopItem.cas_number}
                        />

                        {isSdsAttachmentsEnabled && (
                            <InventorySdsSection
                                labId={currentLabId}
                                casNumber={selectedDesktopItem.cas_number}
                                brand={selectedDesktopItem.brand}
                                productNumber={selectedDesktopItem.product_number}
                                language={i18n.language}
                            />
                        )}

                        <ChemicalRegulationPanel casNumber={selectedDesktopItem.cas_number} />

                        {isAiHandlingDraftsEnabled && (
                            <ReagentHandlingDraftPanel
                                casNumber={selectedDesktopItem.cas_number}
                                name={selectedDesktopItem.cas_number ? null : selectedDesktopItem.name}
                            />
                        )}

                        {readableImportAttributes(selectedDesktopItem.source_attributes).length > 0 && <details className="rounded-lg border p-3 dark:border-slate-700"><summary className="text-sm font-semibold">{t('inv_imported_source_info')}</summary><dl className="mt-2 space-y-1 text-xs">{readableImportAttributes(selectedDesktopItem.source_attributes).map((a, index) => <div key={index} className="break-words"><dt className="inline font-semibold">{a.label}: </dt><dd className="inline">{a.value || '—'}</dd></div>)}</dl></details>}
                    </div>

                    {/* Quick usage bar: the everyday updates stay one tap away on a phone. */}
                    <div className="sticky bottom-0 z-10 -mx-4 mt-auto border-t border-slate-200 bg-white/95 px-4 pb-3 pt-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
                        {quickSaveStatus[selectedDesktopItem.id] && (
                            <span
                                role="status"
                                className={`absolute -top-3 right-4 inline-flex h-6 items-center gap-1 rounded-full px-2 text-2xs font-bold text-white shadow-sm ${quickSaveStatus[selectedDesktopItem.id] === 'saved' ? 'bg-emerald-600' : 'bg-slate-500'}`}
                            >
                                {quickSaveStatus[selectedDesktopItem.id] === 'saved' ? (
                                    <>
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        {t('inventory_quick_saved')}
                                    </>
                                ) : (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={t('msds_loading')} />
                                )}
                            </span>
                        )}
                        <div role="radiogroup" aria-label={t('inventory_remaining_amount')} className="grid grid-cols-4 gap-1.5">
                            {INVENTORY_REMAINING_LEVELS.map((level) => {
                                const isSelected = level.stage === getInventoryRemainingStage(selectedDesktopItem.remaining_percent);
                                return (
                                    <button
                                        key={level.stage}
                                        type="button"
                                        role="radio"
                                        aria-checked={isSelected}
                                        onClick={() => {
                                            if (!isSelected) applyQuickUsageUpdate(selectedDesktopItem, { remaining_percent: level.value });
                                        }}
                                        className={`min-h-10 rounded-lg border-2 px-1 py-1 text-2xs font-bold leading-tight transition-colors duration-200 ${isSelected ? level.active : `${level.color} opacity-70`}`}
                                    >
                                        {t(`inventory_remaining_stage_${level.stage}_label`)}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                            {selectedDesktopItem._source !== 'cabinet_item' && (
                                <QuantityStepper
                                    key={selectedDesktopItem.id}
                                    value={selectedDesktopItem.quantity}
                                    onChange={(quantity) => {
                                        if (quantity !== selectedDesktopItem.quantity) {
                                            applyQuickUsageUpdate(selectedDesktopItem, { quantity }, QUICK_QUANTITY_SAVE_DELAY_MS);
                                        }
                                    }}
                                    className="h-11 w-[8.5rem] shrink-0 rounded-lg"
                                />
                            )}
                            {onStartWasteBatch && (
                                <button
                                    type="button"
                                    onClick={() => void handleStartWasteBatch(selectedDesktopItem)}
                                    disabled={isStartingDesktopWasteBatch || isDeleting || isBulkDeleting}
                                    aria-label={t('inventory_start_waste_batch')}
                                    className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isStartingDesktopWasteBatch
                                        ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                        : <FlaskConical className="h-4 w-4 shrink-0" />}
                                    <span className="truncate">{t('inventory_dispose_short')}</span>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => handleEdit(selectedDesktopItem)}
                                className={`inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 ${onStartWasteBatch ? 'shrink-0' : 'flex-1'}`}
                            >
                                {t('cabinet_card_edit')}
                            </button>
                            <div className="relative shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setIsDetailMenuOpen((open) => !open)}
                                    aria-label={t('inventory_more_actions')}
                                    aria-haspopup="menu"
                                    aria-expanded={isDetailMenuOpen}
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                >
                                    <MoreHorizontal className="h-5 w-5" />
                                </button>
                                {isDetailMenuOpen && (
                                    <>
                                        <button
                                            type="button"
                                            tabIndex={-1}
                                            aria-hidden="true"
                                            onClick={() => setIsDetailMenuOpen(false)}
                                            className="fixed inset-0 z-10 cursor-default"
                                        />
                                        <div role="menu" className="absolute bottom-full right-0 z-20 mb-2 min-w-[10rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                                            {isQrLabelsEnabled && (
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    onClick={() => {
                                                        setIsDetailMenuOpen(false);
                                                        setLabelPrintItems([toLabelItem(selectedDesktopItem)]);
                                                    }}
                                                    className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
                                                >
                                                    <QrCode className="h-4 w-4" />
                                                    {qrText.printLabels}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={() => {
                                                    setIsDetailMenuOpen(false);
                                                    handleDeleteClick(selectedDesktopItem);
                                                }}
                                                disabled={isDeleting || isBulkDeleting || isStartingDesktopWasteBatch}
                                                className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/30"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                {t('inventory_btn_delete')}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                        {selectedDesktopWasteBatchError && (
                            <p role="alert" className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
                                {selectedDesktopWasteBatchError}
                            </p>
                        )}
                    </div>
                    </>
                ) : (
                    <div className="flex min-h-[20rem] items-center justify-center text-center text-sm text-slate-400">
                        {t('inventory_select_item')}
                    </div>
                )}
                </div>
            </aside>

            {/* Registration actions open above the phone search dock. */}
            {isAddMenuOpen && (
                <>
                    <button
                        type="button"
                        aria-label={t('inventory_add_menu_close')}
                        onClick={() => setIsAddMenuOpen(false)}
                        className="absolute inset-0 z-10 cursor-default bg-slate-900/5 dark:bg-black/10 wide:hidden"
                    />
                    <div ref={addMenuRef} role="dialog" aria-modal="true" aria-label={t('inventory_add_menu_open')} tabIndex={-1}
                        className="inventory-register-actions absolute bottom-20 right-5 z-20 flex max-w-[calc(100vw-2.5rem)] flex-col items-end gap-3 wide:hidden">
                        <button
                            type="button"
                            onClick={handleOpenScanRegistration}
                            aria-label={t('inventory_add_menu_scan')}
                            className="animate-slide-up flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xl shadow-slate-900/10 transition-all hover:-translate-y-0.5 hover:bg-slate-50 active:translate-y-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                        >
                            <span className="whitespace-nowrap">{t('inventory_add_menu_scan')}</span>
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-500 dark:text-slate-400">
                                <Camera className="h-5 w-5" />
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={handleOpenManualRegistration}
                            aria-label={t('inventory_add_menu_manual')}
                            className="animate-slide-up flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xl shadow-slate-900/10 transition-all hover:-translate-y-0.5 hover:bg-slate-50 active:translate-y-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                            style={{ animationDelay: '60ms' }}
                        >
                            <span className="whitespace-nowrap">{t('inventory_add_menu_manual')}</span>
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-500 dark:text-slate-400">
                                <PackagePlus className="h-5 w-5" />
                            </span>
                        </button>
                    </div>
                </>
            )}
            {items.length > 0 && (
            <button
                type="button"
                aria-label={t('inventory_add_menu_open')}
                aria-expanded={isAddMenuOpen}
                onClick={() => setIsAddMenuOpen((open) => !open)}
                className={`inventory-register-fab absolute bottom-4 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all active:scale-95 wide:hidden ${isAddMenuOpen
                    ? 'rotate-45 bg-slate-800 shadow-slate-900/20 hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white'
                    : 'bg-blue-600 shadow-blue-600/20 hover:bg-blue-700'
                    }`}
            >
                <Plus className="w-6 h-6" />
            </button>
            )}

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
                    className="inventory-scan-resume absolute bottom-4 left-5 z-30 flex h-14 items-center gap-2 rounded-full border border-emerald-100 bg-white px-4 text-sm font-bold text-emerald-700 shadow-xl shadow-slate-900/10 transition-all hover:-translate-y-0.5 hover:bg-emerald-50 dark:border-emerald-900/60 dark:bg-slate-800 dark:text-emerald-300 table:hidden"
                >
                    <CheckCircle2 className="h-5 w-5" />
                    {t('inventory_scan_result_count', { count: scanResults.length })}
                </button>
            )}

            {isScanResultsOpen && (
                <div className="adaptive-overlay fixed inset-0 z-[95] flex items-end justify-center p-0 pointer-events-none">
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

            {toast && (
                <div
                    role={toast.tone === 'error' ? 'alert' : 'status'}
                    className="fixed top-20 left-1/2 z-[230] w-max max-w-[90vw] -translate-x-1/2 animate-slide-up"
                >
                    <div className={`flex items-center gap-2 rounded-full px-5 py-3 text-center text-sm font-semibold text-white shadow-lg ${toast.tone === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>
                        {toast.tone === 'error'
                            ? <AlertTriangle className="h-4 w-4 shrink-0" />
                            : <CheckCircle2 className="h-4 w-4 shrink-0" />}
                        <span>{toast.message}</span>
                    </div>
                </div>
            )}

            {/* Modal */}
            <InventoryFormModal
                isOpen={isFormOpen}
                onClose={handleCloseForm}
                locations={locations}
                cabinets={cabinets}
                initialData={editingItem}
                initialDraft={initialDraft}
                entryMode={formEntryMode}
                onSaved={handleFormSaved}
            />

            {labelPrintItems && (
                <LabelPrintDialog
                    items={labelPrintItems}
                    labId={currentLabId}
                    language={i18n.language}
                    onClose={() => setLabelPrintItems(null)}
                />
            )}
            {isPurchasesOpen && (
                <PurchaseRequestsDialog
                    items={items}
                    labId={currentLabId}
                    userId={currentMembership?.user_id ?? null}
                    isAdmin={currentMembership?.role === 'admin'}
                    language={i18n.language}
                    onClose={closePurchases}
                />
            )}
            {isStocktakeOpen && (
                <StocktakeDialog
                    items={stocktakeItems}
                    locations={stocktakeLocations}
                    labId={currentLabId}
                    language={i18n.language}
                    onClose={() => setIsStocktakeOpen(false)}
                />
            )}
            <InventoryCsvImportModal
                isOpen={isCsvImportOpen}
                items={items}
                locations={locations}
                cabinets={cabinets}
                onClose={() => setIsCsvImportOpen(false)}
                onImported={() => void loadData({ background: true })}
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
                <div className="adaptive-overlay fixed inset-0 z-[110] flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div
                        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
                        onClick={handleCloseCasReview}
                    />
                    <div className="relative z-10 w-full max-w-3xl rounded-3xl border border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">{t('inv_cas_fill_blank')}</h2>
                                <p className="mt-1 text-sm text-slate-600">
                                    {t('inv_cas_blank_summary', { blank: blankCasItems.length, suggested: casReviewSuggestedEntries.length })}
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
                                    <p>{t('inv_cas_searching')}</p>
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
                                                            {t('inv_apply')}
                                                        </label>
                                                    )}
                                                />
                                            ))}
                                        </div>
                                    ) : !casReviewError ? (
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
                                            {t('inv_cas_none_found')}
                                        </div>
                                    ) : null}

                                    {casReviewBlockedEntries.length > 0 && (
                                        <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                                                {t('inv_cas_blocked_count', { count: casReviewBlockedEntries.length })}
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
                                {t('inv_cas_only_selected')}
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
                                    {t('inv_apply_selected_count', { count: selectedCasReviewCount })}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            */}
        </AdaptivePaneLayout>
    );
};
