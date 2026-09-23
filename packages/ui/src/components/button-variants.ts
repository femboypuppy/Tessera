import { cva } from 'class-variance-authority';

/** Button styles, shared by `Button` and components that style Radix parts as buttons. */
export const buttonVariants = cva(
  'duration-fast relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors ease-out select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
        secondary: 'border border-border bg-surface text-fg shadow-subtle hover:bg-hover',
        ghost: 'text-fg-muted hover:bg-hover hover:text-fg',
        subtle: 'bg-hover text-fg hover:bg-active',
        danger: 'bg-danger text-danger-fg hover:bg-danger-hover',
        link: 'h-auto px-0 text-accent-text underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 px-2.5 text-ui [&_svg]:size-3.5',
        md: 'h-8 px-3 text-sm [&_svg]:size-4',
        lg: 'h-10 px-4 text-sm [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);
