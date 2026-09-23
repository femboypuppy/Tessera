import { createTranslator } from '@tessera/ui';
import { enCore } from './core';
import { en } from './en';

/**
 * `t` for the `db-views` namespace (every string of the views). The startup strings in `core.ts`
 * are part of it too, so views can use one translator.
 *
 * @example
 * t('rowCount', { count: 3 }); // "3 rows"
 */
export const t = createTranslator('db-views', { ...enCore, ...en });

export type DbViewsStrings = typeof en & typeof enCore;
