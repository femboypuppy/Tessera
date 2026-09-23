/**
 * Writes `docs/plugins/api.md` from the SDK's TSDoc comments.
 *
 * Usage: `pnpm --filter @tessera/plugin-api docs:api`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { API_DOCS_PATH, generateApiDocs } from './api-docs';

mkdirSync(dirname(API_DOCS_PATH), { recursive: true });
writeFileSync(API_DOCS_PATH, generateApiDocs());
console.info(`Wrote ${API_DOCS_PATH}`);
