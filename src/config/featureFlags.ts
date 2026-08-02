/**
 * Feature flags bundled into the web/PWA/native client.
 *
 * V2 is globally active. `VITE_ENABLE_WASTE_V2=false` remains an explicit
 * emergency rollback switch for a future deployment.
 */
export function isExplicitlyEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function isExplicitlyDisabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'false'
}

export const isWasteV2Enabled = !isExplicitlyDisabled(import.meta.env.VITE_ENABLE_WASTE_V2)
