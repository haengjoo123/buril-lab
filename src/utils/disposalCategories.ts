import type { DisposalCategory } from '../types';

/** Every disposal category a waste log can carry, for telling a known one from free text. */
export const DISPOSAL_CATEGORY_VALUES: ReadonlySet<string> = new Set<DisposalCategory>([
  'ACID',
  'ALKALI',
  'NEUTRAL',
  'ORGANIC_HALOGEN',
  'ORGANIC_NON_HALOGEN',
  'HEAVY_METAL',
  'CYANIDE',
  'REACTIVE',
  'SOLID_WASTE',
  'SPECIAL_HAZARD',
  'UNKNOWN',
]);

export function isDisposalCategory(value: string): value is DisposalCategory {
  return DISPOSAL_CATEGORY_VALUES.has(value);
}
