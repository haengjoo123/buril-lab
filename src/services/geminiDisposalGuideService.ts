import { postJson } from './internalApi'
import { analyticsService } from './analyticsService'
import type { SolutionContext } from '../types'

export type DisposalGuideDecisionStatus = 'ready' | 'needs_input' | 'blocked'
export type DisposalGuideHandlingAction = 'container_deposit' | 'isolated' | 'handover'
export type DisposalGuideAvailability = 'available' | 'unavailable'
export type DisposalGuideResponseSource = 'ai' | 'cache' | 'deterministic'

export interface DisposalGuideDestination {
    streamCode: string | null
    name: string
    location: string | null
    labelInstructions: string[]
    depositAllowed: boolean
}

export interface DisposalGuideEvidence {
    id: string
    sourceType: 'policy' | 'sds' | 'rule' | 'compatibility' | 'other'
    title: string
    reference: string | null
}

export interface DisposalGuideResult {
    schemaVersion: 3
    availability: DisposalGuideAvailability
    availabilityReason?: 'not_configured' | 'upstream_error'
    responseSource: DisposalGuideResponseSource
    decisionStatus: DisposalGuideDecisionStatus
    summary: string
    destination: DisposalGuideDestination
    steps: string[]
    prohibitions: string[]
    missingInputs: string[]
    evidence: DisposalGuideEvidence[]
    /** Compatibility text for UI surfaces that have not migrated to structured fields yet. */
    guide: string
}

export interface DisposalGuideEvidenceInput {
    id?: string
    sourceType?: DisposalGuideEvidence['sourceType']
    title?: string
    reference?: string
}

export interface DisposalGuideChemicalInput {
    name: string
    casNumber?: string
    molecularFormula?: string
    pubchemCid?: number
    koshaChemId?: number
    concentration?: {
        value: number
        unit: string
    }
    category?: string
    hazardFlags?: string[]
    ghs?: {
        signalWord?: string
        hCodes?: string[]
        hazardStatements?: string[]
        pictograms?: string[]
        dataStatus?: string
    }
    source?: string
    evidence?: DisposalGuideEvidenceInput[]
    solutionContext?: SolutionContext
}

export interface DisposalGuideBatchContext {
    batchId?: string
    matrix?: string
    amount?: {
        value?: number
        unit?: 'mL' | 'L' | 'mg' | 'g'
        approximate?: boolean
        unknown?: boolean
    }
    measuredPh?: number | null
    hazardFlags?: string[]
    compatibilityWarnings?: Array<string | {
        severity?: string
        code?: string
        message?: string
    }>
}

export interface DisposalGuideDecisionContext {
    decisionStatus?: DisposalGuideDecisionStatus
    status?: DisposalGuideDecisionStatus
    streamCode?: string | null
    allowedActions?: DisposalGuideHandlingAction[]
    blockingReasons?: string[]
    missingFields?: string[]
    policyVersion?: string
    ruleVersion?: string
}

export interface DisposalGuidePolicyStream {
    streamCode?: string
    name?: string
    containerLabel?: string
    location?: string
    labelInstructions?: string[]
    handlerContact?: string
    sopUrl?: string
    prohibitions?: string[]
    allowedHazardFlags?: string[]
    blockedHazardFlags?: string[]
    evidence?: DisposalGuideEvidenceInput[]
}

export interface DisposalGuidePolicyContext {
    version?: string
    stream?: DisposalGuidePolicyStream
    streams?: DisposalGuidePolicyStream[]
    evidence?: DisposalGuideEvidenceInput[]
}

export interface DisposalGuideRequestOptions {
    sourceScreen?: string
    triggerSource?: string
    metadata?: Record<string, unknown>
    batch?: DisposalGuideBatchContext
    decision?: DisposalGuideDecisionContext
    policy?: DisposalGuidePolicyContext
    ruleVersion?: string
}

function normalizeSolutionContext(context?: SolutionContext) {
    if (!context) return null

    return {
        physicalForm: context.physicalForm,
        solventClass: context.solventClass,
        solventName: context.solventName || '',
        solventPreset: context.solventPreset || '',
        isCustomSolvent: Boolean(context.isCustomSolvent),
        isSolventVerified: Boolean(context.isSolventVerified),
        solventResolution: context.solventResolution || '',
        solventCasNumber: context.solventCasNumber || '',
        solventMolecularFormula: context.solventMolecularFormula || '',
    }
}

function sortForStableStringify(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortForStableStringify)
    if (!value || typeof value !== 'object') return value

    return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
            result[key] = sortForStableStringify((value as Record<string, unknown>)[key])
            return result
        }, {})
}

export function generateDisposalGuideClientCacheKey(
    chemicals: DisposalGuideChemicalInput[],
    options: Pick<DisposalGuideRequestOptions, 'batch' | 'decision' | 'policy' | 'ruleVersion'> = {},
): string {
    const normalizedChemicals = chemicals.map((chemical) => ({
        ...chemical,
        hazardFlags: [...(chemical.hazardFlags || [])].sort(),
        solutionContext: normalizeSolutionContext(chemical.solutionContext),
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

    return JSON.stringify(sortForStableStringify({
        schemaVersion: 3,
        chemicals: normalizedChemicals,
        batch: options.batch || null,
        decision: options.decision || null,
        policy: options.policy || null,
        ruleVersion: options.ruleVersion || null,
    }))
}

export async function getAIDisposalGuide(
    chemicals: DisposalGuideChemicalInput[],
    options: DisposalGuideRequestOptions = {},
): Promise<DisposalGuideResult> {
    const cacheKey = generateDisposalGuideClientCacheKey(chemicals, options)

    console.log('[Gemini Disposal Guide] Requesting disposal guide...')
    const result = await postJson<DisposalGuideResult>('/api/gemini/disposal-guide', {
        chemicals,
        batch: options.batch,
        decision: options.decision,
        policy: options.policy,
        ruleVersion: options.ruleVersion,
    })

    void analyticsService.trackAIDisposalGuideView({
        chemicals,
        sourceScreen: options.sourceScreen || 'unknown',
        triggerSource: options.triggerSource || 'user_request',
        metadata: {
            ...options.metadata,
            cache_key: cacheKey,
            response_source: result.responseSource,
            availability: result.availability,
            availability_reason: result.availabilityReason,
            decision_status: result.decisionStatus,
            stream_code: result.destination.streamCode,
            policy_version: options.decision?.policyVersion || options.policy?.version,
            rule_version: options.decision?.ruleVersion || options.ruleVersion,
        },
    })

    return result
}
