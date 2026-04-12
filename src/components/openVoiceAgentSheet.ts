import type { VoiceQueryContext } from '../utils/voiceAgent'
import { useVoiceAgentStore } from '../store/useVoiceAgentStore'

export function openVoiceAgentSheet(context?: VoiceQueryContext) {
  useVoiceAgentStore.getState().openSheet(context)
}
