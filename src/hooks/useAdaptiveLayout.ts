import { createContext, useContext, useEffect, useState } from 'react';
import { navigationMode, resolvePaneGeometry, type ViewportRegion } from '../utils/adaptiveLayout';

export interface AdaptiveViewport {
  viewport: ViewportRegion;
  visibleViewport: ViewportRegion;
  segments: ViewportRegion[];
  activeRegion: ViewportRegion;
}
export const AdaptiveViewportContext = createContext<AdaptiveViewport>({
  viewport: { x: 0, y: 0, width: 0, height: 0 }, segments: [],
  visibleViewport: { x: 0, y: 0, width: 0, height: 0 },
  activeRegion: { x: 0, y: 0, width: 0, height: 0 },
});
export const AdaptiveContentContext = createContext<ViewportRegion | null>(null);

export function useAdaptiveLayout() {
  const viewport = useContext(AdaptiveViewportContext);
  const inheritedBounds = useContext(AdaptiveContentContext);
  const [bounds, setBounds] = useState<ViewportRegion | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!node) return;
    const measure = () => {
      const { x, y, width, height } = node.getBoundingClientRect();
      setBounds(previous => previous && previous.x === x && previous.y === y && previous.width === width && previous.height === height
        ? previous : { x, y, width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [node, viewport]);
  const contentBounds = bounds ?? inheritedBounds ?? viewport.viewport;
  return { ...viewport, bounds: contentBounds, attachContainer: setNode, navigation: navigationMode(viewport.viewport.width),
    ...resolvePaneGeometry(contentBounds, viewport.segments) };
}
