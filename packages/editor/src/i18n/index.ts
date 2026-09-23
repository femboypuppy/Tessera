import { createTranslator } from '@tessera/ui';
import { en } from './en';

/** The editor's translator (`editor` namespace). `t('slashPlaceholder')`, or `t('editor:…')` anywhere. */
export const t = createTranslator('editor', en);
export { en };
