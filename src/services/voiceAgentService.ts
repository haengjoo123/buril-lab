import { postJson } from './internalApi'
import { supabase } from './supabaseClient'
import { useLabStore } from '../store/useLabStore'
import type {
  VoiceAgentIntent,
  VoiceFailureReason,
  VoiceMatchSource,
  VoiceQueryRequest,
  VoiceQueryResponse,
} from '../utils/voiceAgent'

export interface VoiceQueryFeedbackInput {
  rawInput: string
  normalizedQuery?: string
  intent?: VoiceAgentIntent
  failureReason: VoiceFailureReason
  correctionText?: string
  selectedMatchSource?: VoiceMatchSource
  selectedMatchId?: string
  metadata?: Record<string, unknown>
}

export async function queryVoiceAgent(payload: VoiceQueryRequest): Promise<VoiceQueryResponse> {
  return postJson<VoiceQueryResponse>('/api/voice/query', payload)
}

export async function submitVoiceQueryFeedback(input: VoiceQueryFeedbackInput): Promise<void> {
  const { currentLabId } = useLabStore.getState()
  const { error } = await supabase.from('voice_query_feedback').insert({
    raw_input: input.rawInput,
    normalized_query: input.normalizedQuery || null,
    intent: input.intent || null,
    failure_reason: input.failureReason,
    correction_text: input.correctionText || null,
    selected_match_source: input.selectedMatchSource || null,
    selected_match_id: input.selectedMatchId || null,
    metadata: input.metadata || {},
    lab_id: currentLabId,
  })

  if (error) {
    throw error
  }
}
