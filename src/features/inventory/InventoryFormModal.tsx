import { useAdaptiveDialog } from '../../hooks/useAdaptiveDialog';
import { formatAuditActionName } from '../../utils/auditLogFormatting';
import { AuditChangeList } from '../../components/AuditChangeList';
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Save, AlertCircle, History, Loader2 } from 'lucide-react';
import { analyticsService } from '../../services/analyticsService';
import { inventoryService, type InventoryItem, type CreateInventoryInput, type StorageLocation } from '../../services/inventoryService';
import { cabinetService, type Cabinet } from '../../services/cabinetService';
import { auditService, type AuditLog } from '../../services/auditService';
import { useFridgeStore } from '../../store/fridgeStore';
import type { ReagentPlacement, ReagentTemplateType } from '../../types/fridge';
import { supabase } from '../../services/supabaseClient';
import { AppSelect } from '../../components/AppSelect';
import { StorageLocationIcon } from '../../components/StorageLocationIcon';
import { CasSuggestionCard } from '../../components/CasSuggestionCard';
import { ReagentDateFields } from '../../components/ReagentDateFields';
import { readableImportAttributes } from './import/sourceAttributes';
import { QuantityStepper } from './QuantityStepper';
import { INVENTORY_REMAINING_LEVELS, getInventoryRemainingStage } from './remainingLevels';
import { readLastInventoryLocation, writeLastInventoryLocation } from './inventoryFormPrefs';
import { useLabStore } from '../../store/useLabStore';
import type { ManufacturerDateType } from '../../utils/manufacturerDate';

import { translateLocationName } from '../../utils/i18nUtils';
import { guessTemplateFromCapacity, getWidthForTemplate } from '../../utils/guessReagentTemplate';
import { getSuggestedCasInputMethod, useCasSuggestion } from '../../hooks/useCasSuggestion';

export interface InventoryFormSaveResult {
    kind: 'created' | 'updated';
    itemId: string;
    /** Server row returned by a creation; null for updates. */
    item: InventoryItem | null;
    /** Values that were written, for optimistic display. */
    values: CreateInventoryInput;
    /** Present when a new item is auto-placed in a cabinet; resolves to whether it fit. */
    placement?: Promise<boolean>;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    locations: StorageLocation[];
    cabinets?: Cabinet[];
    initialData?: InventoryItem | null;
    initialDraft?: Partial<CreateInventoryInput> | null;
    entryMode?: 'manual_form' | 'scan_prefill';
    onSaved: (result: InventoryFormSaveResult) => void;
}

type InventoryFormField = 'name' | 'location' | 'date';

// Auto-placement runs after the modal closed; serialise it so two quick
// registrations never interleave on the shared cabinet store.
let cabinetPlacementQueue: Promise<unknown> = Promise.resolve();
function enqueueCabinetPlacement(task: () => Promise<boolean>): Promise<boolean> {
    const run = cabinetPlacementQueue
        .then(task)
        .catch((placementError: unknown) => {
            console.error('Failed to auto-place inventory item in cabinet:', placementError);
            return false;
        });
    cabinetPlacementQueue = run;
    return run;
}

/** Analytics must never delay or fail a save. */
function trackInBackground(task: Promise<unknown>): void {
    void task.catch((trackingError: unknown) => {
        console.warn('[Inventory] Background tracking failed:', trackingError);
    });
}

export const InventoryFormModal: React.FC<Props> = ({
    isOpen,
    onClose,
    locations,
    cabinets: initialCabinets,
    initialData,
    initialDraft = null,
    entryMode = 'manual_form',
    onSaved,
}) => {
    const { t, i18n } = useTranslation();
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<InventoryFormField, string>>>({});
    const [cabinets, setCabinets] = useState<Cabinet[]>(initialCabinets ?? []);
    const dialogRef = useRef<HTMLDivElement>(null);
    useAdaptiveDialog(dialogRef, onClose, isOpen);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const locationFieldRef = useRef<HTMLDivElement>(null);
    const dateFieldRef = useRef<HTMLDivElement>(null);
    const locationsRef = useRef(locations);
    const initialCabinetsRef = useRef(initialCabinets);
    const qtyNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingRef = useRef(false);
    const [showQtyNotice, setShowQtyNotice] = useState(false);

    useEffect(() => {
        locationsRef.current = locations;
        initialCabinetsRef.current = initialCabinets;
    }, [locations, initialCabinets]);

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
        manufacturer_date_type: 'expiry',
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
            const currentLocations = locationsRef.current;
            const knownCabinets = initialCabinetsRef.current ?? [];
            if (knownCabinets.length > 0) setCabinets(knownCabinets);
            // Fetch cabinets when modal opens
            cabinetService.getCabinets().then(setCabinets).catch(console.error);
            // Resolve the actor (session + display name) while the user is typing.
            inventoryService.prefetchActorContext();

            if (initialData) {
                setAuditLogs([]);
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
                    // Keep the date field visible so an expiry can be added in one step.
                    manufacturer_date_type: initialData.manufacturer_date_type && initialData.manufacturer_date_type !== 'unlabeled'
                        ? initialData.manufacturer_date_type
                        : 'expiry',
                    received_date: initialData.received_date || '',
                    opened_date: initialData.opened_date || '',
                    memo: initialData.memo || '',
                    remaining_percent: initialData.remaining_percent ?? 100,
                });
            } else {
                // Start where the user last stored something in this lab.
                const remembered = readLastInventoryLocation(useLabStore.getState().currentLabId);
                const rememberedOther = remembered?.storage_type === 'other'
                    && currentLocations.some((location) => location.id === remembered.storage_location_id)
                    ? remembered.storage_location_id
                    : undefined;
                const rememberedCabinet = remembered?.storage_type === 'cabinet'
                    && knownCabinets.some((cabinet) => cabinet.id === remembered.cabinet_id)
                    ? remembered.cabinet_id
                    : undefined;
                const defaultStorageType = rememberedCabinet
                    ? 'cabinet'
                    : (rememberedOther || currentLocations.length > 0 ? 'other' : 'cabinet');
                const draftStorageType = initialDraft?.storage_type || defaultStorageType;
                const draftDateType = initialDraft?.manufacturer_date_type;
                setFormData({
                    name: initialDraft?.name || '',
                    brand: initialDraft?.brand || '',
                    product_number: initialDraft?.product_number || '',
                    cas_number: initialDraft?.cas_number || '',
                    quantity: initialDraft?.quantity ?? 1,
                    capacity: initialDraft?.capacity || '',
                    storage_type: draftStorageType,
                    cabinet_id: draftStorageType === 'cabinet'
                        ? (initialDraft?.cabinet_id || rememberedCabinet || '')
                        : '',
                    storage_location_id: draftStorageType === 'other'
                        ? (initialDraft?.storage_location_id || rememberedOther || (currentLocations.length > 0 ? currentLocations[0].id : ''))
                        : '',
                    expiry_date: initialDraft?.expiry_date || '',
                    // The list sorts by expiry, so the expiry field is shown by default.
                    manufacturer_date_type: draftDateType && draftDateType !== 'unlabeled' ? draftDateType : 'expiry',
                    received_date: initialDraft?.received_date || '',
                    opened_date: initialDraft?.opened_date || '',
                    memo: initialDraft?.memo || '',
                    remaining_percent: initialDraft?.remaining_percent ?? 100,
                });
            }
            setError(null);
            setFieldErrors({});
        }
    }, [isOpen, initialData, initialDraft]);

    useEffect(() => {
        if (!isOpen || initialData) return;
        // Registration starts by typing the name.
        const frame = requestAnimationFrame(() => {
            nameInputRef.current?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [isOpen, initialData]);

    useEffect(() => {
        return () => {
            if (qtyNoticeTimerRef.current) clearTimeout(qtyNoticeTimerRef.current);
        };
    }, []);

    const clearFieldError = (field: InventoryFormField) => {
        setError(null);
        setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
    };

    const showQuantityNotice = () => {
        setShowQtyNotice(true);
        if (qtyNoticeTimerRef.current) clearTimeout(qtyNoticeTimerRef.current);
        qtyNoticeTimerRef.current = setTimeout(() => setShowQtyNotice(false), 3000);
    };

    // Handle form changes
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;

        if (name === 'name') {
            casSuggestion.markNameInputChanged();
            clearFieldError('name');
        } else {
            setError(null);
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

    const focusInvalidField = (field: InventoryFormField, message: string) => {
        setFieldErrors({ [field]: message });
        setError(null);
        requestAnimationFrame(() => {
            const container = field === 'name'
                ? nameInputRef.current
                : field === 'location'
                    ? locationFieldRef.current
                    : dateFieldRef.current;
            if (!container) return;
            container.scrollIntoView({ block: 'center', behavior: 'smooth' });
            const focusTarget = container instanceof HTMLInputElement
                ? container
                : container.querySelector<HTMLElement>('input, button');
            focusTarget?.focus({ preventScroll: true });
        });
    };

    /** A date type without a date is stored as "unlabeled" unless the record already had it that way. */
    const resolveManufacturerDateType = (): ManufacturerDateType => {
        if (formData.expiry_date) return formData.manufacturer_date_type || 'expiry';
        if (initialData && !initialData.expiry_date) return initialData.manufacturer_date_type || 'unlabeled';
        return 'unlabeled';
    };

    const rememberLocation = (input: CreateInventoryInput) => {
        writeLastInventoryLocation(useLabStore.getState().currentLabId, {
            storage_type: input.storage_type,
            cabinet_id: input.cabinet_id,
            storage_location_id: input.storage_location_id,
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (savingRef.current) return;

        if (!formData.name.trim()) {
            focusInvalidField('name', t('msg_input_required_name'));
            return;
        }

        if (formData.storage_type === 'cabinet' && !formData.cabinet_id) {
            focusInvalidField('location', t('msg_select_cabinet'));
            return;
        }

        if (formData.storage_type === 'other' && !formData.storage_location_id) {
            focusInvalidField('location', t('msg_select_location'));
            return;
        }

        if (formData.expiry_date && formData.manufacturer_date_type === 'unlabeled') {
            focusInvalidField('date', t('scan_manufacturer_date_type_required'));
            return;
        }

        const payload: CreateInventoryInput = {
            ...formData,
            name: formData.name.trim(),
            quantity: Math.max(1, Math.round(formData.quantity ?? 1)),
            manufacturer_date_type: resolveManufacturerDateType(),
        };

        savingRef.current = true;
        setIsSaving(true);
        setError(null);
        setFieldErrors({});

        try {
            if (initialData) {
                const isStorageChanged = initialData.storage_type !== payload.storage_type
                    || (payload.storage_type === 'cabinet' && (initialData.cabinet_id || '') !== (payload.cabinet_id || ''))
                    || (payload.storage_type === 'other' && (initialData.storage_location_id || '') !== (payload.storage_location_id || ''));
                const shouldTrackCommerceUpdate = hasCommerceSignalChange(initialData, payload);
                const casChanged = (initialData.cas_number || '').trim() !== (payload.cas_number || '').trim();

                if (isStorageChanged) {
                    await moveItemStorage(initialData, payload);
                } else {
                    await inventoryService.updateItem(initialData.id, payload, initialData._source || 'inventory');
                    if (initialData._source === 'inventory' && initialData.storage_type === 'cabinet' && initialData.cabinet_id) {
                        const synced = await inventoryService.syncLinkedCabinetItemFromInventory({
                            inventoryItemId: initialData.id,
                            cabinetId: initialData.cabinet_id,
                            updates: payload,
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
                                nextCasNumber: payload.cas_number,
                            });
                        }
                    } else if (initialData._source === 'cabinet_item' && initialData.linked_inventory_item_id) {
                        await inventoryService.updateItem(initialData.linked_inventory_item_id, {
                            ...payload,
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
                            nextCasNumber: payload.cas_number,
                        });
                    }
                }
                if (shouldTrackCommerceUpdate) {
                    trackInBackground(analyticsService.trackCommerceIntentEvent({
                        eventType: initialData._source === 'cabinet_item' ? 'cabinet_item_updated' : 'inventory_updated',
                        sourceScreen: 'inventory_form_modal',
                        storageType: payload.storage_type,
                        sourceItemType: initialData._source || 'inventory',
                        sourceItemId: initialData.id,
                        brandName: payload.brand,
                        productNumber: payload.product_number,
                        quantity: payload.quantity,
                        capacityText: payload.capacity,
                        casNumber: payload.cas_number,
                        casInputMethod: currentCasInputMethod,
                        metadata: {
                            action: isStorageChanged ? 'move_and_update' : 'update',
                        },
                    }));
                }
                rememberLocation(payload);
                onSaved({ kind: 'updated', itemId: initialData.id, item: null, values: payload });
            } else {
                const createdItem = await inventoryService.createItem(payload);
                if (!createdItem) {
                    throw new Error(t('inventory_error'));
                }
                trackInBackground(analyticsService.trackCommerceIntentEvent({
                    eventType: 'inventory_registered',
                    sourceScreen: 'inventory_form_modal',
                    storageType: payload.storage_type,
                    sourceItemType: 'inventory',
                    sourceItemId: createdItem.id,
                    brandName: payload.brand,
                    productNumber: payload.product_number,
                    quantity: payload.quantity,
                    capacityText: payload.capacity,
                    casNumber: payload.cas_number,
                    casInputMethod: currentCasInputMethod,
                    metadata: {
                        entry_mode: entryMode,
                    },
                }));

                // The record exists from here on: close right away so a second tap can
                // never create a duplicate. Cabinet auto-placement (수동 등록에서도 시약장
                // 선택 시 실제 3D 시약장 빈 공간에 자동 배치) continues in the background and
                // reports its own outcome to the list.
                const placement = payload.storage_type === 'cabinet' && payload.cabinet_id
                    ? enqueueCabinetPlacement(() => placeToCabinet(createdItem.id, payload))
                    : undefined;
                rememberLocation(payload);
                onSaved({ kind: 'created', itemId: createdItem.id, item: createdItem, values: payload, placement });
            }
            onClose();
        } catch (err: unknown) {
            console.error('Failed to save inventory:', err);
            const message = err instanceof Error ? err.message : t('error_save_generic');
            setError(message);
        } finally {
            savingRef.current = false;
            setIsSaving(false);
        }
    };

    async function moveItemStorage(sourceItem: InventoryItem, input: CreateInventoryInput): Promise<void> {
        if (input.storage_type === 'cabinet') {
            if (!input.cabinet_id) throw new Error(t('inv_err_select_cabinet'));

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
                throw new Error(t('inv_err_move_no_space'));
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
                    if (!removed) throw new Error(t('inv_err_remove_from_source'));
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

            trackInBackground(analyticsService.trackStorageWarningIgnoredForItem({
                cabinetId: input.cabinet_id,
                shelves: useFridgeStore.getState().shelves,
                relatedItemId: placed.itemId,
                sourceScreen: 'inventory_form_modal',
                triggerSource: 'inventory_move_to_cabinet',
                metadata: {
                    inventory_source: sourceItem._source || 'inventory',
                },
            }));
            return;
        }

        // Move to 'other' storage
        if (!input.storage_location_id) throw new Error(t('inv_err_select_other_location'));

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
                    throw new Error(t('inv_err_source_sync'));
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
        if (!created) throw new Error(t('inv_err_create_for_other_move'));

        const removed = await removeSourceCabinetRow(sourceItem);
        if (!removed) {
            await inventoryService.deleteItem({ ...created, _source: 'inventory' });
            throw new Error(t('inv_err_source_remove_cancelled'));
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
            throw new Error(t('inv_err_cabinet_not_synced'));
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
        
        return `${t('inventory_loc_other')} · ${locName}`;
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
    // Only an edit that actually moves the item needs the "from -> to" preview.
    const isLocationChanged = Boolean(initialData) && (
        initialData?.storage_type !== formData.storage_type
        || (formData.storage_type === 'cabinet' && (initialData?.cabinet_id || '') !== (formData.cabinet_id || ''))
        || (formData.storage_type === 'other' && (initialData?.storage_location_id || '') !== (formData.storage_location_id || ''))
    );
    const remainingStage = getInventoryRemainingStage(formData.remaining_percent);
    const fieldInputClass = (field: InventoryFormField) => (
        fieldErrors[field]
            ? 'border-red-400 focus:ring-red-500 dark:border-red-500'
            : 'border-slate-200 dark:border-slate-700'
    );

    if (!isOpen) return null;


    return (
        <>
            {isOpen && (
                <div className="adaptive-overlay fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

                    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="inventory-form-title" tabIndex={-1} className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
                            <h2 id="inventory-form-title" className="text-lg font-bold text-slate-800 dark:text-slate-100">
                                {modalTitle}
                            </h2>
                            <button onClick={onClose} aria-label={t('btn_close')} className="min-h-11 min-w-11 p-1 -mr-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 scrollbar-thin">
                            <form id="inventory-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">

                                <div className="flex flex-col gap-1.5">
                                    <label htmlFor="inventory-form-name" className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('inventory_product_name')} <span className="text-red-500">*</span></label>
                                    <input
                                        ref={nameInputRef}
                                        id="inventory-form-name"
                                        name="name"
                                        value={formData.name}
                                        onChange={handleChange}
                                        onBlur={casSuggestion.triggerLookupFromBlur}
                                        placeholder={t('inventory_product_name_placeholder')}
                                        aria-invalid={Boolean(fieldErrors.name)}
                                        aria-describedby={fieldErrors.name ? 'inventory-form-name-error' : undefined}
                                        className={`w-full px-3 py-2 bg-white dark:bg-slate-800 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100 ${fieldInputClass('name')}`}
                                    />
                                    {fieldErrors.name && (
                                        <p id="inventory-form-name-error" role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                                            {fieldErrors.name}
                                        </p>
                                    )}
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
                                            className="h-11 w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label htmlFor="inventory-form-quantity" className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('inventory_quantity')} <span className="text-red-500">*</span></label>
                                        <QuantityStepper
                                            id="inventory-form-quantity"
                                            value={formData.quantity ?? 1}
                                            onChange={(quantity) => setFormData((prev) => ({ ...prev, quantity }))}
                                            readOnly={isEditingCabinetItem}
                                            onReadOnlyClick={showQuantityNotice}
                                        />
                                        {isEditingCabinetItem && showQtyNotice && (
                                            <span className="text-2xs text-red-500 dark:text-red-400 font-medium animate-in fade-in slide-in-from-top-1">
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
                                        {INVENTORY_REMAINING_LEVELS.map((item) => {
                                            const isSelected = item.stage === remainingStage;

                                            return (
                                                <button
                                                    key={item.stage}
                                                    type="button"
                                                    aria-pressed={isSelected}
                                                    onClick={() => setFormData(prev => ({ ...prev, remaining_percent: item.value }))}
                                                    className={`flex flex-col items-center justify-center py-2.5 px-1 rounded-xl border-2 transition-all duration-200 ${
                                                        isSelected ? item.active : `${item.color} opacity-60`
                                                    }`}
                                                >
                                                    <span className="text-3xs font-bold uppercase mb-0.5">
                                                        {t(`inventory_remaining_stage_${item.stage}`)}
                                                    </span>
                                                    <span className="text-2xs font-bold leading-tight text-center">
                                                        {t(`inventory_remaining_stage_${item.stage}_label`)}
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* 보관 위치 지정 */}
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3 mt-2">
                                    <label className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">{t('inventory_storage_type')}</label>

                                    <div className="flex gap-2">
                                        <button type="button" aria-pressed={formData.storage_type === 'cabinet'} onClick={() => { clearFieldError('location'); setFormData(prev => ({ ...prev, storage_type: 'cabinet' })); }} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${formData.storage_type === 'cabinet' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'bg-white dark:bg-slate-700 text-slate-500 border border-slate-200 dark:border-slate-600'}`}>
                                            {t('inventory_storage_cabinet')}
                                        </button>
                                        <button type="button" aria-pressed={formData.storage_type === 'other'} onClick={() => { clearFieldError('location'); setFormData(prev => ({ ...prev, storage_type: 'other', storage_location_id: prev.storage_location_id || locations[0]?.id || '' })); }} className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${formData.storage_type === 'other' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' : 'bg-white dark:bg-slate-700 text-slate-500 border border-slate-200 dark:border-slate-600'}`}>
                                            {t('inventory_storage_other')}
                                        </button>
                                    </div>
                                    {isEditingCabinetItem && (
                                        <p className="text-2xs text-slate-500 dark:text-slate-400">
                                            {t('inventory_move_notice')}
                                        </p>
                                    )}

                                    <div ref={locationFieldRef}>
                                        {formData.storage_type === 'cabinet' && (
                                            <AppSelect
                                                value={formData.cabinet_id || ''}
                                                onChange={(value) => {
                                                    clearFieldError('location');
                                                    setFormData((prev) => ({ ...prev, cabinet_id: value }));
                                                }}
                                                options={cabinetOptions}
                                                placeholder={`-- ${t('inventory_select_cabinet')} --`}
                                                buttonClassName={`bg-white dark:bg-slate-800 ${fieldInputClass('location')}`}
                                            />
                                        )}

                                        {formData.storage_type === 'other' && (
                                            <div role="radiogroup" aria-label={t('inventory_select_location')} className="flex flex-wrap gap-2">
                                                {locations.map((location) => {
                                                    const isSelected = formData.storage_location_id === location.id;
                                                    return (
                                                        <button
                                                            key={location.id}
                                                            type="button"
                                                            role="radio"
                                                            aria-checked={isSelected}
                                                            onClick={() => {
                                                                clearFieldError('location');
                                                                setFormData((prev) => ({ ...prev, storage_location_id: location.id }));
                                                            }}
                                                            className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${isSelected
                                                                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500 dark:border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-300'
                                                                : `bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 ${fieldErrors.location ? 'border-red-300 dark:border-red-700' : 'border-slate-200 dark:border-slate-600'}`
                                                                }`}
                                                        >
                                                            <StorageLocationIcon icon={location.icon} />
                                                            {translateLocationName(location.name, t)}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        {fieldErrors.location && (
                                            <p role="alert" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                                                {fieldErrors.location}
                                            </p>
                                        )}
                                    </div>

                                    {/* 현재 위치 -> 변경 위치 미리보기 (수정 중 위치가 바뀔 때만) */}
                                    {isLocationChanged && (
                                        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                                            {currentLocationLabel}
                                            <span className="mx-1.5">→</span>
                                            <span className="font-semibold">{targetLocationLabel}</span>
                                        </div>
                                    )}
                                </div>

                                <div ref={dateFieldRef}>
                                    <ReagentDateFields
                                        className="mt-2"
                                        value={formData}
                                        onChange={(next) => {
                                            clearFieldError('date');
                                            setFormData((prev) => ({ ...prev, ...next }));
                                        }}
                                    />
                                    {(fieldErrors.date || (formData.expiry_date && formData.manufacturer_date_type === 'unlabeled')) && (
                                        <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
                                            {fieldErrors.date || t('scan_manufacturer_date_type_required')}
                                        </p>
                                    )}
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

                                {readableImportAttributes(initialData?.source_attributes).length > 0 && <details className="rounded-lg border p-3 dark:border-slate-700"><summary className="text-sm font-semibold">{t('inv_imported_source_info')}</summary><dl className="mt-2 space-y-1 text-xs">{readableImportAttributes(initialData?.source_attributes).map((a, index) => <div key={index} className="break-words"><dt className="inline font-semibold">{a.label}: </dt><dd className="inline">{a.value || '—'}</dd></div>)}</dl></details>}
                                {initialData && (isLoadingLogs || auditLogs.length > 0) && (
                                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                                            <History className="w-4 h-4" /> {t('history_log', '변경 이력')}
                                        </h3>
                                        {isLoadingLogs ? (
                                            <div className="flex justify-center p-4">
                                                <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                                            </div>
                                        ) : (
                                            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                                {auditLogs.map(log => (
                                                    <div key={log.id} className="bg-slate-50 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                                                        <div className="flex justify-between items-center mb-1">
                                                             <span className={`font-semibold px-1.5 py-0.5 rounded text-3xs ${log.action === 'create' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
                                                                    log.action === 'update' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' :
                                                                        'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
                                                                }`}>
                                                                {formatAuditActionName(log.action, t, log)}
                                                            </span>
                                                            <span className="text-3xs text-slate-400">
                                                                {new Date(log.created_at).toLocaleString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US')}
                                                            </span>
                                                        </div>
                                                        {log.actor_name && <div className="text-3xs text-slate-500 dark:text-slate-400 mt-1">{t('log_handler_label', '작업자')}: {log.actor_name}</div>}
                                                        <AuditChangeList diff={log.diff_data} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </form>
                        </div>
                        {error && (
                            <div role="alert" className="flex gap-2 border-t border-red-100 bg-red-50 px-5 py-2.5 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}
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
        cabinetService.logActivity(input.cabinet_id, 'add', input.name, undefined, input.memo || undefined)
            .catch((logError: unknown) => console.error('Failed to log cabinet add activity:', logError));

        trackInBackground(analyticsService.trackStorageWarningIgnoredForItem({
            cabinetId: input.cabinet_id,
            shelves: useFridgeStore.getState().shelves,
            relatedItemId: placeResult.itemId,
            sourceScreen: 'inventory_form_modal',
            triggerSource: 'inventory_auto_place',
        }));

        return true;
    }
};

