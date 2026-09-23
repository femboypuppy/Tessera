import type { ThemeInfo } from '@tessera/plugin-api';
import mermaid from 'mermaid';

/** What rendering a diagram produced. */
export type RenderResult = { svg: string } | { error: string };

/** Parses a CSS color into RGBA using the browser (handles every CSS color syntax). */
function rgba(value: string, doc: Document): [number, number, number, number] | null {
  const probe = doc.createElement('span');
  probe.style.color = value;
  if (!probe.style.color) return null;
  doc.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const parts = computed.match(/[\d.]+/g)?.map(Number);
  if (!parts || parts.length < 3) return null;
  const [r = 0, g = 0, b = 0, a = 1] = parts;
  return [r, g, b, a];
}

/**
 * A token as an opaque hex color: mermaid's color math needs plain colors, and several tokens are
 * translucent (they are meant to sit on the page background), so they are blended over it.
 */
export function solidColor(
  value: string | undefined,
  over: string | undefined,
  doc: Document,
): string | undefined {
  if (!value) return undefined;
  const color = rgba(value, doc);
  if (!color) return undefined;
  const base = (over && rgba(over, doc)) || [255, 255, 255, 1];
  const [r, g, b, a] = color;
  const mix = (channel: number, background: number) =>
    Math.round(channel * a + background * (1 - a));
  return `#${[mix(r, base[0]), mix(g, base[1]), mix(b, base[2])]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Mermaid's theme variables from Tessera's design tokens, so diagrams match the app. */
export function themeVariables(theme: ThemeInfo, doc: Document): Record<string, string | boolean> {
  const token = (name: string) => theme.tokens[name];
  const surface =
    solidColor(token('surface'), token('bg'), doc) ??
    (theme.mode === 'dark' ? '#252525' : '#ffffff');
  const solid = (name: string) => solidColor(token(name), surface, doc);
  const variables: Record<string, string | boolean | undefined> = {
    darkMode: theme.mode === 'dark',
    background: surface,
    fontFamily: token('font-sans'),
    fontSize: '14px',
    primaryColor: solid('accent-subtle'),
    primaryTextColor: solid('fg'),
    primaryBorderColor: solid('accent'),
    secondaryColor: solid('tag-green-bg'),
    secondaryTextColor: solid('tag-green-fg'),
    secondaryBorderColor: solid('tag-green-fg'),
    tertiaryColor: solid('bg-subtle'),
    tertiaryTextColor: solid('fg'),
    tertiaryBorderColor: solid('border-strong'),
    lineColor: solid('fg-muted'),
    textColor: solid('fg'),
    mainBkg: solid('accent-subtle'),
    nodeBorder: solid('accent'),
    clusterBkg: solid('bg-subtle'),
    clusterBorder: solid('border-strong'),
    edgeLabelBackground: surface,
    noteBkgColor: solid('tag-yellow-bg'),
    noteTextColor: solid('tag-yellow-fg'),
    noteBorderColor: solid('tag-yellow-fg'),
    actorBkg: solid('accent-subtle'),
    actorBorder: solid('accent'),
    actorTextColor: solid('fg'),
    signalColor: solid('fg-muted'),
    signalTextColor: solid('fg'),
    labelBoxBkgColor: solid('bg-subtle'),
    labelBoxBorderColor: solid('border-strong'),
    labelTextColor: solid('fg'),
    sectionBkgColor: solid('accent-subtle'),
    altSectionBkgColor: solid('bg-subtle'),
    taskBkgColor: solid('accent'),
    taskTextColor: solid('accent-fg'),
    activeTaskBkgColor: solid('tag-blue-bg'),
    activeTaskBorderColor: solid('tag-blue-fg'),
    doneTaskBkgColor: solid('tag-green-bg'),
    doneTaskBorderColor: solid('tag-green-fg'),
    gridColor: solid('border'),
    todayLineColor: solid('danger'),
    pie1: solid('accent'),
    pie2: solid('tag-green-fg'),
    pie3: solid('tag-orange-fg'),
    pie4: solid('tag-pink-fg'),
    pie5: solid('tag-blue-fg'),
    pie6: solid('tag-purple-fg'),
    pieStrokeColor: surface,
    pieOuterStrokeColor: surface,
    pieTitleTextColor: solid('fg'),
    pieSectionTextColor: '#ffffff',
    pieLegendTextColor: solid('fg'),
  };
  return Object.fromEntries(
    Object.entries(variables).filter(
      (entry): entry is [string, string | boolean] => entry[1] !== undefined,
    ),
  );
}

let configured = '';
let counter = 0;

/** Renders a diagram to SVG in the current theme. Invalid code returns mermaid's error message. */
export async function renderDiagram(
  code: string,
  theme: ThemeInfo,
  doc: Document,
): Promise<RenderResult> {
  const variables = themeVariables(theme, doc);
  const key = JSON.stringify(variables);
  if (key !== configured) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: variables,
      fontFamily: typeof variables.fontFamily === 'string' ? variables.fontFamily : undefined,
      // Tighter spacing than the defaults, so wide charts keep a readable size in a page.
      flowchart: { curve: 'basis', nodeSpacing: 28, rankSpacing: 36 },
    });
    configured = key;
  }
  try {
    await mermaid.parse(code);
    counter += 1;
    const { svg } = await mermaid.render(`tessera-mermaid-${counter}`, code);
    return { svg };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message.split('\n').slice(0, 4).join('\n') };
  }
}
