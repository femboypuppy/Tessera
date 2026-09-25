import { describe, expect, it } from 'vitest';
import { en } from './en';
import { registration } from './registration';

describe('startup strings', () => {
  it('are the same as in the full table', () => {
    for (const [key, value] of Object.entries(registration))
      expect(en[key as keyof typeof en], key).toBe(value);
  });
});
