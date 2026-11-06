import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Info, Loader2, Lock, LogIn, Mail, MailCheck, RefreshCw, UserPlus } from 'lucide-react';
import logo from '../assets/burillab_app_icon.png';
import { resendSignupConfirmation } from '../hooks/useAuth';
import {
    classifyAuthError,
    getAuthErrorMessageKey,
    getRetryAfterSeconds,
    type AuthActionResult,
    type SignUpResult,
} from '../utils/authOutcome';

type AuthMode = 'signIn' | 'signUp' | 'reset' | 'verify';
type NoticeTone = 'error' | 'success' | 'info';

interface Notice {
    tone: NoticeTone;
    text: string;
}

const RESEND_COOLDOWN_SECONDS = 60;

const NOTICE_TONE_CLASSES: Record<NoticeTone, string> = {
    error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400',
    success: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300',
    info: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/50 text-blue-800 dark:text-blue-200',
};

const INPUT_CLASSES = 'w-full pl-10 py-2.5 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all';

const PRIMARY_BUTTON_CLASSES = 'w-full py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2';

interface AuthViewProps {
    onSignIn: (email: string, password: string) => Promise<AuthActionResult>;
    onSignUp: (email: string, password: string) => Promise<SignUpResult>;
    onRequestPasswordReset: (email: string) => Promise<AuthActionResult>;
    onResendSignupEmail?: (email: string) => Promise<AuthActionResult>;
    authPrompt?: string;
    onBackToSearch?: () => void;
}

function prefersPointerKeyboard(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export const AuthView: React.FC<AuthViewProps> = ({
    onSignIn,
    onSignUp,
    onRequestPasswordReset,
    onResendSignupEmail = resendSignupConfirmation,
    authPrompt,
    onBackToSearch,
}) => {
    const { t } = useTranslation();
    const [authMode, setAuthMode] = useState<AuthMode>('signIn');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isResending, setIsResending] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const emailInputRef = useRef<HTMLInputElement>(null);
    const passwordInputRef = useRef<HTMLInputElement>(null);
    const confirmInputRef = useRef<HTMLInputElement>(null);
    const pendingFocusRef = useRef<'password' | null>(null);

    const isSignUp = authMode === 'signUp';
    const isReset = authMode === 'reset';
    const isVerify = authMode === 'verify';

    // Desktop only: on phones an autofocus would pop the keyboard over the card.
    useEffect(() => {
        if (prefersPointerKeyboard()) emailInputRef.current?.focus();
    }, []);

    // Focus has to wait until the inputs are enabled again after a request.
    useEffect(() => {
        if (isLoading || pendingFocusRef.current !== 'password') return;
        pendingFocusRef.current = null;
        passwordInputRef.current?.focus();
    }, [isLoading, authMode]);

    useEffect(() => {
        if (resendCooldown <= 0) return;
        const timer = window.setTimeout(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
        return () => window.clearTimeout(timer);
    }, [resendCooldown]);

    const switchMode = (nextMode: AuthMode) => {
        setAuthMode(nextMode);
        setNotice(null);
        setPassword('');
        setConfirmPassword('');
    };

    const enterVerifyMode = (cooldownSeconds: number) => {
        setAuthMode('verify');
        setConfirmPassword('');
        setNotice(null);
        setResendCooldown(cooldownSeconds);
    };

    // Keeps the typed password so the user can log in with one tap once the email is confirmed.
    const returnToSignIn = () => {
        setAuthMode('signIn');
        setNotice(null);
        if (!password) pendingFocusRef.current = 'password';
    };

    const showAuthError = (result: AuthActionResult) => {
        const kind = classifyAuthError(result);

        if (kind === 'already_registered') {
            setAuthMode('signIn');
            setConfirmPassword('');
            setNotice({ tone: 'info', text: t('auth_error_already_registered') });
            pendingFocusRef.current = 'password';
            return;
        }

        if (kind === 'email_not_confirmed') {
            enterVerifyMode(0);
            return;
        }

        setNotice({ tone: 'error', text: t(getAuthErrorMessageKey(kind)) });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setNotice(null);
        const trimmedEmail = email.trim();

        if (!trimmedEmail) {
            setNotice({ tone: 'error', text: t(isReset ? 'auth_reset_email_required' : 'auth_error_empty') });
            return;
        }

        if (isReset) {
            setIsLoading(true);
            try {
                const result = await onRequestPasswordReset(trimmedEmail);
                if (result.error) {
                    showAuthError(result);
                } else {
                    setNotice({ tone: 'success', text: t('auth_reset_email_sent') });
                }
            } catch {
                setNotice({ tone: 'error', text: t('auth_error_generic') });
            } finally {
                setIsLoading(false);
            }
            return;
        }

        if (!password.trim()) {
            setNotice({ tone: 'error', text: t('auth_error_empty') });
            return;
        }

        if (isSignUp && password !== confirmPassword) {
            setNotice({ tone: 'error', text: t('auth_error_password_mismatch') });
            return;
        }

        if (password.length < 6) {
            setNotice({ tone: 'error', text: t('auth_error_password_short') });
            return;
        }

        setIsLoading(true);
        try {
            if (isSignUp) {
                const result = await onSignUp(trimmedEmail, password);
                if (result.error) {
                    showAuthError(result);
                } else if (result.needsEmailConfirmation) {
                    enterVerifyMode(RESEND_COOLDOWN_SECONDS);
                }
                // With a session, the app leaves this screen on its own.
            } else {
                const result = await onSignIn(trimmedEmail, password);
                if (result.error) showAuthError(result);
            }
        } catch {
            setNotice({ tone: 'error', text: t('auth_error_generic') });
        } finally {
            setIsLoading(false);
        }
    };

    const handleResend = async () => {
        if (isResending || resendCooldown > 0) return;
        setNotice(null);
        setIsResending(true);
        try {
            const result = await onResendSignupEmail(email.trim());
            if (!result.error) {
                setNotice({ tone: 'success', text: t('auth_verify_resent') });
                setResendCooldown(RESEND_COOLDOWN_SECONDS);
                return;
            }
            const kind = classifyAuthError(result);
            if (kind === 'rate_limited') {
                // The countdown on the button already says when to try again.
                setResendCooldown(getRetryAfterSeconds(result.error) ?? RESEND_COOLDOWN_SECONDS);
            } else {
                setNotice({ tone: 'error', text: t(getAuthErrorMessageKey(kind)) });
            }
        } catch {
            setNotice({ tone: 'error', text: t('auth_error_generic') });
        } finally {
            setIsResending(false);
        }
    };

    const handleEmailKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || isReset || password) return;
        event.preventDefault();
        passwordInputRef.current?.focus();
    };

    const handlePasswordKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || !isSignUp || confirmPassword) return;
        event.preventDefault();
        confirmInputRef.current?.focus();
    };

    const noticeBox = notice && (
        <div
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`flex gap-2 p-3 border rounded-xl text-xs text-left ${NOTICE_TONE_CLASSES[notice.tone]}`}
        >
            {notice.tone === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            {notice.tone === 'info' && <Info className="w-4 h-4 shrink-0" />}
            <span>{notice.text}</span>
        </div>
    );

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

                {authPrompt && !isReset && !isVerify && (
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
                    {isVerify ? (
                        <div className="space-y-4 text-center">
                            <div className="mx-auto w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                                <MailCheck className="w-7 h-7 text-blue-600 dark:text-blue-300" />
                            </div>
                            <div>
                                <h2 className="text-base font-bold text-slate-800 dark:text-white">
                                    {t('auth_verify_title')}
                                </h2>
                                <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300 break-all">
                                    {email.trim()}
                                </p>
                            </div>

                            {noticeBox}

                            <button type="button" onClick={returnToSignIn} className={PRIMARY_BUTTON_CLASSES}>
                                <LogIn className="w-4 h-4" />
                                {t('auth_verify_to_login')}
                            </button>
                            <button
                                type="button"
                                onClick={handleResend}
                                disabled={isResending || resendCooldown > 0}
                                className="w-full py-3 border border-slate-200 dark:border-slate-600 bg-white/60 dark:bg-slate-700/40 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 tabular-nums"
                            >
                                {isResending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                {resendCooldown > 0
                                    ? t('auth_verify_resend_wait', { seconds: resendCooldown })
                                    : t('auth_verify_resend')}
                            </button>
                        </div>
                    ) : (
                        <>
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
                                    <label htmlFor="auth-email" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                        {t('auth_email')}
                                    </label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                        <input
                                            ref={emailInputRef}
                                            id="auth-email"
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            onKeyDown={handleEmailKeyDown}
                                            placeholder="email@example.com"
                                            className={`${INPUT_CLASSES} pr-4`}
                                            autoComplete="email"
                                            inputMode="email"
                                            autoCapitalize="none"
                                            autoCorrect="off"
                                            spellCheck={false}
                                            enterKeyHint={isReset ? 'send' : 'next'}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </div>

                                {!isReset && (
                                    <div>
                                        <label htmlFor="auth-password" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                            {t('auth_password')}
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                ref={passwordInputRef}
                                                id="auth-password"
                                                type={showPassword ? 'text' : 'password'}
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                onKeyDown={handlePasswordKeyDown}
                                                placeholder="********"
                                                className={`${INPUT_CLASSES} pr-11`}
                                                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                                                autoCapitalize="none"
                                                autoCorrect="off"
                                                spellCheck={false}
                                                enterKeyHint={isSignUp ? 'next' : 'go'}
                                                disabled={isLoading}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword((visible) => !visible)}
                                                aria-label={t('auth_show_password')}
                                                aria-pressed={showPassword}
                                                className="absolute right-1 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                            >
                                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {isSignUp && (
                                    <div>
                                        <label htmlFor="auth-password-confirm" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                                            {t('auth_password_confirm')}
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                ref={confirmInputRef}
                                                id="auth-password-confirm"
                                                type={showPassword ? 'text' : 'password'}
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                placeholder="********"
                                                className={`${INPUT_CLASSES} pr-4`}
                                                autoComplete="new-password"
                                                autoCapitalize="none"
                                                autoCorrect="off"
                                                spellCheck={false}
                                                enterKeyHint="go"
                                                disabled={isLoading}
                                            />
                                        </div>
                                    </div>
                                )}

                                {noticeBox}

                                <button type="submit" disabled={isLoading} className={PRIMARY_BUTTON_CLASSES}>
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
                        </>
                    )}
                </div>

                <div className="mt-4 flex justify-center gap-4">
                    <a
                        href="/privacy"
                        className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 underline underline-offset-2"
                    >
                        {t('auth_privacy_policy', 'Privacy Policy')}
                    </a>
                    <a
                        href="/terms"
                        className="text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 underline underline-offset-2"
                    >
                        {t('auth_terms_of_service', 'Terms of Service')}
                    </a>
                </div>
            </div>
        </div>
    );
};
