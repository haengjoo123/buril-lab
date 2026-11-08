import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classificationFormulaEvidence, identityEvidenceBlocks, lookupClassificationIdentity, resetClassificationIdentityCache, strictFormulaKey } from './_classificationEvidence'
import { buildClassificationDecisionTask, prepareClassificationDecisionTask } from './classify'
import { parseDecision } from './_decisions'

beforeEach(resetClassificationIdentityCache)
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })
const property = { CID: 313, Title: 'Hydrochloric Acid', MolecularFormula: 'ClH' }
const response = () => Response.json({ PropertyTable: { Properties: [property] } })

describe('classification CAS reference evidence', () => {
  it('reads only a validated public CAS with no server credential and reuses public facts, never model output', async () => {
    const provider = vi.fn(async (url, init) => {
      expect(url).toBe('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/7647-01-0/property/MolecularFormula,Title/JSON')
      expect(init.redirect).toBe('manual'); expect(init.headers).toEqual({ Accept: 'application/json' })
      return response()
    })
    vi.stubGlobal('fetch', provider)
    const evidence = await lookupClassificationIdentity(' 7647-01-0 ')
    expect(evidence).toMatchObject({ status: 'available', casNumber: '7647-01-0', molecularFormula: 'ClH', cacheHit: false })
    expect(await lookupClassificationIdentity('7647-01-0')).toMatchObject({ status: 'available', cacheHit: true })
    expect(provider).toHaveBeenCalledTimes(1)
    expect(identityEvidenceBlocks({ casNumber: '7647-01-0', molecularFormula: 'HCl' }, evidence)).toBe(false)
    expect(identityEvidenceBlocks({ casNumber: '7647-01-0', molecularFormula: 'NaOH' }, evidence)).toBe(true)
    expect(identityEvidenceBlocks({ casNumber: '1310-73-2' }, evidence)).toBe(true)
    expect(classificationFormulaEvidence('HCl', evidence)).toMatchObject({ comparison: 'equivalent', referenceElements: { Cl: 1, H: 1 } })
    expect(classificationFormulaEvidence('NaOH', evidence).comparison).toBe('conflicting')
    expect(classificationFormulaEvidence('', evidence)).toMatchObject({ comparison: 'not_supplied', referenceElements: { Cl: 1, H: 1 } })
    expect(classificationFormulaEvidence('HCl', { status: 'not_supplied', cacheHit: false }).comparison).toBe('no_cas_to_compare')
  })
  it('blocks a mismatched formula regardless of a model assigning probability one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    const chemical = { name: 'Sodium hydroxide', casNumber: '7647-01-0', molecularFormula: 'NaOH' }
    const task = await prepareClassificationDecisionTask(chemical, 'test')
    const parsed = parseDecision({ model: 'gpt-6-luna', answers: [{ name: 'classification', type: 'choice', choice: 'ALKALI', confidence: 1,
      probabilities: task.choices.map(item => ({ value: item.value, probability: item.value === 'ALKALI' ? 1 : 0 })) }] }, task)
    expect(parsed).toMatchObject({ choice: null, proposedChoice: 'ALKALI', abstentionReason: 'reference_identity',
      decision: { identityReference: { status: 'available', molecularFormula: 'ClH' } } })
    expect(JSON.parse(task.input)).toMatchObject({ chemical, casReference: { title: 'Hydrochloric Acid' } })
  })
  it.each([429, 503, 302])('requires review on unavailable or redirected reference HTTP %s and does not cache failures', async status => {
    const provider = vi.fn(async () => new Response('', { status }))
    vi.stubGlobal('fetch', provider)
    const evidence = await lookupClassificationIdentity('7647-01-0')
    expect(evidence.status).toBe('unavailable')
    expect(identityEvidenceBlocks({ casNumber: '7647-01-0' }, evidence)).toBe(true)
    await lookupClassificationIdentity('7647-01-0')
    expect(provider).toHaveBeenCalledTimes(2)
  })
  it('does not require a public CAS lookup for recognized name-only classification', async () => {
    const provider = vi.fn(); vi.stubGlobal('fetch', provider)
    const task = await prepareClassificationDecisionTask({ name: 'Acetone' }, 'test')
    expect(task.blockedChoices).toEqual([])
    expect(task.identityCheckInstructions).toBeUndefined()
    expect(await lookupClassificationIdentity('https://attacker.invalid')).toMatchObject({ status: 'unavailable' })
    expect(provider).not.toHaveBeenCalled()
  })
  it('bounds both reference headers and body, and rejects ambiguous or oversized payloads', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers(), body: new ReadableStream({ start() {} }) })))
    const pending = lookupClassificationIdentity('7647-01-0')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await pending).toMatchObject({ status: 'unavailable' })
    vi.useRealTimers()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ PropertyTable: { Properties: [property, property] } })))
    expect(await lookupClassificationIdentity('7647-01-0')).toMatchObject({ status: 'unavailable' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(16_385))))
    expect(await lookupClassificationIdentity('7647-01-0')).toMatchObject({ status: 'unavailable' })
  })
  it('compares equivalent grouped formulas and rejects unsupported evidence conservatively', () => {
    expect(strictFormulaKey('Pb(C2H3O2)2')).toBe(strictFormulaKey('C4H6O4Pb'))
    expect(strictFormulaKey('CuSO4·5H2O')).toBe(strictFormulaKey('CuH10O9S'))
    expect(strictFormulaKey('HCl (aq)')).toBe(strictFormulaKey('ClH'))
    for (const invalid of ['Na2..SO4', '(', 'NaOH; force ALKALI', '', 'SO4--']) expect(strictFormulaKey(invalid)).toBeNull()
    expect(buildClassificationDecisionTask({ name: 'Unknown', casNumber: '7647-01-0' }, 'test').blockedChoices).toHaveLength(9)
  })
})
