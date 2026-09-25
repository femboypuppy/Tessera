/**
 * @tessera/ui — the design system: tokens (import `@tessera/ui/styles.css`), Radix-based
 * components, and the `t()` i18n helper. Every Tessera screen is built from these.
 */
export * from './i18n/i18n';
export { tUi } from './i18n/index';
export { cn } from './lib/cn';
export {
  Button,
  IconButton,
  buttonVariants,
  type ButtonProps,
  type IconButtonProps,
} from './components/button';
export {
  Avatar,
  AvatarStack,
  Badge,
  badgeVariants,
  EmptyState,
  Kbd,
  KeyCombo,
  readableTextColor,
  Separator,
  Skeleton,
  Spinner,
  VisuallyHidden,
} from './components/feedback';
export * from './components/overlays';
export * from './components/menus';
export * from './components/forms';
export * from './components/radio';
export * from './components/scroll-area';
export * from './components/select';
export * from './components/tabs';
export * from './components/toggles';
export * from './components/notify';
export * from './components/error-boundary';
export * from './components/layout';
export { EmojiPicker, loadEmojiData, type EmojiEntry } from './components/emoji-picker';
export { COVER_PRESETS, coverPresetBackground } from './covers';
