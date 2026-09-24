import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

/** Where a floating panel goes, in viewport coordinates. */
export interface FloatingPosition {
  top: number;
  left: number;
  placement: 'below' | 'above';
}

const MARGIN = 8;

/**
 * Places a panel of the given size next to an anchor rectangle: below it (or above when there's
 * no room), aligned to its left edge (or centered), always inside the viewport.
 */
export function placeFloating(
  anchor: DOMRect,
  size: { width: number; height: number },
  options: { gap?: number; align?: 'start' | 'center'; prefer?: 'below' | 'above' } = {},
): FloatingPosition {
  const gap = options.gap ?? 6;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const fitsBelow = below + size.height <= viewportHeight - MARGIN;
  const fitsAbove = above >= MARGIN;
  let placement: 'below' | 'above' = options.prefer ?? 'below';
  if (placement === 'below' && !fitsBelow && fitsAbove) placement = 'above';
  if (placement === 'above' && !fitsAbove && fitsBelow) placement = 'below';
  let top = placement === 'below' ? below : above;
  top = Math.max(MARGIN, Math.min(top, viewportHeight - size.height - MARGIN));
  let left =
    options.align === 'center' ? anchor.left + anchor.width / 2 - size.width / 2 : anchor.left;
  left = Math.max(MARGIN, Math.min(left, viewportWidth - size.width - MARGIN));
  return { top, left, placement };
}

/**
 * Keeps a floating panel positioned next to an anchor while it is open, following scrolling
 * (any scroll container) and window resizes.
 */
export function useFloatingPosition(
  panel: RefObject<HTMLElement | null>,
  getAnchor: (() => DOMRect | null) | null,
  options: { gap?: number; align?: 'start' | 'center'; prefer?: 'below' | 'above' } = {},
  key: unknown = null,
): FloatingPosition | null {
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const { gap, align, prefer } = options;
  const update = useCallback(() => {
    const element = panel.current;
    const anchor = getAnchor?.() ?? null;
    if (!element || !anchor) {
      setPosition(null);
      return;
    }
    const next = placeFloating(
      anchor,
      { width: element.offsetWidth, height: element.offsetHeight },
      { gap, align, prefer },
    );
    setPosition((current) =>
      current &&
      current.top === next.top &&
      current.left === next.left &&
      current.placement === next.placement
        ? current
        : next,
    );
  }, [panel, getAnchor, gap, align, prefer]);

  useLayoutEffect(() => {
    if (!getAnchor) {
      setPosition(null);
      return undefined;
    }
    update();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [getAnchor, update, key]);

  return position;
}
