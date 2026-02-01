import React from 'react';
import type { AnalysisResult } from '../types';
import { AlertTriangle, CheckCircle, HelpCircle, Plus, FileText } from 'lucide-react';
import { useWasteStore } from '../store/useWasteStore';
import { useTranslation } from 'react-i18next';
import { translateGHS } from '../data/ghsCodes';
import { MsdsModal } from './MsdsModal';

interface ResultCardProps {
    result: AnalysisResult;
    onReset: () => void;
}

export const ResultCard: React.FC<ResultCardProps> = ({ result, onReset }) => {
    const { chemical, binColor, reason, isSafe, category, label } = result;
    const addToCart = useWasteStore((state) => state.addToCart);
    const { t, i18n } = useTranslation();
    const [isGhsExpanded, setIsGhsExpanded] = React.useState(false);

    // Modal State
    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const [isMsdsOpen, setIsMsdsOpen] = React.useState(false);
    const [volume, setVolume] = React.useState('');
    const [molarity, setMolarity] = React.useState('');
    const [error, setError] = React.useState('');

    // Decide icon based on category/safety
    const renderIcon = () => {
        if (category === 'UNKNOWN') return <HelpCircle className="w-12 h-12 text-gray-500 dark:text-gray-400" />;
        return <CheckCircle className="w-12 h-12 text-white" />;
    };

    const handleAddClick = () => {
        setIsModalOpen(true);
        setVolume('');
        setMolarity('');
        setError('');
    };

    const handleConfirm = () => {
        if (!volume.trim()) {
            setError(t('msg_input_required'));
            return;
        }

        addToCart({
            ...result,
            volume: `${volume.trim()} mL`,
            molarity: molarity.trim()
        });

        setIsModalOpen(false);
        onReset(); // Clear current view
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg overflow-hidden border border-gray-100 dark:border-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-5">
            {/* Header: Chemical Info */}
            <div className="p-5 bg-slate-50 dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center">
                <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">{chemical.name}</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm font-mono mt-1">
                        {chemical.molecularFormula} {chemical.casNumber !== chemical.name ? `• CAS: ${chemical.casNumber}` : ''}
                    </p>
                </div>
                <button
                    onClick={() => setIsMsdsOpen(true)}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
                >
                    <FileText className="w-3.5 h-3.5" />
                    MSDS 확인
                </button>
            </div>

            {/* Body: Disposal Guide */}
            <div className="p-6 flex flex-col items-center text-center">

                {/* Bin Visual */}
                <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 shadow-md ${binColor} transition-colors`}>
                    {renderIcon()}
                </div>

                <h4 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t(label as any)}</h4>

                <p className="text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
                    {t(reason as any, result.reasonParams)}
                </p>

                {/* MSDS / GHS Information */}
                {chemical.ghs && (
                    <div className="w-full mb-6 p-4 bg-orange-50 dark:bg-orange-900/10 border border-orange-100 dark:border-orange-900/30 rounded-xl text-left animate-in zoom-in-95 duration-300">
                        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-orange-100 dark:border-orange-900/30">
                            <AlertTriangle className={`w-5 h-5 ${chemical.ghs.signal === 'Danger' ? 'text-red-600 dark:text-red-500' : 'text-orange-500'}`} />
                            <span className={`font-bold text-sm ${chemical.ghs.signal === 'Danger' ? 'text-red-600 dark:text-red-500' : 'text-orange-600 dark:text-orange-400'}`}>
                                {t('safety_ghs')}
                            </span>
                            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-bold ${chemical.ghs.signal === 'Danger' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'}`}>
                                {chemical.ghs.signal.toUpperCase()}
                            </span>
                        </div>
                        <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300 transition-all">
                            {(() => {
                                // Deduplicate translated statements
                                const uniqueStatements = Array.from(new Set(
                                    chemical.ghs.hazardStatements.map(h => translateGHS(h, i18n.language as any))
                                ));

                                return (
                                    <>
                                        {uniqueStatements.slice(0, isGhsExpanded ? undefined : 3).map((statement, idx) => (
                                            <li key={`${statement}-${idx}`} className="flex items-start gap-2">
                                                <span className="mt-1.5 w-1 h-1 rounded-full bg-slate-400 flex-shrink-0" />
                                                <span>{statement}</span>
                                            </li>
                                        ))}
                                        {uniqueStatements.length > 3 && (
                                            <li
                                                onClick={() => setIsGhsExpanded(!isGhsExpanded)}
                                                className="text-xs text-slate-400 pt-1 text-center cursor-pointer hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                            >
                                                {isGhsExpanded ? t('btn_close') : `+ ${uniqueStatements.length - 3} more`}
                                            </li>
                                        )}
                                    </>
                                );
                            })()}
                        </ul>
                    </div>
                )}

                {/* Safety Warning if needed */}
                {!isSafe && (
                    <div className="w-full bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 p-3 rounded-lg flex items-start gap-2 text-sm text-left mb-6 border border-red-100 dark:border-red-900/50">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                        <span>
                            {t('safety_uncertain')}
                        </span>
                    </div>
                )}

                <div className="w-full grid grid-cols-2 gap-3">
                    <button
                        onClick={onReset}
                        className="py-2.5 px-3 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                    >
                        {t('btn_reset')}
                    </button>
                    <button
                        onClick={handleAddClick}
                        className="py-2.5 px-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-200 dark:shadow-blue-900/20 whitespace-nowrap"
                    >
                        <Plus className="w-4 h-4" />
                        {t('btn_add_to_list')}
                    </button>
                </div>
            </div>

            {/* Input Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-100 dark:border-slate-800 animate-in zoom-in-95 duration-200">
                        <div className="p-5 border-b border-gray-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
                            <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                                {t('btn_add_to_list')}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                {chemical.name}
                            </p>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    {t('input_volume')} <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={volume}
                                        onChange={(e) => setVolume(e.target.value)}
                                        placeholder="500"
                                        className="w-full pl-4 pr-12 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                        autoFocus
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">
                                        mL
                                    </span>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    {t('input_molarity')}
                                </label>
                                <input
                                    type="text"
                                    value={molarity}
                                    onChange={(e) => setMolarity(e.target.value)}
                                    placeholder="e.g. 0.1M"
                                    className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                />
                            </div>

                            {error && (
                                <p className="text-sm text-red-500 font-medium animate-pulse">
                                    {error}
                                </p>
                            )}
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-800 flex gap-3 justify-end">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="px-4 py-2 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                            >
                                {t('btn_cancel')}
                            </button>
                            <button
                                onClick={handleConfirm}
                                className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 active:bg-blue-800 shadow-lg shadow-blue-200 dark:shadow-blue-900/20 transition-all"
                            >
                                {t('btn_confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MSDS Modal */}
            <MsdsModal
                chemical={chemical}
                isOpen={isMsdsOpen}
                onClose={() => setIsMsdsOpen(false)}
            />
        </div>
    );
};
