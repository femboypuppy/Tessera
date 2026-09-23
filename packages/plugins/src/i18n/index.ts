import { createTranslator } from '@tessera/ui';
import { en } from './en';

/** Translates `plugins:` strings. Light enough for the startup bundle. */
export const t = createTranslator('plugins', en);
