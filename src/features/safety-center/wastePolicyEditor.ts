import type {
  ActiveWastePolicy,
  ResolvedWasteStream,
  SafetyCenterWastePolicyStreamInput,
  SafetyCenterWastePolicyVersion,
  WastePolicySourceRef,
} from '../../services/wastePolicyService';
import type { WasteHazardFlag, WasteStreamCode } from '../../types';

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
  label: string;
}> = [
  { flag: 'FLAMMABLE', label: '인화성' },
  { flag: 'OXIDIZER', label: '산화성' },
  { flag: 'EXPLOSIVE', label: '폭발성' },
  { flag: 'SELF_REACTIVE', label: '자기반응성' },
  { flag: 'WATER_REACTIVE', label: '수반응성' },
  { flag: 'PYROPHORIC', label: '자연발화성' },
  { flag: 'CORROSIVE', label: '부식성' },
  { flag: 'ACUTE_TOXIC', label: '급성독성' },
  { flag: 'CMR', label: '발암성·생식독성' },
  { flag: 'ENVIRONMENTAL_HAZARD', label: '환경유해성' },
  { flag: 'CYANIDE', label: '시안' },
  { flag: 'SULFIDE', label: '황화물' },
  { flag: 'HEAVY_METAL', label: '중금속' },
  { flag: 'HYDROFLUORIC_ACID', label: '불산(HF)' },
  { flag: 'FLUORIDE', label: '불화물' },
  { flag: 'REACTIVE', label: '반응성' },
  { flag: 'UNKNOWN_COMPONENT', label: '미상 성분' },
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
    name: latestVersion?.name || '기관 폐액 분류·처리 정책',
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
  if (!draft.versionLabel.trim()) fieldErrors.versionLabel = '버전 라벨을 입력해 주세요.';
  if (!draft.name.trim()) fieldErrors.name = '정책 이름을 입력해 주세요.';

  draft.sourceRefs.forEach((reference, index) => {
    if (!reference.title.trim() && reference.url?.trim()) {
      fieldErrors[`sourceRefs.${index}.title`] = '근거 제목을 입력해 주세요.';
    }
    if (reference.url?.trim() && !isHttpsUrl(reference.url.trim())) {
      fieldErrors[`sourceRefs.${index}.url`] = '근거 링크는 https:// 주소만 사용할 수 있습니다.';
    }
  });

  const enabledStreams = draft.streams.filter((stream) => stream.isEnabled);
  if (enabledStreams.length === 0) errors.push('사용할 폐액 분류를 하나 이상 활성화해 주세요.');

  draft.streams.forEach((stream) => {
    const label = stream.displayNameKo || stream.streamCode;
    if (!stream.displayNameKo.trim()) {
      fieldErrors[`streams.${stream.streamCode}.displayNameKo`] = `${stream.streamCode}: 한국어 표시명을 입력해 주세요.`;
    }
    if (!stream.displayNameEn.trim()) {
      fieldErrors[`streams.${stream.streamCode}.displayNameEn`] = `${label}: 영어 표시명을 입력해 주세요.`;
    }
    if (stream.sopUrl?.trim() && !isHttpsUrl(stream.sopUrl.trim())) {
      fieldErrors[`streams.${stream.streamCode}.sopUrl`] = `${label}: SOP 링크는 https:// 주소만 사용할 수 있습니다.`;
    }
  });

  const streamCodes = new Set(draft.streams.map((stream) => stream.streamCode));
  if (streamCodes.size !== WASTE_POLICY_STREAMS.length ||
      WASTE_POLICY_STREAMS.some(({ streamCode }) => !streamCodes.has(streamCode))) {
    errors.push('지원하는 폐액 분류 10개가 모두 포함되어야 합니다.');
  }

  errors.push(...Object.values(fieldErrors));
  return { errors: Array.from(new Set(errors)), fieldErrors };
}
