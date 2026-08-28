import { describe, expect, it } from 'vitest'
import { onRequestPost as classifyAI } from '../ai/classify'
import { onRequestPost as disposalGuideAI } from '../ai/disposal-guide'
import { onRequestPost as scanLabelAI } from '../ai/scan-label'
import { onRequestPost as classifyLegacy } from './classify'
import { onRequestPost as disposalGuideLegacy } from './disposal-guide'
import { onRequestPost as scanLabelLegacy } from './scan-label'

describe('Android 1.0.4 AI compatibility aliases', () => {
  it('uses the exact same OpenAI handlers for new and legacy routes', () => {
    expect(classifyLegacy).toBe(classifyAI)
    expect(disposalGuideLegacy).toBe(disposalGuideAI)
    expect(scanLabelLegacy).toBe(scanLabelAI)
  })
})
