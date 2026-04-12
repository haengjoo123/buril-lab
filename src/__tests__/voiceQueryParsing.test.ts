import { describe, expect, it } from 'vitest'
import {
  buildVoiceLookupVariants,
  sanitizeVoiceReagentQuery,
} from '../utils/voiceQueryParsing'

describe('voiceQueryParsing', () => {
  it('strips Korean location phrases from reagent queries', () => {
    expect(sanitizeVoiceReagentQuery('hdg 어디에 있어', 'location')).toBe('hdg')
    expect(sanitizeVoiceReagentQuery('hdg가 어디 있어', 'location')).toBe('hdg')
    expect(sanitizeVoiceReagentQuery('위치 알려줘 hdg', 'location')).toBe('hdg')
  })

  it('strips intent phrases for expiration and remaining questions', () => {
    expect(sanitizeVoiceReagentQuery('hdg 유통기한 알려줘', 'expiration')).toBe('hdg')
    expect(sanitizeVoiceReagentQuery('hdg 잔량 얼마나 남았어', 'remaining')).toBe('hdg')
  })

  it('prioritizes sanitized lookup variants over raw question sentences', () => {
    expect(
      buildVoiceLookupVariants({
        rawInput: 'hdg 어디에 있어',
        reagentQuery: 'hdg 어디에 있어',
        queryAliases: ['HDG', 'hdg reagent'],
        intent: 'location',
      }),
    ).toEqual(['hdg', 'hdg reagent'])
  })

  it('supports English spoken queries', () => {
    expect(sanitizeVoiceReagentQuery('where is the sodium nitrate', 'location')).toBe('sodium nitrate')
  })
})
