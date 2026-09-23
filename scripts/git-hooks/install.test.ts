import { describe, expect, it } from 'vitest';
import { HOOKS_PATH, plan } from './install.ts';

const base = { ci: false, insideWorkTree: true, currentHooksPath: null, force: false };

describe('git hooks installer', () => {
  it('installs in a checkout without hooks', () => {
    expect(plan(base).action).toBe('install');
  });

  it('skips in CI, outside git and when already installed', () => {
    expect(plan({ ...base, ci: true }).action).toBe('skip');
    expect(plan({ ...base, insideWorkTree: false }).action).toBe('skip');
    expect(plan({ ...base, currentHooksPath: HOOKS_PATH })).toEqual({
      action: 'skip',
      reason: 'Already installed.',
    });
  });

  it('keeps a hooks path someone set, unless forced', () => {
    expect(plan({ ...base, currentHooksPath: '.husky' })).toMatchObject({
      action: 'skip',
      reason: expect.stringContaining('--force'),
    });
    expect(plan({ ...base, currentHooksPath: '.husky', force: true }).action).toBe('install');
  });
});
