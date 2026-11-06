import React, { useEffect, useRef, useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildLabInviteUrl, shareLabInvite } from './labInvite';

interface LabInviteButtonProps {
    labId: string;
    labName: string;
    institutionName?: string | null;
    /** `primary`: full-width call to action; `compact`: small pill for headers and toasts. */
    variant?: 'primary' | 'compact';
    className?: string;
}

const VARIANT_SHAPE = {
    primary: 'w-full min-h-12 justify-center gap-2 rounded-xl px-4 text-sm font-semibold shadow-sm',
    compact: 'min-h-9 gap-1.5 rounded-lg px-3 text-xs font-semibold',
} as const;
const VARIANT_TONE = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    compact: 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50',
} as const;
const COPIED_TONE = 'bg-emerald-600 text-white';

/** Shares the lab's invite link (share sheet, or clipboard with a "copied" state). */
export const LabInviteButton: React.FC<LabInviteButtonProps> = ({ labId, labName, institutionName, variant = 'primary', className }) => {
    const { t } = useTranslation();
    const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'failed'>('idle');
    const resetTimer = useRef<number | null>(null);
    const url = buildLabInviteUrl({ labId, labName });

    useEffect(() => () => {
        if (resetTimer.current) window.clearTimeout(resetTimer.current);
    }, []);

    const handleShare = async () => {
        if (state === 'busy') return;
        setState('busy');
        // The institution tells same-named labs apart, as on the join search cards.
        const institution = institutionName?.trim();
        const text = `${t('lab_invite_share_text', { name: labName })}${institution ? ` (${institution})` : ''}`;
        const outcome = await shareLabInvite({ title: labName, text, url });
        if (outcome === 'copied' || outcome === 'failed') {
            setState(outcome);
            if (resetTimer.current) window.clearTimeout(resetTimer.current);
            if (outcome === 'copied') resetTimer.current = window.setTimeout(() => setState('idle'), 2000);
            return;
        }
        setState('idle');
    };

    if (state === 'failed') {
        // Clipboard blocked: hand over the link itself so it can still be copied by hand.
        return (
            <input
                readOnly
                value={url}
                aria-label={t('lab_invite_share')}
                onFocus={event => event.currentTarget.select()}
                autoFocus
                className={`w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 ${className ?? ''}`}
            />
        );
    }

    const copied = state === 'copied';
    return (
        <button
            type="button"
            onClick={() => { void handleShare(); }}
            aria-live="polite"
            className={`inline-flex items-center transition-colors disabled:opacity-60 ${VARIANT_SHAPE[variant]} ${copied ? COPIED_TONE : VARIANT_TONE[variant]} ${className ?? ''}`}
            disabled={state === 'busy'}
        >
            {copied
                ? <Check className={variant === 'primary' ? 'h-5 w-5' : 'h-3.5 w-3.5'} aria-hidden="true" />
                : <Share2 className={variant === 'primary' ? 'h-5 w-5' : 'h-3.5 w-3.5'} aria-hidden="true" />}
            {copied ? t('lab_invite_copied') : t('lab_invite_share')}
        </button>
    );
};
