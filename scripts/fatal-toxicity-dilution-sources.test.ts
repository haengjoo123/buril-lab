import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hazardousRegulationEntries,
  parseRegulationThresholds,
  type ChemicalRegulationRecord,
} from '../src/utils/chemicalRegulations'
import { FATAL_TOXICITY_DILUTION_LIMITS, fatalToxicityDilutionLimit } from '../src/utils/fatalToxicityDilutionLimits'

const repository = path.resolve(import.meta.dirname, '..')
const kecoSnapshot = JSON.parse(readFileSync(
  path.join(repository, 'scripts', 'fixtures', 'keco-fatal-toxicity-dilution-2026-10-20.json'),
  'utf8',
)) as { records: ChemicalRegulationRecord[] }
const kecoRecord = (cas: string) => kecoSnapshot.records.find((record) => record.casNumber === cas)!

describe('fatal-toxicity dilution limit sources', () => {
  it('are the lowest published threshold of every hazardous KECO class, read from the stored snapshot', () => {
    for (const limit of FATAL_TOXICITY_DILUTION_LIMITS) {
      const entries = hazardousRegulationEntries(kecoRecord(limit.casNumber))
      expect(entries.map(({ typeName, uniqueNumber, contentThreshold }) => ({ typeName, uniqueNumber, contentThreshold })))
        .toEqual(limit.sources)
      const thresholds = entries.flatMap(({ contentThreshold }) => parseRegulationThresholds(contentThreshold))
      // An entry without a threshold applies at every concentration and would make a limit meaningless.
      expect(entries.every(({ contentThreshold }) => parseRegulationThresholds(contentThreshold).length > 0)).toBe(true)
      expect(Math.min(...thresholds.map(({ percent }) => percent))).toBe(limit.percent)
    }
  })

  it('match the server copy in the migration that re-derives the decision', () => {
    const migration = readFileSync(
      path.join(repository, 'supabase', 'migrations', '20261020090000_waste_fatal_toxicity_dilution.sql'),
      'utf8',
    )
    const serverLimits = Array.from(
      migration.matchAll(/\('([\d-]+)', ([\d.]+)::numeric, ([\d.]+)::numeric, ([\d.]+)::numeric\)/g),
      ([, casNumber, percent, molecularWeight, worstCaseDensity]) => ({
        casNumber,
        percent: Number(percent),
        molecularWeight: Number(molecularWeight),
        worstCaseDensity: Number(worstCaseDensity),
      }),
    )
    expect(serverLimits).toEqual(FATAL_TOXICITY_DILUTION_LIMITS.map(
      ({ casNumber, percent, molecularWeight, worstCaseDensity }) => ({ casNumber, percent, molecularWeight, worstCaseDensity }),
    ))
  })

  it('has no limit for a substance KECO does not classify, nor for nitric acid', () => {
    expect(hazardousRegulationEntries(kecoRecord('1239-45-8'))).toEqual([])
    expect(fatalToxicityDilutionLimit('1239-45-8')).toBeUndefined()
    expect(fatalToxicityDilutionLimit('7697-37-2')).toBeUndefined()
  })
})
