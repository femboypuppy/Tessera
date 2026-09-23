import { useEffect, useState } from 'react';

/** Colors the graph draws with, read from the design tokens so both themes work. */
export interface GraphTheme {
  dark: boolean;
  background: string;
  label: string;
  labelStrong: string;
  edge: string;
  edgeHighlight: string;
  accent: string;
  neutral: string;
  surface: string;
  border: string;
  /** Distinct colors for groups (tags or top-level pages), most important first. */
  groups: string[];
  font: string;
}

// Tag colors in an order that keeps neighbors distinct; the accent leads.
const GROUP_TOKENS = [
  '--tess-accent',
  '--tess-tag-blue-fg',
  '--tess-tag-pink-fg',
  '--tess-tag-green-fg',
  '--tess-tag-orange-fg',
  '--tess-tag-purple-fg',
  '--tess-tag-red-fg',
  '--tess-tag-yellow-fg',
  '--tess-tag-brown-fg',
];

const FALLBACK: GraphTheme = {
  dark: false,
  background: '#ffffff',
  label: '#6b6a66',
  labelStrong: '#1f1e1d',
  edge: '#d8d7d4',
  edgeHighlight: '#5b5bd6',
  accent: '#5b5bd6',
  neutral: '#8f8e8a',
  surface: '#ffffff',
  border: '#e9e9e7',
  groups: ['#5b5bd6', '#2b6fa8', '#b3437a', '#2f7a4e', '#b35c1c', '#7d4f9e', '#c4403a', '#8f6100'],
  font: 'Inter Variable, ui-sans-serif, system-ui, sans-serif',
};

/** Reads the graph colors from the CSS variables on `<html>`. */
export function readGraphTheme(
  element: Element | null = globalThis.document?.documentElement ?? null,
): GraphTheme {
  if (!element || typeof getComputedStyle !== 'function') return FALLBACK;
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const dark = element.getAttribute('data-theme') === 'dark';
  return {
    dark,
    background: read('--tess-bg', FALLBACK.background),
    label: read('--tess-fg-muted', FALLBACK.label),
    labelStrong: read('--tess-fg', FALLBACK.labelStrong),
    edge: read('--tess-border-strong', FALLBACK.edge),
    edgeHighlight: read('--tess-accent', FALLBACK.edgeHighlight),
    accent: read('--tess-accent', FALLBACK.accent),
    neutral: read('--tess-fg-subtle', FALLBACK.neutral),
    surface: read('--tess-surface-raised', FALLBACK.surface),
    border: read('--tess-border', FALLBACK.border),
    groups: GROUP_TOKENS.map((token, index) =>
      read(token, FALLBACK.groups[index] ?? FALLBACK.accent),
    ),
    font: read('--tess-font-sans', FALLBACK.font),
  };
}

/** The graph theme, updated when the app switches between light and dark. */
export function useGraphTheme(): GraphTheme {
  const [theme, setTheme] = useState(() => readGraphTheme());
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setTheme(readGraphTheme(root));
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    update();
    return () => observer.disconnect();
  }, []);
  return theme;
}

function parseHex(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Mixes two hex colors (`amount` 0 = `a`, 1 = `b`). Dimmed nodes mix into the background, so they
 * recede in both themes. Non-hex input returns `a` unchanged.
 */
export function mix(a: string, b: string, amount: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  if (!from || !to) return a;
  const channel = (i: 0 | 1 | 2) => Math.round(from[i] + (to[i] - from[i]) * amount);
  return `#${[channel(0), channel(1), channel(2)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
