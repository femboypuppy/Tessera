import { describe, expect, it } from 'vitest';
import { hashToken, randomToken, safeEqual, SETUP_CODE_ALPHABET, setupCodeValue } from './tokens';

describe('setupCodeValue', () => {
  it('writes three groups of four unambiguous characters', () => {
    for (let run = 0; run < 200; run += 1) {
      expect(setupCodeValue()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it('uses every character about equally often', () => {
    const counts = new Map<string, number>();
    const codes = 4000;
    for (let run = 0; run < codes; run += 1) {
      for (const char of setupCodeValue().replaceAll('-', '')) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    const expected = (codes * 12) / SETUP_CODE_ALPHABET.length;
    expect([...counts.keys()].sort().join('')).toBe([...SETUP_CODE_ALPHABET].sort().join(''));
    // 1,500 expected per character: 20% is about 8 standard deviations, so this never flakes.
    for (const count of counts.values()) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.2);
    }
  });
});

describe('tokens', () => {
  it('are random, hashed and compared in constant time', () => {
    const token = randomToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(randomToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(safeEqual(token, token)).toBe(true);
    expect(safeEqual(token, `${token}x`)).toBe(false);
  });
});
