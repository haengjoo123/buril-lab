/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { AlertTriangle, ArrowRight, Camera, Clock, Edit2, FileEdit, Loader2, PackagePlus, Plus, Trash2, X, Beaker, Search } from 'lucide-react';
import { cabinetService, type ActivityActionType, type Cabinet } from '../../services/cabinetService';
import { auditService, type AuditLog } from '../../services/auditService';
import { useLabStore } from '../../store/useLabStore';
import { CabinetCard } from './components/CabinetCard';
import { CustomDialog } from '../../components/CustomDialog';
import { CabinetFormDialog } from './components/CabinetFormDialog';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { ImageActionMenu } from './components/ImageActionMenu';
import { ActivityLogModal } from './components/ActivityLogModal';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { getExpiryStatus, getExpiryBadgeClasses } from '../../utils/expiryStatus';
import { hasManufacturerDate } from '../../utils/manufacturerDate';
import { supabase } from '../../services/supabaseClient';
import { OnboardingGuideCard } from '../../components/onboarding/OnboardingGuideCard';
import { useOnboardingStore } from '../../store/useOnboardingStore';
import { useIsDesktop } from '../../hooks/useIsDesktop';

interface CabinetListViewProps {
    onSelectCabinet: (cabinetId: string) => void;
}

type CabinetListStats = {
    inventoryCount: number;
    historyCount: number;
};

type CabinetActivityAction = ActivityActionType | 'update';

type CabinetActivityFeedItem = {
    id: string;
    actionType: CabinetActivityAction;
    itemName: string;
    reason?: string;
    memo?: string;
    actorName?: string;
    occurredAt: string;
    isPhotoChange?: boolean;
    isMove?: boolean;
};

export function CabinetListView({ onSelectCabinet }: CabinetListViewProps) {
    const { t, i18n } = useTranslation();
    const showOnboardingGuide = useOnboardingStore((state) => state.hasCompletedWelcome && !state.hasSkippedOnboarding && !state.seenGuides.cabinetList);
    const markGuideSeen = useOnboardingStore((state) => state.markGuideSeen);
    const [cabinets, setCabinets] = useState<Cabinet[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedCabinetId, setSelectedCabinetId] = useState<string | null>(null);
    const [cabinetSearchQuery, setCabinetSearchQuery] = useState('');
    const [cabinetStats, setCabinetStats] = useState<Record<string, CabinetListStats>>({});
    const [activityFeed, setActivityFeed] = useState<Record<string, CabinetActivityFeedItem[]>>({});
    const [isActivityFeedLoading, setIsActivityFeedLoading] = useState(false);
    const isDesktop = useIsDesktop();

    const { currentLabId, myLabs } = useLabStore();
    const currentRole = myLabs.find(m => m.lab_id === currentLabId)?.role;
    const canCreateCabinet = !currentLabId || currentRole === 'admin';

    // Dialog State
    const [dialogConfig, setDialogConfig] = useState<{
        isOpen: boolean;
        type: 'alert' | 'confirm' | 'prompt';
        title: string;
        description?: string;
        inputValue?: string;
        inputPlaceholder?: string;
        onConfirm?: (val?: string) => void;
        isDestructive?: boolean;
    }>({
        isOpen: false,
        type: 'alert',
        title: ''
    });

    const [formDialogConfig, setFormDialogConfig] = useState<{
        isOpen: boolean;
        mode: 'create' | 'edit';
        cabinetId?: string;
        initialName?: string;
        initialLocation?: string;
    }>({
        isOpen: false,
        mode: 'create'
    });

    const [imageMenu, setImageMenu] = useState<{ isOpen: boolean, cabinetId?: string }>({ isOpen: false });
    const [cameraModal, setCameraModal] = useState<{ isOpen: boolean, cabinetId?: string }>({ isOpen: false });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const closeDialog = () => setDialogConfig(prev => ({ ...prev, isOpen: false }));
    const closeFormDialog = () => setFormDialogConfig(prev => ({ ...prev, isOpen: false }));
    const closeImageMenu = () => setImageMenu(prev => ({ ...prev, isOpen: false }));
    const closeCameraModal = () => setCameraModal(prev => ({ ...prev, isOpen: false }));

    // Inventory modal state
    const [inventoryModal, setInventoryModal] = useState<{
        isOpen: boolean;
        cabinetName: string;
        items: { name: string; shelfLevel: number; template: string; capacity?: string; expiryDate?: string; manufacturerDateType?: 'expiry' | 'minimum_shelf_life' | 'unlabeled' }[];
        isLoading: boolean;
    }>({ isOpen: false, cabinetName: '', items: [], isLoading: false });

    const handleInventory = async (e: React.MouseEvent, cabinet: Cabinet) => {
        e.stopPropagation();
        setInventoryModal({ isOpen: true, cabinetName: cabinet.name, items: [], isLoading: true });
        try {
            const { shelves } = await cabinetService.getCabinetDetails(cabinet.id);
            const items = shelves.flatMap(shelf =>
                shelf.items.map(item => ({
                    name: item.name,
                    shelfLevel: shelf.level,
                    template: item.template,
                    capacity: item.capacity,
                    expiryDate: item.expiryDate,
                    manufacturerDateType: item.manufacturerDateType,
                }))
            );
            setInventoryModal(prev => ({ ...prev, items, isLoading: false }));
        } catch (err) {
            console.error('Failed to load inventory:', err);
            setInventoryModal(prev => ({ ...prev, isLoading: false }));
        }
    };

    // Disposal log modal state
    const [disposalLogModal, setDisposalLogModal] = useState<{
        isOpen: boolean;
        cabinetId: string;
        cabinetName: string;
    }>({ isOpen: false, cabinetId: '', cabinetName: '' });

    const handleDisposalLog = (e: React.MouseEvent, cabinet: Cabinet) => {
        e.stopPropagation();
        setDisposalLogModal({ isOpen: true, cabinetId: cabinet.id, cabinetName: cabinet.name });
    };

    const getTextField = (data: Record<string, unknown> | null, keys: string[]) => {
        if (!data) return undefined;
        for (const key of keys) {
            const value = data[key];
            if (typeof value === 'string' && value.trim()) return value;
        }
        return undefined;
    };

    const includesAny = (values: Array<string | undefined | null>, patterns: RegExp[]) => (
        values.some((value) => typeof value === 'string' && patterns.some((pattern) => pattern.test(value)))
    );

    const isMoveActivity = (item: Pick<CabinetActivityFeedItem, 'reason' | 'memo' | 'itemName'>) => (
        includesAny([item.reason, item.memo, item.itemName], [/이동/i, /move/i])
    );

    const isPhotoActivity = (item: Pick<CabinetActivityFeedItem, 'reason' | 'memo' | 'itemName'>) => (
        includesAny([item.reason, item.memo, item.itemName], [/사진/i, /photo/i, /image/i])
    );

    const mapAuditLogToFeedItem = (log: AuditLog): CabinetActivityFeedItem => {
        const diffKeys = log.diff_data ? Object.keys(log.diff_data) : [];
        const afterActionType = getTextField(log.after_data, ['action_type']);
        const beforeName = getTextField(log.before_data, ['name', 'item_name']);
        const afterName = getTextField(log.after_data, ['name', 'item_name']);
        const actionType: CabinetActivityAction = afterActionType === 'clear_all'
            ? 'clear_all'
            : log.action === 'create'
                ? 'add'
                : log.action === 'delete'
                    ? 'remove'
                    : 'update';
        const itemName = afterName || beforeName || t('tab_cabinet');
        const item = {
            id: `audit-${log.id}`,
            actionType,
            itemName,
            reason: getTextField(log.after_data, ['reason']) || getTextField(log.before_data, ['reason']) || undefined,
            memo: getTextField(log.after_data, ['memo']) || getTextField(log.before_data, ['memo']) || log.location_context || undefined,
            actorName: log.actor_name || undefined,
            occurredAt: log.created_at,
            isPhotoChange: log.entity_type === 'cabinet' && (diffKeys.includes('image_url') || Boolean(getTextField(log.after_data, ['image_url']))),
            isMove: diffKeys.includes('cabinet_id') || includesAny([log.location_context, beforeName, afterName], [/이동/i, /move/i]),
        };

        return {
            ...item,
            isPhotoChange: item.isPhotoChange || isPhotoActivity(item),
            isMove: item.isMove || isMoveActivity(item),
        };
    };

    const loadCabinetActivityFeed = async (cabinetId: string) => {
        setIsActivityFeedLoading(true);
        try {
            const [activityRes, auditRes] = await Promise.allSettled([
                cabinetService.getActivityLogs(cabinetId),
                auditService.getCabinetAuditLogs(cabinetId, 20),
            ]);

            const nextFeed: CabinetActivityFeedItem[] = [];
            if (activityRes.status === 'fulfilled') {
                nextFeed.push(...activityRes.value.map((log) => {
                    const item = {
                        id: `activity-${log.id}`,
                        actionType: log.action_type,
                        itemName: log.item_name,
                        reason: log.reason,
                        memo: log.memo,
                        actorName: log.performed_by_nickname || log.performed_by_email,
                        occurredAt: log.performed_at,
                    };

                    return {
                        ...item,
                        isPhotoChange: isPhotoActivity(item),
                        isMove: isMoveActivity(item),
                    };
                }));
            }

            if (auditRes.status === 'fulfilled') {
                nextFeed.push(...auditRes.value.map(mapAuditLogToFeedItem));
            }

            nextFeed.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
            setActivityFeed((prev) => ({ ...prev, [cabinetId]: nextFeed.slice(0, 4) }));
        } catch (err) {
            console.error('Failed to load cabinet activity feed:', err);
            setActivityFeed((prev) => ({ ...prev, [cabinetId]: [] }));
        } finally {
            setIsActivityFeedLoading(false);
        }
    };

    const loadCabinetStats = async (cabinetIds: string[]) => {
        if (cabinetIds.length === 0) {
            setCabinetStats({});
            return;
        }

        const nextStats = cabinetIds.reduce<Record<string, CabinetListStats>>((acc, id) => {
            acc[id] = { inventoryCount: 0, historyCount: 0 };
            return acc;
        }, {});

        try {
            const { data, error } = await supabase
                .from('cabinet_items')
                .select('cabinet_id')
                .in('cabinet_id', cabinetIds);

            if (error) throw error;

            (data || []).forEach((row) => {
                const cabinetId = row.cabinet_id;
                if (cabinetId && nextStats[cabinetId]) {
                    nextStats[cabinetId].inventoryCount += 1;
                }
            });
        } catch (err) {
            console.error('Failed to load cabinet inventory counts:', err);
        }

        try {
            const { data, error } = await supabase
                .from('cabinet_activity_logs')
                .select('cabinet_id')
                .in('cabinet_id', cabinetIds);

            if (error) throw error;

            (data || []).forEach((row) => {
                const cabinetId = row.cabinet_id;
                if (cabinetId && nextStats[cabinetId]) {
                    nextStats[cabinetId].historyCount += 1;
                }
            });
        } catch (err) {
            console.error('Failed to load cabinet history counts:', err);
        }

        setCabinetStats(nextStats);
    };

    const loadCabinets = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const data = await cabinetService.getCabinets();
            setCabinets(data);
            await loadCabinetStats(data.map((cabinet) => cabinet.id));
        } catch (err) {
            console.error(err);
            setError(t('cabinet_list_load_error'));
            setCabinetStats({});
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadCabinets();

        let reloadTimeout: ReturnType<typeof setTimeout>;

        const handleChange = () => {
            clearTimeout(reloadTimeout);
            reloadTimeout = setTimeout(() => {
                loadCabinets();
            }, 500);
        };

        const channel = supabase.channel('cabinets_realtime_list')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinets' }, handleChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_items' }, handleChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_activity_logs' }, handleChange)
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
            clearTimeout(reloadTimeout);
        };
    }, [currentLabId]);

    const filteredCabinets = useMemo(() => {
        const normalized = cabinetSearchQuery.trim().toLowerCase();
        return cabinets.filter((cabinet) => {
            if (!normalized) return true;
            return [
                cabinet.name,
                cabinet.location || '',
                `${cabinet.width}x${cabinet.height}`,
            ].join(' ').toLowerCase().includes(normalized);
        });
    }, [cabinetSearchQuery, cabinets]);

    useEffect(() => {
        if (filteredCabinets.length === 0) {
            setSelectedCabinetId(null);
            return;
        }
        if (!selectedCabinetId || !filteredCabinets.some((cabinet) => cabinet.id === selectedCabinetId)) {
            setSelectedCabinetId(filteredCabinets[0].id);
        }
    }, [filteredCabinets, selectedCabinetId]);

    const selectedCabinet = filteredCabinets.find((cabinet) => cabinet.id === selectedCabinetId) || filteredCabinets[0];
    const selectedActivities = selectedCabinet ? activityFeed[selectedCabinet.id] || [] : [];
    const selectedHistoryCount = selectedCabinet ? cabinetStats[selectedCabinet.id]?.historyCount ?? 0 : 0;

    useEffect(() => {
        if (!selectedCabinet?.id) return;
        void loadCabinetActivityFeed(selectedCabinet.id);
    }, [selectedCabinet?.id, selectedHistoryCount]);

    const formatActivityDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).replace(/\.$/, '');
    };

    const localizeActivityDetail = (detail?: string) => {
        if (!detail?.trim()) return undefined;

        const detailKeyByValue: Record<string, string> = {
            '재고 목록에서 삭제': 'cabinet_activity_detail_removed_from_inventory',
            'Removed from inventory list': 'cabinet_activity_detail_removed_from_inventory',
            '사진 삭제': 'cabinet_activity_detail_photo_removed',
            'Photo removed': 'cabinet_activity_detail_photo_removed',
            '복사 생성': 'cabinet_copy_activity_memo',
            'Created by copy': 'cabinet_copy_activity_memo',
        };

        const key = detailKeyByValue[detail.trim()];
        return key ? t(key) : detail;
    };

    const getActivityDetail = (...details: Array<string | undefined>) => (
        localizeActivityDetail(details.find((detail) => Boolean(detail?.trim())))
    );

    const getActivityPresentation = (activity: CabinetActivityFeedItem) => {
        if (activity.isPhotoChange) {
            return {
                icon: Camera,
                label: t('cabinet_activity_photo_changed'),
                iconClassName: 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300',
                detail: getActivityDetail(activity.memo, activity.itemName),
            };
        }

        if (activity.isMove) {
            return {
                icon: ArrowRight,
                label: t('cabinet_activity_moved'),
                iconClassName: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300',
                detail: getActivityDetail(activity.memo, activity.reason, activity.itemName),
            };
        }

        switch (activity.actionType) {
            case 'add':
                return {
                    icon: PackagePlus,
                    label: t('cabinet_activity_stock_added'),
                    iconClassName: 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300',
                    detail: getActivityDetail(activity.memo, activity.itemName),
                };
            case 'remove':
                return {
                    icon: Trash2,
                    label: t('cabinet_activity_stock_removed'),
                    iconClassName: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300',
                    detail: getActivityDetail(activity.reason, activity.memo, activity.itemName),
                };
            case 'clear_all':
                return {
                    icon: AlertTriangle,
                    label: t('activity_log_action_clear_all'),
                    iconClassName: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
                    detail: getActivityDetail(activity.itemName),
                };
            case 'update':
            default:
                return {
                    icon: FileEdit,
                    label: t('cabinet_activity_updated'),
                    iconClassName: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300',
                    detail: getActivityDetail(activity.memo, activity.itemName),
                };
        }
    };

    const handleCreate = () => {
        setFormDialogConfig({
            isOpen: true,
            mode: 'create',
            initialName: '',
            initialLocation: ''
        });
    };

    const handleEdit = (e: React.MouseEvent, cabinet: Cabinet) => {
        e.stopPropagation();
        setFormDialogConfig({
            isOpen: true,
            mode: 'edit',
            cabinetId: cabinet.id,
            initialName: cabinet.name,
            initialLocation: cabinet.location || ''
        });
    };

    const handleFormConfirm = async (name: string, location?: string) => {
        try {
            setIsCreating(true);
            if (formDialogConfig.mode === 'create') {
                await cabinetService.createCabinet(name, location);
            } else if (formDialogConfig.mode === 'edit' && formDialogConfig.cabinetId) {
                await cabinetService.updateCabinet(formDialogConfig.cabinetId, { name, location });
                cabinetService.logActivity(
                    formDialogConfig.cabinetId,
                    'update',
                    t('cabinet_card_edit'),
                    undefined,
                    location ? `${name} · ${location}` : name
                ).catch((logError) => console.error('Failed to log cabinet edit activity:', logError));
            }
            closeFormDialog();
            await loadCabinets();
        } catch (err) {
            console.error('Save error:', err);
            setDialogConfig({
                isOpen: true,
                type: 'alert',
                title: t('cabinet_save_error_title'),
                description: t('cabinet_save_error_desc'),
                isDestructive: true
            });
        } finally {
            setIsCreating(false);
        }
    };

    const handleImageClick = (e: React.MouseEvent, cabinetId: string) => {
        e.stopPropagation();
        setImageMenu({ isOpen: true, cabinetId });
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        const cabinetId = imageMenu.cabinetId;
        if (!file || !cabinetId) return;

        try {
            await cabinetService.uploadCabinetImage(cabinetId, file);
            await cabinetService.logActivity(
                cabinetId,
                'update',
                t('cabinet_card_change_photo'),
                undefined,
                t('cabinet_image_gallery')
            );
            await loadCabinets();
            await loadCabinetActivityFeed(cabinetId);
        } catch (err) {
            console.error('이미지 업로드 실패:', err);
            alert(t('cabinet_image_upload_error'));
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleCameraCapture = async (file: File) => {
        const cabinetId = cameraModal.cabinetId;
        if (!cabinetId) return;
        try {
            await cabinetService.uploadCabinetImage(cabinetId, file);
            await cabinetService.logActivity(
                cabinetId,
                'update',
                t('cabinet_card_change_photo'),
                undefined,
                t('cabinet_image_camera')
            );
            await loadCabinets();
            await loadCabinetActivityFeed(cabinetId);
        } catch (err) {
            console.error('카메라 이미지 업로드 실패:', err);
            alert(t('cabinet_image_upload_error'));
        }
    };

    const handleDelete = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDialogConfig({
            isOpen: true,
            type: 'confirm',
            title: t('cabinet_delete_title'),
            description: t('cabinet_delete_desc'),
            isDestructive: true,
            onConfirm: async () => {
                closeDialog();
                try {
                    await cabinetService.deleteCabinet(id);
                    await loadCabinets();
                } catch (err) {
                    console.error('Delete error:', err);
                    setDialogConfig({
                        isOpen: true,
                        type: 'alert',
                        title: t('cabinet_delete_error_title'),
                        description: t('cabinet_delete_error_desc'),
                        isDestructive: true
                    });
                }
            }
        });
    };

    if (isLoading) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-6 gap-4">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <p className="text-slate-500">{t('cabinet_loading')}</p>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-5 pb-32 dark:bg-slate-950 lg:p-8 lg:pb-8">
            <div className="mx-auto flex max-w-md flex-col gap-6 lg:grid lg:max-w-[1320px] lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8">
                <div className="flex min-w-0 flex-col gap-6">
                <header
                    data-onboarding-target="cabinet-list-header"
                    className="mt-4 flex items-center justify-between gap-4 lg:mt-2"
                >
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 lg:text-3xl lg:tracking-tight">
                            {currentLabId ? `${myLabs.find(m => m.lab_id === currentLabId)?.lab?.name || t('cabinet_lab_fallback')}${t('cabinet_lab_suffix')}` : t('cabinet_my_cabinets')}
                        </h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('cabinet_list_desc')}</p>
                    </div>
                    {canCreateCabinet && (
                        <button
                            type="button"
                            onClick={handleCreate}
                            disabled={isCreating}
                            className="hidden h-11 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50 lg:inline-flex"
                        >
                            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            {t('cabinet_create_new')}
                        </button>
                    )}
                </header>

                <section className="hidden flex-col gap-4 lg:flex">
                    <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3">
                        <label className="relative">
                            <span className="sr-only">{t('cabinet_search_placeholder')}</span>
                            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                            <input
                                value={cabinetSearchQuery}
                                onChange={(event) => setCabinetSearchQuery(event.target.value)}
                                placeholder={t('cabinet_search_placeholder')}
                                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-11 pr-4 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={() => {
                                setCabinetSearchQuery('');
                            }}
                            disabled={!cabinetSearchQuery}
                            className="h-11 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                        >
                            {t('btn_reset')}
                        </button>
                    </div>
                </section>

                {showOnboardingGuide && (
                    <OnboardingGuideCard
                        icon={<Beaker className="h-5 w-5" />}
                        title={t('onboarding_cabinet_list_title')}
                        description={t('onboarding_cabinet_list_desc')}
                        points={[
                            t('onboarding_cabinet_list_point_1'),
                            t('onboarding_cabinet_list_point_2'),
                            t('onboarding_cabinet_list_point_3'),
                        ]}
                        onDismiss={() => markGuideSeen('cabinetList')}
                    />
                )}

                {error && (
                    <div className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-100 text-sm">
                        {error}
                    </div>
                )}

                <div className="flex min-w-0 flex-col gap-4">
                    {filteredCabinets.map(cabinet => {
                        const isSelected = selectedCabinet?.id === cabinet.id;

                        return (
                        <div
                            key={cabinet.id}
                            className={`min-w-0 rounded-lg transition-all ${isSelected ? '' : 'lg:hover:-translate-y-0.5'}`}
                        >
                            <CabinetCard
                                cabinet={cabinet}
                                isSelected={isSelected}
                                onClick={() => {
                                    if (isDesktop) {
                                        setSelectedCabinetId(cabinet.id);
                                        return;
                                    }
                                    onSelectCabinet(cabinet.id);
                                }}
                                onEdit={(e) => handleEdit(e, cabinet)}
                                onDelete={canCreateCabinet ? (e) => handleDelete(e, cabinet.id) : undefined}
                                onImageClick={(e) => handleImageClick(e, cabinet.id)}
                                onInventory={(e) => handleInventory(e, cabinet)}
                                onDisposalLog={(e) => handleDisposalLog(e, cabinet)}
                                onManage={() => onSelectCabinet(cabinet.id)}
                                inventoryCount={cabinetStats[cabinet.id]?.inventoryCount ?? 0}
                                historyCount={cabinetStats[cabinet.id]?.historyCount ?? 0}
                            />
                        </div>
                    )})}

                    {filteredCabinets.length === 0 && !error && (
                        <EmptyState variant="cabinet" />
                    )}

                    {canCreateCabinet && (
                        <button
                            onClick={handleCreate}
                            disabled={isCreating}
                            className="w-full mt-2 py-4 px-6 bg-white dark:bg-slate-800 border-2 border-dashed border-blue-300 dark:border-blue-800/50 rounded-2xl text-blue-600 dark:text-blue-400 font-medium hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 transition-all flex items-center justify-center gap-2 group disabled:opacity-50"
                        >
                            {isCreating ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                                    {t('cabinet_create_new')}
                                </>
                            )}
                        </button>
                    )}
                </div>
                </div>

                <aside className="hidden flex-col gap-5 lg:flex">
                    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <div className="flex items-start justify-between gap-4">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t('tab_cabinet')}</h3>
                            {selectedCabinet && (
                                <button
                                    type="button"
                                    onClick={() => onSelectCabinet(selectedCabinet.id)}
                                    className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-700"
                                >
                                    {t('cabinet_manage')}
                                </button>
                            )}
                        </div>

                        {selectedCabinet ? (
                            <div className="mt-5 space-y-5">
                                <div className="flex gap-4">
                                    <button
                                        type="button"
                                        onClick={(e) => handleImageClick(e, selectedCabinet.id)}
                                        className="group relative h-28 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-100 text-slate-400 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
                                        title={t('cabinet_card_change_photo')}
                                        aria-label={t('cabinet_card_change_photo')}
                                    >
                                        {selectedCabinet.image_url ? (
                                            <>
                                                <img src={selectedCabinet.image_url} alt={selectedCabinet.name} className="h-full w-full object-cover" />
                                                <span className="absolute inset-0 flex items-center justify-center bg-slate-950/45 opacity-0 transition-opacity group-hover:opacity-100">
                                                    <Camera className="h-6 w-6 text-white" />
                                                </span>
                                            </>
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center">
                                                <Camera className="h-8 w-8" />
                                            </div>
                                        )}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        <h4 className="truncate text-xl font-bold text-slate-900 dark:text-slate-100">{selectedCabinet.name}</h4>
                                        {selectedCabinet.location && (
                                            <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">{selectedCabinet.location}</p>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-4 divide-x divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                                    <button
                                        type="button"
                                        onClick={(e) => handleInventory(e, selectedCabinet)}
                                        className="flex flex-col items-center gap-1 px-2 py-4 text-xs font-semibold text-slate-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700 dark:text-slate-300 dark:hover:bg-emerald-950/20"
                                    >
                                        <Beaker className="h-5 w-5" />
                                        {t('tab_inventory')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => handleDisposalLog(e, selectedCabinet)}
                                        className="flex flex-col items-center gap-1 px-2 py-4 text-xs font-semibold text-slate-600 transition-colors hover:bg-orange-50 hover:text-orange-700 dark:text-slate-300 dark:hover:bg-orange-950/20"
                                    >
                                        <Clock className="h-5 w-5" />
                                        {t('cabinet_dispose_log_btn')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => handleImageClick(e, selectedCabinet.id)}
                                        className="flex flex-col items-center gap-1 px-2 py-4 text-xs font-semibold text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-blue-950/20"
                                    >
                                        <Camera className="h-5 w-5" />
                                        <span className="whitespace-nowrap">{t('cabinet_activity_photo_short')}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => handleEdit(e, selectedCabinet)}
                                        className="flex flex-col items-center gap-1 px-2 py-4 text-xs font-semibold text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-blue-950/20"
                                    >
                                        <Edit2 className="h-5 w-5" />
                                        {t('cabinet_card_edit')}
                                    </button>
                                </div>

                                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                            {t('cabinet_recent_activity_title')}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => handleDisposalLog(e, selectedCabinet)}
                                            className="text-xs font-bold text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
                                        >
                                            {t('cabinet_activity_view_all')}
                                        </button>
                                    </div>

                                    <div className="mt-4 space-y-3">
                                        {isActivityFeedLoading ? (
                                            <div className="flex items-center justify-center py-6">
                                                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                                            </div>
                                        ) : selectedActivities.length === 0 ? (
                                            <div className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
                                                {t('activity_log_empty')}
                                            </div>
                                        ) : selectedActivities.map((activity) => {
                                            const presentation = getActivityPresentation(activity);
                                            const ActivityIcon = presentation.icon;

                                            return (
                                                <div key={activity.id} className="flex min-w-0 items-start gap-3">
                                                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${presentation.iconClassName}`}>
                                                        <ActivityIcon className="h-4 w-4" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{presentation.label}</div>
                                                        {presentation.detail && (
                                                            <div className="mt-0.5 truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                                                                {presentation.detail}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="shrink-0 text-right">
                                                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{formatActivityDate(activity.occurredAt)}</div>
                                                        {activity.actorName && (
                                                            <div className="mt-1 max-w-[88px] truncate text-xs text-slate-400 dark:text-slate-500">{activity.actorName}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <EmptyState variant="cabinet" />
                        )}
                    </section>
                </aside>
            </div>

            <CustomDialog
                isOpen={dialogConfig.isOpen}
                onClose={closeDialog}
                title={dialogConfig.title}
                description={dialogConfig.description}
                type={dialogConfig.type}
                inputValue={dialogConfig.inputValue}
                onInputChange={(val) => setDialogConfig(prev => ({ ...prev, inputValue: val }))}
                inputPlaceholder={dialogConfig.inputPlaceholder}
                isDestructive={dialogConfig.isDestructive}
                onConfirm={() => dialogConfig.onConfirm?.(dialogConfig.inputValue)}
            />

            <CabinetFormDialog
                isOpen={formDialogConfig.isOpen}
                onClose={closeFormDialog}
                title={formDialogConfig.mode === 'create' ? t('cabinet_create_title') : t('cabinet_edit_info_title')}
                description={formDialogConfig.mode === 'create' ? t('cabinet_create_desc') : undefined}
                initialName={formDialogConfig.initialName}
                initialLocation={formDialogConfig.initialLocation}
                onConfirm={handleFormConfirm}
                isLoading={isCreating}
            />

            <ImageActionMenu
                isOpen={imageMenu.isOpen}
                onClose={closeImageMenu}
                onSelectCamera={() => {
                    setCameraModal({ isOpen: true, cabinetId: imageMenu.cabinetId });
                }}
                onSelectGallery={() => {
                    fileInputRef.current?.click();
                }}
                hasImage={!!cabinets.find(c => c.id === imageMenu.cabinetId)?.image_url}
                onDeleteImage={async () => {
                    const cabinetId = imageMenu.cabinetId;
                    if (!cabinetId) return;
                    try {
                        await cabinetService.updateCabinet(cabinetId, { image_url: '' });
                        await cabinetService.logActivity(
                            cabinetId,
                            'update',
                            t('cabinet_card_change_photo'),
                            undefined,
                            t('cabinet_activity_detail_photo_removed')
                        );
                        await loadCabinets();
                        await loadCabinetActivityFeed(cabinetId);
                    } catch (err) {
                        console.error('이미지 삭제 실패:', err);
                    }
                }}
            />

            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
            />

            <CameraCaptureModal
                isOpen={cameraModal.isOpen}
                onClose={closeCameraModal}
                onCapture={handleCameraCapture}
            />

            <ActivityLogModal
                isOpen={disposalLogModal.isOpen}
                cabinetId={disposalLogModal.cabinetId}
                cabinetName={disposalLogModal.cabinetName}
                onClose={() => setDisposalLogModal(prev => ({ ...prev, isOpen: false }))}
            />

            {/* Inventory Modal */}
            {inventoryModal.isOpen && (
                <div className="fixed inset-0 z-[100] flex items-end justify-center animate-in fade-in duration-200">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setInventoryModal(prev => ({ ...prev, isOpen: false }))} />
                    <div className="relative bg-white dark:bg-slate-800 rounded-t-2xl shadow-xl w-full max-w-md max-h-[70vh] flex flex-col animate-in slide-in-from-bottom duration-300">
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700 shrink-0">
                            <div className="flex items-center gap-2">
                                <Beaker className="w-5 h-5 text-emerald-500" />
                                <span className="font-semibold text-slate-800 dark:text-slate-100">{inventoryModal.cabinetName} 재고 목록</span>
                            </div>
                            <button
                                onClick={() => setInventoryModal(prev => ({ ...prev, isOpen: false }))}
                                className="p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700 hover:text-gray-600 transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        {/* Content */}
                        <div className="overflow-y-auto p-4 flex flex-col gap-3">
                            {inventoryModal.isLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                                </div>
                            ) : inventoryModal.items.length === 0 ? (
                                <p className="text-center text-slate-400 dark:text-slate-500 py-8">시약이 없습니다.</p>
                            ) : (
                                (() => {
                                    // Group by shelf level
                                    const grouped = new Map<number, typeof inventoryModal.items>();
                                    for (const item of inventoryModal.items) {
                                        const list = grouped.get(item.shelfLevel) || [];
                                        list.push(item);
                                        grouped.set(item.shelfLevel, list);
                                    }
                                    const sortedLevels = [...grouped.keys()].sort((a, b) => a - b);
                                    return sortedLevels.map(level => (
                                        <div key={level}>
                                            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                                                {`📦 ${level + 1}층 선반`}
                                            </h4>
                                            <div className="flex flex-col gap-1">
                                                {grouped.get(level)!.map((item, idx) => (
                                                    <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                                                        <span className="text-xs text-slate-400 dark:text-slate-500 font-mono w-5">{idx + 1}.</span>
                                                        <span className="text-sm text-slate-700 dark:text-slate-200 font-medium">{item.name}</span>
                                                        {(() => {
                                                            const expiry = getExpiryStatus(hasManufacturerDate(item.manufacturerDateType) ? item.expiryDate : null);
                                                            if (!expiry || expiry.level === 'ok') return null;
                                                            return (
                                                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${getExpiryBadgeClasses(expiry.level)}`}>
                                                                    {t(expiry.labelKey, expiry.labelParams)}
                                                                </span>
                                                            );
                                                        })()}
                                                        {item.capacity && (
                                                            <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto bg-slate-200/50 dark:bg-slate-600/50 px-2 py-0.5 rounded-md">
                                                                {item.capacity}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ));
                                })()
                            )}
                        </div>
                        {/* Footer */}
                        {!inventoryModal.isLoading && inventoryModal.items.length > 0 && (
                            <div className="p-3 border-t border-gray-100 dark:border-slate-700 text-center shrink-0">
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                    총 {inventoryModal.items.length}개 시약
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
