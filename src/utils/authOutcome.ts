/**
 * Turns Supabase Auth responses into small, UI-friendly outcomes so screens
 * never show raw English API messages.
 */

export interface AuthActionResult {
    error: string | null;
    errorCode?: string | null;
}

export interface SignUpResult extends AuthActionResult {
    /** The account exists but there is no session until the email link is opened. */
    needsEmailConfirmation: boolean;
}

interface AuthErrorLike {
    message: string;
    code?: string | null;
}

interface SignUpResponseLike {
    data: {
        user: { identities?: unknown[] | null } | null;
        session: unknown;
    } | null;
    error: AuthErrorLike | null;
}

export const ALREADY_REGISTERED_ERROR_CODE = 'user_already_exists';

export function toAuthActionResult(error: AuthErrorLike | null | undefined): AuthActionResult {
    if (!error) return { error: null, errorCode: null };
    return { error: error.message, errorCode: error.code ?? null };
}

export function toSignUpResult({ data, error }: SignUpResponseLike): SignUpResult {
    if (error) return { ...toAuthActionResult(error), needsEmailConfirmation: false };

    // With email confirmation on, Supabase answers an existing address with a
    // user that has no identities instead of an error.
    const identities = data?.user?.identities;
    if (data?.user && Array.isArray(identities) && identities.length === 0) {
        return {
            error: 'User already registered',
            errorCode: ALREADY_REGISTERED_ERROR_CODE,
            needsEmailConfirmation: false,
        };
    }

    return { error: null, errorCode: null, needsEmailConfirmation: !data?.session };
}

export type AuthErrorKind =
    | 'invalid_credentials'
    | 'already_registered'
    | 'email_not_confirmed'
    | 'weak_password'
    | 'same_password'
    | 'rate_limited'
    | 'invalid_email'
    | 'network'
    | 'generic';

const KIND_BY_CODE: Record<string, AuthErrorKind> = {
    invalid_credentials: 'invalid_credentials',
    user_already_exists: 'already_registered',
    email_exists: 'already_registered',
    email_not_confirmed: 'email_not_confirmed',
    weak_password: 'weak_password',
    same_password: 'same_password',
    over_request_rate_limit: 'rate_limited',
    over_email_send_rate_limit: 'rate_limited',
    over_sms_send_rate_limit: 'rate_limited',
    email_address_invalid: 'invalid_email',
};

// Fallbacks for servers or client errors that do not send a code. Order matters:
// "New password should be different..." must hit same_password before weak_password.
const KIND_BY_MESSAGE: Array<[RegExp, AuthErrorKind]> = [
    [/invalid login credentials/i, 'invalid_credentials'],
    [/already (been )?registered|user already exists/i, 'already_registered'],
    [/email not confirmed/i, 'email_not_confirmed'],
    [/rate limit|too many requests|for security purposes/i, 'rate_limited'],
    [/different from the old password/i, 'same_password'],
    [/weak password|password is too weak|password should/i, 'weak_password'],
    [/unable to validate email|invalid email|email address .*invalid/i, 'invalid_email'],
    [/failed to fetch|load failed|networkerror|network request failed|fetch failed/i, 'network'],
];

export function classifyAuthError(result: AuthActionResult): AuthErrorKind {
    const code = result.errorCode?.trim();
    if (code && KIND_BY_CODE[code]) return KIND_BY_CODE[code];

    const message = result.error ?? '';
    for (const [pattern, kind] of KIND_BY_MESSAGE) {
        if (pattern.test(message)) return kind;
    }
    return 'generic';
}

const MESSAGE_KEY_BY_KIND: Record<AuthErrorKind, string> = {
    invalid_credentials: 'auth_error_invalid_credentials',
    already_registered: 'auth_error_already_registered',
    email_not_confirmed: 'auth_error_email_not_confirmed',
    weak_password: 'auth_error_weak_password',
    same_password: 'auth_error_same_password',
    rate_limited: 'auth_error_rate_limited',
    invalid_email: 'auth_error_invalid_email',
    network: 'auth_error_network',
    generic: 'auth_error_generic',
};

export function getAuthErrorMessageKey(kind: AuthErrorKind): string {
    return MESSAGE_KEY_BY_KIND[kind];
}

/** Reads "...you can only request this after 42 seconds." style rate-limit messages. */
export function getRetryAfterSeconds(message: string | null | undefined): number | null {
    const match = message?.match(/after (\d+) seconds?/i);
    if (!match) return null;
    const seconds = Number(match[1]);
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : null;
}
