import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { fetchReagentHandlingDraft } from '../services/reagentHandlingDraftService';
import type { ReagentHandlingDraft, ReagentHandlingDraftLookup } from '../utils/reagentHandlingDraft';

interface ReagentHandlingDraftPanelProps {
    casNumber?: string | null;
    name?: string | null;
    className?: string;
}

function List({ items }: { items: string[] }) {
    return (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {items.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
    );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h5 className="text-xs font-semibold text-slate-700 dark:text-slate-200">{title}</h5>
            <div className="mt-0.5 text-xs leading-5 text-slate-600 dark:text-slate-300">{children}</div>
        </div>
    );
}

/**
 * AI-drafted handling and storage notes, kept apart from the official GHS
 * (PubChem/KOSHA) section and always labelled as a draft. Text a reviewer
 * disputed is removed on the server. Renders nothing when no single draft matches.
 */
export const ReagentHandlingDraftPanel: React.FC<ReagentHandlingDraftPanelProps> = ({ casNumber, name, className = '' }) => {
    const { t } = useTranslation();
    const identity = `${casNumber || ''}|${name || ''}`;
    const [lookup, setLookup] = useState<{ identity: string; result: ReagentHandlingDraftLookup } | null>(null);

    useEffect(() => {
        let cancelled = false;
        void fetchReagentHandlingDraft(casNumber, name).then((result) => {
            if (!cancelled) setLookup({ identity, result });
        });
        return () => { cancelled = true; };
    }, [casNumber, name, identity]);

    const result = lookup?.identity === identity ? lookup.result : null;
    if (result?.status !== 'found') return null;
    const draft: ReagentHandlingDraft = result.draft;
    const { handling, storage } = draft;
    const verified = draft.reviewStatus === 'verified';
    const firstAid = handling.firstAid;
    const storageFlags = [
        storage.lightSensitive && t('ai_draft_flag_light'),
        storage.hygroscopic && t('ai_draft_flag_hygroscopic'),
        storage.airSensitive && t('ai_draft_flag_air'),
        storage.waterReactive && t('ai_draft_flag_water'),
        storage.peroxideFormer && t('ai_draft_flag_peroxide'),
    ].filter((value): value is string => Boolean(value));
    const hasStorage = Boolean(storage.temp || storage.container || storage.conditions?.length
        || storageFlags.length || storage.peroxideTestIntervalMonths);

    return (
        <section
            aria-labelledby="ai-handling-draft-title"
            className={`rounded-lg border border-dashed border-violet-300 bg-violet-50/40 p-3 text-left dark:border-violet-800 dark:bg-violet-950/20 ${className}`}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 id="ai-handling-draft-title" className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <Sparkles className="h-4 w-4 text-violet-500" aria-hidden="true" />
                    {t('ai_draft_title')}
                </h4>
                <span className={`rounded-full px-2 py-0.5 text-2xs font-bold ${verified
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'}`}
                >
                    {verified ? t('ai_draft_badge_verified') : t('ai_draft_badge_unreviewed')}
                </span>
            </div>
            <p className="mt-1 text-2xs text-slate-500 dark:text-slate-400">{t('ai_draft_disclaimer')}</p>

            <div className="mt-2 space-y-2">
                {handling.ppe && <Block title={t('ai_draft_ppe')}><List items={handling.ppe} /></Block>}
                {handling.keyCautions && <Block title={t('ai_draft_key_cautions')}><List items={handling.keyCautions} /></Block>}
                {firstAid && (
                    <Block title={t('ai_draft_first_aid')}>
                        <dl className="space-y-0.5">
                            {firstAid.inhalation && <div><dt className="inline font-semibold">{t('ai_draft_first_aid_inhalation')}: </dt><dd className="inline">{firstAid.inhalation}</dd></div>}
                            {firstAid.skin && <div><dt className="inline font-semibold">{t('ai_draft_first_aid_skin')}: </dt><dd className="inline">{firstAid.skin}</dd></div>}
                            {firstAid.eye && <div><dt className="inline font-semibold">{t('ai_draft_first_aid_eye')}: </dt><dd className="inline">{firstAid.eye}</dd></div>}
                            {firstAid.ingestion && <div><dt className="inline font-semibold">{t('ai_draft_first_aid_ingestion')}: </dt><dd className="inline">{firstAid.ingestion}</dd></div>}
                        </dl>
                    </Block>
                )}
                {firstAid?.noteToPhysician && <Block title={t('ai_draft_note_to_physician')}>{firstAid.noteToPhysician}</Block>}
                {handling.spillSmall && <Block title={t('ai_draft_spill_small')}>{handling.spillSmall}</Block>}
                {handling.spillLarge && <Block title={t('ai_draft_spill_large')}>{handling.spillLarge}</Block>}
                {hasStorage && (
                    <Block title={t('ai_draft_storage')}>
                        {storage.temp && <p>{t('ai_draft_storage_temp')}: {storage.temp}</p>}
                        {storage.container && <p>{t('ai_draft_storage_container')}: {storage.container}</p>}
                        {storageFlags.length > 0 && <p>{storageFlags.join(' · ')}</p>}
                        {storage.peroxideTestIntervalMonths && (
                            <p>{t('ai_draft_peroxide_interval', { months: storage.peroxideTestIntervalMonths })}</p>
                        )}
                        {storage.conditions && <List items={storage.conditions} />}
                    </Block>
                )}
            </div>
        </section>
    );
};
