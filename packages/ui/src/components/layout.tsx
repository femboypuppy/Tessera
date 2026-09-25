import { ChevronRight, X } from 'lucide-react';
import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react';
import { tUi } from '../i18n/index';
import { cn } from '../lib/cn';
import { IconButton } from './button';
import { KeyCombo } from './feedback';

// ---------------------------------------------------------------------------------------------
// Sidebar primitives
// ---------------------------------------------------------------------------------------------

/** The sidebar container (a navigation landmark). */
export function SidebarRoot({ className, ...props }: ComponentProps<'nav'>) {
  return (
    <nav
      className={cn('flex h-full min-h-0 flex-col bg-bg-subtle text-fg', className)}
      {...props}
    />
  );
}

export function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex shrink-0 flex-col gap-0.5 p-2', className)} {...props} />;
}

export function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2', className)}
      {...props}
    />
  );
}

export function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex shrink-0 flex-col gap-0.5 border-t border-border p-2', className)}
      {...props}
    />
  );
}

/** Class names of a sidebar row, for custom rows (the page tree) that need their own markup. */
export const sidebarItemClass =
  'group/item relative flex h-7 min-w-0 select-none items-center gap-2 rounded-md px-2 text-sm text-fg-muted outline-none transition-colors duration-fast hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus data-[active=true]:bg-active data-[active=true]:font-medium data-[active=true]:text-fg [&_svg]:size-4 [&_svg]:shrink-0';

/**
 * A sidebar row (a button, or a link with `asChild`-style `render`).
 *
 * @example
 * <SidebarItem icon={<Trash2 />} label={t('trash')} onClick={openTrash} />
 */
export function SidebarItem({
  icon,
  label,
  active,
  shortcut,
  trailing,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'children'> & {
  icon?: ReactNode;
  label: ReactNode;
  active?: boolean;
  shortcut?: readonly string[];
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(sidebarItemClass, 'w-full text-left', className)}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut?.length ? (
        <KeyCombo
          keys={shortcut}
          aria-hidden="true"
          className="duration-fast opacity-0 transition-opacity group-hover/item:opacity-100"
        />
      ) : null}
      {trailing}
    </button>
  );
}

/**
 * A titled group of sidebar rows, optionally collapsible, with an action (for example "+") that
 * shows on hover.
 */
export function SidebarSection({
  title,
  action,
  collapsible = false,
  defaultOpen = true,
  children,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={cn('mt-3 first:mt-1', className)} aria-labelledby={`${id}-title`}>
      <div className="group/section flex h-6 items-center gap-1 px-2">
        {collapsible ? (
          <button
            type="button"
            id={`${id}-title`}
            aria-expanded={open}
            aria-controls={`${id}-content`}
            onClick={() => setOpen((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-xs font-medium text-fg-subtle outline-none hover:text-fg-muted focus-visible:ring-2 focus-visible:ring-focus"
          >
            <span className="truncate">{title}</span>
            <ChevronRight
              className={cn('duration-fast size-3 transition-transform', open && 'rotate-90')}
              aria-hidden="true"
            />
          </button>
        ) : (
          <h2
            id={`${id}-title`}
            className="min-w-0 flex-1 truncate text-xs font-medium text-fg-subtle"
          >
            {title}
          </h2>
        )}
        {action ? (
          <div className="duration-fast flex opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100">
            {action}
          </div>
        ) : null}
      </div>
      {!collapsible || open ? (
        <div id={`${id}-content`} className="mt-0.5 flex flex-col gap-px">
          {children}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Panel primitives
// ---------------------------------------------------------------------------------------------

/** A side panel (complementary landmark). */
export function Panel({ className, ...props }: ComponentProps<'aside'>) {
  return (
    <aside className={cn('flex h-full min-h-0 flex-col bg-bg text-fg', className)} {...props} />
  );
}

export function PanelHeader({
  title,
  icon,
  actions,
  onClose,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex h-[var(--tess-topbar-height)] shrink-0 items-center gap-2 border-b border-border px-3',
        className,
      )}
    >
      {icon ? <span className="text-fg-muted [&_svg]:size-4">{icon}</span> : null}
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
      {actions}
      {onClose ? <IconButton label={tUi('close')} icon={<X />} onClick={onClose} /> : null}
    </header>
  );
}

export function PanelBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto p-3', className)} {...props} />;
}

// ---------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------

/** Tracks a CSS media query (`(max-width: 768px)`, `(prefers-reduced-motion: reduce)`). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** True below the phone/tablet breakpoint (768px), where the sidebar becomes a drawer. */
export function useIsCompact(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
