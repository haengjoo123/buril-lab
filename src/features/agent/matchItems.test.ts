import { describe, expect, it } from 'vitest'
import type { InventoryItem } from '../../services/inventoryService'
import { AGENT_ITEM_MATCH_LIMIT, matchInventoryItems } from './matchItems'

let nextId = 0
function item(overrides: Partial<InventoryItem>): InventoryItem {
  nextId += 1
  return {
    id: `item-${nextId}`,
    lab_id: 'lab',
    user_id: 'user',
    name: 'Reagent',
    brand: null,
    product_number: null,
    cas_number: null,
    quantity: 1,
    capacity: null,
    storage_type: 'other',
    cabinet_id: null,
    storage_location_id: null,
    product_id: null,
    expiry_date: null,
    manufacturer_date_type: 'unlabeled',
    received_date: null,
    opened_date: null,
    memo: null,
    remaining_percent: null,
    created_at: `2026-01-${String(nextId).padStart(2, '0')}T00:00:00Z`,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const ref = (text: string, aliases: string[] = [], casNumber: string | null = null) => ({ text, aliases, casNumber })
const names = (result: ReturnType<typeof matchInventoryItems>) => result.matches.map((match) => match.item.name)

describe('inventory matching for agent answers', () => {
  it('returns every bottle of the named reagent instead of picking one', () => {
    const items = [
      item({ name: 'Acetone', cabinet_id: 'a' }),
      item({ name: 'Acetone', cabinet_id: 'b' }),
      item({ name: 'Acetonitrile' }),
    ]
    const result = matchInventoryItems(items, ref('acetone'))
    expect(names(result)).toEqual(['Acetone', 'Acetone'])
    expect(result.totalInTier).toBe(2)
    expect(result.aliasOnly).toBe(false)
  })

  it('ignores case, spacing and hyphens', () => {
    const items = [item({ name: 'Sodium  Chloride' }), item({ name: 'tert-Butanol' })]
    expect(names(matchInventoryItems(items, ref('sodium chloride')))).toEqual(['Sodium  Chloride'])
    expect(names(matchInventoryItems(items, ref('tert butanol')))).toEqual(['tert-Butanol'])
  })

  it('treats either half of a bilingual name as the whole name', () => {
    const items = [item({ name: '아세톤 (Acetone)' }), item({ name: 'Acetone-d6' })]
    const result = matchInventoryItems(items, ref('acetone'))
    expect(result.matches[0]).toMatchObject({ reason: 'name_exact' })
    expect(names(result)).toEqual(['아세톤 (Acetone)'])
  })

  it('ranks a typed CAS number first and keeps a same-named bottle that has no CAS recorded', () => {
    const items = [
      item({ name: 'Acetone (old label)', cas_number: null }),
      item({ name: 'Propan-2-one', cas_number: '67-64-1' }),
      item({ name: 'Acetonitrile', cas_number: '75-05-8' }),
    ]
    const result = matchInventoryItems(items, ref('acetone', [], '67-64-1'))
    expect(result.matches.map((match) => match.reason)).toEqual(['cas', 'name_exact'])
    expect(names(result)).toEqual(['Propan-2-one', 'Acetone (old label)'])
  })

  it('ignores a CAS number that fails its checksum', () => {
    const items = [item({ name: 'Propan-2-one', cas_number: '67-64-1' })]
    expect(matchInventoryItems(items, ref('nothing', [], '67-64-2')).matches).toEqual([])
  })

  it('matches a product number exactly', () => {
    const items = [item({ name: 'Buffer', product_number: 'A1234-500ML' }), item({ name: 'Other' })]
    expect(matchInventoryItems(items, ref('a1234-500ml')).matches[0]).toMatchObject({ reason: 'product_exact' })
  })

  it('falls back to partial matches only when nothing matches exactly', () => {
    const items = [item({ name: 'Ethanol' }), item({ name: 'Ethanol absolute' }), item({ name: '2-Mercaptoethanol' })]
    expect(names(matchInventoryItems(items, ref('ethanol')))).toEqual(['Ethanol'])

    const partial = matchInventoryItems([items[1], items[2]], ref('ethanol'))
    expect(names(partial)).toEqual(['Ethanol absolute', '2-Mercaptoethanol'])
    expect(partial.matches.map((match) => match.reason)).toEqual(['prefix', 'contains'])
  })

  it('uses a suggested alias only when the typed name finds nothing, and says so', () => {
    const items = [item({ name: 'Acetone' }), item({ name: '아세톤 시약' })]
    const typed = matchInventoryItems(items, ref('아세톤', ['acetone']))
    expect(typed.aliasOnly).toBe(false)
    expect(typed.matches[0].item.name).toBe('Acetone')

    const aliasOnly = matchInventoryItems([items[0]], ref('아세톤', ['acetone']))
    expect(names(aliasOnly)).toEqual(['Acetone'])
    expect(aliasOnly.aliasOnly).toBe(true)
  })

  it('does not match on a one-letter fragment', () => {
    expect(matchInventoryItems([item({ name: 'Acetone' })], ref('a')).matches).toEqual([])
  })

  it('reports how many matches were left out of a long tier', () => {
    const items = Array.from({ length: AGENT_ITEM_MATCH_LIMIT + 3 }, () => item({ name: 'Ethanol' }))
    const result = matchInventoryItems(items, ref('ethanol'))
    expect(result.matches).toHaveLength(AGENT_ITEM_MATCH_LIMIT)
    expect(result.totalInTier).toBe(AGENT_ITEM_MATCH_LIMIT + 3)
  })

  it('returns nothing for an empty inventory or an unknown name', () => {
    expect(matchInventoryItems([], ref('acetone'))).toEqual({ matches: [], totalInTier: 0, aliasOnly: false })
    expect(matchInventoryItems([item({ name: 'Methanol' })], ref('acetone')).matches).toEqual([])
  })
})
