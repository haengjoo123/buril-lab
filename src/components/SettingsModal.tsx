import React from 'react';
import { RotateCcw, ShieldCheck, X, Globe } from 'lucide-react';
import { useWasteStore } from '../store/useWasteStore';
import { useTranslation } from 'react-i18next';

interface SettingsModalProps {
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
    const clearCart = useWasteStore((state) => state.clearCart);
    const { t, i18n } = useTranslation();

    const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng);
        localStorage.setItem('i18nextLng', lng); // Persist manually if needed, or rely on detector
    };

    const handleResetData = () => {
        if (confirm('모든 데이터를 초기화하시겠습니까? (장바구니 및 검색 기록)')) {
            clearCart();
            const currentLang = i18n.language;
            localStorage.clear();
            
            // Restore language preference
            localStorage.setItem('i18nextLng', currentLang);
            
            alert('초기화되었습니다. 페이지를 새로고침합니다.');
            window.location.reload();
        }
    };

    const handleViewDisclaimer = () => {
        localStorage.removeItem('buril-safety-acknowledged');
        alert('안전 면책 동의가 초기화되었습니다. 메인 화면으로 돌아가면 다시 표시됩니다.');
        window.location.reload();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-[350px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">

                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center">
                    <h3 className="font-bold text-lg text-slate-800 dark:text-white">{t('settings_title')}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    {/* Language Switcher */}
                    <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-xl mb-2">
                        <div className="flex items-center gap-2 mb-3 text-slate-700 dark:text-slate-300 font-medium">
                            <Globe className="w-4 h-4" />
                            <span>{t('settings_language')}</span>
                        </div>
                        <div className="flex bg-white dark:bg-slate-900 rounded-lg p-1 border border-gray-200 dark:border-slate-700">
                            <button
                                onClick={() => changeLanguage('ko')}
                                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${i18n.language === 'ko' ? 'bg-blue-100 text-blue-700 shadow-sm dark:bg-blue-900 dark:text-blue-300' : 'text-gray-400 dark:text-gray-600 hover:text-gray-600'}`}
                            >
                                한국어
                            </button>
                            <button
                                onClick={() => changeLanguage('en')}
                                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${i18n.language === 'en' ? 'bg-blue-100 text-blue-700 shadow-sm dark:bg-blue-900 dark:text-blue-300' : 'text-gray-400 dark:text-gray-600 hover:text-gray-600'}`}
                            >
                                English
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={handleResetData}
                        className="w-full flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20 text-red-700 dark:text-red-400 rounded-xl transition-colors text-left"
                    >
                        <span className="font-medium">{t('settings_reset_data')}</span>
                        <RotateCcw className="w-5 h-5" />
                    </button>
                    <p className="text-xs text-gray-500 dark:text-gray-400 px-1">
                        {t('settings_reset_desc')}
                    </p>

                    <hr className="border-gray-100 dark:border-slate-800 my-2" />

                    <button
                        onClick={handleViewDisclaimer}
                        className="w-full flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/10 hover:bg-blue-100 dark:hover:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-xl transition-colors text-left"
                    >
                        <span className="font-medium">{t('settings_view_guide')}</span>
                        <ShieldCheck className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 bg-gray-50 dark:bg-slate-950/50 text-center text-xs text-gray-400 dark:text-gray-600">
                    Buril-rab v1.0.0
                </div>
            </div>
        </div>
    );
};
