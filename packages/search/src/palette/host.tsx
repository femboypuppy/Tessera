import { lazy, Suspense, useEffect, useState } from 'react';
import { paletteStore, usePaletteState } from './store';

const loadPalette = () => import('./command-palette');
const CommandPalette = lazy(loadPalette);

/**
 * The palette's overlay (`overlays` contribution): renders nothing until the palette first
 * opens, and preloads the palette's code once the app is idle so Mod+K opens instantly.
 */
export function PaletteHost() {
  const { open } = usePaletteState();
  const [used, setUsed] = useState(open);
  const [mounted, setMounted] = useState(false);
  if (open && !used) setUsed(true);
  useCaptureTyping(open && !mounted);
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
      <OnMount onMount={setMounted} />
    </Suspense>
  );
}

/** Mounts with the palette (same Suspense boundary), after its input took focus. */
function OnMount({ onMount }: { onMount: (mounted: true) => void }) {
  useEffect(() => onMount(true), [onMount]);
  return null;
}

/**
 * While the palette is open but its code is still loading, keys typed after Mod+K go into the
 * palette's starting text instead of the page (the editor would take them otherwise). Escape
 * cancels; shortcuts, arrows and IME input pass through.
 */
function useCaptureTyping(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') paletteStore.close();
      else if (event.key === 'Backspace') paletteStore.editInitialQuery((q) => q.slice(0, -1));
      else if (event.key.length === 1) paletteStore.editInitialQuery((q) => q + event.key);
      else if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active]);
}
