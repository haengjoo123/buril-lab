import { describe, expect, it } from 'vitest'
import { buildReagentLabelScanResponse, onRequestPost } from './scan-label'

function createConfidentFields(overrides: Record<string, unknown> = {}) {
  return {
    name: { value: 'Acetone', confidence: 0.99 },
    casNumber: { value: '67-64-1', confidence: 0.99 },
    capacity: { value: '500 mL', confidence: 0.96 },
    expiryDate: { value: '2028-02-29', confidence: 0.94 },
    manufacturerDateType: { value: 'expiry', confidence: 0.94 },
    brand: { value: 'Merck', confidence: 0.93 },
    productNumber: { value: 'A-100', confidence: 0.92 },
    containerType: { value: 'A', confidence: 0.97 },
    ...overrides,
  }
}

describe('reagent label scan validation', () => {
  it('returns a per-field snapshot and permits only a clear, valid scan', () => {
    const result = buildReagentLabelScanResponse({
      fields: createConfidentFields(),
    })

    expect(result.success).toBe(true)
    expect(result.reviewRequired).toBe(false)
    expect(result.reviewReasons).toEqual([])
    expect(result.suggestedContainerType).toBe('A')
    expect(result.fieldSnapshots).toEqual({
      name: { value: 'Acetone', confidence: 0.99, validation: 'valid' },
      casNumber: { value: '67-64-1', confidence: 0.99, validation: 'valid' },
      capacity: { value: '500 mL', confidence: 0.96, validation: 'valid' },
      expiryDate: { value: '2028-02-29', confidence: 0.94, validation: 'valid' },
      manufacturerDateType: { value: 'expiry', confidence: 0.94, validation: 'valid' },
      brand: { value: 'Merck', confidence: 0.93, validation: 'valid' },
      productNumber: { value: 'A-100', confidence: 0.92, validation: 'valid' },
      containerType: { value: 'A', confidence: 0.97, validation: 'valid' },
    })
  })

  it('rejects a bad CAS checksum, malformed capacity, and impossible date', () => {
    const result = buildReagentLabelScanResponse({
      fields: createConfidentFields({
        casNumber: { value: '67-64-2', confidence: 0.99 },
        capacity: { value: 'about 500 mL', confidence: 0.99 },
        expiryDate: { value: '2027-02-29', confidence: 0.99 },
      }),
    })

    expect(result.fieldSnapshots.casNumber.validation).toBe('invalid')
    expect(result.fieldSnapshots.capacity.validation).toBe('invalid')
    expect(result.fieldSnapshots.expiryDate.validation).toBe('invalid')
    expect(result.casNumber).toBeUndefined()
    expect(result.capacity).toBeUndefined()
    expect(result.expiryDate).toBeUndefined()
    expect(result.reviewRequired).toBe(true)
    expect(result.reviewReasons).toEqual(expect.arrayContaining([
      'casNumber_invalid',
      'capacity_invalid',
      'expiryDate_invalid',
    ]))
  })

  it('validates grouped and multiplicative capacities without accepting negatives', () => {
    const valid = buildReagentLabelScanResponse({
      fields: createConfidentFields({
        capacity: { value: '2 x 500 mL', confidence: 0.99 },
        expiryDate: { value: '2026/08/07', confidence: 0.99 },
      }),
    })
    const grouped = buildReagentLabelScanResponse({
      fields: createConfidentFields({
        capacity: { value: '1,000 mL', confidence: 0.99 },
      }),
    })
    const negative = buildReagentLabelScanResponse({
      fields: createConfidentFields({
        capacity: { value: '-500 mL', confidence: 0.99 },
      }),
    })

    expect(valid.fieldSnapshots.capacity.validation).toBe('valid')
    expect(valid.fieldSnapshots.expiryDate).toMatchObject({
      value: '2026-08-07',
      validation: 'valid',
    })
    expect(grouped.fieldSnapshots.capacity.validation).toBe('valid')
    expect(negative.fieldSnapshots.capacity.validation).toBe('invalid')
    expect(negative.capacity).toBeUndefined()
  })

  it('does not default an unknown or legacy container code to A', () => {
    const unknown = buildReagentLabelScanResponse({
      fields: createConfidentFields({
        containerType: { value: null, confidence: 0 },
      }),
    })
    const unsupportedLegacyCode = buildReagentLabelScanResponse({
      ...Object.fromEntries(
        Object.entries(createConfidentFields()).map(([key, field]) => [
          key === 'containerType' ? 'suggestedContainerType' : key,
          (field as { value: unknown }).value,
        ]),
      ),
      suggestedContainerType: 'E',
    })

    expect(unknown.suggestedContainerType).toBeNull()
    expect(unknown.fieldSnapshots.containerType.validation).toBe('review_required')
    expect(unknown.reviewRequired).toBe(true)
    expect(unsupportedLegacyCode.suggestedContainerType).toBeNull()
    expect(unsupportedLegacyCode.fieldSnapshots.containerType.validation).toBe('review_required')
  })

  it('requires a user review when a date is readable but its label type is ambiguous', () => {
    const result = buildReagentLabelScanResponse({
      fields: createConfidentFields({
        manufacturerDateType: { value: null, confidence: 0 },
      }),
    })

    expect(result.expiryDate).toBe('2028-02-29')
    expect(result.manufacturerDateType).toBeUndefined()
    expect(result.reviewRequired).toBe(true)
    expect(result.reviewReasons).toContain('manufacturerDateType_review_required')
  })

  it('keeps the existing API-key-missing error response', async () => {
    const response = await onRequestPost({
      request: new Request('https://example.com/api/gemini/scan-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageSrc: 'data:image/jpeg;base64,AA==' }),
      }),
      env: {},
    })
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(500)
    expect(payload.error).toBe('Gemini API key is not configured.')
  })
})
