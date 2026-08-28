import { describe, expect, it } from 'vitest'
import { isProtectedApiPath, resolveRateLimitCategory } from './_middleware'

describe('AI route middleware contract', () => {
  it('protects both new and Android 1.0.4 compatibility routes', () => {
    expect(isProtectedApiPath('/api/ai/classify')).toBe(true)
    expect(isProtectedApiPath('/api/gemini/classify')).toBe(true)
    expect(isProtectedApiPath('/api/voice/query')).toBe(true)
  })

  it('shares the same 10-per-minute AI bucket across new and legacy routes', () => {
    expect(resolveRateLimitCategory('/api/ai/scan-label')).toBe('AI')
    expect(resolveRateLimitCategory('/api/gemini/scan-label')).toBe('AI')
    expect(resolveRateLimitCategory('/api/ai/disposal-guide')).toBe(
      resolveRateLimitCategory('/api/gemini/disposal-guide'),
    )
  })

  it('does not retain a deleted Google Vision route category', () => {
    expect(resolveRateLimitCategory('/api/vision/ocr')).toBeNull()
    expect(isProtectedApiPath('/api/vision/ocr')).toBe(false)
  })
})
