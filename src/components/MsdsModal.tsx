/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Chemical, MsdsSection } from '../types';
import { fetchKoshaMsds } from '../services/koshaApi';
import { fetchPubChemMsds } from '../services/pubchemApi';
import { Loader2, X, FileText, ChevronDown, ChevronRight } from 'lucide-react';

const KOSHA_REFERENCE_URL = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do';

interface MsdsModalProps {
    chemical: Chemical;
    isOpen: boolean;
    onClose: () => void;
}

export const MsdsModal: React.FC<MsdsModalProps> = ({ chemical, isOpen, onClose }) => {
    const { t, i18n } = useTranslation();
    const [loading, setLoading] = useState(true);
    const [sections, setSections] = useState<MsdsSection[]>([]);
    const [missingSections, setMissingSections] = useState<number[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [koshaReferenceUrl, setKoshaReferenceUrl] = useState(KOSHA_REFERENCE_URL);

    // Prevent body scroll when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            loadMsdsData();
        } else {
            document.body.style.overflow = 'auto';
        }
        return () => {
            document.body.style.overflow = 'auto';
        };
    }, [isOpen, chemical]);

    const loadMsdsData = async () => {
        setLoading(true);
        setError(null);
        setSections([]);
        setMissingSections([]);
        setKoshaReferenceUrl(KOSHA_REFERENCE_URL);

        try {
            let data: MsdsSection[] = [];
            let missing: number[] = [];
            const isEnglish = i18n.language === 'en';

            if (isEnglish) {
                // English: PubChem (English) first, KOSHA fallback
                if (chemical.id) {
                    console.log('Fetching from PubChem (EN priority)...');
                    data = await fetchPubChemMsds(chemical.id);
                }
                if (data.length === 0 && chemical.koshaId) {
                    console.log('Fallback to KOSHA...');
                    const koshaData = await fetchKoshaMsds(chemical.koshaId);
                    setKoshaReferenceUrl(koshaData.officialUrl || KOSHA_REFERENCE_URL);
                    data = koshaData.sections;
                    missing = koshaData.missingSections;
                }
            } else {
                // Korean: KOSHA (Korean) first, PubChem fallback
                if (chemical.koshaId) {
                    console.log('Fetching from KOSHA (KO priority)...');
                    const koshaData = await fetchKoshaMsds(chemical.koshaId);
                    setKoshaReferenceUrl(koshaData.officialUrl || KOSHA_REFERENCE_URL);
                    data = koshaData.sections;
                    missing = koshaData.missingSections;
                }
                if (data.length === 0 && chemical.id) {
                    console.log('Fallback to PubChem...');
                    data = await fetchPubChemMsds(chemical.id);
                    if (data.length > 0) {
                        missing = [];
                    }
                }
            }

            if (data.length === 0) {
                setError(t('msds_not_found'));
            } else {
                setSections(data);
                setMissingSections(missing);
            }
        } catch (err) {
            setError(t('msds_load_error'));
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden border border-gray-100 dark:border-slate-800 animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-5 border-b border-gray-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <FileText className="w-5 h-5 text-blue-600" />
                            <span className="sm:hidden">{t('msds_title_short')}</span>
                            <span className="hidden sm:inline">{t('msds_title')}</span>
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            {chemical.name} {chemical.casNumber && `• CAS: ${chemical.casNumber}`}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-slate-900">
                    {chemical.koshaId && (
                        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-100">
                            <p>
                                {i18n.language === 'en'
                                    ? 'KOSHA is a reference. The exact product manufacturer SDS and your institution rules take priority.'
                                    : 'KOSHA는 참고자료입니다. 정확한 제품의 제조사 SDS와 소속 기관 규칙을 우선 확인하세요.'}
                            </p>
                            <a href={koshaReferenceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex font-semibold underline">
                                {i18n.language === 'en' ? 'Open official KOSHA page' : 'KOSHA 공식 페이지 열기'}
                            </a>
                        </div>
                    )}
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full space-y-4">
                            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                            <p className="text-slate-500 animate-pulse">{t('msds_loading')}</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full text-center p-6">
                            <div className="w-16 h-16 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                                <FileText className="w-8 h-8 text-gray-400" />
                            </div>
                            <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">{error}</h3>
                            <button
                                onClick={loadMsdsData}
                                className="text-blue-600 hover:underline text-sm"
                            >
                                {t('msds_retry')}
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {missingSections.length > 0 && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                                    {t('msds_incomplete', { sections: missingSections.join(', ') })}
                                </div>
                            )}
                            {sections.map((section, idx) => (
                                <SectionItem key={idx} section={section} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

import { getPictogramUrl } from '../data/ghsCodes';

const SectionItem: React.FC<{ section: MsdsSection }> = ({ section }) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);

    const renderValue = (label: string, value: string) => {
        // Detect Pictogram fields (KOSHA: "그림문자", PubChem: "Pictogram(s)")
        if (label === '그림문자' || label.toLowerCase().includes('pictogram')) {
            // Split by pipe (KOSHA) or newlines/commas
            const codes = value.split(/[|\n,]+/).map(s => s.trim()).filter(Boolean);

            // Map to URLs
            const images = codes.map(code => {
                const url = getPictogramUrl(code);
                return { code, url };
            }).filter(item => item.url);

            if (images.length > 0) {
                return (
                    <div className="flex flex-wrap gap-4 mt-1">
                        {images.map((img, idx) => (
                            <div key={idx} className="flex flex-col items-center group">
                                <div className="w-20 h-20 bg-white border border-gray-200 rounded-lg shadow-sm flex items-center justify-center p-2 transition-transform hover:scale-105">
                                    <img
                                        src={img.url}
                                        alt={img.code}
                                        className="w-full h-full object-contain"
                                    />
                                </div>
                                <span className="text-xs text-slate-400 mt-1">{img.code.replace(/\.(gif|jpg|png|svg)$/i, '')}</span>
                            </div>
                        ))}
                    </div>
                );
            }
        }
        // Handle pipe separators with newlines for better readability
        if (value && value.includes('|')) {
            return (
                <div className="flex flex-col gap-1">
                    {value.split('|').map((part, index) => (
                        <span key={index}>{part.trim()}</span>
                    ))}
                </div>
            );
        }

        return value || '-';
    };

    return (
        <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors text-left"
            >
                <h3 className="font-bold text-slate-800 dark:text-slate-200 text-base">
                    {section.title}
                </h3>
                {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                ) : (
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                )}
            </button>

            {isExpanded && (
                <div className="p-5 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-700 space-y-3">
                    {section.content.length > 0 ? (
                        section.content.map((item, i) => (
                            <div key={i} className="flex flex-col sm:flex-row sm:gap-4 text-xs border-b last:border-0 border-gray-50 dark:border-slate-800/50 pb-2 last:pb-0">
                                <div className="sm:w-1/3 text-slate-500 dark:text-slate-400 font-medium whitespace-pre-wrap sm:text-right flex-shrink-0">
                                    {item.label}
                                </div>
                                <div className="sm:w-2/3 text-slate-800 dark:text-slate-300 font-normal whitespace-pre-wrap break-words">
                                    {renderValue(item.label, item.value)}
                                </div>
                            </div>
                        ))
                    ) : (
                        <p className="text-sm text-gray-400 italic">{t('msds_no_content')}</p>
                    )}
                </div>
            )}
        </div>
    );
};
