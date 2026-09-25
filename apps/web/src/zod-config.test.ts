import { describe, expect, it } from 'vitest';

describe('zod configuration', () => {
  it('runs zod jitless, without importing zod at startup', async () => {
    await import('./zod-config');
    const { z } = await import('zod');
    expect(z.config().jitless).toBe(true);
    // Parsing works, on the eval-free path.
    expect(z.object({ name: z.string() }).parse({ name: 'Ada' })).toEqual({ name: 'Ada' });
  });
});
