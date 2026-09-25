import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { cn } from '../lib/cn';

// A module of its own: the sidebar primitives in layout.tsx are part of the startup bundle, and
// Radix RadioGroup only needs to load with Settings and the menus that show swatches.

/**
 * A row of round color choices (a radio group).
 *
 * @example
 * <ColorSwatches label={t('color')} colors={USER_COLORS} value={color} onChange={setColor} />
 */
export function ColorSwatches({
  label,
  colors,
  value,
  onChange,
  className,
}: {
  label: string;
  colors: readonly string[];
  value: string;
  onChange: (color: string) => void;
  className?: string;
}) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value}
      onValueChange={onChange}
      className={cn('flex flex-wrap gap-2', className)}
      orientation="horizontal"
    >
      {colors.map((color) => (
        <RadioGroupPrimitive.Item
          key={color}
          value={color}
          aria-label={color}
          className="duration-fast size-6 rounded-full ring-offset-2 ring-offset-bg transition-transform hover:scale-110 data-[state=checked]:ring-2 data-[state=checked]:ring-fg"
          style={{ backgroundColor: color }}
        />
      ))}
    </RadioGroupPrimitive.Root>
  );
}
