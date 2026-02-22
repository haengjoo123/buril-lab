import React, { useEffect, useState, useRef } from 'react';
import { Loader2, Plus, X, Beaker } from 'lucide-react';
import { cabinetService, type Cabinet } from '../../services/cabinetService';
import { useLabStore } from '../../store/useLabStore';
import { CabinetCard } from './components/CabinetCard';
import { CustomDialog } from '../../components/CustomDialog';
import { CabinetFormDialog } from './components/CabinetFormDialog';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { ImageActionMenu } from './components/ImageActionMenu';
import { DisposalLogModal } from './components/DisposalLogModal';
import { useTranslation } from 'react-i18next';

interface CabinetListViewProps {
    onSelectCabinet: (cabinetId: string) => void;
}

export function CabinetListView({ onSelectCabinet }: CabinetListViewProps) {
    const { t } = useTranslation();
    const [cabinets, setCabinets] = useState<Cabinet[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { currentLabId, myLabs } = useLabStore();
    const currentRole = myLabs.find(m => m.lab_id === currentLabId)?.role;
    const canCreateCabinet = !currentLabId || currentRole === 'admin';

    // Dialog State
    const [dialogConfig, setDialogConfig] = useState<{
        isOpen: boolean;
        type: 'alert' | 'confirm' | 'prompt';
        title: string;
        description?: string;
        inputValue?: string;
        inputPlaceholder?: string;
        onConfirm?: (val?: string) => void;
        isDestructive?: boolean;
    }>({
        isOpen: false,
        type: 'alert',
        title: ''
    });

    const [formDialogConfig, setFormDialogConfig] = useState<{
        isOpen: boolean;
        mode: 'create' | 'edit';
        cabinetId?: string;
        initialName?: string;
        initialLocation?: string;
    }>({
        isOpen: false,
        mode: 'create'
    });

    const [imageMenu, setImageMenu] = useState<{ isOpen: boolean, cabinetId?: string }>({ isOpen: false });
    const [cameraModal, setCameraModal] = useState<{ isOpen: boolean, cabinetId?: string }>({ isOpen: false });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const closeDialog = () => setDialogConfig(prev => ({ ...prev, isOpen: false }));
    const closeFormDialog = () => setFormDialogConfig(prev => ({ ...prev, isOpen: false }));
    const closeImageMenu = () => setImageMenu(prev => ({ ...prev, isOpen: false }));
    const closeCameraModal = () => setCameraModal(prev => ({ ...prev, isOpen: false }));

    // Inventory modal state
    const [inventoryModal, setInventoryModal] = useState<{
        isOpen: boolean;
        cabinetName: string;
        items: { name: string; shelfLevel: number; template: string; capacity?: string }[];
        isLoading: boolean;
    }>({ isOpen: false, cabinetName: '', items: [], isLoading: false });

    const handleInventory = async (e: React.MouseEvent, cabinet: Cabinet) => {
        e.stopPropagation();
        setInventoryModal({ isOpen: true, cabinetName: cabinet.name, items: [], isLoading: true });
        try {
            const { shelves } = await cabinetService.getCabinetDetails(cabinet.id);
            const items = shelves.flatMap(shelf =>
                shelf.items.map(item => ({
                    name: item.name,
                    shelfLevel: shelf.level,
                    template: item.template,
                    capacity: item.capacity
                }))
            );
            setInventoryModal(prev => ({ ...prev, items, isLoading: false }));
        } catch (err) {
            console.error('Failed to load inventory:', err);
            setInventoryModal(prev => ({ ...prev, isLoading: false }));
        }
    };

    // Disposal log modal state
    const [disposalLogModal, setDisposalLogModal] = useState<{
        isOpen: boolean;
        cabinetId: string;
        cabinetName: string;
    }>({ isOpen: false, cabinetId: '', cabinetName: '' });

    const handleDisposalLog = (e: React.MouseEvent, cabinet: Cabinet) => {
        e.stopPropagation();
        setDisposalLogModal({ isOpen: true, cabinetId: cabinet.id, cabinetName: cabinet.name });
    };

    const loadCabinets = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const data = await cabinetService.getCabinets();
            setCabinets(data);
        } catch (err) {
            console.error(err);
            setError(t('cabinet_list_load_error'));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadCabinets();
    }, [currentLabId]);

    const handleCreate = () => {
        setFormDialogConfig({
            isOpen: true,
            mode: 'create',
            initialName: '',
            initialLocation: ''
        });
    };

    const handleEdit = (e: React.MouseEvent, cabinet: Cabinet) => {
        e.stopPropagation();
        setFormDialogConfig({
            isOpen: true,
            mode: 'edit',
            cabinetId: cabinet.id,
            initialName: cabinet.name,
            initialLocation: cabinet.location || ''
        });
    };

    const handleFormConfirm = async (name: string, location?: string) => {
        try {
            setIsCreating(true);
            if (formDialogConfig.mode === 'create') {
                await cabinetService.createCabinet(name, location);
            } else if (formDialogConfig.mode === 'edit' && formDialogConfig.cabinetId) {
                await cabinetService.updateCabinet(formDialogConfig.cabinetId, { name, location });
            }
            closeFormDialog();
            await loadCabinets();
        } catch (err) {
            console.error('Save error:', err);
            setDialogConfig({
                isOpen: true,
                type: 'alert',
                title: t('cabinet_save_error_title'),
                description: t('cabinet_save_error_desc'),
                isDestructive: true
            });
        } finally {
            setIsCreating(false);
        }
    };

    const handleImageClick = (e: React.MouseEvent, cabinetId: string) => {
        e.stopPropagation();
        setImageMenu({ isOpen: true, cabinetId });
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        const cabinetId = imageMenu.cabinetId;
        if (!file || !cabinetId) return;

        try {
            await cabinetService.uploadCabinetImage(cabinetId, file);
            await loadCabinets();
        } catch (err) {
            console.error('이미지 업로드 실패:', err);
            alert(t('cabinet_image_upload_error'));
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleCameraCapture = async (file: File) => {
        const cabinetId = cameraModal.cabinetId;
        if (!cabinetId) return;
        try {
            await cabinetService.uploadCabinetImage(cabinetId, file);
            await loadCabinets();
        } catch (err) {
            console.error('카메라 이미지 업로드 실패:', err);
            alert(t('cabinet_image_upload_error'));
        }
    };

    const handleDelete = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDialogConfig({
            isOpen: true,
            type: 'confirm',
            title: t('cabinet_delete_title'),
            description: t('cabinet_delete_desc'),
            isDestructive: true,
            onConfirm: async () => {
                closeDialog();
                try {
                    await cabinetService.deleteCabinet(id);
                    await loadCabinets();
                } catch (err) {
                    console.error('Delete error:', err);
                    setDialogConfig({
                        isOpen: true,
                        type: 'alert',
                        title: t('cabinet_delete_error_title'),
                        description: t('cabinet_delete_error_desc'),
                        isDestructive: true
                    });
                }
            }
        });
    };

    if (isLoading) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-6 gap-4">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <p className="text-slate-500">{t('cabinet_loading')}</p>
            </div>
        );
    }

    return (
        <div className="h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto p-5 pb-32">
            <div className="max-w-md mx-auto flex flex-col gap-6">
                <header className="flex justify-between items-center mt-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                            {currentLabId ? `${myLabs.find(m => m.lab_id === currentLabId)?.lab?.name || t('cabinet_lab_fallback')}${t('cabinet_lab_suffix')}` : t('cabinet_my_cabinets')}
                        </h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('cabinet_list_desc')}</p>
                    </div>
                </header>

                {error && (
                    <div className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-100 text-sm">
                        {error}
                    </div>
                )}

                <div className="flex flex-col gap-4">
                    {cabinets.map(cabinet => (
                        <CabinetCard
                            key={cabinet.id}
                            cabinet={cabinet}
                            onClick={() => onSelectCabinet(cabinet.id)}
                            onEdit={canCreateCabinet ? (e) => handleEdit(e, cabinet) : undefined}
                            onDelete={canCreateCabinet ? (e) => handleDelete(e, cabinet.id) : undefined}
                            onImageClick={(e) => handleImageClick(e, cabinet.id)}
                            onInventory={(e) => handleInventory(e, cabinet)}
                            onDisposalLog={(e) => handleDisposalLog(e, cabinet)}
                        />
                    ))}

                    {cabinets.length === 0 && !error && (
                        <div className="text-center py-10 bg-white/50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                            <p className="text-slate-500 dark:text-slate-400">{t('cabinet_empty')}</p>
                        </div>
                    )}

                    {canCreateCabinet && (
                        <button
                            onClick={handleCreate}
                            disabled={isCreating}
                            className="w-full mt-2 py-4 px-6 bg-white dark:bg-slate-800 border-2 border-dashed border-blue-300 dark:border-blue-800/50 rounded-2xl text-blue-600 dark:text-blue-400 font-medium hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 transition-all flex items-center justify-center gap-2 group disabled:opacity-50"
                        >
                            {isCreating ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                                    {t('cabinet_create_new')}
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>

            <CustomDialog
                isOpen={dialogConfig.isOpen}
                onClose={closeDialog}
                title={dialogConfig.title}
                description={dialogConfig.description}
                type={dialogConfig.type}
                inputValue={dialogConfig.inputValue}
                onInputChange={(val) => setDialogConfig(prev => ({ ...prev, inputValue: val }))}
                inputPlaceholder={dialogConfig.inputPlaceholder}
                isDestructive={dialogConfig.isDestructive}
                onConfirm={() => dialogConfig.onConfirm?.(dialogConfig.inputValue)}
            />

            <CabinetFormDialog
                isOpen={formDialogConfig.isOpen}
                onClose={closeFormDialog}
                title={formDialogConfig.mode === 'create' ? t('cabinet_create_title') : t('cabinet_edit_info_title')}
                description={formDialogConfig.mode === 'create' ? t('cabinet_create_desc') : undefined}
                initialName={formDialogConfig.initialName}
                initialLocation={formDialogConfig.initialLocation}
                onConfirm={handleFormConfirm}
                isLoading={isCreating}
            />

            <ImageActionMenu
                isOpen={imageMenu.isOpen}
                onClose={closeImageMenu}
                onSelectCamera={() => {
                    setCameraModal({ isOpen: true, cabinetId: imageMenu.cabinetId });
                }}
                onSelectGallery={() => {
                    fileInputRef.current?.click();
                }}
                hasImage={!!cabinets.find(c => c.id === imageMenu.cabinetId)?.image_url}
                onDeleteImage={async () => {
                    const cabinetId = imageMenu.cabinetId;
                    if (!cabinetId) return;
                    try {
                        await cabinetService.updateCabinet(cabinetId, { image_url: '' });
                        await loadCabinets();
                    } catch (err) {
                        console.error('이미지 삭제 실패:', err);
                    }
                }}
            />

            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
            />

            <CameraCaptureModal
                isOpen={cameraModal.isOpen}
                onClose={closeCameraModal}
                onCapture={handleCameraCapture}
            />

            <DisposalLogModal
                isOpen={disposalLogModal.isOpen}
                cabinetId={disposalLogModal.cabinetId}
                cabinetName={disposalLogModal.cabinetName}
                onClose={() => setDisposalLogModal(prev => ({ ...prev, isOpen: false }))}
            />

            {/* Inventory Modal */}
            {inventoryModal.isOpen && (
                <div className="fixed inset-0 z-[100] flex items-end justify-center animate-in fade-in duration-200">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setInventoryModal(prev => ({ ...prev, isOpen: false }))} />
                    <div className="relative bg-white dark:bg-slate-800 rounded-t-2xl shadow-xl w-full max-w-md max-h-[70vh] flex flex-col animate-in slide-in-from-bottom duration-300">
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700 shrink-0">
                            <div className="flex items-center gap-2">
                                <Beaker className="w-5 h-5 text-emerald-500" />
                                <span className="font-semibold text-slate-800 dark:text-slate-100">{inventoryModal.cabinetName} 재고 목록</span>
                            </div>
                            <button
                                onClick={() => setInventoryModal(prev => ({ ...prev, isOpen: false }))}
                                className="p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700 hover:text-gray-600 transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        {/* Content */}
                        <div className="overflow-y-auto p-4 flex flex-col gap-3">
                            {inventoryModal.isLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                                </div>
                            ) : inventoryModal.items.length === 0 ? (
                                <p className="text-center text-slate-400 dark:text-slate-500 py-8">시약이 없습니다.</p>
                            ) : (
                                (() => {
                                    // Group by shelf level
                                    const grouped = new Map<number, typeof inventoryModal.items>();
                                    for (const item of inventoryModal.items) {
                                        const list = grouped.get(item.shelfLevel) || [];
                                        list.push(item);
                                        grouped.set(item.shelfLevel, list);
                                    }
                                    const sortedLevels = [...grouped.keys()].sort((a, b) => a - b);
                                    return sortedLevels.map(level => (
                                        <div key={level}>
                                            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                                                {level === 0 ? '📦 바닥면' : `📦 ${level}번째 선반`}
                                            </h4>
                                            <div className="flex flex-col gap-1">
                                                {grouped.get(level)!.map((item, idx) => (
                                                    <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                                                        <span className="text-xs text-slate-400 dark:text-slate-500 font-mono w-5">{idx + 1}.</span>
                                                        <span className="text-sm text-slate-700 dark:text-slate-200 font-medium">{item.name}</span>
                                                        {item.capacity && (
                                                            <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto bg-slate-200/50 dark:bg-slate-600/50 px-2 py-0.5 rounded-md">
                                                                {item.capacity}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ));
                                })()
                            )}
                        </div>
                        {/* Footer */}
                        {!inventoryModal.isLoading && inventoryModal.items.length > 0 && (
                            <div className="p-3 border-t border-gray-100 dark:border-slate-700 text-center shrink-0">
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                    총 {inventoryModal.items.length}개 시약
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
