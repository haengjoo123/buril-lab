import { describe, expect, it } from 'vitest'
import {
    generateDisposalGuideClientCacheKey,
    type DisposalGuideChemicalInput,
} from './geminiDisposalGuideService'

const chemicals: DisposalGuideChemicalInput[] = [
    { name: 'Acetone', category: 'ORGANIC_NON_HALOGEN', hazardFlags: ['FLAMMABLE'] },
    { name: 'Water', category: 'NEUTRAL' },
]

describe('gemini disposal guide service cache context', () => {
    it('is stable across component order', () => {
        const options = {
            batch: { matrix: 'organic_non_halogenated', amount: { value: 500, unit: 'mL' as const } },
            decision: {
                decisionStatus: 'ready' as const,
                streamCode: 'ORGANIC_NON_HALOGENATED',
                allowedActions: ['container_deposit' as const],
                policyVersion: 'policy-1',
            },
            ruleVersion: 'rules-1',
        }

        expect(generateDisposalGuideClientCacheKey(chemicals, options)).toBe(
            generateDisposalGuideClientCacheKey([...chemicals].reverse(), options),
        )
    })

    it('changes when safety-relevant decision context changes', () => {
        const ready = generateDisposalGuideClientCacheKey(chemicals, {
            decision: { decisionStatus: 'ready', streamCode: 'ORGANIC_NON_HALOGENATED' },
            ruleVersion: 'rules-1',
        })
        const blocked = generateDisposalGuideClientCacheKey(chemicals, {
            decision: { decisionStatus: 'blocked', streamCode: 'ORGANIC_NON_HALOGENATED' },
            ruleVersion: 'rules-1',
        })
        const newerRules = generateDisposalGuideClientCacheKey(chemicals, {
            decision: { decisionStatus: 'ready', streamCode: 'ORGANIC_NON_HALOGENATED' },
            ruleVersion: 'rules-2',
        })

        expect(blocked).not.toBe(ready)
        expect(newerRules).not.toBe(ready)
    })
})
