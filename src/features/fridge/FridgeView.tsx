import React, { lazy, Suspense, useState, useEffect } from 'react';
import { ReagentEditPanel } from './ReagentEditPanel';
import { useFridgeStore } from '../../store/fridgeStore';
import { Box, ChevronDown, ChevronUp, Layers, Minus, Plus, Ratio, SplitSquareVertical, ArrowLeft, Save, Loader2, ScanLine, CheckCircle2, ShieldAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CustomDialog } from '../../components/CustomDialog';
import { CameraCaptureModal, type CameraCaptureQueueItem } from './components/CameraCaptureModal';
import { scanReagentLabel, type ReagentScanResult } from '../../services/geminiReagentScanService';
import { analyticsService } from '../../services/analyticsService';
import { cabinetService } from '../../services/cabinetService';
import { inventoryService } from '../../services/inventoryService';
import { StorageCompatBanner } from './components/StorageCompatBanner';
import { CabinetAutoLayoutPreviewModal } from './components/CabinetAutoLayoutPreviewModal';
import { CasSuggestionCard } from '../../components/CasSuggestionCard';
import { supabase } from '../../services/supabaseClient';
import { OnboardingGuideCard } from '../../components/onboarding/OnboardingGuideCard';
import { useOnboardingStore } from '../../store/useOnboardingStore';
import { getSuggestedCasInputMethod, useCasSuggestion } from '../../hooks/useCasSuggestion';

import type { ReagentTemplateType } from '../../types/fridge';
import { normalizeTemplateFromDb } from '../../utils/normalizeTemplateFromDb';
import { checkCabinetCompatibility } from '../../utils/storageCompatibilityChecker';

const FridgeScene = lazy(() =>
    import('./FridgeScene').then((module) => ({ default: module.FridgeScene }))
);
const ReagentModelPreview = lazy(() => import('./components/ReagentModelPreview'));

const SceneLoadingFallback = () => (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80">
        <div className="rounded-xl border border-slate-200 bg-white/90 p-3 text-slate-600 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        </div>
    </div>
);

const ReagentPreviewFallback = ({ width, height }: { width: number; height: number }) => (
    <div
        className="flex items-center justify-center rounded-md bg-slate-100 text-slate-400"
        style={{ width, height }}
        aria-hidden="true"
    >
        <Loader2 className="h-4 w-4 animate-spin" />
    </div>
);

export interface FridgeViewProps {
    cabinetId: string;
    onBack?: () => void;
}

interface GenericContainerItem {
    name: string;
    type: ReagentTemplateType;
    color: string;
    width: number;
    chemicalData: {
        name: string;
    };
}

const NumberInput = ({ value, min, max, onChange, className }: { value: number; min: number; max: number; onChange: (v: number) => void; className?: string }) => {
    const [localVal, setLocalVal] = React.useState(value.toString());
    React.useEffect(() => { setLocalVal(value.toString()); }, [value]);

    const apply = () => {
        let v = parseInt(localVal, 10);
        if (Number.isNaN(v)) {
            setLocalVal(value.toString());
        } else {
            v = Math.max(min, Math.min(max, v));
            setLocalVal(v.toString());
            onChange(v);
        }
    };

    return (
        <input
            type="number"
            min={min}
            max={max}
            step={1}
            value={localVal}
            onChange={e => setLocalVal(e.target.value)}
            onBlur={apply}
            onKeyDown={e => {
                if (e.key === 'Enter') {
                    e.currentTarget.blur();
                }
            }}
            className={className}
        />
    );
};

export const FridgeView: React.FC<FridgeViewProps> = ({ cabinetId, onBack }) => {
    const { t, i18n } = useTranslation();
    const showOnboardingGuide = useOnboardingStore((state) => state.hasCompletedWelcome && !state.hasSkippedOnboarding && !state.seenGuides.cabinetDetail);
    const markGuideSeen = useOnboardingStore((state) => state.markGuideSeen);
    const [verticalPanelPos, setVerticalPanelPos] = useState(50);
    const [isEditPanelVisible, setIsEditPanelVisible] = useState(false);
    const [isReagentTrayVisible, setIsReagentTrayVisible] = useState(false);
    const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
    const [isClearSecondConfirmOpen, setIsClearSecondConfirmOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    // 'idle' | 'saving' | 'saved'
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
    const savedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // Naming / Size Configuration Modal State
    const [placementName, setPlacementName] = useState('');
    const [placementMemo, setPlacementMemo] = useState('');
    const [placementSize, setPlacementSize] = useState<number>(1.0); // 0.8 (S), 1.0 (M), 1.2 (L)
    const [placementCapacity, setPlacementCapacity] = useState('');
    const [placementExpiry, setPlacementExpiry] = useState('');
    const [placementBrand, setPlacementBrand] = useState('');
    const [placementProductNumber, setPlacementProductNumber] = useState('');
    const [placementCas, setPlacementCas] = useState('');
    const [placementRemainingPercent, setPlacementRemainingPercent] = useState<number>(100);

    // Scan & Auto-Place State
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [scanQueueItems, setScanQueueItems] = useState<CameraCaptureQueueItem[]>([]);
    const scanPendingTasksRef = React.useRef<{ id: string; imageSrc: string }[]>([]);
    const scanActiveCountRef = React.useRef(0);
    const scanPlacementQueueRef = React.useRef<Promise<void>>(Promise.resolve());
    const [isScanning, setIsScanning] = useState(false);
    const [scanResult, setScanResult] = useState<ReagentScanResult | null>(null);
    const [scanDialogOpen, setScanDialogOpen] = useState(false);
    const [scanName, setScanName] = useState('');
    const [scanCas, setScanCas] = useState('');
    const [scanContainerType, setScanContainerType] = useState<ReagentTemplateType>('A');
    const [scanSize, setScanSize] = useState<number>(1.0);
    const [scanCapacity, setScanCapacity] = useState('');
    const [scanExpiry, setScanExpiry] = useState('');
    const [scanMemo, setScanMemo] = useState('');
    const [scanBrand, setScanBrand] = useState('');
    const [scanProductNumber, setScanProductNumber] = useState('');
    const [scanRemainingPercent, setScanRemainingPercent] = useState<number>(100);

    // Toast state
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [isCoarsePointer, setIsCoarsePointer] = useState(false);
    const [storageCompatBannerReopenToken, setStorageCompatBannerReopenToken] = useState(0);
    const [isCompatibilityPreviewVisible, setIsCompatibilityPreviewVisible] = useState(false);

    // 모바일: 시약 내려놓은 직후 발생하는 합성 클릭(ghost click)으로 백드롭이 눌리는 것 방지
    const placementModalOpenedAtRef = React.useRef<number>(0);
    /** 시약 정보 입력 모달: 이름 입력란 — 모달 열릴 때 자동 포커스해 ghost click 흡수 */
    const placementNameInputRef = React.useRef<HTMLInputElement>(null);

    const {
        mode,
        setMode,
        addShelf,
        removeShelf,
        addVerticalPanel,
        removeVerticalPanel,
        shelves,
        setDraggedTemplate,
        draggedTemplate,
        cabinetWidth,
        cabinetHeight,
        cabinetDepth,
        cabinetAspectRatio,
        setCabinetDimensions,
        setCabinetDepth,
        setCabinetAspectRatio,
        setFocusedShelfId,
        sortShelves,
        loadCabinet,
        saveCabinet,
        cabinetName,
        isLoadingCabinet,
        clearCabinet,
        pendingPlacement,
        setPendingPlacement,
        placeReagent,
        autoPlaceReagent,
        autoPlaceResult,
        clearAutoPlaceResult,
        setHighlightedItemId,
        compatibilityPlanPreview,
        isBuildingCompatibilityPlan,
        isApplyingCompatibilityPlan,
        buildCompatibilityPlan,
        applyCompatibilityPlan,
        clearCompatibilityPlan,
    } = useFridgeStore();

    const [showModalContent, setShowModalContent] = useState(false);
    const placementCasSuggestion = useCasSuggestion({
        enabled: Boolean(pendingPlacement && showModalContent),
        inputName: placementName,
        casNumber: placementCas,
        sourceType: 'fridge_manual_placement',
        brand: placementBrand,
        productNumber: placementProductNumber,
        capacity: placementCapacity,
        onApplyCasNumber: setPlacementCas,
    });
    const scanCasSuggestion = useCasSuggestion({
        enabled: scanDialogOpen && !isScanning,
        inputName: scanName,
        casNumber: scanCas,
        sourceType: 'fridge_scan_placement',
        brand: scanBrand,
        productNumber: scanProductNumber,
        capacity: scanCapacity,
        onApplyCasNumber: setScanCas,
    });
    const storageCompatWarningMap = React.useMemo(() => checkCabinetCompatibility(shelves), [shelves]);
    const storageCompatWarningCount = React.useMemo(() => {
        let count = 0;
        storageCompatWarningMap.forEach((warnings) => {
            count += warnings.length;
        });
        return count;
    }, [storageCompatWarningMap]);

    // 시약 정보 입력 모달 렌더링 지연 (모바일 고스트 클릭 방지용)
    React.useEffect(() => {
        if (!pendingPlacement) {
            setShowModalContent(false);
            return;
        }
        placementModalOpenedAtRef.current = Date.now();
        const t = setTimeout(() => setShowModalContent(true), 300);
        return () => clearTimeout(t);
    }, [pendingPlacement]);

    React.useEffect(() => {
        if (!cabinetId) return;

        let reloadTimeout: ReturnType<typeof setTimeout>;
        let isDisposed = false;
        let isReloading = false;
        let hasPendingReload = false;

        const runReload = async () => {
            if (isDisposed) return;
            if (isReloading) {
                hasPendingReload = true;
                return;
            }

            isReloading = true;
            try {
                await loadCabinet(cabinetId);
            } finally {
                isReloading = false;
                if (hasPendingReload && !isDisposed) {
                    hasPendingReload = false;
                    void runReload();
                }
            }
        };

        void runReload();

        const handleChange = () => {
            const currentMode = useFridgeStore.getState().mode;
            // 편집 모드나 배치 모드 중일 때는 사용자 작업을 방해하지 않기 위해 자동 새로고침을 건너뜁니다.
            if (currentMode === 'EDIT' || currentMode === 'PLACE') return;

            clearTimeout(reloadTimeout);
            // 여러 변경 이벤트가 동시에 발생할 수 있으므로 디바운스 처리
            reloadTimeout = setTimeout(() => {
                void runReload();
            }, 500);
        };

        const channel = supabase.channel(`cabinet_realtime_${cabinetId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_items', filter: `cabinet_id=eq.${cabinetId}` }, handleChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_shelves', filter: `cabinet_id=eq.${cabinetId}` }, handleChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinets', filter: `id=eq.${cabinetId}` }, handleChange)
            .subscribe();

        return () => {
            isDisposed = true;
            supabase.removeChannel(channel);
            clearTimeout(reloadTimeout);
        };
    }, [cabinetId, loadCabinet]);

    // Auto-place result toast
    useEffect(() => {
        if (autoPlaceResult) {
            setToastMessage(
                t('reagent_placed_toast', {
                    name: autoPlaceResult.reagentName,
                    level: autoPlaceResult.shelfLevel,
                })
            );
            const timer = setTimeout(() => {
                setToastMessage(null);
                clearAutoPlaceResult();
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [autoPlaceResult, clearAutoPlaceResult, t]);

    useEffect(() => {
        if (!toastMessage) return;
        const timer = setTimeout(() => setToastMessage(null), 4000);
        return () => clearTimeout(timer);
    }, [toastMessage]);

    useEffect(() => {
        if (compatibilityPlanPreview) {
            setIsCompatibilityPreviewVisible(true);
            return;
        }
        setIsCompatibilityPreviewVisible(false);
    }, [compatibilityPlanPreview]);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mediaQuery = window.matchMedia('(pointer: coarse)');
        const syncPointerType = () => {
            const hasTouchSupport = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
            const isMobileViewport = window.innerWidth <= 768;
            setIsCoarsePointer(mediaQuery.matches || (hasTouchSupport && isMobileViewport));
        };
        syncPointerType();

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', syncPointerType);
            window.addEventListener('resize', syncPointerType);
            return () => {
                mediaQuery.removeEventListener('change', syncPointerType);
                window.removeEventListener('resize', syncPointerType);
            };
        }

        mediaQuery.addListener(syncPointerType);
        window.addEventListener('resize', syncPointerType);
        return () => {
            mediaQuery.removeListener(syncPointerType);
            window.removeEventListener('resize', syncPointerType);
        };
    }, []);

    // 자동저장 헬퍼 — 모든 상태 변경 후 호출
    const autoSave = React.useCallback(async () => {
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        setSaveStatus('saving');
        try {
            await useFridgeStore.getState().saveCabinet();
            setSaveStatus('saved');
            savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
        } catch (err) {
            console.error('Auto-save failed:', err);
            setSaveStatus('idle');
        }
    }, []);

    // 수동 저장 (헤더 버튼)
    const handleSave = async () => {
        setIsSaving(true);
        try {
            await saveCabinet();
            setSaveStatus('saved');
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
            savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
        } finally {
            setIsSaving(false);
        }
    };

    const handleClearCabinet = async () => {
        // 전체비우기 전에 현재 아이템 목록 수집
        const state = useFridgeStore.getState();
        const currentCabinetId = state.cabinetId;
        const allItems = state.shelves.flatMap(s => s.items);

        clearCabinet();
        setIsClearConfirmOpen(false);
        setIsClearSecondConfirmOpen(false);

        // 로그 및 DB 동기화 (비동기, 실패해도 UI에 영향 없음)
        if (currentCabinetId) {
            try {
                await saveCabinet(); // 먼저 DB에 빈 상태 반영
                
                // 연결된 재고 항목 삭제 및 폐기 로그 기록 (allItems가 없어도 DB에서 cabinet_id로 삭제함)
                await inventoryService.clearCabinetInventory(currentCabinetId, allItems);
                
                if (allItems.length > 0) {
                    const names = allItems.map(i => i.name).join(', ');
                    await cabinetService.logActivity(
                        currentCabinetId,
                        'clear_all',
                        names.length > 200 ? names.slice(0, 197) + '...' : names
                    );
                }
            } catch (err) {
                console.error('Failed to log clear_all activity:', err);
            }
        }
    };

    const handleClearConfirmStep1 = () => {
        setIsClearConfirmOpen(false);
        setIsClearSecondConfirmOpen(true);
    };

    const handleOpenStorageCompatBanner = () => {
        if (storageCompatWarningCount === 0) return;
        setStorageCompatBannerReopenToken((current) => current + 1);
    };

    const handleNameSort = () => {
        sortShelves('name');
        void autoSave();
    };

    const handleBuildCompatibilityPreview = async () => {
        if (compatibilityPlanPreview) {
            setIsCompatibilityPreviewVisible(true);
            return;
        }

        const preview = await buildCompatibilityPlan();
        if (preview) {
            setIsCompatibilityPreviewVisible(true);
            return;
        }

        if (!preview) {
            setToastMessage(t('cabinet_auto_place_failed'));
        }
    };

    const handleApplyCompatibilityPreview = async () => {
        const applied = await applyCompatibilityPlan();
        if (!applied) {
            setToastMessage(t('cabinet_auto_place_save_failed'));
            return;
        }

        setToastMessage(t('cabinet_auto_place_success'));
        setSaveStatus('saved');
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
    };

    const handleHideCompatibilityPreview = () => {
        setIsCompatibilityPreviewVisible(false);
    };

    const handleCancelCompatibilityPreview = () => {
        handleHideCompatibilityPreview();
        clearCompatibilityPlan();
    };

    const handleFocusCompatibilityIssue = (itemId: string) => {
        const targetItem = shelves.flatMap((shelf) => shelf.items).find((item) => item.id === itemId);
        if (!targetItem) return;

        handleHideCompatibilityPreview();
        setMode('VIEW');
        setHighlightedItemId(itemId);
        setFocusedShelfId(null);

        queueMicrotask(() => {
            setFocusedShelfId(targetItem.shelfId);
        });

        setTimeout(() => {
            if (useFridgeStore.getState().highlightedItemId === itemId) {
                useFridgeStore.getState().setHighlightedItemId(null);
            }
        }, 4000);
    };

    const handleReagentClick = (item: GenericContainerItem) => {
        // 이미 선택된 시약을 다시 클릭하면 선택 취소
        if (draggedTemplate?.name === item.name) {
            setDraggedTemplate(null);
            setIsReagentTrayVisible(true);
            return;
        }
        setDraggedTemplate({
            type: item.type as ReagentTemplateType,
            color: item.color,
            width: item.width,
            height: 1,
            depth: 1,
            name: item.name,
            chemicalData: item.chemicalData
        });
        // 병 선택 후 트레이를 접어 시약장 전체가 보이도록 함 (데스크톱·터치 공통)
        setIsReagentTrayVisible(false);
    };

    const handleClearSelectedReagent = () => {
        setDraggedTemplate(null);
        setIsReagentTrayVisible(true);
    };

    const handleConfirmPlacement = async () => {
        if (!pendingPlacement) return;

        const finalName = placementName.trim() || '이름 없음';
        const memo = placementMemo;
        const placementCasInputMethod = getSuggestedCasInputMethod(
            placementCasSuggestion.isSuggestedCasApplied,
            placementCas.trim() ? 'manual' : 'unknown',
            placementCasSuggestion.appliedSuggestion?.confidence,
        );
        const existingItemIds = new Set(useFridgeStore.getState().shelves.flatMap((shelf) => shelf.items.map((item) => item.id)));
        placeReagent(pendingPlacement.shelfId, {
            id: '',
            reagentId: 'custom-' + Date.now(),
            name: finalName,
            position: pendingPlacement.position,
            depthPosition: pendingPlacement.depthPosition,
            width: pendingPlacement.width * placementSize,
            template: pendingPlacement.template,
            isAcidic: false,
            isBasic: false,
            hCodes: [],
            notes: memo,
            capacity: placementCapacity || undefined,
            expiryDate: placementExpiry || undefined,
            brand: placementBrand || undefined,
            productNumber: placementProductNumber || undefined,
            casNo: placementCas || undefined,
            remaining_percent: placementRemainingPercent,
        });
        const newlyPlacedItemId = useFridgeStore.getState().shelves
            .flatMap((shelf) => shelf.items)
            .find((item) => !existingItemIds.has(item.id))?.id || null;

        // Reset states
        setPendingPlacement(null);
        setPlacementName('');
        setPlacementMemo('');
        setPlacementSize(1.0);
        setPlacementCapacity('');
        setPlacementExpiry('');
        setPlacementBrand('');
        setPlacementProductNumber('');
        setPlacementCas('');
        setPlacementRemainingPercent(100);
        setIsReagentTrayVisible(true);

        // 자동저장 + 활동 로그 (병렬)
        const currentCabinetId = useFridgeStore.getState().cabinetId;
        autoSave();
        if (newlyPlacedItemId) {
            await analyticsService.trackCommerceIntentEvent({
                eventType: 'cabinet_item_placed',
                sourceScreen: 'fridge_view',
                storageType: 'cabinet',
                sourceItemType: 'cabinet_item',
                sourceItemId: newlyPlacedItemId,
                brandName: placementBrand || undefined,
                productNumber: placementProductNumber || undefined,
                quantity: 1,
                capacityText: placementCapacity || undefined,
                casNumber: placementCas || undefined,
                casInputMethod: placementCasInputMethod,
                metadata: {
                    placement_mode: 'manual',
                    shelf_id: pendingPlacement.shelfId,
                },
            });
        }
        if (currentCabinetId) {
            cabinetService.logActivity(currentCabinetId, 'add', finalName, undefined, memo || undefined)
                .catch(err => console.error('Failed to log add activity:', err));
            if (newlyPlacedItemId) {
                await analyticsService.trackStorageWarningIgnoredForItem({
                    cabinetId: currentCabinetId,
                    shelves: useFridgeStore.getState().shelves,
                    relatedItemId: newlyPlacedItemId,
                    sourceScreen: 'fridge_view',
                    triggerSource: 'manual_place',
                });
            }
        }
    };

    const handleCancelPlacement = () => {
        setPendingPlacement(null);
        setPlacementName('');
        setPlacementMemo('');
        setPlacementSize(1.0);
        setPlacementCapacity('');
        setPlacementExpiry('');
        setPlacementBrand('');
        setPlacementProductNumber('');
        setPlacementCas('');
        setPlacementRemainingPercent(100);
        setIsReagentTrayVisible(true);
    };

    // ====== Scan Queue Flow ======
    const updateScanQueueItem = React.useCallback((id: string, updates: Partial<CameraCaptureQueueItem>) => {
        setScanQueueItems((prev) => prev.map((item) => (
            item.id === id ? { ...item, ...updates } : item
        )));
    }, []);

    const autoPlaceScannedReagent = React.useCallback(async (scan: ReagentScanResult, queueItemId: string) => {
        const CONTAINER_BASE_WIDTHS: Record<string, number> = { A: 8, B: 10, C: 8, D: 10 };
        const containerType = normalizeTemplateFromDb(scan.suggestedContainerType);
        const finalName = scan.name?.trim() || t('scan_unknown_reagent');

        const result = autoPlaceReagent({
            id: '',
            reagentId: 'scan-' + Date.now(),
            name: finalName,
            width: CONTAINER_BASE_WIDTHS[containerType] || 8,
            template: containerType,
            isAcidic: false,
            isBasic: false,
            hCodes: [],
            casNo: scan.casNumber || undefined,
            expiryDate: scan.expiryDate || undefined,
            capacity: scan.capacity || undefined,
            brand: scan.brand || undefined,
            productNumber: scan.productNumber || undefined,
            remaining_percent: 100,
        });

        if (!result) {
            throw new Error(t('reagent_no_space'));
        } else {
            // 자동저장 + 스캔 등록 로그 (병렬)
            await autoSave();
            updateScanQueueItem(queueItemId, { status: 'success', label: finalName });
            setToastMessage(t('scan_auto_place_done', { name: finalName }));
            void analyticsService.trackCommerceIntentEvent({
                eventType: 'cabinet_item_scanned',
                sourceScreen: 'fridge_view',
                storageType: 'cabinet',
                sourceItemType: 'cabinet_item',
                sourceItemId: result.itemId,
                brandName: scan.brand || undefined,
                productNumber: scan.productNumber || undefined,
                quantity: 1,
                capacityText: scan.capacity || undefined,
                casNumber: scan.casNumber || undefined,
                casInputMethod: scan.casNumber ? 'scan' : 'unknown',
                metadata: {
                    placement_mode: 'scan_auto_place',
                },
            });
            const currentCabinetId = useFridgeStore.getState().cabinetId;
            if (currentCabinetId) {
                const memo = [scan.casNumber && `CAS: ${scan.casNumber}`, scan.capacity && `Capacity: ${scan.capacity}`].filter(Boolean).join(', ');
                cabinetService.logActivity(currentCabinetId, 'add', finalName, undefined, memo || undefined)
                    .catch(err => console.error('Failed to log scan-add activity:', err));
                void analyticsService.trackStorageWarningIgnoredForItem({
                    cabinetId: currentCabinetId,
                    shelves: useFridgeStore.getState().shelves,
                    relatedItemId: result.itemId,
                    sourceScreen: 'fridge_view',
                    triggerSource: 'scan_auto_place',
                });
            }
        }

    }, [autoPlaceReagent, autoSave, t, updateScanQueueItem]);

    const processScanTask = React.useCallback(async (task: { id: string; imageSrc: string }) => {
        try {
            const scan = await scanReagentLabel(task.imageSrc);
            if (!scan.success) {
                throw new Error(scan.error || t('inventory_scan_error_default'));
            }

            const placementJob = scanPlacementQueueRef.current.then(() => autoPlaceScannedReagent(scan, task.id));
            scanPlacementQueueRef.current = placementJob.catch(() => undefined);
            await placementJob;
        } catch (error) {
            console.error('Queued cabinet scan failed:', error);
            const message = error instanceof Error ? error.message : t('inventory_scan_error_default');
            updateScanQueueItem(task.id, { status: 'error', label: t('scan_failed') });
            setToastMessage(message);
        }
    }, [autoPlaceScannedReagent, t, updateScanQueueItem]);

    const runNextScanTasks = React.useCallback(() => {
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
    }, [processScanTask]);

    const handleScanCapture = React.useCallback((imageSrc: string) => {
        const id = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setScanQueueItems((prev) => [...prev, { id, imageSrc, status: 'processing' }]);
        scanPendingTasksRef.current.push({ id, imageSrc });
        runNextScanTasks();
    }, [runNextScanTasks]);

    const handleScanCancel = React.useCallback(() => {
        setScanDialogOpen(false);
        setScanResult(null);
        setIsScanning(false);
    }, []);

    const handleScanAutoPlace = React.useCallback(() => {
        handleScanCancel();
    }, [handleScanCancel]);

    // Generic containers for the placement tray (labels match ReagentEditPanel: cabinet_container_*)
    const genericContainers: GenericContainerItem[] = [
        {
            name: t('cabinet_container_amber'), type: 'A', color: '#8b4513', width: 8,
            chemicalData: { name: t('cabinet_container_amber') }
        },
        {
            name: t('cabinet_container_plastic'), type: 'B', color: '#f8fafc', width: 10,
            chemicalData: { name: t('cabinet_container_plastic') }
        },
        {
            name: t('cabinet_container_glass'), type: 'C', color: '#b0c4de', width: 8,
            chemicalData: { name: t('cabinet_container_glass') }
        },
        {
            name: t('cabinet_container_vial'), type: 'D', color: '#cbd5e1', width: 10,
            chemicalData: { name: t('cabinet_container_vial') }
        },
    ];

    const containerTypeOptions: { type: ReagentTemplateType; label: string; color: string }[] = [
        { type: 'A', label: t('cabinet_container_amber'), color: '#8b4513' },
        { type: 'B', label: t('cabinet_container_plastic'), color: '#f8fafc' },
        { type: 'C', label: t('cabinet_container_glass'), color: '#b0c4de' },
        { type: 'D', label: t('cabinet_container_vial'), color: '#cbd5e1' },
    ];

    return (
        <div className="w-full h-full relative flex flex-col bg-gray-50 overflow-hidden">
            {/* Header Toolbar */}
            <div className="flex justify-between items-center px-4 py-3 bg-white shadow-sm z-30 relative shrink-0">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="p-2 -ml-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-full transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                    )}
                    <h2 className="text-lg font-semibold text-slate-800">
                        {isLoadingCabinet ? (
                            <span className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" /> {t('cabinet_loading')}
                            </span>
                        ) : cabinetName || t('cabinet_manage')}
                    </h2>
                </div>
                <div className="flex items-center gap-2">
                    {/* 저장 상태 인디케이터 */}

                    {saveStatus === 'saving' ? (
                        <span className="flex items-center gap-1.5 text-sm text-slate-400">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="hidden sm:inline">{t('cabinet_saving')}</span>
                        </span>
                    ) : saveStatus === 'saved' ? (
                        <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium animate-in fade-in duration-200">
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="hidden sm:inline">{t('cabinet_saved')}</span>
                        </span>
                    ) : (
                        <button
                            onClick={handleSave}
                            disabled={isSaving || isLoadingCabinet}
                            title={t('cabinet_save_manual')}
                            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40"
                        >
                            <Save className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Main 3D Viewport */}
            <div className="flex-1 relative w-full h-full">
                {isLoadingCabinet && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-20">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                    </div>
                )}
                <Suspense fallback={<SceneLoadingFallback />}>
                    <FridgeScene />
                </Suspense>

                {showOnboardingGuide && (
                    <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-4">
                        <div className="pointer-events-auto w-full max-w-md">
                            <OnboardingGuideCard
                                icon={<Box className="h-5 w-5" />}
                                title={t('onboarding_cabinet_detail_title')}
                                description={t('onboarding_cabinet_detail_desc')}
                                points={[
                                    t('onboarding_cabinet_detail_point_1'),
                                    t('onboarding_cabinet_detail_point_2'),
                                    t('onboarding_cabinet_detail_point_3'),
                                ]}
                                onDismiss={() => markGuideSeen('cabinetDetail')}
                            />
                        </div>
                    </div>
                )}

                {/* Mode Switcher - Floating Pill */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none z-20">
                    <div className="bg-white/90 backdrop-blur pointer-events-auto shadow-md border rounded-full p-1 flex items-center gap-1">
                        <button
                            onClick={() => setMode('VIEW')}
                            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 whitespace-nowrap text-xs font-medium transition-colors ${mode === 'VIEW' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'
                                }`}
                        >
                            <Layers size={14} /> {t('cabinet_mode_view')}
                        </button>
                        <div className="w-px h-4 bg-gray-200" />
                        <button
                            onClick={() => setMode('EDIT')}
                            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 whitespace-nowrap text-xs font-medium transition-colors ${mode === 'EDIT' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'
                                }`}
                        >
                            <Box size={14} /> {t('cabinet_mode_edit')}
                        </button>
                        <div className="w-px h-4 bg-gray-200" />
                        <button
                            onClick={() => setMode('PLACE')}
                            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 whitespace-nowrap text-xs font-medium transition-colors ${mode === 'PLACE' ? 'bg-green-100 text-green-700' : 'text-gray-500 hover:bg-gray-100'
                                }`}
                        >
                            <Plus size={14} /> {t('cabinet_mode_place')}
                        </button>
                    </div>
                </div>

                {compatibilityPlanPreview && !isCompatibilityPreviewVisible && (
                    <div className="pointer-events-none absolute inset-x-0 top-[4.8rem] z-20 flex justify-center px-4">
                        <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur">
                            <div className="flex items-center gap-3 px-4 py-3">
                                <button
                                    type="button"
                                    onClick={() => setIsCompatibilityPreviewVisible(true)}
                                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                >
                                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                                        compatibilityPlanPreview.canApply
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-amber-100 text-amber-700'
                                    }`}>
                                        <CheckCircle2 className="h-5 w-5" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-800">
                                            {t('cabinet_auto_place_collapsed_title')}
                                        </p>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                            <span>
                                                {t('cabinet_auto_place_after')}: {compatibilityPlanPreview.afterWarningCount}
                                            </span>
                                            <span>
                                                {t('cabinet_auto_place_review_items')}: {compatibilityPlanPreview.reviewItems.length}
                                            </span>
                                            <span>
                                                {t('cabinet_auto_place_unplaced_items')}: {compatibilityPlanPreview.unplacedItems.length}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-600">
                                            {t('cabinet_auto_place_collapsed_desc')}
                                        </p>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCancelCompatibilityPreview}
                                    className="rounded-xl border border-slate-200 p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                                    aria-label={t('cabinet_auto_place_close')}
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {mode === 'PLACE' && draggedTemplate && !pendingPlacement && (
                    <div className="pointer-events-none absolute inset-x-0 top-[4rem] z-20 flex justify-center px-4">
                        <div className="pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-emerald-700">
                                    {isCoarsePointer ? t('cabinet_place_instruction_touch') : t('cabinet_place_instruction_desktop')}
                                </p>
                                <p className="truncate text-sm font-semibold text-slate-800">
                                    {t('cabinet_place_selected_reagent', { name: draggedTemplate.name ?? t('cabinet_reagent_tray_title') })}
                                </p>
                            </div>
                            <button
                                onClick={handleClearSelectedReagent}
                                className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                            >
                                {t('cabinet_place_clear_selection')}
                            </button>
                        </div>
                    </div>
                )}

                {/* Storage Compatibility Warning Banner */}
                <StorageCompatBanner reopenToken={storageCompatBannerReopenToken} />
                <CabinetAutoLayoutPreviewModal
                    preview={isCompatibilityPreviewVisible ? compatibilityPlanPreview : null}
                    isApplying={isApplyingCompatibilityPlan}
                    onApply={handleApplyCompatibilityPreview}
                    onCancel={handleCancelCompatibilityPreview}
                    onFocusIssue={handleFocusCompatibilityIssue}
                />

                {/* Edit Mode Overlay */}
                <ReagentEditPanel />
                {mode === 'EDIT' && (
                    <div className="absolute inset-x-0 bottom-24 flex flex-col items-center gap-2 pointer-events-none z-20">
                        {isEditPanelVisible ? (
                            <div className="relative bg-white/90 backdrop-blur pointer-events-auto p-4 rounded-xl shadow-lg border flex flex-col gap-4 max-w-md w-full mx-4">
                                {/* 접기 버튼 - 우측 상단 */}
                                <button
                                    onClick={() => setIsEditPanelVisible(false)}
                                    className="absolute top-2 right-2 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                    title={t('cabinet_edit_panel_hide')}
                                >
                                    <ChevronDown size={18} />
                                </button>
                                <div className="flex flex-col gap-3 mt-6">
                                    {/* 버튼 행 - 4개의 버튼이 모바일에서 한 줄에 들어가도록 최적화 */}
                                    <div className="flex justify-between sm:justify-center items-end gap-x-2 sm:gap-x-6 w-full px-1">
                                        <button
                                            onClick={() => { addShelf(); autoSave(); }}
                                            className="flex flex-col items-center gap-1.5 text-gray-600 hover:text-blue-600 transition-colors group shrink-0"
                                        >
                                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center border group-hover:border-blue-500 group-hover:bg-blue-50 transition-all">
                                                <Plus size={20} />
                                            </div>
                                            <span className="whitespace-nowrap text-[10px] sm:text-xs font-medium">{t('cabinet_add_shelf')}</span>
                                        </button>
                                        <button
                                            onClick={() => { if (shelves.length > 0) { removeShelf(shelves[shelves.length - 1].id); autoSave(); } }}
                                            disabled={shelves.length === 0}
                                            className="flex flex-col items-center gap-1.5 text-gray-600 hover:text-red-600 transition-colors group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-600 shrink-0"
                                        >
                                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center border group-hover:border-red-500 group-hover:bg-red-50 transition-all group-disabled:hover:border-gray-300 group-disabled:hover:bg-gray-100">
                                                <Minus size={20} />
                                            </div>
                                            <span className="whitespace-nowrap text-[10px] sm:text-xs font-medium">{t('cabinet_remove_shelf')}</span>
                                        </button>
                                        <button
                                            onClick={() => { if (verticalPanelPos >= 1 && verticalPanelPos <= 99) { addVerticalPanel(verticalPanelPos); autoSave(); } }}
                                            disabled={shelves.length === 0}
                                            className="flex flex-col items-center gap-1.5 text-gray-600 hover:text-indigo-600 transition-colors group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-600 shrink-0"
                                        >
                                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center border group-hover:border-indigo-500 group-hover:bg-indigo-50 transition-all group-disabled:hover:border-gray-300 group-disabled:hover:bg-gray-100">
                                                <SplitSquareVertical size={20} className="rotate-90" />
                                            </div>
                                            <span className="whitespace-nowrap text-[10px] sm:text-xs font-medium">{t('cabinet_add_vertical_panel')}</span>
                                        </button>
                                        <button
                                            onClick={() => { removeVerticalPanel(); autoSave(); }}
                                            disabled={shelves.every(s => s.dividers.length === 0)}
                                            className="flex flex-col items-center gap-1.5 text-gray-600 hover:text-orange-600 transition-colors group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-600 shrink-0"
                                        >
                                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center border group-hover:border-orange-500 group-hover:bg-orange-50 transition-all group-disabled:hover:border-gray-300 group-disabled:hover:bg-gray-100">
                                                <SplitSquareVertical size={20} className="rotate-90" />
                                            </div>
                                            <span className="whitespace-nowrap text-[10px] sm:text-xs font-medium">{t('cabinet_remove_vertical_panel')}</span>
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-center gap-2 pt-2 border-t border-gray-100 w-full flex-wrap">
                                        <span className="text-[10px] sm:text-xs text-gray-500 font-medium">{t('cabinet_sort_label')}</span>
                                        <button
                                            onClick={handleNameSort}
                                            disabled={shelves.length === 0}
                                            className="px-2.5 py-1 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors flex items-center gap-1"
                                        >
                                            <span className="text-[10px]">AZ</span>
                                            {t('cabinet_sort_name')}
                                        </button>
                                        <button
                                            onClick={() => void handleBuildCompatibilityPreview()}
                                            disabled={shelves.every(s => s.items.length === 0) || isBuildingCompatibilityPlan || isApplyingCompatibilityPlan}
                                            className="px-2.5 py-1 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors flex items-center gap-1"
                                        >
                                            {isBuildingCompatibilityPlan ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />}
                                            {isBuildingCompatibilityPlan ? t('cabinet_auto_place_loading') : t('cabinet_auto_place_button')}
                                        </button>
                                        <div className="w-px h-5 bg-gray-200 mx-0.5" />
                                        <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg">
                                            <span className="text-[10px] sm:text-xs text-gray-500 font-medium whitespace-nowrap">{t('cabinet_vertical_panel')}</span>
                                            <div className="flex items-center gap-0.5 bg-white border border-gray-200 px-1.5 py-0.5 rounded">
                                                <NumberInput
                                                    min={1}
                                                    max={99}
                                                    value={verticalPanelPos}
                                                    onChange={(v) => setVerticalPanelPos(v)}
                                                    className="w-8 text-xs text-center border-none focus:ring-0 p-0"
                                                />
                                                <span className="text-[10px] text-gray-400">%</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 가로/세로/폭 크기 입력 - 한 줄 */}
                                <div className="flex flex-col gap-2 pt-2 border-t border-gray-200">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-xs font-medium text-gray-600 w-8">{t('cabinet_width')}</span>
                                            <NumberInput
                                                min={4}
                                                max={20}
                                                value={cabinetWidth}
                                                onChange={(v) => setCabinetDimensions(v, undefined)}
                                                className="w-14 px-1.5 py-1 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                                            />
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-xs font-medium text-gray-600 w-8">{t('cabinet_height')}</span>
                                            <NumberInput
                                                min={2}
                                                max={15}
                                                value={cabinetHeight}
                                                onChange={(v) => setCabinetDimensions(undefined, v)}
                                                className="w-14 px-1.5 py-1 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                                            />
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-xs font-medium text-gray-600 w-8">{t('cabinet_depth')}</span>
                                            <NumberInput
                                                min={1}
                                                max={4}
                                                value={cabinetDepth}
                                                onChange={(v) => setCabinetDepth(v)}
                                                className="w-14 px-1.5 py-1 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                                            />
                                        </div>
                                    </div>
                                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={cabinetAspectRatio != null}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                setCabinetAspectRatio(checked ? cabinetWidth / cabinetHeight : null);
                                            }}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-400"
                                        />
                                        <Ratio size={14} className="text-gray-400" />
                                        {t('cabinet_ratio_lock')}
                                    </label>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsEditPanelVisible(true)}
                                className="bg-white/90 backdrop-blur pointer-events-auto px-4 py-2 rounded-xl shadow-lg border flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50/50 transition-colors"
                                title={t('cabinet_edit_panel_show')}
                            >
                                <ChevronUp size={18} />
                                {t('cabinet_edit_panel_show')}
                            </button>
                        )}
                    </div>
                )}

                {/* Place Mode Reagent Tray - 편집 패널처럼 열고 닫기 */}
                {mode === 'PLACE' && (
                    <div className="absolute inset-x-0 bottom-24 flex flex-col items-center gap-2 pointer-events-none z-20">
                        {isReagentTrayVisible ? (
                            <div className="relative bg-white/90 backdrop-blur pointer-events-auto p-4 rounded-xl shadow-lg border flex flex-col gap-2 max-w-full w-full mx-4 z-20">
                                <button
                                    onClick={() => setIsReagentTrayVisible(false)}
                                    className="absolute top-2 right-2 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                    title={t('cabinet_reagent_tray_hide')}
                                >
                                    <ChevronDown size={18} />
                                </button>
                                <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-2 px-1 pr-6 w-full">
                                    <h3 className="text-sm font-semibold text-gray-700 whitespace-nowrap shrink-0">{t('cabinet_reagent_tray_title')}</h3>
                                    <div className="flex flex-1 flex-wrap items-center gap-1.5 sm:gap-2 w-full">
                                        <button
                                            onClick={handleNameSort}
                                            disabled={shelves.length === 0}
                                            className="px-2 py-1 text-[10px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap"
                                        >
                                            <span>AZ</span>
                                            {t('cabinet_sort_name')}
                                        </button>
                                        <button
                                            onClick={() => void handleBuildCompatibilityPreview()}
                                            disabled={shelves.every(s => s.items.length === 0) || isBuildingCompatibilityPlan || isApplyingCompatibilityPlan}
                                            className="px-2 py-1 text-[10px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap"
                                        >
                                            {isBuildingCompatibilityPlan ? <Loader2 size={10} className="animate-spin" /> : <Layers size={10} />}
                                            {isBuildingCompatibilityPlan ? t('cabinet_auto_place_loading') : t('cabinet_auto_place_button')}
                                        </button>
                                        <button
                                            onClick={handleOpenStorageCompatBanner}
                                            disabled={storageCompatWarningCount === 0}
                                            className="px-2 py-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 hover:text-amber-800 hover:border-amber-300 transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-amber-50 disabled:hover:text-amber-700 disabled:hover:border-amber-200"
                                        >
                                            <ShieldAlert size={10} />
                                            {t('btn_check_storage_compat')}
                                        </button>
                                        <button
                                            onClick={() => setIsClearConfirmOpen(true)}
                                            disabled={shelves.every(s => s.items.length === 0)}
                                            className="ml-auto text-[11px] sm:text-xs text-red-600 hover:underline flex items-center gap-1 disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
                                        >
                                            {t('cabinet_clear_all')}
                                        </button>
                                    </div>
                                </div>
                                {!draggedTemplate && (
                                    <div className="flex flex-col gap-2 px-1">
                                        <p className="text-xs text-gray-500">{t('cabinet_place_instruction_select')}</p>
                                    </div>
                                )}
                                <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-200">
                                    {/* 📷 Scan Button */}
                                    <div
                                        onClick={() => setIsCameraOpen(true)}
                                        className="min-w-[90px] h-[100px] flex flex-col items-center justify-between px-2 py-1.5 bg-gradient-to-b from-emerald-50 to-emerald-100 border-2 border-dashed border-emerald-400 rounded-lg hover:shadow-md hover:border-emerald-500 cursor-pointer transition-all shrink-0 group"
                                    >
                                        <div className="w-10 h-16 rounded-md flex items-center justify-center group-hover:scale-105 transition-transform origin-bottom">
                                            <ScanLine className="w-8 h-8 text-emerald-600" />
                                        </div>
                                        <div className="w-full text-center">
                                            <span className="text-xs font-bold text-emerald-700 leading-tight">
                                                {t('scan_reagent')}
                                            </span>
                                        </div>
                                    </div>
                                    {genericContainers.map((item, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => handleReagentClick(item)}
                                            className={`min-w-[90px] h-[100px] flex flex-col items-center justify-end gap-1 px-2 py-1.5 bg-white border rounded-lg hover:shadow-md hover:border-blue-300 cursor-pointer transition-all shrink-0 group relative ${draggedTemplate?.name === item.name ? 'ring-2 ring-blue-500 ring-offset-1 bg-blue-50' : ''}`}
                                        >
                                            <div className="group-hover:scale-105 transition-transform origin-bottom">
                                                <Suspense fallback={<ReagentPreviewFallback width={60} height={64} />}>
                                                    <ReagentModelPreview type={item.type as 'A' | 'B' | 'C' | 'D'} width={60} height={64} />
                                                </Suspense>
                                            </div>
                                            <div className="w-full text-center">
                                                <span className="text-xs font-semibold text-gray-800 line-clamp-2 leading-tight">
                                                    {item.name}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsReagentTrayVisible(true)}
                                className="bg-white/90 backdrop-blur pointer-events-auto px-4 py-2 rounded-xl shadow-lg border flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50/50 transition-colors z-20"
                                title={t('cabinet_reagent_tray_show')}
                            >
                                <ChevronUp size={18} />
                                {t('cabinet_reagent_tray_show')}
                            </button>
                        )}
                    </div>
                )}
            </div>

            <CustomDialog
                isOpen={isClearConfirmOpen}
                onClose={() => setIsClearConfirmOpen(false)}
                title={t('cabinet_clear_all')}
                description={t('cabinet_clear_all_confirm')}
                type="confirm"
                isDestructive={true}
                onConfirm={handleClearConfirmStep1}
                confirmText={t('cabinet_delete')}
                cancelText={t('btn_cancel')}
            />

            <CustomDialog
                isOpen={isClearSecondConfirmOpen}
                onClose={() => setIsClearSecondConfirmOpen(false)}
                title={t('cabinet_clear_all')}
                description={t('cabinet_clear_all_confirm_second')}
                type="confirm"
                isDestructive={true}
                onConfirm={handleClearCabinet}
                confirmText={t('cabinet_delete')}
                cancelText={t('btn_cancel')}
            />

            {/* Original manual placement dialog */}
            {(pendingPlacement && showModalContent) && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div
                        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                        onClick={(e) => {
                            // 모바일: 손 뗀 직후 발생하는 합성 클릭은 무시 (의도치 않은 백드롭 클릭 방지)
                            if (Date.now() - placementModalOpenedAtRef.current < 400) {
                                e.preventDefault();
                                e.stopPropagation();
                                return;
                            }
                            handleCancelPlacement();
                        }}
                    />
                    <div className={`relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6 gap-4 flex flex-col animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 max-h-[90vh] overflow-y-auto`}>
                        <h3 className="text-xl font-bold text-slate-800">{t('reagent_info_title')}</h3>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-600">{t('reagent_name_label')}</label>
                            <input
                                ref={placementNameInputRef}
                                type="text"
                                value={placementName}
                                onChange={e => {
                                    placementCasSuggestion.markNameInputChanged();
                                    setPlacementName(e.target.value);
                                }}
                                onBlur={placementCasSuggestion.triggerLookupFromBlur}
                                placeholder={t('reagent_name_placeholder')}
                                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>

                        {/* 브랜드 + 제품번호 */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-600">📦 {t('inventory_brand')}</label>
                                <input
                                    type="text"
                                    value={placementBrand}
                                    onChange={e => setPlacementBrand(e.target.value)}
                                    placeholder={t('inventory_brand_placeholder')}
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-600">🏷 {t('inventory_product_number')}</label>
                                <input
                                    type="text"
                                    value={placementProductNumber}
                                    onChange={e => setPlacementProductNumber(e.target.value)}
                                    placeholder={t('inventory_pn_placeholder')}
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                                />
                            </div>
                        </div>

                        {/* CAS 번호 */}
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-600">🧬 {t('reagent_cas_label')}</label>
                            <input
                                type="text"
                                value={placementCas}
                                onChange={e => setPlacementCas(e.target.value)}
                                onFocus={placementCasSuggestion.triggerLookupFromCasFocus}
                                placeholder={t('inventory_cas_placeholder')}
                                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                            />
                            {placementCasSuggestion.shouldRenderCard && (
                                <CasSuggestionCard
                                    state={
                                        placementCasSuggestion.state === 'checking'
                                            ? 'checking'
                                            : placementCasSuggestion.state === 'suggestion'
                                                ? 'suggestion'
                                                : placementCasSuggestion.state === 'applied'
                                                    ? 'applied'
                                                    : 'unavailable'
                                    }
                                    suggestion={placementCasSuggestion.appliedSuggestion || placementCasSuggestion.suggestion}
                                    inputName={placementName}
                                    onApply={placementCasSuggestion.applySuggestion}
                                    onUndo={placementCasSuggestion.undoAppliedSuggestion}
                                    onDismiss={() => {
                                        void analyticsService.trackCasSuggestionDismissed({
                                            sourceScreen: 'fridge_view',
                                            storageType: 'cabinet',
                                            sourceItemType: 'cabinet_item',
                                            chemicalName: placementName,
                                            casNumber: placementCasSuggestion.suggestion?.casNumber,
                                            metadata: {
                                                trigger: 'manual_place',
                                                confidence: placementCasSuggestion.suggestion?.confidence,
                                                sources: placementCasSuggestion.suggestion?.sources,
                                            },
                                        });
                                        placementCasSuggestion.dismissSuggestion();
                                    }}
                                />
                            )}
                        </div>

                        {/* 크기 */}
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-600">{t('reagent_size_label')}</label>
                            <div className="flex gap-2">
                                {[
                                    { label: t('reagent_size_small'), value: 0.8 },
                                    { label: t('reagent_size_medium'), value: 1.0 },
                                    { label: t('reagent_size_large'), value: 1.2 }
                                ].map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setPlacementSize(opt.value)}
                                        className={`flex-1 py-1.5 rounded-lg text-sm font-medium border transition-colors ${placementSize === opt.value
                                            ? 'bg-blue-100 border-blue-500 text-blue-700'
                                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                            }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 용량 + 유효기간 한 줄 */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                                    🧪 {t('reagent_capacity_label')}
                                </label>
                                <input
                                    type="text"
                                    value={placementCapacity}
                                    onChange={e => setPlacementCapacity(e.target.value)}
                                    placeholder={t('inventory_capacity_placeholder')}
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                                    📅 {t('reagent_expiry_label')}
                                </label>
                                <input
                                    type="date"
                                    value={placementExpiry}
                                    onChange={e => setPlacementExpiry(e.target.value)}
                                    lang={i18n.language.startsWith('ko') ? 'ko' : 'en-US'}
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                        </div>

                        {/* Remaining Amount Input */}
                        <div className="flex flex-col gap-2 mt-1 px-1">
                            <label className="text-sm font-semibold text-slate-700">
                                {t('inventory_remaining_amount', '잔량')}
                            </label>
                            <div className="grid grid-cols-4 gap-2">
                                {[
                                    { stage: 1, value: 5, color: 'bg-red-50 text-red-600 border-red-200', active: 'bg-red-600 text-white border-red-600' },
                                    { stage: 2, value: 30, color: 'bg-orange-50 text-orange-600 border-orange-200', active: 'bg-orange-500 text-white border-orange-500' },
                                    { stage: 3, value: 60, color: 'bg-blue-50 text-blue-600 border-blue-200', active: 'bg-blue-600 text-white border-blue-600' },
                                    { stage: 4, value: 100, color: 'bg-emerald-50 text-emerald-600 border-emerald-200', active: 'bg-emerald-600 text-white border-emerald-600' }
                                ].map((item) => {
                                    const val = placementRemainingPercent;
                                    const isSelected = (
                                        item.stage === 1 ? val <= 10 :
                                        item.stage === 2 ? (val > 10 && val <= 30) :
                                        item.stage === 3 ? (val > 30 && val <= 70) :
                                        val > 70
                                    );

                                    return (
                                        <button
                                            key={item.stage}
                                            type="button"
                                            onClick={() => setPlacementRemainingPercent(item.value)}
                                            className={`flex flex-col items-center justify-center py-2.5 px-0.5 rounded-xl border-2 transition-all duration-200 ${
                                                isSelected ? item.active : `${item.color} opacity-60`
                                            }`}
                                        >
                                            <span className="text-[10px] font-bold uppercase mb-0.5">
                                                {t(`inventory_remaining_stage_${item.stage}`)}
                                            </span>
                                            <span className="text-[11px] font-bold leading-tight text-center">
                                                {t(`inventory_remaining_stage_${item.stage}_label`)}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                            <p className="text-[11px] text-slate-500 ml-1 h-4">
                                {placementRemainingPercent <= 10 && t('inventory_remaining_stage_1_desc')}
                                {placementRemainingPercent > 10 && placementRemainingPercent <= 30 && t('inventory_remaining_stage_2_desc')}
                                {placementRemainingPercent > 30 && placementRemainingPercent <= 70 && t('inventory_remaining_stage_3_desc')}
                                {placementRemainingPercent > 70 && t('inventory_remaining_stage_4_desc')}
                            </p>
                        </div>

                        {/* 메모 */}
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-600">{t('reagent_memo_label')}</label>
                            <textarea
                                value={placementMemo}
                                onChange={e => setPlacementMemo(e.target.value)}
                                placeholder={t('reagent_memo_placeholder')}
                                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none h-16"
                            />
                        </div>

                        <div className="flex items-center gap-3 mt-1">
                            <button
                                onClick={handleCancelPlacement}
                                className="flex-1 py-2 rounded-xl text-slate-600 font-medium bg-slate-100 hover:bg-slate-200 transition-colors"
                            >
                                {t('btn_cancel')}
                            </button>
                            <button
                                onClick={handleConfirmPlacement}
                                disabled={!placementName.trim()}
                                className="flex-1 py-2 rounded-xl text-white font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                                {t('btn_confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Camera Capture Modal */}
            <CameraCaptureModal
                isOpen={isCameraOpen}
                onClose={() => setIsCameraOpen(false)}
                mode="continuous"
                queueItems={scanQueueItems}
                onQueueCapture={handleScanCapture}
            />

            {/* Scan Result Dialog */}
            {scanDialogOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={handleScanCancel} />
                    <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden p-6 gap-3 flex flex-col animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 max-h-[90vh] overflow-y-auto">
                        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <ScanLine className="w-5 h-5 text-emerald-600" />
                            {isScanning ? t('scan_analyzing') : t('scan_result_title')}
                        </h3>

                        {isScanning ? (
                            <div className="flex flex-col items-center gap-4 py-8">
                                <div className="relative">
                                    <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
                                    <ScanLine className="w-5 h-5 text-emerald-700 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                                </div>
                                <p className="text-sm text-gray-500 animate-pulse">{t('scan_analyzing')}</p>
                            </div>
                        ) : scanResult && !scanResult.success ? (
                            <div className="flex flex-col items-center gap-4 py-6">
                                <p className="text-sm text-red-600">{t('scan_failed')}: {scanResult.error}</p>
                                <button
                                    onClick={handleScanCancel}
                                    className="px-4 py-2 bg-slate-100 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
                                >
                                    {t('btn_cancel')}
                                </button>
                            </div>
                        ) : (
                            <>
                                {/* Name */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-gray-600">{t('reagent_name_label')}</label>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={scanName}
                                        onChange={e => {
                                            scanCasSuggestion.markNameInputChanged();
                                            setScanName(e.target.value);
                                        }}
                                        onBlur={scanCasSuggestion.triggerLookupFromBlur}
                                        placeholder={t('reagent_name_placeholder')}
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                    />
                                </div>

                                {/* CAS */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-gray-600">{t('reagent_cas_label')}</label>
                                    <input
                                        type="text"
                                        value={scanCas}
                                        onChange={e => setScanCas(e.target.value)}
                                        onFocus={scanCasSuggestion.triggerLookupFromCasFocus}
                                        placeholder={t('inventory_cas_placeholder')}
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                    />
                                    {scanCasSuggestion.shouldRenderCard && (
                                        <CasSuggestionCard
                                            state={
                                                scanCasSuggestion.state === 'checking'
                                                    ? 'checking'
                                                    : scanCasSuggestion.state === 'suggestion'
                                                        ? 'suggestion'
                                                        : scanCasSuggestion.state === 'applied'
                                                            ? 'applied'
                                                            : 'unavailable'
                                            }
                                            suggestion={scanCasSuggestion.appliedSuggestion || scanCasSuggestion.suggestion}
                                            inputName={scanName}
                                            onApply={scanCasSuggestion.applySuggestion}
                                            onUndo={scanCasSuggestion.undoAppliedSuggestion}
                                            onDismiss={() => {
                                                void analyticsService.trackCasSuggestionDismissed({
                                                    sourceScreen: 'fridge_view',
                                                    storageType: 'cabinet',
                                                    sourceItemType: 'cabinet_item',
                                                    chemicalName: scanName,
                                                    casNumber: scanCasSuggestion.suggestion?.casNumber,
                                                    metadata: {
                                                        trigger: 'scan_place',
                                                        confidence: scanCasSuggestion.suggestion?.confidence,
                                                        sources: scanCasSuggestion.suggestion?.sources,
                                                    },
                                                });
                                                scanCasSuggestion.dismissSuggestion();
                                            }}
                                        />
                                    )}
                                </div>

                                {/* Brand + Product Number */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold text-gray-600">📦 {t('inventory_brand')}</label>
                                        <input
                                            type="text"
                                            value={scanBrand}
                                            onChange={e => setScanBrand(e.target.value)}
                                            placeholder={t('inventory_brand_placeholder')}
                                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold text-gray-600">🏷 {t('inventory_product_number')}</label>
                                        <input
                                            type="text"
                                            value={scanProductNumber}
                                            onChange={e => setScanProductNumber(e.target.value)}
                                            placeholder={t('inventory_pn_placeholder')}
                                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono"
                                        />
                                    </div>
                                </div>

                                {/* Container Type */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-gray-600">{t('reagent_container_type_label')}</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {containerTypeOptions.map(opt => (
                                            <button
                                                key={opt.type}
                                                onClick={() => setScanContainerType(opt.type)}
                                                className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-[10px] font-medium transition-all ${scanContainerType === opt.type
                                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200'
                                                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                    }`}
                                            >
                                                <Suspense fallback={<ReagentPreviewFallback width={36} height={44} />}>
                                                    <ReagentModelPreview type={opt.type as 'A' | 'B' | 'C' | 'D'} width={36} height={44} />
                                                </Suspense>
                                                <span className="text-center leading-tight">{opt.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Size */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-gray-600">{t('reagent_size_label')}</label>
                                    <div className="flex gap-2">
                                        {[
                                            { label: t('reagent_size_small'), value: 0.8 },
                                            { label: t('reagent_size_medium'), value: 1.0 },
                                            { label: t('reagent_size_large'), value: 1.2 }
                                        ].map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => setScanSize(opt.value)}
                                                className={`flex-1 py-1.5 rounded-lg text-sm font-medium border transition-colors ${scanSize === opt.value
                                                    ? 'bg-emerald-50 border-emerald-500 text-emerald-700'
                                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                    }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Capacity & Expiry row */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold text-gray-600">{t('reagent_capacity_label')}</label>
                                        <input
                                            type="text"
                                            value={scanCapacity}
                                            onChange={e => setScanCapacity(e.target.value)}
                                            placeholder={t('inventory_capacity_placeholder')}
                                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold text-gray-600">{t('reagent_expiry_label')}</label>
                                        <input
                                            type="date"
                                            value={scanExpiry}
                                            onChange={e => setScanExpiry(e.target.value)}
                                            lang={i18n.language.startsWith('ko') ? 'ko' : 'en-US'}
                                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                        />
                                    </div>
                                </div>

                                {/* Remaining Amount Input */}
                                <div className="flex flex-col gap-2 mt-1 px-1">
                                    <label className="text-sm font-semibold text-slate-700">
                                        {t('inventory_remaining_amount', '잔량')}
                                    </label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {[
                                            { stage: 1, value: 5, color: 'bg-red-50 text-red-600 border-red-200', active: 'bg-red-600 text-white border-red-600' },
                                            { stage: 2, value: 30, color: 'bg-orange-50 text-orange-600 border-orange-200', active: 'bg-orange-500 text-white border-orange-500' },
                                            { stage: 3, value: 60, color: 'bg-blue-50 text-blue-600 border-blue-200', active: 'bg-blue-600 text-white border-blue-600' },
                                            { stage: 4, value: 100, color: 'bg-emerald-50 text-emerald-600 border-emerald-200', active: 'bg-emerald-600 text-white border-emerald-600' }
                                        ].map((item) => {
                                            const val = scanRemainingPercent;
                                            const isSelected = (
                                                item.stage === 1 ? val <= 10 :
                                                item.stage === 2 ? (val > 10 && val <= 30) :
                                                item.stage === 3 ? (val > 30 && val <= 70) :
                                                val > 70
                                            );

                                            return (
                                                <button
                                                    key={item.stage}
                                                    type="button"
                                                    onClick={() => setScanRemainingPercent(item.value)}
                                                    className={`flex flex-col items-center justify-center py-2.5 px-0.5 rounded-xl border-2 transition-all duration-200 ${
                                                        isSelected ? item.active : `${item.color} opacity-60`
                                                    }`}
                                                >
                                                    <span className="text-[10px] font-bold uppercase mb-0.5">
                                                        {t(`inventory_remaining_stage_${item.stage}`)}
                                                    </span>
                                                    <span className="text-[11px] font-bold leading-tight text-center">
                                                        {t(`inventory_remaining_stage_${item.stage}_label`)}
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                    <p className="text-[11px] text-slate-500 ml-1 h-4">
                                        {scanRemainingPercent <= 10 && t('inventory_remaining_stage_1_desc')}
                                        {scanRemainingPercent > 10 && scanRemainingPercent <= 30 && t('inventory_remaining_stage_2_desc')}
                                        {scanRemainingPercent > 30 && scanRemainingPercent <= 70 && t('inventory_remaining_stage_3_desc')}
                                        {scanRemainingPercent > 70 && t('inventory_remaining_stage_4_desc')}
                                    </p>
                                </div>

                                {/* Memo */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-gray-600">{t('reagent_memo_label')}</label>
                                    <textarea
                                        value={scanMemo}
                                        onChange={e => setScanMemo(e.target.value)}
                                        placeholder={t('reagent_memo_placeholder')}
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none resize-none h-16"
                                    />
                                </div>

                                {/* Buttons */}
                                <div className="flex items-center gap-3 mt-2">
                                    <button
                                        onClick={handleScanCancel}
                                        className="flex-1 py-2.5 rounded-xl text-slate-600 font-medium bg-slate-100 hover:bg-slate-200 transition-colors"
                                    >
                                        {t('btn_cancel')}
                                    </button>
                                    <button
                                        onClick={handleScanAutoPlace}
                                        disabled={!scanName.trim()}
                                        className="flex-1 py-2.5 rounded-xl text-white font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <CheckCircle2 className="w-4 h-4" />
                                        {t('reagent_auto_place')}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Toast Notification */}
            {toastMessage && (
                <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-top-4 fade-in duration-300 w-max max-w-[90vw]">
                    <div className="bg-emerald-600 text-white px-5 py-3 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium text-center break-words">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        {toastMessage}
                    </div>
                </div>
            )}
        </div>
    );
};
