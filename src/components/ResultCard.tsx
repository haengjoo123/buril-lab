/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import type { AnalysisResult, SolutionContext, SolutionPhysicalForm, SolventClass } from '../types';
import { AlertTriangle, CheckCircle, HelpCircle, Plus, FileText, Sparkles, Info, Loader2 } from 'lucide-react';
import { useWasteStore } from '../store/useWasteStore';
import { useTranslation } from 'react-i18next';
import { translateGHS } from '../data/ghsCodes';
import { MsdsModal } from './MsdsModal';
import { resolveCustomOrganicSolvent } from '../utils/solventClassifier';

interface ResultCardProps {
    result: AnalysisResult;
    onReset: () => void;
    /** 비로그인 시 폐기 목록 담기 대신 호출 */
    onRequireAuth?: () => void;
    /** 커스텀 취소/닫기 버튼 텍스트 (기본값: btn_reset) */
    secondaryBtnText?: string;
}

const physicalFormOptions: Array<{ value: SolutionPhysicalForm; labelKey: string }> = [
    { value: 'neat_or_solid', labelKey: 'solution_form_neat_or_solid' },
    { value: 'aqueous', labelKey: 'solution_form_aqueous' },
    { value: 'organic_solvent', labelKey: 'solution_form_organic_solvent' },
    { value: 'mixed_or_unknown', labelKey: 'solution_form_mixed_or_unknown' },
];

const organicSolventPresets: Array<{
    id: string;
    label: string;
    solventName: string;
    solventClass: SolventClass;
    isCustom?: boolean;
}> = [
    { id: 'dmso', label: 'DMSO', solventName: 'DMSO', solventClass: 'organic_non_halogen' },
    { id: 'etoh_meoh', label: 'EtOH/MeOH', solventName: 'EtOH/MeOH', solventClass: 'organic_non_halogen' },
    { id: 'acetone_acn', label: 'Acetone/ACN', solventName: 'Acetone/ACN', solventClass: 'organic_non_halogen' },
    { id: 'hexane_toluene', label: 'Hexane/Toluene', solventName: 'Hexane/Toluene', solventClass: 'organic_non_halogen' },
    { id: 'dcm_chloroform', label: 'DCM/Chloroform', solventName: 'DCM/Chloroform', solventClass: 'organic_halogen' },
    { id: 'custom', label: '', solventName: '', solventClass: 'organic_unknown', isCustom: true },
];

export const ResultCard: React.FC<ResultCardProps> = ({ result, onReset, onRequireAuth, secondaryBtnText }) => {
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
    const [physicalForm, setPhysicalForm] = React.useState<SolutionPhysicalForm>('neat_or_solid');
    const [solventPreset, setSolventPreset] = React.useState('dmso');
    const [customSolvent, setCustomSolvent] = React.useState('');
    const [isResolvingSolvent, setIsResolvingSolvent] = React.useState(false);

    // Decide icon based on category/safety
    const renderIcon = () => {
        if (category === 'UNKNOWN') return <HelpCircle className="w-12 h-12 text-gray-500 dark:text-gray-400" />;
        return <CheckCircle className="w-12 h-12 text-white" />;
    };

    const handleAddClick = () => {
        if (onRequireAuth) {
            onRequireAuth();
            return;
        }
        setIsModalOpen(true);
        setVolume('');
        setMolarity('');
        setError('');
        setPhysicalForm('neat_or_solid');
        setSolventPreset('dmso');
        setCustomSolvent('');
        setIsResolvingSolvent(false);
    };

    const buildSolutionContext = async (): Promise<SolutionContext | null> => {
        if (physicalForm === 'neat_or_solid') {
            return { physicalForm, solventClass: 'none', solventResolution: 'preset', isSolventVerified: true };
        }

        if (physicalForm === 'aqueous') {
            return {
                physicalForm,
                solventClass: 'aqueous',
                solventName: 'Water/Aqueous',
                solventResolution: 'preset',
                isSolventVerified: true,
            };
        }

        if (physicalForm === 'mixed_or_unknown') {
            return { physicalForm, solventClass: 'mixed_or_unknown', solventResolution: 'unresolved', isSolventVerified: false };
        }

        const selectedPreset = organicSolventPresets.find((preset) => preset.id === solventPreset) || organicSolventPresets[0];

        if (selectedPreset.isCustom) {
            const trimmedCustomSolvent = customSolvent.trim();

            if (!trimmedCustomSolvent) {
                setError(t('solvent_custom_required' as any));
                return null;
            }

            setIsResolvingSolvent(true);
            const resolvedSolvent = await resolveCustomOrganicSolvent(trimmedCustomSolvent).finally(() => {
                setIsResolvingSolvent(false);
            });

            return {
                physicalForm,
                solventClass: resolvedSolvent.solventClass,
                solventName: resolvedSolvent.solventName || trimmedCustomSolvent,
                solventPreset: selectedPreset.id,
                isCustomSolvent: true,
                isSolventVerified: resolvedSolvent.isSolventVerified,
                solventResolution: resolvedSolvent.solventResolution,
                solventCasNumber: resolvedSolvent.solventCasNumber,
                solventMolecularFormula: resolvedSolvent.solventMolecularFormula,
            };
        }

        return {
            physicalForm,
            solventClass: selectedPreset.solventClass,
            solventName: selectedPreset.solventName,
            solventPreset: selectedPreset.id,
            solventResolution: 'preset',
            isSolventVerified: true,
        };
    };

    const handleConfirm = async () => {
        setError('');
        const solutionContext = await buildSolutionContext();
        if (!solutionContext) return;

        addToCart({
            ...result,
            volume: volume.trim() ? `${volume.trim()} mL` : undefined,
            molarity: molarity.trim(),
            solutionContext,
        });

        setIsModalOpen(false);
        onReset(); // Clear current view
    };

    const isHF = React.useMemo(() => {
        const nameUpper = chemical.name?.toUpperCase() || '';
        const formulaUpper = chemical.molecularFormula?.toUpperCase() || '';
        return chemical.casNumber === '7664-39-3' ||
            nameUpper.includes('HYDROFLUORIC') ||
            nameUpper.includes('불산') ||
            nameUpper.includes('플루오린화 수소') ||
            formulaUpper === 'HF';
    }, [chemical]);

    const guideKey = category === 'ACID' && isHF ? 'disposal_guide_ACID_HF' : `disposal_guide_${category}`;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg overflow-hidden border border-gray-100 dark:border-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-5">
            {/* Header: Chemical Info */}
            <div className="p-5 bg-slate-50 dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center gap-3">
                <div className="min-w-0 flex-1">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white truncate">{chemical.name}</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm font-mono mt-1 truncate">
                        {chemical.molecularFormula} {chemical.casNumber !== chemical.name ? `• CAS: ${chemical.casNumber}` : ''}
                    </p>
                </div>
                <button
                    onClick={() => setIsMsdsOpen(true)}
                    className="shrink-0 flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
                >
                    <FileText className="w-3.5 h-3.5" />
                    {t('msds_view')}
                </button>
            </div>

            {/* Body: Disposal Guide */}
            <div className="p-6 flex flex-col items-center text-center">

                {/* Bin Visual */}
                <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 shadow-md ${binColor} transition-colors`}>
                    {renderIcon()}
                </div>

                <h4 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t(label as any)}</h4>

                <p className="text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
                    {t(reason as any, result.reasonParams)}
                </p>

                {/* Specific Disposal Guide */}
                <div className="w-full bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100 p-4 rounded-xl text-left mb-6 border border-blue-100 dark:border-blue-800/50 animate-in zoom-in-95 duration-300 delay-100">
                    <p className="font-bold mb-1 text-sm">{t('cart_guide_title')}</p>
                    <p className="text-sm leading-relaxed whitespace-pre-line">
                        {t(guideKey as any)}
                    </p>
                </div>

                <div className="w-full flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300 mb-6">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400" />
                    <span>{t('result_pure_basis_notice' as any)}</span>
                </div>

                {/* AI Badge if inferred by Gemini */}
                {result.isAiEstimated && (
                    <div className="flex items-center gap-1.5 justify-center w-full mb-6 animate-in fade-in duration-300 delay-200">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-bold border border-purple-200 dark:border-purple-800/50">
                            <Sparkles className="w-3.5 h-3.5" />
                            {t('label_ai_classified')}
                        </span>
                    </div>
                )}

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
                        {secondaryBtnText || t('btn_reset')}
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
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto border border-gray-100 dark:border-slate-800 animate-in zoom-in-95 duration-200">
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
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    {t('input_physical_form' as any)}
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    {physicalFormOptions.map((option) => {
                                        const isSelected = physicalForm === option.value;
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setPhysicalForm(option.value)}
                                                className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${isSelected
                                                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-200'
                                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                                                    }`}
                                            >
                                                {t(option.labelKey as any)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {physicalForm === 'organic_solvent' && (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        {t('input_organic_solvent' as any)}
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {organicSolventPresets.map((preset) => {
                                            const isSelected = solventPreset === preset.id;
                                            return (
                                                <button
                                                    key={preset.id}
                                                    type="button"
                                                    onClick={() => setSolventPreset(preset.id)}
                                                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${isSelected
                                                        ? 'border-blue-500 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-500'
                                                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-700'
                                                        }`}
                                                >
                                                    {preset.isCustom ? t('solvent_custom' as any) : preset.label}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {solventPreset === 'custom' && (
                                        <div className="mt-3 space-y-2">
                                            <input
                                                type="text"
                                                value={customSolvent}
                                                onChange={(e) => setCustomSolvent(e.target.value)}
                                                placeholder={t('solvent_custom_placeholder' as any)}
                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                                            />
                                            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                                                {t('solvent_custom_notice' as any)}
                                            </p>
                                            {isResolvingSolvent && (
                                                <div className="flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-300">
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    {t('solvent_resolving' as any)}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    {t('input_volume')}
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
                                disabled={isResolvingSolvent}
                                className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 active:bg-blue-800 shadow-lg shadow-blue-200 dark:shadow-blue-900/20 transition-all disabled:cursor-not-allowed disabled:opacity-70 flex items-center gap-2"
                            >
                                {isResolvingSolvent && <Loader2 className="h-4 w-4 animate-spin" />}
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
