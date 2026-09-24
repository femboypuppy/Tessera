// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTheme, watchTheme } from './theme';

afterEach(() => {
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('class');
});

function addTokens() {
  const style = document.createElement('style');
  style.textContent = `
    :root { --tess-accent: #5b5bd6; --tess-radius-md: 6px; --other: 1px; }
    :root[data-theme='dark'] { --tess-accent: #8080f0; }
  `;
  document.head.append(style);
}

describe('theme', () => {
  it('reads the mode and the --tess-* tokens declared on :root', () => {
    addTokens();
    const theme = readTheme();
    expect(theme.mode).toBe('light');
    expect(theme.tokens).toMatchObject({ accent: '#5b5bd6', 'radius-md': '6px' });
    expect(theme.tokens).not.toHaveProperty('other');
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(readTheme()).toMatchObject({ mode: 'dark', tokens: { accent: '#8080f0' } });
  });

  it('reports theme changes once, and ignores changes that leave the theme as it was', async () => {
    addTokens();
    const listener = vi.fn();
    const stop = watchTheme(listener);
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(listener.mock.lastCall?.[0]).toMatchObject({ mode: 'dark' });
    // A class that doesn't change any token: the listener stays quiet.
    root.setAttribute('class', 'is-resizing');
    root.setAttribute('data-other', 'x');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    root.setAttribute('data-theme', 'light');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
