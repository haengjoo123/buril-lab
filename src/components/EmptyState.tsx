import React from 'react';
import { useTranslation } from 'react-i18next';

type EmptyVariant = 'inventory' | 'inventory_search' | 'logs' | 'logs_search' | 'cabinet' | 'audit';

interface EmptyStateProps {
    variant: EmptyVariant;
    /** Optional subtitle override */
    subtitle?: string;
}

/**
 * Inline SVG illustrations for each empty-state scenario.
 * Each illustration is a self-contained SVG with soft gradients and subtle animations,
 * responsive to dark-mode via CSS custom properties.
 */
const illustrations: Record<EmptyVariant, React.ReactNode> = {
    inventory: (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-44 h-auto mx-auto">
            {/* Shelf */}
            <rect x="30" y="110" width="140" height="6" rx="3" className="fill-slate-200 dark:fill-slate-700" />
            <rect x="40" y="80" width="120" height="6" rx="3" className="fill-slate-200 dark:fill-slate-700" />
            <rect x="30" y="110" width="6" height="40" rx="3" className="fill-slate-200 dark:fill-slate-700" />
            <rect x="164" y="110" width="6" height="40" rx="3" className="fill-slate-200 dark:fill-slate-700" />
            {/* Bottle 1 faded */}
            <rect x="55" y="58" width="20" height="22" rx="3" className="fill-emerald-100 dark:fill-emerald-900/30" opacity="0.6" />
            <rect x="60" y="50" width="10" height="10" rx="2" className="fill-emerald-200 dark:fill-emerald-800/40" opacity="0.6" />
            {/* Bottle 2 faded */}
            <rect x="90" y="62" width="20" height="18" rx="3" className="fill-blue-100 dark:fill-blue-900/30" opacity="0.5" />
            <rect x="95" y="54" width="10" height="10" rx="2" className="fill-blue-200 dark:fill-blue-800/40" opacity="0.5" />
            {/* Dashed outline box — "add item" hint */}
            <rect x="125" y="55" width="24" height="25" rx="4" strokeDasharray="4 3" strokeWidth="1.5" className="stroke-slate-300 dark:stroke-slate-600" fill="none" />
            <line x1="137" y1="62" x2="137" y2="75" strokeWidth="1.5" className="stroke-slate-300 dark:stroke-slate-600" strokeLinecap="round" />
            <line x1="131" y1="68.5" x2="143" y2="68.5" strokeWidth="1.5" className="stroke-slate-300 dark:stroke-slate-600" strokeLinecap="round" />
            {/* Sparkle */}
            <circle cx="160" cy="40" r="2" className="fill-amber-300 dark:fill-amber-500" opacity="0.7">
                <animate attributeName="opacity" values="0.3;0.9;0.3" dur="2.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="45" cy="48" r="1.5" className="fill-blue-300 dark:fill-blue-500" opacity="0.5">
                <animate attributeName="opacity" values="0.2;0.7;0.2" dur="3s" repeatCount="indefinite" />
            </circle>
        </svg>
    ),

    inventory_search: (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-auto mx-auto">
            {/* Magnifier */}
            <circle cx="90" cy="70" r="30" strokeWidth="4" className="stroke-slate-300 dark:stroke-slate-600" fill="none" />
            <line x1="112" y1="92" x2="135" y2="115" strokeWidth="5" strokeLinecap="round" className="stroke-slate-300 dark:stroke-slate-600" />
            {/* Question mark inside */}
            <text x="82" y="80" fontSize="28" fontWeight="bold" className="fill-slate-300 dark:fill-slate-600" fontFamily="sans-serif">?</text>
            {/* Small x marks */}
            <g className="stroke-red-300 dark:stroke-red-700" strokeWidth="1.5" strokeLinecap="round" opacity="0.6">
                <line x1="148" y1="45" x2="154" y2="51" />
                <line x1="154" y1="45" x2="148" y2="51" />
                <line x1="40" y1="105" x2="46" y2="111" />
                <line x1="46" y1="105" x2="40" y2="111" />
            </g>
        </svg>
    ),

    logs: (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-44 h-auto mx-auto">
            {/* Clipboard */}
            <rect x="55" y="25" width="90" height="115" rx="8" className="fill-white dark:fill-slate-800 stroke-slate-200 dark:stroke-slate-700" strokeWidth="2" />
            {/* Clip */}
            <rect x="80" y="18" width="40" height="16" rx="4" className="fill-slate-300 dark:fill-slate-600" />
            <rect x="88" y="14" width="24" height="12" rx="6" className="fill-slate-200 dark:fill-slate-700" />
            {/* Lines (empty rows) */}
            <rect x="70" y="50" width="60" height="4" rx="2" className="fill-slate-100 dark:fill-slate-700" />
            <rect x="70" y="62" width="45" height="4" rx="2" className="fill-slate-100 dark:fill-slate-700" />
            <rect x="70" y="74" width="55" height="4" rx="2" className="fill-slate-100 dark:fill-slate-700" />
            <rect x="70" y="86" width="38" height="4" rx="2" className="fill-slate-100 dark:fill-slate-700" />
            <rect x="70" y="98" width="50" height="4" rx="2" className="fill-slate-100 dark:fill-slate-700" />
            {/* Small flask icon */}
            <g transform="translate(88, 110)" opacity="0.5">
                <path d="M6 0 L6 8 L0 18 L12 18 L6 8" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
            </g>
            {/* Decorative sparkle */}
            <circle cx="155" cy="35" r="2" className="fill-blue-300 dark:fill-blue-500" opacity="0.6">
                <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2.8s" repeatCount="indefinite" />
            </circle>
        </svg>
    ),

    logs_search: (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-auto mx-auto">
            {/* Clipboard with magnifier */}
            <rect x="55" y="30" width="80" height="100" rx="8" className="fill-white dark:fill-slate-800 stroke-slate-200 dark:stroke-slate-700" strokeWidth="2" />
            <rect x="70" y="55" width="50" height="4" rx="2" className="fill-slate-100 dark:fill-slate-700" />
            <rect x="70" y="67" width="35" height="4" rx="2" className="fill-slate-100 dark:fill-slate-700" />
            <rect x="70" y="79" width="42" height="4" rx="2" className="fill-slate-100 dark:fill-slate-700" />
            {/* Magnifier overlay */}
            <circle cx="135" cy="95" r="20" strokeWidth="3" className="stroke-slate-300 dark:stroke-slate-600" fill="none" />
            <line x1="149" y1="109" x2="162" y2="122" strokeWidth="4" strokeLinecap="round" className="stroke-slate-300 dark:stroke-slate-600" />
            <text x="128" y="102" fontSize="18" fontWeight="bold" className="fill-slate-300 dark:fill-slate-600" fontFamily="sans-serif">?</text>
        </svg>
    ),

    cabinet: (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-44 h-auto mx-auto">
            {/* Cabinet body */}
            <rect x="45" y="20" width="110" height="120" rx="6" className="fill-white dark:fill-slate-800 stroke-slate-200 dark:stroke-slate-700" strokeWidth="2" />
            {/* Doors */}
            <line x1="100" y1="26" x2="100" y2="134" strokeWidth="1" className="stroke-slate-200 dark:stroke-slate-700" />
            {/* Handles */}
            <rect x="92" y="65" width="3" height="14" rx="1.5" className="fill-slate-300 dark:fill-slate-600" />
            <rect x="105" y="65" width="3" height="14" rx="1.5" className="fill-slate-300 dark:fill-slate-600" />
            {/* Shelves (visible through glass) */}
            <line x1="50" y1="55" x2="97" y2="55" strokeWidth="1" className="stroke-slate-100 dark:stroke-slate-700" strokeDasharray="3 2" />
            <line x1="103" y1="55" x2="150" y2="55" strokeWidth="1" className="stroke-slate-100 dark:stroke-slate-700" strokeDasharray="3 2" />
            <line x1="50" y1="90" x2="97" y2="90" strokeWidth="1" className="stroke-slate-100 dark:stroke-slate-700" strokeDasharray="3 2" />
            <line x1="103" y1="90" x2="150" y2="90" strokeWidth="1" className="stroke-slate-100 dark:stroke-slate-700" strokeDasharray="3 2" />
            {/* Plus hint */}
            <circle cx="100" cy="110" r="10" className="fill-blue-50 dark:fill-blue-900/30 stroke-blue-300 dark:stroke-blue-700" strokeWidth="1.5" strokeDasharray="3 2" />
            <line x1="96" y1="110" x2="104" y2="110" strokeWidth="1.5" className="stroke-blue-400 dark:stroke-blue-500" strokeLinecap="round" />
            <line x1="100" y1="106" x2="100" y2="114" strokeWidth="1.5" className="stroke-blue-400 dark:stroke-blue-500" strokeLinecap="round" />
            {/* Sparkle */}
            <circle cx="165" cy="30" r="2" className="fill-emerald-300 dark:fill-emerald-500" opacity="0.6">
                <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="35" cy="90" r="1.5" className="fill-blue-300 dark:fill-blue-500" opacity="0.4">
                <animate attributeName="opacity" values="0.2;0.6;0.2" dur="3.2s" repeatCount="indefinite" />
            </circle>
        </svg>
    ),

    audit: (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-auto mx-auto">
            {/* Shield */}
            <path d="M100 20 L140 40 L140 85 C140 110 120 130 100 140 C80 130 60 110 60 85 L60 40 Z"
                className="fill-white dark:fill-slate-800 stroke-slate-200 dark:stroke-slate-700" strokeWidth="2" />
            {/* Check mark */}
            <path d="M82 80 L94 92 L118 65" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
                className="stroke-emerald-400 dark:stroke-emerald-500" fill="none" />
            {/* Decorative mini-clock */}
            <circle cx="158" cy="40" r="8" className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1.5" fill="none" />
            <line x1="158" y1="36" x2="158" y2="40" strokeWidth="1.5" className="stroke-slate-300 dark:stroke-slate-600" strokeLinecap="round" />
            <line x1="158" y1="40" x2="162" y2="42" strokeWidth="1.5" className="stroke-slate-300 dark:stroke-slate-600" strokeLinecap="round" />
            {/* Sparkle */}
            <circle cx="42" cy="55" r="2" className="fill-amber-300 dark:fill-amber-500" opacity="0.6">
                <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2.5s" repeatCount="indefinite" />
            </circle>
        </svg>
    ),
};

const titleKeys: Record<EmptyVariant, string> = {
    inventory: 'empty_inventory_title',
    inventory_search: 'empty_inventory_search_title',
    logs: 'empty_logs_title',
    logs_search: 'empty_logs_search_title',
    cabinet: 'empty_cabinet_title',
    audit: 'empty_audit_title',
};

const descKeys: Record<EmptyVariant, string> = {
    inventory: 'empty_inventory_desc',
    inventory_search: 'empty_inventory_search_desc',
    logs: 'empty_logs_desc',
    logs_search: 'empty_logs_search_desc',
    cabinet: 'empty_cabinet_desc',
    audit: 'empty_audit_desc',
};

export const EmptyState: React.FC<EmptyStateProps> = ({ variant, subtitle }) => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col items-center justify-center py-14 px-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="mb-4 opacity-90">
                {illustrations[variant]}
            </div>
            <h3 className="text-base font-semibold text-slate-500 dark:text-slate-400 mb-1.5 text-center">
                {t(titleKeys[variant])}
            </h3>
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center max-w-[260px] leading-relaxed">
                {subtitle || t(descKeys[variant])}
            </p>
        </div>
    );
};
