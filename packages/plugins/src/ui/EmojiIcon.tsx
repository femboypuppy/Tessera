import type { IconComponent } from '@tessera/core';
import { cn } from '@tessera/ui';

const cache = new Map<string, IconComponent>();

/**
 * An icon component that shows an emoji, sized like a lucide icon, for plugin commands, panels
 * and slash-menu items. Components are cached per emoji so their identity stays stable.
 */
export function emojiIcon(emoji: string): IconComponent {
  let Icon = cache.get(emoji);
  if (!Icon) {
    const EmojiIcon: IconComponent = ({ className }) => (
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center text-[14px] leading-none',
          className,
        )}
      >
        {emoji}
      </span>
    );
    Icon = EmojiIcon;
    cache.set(emoji, Icon);
  }
  return Icon;
}
