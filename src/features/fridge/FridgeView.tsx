import React, { useState } from 'react';
import { FridgeScene } from './FridgeScene';
import { ReagentEditPanel } from './ReagentEditPanel';
import { useFridgeStore } from '../../store/fridgeStore';
import { Box, ChevronDown, ChevronUp, Layers, Minus, Plus, ScanLine, Ratio, SplitSquareVertical, ArrowLeft, Save, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CustomDialog } from '../../components/CustomDialog';

import type { ReagentTemplateType } from '../../types/fridge';

export interface FridgeViewProps {
    cabinetId: string;
    onBack?: () => void;
}

export const FridgeView: React.FC<FridgeViewProps> = ({ cabinetId, onBack }) => {
    const { t } = useTranslation();
    const [verticalPanelPos, setVerticalPanelPos] = useState(50);
    const [isEditPanelVisible, setIsEditPanelVisible] = useState(true);
    const [isReagentTrayVisible, setIsReagentTrayVisible] = useState(true);
    const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Naming / Size Configuration Modal State
    const [placementName, setPlacementName] = useState('');
    const [placementMemo, setPlacementMemo] = useState('');
    const [placementSize, setPlacementSize] = useState<number>(1.0); // 0.8 (S), 1.0 (M), 1.2 (L)

    const {
        mode,
        setMode,
        addShelf,
        removeShelf,
        addVerticalPanel,
        removeVerticalPanel,
        shelves,
        setDraggedTemplate,
        draggedTemplate,
        cabinetWidth,
        cabinetHeight,
        cabinetDepth,
        cabinetAspectRatio,
        setCabinetDimensions,
        setCabinetDepth,
        setCabinetAspectRatio,
        sortShelves,
        loadCabinet,
        saveCabinet,
        cabinetName,
        isLoadingCabinet,
        clearCabinet,
        pendingPlacement,
        setPendingPlacement,
        placeReagent
    } = useFridgeStore();

    React.useEffect(() => {
        if (cabinetId) {
            // Skip if the store already has this cabinet loaded (e.g., from search click)
            const currentCabinetId = useFridgeStore.getState().cabinetId;
            if (currentCabinetId !== cabinetId || useFridgeStore.getState().shelves.length === 0) {
                loadCabinet(cabinetId);
            }
        }
    }, [cabinetId, loadCabinet]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await saveCabinet();
        } finally {
            setIsSaving(false);
        }
    };

    const handleClearCabinet = () => {
        clearCabinet();
        setIsClearConfirmOpen(false);
    };

    const handleReagentClick = (item: typeof genericContainers[0]) => {
        // 이미 선택된 시약을 다시 클릭하면 선택 취소
        if (draggedTemplate?.name === item.name) {
            setDraggedTemplate(null);
            return;
        }
        setDraggedTemplate({
            type: item.type as ReagentTemplateType,
            color: item.color,
            width: item.width,
            height: 1,
            depth: 1,
            name: item.name,
            chemicalData: item.chemicalData
        });
    };

    const handleConfirmPlacement = () => {
        if (!pendingPlacement) return;

        placeReagent(pendingPlacement.shelfId, {
            id: '',
            reagentId: 'custom-' + Date.now(),
            name: placementName.trim() || '이름 없음',
            position: pendingPlacement.position,
            depthPosition: pendingPlacement.depthPosition,
            width: pendingPlacement.width * placementSize,
            template: pendingPlacement.template,
            isAcidic: false,
            isBasic: false,
            hCodes: [],
            notes: placementMemo,
        });

        // Reset states
        setPendingPlacement(null);
        setPlacementName('');
        setPlacementMemo('');
        setPlacementSize(1.0);
    };

    const handleCancelPlacement = () => {
        setPendingPlacement(null);
        setPlacementName('');
        setPlacementMemo('');
        setPlacementSize(1.0);
    };

    // Generic containers for the placement tray
    const genericContainers = [
        {
            name: t('reagent_type_brown'), type: 'A', color: '#8b4513', width: 8,
            chemicalData: { name: t('reagent_type_brown') }
        },
        {
            name: t('reagent_type_plastic'), type: 'B', color: '#f8fafc', width: 10,
            chemicalData: { name: t('reagent_type_plastic') }
        },
        {
            name: t('reagent_type_glass'), type: 'C', color: '#e2e8f0', width: 9,
            chemicalData: { name: t('reagent_type_glass') }
        },
        {
            name: t('reagent_type_box'), type: 'D', color: '#cbd5e1', width: 15,
            chemicalData: { name: t('reagent_type_box') }
        },
    ];

    return (
        <div className="w-full h-full relative flex flex-col bg-gray-50 overflow-hidden">
            {/* Header Toolbar */}
            <div className="flex justify-between items-center px-4 py-3 bg-white shadow-sm z-30 relative shrink-0">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="p-2 -ml-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-full transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                    )}
                    <h2 className="text-lg font-semibold text-slate-800">
                        {isLoadingCabinet ? (
                            <span className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                            </span>
                        ) : cabinetName || t('cabinet_manage')}
                    </h2>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleSave}
                        disabled={isSaving || isLoadingCabinet}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span className="text-sm font-medium">{t('cabinet_save')}</span>
                    </button>
                </div>
            </div>

            {/* Main 3D Viewport */}
            <div className="flex-1 relative w-full h-full">
                {isLoadingCabinet && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-20">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                    </div>
                )}
                <FridgeScene />

                {/* Mode Switcher - Floating Pill */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none z-20">
                    <div className="bg-white/90 backdrop-blur pointer-events-auto shadow-md border rounded-full p-1 flex items-center gap-1">
                        <button
                            onClick={() => setMode('VIEW')}
                            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-medium transition-colors ${mode === 'VIEW' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'
                                }`}
                        >
                            <Layers size={14} /> View
                        </button>
                        <div className="w-px h-4 bg-gray-200" />
                        <button
                            onClick={() => setMode('EDIT')}
                            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-medium transition-colors ${mode === 'EDIT' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'
                                }`}
                        >
                            <Box size={14} /> Edit
                        </button>
                        <div className="w-px h-4 bg-gray-200" />
                        <button
                            onClick={() => setMode('PLACE')}
                            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-medium transition-colors ${mode === 'PLACE' ? 'bg-green-100 text-green-700' : 'text-gray-500 hover:bg-gray-100'
                                }`}
                        >
                            <Plus size={14} /> Stock
                        </button>
                    </div>
                </div>

                {/* Edit Mode Overlay */}
                <ReagentEditPanel />
                {mode === 'EDIT' && (
                    <div className="absolute inset-x-0 bottom-24 flex flex-col items-center gap-2 pointer-events-none z-20">
                        {isEditPanelVisible ? (
                            <div className="relative bg-white/90 backdrop-blur pointer-events-auto p-4 rounded-xl shadow-lg border flex flex-col gap-4 max-w-md w-full mx-4">
                                {/* 접기 버튼 - 우측 상단 */}
                                <button
                                    onClick={() => setIsEditPanelVisible(false)}
                                    className="absolute top-2 right-2 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                    title="패널 숨기기"
                                >
                                    <ChevronDown size={18} />
                                </button>
                                <div className="flex flex-col gap-3">
                                    {/* 버튼 행 - flex-wrap으로 공간 부족 시 자연스럽게 줄바꿈 */}
                                    <div className="flex flex-wrap items-end justify-center gap-x-4 gap-y-3">
                                        <button
                                            onClick={addShelf}
                                            className="flex flex-col items-center gap-1 text-xs font-medium text-gray-600 hover:text-blue-600 transition-colors group shrink-0"
                                        >
                                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center border group-hover:border-blue-500 group-hover:bg-blue-50 transition-all">
                                                <Plus size={20} />
                                            </div>
                                            <span className="whitespace-nowrap">{t('cabinet_add_shelf')}</span>
                                        </button>
                                        <button
                                            onClick={() => shelves.length > 0 && removeShelf(shelves[shelves.length - 1].id)}
                                            disabled={shelves.length === 0}
                                            className="flex flex-col items-center gap-1 text-xs font-medium text-gray-600 hover:text-red-600 transition-colors group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-600 shrink-0"
                                        >
                                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center border group-hover:border-red-500 group-hover:bg-red-50 transition-all group-disabled:hover:border-gray-300 group-disabled:hover:bg-gray-100">
                                                <Minus size={20} />
                                            </div>
                                            <span className="whitespace-nowrap">{t('cabinet_remove_shelf')}</span>
                                        </button>
                                        <div className="flex flex-col items-center gap-1 shrink-0">
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => verticalPanelPos >= 1 && verticalPanelPos <= 99 && addVerticalPanel(verticalPanelPos)}
                                                    disabled={shelves.length === 0}
                                                    className="flex flex-col items-center gap-1 text-xs font-medium text-gray-600 hover:text-indigo-600 transition-colors group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-600"
                                                >
                                                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center border group-hover:border-indigo-500 group-hover:bg-indigo-50 transition-all group-disabled:hover:border-gray-300 group-disabled:hover:bg-gray-100">
                                                        <SplitSquareVertical size={20} className="rotate-90" />
                                                    </div>
                                                    <span className="whitespace-nowrap">{t('cabinet_add_vertical_panel')}</span>
                                                </button>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={99}
                                                    value={verticalPanelPos}
                                                    onChange={(e) => {
                                                        const v = parseInt(e.target.value, 10);
                                                        if (!Number.isNaN(v)) setVerticalPanelPos(Math.max(1, Math.min(99, v)));
                                                    }}
                                                    className="w-12 px-1 py-1 text-xs text-center border border-gray-200 rounded"
                                                />
                                                <span className="text-[10px] text-gray-400">%</span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={removeVerticalPanel}
                                            disabled={shelves.every(s => s.dividers.length === 0)}
                                            className="flex flex-col items-center gap-1 text-xs font-medium text-gray-600 hover:text-orange-600 transition-colors group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-600 shrink-0"
                                        >
                                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center border group-hover:border-orange-500 group-hover:bg-orange-50 transition-all group-disabled:hover:border-gray-300 group-disabled:hover:bg-gray-100">
                                                <SplitSquareVertical size={20} className="rotate-90" />
                                            </div>
                                            <span className="whitespace-nowrap">{t('cabinet_remove_vertical_panel')}</span>
                                        </button>
                                    </div>

                                    {/* Sort Controls */}
                                    <div className="flex items-center justify-center gap-2 pt-2 border-t border-gray-100 w-full">
                                        <button
                                            onClick={() => sortShelves('name')}
                                            disabled={shelves.length === 0}
                                            className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors flex items-center gap-1.5"
                                        >
                                            <span className="text-[10px]">AZ</span>
                                            {t('cabinet_sort_name')}
                                        </button>
                                        <button
                                            onClick={() => sortShelves('type')}
                                            disabled={shelves.length === 0}
                                            className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors flex items-center gap-1.5"
                                        >
                                            <Layers size={12} />
                                            {t('cabinet_sort_type')}
                                        </button>
                                    </div>
                                    {/* 설명 텍스트 - 별도 줄로 분리하여 가독성 향상 */}
                                    <p className="text-xs text-gray-500 text-center leading-relaxed">
                                        {t('cabinet_vertical_panel_hint')}
                                    </p>
                                </div>

                                {/* 가로/세로/폭 크기 입력 - 한 줄 */}
                                <div className="flex flex-col gap-2 pt-2 border-t border-gray-200">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-xs font-medium text-gray-600 w-8">{t('cabinet_width')}</span>
                                            <input
                                                type="number"
                                                min={4}
                                                max={20}
                                                step={1}
                                                value={cabinetWidth}
                                                onChange={(e) => {
                                                    const v = parseInt(e.target.value, 10);
                                                    if (!Number.isNaN(v)) setCabinetDimensions(v, undefined);
                                                }}
                                                className="w-14 px-1.5 py-1 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                                            />
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-xs font-medium text-gray-600 w-8">{t('cabinet_height')}</span>
                                            <input
                                                type="number"
                                                min={2}
                                                max={15}
                                                step={1}
                                                value={cabinetHeight}
                                                onChange={(e) => {
                                                    const v = parseInt(e.target.value, 10);
                                                    if (!Number.isNaN(v)) setCabinetDimensions(undefined, v);
                                                }}
                                                className="w-14 px-1.5 py-1 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                                            />
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-xs font-medium text-gray-600 w-8">{t('cabinet_depth')}</span>
                                            <input
                                                type="number"
                                                min={1}
                                                max={4}
                                                step={1}
                                                value={cabinetDepth}
                                                onChange={(e) => {
                                                    const v = parseInt(e.target.value, 10);
                                                    if (!Number.isNaN(v)) setCabinetDepth(v);
                                                }}
                                                className="w-14 px-1.5 py-1 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                                            />
                                        </div>
                                    </div>
                                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={cabinetAspectRatio != null}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                setCabinetAspectRatio(checked ? cabinetWidth / cabinetHeight : null);
                                            }}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-400"
                                        />
                                        <Ratio size={14} className="text-gray-400" />
                                        {t('cabinet_ratio_lock')}
                                    </label>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsEditPanelVisible(true)}
                                className="bg-white/90 backdrop-blur pointer-events-auto px-4 py-2 rounded-xl shadow-lg border flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50/50 transition-colors"
                                title="패널 펼치기"
                            >
                                <ChevronUp size={18} />
                                {t('cabinet_edit_panel_show')}
                            </button>
                        )}
                    </div>
                )}

                {/* Place Mode Reagent Tray - 편집 패널처럼 열고 닫기 */}
                {mode === 'PLACE' && (
                    <div className="absolute inset-x-0 bottom-24 flex flex-col items-center gap-2 pointer-events-none z-20">
                        {isReagentTrayVisible ? (
                            <div className="relative bg-white/90 backdrop-blur pointer-events-auto p-4 rounded-xl shadow-lg border flex flex-col gap-2 max-w-full w-full mx-4 z-20">
                                <button
                                    onClick={() => setIsReagentTrayVisible(false)}
                                    className="absolute top-2 right-2 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                    title={t('cabinet_reagent_tray_hide')}
                                >
                                    <ChevronDown size={18} />
                                </button>
                                <div className="flex justify-between items-center px-2 pr-8">
                                    <h3 className="text-sm font-semibold text-gray-700">Reagent Tray</h3>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => sortShelves('name')}
                                            disabled={shelves.length === 0}
                                            className="px-2 py-1 text-[10px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors flex items-center gap-1"
                                        >
                                            <span>AZ</span>
                                            {t('cabinet_sort_name')}
                                        </button>
                                        <button
                                            onClick={() => sortShelves('type')}
                                            disabled={shelves.length === 0}
                                            className="px-2 py-1 text-[10px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors flex items-center gap-1"
                                        >
                                            <Layers size={10} />
                                            {t('cabinet_sort_type')}
                                        </button>
                                        <button
                                            onClick={() => setIsClearConfirmOpen(true)}
                                            disabled={shelves.every(s => s.items.length === 0)}
                                            className="text-xs text-red-600 hover:underline ml-2 flex items-center gap-1 disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
                                        >
                                            {t('cabinet_clear_all')}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-200">
                                    <div className="min-w-[100px] h-[120px] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 text-gray-400 hover:border-blue-400 hover:text-blue-500 cursor-pointer transition-colors shrink-0">
                                        <ScanLine size={24} />
                                        <span className="text-xs font-medium">Scan Code</span>
                                    </div>
                                    {genericContainers.map((item, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => handleReagentClick(item)}
                                            className={`min-w-[90px] h-[120px] flex flex-col items-center justify-between p-2 bg-white border rounded-lg hover:shadow-md hover:border-blue-300 cursor-pointer transition-all shrink-0 group relative ${draggedTemplate?.name === item.name ? 'ring-2 ring-blue-500 bg-blue-50' : ''}`}
                                        >
                                            <div
                                                className="w-10 h-16 rounded-md shadow-sm group-hover:scale-105 transition-transform origin-bottom"
                                                style={{ backgroundColor: item.color }}
                                            />
                                            <div className="w-full text-center">
                                                <span className="text-xs font-semibold text-gray-800 line-clamp-2 leading-tight">
                                                    {item.name}
                                                </span>
                                                <span className="text-[10px] text-gray-400 block mt-0.5">Type {item.type}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsReagentTrayVisible(true)}
                                className="bg-white/90 backdrop-blur pointer-events-auto px-4 py-2 rounded-xl shadow-lg border flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50/50 transition-colors z-20"
                                title={t('cabinet_reagent_tray_show')}
                            >
                                <ChevronUp size={18} />
                                {t('cabinet_reagent_tray_show')}
                            </button>
                        )}
                    </div>
                )}
            </div>

            <CustomDialog
                isOpen={isClearConfirmOpen}
                onClose={() => setIsClearConfirmOpen(false)}
                title={t('cabinet_clear_all')}
                description={t('cabinet_clear_all_confirm')}
                type="confirm"
                isDestructive={true}
                onConfirm={handleClearCabinet}
                confirmText={t('cabinet_delete')}
                cancelText={t('btn_cancel')}
            />

            {pendingPlacement && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={handleCancelPlacement} />
                    <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6 gap-4 flex flex-col animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        <h3 className="text-xl font-bold text-slate-800">{t('reagent_info_title')}</h3>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-600">{t('reagent_name_label')}</label>
                            <input
                                autoFocus
                                type="text"
                                value={placementName}
                                onChange={e => setPlacementName(e.target.value)}
                                placeholder={t('reagent_name_placeholder')}
                                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-600">{t('reagent_size_label')}</label>
                            <div className="flex gap-2">
                                {[
                                    { label: t('reagent_size_small'), value: 0.8 },
                                    { label: t('reagent_size_medium'), value: 1.0 },
                                    { label: t('reagent_size_large'), value: 1.2 }
                                ].map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setPlacementSize(opt.value)}
                                        className={`flex-1 py-1.5 rounded-lg text-sm font-medium border transition-colors ${placementSize === opt.value
                                            ? 'bg-blue-50 border-blue-500 text-blue-700'
                                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                            }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-600">{t('reagent_memo_label')}</label>
                            <textarea
                                value={placementMemo}
                                onChange={e => setPlacementMemo(e.target.value)}
                                placeholder={t('reagent_memo_placeholder')}
                                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none h-20"
                            />
                        </div>

                        <div className="flex items-center gap-3 mt-2">
                            <button
                                onClick={handleCancelPlacement}
                                className="flex-1 py-2 rounded-xl text-slate-600 font-medium bg-slate-100 hover:bg-slate-200 transition-colors"
                            >
                                {t('btn_cancel')}
                            </button>
                            <button
                                onClick={handleConfirmPlacement}
                                disabled={!placementName.trim()}
                                className="flex-1 py-2 rounded-xl text-white font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                                {t('btn_confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
