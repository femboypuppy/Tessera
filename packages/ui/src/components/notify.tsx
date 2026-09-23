import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { useSyncExternalStore, type ReactNode } from 'react';
import { tUi } from '../i18n/index';
import { cn } from '../lib/cn';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from './overlays';

// ---------------------------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------------------------

export interface ToastInput {
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
  /** An action button, typically "Undo". */
  action?: { label: string; onClick: () => void };
  /** Default 5 s (errors 8 s). */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  open: boolean;
}

let toasts: ToastItem[] = [];
let nextToastId = 1;
const toastListeners = new Set<() => void>();
const emitToasts = () => {
  for (const listener of [...toastListeners]) listener();
};

/** Dismisses a toast. */
export function dismissToast(id: number): void {
  toasts = toasts.map((item) => (item.id === id ? { ...item, open: false } : item));
  emitToasts();
  setTimeout(() => {
    toasts = toasts.filter((item) => item.id !== id);
    emitToasts();
  }, 300);
}

/**
 * Shows a toast (rendered by `<Toaster />`). Returns a handle to dismiss it early.
 *
 * @example
 * toast({ title: t('movedToTrash'), action: { label: t('undo'), onClick: restore } });
 */
export function toast(input: ToastInput | string): { id: number; dismiss: () => void } {
  const item: ToastItem = {
    ...(typeof input === 'string' ? { title: input } : input),
    id: nextToastId,
    open: true,
  };
  nextToastId += 1;
  toasts = [...toasts.slice(-4), item];
  emitToasts();
  return { id: item.id, dismiss: () => dismissToast(item.id) };
}

const toastIcons = {
  default: null,
  success: <CheckCircle2 className="size-4 text-success-text" aria-hidden="true" />,
  warning: <AlertTriangle className="size-4 text-warning-text" aria-hidden="true" />,
  error: <XCircle className="size-4 text-danger-text" aria-hidden="true" />,
} as const;

/** Renders toasts (bottom right; swipe or Escape to dismiss). Mount once. */
export function Toaster() {
  const items = useSyncExternalStore(
    (listener) => {
      toastListeners.add(listener);
      return () => toastListeners.delete(listener);
    },
    () => toasts,
    () => toasts,
  );
  return (
    <ToastPrimitive.Provider swipeDirection="right" label={tUi('notifications')}>
      {items.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          open={item.open}
          duration={item.durationMs ?? (item.variant === 'error' ? 8000 : 5000)}
          onOpenChange={(open) => {
            if (!open) dismissToast(item.id);
          }}
          className={cn(
            'group pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border bg-surface-raised p-3 pr-2 text-fg shadow-popover data-[state=closed]:animate-fade-out data-[state=open]:animate-toast-in data-[swipe=end]:animate-fade-out data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
          )}
        >
          {item.variant && item.variant !== 'default' ? (
            <span className="mt-0.5">{toastIcons[item.variant]}</span>
          ) : null}
          <div className="min-w-0 flex-1">
            <ToastPrimitive.Title className="text-sm font-medium">
              {item.title}
            </ToastPrimitive.Title>
            {item.description ? (
              <ToastPrimitive.Description className="mt-0.5 text-ui text-fg-muted">
                {item.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          {item.action ? (
            <ToastPrimitive.Action
              altText={item.action.label}
              onClick={item.action.onClick}
              className="duration-fast inline-flex h-7 shrink-0 items-center rounded-md px-2 text-ui font-medium text-accent-text transition-colors hover:bg-hover"
            >
              {item.action.label}
            </ToastPrimitive.Action>
          ) : null}
          <ToastPrimitive.Close
            aria-label={tUi('dismiss')}
            className="duration-fast inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
          >
            <X className="size-3.5" aria-hidden="true" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed right-0 bottom-0 z-[var(--tess-z-toast)] m-0 flex w-full max-w-sm list-none flex-col gap-2 p-4 outline-none" />
    </ToastPrimitive.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------------------------

export interface ConfirmInput {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmInput {
  resolve: (value: boolean) => void;
}

let pending: PendingConfirm | null = null;
const queue: PendingConfirm[] = [];
const confirmListeners = new Set<() => void>();
const emitConfirm = () => {
  for (const listener of [...confirmListeners]) listener();
};

/** Resolves `entry` once; later calls for the same entry (click, then close) are ignored. */
function settle(entry: PendingConfirm, value: boolean) {
  if (pending !== entry) return;
  pending = queue.shift() ?? null;
  entry.resolve(value);
  emitConfirm();
}

/**
 * Asks the user to confirm (rendered by `<ConfirmHost />`). Resolves to true when confirmed.
 *
 * @example
 * if (await confirm({ title: t('deleteForever'), destructive: true })) await remove();
 */
export function confirm(input: ConfirmInput): Promise<boolean> {
  return new Promise((resolve) => {
    const entry = { ...input, resolve };
    if (pending) queue.push(entry);
    else pending = entry;
    emitConfirm();
  });
}

/** Renders pending confirmations. Mount once. */
export function ConfirmHost() {
  const current = useSyncExternalStore(
    (listener) => {
      confirmListeners.add(listener);
      return () => confirmListeners.delete(listener);
    },
    () => pending,
    () => pending,
  );
  return (
    <AlertDialog
      open={current !== null}
      onOpenChange={(open) => {
        if (!open && current) settle(current, false);
      }}
    >
      {current ? (
        <AlertDialogContent>
          <AlertDialogTitle>{current.title}</AlertDialogTitle>
          {current.description ? (
            <AlertDialogDescription>{current.description}</AlertDialogDescription>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{current.cancelLabel ?? tUi('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive={current.destructive}
              onClick={() => settle(current, true)}
            >
              {current.confirmLabel ?? tUi('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  );
}

/** An inline notice (info, success, warning, danger). */
export function Callout({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'bg-info-subtle text-info-text',
    success: 'bg-success-subtle text-success-text',
    warning: 'bg-warning-subtle text-warning-text',
    danger: 'bg-danger-subtle text-danger-text',
  }[tone];
  const Icon = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle }[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-2.5 rounded-lg px-3 py-2.5 text-ui', styles, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-fg-muted">{children}</div> : null}
      </div>
    </div>
  );
}
