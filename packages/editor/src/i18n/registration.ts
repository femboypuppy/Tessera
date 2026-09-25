import { createTranslator } from '@tessera/ui';

/**
 * The `editor` strings the feature registration needs at startup (command, panel and settings
 * titles). The whole namespace (`./en.ts`) loads with the lazy UI, which keeps the startup bundle
 * small; the keys are also in `en.ts`, so translations cover both (`registration.test.ts`).
 */
export const registration = {
  cmdCopyMarkdown: 'Copy page as markdown',
  cmdToggleFullWidth: 'Toggle full width',
  cmdToggleSmallText: 'Toggle small text',
  cmdWordCount: 'Word and character count',
  webEmbed: 'Web embed',
} as const;

export const t = createTranslator('editor', registration);
