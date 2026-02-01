import React, { useState, useEffect } from 'react';
import { ShieldAlert, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const SafetyDisclaimer: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const { t, i18n } = useTranslation();

    useEffect(() => {
        const hasAcknowledged = localStorage.getItem('buril-safety-acknowledged');
        if (!hasAcknowledged) {
            setIsOpen(true);
        }
    }, []);

    const handleAcknowledge = () => {
        localStorage.setItem('buril-safety-acknowledged', 'true');
        setIsOpen(false);
    };

    if (!isOpen) return null;

    // Content defined here for simplicity instead of dictionary
    const content = i18n.language === 'ko' ? {
        points: [
            "본 서비스가 제공하는 폐액 분류 정보는 참고용이며, 실제 폐기 시에는 반드시 해당 시약의 MSDS(물질안전보건자료)와 소속 기관의 안전 규정을 최우선으로 따라야 합니다.",
            "제공된 결과에 따른 사고 및 손해에 대해 서비스 제공자는 법적 책임을 지지 않습니다.",
            "서로 다른 폐액을 혼합할 경우 폭발, 발열 등의 위험이 있으므로 혼합 전 적합성을 반드시 확인하십시오.",
            "불확실한 경우 반드시 연구실 안전관리자에게 문의하시기 바랍니다."
        ]
    } : {
        points: [
            "The disposal information provided is for reference only. Always prioritize the chemical's MSDS and your institution's safety regulations.",
            "The service provider is not liable for any accidents or damages resulting from the use of this information.",
            "Mixing different wastes can cause explosions or heat generation. Always verify compatibility before mixing.",
            "If uncertain, please consult your laboratory safety officer."
        ]
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 bg-black/70 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="w-full max-w-[400px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden p-6 animate-in zoom-in-95 duration-300">

                <div className="flex flex-col items-center text-center mb-6">
                    <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                        <ShieldAlert className="w-8 h-8 text-red-600 dark:text-red-500" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">
                        {t('disclaimer_title')}
                    </h2>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-sm text-slate-600 dark:text-slate-300 mb-6 border border-slate-100 dark:border-slate-700 max-h-[300px] overflow-y-auto">
                    <ul className="list-disc pl-4 space-y-2">
                        {content.points.map((point, i) => (
                            <li key={i}>
                                {i === 0 || i === 2 ? <strong>{point}</strong> : point}
                            </li>
                        ))}
                    </ul>
                </div>

                <button
                    onClick={handleAcknowledge}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-200 dark:shadow-blue-900/20"
                >
                    <Check className="w-5 h-5" />
                    {t('disclaimer_confirm')}
                </button>

            </div>
        </div>
    );
};
