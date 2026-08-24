import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { requireKoshaBulkCollectionPermission } from './kosha-bulk-collection-guard.mjs'

const guardedScripts = [
  'generate-waste-golden-v2.mjs',
  'rebalance-waste-golden-v2.mjs',
  'refresh-waste-golden-v2-evidence.mjs',
]

describe('KOSHA bulk collection freeze', () => {
  it('fails closed unless the exact written-permission acknowledgement is present', () => {
    expect(() => requireKoshaBulkCollectionPermission({})).toThrow('KOSHA bulk collection is frozen')
    expect(() => requireKoshaBulkCollectionPermission({
      KOSHA_BULK_COLLECTION_ACK: 'i_have_written_permission',
    })).toThrow('KOSHA bulk collection is frozen')
    expect(() => requireKoshaBulkCollectionPermission({
      KOSHA_BULK_COLLECTION_ACK: 'I_HAVE_WRITTEN_PERMISSION',
    })).not.toThrow()
  })

  it.each(guardedScripts)('%s invokes the shared guard before maintenance work', (fileName) => {
    const source = readFileSync(resolve('scripts', fileName), 'utf8')
    expect(source).toContain("from './kosha-bulk-collection-guard.mjs'")
    expect(source).toMatch(/requireKoshaBulkCollectionPermission\(\)/)
  })
})
