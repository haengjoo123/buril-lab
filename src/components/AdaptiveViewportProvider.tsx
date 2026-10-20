import { useEffect, useState, type ReactNode } from 'react';
import { AdaptiveViewportContext, type AdaptiveViewport } from '../hooks/useAdaptiveLayout';
import { intersectRegion, largestRegion, normalizeRegions, type ViewportRegion } from '../utils/adaptiveLayout';

type SegmentWindow = Window & { viewport?: Partial<Pick<EventTarget, 'addEventListener' | 'removeEventListener'>> & { segments?: readonly ViewportRegion[] } };

function readViewport(previous?: AdaptiveViewport): AdaptiveViewport {
  const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const visual = window.visualViewport;
  // Keyboard resizing should change available height. Pinch zoom must not change layout mode.
  const visibleViewport = visual && visual.scale === 1
    ? { x: visual.offsetLeft, y: visual.offsetTop, width: visual.width, height: visual.height } : viewport;
  const segments = normalizeRegions((window as SegmentWindow).viewport?.segments ?? [viewport], viewport);
  if (!segments.length) segments.push(viewport);
  const previousCenter = previous && { x: previous.activeRegion.x + previous.activeRegion.width / 2,
    y: previous.activeRegion.y + previous.activeRegion.height / 2 };
  const visibleSegments = segments.filter(r => intersectRegion(r, visibleViewport).height > 0);
  const candidates = visibleSegments.length ? visibleSegments : segments;
  const activeRegion = (previousCenter && candidates.find(r => previousCenter.x >= r.x && previousCenter.x < r.x + r.width
    && previousCenter.y >= r.y && previousCenter.y < r.y + r.height)) || largestRegion(candidates);
  return { viewport, visibleViewport, segments, activeRegion };
}

export function AdaptiveViewportProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState(() => readViewport());
  useEffect(() => {
    let frame = 0;
    const refresh = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setValue(previous => readViewport(previous))); };
    const activate = (event: Event) => {
      // Keep an open dialog on its original segment while interacting with it.
      const target = event.target;
      if (!(target instanceof Element) || target.closest('[role="dialog"]')) return;
      const rect = target.getBoundingClientRect();
      const x = event instanceof PointerEvent ? event.clientX : rect.x + rect.width / 2;
      const y = event instanceof PointerEvent ? event.clientY : rect.y + rect.height / 2;
      setValue(previous => {
        const region = previous.segments.find(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
        return region && region !== previous.activeRegion ? { ...previous, activeRegion: region } : previous;
      });
    };
    const segmentViewport = (window as SegmentWindow).viewport;
    const queries = [matchMedia('(horizontal-viewport-segments: 2)'), matchMedia('(vertical-viewport-segments: 2)')];
    window.addEventListener('resize', refresh);
    window.visualViewport?.addEventListener('resize', refresh);
    window.visualViewport?.addEventListener('scroll', refresh);
    segmentViewport?.addEventListener?.('segmentschange', refresh);
    queries.forEach(q => q.addEventListener('change', refresh));
    document.addEventListener('pointerdown', activate, true);
    document.addEventListener('focusin', activate, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', refresh);
      window.visualViewport?.removeEventListener('resize', refresh);
      window.visualViewport?.removeEventListener('scroll', refresh);
      segmentViewport?.removeEventListener?.('segmentschange', refresh);
      queries.forEach(q => q.removeEventListener('change', refresh));
      document.removeEventListener('pointerdown', activate, true);
      document.removeEventListener('focusin', activate, true);
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const region = value.activeRegion;
    const visual = window.visualViewport;
    const top = Math.max(region.y, visual?.offsetTop ?? 0);
    const bottom = Math.min(region.y + region.height, (visual?.offsetTop ?? 0) + (visual?.height ?? value.viewport.height));
    root.style.setProperty('--overlay-left', `${region.x}px`);
    root.style.setProperty('--overlay-top', `${top}px`);
    root.style.setProperty('--overlay-width', `${region.width}px`);
    root.style.setProperty('--overlay-height', `${Math.max(0, bottom - top)}px`);
    root.dataset.segmented = String(value.segments.length > 1);
    return () => { delete root.dataset.segmented; ['left', 'top', 'width', 'height'].forEach(key => root.style.removeProperty(`--overlay-${key}`)); };
  }, [value]);
  return <AdaptiveViewportContext.Provider value={value}>{children}</AdaptiveViewportContext.Provider>;
}
