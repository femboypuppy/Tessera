import type { FeatureModule } from '@tessera/core';
import { backlinksFeature } from './backlinks';
import { databasesFeature } from './databases';
import { desktopFeature } from './desktop';
import { editorFeature } from './editor';
import { graphFeature } from './graph';
import { importExportFeature } from './import-export';
import { pluginsFeature } from './plugins';
import { searchFeature } from './search';
import { syncFeature } from './sync';

/**
 * Every feature module, in load order (equal-priority services resolve in this order). The shell
 * imports this list after i18n is ready. Owned by the Architect: agents change their own
 * `features/<area>/index.ts`, never this file.
 */
export const features: FeatureModule[] = [
  editorFeature,
  syncFeature,
  databasesFeature,
  searchFeature,
  graphFeature,
  backlinksFeature,
  pluginsFeature,
  importExportFeature,
  desktopFeature,
];
