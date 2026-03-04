/* eslint-disable react-hooks/exhaustive-deps */
/**
 * Inventory Registration Modal
 * Allows users to register a product from search results into inventory.
 * When "cabinet" is chosen, actually auto-places the item on a shelf.
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Package, MapPin, Plus, Check, Loader2, ChevronDown, ArrowRight } from 'lucide-react';
import type { MediaProduct } from '../services/mediaProductService';
import type { Cabinet } from '../services/cabinetService';
import { cabinetService } from '../services/cabinetService';
import {
    inventoryService,
    storageLocationService,
    type StorageLocation,
} from '../services/inventoryService';
import { useFridgeStore } from '../store/fridgeStore';
import type { ReagentPlacement, ReagentTemplateType } from '../types/fridge';

interface InventoryRegistrationModalProps {
    product: MediaProduct;
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    /** Called when the user wants to navigate to the cabinet to see the placed item */
    onNavigateToCabinet?: (cabinetId: string, itemId: string) => void;
}

export const InventoryRegistrationModal: React.FC<InventoryRegistrationModalProps> = ({
    product,
    isOpen,
    onClose,
    onSuccess,
    onNavigateToCabinet,
}) => {
    const { t } = useTranslation();

    // Form state
    const [selectedProductNumber, setSelectedProductNumber] = useState<string>('');
    const [quantity, setQuantity] = useState(1);
    const [capacity, setCapacity] = useState('');
    const [storageType, setStorageType] = useState<'cabinet' | 'other'>('other');
    const [selectedCabinetId, setSelectedCabinetId] = useState<string>('');
    const [selectedLocationId, setSelectedLocationId] = useState<string>('');
    const [memo, setMemo] = useState('');

    // Data
    const [cabinets, setCabinets] = useState<Cabinet[]>([]);
    const [locations, setLocations] = useState<StorageLocation[]>([]);

    // New location input
    const [showNewLocation, setShowNewLocation] = useState(false);
    const [newLocationName, setNewLocationName] = useState('');

    // Status
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successState, setSuccessState] = useState<{
        type: 'other' | 'cabinet';
        cabinetId?: string;
        itemId?: string;
        shelfLevel?: number;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Load cabinets and storage locations on mount
    useEffect(() => {
        if (!isOpen) return;
        loadData();
    }, [isOpen]);

    // Auto-select first product number if only one
    useEffect(() => {
        if (product.product_numbers && product.product_numbers.length === 1) {
            setSelectedProductNumber(product.product_numbers[0]);
        }
    }, [product]);

    const loadData = async () => {
        const [cabs, locs] = await Promise.all([
            cabinetService.getCabinets(),
            storageLocationService.getLocations(),
        ]);
        setCabinets(cabs);
        setLocations(locs);

        // Auto-select first location if available
        if (locs.length > 0 && !selectedLocationId) {
            setSelectedLocationId(locs[0].id);
        }
    };

    const handleAddLocation = async () => {
        if (!newLocationName.trim()) return;
        const loc = await storageLocationService.addLocation(newLocationName.trim());
        if (loc) {
            setLocations(prev => [...prev, loc]);
            setSelectedLocationId(loc.id);
            setNewLocationName('');
            setShowNewLocation(false);
        }
    };

    const resetForm = () => {
        setSuccessState(null);
        setQuantity(1);
        setCapacity('');
        setMemo('');
        setSelectedProductNumber('');
        setError(null);
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setError(null);

        try {
            // 1. Register in inventory table
            const result = await inventoryService.createItem({
                name: product.product_name || 'Unknown',
                brand: product.brand || undefined,
                product_number: selectedProductNumber || undefined,
                quantity,
                capacity: capacity || undefined,
                storage_type: storageType,
                cabinet_id: storageType === 'cabinet' ? selectedCabinetId : undefined,
                storage_location_id: storageType === 'other' ? selectedLocationId : undefined,
                product_id: product.id,
                memo: memo || undefined,
            });

            if (!result) {
                setError(t('inventory_error'));
                return;
            }

            // 2. If cabinet storage, actually place the reagent on a shelf
            if (storageType === 'cabinet' && selectedCabinetId) {
                const placedItemId = await placeToCabinet();
                if (placedItemId) {
                    setSuccessState({
                        type: 'cabinet',
                        cabinetId: selectedCabinetId,
                        itemId: placedItemId,
                        shelfLevel: useFridgeStore.getState().autoPlaceResult?.shelfLevel,
                    });
                } else {
                    // Inventory registered but no space in cabinet
                    setSuccessState({ type: 'cabinet', cabinetId: selectedCabinetId });
                    setError(t('reagent_no_space'));
                }
            } else {
                // Other storage — simple success, auto-close after delay
                setSuccessState({ type: 'other' });
                setTimeout(() => {
                    onSuccess?.();
                    onClose();
                    resetForm();
                }, 1200);
            }
        } catch {
            setError(t('inventory_error'));
        } finally {
            setIsSubmitting(false);
        }
    };

    /** Load the target cabinet into fridgeStore, auto-place, and save */
    const placeToCabinet = async (): Promise<string | null> => {
        const store = useFridgeStore.getState();

        // Load the cabinet data
        await store.loadCabinet(selectedCabinetId);

        // Determine template type based on capacity string
        const template: ReagentTemplateType = guessTemplate(capacity);

        // Build reagent placement data
        const itemData: Omit<ReagentPlacement, 'shelfId' | 'position' | 'depthPosition'> = {
            id: '', // autoPlaceReagent will assign a new UUID
            reagentId: product.id,
            name: product.product_name || 'Unknown',
            width: getWidthForTemplate(template),
            template,
            isAcidic: false,
            isBasic: false,
            hCodes: [],
            notes: memo || undefined,
            casNo: undefined,
            capacity: capacity || undefined,
            productNumber: selectedProductNumber || undefined,
            brand: product.brand || undefined,
        };

        const placeResult = useFridgeStore.getState().autoPlaceReagent(itemData);

        if (placeResult) {
            // Save the cabinet state with the new item
            await useFridgeStore.getState().saveCabinet();
            // Log the activity
            await cabinetService.logActivity(
                selectedCabinetId,
                'add',
                product.product_name || 'Unknown',
            );
            return placeResult.itemId;
        }

        return null;
    };

    const handleGoToCabinet = () => {
        if (successState?.cabinetId && successState?.itemId && onNavigateToCabinet) {
            onNavigateToCabinet(successState.cabinetId, successState.itemId);
        }
        onClose();
        resetForm();
    };

    const handleCloseAfterSuccess = () => {
        onSuccess?.();
        onClose();
        resetForm();
    };

    if (!isOpen) return null;

    const productNumbers = product.product_numbers?.filter(Boolean) || [];
    const isSuccess = successState !== null;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={() => { if (!isSuccess) onClose(); }}
            />

            {/* Modal */}
            <div className="relative w-full max-w-[430px] max-h-[85vh] bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl animate-in slide-in-from-bottom-4 duration-300 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800 flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                            <Package className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                            {t('inventory_register_title')}
                        </h2>
                    </div>
                    <button
                        onClick={() => { if (isSuccess) handleCloseAfterSuccess(); else onClose(); }}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Success overlay */}
                {isSuccess && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/95 dark:bg-slate-900/95 animate-in fade-in duration-200 px-6">
                        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mb-4 animate-in zoom-in duration-300">
                            <Check className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-300 mb-2 text-center">
                            {t('inventory_success')}
                        </p>

                        {/* Cabinet placement result */}
                        {successState.type === 'cabinet' && successState.itemId && successState.shelfLevel && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 text-center">
                                {t('reagent_placed_toast', {
                                    name: product.product_name || '',
                                    level: successState.shelfLevel,
                                })}
                            </p>
                        )}

                        {/* No space warning */}
                        {successState.type === 'cabinet' && !successState.itemId && error && (
                            <p className="text-sm text-amber-600 dark:text-amber-400 mb-6 text-center">
                                {error}
                            </p>
                        )}

                        {/* Action buttons */}
                        <div className="flex flex-col gap-2 w-full max-w-[280px]">
                            {/* Go to cabinet button (only if placement was successful) */}
                            {successState.type === 'cabinet' && successState.itemId && onNavigateToCabinet && (
                                <button
                                    onClick={handleGoToCabinet}
                                    className="w-full py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-semibold rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/20"
                                >
                                    {t('inventory_go_to_cabinet')}
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            )}

                            {/* Close / stay button */}
                            <button
                                onClick={handleCloseAfterSuccess}
                                className={`w-full py-3 px-4 font-medium rounded-xl transition-all active:scale-[0.98] ${successState.type === 'cabinet' && successState.itemId
                                    ? 'bg-gray-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                                    : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white'
                                    }`}
                            >
                                {t('btn_close')}
                            </button>
                        </div>
                    </div>
                )}

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {/* Product Info (read-only) */}
                    <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-2">
                        <div className="flex items-start gap-3">
                            {product.thumbnail_url && (
                                <img
                                    src={product.thumbnail_url}
                                    alt=""
                                    className="w-14 h-14 rounded-lg object-contain bg-white dark:bg-slate-700 flex-shrink-0"
                                />
                            )}
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold text-slate-900 dark:text-slate-100 text-sm leading-tight line-clamp-2">
                                    {product.product_name || 'Unknown Product'}
                                </p>
                                {product.brand && (
                                    <span className="inline-block mt-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium rounded-full">
                                        {product.brand}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Product Number Selection */}
                    {productNumbers.length > 0 && (
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                {t('inventory_product_number')}
                            </label>
                            {productNumbers.length === 1 ? (
                                <div className="px-3 py-2.5 bg-gray-50 dark:bg-slate-800 rounded-xl text-sm text-slate-700 dark:text-slate-300 border border-gray-200 dark:border-slate-700">
                                    {productNumbers[0]}
                                </div>
                            ) : (
                                <div className="relative">
                                    <select
                                        value={selectedProductNumber}
                                        onChange={(e) => setSelectedProductNumber(e.target.value)}
                                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:border-transparent appearance-none pr-8"
                                    >
                                        <option value="">{t('inventory_select_product_number')}</option>
                                        {productNumbers.map((num) => (
                                            <option key={num} value={num}>{num}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Quantity & Capacity Row */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                {t('inventory_quantity')}
                            </label>
                            <div className="flex items-center h-[46px] border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-800">
                                <button
                                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                    className="px-3 h-full text-lg font-medium text-slate-500 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                                >
                                    −
                                </button>
                                <input
                                    type="number"
                                    value={quantity}
                                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                    className="flex-1 text-center text-sm font-semibold bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    min={1}
                                />
                                <button
                                    onClick={() => setQuantity(quantity + 1)}
                                    className="px-3 h-full text-lg font-medium text-slate-500 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                                >
                                    +
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                {t('inventory_capacity')}
                            </label>
                            <input
                                type="text"
                                value={capacity}
                                onChange={(e) => setCapacity(e.target.value)}
                                placeholder={t('inventory_capacity_placeholder')}
                                className="w-full h-[46px] px-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                            />
                        </div>
                    </div>

                    {/* Storage Type */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            <MapPin className="w-4 h-4 inline mr-1 -mt-0.5" />
                            {t('inventory_storage_type')}
                        </label>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                            <button
                                onClick={() => setStorageType('cabinet')}
                                className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all ${storageType === 'cabinet'
                                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                                    : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-600'
                                    }`}
                            >
                                📦 {t('inventory_storage_cabinet')}
                            </button>
                            <button
                                onClick={() => setStorageType('other')}
                                className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all ${storageType === 'other'
                                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                                    : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-600'
                                    }`}
                            >
                                📍 {t('inventory_storage_other')}
                            </button>
                        </div>

                        {/* Cabinet selector */}
                        {storageType === 'cabinet' && (
                            <div className="relative animate-in fade-in slide-in-from-top-1 duration-200">
                                <select
                                    value={selectedCabinetId}
                                    onChange={(e) => setSelectedCabinetId(e.target.value)}
                                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:border-transparent appearance-none pr-8"
                                >
                                    <option value="">{t('inventory_select_cabinet')}</option>
                                    {cabinets.map((cab) => (
                                        <option key={cab.id} value={cab.id}>
                                            {cab.name}{cab.location ? ` (${cab.location})` : ''}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                            </div>
                        )}

                        {/* Storage location selector */}
                        {storageType === 'other' && (
                            <div className="animate-in fade-in slide-in-from-top-1 duration-200 space-y-2">
                                {/* Location chips */}
                                <div className="flex flex-wrap gap-2">
                                    {locations.map((loc) => (
                                        <button
                                            key={loc.id}
                                            onClick={() => setSelectedLocationId(loc.id)}
                                            className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${selectedLocationId === loc.id
                                                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/30'
                                                : 'bg-gray-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                                                }`}
                                        >
                                            {loc.icon} {loc.name}
                                        </button>
                                    ))}

                                    {/* Add new location button */}
                                    {!showNewLocation && (
                                        <button
                                            onClick={() => setShowNewLocation(true)}
                                            className="px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors border-2 border-dashed border-gray-300 dark:border-slate-600"
                                        >
                                            <Plus className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                                            {t('inventory_add_location')}
                                        </button>
                                    )}
                                </div>

                                {/* New location input */}
                                {showNewLocation && (
                                    <div className="flex gap-2 animate-in fade-in duration-200">
                                        <input
                                            type="text"
                                            value={newLocationName}
                                            onChange={(e) => setNewLocationName(e.target.value)}
                                            placeholder={t('inventory_add_location_placeholder')}
                                            className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                                            autoFocus
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleAddLocation();
                                                if (e.key === 'Escape') setShowNewLocation(false);
                                            }}
                                        />
                                        <button
                                            onClick={handleAddLocation}
                                            disabled={!newLocationName.trim()}
                                            className="px-4 py-2 bg-emerald-500 text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-emerald-600 transition-colors"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => { setShowNewLocation(false); setNewLocationName(''); }}
                                            className="px-3 py-2 bg-gray-100 dark:bg-slate-800 text-gray-500 rounded-xl text-sm hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Memo */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            {t('inventory_memo')}
                        </label>
                        <textarea
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            placeholder={t('inventory_memo_placeholder')}
                            rows={2}
                            className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                        />
                    </div>

                    {/* Error message (only shown during form, not in success overlay) */}
                    {error && !isSuccess && (
                        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-800 flex-shrink-0">
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || isSuccess}
                        className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-semibold rounded-xl transition-all active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/20"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                {t('inventory_registering')}
                            </>
                        ) : (
                            <>
                                <Package className="w-5 h-5" />
                                {t('inventory_register_btn')}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── Helpers ─────────────────────────────────────────────

/** Guess a bottle template type from the capacity string */
function guessTemplate(capacity: string): ReagentTemplateType {
    if (!capacity) return 'A';
    const lower = capacity.toLowerCase();
    const numMatch = lower.match(/(\d+)/);
    const num = numMatch ? parseInt(numMatch[1]) : 0;

    if (lower.includes('kg') || num >= 2500) return 'D'; // Large box
    if (lower.includes('l') && !lower.includes('ml')) return 'C'; // Large bottle
    if (num >= 500) return 'C';
    if (num >= 100) return 'A';
    return 'B'; // Small
}

/** Get width percentage for a template */
function getWidthForTemplate(template: ReagentTemplateType): number {
    switch (template) {
        case 'A': return 8;
        case 'B': return 6;
        case 'C': return 12;
        case 'D': return 14;
        default: return 8;
    }
}

export default InventoryRegistrationModal;
