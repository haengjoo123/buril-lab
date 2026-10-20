import { describe, expect, it } from 'vitest';
import { largestRegion, navigationMode, normalizeRegions, resolvePaneGeometry } from './adaptiveLayout';

describe('adaptive workspace geometry', () => {
  it.each([[599, 'bottom'], [600, 'rail'], [1199, 'rail'], [1200, 'sidebar']] as const)('navigation at %i CSS pixels', (width, expected) => {
    expect(navigationMode(width)).toBe(expected);
  });
  it('uses the content area, not the device width, for the two-pane boundary', () => {
    for (const width of [320, 430, 687, 688, 840]) {
      const bounds = { x: 72, y: 64, width, height: 600 };
      expect(resolvePaneGeometry(bounds, [{ x: 0, y: 0, width: width + 72, height: 800 }]).twoPane).toBe(width >= 688);
    }
  });
  it('subtracts navigation and reserves the hinge gap, including unequal regions', () => {
    const segments = [{ x: 0, y: 0, width: 420, height: 900 }, { x: 450, y: 0, width: 500, height: 900 }];
    expect(resolvePaneGeometry({ x: 72, y: 64, width: 878, height: 836 }, segments)).toMatchObject({
      twoPane: true, columns: '348px 30px 500px',
    });
    expect(resolvePaneGeometry({ x: 100, y: 64, width: 850, height: 836 }, segments).twoPane).toBe(false);
  });
  it('does not span stacked or insufficient segments', () => {
    const bounds = { x: 0, y: 0, width: 840, height: 900 };
    expect(resolvePaneGeometry(bounds, [{ ...bounds, height: 430 }, { ...bounds, y: 470, height: 430 }]).twoPane).toBe(false);
    expect(resolvePaneGeometry(bounds, [{ ...bounds, width: 300 }, { ...bounds, x: 340, width: 500 }]).twoPane).toBe(false);
  });
  it('clips invalid/outside geometry and chooses the first largest segment on a tie', () => {
    const bounds = { x: 0, y: 0, width: 840, height: 900 };
    const regions = normalizeRegions([{ ...bounds, width: NaN }, { ...bounds, x: -10, width: 410 },
      { ...bounds, x: 440, width: 500 }, { ...bounds, x: 900 }], bounds);
    expect(regions.map(r => r.width)).toEqual([400, 400]);
    expect(largestRegion(regions)).toEqual(regions[0]);
  });
});
