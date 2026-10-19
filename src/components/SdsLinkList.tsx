import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FileText, Search } from 'lucide-react';
import { resolveManufacturerCasLinks, resolveSdsLinks, type SdsLink, type SdsLinkInput } from '../utils/sdsLinks';

interface SdsLinkListProps extends SdsLinkInput {
    /**
     * 'detail' lists every tier; 'compact' shows one link to the best match;
     * 'manufacturers' links the CAS search of every manufacturer that has one
     * (ignores brand and product number).
     */
    variant?: 'detail' | 'compact' | 'manufacturers';
    className?: string;
}

const TIER_LABEL_KEYS: Record<SdsLink['tier'], string> = {
    manufacturer_product: 'sds_tier_manufacturer_product',
    manufacturer_search: 'sds_tier_manufacturer_search',
    public_reference: 'sds_tier_public_reference',
};

export const SdsLinkList: React.FC<SdsLinkListProps> = ({ brand, productNumber, casNumber, variant = 'detail', className = '' }) => {
    const { t } = useTranslation();
    const links = useMemo(
        () => variant === 'manufacturers'
            ? resolveManufacturerCasLinks(casNumber)
            : resolveSdsLinks({ brand, productNumber, casNumber }),
        [variant, brand, productNumber, casNumber],
    );

    if (variant === 'manufacturers') {
        if (links.length === 0) return null;
        return (
            <section className={`rounded-lg border border-slate-200 p-3 text-left dark:border-slate-800 ${className}`}>
                <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <Search className="h-4 w-4 text-blue-600" aria-hidden="true" />
                    {t('sds_manufacturers_title')}
                </h4>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t('sds_manufacturers_hint', { value: links[0].query })}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                    {links.map((link) => (
                        <li key={link.source}>
                            <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={t(TIER_LABEL_KEYS[link.tier])}
                                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-blue-800 dark:hover:bg-blue-950/30"
                            >
                                {link.sourceName}
                                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                            </a>
                        </li>
                    ))}
                </ul>
            </section>
        );
    }

    if (variant === 'compact') {
        const best = links[0];
        if (!best) return null;
        return (
            <a
                href={best.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={t(TIER_LABEL_KEYS[best.tier])}
                className="inline-flex items-center gap-0.5 font-semibold text-blue-600 hover:underline dark:text-blue-400"
            >
                {t('sds_compact_label')}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
        );
    }

    const referenceOnly = links.length > 0 && links.every((link) => link.tier === 'public_reference');

    return (
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                <FileText className="h-4 w-4 text-blue-600" aria-hidden="true" />
                {t('sds_links_title')}
            </h4>
            {links.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('sds_no_links')}</p>
            ) : (
                <ul className="mt-3 space-y-2">
                    {links.map((link) => (
                        <li key={`${link.tier}:${link.source}`}>
                            <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/30"
                            >
                                <span className="min-w-0">
                                    <span className="block font-semibold text-slate-800 dark:text-slate-100">
                                        {link.sourceName} · {t(TIER_LABEL_KEYS[link.tier])}
                                    </span>
                                    <span className="block font-mono text-xs text-slate-500 dark:text-slate-400">
                                        {link.tier === 'manufacturer_product'
                                            ? t('sds_query_product_number', { value: link.query })
                                            : t('sds_query_cas', { value: link.query })}
                                    </span>
                                </span>
                                <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            </a>
                        </li>
                    ))}
                </ul>
            )}
            {referenceOnly && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t('sds_reference_only_notice')}</p>
            )}
        </div>
    );
};
