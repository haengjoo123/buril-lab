import { DEFAULT_PH_CATALOG, resolvePhCatalogIdentity } from '../../../src/features/phPrediction'
import type {
  ChemicalEnrichmentRequestItem,
  ChemicalEnrichmentResult,
  WasteHazardFlag,
} from '../../../src/types'
import { normalizeCasNumber } from '../../../src/utils/casNumber'
import {
  fetchKoshaText,
  parseKoshaItems,
  resolveKoshaIdentityByCas,
  resolveKoshaIdentityByExactName,
  type KoshaEnv,
  type KoshaIdentity,
} from './_kosha'

export type ChemicalEnrichmentEnv = KoshaEnv

type FetchLike = typeof fetch

type FetchOutcome<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'not_found' }
  | { kind: 'transient_error'; error: string }

interface PubChemProperty {
  CID?: number
  Title?: string
  IUPACName?: string
  MolecularFormula?: string
  MolecularWeight?: number | string
  ConnectivitySMILES?: string
  InChIKey?: string
}

interface CandidateRecord {
  cid: number
  property: PubChemProperty
  casNumbers: string[]
  hCodes: string[]
  hazardStatements: string[]
  pictograms: string[]
  signalWord?: string
  explicitlyNotClassified: boolean
  hazardSourceFound: boolean
  sourceUnavailable: boolean
}

const PUG_REST_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
const PUG_VIEW_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view'
const FETCH_TIMEOUT_MS = 8_000
const MAX_FETCH_ATTEMPTS = 3
const MAX_EQUIVALENT_CIDS = 16
const MAX_CANDIDATE_CONCURRENCY = 3

const NOT_CLASSIFIED_PATTERNS = [
  /\bnot\s+classified\b/i,
  /does\s+not\s+meet\s+(?:the\s+)?ghs\s+hazard\s+criteria/i,
  /ghs\s+(?:hazard\s+)?criteria[^.]{0,80}\bnot\s+met\b/i,
  /분류되지\s*않(?:음|습니다)/,
  /ghs\s*분류\s*기준[^.]{0,80}(?:해당하지\s*않|미해당)/i,
] as const

const HAZARD_CODE_FLAGS: ReadonlyArray<[RegExp, WasteHazardFlag]> = [
  [/^H(?:220|221|222|223|224|225|226|227|228)$/, 'FLAMMABLE'],
  [/^H(?:270|271|272)$/, 'OXIDIZER'],
  [/^H(?:200|201|202|203|204|205)$/, 'EXPLOSIVE'],
  [/^H(?:240|241|242)$/, 'SELF_REACTIVE'],
  [/^H(?:260|261)$/, 'WATER_REACTIVE'],
  [/^H250$/, 'PYROPHORIC'],
  [/^H(?:290|314)$/, 'CORROSIVE'],
  [/^H(?:300|301|310|311|330|331)$/, 'ACUTE_TOXIC'],
  [/^H(?:340|341|350|350I|351|360|360F|360D|360FD|361|361F|361D|361FD|362)$/i, 'CMR'],
  [/^H(?:400|410|411|412|413)$/, 'ENVIRONMENTAL_HAZARD'],
]

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

function valueAt(record: Record<string, unknown>, key: string): unknown {
  return record[key]
}

function stringValuesFromInformation(info: Record<string, unknown>): string[] {
  const value = valueAt(info, 'Value')
  if (!isRecord(value)) return []
  return asRecordArray(value.StringWithMarkup)
    .map((entry) => typeof entry.String === 'string' ? entry.String.trim() : '')
    .filter(Boolean)
}

function markupUrlsFromInformation(info: Record<string, unknown>): string[] {
  const value = valueAt(info, 'Value')
  if (!isRecord(value)) return []
  return asRecordArray(value.StringWithMarkup).flatMap((entry) => (
    asRecordArray(entry.Markup)
      .map((markup) => typeof markup.URL === 'string' ? markup.URL.trim() : '')
      .filter(Boolean)
  ))
}

function walkSections(root: unknown, visitor: (section: Record<string, unknown>) => void): void {
  if (!isRecord(root)) return
  visitor(root)
  for (const section of asRecordArray(root.Section)) walkSections(section, visitor)
}

function parsePrimaryCasNumbers(record: unknown): string[] {
  const result: string[] = []
  const walk = (node: unknown, insideOtherIdentifiers: boolean): void => {
    if (!isRecord(node)) return
    const heading = typeof node.TOCHeading === 'string' ? node.TOCHeading : ''
    const inside = insideOtherIdentifiers || heading === 'Other Identifiers'
    if (inside && heading === 'CAS') {
      for (const info of asRecordArray(node.Information)) {
        for (const value of stringValuesFromInformation(info)) {
          const cas = normalizeCasNumber(value)
          if (cas) result.push(cas)
        }
      }
    }
    for (const child of asRecordArray(node.Section)) walk(child, inside)
  }
  walk(record, false)
  return unique(result)
}

function extractHCodes(text: string): string[] {
  return unique(Array.from(text.toUpperCase().matchAll(/\bH\d{3}[A-Z]*\b/g), (match) => match[0]))
}

function parseGhsRecord(record: unknown): Omit<CandidateRecord, 'cid' | 'property' | 'casNumbers' | 'sourceUnavailable'> {
  const hCodes: string[] = []
  const hazardStatements: string[] = []
  const pictograms: string[] = []
  let signalWord: string | undefined
  let explicitlyNotClassified = false
  let hazardSourceFound = false

  walkSections(record, (section) => {
    if (section.TOCHeading !== 'GHS Classification') return
    hazardSourceFound = true

    for (const info of asRecordArray(section.Information)) {
      const name = typeof info.Name === 'string' ? info.Name : ''
      const values = stringValuesFromInformation(info)
      const combined = values.join(' ')

      if (name === 'GHS Hazard Statements') {
        hazardStatements.push(...values)
        hCodes.push(...extractHCodes(combined))
      } else if (name === 'Signal' && values[0]) {
        signalWord = values[0]
      } else if (name === 'Pictogram(s)') {
        pictograms.push(...markupUrlsFromInformation(info))
      }

      if (NOT_CLASSIFIED_PATTERNS.some((pattern) => pattern.test(`${name} ${combined}`))) {
        explicitlyNotClassified = true
      }
    }
  })

  return {
    hCodes: unique(hCodes),
    hazardStatements: unique(hazardStatements),
    pictograms: unique(pictograms),
    ...(signalWord ? { signalWord } : {}),
    explicitlyNotClassified,
    hazardSourceFound,
  }
}

function hazardFlagsFromHCodes(hCodes: readonly string[]): WasteHazardFlag[] {
  const flags: WasteHazardFlag[] = []
  for (const hCode of hCodes) {
    for (const [pattern, flag] of HAZARD_CODE_FLAGS) {
      if (pattern.test(hCode) && !flags.includes(flag)) flags.push(flag)
    }
  }
  return flags
}

async function waitBeforeRetry(attempt: number): Promise<void> {
  const jitter = Math.floor(Math.random() * 180)
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 300 * (2 ** attempt) + jitter))
}

async function fetchJson<T>(url: string, fetchImpl: FetchLike): Promise<FetchOutcome<T>> {
  let lastError = 'Upstream request failed'
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = globalThis.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
      if (response.status === 404) return { kind: 'not_found' }
      if (!response.ok) {
        lastError = `Upstream HTTP ${response.status}`
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500
        if (!retryable || attempt === MAX_FETCH_ATTEMPTS - 1) {
          return { kind: 'transient_error', error: lastError }
        }
      } else {
        try {
          return { kind: 'ok', data: await response.json() as T }
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Invalid upstream JSON'
          if (attempt === MAX_FETCH_ATTEMPTS - 1) return { kind: 'transient_error', error: lastError }
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Upstream network error'
      if (attempt === MAX_FETCH_ATTEMPTS - 1) return { kind: 'transient_error', error: lastError }
    } finally {
      globalThis.clearTimeout(timeoutId)
    }
    await waitBeforeRetry(attempt)
  }
  return { kind: 'transient_error', error: lastError }
}

function propertyLookupPath(item: ChemicalEnrichmentRequestItem): { path: string; method: ChemicalEnrichmentResult['identity']['evidence'][number]['method'] } | null {
  if (item.pubchemCid) return { path: `cid/${item.pubchemCid}`, method: 'primary_cid' }
  if (item.standardInchiKey) return { path: `inchikey/${encodeURIComponent(item.standardInchiKey)}`, method: 'equivalent_inchikey' }
  if (item.casNumber) return { path: `name/${encodeURIComponent(item.casNumber)}`, method: 'exact_cas' }
  if (item.name) return { path: `name/${encodeURIComponent(item.name)}`, method: 'exact_name' }
  return null
}

async function fetchPropertiesByPath(path: string, fetchImpl: FetchLike): Promise<FetchOutcome<PubChemProperty[]>> {
  const properties = 'MolecularFormula,MolecularWeight,Title,IUPACName,ConnectivitySMILES,InChIKey'
  const outcome = await fetchJson<{ PropertyTable?: { Properties?: PubChemProperty[] } }>(
    `${PUG_REST_BASE}/compound/${path}/property/${properties}/JSON`,
    fetchImpl,
  )
  if (outcome.kind !== 'ok') return outcome
  const records = outcome.data.PropertyTable?.Properties
  return Array.isArray(records) && records.length > 0 ? { kind: 'ok', data: records } : { kind: 'not_found' }
}

async function fetchEquivalentCids(inchiKey: string, primaryCid: number, fetchImpl: FetchLike): Promise<FetchOutcome<number[]>> {
  const outcome = await fetchJson<{ IdentifierList?: { CID?: number[] } }>(
    `${PUG_REST_BASE}/compound/inchikey/${encodeURIComponent(inchiKey)}/cids/JSON`,
    fetchImpl,
  )
  if (outcome.kind === 'not_found') return { kind: 'ok', data: [primaryCid] }
  if (outcome.kind !== 'ok') return outcome
  const cids = Array.isArray(outcome.data.IdentifierList?.CID)
    ? outcome.data.IdentifierList.CID.filter((cid): cid is number => Number.isInteger(cid) && cid > 0)
    : []
  return { kind: 'ok', data: unique([primaryCid, ...cids]).slice(0, MAX_EQUIVALENT_CIDS) }
}

async function fetchCandidateRecord(
  cid: number,
  expectedInchiKey: string,
  fetchImpl: FetchLike,
): Promise<CandidateRecord | null> {
  const propertyOutcome = await fetchPropertiesByPath(`cid/${cid}`, fetchImpl)
  if (propertyOutcome.kind !== 'ok') return propertyOutcome.kind === 'transient_error'
    ? {
        cid,
        property: {},
        casNumbers: [],
        hCodes: [],
        hazardStatements: [],
        pictograms: [],
        explicitlyNotClassified: false,
        hazardSourceFound: false,
        sourceUnavailable: true,
      }
    : null
  const property = propertyOutcome.data[0]
  if (!property || property.InChIKey?.toUpperCase() !== expectedInchiKey.toUpperCase()) return null

  const headingOutcome = await fetchJson<{ Record?: unknown }>(
    `${PUG_VIEW_BASE}/data/compound/${cid}/JSON?heading=GHS+Classification`,
    fetchImpl,
  )
  const fullOutcome = await fetchJson<{ Record?: unknown }>(`${PUG_VIEW_BASE}/data/compound/${cid}/JSON`, fetchImpl)
  const fullRecord = fullOutcome.kind === 'ok' ? fullOutcome.data.Record : undefined
  const headingRecord = headingOutcome.kind === 'ok' ? headingOutcome.data.Record : undefined
  const parsed = parseGhsRecord(headingRecord ?? fullRecord)

  return {
    cid,
    property,
    casNumbers: parsePrimaryCasNumbers(fullRecord),
    ...parsed,
    sourceUnavailable: headingOutcome.kind === 'transient_error' && fullOutcome.kind === 'transient_error',
  }
}

async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()))
  return results
}

interface KoshaHazardResult {
  kind: 'classified' | 'not_classified' | 'source_absent' | 'transient_error'
  chemId?: string
  localizedName?: string
  hCodes: string[]
  hazardStatements: string[]
  pictograms: string[]
  signalWord?: string
}

async function fetchKoshaHazard(identity: KoshaIdentity, env: ChemicalEnrichmentEnv, fetchImpl: FetchLike): Promise<KoshaHazardResult> {
  const section = await fetchKoshaText('chemdetail02', new URLSearchParams({ chemId: identity.chemId }), env, fetchImpl)
  if (section.kind === 'transient_error') return { kind: 'transient_error', chemId: identity.chemId, hCodes: [], hazardStatements: [], pictograms: [] }
  if (section.kind === 'not_found') return { kind: 'source_absent', chemId: identity.chemId, hCodes: [], hazardStatements: [], pictograms: [] }

  const sectionItems = parseKoshaItems(section.data)
  const texts = sectionItems.flatMap((item) => [String(item.msdsItemNameKor ?? ''), String(item.itemDetail ?? '')]).filter(Boolean)
  const allText = texts.join('\n')
  const hCodes = extractHCodes(allText)
  const hazardStatements = unique(texts.filter((text) => extractHCodes(text).length > 0))
  const signalWord = /\bDanger\b|\b위험\b/i.test(allText)
    ? 'Danger'
    : /\bWarning\b|\b경고\b/i.test(allText) ? 'Warning' : undefined
  const pictograms = unique(Array.from(allText.matchAll(/GHS0[1-9]/gi), (match) => match[0].toUpperCase()))
  const explicitlyNotClassified = NOT_CLASSIFIED_PATTERNS.some((pattern) => pattern.test(allText))

  return {
    kind: hCodes.length > 0 ? 'classified' : explicitlyNotClassified ? 'not_classified' : 'source_absent',
    chemId: identity.chemId,
    localizedName: identity.localizedName,
    hCodes,
    hazardStatements,
    pictograms,
    ...(signalWord ? { signalWord } : {}),
  }
}

function emptyResult(item: ChemicalEnrichmentRequestItem, status: 'not_found' | 'transient_error'): ChemicalEnrichmentResult {
  const fetchedAt = new Date().toISOString()
  const expiresAt = status === 'not_found' ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : undefined
  const phCatalog = resolvePhCatalogIdentity({
    standardInchiKey: item.standardInchiKey,
    casNumber: item.casNumber,
    pubchemCid: item.pubchemCid,
    molecularFormula: item.molecularFormula,
  })
  return {
    requestId: item.requestId,
    overallStatus: status === 'transient_error' ? 'retryable' : 'needs_review',
    identity: { status: status === 'not_found' ? 'not_found' : 'ambiguous', equivalentPubchemCids: [], evidence: [] },
    hazard: {
      status: status === 'transient_error' ? 'transient_error' : 'source_absent',
      hCodes: [], hazardStatements: [], pictograms: [], hazardFlags: [], sources: [], fetchedAt,
      ...(expiresAt ? { expiresAt } : {}),
    },
    referencePh: status === 'transient_error'
      ? { status: 'transient_error', retryAfterMs: 2_000 }
      : { status: 'source_absent' },
    phCatalog: {
      status: phCatalog.status,
      ...(phCatalog.id ? { id: phCatalog.id } : {}),
      candidateIds: phCatalog.candidateIds,
      ...(phCatalog.matchedBy ? { matchedBy: phCatalog.matchedBy } : {}),
      catalogVersion: DEFAULT_PH_CATALOG.version,
    },
    ...(status === 'transient_error' ? { retryAfterMs: 2_000 } : {}),
    enrichmentVersion: 2,
  }
}

function ambiguousKoshaIdentityResult(
  item: ChemicalEnrichmentRequestItem,
  candidates: readonly KoshaIdentity[],
): ChemicalEnrichmentResult {
  const result = emptyResult(item, 'not_found')
  return {
    ...result,
    overallStatus: 'needs_review',
    identity: {
      status: 'ambiguous',
      canonicalName: item.name,
      equivalentPubchemCids: [],
      evidence: candidates.map((candidate) => ({
        source: 'kosha' as const,
        sourceId: candidate.chemId,
        method: 'exact_name' as const,
      })),
    },
    hazard: {
      ...result.hazard,
      status: 'identity_ambiguous',
    },
    referencePh: { status: 'identity_ambiguous' },
  }
}

function containsKorean(value: string | undefined): boolean {
  return Boolean(value && /[\u3131-\u318e\uac00-\ud7a3]/.test(value))
}

export async function enrichChemicalItem(
  item: ChemicalEnrichmentRequestItem,
  env: ChemicalEnrichmentEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ChemicalEnrichmentResult> {
  let lookupItem = item
  let koshaIdentity: KoshaIdentity | undefined

  if (!item.casNumber && !item.pubchemCid && !item.standardInchiKey && containsKorean(item.name)) {
    const koshaName = await resolveKoshaIdentityByExactName(item.name!, env, fetchImpl)
    if (koshaName.kind === 'found') {
      koshaIdentity = koshaName.identity
      lookupItem = { ...item, casNumber: koshaName.identity.casNumber }
    } else if (koshaName.kind === 'ambiguous') {
      return ambiguousKoshaIdentityResult(item, koshaName.candidates)
    } else if (koshaName.kind === 'transient_error') {
      return emptyResult(item, 'transient_error')
    }
  }

  const lookup = propertyLookupPath(lookupItem)
  if (!lookup) return emptyResult(item, 'not_found')
  const propertyOutcome = await fetchPropertiesByPath(lookup.path, fetchImpl)
  if (propertyOutcome.kind === 'transient_error') return emptyResult(item, 'transient_error')
  if (propertyOutcome.kind === 'not_found') return emptyResult(item, 'not_found')

  const primary = propertyOutcome.data[0]
  const primaryCid = primary?.CID
  const standardInchiKey = primary?.InChIKey || lookupItem.standardInchiKey
  if (!primary || !primaryCid || !standardInchiKey) return emptyResult(item, 'not_found')

  const equivalentOutcome = await fetchEquivalentCids(standardInchiKey, primaryCid, fetchImpl)
  if (equivalentOutcome.kind === 'transient_error') return emptyResult(item, 'transient_error')
  const equivalentPubchemCids = equivalentOutcome.kind === 'ok' ? equivalentOutcome.data : [primaryCid]
  const candidates = (await mapWithConcurrency(
    equivalentPubchemCids,
    MAX_CANDIDATE_CONCURRENCY,
    (cid) => fetchCandidateRecord(cid, standardInchiKey, fetchImpl),
  )).filter((candidate): candidate is CandidateRecord => Boolean(candidate))

  const verifiedCandidates = candidates.filter((candidate) => candidate.property.InChIKey?.toUpperCase() === standardInchiKey.toUpperCase())
  const exactCasNumbers = unique(verifiedCandidates.flatMap((candidate) => candidate.casNumbers))
  const inputCas = normalizeCasNumber(lookupItem.casNumber)
  const casNumbers = inputCas && (exactCasNumbers.length === 0 || exactCasNumbers.includes(inputCas))
    ? unique([inputCas, ...exactCasNumbers])
    : exactCasNumbers
  const identityAmbiguous = casNumbers.length > 1 || Boolean(inputCas && exactCasNumbers.length > 0 && !exactCasNumbers.includes(inputCas))
  const casNumber = casNumbers.length === 1 ? casNumbers[0] : undefined

  const hCodes = unique(verifiedCandidates.flatMap((candidate) => candidate.hCodes))
  const hazardStatements = unique(verifiedCandidates.flatMap((candidate) => candidate.hazardStatements))
  const pictograms = unique(verifiedCandidates.flatMap((candidate) => candidate.pictograms))
  const signalWord = verifiedCandidates.map((candidate) => candidate.signalWord).find(Boolean)
  const pubchemSources = verifiedCandidates
    .filter((candidate) => candidate.hCodes.length > 0 || candidate.explicitlyNotClassified)
    .map((candidate) => ({ source: 'pubchem' as const, sourceId: String(candidate.cid) }))
  const explicitlyNotClassified = verifiedCandidates.some((candidate) => candidate.explicitlyNotClassified)
  const allCandidatesUnavailable = candidates.length > 0 && candidates.every((candidate) => candidate.sourceUnavailable)

  let hazardStatus: ChemicalEnrichmentResult['hazard']['status']
  let finalHCodes = hCodes
  let finalHazardStatements = hazardStatements
  let finalPictograms = pictograms
  let finalSignalWord = signalWord
  let localizedName = koshaIdentity?.localizedName
  let hazardSources: ChemicalEnrichmentResult['hazard']['sources'] = pubchemSources

  if (identityAmbiguous) {
    hazardStatus = 'identity_ambiguous'
  } else if (hCodes.length > 0) {
    hazardStatus = 'classified'
  } else if (explicitlyNotClassified) {
    hazardStatus = 'not_classified'
  } else if (allCandidatesUnavailable) {
    hazardStatus = 'transient_error'
  } else if (casNumber) {
    const koshaLookup = koshaIdentity?.casNumber === casNumber
      ? { kind: 'found' as const, identity: koshaIdentity }
      : await resolveKoshaIdentityByCas(casNumber, env, fetchImpl)
    if (koshaLookup.kind === 'found') {
      koshaIdentity = koshaLookup.identity
      const kosha = await fetchKoshaHazard(koshaLookup.identity, env, fetchImpl)
      localizedName = kosha.localizedName || localizedName
      hazardStatus = kosha.kind
      finalHCodes = kosha.hCodes
      finalHazardStatements = kosha.hazardStatements
      finalPictograms = kosha.pictograms
      finalSignalWord = kosha.signalWord
      hazardSources = kosha.chemId ? [{ source: 'kosha', sourceId: kosha.chemId }] : []
    } else if (koshaLookup.kind === 'ambiguous') {
      hazardStatus = 'identity_ambiguous'
    } else if (koshaLookup.kind === 'transient_error') {
      hazardStatus = 'transient_error'
    } else {
      hazardStatus = 'source_absent'
    }
  } else {
    hazardStatus = 'source_absent'
  }

  const verifiedProperty = verifiedCandidates.find((candidate) => candidate.cid === primaryCid)?.property
    || verifiedCandidates[0]?.property
    || primary
  const phMatch = resolvePhCatalogIdentity({
    standardInchiKey,
    casNumber,
    pubchemCid: primaryCid,
    equivalentPubchemCids,
    molecularFormula: verifiedProperty.MolecularFormula || item.molecularFormula,
  })
  const fetchedAt = new Date().toISOString()
  const expiresAt = hazardStatus === 'transient_error'
    ? undefined
    : new Date(Date.now() + (
        hazardStatus === 'classified' || hazardStatus === 'not_classified'
          ? 7 * 24 * 60 * 60 * 1000
          : 60 * 60 * 1000
      )).toISOString()
  const identityStatus = identityAmbiguous ? 'ambiguous' : 'verified'

  return {
    requestId: item.requestId,
    overallStatus: hazardStatus === 'transient_error'
      ? 'retryable'
      : identityStatus === 'verified' && (hazardStatus === 'classified' || hazardStatus === 'not_classified')
        ? 'complete'
        : 'needs_review',
    identity: {
      status: identityStatus,
      canonicalName: verifiedProperty.Title || verifiedProperty.IUPACName || item.name,
      ...(localizedName ? { localizedName } : {}),
      ...(casNumber ? { casNumber } : {}),
      ...(koshaIdentity ? { koshaChemId: Number(koshaIdentity.chemId) } : {}),
      pubchemCid: primaryCid,
      equivalentPubchemCids,
      standardInchiKey,
      molecularFormula: verifiedProperty.MolecularFormula || item.molecularFormula,
      molecularWeight: Number(verifiedProperty.MolecularWeight || item.molecularWeight) || undefined,
      connectivitySmiles: verifiedProperty.ConnectivitySMILES,
      evidence: [
        { source: 'pubchem', sourceId: String(primaryCid), method: lookup.method },
        ...equivalentPubchemCids
          .filter((cid) => cid !== primaryCid)
          .map((cid) => ({ source: 'pubchem' as const, sourceId: String(cid), method: 'equivalent_inchikey' as const })),
        ...(koshaIdentity ? [{
          source: 'kosha' as const,
          sourceId: koshaIdentity.chemId,
          method: 'exact_cas' as const,
        }] : []),
      ],
    },
    referencePh: identityAmbiguous
      ? { status: 'identity_ambiguous' }
      : casNumber
        ? {
            status: 'pending',
            source: 'kosha',
            ...(koshaIdentity ? { sourceId: koshaIdentity.chemId } : {}),
            retryAfterMs: 2_000,
          }
        : { status: 'source_absent' },
    hazard: {
      status: hazardStatus,
      hCodes: finalHCodes,
      hazardStatements: finalHazardStatements,
      pictograms: finalPictograms,
      ...(finalSignalWord ? { signalWord: finalSignalWord } : {}),
      hazardFlags: hazardFlagsFromHCodes(finalHCodes),
      sources: hazardSources,
      fetchedAt,
      ...(expiresAt ? { expiresAt } : {}),
    },
    phCatalog: {
      status: phMatch.status,
      ...(phMatch.id ? { id: phMatch.id } : {}),
      candidateIds: phMatch.candidateIds,
      ...(phMatch.matchedBy ? { matchedBy: phMatch.matchedBy } : {}),
      catalogVersion: phMatch.catalogVersion,
    },
    ...(hazardStatus === 'transient_error' ? { retryAfterMs: 2_000 } : {}),
    enrichmentVersion: 2,
  }
}
