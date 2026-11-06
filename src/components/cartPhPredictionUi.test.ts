import { describe, expect, it } from 'vitest'
import { APPROVED_PH_CATALOG_RECORDS } from '../features/phPrediction'
import type { PhPredictionResult, WasteComponent } from '../types'
import {
  canDisplayPhPredictionNumber,
  createPhPredictionAuditSnapshot,
  getApprovedPhCatalogOptions,
  getPhCatalogFormLabel,
  shouldAskPhPredictionCompleteness,
  shouldOfferPhCatalogForm,
  shouldShowPhPredictionMatrixNotice,
} from './cartPhPredictionUi'

const component = (
  casNumber?: string,
  molecularFormula?: string,
): Pick<WasteComponent, 'chemical'> => ({
  chemical: {
    id: 'ui-policy-test',
    name: 'UI policy test',
    casNumber: casNumber ?? '',
    molecularFormula: molecularFormula ?? '',
  },
})

const result = (
  status: PhPredictionResult['status'],
  value?: number,
): PhPredictionResult => ({
  status,
  value,
  confidence: status === 'available' ? 'good' : 'unavailable',
  issueCodes: [],
  assumptions: [],
  modelVersion: 'test',
  catalogVersion: 'test',
  inputHash: 'test',
})

describe('pH prediction UI safety policy', () => {
  it('offers only approved exact catalog forms', () => {
    const hydrochloricAcid = getApprovedPhCatalogOptions(component('7647-01-0', 'HCl'))
    expect(hydrochloricAcid).toEqual(
      APPROVED_PH_CATALOG_RECORDS.filter((record) => record.casNumber === '7647-01-0'),
    )
    expect(hydrochloricAcid.map((record) => record.id)).toEqual(['hydrochloric-acid'])
    expect(hydrochloricAcid.every((record) => APPROVED_PH_CATALOG_RECORDS.includes(record))).toBe(true)
    expect(APPROVED_PH_CATALOG_RECORDS.some((record) => record.id === 'perchloric-acid')).toBe(false)
    expect(getApprovedPhCatalogOptions(component('1310-73-2', 'HCl'))).toEqual([])
    expect(getApprovedPhCatalogOptions(component())).toEqual([])
  })

  it('matches equivalent molecular-formula notations without weakening exact CAS matching', () => {
    expect(getApprovedPhCatalogOptions(component('127-09-3', 'C2H3NaO2')).map(({ id }) => id))
      .toEqual(['sodium-acetate'])
    expect(getApprovedPhCatalogOptions(component('127-09-3', 'CH3COONa')).map(({ id }) => id))
      .toEqual(['sodium-acetate'])
    expect(getApprovedPhCatalogOptions(component('127-09-3')).map(({ id }) => id))
      .toEqual(['sodium-acetate'])
    expect(getApprovedPhCatalogOptions(component('6131-90-4', 'C2H9NaO5'))).toEqual([])
    expect(() => getApprovedPhCatalogOptions(component('127-09-3', 'C)Cl'))).not.toThrow()
    expect(getApprovedPhCatalogOptions(component('127-09-3', 'C)Cl'))).toEqual([])
  })

  it.each(['unsupported', 'blocked', 'failed'] as const)(
    'never displays a number for a %s result even if a value is present',
    (status) => {
      expect(canDisplayPhPredictionNumber(result(status, 7))).toBe(false)
    },
  )

  it('displays finite numbers only for available or approximate results', () => {
    expect(canDisplayPhPredictionNumber(result('available', 7))).toBe(true)
    expect(canDisplayPhPredictionNumber({ ...result('approximate'), displayValue: 6.8 })).toBe(true)
    expect(canDisplayPhPredictionNumber(result('available', Number.NaN))).toBe(false)
  })

  it('asks even a single-component aqueous batch to confirm that no component is omitted', () => {
    expect(shouldAskPhPredictionCompleteness(true, 'aqueous', 1)).toBe(true)
    expect(shouldAskPhPredictionCompleteness(true, 'aqueous', 0)).toBe(false)
    expect(shouldAskPhPredictionCompleteness(false, 'aqueous', 1)).toBe(false)
    expect(shouldAskPhPredictionCompleteness(true, 'mixed_biphasic', 1)).toBe(false)
  })

  it('shows a non-numeric scope notice only for a mixed phase, and no pH block for organic or solid batches', () => {
    expect(shouldShowPhPredictionMatrixNotice(true, 'mixed_biphasic', 2)).toBe(true)
    expect(shouldShowPhPredictionMatrixNotice(true, 'organic_non_halogenated', 1)).toBe(false)
    expect(shouldShowPhPredictionMatrixNotice(true, 'organic_halogenated', 1)).toBe(false)
    expect(shouldShowPhPredictionMatrixNotice(true, 'solid_slurry', 1)).toBe(false)
    expect(shouldShowPhPredictionMatrixNotice(true, 'aqueous', 2)).toBe(false)
    expect(shouldShowPhPredictionMatrixNotice(true, 'unknown', 2)).toBe(false)
    expect(shouldShowPhPredictionMatrixNotice(false, 'mixed_biphasic', 2)).toBe(false)
    expect(shouldShowPhPredictionMatrixNotice(true, 'mixed_biphasic', 0)).toBe(false)
  })

  it('offers the pH form picker only where a form exists and the batch can be aqueous', () => {
    const acid = { ...component('7647-01-0', 'HCl'), phCatalogId: undefined, materialForm: undefined }
    const acetone = { ...component('67-64-1', 'C3H6O'), phCatalogId: undefined, materialForm: undefined }
    expect(shouldOfferPhCatalogForm(true, 'aqueous', acid)).toBe(true)
    expect(shouldOfferPhCatalogForm(true, 'unknown', acid)).toBe(true)
    expect(shouldOfferPhCatalogForm(true, 'organic_non_halogenated', acid)).toBe(false)
    expect(shouldOfferPhCatalogForm(true, 'aqueous', acetone)).toBe(false)
    expect(shouldOfferPhCatalogForm(false, 'aqueous', acid)).toBe(false)
    expect(shouldOfferPhCatalogForm(true, 'aqueous', { ...acetone, phCatalogId: 'water' })).toBe(true)
  })

  it('shows a readable chemical-form name instead of the catalog slug', () => {
    expect(getPhCatalogFormLabel('hydrochloric-acid', 'ko')).toBe('염산')
    expect(getPhCatalogFormLabel('hydrochloric-acid', 'en')).toBe('Hydrochloric acid')
    expect(getPhCatalogFormLabel('not-a-catalog-id', 'ko')).toBeNull()
    expect(getPhCatalogFormLabel(undefined, 'ko')).toBeNull()
  })

  it('keeps the audit snapshot stable across retries of the same batch input', () => {
    const capturedAt = '2026-08-05T00:00:00.000Z'
    const first = createPhPredictionAuditSnapshot(result('failed'), capturedAt)
    const retry = createPhPredictionAuditSnapshot(result('failed'), capturedAt)

    expect(retry).toEqual(first)
    expect(retry).toMatchObject({ origin: 'client_generated', capturedAt })
  })
})
