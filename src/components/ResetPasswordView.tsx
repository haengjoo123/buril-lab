import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, FlaskConical, Loader2, Lock } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export function ResetPasswordView() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { session, isLoading: isAuthLoading, updatePassword, signOut } = useAuth();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isComplete, setIsComplete] = useState(false);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);

        if (!password.trim() || !confirmPassword.trim()) {
            setError(t('auth_reset_password_empty'));
            return;
        }

        if (password !== confirmPassword) {
            setError(t('auth_error_password_mismatch'));
            return;
        }

        if (password.length < 6) {
            setError(t('auth_error_password_short'));
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await updatePassword(password);
            if (result.error) {
                setError(result.error);
            } else {
                setPassword('');
                setConfirmPassword('');
                setIsComplete(true);
            }
        } catch {
            setError(t('auth_error_generic'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBackToLogin = async () => {
        await signOut();
        navigate('/login', { replace: true });
    };

    if (isAuthLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950 p-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25 mb-4">
                        <FlaskConical className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
                        {t('auth_reset_password_title')}
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {t('auth_reset_password_desc')}
                    </p>
                </div>

                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-2xl shadow-xl shadow-black/5 dark:shadow-black/20 border border-white/50 dark:border-slate-700/50 p-6">
                    {isComplete ? (
                        <div className="space-y-4 text-center">
                            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-300" />
                            </div>
                            <div>
                                <h2 className="text-base font-bold text-slate-800 dark:text-white">
                                    {t('auth_reset_password_success_title')}
                                </h2>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                    {t('auth_reset_password_success_desc')}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleBackToLogin}
                                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-500/20 transition-colors"
                            >
                                {t('auth_reset_go_to_login')}
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {!session && (
                                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl text-xs text-amber-700 dark:text-amber-300">
                                    {t('auth_reset_invalid_link')}
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                    {t('auth_new_password')}
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        placeholder="********"
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                                        autoComplete="new-password"
                                        disabled={isSubmitting || !session}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                    {t('auth_password_confirm')}
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(event) => setConfirmPassword(event.target.value)}
                                        placeholder="********"
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                                        autoComplete="new-password"
                                        disabled={isSubmitting || !session}
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl text-xs text-red-600 dark:text-red-400">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isSubmitting || !session}
                                className="w-full py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                                {isSubmitting ? t('dialog_processing') : t('auth_reset_password_submit')}
                            </button>

                            <button
                                type="button"
                                onClick={() => navigate('/login', { replace: true })}
                                className="w-full text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                            >
                                {t('auth_reset_back_to_login')}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
