import { HocuspocusProvider } from '@hocuspocus/provider';
import { describe, expect, it } from 'vitest';
import { SYNC_PACKAGE } from './index';

describe('@tessera/sync skeleton', () => {
  it('has the Hocuspocus client available', () => {
    expect(SYNC_PACKAGE).toBe('@tessera/sync');
    expect(typeof HocuspocusProvider).toBe('function');
  });
});
