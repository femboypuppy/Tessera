import { cva, type VariantProps } from 'class-variance-authority';
import {
  Avatar as AvatarPrimitive,
  Separator as SeparatorPrimitive,
  VisuallyHidden as VisuallyHiddenPrimitive,
} from 'radix-ui';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { tUi } from '../i18n/index';
import { cn } from '../lib/cn';

/** A loading spinner. Announced to screen readers as "Loading…" unless `label` is empty. */
export function Spinner({
  size = 'md',
  className,
  label,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}) {
  const px = size === 'sm' ? 14 : size === 'lg' ? 24 : 18;
  const text = label ?? tUi('loading');
  return (
    <span
      role={text ? 'status' : undefined}
      className={cn('inline-flex items-center justify-center text-fg-subtle', className)}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="animate-spin"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {text ? <span className="sr-only">{text}</span> : null}
    </span>
  );
}

/** A placeholder block for content that is loading. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-shimmer rounded-md bg-active', className)}
      {...props}
    />
  );
}

/** One key, as in a keyboard shortcut. */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-bg-subtle px-1 font-sans text-2xs font-medium text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A key combination (pass labels from `formatShortcut` in `@tessera/core`). Inside a control whose
 * accessible name should not include the keys (a menu item, a sidebar row), pass `aria-hidden`.
 *
 * @example
 * <KeyCombo keys={formatShortcut('Mod+K', platform.isApple)} />
 */
export function KeyCombo({
  keys,
  className,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & { keys: readonly string[] }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} {...props}>
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key}</Kbd>
      ))}
    </span>
  );
}

export const badgeVariants = cva(
  'inline-flex max-w-full items-center gap-1 truncate rounded-sm px-1.5 text-xs leading-5 font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-hover text-fg-muted',
        accent: 'bg-accent-subtle text-accent-text',
        success: 'bg-success-subtle text-success-text',
        warning: 'bg-warning-subtle text-warning-text',
        danger: 'bg-danger-subtle text-danger-text',
        default: 'bg-tag-default-bg text-tag-default-fg',
        gray: 'bg-tag-gray-bg text-tag-gray-fg',
        brown: 'bg-tag-brown-bg text-tag-brown-fg',
        orange: 'bg-tag-orange-bg text-tag-orange-fg',
        yellow: 'bg-tag-yellow-bg text-tag-yellow-fg',
        green: 'bg-tag-green-bg text-tag-green-fg',
        blue: 'bg-tag-blue-bg text-tag-blue-fg',
        purple: 'bg-tag-purple-bg text-tag-purple-fg',
        pink: 'bg-tag-pink-bg text-tag-pink-fg',
        red: 'bg-tag-red-bg text-tag-red-fg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

/**
 * A small label. `tone` accepts status tones and every tag color (select options).
 *
 * @example
 * <Badge tone={option.color}>{option.name}</Badge>
 */
export function Badge({
  tone,
  className,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

// Presence colors are literal hex values (USER_COLORS in core), so the text color is computed from
// them. This near-black clears 4.5:1 on every presence color that white doesn't.
const DARK_TEXT = '#111110';

/** Relative luminance (WCAG 2.x) of a `#rgb` or `#rrggbb` color, or null for anything else. */
function luminance(color: string): number | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((at) => {
    const channel = parseInt(full.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or near-black, whichever contrasts more with `background` (white when unknown). */
export function readableTextColor(background: string | undefined): string {
  const bg = background === undefined ? null : luminance(background);
  if (bg === null) return '#ffffff';
  const onWhite = 1.05 / (bg + 0.05);
  const onDark = (bg + 0.05) / ((luminance(DARK_TEXT) ?? 0) + 0.05);
  return onDark > onWhite ? DARK_TEXT : '#ffffff';
}

/** A person's avatar: an image, or initials on their presence color. */
export function Avatar({
  name,
  color,
  src,
  size = 'md',
  className,
  style,
}: {
  name: string;
  color?: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  style?: CSSProperties;
}) {
  const dimension =
    size === 'sm' ? 'size-5 text-[9px]' : size === 'lg' ? 'size-8 text-xs' : 'size-6 text-2xs';
  return (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none',
        dimension,
        className,
      )}
      style={{
        backgroundColor: color ?? 'var(--tess-fg-subtle)',
        color: readableTextColor(color),
        ...style,
      }}
      title={name}
    >
      {src ? (
        <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" />
      ) : null}
      <AvatarPrimitive.Fallback delayMs={src ? 300 : 0} aria-label={name}>
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/** Overlapping avatars with a "+N" counter. */
export function AvatarStack({
  people,
  max = 4,
  size = 'md',
  className,
}: {
  people: ReadonlyArray<{ id: string; name: string; color?: string; src?: string }>;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className={cn('flex items-center -space-x-1.5', className)}>
      {shown.map((person) => (
        <Avatar
          key={person.id}
          name={person.name}
          color={person.color}
          src={person.src}
          size={size}
          className="ring-2 ring-bg"
        />
      ))}
      {extra > 0 ? (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-active text-2xs font-medium text-fg-muted ring-2 ring-bg">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

/** A horizontal or vertical divider. */
export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

/** Content for screen readers only. */
export const VisuallyHidden = VisuallyHiddenPrimitive.Root;

/**
 * The empty, error or "nothing here yet" state of a view: an icon, a title, a line of help and
 * optional actions.
 *
 * @example
 * <EmptyState icon={<Trash2 />} title={t('trashEmpty')} description={t('trashEmptyHint')} />
 */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
  tone = 'neutral',
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-sm flex-col items-center px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            'mb-4 flex size-11 items-center justify-center rounded-xl [&_svg]:size-5',
            tone === 'danger' ? 'bg-danger-subtle text-danger-text' : 'bg-hover text-fg-muted',
          )}
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      {description ? <p className="mt-1 text-ui text-fg-muted">{description}</p> : null}
      {actions ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
