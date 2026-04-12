import React, { useState, useEffect } from 'react';
import { useFridgeStore } from '../../store/fridgeStore';
import { X, Save, Trash2, Beaker, MapPin, CalendarClock, CheckCircle2, Tag, Package, Loader2, History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { analyticsService } from '../../services/analyticsService';
import { cabinetService } from '../../services/cabinetService';
import { inventoryService } from '../../services/inventoryService';
import { auditService, type AuditLog } from '../../services/auditService';
import type { ReagentTemplateType } from '../../types/fridge';
import { CONTAINER_BASE_WIDTHS } from './ReagentItem';
import { getExpiryStatus, getExpiryBadgeClasses } from '../../utils/expiryStatus';
import { classifyStorageGroups, checkShelfCompatibility, getStorageGroupLabels } from '../../utils/storageCompatibilityChecker';
import { AlertTriangle, FlaskConical, BookOpen } from 'lucide-react';
import { searchChemical } from '../../services/searchService';
import { analyzeChemical } from '../../utils/chemicalAnalyzer';
import { classifyChemicalWithAI } from '../../services/geminiClassificationService';
import { ResultCard } from '../../components/ResultCard';
import type { AnalysisResult } from '../../types';

type DisposalReason = 'used' | 'expired' | 'broken' | 'other';

const REASONS: { key: DisposalReason; i18n: string; icon: string }[] = [
    { key: 'used', i18n: 'cabinet_dispose_reason_used', icon: '✅' },
    { key: 'expired', i18n: 'cabinet_dispose_reason_expired', icon: '⏰' },
    { key: 'broken', i18n: 'cabinet_dispose_reason_broken', icon: '💔' },
    { key: 'other', i18n: 'cabinet_dispose_reason_other', icon: '📝' },
];

const CONTAINER_TYPES: { type: ReagentTemplateType; label: string; icon: string }[] = [
    { type: 'A', label: 'cabinet_container_amber', icon: '🟤' },
    { type: 'B', label: 'cabinet_container_plastic', icon: '🤍' },
    { type: 'C', label: 'cabinet_container_glass', icon: '🧪' },
    { type: 'D', label: 'cabinet_container_vial', icon: '🧴' },
];

export const ReagentEditPanel: React.FC = () => {
    const { t, i18n } = useTranslation();
    const selectedReagentId = useFridgeStore(s => s.selectedReagentId);
    const shelves = useFridgeStore(s => s.shelves);
    const cabinetId = useFridgeStore(s => s.cabinetId);
    const updateReagent = useFridgeStore(s => s.updateReagent);
    const removeReagent = useFridgeStore(s => s.removeReagent);
    const saveCabinet = useFridgeStore(s => s.saveCabinet);
    const setSelectedReagentId = useFridgeStore(s => s.setSelectedReagentId);

    const [name, setName] = useState('');
    const [notes, setNotes] = useState('');
    const [expiryDate, setExpiryDate] = useState('');
    const [capacity, setCapacity] = useState('');
    const [template, setTemplate] = useState<ReagentTemplateType>('A');
    const [width, setWidth] = useState<number>(10);
    const [brand, setBrand] = useState('');
    const [productNumber, setProductNumber] = useState('');
    const [casNo, setCasNo] = useState('');

    // Disposal flow state
    const [showDisposalView, setShowDisposalView] = useState(false);
    const [selectedReason, setSelectedReason] = useState<DisposalReason | null>(null);
    const [isDisposing, setIsDisposing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [remainingPercent, setRemainingPercent] = useState<number>(100);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    // Disposal guide state
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

    // Prevent immediate interaction to avoid ghost clicks on mobile
    const [showModalContent, setShowModalContent] = useState(false);
    // Find the selected item from all shelves
    const selectedItem = React.useMemo(() => {
        if (!selectedReagentId) return null;
        for (const shelf of shelves) {
            const item = shelf.items.find(i => i.id === selectedReagentId);
            if (item) return { ...item, shelfLevel: shelf.level };
        }
        return null;
    }, [selectedReagentId, shelves]);

    // Update local state when selection data changes
    useEffect(() => {
        if (selectedItem) {
            setName(selectedItem.name);
            setNotes(selectedItem.notes || '');
            setExpiryDate(selectedItem.expiryDate || '');
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
            const timer = setTimeout(() => {
                setShowModalContent(true);
            }, 300);
            return () => clearTimeout(timer);
        } else {
            setShowModalContent(false);
        }
    }, [selectedReagentId]);

    // Reset disposal view when panel opens/closes
    useEffect(() => {
        setShowDisposalView(false);
        setSelectedReason(null);

        if (selectedReagentId) {
            setIsLoadingLogs(true);
            auditService.getLogs({ entity_id: selectedReagentId, limit: 10 })
                .then(setAuditLogs)
                .catch(console.error)
                .finally(() => setIsLoadingLogs(false));
        }
    }, [selectedReagentId]);

    if (!selectedReagentId || !selectedItem || !showModalContent) return null;

    const handleSave = async () => {
        if (isSaving) return;

        const normalize = (value?: string | null) => (value || '').trim();
        const shouldTrackCommerceUpdate =
            normalize(selectedItem.brand) !== normalize(brand)
            || normalize(selectedItem.productNumber) !== normalize(productNumber)
            || normalize(selectedItem.casNo) !== normalize(casNo)
            || normalize(selectedItem.capacity) !== normalize(capacity);

        const updatePayload = {
            name,
            memo: notes || undefined,
            expiry_date: expiryDate || undefined,
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
            capacity: capacity || undefined,
            template,
            brand: brand || undefined,
            productNumber: productNumber || undefined,
            casNo: casNo || undefined,
            remaining_percent: remainingPercent,
            width,
        });

        // If CAS changed and now has a value, trigger PubChem enrichment
        const casChanged = (casNo || '') !== (selectedItem.casNo || '');
        if (casChanged && casNo) {
            const enrichStore = useFridgeStore.getState();
            enrichStore.enrichReagentGHS(selectedReagentId);
        }

        // 감사로그를 남기기 위해 cabinet_item 업데이트 RPC를 먼저 호출합니다.
        setIsSaving(true);
        try {
            await inventoryService.updateItem(selectedReagentId, updatePayload, 'cabinet_item');
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
                    casInputMethod: casNo.trim() ? 'manual' : 'unknown',
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

    const expiryStatus = getExpiryStatus(expiryDate);

    const handleDeleteClick = () => {
        setShowDisposalView(true);
    };

    const confirmDisposal = async () => {
        if (!selectedReason || !cabinetId) return;
        setIsDisposing(true);
        try {
            // 1. 기존 폐기 로그 (하위 호환성)
            await cabinetService.logDisposal(cabinetId, selectedItem.name, selectedReason);
            // 2. 통합 활동 로그 기록
            await cabinetService.logActivity(cabinetId, 'remove', selectedItem.name, selectedReason);
            // 3. 연결된 재고 항목 삭제
            await inventoryService.deleteLinkedInventoryByCabinetItemId(cabinetId, selectedItem.name, selectedReason);
            // 4. Remove from store
            removeReagent(selectedReagentId);
            // 5. Save cabinet state
            await saveCabinet();
            setSelectedReagentId(null);
        } catch (err) {
            console.error('Disposal failed:', err);
        } finally {
            setIsDisposing(false);
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
                if (analysis.category === 'UNKNOWN') {
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
            'expiry_date': t('inventory_expiry', '유통기한'),
            'memo': t('inventory_memo', '메모'),
            'notes': t('inventory_memo', '메모'),
            'quantity': t('inventory_quantity', '수량'),
            'storage_location_id': t('inventory_location', '보관 위치'),
            'cabinet_id': t('inventory_cabinet', '보관함'),
            'storage_type': t('inventory_storage_type', '보관 방식')
        };
        return keyMap[key] || key;
    };

    return (
        <>
            <div className={`absolute left-1/2 -translate-x-1/2 top-2 w-[calc(100%-32px)] max-w-[320px] max-h-[calc(100%-4.5rem)] bg-white/95 backdrop-blur shadow-xl rounded-xl border border-gray-200 flex flex-col overflow-hidden z-30 animate-in slide-in-from-bottom duration-200`}>
                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b bg-gray-50/50 flex-shrink-0">
                    <div className="flex items-center gap-2 text-gray-800 font-semibold">
                        {showDisposalView ? (
                            <>
                                <Trash2 size={18} className="text-red-500" />
                                <span>{t('cabinet_dispose_reason_title')}</span>
                            </>
                        ) : (
                            <>
                                <Beaker size={18} className="text-blue-500" />
                                <span>{t('cabinet_edit_title')}</span>
                            </>
                        )}
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-1 rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {showDisposalView ? (
                    <>
                        {/* Disposal Reason Selection */}
                        <div className="p-3 flex flex-col gap-2 overflow-y-auto">
                            <p className="text-xs text-gray-500 mb-1">
                                <span className="font-medium text-gray-700">{selectedItem.name}</span> — {t('cabinet_dispose_reason_desc')}
                            </p>
                            {REASONS.map(reason => (
                                <button
                                    key={reason.key}
                                    onClick={() => setSelectedReason(reason.key)}
                                    className={`w-full px-3 py-2.5 text-sm rounded-lg border transition-all flex items-center gap-2.5 ${selectedReason === reason.key
                                        ? 'border-red-400 bg-red-50 text-red-700 ring-1 ring-red-300'
                                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                                        }`}
                                >
                                    <span className="text-base">{reason.icon}</span>
                                    <span className="font-medium">{t(reason.i18n)}</span>
                                    {selectedReason === reason.key && (
                                        <CheckCircle2 size={16} className="ml-auto text-red-500" />
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Disposal Confirm Button */}
                        <div className="p-3 border-t bg-gray-50/50 shrink-0">
                            <button
                                onClick={confirmDisposal}
                                disabled={!selectedReason || isDisposing}
                                className="w-full px-3.5 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Trash2 size={16} />
                                {isDisposing ? t('cabinet_processing') : t('cabinet_delete')}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        {/* Scrollable Content */}
                        <div className="p-3 flex flex-col gap-3 overflow-y-auto flex-1 min-h-0">
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
                            <div className="text-xs text-gray-500 flex flex-col gap-1">
                                <div className="flex justify-between items-center">
                                    <span>{t('cabinet_label_location')}</span>
                                    <span className="font-medium text-gray-700 flex items-center gap-1">
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
                                    <label className="text-xs font-medium text-gray-600">{t('cabinet_reagent_name')}</label>
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
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                    placeholder={t('cabinet_placeholder_name')}
                                />
                            </div>

                            {/* Brand & Product Number Row */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                                        <Package size={11} />
                                        {t('inventory_brand')}
                                    </label>
                                    <input
                                        type="text"
                                        value={brand}
                                        onChange={(e) => setBrand(e.target.value)}
                                        className="w-full px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                        placeholder="예: Sigma"
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                                        <Tag size={11} />
                                        {t('inventory_product_number')}
                                    </label>
                                    <input
                                        type="text"
                                        value={productNumber}
                                        onChange={(e) => setProductNumber(e.target.value)}
                                        className="w-full px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono"
                                        placeholder="예: A1234"
                                    />
                                </div>
                            </div>


                            {/* Capacity & CAS Number Row */}
                            <div className="flex flex-col gap-0.5">
                                <div className="grid grid-cols-2 gap-2">
                                    {/* Capacity Input */}
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                                            <Beaker size={12} />
                                            {t('inventory_capacity')}
                                        </label>
                                        <input
                                            type="text"
                                            value={capacity}
                                            onChange={(e) => setCapacity(e.target.value)}
                                            className="w-full px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                            placeholder={t('inventory_capacity_placeholder')}
                                        />
                                    </div>
                                    {/* CAS Number Input */}
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                                            <FlaskConical size={12} />
                                            CAS Number
                                        </label>
                                        <input
                                            type="text"
                                            value={casNo}
                                            onChange={(e) => setCasNo(e.target.value)}
                                            className="w-full px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono"
                                            placeholder={t('inventory_cas_placeholder')}
                                        />
                                    </div>
                                </div>
                                {casNo && (
                                    <p className="text-[10px] text-gray-400 mt-1 pl-1">
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
                                <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
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
                                            className={`flex flex-col items-center gap-0.5 px-1.5 py-2 rounded-lg border text-xs font-medium transition-all ${template === ct.type
                                                ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-blue-300'
                                                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                                                }`}
                                        >
                                            <span className="text-base leading-none">{ct.icon}</span>
                                            <span className="leading-tight text-center">{t(ct.label)}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Container Size (Width) Input */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
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
                                        className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                    />
                                    <span className="text-xs text-gray-500 w-8 text-right">{width}</span>
                                </div>
                            </div>



                            {/* Expiry Date Input */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                                    <CalendarClock size={12} />
                                    {t('inventory_error_expiry_label')}
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="date"
                                        value={expiryDate}
                                        onChange={(e) => setExpiryDate(e.target.value)}
                                        lang={i18n.language.startsWith('ko') ? 'ko' : 'en-US'}
                                        className="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                    />
                                    {expiryDate && (
                                        <button
                                            type="button"
                                            onClick={() => setExpiryDate('')}
                                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                                            title={t('cabinet_delete_expiry')}
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                                {expiryStatus && (
                                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md w-fit ${getExpiryBadgeClasses(expiryStatus.level)}`}>
                                        {t(expiryStatus.labelKey, expiryStatus.labelParams)}
                                    </span>
                                )}
                            </div>

                            {/* Notes Input */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-gray-600">{t('cabinet_notes')}</label>
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    rows={2}
                                    className="w-full px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none"
                                    placeholder={t('cabinet_placeholder_notes')}
                                />
                            </div>

                            {/* Storage Compatibility Section */}
                            {(() => {
                                const storageGroups = classifyStorageGroups(selectedItem);
                                const groupLabels = getStorageGroupLabels(storageGroups);
                                const currentShelf = shelves.find(s => s.items.some(i => i.id === selectedReagentId));
                                const shelfWarnings = currentShelf ? checkShelfCompatibility(currentShelf.items).filter(
                                    w => w.itemA === selectedItem.name || w.itemB === selectedItem.name
                                ) : [];

                                if (groupLabels.length === 0 && shelfWarnings.length === 0) return null;

                                return (
                                    <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
                                        {/* Storage Group Tags */}
                                        {groupLabels.length > 0 && (
                                            <div className="flex flex-col gap-1">
                                                <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                                                    {t('cabinet_storage_group')}
                                                </label>
                                                <div className="flex flex-wrap gap-1">
                                                    {groupLabels.map(key => (
                                                        <span key={key} className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                                            {t(key)}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Shelf Compatibility Warnings */}
                                        {shelfWarnings.length > 0 && (
                                            <div className="flex flex-col gap-1.5">
                                                {shelfWarnings.map((w, i) => {
                                                    const isDanger = w.severity === 'DANGER';
                                                    const otherName = w.itemA === selectedItem.name ? w.itemB : w.itemA;
                                                    return (
                                                        <div
                                                            key={`${w.ruleId}-${i}`}
                                                            className={`flex items-start gap-1.5 p-2 rounded-lg text-[11px] leading-relaxed ${isDanger
                                                                ? 'bg-red-50 text-red-700 border border-red-200'
                                                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                                                                }`}
                                                        >
                                                            <AlertTriangle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isDanger ? 'text-red-500' : 'text-amber-500'}`} />
                                                            <div>
                                                                <span className={`font-bold mr-1 ${isDanger ? 'text-red-600' : 'text-amber-600'}`}>
                                                                    {isDanger ? t('storage_compat_danger') : t('storage_compat_warning')}
                                                                </span>
                                                                <span className="font-semibold">{otherName}</span>
                                                                <span className="mx-1">—</span>
                                                                <span>{t(w.messageKey)}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
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
                        <div className="p-3 border-t bg-gray-50/50 flex items-center justify-between gap-2 shrink-0">
                            <button
                                onClick={handleDeleteClick}
                                disabled={isSaving}
                                className="px-3.5 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1.5 transition-colors"
                            >
                                <Trash2 size={16} />
                                {t('cabinet_delete')}
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="flex-1 px-3.5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                {isSaving ? t('cabinet_processing') : t('cabinet_save')}
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Disposal Guide Modal overlay */}
            {analysisResult && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
                        <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-gray-50 dark:bg-slate-800/50">
                            <h3 className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                <BookOpen className="w-5 h-5 text-blue-500" />
                                {t('btn_check_disposal_guide', '폐기가이드 확인')}
                            </h3>
                            <button
                                onClick={() => setAnalysisResult(null)}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-slate-700 transition"
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
