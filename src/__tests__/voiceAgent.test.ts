import { describe, expect, it } from 'vitest'
import {
  buildExpiryAnswer,
  buildVoiceUiAction,
  describeRemainingPercent,
  normalizeVoiceLookupText,
} from '../utils/voiceAgent'

describe('voiceAgent utilities', () => {
  it('normalizes lookup text for flexible matching', () => {
    expect(normalizeVoiceLookupText('  Sodium-Nitrate (99%)  ')).toBe('sodium-nitrate 99')
    expect(normalizeVoiceLookupText('  Sodium   nitrate  ')).toBe('sodium nitrate')
  })

  it('describes remaining amount in natural language', () => {
    expect(describeRemainingPercent(5, 'en')).toContain('small amount')
    expect(describeRemainingPercent(30, 'en')).toContain('30 percent')
    expect(describeRemainingPercent(60, 'en')).toContain('More than half')
    expect(describeRemainingPercent(100, 'en')).toContain('close to full')
  })

  it('formats expiry answers from days remaining', () => {
    const result = buildExpiryAnswer('Sodium nitrate', '2026-04-20', 'en', () => 8)
    expect(result).toContain('2026-04-20')
    expect(result).toContain('8 days')
  })

  it('reports missing expiry information', () => {
    expect(buildExpiryAnswer('HDG', null, 'en', () => null)).toContain('has not been recorded')
  })

  it('builds location-only cabinet focus actions', () => {
    expect(
      buildVoiceUiAction('location', {
        source: 'cabinet_item',
        id: 'item-1',
        name: 'HDG',
        cabinetId: 'cab-1',
        shelfId: 'shelf-1',
        matchedBy: 'name_exact',
      }),
    ).toEqual({
      type: 'focus_cabinet_item',
      cabinetId: 'cab-1',
      shelfId: 'shelf-1',
      highlightItemId: 'item-1',
    })

    expect(
      buildVoiceUiAction('remaining', {
        source: 'cabinet_item',
        id: 'item-1',
        name: 'HDG',
        cabinetId: 'cab-1',
        shelfId: 'shelf-1',
        matchedBy: 'name_exact',
      }),
    ).toEqual({ type: 'none' })
  })

  it('routes disposal answers back into reagent search', () => {
    expect(
      buildVoiceUiAction('disposal', {
        source: 'inventory',
        id: 'inv-1',
        name: 'Sodium nitrate',
        storageType: 'other',
        matchedBy: 'name_exact',
      }),
    ).toEqual({
      type: 'search_reagent',
      query: 'Sodium nitrate',
    })
  })
})
