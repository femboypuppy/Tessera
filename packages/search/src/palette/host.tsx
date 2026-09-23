import { lazy, Suspense, useEffect, useState } from 'react';
import { usePaletteState } from './store';

const loadPalette = () => import('./command-palette');
const CommandPalette = lazy(loadPalette);

/**
 * The palette's overlay (`overlays` contribution): renders nothing until the palette first
 * opens, and preloads the palette's code once the app is idle so Mod+K opens instantly.
 */
export function PaletteHost() {
  const { open } = usePaletteState();
  const [used, setUsed] = useState(open);
  if (open && !used) setUsed(true);
  useEffect(() => {
    const preload = () => void loadPalette();
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(timer);
  }, []);
  if (!used) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette />
    </Suspense>
  );
}
