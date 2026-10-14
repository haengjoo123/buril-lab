import type {
  ActiveWastePolicy,
  ResolvedWasteStream,
  SafetyCenterWastePolicyStreamInput,
  SafetyCenterWastePolicyVersion,
  WastePolicySourceRef,
} from '../../services/wastePolicyService';
import type { WasteHazardFlag, WasteStreamCode } from '../../types';
import i18n from '../../locales/i18n';

export const WASTE_POLICY_STREAMS: ReadonlyArray<{
  streamCode: WasteStreamCode;
  displayNameKo: string;
  displayNameEn: string;
}> = [
  { streamCode: 'ACID_AQUEOUS', displayNameKo: '산성 수계 폐액', displayNameEn: 'Acidic aqueous waste' },
  { streamCode: 'ALKALI_AQUEOUS', displayNameKo: '알칼리성 수계 폐액', displayNameEn: 'Alkaline aqueous waste' },
  { streamCode: 'ORGANIC_HALOGENATED', displayNameKo: '할로겐 유기용매 폐액', displayNameEn: 'Halogenated organic waste' },
  { streamCode: 'ORGANIC_NON_HALOGENATED', displayNameKo: '비할로겐 유기용매 폐액', displayNameEn: 'Non-halogenated organic waste' },
  { streamCode: 'HEAVY_METAL', displayNameKo: '중금속 폐액', displayNameEn: 'Heavy-metal waste' },
  { streamCode: 'CYANIDE_SULFIDE', displayNameKo: '시안·황화물 폐액', displayNameEn: 'Cyanide and sulfide waste' },
  { streamCode: 'REACTIVE_OXIDIZER', displayNameKo: '반응성·산화성 폐기물', displayNameEn: 'Reactive and oxidizing waste' },
  { streamCode: 'SOLID_CONTAMINATED', displayNameKo: '오염 고체·슬러리', displayNameEn: 'Contaminated solid and slurry' },
  { streamCode: 'AQUEOUS_OTHER', displayNameKo: '기타 수계 폐액', displayNameEn: 'Other aqueous waste' },
  { streamCode: 'SPECIAL_REVIEW', displayNameKo: '특수 검토 폐기물', displayNameEn: 'Special-review waste' },
];

export const WASTE_POLICY_HAZARDS: ReadonlyArray<{
  flag: WasteHazardFlag;
  labelKey: string;
}> = [
  { flag: 'FLAMMABLE', labelKey: 'wl_hazard_flammable' },
  { flag: 'OXIDIZER', labelKey: 'wl_hazard_oxidizer' },
  { flag: 'EXPLOSIVE', labelKey: 'wl_hazard_explosive' },
  { flag: 'SELF_REACTIVE', labelKey: 'wl_hazard_self_reactive' },
  { flag: 'WATER_REACTIVE', labelKey: 'wl_hazard_water_reactive' },
  { flag: 'PYROPHORIC', labelKey: 'wl_hazard_pyrophoric' },
  { flag: 'CORROSIVE', labelKey: 'wl_hazard_corrosive' },
  { flag: 'ACUTE_TOXIC', labelKey: 'wl_hazard_acute_toxic' },
  { flag: 'CMR', labelKey: 'wl_hazard_cmr' },
  { flag: 'ENVIRONMENTAL_HAZARD', labelKey: 'wl_hazard_environmental_hazard' },
  { flag: 'CYANIDE', labelKey: 'wl_hazard_cyanide' },
  { flag: 'SULFIDE', labelKey: 'wl_hazard_sulfide' },
  { flag: 'HEAVY_METAL', labelKey: 'wl_hazard_heavy_metal' },
  { flag: 'HYDROFLUORIC_ACID', labelKey: 'wl_hazard_hydrofluoric_acid' },
  { flag: 'FLUORIDE', labelKey: 'wl_hazard_fluoride' },
  { flag: 'REACTIVE', labelKey: 'wl_hazard_reactive' },
  { flag: 'UNKNOWN_COMPONENT', labelKey: 'wl_hazard_unknown_component' },
];

export interface WastePolicyEditorDraft {
  versionLabel: string;
  name: string;
  sourceRefs: WastePolicySourceRef[];
  streams: SafetyCenterWastePolicyStreamInput[];
}

const trimOrNull = (value?: string | null): string | null => value?.trim() || null;

const toEditorStream = (
  definition: (typeof WASTE_POLICY_STREAMS)[number],
  source?: ResolvedWasteStream,
  sortOrder = 0,
): SafetyCenterWastePolicyStreamInput => ({
  streamCode: definition.streamCode,
  displayNameKo: source?.displayNameKo?.trim() || definition.displayNameKo,
  displayNameEn: source?.displayNameEn?.trim() || definition.displayNameEn,
  descriptionKo: trimOrNull(source?.descriptionKo),
  containerLabel: trimOrNull(source?.containerLabel),
  containerColor: trimOrNull(source?.containerColor),
  location: trimOrNull(source?.location),
  handlerContact: trimOrNull(source?.handlerContact),
  sopUrl: trimOrNull(source?.sopUrl),
  allowedHazardFlags: [...(source?.allowedHazardFlags ?? [])],
  blockedHazardFlags: [...(source?.blockedHazardFlags ?? [])],
  prohibitions: [...(source?.prohibitions ?? [])],
  labelRequirements: [...(source?.labelRequirements ?? [])],
  isEnabled: source?.isEnabled ?? false,
  sortOrder: source?.sortOrder ?? sortOrder,
});

export function createWastePolicyEditorDraft(
  latestVersion: SafetyCenterWastePolicyVersion | null,
  systemPolicy: ActiveWastePolicy | null,
  now = new Date(),
): WastePolicyEditorDraft {
  const sourceStreams = latestVersion?.streams ?? systemPolicy?.resolvedStreams ?? [];
  const sourcesByCode = new Map(sourceStreams.map((stream) => [stream.streamCode, stream]));
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');

  return {
    versionLabel: `institution-${timestamp}`,
    name: latestVersion?.name || i18n.t('wl_policy_default_name'),
    sourceRefs: (latestVersion?.sourceRefs ?? sourceStreams.flatMap((stream) => stream.sourceRefs))
      .filter((reference, index, values) => values.findIndex((value) =>
        value.title === reference.title && value.url === reference.url
      ) === index)
      .map((reference) => ({ ...reference })),
    streams: WASTE_POLICY_STREAMS.map((definition, index) =>
      toEditorStream(definition, sourcesByCode.get(definition.streamCode), index)
    ),
  };
}

export interface WastePolicyValidationResult {
  errors: string[];
  fieldErrors: Record<string, string>;
}

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

export function validateWastePolicyEditorDraft(
  draft: WastePolicyEditorDraft,
): WastePolicyValidationResult {
  const errors: string[] = [];
  const fieldErrors: Record<string, string> = {};
  if (!draft.versionLabel.trim()) fieldErrors.versionLabel = i18n.t('wl_err_version_label');
  if (!draft.name.trim()) fieldErrors.name = i18n.t('wl_err_policy_name');

  draft.sourceRefs.forEach((reference, index) => {
    if (!reference.title.trim() && reference.url?.trim()) {
      fieldErrors[`sourceRefs.${index}.title`] = i18n.t('wl_err_ref_title');
    }
    if (reference.url?.trim() && !isHttpsUrl(reference.url.trim())) {
      fieldErrors[`sourceRefs.${index}.url`] = i18n.t('wl_err_ref_url');
    }
  });

  const enabledStreams = draft.streams.filter((stream) => stream.isEnabled);
  if (enabledStreams.length === 0) errors.push(i18n.t('wl_err_no_stream'));

  draft.streams.forEach((stream) => {
    const label = stream.displayNameKo || stream.streamCode;
    if (!stream.displayNameKo.trim()) {
      fieldErrors[`streams.${stream.streamCode}.displayNameKo`] = i18n.t('wl_err_name_ko', { code: stream.streamCode });
    }
    if (!stream.displayNameEn.trim()) {
      fieldErrors[`streams.${stream.streamCode}.displayNameEn`] = i18n.t('wl_err_name_en', { label });
    }
    if (stream.sopUrl?.trim() && !isHttpsUrl(stream.sopUrl.trim())) {
      fieldErrors[`streams.${stream.streamCode}.sopUrl`] = i18n.t('wl_err_stream_sop', { label });
    }
  });

  const streamCodes = new Set(draft.streams.map((stream) => stream.streamCode));
  if (streamCodes.size !== WASTE_POLICY_STREAMS.length ||
      WASTE_POLICY_STREAMS.some(({ streamCode }) => !streamCodes.has(streamCode))) {
    errors.push(i18n.t('wl_err_all_streams'));
  }

  errors.push(...Object.values(fieldErrors));
  return { errors: Array.from(new Set(errors)), fieldErrors };
}
