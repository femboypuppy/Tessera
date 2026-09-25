import { describe, expect, it } from 'vitest';
import { buttonVariants } from '../components/button-variants';
import { cn } from './cn';

describe('cn', () => {
  it('knows the design system sizes are sizes, not colors', () => {
    expect(cn('text-accent-fg', 'text-ui')).toBe('text-accent-fg text-ui');
    expect(cn('text-fg-muted', 'text-2xs')).toBe('text-fg-muted text-2xs');
    expect(cn('text-sm', 'text-ui')).toBe('text-ui');
    expect(cn('text-fg', 'text-accent-fg')).toBe('text-accent-fg');
    expect(cn('shadow-subtle', 'shadow-popover')).toBe('shadow-popover');
  });

  it('keeps the text color of a small primary button', () => {
    expect(cn(buttonVariants({ variant: 'primary', size: 'sm' }))).toContain('text-accent-fg');
  });
});
