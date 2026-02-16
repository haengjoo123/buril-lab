import React, { useEffect, useState } from 'react';
import type { Chemical, MsdsSection } from '../types';
import { fetchKoshaMsds } from '../services/koshaApi';
import { fetchPubChemMsds } from '../services/pubchemApi';
import { Loader2, X, FileText, ChevronDown, ChevronRight } from 'lucide-react';

interface MsdsModalProps {
    chemical: Chemical;
    isOpen: boolean;
    onClose: () => void;
}

export const MsdsModal: React.FC<MsdsModalProps> = ({ chemical, isOpen, onClose }) => {
    const [loading, setLoading] = useState(true);
    const [sections, setSections] = useState<MsdsSection[]>([]);
    const [error, setError] = useState<string | null>(null);

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

        try {
            let data: MsdsSection[] = [];

            // 1. Try KOSHA first if ID exists (Korean context)
            if (chemical.koshaId) {
                console.log('Fetching from KOSHA...');
                data = await fetchKoshaMsds(chemical.koshaId);
            }

            // 2. If no KOSHA ID or KOSHA returned empty (and we have PubChem CID), try PubChem
            if (data.length === 0 && chemical.id) {
                console.log('Fetching from PubChem...');
                data = await fetchPubChemMsds(chemical.id);
            }

            if (data.length === 0) {
                setError('MSDS 정보를 찾을 수 없습니다.');
            } else {
                setSections(data);
            }
        } catch (err) {
            setError('데이터를 불러오는 중 오류가 발생했습니다.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden border border-gray-100 dark:border-slate-800 animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-5 border-b border-gray-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <FileText className="w-5 h-5 text-blue-600" />
                            MSDS 정보 (물질안전보건자료)
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
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full space-y-4">
                            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                            <p className="text-slate-500 animate-pulse">데이터를 불러오는 중입니다...</p>
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
                                다시 시도하기
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {sections.map((section, idx) => (
                                <SectionItem key={idx} section={section} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

import { getPictogramUrl } from '../data/ghsCodes';

const SectionItem: React.FC<{ section: MsdsSection }> = ({ section }) => {
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
                        <p className="text-sm text-gray-400 italic">내용 없음</p>
                    )}
                </div>
            )}
        </div>
    );
};
