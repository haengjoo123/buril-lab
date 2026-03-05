import React, { useState, useEffect, useRef } from 'react';
import { X, Save, AlertCircle, CheckCircle2, History, Loader2 } from 'lucide-react';
import { inventoryService, type InventoryItem, type CreateInventoryInput, type StorageLocation } from '../../services/inventoryService';
import { cabinetService, type Cabinet } from '../../services/cabinetService';
import { auditService, type AuditLog } from '../../services/auditService';
import { useFridgeStore } from '../../store/fridgeStore';
import type { ReagentPlacement, ReagentTemplateType } from '../../types/fridge';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    locations: StorageLocation[];
    initialData?: InventoryItem | null;
    onSaved: () => void;
}

export const InventoryFormModal: React.FC<Props> = ({ isOpen, onClose, locations, initialData, onSaved }) => {
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cabinets, setCabinets] = useState<Cabinet[]>([]);
    const [successToastMessage, setSuccessToastMessage] = useState<string | null>(null);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    const [formData, setFormData] = useState<CreateInventoryInput>({
        name: '',
        brand: '',
        product_number: '',
        cas_number: '',
        quantity: 1,
        capacity: '',
        storage_type: 'other',
        cabinet_id: '',
        storage_location_id: '',
        expiry_date: '',
        memo: '',
    });
    const isEditingCabinetItem = initialData?._source === 'cabinet_item';

    useEffect(() => {
        if (isOpen) {
            // Fetch cabinets when modal opens
            cabinetService.getCabinets().then(setCabinets).catch(console.error);

            if (initialData) {
                setIsLoadingLogs(true);
                auditService.getLogs({ entity_id: initialData.id, limit: 10 })
                    .then(setAuditLogs)
                    .catch(console.error)
                    .finally(() => setIsLoadingLogs(false));

                setFormData({
                    name: initialData.name,
                    brand: initialData.brand || '',
                    product_number: initialData.product_number || '',
                    cas_number: initialData.cas_number || '',
                    quantity: initialData.quantity,
                    capacity: initialData.capacity || '',
                    storage_type: initialData.storage_type,
                    cabinet_id: initialData.cabinet_id || '',
                    storage_location_id: initialData.storage_location_id || '',
                    expiry_date: initialData.expiry_date || '',
                    memo: initialData.memo || '',
                });
            } else {
                setFormData({
                    name: '',
                    brand: '',
                    product_number: '',
                    cas_number: '',
                    quantity: 1,
                    capacity: '',
                    storage_type: locations.length > 0 ? 'other' : 'cabinet',
                    cabinet_id: '',
                    storage_location_id: locations.length > 0 ? locations[0].id : '',
                    expiry_date: '',
                    memo: '',
                });
            }
            setError(null);
        }
    }, [isOpen, initialData, locations]);

    useEffect(() => {
        return () => {
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        };
    }, []);

    // Handle form changes
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;

        if (name === 'quantity') {
            const parsed = parseInt(value, 10);
            setFormData(prev => ({ ...prev, [name]: isNaN(parsed) ? 1 : Math.max(1, parsed) }));
            return;
        }

        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name.trim()) {
            setError('시약/물품 이름을 입력해주세요.');
            return;
        }

        if (formData.storage_type === 'cabinet' && !formData.cabinet_id) {
            setError('보관할 시약장을 선택해주세요.');
            return;
        }

        if (formData.storage_type === 'other' && !formData.storage_location_id) {
            setError('기타 보관 장소를 선택해주세요.');
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            if (initialData) {
                await inventoryService.updateItem(initialData.id, formData, initialData._source || 'inventory');
            } else {
                const createdItem = await inventoryService.createItem(formData);
                if (!createdItem) {
                    throw new Error('재고 등록에 실패했습니다.');
                }

                // 수동 등록에서도 시약장 선택 시 실제 3D 시약장 빈 공간에 자동 배치
                if (formData.storage_type === 'cabinet' && formData.cabinet_id) {
                    const isPlaced = await placeToCabinet(createdItem.id, formData);
                    if (!isPlaced) {
                        onSaved();
                        setError('재고 등록은 완료되었지만 시약장에 빈 공간이 없어 자동 배치되지 않았습니다.');
                        return;
                    }
                    // 모달이 닫힌 뒤에도 짧게 성공 피드백을 보여 중복 입력을 줄입니다.
                    setSuccessToastMessage('시약장 빈 공간에 자동 배치되었습니다.');
                    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
                    toastTimerRef.current = setTimeout(() => setSuccessToastMessage(null), 1800);
                }
            }
            onSaved();
            onClose();
        } catch (err: unknown) {
            console.error('Failed to save inventory:', err);
            const message = err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.';
            setError(message);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen && !successToastMessage) return null;

    return (
        <>
            {successToastMessage && (
                <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[230] animate-in slide-in-from-top-3 fade-in duration-200">
                    <div className="bg-emerald-600 text-white px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        {successToastMessage}
                    </div>
                </div>
            )}

            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

                    <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
                            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                                {initialData ? '재고 수정' : '재고 수동 등록'}
                            </h2>
                            <button onClick={onClose} className="p-1 -mr-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 py-5 scrollbar-thin">
                            <form id="inventory-form" onSubmit={handleSubmit} className="flex flex-col gap-4">

                                {error && (
                                    <div className="flex bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm gap-2">
                                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                        <span>{error}</span>
                                    </div>
                                )}

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">이름 <span className="text-red-500">*</span></label>
                                    <input
                                        name="name"
                                        value={formData.name}
                                        onChange={handleChange}
                                        placeholder="예: 염산, 비커 등"
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">브랜드</label>
                                        <input
                                            name="brand"
                                            value={formData.brand}
                                            onChange={handleChange}
                                            placeholder="예: Sigma"
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">제품번호 (PN)</label>
                                        <input
                                            name="product_number"
                                            value={formData.product_number}
                                            onChange={handleChange}
                                            placeholder="예: A1234"
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono text-slate-900 dark:text-slate-100"
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">CAS Number</label>
                                    <input
                                        name="cas_number"
                                        value={formData.cas_number}
                                        onChange={handleChange}
                                        placeholder="예: 7647-01-0"
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono text-slate-900 dark:text-slate-100"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">용량</label>
                                        <input
                                            name="capacity"
                                            value={formData.capacity}
                                            onChange={handleChange}
                                            placeholder="예: 500mL, 1kg"
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">수량 <span className="text-red-500">*</span></label>
                                        <input
                                            name="quantity"
                                            type="number"
                                            min="1"
                                            value={formData.quantity}
                                            onChange={handleChange}
                                            disabled={isEditingCabinetItem}
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-slate-900 dark:text-slate-100"
                                        />
                                        {isEditingCabinetItem && (
                                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                                시약장 항목 수량은 3D 시약장 위치 기준으로 관리됩니다.
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* 보관 위치 지정 */}
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3 mt-2">
                                    <label className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">보관 위치 설정</label>

                                    <div className="flex gap-2">
                                        <button type="button" disabled={isEditingCabinetItem} onClick={() => setFormData(prev => ({ ...prev, storage_type: 'cabinet' }))} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${formData.storage_type === 'cabinet' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'bg-white dark:bg-slate-700 text-slate-500 border border-slate-200 dark:border-slate-600'} ${isEditingCabinetItem ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                            시약장에 보관
                                        </button>
                                        <button type="button" disabled={isEditingCabinetItem} onClick={() => setFormData(prev => ({ ...prev, storage_type: 'other' }))} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${formData.storage_type === 'other' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-white dark:bg-slate-700 text-slate-500 border border-slate-200 dark:border-slate-600'} ${isEditingCabinetItem ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                            기타 위치에 보관
                                        </button>
                                    </div>
                                    {isEditingCabinetItem && (
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                            시약장 항목의 위치 이동은 시약장 화면에서 Drag & Drop으로 변경해주세요.
                                        </p>
                                    )}

                                    {formData.storage_type === 'cabinet' && (
                                        <select
                                            name="cabinet_id"
                                            value={formData.cabinet_id}
                                            onChange={handleChange}
                                            disabled={isEditingCabinetItem}
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
                                        >
                                            <option value="">-- 시약장 선택 --</option>
                                            {cabinets.map(cab => (
                                                <option key={cab.id} value={cab.id}>{cab.name}</option>
                                            ))}
                                        </select>
                                    )}

                                    {formData.storage_type === 'other' && (
                                        <select
                                            name="storage_location_id"
                                            value={formData.storage_location_id}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                                        >
                                            <option value="">-- 보관 장소 선택 --</option>
                                            {locations.map(loc => (
                                                <option key={loc.id} value={loc.id}>{loc.icon} {loc.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>

                                <div className="flex flex-col gap-1.5 mt-2">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">유효기간</label>
                                    <input
                                        name="expiry_date"
                                        type="date"
                                        value={formData.expiry_date}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100 min-h-[42px]"
                                    />
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">메모</label>
                                    <textarea
                                        name="memo"
                                        value={formData.memo}
                                        onChange={handleChange}
                                        placeholder="특이사항, 보관 방법 등"
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100"
                                    />
                                </div>

                                {initialData && (
                                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                                            <History className="w-4 h-4" /> 변경 이력
                                        </h3>
                                        {isLoadingLogs ? (
                                            <div className="flex justify-center p-4">
                                                <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                                            </div>
                                        ) : auditLogs.length === 0 ? (
                                            <p className="text-xs text-slate-500 text-center py-2">기록이 없습니다.</p>
                                        ) : (
                                            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                                {auditLogs.map(log => (
                                                    <div key={log.id} className="bg-slate-50 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                                                        <div className="flex justify-between items-center mb-1">
                                                            <span className={`font-semibold px-1.5 py-0.5 rounded text-[10px] ${log.action === 'create' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
                                                                    log.action === 'update' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' :
                                                                        'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
                                                                }`}>
                                                                {log.action === 'update' ? '수정' : log.action === 'create' ? '등록' : log.action}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400">
                                                                {new Date(log.created_at).toLocaleString('ko-KR')}
                                                            </span>
                                                        </div>
                                                        {log.actor_name && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">작업자: {log.actor_name}</div>}
                                                        {log.diff_data && Object.keys(log.diff_data).length > 0 && (
                                                            <div className="mt-1 flex flex-col gap-0.5">
                                                                {Object.entries(log.diff_data).map(([k, v]) => (
                                                                    <div key={k} className="flex gap-1 text-[10px] items-center">
                                                                        <span className="text-slate-400 w-16 shrink-0 truncate">{k}:</span>
                                                                        <span className="line-through text-red-500/70 truncate break-all">{JSON.stringify(v.from)}</span>
                                                                        <span className="text-slate-400 shrink-0">→</span>
                                                                        <span className="text-emerald-600 dark:text-emerald-400 truncate break-all">{JSON.stringify(v.to)}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </form>
                        </div>
                        <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-end gap-3 sticky bottom-0">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-400 font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
                            >
                                취소
                            </button>
                            <button
                                type="submit"
                                form="inventory-form"
                                disabled={isSaving}
                                className="px-6 py-2 rounded-lg text-white font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                            >
                                {isSaving ? <span className="animate-spin text-xl leading-none w-4 h-4 rounded-full border-2 border-white/30 border-t-white"></span> : <Save className="w-4 h-4" />}
                                {initialData ? '수정 내용 저장' : '등록 완료'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </>
    );

    async function placeToCabinet(inventoryId: string, input: CreateInventoryInput): Promise<boolean> {
        if (!input.cabinet_id) return false;

        const fridgeStore = useFridgeStore.getState();
        await fridgeStore.loadCabinet(input.cabinet_id);

        const template = guessTemplate(input.capacity || '');
        const placeResult = useFridgeStore.getState().autoPlaceReagent({
            id: '',
            reagentId: inventoryId,
            name: input.name,
            width: getWidthForTemplate(template),
            template,
            isAcidic: false,
            isBasic: false,
            hCodes: [],
            notes: input.memo || undefined,
            casNo: input.cas_number || undefined,
            capacity: input.capacity || undefined,
            productNumber: input.product_number || undefined,
            brand: input.brand || undefined,
            expiryDate: input.expiry_date || undefined,
        } as Omit<ReagentPlacement, 'shelfId' | 'position' | 'depthPosition'>);

        if (!placeResult) return false;

        await useFridgeStore.getState().saveCabinet();
        try {
            await cabinetService.logActivity(input.cabinet_id, 'add', input.name, undefined, input.memo || undefined);
        } catch (error) {
            console.error('Failed to log cabinet add activity:', error);
        }

        return true;
    }
};

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

function getWidthForTemplate(template: ReagentTemplateType): number {
    switch (template) {
        case 'A': return 8;
        case 'B': return 6;
        case 'C': return 12;
        case 'D': return 14;
        default: return 8;
    }
}
