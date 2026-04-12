import { describe, expect, it } from 'vitest'
import {
  buildExpiryAnswer,
  describeRemainingPercent,
  normalizeVoiceLookupText,
} from '../utils/voiceAgent'

describe('voiceAgent utilities', () => {
  it('normalizes lookup text for flexible matching', () => {
    expect(normalizeVoiceLookupText('  Sodium-Nitrate (99%)  ')).toBe('sodium-nitrate 99')
    expect(normalizeVoiceLookupText('소듐   나이트레이트')).toBe('소듐 나이트레이트')
  })

  it('describes remaining amount in natural language', () => {
    expect(describeRemainingPercent(5, 'ko')).toContain('아주 조금')
    expect(describeRemainingPercent(30, 'ko')).toContain('30퍼센트')
    expect(describeRemainingPercent(60, 'en')).toContain('More than half')
    expect(describeRemainingPercent(100, 'en')).toContain('close to full')
  })

  it('formats expiry answers from days remaining', () => {
    const result = buildExpiryAnswer('Sodium nitrate', '2026-04-20', 'en', () => 8)
    expect(result).toContain('2026-04-20')
    expect(result).toContain('8 days')
  })

  it('reports missing expiry information', () => {
    expect(buildExpiryAnswer('시약', null, 'ko', () => null)).toContain('등록되지 않았어요')
  })
})
