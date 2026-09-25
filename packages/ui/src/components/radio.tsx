import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** A group of radio buttons. */
export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn('flex gap-2', className)} {...props} />;
}

/** One radio button, rendered as a selectable card with a label. */
export function RadioCard({
  value,
  label,
  description,
  icon,
  className,
}: {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      className={cn(
        'duration-fast flex min-w-0 flex-1 flex-col items-start gap-1 rounded-lg border border-border bg-bg p-3 text-left transition-colors hover:bg-hover data-[state=checked]:border-accent data-[state=checked]:bg-accent-subtle',
        className,
      )}
    >
      {icon ? <span className="text-fg-muted [&_svg]:size-4">{icon}</span> : null}
      <span className="text-sm font-medium">{label}</span>
      {description ? <span className="text-xs text-fg-muted">{description}</span> : null}
    </RadioGroupPrimitive.Item>
  );
}
