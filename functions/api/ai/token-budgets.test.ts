import { describe, expect, it } from 'vitest'
import { CLASSIFICATION_MAX_OUTPUT_TOKENS } from './classify'
import { DISPOSAL_GUIDE_MAX_OUTPUT_TOKENS } from './disposal-guide'
import { LABEL_SCAN_MAX_OUTPUT_TOKENS } from './scan-label'
import {
  VOICE_ALIAS_MAX_OUTPUT_TOKENS,
  VOICE_CANDIDATE_MAX_OUTPUT_TOKENS,
} from '../voice/_reagentAliases'
import { VOICE_INTENT_MAX_OUTPUT_TOKENS } from '../voice/query'

describe('task-specific OpenAI output budgets', () => {
  it('keeps every Responses task within its planned cap', () => {
    expect({
      label: LABEL_SCAN_MAX_OUTPUT_TOKENS,
      classification: CLASSIFICATION_MAX_OUTPUT_TOKENS,
      disposalGuide: DISPOSAL_GUIDE_MAX_OUTPUT_TOKENS,
      voiceIntent: VOICE_INTENT_MAX_OUTPUT_TOKENS,
      voiceAlias: VOICE_ALIAS_MAX_OUTPUT_TOKENS,
      voiceCandidate: VOICE_CANDIDATE_MAX_OUTPUT_TOKENS,
    }).toEqual({
      label: 1_200,
      classification: 400,
      disposalGuide: 2_000,
      voiceIntent: 600,
      voiceAlias: 500,
      voiceCandidate: 500,
    })
  })
})
