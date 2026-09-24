import { createTranslator } from '@tessera/ui';
import { en } from './en';

/** `t` for the `sync` namespace (`t('storageFullTitle')`, or `t('sync:…')` anywhere). */
export const t = createTranslator('sync', en);
