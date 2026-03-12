import React, { useState, useEffect } from 'react';
import { useFridgeStore } from '../../store/fridgeStore';
import { X, Save, Trash2, Beaker, MapPin, CalendarClock, CheckCircle2, Tag, Package, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cabinetService } from '../../services/cabinetService';
import { inventoryService } from '../../services/inventoryService';
import type { ReagentTemplateType } from '../../types/fridge';
import { CONTAINER_BASE_WIDTHS } from './ReagentItem';
import { getExpiryStatus, getExpiryBadgeClasses } from '../../utils/expiryStatus';
import { classifyStorageGroups, checkShelfCompatibility, getStorageGroupLabels } from '../../utils/storageCompatibilityChecker';
import { AlertTriangle, FlaskConical } from 'lucide-react';

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
    { type: 'C', label: 'cabinet_container_solvent', icon: '🥫' },
    { type: 'D', label: 'cabinet_container_vial', icon: '📦' },
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
    const [brand, setBrand] = useState('');
    const [productNumber, setProductNumber] = useState('');
    const [casNo, setCasNo] = useState('');

    // Disposal flow state
    const [showDisposalView, setShowDisposalView] = useState(false);
    const [selectedReason, setSelectedReason] = useState<DisposalReason | null>(null);
    const [isDisposing, setIsDisposing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Find the selected item from all shelves
    const selectedItem = React.useMemo(() => {
        if (!selectedReagentId) return null;
        for (const shelf of shelves) {
            const item = shelf.items.find(i => i.id === selectedReagentId);
            if (item) return { ...item, shelfLevel: shelf.level };
        }
        return null;
    }, [selectedReagentId, shelves]);

    // Update local state when selection changes
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
        }
    }, [selectedItem]);

    // Reset disposal view when panel opens/closes
    useEffect(() => {
        setShowDisposalView(false);
        setSelectedReason(null);
    }, [selectedReagentId]);

    if (!selectedReagentId || !selectedItem) return null;

    const handleSave = async () => {
        if (isSaving) return;

        // Calculate new width if template changed
        const newWidth = template !== selectedItem.template
            ? (CONTAINER_BASE_WIDTHS[template] || 8)
            : undefined;

        const updatePayload = {
            name,
            memo: notes || undefined,
            expiry_date: expiryDate || undefined,
            capacity: capacity || undefined,
            brand: brand || undefined,
            product_number: productNumber || undefined,
            cas_number: casNo || undefined,
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
            ...(newWidth !== undefined && { width: newWidth }),
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

    return (
        <div className="absolute left-1/2 -translate-x-1/2 top-16 w-[calc(100%-32px)] max-w-[320px] max-h-[calc(100%-80px-5rem)] bg-white/95 backdrop-blur shadow-xl rounded-xl border border-gray-200 flex flex-col overflow-hidden z-30 animate-in slide-in-from-bottom duration-200">
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
                            <label className="text-xs font-medium text-gray-600">{t('cabinet_reagent_name')}</label>
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

                        {/* Container Type Selection */}
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                                {t('cabinet_label_type')}
                            </label>
                            <div className="grid grid-cols-4 gap-1.5">
                                {CONTAINER_TYPES.map((ct) => (
                                    <button
                                        key={ct.type}
                                        onClick={() => setTemplate(ct.type)}
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
                            {casNo && (
                                <p className="text-[10px] text-gray-400">
                                    {t('cabinet_pubchem_auto_enrich')}
                                </p>
                            )}
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
    );
};
