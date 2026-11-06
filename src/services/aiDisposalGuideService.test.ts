import { describe, expect, it } from 'vitest'
import {
    generateDisposalGuideClientCacheKey,
    hashDisposalGuideCacheKey,
    type DisposalGuideChemicalInput,
} from './aiDisposalGuideService'

const chemicals: DisposalGuideChemicalInput[] = [
    { name: 'Acetone', category: 'ORGANIC_NON_HALOGEN', hazardFlags: ['FLAMMABLE'] },
    { name: 'Water', category: 'NEUTRAL' },
]

describe('AI disposal guide service cache context', () => {
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

describe('AI disposal guide analytics identifier', () => {
    it('stores a stable SHA-256 hex digest instead of the request itself', async () => {
        const key = generateDisposalGuideClientCacheKey(chemicals, {
            policy: { version: 'policy-1', handlerContact: '02-000-0000' } as never,
        })
        const hash = await hashDisposalGuideCacheKey(key)

        expect(hash).toMatch(/^[0-9a-f]{64}$/)
        expect(await hashDisposalGuideCacheKey(key)).toBe(hash)
        expect(hash).not.toContain('02-000-0000')
        expect(await hashDisposalGuideCacheKey(`${key} `)).not.toBe(hash)
    })
})
