import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, Info, Loader2, Lock, LogIn, Mail, UserPlus } from 'lucide-react';
import logo from '../assets/burillab_app_icon.png';

type AuthMode = 'signIn' | 'signUp' | 'reset';

interface AuthViewProps {
    onSignIn: (email: string, password: string) => Promise<{ error: string | null }>;
    onSignUp: (email: string, password: string) => Promise<{ error: string | null }>;
    onRequestPasswordReset: (email: string) => Promise<{ error: string | null }>;
    authPrompt?: string;
    onBackToSearch?: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
    onSignIn,
    onSignUp,
    onRequestPasswordReset,
    authPrompt,
    onBackToSearch,
}) => {
    const { t } = useTranslation();
    const [authMode, setAuthMode] = useState<AuthMode>('signIn');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const isSignUp = authMode === 'signUp';
    const isReset = authMode === 'reset';

    const switchMode = (nextMode: AuthMode) => {
        setAuthMode(nextMode);
        setError(null);
        setSuccessMessage(null);
        setPassword('');
        setConfirmPassword('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccessMessage(null);

        if (!email.trim()) {
            setError(t(isReset ? 'auth_reset_email_required' : 'auth_error_empty'));
            return;
        }

        if (isReset) {
            setIsLoading(true);
            try {
                const result = await onRequestPasswordReset(email.trim());
                if (result.error) {
                    setError(result.error);
                } else {
                    setSuccessMessage(t('auth_reset_email_sent'));
                }
            } catch {
                setError(t('auth_error_generic'));
            } finally {
                setIsLoading(false);
            }
            return;
        }

        if (!password.trim()) {
            setError(t('auth_error_empty'));
            return;
        }

        if (isSignUp && password !== confirmPassword) {
            setError(t('auth_error_password_mismatch'));
            return;
        }

        if (password.length < 6) {
            setError(t('auth_error_password_short'));
            return;
        }

        setIsLoading(true);
        try {
            const result = isSignUp
                ? await onSignUp(email.trim(), password)
                : await onSignIn(email.trim(), password);

            if (result.error) {
                setError(result.error);
            }
        } catch {
            setError(t('auth_error_generic'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950 p-4">
            <div className="w-full max-w-md">
                {onBackToSearch && (
                    <button
                        type="button"
                        onClick={onBackToSearch}
                        className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        {t('auth_back_to_search')}
                    </button>
                )}

                {authPrompt && !isReset && (
                    <div className="mb-6 flex gap-3 rounded-xl border border-blue-200 dark:border-blue-800/50 bg-blue-50/90 dark:bg-blue-950/40 px-4 py-3 text-sm text-blue-900 dark:text-blue-100">
                        <Info className="w-5 h-5 shrink-0 mt-0.5" />
                        <p className="leading-snug">{authPrompt}</p>
                    </div>
                )}

                <div className="text-center mb-8">
                    <img
                        src={logo}
                        alt={t('app_logo_alt')}
                        className="mx-auto mb-4 h-16 w-16 rounded-2xl object-contain shadow-lg shadow-slate-900/10 dark:shadow-black/30"
                    />
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
                        {isReset ? t('auth_reset_title') : t('app_title')}
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {isReset ? t('auth_reset_desc') : t('auth_subtitle')}
                    </p>
                </div>

                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-2xl shadow-xl shadow-black/5 dark:shadow-black/20 border border-white/50 dark:border-slate-700/50 p-6">
                    {!isReset && (
                        <div className="flex bg-slate-100 dark:bg-slate-700/50 rounded-xl p-1 mb-6">
                            <button
                                type="button"
                                onClick={() => switchMode('signIn')}
                                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${authMode === 'signIn'
                                    ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-sm'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                            >
                                {t('auth_login')}
                            </button>
                            <button
                                type="button"
                                onClick={() => switchMode('signUp')}
                                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${authMode === 'signUp'
                                    ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-sm'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                            >
                                {t('auth_signup')}
                            </button>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                {t('auth_email')}
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="email@example.com"
                                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                                    autoComplete="email"
                                    disabled={isLoading}
                                />
                            </div>
                        </div>

                        {!isReset && (
                            <div>
                                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                    {t('auth_password')}
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="********"
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                                        autoComplete={isSignUp ? 'new-password' : 'current-password'}
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>
                        )}

                        {isSignUp && (
                            <div>
                                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                    {t('auth_password_confirm')}
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="********"
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                                        autoComplete="new-password"
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl text-xs text-red-600 dark:text-red-400">
                                {error}
                            </div>
                        )}

                        {successMessage && (
                            <div className="flex gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-xl text-xs text-emerald-700 dark:text-emerald-300">
                                <CheckCircle2 className="w-4 h-4 shrink-0" />
                                <span>{successMessage}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : isReset ? (
                                <>
                                    <Mail className="w-4 h-4" />
                                    {t('auth_reset_submit')}
                                </>
                            ) : isSignUp ? (
                                <>
                                    <UserPlus className="w-4 h-4" />
                                    {t('auth_signup')}
                                </>
                            ) : (
                                <>
                                    <LogIn className="w-4 h-4" />
                                    {t('auth_login')}
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-4 text-center">
                        {isReset ? (
                            <button
                                type="button"
                                onClick={() => switchMode('signIn')}
                                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                            >
                                {t('auth_reset_back_to_login')}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => switchMode('reset')}
                                className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                            >
                                {t('auth_forgot_password')}
                            </button>
                        )}
                    </div>
                </div>

                <div className="mt-4 text-center">
                    <a
                        href="/privacy"
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 underline underline-offset-2"
                    >
                        {t('auth_privacy_policy', 'Privacy Policy')}
                    </a>
                </div>
            </div>
        </div>
    );
};
