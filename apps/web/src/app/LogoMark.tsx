import { cn } from '@tessera/ui';

/** The logo's nine tiles (`assets/brand/logo-mark.svg`): a solid T among fainter tiles. */
const TILES = [
  [0, 0, 1],
  [11.4, 0, 1],
  [22.8, 0, 1],
  [11.4, 11.4, 1],
  [11.4, 22.8, 1],
  [0, 11.4, 0.3],
  [22.8, 11.4, 0.3],
  [0, 22.8, 0.14],
  [22.8, 22.8, 0.14],
] as const;

/** The Tessera mark in the accent color. Decorative: the product name is always written next to it. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('text-accent', className)}
      aria-hidden="true"
      focusable="false"
    >
      {TILES.map(([x, y, opacity]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="9.2"
          height="9.2"
          rx="2.3"
          fill="currentColor"
          fillOpacity={opacity}
        />
      ))}
    </svg>
  );
}
