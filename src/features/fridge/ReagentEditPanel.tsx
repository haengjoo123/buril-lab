import React, { useState, useEffect } from 'react';
import { useFridgeStore } from '../../store/fridgeStore';
import { X, Save, Trash2, Beaker, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const ReagentEditPanel: React.FC = () => {
    const { t } = useTranslation();
    const selectedReagentId = useFridgeStore(s => s.selectedReagentId);
    const shelves = useFridgeStore(s => s.shelves);
    const updateReagent = useFridgeStore(s => s.updateReagent);
    const removeReagent = useFridgeStore(s => s.removeReagent);
    const setSelectedReagentId = useFridgeStore(s => s.setSelectedReagentId);

    const [name, setName] = useState('');
    const [notes, setNotes] = useState('');

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
        }
    }, [selectedItem]);

    if (!selectedReagentId || !selectedItem) return null;

    const handleSave = () => {
        updateReagent(selectedReagentId, { name, notes });
        setSelectedReagentId(null); // Close after save
    };

    const handleDelete = () => {
        if (confirm(t('cabinet_delete_confirm'))) {
            removeReagent(selectedReagentId);
            setSelectedReagentId(null);
        }
    };

    const handleClose = () => {
        setSelectedReagentId(null);
    };

    return (
        <div className="absolute right-4 top-20 w-80 bg-white/90 backdrop-blur shadow-xl rounded-xl border border-gray-200 flex flex-col overflow-hidden z-30 animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b bg-gray-50/50">
                <div className="flex items-center gap-2 text-gray-800 font-semibold">
                    <Beaker size={18} className="text-blue-500" />
                    <span>{t('cabinet_edit_title')}</span>
                </div>
                <button
                    onClick={handleClose}
                    className="p-1 rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
                >
                    <X size={18} />
                </button>
            </div>

            {/* Content */}
            <div className="p-4 flex flex-col gap-4">
                {/* Info Read-only */}
                <div className="text-xs text-gray-500 flex flex-col gap-1">
                    <div className="flex justify-between">
                        <span>{t('cabinet_label_type')}</span>
                        <span className="font-medium text-gray-700">{selectedItem.template}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>{t('cabinet_label_location')}</span>
                        <span className="font-medium text-gray-700 flex items-center gap-1">
                            <MapPin size={10} />
                            {t('cabinet_shelf_level', { level: selectedItem.shelfLevel + 1 })} / {Math.round(selectedItem.position)}%
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
                        className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                        placeholder={t('cabinet_placeholder_name')}
                    />
                </div>

                {/* Notes Input */}
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600">{t('cabinet_notes')}</label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none"
                        placeholder={t('cabinet_placeholder_notes')}
                    />
                </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t bg-gray-50/50 flex items-center justify-between gap-2">
                <button
                    onClick={handleDelete}
                    className="px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1.5 transition-colors"
                >
                    <Trash2 size={14} />
                    {t('cabinet_delete')}
                </button>
                <button
                    onClick={handleSave}
                    className="flex-1 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                >
                    <Save size={14} />
                    {t('cabinet_save')}
                </button>
            </div>
        </div>
    );
};
