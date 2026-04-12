export type VoiceAgentIntent = 'location' | 'expiration' | 'remaining' | 'disposal'
export type VoiceSource = 'typed' | 'voice'
export type VoiceLanguage = 'ko' | 'en'
export type VoiceSpeechMode = 'remote_audio' | 'device_tts' | 'none'
export type VoiceUiActionType =
  | 'focus_cabinet_item'
  | 'show_storage_location'
  | 'search_reagent'
  | 'clarify'
  | 'none'
export type VoiceFailureReason = 'no_match' | 'ambiguous' | 'user_corrected'
export type VoiceMatchSource = 'cabinet_item' | 'inventory'

export interface VoiceQueryContext {
  screen?: 'search' | 'cabinet'
  cabinetId?: string
  language?: VoiceLanguage
}

export interface VoiceTranscriptMeta {
  model?: string
  durationMs?: number
}

export interface VoiceQueryRequest {
  text: string
  source: VoiceSource
  context?: VoiceQueryContext
  transcriptMeta?: VoiceTranscriptMeta
}

export interface VoiceSpeechPayload {
  mode: VoiceSpeechMode
  text: string
}

export interface VoiceMatch {
  source: VoiceMatchSource
  id: string
  name: string
  labId?: string
  casNumber?: string
  productNumber?: string
  brand?: string
  cabinetId?: string
  cabinetName?: string
  shelfId?: string
  shelfLevel?: number
  storageType?: 'cabinet' | 'other'
  storageLocationId?: string
  storageLocationName?: string
  storageLocationIcon?: string
  expiryDate?: string
  remainingPercent?: number
  capacity?: string
  matchedBy: 'cas' | 'name_exact' | 'product_exact' | 'prefix' | 'contains'
}

export interface VoiceClarificationCandidate {
  id: string
  name: string
  source: VoiceMatchSource
  cabinetName?: string
  shelfLevel?: number
  storageLocationName?: string
}

export interface VoiceClarification {
  reason: Exclude<VoiceFailureReason, 'user_corrected'>
  message: string
  candidates: VoiceClarificationCandidate[]
}

export interface VoiceUiAction {
  type: VoiceUiActionType
  cabinetId?: string
  shelfId?: string
  highlightItemId?: string
  query?: string
}

export interface VoiceQueryResponse {
  resolvedText: string
  intent: VoiceAgentIntent
  answerText: string
  speech: VoiceSpeechPayload
  match: VoiceMatch | null
  uiAction: VoiceUiAction
  clarification: VoiceClarification | null
}

export function buildVoiceUiAction(
  intent: VoiceAgentIntent,
  match: VoiceMatch | null,
): VoiceUiAction {
  if (!match) {
    return { type: 'none' }
  }

  if (intent === 'location') {
    if (match.source === 'cabinet_item' && match.cabinetId && match.shelfId) {
      return {
        type: 'focus_cabinet_item',
        cabinetId: match.cabinetId,
        shelfId: match.shelfId,
        highlightItemId: match.id,
      }
    }

    if (match.storageType === 'other') {
      return {
        type: 'show_storage_location',
      }
    }

    return { type: 'none' }
  }

  if (intent === 'disposal') {
    return {
      type: 'search_reagent',
      query: match.name,
    }
  }

  return { type: 'none' }
}

export function normalizeVoiceLookupText(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[_/\\()[\]{}.,]/g, ' ')
    .replace(/[^0-9a-zA-Z\u3131-\u318E\uAC00-\uD7A3\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeCompactToken(value?: string | null): string {
  return normalizeVoiceLookupText(value).replace(/[\s-]/g, '')
}

export function detectVoiceLanguage(text: string, fallback: VoiceLanguage = 'ko'): VoiceLanguage {
  if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text)) {
    return 'ko'
  }

  if (/[a-zA-Z]/.test(text)) {
    return 'en'
  }

  return fallback
}

export function describeRemainingPercent(
  percent: number | null | undefined,
  language: VoiceLanguage,
): string {
  if (percent == null || Number.isNaN(percent)) {
    return language === 'ko'
      ? '잔량 정보가 아직 등록되지 않았어요.'
      : 'The remaining amount has not been recorded yet.'
  }

  if (percent <= 10) {
    return language === 'ko'
      ? '거의 다 사용해서 아주 조금만 남아 있어요.'
      : 'Only a very small amount is left.'
  }

  if (percent <= 30) {
    return language === 'ko'
      ? '대략 30퍼센트 정도 남아 있어요.'
      : 'Roughly 30 percent remains.'
  }

  if (percent <= 70) {
    return language === 'ko'
      ? '아직 절반 이상 남아 있어요.'
      : 'More than half is still left.'
  }

  return language === 'ko'
    ? '거의 새 제품 수준으로 충분히 남아 있어요.'
    : 'It is still well stocked and close to full.'
}

export function buildExpiryAnswer(
  itemName: string,
  expiryDate: string | null | undefined,
  language: VoiceLanguage,
  getDaysLeft: (date?: string | null) => number | null,
): string {
  if (!expiryDate) {
    return language === 'ko'
      ? `${itemName}의 유통기한 정보가 아직 등록되지 않았어요.`
      : `The expiry date for ${itemName} has not been recorded yet.`
  }

  const daysLeft = getDaysLeft(expiryDate)
  if (daysLeft == null) {
    return language === 'ko'
      ? `${itemName}의 유통기한 정보를 해석하지 못했어요.`
      : `I could not interpret the expiry date for ${itemName}.`
  }

  if (daysLeft < 0) {
    return language === 'ko'
      ? `${itemName}는 ${expiryDate}에 이미 만료됐어요.`
      : `${itemName} expired on ${expiryDate}.`
  }

  if (daysLeft === 0) {
    return language === 'ko'
      ? `${itemName}는 오늘 만료예요.`
      : `${itemName} expires today.`
  }

  return language === 'ko'
    ? `${itemName}의 유통기한은 ${expiryDate}이고, 약 ${daysLeft}일 남아 있어요.`
    : `${itemName} expires on ${expiryDate}, with about ${daysLeft} days remaining.`
}

export function buildLocationSummary(match: VoiceMatch, language: VoiceLanguage): string {
  if (match.source === 'cabinet_item') {
    const shelfText = typeof match.shelfLevel === 'number'
      ? language === 'ko'
        ? `${match.shelfLevel + 1}번 선반`
        : `shelf ${match.shelfLevel + 1}`
      : language === 'ko'
        ? '선반 위치'
        : 'its shelf'

    return language === 'ko'
      ? `${match.name}는 ${match.cabinetName || '시약장'}의 ${shelfText}에 있어요.`
      : `${match.name} is in ${match.cabinetName || 'the cabinet'}, on ${shelfText}.`
  }

  if (match.storageType === 'other' && match.storageLocationName) {
    return language === 'ko'
      ? `${match.name}는 ${match.storageLocationName}에 보관되어 있어요.`
      : `${match.name} is stored in ${match.storageLocationName}.`
  }

  return language === 'ko'
    ? `${match.name}의 정확한 위치 정보를 찾았어요.`
    : `I found the location details for ${match.name}.`
}

export function buildClarificationMessage(
  reason: Exclude<VoiceFailureReason, 'user_corrected'>,
  reagentQuery: string,
  language: VoiceLanguage,
): string {
  if (reason === 'ambiguous') {
    return language === 'ko'
      ? `"${reagentQuery}"와 일치하는 시약이 여러 개 있어요. 아래 후보 중에서 골라 주세요.`
      : `I found multiple reagents that match "${reagentQuery}". Please choose one of the options below.`
  }

  return language === 'ko'
    ? `"${reagentQuery}"와 일치하는 시약을 찾지 못했어요. 시약명을 다시 입력해 주세요.`
    : `I could not find a reagent that matches "${reagentQuery}". Please try entering the name again.`
}
