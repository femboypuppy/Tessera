import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { IMPORTERS_PACKAGE } from './index';

describe('@tessera/importers skeleton', () => {
  it('round-trips a zip archive with fflate', () => {
    expect(IMPORTERS_PACKAGE).toBe('@tessera/importers');
    const zip = zipSync({ 'Notes/Hello.md': strToU8('# Hello') });
    expect(strFromU8(unzipSync(zip)['Notes/Hello.md'] ?? new Uint8Array())).toBe('# Hello');
  });
});
