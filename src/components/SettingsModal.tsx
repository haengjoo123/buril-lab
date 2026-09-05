import React from 'react';
import { Capacitor } from '@capacitor/core';
import { RotateCcw, ShieldCheck, X, Globe, MessageSquarePlus, Bug, Lightbulb, MessageCircle, Send, CheckCircle2, UserMinus, KeyRound, Moon, Sun } from 'lucide-react';
import { useWasteStore } from '../store/useWasteStore';
import { useTranslation } from 'react-i18next';
import { CustomDialog } from './CustomDialog';
import { supabase } from '../services/supabaseClient';
import { useOnboardingStore } from '../store/useOnboardingStore';
import { useAuth } from '../hooks/useAuth';
import { useThemeMode } from '../hooks/useThemeMode';
import type { FeedbackType } from '../types/feedback';
import { analyticsService } from '../services/analyticsService';
import {
    LEGACY_SAFETY_ACKNOWLEDGEMENT_STORAGE_KEY,
    SAFETY_ACKNOWLEDGEMENT_STORAGE_KEY,
} from './SafetyDisclaimer';
import { DELETION_UI_ENABLED } from '../config/deletion';
import { MfaSettingsPanel } from './MfaSettingsPanel';

const onboardingPlatform = Capacitor.isNativePlatform() ? 'native' : 'web';

interface SettingsModalProps {
    isAuthenticated?: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isAuthenticated: authenticatedFromLayout, onClose }) => {
        const clearCart = useWasteStore((state) => state.clearCart);
        const clearSearchHistory = useWasteStore((state) => state.clearSearchHistory);
        const resetOnboarding = useOnboardingStore((state) => state.resetOnboarding);
    const { t, i18n } = useTranslation();
    const deleteConfirmPhrase = t('settings_delete_account_confirm_phrase');

    const { session, updatePassword, deleteAccount } = useAuth();
    const isAuthenticated = authenticatedFromLayout ?? Boolean(session);
    const { isDarkMode, toggleThemeMode } = useThemeMode();
    const [dialogConfig, setDialogConfig] = React.useState<{
        isOpen: boolean;
        type: 'alert' | 'confirm' | 'prompt';
        title: string;
        description: string;
        isDestructive?: boolean;
        onConfirm?: () => void;
        inputValue?: string;
        inputPlaceholder?: string;
        isConfirmLoading?: boolean;
    }>({ isOpen: false, type: 'alert', title: '', description: '' });

    const [deleteInputValue, setDeleteInputValue] = React.useState('');
    const [showPasswordChange, setShowPasswordChange] = React.useState(false);
    const [accountPassword, setAccountPassword] = React.useState('');
    const [accountPasswordConfirm, setAccountPasswordConfirm] = React.useState('');
    const [passwordChangeError, setPasswordChangeError] = React.useState('');
    const [passwordChangeSuccess, setPasswordChangeSuccess] = React.useState('');
    const [isChangingPassword, setIsChangingPassword] = React.useState(false);

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
            title: t('settings_reset_data'),
            description: t('settings_reset_confirm_desc'),
            isDestructive: true,
            onConfirm: () => {
                clearCart();
                clearSearchHistory();
                const currentLang = i18n.language;
                localStorage.clear();
                localStorage.setItem('i18nextLng', currentLang);

                setDialogConfig({
                    isOpen: true,
                    type: 'alert',
                    title: t('settings_reset_complete_title'),
                    description: t('settings_reset_complete_desc'),
                    onConfirm: () => window.location.reload()
                });
            }
        });
    };

    const handleViewDisclaimer = () => {
        setDialogConfig({
            isOpen: true,
            type: 'confirm',
            title: t('settings_view_guide'),
            description: t('settings_view_guide_confirm_desc'),
            onConfirm: () => {
                localStorage.removeItem(SAFETY_ACKNOWLEDGEMENT_STORAGE_KEY);
                localStorage.removeItem(LEGACY_SAFETY_ACKNOWLEDGEMENT_STORAGE_KEY);
                setDialogConfig({
                    isOpen: true,
                    type: 'alert',
                    title: t('settings_view_guide_complete_title'),
                    description: t('settings_view_guide_complete_desc'),
                    onConfirm: () => window.location.reload()
                });
            }
        });
    };

    const handleReplayOnboarding = () => {
        resetOnboarding();
        void analyticsService.trackOnboardingEvent({
            eventType: 'replayed',
            sourceScreen: 'settings',
            platform: onboardingPlatform,
            metadata: {
                language: i18n.language,
            },
        });
        onClose();
    };

    const handleDeleteAccount = () => {
        setDeleteInputValue('');
        setDialogConfig({
            isOpen: true,
            type: 'prompt',
            title: t('settings_delete_account'),
            description: t('settings_delete_account_confirm'),
            isDestructive: true,
            inputPlaceholder: t('settings_delete_account_confirm_input', { phrase: deleteConfirmPhrase }),
            onConfirm: async () => {} // Logic is handled in CustomDialog onConfirm prop directly
        });
    };

    const handlePasswordChangeSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setPasswordChangeError('');
        setPasswordChangeSuccess('');

        if (!accountPassword.trim() || !accountPasswordConfirm.trim()) {
            setPasswordChangeError(t('settings_password_change_empty'));
            return;
        }

        if (accountPassword !== accountPasswordConfirm) {
            setPasswordChangeError(t('auth_error_password_mismatch'));
            return;
        }

        if (accountPassword.length < 6) {
            setPasswordChangeError(t('auth_error_password_short'));
            return;
        }

        setIsChangingPassword(true);
        try {
            const { error } = await updatePassword(accountPassword);
            if (error) {
                setPasswordChangeError(error);
                return;
            }

            setAccountPassword('');
            setAccountPasswordConfirm('');
            setShowPasswordChange(false);
            setPasswordChangeSuccess(t('settings_password_change_success'));
        } catch {
            setPasswordChangeError(t('settings_password_change_error'));
        } finally {
            setIsChangingPassword(false);
        }
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
                user_email: user?.email ?? null,
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 backdrop-blur-sm animate-in fade-in duration-200 sm:p-5">
            <div className="flex w-full max-w-[360px] max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-xl bg-white shadow-2xl animate-in zoom-in-95 duration-200 dark:bg-slate-900 sm:max-w-[380px] sm:max-h-[calc(100dvh-2.5rem)] sm:rounded-2xl">

                <div className="flex shrink-0 items-center justify-between border-b border-gray-100 p-3.5 dark:border-slate-800 sm:p-4">
                    <h3 className="text-base font-bold text-slate-800 dark:text-white sm:text-lg">
                        {showFeedback ? t('feedback_title') : t('settings_title')}
                    </h3>
                    <button
                        type="button"
                        onClick={showFeedback ? handleCloseFeedback : onClose}
                        className="shrink-0 rounded-full p-1 transition-colors hover:bg-gray-100 dark:hover:bg-slate-800"
                        aria-label={t('btn_close')}
                    >
                        <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </button>
                </div>

                {/* ── Feedback Panel ── */}
                {showFeedback ? (
                    <div className="min-h-0 overflow-y-auto overscroll-contain p-3.5 sm:p-4">
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
                            <form onSubmit={handleFeedbackSubmit} className="space-y-3 sm:space-y-4">
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
                    <div className="min-h-0 space-y-2.5 overflow-y-auto overscroll-contain p-3 sm:space-y-3 sm:p-4">
                        {/* Language Switcher */}
                        <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-800 sm:p-4">
                            <div className="mb-2.5 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 sm:mb-3 sm:text-base">
                                <Globe className="w-4 h-4" />
                                <span>{t('settings_language')}</span>
                            </div>
                            <div className="flex bg-white dark:bg-slate-900 rounded-lg p-1 border border-gray-200 dark:border-slate-700">
                                <button
                                    onClick={() => changeLanguage('ko')}
                                    className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${i18n.language === 'ko' ? 'bg-blue-100 text-blue-700 shadow-sm dark:bg-blue-900 dark:text-blue-300' : 'text-gray-400 dark:text-gray-600 hover:text-gray-600'}`}
                                >
                                    {t('settings_language_option_ko')}
                                </button>
                                <button
                                    onClick={() => changeLanguage('en')}
                                    className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${i18n.language === 'en' ? 'bg-blue-100 text-blue-700 shadow-sm dark:bg-blue-900 dark:text-blue-300' : 'text-gray-400 dark:text-gray-600 hover:text-gray-600'}`}
                                >
                                    {t('settings_language_option_en')}
                                </button>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={toggleThemeMode}
                            className="flex w-full items-center justify-between rounded-xl bg-slate-50 p-3 text-left text-slate-700 transition-colors hover:bg-slate-100 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800 sm:p-4"
                            aria-pressed={isDarkMode}
                        >
                            <span className="flex min-w-0 items-center gap-2.5">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                                    {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                                </span>
                                <span className="min-w-0">
                                    <span className="block text-sm font-semibold">{t('theme_dark_mode')}</span>
                                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                                        {isDarkMode ? t('theme_mode_on') : t('theme_mode_off')}
                                    </span>
                                </span>
                            </span>
                            <span className={`flex h-5 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${isDarkMode ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`}>
                                <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${isDarkMode ? 'translate-x-5' : 'translate-x-0'}`} />
                            </span>
                        </button>

                        {/* Feedback Button */}
                        <button
                            onClick={() => {
                                if (!isAuthenticated) {
                                    setDialogConfig({
                                        isOpen: true,
                                        type: 'alert',
                                        title: '로그인이 필요합니다',
                                        description: '앱 개선 제안은 로그인을 하셔야 접수하실 수 있습니다.',
                                        onConfirm: () => setDialogConfig(prev => ({ ...prev, isOpen: false }))
                                    });
                                    return;
                                }
                                setShowFeedback(true);
                            }}
                            className="flex w-full items-center justify-between rounded-xl bg-violet-50 p-3 text-left text-violet-700 transition-colors hover:bg-violet-100 dark:bg-violet-900/10 dark:text-violet-400 dark:hover:bg-violet-900/20 sm:p-4"
                        >
                            <div>
                                <span className="font-medium block">{t('feedback_btn')}</span>
                                <span className="text-xs text-violet-500 dark:text-violet-500 mt-0.5 block">{t('feedback_desc')}</span>
                            </div>
                            <MessageSquarePlus className="w-5 h-5 flex-shrink-0 ml-2" />
                        </button>

                        {isAuthenticated && (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowPasswordChange(prev => !prev);
                                        setPasswordChangeError('');
                                        setPasswordChangeSuccess('');
                                        setAccountPassword('');
                                        setAccountPasswordConfirm('');
                                    }}
                                    className="flex w-full items-center justify-between p-3 text-left text-slate-700 transition-colors hover:bg-white/70 dark:text-slate-200 dark:hover:bg-slate-800 sm:p-4"
                                >
                                    <div>
                                        <span className="font-medium block">{t('settings_password_change')}</span>
                                        <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 block">{t('settings_password_change_desc')}</span>
                                    </div>
                                    <KeyRound className="w-5 h-5 flex-shrink-0 ml-2 text-slate-500" />
                                </button>

                                {showPasswordChange && (
                                    <form onSubmit={handlePasswordChangeSubmit} className="px-4 pb-4 space-y-3">
                                        <input
                                            type="password"
                                            value={accountPassword}
                                            onChange={e => {
                                                setAccountPassword(e.target.value);
                                                setPasswordChangeError('');
                                                setPasswordChangeSuccess('');
                                            }}
                                            placeholder={t('auth_new_password')}
                                            autoComplete="new-password"
                                            disabled={isChangingPassword}
                                            className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-700 transition-colors disabled:opacity-60"
                                        />
                                        <input
                                            type="password"
                                            value={accountPasswordConfirm}
                                            onChange={e => {
                                                setAccountPasswordConfirm(e.target.value);
                                                setPasswordChangeError('');
                                                setPasswordChangeSuccess('');
                                            }}
                                            placeholder={t('auth_password_confirm')}
                                            autoComplete="new-password"
                                            disabled={isChangingPassword}
                                            className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-700 transition-colors disabled:opacity-60"
                                        />

                                        {passwordChangeError && (
                                            <p className="text-xs text-red-500">{passwordChangeError}</p>
                                        )}

                                        <button
                                            type="submit"
                                            disabled={isChangingPassword}
                                            className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-medium text-sm transition-colors"
                                        >
                                            {isChangingPassword ? (
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            ) : (
                                                <KeyRound className="w-4 h-4" />
                                            )}
                                            {isChangingPassword ? t('dialog_processing') : t('settings_password_change_submit')}
                                        </button>
                                    </form>
                                )}
                            </div>
                        )}

                        {passwordChangeSuccess && (
                            <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300">
                                <CheckCircle2 className="w-4 h-4 shrink-0" />
                                <span>{passwordChangeSuccess}</span>
                            </div>
                        )}

                        {isAuthenticated && <MfaSettingsPanel />}

                        <hr className="my-1.5 border-gray-100 dark:border-slate-800 sm:my-2" />

                        <button
                            onClick={handleResetData}
                            className="flex w-full items-center justify-between rounded-xl bg-red-50 p-3 text-left text-red-700 transition-colors hover:bg-red-100 dark:bg-red-900/10 dark:text-red-400 dark:hover:bg-red-900/20 sm:p-4"
                        >
                            <span className="font-medium">{t('settings_reset_data')}</span>
                            <RotateCcw className="w-5 h-5" />
                        </button>
                        <p className="text-xs text-gray-500 dark:text-gray-400 px-1">
                            {t('settings_reset_desc')}
                        </p>

                        <hr className="my-1.5 border-gray-100 dark:border-slate-800 sm:my-2" />

                        <button
                            onClick={handleViewDisclaimer}
                            className="flex w-full items-center justify-between rounded-xl bg-blue-50 p-3 text-left text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/10 dark:text-blue-400 dark:hover:bg-blue-900/20 sm:p-4"
                        >
                            <span className="font-medium">{t('settings_view_guide')}</span>
                            <ShieldCheck className="w-5 h-5" />
                        </button>

                        <button
                            onClick={handleReplayOnboarding}
                            className="flex w-full items-center justify-between rounded-xl bg-emerald-50 p-3 text-left text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-900/10 dark:text-emerald-400 dark:hover:bg-emerald-900/20 sm:p-4"
                        >
                            <span className="font-medium">{t('settings_replay_onboarding')}</span>
                            <Lightbulb className="w-5 h-5" />
                        </button>

                        {isAuthenticated && DELETION_UI_ENABLED && (
                            <>
                                <hr className="my-1.5 border-gray-100 dark:border-slate-800 sm:my-2" />
                                <button
                                    onClick={handleDeleteAccount}
                                    className="flex w-full items-center justify-between rounded-xl bg-red-50/50 p-3 text-left text-red-600 transition-colors hover:bg-red-50 dark:bg-red-950/20 dark:text-red-500 dark:hover:bg-red-900/40 sm:p-4"
                                >
                                    <span className="font-medium text-sm">{t('settings_delete_account')}</span>
                                    <UserMinus className="w-4 h-4 opacity-70" />
                                </button>
                                <p className="text-xs text-red-400/80 px-1 text-center">
                                    {t('settings_delete_account_desc')}
                                </p>
                            </>
                        )}
                    </div>
                )}

                <div className="flex shrink-0 flex-col items-center gap-1.5 bg-gray-50 p-3 text-xs text-gray-400 dark:bg-slate-950/50 dark:text-gray-600 sm:gap-2 sm:p-4">
                    <a
                        href="/privacy"
                        className="hover:text-blue-600 dark:hover:text-blue-400 underline underline-offset-2 transition-colors"
                    >
                        {t('settings_privacy_policy', '개인정보처리방침')}
                    </a>
                    <span>{t('app_title')} v1.0.0</span>
                </div>
            </div>

            <CustomDialog
                isOpen={dialogConfig.isOpen}
                onClose={closeDialog}
                title={dialogConfig.title}
                description={dialogConfig.description}
                type={dialogConfig.type}
                isDestructive={dialogConfig.isDestructive}
                inputValue={deleteInputValue}
                onInputChange={setDeleteInputValue}
                inputPlaceholder={dialogConfig.inputPlaceholder}
                isConfirmLoading={dialogConfig.isConfirmLoading}
                onConfirm={async () => {
                    if (DELETION_UI_ENABLED
                        && dialogConfig.type === 'prompt'
                        && dialogConfig.title === t('settings_delete_account')) {
                        if (deleteInputValue !== deleteConfirmPhrase) {
                            alert(t('settings_delete_account_confirm_input', { phrase: deleteConfirmPhrase }));
                            return;
                        }
                        
                        setDialogConfig(prev => ({ ...prev, isConfirmLoading: true }));
                        const { error } = await deleteAccount();
                        setDialogConfig(prev => ({ ...prev, isConfirmLoading: false }));
                        
                        if (error) {
                            alert(t('settings_delete_account_error') + '\n' + error);
                        } else {
                            closeDialog();
                            setTimeout(() => alert(t(
                                'settings_delete_account_queued',
                                '계정 삭제 요청이 안전하게 접수되었습니다.',
                            )), 100);
                        }
                    } else if (dialogConfig.onConfirm) {
                        dialogConfig.onConfirm();
                    }
                }}
            />
        </div>
    );
};
