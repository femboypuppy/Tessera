import { describe, expect, it } from 'vitest';
import { DESKTOP_PACKAGE, isTauri } from './index';

describe('@tessera/desktop skeleton', () => {
  it('detects that tests do not run inside Tauri', () => {
    expect(DESKTOP_PACKAGE).toBe('@tessera/desktop');
    expect(isTauri()).toBe(false);
  });
});
