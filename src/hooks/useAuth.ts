/**
 * useAuth Hook
 * Manages Supabase Auth session state, sign in, sign up, and sign out.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import type { Session, User } from '@supabase/supabase-js';
import { postJson } from '../services/internalApi';
import { useInventoryHazardStore } from '../store/useInventoryHazardStore';

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
    deleteAccount: () => Promise<{ error: string | null; jobId?: string }>;
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

    const currentUserId = state.user?.id;

    const signOut = useCallback(async () => {
        if (currentUserId) useInventoryHazardStore.getState().clearUser(currentUserId);
        await supabase.auth.signOut();
    }, [currentUserId]);

    const deleteAccount = useCallback(async () => {
        try {
            const queued = await postJson<{ success: boolean; jobId: string; status: string }>(
                '/api/account/delete',
                { requestId: crypto.randomUUID() },
            );
            if (!queued || typeof queued !== 'object'
                || queued.success !== true
                || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(queued.jobId)
                || !['pending', 'running', 'retry_wait'].includes(queued.status)) {
                return { error: 'The deletion request could not be verified.' };
            }
            return { error: null, jobId: queued.jobId };
        } catch (error) {
            return { error: error instanceof Error ? error.message : 'Failed to delete account.' };
        }
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
