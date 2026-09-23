import { createTranslator } from '@tessera/ui';
import { en } from './en';

/** Translator for the `desktop` namespace (`t('pickerTitle')`, or `t('desktop:pickerTitle')` anywhere). */
export const t = createTranslator('desktop', en);
