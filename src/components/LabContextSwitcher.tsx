import React, { useState, useEffect } from 'react';
import { useLabStore } from '../store/useLabStore';
import { labService } from '../services/labService';
import { Check, ChevronDown, Users, User } from 'lucide-react';
import { LabManagementModal } from './LabManagementModal';
import { useTranslation } from 'react-i18next';
import { resolveLabSegmentAction } from './labContextSegment';

// Same shape as SegmentedControl: a 44px hit area with the visible pill inset by 4px,
// so the switcher matches the 44px header buttons instead of growing to 50px on touch.
const SEGMENT_BUTTON = 'group flex h-11 items-center rounded-xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const SEGMENT_PILL = 'flex h-full min-w-0 items-center gap-1.5 rounded-lg px-2 text-sm transition-colors @min-[11rem]:px-2.5';
const SEGMENT_IDLE = 'font-medium text-slate-500 group-hover:bg-white/70 group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:bg-slate-700/60 dark:group-hover:text-slate-100';
const SEGMENT_PERSONAL_ACTIVE = 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-100 dark:ring-slate-700';
const SEGMENT_LAB_ACTIVE = 'bg-blue-600 font-semibold text-white shadow-sm group-hover:bg-blue-700';
// Width priority on phones: the current lab name first. The inactive segment stays icon-only
// until the switcher is tablet-wide (container ≥ 18rem), and the active lab pill drops its
// people icon below 13rem (the blue fill already says "lab"), so 320–390px phones show
// 3–7 characters of the lab name instead of one.
const INACTIVE_LABEL = 'hidden @min-[18rem]:inline';
const ACTIVE_LAB_ICON = 'hidden h-4 w-4 shrink-0 @min-[13rem]:block';

export const LabContextSwitcher: React.FC = () => {
    const { t } = useTranslation();
    const { currentLabId, lastLabId, setCurrentLabId, myLabs, setMyLabs } = useLabStore();
    const [isOpen, setIsOpen] = useState(false);
    const [isManageOpen, setIsManageOpen] = useState(false);
    const [labsLoaded, setLabsLoaded] = useState(false);

    useEffect(() => {
        labService.getMyLabs()
            .then(setMyLabs)
            .catch(console.error)
            .finally(() => setLabsLoaded(true));
    }, [setMyLabs]);

    useEffect(() => {
        if (!isOpen) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [isOpen]);

    const labsReady = labsLoaded || myLabs.length > 0;
    const isLab = Boolean(currentLabId);
    const opensMenu = isLab || !labsReady;
    const currentLabName = myLabs.find(m => m.lab_id === currentLabId)?.lab?.name || t('lab_default_name');

    const selectPersonal = () => {
        setCurrentLabId(null);
        setIsOpen(false);
    };

    const pressLabSegment = () => {
        const action = resolveLabSegmentAction({ currentLabId, lastLabId, myLabs, labsReady });
        if (action.type === 'switch') setCurrentLabId(action.labId);
        else if (action.type === 'open-manage') setIsManageOpen(true);
        else setIsOpen(open => !open);
    };

    return (
        <div className="relative min-w-0 flex-1">
            {/* Size container only (no fixed/absolute children), so the menu backdrop below still covers the screen. */}
            <div className="@container w-full min-w-0">
                <div
                    role="group"
                    aria-label={t('lab_switcher_title')}
                    className="inline-flex max-w-full min-w-0 items-center overflow-hidden rounded-xl bg-slate-100 align-middle dark:bg-slate-800"
                >
                    <button
                        type="button"
                        onClick={selectPersonal}
                        aria-pressed={!isLab}
                        aria-label={t('lab_personal_space')}
                        title={t('lab_personal_space')}
                        className={`${SEGMENT_BUTTON} shrink-0`}
                    >
                        <span className={`${SEGMENT_PILL} ${isLab ? SEGMENT_IDLE : SEGMENT_PERSONAL_ACTIVE}`}>
                            <User className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className={isLab ? INACTIVE_LABEL : undefined}>{t('lab_segment_personal')}</span>
                        </span>
                    </button>
                    <button
                        type="button"
                        data-testid="lab-context-lab-segment"
                        onClick={pressLabSegment}
                        aria-pressed={isLab}
                        aria-label={isLab ? undefined : t('lab_segment_lab')}
                        title={isLab ? currentLabName : t('lab_segment_lab')}
                        aria-busy={labsReady ? undefined : true}
                        aria-haspopup={opensMenu ? 'menu' : undefined}
                        aria-expanded={opensMenu ? isOpen : undefined}
                        className={`${SEGMENT_BUTTON} min-w-0`}
                    >
                        <span className={`${SEGMENT_PILL} ${isLab ? SEGMENT_LAB_ACTIVE : SEGMENT_IDLE}`}>
                            <Users className={isLab ? ACTIVE_LAB_ICON : 'h-4 w-4 shrink-0'} aria-hidden="true" />
                            <span className={isLab
                                ? 'min-w-0 max-w-[9rem] truncate whitespace-nowrap sm:max-w-[14rem] lg:max-w-[18rem]'
                                : INACTIVE_LABEL}
                            >
                                {isLab ? currentLabName : t('lab_segment_lab')}
                            </span>
                            {isLab && (
                                <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                            )}
                        </span>
                    </button>
                </div>
            </div>

            {isOpen && (
                <>
                    {/* Backdrop to close when clicking outside */}
                    <button
                        type="button"
                        className="fixed inset-0 z-40 cursor-default"
                        onClick={() => setIsOpen(false)}
                        aria-label={t('common_close_menu')}
                    />

                    <div
                        role="menu"
                        aria-label={t('lab_list')}
                        className="absolute left-0 top-full z-50 mt-1.5 w-64 max-w-[calc(var(--overlay-width,100vw)-2rem)] max-h-[calc(var(--overlay-height,100dvh)-6rem)] overflow-y-auto rounded-xl border border-slate-100 bg-white py-2 shadow-lg dark:border-slate-700 dark:bg-slate-800"
                    >
                        <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                            {t('lab_list')}
                        </div>
                        {!labsReady ? (
                            <div className="px-4 py-2 text-sm text-slate-400">{t('lab_switcher_loading')}</div>
                        ) : myLabs.length === 0 ? (
                            <div className="px-4 py-2 text-sm italic text-slate-400">{t('lab_no_joined')}</div>
                        ) : (
                            myLabs.map(member => {
                                const selected = member.lab_id === currentLabId;
                                return (
                                    <button
                                        key={member.lab_id}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={selected}
                                        onClick={() => { setCurrentLabId(member.lab_id); setIsOpen(false); }}
                                        className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${selected ? 'bg-blue-50 font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50'}`}
                                    >
                                        <Check className={`h-4 w-4 shrink-0 ${selected ? '' : 'invisible'}`} aria-hidden="true" />
                                        <span className="min-w-0 flex-1 truncate">{member.lab?.name || t('common_unknown')}</span>
                                        <span className="shrink-0 text-xs font-normal capitalize text-slate-400">{t(`member_role_${member.role}`)}</span>
                                    </button>
                                );
                            })
                        )}

                        <div className="mx-2 mt-2 border-t border-slate-100 pt-2 dark:border-slate-700">
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setIsOpen(false); setIsManageOpen(true); }}
                                className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                            >
                                <Users className="h-4 w-4" aria-hidden="true" /> {t('lab_manage_join')}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {isManageOpen && (
                <LabManagementModal onClose={() => setIsManageOpen(false)} />
            )}
        </div>
    );
};
