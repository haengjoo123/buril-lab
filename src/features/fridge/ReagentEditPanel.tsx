import React, { useState, useEffect, useRef } from 'react';
import { useFridgeStore } from '../../store/fridgeStore';
import { useLabStore } from '../../store/useLabStore';
import { useAuth } from '../../hooks/useAuth';
import { X, Save, Trash2, Beaker, MapPin, CalendarClock, CheckCircle2, Tag, Package, Loader2, History, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { analyticsService } from '../../services/analyticsService';
import { cabinetService } from '../../services/cabinetService';
import {
    createInventoryOperationRequestId,
    inventoryService,
    type InventoryItem,
    type InventoryUsageCompletionKind,
} from '../../services/inventoryService';
import { auditService, type AuditLog } from '../../services/auditService';
import type { ReagentTemplateType } from '../../types/fridge';
import { CONTAINER_BASE_WIDTHS } from './ReagentItem';
import { getExpiryStatus, getExpiryBadgeClasses } from '../../utils/expiryStatus';
import { classifyStoragePlacement, checkShelfCompatibility, getStorageGroupLabels } from '../../utils/storageCompatibilityChecker';
import { AlertTriangle, FlaskConical, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { searchChemical } from '../../services/searchService';
import { ReagentDateFields } from '../../components/ReagentDateFields';
import { hasManufacturerDate, type ManufacturerDateType } from '../../utils/manufacturerDate';
import { analyzeChemical } from '../../utils/chemicalAnalyzer';
import { classifyChemicalWithAI } from '../../services/geminiClassificationService';
import { ResultCard } from '../../components/ResultCard';
import type { AnalysisResult } from '../../types';
import { CasSuggestionCard } from '../../components/CasSuggestionCard';
import { getSuggestedCasInputMethod, useCasSuggestion } from '../../hooks/useCasSuggestion';
import {
    executeReagentDisposalAction,
    type ReagentDisposalReason,
    type WasteBatchDisposalReason,
} from './reagentDisposalFlow';

const REASONS: { key: ReagentDisposalReason; i18n: string; icon: string }[] = [
    { key: 'used', i18n: 'cabinet_dispose_reason_used', icon: '✅' },
    { key: 'empty_container', i18n: 'cabinet_dispose_reason_empty_container', icon: '📦' },
    { key: 'contaminated_container', i18n: 'cabinet_dispose_reason_contaminated_container', icon: '⚠️' },
    { key: 'expired', i18n: 'cabinet_dispose_reason_expired', icon: '⏰' },
    { key: 'broken', i18n: 'cabinet_dispose_reason_broken', icon: '💔' },
    { key: 'leak', i18n: 'cabinet_dispose_reason_leak', icon: '💧' },
    { key: 'other', i18n: 'cabinet_dispose_reason_other', icon: '📝' },
];

const CONTAINER_TYPES: { type: ReagentTemplateType; label: string; icon: string }[] = [
    { type: 'A', label: 'cabinet_container_amber', icon: '🟤' },
    { type: 'B', label: 'cabinet_container_plastic', icon: '🤍' },
    { type: 'C', label: 'cabinet_container_glass', icon: '🧪' },
    { type: 'D', label: 'cabinet_container_vial', icon: '🧴' },
];

const STORAGE_WARNING_PREVIEW_LIMIT = 3;

interface ReagentEditPanelProps {
    variant?: 'floating' | 'desktop-aside';
    onStartWasteBatch?: (
        item: InventoryItem,
        options?: { reason?: WasteBatchDisposalReason },
    ) => Promise<void>;
}

export const ReagentEditPanel: React.FC<ReagentEditPanelProps> = ({
    variant = 'floating',
    onStartWasteBatch,
}) => {
    const { t, i18n } = useTranslation();
    const { user } = useAuth();
    const currentLabId = useLabStore((state) => state.currentLabId);
    const disposalReasons = onStartWasteBatch
        ? REASONS
        : REASONS.filter(({ key }) => key === 'used' || key === 'empty_container');
    const selectedReagentId = useFridgeStore(s => s.selectedReagentId);
    const shelves = useFridgeStore(s => s.shelves);
    const cabinetId = useFridgeStore(s => s.cabinetId);
    const updateReagent = useFridgeStore(s => s.updateReagent);
    const removeReagent = useFridgeStore(s => s.removeReagent);
    const saveCabinet = useFridgeStore(s => s.saveCabinetStrict);
    const placeReagentNear = useFridgeStore(s => s.placeReagentNear);
    const setSelectedReagentId = useFridgeStore(s => s.setSelectedReagentId);

    const [name, setName] = useState('');
    const [notes, setNotes] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [manufacturerDateType, setManufacturerDateType] = useState<ManufacturerDateType>('unlabeled');
    const [receivedDate, setReceivedDate] = useState('');
    const [openedDate, setOpenedDate] = useState('');
    const [capacity, setCapacity] = useState('');
    const [template, setTemplate] = useState<ReagentTemplateType>('A');
    const [width, setWidth] = useState<number>(10);
    const [brand, setBrand] = useState('');
    const [productNumber, setProductNumber] = useState('');
    const [casNo, setCasNo] = useState('');

    // Disposal flow state
    const [showDisposalView, setShowDisposalView] = useState(false);
    const [selectedReason, setSelectedReason] = useState<ReagentDisposalReason | null>(null);
    const [isDisposing, setIsDisposing] = useState(false);
    const [disposalError, setDisposalError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [copyToastMessage, setCopyToastMessage] = useState<string | null>(null);
    const [isStorageWarningsExpanded, setIsStorageWarningsExpanded] = useState(false);

    const [remainingPercent, setRemainingPercent] = useState<number>(100);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    // Disposal guide state
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

    // Prevent immediate interaction to avoid ghost clicks on mobile
    const [showModalContent, setShowModalContent] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const analysisDialogRef = useRef<HTMLDivElement>(null);
    const analysisDialogCloseRef = useRef<HTMLButtonElement>(null);
    const usageCompletionRequestRef = useRef<{
        cabinetItemId: string;
        completionKind: InventoryUsageCompletionKind;
        requestId: string;
    } | null>(null);
    // Find the selected item from all shelves
    const selectedItem = React.useMemo(() => {
        if (!selectedReagentId) return null;
        for (const shelf of shelves) {
            const item = shelf.items.find(i => i.id === selectedReagentId);
            if (item) return { ...item, shelfLevel: shelf.level };
        }
        return null;
    }, [selectedReagentId, shelves]);
    const casSuggestion = useCasSuggestion({
        enabled: Boolean(selectedReagentId && showModalContent),
        inputName: name,
        casNumber: casNo,
        sourceType: 'reagent_edit_panel',
        brand,
        productNumber,
        capacity,
        onApplyCasNumber: setCasNo,
    });

    // Update local state when selection data changes
    useEffect(() => {
        if (selectedItem) {
            setName(selectedItem.name);
            setNotes(selectedItem.notes || '');
            setExpiryDate(selectedItem.expiryDate || '');
            setManufacturerDateType(selectedItem.manufacturerDateType || 'unlabeled');
            setReceivedDate(selectedItem.receivedDate || '');
            setOpenedDate(selectedItem.openedDate || '');
            setCapacity(selectedItem.capacity || '');
            setTemplate(selectedItem.template);
            setBrand(selectedItem.brand || '');
            setProductNumber(selectedItem.productNumber || '');
            setCasNo(selectedItem.casNo || '');
            setRemainingPercent(selectedItem.remaining_percent ?? 100);
            setWidth(selectedItem.width || CONTAINER_BASE_WIDTHS[selectedItem.template] || 10);
        }
    }, [selectedItem]);

    // Handle open animation when a new reagent is selected
    useEffect(() => {
        if (selectedReagentId) {
            setShowModalContent(false);
            setIsStorageWarningsExpanded(false);
            const timer = setTimeout(() => {
                setShowModalContent(true);
            }, 300);
            return () => clearTimeout(timer);
        } else {
            setShowModalContent(false);
            setIsStorageWarningsExpanded(false);
        }
    }, [selectedReagentId]);

    // Reset disposal view when panel opens/closes
    useEffect(() => {
        setShowDisposalView(false);
        setSelectedReason(null);
        setDisposalError(null);

        if (selectedReagentId) {
            setIsLoadingLogs(true);
            auditService.getLogs({ entity_id: selectedReagentId, limit: 10 })
                .then(setAuditLogs)
                .catch(console.error)
                .finally(() => setIsLoadingLogs(false));
        }
    }, [selectedReagentId]);

    useEffect(() => {
        if (!copyToastMessage) return;

        const timer = window.setTimeout(() => {
            setCopyToastMessage(null);
        }, 2400);

        return () => window.clearTimeout(timer);
    }, [copyToastMessage]);

    useEffect(() => {
        if (!selectedReagentId || !showModalContent || analysisResult) return;

        const panel = panelRef.current;
        if (panel && !panel.contains(document.activeElement)) {
            panel.focus();
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (showDisposalView) {
                    setShowDisposalView(false);
                    setSelectedReason(null);
                    setDisposalError(null);
                } else {
                    setSelectedReagentId(null);
                }
                return;
            }

            if (event.key !== 'Tab' || !panel) return;
            const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ));
            if (focusable.length === 0) {
                event.preventDefault();
                panel.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [analysisResult, selectedReagentId, setSelectedReagentId, showDisposalView, showModalContent]);

    useEffect(() => {
        if (!analysisResult) return;

        const dialog = analysisDialogRef.current;
        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        analysisDialogCloseRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setAnalysisResult(null);
                return;
            }
            if (event.key !== 'Tab' || !dialog) return;

            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ));
            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (previouslyFocused?.isConnected) previouslyFocused.focus();
        };
    }, [analysisResult]);

    if (!selectedReagentId || !selectedItem || !showModalContent) return null;

    const handleSave = async () => {
        if (isSaving) return;

        const normalize = (value?: string | null) => (value || '').trim();
        const shouldTrackCommerceUpdate =
            normalize(selectedItem.brand) !== normalize(brand)
            || normalize(selectedItem.productNumber) !== normalize(productNumber)
            || normalize(selectedItem.casNo) !== normalize(casNo)
            || normalize(selectedItem.capacity) !== normalize(capacity);
        const casChanged = normalize(selectedItem.casNo) !== normalize(casNo);
        const casInputMethod = getSuggestedCasInputMethod(
            casSuggestion.isSuggestedCasApplied,
            casNo.trim() ? 'manual' : 'unknown',
            casSuggestion.appliedSuggestion?.confidence,
        );

        const updatePayload = {
            name,
            memo: notes || undefined,
            expiry_date: expiryDate || undefined,
            manufacturer_date_type: manufacturerDateType,
            received_date: receivedDate || undefined,
            opened_date: openedDate || undefined,
            capacity: capacity || undefined,
            brand: brand || undefined,
            product_number: productNumber || undefined,
            cas_number: casNo || undefined,
            remaining_percent: remainingPercent,
        };

        updateReagent(selectedReagentId, {
            name,
            notes,
            expiryDate: expiryDate || undefined,
            manufacturerDateType,
            receivedDate: receivedDate || undefined,
            openedDate: openedDate || undefined,
            capacity: capacity || undefined,
            template,
            brand: brand || undefined,
            productNumber: productNumber || undefined,
            casNo: casNo || undefined,
            remaining_percent: remainingPercent,
            width,
            ...(casChanged ? {
                hCodes: [],
                isAcidic: false,
                isBasic: false,
                ghsStatus: casNo ? 'pending' as const : 'not_checked' as const,
                ghsCheckedAt: undefined,
            } : {}),
        });

        // If CAS changed and now has a value, trigger PubChem enrichment
        if (casChanged && casNo) {
            const enrichStore = useFridgeStore.getState();
            enrichStore.enrichReagentGHS(selectedReagentId);
        }

        // 감사로그를 남기기 위해 cabinet_item 업데이트 RPC를 먼저 호출합니다.
        setIsSaving(true);
        try {
            await inventoryService.updateItem(selectedReagentId, updatePayload, 'cabinet_item');
            if (selectedItem.linkedInventoryItemId) {
                await inventoryService.updateItem(selectedItem.linkedInventoryItemId, {
                    ...updatePayload,
                    storage_type: 'cabinet',
                    cabinet_id: cabinetId || undefined,
                }, 'inventory');
            } else if (casChanged) {
                await inventoryService.syncLinkedCabinetCas({
                    source: 'cabinet_item',
                    sourceId: selectedReagentId,
                    cabinetId,
                    name: selectedItem.name,
                    brand: selectedItem.brand,
                    productNumber: selectedItem.productNumber,
                    capacity: selectedItem.capacity,
                    previousCasNumber: selectedItem.casNo,
                    nextCasNumber: casNo,
                });
            }
            await saveCabinet();
            if (shouldTrackCommerceUpdate) {
                await analyticsService.trackCommerceIntentEvent({
                    eventType: 'cabinet_item_updated',
                    sourceScreen: 'reagent_edit_panel',
                    storageType: 'cabinet',
                    sourceItemType: 'cabinet_item',
                    sourceItemId: selectedReagentId,
                    brandName: brand,
                    productNumber,
                    quantity: 1,
                    capacityText: capacity,
                    casNumber: casNo,
                    casInputMethod,
                    metadata: {
                        edited_from: 'cabinet_detail',
                    },
                });
            }
            setSelectedReagentId(null);
        } catch (err) {
            console.error('Failed to save reagent edits:', err);
        } finally {
            setIsSaving(false);
        }
    };

    const expiryStatus = getExpiryStatus(hasManufacturerDate(manufacturerDateType) ? expiryDate : null);

    const handleDeleteClick = () => {
        setDisposalError(null);
        setShowDisposalView(true);
    };

    const confirmDisposal = async () => {
        if (!selectedReason || !cabinetId) return;
        setIsDisposing(true);
        setDisposalError(null);
        try {
            const actionResult = await executeReagentDisposalAction({
                reason: selectedReason,
                completeUsage: async (completionKind) => {
                    const pendingRequest = usageCompletionRequestRef.current;
                    const requestId = pendingRequest?.cabinetItemId === selectedReagentId &&
                        pendingRequest.completionKind === completionKind
                        ? pendingRequest.requestId
                        : createInventoryOperationRequestId();
                    usageCompletionRequestRef.current = {
                        cabinetItemId: selectedReagentId,
                        completionKind,
                        requestId,
                    };

                    return inventoryService.recordUsageCompletion({
                        cabinetItemId: selectedReagentId,
                        requestId,
                        completionKind,
                    });
                },
                startWasteBatch: async (reason) => {
                    if (!onStartWasteBatch) {
                        throw new Error(t('cabinet_start_waste_batch_failed'));
                    }

                    const inventoryItem: InventoryItem = {
                        id: selectedReagentId,
                        lab_id: currentLabId,
                        user_id: currentLabId ? null : user?.id ?? null,
                        name: selectedItem.name,
                        brand: selectedItem.brand ?? null,
                        product_number: selectedItem.productNumber ?? null,
                        cas_number: selectedItem.casNo ?? null,
                        quantity: 1,
                        capacity: selectedItem.capacity ?? null,
                        storage_type: 'cabinet',
                        cabinet_id: cabinetId,
                        storage_location_id: null,
                        product_id: null,
                        expiry_date: selectedItem.expiryDate ?? null,
                        manufacturer_date_type: selectedItem.manufacturerDateType || 'unlabeled',
                        received_date: selectedItem.receivedDate ?? null,
                        opened_date: selectedItem.openedDate ?? null,
                        memo: selectedItem.notes ?? null,
                        remaining_percent: selectedItem.remaining_percent ?? null,
                        created_at: '',
                        updated_at: '',
                        linked_inventory_item_id: selectedItem.linkedInventoryItemId ?? null,
                        shelf_id: selectedItem.shelfId,
                        shelf_level: selectedItem.shelfLevel,
                        _source: 'cabinet_item',
                    };

                    await onStartWasteBatch(inventoryItem, { reason });
                },
            });

            if (actionResult.kind === 'inventory_usage_completed') {
                if (actionResult.receipt.cabinetItemRemoved) {
                    // The RPC already removed the database rows. Only mirror that
                    // committed result in local cabinet state; do not save again.
                    removeReagent(selectedReagentId);
                }
                usageCompletionRequestRef.current = null;
            }

            setShowDisposalView(false);
            setSelectedReason(null);
            setSelectedReagentId(null);
        } catch (err) {
            console.error('Disposal failed:', err);
            setDisposalError(err instanceof Error ? err.message : t('cabinet_start_waste_batch_failed'));
        } finally {
            setIsDisposing(false);
        }
    };

    const handleCopy = async () => {
        if (isCopying || !cabinetId || !selectedReagentId) return;

        const sourcePlacementId = selectedReagentId;
        const sourceItem = {
            ...selectedItem,
            hCodes: [...selectedItem.hCodes],
        };

        setIsCopying(true);
        setCopyToastMessage(null);

        let createdInventoryId: string | null = null;
        let placedItemId: string | null = null;

        try {
            const createdInventory = await inventoryService.createItem({
                name: sourceItem.name,
                brand: sourceItem.brand || undefined,
                product_number: sourceItem.productNumber || undefined,
                cas_number: sourceItem.casNo || undefined,
                quantity: 1,
                capacity: sourceItem.capacity || undefined,
                storage_type: 'cabinet',
                cabinet_id: cabinetId,
                expiry_date: sourceItem.expiryDate || undefined,
                manufacturer_date_type: sourceItem.manufacturerDateType || 'unlabeled',
                received_date: sourceItem.receivedDate || undefined,
                opened_date: sourceItem.openedDate || undefined,
                memo: sourceItem.notes || undefined,
                remaining_percent: sourceItem.remaining_percent,
            });

            if (!createdInventory) {
                throw new Error(t('cabinet_copy_failed'));
            }

            createdInventoryId = createdInventory.id;

            const placed = placeReagentNear(sourcePlacementId, {
                reagentId: createdInventory.id,
                linkedInventoryItemId: createdInventory.id,
                name: sourceItem.name,
                width: sourceItem.width,
                template: sourceItem.template,
                isAcidic: sourceItem.isAcidic,
                isBasic: sourceItem.isBasic,
                hCodes: sourceItem.hCodes,
                notes: sourceItem.notes,
                casNo: sourceItem.casNo,
                capacity: sourceItem.capacity,
                productNumber: sourceItem.productNumber,
                brand: sourceItem.brand,
                expiryDate: sourceItem.expiryDate,
                manufacturerDateType: sourceItem.manufacturerDateType,
                receivedDate: sourceItem.receivedDate,
                openedDate: sourceItem.openedDate,
                remaining_percent: sourceItem.remaining_percent,
            });

            if (!placed) {
                await inventoryService.deleteItem({ ...createdInventory, _source: 'inventory' });
                setSelectedReagentId(sourcePlacementId);
                setCopyToastMessage(t('reagent_no_space'));
                return;
            }

            placedItemId = placed.itemId;
            await saveCabinet();

            cabinetService.logActivity(
                cabinetId,
                'add',
                sourceItem.name,
                undefined,
                t('cabinet_copy_activity_memo')
            ).catch((error) => console.error('Failed to log cabinet copy activity:', error));

            setCopyToastMessage(t('cabinet_copy_success_toast'));
        } catch (err) {
            console.error('Failed to copy reagent:', err);

            if (placedItemId) {
                useFridgeStore.getState().removeReagent(placedItemId);
                useFridgeStore.getState().setSelectedReagentId(sourcePlacementId);
                try {
                    await useFridgeStore.getState().saveCabinet();
                } catch (rollbackSaveError) {
                    console.error('Failed to persist copied reagent rollback:', rollbackSaveError);
                }
            }

            if (createdInventoryId) {
                try {
                    await inventoryService.deleteItem({
                        id: createdInventoryId,
                        lab_id: null,
                        user_id: null,
                        name: sourceItem.name,
                        brand: sourceItem.brand ?? null,
                        product_number: sourceItem.productNumber ?? null,
                        cas_number: sourceItem.casNo ?? null,
                        quantity: 1,
                        capacity: sourceItem.capacity ?? null,
                        storage_type: 'cabinet',
                        cabinet_id: cabinetId,
                        storage_location_id: null,
                        product_id: null,
                        expiry_date: sourceItem.expiryDate ?? null,
                        manufacturer_date_type: sourceItem.manufacturerDateType || 'unlabeled',
                        received_date: sourceItem.receivedDate ?? null,
                        opened_date: sourceItem.openedDate ?? null,
                        memo: sourceItem.notes ?? null,
                        remaining_percent: sourceItem.remaining_percent ?? null,
                        created_at: '',
                        updated_at: '',
                        _source: 'inventory',
                    });
                } catch (rollbackError) {
                    console.error('Failed to rollback copied inventory row:', rollbackError);
                }
            }

            setCopyToastMessage(t('cabinet_copy_failed'));
        } finally {
            setIsCopying(false);
        }
    };

    const handleClose = () => {
        if (showDisposalView) {
            setShowDisposalView(false);
            setSelectedReason(null);
        } else {
            setSelectedReagentId(null);
        }
    };

    const handleCheckDisposalGuide = async () => {
        const query = casNo || name;
        if (!query) return;

        setIsAnalyzing(true);
        try {
            const chemicalData = await searchChemical(query);
            if (chemicalData) {
                let analysis = analyzeChemical(chemicalData);
                if (analysis.category === 'UNKNOWN' &&
                    analysis.materialProfile?.kind !== 'possible_ionic_organic_material') {
                    const aiResult = await classifyChemicalWithAI(chemicalData);
                    if (aiResult) {
                        analysis = { ...analysis, ...aiResult };
                    }
                }
                setAnalysisResult(analysis);
            } else {
                setAnalysisResult({
                    chemical: { id: '', name: name || query, casNumber: casNo, molecularFormula: '', molecularWeight: 0, properties: { isOrganic: false, isHalogenated: false } },
                    category: 'UNKNOWN',
                    isSafe: false,
                    reason: 'reason_unknown',
                    binColor: 'bg-gray-400',
                    label: 'mix_label_unknown'
                });
            }
        } catch (error) {
            console.error('Failed to analyze chemical:', error);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const translateAuditKey = (key: string): string => {
        const keyMap: Record<string, string> = {
            'remaining_percent': t('inventory_remaining_amount', '잔량'),
            'name': t('inventory_name', '이름'),
            'brand': t('inventory_brand', '브랜드'),
            'product_number': t('inventory_product_number', '카탈로그 번호'),
            'cas_no': 'CAS',
            'cas_number': 'CAS',
            'capacity': t('inventory_capacity', '규격'),
            'manufacturer_date_type': t('manufacturer_date_type_label'),
            'expiry_date': t('manufacturer_date_label'),
            'received_date': t('inventory_received_date'),
            'opened_date': t('inventory_opened_date'),
            'memo': t('inventory_memo', '메모'),
            'notes': t('inventory_memo', '메모'),
            'quantity': t('inventory_quantity', '수량'),
            'storage_location_id': t('inventory_location', '보관 위치'),
            'cabinet_id': t('inventory_cabinet', '보관함'),
            'storage_type': t('inventory_storage_type', '보관 방식')
        };
        return keyMap[key] || key;
    };

    const panelClassName = variant === 'desktop-aside'
        ? 'relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-none border-0 bg-white shadow-none dark:bg-slate-900'
        : 'absolute left-1/2 top-2 z-30 flex max-h-[calc(100%-4.5rem)] w-[calc(100%-32px)] max-w-[320px] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur animate-in slide-in-from-bottom duration-200 dark:border-slate-700 dark:bg-slate-900/95 dark:shadow-black/40';
    const labelClassName = 'text-xs font-medium text-slate-600 dark:text-slate-300';
    const iconLabelClassName = `${labelClassName} flex items-center gap-1`;
    const inputClassName = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500';
    const inputMonoClassName = `${inputClassName} font-mono`;

    return (
        <>
            <div
                ref={panelRef}
                className={panelClassName}
                role="dialog"
                aria-modal="true"
                aria-labelledby="reagent-edit-panel-title"
                tabIndex={-1}
            >
                {/* Header */}
                <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/95">
                    <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
                        {showDisposalView ? (
                            <>
                                <Trash2 size={18} className="text-red-500" />
                                <span id="reagent-edit-panel-title">{t('cabinet_dispose_reason_title')}</span>
                            </>
                        ) : (
                            <>
                                <Beaker size={18} className="text-blue-500" />
                                <span id="reagent-edit-panel-title">{t('cabinet_edit_title')}</span>
                            </>
                        )}
                    </div>
                    <button
                        onClick={handleClose}
                        type="button"
                        aria-label={t('btn_close')}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                        <X size={18} />
                    </button>
                </div>

                {showDisposalView ? (
                    <>
                        {/* Disposal Reason Selection */}
                        <div className="p-3 flex flex-col gap-2 overflow-y-auto">
                            <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-medium text-slate-700 dark:text-slate-200">{selectedItem.name}</span> — {t('cabinet_dispose_reason_desc')}
                            </p>
                            {disposalReasons.map(reason => (
                                <button
                                    key={reason.key}
                                    onClick={() => {
                                        setSelectedReason(reason.key);
                                        setDisposalError(null);
                                    }}
                                    className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-all ${selectedReason === reason.key
                                        ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-blue-300 dark:border-blue-500/70 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-500/40'
                                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-700'
                                        }`}
                                >
                                    <span className="text-base">{reason.icon}</span>
                                    <span className="font-medium">{t(reason.i18n)}</span>
                                    {selectedReason === reason.key && (
                                        <CheckCircle2 size={16} className="ml-auto text-blue-500" />
                                    )}
                                </button>
                            ))}
                            {selectedReason && (
                                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    {t(selectedReason === 'used' || selectedReason === 'empty_container'
                                        ? 'cabinet_usage_complete_notice'
                                        : selectedReason === 'contaminated_container'
                                            ? 'cabinet_contaminated_container_notice'
                                            : 'cabinet_waste_batch_notice')}
                                </p>
                            )}
                        </div>

                        {/* Disposal Confirm Button */}
                        <div className="shrink-0 border-t border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                            {disposalError && (
                                <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-200">
                                    {disposalError}
                                </p>
                            )}
                            <button
                                onClick={confirmDisposal}
                                disabled={!selectedReason || isDisposing}
                                type="button"
                                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {selectedReason === 'used' || selectedReason === 'empty_container'
                                    ? <CheckCircle2 size={16} />
                                    : <FlaskConical size={16} />}
                                {isDisposing
                                    ? t('cabinet_processing')
                                    : t(selectedReason === 'used' || selectedReason === 'empty_container'
                                        ? 'cabinet_action_usage_complete'
                                        : 'cabinet_action_continue_waste_batch')}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        {/* Scrollable Content */}
                        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-slate-800 dark:text-slate-100">
                            {/* Expiry Alert Banner — shown at top only for urgent states */}
                            {expiryStatus && (expiryStatus.level === 'expired' || expiryStatus.level === 'critical' || expiryStatus.level === 'warning') && (
                                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${
                                    expiryStatus.level === 'expired'
                                        ? 'bg-red-100 text-red-700 border border-red-200 animate-pulse'
                                        : expiryStatus.level === 'critical'
                                            ? 'bg-red-50 text-red-600 border border-red-200 animate-pulse'
                                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}>
                                    <CalendarClock size={14} className="shrink-0" />
                                    <span>{t(expiryStatus.labelKey, expiryStatus.labelParams)}</span>
                                </div>
                            )}

                            {/* Info Read-only */}
                            <div className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
                                <div className="flex justify-between items-center">
                                    <span>{t('cabinet_label_location')}</span>
                                    <span className="flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
                                        <MapPin size={10} />
                                        {t('cabinet_shelf_level', { level: selectedItem.shelfLevel + 1 })}
                                        {' · '}
                                        {selectedItem.position <= 15 ? t('cabinet_pos_left')
                                            : selectedItem.position <= 35 ? t('cabinet_pos_center_left')
                                                : selectedItem.position <= 65 ? t('cabinet_pos_center')
                                                    : selectedItem.position <= 85 ? t('cabinet_pos_center_right')
                                                        : t('cabinet_pos_right')}
                                    </span>
                                </div>
                            </div>

                            {/* Name Input */}
                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                    <label className={labelClassName}>{t('cabinet_reagent_name')}</label>
                                    <button
                                        type="button"
                                        onClick={handleCheckDisposalGuide}
                                        disabled={isAnalyzing}
                                        className="text-[11px] px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-medium flex items-center gap-1 transition-colors shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
                                    >
                                        {isAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <BookOpen size={12} />}
                                        {isAnalyzing ? t('analyzing_guide', '가이드 불러오는 중...') : t('btn_check_disposal_guide', '폐기가이드 확인')}
                                    </button>
                                </div>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => {
                                        casSuggestion.markNameInputChanged();
                                        setName(e.target.value);
                                    }}
                                    onBlur={casSuggestion.triggerLookupFromBlur}
                                    className={inputClassName}
                                    placeholder={t('cabinet_placeholder_name')}
                                />
                            </div>

                            {/* Brand & Product Number Row */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex flex-col gap-1.5">
                                    <label className={iconLabelClassName}>
                                        <Package size={11} />
                                        {t('inventory_brand')}
                                    </label>
                                    <input
                                        type="text"
                                        value={brand}
                                        onChange={(e) => setBrand(e.target.value)}
                                        className={inputClassName}
                                        placeholder={t('inventory_brand_placeholder')}
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label className={iconLabelClassName}>
                                        <Tag size={11} />
                                        {t('inventory_product_number')}
                                    </label>
                                    <input
                                        type="text"
                                        value={productNumber}
                                        onChange={(e) => setProductNumber(e.target.value)}
                                        className={inputMonoClassName}
                                        placeholder={t('inventory_pn_placeholder')}
                                    />
                                </div>
                            </div>


                            {/* Capacity & CAS Number Row */}
                            <div className="flex flex-col gap-0.5">
                                <div className="grid grid-cols-2 gap-2">
                                    {/* Capacity Input */}
                                    <div className="flex flex-col gap-1.5">
                                        <label className={iconLabelClassName}>
                                            <Beaker size={12} />
                                            {t('inventory_capacity')}
                                        </label>
                                        <input
                                            type="text"
                                            value={capacity}
                                            onChange={(e) => setCapacity(e.target.value)}
                                            className={inputClassName}
                                            placeholder={t('inventory_capacity_placeholder')}
                                        />
                                    </div>
                                    {/* CAS Number Input */}
                                    <div className="flex flex-col gap-1.5">
                                        <label className={iconLabelClassName}>
                                            <FlaskConical size={12} />
                                            {t('inventory_cas_number')}
                                        </label>
                                        <input
                                            type="text"
                                            value={casNo}
                                            onChange={(e) => setCasNo(e.target.value)}
                                            onFocus={casSuggestion.triggerLookupFromCasFocus}
                                            className={inputMonoClassName}
                                            placeholder={t('inventory_cas_placeholder')}
                                        />
                                    </div>
                                </div>
                                {casSuggestion.shouldRenderCard && (
                                    <CasSuggestionCard
                                        state={
                                            casSuggestion.state === 'checking'
                                                ? 'checking'
                                                : casSuggestion.state === 'suggestion'
                                                    ? 'suggestion'
                                                    : casSuggestion.state === 'applied'
                                                        ? 'applied'
                                                        : 'unavailable'
                                        }
                                        suggestion={casSuggestion.state === 'applied' ? casSuggestion.appliedSuggestion : casSuggestion.suggestion}
                                        inputName={name}
                                        onApply={casSuggestion.applySuggestion}
                                        onDismiss={async () => {
                                            if (casSuggestion.suggestion?.casNumber) {
                                                await analyticsService.trackCasSuggestionDismissed({
                                                    sourceScreen: 'reagent_edit_panel',
                                                    storageType: 'cabinet',
                                                    sourceItemType: 'cabinet_item',
                                                    sourceItemId: selectedReagentId,
                                                    chemicalName: name,
                                                    casNumber: casSuggestion.suggestion.casNumber,
                                                    metadata: {
                                                        confidence: casSuggestion.suggestion.confidence,
                                                        sources: casSuggestion.suggestion.sources,
                                                    },
                                                });
                                            }
                                            casSuggestion.dismissSuggestion();
                                        }}
                                        onUndo={casSuggestion.undoAppliedSuggestion}
                                    />
                                )}
                                {casNo && (
                                    <p className="mt-1 pl-1 text-[10px] text-slate-400 dark:text-slate-500">
                                        {t('cabinet_pubchem_auto_enrich')}
                                    </p>
                                )}
                            </div>

                            {/* Remaining Amount Input */}
                            <div className="flex flex-col gap-2 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                    <Beaker size={12} className="text-blue-500" />
                                    {t('inventory_remaining_amount', '잔량')}
                                </label>
                                <div className="flex gap-1.5">
                                    {[
                                        { level: 1, stage: 1, percent: 5, color: 'bg-red-500' },
                                        { level: 1, stage: 2, percent: 30, color: 'bg-orange-500' },
                                        { level: 2, stage: 3, percent: 60, color: 'bg-blue-500' },
                                        { level: 2, stage: 4, percent: 100, color: 'bg-emerald-500' }
                                    ].map((item) => {
                                        const isSelected = (item.stage === 1 && remainingPercent <= 10) ||
                                            (item.stage === 2 && remainingPercent > 10 && remainingPercent <= 30) ||
                                            (item.stage === 3 && remainingPercent > 30 && remainingPercent <= 70) ||
                                            (item.stage === 4 && remainingPercent > 70);

                                        return (
                                            <button
                                                key={item.stage}
                                                type="button"
                                                onClick={() => setRemainingPercent(item.percent)}
                                                className={`flex-1 flex flex-col items-center gap-1 py-1.5 px-0.5 rounded-md border transition-all ${isSelected
                                                    ? 'bg-blue-600 border-blue-600 shadow-md transform scale-105 z-10'
                                                    : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500 hover:border-blue-400'
                                                    }`}
                                            >
                                                <div className="relative w-full h-1 rounded-full bg-gray-300 dark:bg-gray-600 mb-0.5">
                                                    <div
                                                        className={`absolute left-0 top-0 h-full rounded-full transition-all duration-300 ${isSelected ? 'bg-white' :
                                                                item.stage === 1 ? 'bg-red-500' :
                                                                    item.stage === 2 ? 'bg-orange-500' :
                                                                        item.stage === 3 ? 'bg-blue-500' : 'bg-emerald-500'
                                                            }`}
                                                        style={{ width: `${item.percent}%` }}
                                                    />
                                                </div>
                                                <span className={`text-[9px] font-bold whitespace-nowrap ${isSelected ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                                                    {t(`inventory_remaining_stage_${item.stage}_label`)}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 h-3">
                                    {(remainingPercent !== undefined) && (
                                        <>
                                            {remainingPercent <= 10 && t('inventory_remaining_stage_1_desc')}
                                            {remainingPercent > 10 && remainingPercent <= 30 && t('inventory_remaining_stage_2_desc')}
                                            {remainingPercent > 30 && remainingPercent <= 70 && t('inventory_remaining_stage_3_desc')}
                                            {remainingPercent > 70 && t('inventory_remaining_stage_4_desc')}
                                        </>
                                    )}
                                </p>
                            </div>

                            {/* Container Type Selection */}
                            <div className="flex flex-col gap-1.5">
                                <label className={iconLabelClassName}>
                                    {t('cabinet_label_type')}
                                </label>
                                <div className="grid grid-cols-4 gap-1.5">
                                    {CONTAINER_TYPES.map((ct) => (
                                        <button
                                            key={ct.type}
                                            onClick={() => {
                                                setTemplate(ct.type);
                                                if (template !== ct.type) {
                                                    setWidth(CONTAINER_BASE_WIDTHS[ct.type] || 8);
                                                }
                                            }}
                                            className={`flex items-center justify-center px-1.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all min-h-[44px] ${template === ct.type
                                                ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-blue-300 dark:border-blue-500 dark:bg-blue-500/20 dark:text-blue-200 dark:ring-blue-500/40'
                                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-700'
                                                }`}
                                        >
                                            <span className="leading-tight text-center">{t(ct.label)}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Container Size (Width) Input */}
                            <div className="flex flex-col gap-1.5">
                                <label className={iconLabelClassName}>
                                    {t('cabinet_container_size', '용기 크기')}
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="range"
                                        min="2"
                                        max="30"
                                        step="0.5"
                                        value={width}
                                        onChange={(e) => setWidth(parseFloat(e.target.value))}
                                        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-slate-200 accent-blue-500 dark:bg-slate-700"
                                    />
                                    <span className="w-8 text-right text-xs text-slate-500 dark:text-slate-400">{width}</span>
                                </div>
                            </div>



                            <ReagentDateFields
                                value={{
                                    manufacturer_date_type: manufacturerDateType,
                                    expiry_date: expiryDate,
                                    received_date: receivedDate,
                                    opened_date: openedDate,
                                }}
                                onChange={(next) => {
                                    setManufacturerDateType(next.manufacturer_date_type);
                                    setExpiryDate(next.expiry_date);
                                    setReceivedDate(next.received_date);
                                    setOpenedDate(next.opened_date);
                                }}
                                labelClassName={labelClassName}
                                inputClassName={inputClassName}
                                columnsClassName="grid grid-cols-1 gap-3"
                            />
                            {expiryStatus && (
                                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md w-fit ${getExpiryBadgeClasses(expiryStatus.level)}`}>
                                    {t(expiryStatus.labelKey, expiryStatus.labelParams)}
                                </span>
                            )}

                            {/* Notes Input */}
                            <div className="flex flex-col gap-1.5">
                                <label className={labelClassName}>{t('cabinet_notes')}</label>
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    rows={2}
                                    className={`${inputClassName} resize-none`}
                                    placeholder={t('cabinet_placeholder_notes')}
                                />
                            </div>

                            {/* Storage Compatibility Section */}
                            {(() => {
                                const storageClassification = classifyStoragePlacement(selectedItem);
                                const storageGroups = storageClassification.groups;
                                const groupLabels = getStorageGroupLabels(storageGroups);
                                const currentShelf = shelves.find(s => s.items.some(i => i.id === selectedReagentId));
                                const shelfWarnings = currentShelf ? checkShelfCompatibility(currentShelf.items).filter(
                                    w => w.itemA === selectedItem.name || w.itemB === selectedItem.name
                                ) : [];
                                const visibleShelfWarnings = isStorageWarningsExpanded
                                    ? shelfWarnings
                                    : shelfWarnings.slice(0, STORAGE_WARNING_PREVIEW_LIMIT);
                                const hiddenShelfWarningCount = Math.max(0, shelfWarnings.length - STORAGE_WARNING_PREVIEW_LIMIT);

                                if (groupLabels.length === 0 && shelfWarnings.length === 0 && !storageClassification.needsReview) return null;

                                return (
                                    <div className="flex flex-col gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                                        {/* Storage Group Tags */}
                                        {groupLabels.length > 0 && (
                                            <div className="flex flex-col gap-1">
                                                <label className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                    {t('cabinet_storage_group')}
                                                </label>
                                                <div className="flex flex-wrap gap-1">
                                                    {groupLabels.map(key => (
                                                        <span key={key} className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                                            {t(key)}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Shelf Compatibility Warnings */}
                                        {shelfWarnings.length > 0 && (
                                            <div className="flex flex-col gap-1.5">
                                                {visibleShelfWarnings.map((w, i) => {
                                                    const isDanger = w.severity === 'DANGER';
                                                    const otherName = w.itemA === selectedItem.name ? w.itemB : w.itemA;
                                                    return (
                                                        <div
                                                            key={`${w.ruleId}-${i}`}
                                                            className={`flex items-start gap-1.5 p-2 rounded-lg text-[11px] leading-relaxed ${isDanger
                                                                ? 'bg-red-50 text-red-700 border border-red-200 dark:border-red-500/40 dark:bg-red-950/35 dark:text-red-200'
                                                                : 'bg-amber-50 text-amber-700 border border-amber-200 dark:border-amber-500/40 dark:bg-amber-950/35 dark:text-amber-200'
                                                                }`}
                                                        >
                                                            <AlertTriangle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isDanger ? 'text-red-500' : 'text-amber-500'}`} />
                                                            <div>
                                                                <span className={`font-bold mr-1 ${isDanger ? 'text-red-600 dark:text-red-300' : 'text-amber-600 dark:text-amber-300'}`}>
                                                                    {isDanger ? t('storage_compat_danger') : t('storage_compat_warning')}
                                                                </span>
                                                                <span className="font-semibold">{otherName}</span>
                                                                <span className="mx-1">—</span>
                                                                <span>{t(w.messageKey)}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                {hiddenShelfWarningCount > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsStorageWarningsExpanded(current => !current)}
                                                        className="mt-0.5 flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                                                    >
                                                        {isStorageWarningsExpanded ? (
                                                            <ChevronUp className="h-3.5 w-3.5" />
                                                        ) : (
                                                            <ChevronDown className="h-3.5 w-3.5" />
                                                        )}
                                                        {isStorageWarningsExpanded
                                                            ? t('cabinet_storage_warnings_collapse')
                                                            : t('cabinet_storage_warnings_show_more', { count: hiddenShelfWarningCount })}
                                                    </button>
                                                )}
                                            </div>
                                        )}

                                        {storageClassification.needsReview && (
                                            <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/35 dark:text-amber-200">
                                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                                                <span>{t('cabinet_storage_review_required')}</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* Change History Section */}
                            <div className="mt-2 pt-4 border-t border-slate-200 dark:border-slate-700">
                                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2.5 flex items-center gap-2">
                                    <History className="w-3.5 h-3.5" /> {t('history_log', '변경 이력')}
                                </h3>
                                {isLoadingLogs ? (
                                    <div className="flex justify-center p-3">
                                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                                    </div>
                                ) : auditLogs.length === 0 ? (
                                    <p className="text-[10px] text-slate-500 text-center py-1">{t('log_empty', '기록이 없습니다.')}</p>
                                ) : (
                                    <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1 scrollbar-thin">
                                        {auditLogs.map(log => (
                                            <div key={log.id} className="bg-slate-50 dark:bg-slate-800/80 p-2 rounded border border-slate-100 dark:border-slate-700 text-[10px] text-slate-600 dark:text-slate-300">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className={`font-semibold px-1 py-0.5 rounded text-[9px] ${log.action === 'create' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
                                                        log.action === 'update' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' :
                                                            'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
                                                        }`}>
                                                        {log.action === 'update' ? t('log_action_update', '수정') : log.action === 'create' ? t('log_action_create', '등록') : log.action}
                                                    </span>
                                                    <span className="text-[9px] text-slate-400">
                                                        {new Date(log.created_at).toLocaleString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US', {
                                                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                                        })}
                                                    </span>
                                                </div>
                                                {log.actor_name && <div className="text-[9px] text-slate-400 mt-0.5">{t('log_handler_label', '작업자')}: {log.actor_name}</div>}
                                                {log.diff_data && Object.keys(log.diff_data).length > 0 && (
                                                    <div className="mt-1 flex flex-col gap-0.5 border-t border-slate-200/50 dark:border-slate-700/50 pt-1">
                                                        {Object.entries(log.diff_data).map(([k, v]: [string, { from: unknown; to: unknown }]) => (
                                                            <div key={k} className="flex gap-1 items-center overflow-hidden">
                                                                <span className="text-slate-400 w-16 shrink-0 truncate">{translateAuditKey(k)}:</span>
                                                                <span className="line-through text-red-500/70 truncate max-w-[40px]">{JSON.stringify(v.from)}</span>
                                                                <span className="text-slate-400 shrink-0">→</span>
                                                                <span className="text-emerald-600 dark:text-emerald-400 truncate flex-1">{JSON.stringify(v.to)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer Actions */}
                        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                            <button
                                onClick={handleDeleteClick}
                                disabled={isSaving || isCopying}
                                className="flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                            >
                                <Trash2 size={16} />
                                {t('cabinet_delete')}
                            </button>
                            <button
                                onClick={handleCopy}
                                disabled={isSaving || isCopying}
                                className="flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                {isCopying ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
                                {t('cabinet_copy')}
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving || isCopying}
                                className="flex-1 px-3.5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                {isSaving ? t('cabinet_processing') : t('cabinet_save')}
                            </button>
                        </div>
                    </>
                )}
            </div>

            {copyToastMessage && (
                <div className="absolute left-1/2 top-4 -translate-x-1/2 z-40 px-3 py-2 rounded-lg bg-slate-900/90 text-white text-xs font-medium shadow-lg">
                    {copyToastMessage}
                </div>
            )}

            {/* Disposal Guide Modal overlay */}
            {analysisResult && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
                    <div
                        ref={analysisDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="reagent-disposal-guide-title"
                        tabIndex={-1}
                        className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95"
                    >
                        <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-gray-50 dark:bg-slate-800/50">
                            <h3
                                id="reagent-disposal-guide-title"
                                className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2"
                            >
                                <BookOpen className="w-5 h-5 text-blue-500" />
                                {t('btn_check_disposal_guide', '폐기가이드 확인')}
                            </h3>
                            <button
                                ref={analysisDialogCloseRef}
                                onClick={() => setAnalysisResult(null)}
                                type="button"
                                aria-label={t('btn_close')}
                                className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-slate-700 dark:hover:text-gray-300"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4 max-h-[80vh] overflow-y-auto">
                            <ResultCard
                                result={analysisResult}
                                onReset={() => setAnalysisResult(null)}
                                secondaryBtnText={t('btn_close', '닫기')}
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
