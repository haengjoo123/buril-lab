import React from 'react';
import { RotateCcw, ShieldCheck, X, Globe, MessageSquarePlus, Bug, Lightbulb, MessageCircle, Send, CheckCircle2 } from 'lucide-react';
import { useWasteStore } from '../store/useWasteStore';
import { useTranslation } from 'react-i18next';
import { CustomDialog } from './CustomDialog';
import { supabase } from '../services/supabaseClient';
import { useOnboardingStore } from '../store/useOnboardingStore';

interface SettingsModalProps {
    onClose: () => void;
}

type FeedbackType = 'bug' | 'improvement' | 'general';

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
    const clearCart = useWasteStore((state) => state.clearCart);
    const resetOnboarding = useOnboardingStore((state) => state.resetOnboarding);
    const { t, i18n } = useTranslation();

    const [dialogConfig, setDialogConfig] = React.useState<{
        isOpen: boolean;
        type: 'alert' | 'confirm';
        title: string;
        description: string;
        isDestructive?: boolean;
        onConfirm?: () => void;
    }>({ isOpen: false, type: 'alert', title: '', description: '' });

    // Feedback state
    const [showFeedback, setShowFeedback] = React.useState(false);
    const [feedbackType, setFeedbackType] = React.useState<FeedbackType>('improvement');
    const [feedbackMessage, setFeedbackMessage] = React.useState('');
    const [feedbackContact, setFeedbackContact] = React.useState('');
    const [feedbackError, setFeedbackError] = React.useState('');
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [submitSuccess, setSubmitSuccess] = React.useState(false);

    const closeDialog = () => setDialogConfig(prev => ({ ...prev, isOpen: false }));

    const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng);
        localStorage.setItem('i18nextLng', lng);
    };

    const handleResetData = () => {
        setDialogConfig({
            isOpen: true,
            type: 'confirm',
            title: '초기화',
            description: '모든 데이터를 초기화하시겠습니까? (장바구니 및 검색 기록)',
            isDestructive: true,
            onConfirm: () => {
                clearCart();
                const currentLang = i18n.language;
                localStorage.clear();
                localStorage.setItem('i18nextLng', currentLang);

                setDialogConfig({
                    isOpen: true,
                    type: 'alert',
                    title: '초기화 완료',
                    description: '초기화되었습니다. 페이지를 새로고침합니다.',
                    onConfirm: () => window.location.reload()
                });
            }
        });
    };

    const handleViewDisclaimer = () => {
        setDialogConfig({
            isOpen: true,
            type: 'confirm',
            title: '안전 면책 동의 초기화',
            description: '안전 면책 동의를 초기화하시겠습니까?',
            onConfirm: () => {
                localStorage.removeItem('buril-safety-acknowledged');
                setDialogConfig({
                    isOpen: true,
                    type: 'alert',
                    title: '초기화 완료',
                    description: '안전 면책 동의가 초기화되었습니다. 메인 화면으로 돌아가면 다시 표시됩니다.',
                    onConfirm: () => window.location.reload()
                });
            }
        });
    };

    const handleReplayOnboarding = () => {
        resetOnboarding();
        onClose();
    };

    const handleFeedbackSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!feedbackMessage.trim()) {
            setFeedbackError(t('feedback_required'));
            return;
        }
        setFeedbackError('');
        setIsSubmitting(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            const { error } = await supabase.from('feedback').insert({
                type: feedbackType,
                message: feedbackMessage.trim(),
                contact: feedbackContact.trim() || null,
                user_id: user?.id ?? null,
                user_agent: navigator.userAgent,
            });

            if (error) throw error;

            setSubmitSuccess(true);
            setFeedbackMessage('');
            setFeedbackContact('');
        } catch {
            setFeedbackError(t('feedback_error'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCloseFeedback = () => {
        setShowFeedback(false);
        setSubmitSuccess(false);
        setFeedbackMessage('');
        setFeedbackContact('');
        setFeedbackError('');
        setFeedbackType('improvement');
    };

    const feedbackTypeOptions: { value: FeedbackType; label: string; icon: React.ReactNode }[] = [
        { value: 'bug', label: t('feedback_type_bug'), icon: <Bug className="w-3.5 h-3.5" /> },
        { value: 'improvement', label: t('feedback_type_improvement'), icon: <Lightbulb className="w-3.5 h-3.5" /> },
        { value: 'general', label: t('feedback_type_general'), icon: <MessageCircle className="w-3.5 h-3.5" /> },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-[380px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">

                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center">
                    <h3 className="font-bold text-lg text-slate-800 dark:text-white">
                        {showFeedback ? t('feedback_title') : t('settings_title')}
                    </h3>
                    <button
                        onClick={showFeedback ? handleCloseFeedback : onClose}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </button>
                </div>

                {/* ── Feedback Panel ── */}
                {showFeedback ? (
                    <div className="p-4">
                        {submitSuccess ? (
                            /* Success State */
                            <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
                                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center animate-in zoom-in duration-300">
                                    <CheckCircle2 className="w-9 h-9 text-green-500" />
                                </div>
                                <h4 className="font-bold text-lg text-slate-800 dark:text-white">
                                    {t('feedback_success_title')}
                                </h4>
                                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                                    {t('feedback_success_desc')}
                                </p>
                                <button
                                    onClick={handleCloseFeedback}
                                    className="mt-2 px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors"
                                >
                                    {t('btn_close')}
                                </button>
                            </div>
                        ) : (
                            /* Feedback Form */
                            <form onSubmit={handleFeedbackSubmit} className="space-y-4">
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {t('feedback_desc')}
                                </p>

                                {/* Type Selector */}
                                <div>
                                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2 block">
                                        {t('feedback_type_label')}
                                    </label>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {feedbackTypeOptions.map(opt => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setFeedbackType(opt.value)}
                                                className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl text-[11px] font-medium border transition-all ${feedbackType === opt.value
                                                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 dark:border-blue-500 text-blue-700 dark:text-blue-300'
                                                        : 'bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600'
                                                    }`}
                                            >
                                                {opt.icon}
                                                <span className="leading-tight text-center">{opt.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Message */}
                                <div>
                                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 block">
                                        {t('feedback_message_label')} <span className="text-red-400">*</span>
                                    </label>
                                    <textarea
                                        value={feedbackMessage}
                                        onChange={e => { setFeedbackMessage(e.target.value); setFeedbackError(''); }}
                                        placeholder={t('feedback_message_placeholder')}
                                        rows={4}
                                        className={`w-full px-3 py-2.5 text-sm rounded-xl border transition-colors resize-none bg-gray-50 dark:bg-slate-800 text-slate-800 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 ${feedbackError
                                                ? 'border-red-400 focus:ring-red-300'
                                                : 'border-gray-200 dark:border-slate-700 focus:ring-blue-300 dark:focus:ring-blue-700'
                                            }`}
                                    />
                                    {feedbackError && (
                                        <p className="text-xs text-red-500 mt-1">{feedbackError}</p>
                                    )}
                                </div>

                                {/* Contact */}
                                <div>
                                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 block">
                                        {t('feedback_contact_label')}
                                    </label>
                                    <input
                                        type="text"
                                        value={feedbackContact}
                                        onChange={e => setFeedbackContact(e.target.value)}
                                        placeholder={t('feedback_contact_placeholder')}
                                        className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-slate-800 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-700 transition-colors"
                                    />
                                </div>

                                {/* Submit */}
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="w-full flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white rounded-xl font-medium text-sm transition-all"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            {t('feedback_submitting')}
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-4 h-4" />
                                            {t('feedback_submit')}
                                        </>
                                    )}
                                </button>
                            </form>
                        )}
                    </div>
                ) : (
                    /* ── Settings Panel ── */
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

                        {/* Feedback Button */}
                        <button
                            onClick={() => setShowFeedback(true)}
                            className="w-full flex items-center justify-between p-4 bg-violet-50 dark:bg-violet-900/10 hover:bg-violet-100 dark:hover:bg-violet-900/20 text-violet-700 dark:text-violet-400 rounded-xl transition-colors text-left"
                        >
                            <div>
                                <span className="font-medium block">{t('feedback_btn')}</span>
                                <span className="text-xs text-violet-500 dark:text-violet-500 mt-0.5 block">{t('feedback_desc')}</span>
                            </div>
                            <MessageSquarePlus className="w-5 h-5 flex-shrink-0 ml-2" />
                        </button>

                        <hr className="border-gray-100 dark:border-slate-800 my-2" />

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

                        <button
                            onClick={handleReplayOnboarding}
                            className="w-full flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-900/10 hover:bg-emerald-100 dark:hover:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-xl transition-colors text-left"
                        >
                            <span className="font-medium">{t('settings_replay_onboarding')}</span>
                            <Lightbulb className="w-5 h-5" />
                        </button>
                    </div>
                )}

                <div className="p-4 bg-gray-50 dark:bg-slate-950/50 text-center text-xs text-gray-400 dark:text-gray-600">
                    Buril-lab v1.0.0
                </div>
            </div>

            <CustomDialog
                isOpen={dialogConfig.isOpen}
                onClose={closeDialog}
                title={dialogConfig.title}
                description={dialogConfig.description}
                type={dialogConfig.type}
                isDestructive={dialogConfig.isDestructive}
                onConfirm={dialogConfig.onConfirm}
            />
        </div>
    );
};
