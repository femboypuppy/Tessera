/**
 * Vitest setup for packages that test React components in jsdom. Every jsdom package lists it in
 * `vitest.config.ts` (`setupFiles: ['@tessera/core/testing/setup-dom']`).
 *
 * - adds the jest-dom matchers (`toBeInTheDocument`, `toHaveAccessibleName`, …);
 * - unmounts rendered components after each test;
 * - polyfills the browser APIs jsdom lacks but Radix, ProseMirror and the shell use.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class IntersectionObserverStub {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds: readonly number[] = [0];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

if (typeof window !== 'undefined') {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= ResizeObserverStub;
  g.IntersectionObserver ??= IntersectionObserverStub;

  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList => {
      const list = {
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
      return list as MediaQueryList;
    };
  }

  window.scrollTo = () => undefined;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;

  const emptyRect = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  Range.prototype.getBoundingClientRect ??= emptyRect;
  Range.prototype.getClientRects ??= () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    }) as unknown as DOMRectList;
  document.elementFromPoint ??= () => null;

  let objectUrlCounter = 0;
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => {
      objectUrlCounter += 1;
      return `blob:jsdom/${objectUrlCounter}`;
    };
    URL.revokeObjectURL = () => undefined;
  }
}
