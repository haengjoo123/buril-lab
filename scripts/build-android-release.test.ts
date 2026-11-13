import { describe, expect, it } from 'vitest'
// @ts-expect-error release tooling is JavaScript
import { productionEnvironment, validateWebChanges } from './build-android-release.mjs'

const release = { commit_sha: 'a'.repeat(40), environment: 'production', project: 'buril-lab' }
const profile = { commit: release.commit_sha, environment: 'production',
  supabase_url: 'https://zafxzidbtbryiksemlwc.supabase.co', features: {
    VITE_ENABLE_WASTE_V2: 'true', VITE_ENABLE_PH_PREDICTION: 'true',
    VITE_ENABLE_CHEMICAL_ENRICHMENT: 'true', VITE_ENABLE_SEARCH_ANALYTICS: 'false',
    VITE_ENABLE_LAB_TOOLS: 'false', VITE_ENABLE_WASTE_CONTAINERS: 'true',
  } }
const bundle = `${profile.supabase_url} sb_publishable_test_public_key`

describe('Android production configuration', () => {
  it('requires an explicit choice for changed web inputs and records that parity no longer holds', () => {
    const files = ['src/features/fridge/FridgeScene.tsx']
    expect(() => validateWebChanges(files, [], false)).toThrow()
    expect(validateWebChanges(files, [], true)).toEqual({ web_inputs_match_production: false, web_changed_files: files })
    expect(validateWebChanges([], [], false).web_inputs_match_production).toBe(true)
    expect(() => validateWebChanges([], ['public/unreviewed.js'], true)).toThrow()
  })
  it('copies the deployed flags and keeps the import feature off for profiles that predate it', () => {
    expect(productionEnvironment(release, profile, bundle)).toMatchObject({
      ...profile.features, VITE_ENABLE_INVENTORY_IMPORT_V2: 'false', VITE_ENABLE_CONTAINER_CONTENT_CHECK: 'false', VITE_ENABLE_CONTAINER_PICKUP_REQUESTS: 'false', VITE_ENABLE_DAILY_INSPECTION: 'false', VITE_ENABLE_QR_LABELS: 'false', VITE_ENABLE_SDS_ATTACHMENTS: 'false', VITE_ENABLE_DEVICE_REMINDERS: 'false', VITE_ENABLE_HAZARD_REGISTER_EXPORT: 'false', VITE_ENABLE_PURCHASE_REQUESTS: 'false',
      VITE_INTERNAL_API_BASE_URL: 'https://burillab.com',
    })
  })
  it('follows the deployed import flag once production records it', () => {
    const deployed = { ...profile, features: { ...profile.features, VITE_ENABLE_INVENTORY_IMPORT_V2: 'true' } }
    expect(productionEnvironment(release, deployed, bundle).VITE_ENABLE_INVENTORY_IMPORT_V2).toBe('true')
  })
  it('rejects mixed releases and staging configuration', () => {
    expect(() => productionEnvironment(release, { ...profile, commit: 'b'.repeat(40) }, bundle)).toThrow()
    expect(() => productionEnvironment(release, { ...profile, environment: 'staging' }, bundle)).toThrow()
  })
  it('rejects missing feature settings instead of using local defaults', () => {
    expect(() => productionEnvironment(release, { ...profile, features: {} }, bundle)).toThrow()
  })
  it('rejects missing or ambiguous public keys', () => {
    expect(() => productionEnvironment(release, profile, profile.supabase_url)).toThrow()
    expect(() => productionEnvironment(release, profile, `${bundle} sb_publishable_another_key`)).toThrow()
  })
})
