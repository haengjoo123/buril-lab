import { describe, expect, it } from 'vitest'
import { DEFAULT_PH_CATALOG_APPROVAL } from '../features/phPrediction'
import {
  isExplicitlyDisabled,
  isExplicitlyEnabled,
  isPhPredictionDeploymentEnabled,
  isPhPredictionEnabled,
} from './featureFlags'

describe('isExplicitlyEnabled', () => {
  it('fails closed when the flag is missing or not the literal true value', () => {
    expect(isExplicitlyEnabled(undefined)).toBe(false)
    expect(isExplicitlyEnabled('')).toBe(false)
    expect(isExplicitlyEnabled('false')).toBe(false)
    expect(isExplicitlyEnabled('1')).toBe(false)
    expect(isExplicitlyEnabled('yes')).toBe(false)
  })

  it('accepts only an explicit case-insensitive true value', () => {
    expect(isExplicitlyEnabled('true')).toBe(true)
    expect(isExplicitlyEnabled(' TRUE ')).toBe(true)
  })

  it('keeps Waste V2 enabled unless the rollback flag is explicitly false', () => {
    expect(isExplicitlyDisabled(undefined)).toBe(false)
    expect(isExplicitlyDisabled('')).toBe(false)
    expect(isExplicitlyDisabled('true')).toBe(false)
    expect(isExplicitlyDisabled(' FALSE ')).toBe(true)
  })

  it('enables an approved catalog by default and keeps an explicit emergency rollback', () => {
    expect(isPhPredictionDeploymentEnabled(undefined, { runtimeReady: true })).toBe(true)
    expect(isPhPredictionDeploymentEnabled('false', { runtimeReady: true })).toBe(false)
    expect(isPhPredictionDeploymentEnabled(' FALSE ', { runtimeReady: true })).toBe(false)
    expect(isPhPredictionDeploymentEnabled('true', { runtimeReady: false })).toBe(false)
    expect(isPhPredictionDeploymentEnabled(undefined, { runtimeReady: false })).toBe(false)
    expect(isPhPredictionDeploymentEnabled('yes', { runtimeReady: false })).toBe(false)
    expect(isPhPredictionDeploymentEnabled('true', { runtimeReady: true })).toBe(true)
  })

  it('unlocks the current validated catalog in the default environment', () => {
    expect(
      DEFAULT_PH_CATALOG_APPROVAL.runtimeReady,
      DEFAULT_PH_CATALOG_APPROVAL.issueCodes.join(', '),
    ).toBe(true)
    expect(isPhPredictionEnabled).toBe(true)
  })
})
