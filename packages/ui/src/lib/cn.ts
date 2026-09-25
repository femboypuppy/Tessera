import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge with the design system's own scale names. Without them it reads `text-ui` (a
 * font size) as a text color and drops the color it "conflicts" with: a small primary button lost
 * `text-accent-fg` and showed dark text on the accent.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['ui', '2xs'],
      shadow: ['subtle', 'popover', 'dialog'],
    },
  },
});

/**
 * Joins class names and resolves Tailwind conflicts (the last one wins).
 *
 * @example
 * cn('px-2 text-sm', isActive && 'bg-accent-subtle', className);
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
