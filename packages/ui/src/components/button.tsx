import { cva, type VariantProps } from 'class-variance-authority';
import { buttonVariants } from './button-variants';
import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Spinner } from './feedback';
import { Tooltip } from './overlays';

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (for example a router link) with button styles. */
  asChild?: boolean;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

/**
 * A button. Variants: `primary` (the one main action), `secondary` (default), `ghost`, `subtle`,
 * `danger`, `link`.
 *
 * @example
 * <Button variant="primary" onClick={save}>{t('save')}</Button>
 */
export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      type={asChild ? undefined : (type ?? 'button')}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-1.5">{children}</span>
          <Spinner className="absolute" size="sm" />
        </>
      ) : (
        children
      )}
    </Component>
  );
}

const iconButtonVariants = cva(
  'duration-fast inline-flex shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors ease-out select-none hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-active aria-pressed:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg [&_svg]:shrink-0',
  {
    variants: {
      size: {
        sm: 'size-6 [&_svg]:size-3.5',
        md: 'size-7 [&_svg]:size-4',
        lg: 'size-8 [&_svg]:size-[18px]',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface IconButtonProps
  extends Omit<ComponentProps<'button'>, 'children'>, VariantProps<typeof iconButtonVariants> {
  /** Accessible name, also shown as a tooltip unless `tooltip` is false. */
  label: string;
  icon: ReactNode;
  /** Tooltip content (defaults to `label`); false disables it. */
  tooltip?: ReactNode | false;
  /** Keyboard shortcut labels shown in the tooltip (from `formatShortcut`). */
  shortcut?: string[];
  asChild?: boolean;
}

/**
 * A square icon-only button with an accessible name and a tooltip.
 *
 * @example
 * <IconButton label={t('newPage')} icon={<Plus />} onClick={createPage} />
 */
export function IconButton({
  label,
  icon,
  tooltip,
  shortcut,
  size,
  className,
  asChild,
  type,
  ...props
}: IconButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  const button = (
    <Component
      aria-label={label}
      className={cn(iconButtonVariants({ size }), className)}
      type={asChild ? undefined : (type ?? 'button')}
      {...props}
    >
      {icon}
    </Component>
  );
  if (tooltip === false) return button;
  return (
    <Tooltip content={tooltip ?? label} shortcut={shortcut}>
      {button}
    </Tooltip>
  );
}

export { buttonVariants };
