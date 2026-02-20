import React, { useState } from 'react';
import { FridgeScene } from './FridgeScene';
import { ReagentEditPanel } from './ReagentEditPanel';
import { useFridgeStore } from '../../store/fridgeStore';
import { Box, ChevronDown, ChevronUp, Layers, Minus, Plus, ScanLine, Ratio, SplitSquareVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReagentTemplateType } from '../../types/fridge';

export const FridgeView: React.FC = () => {
    const { t } = useTranslation();
    const [verticalPanelPos, setVerticalPanelPos] = useState(50);
    const [isEditPanelVisible, setIsEditPanelVisible] = useState(true);
    const [isReagentTrayVisible, setIsReagentTrayVisible] = useState(true);
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
    } = useFridgeStore();

    const handleReagentClick = (item: typeof mockReagents[0]) => {
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

    // Mock reagents for the placement tray
    const mockReagents = [
        {
            name: 'Ethanol (70%)', type: 'C', color: '#64748b', width: 10,
            chemicalData: { name: 'Ethanol', properties: { ph: 7 }, ghs: { hazardStatements: ['H225'] } }
        },
        {
            name: 'Sulfuric Acid', type: 'A', color: '#dc2626', width: 8,
            chemicalData: { name: 'Sulfuric Acid', properties: { ph: 1 }, ghs: { hazardStatements: ['H314'] } }
        }, // Acid
        {
            name: 'Sodium Hydroxide', type: 'B', color: '#2563eb', width: 12,
            chemicalData: { name: 'Sodium Hydroxide', properties: { ph: 14 }, ghs: { hazardStatements: ['H314'] } }
        }, // Base
        {
            name: 'Acetone', type: 'C', color: '#0f172a', width: 10,
            chemicalData: { name: 'Acetone', properties: { ph: 7 }, ghs: { hazardStatements: ['H225', 'H319'] } }
        },
    ];

    return (
        <div className="w-full h-full relative flex flex-col bg-gray-50 overflow-hidden">

            {/* Main 3D Viewport */}
            <div className="flex-1 relative w-full h-full">
                <FridgeScene />

                {/* Mode Switcher - Floating Pill */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur shadow-md border rounded-full p-1 flex items-center gap-1 z-20">
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

                {/* Edit Mode Overlay */}
                <ReagentEditPanel />
                {mode === 'EDIT' && (
                    <div className="absolute inset-x-0 bottom-8 flex flex-col items-center gap-2 pointer-events-none">
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
                                                step={0.5}
                                                value={cabinetWidth}
                                                onChange={(e) => {
                                                    const v = parseFloat(e.target.value);
                                                    if (!Number.isNaN(v)) setCabinetDimensions(v, undefined);
                                                }}
                                                className="w-14 px-1.5 py-1 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                                            />
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-xs font-medium text-gray-600 w-8">{t('cabinet_height')}</span>
                                            <input
                                                type="number"
                                                min={1.2}
                                                max={15}
                                                step={0.1}
                                                value={cabinetHeight}
                                                onChange={(e) => {
                                                    const v = parseFloat(e.target.value);
                                                    if (!Number.isNaN(v)) setCabinetDimensions(undefined, v);
                                                }}
                                                className="w-14 px-1.5 py-1 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                                            />
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-xs font-medium text-gray-600 w-8">{t('cabinet_depth')}</span>
                                            <input
                                                type="number"
                                                min={0.8}
                                                max={4}
                                                step={0.1}
                                                value={cabinetDepth}
                                                onChange={(e) => {
                                                    const v = parseFloat(e.target.value);
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
                    <div className="absolute inset-x-0 bottom-8 flex flex-col items-center gap-2 pointer-events-none">
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
                                    <button className="text-xs text-blue-600 hover:underline">Clear Tray</button>
                                </div>
                                <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-200">
                                    <div className="min-w-[100px] h-[120px] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 text-gray-400 hover:border-blue-400 hover:text-blue-500 cursor-pointer transition-colors shrink-0">
                                        <ScanLine size={24} />
                                        <span className="text-xs font-medium">Scan Code</span>
                                    </div>
                                    {mockReagents.map((item, idx) => (
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
        </div>
    );
};
