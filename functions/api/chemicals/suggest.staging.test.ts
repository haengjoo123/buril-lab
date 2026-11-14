import { describe, expect, it } from 'vitest'
import { onRequestGet } from './suggest'

// Runs only against Buril-Lab-Staging with an explicit opt-in and staging credentials:
//   RUN_STAGING_ALIAS_SMOKE=true STAGING_SUPABASE_URL=... STAGING_SUPABASE_SERVICE_ROLE_KEY=... npx vitest run functions/api/chemicals/suggest.staging.test.ts
const STAGING_REF = 'qpgnomuqdcucjmxrunnw'
const stagingUrl = process.env.STAGING_SUPABASE_URL || ''
const stagingKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || ''
const enabled = process.env.RUN_STAGING_ALIAS_SMOKE === 'true' && stagingUrl.includes(STAGING_REF) && Boolean(stagingKey)
const stagingDescribe = enabled ? describe : describe.skip

interface SuggestPayload {
  suggestions: string[]
  formChoices?: { name: string; nameEn?: string }[]
}

async function suggest(q: string): Promise<SuggestPayload> {
  const response = await onRequestGet({
    request: new Request(`https://example.test/api/chemicals/suggest?q=${encodeURIComponent(q)}&limit=5`),
    env: { SUPABASE_URL: stagingUrl, SUPABASE_SERVICE_ROLE_KEY: stagingKey } as never,
  })
  expect(response.status).toBe(200)
  return response.json() as Promise<SuggestPayload>
}

stagingDescribe('staging AI alias search smoke', () => {
  it.each([
    ['DCM', '디클로로메탄'],
    ['염화메틸렌', '디클로로메탄'],
    ['HCl', '염산 (37% 수용액)'],
  ])('%s leads to the standard reagent name', async (query, canonical) => {
    const payload = await suggest(query)
    expect(payload.suggestions).toContain(canonical)
    expect(payload.formChoices).toBeUndefined()
  })

  it('TEA is never linked to one reagent and asks for the form instead', async () => {
    const payload = await suggest('TEA')
    expect(payload.suggestions).not.toContain('트리에틸알루미늄')
    const names = (payload.formChoices || []).map((choice) => choice.name)
    expect(names).toEqual(expect.arrayContaining(['트라이에틸아민', '트라이에탄올아민', '트리에틸알루미늄']))
  })

  it.each(['포도당', 'CaCl2', 'EDTA', '구연산'])('%s offers form choices', async (query) => {
    const payload = await suggest(query)
    expect((payload.formChoices || []).length).toBeGreaterThanOrEqual(2)
  })
})
