import React, { useMemo } from 'react';
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Loader2, MoveRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFridgeStore } from '../../../store/fridgeStore';
import type {
    CompatibilityPlanIssue,
    CompatibilityPlanPreview,
    StoragePlacementGroup,
} from '../../../types/fridge';

interface PlannedMove {
    itemId: string;
    name: string;
    fromLevel: number | null;
    toLevel: number;
}

interface CabinetAutoLayoutPreviewModalProps {
    preview: CompatibilityPlanPreview | null;
    isApplying: boolean;
    onApply: () => void | Promise<void>;
    onCancel: () => void;
    onFocusIssue: (itemId: string) => void;
}

const STORAGE_GROUP_LABEL_KEYS: Record<StoragePlacementGroup, string> = {
    FLAMMABLE: 'storage_group_flammable',
    OXIDIZER: 'storage_group_oxidizer',
    INORGANIC_ACID: 'storage_group_inorganic_acid',
    ORGANIC_ACID: 'storage_group_organic_acid',
    BASE: 'storage_group_base',
    TOXIC_CYANIDE: 'storage_group_cyanide',
    TOXIC_SULFIDE: 'storage_group_sulfide',
    TOXIC_AZIDE: 'storage_group_azide',
    ACUTE_TOXIC: 'storage_group_acute_toxic',
    WATER_REACTIVE: 'storage_group_water_reactive',
    PYROPHORIC: 'storage_group_pyrophoric',
    EXPLOSIVE: 'storage_group_explosive',
    ORGANIC_PEROXIDE: 'storage_group_organic_peroxide',
    COMPRESSED_GAS: 'storage_group_compressed_gas',
    ORGANIC_SOLVENT: 'storage_group_organic_solvent',
    GENERAL: 'storage_group_general',
};

function SummaryCard({
    label,
    value,
    tone = 'slate',
}: {
    label: string;
    value: number;
    tone?: 'slate' | 'emerald' | 'amber' | 'red';
}) {
    const toneClassName = {
        slate: 'bg-slate-50 border-slate-200 text-slate-700',
        emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
        amber: 'bg-amber-50 border-amber-200 text-amber-700',
        red: 'bg-red-50 border-red-200 text-red-700',
    }[tone];

    return (
        <div className={`rounded-2xl border p-4 ${toneClassName}`}>
            <div className="text-xs font-semibold">{label}</div>
            <div className="mt-2 text-2xl font-bold">{value}</div>
        </div>
    );
}

function MoveList({ moves }: { moves: PlannedMove[] }) {
    const { t } = useTranslation();
    const levelLabel = (level: number) => t('inventory_shelf_level', { level });

    return (
        <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <h4 className="text-sm font-semibold text-slate-800">{t('cabinet_auto_place_moved')}</h4>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {moves.length}
                </span>
            </div>
            <ul className="max-h-56 overflow-y-auto px-4 py-2">
                {moves.map((move) => (
                    <li key={move.itemId} className="flex min-h-10 items-center gap-3 border-b border-slate-100 py-2 last:border-b-0">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{move.name}</span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-slate-600">
                            {move.fromLevel === null || move.fromLevel === move.toLevel ? (
                                <>
                                    {levelLabel(move.toLevel)}
                                    <ArrowLeftRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                                </>
                            ) : (
                                <>
                                    <span className="text-slate-400">{levelLabel(move.fromLevel)}</span>
                                    <MoveRight className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                                    <span className="text-emerald-700">{levelLabel(move.toLevel)}</span>
                                </>
                            )}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function IssueList({
    title,
    items,
    onFocusIssue,
}: {
    title: string;
    items: CompatibilityPlanIssue[];
    onFocusIssue: (itemId: string) => void;
}) {
    const { t } = useTranslation();

    return (
        <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {items.length}
                </span>
            </div>

            <div className="max-h-56 overflow-y-auto px-3 py-3">
                <div className="flex flex-col gap-2">
                    {items.map((issue) => (
                        <button
                            key={`${issue.itemId}-${issue.messageKey}`}
                            type="button"
                            onClick={() => onFocusIssue(issue.itemId)}
                            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-slate-800">
                                        {issue.itemName}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                        <span className="rounded-full bg-white px-2 py-0.5 font-medium text-slate-600">
                                            {t(STORAGE_GROUP_LABEL_KEYS[issue.group])}
                                        </span>
                                    </div>
                                </div>
                                <MoveRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                            </div>
                            <p className="mt-2 text-xs leading-relaxed text-slate-600">
                                {t(issue.messageKey)}
                            </p>
                        </button>
                    ))}
                </div>
            </div>
        </section>
    );
}

export const CabinetAutoLayoutPreviewModal: React.FC<CabinetAutoLayoutPreviewModalProps> = ({
    preview,
    isApplying,
    onApply,
    onCancel,
    onFocusIssue,
}) => {
    const { t } = useTranslation();
    const shelves = useFridgeStore((state) => state.shelves);

    // What moves where: "Toluene 1층 → 3층".
    const moves = useMemo<PlannedMove[]>(() => {
        if (!preview) return [];
        const currentLevelById = new Map<string, number>();
        shelves.forEach((shelf) => shelf.items.forEach((item) => currentLevelById.set(item.id, shelf.level + 1)));
        const movedIds = new Set(preview.movedItemIds);

        return preview.plannedShelves
            .flatMap((shelf) => shelf.items
                .filter((item) => movedIds.has(item.id))
                .map((item) => ({
                    itemId: item.id,
                    name: item.name,
                    fromLevel: currentLevelById.get(item.id) ?? null,
                    toLevel: shelf.level + 1,
                })))
            .sort((a, b) => (a.fromLevel ?? 0) - (b.fromLevel ?? 0) || a.toLevel - b.toLevel);
    }, [preview, shelves]);

    if (!preview) return null;

    const isBlocked = !preview.canApply;
    const hasBeforeWarnings = preview.beforeWarningCount > 0;

    return (
        <div className="adaptive-overlay fixed inset-0 z-[110] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" onClick={onCancel} />

            <div
                className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="border-b border-slate-100 px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                <h3 className="text-xl font-bold text-slate-900">
                                    {t('cabinet_auto_place_title')}
                                </h3>
                            </div>
                            <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                {t('cabinet_auto_place_desc')}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onCancel}
                            className="rounded-xl border border-slate-200 p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                            aria-label={t('cabinet_auto_place_cancel')}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
                    {/* Only numbers that say something: zero cards are hidden, except the
                        "after" count when it shows conflicts going away. */}
                    {(hasBeforeWarnings || preview.afterWarningCount > 0 || preview.reviewItems.length > 0) && (
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            {hasBeforeWarnings && (
                                <SummaryCard
                                    label={t('cabinet_auto_place_before')}
                                    value={preview.beforeWarningCount}
                                    tone="amber"
                                />
                            )}
                            {(hasBeforeWarnings || preview.afterWarningCount > 0) && (
                                <SummaryCard
                                    label={t('cabinet_auto_place_after')}
                                    value={preview.afterWarningCount}
                                    tone={preview.afterWarningCount > 0 ? 'red' : 'emerald'}
                                />
                            )}
                            {preview.reviewItems.length > 0 && (
                                <SummaryCard
                                    label={t('cabinet_auto_place_review_items')}
                                    value={preview.reviewItems.length}
                                    tone="amber"
                                />
                            )}
                        </div>
                    )}

                    {isBlocked && (
                        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <p className="leading-relaxed">{t('cabinet_auto_place_blocked')}</p>
                        </div>
                    )}

                    {moves.length > 0 && <MoveList moves={moves} />}

                    {(preview.reviewItems.length > 0 || preview.unplacedItems.length > 0) && (
                        <div className="grid gap-4 lg:grid-cols-2">
                            {preview.reviewItems.length > 0 && (
                                <IssueList
                                    title={t('cabinet_auto_place_review_items')}
                                    items={preview.reviewItems}
                                    onFocusIssue={onFocusIssue}
                                />
                            )}
                            {preview.unplacedItems.length > 0 && (
                                <IssueList
                                    title={t('cabinet_auto_place_unplaced_items')}
                                    items={preview.unplacedItems}
                                    onFocusIssue={onFocusIssue}
                                />
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                    >
                        {t('cabinet_auto_place_cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={() => void onApply()}
                        disabled={isBlocked || isApplying}
                        className="flex min-w-[120px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                        {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {isApplying ? t('cabinet_auto_place_applying') : t('cabinet_auto_place_apply')}
                    </button>
                </div>
            </div>
        </div>
    );
};
