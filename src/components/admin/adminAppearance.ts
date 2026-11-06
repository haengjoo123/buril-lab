/**
 * Admin surfaces render in two shells: the lab app (/app, follows the light/dark theme) and the
 * operator console (/ops, light only). Tailwind's dark variant applies to any element under `.dark`,
 * so console-only components must not carry `dark:` classes at all.
 */
export type AdminAppearance = 'adaptive' | 'light'

export type AdminTone = 'neutral' | 'good' | 'attention' | 'danger'

/** Picks the adaptive (with dark: variants) or light-only class string. */
export function byAppearance(appearance: AdminAppearance, adaptive: string, light: string): string {
  return appearance === 'light' ? light : adaptive
}
