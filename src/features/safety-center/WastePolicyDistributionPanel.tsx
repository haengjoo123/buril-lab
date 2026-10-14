import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  activateSafetyCenterWastePolicyV2,
  getActiveWastePolicyV2,
  getSafetyCenterWastePolicyVersionsV2,
  saveSafetyCenterWastePolicyDraftV2,
  type SafetyCenterWastePolicyStreamInput,
  type SafetyCenterWastePolicyVersion,
} from '../../services/wastePolicyService';
import { useTranslation, Trans } from 'react-i18next';
import i18n from '../../locales/i18n';
import type { WasteHazardFlag, WasteStreamCode } from '../../types';
import {
  createWastePolicyEditorDraft,
  validateWastePolicyEditorDraft,
  WASTE_POLICY_HAZARDS,
  WASTE_POLICY_STREAMS,
  type WastePolicyEditorDraft,
} from './wastePolicyEditor';

interface WastePolicyDistributionPanelProps {
  centerId: string;
  canManage: boolean;
}

const inputClass = 'mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-950 dark:disabled:bg-slate-900';
const textareaClass = `${inputClass} py-2`;

const versionStatusLabel: Record<SafetyCenterWastePolicyVersion['status'], string> = {
  draft: 'wl_status_draft',
  active: 'wl_status_active',
  retired: 'wl_status_retired',
};

const versionStatusTone: Record<SafetyCenterWastePolicyVersion['status'], string> = {
  draft: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  active: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  retired: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  return new Date(value).toLocaleString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
};

const linesToArray = (value: string): string[] => value
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const getLoadError = (): string =>
  i18n.t('wl_err_load');

const getSaveError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (/duplicate|unique/i.test(message)) return i18n.t('wl_err_dup_label');
  if (/permission|not authorized|42501/i.test(message)) return i18n.t('wl_err_save_perm');
  return i18n.t('wl_err_save');
};

const getActivationError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (/permission|not authorized|42501/i.test(message)) return i18n.t('wl_err_deploy_perm');
  return i18n.t('wl_err_activate');
};

export function WastePolicyDistributionPanel({
  centerId,
  canManage,
}: WastePolicyDistributionPanelProps) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<SafetyCenterWastePolicyVersion[]>([]);
  const [draft, setDraft] = useState<WastePolicyEditorDraft | null>(null);
  const [expandedStream, setExpandedStream] = useState<WasteStreamCode | null>('ACID_AQUEOUS');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [pendingActivationId, setPendingActivationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [showValidation, setShowValidation] = useState(false);
  const loadRequestRef = useRef(0);

  const validation = useMemo(
    () => draft ? validateWastePolicyEditorDraft(draft) : { errors: [], fieldErrors: {} },
    [draft],
  );
  const pendingActivationVersion = useMemo(
    () => versions.find((version) => version.id === pendingActivationId) ?? null,
    [pendingActivationId, versions],
  );

  const loadPolicy = useCallback(async (resetEditor = true) => {
    const requestId = ++loadRequestRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const nextVersions = await getSafetyCenterWastePolicyVersionsV2(centerId);
      let systemPolicy = null;
      if (nextVersions.length === 0) systemPolicy = await getActiveWastePolicyV2(null);
      if (requestId !== loadRequestRef.current) return;
      setVersions(nextVersions);
      if (resetEditor) {
        setDraft(createWastePolicyEditorDraft(nextVersions[0] ?? null, systemPolicy));
        setShowValidation(false);
      }
    } catch (loadError) {
      if (requestId !== loadRequestRef.current) return;
      console.error(loadError);
      const message = getLoadError();
      setError(message);
      setLiveMessage(message);
    } finally {
      if (requestId === loadRequestRef.current) setIsLoading(false);
    }
  }, [centerId]);

  useEffect(() => {
    void loadPolicy();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadPolicy]);

  const updateStream = useCallback((
    streamCode: WasteStreamCode,
    update: (stream: SafetyCenterWastePolicyStreamInput) => SafetyCenterWastePolicyStreamInput,
  ) => {
    setDraft((current) => current ? {
      ...current,
      streams: current.streams.map((stream) =>
        stream.streamCode === streamCode ? update(stream) : stream
      ),
    } : current);
  }, []);

  const toggleHazard = useCallback((
    streamCode: WasteStreamCode,
    flag: WasteHazardFlag,
    mode: 'allowed' | 'blocked',
  ) => {
    updateStream(streamCode, (stream) => {
      const key = mode === 'allowed' ? 'allowedHazardFlags' : 'blockedHazardFlags';
      const oppositeKey = mode === 'allowed' ? 'blockedHazardFlags' : 'allowedHazardFlags';
      const values = stream[key];
      const isSelected = values.includes(flag);
      return {
        ...stream,
        [key]: isSelected ? values.filter((value) => value !== flag) : [...values, flag],
        [oppositeKey]: isSelected
          ? stream[oppositeKey]
          : stream[oppositeKey].filter((value) => value !== flag),
      };
    });
  }, [updateStream]);
  const closeActivationDialog = useCallback(() => setPendingActivationId(null), []);

  const saveDraft = async () => {
    if (!draft || !canManage) return;
    setShowValidation(true);
    setError(null);
    setLiveMessage('');
    if (validation.errors.length > 0) {
      setLiveMessage(t('wl_live_validation', { count: validation.errors.length }));
      return;
    }

    setIsSaving(true);
    try {
      const receipt = await saveSafetyCenterWastePolicyDraftV2({
        centerId,
        versionLabel: draft.versionLabel,
        name: draft.name,
        streams: draft.streams,
        sourceRefs: draft.sourceRefs,
      });
      setLiveMessage(t('wl_live_saved', { label: receipt.versionLabel }));
      await loadPolicy();
    } catch (saveError) {
      console.error(saveError);
      const message = getSaveError(saveError);
      setError(message);
      setLiveMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  const activateVersion = async (version: SafetyCenterWastePolicyVersion) => {
    if (!canManage || version.status !== 'draft') return;
    setActivatingId(version.id);
    setError(null);
    setLiveMessage('');
    try {
      await activateSafetyCenterWastePolicyV2(version.id);
      setPendingActivationId(null);
      setLiveMessage(t('wl_live_deployed', { label: version.versionLabel }));
      await loadPolicy(false);
    } catch (activationError) {
      console.error(activationError);
      const message = getActivationError(activationError);
      setError(message);
      setLiveMessage(message);
    } finally {
      setActivatingId(null);
    }
  };

  if (isLoading && !draft) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-busy="true">
        <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          {t('wl_loading')}
        </div>
      </section>
    );
  }

  if (!draft) {
    return (
      <section className="rounded-lg border border-red-200 bg-white p-5 shadow-sm dark:border-red-900 dark:bg-slate-900">
        <div className="flex items-start gap-3 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p>{error ?? getLoadError()}</p>
            <button
              type="button"
              onClick={() => void loadPolicy()}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-200 px-4 font-medium hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/40"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('wl_retry')}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5" aria-labelledby="waste-policy-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" aria-hidden="true" />
            <h2 id="waste-policy-title" className="text-base font-medium text-slate-950 dark:text-white">{t('wl_title')}</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {t('wl_intro')}
          </p>
          {!canManage && (
            <p className="mt-2 inline-flex min-h-8 items-center rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {t('wl_readonly')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadPolicy()}
          disabled={isLoading || isSaving || Boolean(activatingId)}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          {t('wl_load_latest')}
        </button>
      </div>

      <div aria-live="polite" aria-atomic="true" className="mt-4">
        {liveMessage && (
          <p className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300'}`}>
            {liveMessage}
          </p>
        )}
      </div>

      <fieldset className="mt-5 space-y-5">
        <legend className="sr-only">{t('wl_legend')}</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('wl_version_label')} <span className="text-red-600" aria-hidden="true">*</span>
            <input
              value={draft.versionLabel}
              onChange={(event) => setDraft({ ...draft, versionLabel: event.target.value })}
              disabled={!canManage || isSaving || Boolean(activatingId)}
              aria-invalid={showValidation && Boolean(validation.fieldErrors.versionLabel)}
              aria-describedby={showValidation && validation.fieldErrors.versionLabel ? 'policy-version-error' : undefined}
              className={inputClass}
              placeholder={t('wl_version_ph')}
            />
            {showValidation && validation.fieldErrors.versionLabel && <span id="policy-version-error" className="mt-1 block text-xs text-red-600">{validation.fieldErrors.versionLabel}</span>}
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('wl_policy_name')} <span className="text-red-600" aria-hidden="true">*</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              disabled={!canManage || isSaving || Boolean(activatingId)}
              aria-invalid={showValidation && Boolean(validation.fieldErrors.name)}
              aria-describedby={showValidation && validation.fieldErrors.name ? 'policy-name-error' : undefined}
              className={inputClass}
              placeholder={t('wl_policy_name_ph')}
            />
            {showValidation && validation.fieldErrors.name && <span id="policy-name-error" className="mt-1 block text-xs text-red-600">{validation.fieldErrors.name}</span>}
          </label>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('wl_sources')}</h3>
              <p className="mt-1 text-xs text-slate-500">{t('wl_sources_hint')}</p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => setDraft({ ...draft, sourceRefs: [...draft.sourceRefs, { title: '', url: '' }] })}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> {t('wl_add_source')}
              </button>
            )}
          </div>
          <div className="mt-3 space-y-3">
            {draft.sourceRefs.map((reference, index) => {
              const titleError = validation.fieldErrors[`sourceRefs.${index}.title`];
              const urlError = validation.fieldErrors[`sourceRefs.${index}.url`];
              return (
                <div key={index} className="grid gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px]">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {t('wl_ref_title')}
                    <input
                      value={reference.title}
                      disabled={!canManage || isSaving || Boolean(activatingId)}
                      onChange={(event) => setDraft({
                        ...draft,
                        sourceRefs: draft.sourceRefs.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item),
                      })}
                      aria-invalid={showValidation && Boolean(titleError)}
                      className={inputClass}
                      placeholder={t('wl_ref_title_ph')}
                    />
                    {showValidation && titleError && <span className="mt-1 block text-xs text-red-600">{titleError}</span>}
                  </label>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {t('wl_ref_url')}
                    <input
                      type="url"
                      inputMode="url"
                      value={reference.url ?? ''}
                      disabled={!canManage || isSaving || Boolean(activatingId)}
                      onChange={(event) => setDraft({
                        ...draft,
                        sourceRefs: draft.sourceRefs.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item),
                      })}
                      aria-invalid={showValidation && Boolean(urlError)}
                      className={inputClass}
                      placeholder="https://..."
                    />
                    {showValidation && urlError && <span className="mt-1 block text-xs text-red-600">{urlError}</span>}
                  </label>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, sourceRefs: draft.sourceRefs.filter((_, itemIndex) => itemIndex !== index) })}
                      aria-label={t('wl_ref_delete', { title: reference.title || t('wl_ref_default_title', { n: index + 1 }) })}
                      className="mt-5 flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
            {draft.sourceRefs.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">{t('wl_no_sources')}</p>}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('wl_streams_title')}</h3>
              <p className="mt-1 text-xs text-slate-500">{t('wl_streams_hint')}</p>
            </div>
            <p className="text-xs font-medium text-slate-500">{t('wl_active_count', { count: draft.streams.filter((stream) => stream.isEnabled).length, total: WASTE_POLICY_STREAMS.length })}</p>
          </div>
          <div className="mt-3 space-y-3">
            {draft.streams.map((stream) => (
              <WasteStreamEditor
                key={stream.streamCode}
                stream={stream}
                expanded={expandedStream === stream.streamCode}
                canManage={canManage && !isSaving && !activatingId}
                showValidation={showValidation}
                fieldErrors={validation.fieldErrors}
                onToggleExpanded={() => setExpandedStream((current) => current === stream.streamCode ? null : stream.streamCode)}
                onChange={(nextStream) => updateStream(stream.streamCode, () => nextStream)}
                onToggleHazard={(flag, mode) => toggleHazard(stream.streamCode, flag, mode)}
              />
            ))}
          </div>
        </div>
      </fieldset>

      {canManage && (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
          {showValidation && validation.errors.length > 0 && (
            <div role="alert" className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200">
              <p className="font-medium">{t('wl_fix_items')}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {validation.errors.slice(0, 8).map((validationError) => <li key={validationError}>{validationError}</li>)}
              </ul>
              {validation.errors.length > 8 && <p className="mt-2">{t('wl_more_items', { count: validation.errors.length - 8 })}</p>}
            </div>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
            <p className="text-xs leading-5 text-slate-500 sm:mr-auto">{t('wl_no_auto_deploy')}</p>
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={isSaving || Boolean(activatingId)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {t('wl_save_draft')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-7 border-t border-slate-200 pt-5 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('wl_history')}</h3>
        </div>
        <div className="mt-3 space-y-3">
          {versions.map((version) => (
            <article key={version.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{version.name}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${versionStatusTone[version.status]}`}>{t(versionStatusLabel[version.status])}</span>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-slate-500">{version.versionLabel}</p>
                  <p className="mt-2 text-xs text-slate-500">{t('wl_version_meta', { created: formatDateTime(version.createdAt), count: version.streams.filter((stream) => stream.isEnabled).length })}{version.activatedAt ? t('wl_version_meta_deployed', { date: formatDateTime(version.activatedAt) }) : ''}</p>
                  {version.sourceRefs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {version.sourceRefs.map((reference) => reference.url ? (
                        <a key={`${reference.title}-${reference.url}`} href={reference.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 rounded-full bg-slate-100 px-3 text-xs text-slate-600 hover:text-blue-700 dark:bg-slate-800 dark:text-slate-300">
                          {reference.title}<ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ) : <span key={reference.title} className="inline-flex min-h-8 items-center rounded-full bg-slate-100 px-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{reference.title}</span>)}
                    </div>
                  )}
                </div>
                {canManage && version.status === 'draft' && (
                  <button
                    type="button"
                    onClick={() => setPendingActivationId(version.id)}
                    disabled={Boolean(activatingId)}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-blue-200 px-4 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40"
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" /> {t('wl_activate')}
                  </button>
                )}
              </div>
            </article>
          ))}
          {versions.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">{t('wl_no_versions')}</p>
          )}
        </div>
      </div>
      {canManage && pendingActivationVersion?.status === 'draft' && (
        <PolicyActivationDialog
          version={pendingActivationVersion}
          isLoading={activatingId === pendingActivationVersion.id}
          onCancel={closeActivationDialog}
          onConfirm={() => void activateVersion(pendingActivationVersion)}
        />
      )}
    </section>
  );
}

function PolicyActivationDialog({
  version,
  isLoading,
  onCancel,
  onConfirm,
}: {
  version: SafetyCenterWastePolicyVersion;
  isLoading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const isLoadingRef = useRef(isLoading);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    const dialog = dialogRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isLoadingRef.current) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog?.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="waste-policy-activation-title"
        aria-describedby="waste-policy-activation-description"
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900 sm:p-6"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 id="waste-policy-activation-title" className="mt-4 text-lg font-medium text-slate-950 dark:text-white">{t('wl_confirm_title')}</h2>
        <p id="waste-policy-activation-description" className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
          <Trans i18nKey="wl_confirm_body" values={{ label: version.versionLabel }} components={{ strong: <strong className="font-medium text-slate-900 dark:text-slate-100" /> }} />
        </p>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
          {t('wl_confirm_meta', { count: version.streams.filter((stream) => stream.isEnabled).length, name: version.name })}
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="min-h-11 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t('wl_cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            {t('wl_confirm_deploy')}
          </button>
        </div>
      </div>
    </div>
  );
}

function WasteStreamEditor({
  stream,
  expanded,
  canManage,
  showValidation,
  fieldErrors,
  onToggleExpanded,
  onChange,
  onToggleHazard,
}: {
  stream: SafetyCenterWastePolicyStreamInput;
  expanded: boolean;
  canManage: boolean;
  showValidation: boolean;
  fieldErrors: Record<string, string>;
  onToggleExpanded: () => void;
  onChange: (stream: SafetyCenterWastePolicyStreamInput) => void;
  onToggleHazard: (flag: WasteHazardFlag, mode: 'allowed' | 'blocked') => void;
}) {
  const { t } = useTranslation();
  const streamDefinition = WASTE_POLICY_STREAMS.find(({ streamCode }) => streamCode === stream.streamCode);
  const locationError = fieldErrors[`streams.${stream.streamCode}.location`];
  const sopError = fieldErrors[`streams.${stream.streamCode}.sopUrl`];
  const displayNameKoError = fieldErrors[`streams.${stream.streamCode}.displayNameKo`];
  const displayNameEnError = fieldErrors[`streams.${stream.streamCode}.displayNameEn`];
  const panelId = `waste-stream-${stream.streamCode}`;

  return (
    <article className={`rounded-lg border ${stream.isEnabled ? 'border-blue-200 dark:border-blue-900' : 'border-slate-200 dark:border-slate-700'}`}>
      <div className="flex min-h-14 items-center gap-2 p-2 sm:px-3">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stream.isEnabled ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{stream.displayNameKo || streamDefinition?.displayNameKo}</span>
            <span className="block truncate font-mono text-[11px] text-slate-500">{stream.streamCode}</span>
          </span>
          {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />}
        </button>
        <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs font-medium text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={stream.isEnabled}
            onChange={(event) => onChange({ ...stream, isEnabled: event.target.checked })}
            disabled={!canManage}
            className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          {stream.isEnabled ? t('wl_stream_on') : t('wl_stream_off')}
        </label>
      </div>

      {expanded && (
        <div id={panelId} className="border-t border-slate-200 p-4 dark:border-slate-700">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('wl_name_ko')}
              <input value={stream.displayNameKo} disabled={!canManage} onChange={(event) => onChange({ ...stream, displayNameKo: event.target.value })} aria-invalid={showValidation && Boolean(displayNameKoError)} className={inputClass} />
              {showValidation && displayNameKoError && <span className="mt-1 block text-xs text-red-600">{displayNameKoError}</span>}
            </label>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('wl_name_en')}
              <input value={stream.displayNameEn} disabled={!canManage} onChange={(event) => onChange({ ...stream, displayNameEn: event.target.value })} aria-invalid={showValidation && Boolean(displayNameEnError)} className={inputClass} />
              {showValidation && displayNameEnError && <span className="mt-1 block text-xs text-red-600">{displayNameEnError}</span>}
            </label>
          </div>
          <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('wl_desc')}
            <textarea value={stream.descriptionKo ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, descriptionKo: event.target.value })} rows={2} className={textareaClass} />
          </label>

          <div className="mt-5 rounded-lg bg-slate-50 p-4 dark:bg-slate-950/60">
            <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('wl_site_info')}</h4>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('wl_container_name')}
                <input value={stream.containerLabel ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, containerLabel: event.target.value })} className={inputClass} placeholder={t('wl_container_ph')} />
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('wl_location')}
                <input value={stream.location ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, location: event.target.value })} aria-invalid={showValidation && Boolean(locationError)} className={inputClass} placeholder={t('wl_location_ph')} />
                {showValidation && locationError && <span className="mt-1 block text-xs text-red-600">{locationError}</span>}
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('wl_color')}
                <input value={stream.containerColor ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, containerColor: event.target.value })} className={inputClass} placeholder={t('wl_color_ph')} />
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('wl_contact')}
                <input value={stream.handlerContact ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, handlerContact: event.target.value })} className={inputClass} placeholder={t('wl_contact_ph')} />
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                {t('wl_sop_link')}
                <input type="url" inputMode="url" value={stream.sopUrl ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, sopUrl: event.target.value })} aria-invalid={showValidation && Boolean(sopError)} className={inputClass} placeholder="https://..." />
                {showValidation && sopError && <span className="mt-1 block text-xs text-red-600">{sopError}</span>}
              </label>
            </div>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            {(['allowed', 'blocked'] as const).map((mode) => (
              <div key={mode}>
                <h4 className={`text-sm font-medium ${mode === 'blocked' ? 'text-red-700 dark:text-red-300' : 'text-slate-900 dark:text-slate-100'}`}>{mode === 'allowed' ? t('wl_hz_allowed') : t('wl_hz_blocked')}</h4>
                <p className="mt-1 text-xs text-slate-500">{t('wl_hz_note')}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {WASTE_POLICY_HAZARDS.map(({ flag, labelKey }) => {
                    const checked = mode === 'allowed' ? stream.allowedHazardFlags.includes(flag) : stream.blockedHazardFlags.includes(flag);
                    return (
                      <label key={flag} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium ${checked ? mode === 'blocked' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>
                        <input type="checkbox" checked={checked} disabled={!canManage} onChange={() => onToggleHazard(flag, mode)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                        {t(labelKey)}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('wl_prohibitions')} <span className="font-normal text-slate-500">{t('wl_one_per_line')}</span>
              <textarea value={stream.prohibitions.join('\n')} disabled={!canManage} onChange={(event) => onChange({ ...stream, prohibitions: linesToArray(event.target.value) })} rows={4} className={textareaClass} placeholder={t('wl_prohib_ph')} />
            </label>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('wl_label_reqs')} <span className="font-normal text-slate-500">{t('wl_one_per_line')}</span>
              <textarea value={stream.labelRequirements.join('\n')} disabled={!canManage} onChange={(event) => onChange({ ...stream, labelRequirements: linesToArray(event.target.value) })} rows={4} className={textareaClass} placeholder={t('wl_label_ph')} />
            </label>
          </div>
        </div>
      )}
    </article>
  );
}
