import { cn } from '@tessera/ui';

/**
 * A placeholder mosaic-tile mark in the accent color (Agent 10 designs the final logo in
 * `assets/`). Decorative: the product name is always written next to it.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('text-accent', className)}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="12" height="12" rx="3" fill="currentColor" />
      <rect x="17" y="3" width="12" height="12" rx="3" fill="currentColor" opacity="0.55" />
      <rect x="3" y="17" width="12" height="12" rx="3" fill="currentColor" opacity="0.55" />
      <rect x="17" y="17" width="12" height="12" rx="3" fill="currentColor" />
    </svg>
  );
}
