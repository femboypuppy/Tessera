/**
 * Text fields, labels and `Field`. The controls built on heavier Radix primitives live in their own
 * modules (`select`, `toggles`, `radio`, `tabs`, `scroll-area`): chunks split per module, so a
 * shell that only needs an input doesn't load a select box at startup.
 */
import { Label as LabelPrimitive } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/** The shared look of text fields and select boxes. */
export const field =
  'w-full rounded-md border border-border bg-bg px-2.5 text-sm text-fg shadow-subtle outline-none transition-colors duration-fast placeholder:text-fg-subtle hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger';

/** A single-line text field. */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(field, 'h-8', className)} {...props} />;
}

/** A multi-line text field. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea className={cn(field, 'min-h-20 py-1.5 leading-relaxed', className)} {...props} />
  );
}

/** A label for a form control. */
export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root className={cn('text-ui font-medium text-fg', className)} {...props} />
  );
}

/**
 * A labelled form field with optional help text and error, wired up for screen readers.
 *
 * @example
 * <Field label={t('displayName')} description={t('displayNameHelp')}>
 *   {(props) => <Input {...props} value={name} onChange={…} />}
 * </Field>
 */
export function Field({
  label,
  description,
  error,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = [description ? `${id}-description` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  const controlProps: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean } = {
    id,
  };
  if (describedBy) controlProps['aria-describedby'] = describedBy;
  if (error) controlProps['aria-invalid'] = true;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children(controlProps)}
      {description ? (
        <p id={`${id}-description`} className="text-xs text-fg-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
