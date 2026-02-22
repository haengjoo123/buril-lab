import React, { useState, useEffect } from 'react';
import { useFridgeStore } from '../../store/fridgeStore';
import { X, Save, Trash2, Beaker, MapPin, CalendarClock, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cabinetService } from '../../services/cabinetService';

type DisposalReason = 'used' | 'expired' | 'broken' | 'other';

const REASONS: { key: DisposalReason; i18n: string; icon: string }[] = [
    { key: 'used', i18n: 'cabinet_dispose_reason_used', icon: '✅' },
    { key: 'expired', i18n: 'cabinet_dispose_reason_expired', icon: '⏰' },
    { key: 'broken', i18n: 'cabinet_dispose_reason_broken', icon: '💔' },
    { key: 'other', i18n: 'cabinet_dispose_reason_other', icon: '📝' },
];

export const ReagentEditPanel: React.FC = () => {
    const { t } = useTranslation();
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

    // Disposal flow state
    const [showDisposalView, setShowDisposalView] = useState(false);
    const [selectedReason, setSelectedReason] = useState<DisposalReason | null>(null);
    const [isDisposing, setIsDisposing] = useState(false);

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
        }
    }, [selectedItem]);

    // Reset disposal view when panel opens/closes
    useEffect(() => {
        setShowDisposalView(false);
        setSelectedReason(null);
    }, [selectedReagentId]);

    if (!selectedReagentId || !selectedItem) return null;

    const handleSave = () => {
        updateReagent(selectedReagentId, { name, notes, expiryDate: expiryDate || undefined, capacity: capacity || undefined });
        setSelectedReagentId(null);
    };

    // Expiry status helper
    const getExpiryStatus = () => {
        if (!expiryDate) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiry = new Date(expiryDate);
        const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) return { label: '만료됨', color: 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400' };
        if (diffDays <= 30) return { label: `${diffDays}일 남음`, color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400' };
        return { label: `${diffDays}일 남음`, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400' };
    };
    const expiryStatus = getExpiryStatus();

    const handleDeleteClick = () => {
        setShowDisposalView(true);
    };

    const confirmDisposal = async () => {
        if (!selectedReason || !cabinetId) return;
        setIsDisposing(true);
        try {
            // 1. Log disposal
            await cabinetService.logDisposal(cabinetId, selectedItem.name, selectedReason);
            // 2. Remove from store
            removeReagent(selectedReagentId);
            // 3. Save cabinet state
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
        <div className="absolute left-1/2 -translate-x-1/2 top-16 w-[calc(100%-32px)] max-w-[320px] bg-white/95 backdrop-blur shadow-xl rounded-xl border border-gray-200 flex flex-col overflow-hidden z-30 animate-in slide-in-from-bottom duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b bg-gray-50/50">
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
                    <div className="p-3 flex flex-col gap-2">
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
                            {isDisposing ? '처리 중...' : t('cabinet_delete')}
                        </button>
                    </div>
                </>
            ) : (
                <>
                    {/* Content */}
                    <div className="p-3 flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-140px)]">
                        {/* Info Read-only */}
                        <div className="text-xs text-gray-500 flex flex-col gap-1">
                            <div className="flex justify-between items-center">
                                <span>{t('cabinet_label_location')}</span>
                                <span className="font-medium text-gray-700 flex items-center gap-1">
                                    <MapPin size={10} />
                                    {selectedItem.shelfLevel === 0 ? '바닥면' : t('cabinet_shelf_level', { level: selectedItem.shelfLevel })}
                                    {' · '}
                                    {selectedItem.position <= 15 ? '왼쪽'
                                        : selectedItem.position <= 35 ? '중앙 왼쪽'
                                            : selectedItem.position <= 65 ? '중앙'
                                                : selectedItem.position <= 85 ? '중앙 오른쪽'
                                                    : '오른쪽'}
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

                        {/* Expiry Date Input */}
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                                <CalendarClock size={12} />
                                유효기간
                            </label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="date"
                                    value={expiryDate}
                                    onChange={(e) => setExpiryDate(e.target.value)}
                                    className="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                />
                                {expiryDate && (
                                    <button
                                        type="button"
                                        onClick={() => setExpiryDate('')}
                                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                                        title="유효기간 삭제"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            {expiryStatus && (
                                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md w-fit ${expiryStatus.color}`}>
                                    {expiryStatus.label}
                                </span>
                            )}
                        </div>

                        {/* Capacity Input */}
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                                <Beaker size={12} />
                                용량(규격)
                            </label>
                            <input
                                type="text"
                                value={capacity}
                                onChange={(e) => setCapacity(e.target.value)}
                                className="w-full px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                placeholder="예: 500mL, 1kg, 50% 남음"
                            />
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="p-3 border-t bg-gray-50/50 flex items-center justify-between gap-2 shrink-0">
                        <button
                            onClick={handleDeleteClick}
                            className="px-3.5 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1.5 transition-colors"
                        >
                            <Trash2 size={16} />
                            {t('cabinet_delete')}
                        </button>
                        <button
                            onClick={handleSave}
                            className="flex-1 px-3.5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                        >
                            <Save size={16} />
                            {t('cabinet_save')}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};
