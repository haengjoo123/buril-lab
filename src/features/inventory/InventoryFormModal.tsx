import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Save, AlertCircle, CheckCircle2, History, Loader2 } from 'lucide-react';
import { inventoryService, type InventoryItem, type CreateInventoryInput, type StorageLocation } from '../../services/inventoryService';
import { cabinetService, type Cabinet } from '../../services/cabinetService';
import { auditService, type AuditLog } from '../../services/auditService';
import { useFridgeStore } from '../../store/fridgeStore';
import type { ReagentPlacement, ReagentTemplateType } from '../../types/fridge';
import { supabase } from '../../services/supabaseClient';
import { AppSelect } from '../../components/AppSelect';

import { translateLocationName } from '../../utils/i18nUtils';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    locations: StorageLocation[];
    initialData?: InventoryItem | null;
    onSaved: () => void;
}

export const InventoryFormModal: React.FC<Props> = ({ isOpen, onClose, locations, initialData, onSaved }) => {
    const { t, i18n } = useTranslation();
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
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
            setError(t('msg_input_required_name'));
            return;
        }

        if (formData.storage_type === 'cabinet' && !formData.cabinet_id) {
            setError(t('msg_select_cabinet'));
            return;
        }

        if (formData.storage_type === 'other' && !formData.storage_location_id) {
            setError(t('msg_select_location'));
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            if (initialData) {
                const isStorageChanged = initialData.storage_type !== formData.storage_type
                    || (formData.storage_type === 'cabinet' && (initialData.cabinet_id || '') !== (formData.cabinet_id || ''))
                    || (formData.storage_type === 'other' && (initialData.storage_location_id || '') !== (formData.storage_location_id || ''));

                if (isStorageChanged) {
                    await moveItemStorage(initialData, formData);
                } else {
                    await inventoryService.updateItem(initialData.id, formData, initialData._source || 'inventory');
                }
            } else {
                const createdItem = await inventoryService.createItem(formData);
                if (!createdItem) {
                    throw new Error(t('inventory_error'));
                }

                // 수동 등록에서도 시약장 선택 시 실제 3D 시약장 빈 공간에 자동 배치
                if (formData.storage_type === 'cabinet' && formData.cabinet_id) {
                    const isPlaced = await placeToCabinet(createdItem.id, formData);
                    if (!isPlaced) {
                        onSaved();
                        setError(t('inventory_auto_placed_fail'));
                        return;
                    }
                    // 모달이 닫힌 뒤에도 짧게 성공 피드백을 보여 중복 입력을 줄입니다.
                    setSuccessToastMessage(t('inventory_auto_placed'));
                    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
                    toastTimerRef.current = setTimeout(() => setSuccessToastMessage(null), 1800);
                }
            }
            onSaved();
            onClose();
        } catch (err: unknown) {
            console.error('Failed to save inventory:', err);
            const message = err instanceof Error ? err.message : t('error_save_generic');
            setError(message);
        } finally {
            setIsSaving(false);
        }
    };

    async function moveItemStorage(sourceItem: InventoryItem, input: CreateInventoryInput): Promise<void> {
        if (input.storage_type === 'cabinet') {
            if (!input.cabinet_id) throw new Error('보관할 시약장을 선택해주세요.');

            const geometry = await getSourceGeometry(sourceItem, input);
            const targetStore = useFridgeStore.getState();
            await targetStore.loadCabinet(input.cabinet_id);

            const placed = targetStore.autoPlaceReagent({
                id: '',
                reagentId: sourceItem.id,
                name: input.name.trim(),
                width: geometry.width,
                template: geometry.template,
                isAcidic: false,
                isBasic: false,
                hCodes: [],
                notes: input.memo || undefined,
                casNo: input.cas_number || undefined,
                capacity: input.capacity || undefined,
                productNumber: input.product_number || undefined,
                brand: input.brand || undefined,
                expiryDate: input.expiry_date || undefined,
            });
            if (!placed) {
                throw new Error('재고 이동 실패: 대상 시약장에 빈 공간이 없습니다.');
            }

            await persistLoadedCabinetStateStrict(input.cabinet_id);
            cabinetService.logActivity(input.cabinet_id, 'add', input.name, undefined, input.memo || undefined)
                .catch(console.error);

            let createdInventoryId: string | null = null;
            try {
                if (sourceItem._source === 'inventory') {
                    await inventoryService.updateItem(sourceItem.id, {
                        ...input,
                        storage_type: 'cabinet',
                        cabinet_id: input.cabinet_id,
                    }, 'inventory');
                }

                if (sourceItem.storage_type === 'cabinet' && sourceItem.cabinet_id && sourceItem.cabinet_id !== input.cabinet_id) {
                    const removed = await removeSourceCabinetRow(sourceItem);
                    if (!removed) throw new Error('원본 시약장에서 항목 제거에 실패했습니다.');
                }
            } catch (error) {
                // Roll back target cabinet placement on downstream failures
                await rollbackPlacementInCabinet(input.cabinet_id, placed.itemId);
                if (createdInventoryId) {
                    await supabase.from('inventory').delete().eq('id', createdInventoryId);
                }
                throw error;
            }
            return;
        }

        // Move to 'other' storage
        if (!input.storage_location_id) throw new Error('기타 보관 장소를 선택해주세요.');

        if (sourceItem._source === 'inventory') {
            await inventoryService.updateItem(sourceItem.id, {
                ...input,
                storage_type: 'other',
                storage_location_id: input.storage_location_id,
            }, 'inventory');
            if (sourceItem.storage_type === 'cabinet' && sourceItem.cabinet_id) {
                const removed = await removeSourceCabinetRow(sourceItem);
                if (!removed) {
                    // Revert inventory row when cabinet sync fails
                    await inventoryService.updateItem(sourceItem.id, {
                        storage_type: 'cabinet',
                        cabinet_id: sourceItem.cabinet_id,
                    }, 'inventory');
                    throw new Error('원본 시약장 동기화에 실패했습니다.');
                }
            }
            return;
        }

        // cabinet_item -> other: create inventory row then remove source cabinet item
        const created = await inventoryService.createItem({
            ...input,
            storage_type: 'other',
            storage_location_id: input.storage_location_id,
            quantity: 1,
        });
        if (!created) throw new Error('기타 위치 이동을 위한 재고 생성에 실패했습니다.');

        const removed = await removeSourceCabinetRow(sourceItem);
        if (!removed) {
            await supabase.from('inventory').delete().eq('id', created.id);
            throw new Error('원본 시약장 제거에 실패해 이동을 취소했습니다.');
        }
    }

    async function getSourceGeometry(sourceItem: InventoryItem, input: CreateInventoryInput): Promise<{ template: ReagentTemplateType; width: number }> {
        if (sourceItem.storage_type === 'cabinet' && sourceItem.cabinet_id) {
            const store = useFridgeStore.getState();
            await store.loadCabinet(sourceItem.cabinet_id);
            const placement = store.shelves
                .flatMap(shelf => shelf.items)
                .find((placed) => placed.id === sourceItem.id
                    || (placed.reagentId === sourceItem.id)
                    || (
                        normalizeText(placed.name) === normalizeText(sourceItem.name)
                        && normalizeText(placed.brand) === normalizeText(sourceItem.brand)
                        && normalizeText(placed.productNumber) === normalizeText(sourceItem.product_number)
                        && normalizeText(placed.capacity) === normalizeText(sourceItem.capacity)
                        && normalizeText(placed.casNo) === normalizeText(sourceItem.cas_number)
                    ));
            if (placement) {
                return {
                    template: placement.template as ReagentTemplateType,
                    width: placement.width,
                };
            }
        }
        const template = guessTemplate((input.capacity || sourceItem.capacity || '').toString());
        return { template, width: getWidthForTemplate(template) };
    }

    async function removeSourceCabinetRow(sourceItem: InventoryItem): Promise<boolean> {
        if (sourceItem.storage_type !== 'cabinet' || !sourceItem.cabinet_id) return true;

        const sourceCabinetId = sourceItem.cabinet_id;

        if (sourceItem._source === 'cabinet_item') {
            const { data, error } = await supabase
                .from('cabinet_items')
                .delete()
                .eq('cabinet_id', sourceCabinetId)
                .eq('id', sourceItem.id)
                .select('id');
            if (error) {
                console.error('Failed to remove source cabinet_item row:', error);
                return false;
            }
            if ((data || []).length > 0) {
                cabinetService.logActivity(sourceCabinetId, 'remove', sourceItem.name, '모달 위치 이동', sourceItem.memo || undefined)
                    .catch(console.error);
                return true;
            }
        }

        const store = useFridgeStore.getState();
        await store.loadCabinet(sourceCabinetId);
        const placement = store.shelves
            .flatMap(shelf => shelf.items)
            .find((placed) =>
                placed.id === sourceItem.id
                || (
                    normalizeText(placed.name) === normalizeText(sourceItem.name)
                    && normalizeText(placed.brand) === normalizeText(sourceItem.brand)
                    && normalizeText(placed.productNumber) === normalizeText(sourceItem.product_number)
                    && normalizeText(placed.capacity) === normalizeText(sourceItem.capacity)
                    && normalizeText(placed.casNo) === normalizeText(sourceItem.cas_number)
                )
            );
        if (!placement) return false;

        store.removeReagent(placement.id);
        await persistLoadedCabinetStateStrict(sourceCabinetId);
        cabinetService.logActivity(sourceCabinetId, 'remove', sourceItem.name, '모달 위치 이동', sourceItem.memo || undefined)
            .catch(console.error);
        return true;
    }

    async function rollbackPlacementInCabinet(cabinetId: string, itemId: string): Promise<void> {
        const store = useFridgeStore.getState();
        await store.loadCabinet(cabinetId);
        const rollbackTarget = store.shelves.flatMap(shelf => shelf.items).find(item => item.id === itemId);
        if (!rollbackTarget) return;
        store.removeReagent(itemId);
        await persistLoadedCabinetStateStrict(cabinetId);
    }

    async function persistLoadedCabinetStateStrict(expectedCabinetId: string): Promise<void> {
        const state = useFridgeStore.getState();
        if (!state.cabinetId || state.cabinetId !== expectedCabinetId) {
            throw new Error('시약장 상태가 동기화되지 않아 저장을 중단했습니다.');
        }
        await cabinetService.saveCabinetState(expectedCabinetId, state.shelves);
        await cabinetService.updateCabinet(expectedCabinetId, {
            width: state.cabinetWidth,
            height: state.cabinetHeight,
            depth: state.cabinetDepth,
        });
    }

    function normalizeText(value?: string | null): string {
        return (value || '').trim().toLowerCase();
    }

    const resolveLocationLabel = (storageType: 'cabinet' | 'other', cabinetId?: string | null, locationId?: string | null): string => {
        if (storageType === 'cabinet') {
            const cabinetName = cabinets.find(cab => cab.id === (cabinetId || ''))?.name || t('inventory_unspecified');
            return `${t('inventory_loc_cabinet')} · ${cabinetName}`;
        }
        const location = locations.find(loc => loc.id === (locationId || ''));
        if (!location) return `${t('inventory_loc_other')} · ${t('inventory_unspecified')}`;
        
        const locName = translateLocationName(location.name, t);
        
        return `${t('inventory_loc_other')} · ${location.icon} ${locName}`;
    };

    const currentLocationLabel = initialData
        ? resolveLocationLabel(initialData.storage_type, initialData.cabinet_id, initialData.storage_location_id)
        : t('inventory_new_registration');
    const targetLocationLabel = resolveLocationLabel(
        formData.storage_type,
        formData.cabinet_id,
        formData.storage_location_id
    );
    const cabinetOptions = cabinets.map((cab) => ({
        value: cab.id,
        label: cab.name,
    }));
    const locationOptions = locations.map((loc) => ({
        value: loc.id,
        label: `${loc.icon} ${translateLocationName(loc.name, t)}`,
    }));
    const isLocationChanged = initialData
        ? (
            initialData.storage_type !== formData.storage_type
            || (formData.storage_type === 'cabinet' && (initialData.cabinet_id || '') !== (formData.cabinet_id || ''))
            || (formData.storage_type === 'other' && (initialData.storage_location_id || '') !== (formData.storage_location_id || ''))
        )
        : Boolean(formData.cabinet_id || formData.storage_location_id);

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
                                {initialData ? t('inventory_modal_title_edit') : t('inventory_modal_title_add')}
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
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('inventory_product_name')} <span className="text-red-500">*</span></label>
                                    <input
                                        name="name"
                                        value={formData.name}
                                        onChange={handleChange}
                                        placeholder={t('inventory_product_name_placeholder')}
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('inventory_brand')}</label>
                                        <input
                                            name="brand"
                                            value={formData.brand}
                                            onChange={handleChange}
                                            placeholder={t('inventory_brand_placeholder')}
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('inventory_product_number')}</label>
                                        <input
                                            name="product_number"
                                            value={formData.product_number}
                                            onChange={handleChange}
                                            placeholder={t('inventory_pn_placeholder')}
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono text-slate-900 dark:text-slate-100"
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('inventory_cas_number')}</label>
                                    <input
                                        name="cas_number"
                                        value={formData.cas_number}
                                        onChange={handleChange}
                                        placeholder={t('inventory_cas_placeholder')}
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono text-slate-900 dark:text-slate-100"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('inventory_capacity')}</label>
                                        <input
                                            name="capacity"
                                            value={formData.capacity}
                                            onChange={handleChange}
                                            placeholder={t('inventory_capacity_placeholder')}
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('inventory_quantity')} <span className="text-red-500">*</span></label>
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
                                                {t('inventory_qty_notice')}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* 보관 위치 지정 */}
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3 mt-2">
                                    <label className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">{t('inventory_storage_type')}</label>

                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => setFormData(prev => ({ ...prev, storage_type: 'cabinet' }))} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${formData.storage_type === 'cabinet' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'bg-white dark:bg-slate-700 text-slate-500 border border-slate-200 dark:border-slate-600'}`}>
                                            {t('inventory_storage_cabinet')}
                                        </button>
                                        <button type="button" onClick={() => setFormData(prev => ({ ...prev, storage_type: 'other' }))} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${formData.storage_type === 'other' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-white dark:bg-slate-700 text-slate-500 border border-slate-200 dark:border-slate-600'}`}>
                                            {t('inventory_storage_other')}
                                        </button>
                                    </div>
                                    {isEditingCabinetItem && (
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                            {t('inventory_move_notice')}
                                        </p>
                                    )}

                                    {formData.storage_type === 'cabinet' && (
                                        <AppSelect
                                            value={formData.cabinet_id || ''}
                                            onChange={(value) => setFormData((prev) => ({ ...prev, cabinet_id: value }))}
                                            options={cabinetOptions}
                                            placeholder={`-- ${t('inventory_select_cabinet')} --`}
                                            buttonClassName="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                                        />
                                    )}

                                    {formData.storage_type === 'other' && (
                                        <AppSelect
                                            value={formData.storage_location_id || ''}
                                            onChange={(value) => setFormData((prev) => ({ ...prev, storage_location_id: value }))}
                                            options={locationOptions}
                                            placeholder={`-- ${t('inventory_select_location')} --`}
                                            buttonClassName="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                                        />
                                    )}

                                    {/* 현재 위치 -> 변경 위치 미리보기 */}
                                    <div className={`rounded-lg border px-3 py-2 text-xs ${isLocationChanged
                                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                                        }`}>
                                        <span className="font-semibold">{t('inventory_current_location')}</span>
                                        <span className="mx-1">→</span>
                                        <span className="font-semibold">{t('inventory_change_location')}</span>
                                        <div className="mt-1 leading-relaxed">
                                            {currentLocationLabel}
                                            <span className="mx-1.5">→</span>
                                            {targetLocationLabel}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-1.5 mt-2">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('inventory_expiry_date')}</label>
                                    <input
                                        name="expiry_date"
                                        type="date"
                                        value={formData.expiry_date}
                                        onChange={handleChange}
                                        lang={i18n.language.startsWith('ko') ? 'ko' : 'en-US'}
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100 min-h-[42px]"
                                    />
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('inventory_memo')}</label>
                                    <textarea
                                        name="memo"
                                        value={formData.memo}
                                        onChange={handleChange}
                                        placeholder={t('inventory_memo_placeholder')}
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100"
                                    />
                                </div>

                                {initialData && (
                                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                                            <History className="w-4 h-4" /> {t('history_log', '변경 이력')}
                                        </h3>
                                        {isLoadingLogs ? (
                                            <div className="flex justify-center p-4">
                                                <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                                            </div>
                                        ) : auditLogs.length === 0 ? (
                                            <p className="text-xs text-slate-500 text-center py-2">{t('log_empty', '기록이 없습니다.')}</p>
                                        ) : (
                                            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                                {auditLogs.map(log => (
                                                    <div key={log.id} className="bg-slate-50 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                                                        <div className="flex justify-between items-center mb-1">
                                                             <span className={`font-semibold px-1.5 py-0.5 rounded text-[10px] ${log.action === 'create' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
                                                                    log.action === 'update' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' :
                                                                        'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
                                                                }`}>
                                                                {log.action === 'update' ? t('log_action_update', '수정') : log.action === 'create' ? t('log_action_create', '등록') : log.action}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400">
                                                                {new Date(log.created_at).toLocaleString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US')}
                                                            </span>
                                                        </div>
                                                        {log.actor_name && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">{t('log_handler_label', '작업자')}: {log.actor_name}</div>}
                                                        {log.diff_data && Object.keys(log.diff_data).length > 0 && (
                                                            <div className="mt-1 flex flex-col gap-0.5">
                                                                {Object.entries(log.diff_data).map(([k, v]: [string, any]) => (
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
                                {t('btn_cancel')}
                            </button>
                            <button
                                type="submit"
                                form="inventory-form"
                                disabled={isSaving}
                                className="px-6 py-2 rounded-lg text-white font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                            >
                                {isSaving ? <span className="animate-spin text-xl leading-none w-4 h-4 rounded-full border-2 border-white/30 border-t-white"></span> : <Save className="w-4 h-4" />}
                                {initialData ? t('cabinet_save') : t('inventory_register_btn')}
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
