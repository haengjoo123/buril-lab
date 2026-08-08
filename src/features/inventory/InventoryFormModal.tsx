import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Save, AlertCircle, CheckCircle2, History, Loader2 } from 'lucide-react';
import { analyticsService } from '../../services/analyticsService';
import { inventoryService, type InventoryItem, type CreateInventoryInput, type StorageLocation } from '../../services/inventoryService';
import { cabinetService, type Cabinet } from '../../services/cabinetService';
import { auditService, type AuditLog } from '../../services/auditService';
import { useFridgeStore } from '../../store/fridgeStore';
import type { ReagentPlacement, ReagentTemplateType } from '../../types/fridge';
import { supabase } from '../../services/supabaseClient';
import { AppSelect } from '../../components/AppSelect';
import { CasSuggestionCard } from '../../components/CasSuggestionCard';
import { ReagentDateFields } from '../../components/ReagentDateFields';

import { translateLocationName } from '../../utils/i18nUtils';
import { guessTemplateFromCapacity, getWidthForTemplate } from '../../utils/guessReagentTemplate';
import { getSuggestedCasInputMethod, useCasSuggestion } from '../../hooks/useCasSuggestion';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    locations: StorageLocation[];
    initialData?: InventoryItem | null;
    initialDraft?: Partial<CreateInventoryInput> | null;
    entryMode?: 'manual_form' | 'scan_prefill';
    onSaved: () => void;
}

export const InventoryFormModal: React.FC<Props> = ({
    isOpen,
    onClose,
    locations,
    initialData,
    initialDraft = null,
    entryMode = 'manual_form',
    onSaved,
}) => {
    const { t, i18n } = useTranslation();
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cabinets, setCabinets] = useState<Cabinet[]>([]);
    const [successToastMessage, setSuccessToastMessage] = useState<string | null>(null);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [showQtyNotice, setShowQtyNotice] = useState(false);

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
        manufacturer_date_type: 'unlabeled',
        received_date: '',
        opened_date: '',
        memo: '',
        remaining_percent: 100,
    });
    const isEditingCabinetItem = initialData?._source === 'cabinet_item';
    const casSuggestion = useCasSuggestion({
        enabled: isOpen,
        inputName: formData.name,
        casNumber: formData.cas_number || '',
        sourceType: 'inventory_form_modal',
        brand: formData.brand,
        productNumber: formData.product_number,
        capacity: formData.capacity,
        onApplyCasNumber: (casNumber) => {
            setFormData(prev => ({ ...prev, cas_number: casNumber }));
        },
    });

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
                    manufacturer_date_type: initialData.manufacturer_date_type || 'unlabeled',
                    received_date: initialData.received_date || '',
                    opened_date: initialData.opened_date || '',
                    memo: initialData.memo || '',
                    remaining_percent: initialData.remaining_percent ?? 100,
                });
            } else {
                const defaultStorageType = locations.length > 0 ? 'other' : 'cabinet';
                const draftStorageType = initialDraft?.storage_type || defaultStorageType;
                setFormData({
                    name: initialDraft?.name || '',
                    brand: initialDraft?.brand || '',
                    product_number: initialDraft?.product_number || '',
                    cas_number: initialDraft?.cas_number || '',
                    quantity: initialDraft?.quantity ?? 1,
                    capacity: initialDraft?.capacity || '',
                    storage_type: draftStorageType,
                    cabinet_id: draftStorageType === 'cabinet' ? (initialDraft?.cabinet_id || '') : '',
                    storage_location_id: draftStorageType === 'other'
                        ? (initialDraft?.storage_location_id || (locations.length > 0 ? locations[0].id : ''))
                        : '',
                    expiry_date: initialDraft?.expiry_date || '',
                    manufacturer_date_type: initialDraft?.manufacturer_date_type || 'unlabeled',
                    received_date: initialDraft?.received_date || '',
                    opened_date: initialDraft?.opened_date || '',
                    memo: initialDraft?.memo || '',
                    remaining_percent: initialDraft?.remaining_percent ?? 100,
                });
            }
            setError(null);
        }
    }, [isOpen, initialData, locations, initialDraft]);

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

        if (name === 'name') {
            casSuggestion.markNameInputChanged();
        }

        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const scanDraftCasNumber = entryMode === 'scan_prefill' ? (initialDraft?.cas_number || '').trim() : '';
    const fallbackCasInputMethod = formData.cas_number?.trim()
        ? (scanDraftCasNumber && formData.cas_number.trim() === scanDraftCasNumber ? 'scan' : 'manual')
        : 'unknown';
    const currentCasInputMethod = getSuggestedCasInputMethod(
        casSuggestion.isSuggestedCasApplied,
        fallbackCasInputMethod,
        casSuggestion.appliedSuggestion?.confidence,
    );

    const hasCommerceSignalChange = (before: InventoryItem, after: CreateInventoryInput) => {
        const normalize = (value?: string | null) => (value || '').trim();

        return (
            normalize(before.brand) !== normalize(after.brand) ||
            normalize(before.product_number) !== normalize(after.product_number) ||
            normalize(before.cas_number) !== normalize(after.cas_number) ||
            normalize(before.capacity) !== normalize(after.capacity) ||
            before.quantity !== (after.quantity ?? 1)
        );
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

        if (formData.expiry_date && formData.manufacturer_date_type === 'unlabeled') {
            setError(t('scan_manufacturer_date_type_required'));
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            if (initialData) {
                const isStorageChanged = initialData.storage_type !== formData.storage_type
                    || (formData.storage_type === 'cabinet' && (initialData.cabinet_id || '') !== (formData.cabinet_id || ''))
                    || (formData.storage_type === 'other' && (initialData.storage_location_id || '') !== (formData.storage_location_id || ''));
                const shouldTrackCommerceUpdate = hasCommerceSignalChange(initialData, formData);
                const casChanged = (initialData.cas_number || '').trim() !== (formData.cas_number || '').trim();

                if (isStorageChanged) {
                    await moveItemStorage(initialData, formData);
                } else {
                    await inventoryService.updateItem(initialData.id, formData, initialData._source || 'inventory');
                    if (initialData._source === 'inventory' && initialData.storage_type === 'cabinet' && initialData.cabinet_id) {
                        const synced = await inventoryService.syncLinkedCabinetItemFromInventory({
                            inventoryItemId: initialData.id,
                            cabinetId: initialData.cabinet_id,
                            updates: formData,
                        });
                        if (!synced && casChanged) {
                            await inventoryService.syncLinkedCabinetCas({
                                source: initialData._source || 'inventory',
                                sourceId: initialData.id,
                                cabinetId: initialData.cabinet_id,
                                name: initialData.name,
                                brand: initialData.brand,
                                productNumber: initialData.product_number,
                                capacity: initialData.capacity,
                                previousCasNumber: initialData.cas_number,
                                nextCasNumber: formData.cas_number,
                            });
                        }
                    } else if (initialData._source === 'cabinet_item' && initialData.linked_inventory_item_id) {
                        await inventoryService.updateItem(initialData.linked_inventory_item_id, {
                            ...formData,
                            storage_type: 'cabinet',
                            cabinet_id: initialData.cabinet_id || undefined,
                        }, 'inventory');
                    } else if (casChanged && (initialData.storage_type === 'cabinet' || initialData._source === 'cabinet_item')) {
                        await inventoryService.syncLinkedCabinetCas({
                            source: initialData._source || 'inventory',
                            sourceId: initialData.id,
                            cabinetId: initialData.cabinet_id,
                            name: initialData.name,
                            brand: initialData.brand,
                            productNumber: initialData.product_number,
                            capacity: initialData.capacity,
                            previousCasNumber: initialData.cas_number,
                            nextCasNumber: formData.cas_number,
                        });
                    }
                }
                if (shouldTrackCommerceUpdate) {
                    await analyticsService.trackCommerceIntentEvent({
                        eventType: initialData._source === 'cabinet_item' ? 'cabinet_item_updated' : 'inventory_updated',
                        sourceScreen: 'inventory_form_modal',
                        storageType: formData.storage_type,
                        sourceItemType: initialData._source || 'inventory',
                        sourceItemId: initialData.id,
                        brandName: formData.brand,
                        productNumber: formData.product_number,
                        quantity: formData.quantity,
                        capacityText: formData.capacity,
                        casNumber: formData.cas_number,
                        casInputMethod: currentCasInputMethod,
                        metadata: {
                            action: isStorageChanged ? 'move_and_update' : 'update',
                        },
                    });
                }
            } else {
                const createdItem = await inventoryService.createItem(formData);
                if (!createdItem) {
                    throw new Error(t('inventory_error'));
                }
                await analyticsService.trackCommerceIntentEvent({
                    eventType: 'inventory_registered',
                    sourceScreen: 'inventory_form_modal',
                    storageType: formData.storage_type,
                    sourceItemType: 'inventory',
                    sourceItemId: createdItem.id,
                    brandName: formData.brand,
                    productNumber: formData.product_number,
                    quantity: formData.quantity,
                    capacityText: formData.capacity,
                    casNumber: formData.cas_number,
                    casInputMethod: currentCasInputMethod,
                    metadata: {
                        entry_mode: entryMode,
                    },
                });

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

            const targetLinkId = sourceItem._source === 'inventory'
                ? sourceItem.id
                : (sourceItem.linked_inventory_item_id || null);
            const needsDeferredLink = Boolean(
                targetLinkId
                && sourceItem.storage_type === 'cabinet'
                && sourceItem.cabinet_id
                && sourceItem.cabinet_id !== input.cabinet_id
            );

            const placed = targetStore.autoPlaceReagent({
                id: '',
                reagentId: sourceItem.id,
                linkedInventoryItemId: needsDeferredLink ? undefined : (targetLinkId || undefined),
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
                manufacturerDateType: input.manufacturer_date_type,
                receivedDate: input.received_date || undefined,
                openedDate: input.opened_date || undefined,
                remaining_percent: input.remaining_percent,
            });
            if (!placed) {
                throw new Error('재고 이동 실패: 대상 시약장에 빈 공간이 없습니다.');
            }

            await persistLoadedCabinetStateStrict(input.cabinet_id);
            cabinetService.logActivity(input.cabinet_id, 'add', input.name, undefined, input.memo || undefined)
                .catch(console.error);

            let inventoryUpdated = false;
            try {
                if (sourceItem._source === 'inventory') {
                    await inventoryService.updateItem(sourceItem.id, {
                        ...input,
                        storage_type: 'cabinet',
                        cabinet_id: input.cabinet_id,
                    }, 'inventory');
                    inventoryUpdated = true;
                }

                if (sourceItem.storage_type === 'cabinet' && sourceItem.cabinet_id && sourceItem.cabinet_id !== input.cabinet_id) {
                    const removed = await removeSourceCabinetRow(sourceItem);
                    if (!removed) throw new Error('원본 시약장에서 항목 제거에 실패했습니다.');
                }
            } catch (error) {
                // Roll back target cabinet placement on downstream failures
                await rollbackPlacementInCabinet(input.cabinet_id, placed.itemId);
                if (inventoryUpdated && sourceItem._source === 'inventory') {
                    await inventoryService.updateItem(sourceItem.id, {
                        storage_type: sourceItem.storage_type,
                        cabinet_id: sourceItem.storage_type === 'cabinet' ? (sourceItem.cabinet_id || undefined) : undefined,
                        storage_location_id: sourceItem.storage_type === 'other' ? (sourceItem.storage_location_id || undefined) : undefined,
                    }, 'inventory');
                }
                throw error;
            }

            if (needsDeferredLink && targetLinkId) {
                try {
                    await inventoryService.setCabinetItemInventoryLink(placed.itemId, targetLinkId);
                    useFridgeStore.getState().updateReagent(placed.itemId, {
                        linkedInventoryItemId: targetLinkId,
                        reagentId: targetLinkId,
                    });
                } catch (error) {
                    console.error('Failed to finalize cabinet inventory link after move:', error);
                }
            }

            await analyticsService.trackStorageWarningIgnoredForItem({
                cabinetId: input.cabinet_id,
                shelves: useFridgeStore.getState().shelves,
                relatedItemId: placed.itemId,
                sourceScreen: 'inventory_form_modal',
                triggerSource: 'inventory_move_to_cabinet',
                metadata: {
                    inventory_source: sourceItem._source || 'inventory',
                },
            });
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
            await inventoryService.deleteItem({ ...created, _source: 'inventory' });
            throw new Error('원본 시약장 제거에 실패해 이동을 취소했습니다.');
        }
    }

    async function getSourceGeometry(sourceItem: InventoryItem, input: CreateInventoryInput): Promise<{ template: ReagentTemplateType; width: number }> {
        if (sourceItem.storage_type === 'cabinet' && sourceItem.cabinet_id) {
            const store = useFridgeStore.getState();
            await store.loadCabinet(sourceItem.cabinet_id);
            const placement = store.shelves
                .flatMap(shelf => shelf.items)
                .find((placed) => (
                    (sourceItem._source === 'cabinet_item' && placed.id === sourceItem.id)
                    || (sourceItem._source === 'inventory' && placed.linkedInventoryItemId === sourceItem.id)
                    || (sourceItem._source === 'inventory' && placed.reagentId === sourceItem.id)
                    || (
                        normalizeText(placed.name) === normalizeText(sourceItem.name)
                        && normalizeText(placed.brand) === normalizeText(sourceItem.brand)
                        && normalizeText(placed.productNumber) === normalizeText(sourceItem.product_number)
                        && normalizeText(placed.capacity) === normalizeText(sourceItem.capacity)
                        && normalizeText(placed.casNo) === normalizeText(sourceItem.cas_number)
                        && !placed.linkedInventoryItemId
                    )
                ));
            if (placement) {
                return {
                    template: placement.template as ReagentTemplateType,
                    width: placement.width,
                };
            }
        }
        const template = guessTemplateFromCapacity((input.capacity || sourceItem.capacity || '').toString());
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
                (sourceItem._source === 'cabinet_item' && placed.id === sourceItem.id)
                || (sourceItem._source === 'inventory' && placed.linkedInventoryItemId === sourceItem.id)
                || (sourceItem._source === 'inventory' && placed.reagentId === sourceItem.id)
                || (
                    normalizeText(placed.name) === normalizeText(sourceItem.name)
                    && normalizeText(placed.brand) === normalizeText(sourceItem.brand)
                    && normalizeText(placed.productNumber) === normalizeText(sourceItem.product_number)
                    && normalizeText(placed.capacity) === normalizeText(sourceItem.capacity)
                    && normalizeText(placed.casNo) === normalizeText(sourceItem.cas_number)
                    && !placed.linkedInventoryItemId
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
        await useFridgeStore.getState().saveCabinetStrict();
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
    const modalTitle = initialData
        ? t('inventory_modal_title_edit')
        : entryMode === 'scan_prefill'
            ? t('inventory_modal_title_scan')
            : t('inventory_modal_title_add');
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
                                {modalTitle}
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
                                        onBlur={casSuggestion.triggerLookupFromBlur}
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
                                            readOnly={isEditingCabinetItem}
                                            onClick={() => {
                                                if (isEditingCabinetItem) {
                                                    setShowQtyNotice(true);
                                                    setTimeout(() => setShowQtyNotice(false), 3000);
                                                }
                                            }}
                                            className={`w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-slate-900 dark:text-slate-100 ${isEditingCabinetItem ? 'opacity-70 cursor-not-allowed bg-slate-50 dark:bg-slate-900/50' : ''}`}
                                        />
                                        {isEditingCabinetItem && showQtyNotice && (
                                            <span className="text-[11px] text-red-500 dark:text-red-400 font-medium animate-in fade-in slide-in-from-top-1">
                                                {t('inventory_qty_notice')}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('inventory_cas_number')}</label>
                                    <input
                                        name="cas_number"
                                        value={formData.cas_number}
                                        onChange={handleChange}
                                        onFocus={casSuggestion.triggerLookupFromCasFocus}
                                        placeholder={t('inventory_cas_placeholder')}
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono text-slate-900 dark:text-slate-100"
                                    />
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
                                            inputName={formData.name}
                                            onApply={casSuggestion.applySuggestion}
                                            onDismiss={async () => {
                                                if (casSuggestion.suggestion?.casNumber) {
                                                    await analyticsService.trackCasSuggestionDismissed({
                                                        sourceScreen: 'inventory_form_modal',
                                                        storageType: formData.storage_type,
                                                        sourceItemType: initialData?._source || 'inventory',
                                                        sourceItemId: initialData?.id || null,
                                                        chemicalName: formData.name,
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
                                </div>

                                <div className="flex flex-col gap-2 mt-1">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        {t('inventory_remaining_amount')}
                                    </label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {[
                                            { stage: 1, value: 5, color: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800', active: 'bg-red-600 text-white border-red-600 dark:bg-red-600 dark:text-white' },
                                            { stage: 2, value: 30, color: 'bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800', active: 'bg-orange-500 text-white border-orange-500 dark:bg-orange-500 dark:text-white' },
                                            { stage: 3, value: 60, color: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800', active: 'bg-blue-600 text-white border-blue-600 dark:bg-blue-600 dark:text-white' },
                                            { stage: 4, value: 100, color: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800', active: 'bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-600 dark:text-white' }
                                        ].map((item) => {
                                            const val = formData.remaining_percent ?? 100;
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
                                                    onClick={() => setFormData(prev => ({ ...prev, remaining_percent: item.value }))}
                                                    className={`flex flex-col items-center justify-center py-2.5 px-1 rounded-xl border-2 transition-all duration-200 ${
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
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 ml-1 h-4">
                                        {formData.remaining_percent !== undefined && (
                                            <>
                                                {formData.remaining_percent <= 10 && t('inventory_remaining_stage_1_desc')}
                                                {formData.remaining_percent > 10 && formData.remaining_percent <= 30 && t('inventory_remaining_stage_2_desc')}
                                                {formData.remaining_percent > 30 && formData.remaining_percent <= 70 && t('inventory_remaining_stage_3_desc')}
                                                {formData.remaining_percent > 70 && t('inventory_remaining_stage_4_desc')}
                                            </>
                                        )}
                                    </p>
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

                                <ReagentDateFields
                                    className="mt-2"
                                    value={formData}
                                    onChange={(next) => setFormData((prev) => ({ ...prev, ...next }))}
                                />
                                {formData.expiry_date && formData.manufacturer_date_type === 'unlabeled' && (
                                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                                        {t('scan_manufacturer_date_type_required')}
                                    </p>
                                )}

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
                                                                {Object.entries(log.diff_data).map(([k, v]: [string, { from: unknown; to: unknown }]) => (
                                                                    <div key={k} className="flex gap-1 text-[10px] items-center">
                                                                        <span className="text-slate-400 w-24 shrink-0 truncate">{translateAuditKey(k)}:</span>
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

        const template = guessTemplateFromCapacity(input.capacity || '');
        const placeResult = useFridgeStore.getState().autoPlaceReagent({
            id: '',
            reagentId: inventoryId,
            linkedInventoryItemId: inventoryId,
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
            manufacturerDateType: input.manufacturer_date_type,
            receivedDate: input.received_date || undefined,
            openedDate: input.opened_date || undefined,
            remaining_percent: input.remaining_percent,
        } as Omit<ReagentPlacement, 'shelfId' | 'position' | 'depthPosition'>);

        if (!placeResult) return false;

        await useFridgeStore.getState().saveCabinetStrict();
        try {
            await cabinetService.logActivity(input.cabinet_id, 'add', input.name, undefined, input.memo || undefined);
        } catch (error) {
            console.error('Failed to log cabinet add activity:', error);
        }

        await analyticsService.trackStorageWarningIgnoredForItem({
            cabinetId: input.cabinet_id,
            shelves: useFridgeStore.getState().shelves,
            relatedItemId: placeResult.itemId,
            sourceScreen: 'inventory_form_modal',
            triggerSource: 'inventory_auto_place',
        });

        return true;
    }
};

