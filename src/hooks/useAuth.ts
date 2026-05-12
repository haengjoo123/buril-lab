/**
 * useAuth Hook
 * Manages Supabase Auth session state, sign in, sign up, and sign out.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import type { Session, User } from '@supabase/supabase-js';
import { postJson } from '../services/internalApi';

interface AuthState {
    session: Session | null;
    user: User | null;
    isLoading: boolean;
}

interface UseAuthReturn extends AuthState {
    signIn: (email: string, password: string) => Promise<{ error: string | null }>;
    signUp: (email: string, password: string) => Promise<{ error: string | null }>;
    requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
    updatePassword: (password: string) => Promise<{ error: string | null }>;
    signOut: () => Promise<void>;
    deleteAccount: () => Promise<{ error: string | null }>;
}

function getPasswordResetRedirectUrl(): string {
    const configuredUrl = import.meta.env.VITE_AUTH_REDIRECT_URL as string | undefined;
    const baseUrl = configuredUrl?.trim() || window.location.origin;
    return new URL('/reset-password', baseUrl).toString();
}

export function useAuth(): UseAuthReturn {
    const [state, setState] = useState<AuthState>({
        session: null,
        user: null,
        isLoading: true,
    });

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setState({
                session,
                user: session?.user ?? null,
                isLoading: false,
            });
        });

        // Listen for auth state changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setState({
                    session,
                    user: session?.user ?? null,
                    isLoading: false,
                });
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    const signIn = useCallback(async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message ?? null };
    }, []);

    const signUp = useCallback(async (email: string, password: string) => {
        const { error } = await supabase.auth.signUp({ email, password });
        return { error: error?.message ?? null };
    }, []);

    const requestPasswordReset = useCallback(async (email: string) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: getPasswordResetRedirectUrl(),
        });
        return { error: error?.message ?? null };
    }, []);

    const updatePassword = useCallback(async (password: string) => {
        const { error } = await supabase.auth.updateUser({ password });
        return { error: error?.message ?? null };
    }, []);

    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
    }, []);

    const deleteAccount = useCallback(async () => {
        try {
            await postJson<{ success: boolean }>('/api/account/delete', {});
        } catch (error) {
            return { error: error instanceof Error ? error.message : 'Failed to delete account.' };
        }

        await supabase.auth.signOut();
        return { error: null };
    }, []);

    return {
        ...state,
        signIn,
        signUp,
        requestPasswordReset,
        updatePassword,
        signOut,
        deleteAccount,
    };
}
