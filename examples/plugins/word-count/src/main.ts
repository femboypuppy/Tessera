import { definePlugin, type PanelContext, type SettingsSchema } from '@tessera/plugin-api';
import { countText, formatReadingTime, type TextStats } from './stats';

const settings = {
  goal: {
    type: 'number',
    label: 'Word goal',
    description: 'Shows your progress towards a goal on every page. 0 turns it off.',
    default: 0,
    min: 0,
    max: 1_000_000,
    step: 50,
    unit: 'words',
  },
} satisfies SettingsSchema;

const STYLE = `
.wc { display: flex; flex-direction: column; gap: 16px; }
.wc-label { margin: 0; font-size: 12px; font-weight: 500; color: var(--tess-fg-muted); letter-spacing: .01em; }
.wc-number { margin: 2px 0 0; font-size: 40px; line-height: 1.1; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.wc-goal { display: flex; flex-direction: column; gap: 6px; }
.wc-bar { height: 6px; border-radius: 999px; background: var(--tess-hover); overflow: hidden; }
.wc-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--tess-accent); transition: width var(--tess-duration-normal) var(--tess-ease-out); }
.wc-bar[data-done] > span { background: var(--tess-success); }
.wc-goal p { margin: 0; font-size: 12px; color: var(--tess-fg-muted); }
.wc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0; }
.wc-grid > div { padding: 10px 12px; border: 1px solid var(--tess-border); border-radius: var(--tess-radius-lg); background: var(--tess-surface); }
.wc-grid dt { font-size: 12px; color: var(--tess-fg-muted); }
.wc-grid dd { margin: 2px 0 0; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.wc-page { margin: 0; font-size: 12px; color: var(--tess-fg-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wc-note { margin: 0; padding: 12px; border-radius: var(--tess-radius-lg); background: var(--tess-bg-subtle); color: var(--tess-fg-muted); font-size: 13px; }
.wc-note[data-tone=error] { background: var(--tess-warning-subtle); color: var(--tess-warning-text); }
`;

const numbers = new Intl.NumberFormat();

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attributes: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Renders the statistics of one page. */
function renderStats(doc: Document, stats: TextStats, title: string, goal: number): HTMLElement {
  const section = element(doc, 'section', { class: 'wc', 'aria-label': 'Word count' });
  const heading = element(doc, 'div');
  heading.append(
    element(doc, 'p', { class: 'wc-label' }, 'Words'),
    element(
      doc,
      'p',
      { class: 'wc-number', 'data-testid': 'word-count' },
      numbers.format(stats.words),
    ),
  );
  section.append(heading);
  if (goal > 0) {
    const ratio = Math.min(stats.words / goal, 1);
    const bar = element(doc, 'div', {
      class: 'wc-bar',
      role: 'progressbar',
      'aria-label': 'Progress towards your word goal',
      'aria-valuemin': '0',
      'aria-valuemax': String(goal),
      'aria-valuenow': String(Math.min(stats.words, goal)),
    });
    if (ratio >= 1) bar.setAttribute('data-done', '');
    const fill = element(doc, 'span');
    fill.style.width = `${Math.round(ratio * 100)}%`;
    bar.append(fill);
    const goalBlock = element(doc, 'div', { class: 'wc-goal' });
    goalBlock.append(
      bar,
      element(
        doc,
        'p',
        {},
        ratio >= 1
          ? `Goal reached: ${numbers.format(goal)} words 🎉`
          : `${Math.round(ratio * 100)}% of ${numbers.format(goal)} words`,
      ),
    );
    section.append(goalBlock);
  }
  const grid = element(doc, 'dl', { class: 'wc-grid' });
  for (const [label, value] of [
    ['Characters', numbers.format(stats.characters)],
    ['Without spaces', numbers.format(stats.charactersNoSpaces)],
    ['Reading time', formatReadingTime(stats.readingMinutes)],
    ['Paragraphs', numbers.format(stats.paragraphs)],
  ] as const) {
    const item = element(doc, 'div');
    item.append(element(doc, 'dt', {}, label), element(doc, 'dd', {}, value));
    grid.append(item);
  }
  section.append(grid, element(doc, 'p', { class: 'wc-page' }, `On “${title || 'Untitled'}”`));
  return section;
}

/** The side panel: counts the open page and follows edits and navigation. */
function renderPanel(ctx: PanelContext<typeof settings>) {
  const doc = ctx.root.ownerDocument;
  const style = element(doc, 'style', {}, STYLE);
  const body = element(doc, 'div', { 'aria-live': 'polite' });
  ctx.root.append(style, body);
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const show = (node: Node) => body.replaceChildren(node);
  const note = (text: string, tone?: 'error') =>
    element(doc, 'p', tone ? { class: 'wc-note', 'data-tone': tone } : { class: 'wc-note' }, text);

  const refresh = async () => {
    const run = (generation += 1);
    const pageId = ctx.pageId;
    if (!pageId) {
      show(note('Open a page to count its words.'));
      return;
    }
    try {
      const page = await ctx.api.pages.get(pageId);
      if (run !== generation) return;
      show(renderStats(doc, countText(page.content), page.title, ctx.api.settings.get('goal')));
    } catch (error) {
      if (run !== generation) return;
      show(note(error instanceof Error ? error.message : String(error), 'error'));
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 250);
  };

  const stops: Array<() => void> = [
    ctx.onPageChange(() => void refresh()),
    ctx.api.settings.onChange(() => void refresh()),
  ];
  try {
    stops.push(
      ctx.api.pages.onChange((event) => {
        if (event.pageId === ctx.pageId && (event.type === 'content' || event.type === 'updated'))
          later();
      }),
    );
  } catch {
    // Without the permission to read pages, refresh() shows why.
  }
  void refresh();
  return () => {
    clearTimeout(timer);
    for (const stop of stops) stop();
  };
}

export default definePlugin({
  settings,
  activate(api) {
    api.ui.addPanel({ id: 'count', title: 'Word count', icon: '🔢' });
  },
  panels: {
    count: renderPanel,
  },
});
