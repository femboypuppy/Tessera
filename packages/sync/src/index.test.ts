import { HocuspocusProvider } from '@hocuspocus/provider';
import { describe, expect, it } from 'vitest';
import { SERVICE_PRIORITY } from '@tessera/core';
import { SYNC_PACKAGE } from './index';

describe('@tessera/sync skeleton', () => {
  it('has the Hocuspocus client and the service priorities available', () => {
    expect(SYNC_PACKAGE).toBe('@tessera/sync');
    expect(typeof HocuspocusProvider).toBe('function');
    expect(SERVICE_PRIORITY.browser).toBe(50);
  });
});
