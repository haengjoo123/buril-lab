import React, { useState, useEffect } from 'react';
import { Plus, Search, Archive, Package, SearchX, MapPin, Loader2 } from 'lucide-react';
import { inventoryService, storageLocationService, type InventoryItem, type StorageLocation } from '../../services/inventoryService';
import { InventoryFormModal } from './InventoryFormModal';
import { CustomDialog } from '../../components/CustomDialog';

import { useLabStore } from '../../store/useLabStore';

export const InventoryListView: React.FC = () => {
    const { currentLabId } = useLabStore();
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [locations, setLocations] = useState<StorageLocation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
    const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [fetchedItems, fetchedLocations] = await Promise.all([
                inventoryService.getItems(),
                storageLocationService.getLocations(),
            ]);
            setItems(fetchedItems);
            setLocations(fetchedLocations);
        } catch (error) {
            console.error('Failed to load inventory data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [currentLabId]);

    const filteredItems = items.filter(item =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.brand && item.brand.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (item.product_number && item.product_number.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (item.cas_number && item.cas_number.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    const handleEdit = (item: InventoryItem) => {
        setEditingItem(item);
        setIsFormOpen(true);
    };

    const handleDeleteClick = (item: InventoryItem) => {
        setItemToDelete(item);
    };

    const confirmDelete = async () => {
        if (!itemToDelete || isDeleting) return;
        setIsDeleting(true);
        try {
            await inventoryService.deleteItem(itemToDelete);
            setItems(items.filter(i => i.id !== itemToDelete.id));
        } catch (error) {
            console.error('Failed to delete item:', error);
        } finally {
            setIsDeleting(false);
            setItemToDelete(null);
        }
    };

    const renderStorageBadge = (item: InventoryItem) => {
        if (item.storage_type === 'cabinet') {
            const shelfLabel = typeof item.shelf_level === 'number'
                ? ` · ${item.shelf_level + 1}층`
                : '';
            return (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    <Archive className="w-3.5 h-3.5" />
                    시약장: {item.cabinet_name || '미지정'}{shelfLabel}
                </span>
            );
        }

        return (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                <MapPin className="w-3.5 h-3.5" />
                {item.storage_location_icon || '📦'} {item.storage_location_name || '기타 보관장소'}
            </span>
        );
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-4 py-4 flex-shrink-0">
                <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Package className="w-6 h-6 text-emerald-500" />
                    재고 목록
                </h1>

                {/* Search Bar */}
                <div className="mt-4 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="시약명, 브랜드, CAS, 제품번호 검색"
                        className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-slate-50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-shadow"
                    />
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-3">
                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                    </div>
                ) : filteredItems.length > 0 ? (
                    filteredItems.map(item => (
                        <div
                            key={item.id}
                            onClick={() => handleEdit(item)}
                            className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-3 cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-600 transition-colors"
                        >
                            <div className="flex justify-between items-start gap-2">
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base break-words">
                                        {item.name}
                                    </h3>
                                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                                        {item.cas_number && <span>CAS: {item.cas_number}</span>}
                                        {item.brand && <span>{item.brand}</span>}
                                        {item.product_number && <span>PN: {item.product_number}</span>}
                                    </div>
                                </div>
                                <div className="flex flex-col items-end shrink-0">
                                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-md">
                                        {item.quantity}개
                                    </span>
                                    {item.capacity && (
                                        <span className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                            {item.capacity}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700">
                                {renderStorageBadge(item)}

                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteClick(item); }}
                                    disabled={isDeleting}
                                    className="text-xs text-red-500 hover:text-red-700 disabled:text-red-300 disabled:cursor-not-allowed font-medium px-2 py-1"
                                >
                                    삭제
                                </button>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400 dark:text-slate-500">
                        <SearchX className="w-12 h-12 mb-3 text-slate-300 dark:text-slate-600" />
                        <p>{searchQuery ? '검색 결과가 없습니다.' : '등록된 재고가 없습니다.'}</p>
                    </div>
                )}
            </div>

            {/* FAB */}
            <button
                onClick={() => { setEditingItem(null); setIsFormOpen(true); }}
                className="absolute bottom-24 right-5 w-14 h-14 bg-emerald-500 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-emerald-600 active:scale-95 transition-all z-10"
            >
                <Plus className="w-6 h-6" />
            </button>

            {/* Modal */}
            <InventoryFormModal
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                locations={locations}
                initialData={editingItem}
                onSaved={loadData}
            />

            {/* Delete Confirm */}
            <CustomDialog
                isOpen={!!itemToDelete}
                onClose={() => setItemToDelete(null)}
                title="재고 삭제"
                description={`'${itemToDelete?.name}' 항목을 재고 목록에서 삭제하시겠습니까?`}
                type="confirm"
                isDestructive={true}
                onConfirm={confirmDelete}
                confirmText="삭제"
                cancelText="취소"
                isConfirmLoading={isDeleting}
                preventCloseWhileLoading={true}
            />
        </div>
    );
};
