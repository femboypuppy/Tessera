/**
 * The Tessera brand, as data: the logo geometry and the colors it takes from the design tokens.
 * `render-brand.ts` writes every SVG from these functions, so the mark, the app icon, the
 * wordmarks and the favicon can never drift apart.
 *
 * The mark is a 3×3 mosaic (32 units: 9.2-unit tiles, 2.2-unit grout). Five solid tiles draw a T;
 * the other four are faint tints of the same color, so the T dominates at 16 px and the mark reads
 * on light and dark backgrounds alike.
 */

export interface BrandColors {
  /** `--tess-accent`: the one accent color, identical in both themes. */
  accent: string;
  /** `--tess-accent-hover` (dark): the lighter end of the app icon gradient. */
  accentLight: string;
  /** `--tess-accent-text` (light): the deeper end of the app icon gradient. */
  accentDeep: string;
  /** `--tess-fg` in the light theme: wordmark text on light backgrounds. */
  fgLight: string;
  /** `--tess-fg` in the dark theme: wordmark text on dark backgrounds. */
  fgDark: string;
  /** `--tess-bg` in both themes. */
  bgLight: string;
  bgDark: string;
}

type TokenBlock = Record<string, string>;

/** Reads `--tess-*` variables from one `{ … }` block of tokens.css. */
function readBlock(css: string, selector: string): TokenBlock {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`tokens.css has no "${selector}" block`);
  const end = css.indexOf('\n}', start);
  const block = css.slice(start, end);
  const tokens: TokenBlock = {};
  for (const match of block.matchAll(/--tess-([a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) tokens[name] = value.trim();
  }
  return tokens;
}

function requireToken(block: TokenBlock, name: string): string {
  const value = block[name];
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`Token --tess-${name} is missing or not a hex color: ${String(value)}`);
  }
  return value.toLowerCase();
}

/** Takes the brand colors from `packages/ui/src/styles/tokens.css`. */
export function brandColorsFromTokens(css: string): BrandColors {
  const light = readBlock(css, ':root');
  const dark = readBlock(css, ":root[data-theme='dark']");
  return {
    accent: requireToken(light, 'accent'),
    accentLight: requireToken(dark, 'accent-hover'),
    accentDeep: requireToken(light, 'accent-text'),
    fgLight: requireToken(light, 'fg'),
    fgDark: requireToken(dark, 'fg'),
    bgLight: requireToken(light, 'bg'),
    bgDark: requireToken(dark, 'bg'),
  };
}

export interface Tile {
  col: number;
  row: number;
  /** 1 for the T, lower for the tints. */
  opacity: number;
}

/** The nine tiles of the mark: a solid T and four fading tints. */
export const TILES: readonly Tile[] = [
  { col: 0, row: 0, opacity: 1 },
  { col: 1, row: 0, opacity: 1 },
  { col: 2, row: 0, opacity: 1 },
  { col: 1, row: 1, opacity: 1 },
  { col: 1, row: 2, opacity: 1 },
  { col: 0, row: 1, opacity: 0.3 },
  { col: 2, row: 1, opacity: 0.3 },
  { col: 0, row: 2, opacity: 0.14 },
  { col: 2, row: 2, opacity: 0.14 },
];

interface GridOptions {
  x: number;
  y: number;
  tile: number;
  gap: number;
  radius: number;
  fill: string;
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** The tiles as `<rect>` elements, laid out on a grid. */
export function tileRects({ x, y, tile, gap, radius, fill }: GridOptions): string {
  return TILES.map((t) => {
    const opacity = t.opacity < 1 ? ` fill-opacity="${t.opacity}"` : '';
    return `<rect x="${round(x + t.col * (tile + gap))}" y="${round(y + t.row * (tile + gap))}" width="${round(tile)}" height="${round(tile)}" rx="${round(radius)}" fill="${fill}"${opacity}/>`;
  }).join('');
}

const MARK_GRID = (fill: string): GridOptions => ({
  x: 0,
  y: 0,
  tile: 9.2,
  gap: 2.2,
  radius: 2.3,
  fill,
});

/** The mark on a transparent background (logo, favicon). */
export function markSvg(colors: BrandColors, size = 32): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-label="Tessera">`,
    tileRects(MARK_GRID(colors.accent)),
    '</svg>',
  ].join('');
}

/** The mark in white on a rounded indigo square (desktop, PWA and touch icons). */
export function appIconSvg(colors: BrandColors, size = 512): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-label="Tessera">`,
    '<defs><linearGradient id="tessera-bg" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="${colors.accentLight}"/><stop offset="1" stop-color="${colors.accentDeep}"/>`,
    '</linearGradient></defs>',
    '<rect width="32" height="32" rx="7.2" fill="url(#tessera-bg)"/>',
    tileRects({ x: 5.6, y: 5.6, tile: 6, gap: 1.4, radius: 1.4, fill: '#ffffff' }),
    '</svg>',
  ].join('');
}

/** Wordmark layout in mark units: the text's cap height is 22 of the mark's 32 units. */
export const WORDMARK = {
  text: 'Tessera',
  weight: 600,
  capHeight: 22,
  gap: 11,
  tracking: -0.012,
} as const;

/** The mark followed by the outlined name. `textPath` is SVG path data already in mark units. */
export function wordmarkSvg(
  colors: BrandColors,
  theme: 'light' | 'dark',
  textPath: string,
  textWidth: number,
  height = 64,
): string {
  const width = 32 + WORDMARK.gap + textWidth + 1;
  const fg = theme === 'light' ? colors.fgLight : colors.fgDark;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} 32" width="${round((width / 32) * height)}" height="${height}" role="img" aria-label="Tessera">`,
    tileRects(MARK_GRID(colors.accent)),
    `<path d="${textPath}" fill="${fg}"/>`,
    '</svg>',
  ].join('');
}
