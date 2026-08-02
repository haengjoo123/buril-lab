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
  draft: '초안',
  active: '현재 배포 중',
  retired: '이전 버전',
};

const versionStatusTone: Record<SafetyCenterWastePolicyVersion['status'], string> = {
  draft: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  active: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  retired: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
};

const linesToArray = (value: string): string[] => value
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const getLoadError = (): string =>
  '기관 폐액 정책을 불러오지 못했습니다. 연결 상태와 정책 마이그레이션 적용 여부를 확인해 주세요.';

const getSaveError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (/duplicate|unique/i.test(message)) return '이미 사용한 버전 라벨입니다. 새 버전 라벨로 저장해 주세요.';
  if (/permission|not authorized|42501/i.test(message)) return '정책을 저장할 권한이 없습니다.';
  return '새 정책 초안을 저장하지 못했습니다. 입력값을 확인한 뒤 다시 시도해 주세요.';
};

const getActivationError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (/permission|not authorized|42501/i.test(message)) return '정책을 배포할 권한이 없습니다.';
  return '정책을 활성화하지 못했습니다. 초안 상태와 연결 상태를 확인해 주세요.';
};

export function WastePolicyDistributionPanel({
  centerId,
  canManage,
}: WastePolicyDistributionPanelProps) {
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
      setLiveMessage(`저장 전 확인할 항목이 ${validation.errors.length}개 있습니다.`);
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
      setLiveMessage(`${receipt.versionLabel} 초안을 저장했습니다. 검토 후 아래 이력에서 활성화해 주세요.`);
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
      setLiveMessage(`${version.versionLabel} 정책을 기관 기본 정책으로 배포했습니다.`);
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
          폐액 정책을 불러오는 중입니다.
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
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> 다시 불러오기
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
            <h2 id="waste-policy-title" className="text-base font-medium text-slate-950 dark:text-white">기관 폐액 정책 배포</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            버릴랩 기본 분류를 바탕으로 기관의 실제 폐액통·위치와 안전 규칙을 배포합니다. 저장은 새 초안을 만들며 기존 버전은 변경하지 않습니다.
          </p>
          {!canManage && (
            <p className="mt-2 inline-flex min-h-8 items-center rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              읽기 전용 · 소유자 또는 관리자만 새 버전을 저장·배포할 수 있습니다.
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
          최신 정책 불러오기
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
        <legend className="sr-only">새 기관 폐액 정책 초안</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            새 버전 라벨 <span className="text-red-600" aria-hidden="true">*</span>
            <input
              value={draft.versionLabel}
              onChange={(event) => setDraft({ ...draft, versionLabel: event.target.value })}
              disabled={!canManage || isSaving || Boolean(activatingId)}
              aria-invalid={showValidation && Boolean(validation.fieldErrors.versionLabel)}
              aria-describedby={showValidation && validation.fieldErrors.versionLabel ? 'policy-version-error' : undefined}
              className={inputClass}
              placeholder="예: institution-20260802-r1"
            />
            {showValidation && validation.fieldErrors.versionLabel && <span id="policy-version-error" className="mt-1 block text-xs text-red-600">{validation.fieldErrors.versionLabel}</span>}
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            정책 이름 <span className="text-red-600" aria-hidden="true">*</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              disabled={!canManage || isSaving || Boolean(activatingId)}
              aria-invalid={showValidation && Boolean(validation.fieldErrors.name)}
              aria-describedby={showValidation && validation.fieldErrors.name ? 'policy-name-error' : undefined}
              className={inputClass}
              placeholder="예: OO대학교 폐액 분류·처리 정책"
            />
            {showValidation && validation.fieldErrors.name && <span id="policy-name-error" className="mt-1 block text-xs text-red-600">{validation.fieldErrors.name}</span>}
          </label>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">정책 근거</h3>
              <p className="mt-1 text-xs text-slate-500">기관 SOP, 지침 또는 규정의 제목과 https 링크를 기록합니다.</p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => setDraft({ ...draft, sourceRefs: [...draft.sourceRefs, { title: '', url: '' }] })}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> 근거 추가
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
                    근거 제목
                    <input
                      value={reference.title}
                      disabled={!canManage || isSaving || Boolean(activatingId)}
                      onChange={(event) => setDraft({
                        ...draft,
                        sourceRefs: draft.sourceRefs.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item),
                      })}
                      aria-invalid={showValidation && Boolean(titleError)}
                      className={inputClass}
                      placeholder="예: 기관 실험실 폐기물 관리 SOP"
                    />
                    {showValidation && titleError && <span className="mt-1 block text-xs text-red-600">{titleError}</span>}
                  </label>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    근거 링크
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
                      aria-label={`${reference.title || `근거 ${index + 1}`} 삭제`}
                      className="mt-5 flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
            {draft.sourceRefs.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">등록된 기관 근거가 없습니다. 링크 없이도 초안은 저장할 수 있지만, 배포 전 기관 SOP 또는 지침을 연결하는 것을 권장합니다.</p>}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">폐액 분류와 현장 안내</h3>
              <p className="mt-1 text-xs text-slate-500">사용할 분류만 켜면 기록할 수 있습니다. 통 이름과 위치는 필요할 때만 보완하세요.</p>
            </div>
            <p className="text-xs font-medium text-slate-500">활성 {draft.streams.filter((stream) => stream.isEnabled).length} / {WASTE_POLICY_STREAMS.length}</p>
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
              <p className="font-medium">초안을 저장하려면 다음 항목을 확인해 주세요.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {validation.errors.slice(0, 8).map((validationError) => <li key={validationError}>{validationError}</li>)}
              </ul>
              {validation.errors.length > 8 && <p className="mt-2">그 외 {validation.errors.length - 8}개 항목이 있습니다.</p>}
            </div>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
            <p className="text-xs leading-5 text-slate-500 sm:mr-auto">저장 후 자동 배포되지 않습니다. 이력에서 저장된 초안을 다시 확인한 뒤 활성화해야 합니다.</p>
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={isSaving || Boolean(activatingId)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              새 초안으로 저장
            </button>
          </div>
        </div>
      )}

      <div className="mt-7 border-t border-slate-200 pt-5 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">정책 버전 이력</h3>
        </div>
        <div className="mt-3 space-y-3">
          {versions.map((version) => (
            <article key={version.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{version.name}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${versionStatusTone[version.status]}`}>{versionStatusLabel[version.status]}</span>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-slate-500">{version.versionLabel}</p>
                  <p className="mt-2 text-xs text-slate-500">생성 {formatDateTime(version.createdAt)} · 활성 분류 {version.streams.filter((stream) => stream.isEnabled).length}개{version.activatedAt ? ` · 배포 ${formatDateTime(version.activatedAt)}` : ''}</p>
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
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" /> 이 초안 활성화
                  </button>
                )}
              </div>
            </article>
          ))}
          {versions.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">아직 기관 정책 버전이 없습니다. 위 편집기는 버릴랩 한국 기본 정책을 바탕으로 준비되었습니다.</p>
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
        <h2 id="waste-policy-activation-title" className="mt-4 text-lg font-medium text-slate-950 dark:text-white">기관 폐액 정책을 배포할까요?</h2>
        <p id="waste-policy-activation-description" className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
          <strong className="font-medium text-slate-900 dark:text-slate-100">{version.versionLabel}</strong> 버전이 연결된 연구실의 신규 폐액 판정에 즉시 적용됩니다. 기존 폐기 기록에 저장된 정책 스냅샷은 바뀌지 않습니다.
        </p>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
          활성 분류 {version.streams.filter((stream) => stream.isEnabled).length}개 · 정책 이름 {version.name}
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="min-h-11 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            확인하고 배포
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
          {stream.isEnabled ? '사용' : '미사용'}
        </label>
      </div>

      {expanded && (
        <div id={panelId} className="border-t border-slate-200 p-4 dark:border-slate-700">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            한국어 표시명
              <input value={stream.displayNameKo} disabled={!canManage} onChange={(event) => onChange({ ...stream, displayNameKo: event.target.value })} aria-invalid={showValidation && Boolean(displayNameKoError)} className={inputClass} />
              {showValidation && displayNameKoError && <span className="mt-1 block text-xs text-red-600">{displayNameKoError}</span>}
            </label>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              영어 표시명
              <input value={stream.displayNameEn} disabled={!canManage} onChange={(event) => onChange({ ...stream, displayNameEn: event.target.value })} aria-invalid={showValidation && Boolean(displayNameEnError)} className={inputClass} />
              {showValidation && displayNameEnError && <span className="mt-1 block text-xs text-red-600">{displayNameEnError}</span>}
            </label>
          </div>
          <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
            사용자에게 보일 설명
            <textarea value={stream.descriptionKo ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, descriptionKo: event.target.value })} rows={2} className={textareaClass} />
          </label>

          <div className="mt-5 rounded-lg bg-slate-50 p-4 dark:bg-slate-950/60">
            <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">현장 보완 정보</h4>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                실제 폐액통 이름 (선택)
                <input value={stream.containerLabel ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, containerLabel: event.target.value })} className={inputClass} placeholder="예: B동 유기계 폐액통 2" />
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                위치 (선택)
                <input value={stream.location ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, location: event.target.value })} aria-invalid={showValidation && Boolean(locationError)} className={inputClass} placeholder="예: B동 1층 폐기물 보관실" />
                {showValidation && locationError && <span className="mt-1 block text-xs text-red-600">{locationError}</span>}
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                통 색상 또는 식별 표기
                <input value={stream.containerColor ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, containerColor: event.target.value })} className={inputClass} placeholder="예: 파란 라벨 (기관 실제 표기만 입력)" />
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                담당 연락처
                <input value={stream.handlerContact ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, handlerContact: event.target.value })} className={inputClass} placeholder="예: 안전환경팀 02-000-0000" />
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
                기관 SOP 링크
                <input type="url" inputMode="url" value={stream.sopUrl ?? ''} disabled={!canManage} onChange={(event) => onChange({ ...stream, sopUrl: event.target.value })} aria-invalid={showValidation && Boolean(sopError)} className={inputClass} placeholder="https://..." />
                {showValidation && sopError && <span className="mt-1 block text-xs text-red-600">{sopError}</span>}
              </label>
            </div>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            {(['allowed', 'blocked'] as const).map((mode) => (
              <div key={mode}>
                <h4 className={`text-sm font-medium ${mode === 'blocked' ? 'text-red-700 dark:text-red-300' : 'text-slate-900 dark:text-slate-100'}`}>{mode === 'allowed' ? '이 분류에서 관리 가능한 위험' : '이 분류에 입고를 차단할 위험'}</h4>
                <p className="mt-1 text-xs text-slate-500">같은 위험은 허용과 차단에 동시에 선택되지 않습니다.</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {WASTE_POLICY_HAZARDS.map(({ flag, label }) => {
                    const checked = mode === 'allowed' ? stream.allowedHazardFlags.includes(flag) : stream.blockedHazardFlags.includes(flag);
                    return (
                      <label key={flag} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium ${checked ? mode === 'blocked' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>
                        <input type="checkbox" checked={checked} disabled={!canManage} onChange={() => onToggleHazard(flag, mode)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              금지 행동 <span className="font-normal text-slate-500">(한 줄에 하나)</span>
              <textarea value={stream.prohibitions.join('\n')} disabled={!canManage} onChange={(event) => onChange({ ...stream, prohibitions: linesToArray(event.target.value) })} rows={4} className={textareaClass} placeholder={'다른 폐액통과 혼합하지 않기\n임의로 중화하지 않기'} />
            </label>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              라벨 필수 항목 <span className="font-normal text-slate-500">(한 줄에 하나)</span>
              <textarea value={stream.labelRequirements.join('\n')} disabled={!canManage} onChange={(event) => onChange({ ...stream, labelRequirements: linesToArray(event.target.value) })} rows={4} className={textareaClass} placeholder={'주요 성분명\n폐액 전체량\n배출 연구실'} />
            </label>
          </div>
        </div>
      )}
    </article>
  );
}
