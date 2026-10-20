export interface ViewportRegion { x: number; y: number; width: number; height: number }
export const MIN_PANE_WIDTH = 320;
export const TWO_PANE_WIDTH = 688;

export function navigationMode(width: number) {
  return width < 600 ? 'bottom' : width < 1200 ? 'rail' : 'sidebar';
}

export function intersectRegion(a: ViewportRegion, b: ViewportRegion): ViewportRegion {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

export function normalizeRegions(regions: readonly ViewportRegion[], viewport: ViewportRegion) {
  return regions.filter(r => [r.x, r.y, r.width, r.height].every(Number.isFinite))
    .map(r => intersectRegion(r, viewport)).filter(r => r.width > 0 && r.height > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function largestRegion(regions: readonly ViewportRegion[]) {
  return regions.reduce((best, region) => region.width * region.height > best.width * best.height ? region : best);
}

export function resolvePaneGeometry(bounds: ViewportRegion, segments: readonly ViewportRegion[]) {
  const regions = normalizeRegions(segments, bounds);
  if (regions.length <= 1) return { twoPane: segments.length <= 1 && bounds.width >= TWO_PANE_WIDTH, regions, columns: undefined };
  const [left, right] = regions;
  const sideBySide = regions.length === 2 && Math.abs(left.y - right.y) < 1 && left.x + left.width <= right.x;
  const twoPane = sideBySide && left.width >= MIN_PANE_WIDTH + 16 && right.width >= MIN_PANE_WIDTH + 16;
  return { twoPane, regions, columns: twoPane
    ? `${left.width}px ${Math.max(0, right.x - left.x - left.width)}px ${right.width}px` : undefined };
}

/** A synchronous, cancelable event also used by the native back dispatcher. */
export function requestAdaptiveBack() {
  return !window.dispatchEvent(new Event('buril:adaptive-back', { cancelable: true }));
}
