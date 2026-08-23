import { describe, expect, it } from 'vitest'
import {
  MATRIX_LABELS,
  canonicalComponentDisplayKey,
  koreanChemicalDisplayName,
  koreanReviewDisplayText,
  opsAnalyticsLabel,
} from './opsAnalyticsLabels'

describe('opsAnalyticsLabels', () => {
  it('removes a redundant English chemical name from a Korean display name', () => {
    expect(koreanChemicalDisplayName('수산화나트륨 (Sodium Hydroxide)')).toBe('수산화나트륨')
    expect(koreanChemicalDisplayName('벤조일아세톤 (Benzoylacetone)')).toBe('벤조일아세톤')
  })

  it('keeps chemical formulae, standards, and names that have no Korean label', () => {
    expect(koreanChemicalDisplayName('수산화나트륨 (NaOH)')).toBe('수산화나트륨 (NaOH)')
    expect(koreanChemicalDisplayName('시약 (CAS 67-64-1)')).toBe('시약 (CAS 67-64-1)')
    expect(koreanChemicalDisplayName('Sodium Hydroxide')).toBe('Sodium Hydroxide')
  })

  it('formats canonical keys without exposing storage prefixes', () => {
    expect(canonicalComponentDisplayKey('cas:1310-73-2')).toBe('CAS 1310-73-2')
    expect(canonicalComponentDisplayKey('name:미상 시약')).toBe('명칭 미상 시약')
    expect(canonicalComponentDisplayKey('unexpected:key')).toBe('식별값 확인 필요')
  })

  it('uses Korean labels while keeping a safe fallback for unknown codes', () => {
    expect(opsAnalyticsLabel('aqueous', MATRIX_LABELS)).toBe('물·수용액')
    expect(opsAnalyticsLabel('future_matrix', MATRIX_LABELS, '미분류')).toBe('미분류')
  })

  it('replaces internal review terminology in visible copy', () => {
    expect(koreanReviewDisplayText('문헌·골든셋·담당자 검토')).toBe('문헌·검증 기준표·담당자 검토')
  })
})
